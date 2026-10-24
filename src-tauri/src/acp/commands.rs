use super::attachments::PromptInput;
use super::hermes::{HermesSettings, HermesStatus};
use super::{catalog::RegistryEntry, AcpRuntime};
use super::{
    AcpEvent, AcpPreferences, AgentCheck, AgentDefinition, AgentPreferences, AgentSessionPage,
    AgentStatus, DeleteOutcome, EventPage, SessionPage, SessionRecord, SessionSnapshot,
    StartSession, SteerOutcome, TerminalSignIn, TurnCommit,
};
use oleafly_acp::controls::ConfigValue;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State, Webview};
use zeroize::Zeroizing;

/// Runs store or file work off the main thread. These commands take the
/// store's one connection lock, which every streamed event append takes too.
async fn off_thread<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

fn check_project(
    runtime: &AcpRuntime,
    id: &str,
    project_id: &str,
) -> Result<SessionRecord, String> {
    crate::paths::project_dir(project_id)?;
    let record = runtime.record(id)?;
    if record.project_id != project_id {
        return Err("This ACP session belongs to another project.".into());
    }
    Ok(record)
}

#[tauri::command]
pub async fn acp_catalog(
    runtime: State<'_, Arc<AcpRuntime>>,
    probe: Option<bool>,
) -> Result<Vec<AgentStatus>, String> {
    runtime.catalog(probe.unwrap_or(false)).await
}

#[tauri::command]
pub async fn acp_registry_search(
    runtime: State<'_, Arc<AcpRuntime>>,
    query: String,
) -> Result<Vec<RegistryEntry>, String> {
    runtime.registry_search(&query).await
}

#[tauri::command]
pub async fn acp_register(
    runtime: State<'_, Arc<AcpRuntime>>,
    definition_json: String,
) -> Result<AgentDefinition, String> {
    let runtime = runtime.inner().clone();
    off_thread(move || runtime.register(&definition_json)).await
}

#[tauri::command]
pub async fn acp_remove_agent(
    runtime: State<'_, Arc<AcpRuntime>>,
    agent_id: String,
) -> Result<(), String> {
    runtime.remove_agent(&agent_id).await
}

#[tauri::command]
pub async fn acp_install(
    runtime: State<'_, Arc<AcpRuntime>>,
    agent_id: String,
) -> Result<AgentStatus, String> {
    runtime.install(&agent_id).await
}

fn caller_label(webview: &Webview) -> Result<String, String> {
    crate::caller::own_window_label(webview)
        .ok_or_else(|| "Agents are unavailable from this view.".to_string())
}

#[tauri::command]
pub async fn acp_start(
    app: AppHandle,
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    agent_id: String,
) -> Result<SessionSnapshot, String> {
    let owner = caller_label(&webview)?;
    let _startup = runtime.begin_startup()?;
    let generation = runtime.owner_generation(owner.as_str());
    let project_path = crate::paths::project_dir(&project_id)?;
    super::runtime::note_launch_root(&project_path);
    let bridge = super::admit_agent_bridge(
        &project_id,
        crate::research_mcp::start(app, project_id.clone(), None),
    )
    .await?;
    // 0.4.8 I: desktop apps through their own bridge, when they are on.
    let cua = crate::cua_driver::acp_bridge(&project_id, &agent_label(&runtime, &agent_id)).await;
    let servers = agent_servers(&bridge, cua.as_ref());
    let result = runtime
        .start_with_mcp_at_generation(
            StartSession {
                project_id,
                project_path,
                agent_id,
                owner: Some(owner.as_str().into()),
                ..StartSession::default()
            },
            servers,
            Some(generation),
        )
        .await?;
    keep_agent_bridges(&runtime, &result.session.id, bridge, cua).await?;
    Ok(result)
}

// 0.4.8 I: the agent's name labels its desktop apps session.
fn agent_label(runtime: &AcpRuntime, agent_id: &str) -> String {
    runtime
        .agent_definition(agent_id)
        .map(|definition| definition.name)
        .unwrap_or_else(|_| agent_id.to_string())
}

// 0.4.8 I: the research bridge, then desktop apps when present.
fn agent_servers(
    bridge: &crate::research_mcp::ScopedResearchMcp,
    cua: Option<&crate::cua_driver::CuaBridge>,
) -> Vec<serde_json::Value> {
    let mut servers = vec![bridge.mcp_server()];
    servers.extend(cua.map(crate::cua_driver::CuaBridge::mcp_server));
    servers
}

// 0.4.8 I: one resource per session id, so both bridges go in one tuple; a
// second insert would drop the research bridge.
async fn keep_agent_bridges(
    runtime: &AcpRuntime,
    session_id: &str,
    bridge: crate::research_mcp::ScopedResearchMcp,
    cua: Option<crate::cua_driver::CuaBridge>,
) -> Result<(), String> {
    if let Some(cua) = &cua {
        crate::cua_driver::bind_acp_session(session_id, cua.session_key());
    }
    runtime.retain_resource(session_id, (bridge, cua)).await
}

#[tauri::command]
pub async fn acp_reconnect(
    app: AppHandle,
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
) -> Result<SessionSnapshot, String> {
    let owner = caller_label(&webview)?;
    let _startup = runtime.begin_startup()?;
    let generation = runtime.owner_generation(owner.as_str());
    let record = check_project(&runtime, &session_id, &project_id)?;
    if record.task_id.is_some() {
        return Err("Resume delegated work from its research task.".into());
    }
    let original = crate::paths::project_dir(&project_id)?;
    let root = original
        .canonicalize()
        .map_err(|_| "The project could not be resolved.")?;
    super::runtime::note_launch_root(&original);
    if root != std::path::Path::new(&record.project_path) {
        return Err("The saved session uses a different project directory.".into());
    }
    let bridge = super::admit_agent_bridge(
        &project_id,
        crate::research_mcp::start(app, project_id.clone(), None),
    )
    .await?;
    // 0.4.8 I: desktop apps through their own bridge, when they are on.
    let cua =
        crate::cua_driver::acp_bridge(&project_id, &agent_label(&runtime, &record.agent_id)).await;
    let result = runtime
        .reconnect_with_mcp_at_generation(
            &session_id,
            Some(owner.as_str().into()),
            agent_servers(&bridge, cua.as_ref()),
            Some(generation),
        )
        .await?;
    keep_agent_bridges(&runtime, &session_id, bridge, cua).await?;
    Ok(result)
}

/// Sends a message. A failure is a plain string when the message was not
/// sent, or `{"delivered": true, "message": "…"}` when it reached the
/// conversation and the turn then ended in an error (see `PromptFailure`).
#[tauri::command]
pub async fn acp_prompt(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
    input: PromptInput,
) -> Result<SessionSnapshot, super::PromptFailure> {
    let owner = caller_label(&webview)?;
    check_project(&runtime, &session_id, &project_id)?;
    runtime.assert_owner(&session_id, owner.as_str()).await?;
    let skill = match input.skill_id.clone().filter(|id| !id.trim().is_empty()) {
        Some(skill_id) => {
            let app = webview.app_handle().clone();
            let project = project_id.clone();
            Some(
                tauri::async_runtime::spawn_blocking(move || {
                    super::skill_block::prompt_skill(&app, &project, &skill_id)
                })
                .await
                .map_err(|e| e.to_string())??,
            )
        }
        None => None,
    };
    runtime.send_prompt(&session_id, input, skill).await
}

#[tauri::command]
pub async fn acp_cancel(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
) -> Result<(), String> {
    let owner = caller_label(&webview)?;
    check_project(&runtime, &session_id, &project_id)?;
    runtime.assert_owner(&session_id, owner.as_str()).await?;
    runtime.cancel(&session_id).await
}

#[tauri::command]
pub async fn acp_disconnect(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
) -> Result<(), String> {
    let owner = caller_label(&webview)?;
    check_project(&runtime, &session_id, &project_id)?;
    runtime.assert_owner(&session_id, owner.as_str()).await?;
    runtime.close(&session_id).await
}

#[tauri::command]
pub async fn acp_authenticate(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
    method_id: String,
    api_key: Option<String>,
) -> Result<SessionSnapshot, String> {
    let api_key = api_key.map(Zeroizing::new);
    let owner = caller_label(&webview)?;
    check_project(&runtime, &session_id, &project_id)?;
    runtime.assert_owner(&session_id, owner.as_str()).await?;
    runtime.authenticate(&session_id, &method_id, api_key).await
}

#[tauri::command]
pub async fn acp_set_model(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
    model_id: String,
) -> Result<SessionSnapshot, String> {
    let owner = caller_label(&webview)?;
    check_project(&runtime, &session_id, &project_id)?;
    runtime.assert_owner(&session_id, owner.as_str()).await?;
    runtime.set_model(&session_id, &model_id).await
}

#[tauri::command]
pub async fn acp_permission(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
    permission_id: String,
    option_id: Option<String>,
) -> Result<(), String> {
    let owner = caller_label(&webview)?;
    check_project(&runtime, &session_id, &project_id)?;
    runtime.assert_owner(&session_id, owner.as_str()).await?;
    runtime
        .resolve_permission(&session_id, &permission_id, option_id)
        .await
}

#[tauri::command]
pub async fn acp_delegated_permission(
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
    parent_session_id: String,
    permission_id: String,
    option_id: Option<String>,
) -> Result<(), String> {
    let record = check_project(&runtime, &session_id, &project_id)?;
    if parent_session_id.trim().is_empty()
        || record.parent_session_id.as_deref() != Some(parent_session_id.as_str())
    {
        return Err("This permission request belongs to another conversation.".into());
    }
    runtime
        .resolve_delegated_permission(&session_id, &permission_id, option_id)
        .await
}

/// A page of a project's conversations. `before` and `before_id` are the
/// update time and id of the last one shown; `before` alone still works, and
/// then skips conversations that share its timestamp.
#[tauri::command]
pub async fn acp_sessions(
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    query: Option<String>,
    before: Option<u64>,
    before_id: Option<String>,
    limit: Option<u32>,
) -> Result<SessionPage, String> {
    crate::paths::project_dir(&project_id)?;
    if query.as_ref().is_some_and(|query| query.len() > 200) {
        return Err("The search is too long.".into());
    }
    let runtime = runtime.inner().clone();
    off_thread(move || {
        runtime.session_page(
            &project_id,
            query.as_deref(),
            before,
            before_id.as_deref(),
            limit,
        )
    })
    .await
}

#[tauri::command]
pub async fn acp_snapshot(
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
) -> Result<SessionSnapshot, String> {
    check_project(&runtime, &session_id, &project_id)?;
    runtime.snapshot(&session_id).await
}

#[tauri::command]
pub async fn acp_events(
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
    after: u64,
    limit: Option<usize>,
) -> Result<EventPage, String> {
    let runtime = runtime.inner().clone();
    off_thread(move || {
        check_project(&runtime, &session_id, &project_id)?;
        runtime.events(&session_id, after, limit.unwrap_or(200))
    })
    .await
}

/// Tests an agent program without saving it: the chosen `path`, or the
/// program Oleafly resolves today when `path` is `None`.
#[tauri::command]
pub async fn acp_check_agent(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    agent_id: String,
    path: Option<String>,
) -> Result<AgentCheck, String> {
    let owner = caller_label(&webview)?;
    super::setup::require_main_window(owner.as_str())?;
    runtime
        .agent_definition(&agent_id)
        .map_err(|_| String::from(super::setup::program_error("unknown_agent")))?;
    let candidate = path
        .map(|path| path.trim().to_string())
        .map(std::path::PathBuf::from);
    runtime.check_agent(&agent_id, candidate).await
}

/// Opens a native file dialog for choosing an agent program and returns the
/// chosen path, or `None` when the dialog was cancelled.
#[tauri::command]
pub async fn acp_pick_agent_program(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    agent_id: String,
) -> Result<Option<String>, String> {
    let owner = caller_label(&webview)?;
    super::setup::require_main_window(owner.as_str())?;
    let definition = runtime
        .agent_definition(&agent_id)
        .map_err(|_| String::from(super::setup::program_error("unknown_agent")))?;
    let status = runtime.agent_status(&agent_id, false).await?;
    let start = status
        .program_override
        .clone()
        .or_else(|| status.cli.as_ref().and_then(|cli| cli.path.clone()))
        .or_else(|| status.executable.clone())
        .and_then(|path| {
            std::path::Path::new(&path)
                .parent()
                .map(std::path::Path::to_path_buf)
        });
    let picked = super::setup::pick_program(webview.app_handle(), &definition, start).await?;
    if let Some(path) = &picked {
        super::setup::remember_pick(&agent_id, path);
    }
    Ok(picked.map(|path| path.to_string_lossy().into_owned()))
}

/// Saves (or clears with `None`) the program the user chose for an agent.
#[tauri::command]
pub async fn acp_set_agent_program(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    agent_id: String,
    path: Option<String>,
) -> Result<AgentStatus, String> {
    let owner = caller_label(&webview)?;
    super::setup::require_main_window(owner.as_str())?;
    let definition = runtime
        .agent_definition(&agent_id)
        .map_err(|_| String::from(super::setup::program_error("unknown_agent")))?;
    let Some(path) = path else {
        runtime.save_agent_program(&agent_id, None)?;
        return runtime.agent_status(&agent_id, false).await;
    };
    let path = std::path::PathBuf::from(path.trim());
    let located = {
        let definition = definition.clone();
        super::catalog::blocking(move || super::setup::inspect_choice(&definition, &path))
            .await?
            .map_err(|code| String::from(super::setup::program_error(code)))?
    };
    if !super::setup::was_picked(&agent_id, &located.path)
        && !super::setup::confirm_program(webview.app_handle(), &definition, &located.path).await?
    {
        return Err(super::setup::program_error("declined").into());
    }
    runtime.save_agent_program(&agent_id, Some(&located.path))?;
    runtime.agent_status(&agent_id, false).await
}

/// Writes a conversation as pretty JSON (`{ session, events }`) to `path`,
/// an absolute path from a save dialog.
#[tauri::command]
pub async fn acp_session_export(
    runtime: State<'_, Arc<AcpRuntime>>,
    state: State<'_, crate::state::AppState>,
    project_id: String,
    session_id: String,
    path: String,
) -> Result<(), String> {
    check_project(&runtime, &session_id, &project_id)?;
    let exporter = runtime.inner().clone();
    let destination = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        exporter.export_session(&session_id, &destination)
    })
    .await
    .map_err(|e| e.to_string())??;
    crate::commands::allow_reveal_export(&path, &state).await;
    Ok(())
}

/// Every stored event of a conversation, oldest first.
#[tauri::command]
pub async fn acp_session_events_all(
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
) -> Result<Vec<AcpEvent>, String> {
    check_project(&runtime, &session_id, &project_id)?;
    let reader = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || reader.events_all(&session_id))
        .await
        .map_err(|e| e.to_string())?
}

// 0.4.8 D: preferences, options, usage, sign-in, steering, sessions, Hermes.

/// The live session a window owns, after the usual project checks.
async fn owned(
    webview: &Webview,
    runtime: &AcpRuntime,
    project_id: &str,
    session_id: &str,
) -> Result<SessionRecord, String> {
    let owner = caller_label(webview)?;
    let record = check_project(runtime, session_id, project_id)?;
    runtime.assert_owner(session_id, owner.as_str()).await?;
    Ok(record)
}

#[tauri::command]
pub async fn acp_preferences(
    runtime: State<'_, Arc<AcpRuntime>>,
) -> Result<AcpPreferences, String> {
    let runtime = runtime.inner().clone();
    off_thread(move || Ok(runtime.preferences())).await
}

#[tauri::command]
pub async fn acp_set_preferences(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    prefs: AcpPreferences,
) -> Result<AcpPreferences, String> {
    super::setup::require_main_window(caller_label(&webview)?.as_str())?;
    runtime.inner().clone().set_preferences(prefs).await
}

#[tauri::command]
pub async fn acp_agent_preferences(
    runtime: State<'_, Arc<AcpRuntime>>,
    agent_id: String,
) -> Result<AgentPreferences, String> {
    let runtime = runtime.inner().clone();
    off_thread(move || runtime.agent_preferences(&agent_id)).await
}

#[tauri::command]
pub async fn acp_set_agent_preferences(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    agent_id: String,
    prefs: AgentPreferences,
) -> Result<AgentPreferences, String> {
    super::setup::require_main_window(caller_label(&webview)?.as_str())?;
    runtime
        .inner()
        .clone()
        .set_agent_preferences(&agent_id, prefs)
        .await
}

/// Changes one remembered choice of an agent (`effort`, `mode` or
/// `provider`) and keeps the rest as stored.
#[tauri::command]
pub async fn acp_set_agent_preference(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    agent_id: String,
    slot: String,
    value: serde_json::Value,
) -> Result<AgentPreferences, String> {
    super::setup::require_main_window(caller_label(&webview)?.as_str())?;
    runtime
        .inner()
        .clone()
        .set_agent_preference(&agent_id, &slot, value)
        .await
}

#[tauri::command]
pub async fn acp_provider_choices(
    runtime: State<'_, Arc<AcpRuntime>>,
    agent_id: String,
) -> Result<Vec<super::providers::ProviderChoice>, String> {
    let runtime = runtime.inner().clone();
    off_thread(move || {
        runtime.agent_definition(&agent_id)?;
        let supported = runtime.agent_supported_providers(&agent_id);
        let config = crate::config::read_config()?;
        Ok(super::providers::provider_choices(&supported, &config))
    })
    .await
}

#[tauri::command]
pub async fn acp_buffer_reply(
    webview: Webview,
    buffers: State<'_, Arc<super::buffers::WindowBuffers>>,
    request_id: String,
    content: Option<String>,
) -> Result<(), String> {
    let window = caller_label(&webview)?;
    buffers.reply(window.as_str(), &request_id, content)
}

#[tauri::command]
pub async fn acp_set_config_option(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
    config_id: String,
    value: ConfigValue,
) -> Result<SessionSnapshot, String> {
    owned(&webview, &runtime, &project_id, &session_id).await?;
    runtime
        .inner()
        .clone()
        .set_config_option(&session_id, &config_id, value)
        .await
}

#[tauri::command]
pub async fn acp_set_mode(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
    mode_id: String,
) -> Result<SessionSnapshot, String> {
    owned(&webview, &runtime, &project_id, &session_id).await?;
    runtime
        .inner()
        .clone()
        .set_mode(&session_id, &mode_id)
        .await
}

#[tauri::command]
pub async fn acp_refresh_plan_usage(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
) -> Result<SessionSnapshot, String> {
    owned(&webview, &runtime, &project_id, &session_id).await?;
    runtime
        .inner()
        .clone()
        .refresh_plan_usage(&session_id)
        .await
}

#[tauri::command]
pub async fn acp_sign_in_command(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: Option<String>,
    agent_id: String,
    session_id: Option<String>,
    method_id: String,
) -> Result<TerminalSignIn, String> {
    caller_label(&webview)?;
    if let Some(project_id) = &project_id {
        crate::paths::project_dir(project_id)?;
        if let Some(session_id) = &session_id {
            check_project(&runtime, session_id, project_id)?;
        }
    } else if session_id.is_some() {
        return Err("Choose the project of this conversation.".into());
    }
    runtime
        .sign_in_command(&agent_id, session_id.as_deref(), &method_id)
        .await
}

#[tauri::command]
pub async fn acp_logout(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
) -> Result<SessionSnapshot, String> {
    owned(&webview, &runtime, &project_id, &session_id).await?;
    runtime.inner().clone().logout(&session_id).await
}

#[tauri::command]
pub async fn acp_elicitation_respond(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
    elicitation_id: String,
    action: String,
    content: Option<serde_json::Map<String, serde_json::Value>>,
) -> Result<(), String> {
    owned(&webview, &runtime, &project_id, &session_id).await?;
    runtime
        .respond_elicitation(&session_id, &elicitation_id, &action, content)
        .await
}

#[tauri::command]
pub async fn acp_steer(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
    text: String,
) -> Result<SteerOutcome, String> {
    owned(&webview, &runtime, &project_id, &session_id).await?;
    runtime.inner().clone().steer(&session_id, text).await
}

#[tauri::command]
pub async fn acp_session_rename(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
    title: String,
) -> Result<SessionRecord, String> {
    caller_label(&webview)?;
    check_project(&runtime, &session_id, &project_id)?;
    runtime.rename_session(&session_id, &title).await
}

#[tauri::command]
pub async fn acp_session_delete(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
    from_agent: bool,
) -> Result<DeleteOutcome, String> {
    let owner = caller_label(&webview)?;
    let record = check_project(&runtime, &session_id, &project_id)?;
    if record.task_id.is_some() {
        return Err("Delete research task conversations from the task.".into());
    }
    // A live conversation may only be deleted from its own window.
    if let Err(error) = runtime.assert_owner(&session_id, owner.as_str()).await {
        if error != "This ACP session is disconnected." {
            return Err(error);
        }
    }
    runtime
        .inner()
        .clone()
        .delete_session(&session_id, from_agent)
        .await
}

#[tauri::command]
pub async fn acp_agent_sessions(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    agent_id: String,
    cursor: Option<String>,
) -> Result<AgentSessionPage, String> {
    caller_label(&webview)?;
    crate::paths::project_dir(&project_id)?;
    runtime
        .inner()
        .clone()
        .agent_sessions(&project_id, &agent_id, cursor)
        .await
}

#[tauri::command]
pub async fn acp_session_import(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    agent_id: String,
    native_session_ids: Vec<String>,
) -> Result<Vec<SessionRecord>, String> {
    caller_label(&webview)?;
    crate::paths::project_dir(&project_id)?;
    runtime
        .inner()
        .clone()
        .import_sessions(&project_id, &agent_id, native_session_ids)
        .await
}

#[tauri::command]
pub async fn acp_fork(
    app: AppHandle,
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
) -> Result<SessionSnapshot, String> {
    let owner = caller_label(&webview)?;
    let record = check_project(&runtime, &session_id, &project_id)?;
    runtime.assert_owner(&session_id, owner.as_str()).await?;
    let _startup = runtime.begin_startup()?;
    let bridge = super::admit_agent_bridge(
        &project_id,
        crate::research_mcp::start(app, project_id.clone(), None),
    )
    .await?;
    // 0.4.8 I: a fork is a new session with its own desktop apps bridge.
    let cua =
        crate::cua_driver::acp_bridge(&project_id, &agent_label(&runtime, &record.agent_id)).await;
    let result = runtime
        .inner()
        .clone()
        .fork(
            &session_id,
            Some(owner.as_str().into()),
            agent_servers(&bridge, cua.as_ref()),
        )
        .await?;
    keep_agent_bridges(&runtime, &result.session.id, bridge, cua).await?;
    Ok(result)
}

#[tauri::command]
pub async fn acp_commit_turn(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
    turn_id: String,
    message: String,
    paths: Vec<String>,
) -> Result<TurnCommit, String> {
    caller_label(&webview)?;
    check_project(&runtime, &session_id, &project_id)?;
    runtime
        .commit_turn(&session_id, &turn_id, &message, paths)
        .await
}

#[tauri::command]
pub async fn acp_hermes_settings(
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
) -> Result<HermesSettings, String> {
    crate::paths::project_dir(&project_id)?;
    let runtime = runtime.inner().clone();
    off_thread(move || runtime.hermes_project_settings(&project_id)).await
}

#[tauri::command]
pub async fn acp_set_hermes_settings(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    settings: HermesSettings,
) -> Result<HermesStatus, String> {
    caller_label(&webview)?;
    let project = crate::paths::project_dir(&project_id)?;
    crate::trust::require_trusted(&project_id, crate::trust::Capability::ExternalAgents)?;
    let name = project
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| project_id.clone());
    runtime
        .set_hermes_project_settings(&project_id, &name, settings)
        .await
}

#[tauri::command]
pub async fn acp_hermes_status(
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
) -> Result<HermesStatus, String> {
    crate::paths::project_dir(&project_id)?;
    crate::trust::require_trusted(&project_id, crate::trust::Capability::ExternalAgents)?;
    runtime.hermes_project_status(&project_id).await
}

#[tauri::command]
pub async fn acp_hermes_set_option(
    webview: Webview,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    option: String,
    enabled: bool,
) -> Result<HermesStatus, String> {
    caller_label(&webview)?;
    crate::paths::project_dir(&project_id)?;
    crate::trust::require_trusted(&project_id, crate::trust::Capability::ExternalAgents)?;
    runtime
        .hermes_set_option(&project_id, &option, enabled)
        .await
}

#[tauri::command]
pub async fn acp_test_remote_hermes(
    webview: Webview,
    project_id: String,
    remote: super::remote::RemoteHermes,
) -> Result<String, String> {
    caller_label(&webview)?;
    crate::paths::project_dir(&project_id)?;
    crate::trust::require_trusted(&project_id, crate::trust::Capability::ExternalAgents)?;
    let ssh = super::remote::locate_ssh()
        .ok_or("Oleafly couldn't find ssh on this computer. Install OpenSSH, then try again.")?;
    super::remote::test_connection(&ssh, &remote).await
}
