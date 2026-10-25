//! Signals for a whole process group, so a terminal can hang up its shell
//! and the shell's jobs before it falls back to a kill.

use super::tree::ProcessTreeGuard;

/// Send `signal` to every process in `process_group`. Returns whether the
/// signal was delivered. Group ids 0 and 1 are refused: `kill(0, …)` would
/// signal the caller's own group and `kill(-1, …)` every process the user
/// owns.
pub fn signal_process_group(process_group: i32, signal: libc::c_int) -> bool {
    if process_group <= 1 {
        return false;
    }
    unsafe { libc::kill(-process_group, signal) == 0 }
}

impl ProcessTreeGuard {
    /// The process group this guard kills when it is dropped (0 once
    /// disarmed).
    pub fn process_group(&self) -> i32 {
        self.process_group
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn refuses_the_groups_that_would_signal_everything() {
        assert!(!signal_process_group(0, 0));
        assert!(!signal_process_group(1, 0));
        assert!(!signal_process_group(-42, 0));
    }

    #[test]
    fn hanging_up_a_group_stops_the_process_in_it() {
        let mut command = std::process::Command::new("sleep");
        command.arg("30");
        super::super::isolate_std_process_tree(&mut command);
        let mut child = command.spawn().expect("start sleep");
        let pid = child.id() as i32;
        let guard = super::super::contain_process_tree(child.id()).expect("contain sleep");
        assert_eq!(guard.process_group(), pid);

        assert!(signal_process_group(pid, libc::SIGHUP));
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut exited = None;
        while Instant::now() < deadline {
            exited = child.try_wait().expect("poll sleep");
            if exited.is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        drop(guard);
        if exited.is_none() {
            let _ = child.kill();
        }
        let _ = child.wait();
        assert!(exited.is_some(), "SIGHUP did not reach the process group");
    }
}
