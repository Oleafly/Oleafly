//! Git for the private mirror. The app runs Git through its own runner (it
//! locates Git and bounds every call); the CLI uses [`SystemGit`]. Both use
//! the same settings: no hooks, no signing, no credential helpers except the
//! one that reads the token from the environment, never from argv.
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::error::{OnlineError, OnlineErrorKind};

pub trait MirrorGit: Send + Sync {
    fn run(&self, repo: &Path, args: &[&str]) -> Result<Output, OnlineError>;
    fn run_remote(
        &self,
        repo: &Path,
        credential_origin: &str,
        token: &str,
        args: &[&str],
    ) -> Result<Output, OnlineError>;
    fn failure_text(&self, output: &Output) -> String {
        output_text(output)
    }
}

/// The variable the credential helper reads the token from.
pub const MIRROR_TOKEN_VARIABLE: &str = "OLEAFLY_MIRROR_TOKEN";

fn null_device() -> &'static str {
    if cfg!(windows) {
        "NUL"
    } else {
        "/dev/null"
    }
}

/// The `-c` settings every mirror call carries.
pub fn mirror_config() -> Vec<String> {
    [
        format!("core.hooksPath={}", null_device()),
        "commit.gpgsign=false".to_string(),
        "tag.gpgsign=false".to_string(),
        "core.fsmonitor=false".to_string(),
        "core.autocrlf=false".to_string(),
        "core.safecrlf=false".to_string(),
        "core.longpaths=true".to_string(),
        "core.quotepath=false".to_string(),
        "core.precomposeunicode=true".to_string(),
        "core.filemode=false".to_string(),
        "core.symlinks=false".to_string(),
        "core.protectNTFS=true".to_string(),
        "core.protectHFS=true".to_string(),
        "gc.auto=0".to_string(),
        "merge.conflictstyle=merge".to_string(),
        "user.name=Oleafly".to_string(),
        "user.email=sync@oleafly.invalid".to_string(),
        "credential.helper=".to_string(),
    ]
    .into_iter()
    .flat_map(|setting| ["-c".to_string(), setting])
    .collect()
}

/// The `-c` settings that give the credential origin the token from
/// [`MIRROR_TOKEN_VARIABLE`].
pub fn credential_config(credential_origin: &str) -> Vec<String> {
    vec![
        "-c".to_string(),
        format!("credential.{credential_origin}.helper="),
        "-c".to_string(),
        format!(
            "credential.{credential_origin}.helper=!f() {{ test \"$1\" = get && printf 'username=git\\npassword=%s\\n' \"${MIRROR_TOKEN_VARIABLE}\"; }}; f"
        ),
        "-c".to_string(),
        format!("credential.{credential_origin}.useHttpPath=false"),
    ]
}

fn last_progress_frame(line: &str) -> &str {
    let line = line.strip_suffix('\r').unwrap_or(line);
    match line.rfind('\r') {
        Some(index) => &line[index + 1..],
        None => line,
    }
}

/// stdout and stderr, each progress line reduced to its last frame.
pub fn output_text(output: &Output) -> String {
    let mut text = String::new();
    text.push_str(&String::from_utf8_lossy(&output.stdout));
    if !output.stderr.is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    text.split('\n')
        .map(last_progress_frame)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

const GIT_REPOSITORY_ENV: [&str; 16] = [
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
    "GIT_OBJECT_DIRECTORY",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_IMPLICIT_WORK_TREE",
    "GIT_GRAFT_FILE",
    "GIT_INDEX_FILE",
    "GIT_NO_REPLACE_OBJECTS",
    "GIT_REPLACE_REF_BASE",
    "GIT_PREFIX",
    "GIT_SHALLOW_FILE",
    "GIT_COMMON_DIR",
    "GIT_INTERNAL_SUPER_PREFIX",
];

const GIT_IDENTITY_ENV: [&str; 6] = [
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_AUTHOR_DATE",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
    "GIT_COMMITTER_DATE",
];

const GIT_PATHSPEC_ENV: [&str; 4] = [
    "GIT_LITERAL_PATHSPECS",
    "GIT_GLOB_PATHSPECS",
    "GIT_NOGLOB_PATHSPECS",
    "GIT_ICASE_PATHSPECS",
];

const GIT_TRACE_ENV: [&str; 9] = [
    "GIT_TRACE",
    "GIT_TRACE2",
    "GIT_TRACE2_EVENT",
    "GIT_TRACE2_PERF",
    "GIT_TRACE_CURL",
    "GIT_TRACE_PACKET",
    "GIT_TRACE_PERFORMANCE",
    "GIT_TRACE_SETUP",
    "GIT_CURL_VERBOSE",
];

const REMOTE_IDLE: Duration = Duration::from_secs(120);
const REMOTE_TOTAL: Duration = Duration::from_secs(60 * 60);
const LOCAL_TOTAL: Duration = Duration::from_secs(120);
const LOCAL_SLOW_TOTAL: Duration = Duration::from_secs(600);
const MAX_CAPTURE: usize = 64 * 1024 * 1024;

/// Git found by the caller (the CLI resolves it on `PATH`).
#[derive(Clone, Debug)]
pub struct SystemGit {
    program: PathBuf,
}

impl SystemGit {
    pub fn new(program: PathBuf) -> SystemGit {
        SystemGit { program }
    }

    /// The command for one call. `remote` is `(credential origin, token)`.
    pub fn command(&self, repo: &Path, args: &[&str], remote: Option<(&str, &str)>) -> Command {
        let mut command = Command::new(&self.program);
        command.args(mirror_config());
        if let Some((origin, _)) = remote {
            command.args(credential_config(origin));
        }
        command.args(args).current_dir(repo).stdin(Stdio::null());
        for variable in GIT_REPOSITORY_ENV
            .into_iter()
            .chain(GIT_IDENTITY_ENV)
            .chain(GIT_PATHSPEC_ENV)
            .chain(GIT_TRACE_ENV)
            .chain(["GIT_ASKPASS", "SSH_ASKPASS"])
        {
            command.env_remove(variable);
        }
        command
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_LITERAL_PATHSPECS", "1")
            .env("GIT_OPTIONAL_LOCKS", "1");
        if let Some((_, token)) = remote {
            command.env(MIRROR_TOKEN_VARIABLE, token);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        command
    }
}

fn local_total(args: &[&str]) -> Duration {
    match args.first() {
        Some(&("add" | "checkout" | "clean" | "status" | "diff")) => LOCAL_SLOW_TOTAL,
        _ => LOCAL_TOTAL,
    }
}

impl MirrorGit for SystemGit {
    fn run(&self, repo: &Path, args: &[&str]) -> Result<Output, OnlineError> {
        run_bounded(self.command(repo, args, None), None, local_total(args))
    }

    fn run_remote(
        &self,
        repo: &Path,
        credential_origin: &str,
        token: &str,
        args: &[&str],
    ) -> Result<Output, OnlineError> {
        run_bounded(
            self.command(repo, args, Some((credential_origin, token))),
            Some(REMOTE_IDLE),
            REMOTE_TOTAL,
        )
    }
}

fn now_millis(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// Runs `command`, killing it after `total`, or after `idle` without any
/// output when set.
fn run_bounded(
    mut command: Command,
    idle: Option<Duration>,
    total: Duration,
) -> Result<Output, OnlineError> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            OnlineError::new(OnlineErrorKind::GitNotInstalled)
        } else {
            OnlineError::io(format!("could not start Git: {error}"))
        }
    })?;
    let started = Instant::now();
    let last_read = Arc::new(AtomicU64::new(0));
    let reader = |pipe: Option<Box<dyn Read + Send>>| {
        let last_read = last_read.clone();
        std::thread::spawn(move || {
            let mut captured = Vec::new();
            let Some(mut pipe) = pipe else {
                return captured;
            };
            let mut buffer = [0u8; 8192];
            loop {
                match pipe.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        last_read.store(now_millis(started), Ordering::Relaxed);
                        if captured.len() < MAX_CAPTURE {
                            let room = MAX_CAPTURE - captured.len();
                            captured.extend_from_slice(&buffer[..count.min(room)]);
                        }
                    }
                }
            }
            captured
        })
    };
    let stdout = reader(
        child
            .stdout
            .take()
            .map(|pipe| Box::new(pipe) as Box<dyn Read + Send>),
    );
    let stderr = reader(
        child
            .stderr
            .take()
            .map(|pipe| Box::new(pipe) as Box<dyn Read + Send>),
    );
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(OnlineError::io(format!("could not wait for Git: {error}")));
            }
        }
        let elapsed = started.elapsed();
        let silent = idle.is_some_and(|idle| {
            let last = Duration::from_millis(last_read.load(Ordering::Relaxed));
            elapsed.saturating_sub(last) > idle
        });
        if elapsed > total || silent {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout.join();
            let _ = stderr.join();
            return Err(OnlineError::new(if idle.is_some() {
                OnlineErrorKind::SyncOffline
            } else {
                OnlineErrorKind::SyncFailed
            })
            .detail("git stopped responding"));
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    Ok(Output {
        status,
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
    })
}

/// Git on `PATH` (the first `git`, or `git.exe` on Windows).
pub fn git_on_path() -> Option<PathBuf> {
    let name = if cfg!(windows) { "git.exe" } else { "git" };
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|folder| folder.join(name))
        .find(|candidate| candidate.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::ffi::OsStr;

    #[test]
    fn system_git_builds_an_absolute_program_without_shell_or_token_in_args() {
        let program = PathBuf::from(if cfg!(windows) {
            r"C:\Program Files\Git\cmd\git.exe"
        } else {
            "/usr/bin/git"
        });
        let command = SystemGit::new(program.clone()).command(
            Path::new("repo"),
            &["fetch", "u"],
            Some(("https://git.example.edu", "tok_SECRET_123")),
        );
        assert_eq!(command.get_program(), program.as_os_str());
        let args: Vec<_> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert!(args.iter().all(|arg| !arg.contains("tok_SECRET_123")));
        assert!(args.contains(&"credential.helper=".to_string()));
        let envs: HashMap<_, _> = command.get_envs().collect();
        assert_eq!(
            envs.get(OsStr::new(MIRROR_TOKEN_VARIABLE))
                .unwrap()
                .unwrap(),
            "tok_SECRET_123"
        );
        assert_eq!(
            envs.get(OsStr::new("GIT_TERMINAL_PROMPT"))
                .unwrap()
                .unwrap(),
            "0"
        );
        assert!(envs.get(OsStr::new("GIT_DIR")).unwrap().is_none());
    }

    #[test]
    fn a_missing_git_reports_git_not_installed() {
        let temp = tempfile::tempdir().unwrap();
        let git = SystemGit::new(temp.path().join("no-git"));
        let error = git.run(temp.path(), &["status"]).unwrap_err();
        assert_eq!(error.kind, OnlineErrorKind::GitNotInstalled);
    }

    #[test]
    fn mirror_config_matches_the_app_list() {
        let config = mirror_config();
        assert_eq!(config.len(), 36);
        assert_eq!(config[0], "-c");
        assert!(config[1].starts_with("core.hooksPath="));
        assert!(config.contains(&"user.email=sync@oleafly.invalid".to_string()));
        assert_eq!(
            config.last().map(String::as_str),
            Some("credential.helper=")
        );
    }

    #[test]
    fn progress_lines_keep_their_last_frame() {
        let output = Output {
            status: std::process::Command::new(if cfg!(windows) { "cmd" } else { "true" })
                .args(if cfg!(windows) {
                    vec!["/C", "exit 0"]
                } else {
                    vec![]
                })
                .status()
                .unwrap(),
            stdout: Vec::new(),
            stderr: b"Receiving 10%\rReceiving 50%\rReceiving 100%\nfatal: gone\n".to_vec(),
        };
        assert_eq!(output_text(&output), "Receiving 100%\nfatal: gone");
    }
}
