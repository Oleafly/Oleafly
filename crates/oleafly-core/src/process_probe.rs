//! Short, bounded runs of a tool to ask its version: stdin and stderr are
//! closed, stdout is read up to a cap, and the process is killed when it
//! outlives its deadline.
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// The deadline a version probe gets.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const POLL: Duration = Duration::from_millis(25);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProbeOutput {
    pub success: bool,
    pub stdout: Vec<u8>,
}

/// Runs `program args` and returns its exit status and up to `max_bytes`
/// of its output, or `None` when it can't start or exceeds `timeout`.
pub fn probe_output(
    program: &Path,
    args: &[&str],
    timeout: Duration,
    max_bytes: u64,
) -> Option<ProbeOutput> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().ok()?;
    let deadline = Instant::now() + timeout;
    let (sender, receiver) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            let mut output = Vec::new();
            let _ = stdout.take(max_bytes).read_to_end(&mut output);
            let _ = sender.send(output);
        });
    }
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(POLL),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    let stdout = receiver
        .recv_timeout(deadline.saturating_duration_since(Instant::now()).max(POLL))
        .unwrap_or_default();
    Some(ProbeOutput {
        success: status.success(),
        stdout,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_probe_that_exceeds_its_deadline_is_killed() {
        let started = Instant::now();
        #[cfg(unix)]
        let result = probe_output(
            Path::new("/bin/sh"),
            &["-c", "sleep 5"],
            Duration::from_millis(200),
            1024,
        );
        #[cfg(windows)]
        let result = probe_output(
            Path::new("cmd"),
            &["/C", "ping -n 6 127.0.0.1 >NUL"],
            Duration::from_millis(200),
            1024,
        );
        assert!(result.is_none());
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[cfg(unix)]
    #[test]
    fn stdout_is_capped() {
        let output = probe_output(
            Path::new("/bin/sh"),
            &["-c", "head -c 1048576 /dev/zero"],
            Duration::from_secs(10),
            1024,
        )
        .unwrap();
        assert!(output.stdout.len() <= 1024);
    }
}
