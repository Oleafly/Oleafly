use std::time::{Duration, Instant};

use oleafly_online::live::session::SessionTuning;

pub const WAIT: Duration = Duration::from_secs(20);

pub fn tuning() -> SessionTuning {
    SessionTuning {
        tick: Duration::from_millis(20),
        trickle_every: Duration::from_millis(20),
        legacy_check: Duration::from_millis(400),
        legacy_grace: Duration::from_millis(50),
        legacy_every: Duration::from_millis(20),
        call_timeout: Duration::from_secs(5),
        ..SessionTuning::default()
    }
}

pub async fn eventually(what: &str, mut check: impl FnMut() -> bool) {
    let started = Instant::now();
    while !check() {
        assert!(started.elapsed() < WAIT, "timed out waiting until {what}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
