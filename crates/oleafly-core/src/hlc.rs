use crate::ids::DeviceId;
use serde::{Deserialize, Serialize};

const WALL_MASK: u64 = (1 << 48) - 1;

#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize,
)]
#[serde(transparent)]
pub struct Hlc(u64);

impl Hlc {
    pub const ZERO: Self = Self(0);

    pub fn from_raw(raw: u64) -> Self {
        Self(raw)
    }

    pub fn raw(self) -> u64 {
        self.0
    }

    pub fn wall_ms(self) -> u64 {
        self.0 >> 16
    }

    pub fn counter(self) -> u64 {
        self.0 & 0xffff
    }

    fn at(now_ms: u64) -> Self {
        Self((now_ms & WALL_MASK) << 16)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct HlcClock {
    last: Hlc,
}

impl HlcClock {
    pub fn new() -> Self {
        Self { last: Hlc::ZERO }
    }

    pub fn restore(last: Hlc) -> Self {
        Self { last }
    }

    pub fn last(&self) -> Hlc {
        self.last
    }

    pub fn tick(&mut self, now_ms: u64) -> Hlc {
        let candidate = Hlc::at(now_ms);
        let next = candidate.max(Hlc(self.last.0.saturating_add(1)));
        self.last = next;
        next
    }

    pub fn observe(&mut self, remote: Hlc) -> Hlc {
        self.last = self.last.max(remote);
        self.last
    }
}

impl Default for HlcClock {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub struct Stamp {
    pub hlc: Hlc,
    pub device: DeviceId,
}

impl Stamp {
    pub fn new(hlc: Hlc, device: DeviceId) -> Self {
        Self { hlc, device }
    }
}

#[cfg(test)]
mod tests {
    use super::{Hlc, HlcClock, Stamp};
    use crate::ids::DeviceId;

    #[test]
    fn ticks_in_one_millisecond_count_up() {
        let mut clock = HlcClock::new();
        let first = clock.tick(1_000);
        let second = clock.tick(1_000);
        let third = clock.tick(1_000);
        assert_eq!(first.wall_ms(), 1_000);
        assert_eq!(first.counter(), 0);
        assert_eq!(second.counter(), 1);
        assert!(first < second && second < third);
        assert_eq!(clock.last(), third);
    }

    #[test]
    fn a_clock_set_back_still_ticks_forward() {
        let mut clock = HlcClock::new();
        let first = clock.tick(50_000);
        let second = clock.tick(1_000);
        assert!(second > first);
        assert_eq!(second.raw(), first.raw() + 1);
    }

    #[test]
    fn observing_a_remote_value_moves_past_it_on_the_next_tick() {
        let mut clock = HlcClock::new();
        clock.tick(1_000);
        let remote = Hlc::from_raw(90_000 << 16);
        assert_eq!(clock.observe(remote), remote);
        assert!(clock.tick(1_000) > remote);
        assert_eq!(clock.observe(Hlc::ZERO), clock.last());
    }

    #[test]
    fn wall_values_are_masked_to_48_bits() {
        let mut clock = HlcClock::new();
        let ticked = clock.tick(u64::MAX);
        assert_eq!(ticked.wall_ms(), (1 << 48) - 1);
    }

    #[test]
    fn restore_continues_from_the_persisted_value() {
        let mut clock = HlcClock::restore(Hlc::from_raw(41));
        assert_eq!(clock.tick(0), Hlc::from_raw(42));
    }

    #[test]
    fn stamps_order_by_hlc_then_device_bytes() {
        let low = DeviceId::parse("018f3c2a-7b1e-7f3a-8d4c-5e6f70813f9a").unwrap();
        let high = DeviceId::parse("018f3c2a-7b1e-7f3a-9d4c-5e6f70813f9a").unwrap();
        assert!(Stamp::new(Hlc::from_raw(2), low) > Stamp::new(Hlc::from_raw(1), high));
        assert!(Stamp::new(Hlc::from_raw(1), high) > Stamp::new(Hlc::from_raw(1), low));
    }
}
