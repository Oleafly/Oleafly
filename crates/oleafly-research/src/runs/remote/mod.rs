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

#[cfg(not(test))]
pub(crate) const REMOTE_POLL_EVERY: Duration = Duration::from_secs(15);
#[cfg(test)]
pub(crate) const REMOTE_POLL_EVERY: Duration = Duration::from_millis(200);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpStdioServer {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}

#[async_trait::async_trait]
pub trait ComputeHost: Send + Sync {
    fn data_root(&self) -> PathBuf;
    fn locate_program(&self, name: &str) -> Option<PathBuf> {
        path_search(name)
    }
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

pub fn register(runs: &RunManager, host: Arc<dyn ComputeHost>) {
    runs.register_executor(Arc::new(ssh::SshExecutor::new(host.clone())));
    runs.register_executor(Arc::new(slurm::SlurmExecutor::new(host.clone())));
    runs.register_executor(Arc::new(cua_space::CuaSpaceExecutor::new(host)));
}

pub(crate) fn handle_data<T: DeserializeOwned>(handle: &RunHandle) -> Result<T, RunError> {
    if handle.version > HANDLE_VERSION {
        return Err(RunError::Config(
            "A newer version of Oleafly started this run. Update Oleafly to follow it.".into(),
        ));
    }
    serde_json::from_value(handle.data.clone())
        .map_err(|_| RunError::Config("The run's saved state is unreadable.".into()))
}

pub fn outputs_folder(run_id: &str) -> String {
    format!("runs/{run_id}/outputs")
}
