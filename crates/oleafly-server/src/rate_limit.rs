use std::collections::HashMap;
use std::sync::Mutex;

use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::error::ServerError;
use crate::routes::ClientIp;
use crate::state::AppState;

pub const SIGN_IN_BURST: u32 = 60;
pub const SIGN_IN_PER_MINUTE: u32 = 60;
pub const MAX_TRACKED: usize = 10_000;
const TOKEN: u64 = 60_000;

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
        let mut buckets = self
            .buckets
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !buckets.contains_key(key) && buckets.len() >= self.max_tracked {
            buckets.retain(|_, bucket| self.refilled(*bucket, now) < self.capacity);
            if buckets.len() >= self.max_tracked {
                buckets.clear();
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
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .len()
    }

    fn refilled(&self, bucket: Bucket, now: i64) -> u64 {
        let elapsed = u64::try_from(now.saturating_sub(bucket.updated)).unwrap_or(0);
        bucket
            .units
            .saturating_add(elapsed.saturating_mul(self.per_minute))
            .min(self.capacity)
    }
}

pub async fn limit_sign_in(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path();
    if path.ends_with("/ws") || path.contains("/auth/") {
        let key = ip.unwrap_or_else(|| "unknown".to_string());
        if !state.rate_limiter.allow(&key, state.clock.now_ms()) {
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
    fn tracked_addresses_stay_bounded() {
        let limiter = RateLimiter::with_capacity(1, 60, 4);
        for index in 0..100 {
            assert!(limiter.allow(&format!("10.0.1.{index}"), 0));
        }
        assert!(limiter.tracked() <= 4);
    }
}
