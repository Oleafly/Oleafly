use std::process::{Child, ExitStatus};
use std::time::{Duration, Instant};

pub fn exit_within(child: &mut Child, within: Duration) -> ExitStatus {
    let deadline = Instant::now() + within;
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            return status;
        }
        assert!(
            Instant::now() < deadline,
            "the process kept running past {within:?}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}
