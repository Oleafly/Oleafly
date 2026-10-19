//! bubblewrap arguments for confined commands on Linux. The argument list is
//! the one Oleafly 0.4.7 used for task commands; the workspace is mounted
//! read-only under its write grants, protected paths are mounted read-only
//! again on top, and the Training run profile binds the GPU device nodes.
use crate::{PlatformRequest, SandboxError};
use std::path::{Path, PathBuf};

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) const MISSING_MESSAGE: &str =
    "Task commands need bubblewrap to keep writes inside their workspace.";

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn bubblewrap() -> Option<&'static str> {
    ["/usr/bin/bwrap", "/bin/bwrap"]
        .into_iter()
        .find(|path| Path::new(path).is_file())
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
