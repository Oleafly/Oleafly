use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::support::Running;

pub const WAIT: Duration = Duration::from_secs(30);
pub const STOP_WAIT: Duration = Duration::from_secs(12);

pub fn command(data: &Path, folder: &Path, args: &[&str]) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_oleaflyc"));
    command
        .args(["--json", "--events", "-C"])
        .arg(folder)
        .args(args)
        .env("OLEAFLY_DATA_DIR", data)
        .stdin(Stdio::null());
    #[cfg(unix)]
    crate::support::set_hangup(&mut command, libc::SIG_DFL);
    command
}

pub fn live(data: &Path, folder: &Path, extra: &[&str]) -> Running {
    let mut args = vec!["remote", "live"];
    args.extend_from_slice(extra);
    Running::start(&mut command(data, folder, &args))
}

pub fn wait_for(live: &Running, what: &str, mut wanted: impl FnMut(&Value) -> bool) -> Value {
    let deadline = Instant::now() + WAIT;
    let mut seen = Vec::new();
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        let Ok(line) = live.lines.recv_timeout(left) else {
            panic!("no {what} within {WAIT:?}, after {seen:#?}");
        };
        let value: Value =
            serde_json::from_str(&line).unwrap_or_else(|_| panic!("not a JSON line: {line}"));
        if wanted(&value) {
            return value;
        }
        seen.push(value);
    }
}

pub fn event(live: &Running, name: &str) -> Value {
    wait_for(live, name, |value| value["event"] == name)
}

pub fn state(live: &Running, name: &str) -> Value {
    wait_for(live, name, |value| {
        value["event"] == "state" && value["state"] == name
    })
}

pub fn ready(live: &Running) -> Value {
    let (mut started, mut online) = (None, false);
    wait_for(live, "a started and online live session", |value| {
        if value["event"] == "live_started" {
            started = Some(value.clone());
        }
        online |= value["event"] == "state" && value["state"] == "online";
        started.is_some() && online
    });
    started.unwrap()
}

pub fn rest_of(live: &Running) -> Vec<Value> {
    std::iter::from_fn(|| live.lines.recv_timeout(Duration::from_secs(5)).ok())
        .filter_map(|line| serde_json::from_str(&line).ok())
        .collect()
}

#[cfg(unix)]
pub fn send(live: &Running, signal: i32) {
    let pid = i32::try_from(live.process.id()).unwrap();
    // SAFETY: signals the child process this test started.
    assert_eq!(unsafe { libc::kill(pid, signal) }, 0);
}

#[cfg(unix)]
pub fn terminate(live: &mut Running, signal: i32) -> std::process::ExitStatus {
    send(live, signal);
    crate::support::exit_within(&mut live.process, STOP_WAIT)
}
