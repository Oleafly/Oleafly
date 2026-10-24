//! Desktop apps for attended research tasks: a decorator around the task's
//! research bridge. CLI-agent runs get the `oleafly-desktop-apps` server;
//! built-in runs get the `desktop_apps` tool. Grants last for the task, and
//! each generation has its own Cua session, ended when the bridge shuts down.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use oleafly_research::builtin::TaskBridge;
use oleafly_research::scheduler::TaskRuntimeFuture;
use serde_json::Value;

use super::bridge::CuaBridge;
use super::config::ready;
use super::dispatch::{call_desktop_apps, project_denied};
use super::policy::tool_meta;
use super::{global, CuaDriverState, CuaScope, Surface, DESKTOP_APPS_TOOL};
use crate::mcp::protocol::ToolMeta;

pub(crate) struct DesktopAppsTaskBridge {
    inner: Arc<dyn TaskBridge>,
    cua: CuaBridge,
    state: Arc<CuaDriverState>,
}

impl DesktopAppsTaskBridge {
    /// `inner` plus desktop apps, or `inner` alone when they aren't ready.
    /// `title` names the task in its dialogs.
    pub(crate) async fn wrap(
        inner: Arc<dyn TaskBridge>,
        task_id: &str,
        generation: u64,
        project_id: &str,
        title: &str,
    ) -> Result<Arc<dyn TaskBridge>, String> {
        match global() {
            Some(state) => {
                Self::wrap_with(inner, state, task_id, generation, project_id, title).await
            }
            None => Ok(inner),
        }
    }

    pub(crate) async fn wrap_with(
        inner: Arc<dyn TaskBridge>,
        state: Arc<CuaDriverState>,
        task_id: &str,
        generation: u64,
        project_id: &str,
        title: &str,
    ) -> Result<Arc<dyn TaskBridge>, String> {
        if !ready(&state.settings()) || project_denied(&state, Some(project_id)) {
            return Ok(inner);
        }
        let title: String = title
            .chars()
            .filter(|character| !super::config::is_format_char(*character))
            .map(|character| {
                if character.is_control() {
                    ' '
                } else {
                    character
                }
            })
            .collect();
        let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
        let scope = CuaScope {
            grant_key: format!("task:{task_id}"),
            session_key: format!("task:{task_id}:{generation}"),
            project_id: Some(project_id.to_string()),
            agent_label: "Research task".into(),
            surface: Surface::Task,
            task_title: (!title.is_empty()).then(|| super::policy::bounded(&title, 120)),
        };
        let cua = CuaBridge::start_with(scope, state.clone()).await?;
        Ok(Arc::new(Self { inner, cua, state }))
    }
}

impl TaskBridge for DesktopAppsTaskBridge {
    fn mcp_server(&self) -> Value {
        self.inner.mcp_server()
    }

    fn mcp_servers(&self) -> Vec<Value> {
        let mut servers = self.inner.mcp_servers();
        servers.push(self.cua.mcp_server());
        servers
    }

    fn tool_definitions(&self) -> Vec<ToolMeta> {
        let mut tools = self.inner.tool_definitions();
        if !project_denied(&self.state, self.cua.scope().project_id.as_deref()) {
            tools.extend(tool_meta(&self.state.settings()));
        }
        tools
    }

    fn call_tool(self: Arc<Self>, name: String, args: Value) -> TaskRuntimeFuture<Value> {
        if name != DESKTOP_APPS_TOOL {
            return self.inner.clone().call_tool(name, args);
        }
        Box::pin(async move {
            let outcome = call_desktop_apps(&self.state, self.cua.scope(), args).await;
            Ok(outcome.mcp_result)
        })
    }

    fn shutdown(self: Arc<Self>) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(async move {
            self.cua.shutdown().await;
            self.inner.clone().shutdown().await;
        })
    }
}
