//! Calls to the user's own OpenSSH: their config, agent and jump hosts keep
//! working, keys or the agent only (`BatchMode`), and host keys checked
//! against Oleafly's own file plus the user's files, read-only.
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use oleafly_agent::CancellationToken;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};

use crate::runs::RunError;

const MAX_STDERR: usize = 64 * 1024;
const MAX_DETAIL_CHARS: usize = 300;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const INSTALL_HINT: &str =
    "OpenSSH is not installed. On Windows, add OpenSSH Client in Settings › System › Optional features.";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshEndpoint {
    pub host: String,
    pub user: Option<String>,
    pub port: Option<u16>,
}

impl SshEndpoint {
    pub fn destination(&self) -> String {
        match &self.user {
            Some(user) => format!("{user}@{}", self.host),
            None => self.host.clone(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct SshContext {
    pub program: PathBuf,
    pub oleafly_known_hosts: PathBuf,
}

impl SshContext {
    pub fn new(
        data_root: &Path,
        locate: &dyn Fn(&str) -> Option<PathBuf>,
    ) -> Result<Self, RunError> {
        let system_root = if cfg!(windows) {
            std::env::var_os("SystemRoot").map(PathBuf::from)
        } else {
            None
        };
        let program = ssh_program_for(
            system_root.as_deref(),
            &|path: &Path| path.is_file(),
            locate,
        )
        .ok_or_else(|| RunError::Unavailable(INSTALL_HINT.into()))?;
        Ok(Self {
            program,
            oleafly_known_hosts: known_hosts_file(data_root),
        })
    }
}

pub fn known_hosts_file(data_root: &Path) -> PathBuf {
    data_root.join("research").join("known_hosts")
}

/// Windows' own OpenSSH first (Git's MSYS ssh cannot reach the Windows
/// agent), then whatever `ssh` the program search finds.
pub fn ssh_program_for(
    system_root: Option<&Path>,
    exists: &dyn Fn(&Path) -> bool,
    locate: &dyn Fn(&str) -> Option<PathBuf>,
) -> Option<PathBuf> {
    if let Some(root) = system_root {
        let candidate = root.join("System32").join("OpenSSH").join("ssh.exe");
        if exists(&candidate) {
            return Some(candidate);
        }
    }
    locate("ssh")
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HostKeyMode {
    Strict,
    ProbeInto(PathBuf),
}

/// A path as one value inside an ssh option: forward slashes on Windows,
/// in double quotes, with `\` and `"` escaped.
pub fn ssh_path_value(path: &str, windows: bool) -> String {
    let path = if windows {
        path.replace('\\', "/")
    } else {
        path.to_string()
    };
    let mut quoted = String::with_capacity(path.len() + 2);
    quoted.push('"');
    for character in path.chars() {
        if character == '"' || character == '\\' {
            quoted.push('\\');
        }
        quoted.push(character);
    }
    quoted.push('"');
    quoted
}

fn known_hosts_value(ctx: &SshContext, mode: &HostKeyMode) -> String {
    let windows = cfg!(windows);
    match mode {
        HostKeyMode::Strict => format!(
            "{} ~/.ssh/known_hosts ~/.ssh/known_hosts2",
            ssh_path_value(&ctx.oleafly_known_hosts.to_string_lossy(), windows)
        ),
        HostKeyMode::ProbeInto(file) => ssh_path_value(&file.to_string_lossy(), windows),
    }
}

pub fn ssh_options(ctx: &SshContext, endpoint: &SshEndpoint, mode: &HostKeyMode) -> Vec<String> {
    let strict = match mode {
        HostKeyMode::Strict => "yes",
        HostKeyMode::ProbeInto(_) => "accept-new",
    };
    let mut args: Vec<String> = vec!["-T".into()];
    for option in [
        "BatchMode=yes".to_string(),
        format!("StrictHostKeyChecking={strict}"),
        format!("UserKnownHostsFile={}", known_hosts_value(ctx, mode)),
        "HashKnownHosts=no".into(),
        "UpdateHostKeys=no".into(),
        "ConnectTimeout=20".into(),
        "ServerAliveInterval=30".into(),
        "ServerAliveCountMax=4".into(),
        "ForwardAgent=no".into(),
        "ForwardX11=no".into(),
        "ClearAllForwardings=yes".into(),
        "RequestTTY=no".into(),
        "LogLevel=ERROR".into(),
    ] {
        args.push("-o".into());
        args.push(option);
    }
    if let Some(user) = &endpoint.user {
        args.push("-l".into());
        args.push(user.clone());
    }
    if let Some(port) = endpoint.port {
        args.push("-p".into());
        args.push(port.to_string());
    }
    args
}

pub fn ssh_args(
    ctx: &SshContext,
    endpoint: &SshEndpoint,
    mode: &HostKeyMode,
    remote_command: &str,
) -> Vec<OsString> {
    let mut args: Vec<OsString> = ssh_options(ctx, endpoint, mode)
        .into_iter()
        .map(OsString::from)
        .collect();
    args.push("--".into());
    args.push(endpoint.host.clone().into());
    args.push(remote_command.into());
    args
}

pub enum SshInput {
    Empty,
    Script(String),
    Reader(Box<dyn AsyncRead + Send + Unpin>),
}

#[derive(Clone, Copy, Debug)]
pub struct SshLimits {
    pub timeout: Duration,
    pub max_stdout: usize,
}

impl SshLimits {
    pub fn new(timeout: Duration, max_stdout: usize) -> Self {
        Self {
            timeout,
            max_stdout,
        }
    }
}

#[derive(Debug)]
pub struct SshOutput {
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

impl SshOutput {
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }
}

/// Windows' OpenSSH talks to the agent over a named pipe; a socket path left
/// by MSYS or WSL makes it fail, so it is dropped.
pub fn child_env_fixes(
    ssh_auth_sock: Option<&str>,
    windows: bool,
) -> Vec<(String, Option<String>)> {
    if !windows {
        return Vec::new();
    }
    match ssh_auth_sock {
        Some(value) if !value.starts_with(r"\\.\pipe\") => vec![("SSH_AUTH_SOCK".into(), None)],
        _ => Vec::new(),
    }
}

pub fn no_window(command: &mut tokio::process::Command) {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = (command, CREATE_NO_WINDOW);
    }
}

fn last_line(stderr: &str) -> String {
    let line = stderr
        .lines()
        .map(str::trim)
        .rfind(|line| !line.is_empty())
        .unwrap_or("");
    let clean: String = line
        .chars()
        .filter(|character| !character.is_control())
        .collect();
    if clean.chars().count() <= MAX_DETAIL_CHARS {
        return clean;
    }
    let mut cut: String = clean.chars().take(MAX_DETAIL_CHARS).collect();
    cut.push('…');
    cut
}

/// What an ssh failure means, from OpenSSH's own messages (exit 255 is
/// also a legal exit status of the remote command).
pub fn classify(code: Option<i32>, stderr: &str, host: &str) -> RunError {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("remote host identification has changed")
        || lower.contains("host key for") && lower.contains("has changed")
    {
        return RunError::HostKeyChanged(format!(
            "The host key of {host} has changed. This can mean someone is intercepting the connection. Check with the host's administrator, then test the target again in Settings › Research › Compute."
        ));
    }
    if lower.contains("host key verification failed") || lower.contains("host key is known") {
        return RunError::HostKeyUnknown(format!(
            "Oleafly doesn't know the host key of {host} yet. Test the target in Settings › Research › Compute to check and trust it."
        ));
    }
    if lower.contains("permission denied") || lower.contains("too many authentication failures") {
        return RunError::Auth(format!(
            "{host} refused the sign-in. Oleafly connects with your SSH keys or agent only, so check that `ssh {host}` works in a terminal without a password prompt."
        ));
    }
    const NETWORK: [&str; 11] = [
        "could not resolve hostname",
        "connection timed out",
        "operation timed out",
        "connection refused",
        "network is unreachable",
        "no route to host",
        "connection closed by",
        "connection reset",
        "kex_exchange_identification",
        "broken pipe",
        "timeout, server",
    ];
    if NETWORK.iter().any(|pattern| lower.contains(pattern)) {
        return RunError::Network(format!(
            "Oleafly could not reach {host}: {}",
            last_line(stderr)
        ));
    }
    let detail = last_line(stderr);
    match code {
        Some(code) if detail.is_empty() => RunError::Remote(format!(
            "The command on {host} failed with exit code {code}."
        )),
        Some(code) => RunError::Remote(format!(
            "The command on {host} failed with exit code {code}: {detail}"
        )),
        None if detail.is_empty() => {
            RunError::Remote(format!("The connection to {host} ended unexpectedly."))
        }
        None => RunError::Remote(format!(
            "The connection to {host} ended unexpectedly: {detail}"
        )),
    }
}

enum Stop {
    Overflow,
    Io(std::io::Error),
}

async fn feed(stdin: Option<tokio::process::ChildStdin>, input: SshInput) -> Result<(), Stop> {
    let Some(mut stdin) = stdin else {
        return Ok(());
    };
    let written = match input {
        SshInput::Empty => Ok(()),
        SshInput::Script(text) => stdin.write_all(text.as_bytes()).await,
        SshInput::Reader(mut reader) => tokio::io::copy(&mut reader, &mut stdin).await.map(|_| ()),
    };
    let _ = stdin.shutdown().await;
    drop(stdin);
    match written {
        Err(error) if error.kind() == std::io::ErrorKind::BrokenPipe => Ok(()),
        Err(error) => Err(Stop::Io(error)),
        Ok(()) => Ok(()),
    }
}

async fn collect(stdout: Option<tokio::process::ChildStdout>, max: usize) -> Result<Vec<u8>, Stop> {
    let Some(stdout) = stdout else {
        return Ok(Vec::new());
    };
    let mut bytes = Vec::new();
    stdout
        .take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(Stop::Io)?;
    if bytes.len() > max {
        return Err(Stop::Overflow);
    }
    Ok(bytes)
}

async fn collect_errors(stderr: Option<tokio::process::ChildStderr>) -> Result<String, Stop> {
    let Some(mut stderr) = stderr else {
        return Ok(String::new());
    };
    let mut kept: Vec<u8> = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        let read = stderr.read(&mut buffer).await.map_err(Stop::Io)?;
        if read == 0 {
            break;
        }
        kept.extend_from_slice(&buffer[..read]);
        if kept.len() > MAX_STDERR {
            let excess = kept.len() - MAX_STDERR;
            kept.drain(..excess);
        }
    }
    Ok(String::from_utf8_lossy(&kept).into_owned())
}

/// Runs one remote command. Standard input is always a pipe (Windows'
/// OpenSSH hangs on a `NUL` input); the call ends at the time limit or when
/// `cancel` fires, and the ssh process is killed then.
pub async fn run(
    ctx: &SshContext,
    endpoint: &SshEndpoint,
    mode: &HostKeyMode,
    remote_command: &str,
    input: SshInput,
    limits: SshLimits,
    cancel: &CancellationToken,
) -> Result<SshOutput, RunError> {
    let mut command = tokio::process::Command::new(&ctx.program);
    command
        .args(ssh_args(ctx, endpoint, mode, remote_command))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let agent = std::env::var("SSH_AUTH_SOCK").ok();
    for (name, value) in child_env_fixes(agent.as_deref(), cfg!(windows)) {
        match value {
            Some(value) => command.env(name, value),
            None => command.env_remove(name),
        };
    }
    no_window(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| RunError::Unavailable(format!("OpenSSH could not start: {error}")))?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let host = endpoint.host.as_str();
    let outcome = {
        let work = async {
            let (_, out, errors) = tokio::try_join!(
                feed(stdin, input),
                collect(stdout, limits.max_stdout),
                collect_errors(stderr)
            )?;
            let status = child.wait().await.map_err(Stop::Io)?;
            Ok::<_, Stop>((status.code(), out, errors))
        };
        tokio::select! {
            result = work => Some(result),
            _ = tokio::time::sleep(limits.timeout) => None,
            _ = cancel.cancelled() => {
                let _ = child.start_kill();
                let _ = child.wait().await;
                return Err(RunError::Cancelled);
            }
        }
    };
    match outcome {
        None => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            Err(RunError::Network(format!("{host} did not answer in time.")))
        }
        Some(Err(Stop::Overflow)) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            Err(RunError::Remote(format!(
                "The command on {host} printed more output than Oleafly reads."
            )))
        }
        Some(Err(Stop::Io(error))) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            Err(RunError::Io(format!(
                "The connection to {host} failed: {error}"
            )))
        }
        Some(Ok((code, stdout, stderr))) => Ok(SshOutput {
            code,
            stdout,
            stderr,
        }),
    }
}

pub async fn run_ok(
    ctx: &SshContext,
    endpoint: &SshEndpoint,
    mode: &HostKeyMode,
    remote_command: &str,
    input: SshInput,
    limits: SshLimits,
    cancel: &CancellationToken,
) -> Result<SshOutput, RunError> {
    let output = run(ctx, endpoint, mode, remote_command, input, limits, cancel).await?;
    if output.code == Some(0) {
        return Ok(output);
    }
    Err(classify(output.code, &output.stderr, &endpoint.host))
}

struct BlockingReader {
    stream: tokio::process::ChildStdout,
    runtime: tokio::runtime::Handle,
}

impl std::io::Read for BlockingReader {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let stream = &mut self.stream;
        self.runtime.block_on(stream.read(buffer))
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn run_streaming<T: Send + 'static>(
    ctx: &SshContext,
    endpoint: &SshEndpoint,
    mode: &HostKeyMode,
    remote_command: &str,
    input: SshInput,
    timeout: Duration,
    cancel: &CancellationToken,
    consume: impl FnOnce(&mut dyn std::io::Read) -> T + Send + 'static,
) -> Result<(T, SshOutput), RunError> {
    let mut command = tokio::process::Command::new(&ctx.program);
    command
        .args(ssh_args(ctx, endpoint, mode, remote_command))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let agent = std::env::var("SSH_AUTH_SOCK").ok();
    for (name, value) in child_env_fixes(agent.as_deref(), cfg!(windows)) {
        match value {
            Some(value) => command.env(name, value),
            None => command.env_remove(name),
        };
    }
    no_window(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| RunError::Unavailable(format!("OpenSSH could not start: {error}")))?;
    let stdin = child.stdin.take();
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| RunError::Io("OpenSSH gave no output stream.".into()))?;
    let stderr = child.stderr.take();
    let runtime = tokio::runtime::Handle::current();
    let consumer = tokio::task::spawn_blocking(move || {
        let mut reader = BlockingReader {
            stream: stdout,
            runtime,
        };
        consume(&mut reader)
    });
    let host = endpoint.host.as_str();
    let outcome = {
        let work = async {
            let (_, errors, value) =
                tokio::try_join!(feed(stdin, input), collect_errors(stderr), async {
                    consumer
                        .await
                        .map_err(|error| Stop::Io(std::io::Error::other(error.to_string())))
                })?;
            let status = child.wait().await.map_err(Stop::Io)?;
            Ok::<_, Stop>((value, status.code(), errors))
        };
        tokio::select! {
            result = work => Some(result),
            _ = tokio::time::sleep(timeout) => None,
            _ = cancel.cancelled() => {
                let _ = child.start_kill();
                let _ = child.wait().await;
                return Err(RunError::Cancelled);
            }
        }
    };
    match outcome {
        None => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            Err(RunError::Network(format!("{host} did not answer in time.")))
        }
        Some(Err(Stop::Overflow)) => Err(RunError::Remote(format!(
            "The command on {host} printed more output than Oleafly reads."
        ))),
        Some(Err(Stop::Io(error))) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            Err(RunError::Io(format!(
                "The connection to {host} failed: {error}"
            )))
        }
        Some(Ok((value, code, stderr))) => Ok((
            value,
            SshOutput {
                code,
                stdout: Vec::new(),
                stderr,
            },
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> SshContext {
        SshContext {
            program: PathBuf::from("ssh"),
            oleafly_known_hosts: PathBuf::from("/data/research/known_hosts"),
        }
    }

    fn endpoint() -> SshEndpoint {
        SshEndpoint {
            host: "cluster".into(),
            user: None,
            port: None,
        }
    }

    fn strings(args: &[OsString]) -> Vec<String> {
        args.iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn strict_args_use_oleafly_and_user_known_hosts() {
        let args = strings(&ssh_args(
            &ctx(),
            &endpoint(),
            &HostKeyMode::Strict,
            "sh -s",
        ));
        assert!(args.contains(&"BatchMode=yes".to_string()));
        assert!(args.contains(&"StrictHostKeyChecking=yes".to_string()));
        let known = args
            .iter()
            .find(|arg| arg.starts_with("UserKnownHostsFile="))
            .unwrap();
        assert!(
            known.contains("/data/research/known_hosts") && known.contains("~/.ssh/known_hosts"),
            "{known}"
        );
        let separator = args.iter().position(|arg| arg == "--").unwrap();
        assert_eq!(&args[separator + 1..], ["cluster", "sh -s"]);
    }

    #[test]
    fn probe_args_use_only_the_scratch_file() {
        let args = strings(&ssh_args(
            &ctx(),
            &endpoint(),
            &HostKeyMode::ProbeInto(PathBuf::from("/tmp/scratch")),
            "true",
        ));
        assert!(args.contains(&"StrictHostKeyChecking=accept-new".to_string()));
        let known = args
            .iter()
            .find(|arg| arg.starts_with("UserKnownHostsFile="))
            .unwrap();
        assert_eq!(known, "UserKnownHostsFile=\"/tmp/scratch\"");
    }

    #[test]
    fn user_and_port_are_separate_arguments() {
        let endpoint = SshEndpoint {
            host: "h".into(),
            user: Some("jdoe".into()),
            port: Some(2222),
        };
        let args = strings(&ssh_args(&ctx(), &endpoint, &HostKeyMode::Strict, "true"));
        let user = args.iter().position(|arg| arg == "-l").unwrap();
        assert_eq!(args[user + 1], "jdoe");
        let port = args.iter().position(|arg| arg == "-p").unwrap();
        assert_eq!(args[port + 1], "2222");
    }

    #[test]
    fn no_quiet_flag() {
        let args = strings(&ssh_args(&ctx(), &endpoint(), &HostKeyMode::Strict, "true"));
        assert!(!args.contains(&"-q".to_string()));
    }

    #[test]
    fn windows_paths_use_forward_slashes_and_quotes() {
        assert_eq!(
            ssh_path_value(r"C:\Users\John Doe\.oleafly\research\known_hosts", true),
            "\"C:/Users/John Doe/.oleafly/research/known_hosts\""
        );
        assert_eq!(ssh_path_value("/a \"b\"/c", false), "\"/a \\\"b\\\"/c\"");
    }

    #[test]
    fn windows_prefers_system_openssh() {
        let system = PathBuf::from(r"C:\Windows")
            .join("System32")
            .join("OpenSSH")
            .join("ssh.exe");
        let expected = system.clone();
        let only_system = move |path: &Path| path == expected.as_path();
        let none = |_: &str| None;
        assert_eq!(
            ssh_program_for(Some(Path::new(r"C:\Windows")), &only_system, &none),
            Some(system)
        );
        let nothing = |_: &Path| false;
        let found = |_: &str| Some(PathBuf::from("/usr/bin/ssh"));
        assert_eq!(
            ssh_program_for(Some(Path::new(r"C:\Windows")), &nothing, &found),
            Some(PathBuf::from("/usr/bin/ssh"))
        );
        assert_eq!(
            ssh_program_for(Some(Path::new(r"C:\Windows")), &nothing, &none),
            None
        );
    }

    #[test]
    fn windows_drops_msys_agent_socket() {
        assert_eq!(
            child_env_fixes(Some("/tmp/ssh-x/agent.1"), true),
            vec![("SSH_AUTH_SOCK".to_string(), None)]
        );
        assert!(child_env_fixes(Some(r"\\.\pipe\openssh-ssh-agent"), true).is_empty());
        assert!(child_env_fixes(Some("/tmp/ssh-x/agent.1"), false).is_empty());
    }

    #[test]
    fn classify_maps_openssh_messages() {
        let unknown = classify(
            Some(255),
            "No ED25519 host key is known for h and you have requested strict checking.\nHost key verification failed.",
            "h",
        );
        assert!(
            matches!(unknown, RunError::HostKeyUnknown(ref message) if message.contains("Settings"))
        );
        let changed = classify(
            Some(255),
            "@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @\nHost key verification failed.",
            "h",
        );
        assert!(matches!(changed, RunError::HostKeyChanged(_)));
        assert!(matches!(
            classify(Some(255), "jdoe@h: Permission denied (publickey).", "h"),
            RunError::Auth(_)
        ));
        for message in [
            "ssh: Could not resolve hostname h",
            "Connection timed out",
            "Connection refused",
        ] {
            assert!(
                matches!(classify(Some(255), message, "h"), RunError::Network(_)),
                "{message}"
            );
        }
        let remote = classify(Some(3), "boom", "h");
        assert!(
            matches!(remote, RunError::Remote(ref message) if message.contains("h") && message.contains("boom"))
        );
    }

    #[cfg(unix)]
    fn fake_ssh(dir: &Path, body: &str) -> SshContext {
        let program = dir.join("fake-ssh");
        crate::runs::remote::testing::write_script(&program, body);
        SshContext {
            program,
            oleafly_known_hosts: dir.join("known_hosts"),
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stdin_is_always_a_pipe() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = fake_ssh(
            dir.path(),
            "#!/bin/sh\n[ -p /dev/stdin ] && exit 0\nexit 7\n",
        );
        let output = run(
            &ctx,
            &endpoint(),
            &HostKeyMode::Strict,
            "true",
            SshInput::Empty,
            SshLimits::new(Duration::from_secs(10), 1024),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(output.code, Some(0));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn timeout_kills_ssh_and_reports_network() {
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("pid");
        let ctx = fake_ssh(
            dir.path(),
            &format!(
                "#!/bin/sh\n[ \"$1\" = --warm-up ] && exit 0\necho $$ > '{}'\nexec sleep 30\n",
                marker.display()
            ),
        );
        // The first start of a new program can be slow on a busy machine
        // (macOS checks it), so it happens before the timed call.
        assert!(std::process::Command::new(&ctx.program)
            .arg("--warm-up")
            .status()
            .unwrap()
            .success());
        let started = std::time::Instant::now();
        let error = run(
            &ctx,
            &endpoint(),
            &HostKeyMode::Strict,
            "true",
            SshInput::Empty,
            SshLimits::new(Duration::from_secs(3), 1024),
            &CancellationToken::new(),
        )
        .await
        .unwrap_err();
        assert!(matches!(error, RunError::Network(_)), "{error:?}");
        assert!(started.elapsed() < Duration::from_secs(8));
        let pid: i32 = std::fs::read_to_string(&marker)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        // SAFETY: probing a pid with signal 0 sends nothing.
        assert_ne!(
            unsafe { libc::kill(pid, 0) },
            0,
            "the fake ssh is still running"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stdout_cap_is_enforced() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = fake_ssh(dir.path(), "#!/bin/sh\nhead -c 100000 /dev/zero\n");
        let error = run(
            &ctx,
            &endpoint(),
            &HostKeyMode::Strict,
            "true",
            SshInput::Empty,
            SshLimits::new(Duration::from_secs(10), 1000),
            &CancellationToken::new(),
        )
        .await
        .unwrap_err();
        assert!(
            matches!(error, RunError::Remote(ref message) if message.contains("more output")),
            "{error:?}"
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_spawn_classifies_a_fake_ssh_failure() {
        let dir = tempfile::tempdir().unwrap();
        let program = dir.path().join("fake-ssh.cmd");
        std::fs::write(
            &program,
            "@echo off\r\necho Host key verification failed. 1>&2\r\nexit /b 255\r\n",
        )
        .unwrap();
        let ctx = SshContext {
            program,
            oleafly_known_hosts: dir.path().join("known_hosts"),
        };
        let started = std::time::Instant::now();
        let error = run_ok(
            &ctx,
            &endpoint(),
            &HostKeyMode::Strict,
            "true",
            SshInput::Empty,
            SshLimits::new(Duration::from_secs(10), 1024),
            &CancellationToken::new(),
        )
        .await
        .unwrap_err();
        assert!(matches!(error, RunError::HostKeyUnknown(_)), "{error:?}");
        assert!(started.elapsed() < Duration::from_secs(10));
    }
}
