//! First contact with an SSH host, from Settings only: probe its keys into a
//! scratch file, show their fingerprints, and trust exactly the keys the
//! user saw, in Oleafly's own `known_hosts` (the user's files stay
//! untouched).
use std::collections::BTreeSet;
use std::fs::OpenOptions;
use std::path::Path;
use std::time::Duration;

use base64::Engine;
use oleafly_agent::CancellationToken;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::transport::{self, HostKeyMode, SshContext, SshEndpoint, SshInput, SshLimits};
use crate::runs::RunError;

const PROBE_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyFingerprint {
    pub key_type: String,
    pub fingerprint: String,
}

/// The SHA256 fingerprint `ssh-keygen -l` shows for a `known_hosts` line.
pub fn fingerprint(known_hosts_line: &str) -> Option<HostKeyFingerprint> {
    let line = known_hosts_line.trim();
    if line.is_empty() || line.starts_with('#') || line.starts_with('@') {
        return None;
    }
    let mut fields = line.split_whitespace();
    let _hosts = fields.next()?;
    let key_type = fields.next()?;
    let blob = base64::engine::general_purpose::STANDARD
        .decode(fields.next()?)
        .ok()?;
    let digest = Sha256::digest(&blob);
    Some(HostKeyFingerprint {
        key_type: key_type.to_string(),
        fingerprint: format!(
            "SHA256:{}",
            base64::engine::general_purpose::STANDARD_NO_PAD.encode(digest)
        ),
    })
}

/// Connects once with `accept-new` into a scratch file and returns the key
/// lines the host offered. Authentication may fail; the keys arrive first.
pub async fn probe(
    ctx: &SshContext,
    endpoint: &SshEndpoint,
    cancel: &CancellationToken,
) -> Result<Vec<String>, RunError> {
    let folder = ctx
        .oleafly_known_hosts
        .parent()
        .ok_or_else(|| RunError::Io("Oleafly's data folder is missing.".into()))?;
    tokio::fs::create_dir_all(folder)
        .await
        .map_err(|error| RunError::Io(error.to_string()))?;
    let scratch = tempfile::Builder::new()
        .prefix("probe-")
        .tempfile_in(folder)
        .map_err(|error| RunError::Io(error.to_string()))?;
    let output = transport::run(
        ctx,
        endpoint,
        &HostKeyMode::ProbeInto(scratch.path().to_path_buf()),
        "true",
        SshInput::Empty,
        SshLimits::new(PROBE_TIMEOUT, 64 * 1024),
        cancel,
    )
    .await?;
    let text = tokio::fs::read_to_string(scratch.path())
        .await
        .unwrap_or_default();
    let lines: Vec<String> = text
        .lines()
        .map(str::trim)
        .filter(|line| fingerprint(line).is_some())
        .map(str::to_string)
        .collect();
    if lines.is_empty() {
        return Err(transport::classify(
            output.code,
            &output.stderr,
            &endpoint.host,
        ));
    }
    Ok(lines)
}

/// Probes again and trusts the keys only when they are exactly the ones
/// the user confirmed.
pub async fn trust(
    ctx: &SshContext,
    endpoint: &SshEndpoint,
    confirmed: &[String],
    cancel: &CancellationToken,
) -> Result<(), RunError> {
    let lines = probe(ctx, endpoint, cancel).await?;
    let offered: BTreeSet<String> = lines
        .iter()
        .filter_map(|line| fingerprint(line))
        .map(|key| key.fingerprint)
        .collect();
    let wanted: BTreeSet<String> = confirmed.iter().cloned().collect();
    if offered != wanted {
        return Err(RunError::HostKeyChanged(format!(
            "{} sent a different key than the one you confirmed. Test the target again before trusting it.",
            endpoint.host
        )));
    }
    let lines: Vec<String> = lines
        .iter()
        .map(|line| with_target_name(line, &endpoint.host, endpoint.port))
        .collect();
    append_lines(&ctx.oleafly_known_hosts, &lines)
}

/// A probed key line with the target's own name added to its hosts. ssh
/// writes the line under the resolved `HostName` and `Port`, so for a
/// target imported from `~/.ssh/config` (an alias) the line would not name
/// the target at all, and "Forget host key" would find nothing to remove.
fn with_target_name(line: &str, host: &str, port: Option<u16>) -> String {
    let Some((hosts, rest)) = line.split_once(char::is_whitespace) else {
        return line.to_owned();
    };
    let Some(name) = host_patterns(host, port).into_iter().next() else {
        return line.to_owned();
    };
    if hosts.split(',').any(|entry| entry == name) {
        return line.to_owned();
    }
    format!("{hosts},{name} {}", rest.trim_start())
}

fn lock_for(file: &Path) -> Result<std::fs::File, RunError> {
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(file.with_extension("lock"))
        .map_err(|error| RunError::Io(error.to_string()))?;
    fs4::FileExt::lock(&lock).map_err(|error| RunError::Io(error.to_string()))?;
    Ok(lock)
}

fn write_private(file: &Path, text: &str) -> Result<(), RunError> {
    let folder = file
        .parent()
        .ok_or_else(|| RunError::Io("Oleafly's data folder is missing.".into()))?;
    let temporary =
        tempfile::NamedTempFile::new_in(folder).map_err(|error| RunError::Io(error.to_string()))?;
    std::fs::write(temporary.path(), text).map_err(|error| RunError::Io(error.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(temporary.path(), std::fs::Permissions::from_mode(0o600));
    }
    temporary
        .persist(file)
        .map_err(|error| RunError::Io(error.error.to_string()))?;
    Ok(())
}

fn append_lines(file: &Path, lines: &[String]) -> Result<(), RunError> {
    if let Some(folder) = file.parent() {
        std::fs::create_dir_all(folder).map_err(|error| RunError::Io(error.to_string()))?;
    }
    let _lock = lock_for(file)?;
    let existing = std::fs::read_to_string(file).unwrap_or_default();
    let mut text = existing.clone();
    let known: BTreeSet<&str> = existing.lines().map(str::trim).collect();
    let mut added = false;
    for line in lines {
        if !known.contains(line.as_str()) {
            if !text.is_empty() && !text.ends_with('\n') {
                text.push('\n');
            }
            text.push_str(line);
            text.push('\n');
            added = true;
        }
    }
    if !added && !existing.is_empty() {
        return Ok(());
    }
    write_private(file, &text)
}

fn host_patterns(host: &str, port: Option<u16>) -> Vec<String> {
    match port {
        Some(port) if port != 22 => vec![format!("[{host}]:{port}")],
        _ => vec![host.to_string(), format!("[{host}]:22")],
    }
}

/// Removes the keys Oleafly trusted for `host` (and `port`); returns how
/// many lines went.
pub fn forget(file: &Path, host: &str, port: Option<u16>) -> Result<usize, RunError> {
    if !file.exists() {
        return Ok(0);
    }
    // Read under the lock, so a line a concurrent trust writes is never lost.
    let _lock = lock_for(file)?;
    let Ok(existing) = std::fs::read_to_string(file) else {
        return Ok(0);
    };
    let patterns = host_patterns(host, port);
    let mut removed = 0;
    let mut kept = String::new();
    for line in existing.lines() {
        let hosts = line.split_whitespace().next().unwrap_or("");
        if hosts
            .split(',')
            .any(|entry| patterns.iter().any(|pattern| pattern == entry))
        {
            removed += 1;
            continue;
        }
        kept.push_str(line);
        kept.push('\n');
    }
    if removed > 0 {
        write_private(file, &kept)?;
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIO5iNlYpT42j+Y7KWV6rcQPDAz8RIwdxSau3SX19xb4V";

    #[test]
    fn fingerprint_matches_ssh_keygen() {
        let line = format!("h ssh-ed25519 {KEY}");
        assert_eq!(
            fingerprint(&line).unwrap(),
            HostKeyFingerprint {
                key_type: "ssh-ed25519".into(),
                fingerprint: "SHA256:KBnev/h5SIgwiDASyOnH51z2NYWfa99cXhaTQrXXW0A".into(),
            }
        );
        assert!(fingerprint("# comment").is_none());
        assert!(fingerprint("@revoked h ssh-ed25519 AAAA").is_none());
    }

    #[test]
    fn forget_removes_plain_and_bracketed_port_entries() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("known_hosts");
        std::fs::write(
            &file,
            format!("h ssh-ed25519 {KEY}\n[h]:2222 ssh-ed25519 {KEY}\nother ssh-ed25519 {KEY}\n"),
        )
        .unwrap();
        assert_eq!(forget(&file, "h", Some(2222)).unwrap(), 1);
        assert_eq!(forget(&file, "h", None).unwrap(), 1);
        let left = std::fs::read_to_string(&file).unwrap();
        assert_eq!(left.lines().count(), 1);
        assert!(left.starts_with("other "));
    }

    #[cfg(unix)]
    fn fake_ssh(dir: &Path, key: &str) -> SshContext {
        let program = dir.join("ssh");
        // Writes the given key line into the UserKnownHostsFile like accept-new.
        crate::runs::remote::testing::write_script(
            &program,
            &format!(
                r#"#!/bin/sh
for a in "$@"; do case "$a" in UserKnownHostsFile=*) f="${{a#UserKnownHostsFile=}}";; esac; done
f=$(printf %s "$f" | sed 's/^"//; s/"$//')
key=$(cat '{key}')
echo "h ssh-ed25519 $key" >> "$f"
echo "jdoe@h: Permission denied (publickey)." >&2
exit 255
"#,
                key = dir.join("key").display()
            ),
        );
        std::fs::write(dir.join("key"), key).unwrap();
        SshContext {
            program,
            oleafly_known_hosts: dir.join("research").join("known_hosts"),
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn trust_rechecks_fingerprints() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = fake_ssh(dir.path(), KEY);
        let endpoint = SshEndpoint {
            host: "h".into(),
            user: None,
            port: None,
        };
        let lines = probe(&ctx, &endpoint, &CancellationToken::new())
            .await
            .unwrap();
        let confirmed = vec![fingerprint(&lines[0]).unwrap().fingerprint];
        std::fs::write(
            dir.path().join("key"),
            "AAAAC3NzaC1lZDI1NTE5AAAAIBf0jTq8E9H4Yp1nWJb0mJ3bR0mQ8uVgS3a3w8cQmM2x",
        )
        .unwrap();
        let error = trust(&ctx, &endpoint, &confirmed, &CancellationToken::new())
            .await
            .unwrap_err();
        assert!(error.to_string().contains("different key"), "{error}");
        assert!(!ctx.oleafly_known_hosts.exists());
    }

    // ssh writes the probed key under the resolved host name, which a target
    // imported from ~/.ssh/config does not use: the trusted line names the
    // target too, so forgetting it by its own name removes the key.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_key_trusted_for_an_alias_is_forgotten_by_that_alias() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = fake_ssh(dir.path(), KEY);
        let endpoint = SshEndpoint {
            host: "cluster".into(),
            user: None,
            port: None,
        };
        let confirmed = vec!["SHA256:KBnev/h5SIgwiDASyOnH51z2NYWfa99cXhaTQrXXW0A".to_string()];
        trust(&ctx, &endpoint, &confirmed, &CancellationToken::new())
            .await
            .unwrap();
        let text = std::fs::read_to_string(&ctx.oleafly_known_hosts).unwrap();
        assert_eq!(text, format!("h,cluster ssh-ed25519 {KEY}\n"));
        assert_eq!(
            forget(&ctx.oleafly_known_hosts, "cluster", None).unwrap(),
            1
        );
        assert_eq!(
            std::fs::read_to_string(&ctx.oleafly_known_hosts).unwrap(),
            ""
        );
        assert_eq!(
            forget(&ctx.oleafly_known_hosts, "cluster", None).unwrap(),
            0
        );
    }

    #[test]
    fn the_target_name_goes_beside_the_probed_host_once() {
        let line = format!("h ssh-ed25519 {KEY}");
        assert_eq!(
            with_target_name(&line, "alias", Some(2222)),
            format!("h,[alias]:2222 ssh-ed25519 {KEY}")
        );
        assert_eq!(with_target_name(&line, "h", None), line);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn trust_appends_once() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let ctx = fake_ssh(dir.path(), KEY);
        let endpoint = SshEndpoint {
            host: "h".into(),
            user: None,
            port: None,
        };
        let confirmed = vec!["SHA256:KBnev/h5SIgwiDASyOnH51z2NYWfa99cXhaTQrXXW0A".to_string()];
        trust(&ctx, &endpoint, &confirmed, &CancellationToken::new())
            .await
            .unwrap();
        trust(&ctx, &endpoint, &confirmed, &CancellationToken::new())
            .await
            .unwrap();
        let text = std::fs::read_to_string(&ctx.oleafly_known_hosts).unwrap();
        assert_eq!(text.lines().count(), 1, "{text}");
        let mode = std::fs::metadata(&ctx.oleafly_known_hosts)
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
