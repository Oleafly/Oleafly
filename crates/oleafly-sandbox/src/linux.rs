//! bubblewrap arguments for confined commands on Linux. The argument list is
//! the one Oleafly 0.4.7 used for task commands; the workspace is mounted
//! read-only under its write grants, protected paths are mounted read-only
//! again on top, hidden paths are covered last, and the Training run profile
//! binds the GPU device nodes. Availability means bubblewrap can create the
//! namespaces here, not only that the program exists.
use crate::{PlatformRequest, SandboxError};
use std::path::{Path, PathBuf};

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) const MISSING_MESSAGE: &str =
    "Task commands need bubblewrap to keep writes inside their workspace.";

/// Where bubblewrap is looked for before the search path.
const SYSTEM_BWRAP: [&str; 4] = [
    "/usr/bin/bwrap",
    "/bin/bwrap",
    "/usr/local/bin/bwrap",
    "/run/current-system/sw/bin/bwrap",
];

/// bubblewrap in a system folder, then in an absolute `PATH` folder
/// (Homebrew, Nix and other installs).
pub(crate) fn find_bubblewrap(path: Option<&std::ffi::OsStr>) -> Option<PathBuf> {
    SYSTEM_BWRAP
        .iter()
        .map(PathBuf::from)
        .chain(
            path.into_iter()
                .flat_map(std::env::split_paths)
                .filter(|folder| folder.is_absolute())
                .map(|folder| folder.join("bwrap")),
        )
        .find(|candidate| candidate.is_file())
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn bubblewrap() -> Option<PathBuf> {
    find_bubblewrap(std::env::var_os("PATH").as_deref())
}

/// The longest the probe may take.
const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// What the probe runs: the same isolation flags as a task command, over a
/// read-only copy of the whole system, and a program that does nothing.
fn probe_arguments() -> Vec<&'static str> {
    let nothing = ["/usr/bin/true", "/bin/true"]
        .into_iter()
        .find(|path| Path::new(path).is_file())
        .unwrap_or("true");
    vec![
        "--die-with-parent",
        "--new-session",
        "--unshare-all",
        "--unshare-pid",
        "--ro-bind",
        "/",
        "/",
        "--dev",
        "/dev",
        "--proc",
        "/proc",
        "--",
        nothing,
    ]
}

/// The first line bubblewrap printed, or the exit status.
fn probe_detail(stderr: &str, status: &std::process::ExitStatus) -> String {
    stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| status.to_string())
}

/// Starts bubblewrap with the isolation flags; `Err` says why it can't.
fn run_probe(bubblewrap: &Path) -> Result<(), String> {
    use std::io::Read;
    use std::process::Stdio;
    let mut child = std::process::Command::new(bubblewrap)
        .args(probe_arguments())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    let deadline = std::time::Instant::now() + PROBE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stderr = String::new();
                if let Some(mut pipe) = child.stderr.take() {
                    let _ = pipe.read_to_string(&mut stderr);
                }
                return if status.success() {
                    Ok(())
                } else {
                    Err(probe_detail(&stderr, &status))
                };
            }
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("it did not finish".into());
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

/// Whether bubblewrap is installed and can create the namespaces a task
/// command needs here (unprivileged user namespaces are off on some
/// systems, in some containers and under WSL1). Checked once per process
/// when it works, again after a short while when it doesn't.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn availability() -> crate::Availability {
    static CACHE: crate::probe::ProbeCache = crate::probe::ProbeCache::new();
    CACHE.get(|| match bubblewrap() {
        None => crate::Availability::Unavailable(MISSING_MESSAGE.into()),
        Some(path) => match run_probe(&path) {
            Ok(()) => crate::Availability::Available,
            Err(detail) => crate::Availability::Unavailable(format!(
                "Task commands need bubblewrap, but it can't start a sandbox here: {detail}"
            )),
        },
    })
}

/// GPU device nodes that exist on this machine (NVIDIA and DRI).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn gpu_devices() -> Vec<PathBuf> {
    let mut devices: Vec<PathBuf> = [
        "/dev/nvidiactl",
        "/dev/nvidia-uvm",
        "/dev/nvidia-uvm-tools",
        "/dev/nvidia-modeset",
        "/dev/dri",
        "/dev/kfd",
    ]
    .into_iter()
    .map(PathBuf::from)
    .filter(|path| path.exists())
    .collect();
    if let Ok(entries) = std::fs::read_dir("/dev") {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("nvidia")
                && name[6..].chars().all(|c| c.is_ascii_digit())
                && name.len() > 6
            {
                devices.push(entry.path());
            }
        }
    }
    devices.sort();
    devices.dedup();
    devices
}

/// Where `/etc/resolv.conf` points when it is a link to a file outside the
/// system folders (systemd-resolved), so DNS keeps working inside.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn resolv_target() -> Option<PathBuf> {
    let link = Path::new("/etc/resolv.conf");
    let metadata = std::fs::symlink_metadata(link).ok()?;
    if !metadata.file_type().is_symlink() {
        return None;
    }
    let target = link.canonicalize().ok()?;
    (!target.starts_with("/etc") && !target.starts_with("/usr")).then_some(target)
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn arguments(request: &PlatformRequest<'_>) -> Vec<std::ffi::OsString> {
    let gpu = if request.gpu {
        gpu_devices()
    } else {
        Vec::new()
    };
    let resolv = if request.network {
        resolv_target()
    } else {
        None
    };
    arguments_with(request, &gpu, resolv.as_deref())
}

pub(crate) fn arguments_with(
    request: &PlatformRequest<'_>,
    gpu_devices: &[PathBuf],
    resolv: Option<&Path>,
) -> Vec<std::ffi::OsString> {
    let mut args: Vec<std::ffi::OsString> = [
        "--die-with-parent",
        "--new-session",
        "--unshare-all",
        "--unshare-pid",
    ]
    .into_iter()
    .map(Into::into)
    .collect();
    if request.network {
        args.push("--share-net".into());
    }
    for value in ["--proc", "/proc", "--dev", "/dev"] {
        args.push(value.into());
    }
    if request.gpu {
        for device in gpu_devices {
            args.push("--dev-bind".into());
            args.push(device.clone().into_os_string());
            args.push(device.clone().into_os_string());
        }
        if !gpu_devices.is_empty() {
            for value in ["--ro-bind", "/sys", "/sys"] {
                args.push(value.into());
            }
        }
    }
    if let Some(resolv) = resolv.filter(|_| request.network) {
        args.push("--ro-bind".into());
        args.push(resolv.as_os_str().to_os_string());
        args.push(resolv.as_os_str().to_os_string());
    }
    for path in request.readable {
        args.push("--ro-bind".into());
        args.push(path.clone().into_os_string());
        args.push(path.clone().into_os_string());
    }
    args.push("--ro-bind".into());
    args.push(request.root.as_os_str().to_os_string());
    args.push(request.root.as_os_str().to_os_string());
    for path in request
        .writable
        .iter()
        .map(PathBuf::as_path)
        .chain(std::iter::once(request.temp))
    {
        args.push("--bind".into());
        args.push(path.as_os_str().to_os_string());
        args.push(path.as_os_str().to_os_string());
    }
    // Mounted last, so they stay read-only inside the write grants.
    for path in request.protected {
        args.push("--ro-bind".into());
        args.push(path.as_os_str().to_os_string());
        args.push(path.as_os_str().to_os_string());
    }
    // Hidden paths are covered after every grant: an empty file, or an empty
    // folder whose changes die with the command.
    for path in request.hidden {
        if path.is_dir() {
            args.push("--tmpfs".into());
        } else {
            args.push("--ro-bind".into());
            args.push("/dev/null".into());
        }
        args.push(path.as_os_str().to_os_string());
    }
    args.push("--".into());
    args.push(request.program.as_os_str().to_os_string());
    args.extend(request.args.iter().cloned());
    args
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn command(
    request: &PlatformRequest<'_>,
) -> Result<std::process::Command, SandboxError> {
    let executable =
        bubblewrap().ok_or_else(|| SandboxError::Unsupported(MISSING_MESSAGE.into()))?;
    let mut command = std::process::Command::new(executable);
    command.args(arguments(request));
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    fn request<'a>(
        writable: &'a [PathBuf],
        protected: &'a [PathBuf],
        network: bool,
        gpu: bool,
    ) -> PlatformRequest<'a> {
        static NO_ARGS: [OsString; 0] = [];
        PlatformRequest {
            program: Path::new("/usr/bin/python3"),
            args: &NO_ARGS,
            root: Path::new("/w"),
            writable,
            temp: Path::new("/h"),
            network,
            gpu,
            child_processes: false,
            readable: &[],
            protected,
            hidden: &[],
        }
    }

    fn strings(args: &[OsString]) -> Vec<String> {
        args.iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    fn position(args: &[String], flag: &str, path: &str) -> usize {
        args.windows(2)
            .position(|pair| pair[0] == flag && pair[1] == path)
            .unwrap_or_else(|| panic!("{flag} {path} missing in {args:?}"))
    }

    #[test]
    fn keeps_isolation_flags() {
        let args = strings(&arguments_with(&request(&[], &[], false, false), &[], None));
        assert_eq!(
            &args[..4],
            [
                "--die-with-parent",
                "--new-session",
                "--unshare-all",
                "--unshare-pid"
            ]
        );
        assert!(!args.contains(&"--share-net".to_string()));
        let networked = strings(&arguments_with(&request(&[], &[], true, false), &[], None));
        assert!(networked.contains(&"--share-net".to_string()));
    }

    #[test]
    fn binds_workspace_ro_then_writable_then_protected() {
        let writable = [PathBuf::from("/w/chapters")];
        let protected = [PathBuf::from("/w/chapters/.git")];
        let args = strings(&arguments_with(
            &request(&writable, &protected, false, false),
            &[],
            None,
        ));
        let workspace = position(&args, "--ro-bind", "/w");
        let write = position(&args, "--bind", "/w/chapters");
        let guard = position(&args, "--ro-bind", "/w/chapters/.git");
        assert!(workspace < write && write < guard);
    }

    #[test]
    fn hidden_paths_are_covered_after_every_grant() {
        let folder = tempfile::tempdir().unwrap();
        let hidden_dir = folder.path().join(".private");
        let hidden_file = folder.path().join(".env");
        std::fs::create_dir(&hidden_dir).unwrap();
        std::fs::write(&hidden_file, "SECRET=1").unwrap();
        let writable = [PathBuf::from("/w")];
        let protected = [PathBuf::from("/w/.git")];
        let hidden = [hidden_dir.clone(), hidden_file.clone()];
        let mut request = request(&writable, &protected, false, false);
        request.hidden = &hidden;
        let args = strings(&arguments_with(&request, &[], None));
        let dir = hidden_dir.to_string_lossy().into_owned();
        let file = hidden_file.to_string_lossy().into_owned();
        let guard = position(&args, "--ro-bind", "/w/.git");
        let tmpfs = args.iter().position(|arg| arg == "--tmpfs").unwrap();
        assert_eq!(args[tmpfs + 1], dir);
        let null = args
            .windows(3)
            .position(|chunk| {
                chunk[0] == "--ro-bind" && chunk[1] == "/dev/null" && chunk[2] == file
            })
            .expect("the file is not covered with /dev/null");
        assert!(guard < tmpfs && guard < null);
        // Every mask comes before the program.
        let separator = args.iter().position(|arg| arg == "--").unwrap();
        assert!(tmpfs < separator && null < separator);
    }

    #[test]
    fn finds_bubblewrap_on_the_search_path() {
        let folder = tempfile::tempdir().unwrap();
        let bwrap = folder.path().join("bwrap");
        std::fs::write(&bwrap, "").unwrap();
        let path = std::env::join_paths([Path::new("relative/folder"), folder.path()]).unwrap();
        let found = find_bubblewrap(Some(&path)).unwrap();
        // A system install wins over the search path when there is one.
        assert!(found == bwrap || SYSTEM_BWRAP.contains(&found.to_str().unwrap()));
        assert_eq!(
            find_bubblewrap(Some(std::ffi::OsStr::new("relative/only"))),
            find_bubblewrap(None)
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_probe_names_what_bubblewrap_said() {
        use std::os::unix::process::ExitStatusExt;
        let failed = std::process::ExitStatus::from_raw(1 << 8);
        let text = "\nbwrap: No permissions to create new namespace\nsecond line\n";
        assert_eq!(
            probe_detail(text, &failed),
            "bwrap: No permissions to create new namespace"
        );
        assert!(probe_detail("", &failed).contains("exit status: 1"));
    }

    #[test]
    fn probe_arguments_keep_the_task_isolation_flags() {
        let args = probe_arguments();
        for flag in [
            "--unshare-all",
            "--unshare-pid",
            "--new-session",
            "--proc",
            "--dev",
        ] {
            assert!(args.contains(&flag), "{flag}");
        }
        assert_eq!(args[args.len() - 2], "--");
    }

    #[test]
    fn gpu_devices_only_with_gpu() {
        let devices = [PathBuf::from("/dev/nvidia0")];
        let without = strings(&arguments_with(
            &request(&[], &[], false, false),
            &devices,
            None,
        ));
        assert!(!without.contains(&"--dev-bind".to_string()));
        let with = strings(&arguments_with(
            &request(&[], &[], false, true),
            &devices,
            None,
        ));
        position(&with, "--dev-bind", "/dev/nvidia0");
        position(&with, "--ro-bind", "/sys");
    }

    #[test]
    fn resolv_target_bound_only_with_network() {
        let target = Path::new("/run/systemd/resolve/stub-resolv.conf");
        let offline = strings(&arguments_with(
            &request(&[], &[], false, false),
            &[],
            Some(target),
        ));
        assert!(!offline.contains(&target.to_string_lossy().into_owned()));
        let online = strings(&arguments_with(
            &request(&[], &[], true, false),
            &[],
            Some(target),
        ));
        position(
            &online,
            "--ro-bind",
            "/run/systemd/resolve/stub-resolv.conf",
        );
    }
}
