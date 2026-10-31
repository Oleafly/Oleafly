use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const POLL: Duration = Duration::from_millis(25);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProbeOutput {
    pub success: bool,
    pub stdout: Vec<u8>,
}

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
    // Its own process group, so a launcher (a Scoop or Chocolatey shim, a
    // wrapper script) is stopped together with what it started.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
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
                kill_tree(&mut child);
                let _ = child.wait();
                return None;
            }
        }
    };
    let stdout =
        match receiver.recv_timeout(deadline.saturating_duration_since(Instant::now()).max(POLL)) {
            Ok(stdout) => stdout,
            Err(_) => {
                kill_group(child.id());
                Vec::new()
            }
        };
    Some(ProbeOutput {
        success: status.success(),
        stdout,
    })
}

fn kill_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
        let taskkill = Path::new(&system_root)
            .join("System32")
            .join("taskkill.exe");
        let mut command = Command::new(taskkill);
        command
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let _ = command.status();
    }
    #[cfg(unix)]
    kill_group(child.id());
    let _ = child.kill();
}

#[cfg(unix)]
fn kill_group(pid: u32) {
    if let Ok(group) = i32::try_from(pid) {
        // SAFETY: `kill` only sends a signal; a negative id names the group
        // the probe was spawned into, and an empty group just reports ESRCH.
        unsafe {
            libc::kill(-group, libc::SIGKILL);
        }
    }
}

#[cfg(not(unix))]
fn kill_group(_pid: u32) {}

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
    fn a_probe_past_its_deadline_takes_what_it_started_with_it() {
        let dir = tempfile::tempdir().unwrap();
        let pid_file = dir.path().join("grandchild.pid");
        let script = format!("sleep 30 & echo $! > '{}'; wait", pid_file.display());
        let result = probe_output(
            Path::new("/bin/sh"),
            &["-c", &script],
            Duration::from_millis(300),
            1024,
        );
        assert!(result.is_none());
        let pid: i32 = std::fs::read_to_string(&pid_file)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        let alive = |pid: i32| {
            // SAFETY: signal 0 only asks whether the process exists.
            unsafe { libc::kill(pid, 0) == 0 }
        };
        let deadline = Instant::now() + Duration::from_secs(5);
        while alive(pid) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!alive(pid), "the grandchild {pid} outlived the probe");
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
