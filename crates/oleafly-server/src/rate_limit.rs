use std::collections::HashMap;
use std::net::{IpAddr, Ipv6Addr};
use std::sync::{Mutex, PoisonError};

use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use oleafly_collab_protocol::ids::DeviceId;

use crate::error::ServerError;
use crate::routes::ClientIp;
use crate::state::AppState;

pub const CONNECT_BURST: u32 = 300;
pub const CONNECTS_PER_MINUTE: u32 = 600;
pub const DEVICE_RECONNECT_BURST: u32 = 60;
pub const DEVICE_RECONNECTS_PER_MINUTE: u32 = 60;
pub const MAX_TRACKED: usize = 10_000;
const TOKEN: u64 = 60_000;
const EVICT_SHARE: usize = 10;

pub fn client_key(ip: &str) -> String {
    match ip.parse::<IpAddr>().map(|address| address.to_canonical()) {
        Ok(IpAddr::V6(address)) => {
            let network = u128::from(address) & !((1u128 << 64) - 1);
            format!("{}/64", Ipv6Addr::from(network))
        }
        Ok(IpAddr::V4(address)) => address.to_string(),
        Err(_) => ip.to_string(),
    }
}

#[derive(Clone, Copy)]
struct Bucket {
    units: u64,
    updated: i64,
}

pub struct RateLimiter {
    capacity: u64,
    per_minute: u64,
    max_tracked: usize,
    buckets: Mutex<HashMap<String, Bucket>>,
}

impl RateLimiter {
    pub fn new(burst: u32, per_minute: u32) -> RateLimiter {
        RateLimiter::with_capacity(burst, per_minute, MAX_TRACKED)
    }

    pub fn with_capacity(burst: u32, per_minute: u32, max_tracked: usize) -> RateLimiter {
        RateLimiter {
            capacity: u64::from(burst) * TOKEN,
            per_minute: u64::from(per_minute),
            max_tracked: max_tracked.max(1),
            buckets: Mutex::new(HashMap::new()),
        }
    }

    pub fn allow(&self, key: &str, now: i64) -> bool {
        let mut buckets = self.buckets.lock().unwrap_or_else(PoisonError::into_inner);
        if !buckets.contains_key(key) && buckets.len() >= self.max_tracked {
            buckets.retain(|_, bucket| self.refilled(*bucket, now) < self.capacity);
            if buckets.len() >= self.max_tracked {
                self.evict_oldest(&mut buckets);
            }
        }
        let fresh = Bucket {
            units: self.capacity,
            updated: now,
        };
        let bucket = buckets.entry(key.to_string()).or_insert(fresh);
        let units = self.refilled(*bucket, now);
        let allowed = units >= TOKEN;
        *bucket = Bucket {
            units: if allowed { units - TOKEN } else { units },
            updated: now.max(bucket.updated),
        };
        allowed
    }

    pub fn tracked(&self) -> usize {
        self.buckets
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len()
    }

    fn evict_oldest(&self, buckets: &mut HashMap<String, Bucket>) {
        let excess = buckets.len() + 1 - self.max_tracked;
        let count = excess
            .max(self.max_tracked / EVICT_SHARE)
            .min(buckets.len());
        let mut ages: Vec<(i64, String)> = buckets
            .iter()
            .map(|(key, bucket)| (bucket.updated, key.clone()))
            .collect();
        ages.select_nth_unstable_by_key(count - 1, |(updated, _)| *updated);
        for (_, key) in ages.into_iter().take(count) {
            buckets.remove(&key);
        }
    }

    pub fn refund(&self, key: &str, now: i64) {
        let mut buckets = self.buckets.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(bucket) = buckets.get_mut(key) {
            let units = self.refilled(*bucket, now);
            *bucket = Bucket {
                units: units.saturating_add(TOKEN).min(self.capacity),
                updated: now.max(bucket.updated),
            };
        }
    }

    fn refilled(&self, bucket: Bucket, now: i64) -> u64 {
        let elapsed = u64::try_from(now.saturating_sub(bucket.updated)).unwrap_or(0);
        bucket
            .units
            .saturating_add(elapsed.saturating_mul(self.per_minute))
            .min(self.capacity)
    }
}

pub struct ConnectLimits {
    by_address: RateLimiter,
    by_device: RateLimiter,
}

impl Default for ConnectLimits {
    fn default() -> ConnectLimits {
        ConnectLimits::new(
            (CONNECT_BURST, CONNECTS_PER_MINUTE),
            (DEVICE_RECONNECT_BURST, DEVICE_RECONNECTS_PER_MINUTE),
        )
    }
}

impl ConnectLimits {
    pub fn new(address: (u32, u32), device: (u32, u32)) -> ConnectLimits {
        ConnectLimits {
            by_address: RateLimiter::new(address.0, address.1),
            by_device: RateLimiter::new(device.0, device.1),
        }
    }

    pub fn allow_address(&self, address: &str, now: i64) -> bool {
        self.by_address.allow(address, now)
    }

    pub fn admitted(&self, address: &str, device: DeviceId, now: i64) -> bool {
        self.by_address.refund(address, now);
        self.by_device.allow(&device.to_string(), now)
    }

    pub fn forgive(&self, address: &str, now: i64) {
        self.by_address.refund(address, now);
    }
}

pub async fn limit_sign_in(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path();
    let socket = path.ends_with("/ws");
    if socket || path.contains("/auth/") {
        let key = client_key(ip.as_deref().unwrap_or("unknown"));
        let now = state.clock.now_ms();
        let allowed = if socket {
            state.connects.allow_address(&key, now)
        } else {
            state.rate_limiter.allow(&key, now)
        };
        if !allowed {
            return ServerError::RateLimited.into_response();
        }
    }
    next.run(request).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_burst_is_allowed_then_refused_until_tokens_refill() {
        let limiter = RateLimiter::new(3, 60);
        assert!(limiter.allow("10.0.0.1", 0));
        assert!(limiter.allow("10.0.0.1", 0));
        assert!(limiter.allow("10.0.0.1", 0));
        assert!(!limiter.allow("10.0.0.1", 0));
        assert!(!limiter.allow("10.0.0.1", 999));
        assert!(limiter.allow("10.0.0.1", 1_000));
        assert!(!limiter.allow("10.0.0.1", 1_000));
    }

    #[test]
    fn each_address_has_its_own_bucket() {
        let limiter = RateLimiter::new(1, 1);
        assert!(limiter.allow("10.0.0.1", 0));
        assert!(!limiter.allow("10.0.0.1", 0));
        assert!(limiter.allow("10.0.0.2", 0));
    }

    #[test]
    fn a_long_quiet_spell_refills_only_up_to_the_burst() {
        let limiter = RateLimiter::new(2, 60);
        assert!(limiter.allow("10.0.0.1", 0));
        assert!(limiter.allow("10.0.0.1", 0));
        let later = 24 * 60 * 60 * 1_000;
        assert!(limiter.allow("10.0.0.1", later));
        assert!(limiter.allow("10.0.0.1", later));
        assert!(!limiter.allow("10.0.0.1", later));
    }

    #[test]
    fn addresses_in_one_ipv6_64_share_a_key_and_ipv4_keeps_its_own() {
        assert_eq!(client_key("2001:db8:1:2::1"), "2001:db8:1:2::/64");
        assert_eq!(
            client_key("2001:db8:1:2:aaaa:bbbb:cccc:dddd"),
            client_key("2001:db8:1:2::1")
        );
        assert_ne!(client_key("2001:db8:1:2::1"), client_key("2001:db8:1:3::1"));
        assert_eq!(client_key("203.0.113.7"), "203.0.113.7");
        assert_eq!(client_key("::ffff:203.0.113.7"), "203.0.113.7");
        assert_eq!(client_key("unknown"), "unknown");
    }

    #[test]
    fn a_flood_of_new_addresses_never_frees_a_busy_one() {
        let limiter = RateLimiter::with_capacity(1, 60, 4);
        assert!(limiter.allow("10.0.0.1", 0));
        for index in 0..100 {
            assert!(limiter.allow(&format!("10.0.1.{index}"), index));
            assert!(!limiter.allow("10.0.0.1", index), "freed after {index}");
        }
        assert!(limiter.tracked() <= 4);
    }

    #[test]
    fn a_refund_gives_back_one_token_and_never_passes_the_burst() {
        let limiter = RateLimiter::new(2, 60);
        assert!(limiter.allow("10.0.0.1", 0));
        assert!(limiter.allow("10.0.0.1", 0));
        assert!(!limiter.allow("10.0.0.1", 0));
        limiter.refund("10.0.0.1", 0);
        assert!(limiter.allow("10.0.0.1", 0));
        assert!(!limiter.allow("10.0.0.1", 0));
        for _ in 0..5 {
            limiter.refund("10.0.0.1", 0);
        }
        assert!(limiter.allow("10.0.0.1", 0));
        assert!(limiter.allow("10.0.0.1", 0));
        assert!(!limiter.allow("10.0.0.1", 0));
        limiter.refund("10.0.0.2", 0);
        assert_eq!(limiter.tracked(), 1);
    }

    #[test]
    fn verified_reconnects_cost_their_device_and_failed_ones_cost_the_address() {
        let limits = ConnectLimits::new((2, 60), (3, 60));
        let device = DeviceId::new_v7();
        for _ in 0..3 {
            assert!(limits.allow_address("10.0.0.1", 0));
            assert!(limits.admitted("10.0.0.1", device, 0));
        }
        assert!(limits.allow_address("10.0.0.1", 0));
        assert!(!limits.admitted("10.0.0.1", device, 0));
        assert!(limits.allow_address("10.0.0.1", 0));
        assert!(limits.admitted("10.0.0.1", DeviceId::new_v7(), 0));
        assert!(limits.allow_address("10.0.0.1", 0));
        assert!(limits.allow_address("10.0.0.1", 0));
        assert!(!limits.allow_address("10.0.0.1", 0));
        limits.forgive("10.0.0.1", 0);
        assert!(limits.allow_address("10.0.0.1", 0));
    }

    #[test]
    fn tracked_addresses_stay_bounded() {
        let limiter = RateLimiter::with_capacity(1, 60, 4);
        for index in 0..100 {
            assert!(limiter.allow(&format!("10.0.1.{index}"), 0));
        }
        assert!(limiter.tracked() <= 4);
    }
}
