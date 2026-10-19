//! The research MCP bridge: a loopback HTTP server, scoped to one project
//! folder (or a task's isolated copy), that CLI agents and research tasks use
//! for files, linked folders, literature lookups and skills.
mod files;
pub mod protocol;
mod stdio;
mod tools;
mod transport;

use std::path::PathBuf;
use std::sync::{atomic::AtomicBool, Arc};

use serde_json::Value;
use tokio::sync::{watch, Mutex, Semaphore};
use zeroize::Zeroizing;

use crate::builtin::TaskBridge;
use crate::host::ConnectorSecrets;
use crate::scheduler::TaskRuntimeFuture;
use crate::task_tools::extra::TaskBinding;

pub use stdio::{serve_stdio_bridge, stdio_bridge_requested, stdio_server, STDIO_FLAG};
pub use tools::tool_definitions;

/// A linked research folder granted to the session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkedRootInfo {
    pub id: String,
    pub label: String,
    pub role: String,
    pub canonical_path: String,
}

/// Installed skills, as the bridge's skill tools report them.
pub trait SkillSource: Send + Sync {
    /// `list_skills` rows for the valid skills.
    fn list(&self, project_id: &str) -> Result<Vec<Value>, String>;
    /// The payload of an enabled skill, or the "turned off" error.
    fn load(&self, project_id: &str, id: &str) -> Result<Value, String>;
    /// `{path, content, truncated}` for a support file of an enabled skill.
    fn read_file(&self, project_id: &str, id: &str, path: &str) -> Result<Value, String>;
}

/// Resolves a linked folder's current path for a read.
pub trait LinkedRoots: Send + Sync {
    fn resolve(&self, project_id: &str, root_id: &str) -> Result<PathBuf, String>;
}

/// The host services a bridge uses.
#[derive(Clone)]
pub struct BridgeServices {
    pub skills: Arc<dyn SkillSource>,
    pub linked: Arc<dyn LinkedRoots>,
    pub secrets: Arc<dyn ConnectorSecrets>,
}

/// Everything needed to start a bridge.
pub struct McpStart {
    pub project_id: String,
    /// The folder the session's file tools read (the project or a task copy).
    pub root: PathBuf,
    /// Restrict the file tools to these project-relative paths.
    pub allowed: Option<Vec<String>>,
    pub linked_roots: Vec<LinkedRootInfo>,
    pub services: BridgeServices,
    /// A research task's runs, record and literature tools, for a CLI agent
    /// working on that task.
    pub task: Option<TaskBinding>,
}

pub async fn serve(start: McpStart) -> Result<ScopedResearchMcp, String> {
    let files = files::FileScope::open(&start.root, start.allowed)?;
    transport::serve(
        start.project_id,
        files,
        start.linked_roots,
        start.services,
        start.task,
    )
    .await
}

pub struct ScopedResearchMcp {
    context: Arc<Context>,
    url: String,
    shutdown: watch::Sender<bool>,
    server: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

struct Context {
    project_id: String,
    files: files::FileScope,
    linked_roots: Vec<LinkedRootInfo>,
    services: BridgeServices,
    task: Option<TaskBinding>,
    token: Zeroizing<String>,
    authority: String,
    closed: Arc<AtomicBool>,
    shutdown: watch::Receiver<bool>,
    slots: Semaphore,
    requests: Semaphore,
}

impl ScopedResearchMcp {
    pub fn mcp_server(&self) -> Value {
        serde_json::json!({
            "type": "http",
            "name": "oleafly-research",
            "url": self.url,
            "headers": [{
                "name": "Authorization",
                "value": format!("Bearer {}", self.context.token.as_str()),
            }],
        })
    }

    pub async fn call_tool(&self, name: &str, arguments: &Value) -> Result<Value, String> {
        transport::call(&self.context, name, arguments).await
    }

    pub async fn shutdown(&self) {
        self.close();
        if let Some(mut server) = self.server.lock().await.take() {
            if tokio::time::timeout(std::time::Duration::from_secs(2), &mut server)
                .await
                .is_err()
            {
                server.abort();
                let _ = server.await;
            }
        }
    }

    fn close(&self) {
        self.context
            .closed
            .store(true, std::sync::atomic::Ordering::Release);
        self.context.slots.close();
        self.context.requests.close();
        let _ = self.shutdown.send(true);
    }
}

impl Drop for ScopedResearchMcp {
    fn drop(&mut self) {
        self.close();
    }
}

impl TaskBridge for ScopedResearchMcp {
    fn mcp_server(&self) -> Value {
        ScopedResearchMcp::mcp_server(self)
    }

    fn call_tool(self: Arc<Self>, name: String, args: Value) -> TaskRuntimeFuture<Value> {
        Box::pin(async move { ScopedResearchMcp::call_tool(&self, &name, &args).await })
    }

    fn shutdown(
        self: Arc<Self>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
        Box::pin(async move { ScopedResearchMcp::shutdown(&self).await })
    }
}

#[cfg(test)]
mod tests;
