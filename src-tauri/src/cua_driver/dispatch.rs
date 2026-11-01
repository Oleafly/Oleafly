use std::sync::Arc;

use serde_json::{json, Map, Value};

use super::browser;
use super::config::{ready, AllowedApp, CuaDriverConfig};
use super::gate::{self, Answer, GateDecision, SeenBrowser};
use super::policy::{self, Family};
use super::running::running_pids;
use super::runtime::{BATCH_TIMEOUT, CALL_TIMEOUT};
use super::{global, lock, log, CuaDriverState, CuaScope, RuntimeKind, Surface, DESKTOP_APPS_TOOL};
use crate::mcp::client::McpServerTool;

const MAX_IMAGE_DATA_URL_BYTES: usize = 14 * 1024 * 1024;
const IMAGE_TYPES: &[&str] = &["image/png", "image/jpeg", "image/webp", "image/gif"];

const OFF_TEXT: &str =
    "Computer Use is off. The user can turn it on in Settings > Integrations > Computer Use.";
const DECLINED_TEXT: &str = "The user didn't allow this action.";
const NO_ANSWER_TEXT: &str =
    "The user didn't answer the approval dialog in time, so nothing was done.";
const TURN_ENDED_TEXT: &str = "The turn ended before the user answered, so nothing was done.";
const STOPPED_AT_TURN_END_TEXT: &str =
    "The turn ended, so Oleafly stopped this call. Check the app's state before you try again.";
const BATCH_TOO_LONG_TEXT: &str =
    "That batch is too long for the approval dialog. Send fewer steps at a time.";
const MAX_LISTED_ELEMENTS: usize = 300;
const MAX_ELEMENT_LIST_CHARS: usize = 24 * 1024;
const MAX_ELEMENT_LINE_CHARS: usize = 240;
const NO_SIGNED_IN_TEXT: &str = "No website is marked for the user's signed-in browser. Use browser \"separate\", or ask the user to mark the site in Settings > Integrations > Computer Use.";

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DesktopAppsOutcome {
    pub text: String,
    pub images: Vec<String>,
    pub is_error: bool,
    pub mcp_result: Value,
}

impl DesktopAppsOutcome {
    fn text(text: impl Into<String>, is_error: bool) -> Self {
        let text = text.into();
        Self {
            mcp_result: json!({"content": [{"type": "text", "text": text}], "isError": is_error}),
            text,
            images: Vec::new(),
            is_error,
        }
    }

    fn error(text: impl Into<String>) -> Self {
        Self::text(text, true)
    }

    fn add_note(&mut self, note: &str) {
        if !self.text.is_empty() {
            self.text.push('\n');
        }
        self.text.push_str(note);
        if let Some(content) = self
            .mcp_result
            .get_mut("content")
            .and_then(Value::as_array_mut)
        {
            content.push(json!({"type": "text", "text": note}));
        }
    }
}

fn element_list(structured: &Value) -> Option<String> {
    let elements = structured.get("elements").and_then(Value::as_array)?;
    if elements.is_empty() {
        return None;
    }
    let field = |element: &Value, key: &str| -> Option<String> {
        match element.get(key)? {
            Value::String(text) if !text.trim().is_empty() => Some(format!("{key} {text:?}")),
            Value::Number(number) => Some(format!("{key} {number}")),
            _ => None,
        }
    };
    let mut lines = Vec::new();
    match structured.get("snapshot_id") {
        Some(Value::String(id)) => lines.push(format!("Elements (snapshot_id {id:?}):")),
        Some(Value::Number(id)) => lines.push(format!("Elements (snapshot_id {id}):")),
        _ => lines.push("Elements:".to_string()),
    }
    let mut used = lines[0].len();
    let mut listed = 0;
    for element in elements.iter().take(MAX_LISTED_ELEMENTS) {
        let parts: Vec<String> = ["element_index", "element_token", "role", "label"]
            .iter()
            .filter_map(|key| field(element, key))
            .collect();
        if parts.is_empty() {
            continue;
        }
        let line = format!(
            "- {}",
            policy::bounded(&parts.join(", "), MAX_ELEMENT_LINE_CHARS)
        );
        if used + line.len() + 1 > MAX_ELEMENT_LIST_CHARS {
            break;
        }
        used += line.len() + 1;
        lines.push(line);
        listed += 1;
    }
    if listed < elements.len() {
        lines.push(format!(
            "{} more elements are not listed here.",
            elements.len() - listed
        ));
    }
    Some(lines.join("\n"))
}

/// A browser page read as text, for a chat: the page outline of a semantic
/// read and the refs to act on, which the driver's own text only counts.
/// Bounded like the element list.
fn page_text(structured: &Value) -> Option<String> {
    let mut sections = Vec::new();
    if let Some(title) = structured
        .get("content_refs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|entry| entry.get("role").and_then(Value::as_str) == Some("rootwebarea"))
        .and_then(|entry| entry.get("name"))
        .and_then(Value::as_str)
        .filter(|title| !title.trim().is_empty())
    {
        sections.push(format!(
            "Title: {}",
            policy::bounded(title, MAX_ELEMENT_LINE_CHARS)
        ));
    }
    if let Some(outline) = structured
        .get("outline")
        .and_then(Value::as_str)
        .filter(|outline| !outline.trim().is_empty())
    {
        sections.push(format!(
            "Page:\n{}",
            policy::bounded(outline, MAX_ELEMENT_LIST_CHARS)
        ));
    }
    let refs = structured
        .get("action_refs")
        .or_else(|| structured.get("refs"))
        .and_then(Value::as_array)
        .filter(|refs| !refs.is_empty());
    if let Some(refs) = refs {
        let text = |entry: &Value, keys: &[&str]| {
            keys.iter()
                .filter_map(|key| entry.get(*key).and_then(Value::as_str))
                .find(|text| !text.trim().is_empty())
                .map(str::to_string)
        };
        let mut lines = vec!["Refs to act on (pass as ref):".to_string()];
        let mut used = lines[0].len();
        let mut listed = 0;
        for entry in refs.iter().take(MAX_LISTED_ELEMENTS) {
            let Some(reference) = text(entry, &["ref"]) else {
                continue;
            };
            let mut parts = vec![reference];
            parts.extend(text(entry, &["role", "node"]));
            parts.extend(text(entry, &["name", "label"]).map(|name| format!("{name:?}")));
            let line = format!(
                "- {}",
                policy::bounded(&parts.join(" "), MAX_ELEMENT_LINE_CHARS)
            );
            if used + line.len() + 1 > MAX_ELEMENT_LIST_CHARS {
                break;
            }
            used += line.len() + 1;
            lines.push(line);
            listed += 1;
        }
        if listed < refs.len() {
            lines.push(format!(
                "{} more refs are not listed here.",
                refs.len() - listed
            ));
        }
        sections.push(lines.join("\n"));
    }
    (!sections.is_empty()).then(|| sections.join("\n"))
}

fn readable(error: &str) -> String {
    crate::app_error::english(error).unwrap_or_else(|| error.to_string())
}

pub(crate) fn outcome_from_result(result: &Value) -> DesktopAppsOutcome {
    outcome_with(result, true)
}

fn outcome_with(result: &Value, keep_mcp: bool) -> DesktopAppsOutcome {
    if let Some((_, text)) = policy::refusal(result) {
        return DesktopAppsOutcome::error(text);
    }
    let is_error = result.get("isError").and_then(Value::as_bool) == Some(true);
    let mut texts = Vec::new();
    let mut images = Vec::new();
    let mut kept_parts = Vec::new();
    let mut dropped = 0usize;
    for part in result
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        match part.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    texts.push(text.to_string());
                }
                if keep_mcp {
                    kept_parts.push(part.clone());
                }
            }
            Some("image") => {
                let mime = part
                    .get("mimeType")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                let data = part.get("data").and_then(Value::as_str).unwrap_or_default();
                let url = format!("data:{mime};base64,{data}");
                if IMAGE_TYPES.contains(&mime.as_str())
                    && !data.is_empty()
                    && url.len() <= MAX_IMAGE_DATA_URL_BYTES
                {
                    images.push(url);
                    if keep_mcp {
                        kept_parts.push(part.clone());
                    }
                } else {
                    dropped += 1;
                }
            }
            _ => {}
        }
    }
    if dropped > 0 {
        let notice = format!(
            "{dropped} screenshot(s) were left out because they were too large or in an unsupported format."
        );
        if keep_mcp {
            kept_parts.push(json!({"type": "text", "text": notice}));
        }
        texts.push(notice);
    }
    let mut text = texts.join("\n");
    if text.is_empty() {
        if let Some(structured) = result.get("structuredContent") {
            text = structured.to_string();
        }
    } else if let Some(listed) = result
        .get("structuredContent")
        .and_then(|structured| element_list(structured).or_else(|| page_text(structured)))
    {
        text.push('\n');
        text.push_str(&listed);
    }
    let mut mcp_result = Value::Null;
    if keep_mcp {
        mcp_result = json!({"content": kept_parts, "isError": is_error});
        if let Some(structured) = result.get("structuredContent") {
            mcp_result["structuredContent"] = structured.clone();
        }
    }
    DesktopAppsOutcome {
        text,
        images,
        is_error,
        mcp_result,
    }
}

fn log_outcome(tool: &str, status: &str) {
    let tool = if policy::curated(tool).is_some() {
        tool
    } else {
        "unknown"
    };
    log(format!("desktop apps: {tool} {status}"));
}

fn result_status(result: &Value) -> String {
    match policy::refusal_code(result) {
        Some(code) => format!("refused:{code}"),
        None if result.get("isError").and_then(Value::as_bool) == Some(true) => "error".into(),
        None => "ok".into(),
    }
}

fn available_kinds(config: &CuaDriverConfig) -> Vec<RuntimeKind> {
    let mut kinds = Vec::new();
    if !config.apps.is_empty() {
        kinds.push(RuntimeKind::Desktop);
    }
    if !config.sites.is_empty() {
        kinds.push(RuntimeKind::Browser);
    }
    if config.sites.iter().any(|site| site.signed_in) {
        kinds.push(RuntimeKind::SignedInBrowser);
    }
    kinds
}

fn allowed_lines(config: &CuaDriverConfig) -> Vec<String> {
    let mut lines = vec![if config.ask_before_actions {
        "Clicks, typing, keys and page changes ask the user first, unless they allowed that tool for this chat, session or task."
    } else {
        "Clicks, typing, keys and page changes run without asking the user. Make each one deliberate, and check the result before the next."
    }
    .to_string()];
    if !config.apps.is_empty() {
        let names: Vec<&str> = config.apps.iter().map(|app| app.name.as_str()).collect();
        lines.push(format!("Allowed apps: {}", names.join(", ")));
    }
    if !config.sites.is_empty() {
        let sites: Vec<String> = config
            .sites
            .iter()
            .map(|site| {
                if site.signed_in {
                    format!(
                        "{} (separate profile, or the user's signed-in browser)",
                        site.origin
                    )
                } else {
                    format!("{} (separate profile)", site.origin)
                }
            })
            .collect();
        lines.push(format!("Allowed sites: {}", sites.join(", ")));
        lines.push(
            "Websites: browser_prepare opens the browser. get_browser_state then connects to it and reads the page; its target_id and tab_id go to browser_navigate, browser_click, browser_type and browser_select, and Oleafly fills them in when you leave them out."
                .into(),
        );
        if config.sites.iter().any(|site| site.signed_in) {
            lines.push(
                "Pass browser \"signed_in\" to work in the user's own browser on the sites marked for it."
                    .into(),
            );
        }
    }
    lines
}

fn kind_label(kind: RuntimeKind) -> &'static str {
    match kind {
        RuntimeKind::Desktop => "Apps",
        RuntimeKind::Browser => "Websites in a separate profile",
        RuntimeKind::SignedInBrowser => "Websites in the user's signed-in browser",
    }
}

async fn start_kind(
    state: &CuaDriverState,
    kind: RuntimeKind,
    label: &str,
) -> Result<Vec<McpServerTool>, String> {
    let result = state.runtimes.ensure_session(kind, label).await?;
    if result.get("isError").and_then(Value::as_bool) == Some(true) {
        return Err(outcome_from_result(&result).text);
    }
    state.runtimes.tools(kind).await
}

async fn start_session(
    state: &CuaDriverState,
    config: &CuaDriverConfig,
    label: &str,
) -> DesktopAppsOutcome {
    let kinds = available_kinds(config);
    let exposed = policy::exposed_tools(config);
    let mut sections = vec![format!(
        "Rules:\n{}",
        policy::POLICY_LINES
            .iter()
            .map(|line| format!("- {line}"))
            .collect::<Vec<_>>()
            .join("\n")
    )];
    sections.push(allowed_lines(config).join("\n"));
    let started =
        futures_util::future::join_all(kinds.iter().map(|kind| start_kind(state, *kind, label)))
            .await;
    let mut references = Vec::new();
    let mut failures = Vec::new();
    let mut browser_reference_done = false;
    for (kind, started) in kinds.iter().copied().zip(started) {
        let tools = match started {
            Ok(tools) => tools,
            Err(error) => {
                failures.push(format!("- {}: {}", kind_label(kind), readable(&error)));
                continue;
            }
        };
        let is_browser = kind != RuntimeKind::Desktop;
        if is_browser && browser_reference_done {
            continue;
        }
        let family = if is_browser {
            Family::Browser
        } else {
            Family::Desktop
        };
        let allowed: Vec<&str> = exposed
            .iter()
            .copied()
            .filter(|name| {
                policy::curated(name)
                    .is_some_and(|tool| tool.family == family || tool.family == Family::Session)
            })
            .collect();
        let reference = policy::render_tool_reference(&tools, &allowed);
        if !reference.is_empty() {
            references.push(reference);
        }
        browser_reference_done |= is_browser;
    }
    if failures.len() == kinds.len() {
        log_outcome("start_session", "error");
        let reasons = failures.join("\n");
        return DesktopAppsOutcome::error(format!("Computer Use couldn't start:\n{reasons}"));
    }
    if !references.is_empty() {
        sections.push(format!(
            "Tools (pass these in args):\n{}",
            references.join("\n")
        ));
    }
    if !failures.is_empty() {
        sections.push(format!(
            "Not available right now (the rest works):\n{}",
            failures.join("\n")
        ));
    }
    log_outcome("start_session", "ok");
    DesktopAppsOutcome::text(sections.join("\n\n"), false)
}

fn clean_args(args: Option<&Value>) -> Result<Map<String, Value>, String> {
    match args {
        None | Some(Value::Null) => Ok(Map::new()),
        Some(Value::Object(map)) => Ok(map
            .iter()
            .filter(|(key, _)| !policy::is_private_key(key))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect()),
        Some(_) => Err("args must be an object.".into()),
    }
}

async fn launch_outside_list(
    tool: &'static str,
    args: &Map<String, Value>,
    apps: &[AllowedApp],
) -> Option<&'static str> {
    if tool != "launch_app" {
        return None;
    }
    let (args, apps) = (args.clone(), apps.to_vec());
    tauri::async_runtime::spawn_blocking(move || {
        policy::launch_outside_list(tool, &args, &apps, &|path| {
            super::apps::app_from_bundle(std::path::Path::new(path)).and_then(|app| app.bundle_id)
        })
    })
    .await
    .unwrap_or(Some(policy::OUTSIDE_TEXT))
}

pub(crate) fn project_denied(state: &CuaDriverState, project_id: Option<&str>) -> bool {
    match (project_id, &state.data_root) {
        (Some(project), Some(root)) => {
            crate::approvals::effective_decision_for(root, project, DESKTOP_APPS_TOOL)
                == Some(crate::approvals::ToolDecision::Deny)
        }
        _ => false,
    }
}

fn already_allowed(
    state: &CuaDriverState,
    scope: &CuaScope,
    kind: RuntimeKind,
    tool: &policy::CuratedTool,
    steps: Option<&[policy::Step]>,
) -> bool {
    let grants = lock(&state.grants);
    match steps {
        Some(steps) => steps
            .iter()
            .all(|step| grants.has(&scope.grant_key, &gate::grant_name(kind, &step.tool))),
        None => grants.has(&scope.grant_key, &gate::grant_name(kind, tool.name)),
    }
}

pub(crate) async fn call_desktop_apps(
    state: &CuaDriverState,
    scope: &CuaScope,
    arguments: Value,
) -> DesktopAppsOutcome {
    let Some(object) = arguments.as_object() else {
        return DesktopAppsOutcome::error("desktop_apps needs an object with a tool name.");
    };
    let config = state.settings();
    if !ready(&config) {
        return DesktopAppsOutcome::error(OFF_TEXT);
    }
    let exposed = policy::exposed_tools(&config);
    let tool_name = object
        .get("tool")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let Some(tool) = policy::curated(tool_name).filter(|tool| exposed.contains(&tool.name)) else {
        log_outcome(tool_name, "error");
        if tool_name.is_empty() {
            return DesktopAppsOutcome::error(
                "Put the tool name next to args, not inside them: {\"tool\": \"type_text\", \"args\": {\"pid\": 123, \"text\": \"Hello\"}}.",
            );
        }
        return DesktopAppsOutcome::error(format!(
            "Unknown tool \"{}\". Use one of: {}.",
            policy::bounded(tool_name, 60),
            exposed.join(", ")
        ));
    };
    let args = match clean_args(object.get("args")) {
        Ok(args) => args,
        Err(error) => return DesktopAppsOutcome::error(error),
    };
    let browser = object
        .get("browser")
        .and_then(Value::as_str)
        .unwrap_or("separate");
    if !matches!(browser, "separate" | "signed_in") {
        return DesktopAppsOutcome::error("browser must be \"separate\" or \"signed_in\".");
    }
    let denied = project_denied(state, scope.project_id.as_deref());
    if denied && tool.name == "start_session" {
        log_outcome(tool.name, "refused:approval_rules");
        return DesktopAppsOutcome::error(gate::DENIED_TEXT);
    }
    let label = policy::session_label(&scope.agent_label, &scope.session_key);
    lock(&state.labels).insert(scope.session_key.clone(), label.clone());

    match tool.name {
        "start_session" => return start_session(state, &config, &label).await,
        "end_session" => {
            state.runtimes.end_session(&label).await;
            log_outcome("end_session", "ok");
            return DesktopAppsOutcome::text("Session ended.", false);
        }
        _ => {}
    }

    let kind = match runtime_kind(tool, browser, &config) {
        Ok(kind) => kind,
        Err(text) => return DesktopAppsOutcome::error(text),
    };
    let mut steps = match batch_steps(tool, &args) {
        Ok(steps) => steps,
        Err(error) => {
            log_outcome(tool.name, "error");
            return DesktopAppsOutcome::error(error);
        }
    };
    let args = schema_known_args(state, kind, tool, args, &mut steps);
    if let Some(text) = launch_outside_list(tool.name, &args, &config.apps).await {
        log_outcome(tool.name, "refused:outside_list");
        return DesktopAppsOutcome::error(text);
    }
    let args = if kind == RuntimeKind::Desktop {
        let filled = with_pids(&lock(&state.seen), tool.name, args, &mut steps);
        match filled {
            Ok(args) => args,
            Err(text) => {
                log_outcome(tool.name, "refused:target");
                return DesktopAppsOutcome::error(text);
            }
        }
    } else {
        let filled =
            with_browser_targets(state, scope, &config, kind, &label, tool.name, args).await;
        match filled {
            Ok(args) => args,
            Err(text) => {
                log_outcome(tool.name, "refused:target");
                return DesktopAppsOutcome::error(text);
            }
        }
    };

    let signed_in = kind == RuntimeKind::SignedInBrowser;
    let granted = !signed_in && already_allowed(state, scope, kind, tool, steps.as_deref());
    let skipped_steps =
        match gate::decide(tool, denied, granted, signed_in, config.ask_before_actions) {
            GateDecision::Run => 0,
            GateDecision::Refuse(text) => {
                log_outcome(tool.name, "refused:approval_rules");
                return DesktopAppsOutcome::error(text);
            }
            GateDecision::Ask { session_option } => {
                match ask_approval(state, scope, kind, tool, &args, &mut steps, session_option)
                    .await
                {
                    Ok(skipped) => skipped,
                    Err(text) => return DesktopAppsOutcome::error(text),
                }
            }
        };

    let timeout = if matches!(tool.name, "run_steps" | "run_script") {
        BATCH_TIMEOUT
    } else {
        CALL_TIMEOUT
    };
    let observed_args = Value::Object(args.clone());
    let mut forwarded = forwarded_args(args, steps.as_deref());
    forwarded.insert("session".into(), Value::String(label.clone()));
    let listed = if kind == RuntimeKind::Desktop {
        allowed_listing(state, scope, &config, &label, tool.name, &observed_args).await
    } else {
        None
    };
    let called = match listed {
        Some(Some(listed)) => listed,
        Some(None) => {
            log_outcome(tool.name, "refused:turn_ended");
            return DesktopAppsOutcome::error(STOPPED_AT_TURN_END_TEXT);
        }
        None => {
            let call =
                state
                    .runtimes
                    .call(kind, &label, tool.name, Value::Object(forwarded), timeout);
            let Some(called) = call_until_turn_ends(state, scope, call).await else {
                log_outcome(tool.name, "refused:turn_ended");
                return DesktopAppsOutcome::error(STOPPED_AT_TURN_END_TEXT);
            };
            called
        }
    };
    match called {
        Ok(result) => {
            log_outcome(tool.name, &result_status(&result));
            lock(&state.seen).record(&scope.session_key, kind, tool.name, &observed_args, &result);
            let mut outcome = outcome_with(&result, scope.surface != Surface::Chat);
            if skipped_steps > 0 {
                let ran = steps.as_ref().map_or(0, Vec::len);
                outcome.add_note(&format!(
                    "Only the first {ran} of {} steps ran. The approval dialog had no room for the other {skipped_steps}, so they did not run. Send them again in a smaller run_steps batch.",
                    ran + skipped_steps
                ));
            }
            outcome
        }
        Err(error) => {
            log_outcome(tool.name, "error");
            DesktopAppsOutcome::error(readable(&error))
        }
    }
}

fn matches_app_filter(app: &AllowedApp, filter: Option<&str>) -> bool {
    let Some(filter) = filter.map(str::trim).filter(|filter| !filter.is_empty()) else {
        return true;
    };
    app.name.to_lowercase().contains(&filter.to_lowercase())
        || app
            .bundle_id
            .as_deref()
            .is_some_and(|id| id.eq_ignore_ascii_case(filter))
}

pub(crate) fn allowed_apps_result(apps: &[(AllowedApp, Vec<u32>)]) -> Value {
    let mut lines = vec!["Allowed apps:".to_string()];
    let mut listed = Vec::new();
    for (app, pids) in apps {
        let identity = app
            .bundle_id
            .as_deref()
            .or(app.executable.as_deref())
            .unwrap_or_default();
        let state = if pids.is_empty() {
            "not running. launch_app opens it.".to_string()
        } else {
            let pids: Vec<String> = pids.iter().map(u32::to_string).collect();
            format!(
                "running, pid {}. Call list_windows with that pid.",
                pids.join(", ")
            )
        };
        lines.push(format!("- {} ({identity}): {state}", app.name));
        let mut entry = json!({"name": app.name, "running": !pids.is_empty(), "pids": pids});
        if let Some(bundle_id) = &app.bundle_id {
            entry["bundle_id"] = json!(bundle_id);
        }
        if let Some(executable) = &app.executable {
            entry["executable"] = json!(executable);
        }
        listed.push(entry);
    }
    json!({
        "content": [{"type": "text", "text": lines.join("\n")}],
        "structuredContent": {"apps": listed},
    })
}

pub(crate) fn merged_windows_result(answers: &[Value], any_running: bool) -> Value {
    let windows: Vec<Value> = answers
        .iter()
        .filter(|answer| answer.get("isError").and_then(Value::as_bool) != Some(true))
        .filter_map(|answer| {
            answer
                .pointer("/structuredContent/windows")?
                .as_array()
                .cloned()
        })
        .flatten()
        .collect();
    let text = if !any_running {
        "None of the allowed apps is running. launch_app opens one.".to_string()
    } else if windows.is_empty() {
        "The allowed apps that run have no windows.".to_string()
    } else {
        let mut lines = vec![format!("Found {} window(s).", windows.len())];
        for window in &windows {
            let text = |key: &str| window.get(key).and_then(Value::as_str).unwrap_or_default();
            let number = |key: &str| window.get(key).and_then(Value::as_u64).unwrap_or_default();
            lines.push(format!(
                "- {} (pid {}) \"{}\" [window_id: {}]",
                text("app_name"),
                number("pid"),
                text("title"),
                number("window_id")
            ));
        }
        lines.join("\n")
    };
    json!({
        "content": [{"type": "text", "text": text}],
        "structuredContent": {"windows": windows},
    })
}

/// Cua Driver 0.38 counts a list of every app, or of every window, as
/// watching the whole desktop, which Oleafly's manifests never allow. The
/// allowed apps are known, so Oleafly answers `list_apps` itself and asks for
/// each running allowed app's windows by pid. `None` for every other call;
/// `Some(None)` when the turn ended meanwhile.
async fn allowed_listing(
    state: &CuaDriverState,
    scope: &CuaScope,
    config: &CuaDriverConfig,
    label: &str,
    tool: &str,
    args: &Value,
) -> Option<Option<Result<Value, String>>> {
    let listing_windows = tool == "list_windows" && args.get("pid").is_none();
    if tool != "list_apps" && !listing_windows {
        return None;
    }
    let filter = args.get("app").and_then(Value::as_str).map(str::to_string);
    let apps: Vec<AllowedApp> = config
        .apps
        .iter()
        .filter(|app| !listing_windows || matches_app_filter(app, filter.as_deref()))
        .cloned()
        .collect();
    let found = tauri::async_runtime::spawn_blocking(move || {
        apps.into_iter()
            .map(|app| {
                let pids = running_pids(&app);
                (app, pids)
            })
            .collect::<Vec<_>>()
    })
    .await
    .unwrap_or_default();
    if tool == "list_apps" {
        return Some(Some(Ok(allowed_apps_result(&found))));
    }
    let mut answers = Vec::new();
    for pid in found.iter().flat_map(|(_, pids)| pids) {
        let mut forwarded = json!({"session": label, "pid": pid});
        if let Some(on_screen) = args.get("on_screen_only") {
            forwarded["on_screen_only"] = on_screen.clone();
        }
        let call = state.runtimes.call(
            RuntimeKind::Desktop,
            label,
            "list_windows",
            forwarded,
            CALL_TIMEOUT,
        );
        match call_until_turn_ends(state, scope, call).await {
            None => return Some(None),
            Some(Ok(answer)) => answers.push(answer),
            Some(Err(error)) => return Some(Some(Err(error))),
        }
    }
    let any_running = found.iter().any(|(_, pids)| !pids.is_empty());
    Some(Some(Ok(merged_windows_result(&answers, any_running))))
}

fn runtime_kind(
    tool: &policy::CuratedTool,
    browser: &str,
    config: &CuaDriverConfig,
) -> Result<RuntimeKind, &'static str> {
    match tool.family {
        Family::Desktop => Ok(RuntimeKind::Desktop),
        Family::Browser if browser == "signed_in" => {
            if config.sites.iter().any(|site| site.signed_in) {
                Ok(RuntimeKind::SignedInBrowser)
            } else {
                Err(NO_SIGNED_IN_TEXT)
            }
        }
        Family::Browser | Family::Session => Ok(RuntimeKind::Browser),
    }
}

fn batch_steps(
    tool: &policy::CuratedTool,
    args: &Map<String, Value>,
) -> Result<Option<Vec<policy::Step>>, String> {
    if tool.name != "run_steps" {
        return Ok(None);
    }
    policy::parse_steps(&Value::Object(args.clone())).map(Some)
}

fn schema_known_args(
    state: &CuaDriverState,
    kind: RuntimeKind,
    tool: &policy::CuratedTool,
    args: Map<String, Value>,
    steps: &mut Option<Vec<policy::Step>>,
) -> Map<String, Value> {
    if tool.class != policy::ToolClass::Act {
        return args;
    }
    let known = state.runtimes.known_tools(kind);
    let schema = |name: &str| {
        known
            .iter()
            .find(|known| known.name == name)
            .map(|known| known.input_schema.clone())
    };
    match steps.as_mut() {
        Some(steps) => {
            for step in steps.iter_mut() {
                if let (Some(schema), Value::Object(map)) = (schema(&step.tool), &step.args) {
                    step.args = Value::Object(policy::schema_args(&schema, map.clone()));
                }
            }
            args
        }
        None => match schema(tool.name) {
            Some(schema) => policy::schema_args(&schema, args),
            None => args,
        },
    }
}

/// Cua Driver 0.38 only works in an allowed app's window when the call names
/// the app's process ("window resource did not attest a pid"). Agents often
/// pass just the window_id or element_token they were shown, so the pid the
/// driver gave for it is filled in. A call to one window that still names no
/// process is answered here, before any dialog, and so is an element token
/// from a turn that ended, which the driver would refuse after the user was
/// asked. A batch's steps can name their target by role and name instead, so
/// a batch is only filled in.
fn with_pids(
    seen: &gate::Seen,
    tool: &str,
    mut args: Map<String, Value>,
    steps: &mut Option<Vec<policy::Step>>,
) -> Result<Map<String, Value>, &'static str> {
    let carried_over = seen.names_ended_snapshot(&Value::Object(args.clone()))
        || steps
            .iter()
            .flatten()
            .any(|step| seen.names_ended_snapshot(&step.args));
    if carried_over {
        return Err(policy::EARLIER_TURN_TEXT);
    }
    let Some(steps) = steps.as_mut() else {
        if !policy::targets_window(tool) {
            return Ok(args);
        }
        seen.fill_pid(&mut args);
        return if gate::names_pid(&args) {
            Ok(args)
        } else {
            Err(policy::NEEDS_PID_TEXT)
        };
    };
    for step in steps.iter_mut() {
        if let Value::Object(map) = &mut step.args {
            seen.fill_pid(map);
        }
    }
    seen.fill_pid(&mut args);
    if !gate::names_pid(&args) && !args.contains_key("app") {
        let mut pids = steps
            .iter()
            .filter_map(|step| step.args.get("pid").and_then(Value::as_u64));
        if let Some(first) = pids.next() {
            if pids.all(|pid| pid == first) {
                args.insert("pid".into(), Value::from(first));
            }
        }
    }
    Ok(args)
}

/// Fills in what a 0.38 browser call needs and the agent left out (see
/// `browser`), and answers here, before any dialog, a page outside the list
/// and, in the separate profile, a browser Oleafly didn't open.
async fn with_browser_targets(
    state: &CuaDriverState,
    scope: &CuaScope,
    config: &CuaDriverConfig,
    kind: RuntimeKind,
    label: &str,
    tool: &str,
    mut args: Map<String, Value>,
) -> Result<Map<String, Value>, &'static str> {
    let seen = lock(&state.seen)
        .browser(&scope.session_key, kind)
        .cloned()
        .unwrap_or_default();
    match tool {
        "browser_prepare" => {
            browser::prepare_defaults(kind, &mut args);
            // The user's own browser is attached at the window the last
            // bind named, as the driver's refusal of that bind asks.
            if kind == RuntimeKind::SignedInBrowser && !args.contains_key("pid") {
                if let Some((pid, window_id)) = seen.window {
                    args.insert("pid".into(), Value::from(pid));
                    args.entry("window_id")
                        .or_insert_with(|| Value::from(window_id));
                    args.entry("strategy")
                        .or_insert_with(|| json!({"kind": "existing_profile"}));
                }
            }
        }
        "browser_navigate" | "browser_click" | "browser_type" | "browser_select" => {
            if tool == "browser_navigate" {
                let url = args.get("url").and_then(Value::as_str).unwrap_or_default();
                if !browser::site_allowed(config, kind, url) {
                    return Err(policy::OUTSIDE_TEXT);
                }
            }
            fill_tab(&seen, &mut args);
            if !args.contains_key("target_id") {
                return Err(browser::BIND_FIRST_TEXT);
            }
        }
        "get_browser_state" => {
            let binding = !args.contains_key("target_id")
                && (args.contains_key("pid") || seen.target.is_none());
            if binding {
                bind_args(state, scope, kind, label, &seen, &mut args).await?;
            } else {
                fill_tab(&seen, &mut args);
                args.entry("snapshot_format")
                    .or_insert_with(|| Value::from("semantic_v2"));
            }
        }
        _ => {}
    }
    Ok(args)
}

fn fill_tab(seen: &SeenBrowser, args: &mut Map<String, Value>) {
    let Some(target) = seen.target.as_deref() else {
        return;
    };
    args.entry("target_id")
        .or_insert_with(|| Value::from(target));
    let same_target = args.get("target_id").and_then(Value::as_str) == Some(target);
    if let (true, Some(tab)) = (same_target, seen.tab.as_deref()) {
        args.entry("tab_id").or_insert_with(|| Value::from(tab));
    }
}

async fn bind_args(
    state: &CuaDriverState,
    scope: &CuaScope,
    kind: RuntimeKind,
    label: &str,
    seen: &SeenBrowser,
    args: &mut Map<String, Value>,
) -> Result<(), &'static str> {
    let named = args.get("pid").and_then(Value::as_u64);
    let pids = match (kind, named) {
        (RuntimeKind::Browser, Some(pid)) if Some(pid) != seen.prepared => {
            return Err(browser::OWN_BROWSER_TEXT)
        }
        (_, Some(pid)) => vec![pid],
        (RuntimeKind::Browser, None) => vec![seen.prepared.ok_or(browser::PREPARE_FIRST_TEXT)?],
        (_, None) => {
            let running = tauri::async_runtime::spawn_blocking(|| {
                browser::known_browsers()
                    .iter()
                    .flat_map(running_pids)
                    .map(u64::from)
                    .collect::<Vec<_>>()
            })
            .await
            .unwrap_or_default();
            if running.is_empty() {
                return Err(browser::NO_BROWSER_TEXT);
            }
            running
        }
    };
    if args.contains_key("window_id") {
        args.entry("pid").or_insert_with(|| Value::from(pids[0]));
        return Ok(());
    }
    for pid in pids {
        let call = state.runtimes.call(
            kind,
            label,
            "list_windows",
            json!({"session": label, "pid": pid}),
            CALL_TIMEOUT,
        );
        let Some(answer) = call_until_turn_ends(state, scope, call).await else {
            return Err(STOPPED_AT_TURN_END_TEXT);
        };
        if let Some(window_id) = answer.ok().as_ref().and_then(browser::main_window) {
            args.insert("pid".into(), Value::from(pid));
            args.insert("window_id".into(), Value::from(window_id));
            lock(&state.seen).note_browser_window(&scope.session_key, kind, pid, window_id);
            return Ok(());
        }
    }
    Err(browser::NO_WINDOW_TEXT)
}

async fn ask_approval(
    state: &CuaDriverState,
    scope: &CuaScope,
    kind: RuntimeKind,
    tool: &policy::CuratedTool,
    args: &Map<String, Value>,
    steps: &mut Option<Vec<policy::Step>>,
    session_option: bool,
) -> Result<usize, &'static str> {
    let context = dialog_context(state, scope, args, steps.as_deref());
    let approval = gate::approval_message(
        &scope.agent_label,
        tool,
        &Value::Object(args.clone()),
        steps.as_deref(),
        kind == RuntimeKind::SignedInBrowser,
        &context,
        &|key, params| crate::i18n::t_with(key, params),
    );
    if steps.is_some() && approval.shown_steps == 0 {
        log_outcome(tool.name, "error");
        return Err(BATCH_TOO_LONG_TEXT);
    }
    let mut ended = state.turn_signal(&scope.session_key);
    let answer = tokio::select! {
        biased;
        _ = ended.wait_for(|ended| *ended) => None,
        answer = state.approver.ask(
            scope,
            approval.message,
            session_option,
            gate::approval_wait(scope.surface),
        ) => Some(answer),
    };
    let Some(answer) = answer else {
        log_outcome(tool.name, "refused:turn_ended");
        return Err(TURN_ENDED_TEXT);
    };
    match answer {
        Answer::Deny => {
            log_outcome(tool.name, "refused:user");
            return Err(DECLINED_TEXT);
        }
        Answer::Unanswered => {
            log_outcome(tool.name, "refused:no_answer");
            return Err(NO_ANSWER_TEXT);
        }
        _ if *ended.borrow() => {
            log_outcome(tool.name, "refused:turn_ended");
            return Err(TURN_ENDED_TEXT);
        }
        _ if !ready(&state.settings()) => {
            log_outcome(tool.name, "refused:off");
            return Err(OFF_TEXT);
        }
        Answer::Session if session_option => grant_for_session(
            state,
            scope,
            kind,
            tool,
            steps.as_deref(),
            approval.shown_steps,
        ),
        Answer::Session | Answer::Once => {}
    }
    let Some(steps) = steps.as_mut() else {
        return Ok(0);
    };
    let skipped = steps.len().saturating_sub(approval.shown_steps);
    steps.truncate(approval.shown_steps);
    Ok(skipped)
}

fn grant_for_session(
    state: &CuaDriverState,
    scope: &CuaScope,
    kind: RuntimeKind,
    tool: &policy::CuratedTool,
    steps: Option<&[policy::Step]>,
    shown_steps: usize,
) {
    let mut grants = lock(&state.grants);
    match steps {
        Some(steps) => {
            for step in steps.iter().take(shown_steps) {
                grants.grant(&scope.grant_key, &gate::grant_name(kind, &step.tool));
            }
        }
        None => grants.grant(&scope.grant_key, &gate::grant_name(kind, tool.name)),
    }
}

fn forwarded_args(args: Map<String, Value>, steps: Option<&[policy::Step]>) -> Map<String, Value> {
    match steps {
        Some(steps) => match policy::steps_payload(&Value::Object(args), steps) {
            Value::Object(map) => map,
            _ => Map::new(),
        },
        None => args,
    }
}

async fn call_until_turn_ends(
    state: &CuaDriverState,
    scope: &CuaScope,
    call: impl std::future::Future<Output = Result<Value, String>>,
) -> Option<Result<Value, String>> {
    if scope.surface == Surface::Chat {
        return Some(call.await);
    }
    let mut ended = state.turn_signal(&scope.session_key);
    tokio::select! {
        biased;
        _ = ended.wait_for(|ended| *ended) => None,
        result = call => Some(result),
    }
}

fn dialog_context(
    state: &CuaDriverState,
    scope: &CuaScope,
    args: &Map<String, Value>,
    steps: Option<&[policy::Step]>,
) -> gate::DialogContext {
    let seen = lock(&state.seen);
    gate::DialogContext {
        task: scope.task_title.clone(),
        target: seen.target(&Value::Object(args.clone())),
        steps: steps
            .into_iter()
            .flatten()
            .map(|step| seen.target(&step.args))
            .collect(),
        origin: seen.origin(&scope.session_key),
    }
}

pub(crate) fn turn_ended_in(state: &Arc<CuaDriverState>, session_key: &str) {
    state.end_turn(session_key);
    lock(&state.seen).forget_session(session_key);
    let Some(label) = lock(&state.labels).remove(session_key) else {
        return;
    };
    let state = state.clone();
    super::spawn_background(async move {
        state.runtimes.end_session(&label).await;
    });
}

#[cfg(test)]
pub(crate) static TEST_ACP_TURN_ENDS: std::sync::Mutex<Vec<String>> =
    std::sync::Mutex::new(Vec::new());

pub(crate) fn acp_turn_ended(acp_session_id: &str) {
    let Some(state) = global() else {
        #[cfg(test)]
        lock(&TEST_ACP_TURN_ENDS).push(acp_session_id.to_string());
        return;
    };
    let key = lock(&state.acp).get(acp_session_id).cloned();
    if let Some(key) = key {
        turn_ended_in(&state, &key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oleafly_lists_the_allowed_apps_with_their_processes() {
        let textedit = AllowedApp {
            name: "TextEdit".into(),
            bundle_id: Some("com.apple.TextEdit".into()),
            executable: None,
        };
        let stata = AllowedApp {
            name: "Stata".into(),
            bundle_id: None,
            executable: Some(r"C:\Program Files\Stata 18\StataSE-64.exe".into()),
        };
        let result =
            allowed_apps_result(&[(textedit.clone(), vec![52508]), (stata.clone(), vec![])]);
        let text = result["content"][0]["text"].as_str().unwrap();
        assert!(
            text.contains("TextEdit (com.apple.TextEdit): running, pid 52508"),
            "{text}"
        );
        assert!(
            text.contains("Stata (C:\\Program Files\\Stata 18\\StataSE-64.exe): not running"),
            "{text}"
        );
        assert_eq!(
            result["structuredContent"]["apps"][0]["pids"],
            json!([52508])
        );
        assert_eq!(
            result["structuredContent"]["apps"][1]["running"],
            json!(false)
        );
        assert!(matches_app_filter(&textedit, Some("text")));
        assert!(matches_app_filter(&textedit, Some("COM.APPLE.TEXTEDIT")));
        assert!(!matches_app_filter(&textedit, Some("com.apple")));
        assert!(matches_app_filter(&stata, None));
    }

    #[test]
    fn windows_of_each_allowed_process_come_back_as_one_answer() {
        // cua-driver 0.38.0, `list_windows {pid}`, trimmed.
        let textedit = json!({"content": [{"type": "text", "text": "Found 1 window(s)."}], "structuredContent": {"windows": [
            {"app_name": "TextEdit", "pid": 52508, "title": "Untitled", "window_id": 178776}
        ]}});
        let refused = json!({"isError": true, "structuredContent": {"refusal": {"code": "bounded_resource_outside_manifest"}, "windows": [
            {"app_name": "Other", "pid": 1, "title": "x", "window_id": 2}
        ]}});
        let merged = merged_windows_result(&[textedit, refused], true);
        let text = merged["content"][0]["text"].as_str().unwrap();
        assert!(text.starts_with("Found 1 window(s)."), "{text}");
        assert!(
            text.contains("- TextEdit (pid 52508) \"Untitled\" [window_id: 178776]"),
            "{text}"
        );
        assert_eq!(
            merged["structuredContent"]["windows"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let none = merged_windows_result(&[], false);
        assert!(none["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("None of the allowed apps is running"));
    }

    #[test]
    fn a_page_read_reaches_a_chat_as_text() {
        let semantic = json!({"content": [{"type": "text", "text": "semantic snapshot p2: 1 action ref(s), 13 content ref(s)"}],
            "structuredContent": {"outline": "- heading \"Example Domain\"\n- paragraph",
                "content_refs": [{"ref": "p2:0", "role": "rootwebarea", "name": "Example Domain"}],
                "action_refs": [{"ref": "p2:9", "role": "link", "name": "Learn more"}]}});
        let text = outcome_from_result(&semantic).text;
        assert!(
            text.contains("Title: Example Domain\nPage:\n- heading \"Example Domain\""),
            "{text}"
        );
        assert!(text.contains("- p2:9 link \"Learn more\""), "{text}");
        let links = json!({"content": [{"type": "text", "text": "snapshot p1: 1 interactive element(s)"}],
            "structuredContent": {"refs": [{"ref": "p1:2", "node": "a", "label": "href=https://iana.org"}]}});
        assert!(outcome_from_result(&links)
            .text
            .contains("- p1:2 a \"href=https://iana.org\""));
    }

    #[test]
    fn images_become_data_urls_and_refusals_become_plain_text() {
        let window = json!({"content": [
            {"type": "text", "text": "Zotero window"},
            {"type": "image", "mimeType": "image/png", "data": "iVBORw0KGgo="}
        ]});
        let outcome = outcome_from_result(&window);
        assert_eq!(outcome.text, "Zotero window");
        assert!(outcome.images[0].starts_with("data:image/png;base64,"));
        assert!(!outcome.is_error);
        assert_eq!(outcome.mcp_result["content"][1]["type"], "image");

        let refused = json!({"isError": true, "structuredContent": {"status": "refused",
            "refusal": {"code": "bounded_resource_outside_manifest", "message": "app"}}});
        let outcome = outcome_from_result(&refused);
        assert!(outcome.is_error);
        assert_eq!(
            outcome.text,
            "That app or site isn't on the user's allowed list. Ask the user to add it in Settings > Integrations > Computer Use."
        );
        assert_eq!(outcome.mcp_result["isError"], true);
    }

    #[test]
    fn oversized_and_unknown_images_are_left_out_with_a_notice() {
        let huge = "A".repeat(MAX_IMAGE_DATA_URL_BYTES);
        let result = json!({"content": [
            {"type": "image", "mimeType": "image/png", "data": huge},
            {"type": "image", "mimeType": "image/tiff", "data": "AAAA"}
        ]});
        let outcome = outcome_from_result(&result);
        assert!(outcome.images.is_empty());
        assert!(
            outcome.text.contains("2 screenshot(s) were left out"),
            "{}",
            outcome.text
        );
        assert_eq!(outcome.mcp_result["content"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn private_and_session_keys_never_reach_the_driver() {
        let args = clean_args(Some(
            &json!({"__cuaSession": "x", "session": "other", "pid": 3}),
        ))
        .unwrap();
        assert_eq!(Value::Object(args), json!({"pid": 3}));
        assert!(clean_args(Some(&json!("text"))).is_err());
        assert!(clean_args(None).unwrap().is_empty());
    }
}
