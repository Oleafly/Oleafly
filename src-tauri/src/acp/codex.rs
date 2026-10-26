use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::catalog;
use super::preferences::AgentPreferences;
use super::runtime::{AcpRuntime, LiveSession};

const CHECK_LIMIT: Duration = Duration::from_secs(2);
const CHECK_ARGS: [&str; 3] = ["cli", "features", "list"];
const CONFIG_LIMIT: u64 = 256 * 1024;
const MAX_ERROR: usize = 2000;
const MAX_NAME: usize = 64;
const SYSTEM_ERROR: &str = "Codex stopped this turn with an error.";

#[derive(Clone, Debug)]
pub(super) struct ConfigCheck {
    pub(super) program: PathBuf,
    pub(super) args: Vec<OsString>,
    pub(super) env: Vec<(OsString, Option<OsString>)>,
    pub(super) cwd: PathBuf,
    pub(super) batch: bool,
}

impl ConfigCheck {
    pub(super) fn new(command: &std::process::Command, cwd: &Path, batch: bool) -> Self {
        Self {
            program: PathBuf::from(command.get_program()),
            args: command.get_args().map(OsStr::to_os_string).collect(),
            env: command
                .get_envs()
                .map(|(name, value)| (name.to_os_string(), value.map(OsStr::to_os_string)))
                .collect(),
            cwd: cwd.to_path_buf(),
            batch,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ConfigProvider {
    pub(super) name: String,
    pub(super) env_key: Option<String>,
}

pub(super) async fn check_failure(check: &ConfigCheck) -> Option<String> {
    if check.batch
        && crate::program_locator::script_launch_check(&check.program, &check.cwd).is_err()
    {
        return None;
    }
    let mut command = tokio::process::Command::new(&check.program);
    command
        .args(&check.args)
        .args(CHECK_ARGS)
        .current_dir(&check.cwd);
    for (name, value) in &check.env {
        match value {
            Some(value) => command.env(name, value),
            None => command.env_remove(name),
        };
    }
    catalog::failure_output(command, CHECK_LIMIT).await
}

pub(super) fn config_path(
    env: &dyn Fn(&str) -> Option<OsString>,
    home: Option<&Path>,
) -> Option<PathBuf> {
    let folder = env("CODEX_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| home.map(|home| home.join(".codex")))?;
    Some(folder.join("config.toml"))
}

fn clean(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control())
        .take(MAX_NAME)
        .collect::<String>()
        .trim()
        .to_owned()
}

fn env_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub(super) fn config_provider(path: &Path) -> Option<ConfigProvider> {
    let file = std::fs::File::open(path).ok()?;
    if !file.metadata().ok()?.is_file() {
        return None;
    }
    let mut text = String::new();
    file.take(CONFIG_LIMIT + 1).read_to_string(&mut text).ok()?;
    if text.len() as u64 > CONFIG_LIMIT {
        return None;
    }
    let config: toml::Value = toml::from_str(&text).ok()?;
    let profile = config
        .get("profile")
        .and_then(toml::Value::as_str)
        .and_then(|name| config.get("profiles")?.get(name));
    let id = profile
        .and_then(|profile| profile.get("model_provider"))
        .or_else(|| config.get("model_provider"))
        .and_then(toml::Value::as_str)
        .map(clean)
        .filter(|id| !id.is_empty() && id != "openai")?;
    let entry = config
        .get("model_providers")
        .and_then(|providers| providers.get(id.as_str()));
    let name = entry
        .and_then(|entry| entry.get("name"))
        .and_then(toml::Value::as_str)
        .map(clean)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| id.clone());
    let env_key = entry
        .and_then(|entry| entry.get("env_key"))
        .and_then(toml::Value::as_str)
        .filter(|key| env_name(key))
        .map(str::to_owned);
    Some(ConfigProvider { name, env_key })
}

pub(super) fn sign_in_reason(
    failure: Option<String>,
    routed: Option<String>,
    provider: Option<ConfigProvider>,
) -> Option<String> {
    if let Some(lines) = failure {
        return Some(format!("Codex reported a problem with its setup:\n{lines}"));
    }
    if let Some(label) = routed {
        return Some(format!("Your {label} key was rejected."));
    }
    let provider = provider?;
    Some(match provider.env_key {
        Some(key) => format!(
            "Codex uses the {} provider from its config.toml. Check that {key} is set and valid, then reconnect.",
            provider.name
        ),
        None => format!(
            "Codex uses the {} provider from its config.toml. Check its settings, then reconnect.",
            provider.name
        ),
    })
}

pub(super) fn system_error_message(text: &str) -> String {
    let text = text.trim();
    let unwrapped = serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|body| {
            [&body["error"]["message"], &body["error"], &body["message"]]
                .into_iter()
                .find_map(serde_json::Value::as_str)
                .map(str::to_owned)
        });
    let message: String = unwrapped
        .as_deref()
        .unwrap_or(text)
        .chars()
        .filter(|c| *c == '\n' || !c.is_control())
        .take(MAX_ERROR)
        .collect();
    let message = message.trim();
    if message.is_empty() {
        SYSTEM_ERROR.to_owned()
    } else {
        message.to_owned()
    }
}

pub(super) fn initial_mode(prefs: &AgentPreferences) -> Option<(String, OsString)> {
    let mode = prefs.mode.as_ref()?;
    let plain = !mode.value.is_empty()
        && mode.value.len() <= MAX_NAME
        && mode
            .value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    if !plain || oleafly_acp::controls::is_bypass_choice(&mode.value, &mode.name) {
        return None;
    }
    Some(("INITIAL_AGENT_MODE".to_owned(), OsString::from(&mode.value)))
}

impl AcpRuntime {
    pub(super) async fn codex_sign_in_reason(&self, session: &LiveSession) -> Option<String> {
        let check = session.codex_check.as_ref()?;
        let routed = self.copy_record(session).ok()?.routed_provider;
        let failure = check_failure(check).await;
        let env = check.env.clone();
        let reason = tokio::task::spawn_blocking(move || {
            let routed = routed.map(|provider| super::providers::provider_label(&provider));
            let provider = if failure.is_none() && routed.is_none() {
                let host = crate::program_locator::host_env();
                let lookup =
                    |name: &str| match env.iter().rev().find(|(key, _)| key.as_os_str() == name) {
                        Some((_, value)) => value.clone(),
                        None => host(name),
                    };
                config_path(&lookup, crate::paths::home_dir().ok().as_deref())
                    .and_then(|path| config_provider(&path))
            } else {
                None
            };
            sign_in_reason(failure, routed, provider)
        })
        .await
        .ok()
        .flatten()?;
        Some(session.redactor.text(&reason))
    }
}

#[cfg(test)]
#[path = "tests/codex.rs"]
mod tests;
