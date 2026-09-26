use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ProcessIdentity {
    pub(crate) pid: u32,
    pub(crate) started: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProcessProbe {
    Gone,
    Running { started: Option<u64> },
}

pub(crate) fn current() -> ProcessIdentity {
    static CURRENT: OnceLock<ProcessIdentity> = OnceLock::new();
    *CURRENT.get_or_init(|| {
        let pid = std::process::id();
        let started = match probe(pid) {
            ProcessProbe::Running { started } => started,
            ProcessProbe::Gone => None,
        };
        ProcessIdentity { pid, started }
    })
}

pub(crate) fn owner_is_live(
    owner: Option<ProcessIdentity>,
    current: ProcessIdentity,
    probe: impl Fn(u32) -> ProcessProbe,
) -> bool {
    let Some(owner) = owner else {
        return false;
    };
    if owner.pid == current.pid {
        return false;
    }
    match probe(owner.pid) {
        ProcessProbe::Gone => false,
        ProcessProbe::Running { started } => match (owner.started, started) {
            (Some(recorded), Some(observed)) => recorded == observed,
            _ => true,
        },
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn probe(pid: u32) -> ProcessProbe {
    if pid == 0 {
        return ProcessProbe::Gone;
    }
    match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        Ok(stat) => parse_linux_stat(&stat),
        Err(_) => ProcessProbe::Gone,
    }
}

#[cfg(any(target_os = "linux", test))]
fn parse_linux_stat(stat: &str) -> ProcessProbe {
    let Some((_, tail)) = stat.rsplit_once(") ") else {
        return ProcessProbe::Gone;
    };
    let mut fields = tail.split_whitespace();
    match fields.next() {
        None | Some("Z" | "X" | "x") => ProcessProbe::Gone,
        Some(_) => ProcessProbe::Running {
            started: fields.nth(18).and_then(|value| value.parse().ok()),
        },
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn probe(pid: u32) -> ProcessProbe {
    let Ok(raw) = libc::pid_t::try_from(pid) else {
        return ProcessProbe::Gone;
    };
    if raw <= 0 {
        return ProcessProbe::Gone;
    }
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
    let read = unsafe {
        libc::proc_pidinfo(
            raw,
            libc::PROC_PIDTBSDINFO,
            0,
            (&mut info as *mut libc::proc_bsdinfo).cast(),
            size,
        )
    };
    if read == size {
        return ProcessProbe::Running {
            started: Some(
                info.pbi_start_tvsec
                    .saturating_mul(1_000_000)
                    .saturating_add(info.pbi_start_tvusec),
            ),
        };
    }
    if unsafe { libc::kill(raw, 0) } == 0 {
        ProcessProbe::Running { started: None }
    } else {
        ProcessProbe::Gone
    }
}

#[cfg(windows)]
pub(crate) fn probe(pid: u32) -> ProcessProbe {
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    if pid == 0 {
        return ProcessProbe::Gone;
    }
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return ProcessProbe::Gone;
        }
        let mut code = 0u32;
        let running = GetExitCodeProcess(process, &mut code) != 0 && code == STILL_ACTIVE as u32;
        let mut created = FILETIME::default();
        let mut exited = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        let times_read =
            GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user) != 0;
        CloseHandle(process);
        let started = times_read.then_some(
            (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime),
        );
        if running {
            ProcessProbe::Running { started }
        } else {
            ProcessProbe::Gone
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::proc::NoConsole;

    use super::*;

    const CURRENT: ProcessIdentity = ProcessIdentity {
        pid: 1717,
        started: Some(9),
    };
    const OWNER: ProcessIdentity = ProcessIdentity {
        pid: 4242,
        started: Some(7),
    };

    #[test]
    fn a_row_without_an_owner_is_recoverable() {
        assert!(!owner_is_live(None, CURRENT, |_| ProcessProbe::Running {
            started: Some(7)
        }));
    }

    #[test]
    fn an_owner_with_this_pid_is_recoverable_without_probing() {
        let earlier = ProcessIdentity {
            pid: CURRENT.pid,
            started: Some(1),
        };
        assert!(!owner_is_live(
            Some(earlier),
            CURRENT,
            |_| -> ProcessProbe { panic!("the current pid must not be probed") }
        ));
    }

    #[test]
    fn an_owner_that_exited_is_recoverable() {
        assert!(!owner_is_live(Some(OWNER), CURRENT, |_| ProcessProbe::Gone));
    }

    #[test]
    fn a_reused_pid_with_another_start_time_is_recoverable() {
        assert!(!owner_is_live(Some(OWNER), CURRENT, |_| {
            ProcessProbe::Running { started: Some(8) }
        }));
    }

    #[test]
    fn a_running_owner_with_the_recorded_start_time_is_live() {
        assert!(owner_is_live(Some(OWNER), CURRENT, |_| {
            ProcessProbe::Running { started: Some(7) }
        }));
    }

    #[test]
    fn a_running_owner_whose_start_time_cannot_be_compared_stays_live() {
        assert!(owner_is_live(Some(OWNER), CURRENT, |_| {
            ProcessProbe::Running { started: None }
        }));
        let unrecorded = ProcessIdentity {
            pid: OWNER.pid,
            started: None,
        };
        assert!(owner_is_live(Some(unrecorded), CURRENT, |_| {
            ProcessProbe::Running { started: Some(7) }
        }));
    }

    #[test]
    fn this_process_probes_as_running_with_its_own_start_time() {
        let identity = current();
        assert_eq!(identity.pid, std::process::id());
        assert!(identity.started.is_some());
        assert_eq!(
            probe(identity.pid),
            ProcessProbe::Running {
                started: identity.started
            }
        );
    }

    #[test]
    fn pids_that_would_address_process_groups_are_never_live() {
        assert_eq!(probe(0), ProcessProbe::Gone);
        assert_eq!(probe(u32::MAX), ProcessProbe::Gone);
    }

    #[test]
    fn a_reaped_child_probes_as_gone() {
        #[cfg(windows)]
        let mut command = std::process::Command::new("cmd.exe");
        #[cfg(windows)]
        command.args(["/C", "exit 0"]);
        #[cfg(not(windows))]
        let mut command = std::process::Command::new("/bin/sh");
        #[cfg(not(windows))]
        command.args(["-c", "exit 0"]);
        let mut child = command.no_console().spawn().unwrap();
        let pid = child.id();
        child.wait().unwrap();
        assert_eq!(probe(pid), ProcessProbe::Gone);
        drop(child);
    }

    #[test]
    fn linux_stat_lines_yield_state_and_start_time() {
        let running =
            "812 (Oleafly (helper)) S 1 812 812 0 -1 4194560 100 0 0 0 5 3 0 0 20 0 12 0 998877 0 0";
        assert_eq!(
            parse_linux_stat(running),
            ProcessProbe::Running {
                started: Some(998877)
            }
        );
        let zombie = "813 (sh) Z 812 813 813 0 -1 4194564 0 0 0 0 0 0 0 0 20 0 1 0 998878 0 0";
        assert_eq!(parse_linux_stat(zombie), ProcessProbe::Gone);
        assert_eq!(parse_linux_stat("garbage"), ProcessProbe::Gone);
    }
}
