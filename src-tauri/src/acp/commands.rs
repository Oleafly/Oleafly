use super::{catalog::RegistryEntry, AcpRuntime};
use super::{
    AcpEvent, AgentCheck, AgentDefinition, AgentStatus, EventPage, ImagePrompt, SessionRecord,
    SessionSnapshot, StartSession,
};
use std::sync::Arc;
use tauri::{AppHandle, State, WebviewWindow};

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
pub fn acp_register(
    runtime: State<'_, Arc<AcpRuntime>>,
    definition_json: String,
) -> Result<AgentDefinition, String> {
    runtime.register(&definition_json)
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

#[tauri::command]
pub async fn acp_start(
    app: AppHandle,
    window: WebviewWindow,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    agent_id: String,
) -> Result<SessionSnapshot, String> {
    let _startup = runtime.begin_startup()?;
    let generation = runtime.owner_generation(window.label());
    let project_path = crate::paths::project_dir(&project_id)?;
    let bridge = super::admit_agent_bridge(
        &project_id,
        crate::research_mcp::start(app, project_id.clone(), None),
    )
    .await?;
    let result = runtime
        .start_with_mcp_at_generation(
            StartSession {
                project_id,
                project_path,
                agent_id,
                owner: Some(window.label().into()),
                ..StartSession::default()
            },
            vec![bridge.mcp_server()],
            Some(generation),
        )
        .await?;
    runtime.retain_resource(&result.session.id, bridge).await?;
    Ok(result)
}

#[tauri::command]
pub async fn acp_reconnect(
    app: AppHandle,
    window: WebviewWindow,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
) -> Result<SessionSnapshot, String> {
    let _startup = runtime.begin_startup()?;
    let generation = runtime.owner_generation(window.label());
    let record = check_project(&runtime, &session_id, &project_id)?;
    if record.task_id.is_some() {
        return Err("Resume delegated work from its research task.".into());
    }
    let root = crate::paths::project_dir(&project_id)?
        .canonicalize()
        .map_err(|_| "The project could not be resolved.")?;
    if root != std::path::Path::new(&record.project_path) {
        return Err("The saved session uses a different project directory.".into());
    }
    let bridge = super::admit_agent_bridge(
        &project_id,
        crate::research_mcp::start(app, project_id.clone(), None),
    )
    .await?;
    let result = runtime
        .reconnect_with_mcp_at_generation(
            &session_id,
            Some(window.label().into()),
            vec![bridge.mcp_server()],
            Some(generation),
        )
        .await?;
    runtime.retain_resource(&session_id, bridge).await?;
    Ok(result)
}

#[tauri::command]
pub async fn acp_prompt(
    window: WebviewWindow,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
    text: String,
    images: Option<Vec<ImagePrompt>>,
    skill_id: Option<String>,
) -> Result<SessionSnapshot, String> {
    check_project(&runtime, &session_id, &project_id)?;
    runtime.assert_owner(&session_id, window.label()).await?;
    // Contract stub: the skill block arrives with the runtime implementation.
    let _ = skill_id;
    runtime
        .prompt(&session_id, text, images.unwrap_or_default())
        .await
}

#[tauri::command]
pub async fn acp_cancel(
    window: WebviewWindow,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
) -> Result<(), String> {
    check_project(&runtime, &session_id, &project_id)?;
    runtime.assert_owner(&session_id, window.label()).await?;
    runtime.cancel(&session_id).await
}

#[tauri::command]
pub async fn acp_disconnect(
    window: WebviewWindow,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
) -> Result<(), String> {
    check_project(&runtime, &session_id, &project_id)?;
    runtime.assert_owner(&session_id, window.label()).await?;
    runtime.close(&session_id).await
}

#[tauri::command]
pub async fn acp_authenticate(
    window: WebviewWindow,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
    method_id: String,
) -> Result<SessionSnapshot, String> {
    check_project(&runtime, &session_id, &project_id)?;
    runtime.assert_owner(&session_id, window.label()).await?;
    runtime.authenticate(&session_id, &method_id).await
}

#[tauri::command]
pub async fn acp_set_model(
    window: WebviewWindow,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
    model_id: String,
) -> Result<SessionSnapshot, String> {
    check_project(&runtime, &session_id, &project_id)?;
    runtime.assert_owner(&session_id, window.label()).await?;
    runtime.set_model(&session_id, &model_id).await
}

#[tauri::command]
pub async fn acp_permission(
    window: WebviewWindow,
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
    permission_id: String,
    option_id: Option<String>,
) -> Result<(), String> {
    check_project(&runtime, &session_id, &project_id)?;
    runtime.assert_owner(&session_id, window.label()).await?;
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

#[tauri::command]
pub fn acp_sessions(
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
) -> Result<Vec<SessionRecord>, String> {
    crate::paths::project_dir(&project_id)?;
    runtime.list(&project_id)
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
pub fn acp_events(
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
    after: u64,
    limit: Option<usize>,
) -> Result<EventPage, String> {
    check_project(&runtime, &session_id, &project_id)?;
    runtime.events(&session_id, after, limit.unwrap_or(200))
}

const NOT_IMPLEMENTED: &str = "Not implemented.";

/// Tests an agent program without saving it: the chosen `path`, or the
/// program Oleafly resolves today when `path` is `None`.
#[tauri::command]
pub async fn acp_check_agent(
    window: WebviewWindow,
    runtime: State<'_, Arc<AcpRuntime>>,
    agent_id: String,
    path: Option<String>,
) -> Result<AgentCheck, String> {
    let _ = (window, runtime, agent_id, path);
    Err(NOT_IMPLEMENTED.into())
}

/// Opens a native file dialog for choosing an agent program and returns the
/// chosen path, or `None` when the dialog was cancelled.
#[tauri::command]
pub async fn acp_pick_agent_program(
    window: WebviewWindow,
    runtime: State<'_, Arc<AcpRuntime>>,
    agent_id: String,
) -> Result<Option<String>, String> {
    let _ = (window, runtime, agent_id);
    Err(NOT_IMPLEMENTED.into())
}

/// Saves (or clears with `None`) the program the user chose for an agent.
#[tauri::command]
pub async fn acp_set_agent_program(
    window: WebviewWindow,
    runtime: State<'_, Arc<AcpRuntime>>,
    agent_id: String,
    path: Option<String>,
) -> Result<AgentStatus, String> {
    let _ = (window, runtime, agent_id, path);
    Err(NOT_IMPLEMENTED.into())
}

/// Writes a conversation as pretty JSON (`{ session, events }`) to `path`.
#[tauri::command]
pub async fn acp_session_export(
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
    path: String,
) -> Result<(), String> {
    check_project(&runtime, &session_id, &project_id)?;
    let _ = path;
    Err(NOT_IMPLEMENTED.into())
}

/// Every stored event of a conversation, oldest first.
#[tauri::command]
pub async fn acp_session_events_all(
    runtime: State<'_, Arc<AcpRuntime>>,
    project_id: String,
    session_id: String,
) -> Result<Vec<AcpEvent>, String> {
    check_project(&runtime, &session_id, &project_id)?;
    Err(NOT_IMPLEMENTED.into())
}
