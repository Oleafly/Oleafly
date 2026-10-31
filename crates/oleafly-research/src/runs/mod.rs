use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::model::Resources;
use crate::RunProfile;

pub mod local;
pub mod log;
pub mod manager;
pub mod metrics;
pub mod remote;
pub mod supervisor;
#[cfg(test)]
mod tests;

pub use local::{supervisor_creation_flags, LocalExecutor, SupervisorCommand};
pub use manager::{RunCompletion, RunManager, RunSummary, StartRun, WaitOutcome};
pub use metrics::{parse_metrics_line, MetricsSummary};

#[cfg(not(test))]
pub const POLL_EVERY: Duration = Duration::from_secs(2);
#[cfg(test)]
pub const POLL_EVERY: Duration = Duration::from_millis(100);
pub const MAX_RUN_LOG_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_METRIC_LINES: usize = 10_000;
pub const MAX_IN_FLIGHT_RUNS: usize = 4;
pub const WAIT_DEFAULT: Duration = Duration::from_secs(120);
pub const WAIT_MAX: Duration = Duration::from_secs(300);
pub const MAX_RUN_COMMAND_BYTES: usize = 16 * 1024;
const MAX_RUN_ENV: usize = 32;
const MAX_RUN_ENV_VALUE: usize = 4 * 1024;
pub const HANDLE_VERSION: u32 = 1;

#[async_trait::async_trait]
pub trait RunExecutor: Send + Sync {
    fn id(&self) -> &'static str;
    async fn start(&self, spec: &RunSpec) -> Result<RunHandle, RunError>;
    async fn poll(&self, handle: &RunHandle) -> Result<RunStatus, RunError>;
    async fn read_log(&self, handle: &RunHandle, query: LogQuery) -> Result<String, RunError>;
    async fn cancel(&self, handle: &RunHandle) -> Result<(), RunError>;
    async fn cleanup(&self, _handle: &RunHandle) -> Result<(), RunError> {
        Ok(())
    }
    async fn discard(&self, handle: &RunHandle) -> Result<(), RunError> {
        self.cleanup(handle).await
    }
    fn poll_every(&self) -> Duration {
        POLL_EVERY
    }
}

mod secs {
    use serde::{Deserialize, Deserializer, Serializer};
    use std::time::Duration;

    pub fn serialize<S: Serializer>(value: &Duration, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_u64(value.as_secs())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Duration, D::Error> {
        u64::deserialize(deserializer).map(Duration::from_secs)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunSpec {
    pub task_id: String,
    pub run_id: String,
    pub command: String,
    pub cwd_rel: String,
    pub env: BTreeMap<String, String>,
    #[serde(with = "secs")]
    pub timeout: Duration,
    pub profile: RunProfile,
    pub workspace: PathBuf,
    pub resources: Option<Resources>,
    pub target: Option<String>,
    pub run_dir: PathBuf,
    pub network: bool,
    pub sandbox: Option<oleafly_sandbox::SandboxSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunHandle {
    pub version: u32,
    pub executor: String,
    pub task_id: String,
    pub run_id: String,
    pub run_dir: PathBuf,
    pub started_at: i64,
    pub data: serde_json::Value,
}

impl RunHandle {
    pub fn parse(json: &str) -> Result<Self, String> {
        let handle: Self = serde_json::from_str(json)
            .map_err(|_| "The run's saved state is unreadable.".to_string())?;
        if handle.version > HANDLE_VERSION {
            return Err(
                "A newer version of Oleafly started this run. Update Oleafly to follow it.".into(),
            );
        }
        Ok(handle)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunOutcomeKind {
    Succeeded,
    Failed,
    TimedOut,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "state",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum RunStatus {
    Starting,
    Queued {
        reason: String,
    },
    Running {
        started_at: i64,
        #[serde(default)]
        note: Option<String>,
    },
    Finished {
        exit_code: Option<i32>,
        finished_at: i64,
        outcome: RunOutcomeKind,
        #[serde(default)]
        note: Option<String>,
    },
    Lost {
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum LogQuery {
    Tail { lines: usize },
    Grep { pattern: String, max_matches: usize },
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RunError {
    #[error("{0}")]
    Config(String),
    #[error("{0}")]
    Unavailable(String),
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    HostKeyUnknown(String),
    #[error("{0}")]
    HostKeyChanged(String),
    #[error("{0}")]
    Auth(String),
    #[error("{0}")]
    Network(String),
    #[error("{0}")]
    Remote(String),
    #[error("{0}")]
    Io(String),
    #[error("The run was cancelled.")]
    Cancelled,
}

impl From<RunError> for String {
    fn from(error: RunError) -> Self {
        error.to_string()
    }
}

pub fn validate_cwd_rel(value: &str) -> Result<String, String> {
    const MESSAGE: &str = "Use a folder inside the task workspace, written with forward slashes.";
    let value = value.trim();
    if value.is_empty() || value == "." {
        return Ok(String::new());
    }
    if value.contains(['\\', '\0', ':']) || value.starts_with('/') {
        return Err(MESSAGE.into());
    }
    let parts: Vec<&str> = value.trim_end_matches('/').split('/').collect();
    if parts
        .iter()
        .any(|part| part.is_empty() || *part == "." || *part == "..")
    {
        return Err(MESSAGE.into());
    }
    Ok(parts.join("/"))
}

fn valid_env_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && name.len() <= 64
        && chars.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

pub fn validate_run_env(env: &BTreeMap<String, String>) -> Result<(), String> {
    if env.len() > MAX_RUN_ENV {
        return Err("A run can set at most 32 environment variables.".into());
    }
    for (name, value) in env {
        if !valid_env_name(name) {
            return Err(format!("{name} isn't a valid environment variable name."));
        }
        let upper = name.to_ascii_uppercase();
        if oleafly_sandbox::RESERVED_ENV
            .iter()
            .any(|reserved| *reserved == upper)
            || upper.starts_with("LD_")
            || upper.starts_with("DYLD_")
        {
            return Err(format!("The task cannot change {name}."));
        }
        if value.len() > MAX_RUN_ENV_VALUE || value.contains('\0') {
            return Err(format!("The value of {name} is too long."));
        }
    }
    Ok(())
}

pub fn next_run_id(existing: usize) -> String {
    format!("r{:03}", existing + 1)
}
