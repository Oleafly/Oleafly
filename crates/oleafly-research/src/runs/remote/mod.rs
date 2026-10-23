//! Runs on another computer: an SSH host, a Slurm cluster or a Cua Space,
//! configured in Settings › Research › Compute (`compute.json`). The
//! executors keep all their state in the run's `handle.json` and in the
//! remote run folder, so the app or the daemon can pick a run up again
//! after a restart.
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde_json::Value;

use super::{RunError, RunHandle, RunManager, HANDLE_VERSION};

pub mod archive;
pub mod cua_space;
pub mod host_keys;
pub(crate) mod mirror;
pub mod rsync;
pub mod scripts;
pub mod settings;
pub mod slurm;
pub mod ssh;
pub mod target_test;
#[cfg(test)]
pub(crate) mod testing;
pub mod transport;

/// How often a remote run is checked. Every check is a login to the host
/// (and a query to the scheduler), which clusters rate-limit.
#[cfg(not(test))]
pub(crate) const REMOTE_POLL_EVERY: Duration = Duration::from_secs(15);
#[cfg(test)]
pub(crate) const REMOTE_POLL_EVERY: Duration = Duration::from_millis(200);

/// An MCP server started over stdio for one call (the `cua` daemon).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpStdioServer {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}

/// What remote executors need from whoever hosts them.
#[async_trait::async_trait]
pub trait ComputeHost: Send + Sync {
    /// Oleafly's data folder (`compute.json` and the known hosts live in
    /// its `research/` folder).
    fn data_root(&self) -> PathBuf;
    fn locate_program(&self, name: &str) -> Option<PathBuf> {
        path_search(name)
    }
    /// One MCP tool call. Hosts without an MCP client refuse.
    async fn mcp_call(
        &self,
        _server: &McpStdioServer,
        _tool: &str,
        _arguments: Value,
        _timeout: Duration,
    ) -> Result<Value, String> {
        Err("Runs on Cua Spaces need the Oleafly app open.".into())
    }
}

/// A host that finds programs on `PATH` and has no MCP client (the daemon).
pub struct PathComputeHost {
    data_root: PathBuf,
}

impl PathComputeHost {
    pub fn new(data_root: PathBuf) -> Self {
        Self { data_root }
    }
}

#[async_trait::async_trait]
impl ComputeHost for PathComputeHost {
    fn data_root(&self) -> PathBuf {
        self.data_root.clone()
    }
}

/// `name` from `PATH` (with `.exe` on Windows).
pub fn path_search(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let names: Vec<String> = if cfg!(windows) && !name.contains('.') {
        vec![format!("{name}.exe"), name.to_string()]
    } else {
        vec![name.to_string()]
    };
    std::env::split_paths(&path)
        .flat_map(|folder| names.iter().map(move |name| folder.join(name)))
        .find(|candidate| candidate.is_file())
}

/// Adds the SSH, Slurm and Cua Space executors next to the local one.
pub fn register(runs: &RunManager, host: Arc<dyn ComputeHost>) {
    runs.register_executor(Arc::new(ssh::SshExecutor::new(host.clone())));
    runs.register_executor(Arc::new(slurm::SlurmExecutor::new(host.clone())));
    runs.register_executor(Arc::new(cua_space::CuaSpaceExecutor::new(host)));
}

/// The executor-specific part of a stored handle.
pub(crate) fn handle_data<T: DeserializeOwned>(handle: &RunHandle) -> Result<T, RunError> {
    if handle.version > HANDLE_VERSION {
        return Err(RunError::Config(
            "A newer version of Oleafly started this run. Update Oleafly to follow it.".into(),
        ));
    }
    serde_json::from_value(handle.data.clone())
        .map_err(|_| RunError::Config("The run's saved state is unreadable.".into()))
}

/// Where a remote run's outputs land in the task workspace.
pub fn outputs_folder(run_id: &str) -> String {
    format!("runs/{run_id}/outputs")
}
