mod files;
mod tools;
mod transport;

use std::path::PathBuf;
use std::sync::{atomic::AtomicBool, Arc};

use serde_json::Value;
use tokio::sync::{watch, Mutex, Semaphore};
use zeroize::Zeroizing;

pub use tools::tool_definitions;

pub struct ScopedResearchMcp {
    context: Arc<Context>,
    url: String,
    shutdown: watch::Sender<bool>,
    server: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

struct Context {
    project_id: String,
    files: files::FileScope,
    linked_roots: Vec<crate::research_workspace::LinkedResearchRoot>,
    skills_root: PathBuf,
    skills_pack: Option<PathBuf>,
    token: Zeroizing<String>,
    authority: String,
    closed: Arc<AtomicBool>,
    shutdown: watch::Receiver<bool>,
    slots: Semaphore,
    requests: Semaphore,
}

pub async fn start(
    app: tauri::AppHandle,
    project_id: String,
    execution_root: Option<PathBuf>,
) -> Result<ScopedResearchMcp, String> {
    start_inner(app, project_id, execution_root, None).await
}

pub async fn start_restricted(
    app: tauri::AppHandle,
    project_id: String,
    execution_root: PathBuf,
    allowed_paths: Vec<String>,
) -> Result<ScopedResearchMcp, String> {
    start_inner(app, project_id, Some(execution_root), Some(allowed_paths)).await
}

async fn start_inner(
    app: tauri::AppHandle,
    project_id: String,
    execution_root: Option<PathBuf>,
    allowed_paths: Option<Vec<String>>,
) -> Result<ScopedResearchMcp, String> {
    crate::paths::validate_project_id(&project_id)?;
    let project_root = crate::paths::project_dir(&project_id)?;
    if !project_root.is_dir() {
        return Err("The research project is no longer available.".into());
    }
    let root = execution_root.unwrap_or(project_root);
    let files = files::FileScope::open(&root, allowed_paths)?;
    let linked_roots = crate::research_workspace::get_research_workspace(project_id.clone())?.roots;
    transport::serve(
        project_id,
        files,
        linked_roots,
        crate::paths::oleafly_root()?,
        crate::skills_pack::pack_root(&app),
    )
    .await
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

#[cfg(test)]
mod tests;
