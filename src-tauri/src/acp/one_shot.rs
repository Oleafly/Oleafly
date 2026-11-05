use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use oleafly_acp::controls::{ConfigKind, ConfigOptionView, ConfigValue, SessionControls};
use oleafly_acp::limits::REQUEST_TIMEOUT;
use oleafly_acp::prompt::{prompt_blocks, ImagePrompt, PromptError, PromptParts};
use oleafly_acp::redact::Redactor;
use oleafly_acp::{AcpClient, ClientHost, IncomingRequest, Negotiated, NullHost, TurnTiming};
use oleafly_agent::{CompletionRequest, CompletionResponse, ContentPart, Role, Usage};
use serde_json::{json, Value};
use tokio::sync::watch;

use crate::program_locator::ProbeDir;

use super::catalog;
use super::failures::rpc_message;
use super::runtime::{add_login_secrets, client_options, AcpRuntime};
use super::setup::probe_command;
use super::types::AgentDefinition;

/// The model an agent picks for itself. Agents that list a model under this
/// id get that one; the others keep their own default.
const AGENT_DEFAULT_MODEL: &str = "default";
const IDLE_LIMIT: Duration = Duration::from_secs(90);
const TOTAL_LIMIT: Duration = Duration::from_secs(180);
const INITIALIZE_LIMIT: Duration = Duration::from_secs(30);
const MAX_REPLY: usize = 1 << 20;
const READ_ONLY_MODES: [&str; 4] = ["read-only", "readonly", "read_only", "plan"];
const LOW_EFFORTS: [&str; 4] = ["none", "off", "minimal", "low"];

/// One prompt to a CLI agent, outside any conversation, so the Tools can read
/// an image with the subscription the user already has.
pub(crate) struct OneShot {
    agent_id: String,
    model: String,
    system: Option<String>,
    text: String,
    images: Vec<ImagePrompt>,
    idle: Duration,
    total: Duration,
}

fn tagged(kind: &str, message: impl AsRef<str>) -> String {
    format!("[{kind}] {}", message.as_ref())
}

pub(super) fn image_prompt(url: &str) -> Option<ImagePrompt> {
    let (header, data) = url.strip_prefix("data:")?.split_once(',')?;
    let mime_type = header.strip_suffix(";base64")?;
    Some(ImagePrompt {
        mime_type: mime_type.to_owned(),
        data: data.to_owned(),
    })
}

impl OneShot {
    pub(crate) fn new(
        agent_id: &str,
        model: &str,
        request: &CompletionRequest,
    ) -> Result<Self, String> {
        let mut text = Vec::new();
        let mut images = Vec::new();
        for message in &request.messages {
            if message.role != Role::User {
                return Err(tagged("agent", "A CLI agent takes one message here."));
            }
            for part in &message.content {
                match part {
                    ContentPart::Text { text: part } => text.push(part.as_str()),
                    ContentPart::Image { image } => images.push(
                        image_prompt(image)
                            .ok_or_else(|| tagged("agent", PromptError::BadImage.message()))?,
                    ),
                    _ => return Err(tagged("agent", "A CLI agent takes text and images here.")),
                }
            }
        }
        Ok(Self {
            agent_id: agent_id.to_owned(),
            model: model.to_owned(),
            system: request.system.clone(),
            text: text.join("\n\n"),
            images,
            idle: request
                .idle_timeout_ms
                .map_or(IDLE_LIMIT, Duration::from_millis),
            total: request
                .timeout_ms
                .map_or(TOTAL_LIMIT, Duration::from_millis),
        })
    }
}

#[derive(Default)]
pub(super) struct Reply {
    text: String,
    marked: bool,
    system_error: Option<String>,
}

impl Reply {
    pub(super) fn push(&mut self, update: &Value, text: &str) {
        // Codex puts its own warnings ahead of the reply, as text with no
        // message id, and they must not end up in the user's document.
        if update["messageId"].is_string() && !self.marked {
            self.marked = true;
            self.text.clear();
        }
        let target = self.system_error.as_mut().unwrap_or(&mut self.text);
        if target.len() + text.len() <= MAX_REPLY {
            target.push_str(text);
        }
    }

    pub(super) fn text(self) -> String {
        self.text
    }
}

struct OneShotHost {
    reply: Mutex<Reply>,
    tool_started: watch::Sender<bool>,
}

impl OneShotHost {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            reply: Mutex::new(Reply::default()),
            tool_started: watch::channel(false).0,
        })
    }

    fn take(&self) -> Reply {
        self.reply
            .lock()
            .map(|mut reply| std::mem::take(&mut *reply))
            .unwrap_or_default()
    }
}

impl ClientHost for OneShotHost {
    fn on_update(&self, params: Value) {
        let update = &params["update"];
        match update["sessionUpdate"].as_str() {
            Some("agent_message_chunk") => {
                if let (Some(text), Ok(mut reply)) =
                    (super::coalesce::chunk_text(update), self.reply.lock())
                {
                    reply.push(update, text);
                }
            }
            Some("tool_call") => {
                self.tool_started.send_replace(true);
            }
            _ => {}
        }
        if update["_meta"]["codex"]["threadStatus"]["type"] == "systemError" {
            if let Ok(mut reply) = self.reply.lock() {
                reply.system_error.get_or_insert_with(String::new);
            }
        }
    }

    fn on_request(&self, request: IncomingRequest) {
        NullHost.on_request(request);
    }

    fn on_notification(&self, _method: &str, _params: Value) {}
    fn on_dropped_update(&self, _bytes: usize) {}
    fn on_disconnected(&self) {}
}

fn accepts_system_prompt(negotiated: &Negotiated) -> bool {
    negotiated.raw["agentCapabilities"]["sessionCapabilities"]["systemPrompt"].is_object()
}

/// Claude Code's options for a turn that only reads. `tools` turns off the
/// built-in tools alone: the user's MCP servers and hooks need their own
/// switches, or an image could reach them. A session with no title costs a
/// second model call to name it. The user's settings stay only when the login
/// is in them, and memory and skills are off otherwise.
pub(super) fn claude_options(login_in_settings: bool) -> Value {
    json!({
        "tools": [],
        "strictMcpConfig": true,
        "settings": {"disableAllHooks": true},
        "persistSession": false,
        "maxTurns": 1,
        "title": "Oleafly Tools",
        "settingSources": if login_in_settings { json!(["user"]) } else { json!([]) },
    })
}

fn new_session_params(
    definition: &AgentDefinition,
    request: &OneShot,
    negotiated: &Negotiated,
    cwd: &Path,
) -> Value {
    let mut params = json!({"cwd": cwd.to_string_lossy(), "mcpServers": []});
    if let Some(system) = request
        .system
        .as_ref()
        .filter(|_| accepts_system_prompt(negotiated))
    {
        params["systemPrompt"] =
            json!({"mode": "override", "content": [{"type": "text", "text": system}]});
    }
    if catalog::is_claude(definition) {
        let options = claude_options(catalog::claude_login_in_settings(definition));
        params["_meta"] = json!({"claudeCode": {"options": options}});
    }
    params
}

fn prompt_text(request: &OneShot, negotiated: &Negotiated) -> String {
    match &request.system {
        Some(system) if !accepts_system_prompt(negotiated) => {
            format!("{system}\n\n{}", request.text)
        }
        _ => request.text.clone(),
    }
}

async fn choose_model(
    client: &AcpClient,
    session: &str,
    controls: &mut SessionControls,
    model: &str,
) -> Result<(), String> {
    if !controls
        .models
        .iter()
        .any(|option| option.model_id == model)
    {
        return if model == AGENT_DEFAULT_MODEL {
            Ok(())
        } else {
            Err(tagged("agent_model", model))
        };
    }
    if controls.model_id.as_deref() == Some(model) {
        return Ok(());
    }
    let changed = match controls.model_config_id.clone() {
        Some(option) => {
            client
                .set_config_option(session, &option, &ConfigValue::Id(model.to_owned()))
                .await
        }
        None => client.set_model(session, model).await,
    };
    let changed = changed.map_err(|error| tagged("agent", rpc_message(&error)))?;
    controls.merge(&changed);
    Ok(())
}

fn offers(option: &ConfigOptionView, value: &str) -> bool {
    match &option.kind {
        ConfigKind::Select { options, .. } => options.iter().any(|choice| choice.value == value),
        _ => false,
    }
}

pub(super) fn read_only_mode(controls: &SessionControls) -> Option<&'static str> {
    let option = controls.by_category("mode");
    READ_ONLY_MODES.into_iter().find(|mode| {
        controls.modes.iter().any(|offered| offered.id == *mode)
            || option.is_some_and(|option| offers(option, mode))
    })
}

pub(super) fn low_effort(controls: &SessionControls) -> Option<(&str, &'static str)> {
    let option = controls.by_category("thought_level")?;
    LOW_EFFORTS
        .into_iter()
        .find(|effort| offers(option, effort))
        .map(|effort| (option.id.as_str(), effort))
}

/// Whether the Tools can hold this agent to reading. Claude Code turns its
/// tools off. Any other agent has to be in a read-only mode before it sees an
/// image, because a tool that needs no approval starts before the stop on the
/// first tool call can land.
pub(super) fn holds_to_reading(definition: &AgentDefinition, controls: &SessionControls) -> bool {
    catalog::is_claude(definition) || read_only_mode(controls).is_some()
}

fn not_read_only() -> String {
    tagged("agent_read_only", "This agent can't be limited to reading.")
}

async fn settle_for_reading(
    client: &AcpClient,
    session: &str,
    definition: &AgentDefinition,
    controls: &SessionControls,
) -> Result<(), String> {
    if !catalog::is_claude(definition) {
        let mode = read_only_mode(controls).ok_or_else(not_read_only)?;
        let switched = match controls.by_category("mode") {
            Some(option) => {
                client
                    .set_config_option(session, &option.id, &ConfigValue::Id(mode.to_owned()))
                    .await
            }
            None => client.set_mode(session, mode).await,
        };
        switched.map_err(|_| not_read_only())?;
    }
    if let Some((option, effort)) = low_effort(controls) {
        let _ = client
            .set_config_option(session, option, &ConfigValue::Id(effort.to_owned()))
            .await;
    }
    Ok(())
}

fn used_a_tool() -> String {
    tagged(
        "agent_tool",
        "The agent tried to use a tool, so Oleafly stopped it.",
    )
}

async fn run_turn(
    client: &AcpClient,
    host: &OneShotHost,
    definition: &AgentDefinition,
    request: &OneShot,
    cwd: &Path,
) -> Result<CompletionResponse, String> {
    let redactor = Redactor::new(&[]);
    add_login_secrets(&redactor);
    let failed = |error: &oleafly_acp::RpcError| {
        if error.auth_required() {
            tagged("auth", redactor.text(&error.message))
        } else {
            tagged("agent", redactor.text(&rpc_message(error)))
        }
    };
    let negotiated = tokio::time::timeout(
        INITIALIZE_LIMIT,
        client.initialize(&client_options(false, false)),
    )
    .await
    .map_err(|_| tagged("agent", "The agent did not start in time."))?
    .map_err(|error| tagged("agent", redactor.text(&error.to_string())))?;
    if !request.images.is_empty() && !negotiated.capabilities.image {
        return Err(tagged(
            "agent_images",
            PromptError::ImagesUnsupported.message(),
        ));
    }
    let opened = client
        .request(
            "session/new",
            new_session_params(definition, request, &negotiated, cwd),
            REQUEST_TIMEOUT,
        )
        .await
        .map_err(|error| failed(&error))?;
    let session = opened["sessionId"]
        .as_str()
        .ok_or_else(|| tagged("agent", "The agent did not open a session."))?;
    let mut controls = SessionControls::default();
    controls.merge(&opened);
    choose_model(client, session, &mut controls, &request.model).await?;
    settle_for_reading(client, session, definition, &controls).await?;

    let text = prompt_text(request, &negotiated);
    let mut blocks = prompt_blocks(
        session,
        &PromptParts {
            text: &text,
            skill_block: None,
            images: &request.images,
            links: &[],
            texts: &[],
        },
        &negotiated.capabilities,
    )
    .map_err(|error| tagged("agent", error.message()))?;
    // The image comes first, as in every other Tools request.
    blocks.rotate_left(1);

    let timing = TurnTiming {
        inactivity: Some(request.idle),
        absolute: Some(request.total),
        hold: None,
    };
    let mut tool_started = host.tool_started.subscribe();
    let answer = tokio::select! {
        answer = client.prompt_or_cancel(session, blocks, timing) => answer,
        _ = tool_started.wait_for(|started| *started) => {
            let _ = client.cancel(session);
            return Err(used_a_tool());
        }
    };
    // A turn can end in the same breath as the call, and nothing a tool
    // touched is a transcription.
    if *host.tool_started.borrow() {
        return Err(used_a_tool());
    }
    let answer = answer.map_err(|error| failed(&error))?;

    let reply = host.take();
    if let Some(held) = &reply.system_error {
        let message = super::codex::system_error_message(held);
        let kind = if super::protocol::reads_as_auth_failure(&message) {
            "auth"
        } else {
            "agent"
        };
        return Err(tagged(kind, redactor.text(&message)));
    }
    Ok(CompletionResponse {
        text: redactor.text(&reply.text()),
        usage: Usage::default(),
        provider_id: format!("acp:{}", request.agent_id),
        model_id: request.model.clone(),
        stop_reason: answer["stopReason"].as_str().map(str::to_owned),
    })
}

/// The agent's process and folder. A cancelled run drops the turn's future at
/// any await, so stopping runs as a task of its own.
struct RunningAgent {
    runtime: Arc<AcpRuntime>,
    client: Arc<AcpClient>,
    folder: Option<ProbeDir>,
}

impl RunningAgent {
    fn stop(&mut self) -> Option<tokio::task::JoinHandle<()>> {
        let folder = self.folder.take()?;
        let (runtime, client) = (self.runtime.clone(), self.client.clone());
        let handle = tokio::runtime::Handle::try_current().ok()?;
        Some(handle.spawn(async move {
            client.shutdown().await;
            runtime.untrack_transient(&client).await;
            drop(folder);
        }))
    }

    async fn finish(mut self) {
        if let Some(stopping) = self.stop() {
            let _ = stopping.await;
        }
    }
}

impl Drop for RunningAgent {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

impl AcpRuntime {
    pub(crate) async fn one_shot(
        self: &Arc<Self>,
        request: OneShot,
    ) -> Result<CompletionResponse, String> {
        let definition = self
            .definition(&request.agent_id)
            .map_err(|error| tagged("agent", error))?;
        let startup = self
            .begin_startup()
            .map_err(|error| tagged("agent", error))?;
        let program = self
            .store
            .agent_program(&request.agent_id)
            .map_err(|error| tagged("agent", error))?;
        let launch = {
            let root = self.root.clone();
            let definition = definition.clone();
            catalog::blocking(move || {
                catalog::plan(&root, &definition, program.as_deref().map(Path::new)).launch
            })
            .await
            .and_then(|launch| launch)
            .map_err(|error| tagged("agent_unavailable", error))?
        };
        let folder = catalog::probe_folder(&self.root).map_err(|error| tagged("agent", error))?;
        let command =
            probe_command(&launch, folder.path()).map_err(|error| tagged("agent", error))?;
        let host = OneShotHost::new();
        let client = AcpClient::spawn(command, host.clone())
            .await
            .map_err(|error| tagged("agent", rpc_message(&error)))?;
        let cwd = folder.path().to_path_buf();
        let running = RunningAgent {
            runtime: self.clone(),
            client: client.clone(),
            folder: Some(folder),
        };
        self.track_transient(&client, &launch.executable).await;
        drop(startup);
        let result = run_turn(&client, &host, &definition, &request, &cwd).await;
        running.finish().await;
        result
    }
}
