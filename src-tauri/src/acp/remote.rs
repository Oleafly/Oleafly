//! Hermes on another machine: Oleafly starts `ssh host hermes acp` and talks
//! ACP over it. The user's own SSH keys sign in (BatchMode, no prompts);
//! every remote word is quoted for the remote shell.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

const TEST_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHermes {
    /// `host` or `user@host` (an SSH config alias works too).
    pub host: String,
    pub port: Option<u16>,
    /// The project folder on the remote machine (absolute).
    pub folder: String,
    /// `hermes`, or an absolute path to it.
    pub command: String,
    pub profile: Option<String>,
}

fn plain_word(text: &str) -> bool {
    !text.contains(['\0', '\r', '\n'])
}

pub fn validate(remote: &RemoteHermes) -> Result<(), String> {
    let host_ok = !remote.host.is_empty()
        && remote.host.len() <= 253
        && !remote.host.starts_with('-')
        && remote
            .host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '@' | '-'));
    if !host_ok {
        return Err("Enter the SSH host as host or user@host.".into());
    }
    if remote.port == Some(0) {
        return Err("Enter an SSH port between 1 and 65535.".into());
    }
    if !remote.folder.starts_with('/') || remote.folder.len() > 1024 || !plain_word(&remote.folder)
    {
        return Err(
            "Enter the remote project folder as an absolute path, such as /home/me/thesis.".into(),
        );
    }
    let command_ok = remote.command == "hermes"
        || (remote.command.starts_with('/')
            && remote.command.len() <= 1024
            && remote.command.chars().all(|c| {
                c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '/' | '~' | '+' | '-')
            }));
    if !command_ok {
        return Err("Enter hermes, or the absolute path to hermes on the remote machine.".into());
    }
    if let Some(profile) = &remote.profile {
        if !super::hermes::valid_profile_name(profile) {
            return Err(
                "The Hermes profile name may use lowercase letters, digits, - and _.".into(),
            );
        }
    }
    Ok(())
}

/// A word quoted for a POSIX shell.
pub fn sh_quote(word: &str) -> String {
    format!("'{}'", word.replace('\'', "'\\''"))
}

fn base_args(remote: &RemoteHermes) -> Vec<String> {
    let mut args: Vec<String> = [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ServerAliveInterval=30",
        "-o",
        "ServerAliveCountMax=4",
    ]
    .iter()
    .map(|arg| (*arg).to_string())
    .collect();
    if let Some(port) = remote.port {
        args.extend(["-p".to_string(), port.to_string()]);
    }
    args.extend(["--".to_string(), remote.host.clone()]);
    args.push(sh_quote(&remote.command));
    if let Some(profile) = &remote.profile {
        args.extend(["-p".to_string(), sh_quote(profile)]);
    }
    args
}

/// `ssh … -- host 'hermes' ['-p' 'profile'] acp`.
pub fn ssh_args(remote: &RemoteHermes) -> Vec<String> {
    let mut args = base_args(remote);
    args.push("acp".into());
    args
}

/// The `ssh` program: the one on the search path, or Windows's own copy.
pub fn locate_ssh() -> Option<PathBuf> {
    if let Some(found) = crate::program_locator::locate_native("ssh") {
        return Some(found.path);
    }
    #[cfg(windows)]
    {
        let root = std::env::var_os("SystemRoot")?;
        let path = PathBuf::from(root).join(r"System32\OpenSSH\ssh.exe");
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

fn explain(stderr: &str) -> String {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("permission denied") || lower.contains("host key verification failed") {
        if lower.contains("host key") {
            return "SSH does not know this host yet. Connect once from a terminal to accept its host key, then test again.".into();
        }
        return "Oleafly signs in with your SSH keys only. Add a key for this host (ssh-copy-id), then test again.".into();
    }
    if lower.contains("could not resolve") || lower.contains("name or service not known") {
        return "The SSH host could not be found. Check the host name.".into();
    }
    if lower.contains("command not found") || lower.contains("no such file") {
        return "Hermes was not found on the remote machine. Check the command path.".into();
    }
    let first = stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("The connection failed.");
    first.chars().take(300).collect()
}

/// Runs `hermes --version` on the remote machine; the version text on
/// success.
pub async fn test_connection(ssh: &Path, remote: &RemoteHermes) -> Result<String, String> {
    validate(remote)?;
    let mut args = base_args(remote);
    args.push("--version".into());
    let mut command = tokio::process::Command::new(ssh);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = tokio::time::timeout(TEST_TIMEOUT, command.output())
        .await
        .map_err(|_| "The SSH connection did not answer within 15 seconds.".to_string())?
        .map_err(|_| "Oleafly couldn't start ssh.".to_string())?;
    if !output.status.success() {
        return Err(explain(&String::from_utf8_lossy(&output.stderr)));
    }
    let version = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("Hermes")
        .chars()
        .take(200)
        .collect();
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn remote() -> RemoteHermes {
        RemoteHermes {
            host: "me@lab.example.org".into(),
            port: Some(2222),
            folder: "/home/a b/it's".into(),
            command: "hermes".into(),
            profile: Some("work".into()),
        }
    }

    #[test]
    fn ssh_args_quote_remote_words() {
        let args = ssh_args(&remote());
        assert!(args.windows(2).any(|pair| pair == ["-p", "2222"]));
        assert_eq!(args.last().unwrap(), "acp");
        assert!(args.contains(&"'hermes'".to_string()));
        assert!(args.contains(&"'work'".to_string()));
        assert!(!args.iter().any(|arg| arg.contains("/home/a b")));
        assert_eq!(sh_quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn remote_settings_reject_option_injection() {
        let mut bad = remote();
        bad.host = "-oProxyCommand=x".into();
        assert!(validate(&bad).is_err());
        let mut bad = remote();
        bad.command = "hermes; rm".into();
        assert!(validate(&bad).is_err());
        let mut bad = remote();
        bad.folder = "relative/x".into();
        assert!(validate(&bad).is_err());
        assert!(validate(&remote()).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn ssh_falls_back_to_the_system32_openssh_copy() {
        if crate::program_locator::locate_native("ssh").is_none() {
            let found = locate_ssh().unwrap();
            assert!(found.ends_with(r"System32\OpenSSH\ssh.exe"));
        }
    }
}
