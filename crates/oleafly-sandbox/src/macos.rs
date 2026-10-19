//! `sandbox-exec` profile for confined commands on macOS. The profile text is
//! the one Oleafly 0.4.7 used for task commands; the workspace is readable as
//! a whole, protected paths stay read-only inside write grants, and the
//! Training run profile adds IOKit access for Metal.
use crate::{PlatformRequest, SandboxError};
use std::path::{Path, PathBuf};

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) const MISSING_MESSAGE: &str =
    "This Mac cannot confine task commands because sandbox-exec is unavailable.";

const BASE_PROFILE: &str = "(version 1) (deny default) (allow process*) (allow syscall-unix) (allow file-read-metadata) (allow sysctl-read) (allow signal (target same-sandbox)) (deny syscall-unix (syscall-number SYS_setsid SYS_setpgid) (with errno 1))";
/// Programs that do not start helpers may not use `posix_spawn`.
const NO_SPAWN: &str = " (deny syscall-unix (syscall-number SYS_posix_spawn) (with errno 78))";

/// The profile for `request`, without the program arguments.
pub(crate) fn profile(request: &PlatformRequest<'_>) -> Result<String, SandboxError> {
    let mut profile = String::from(BASE_PROFILE);
    if !request.child_processes {
        profile.push_str(NO_SPAWN);
    }
    profile.push_str(" (allow mach-lookup (global-name \"com.apple.system.logger\") (global-name \"com.apple.system.notification_center\") (global-name \"com.apple.notifyd\") (global-name \"com.apple.cfprefsd.daemon\") (global-name \"com.apple.cfprefsd.agent\"))");
    if request.network {
        profile.push_str(" (allow network*)");
        profile.push_str(" (allow mach-lookup (global-name \"com.apple.SecurityServer\") (global-name \"com.apple.trustd\") (global-name \"com.apple.trustd.agent\") (global-name \"com.apple.mDNSResponder\") (global-name \"com.apple.networkd\") (global-name \"com.apple.SystemConfiguration.configd\"))");
    }
    if request.gpu {
        // Metal and the GPU drivers live behind IOKit user clients.
        profile.push_str(" (allow iokit-open) (allow iokit-get-properties) (allow mach-lookup (global-name \"com.apple.MTLCompilerService\") (global-name \"com.apple.CoreDisplay.master\") (global-name \"com.apple.gpumemd.source\"))");
    }
    for path in request
        .readable
        .iter()
        .chain(request.writable)
        .map(PathBuf::as_path)
        .chain(std::iter::once(request.temp))
    {
        let quoted = quote(path)?;
        let filter = if path.is_dir() { "subpath" } else { "literal" };
        profile.push_str(&format!(" (allow file-read* ({filter} {quoted}))"));
    }
    let root = quote(request.root)?;
    profile.push_str(&format!(
        " (allow file-read* (literal \"/\") (subpath {root}) (subpath \"/dev\"))"
    ));
    for path in request
        .writable
        .iter()
        .map(PathBuf::as_path)
        .chain(std::iter::once(request.temp))
    {
        let quoted = quote(path)?;
        let filter = if path.is_dir() { "subpath" } else { "literal" };
        profile.push_str(&format!(" (allow file-write* ({filter} {quoted}))"));
    }
    // Later rules win: protected paths stay read-only inside write grants.
    for path in request.protected {
        let quoted = quote(path)?;
        let filter = if path.is_dir() { "subpath" } else { "literal" };
        profile.push_str(&format!(" (deny file-write* ({filter} {quoted}))"));
    }
    profile.push_str(" (allow file-write-data (literal \"/dev/null\") (literal \"/dev/zero\") (literal \"/dev/random\") (literal \"/dev/urandom\"))");
    Ok(profile)
}

fn quote(path: &Path) -> Result<String, SandboxError> {
    serde_json::to_string(&path.to_string_lossy())
        .map_err(|error| SandboxError::Io(error.to_string()))
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn command(
    request: &PlatformRequest<'_>,
) -> Result<std::process::Command, SandboxError> {
    if !Path::new("/usr/bin/sandbox-exec").is_file() {
        return Err(SandboxError::Unsupported(MISSING_MESSAGE.into()));
    }
    let profile = profile(request)?;
    let mut command = std::process::Command::new("/usr/bin/sandbox-exec");
    command
        .arg("-p")
        .arg(profile)
        .arg(request.program)
        .args(request.args);
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    fn request<'a>(
        writable: &'a [PathBuf],
        protected: &'a [PathBuf],
        readable: &'a [PathBuf],
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
            readable,
            protected,
        }
    }

    #[test]
    fn keeps_todays_rules() {
        let text = profile(&request(&[], &[], &[], false, false)).unwrap();
        assert!(text.contains("(deny default)"));
        assert!(text.contains("SYS_posix_spawn) (with errno 78)"));
        assert!(text.contains("(allow signal (target same-sandbox))"));
    }

    #[test]
    fn protected_denies_come_after_write_allows() {
        let writable = [PathBuf::from("/w")];
        let protected = [PathBuf::from("/w/.git")];
        let text = profile(&request(&writable, &protected, &[], false, false)).unwrap();
        let deny = text
            .find("(deny file-write* (literal \"/w/.git\"))")
            .unwrap();
        let allow = text.find("(allow file-write* (literal \"/w\"))").unwrap();
        assert!(deny > allow);
    }

    #[test]
    fn home_is_readable_and_writable() {
        let text = profile(&request(&[], &[], &[], false, false)).unwrap();
        assert!(text.contains("(allow file-read* (literal \"/h\"))"));
        assert!(text.contains("(allow file-write* (literal \"/h\"))"));
    }

    #[test]
    fn gpu_rules_only_with_gpu() {
        assert!(!profile(&request(&[], &[], &[], false, false))
            .unwrap()
            .contains("(allow iokit-open)"));
        let text = profile(&request(&[], &[], &[], false, true)).unwrap();
        assert!(
            text.contains("(allow iokit-open)") && text.contains("com.apple.MTLCompilerService")
        );
    }

    #[test]
    fn network_rules_only_with_network() {
        assert!(!profile(&request(&[], &[], &[], false, false))
            .unwrap()
            .contains("(allow network*)"));
        assert!(profile(&request(&[], &[], &[], true, false))
            .unwrap()
            .contains("(allow network*)"));
    }

    #[test]
    fn quotes_in_paths_are_escaped() {
        let readable = [PathBuf::from("/w/a\"b")];
        let text = profile(&request(&[], &[], &readable, false, false)).unwrap();
        assert!(text.contains("\"/w/a\\\"b\""), "{text}");
    }
}
