//! `desktop_apps {tool, args, browser?}`, the one entry point every agent
//! surface uses: it checks the call, asks through the gate (before any
//! runtime lock), labels the session, runs the call on the right runtime and
//! turns the result into tool output.
//!
//! The app log gets only `desktop apps: <tool> <ok|refused:<code>|error>`,
//! never arguments or typed text.

use std::sync::Arc;

use serde_json::{json, Map, Value};

use super::config::{ready, CuaDriverConfig};
use super::gate::{self, Answer, GateDecision};
use super::policy::{self, Family};
use super::runtime::{BATCH_TIMEOUT, CALL_TIMEOUT};
use super::{global, lock, log, CuaDriverState, CuaScope, RuntimeKind, Surface, DESKTOP_APPS_TOOL};
use crate::mcp::client::McpServerTool;

/// The largest image (as a data URL) the agent accepts in a tool result.
const MAX_IMAGE_DATA_URL_BYTES: usize = 14 * 1024 * 1024;
const IMAGE_TYPES: &[&str] = &["image/png", "image/jpeg", "image/webp", "image/gif"];

const OFF_TEXT: &str =
    "Desktop apps are off. The user can turn them on in Settings > Integrations > Desktop apps.";
const DECLINED_TEXT: &str = "The user didn't allow this action.";
const TURN_ENDED_TEXT: &str = "The turn ended before the user answered, so nothing was done.";
const NO_SIGNED_IN_TEXT: &str = "No website is marked for the user's signed-in browser. Use browser \"separate\", or ask the user to mark the site in Settings > Integrations > Desktop apps.";

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DesktopAppsOutcome {
    pub text: String,
    /// `data:` URLs.
    pub images: Vec<String>,
    pub is_error: bool,
    /// The same, as an MCP `tools/call` result (images kept) for the bridge.
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
}

/// An error string as the model should read it: AppError envelopes in
/// English, everything else as is.
fn readable(error: &str) -> String {
    crate::app_error::english(error).unwrap_or_else(|| error.to_string())
}

/// Text parts joined, images as data URLs (oversized ones left out with a
/// notice), and refusals as plain text the model can act on. Keeps the whole
/// result as an MCP result too, for the bridge.
pub(crate) fn outcome_from_result(result: &Value) -> DesktopAppsOutcome {
    outcome_with(result, true)
}

/// `outcome_from_result`; `keep_mcp: false` leaves `mcp_result` null, so a
/// screenshot is not held a third time when nothing will read it.
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

/// The kinds that have something to do with these settings.
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
    let mut lines = Vec::new();
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

/// Starts one runtime and the label's session on it, and reads its tools.
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

/// The rules, what is allowed and how to call each tool. Each runtime the
/// settings need starts on its own: one that can't start is listed with its
/// reason, and the rest still work.
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
        return DesktopAppsOutcome::error(format!("Desktop apps couldn't start:\n{reasons}"));
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

/// Strips private keys (`__…`) and any `session` the model sent: Oleafly
/// sets the session itself.
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

/// Whether the project's approval rules deny desktop apps.
pub(crate) fn project_denied(state: &CuaDriverState, project_id: Option<&str>) -> bool {
    match (project_id, &state.data_root) {
        (Some(project), Some(root)) => {
            crate::approvals::effective_decision_for(root, project, DESKTOP_APPS_TOOL)
                == Some(crate::approvals::ToolDecision::Deny)
        }
        _ => false,
    }
}

/// Whether the user already allowed everything this call does for the
/// chat, session or task. A batch counts when each of its steps' tools is
/// allowed, the same as if they came one by one.
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

/// One `desktop_apps` call from any surface.
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
    // A project that denies desktop apps gets nothing, not even a session.
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

    let kind = match tool.family {
        Family::Desktop => RuntimeKind::Desktop,
        Family::Browser if browser == "signed_in" => {
            if !config.sites.iter().any(|site| site.signed_in) {
                return DesktopAppsOutcome::error(NO_SIGNED_IN_TEXT);
            }
            RuntimeKind::SignedInBrowser
        }
        Family::Browser | Family::Session => RuntimeKind::Browser,
    };
    let steps = if tool.name == "run_steps" {
        match policy::parse_steps(&Value::Object(args.clone())) {
            Ok(steps) => Some(steps),
            Err(error) => {
                log_outcome(tool.name, "error");
                return DesktopAppsOutcome::error(error);
            }
        }
    } else {
        None
    };

    let signed_in = kind == RuntimeKind::SignedInBrowser;
    let granted = !signed_in && already_allowed(state, scope, kind, tool, steps.as_deref());
    match gate::decide(tool, denied, granted, signed_in) {
        GateDecision::Run => {}
        GateDecision::Refuse(text) => {
            log_outcome(tool.name, "refused:approval_rules");
            return DesktopAppsOutcome::error(text);
        }
        GateDecision::Ask { session_option } => {
            let approval = gate::approval_message(
                &scope.agent_label,
                tool,
                &Value::Object(args.clone()),
                steps.as_deref(),
                signed_in,
                &|key, params| crate::i18n::t_with(key, params),
            );
            // The dialog stays up until answered; the turn it belongs to may
            // end first (Stop, a timeout), and then nothing runs.
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
                return DesktopAppsOutcome::error(TURN_ENDED_TEXT);
            };
            match answer {
                Answer::Deny => {
                    log_outcome(tool.name, "refused:user");
                    return DesktopAppsOutcome::error(DECLINED_TEXT);
                }
                _ if *ended.borrow() => {
                    log_outcome(tool.name, "refused:turn_ended");
                    return DesktopAppsOutcome::error(TURN_ENDED_TEXT);
                }
                Answer::Session if session_option => {
                    let mut grants = lock(&state.grants);
                    match steps.as_deref() {
                        // Only the steps the dialog listed were seen.
                        Some(steps) => {
                            for step in steps.iter().take(approval.shown_steps) {
                                grants.grant(&scope.grant_key, &gate::grant_name(kind, &step.tool));
                            }
                        }
                        None => grants.grant(&scope.grant_key, &gate::grant_name(kind, tool.name)),
                    }
                }
                Answer::Session | Answer::Once => {}
            }
        }
    }

    let timeout = if matches!(tool.name, "run_steps" | "run_script") {
        BATCH_TIMEOUT
    } else {
        CALL_TIMEOUT
    };
    // A batch runs exactly the steps that were checked and shown.
    let mut forwarded = match &steps {
        Some(steps) => match policy::steps_payload(&Value::Object(args), steps) {
            Value::Object(map) => map,
            _ => Map::new(),
        },
        None => args,
    };
    forwarded.insert("session".into(), Value::String(label.clone()));
    match state
        .runtimes
        .call(kind, &label, tool.name, Value::Object(forwarded), timeout)
        .await
    {
        Ok(result) => {
            log_outcome(tool.name, &result_status(&result));
            outcome_with(&result, scope.surface != Surface::Chat)
        }
        Err(error) => {
            log_outcome(tool.name, "error");
            DesktopAppsOutcome::error(readable(&error))
        }
    }
}

/// Ends the Cua session a turn used, if it used one. Runs in the background.
pub(crate) fn turn_ended_in(state: &Arc<CuaDriverState>, session_key: &str) {
    // A call still waiting on the user's answer stops waiting.
    state.end_turn(session_key);
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

/// An ACP session's turn ended: end the Cua session of its bridge.
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
            "That app or site isn't on the user's allowed list. Ask the user to add it in Settings > Integrations > Desktop apps."
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
