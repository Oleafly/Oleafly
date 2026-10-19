//! rsync for uploads when both ends have it (macOS and Linux only; it sends
//! only what changed between runs).
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use super::transport::{ssh_options, HostKeyMode, SshContext, SshEndpoint};

/// The local rsync, never on Windows (no native build reads Windows paths).
pub fn local_rsync(locate: &dyn Fn(&str) -> Option<PathBuf>) -> Option<PathBuf> {
    if cfg!(windows) {
        return None;
    }
    locate("rsync")
}

/// One word of rsync's `-e` value: rsync splits it on spaces and keeps
/// quoted runs together, but knows no backslash escapes.
fn rsync_word(word: &str) -> String {
    if !word.is_empty() && !word.contains([' ', '\'', '"']) {
        return word.to_string();
    }
    if !word.contains('\'') {
        return format!("'{word}'");
    }
    format!("\"{word}\"")
}

/// The single `-e` argument: the ssh program and every option of a strict
/// call, without the host (rsync adds the user from `user@host:`).
pub fn rsync_shell(ctx: &SshContext, endpoint: &SshEndpoint) -> String {
    let anonymous = SshEndpoint {
        user: None,
        ..endpoint.clone()
    };
    let mut words = vec![rsync_word(&ctx.program.to_string_lossy())];
    words.extend(
        ssh_options(ctx, &anonymous, &HostKeyMode::Strict)
            .iter()
            .map(|option| rsync_word(option)),
    );
    words.join(" ")
}

pub fn rsync_args(shell: &str, local_root: &Path, remote_dir: &str, host: &str) -> Vec<OsString> {
    let mut local = local_root.as_os_str().to_owned();
    local.push("/");
    let mut args: Vec<OsString> = [
        "-rt",
        "--delete",
        "--exclude=/.git",
        "--exclude=/.oleafly",
        "--exclude=/runs/",
        "--exclude=__pycache__/",
        "--exclude=/.venv/",
        "--exclude=/venv/",
        "--exclude=node_modules/",
        "-e",
    ]
    .iter()
    .map(OsString::from)
    .collect();
    args.push(shell.into());
    args.push(local);
    args.push(format!("{host}:{remote_dir}/work/").into());
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(known_hosts: &str) -> SshContext {
        SshContext {
            program: PathBuf::from("/usr/bin/ssh"),
            oleafly_known_hosts: PathBuf::from(known_hosts),
        }
    }

    #[test]
    fn rsync_args_keep_runs_and_git_out() {
        let endpoint = SshEndpoint {
            host: "h".into(),
            user: Some("jdoe".into()),
            port: None,
        };
        let shell = rsync_shell(&ctx("/data/known_hosts"), &endpoint);
        let args: Vec<String> = rsync_args(
            &shell,
            Path::new("/w"),
            ".oleafly-runs/t1/r1",
            &endpoint.destination(),
        )
        .iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
        for expected in ["--exclude=/.git", "--exclude=/runs/", "-e"] {
            assert!(args.contains(&expected.to_string()), "{expected}");
        }
        assert!(args.contains(&shell));
        assert_eq!(
            &args[args.len() - 2..],
            ["/w/", "jdoe@h:.oleafly-runs/t1/r1/work/"]
        );
        assert!(!shell.contains("-l"), "{shell}");
    }

    #[test]
    fn rsync_shell_quotes_paths_with_spaces() {
        let endpoint = SshEndpoint {
            host: "h".into(),
            user: None,
            port: Some(2222),
        };
        let shell = rsync_shell(
            &ctx("/Users/John Doe/.oleafly/research/known_hosts"),
            &endpoint,
        );
        assert!(
            shell.contains("'UserKnownHostsFile=\"/Users/John Doe/.oleafly/research/known_hosts\" ~/.ssh/known_hosts ~/.ssh/known_hosts2'"),
            "{shell}"
        );
        assert!(shell.contains("-p 2222"), "{shell}");
    }

    #[cfg(windows)]
    #[test]
    fn no_rsync_on_windows() {
        assert_eq!(
            local_rsync(&|_| Some(PathBuf::from(r"C:\msys\rsync.exe"))),
            None
        );
    }
}
