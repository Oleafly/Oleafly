//! The "Test" button in Settings › Research › Compute: connects to a target,
//! checks what runs need there, and asks about an unknown host key.
use std::time::Duration;

use oleafly_agent::CancellationToken;
use serde::Serialize;
use serde_json::json;

use super::cua_space::{cua_server, parse_bash, parse_spaces};
use super::host_keys::{self, HostKeyFingerprint};
use super::settings::{self, ComputeTarget, TestSummary};
use super::transport::{self, HostKeyMode, SshContext, SshEndpoint, SshInput, SshLimits};
use super::ComputeHost;
use crate::model::now_ms;
use crate::runs::RunError;

const TEST_TIMEOUT: Duration = Duration::from_secs(60);
const LOW_DISK_KIB: u64 = 2 * 1024 * 1024;
const FULL_DISK_KIB: u64 = 200 * 1024;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComputeTestReport {
    pub target_id: String,
    pub checks: Vec<ComputeCheck>,
    pub host_key: Option<HostKeyPrompt>,
    pub resolved: Option<String>,
    pub finished_at: i64,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComputeCheck {
    pub id: CheckId,
    pub status: CheckStatus,
    pub detail: String,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CheckId {
    Connect,
    Echo,
    Disk,
    Python,
    Gpu,
    Rsync,
    Slurm,
    Cua,
    Space,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CheckStatus {
    Pass,
    Warn,
    Fail,
    Skipped,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyPrompt {
    pub host: String,
    pub keys: Vec<HostKeyFingerprint>,
    pub changed: bool,
}

const TEST_SCRIPT: &str = r#"cd || exit 1
echo 'OLEAFLY_CHECK echo oleafly-ok'
free=$(df -Pk . 2>/dev/null | awk 'NR==2 {print $(NF-2)}')
echo "OLEAFLY_CHECK disk ${free:-unknown}"
v=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:3])))' 2>/dev/null | head -n 1)
case "$v" in [0-9]*.[0-9]*.[0-9]*) ;; *) v=$(python -c 'import sys; print(".".join(map(str, sys.version_info[:3])))' 2>/dev/null | head -n 1);; esac
echo "OLEAFLY_CHECK python ${v:-missing}"
if command -v nvidia-smi >/dev/null 2>&1; then
  g=$(nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits 2>/dev/null | head -n 8)
  if [ -n "$g" ]; then printf '%s\n' "$g" | while IFS= read -r line; do echo "OLEAFLY_CHECK gpu $line"; done; else echo 'OLEAFLY_CHECK gpu none'; fi
else
  echo 'OLEAFLY_CHECK gpu none'
fi
if command -v rsync >/dev/null 2>&1; then echo 'OLEAFLY_CHECK rsync yes'; else echo 'OLEAFLY_CHECK rsync missing'; fi
"#;

const SLURM_LINES: &str = r#"if command -v sbatch >/dev/null 2>&1; then
  echo "OLEAFLY_CHECK slurm $(sbatch --version 2>/dev/null | head -n 1) | $(sinfo -h -o %P 2>/dev/null | head -n 8 | tr '\n' ' ')"
else
  echo 'OLEAFLY_CHECK slurm missing'
fi
"#;

/// The check script (with the Slurm lines for a cluster).
pub fn test_script(slurm: bool) -> &'static str {
    use std::sync::OnceLock;
    static WITH_SLURM: OnceLock<String> = OnceLock::new();
    if slurm {
        WITH_SLURM.get_or_init(|| format!("{TEST_SCRIPT}{SLURM_LINES}"))
    } else {
        TEST_SCRIPT
    }
}

fn check(id: CheckId, status: CheckStatus, detail: impl Into<String>) -> ComputeCheck {
    ComputeCheck {
        id,
        status,
        detail: detail.into(),
    }
}

fn gigabytes(kib: u64) -> String {
    format!("{:.1} GB free", kib as f64 / (1024.0 * 1024.0))
}

fn is_version(value: &str) -> bool {
    let parts: Vec<&str> = value.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty() && part.chars().all(|character| character.is_ascii_digit())
        })
}

/// The checks the script printed.
pub fn parse_test_output(stdout: &str) -> Vec<ComputeCheck> {
    let mut checks = Vec::new();
    let mut gpus: Vec<String> = Vec::new();
    let mut gpu_seen = false;
    for line in stdout.lines().map(|line| line.trim_end_matches('\r')) {
        let Some(rest) = line.strip_prefix("OLEAFLY_CHECK ") else {
            continue;
        };
        let (name, value) = rest.split_once(' ').unwrap_or((rest, ""));
        let value = value.trim();
        match name {
            "echo" if value == "oleafly-ok" => {
                checks.push(check(CheckId::Echo, CheckStatus::Pass, ""))
            }
            "echo" => checks.push(check(
                CheckId::Echo,
                CheckStatus::Fail,
                "The shell printed something unexpected.",
            )),
            "disk" => checks.push(match value.parse::<u64>() {
                Ok(kib) if kib < FULL_DISK_KIB => {
                    check(CheckId::Disk, CheckStatus::Fail, gigabytes(kib))
                }
                Ok(kib) if kib < LOW_DISK_KIB => {
                    check(CheckId::Disk, CheckStatus::Warn, gigabytes(kib))
                }
                Ok(kib) => check(CheckId::Disk, CheckStatus::Pass, gigabytes(kib)),
                Err(_) => check(CheckId::Disk, CheckStatus::Warn, "unknown"),
            }),
            "python" if is_version(value) => {
                checks.push(check(CheckId::Python, CheckStatus::Pass, value))
            }
            "python" => checks.push(check(CheckId::Python, CheckStatus::Warn, "missing")),
            "gpu" => {
                gpu_seen = true;
                if value != "none" && !value.is_empty() {
                    gpus.push(value.split(',').next().unwrap_or(value).trim().to_string());
                }
            }
            "rsync" if value == "yes" => checks.push(check(CheckId::Rsync, CheckStatus::Pass, "")),
            "rsync" => checks.push(check(CheckId::Rsync, CheckStatus::Warn, "missing")),
            "slurm" if value == "missing" => {
                checks.push(check(CheckId::Slurm, CheckStatus::Fail, "missing"))
            }
            "slurm" => checks.push(check(
                CheckId::Slurm,
                CheckStatus::Pass,
                value.trim_end_matches(['|', ' ']),
            )),
            _ => {}
        }
    }
    if gpu_seen {
        checks.push(match gpus.len() {
            0 => check(CheckId::Gpu, CheckStatus::Skipped, "none"),
            1 => check(CheckId::Gpu, CheckStatus::Pass, gpus[0].clone()),
            count => check(
                CheckId::Gpu,
                CheckStatus::Pass,
                format!("{count} × {}", gpus[0]),
            ),
        });
    }
    checks
}

/// `user@hostname:port` from `ssh -G` (the user's config resolved locally).
pub fn parse_ssh_g(stdout: &str) -> Option<String> {
    let mut user = None;
    let mut hostname = None;
    let mut port = None;
    for line in stdout.lines() {
        let Some((key, value)) = line.trim().split_once(' ') else {
            continue;
        };
        match key {
            "user" => user = Some(value.trim()),
            "hostname" => hostname = Some(value.trim()),
            "port" => port = Some(value.trim()),
            _ => {}
        }
    }
    let hostname = hostname?;
    Some(match (user, port) {
        (Some(user), Some(port)) => format!("{user}@{hostname}:{port}"),
        (Some(user), None) => format!("{user}@{hostname}"),
        (None, Some(port)) => format!("{hostname}:{port}"),
        (None, None) => hostname.to_string(),
    })
}

async fn resolve(ctx: &SshContext, endpoint: &SshEndpoint) -> Option<String> {
    let mut command = tokio::process::Command::new(&ctx.program);
    command.arg("-G");
    if let Some(user) = &endpoint.user {
        command.args(["-l", user]);
    }
    if let Some(port) = endpoint.port {
        command.args(["-p", &port.to_string()]);
    }
    command
        .arg("--")
        .arg(&endpoint.host)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    transport::no_window(&mut command);
    let output = tokio::time::timeout(Duration::from_secs(10), command.output())
        .await
        .ok()?
        .ok()?;
    output
        .status
        .success()
        .then(|| parse_ssh_g(&String::from_utf8_lossy(&output.stdout)))
        .flatten()
}

async fn test_ssh(
    host: &dyn ComputeHost,
    endpoint: SshEndpoint,
    slurm: bool,
    cancel: &CancellationToken,
    report: &mut ComputeTestReport,
) {
    let ctx = match SshContext::new(&host.data_root(), &|name| host.locate_program(name)) {
        Ok(ctx) => ctx,
        Err(error) => {
            report.checks.push(check(
                CheckId::Connect,
                CheckStatus::Fail,
                error.to_string(),
            ));
            report.error = Some(error.to_string());
            return;
        }
    };
    report.resolved = resolve(&ctx, &endpoint).await;
    let result = transport::run_ok(
        &ctx,
        &endpoint,
        &HostKeyMode::Strict,
        "sh -s",
        SshInput::Script(test_script(slurm).to_string()),
        SshLimits::new(TEST_TIMEOUT, 256 * 1024),
        cancel,
    )
    .await;
    match result {
        Ok(output) => {
            report
                .checks
                .push(check(CheckId::Connect, CheckStatus::Pass, ""));
            report.checks.extend(parse_test_output(&output.text()));
        }
        Err(RunError::HostKeyUnknown(message)) => {
            report
                .checks
                .push(check(CheckId::Connect, CheckStatus::Fail, message));
            match host_keys::probe(&ctx, &endpoint, cancel).await {
                Ok(lines) => {
                    report.host_key = Some(HostKeyPrompt {
                        host: endpoint.host.clone(),
                        keys: lines
                            .iter()
                            .filter_map(|line| host_keys::fingerprint(line))
                            .collect(),
                        changed: false,
                    });
                }
                Err(error) => report.error = Some(error.to_string()),
            }
        }
        Err(RunError::HostKeyChanged(message)) => {
            report
                .checks
                .push(check(CheckId::Connect, CheckStatus::Fail, message));
            report.host_key = Some(HostKeyPrompt {
                host: endpoint.host.clone(),
                keys: Vec::new(),
                changed: true,
            });
        }
        Err(error) => {
            report.checks.push(check(
                CheckId::Connect,
                CheckStatus::Fail,
                error.to_string(),
            ));
            report.error = Some(error.to_string());
        }
    }
}

async fn test_cua(
    host: &dyn ComputeHost,
    space: &str,
    per_task: bool,
    report: &mut ComputeTestReport,
) -> bool {
    let Some(program) = host.locate_program("cua") else {
        report.checks.push(check(
            CheckId::Cua,
            CheckStatus::Fail,
            "Cua is not installed. Install it from cua.ai, then test again.",
        ));
        return false;
    };
    let mut version = tokio::process::Command::new(&program);
    version
        .arg("--version")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    transport::no_window(&mut version);
    let printed = match tokio::time::timeout(Duration::from_secs(10), version.output()).await {
        Ok(Ok(output)) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        }
        _ => String::new(),
    };
    report
        .checks
        .push(check(CheckId::Cua, CheckStatus::Pass, printed));
    let server = cua_server(program, per_task);
    if per_task {
        report.checks.push(check(
            CheckId::Space,
            CheckStatus::Pass,
            "A new Space is created for each task.",
        ));
        return false;
    }
    let listed = host
        .mcp_call(&server, "list_spaces", json!({}), TEST_TIMEOUT)
        .await
        .map_err(RunError::Network)
        .and_then(|result| parse_spaces(&result));
    let spaces = match listed {
        Ok(spaces) => spaces,
        Err(error) => {
            report
                .checks
                .push(check(CheckId::Space, CheckStatus::Fail, error.to_string()));
            return false;
        }
    };
    let Some(found) = spaces.into_iter().find(|candidate| candidate.name == space) else {
        report.checks.push(check(
            CheckId::Space,
            CheckStatus::Warn,
            "The Space doesn't exist yet. Oleafly creates it on the first run.",
        ));
        return false;
    };
    if found.os.contains("windows") {
        report.checks.push(check(
            CheckId::Space,
            CheckStatus::Fail,
            "Runs need a Linux or macOS Space.",
        ));
        return found.relay;
    }
    if found.relay {
        report.checks.push(check(
            CheckId::Space,
            CheckStatus::Warn,
            "This Space is your own computer, so runs there are not isolated.",
        ));
    } else {
        report
            .checks
            .push(check(CheckId::Space, CheckStatus::Pass, found.os.clone()));
    }
    let result = host
        .mcp_call(
            &server,
            "space_bash",
            json!({"space": found.id, "command": test_script(false), "timeout": 60}),
            TEST_TIMEOUT + Duration::from_secs(30),
        )
        .await
        .map_err(RunError::Network)
        .and_then(|result| parse_bash(&result));
    match result {
        Ok(bash) => report.checks.extend(
            parse_test_output(&bash.stdout)
                .into_iter()
                .filter(|item| item.id != CheckId::Rsync),
        ),
        Err(error) => {
            report
                .checks
                .push(check(CheckId::Echo, CheckStatus::Fail, error.to_string()))
        }
    }
    found.relay
}

/// Tests a target and records the result in `compute.json`.
pub async fn test_target(
    host: &dyn ComputeHost,
    target: &ComputeTarget,
    cancel: &CancellationToken,
) -> ComputeTestReport {
    let mut report = ComputeTestReport {
        target_id: target.id().to_string(),
        checks: Vec::new(),
        host_key: None,
        resolved: None,
        finished_at: 0,
        error: None,
    };
    let mut relay = false;
    match target {
        ComputeTarget::Ssh {
            host: name,
            user,
            port,
            ..
        } => {
            let endpoint = SshEndpoint {
                host: name.clone(),
                user: user.clone(),
                port: *port,
            };
            test_ssh(host, endpoint, false, cancel, &mut report).await;
        }
        ComputeTarget::Slurm {
            host: name,
            user,
            port,
            ..
        } => {
            let endpoint = SshEndpoint {
                host: name.clone(),
                user: user.clone(),
                port: *port,
            };
            test_ssh(host, endpoint, true, cancel, &mut report).await;
        }
        ComputeTarget::CuaSpace {
            space, per_task, ..
        } => {
            relay = test_cua(host, space, *per_task, &mut report).await;
        }
    }
    report.finished_at = now_ms();
    let ok = report.error.is_none()
        && !report
            .checks
            .iter()
            .any(|item| item.status == CheckStatus::Fail);
    let summary = TestSummary {
        at: report.finished_at,
        ok,
        resolved: report.resolved.clone(),
        relay,
    };
    let id = report.target_id.clone();
    let _ = settings::update(&host.data_root(), move |saved| {
        if settings::find(saved, &id).is_some() {
            saved.tested.insert(id, summary);
        }
        Ok(())
    });
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status_of(checks: &[ComputeCheck], id: CheckId) -> CheckStatus {
        checks
            .iter()
            .find(|item| item.id == id)
            .map(|item| item.status)
            .unwrap()
    }

    #[test]
    fn parse_test_output_statuses() {
        let checks = parse_test_output(
            "OLEAFLY_CHECK disk 1048576\nOLEAFLY_CHECK python 3.12.4\nOLEAFLY_CHECK gpu NVIDIA A100 80GB, 81920, 550.54\nOLEAFLY_CHECK rsync missing\nOLEAFLY_CHECK slurm missing\n",
        );
        assert_eq!(status_of(&checks, CheckId::Disk), CheckStatus::Warn);
        assert_eq!(status_of(&checks, CheckId::Python), CheckStatus::Pass);
        let gpu = checks.iter().find(|item| item.id == CheckId::Gpu).unwrap();
        assert_eq!(
            (gpu.status, gpu.detail.as_str()),
            (CheckStatus::Pass, "NVIDIA A100 80GB")
        );
        assert_eq!(status_of(&checks, CheckId::Rsync), CheckStatus::Warn);
        assert_eq!(status_of(&checks, CheckId::Slurm), CheckStatus::Fail);
        let checks = parse_test_output("OLEAFLY_CHECK python missing\nOLEAFLY_CHECK gpu none\n");
        assert_eq!(status_of(&checks, CheckId::Python), CheckStatus::Warn);
        assert_eq!(status_of(&checks, CheckId::Gpu), CheckStatus::Skipped);
    }

    #[test]
    fn macos_python_stub_counts_as_missing() {
        let checks = parse_test_output(
            "OLEAFLY_CHECK python xcode-select: note: No developer tools were found\n",
        );
        assert_eq!(status_of(&checks, CheckId::Python), CheckStatus::Warn);
    }

    #[test]
    fn ssh_g_resolves_display_target() {
        assert_eq!(
            parse_ssh_g("user jdoe\nhostname cluster.example.edu\nport 22\n").as_deref(),
            Some("jdoe@cluster.example.edu:22")
        );
    }

    #[cfg(unix)]
    mod fake {
        use super::*;
        use crate::runs::remote::testing::{write_script, FakeCompute};
        use std::collections::BTreeMap;
        use std::path::Path;
        use std::sync::Arc;

        fn host_with(dir: &Path, strict_error: &str) -> Arc<dyn ComputeHost> {
            let program = dir.join("ssh");
            write_script(
                &program,
                &format!(
                    r#"#!/bin/sh
if [ "$1" = "-G" ]; then printf 'user jdoe\nhostname h.example.edu\nport 22\n'; exit 0; fi
probe=0
for a in "$@"; do
  case "$a" in
    StrictHostKeyChecking=accept-new) probe=1;;
    UserKnownHostsFile=*) f="${{a#UserKnownHostsFile=}}";;
  esac
done
if [ "$probe" = 1 ]; then
  f=$(printf %s "$f" | sed 's/^"//; s/"$//')
  echo "h ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO5iNlYpT42j+Y7KWV6rcQPDAz8RIwdxSau3SX19xb4V" >> "$f"
  echo "jdoe@h: Permission denied (publickey)." >&2
  exit 255
fi
printf '%s\n' '{strict_error}' >&2
exit 255
"#
                ),
            );
            Arc::new(FakeCompute {
                data_root: dir.join("data"),
                programs: BTreeMap::from([("ssh".to_string(), program)]),
                spaces: None,
            })
        }

        fn target() -> ComputeTarget {
            ComputeTarget::Ssh {
                id: "t-a".into(),
                label: "Lab".into(),
                host: "h".into(),
                user: None,
                port: None,
                remote_root: None,
                prelude: String::new(),
            }
        }

        #[tokio::test]
        async fn unknown_host_key_returns_a_prompt() {
            let dir = tempfile::tempdir().unwrap();
            let host = host_with(
                dir.path(),
                "No ED25519 host key is known for h and you have requested strict checking.",
            );
            let report = test_target(&*host, &target(), &CancellationToken::new()).await;
            let prompt = report.host_key.unwrap();
            assert_eq!(prompt.keys.len(), 1);
            assert!(!prompt.changed);
            assert_eq!(
                status_of(&report.checks, CheckId::Connect),
                CheckStatus::Fail
            );
            assert_eq!(report.resolved.as_deref(), Some("jdoe@h.example.edu:22"));
        }

        #[tokio::test]
        async fn changed_host_key_returns_changed_without_probe() {
            let dir = tempfile::tempdir().unwrap();
            let host = host_with(
                dir.path(),
                "@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @",
            );
            let report = test_target(&*host, &target(), &CancellationToken::new()).await;
            let prompt = report.host_key.unwrap();
            assert!(prompt.changed && prompt.keys.is_empty());
            assert!(!dir.path().join("data/research/known_hosts").exists());
        }
    }
}
