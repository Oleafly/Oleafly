use std::sync::{Arc, Mutex};

use oleafly_agent::{AgentEvent, CancellationToken};
use tauri::Manager;

use super::subagents::RunContext;

pub(super) struct AcpChild {
    runtime: Arc<crate::acp::AcpRuntime>,
    app: tauri::AppHandle,
    project_id: String,
    project_path: std::path::PathBuf,
    parent_session_id: String,
    owner: String,
    pub agent_id: String,
    pub model_id: Option<String>,
    session_id: Mutex<Option<String>>,
    bridge: Mutex<Option<crate::research_mcp::ScopedResearchMcp>>,
}

impl AcpChild {
    pub fn new(
        ctx: &RunContext,
        agent_id: String,
        model_id: Option<String>,
        owner: String,
    ) -> Result<Self, String> {
        let app = ctx
            .app
            .as_ref()
            .ok_or("The native agent runtime is unavailable.")?
            .clone();
        let runtime = app
            .try_state::<Arc<crate::acp::AcpRuntime>>()
            .ok_or("The ACP runtime is unavailable.")?
            .inner()
            .clone();
        let project_path = crate::paths::project_dir(&ctx.project_id)?
            .canonicalize()
            .map_err(|_| "The research project is no longer available.")?;
        Ok(Self {
            runtime,
            app,
            project_id: ctx.project_id.clone(),
            project_path,
            parent_session_id: ctx.session_id.clone(),
            owner,
            agent_id,
            model_id,
            session_id: Mutex::new(None),
            bridge: Mutex::new(None),
        })
    }

    pub fn session_id(&self) -> Option<String> {
        super::lock_or_recover(&self.session_id).clone()
    }

    pub fn selected_model(&self) -> Option<String> {
        self.session_id()
            .and_then(|id| self.runtime.record(&id).ok())
            .and_then(|record| record.controls.model_id)
            .or_else(|| self.model_id.clone())
    }

    async fn connect(&self) -> Result<String, String> {
        let bridge = crate::research_mcp::start(
            self.app.clone(),
            self.project_id.clone(),
            Some(self.project_path.clone()),
        )
        .await?;
        let servers = vec![bridge.mcp_server()];
        *super::lock_or_recover(&self.bridge) = Some(bridge);
        let existing = self.session_id();
        let snapshot = if let Some(id) = existing {
            self.runtime
                .reconnect_with_mcp(&id, Some(self.owner.clone()), servers)
                .await?
        } else {
            self.runtime
                .start_with_mcp(
                    crate::acp::StartSession {
                        project_id: self.project_id.clone(),
                        project_path: self.project_path.clone(),
                        agent_id: self.agent_id.clone(),
                        parent_session_id: Some(self.parent_session_id.clone()),
                        task_id: None,
                        owner: Some(self.owner.clone()),
                        allowed_paths: None,
                    },
                    servers,
                )
                .await?
        };
        *super::lock_or_recover(&self.session_id) = Some(snapshot.session.id.clone());
        if let Some(model) = &self.model_id {
            self.runtime.set_model(&snapshot.session.id, model).await?;
        }
        Ok(snapshot.session.id)
    }

    async fn ready_session(&self) -> Result<String, String> {
        if super::lock_or_recover(&self.bridge).is_some() {
            if let Some(id) = self.session_id() {
                return Ok(id);
            }
        }
        self.connect().await
    }

    pub async fn run(
        &self,
        prompt: String,
        token: &CancellationToken,
        sink: &super::subagents::ActivitySink,
        id: &str,
        label: &str,
    ) -> Result<String, String> {
        let result = tokio::select! {
            biased;
            _ = token.cancelled() => Err("The agent was interrupted.".into()),
            result = self.run_connected(prompt, sink, id, label) => result,
        };
        if result.is_err() || token.is_cancelled() {
            self.close().await;
        }
        result
    }

    async fn run_connected(
        &self,
        prompt: String,
        sink: &super::subagents::ActivitySink,
        id: &str,
        label: &str,
    ) -> Result<String, String> {
        let session_id = self.ready_session().await?;
        let _ = sink.send(self.activity(id, label, "started", None));
        let before = self
            .runtime
            .snapshot(&session_id)
            .await?
            .session
            .last_sequence;
        let mut events = self.runtime.subscribe();
        let run = self.runtime.prompt(&session_id, prompt, Vec::new());
        tokio::pin!(run);
        loop {
            tokio::select! {
                result = &mut run => { result?; break; }
                event = events.recv() => {
                    if let Ok(event) = event {
                        if event.session_id == session_id {
                            let (state, detail) = match event.kind.as_str() {
                                "agent_message_chunk" => ("thinking", event_text(&event.data).map(|text| super::subagents::bounded_output(text, 240))),
                                "agent_thought_chunk" => ("thinking", None),
                                "tool_call" | "tool_call_update" => ("tool", event.data["title"].as_str().map(str::to_owned)),
                                "permission" => ("tool", Some("Waiting for permission".into())),
                                _ => continue,
                            };
                            let _ = sink.send(self.activity(id, label, state, detail));
                        }
                    }
                }
            }
        }
        completed_turn_output(&self.runtime, &session_id, before)
    }

    fn activity(&self, id: &str, label: &str, state: &str, detail: Option<String>) -> AgentEvent {
        AgentEvent::SubagentUpdate {
            id: id.into(),
            label: label.into(),
            state: state.into(),
            detail,
            runtime: Some("acp".into()),
            session_id: self.session_id(),
            provider_id: None,
            model_id: self.selected_model(),
            agent_id: Some(self.agent_id.clone()),
        }
    }

    pub async fn close(&self) {
        self.runtime.close_owner(&self.owner).await;
        let bridge = super::lock_or_recover(&self.bridge).take();
        if let Some(bridge) = bridge {
            bridge.shutdown().await;
        }
    }
}

fn event_text(data: &serde_json::Value) -> Option<&str> {
    data["text"]
        .as_str()
        .or_else(|| data["content"]["text"].as_str())
}

fn completed_turn_output(
    runtime: &crate::acp::AcpRuntime,
    session_id: &str,
    before: u64,
) -> Result<String, String> {
    let mut cursor = before;
    let mut output = String::new();
    let mut stop_reason = None;
    loop {
        let page = runtime.events(session_id, cursor, 500)?;
        for event in page.events {
            cursor = cursor.max(event.sequence);
            match event.kind.as_str() {
                "agent_message_chunk" => {
                    if let Some(text) = event_text(&event.data) {
                        output.push_str(text);
                    }
                }
                "turn_complete" => {
                    stop_reason = event.data["stopReason"].as_str().map(str::to_owned);
                }
                _ => {}
            }
        }
        if !page.has_more {
            break;
        }
    }
    if stop_reason.as_deref() != Some("end_turn") {
        let reason = super::subagents::bounded_output(
            stop_reason.as_deref().unwrap_or("no completion event"),
            80,
        );
        return Err(format!(
            "The agent stopped before completing this turn ({reason})."
        ));
    }
    Ok(output)
}

impl Drop for AcpChild {
    fn drop(&mut self) {
        let runtime = self.runtime.clone();
        let owner = self.owner.clone();
        let bridge = self
            .bridge
            .get_mut()
            .unwrap_or_else(|error| error.into_inner())
            .take();
        tauri::async_runtime::spawn(async move {
            runtime.close_owner(&owner).await;
            if let Some(bridge) = bridge {
                bridge.shutdown().await;
            }
        });
    }
}

#[cfg(test)]
mod tests;
