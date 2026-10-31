//! Which allowed apps are running, by process id. Cua Driver 0.38 refuses
//! to list every app or window under a manifest that keeps the desktop
//! display out, so Oleafly finds the allowed apps' processes itself and asks
//! the driver for their windows one process at a time.

use super::config::AllowedApp;

/// The ids of the running processes of `app`, oldest first where the system
/// says, at most a few.
pub(crate) fn running_pids(app: &AllowedApp) -> Vec<u32> {
    let mut pids = platform_pids(app);
    pids.sort_unstable();
    pids.dedup();
    pids.truncate(MAX_PIDS);
    pids
}

/// More processes than this for one app are left out.
const MAX_PIDS: usize = 8;

#[cfg(target_os = "macos")]
fn platform_pids(app: &AllowedApp) -> Vec<u32> {
    use objc2::rc::autoreleasepool;
    use objc2_app_kit::NSRunningApplication;
    use objc2_foundation::NSString;

    let Some(bundle_id) = app.bundle_id.as_deref() else {
        return Vec::new();
    };
    autoreleasepool(|_| {
        NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str(
            bundle_id,
        ))
        .iter()
        .filter(|running| !running.isTerminated())
        .filter_map(|running| u32::try_from(running.processIdentifier()).ok())
        .filter(|pid| *pid > 0)
        .collect()
    })
}

/// Windows: every process whose image is the allowed program.
#[cfg(windows)]
fn platform_pids(app: &AllowedApp) -> Vec<u32> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let Some(program) = app.executable.as_deref().map(windows_key) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    // SAFETY: the snapshot handle is checked and closed; `entry` carries its
    // own size as the API asks.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return found;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more && found.len() < MAX_PIDS {
            let pid = entry.th32ProcessID;
            if pid != 0
                && oleafly_sandbox::process::process_image_name(pid)
                    .is_some_and(|image| windows_key(&image) == program)
            {
                found.push(pid);
            }
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
    }
    found
}

/// A Windows path as compared here: no `\\?\` prefix, any case.
#[cfg_attr(not(windows), allow(dead_code))]
fn windows_key(path: &str) -> String {
    path.strip_prefix(r"\\?\")
        .unwrap_or(path)
        .replace('/', "\\")
        .to_lowercase()
}

/// Linux: every process whose program, or whose first argument, is the
/// allowed program.
#[cfg(target_os = "linux")]
fn platform_pids(app: &AllowedApp) -> Vec<u32> {
    let Some(program) = app.executable.as_deref() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| entry.file_name().to_str()?.parse::<u32>().ok())
        .filter(|pid| {
            let exe = std::fs::read_link(format!("/proc/{pid}/exe")).ok();
            exe.as_deref()
                .is_some_and(|exe| exe == std::path::Path::new(program))
                || first_argument(*pid).is_some_and(|argument| {
                    std::fs::canonicalize(&argument)
                        .is_ok_and(|path| path == std::path::Path::new(program))
                })
        })
        .take(MAX_PIDS)
        .collect()
}

#[cfg(target_os = "linux")]
fn first_argument(pid: u32) -> Option<String> {
    let line = std::fs::read(format!("/proc/{pid}/cmdline")).ok()?;
    let first = line.split(|byte| *byte == 0).next()?;
    let first = String::from_utf8(first.to_vec()).ok()?;
    first.starts_with('/').then_some(first)
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
fn platform_pids(_app: &AllowedApp) -> Vec<u32> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_paths_compare_without_prefix_or_case() {
        assert_eq!(
            windows_key(r"\\?\C:\Program Files\Stata 18\StataSE-64.exe"),
            windows_key(r"c:\program files\STATA 18\statase-64.exe")
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_finds_a_running_app_by_bundle_id() {
        // Finder always runs.
        let finder = AllowedApp {
            name: "Finder".into(),
            bundle_id: Some("com.apple.finder".into()),
            executable: None,
        };
        assert!(!running_pids(&finder).is_empty());
        let missing = AllowedApp {
            name: "Missing".into(),
            bundle_id: Some("org.example.not-installed".into()),
            executable: None,
        };
        assert!(running_pids(&missing).is_empty());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_finds_its_own_process_by_program() {
        let own = std::env::current_exe().unwrap();
        let app = AllowedApp {
            name: "self".into(),
            bundle_id: None,
            executable: Some(own.to_string_lossy().into_owned()),
        };
        assert!(running_pids(&app).contains(&std::process::id()));
    }
}
