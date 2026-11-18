use std::time::Duration;

use ring::rand::{SecureRandom, SystemRandom};

const BACKOFF_MS: [u64; 5] = [500, 1_000, 2_000, 3_000, 5_000];
pub const QUICK_ATTEMPTS: usize = 25;
pub const LONGEST_WAIT_MS: u64 = 60_000;
const JITTER_FLOOR_MS: u64 = 100;
const STEADY_AFTER: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reached {
    Never,
    Briefly,
    Steady,
}

impl Reached {
    pub fn after(online: Duration) -> Reached {
        if online >= STEADY_AFTER {
            Reached::Steady
        } else {
            Reached::Briefly
        }
    }
}

fn within(floor: u64, cap: u64, random: u64) -> u64 {
    floor + random % (cap - floor + 1)
}

fn jittered(cap: u64, random: u64) -> u64 {
    within(JITTER_FLOOR_MS.min(cap), cap, random)
}

pub fn backoff_step(attempt: usize, reached: Reached) -> usize {
    if reached == Reached::Steady {
        0
    } else {
        attempt
    }
}

pub fn backoff_cap(attempt: usize) -> u64 {
    let quick = BACKOFF_MS[attempt.min(BACKOFF_MS.len() - 1)];
    if attempt < QUICK_ATTEMPTS {
        return quick;
    }
    let doublings = (attempt - QUICK_ATTEMPTS + 1).min(4) as u32;
    (quick << doublings).min(LONGEST_WAIT_MS)
}

pub fn random_u64() -> u64 {
    let mut random = [0u8; 8];
    let _ = SystemRandom::new().fill(&mut random);
    u64::from_le_bytes(random)
}

pub fn backoff_wait(attempt: usize) -> u64 {
    jittered(backoff_cap(attempt), random_u64())
}

pub fn busy_wait(attempt: usize, random: u64) -> u64 {
    let cap = backoff_cap(attempt);
    within(cap / 2, cap, random)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn the_first_minute_of_retries_never_waits_more_than_five_seconds() {
        assert_eq!(BACKOFF_MS.iter().max(), Some(&5_000));
        assert!((0..QUICK_ATTEMPTS).all(|attempt| backoff_cap(attempt) <= 5_000));
    }

    #[test]
    fn waits_grow_to_a_minute_after_many_failures_and_start_over_once_connected() {
        let caps: Vec<u64> = (0..50).map(backoff_cap).collect();
        assert!(caps.windows(2).all(|pair| pair[0] <= pair[1]), "{caps:?}");
        assert_eq!(caps[0], 500);
        assert!(caps[QUICK_ATTEMPTS] > 5_000, "{caps:?}");
        assert_eq!(caps[49], LONGEST_WAIT_MS);
        assert!(caps.iter().all(|cap| *cap <= LONGEST_WAIT_MS));
        let average_seconds: u64 = caps.iter().map(|cap| cap / 2).sum::<u64>() / 1_000;
        assert!(
            average_seconds > 60 * 10,
            "{average_seconds} s over 50 failures"
        );
        assert_eq!(backoff_cap(backoff_step(49, Reached::Steady)), 500);
        assert_eq!(
            backoff_cap(backoff_step(49, Reached::Briefly)),
            LONGEST_WAIT_MS
        );
    }

    #[test]
    fn reconnect_waits_spread_over_the_whole_window() {
        for cap in BACKOFF_MS {
            for random in [0, 1, 99, 4_999, u64::MAX] {
                let wait = jittered(cap, random);
                assert!(
                    (JITTER_FLOOR_MS..=cap).contains(&wait),
                    "{wait} ms for a {cap} ms window"
                );
            }
        }
        let spread: BTreeSet<u64> = (0..200u64)
            .map(|n| jittered(5_000, n.wrapping_mul(0x9E37_79B9_7F4A_7C15)))
            .collect();
        assert!(spread.len() > 150, "{} distinct waits", spread.len());
    }

    #[test]
    fn only_a_connection_that_stayed_up_starts_the_waits_over() {
        assert_eq!(Reached::after(Duration::from_millis(300)), Reached::Briefly);
        assert_eq!(Reached::after(STEADY_AFTER), Reached::Steady);
        assert_eq!(backoff_step(3, Reached::Never), 3);
        assert_eq!(backoff_step(3, Reached::Briefly), 3);
        assert_eq!(backoff_step(3, Reached::Steady), 0);
    }
}
