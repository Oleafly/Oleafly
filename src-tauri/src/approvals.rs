use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

// Persisted per-project tool-approval decisions: ~/.oleafly/approvals.toml.
// The webview consults these before running a tool (allow skips the prompt,
// deny skips execution entirely); agent_tool_result re-checks deny as
// defense-in-depth so a compromised webview cannot smuggle a denied tool's
// output back into the model context.

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolDecision {
    Allow,
    Deny,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalMode {
    AskForApproval,
    #[default]
    ApproveForMe,
    FullAccess,
    Custom,
}

#[derive(Default, Serialize, Deserialize)]
struct ApprovalsFile {
    #[serde(
        default,
        rename = "$approval_modes",
        skip_serializing_if = "BTreeMap::is_empty"
    )]
    modes: BTreeMap<String, ApprovalMode>,
    #[serde(flatten)]
    decisions: BTreeMap<String, BTreeMap<String, ToolDecision>>,
}

impl ApprovalsFile {
    fn mode_for(&self, project_id: &str) -> ApprovalMode {
        if let Some(mode) = self.modes.get(project_id) {
            return *mode;
        }
        if self
            .decisions
            .get(project_id)
            .is_some_and(|decisions| !decisions.is_empty())
        {
            ApprovalMode::Custom
        } else {
            ApprovalMode::ApproveForMe
        }
    }
}

static APPROVALS_WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Every tool name a rule can match: the assistant's tools, helper agents'
/// and the MCP server's. Tools from connected MCP servers are named
/// `mcp_ext_<server>_<tool>_<hash>`. Tests in src/lib/mcp-bridge.test.ts and
/// packages/ai-tools/src/known-tools.test.ts keep this list in step with the
/// tools the MCP bridge and the in-app chat register.
const KNOWN_TOOLS: &[&str] = &[
    "close_agent",
    "compile",
    "computer_use",
    "create_file",
    "delete_file",
    "followup_task",
    "forget_note",
    "get_log",
    "get_pdf_text",
    "get_status",
    "get_todos",
    "import_overleaf_projects",
    "insert_figure",
    "interrupt_agent",
    "list_agents",
    "list_files",
    "list_notes",
    "list_overleaf_projects",
    "list_projects",
    "list_research_root_files",
    "list_research_roots",
    "list_skills",
    "literature_search",
    "load_image",
    "load_skill",
    "open_project",
    "preview_figure",
    "project_library_search",
    "project_map",
    "read_file",
    "read_research_root_file",
    "read_skill_file",
    "remember_note",
    "rename_file",
    "replace_in_file",
    "run_command",
    "search_project",
    "send_message",
    "set_main_doc",
    "show_location",
    "spawn_agent",
    "toggle_theme",
    "update_todos",
    "verify_citation",
    "verify_pdf_pages",
    "wait_agent",
    "write_file",
];

const MCP_TOOL_PREFIX: &str = "mcp_ext_";

/// A rule whose tool name matches no tool, with the closest real name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnknownTool {
    pub name: String,
    pub suggestion: Option<&'static str>,
}

fn edit_distance(left: &str, right: &str) -> usize {
    let right: Vec<char> = right.chars().collect();
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    for (row, left_char) in left.chars().enumerate() {
        let mut current = vec![row + 1];
        for (column, right_char) in right.iter().enumerate() {
            let replace = previous[column] + usize::from(left_char != *right_char);
            current.push(
                replace
                    .min(previous[column + 1] + 1)
                    .min(current[column] + 1),
            );
        }
        previous = current;
    }
    previous[right.len()]
}

fn closest_tool(name: &str) -> Option<&'static str> {
    let normalized = name
        .trim()
        .to_ascii_lowercase()
        .replace(['-', ' ', '.'], "_");
    KNOWN_TOOLS
        .iter()
        .map(|known| (edit_distance(&normalized, known), *known))
        .filter(|(distance, _)| *distance <= 2)
        .min_by_key(|(distance, _)| *distance)
        .map(|(_, known)| known)
}

/// One entry per unknown name, however many projects use it.
fn unknown_tools(approvals: &ApprovalsFile) -> Vec<UnknownTool> {
    approvals
        .decisions
        .values()
        .flat_map(|tools| tools.keys())
        .filter(|tool| !KNOWN_TOOLS.contains(&tool.as_str()) && !tool.starts_with(MCP_TOOL_PREFIX))
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .map(|tool| UnknownTool {
            name: tool.clone(),
            suggestion: closest_tool(tool),
        })
        .collect()
}

fn unknown_tool_warning(unknown: &UnknownTool) -> String {
    match unknown.suggestion {
        Some(suggestion) => crate::i18n::t_with(
            "approvals.unknownToolSuggestion",
            &[("name", &unknown.name), ("suggestion", suggestion)],
        ),
        None => crate::i18n::t_with("approvals.unknownTool", &[("name", &unknown.name)]),
    }
}

fn approvals_path(root: &Path) -> PathBuf {
    root.join("approvals.toml")
}

fn read_file(root: &Path) -> Result<ApprovalsFile, String> {
    let raw = match std::fs::read_to_string(approvals_path(root)) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ApprovalsFile::default());
        }
        Err(error) => return Err(format!("failed to read approvals: {error}")),
    };
    toml::from_str(&raw).map_err(|error| format!("failed to parse approvals: {error}"))
}

fn write_file(root: &Path, approvals: &ApprovalsFile) -> Result<(), String> {
    let raw = toml::to_string_pretty(approvals)
        .map_err(|e| format!("failed to encode approvals: {e}"))?;
    std::fs::create_dir_all(root).map_err(|e| format!("failed to create data dir: {e}"))?;
    let tmp = approvals_path(root).with_extension("toml.tmp");
    std::fs::write(&tmp, raw).map_err(|e| format!("failed to write approvals: {e}"))?;
    crate::sandbox::replace_file(&tmp, &approvals_path(root))
        .map_err(|e| format!("failed to replace approvals: {e}"))
}

#[cfg(test)]
pub fn decisions_for(root: &Path, project_id: &str) -> BTreeMap<String, ToolDecision> {
    try_decisions_for(root, project_id).unwrap_or_default()
}

fn try_decisions_for(
    root: &Path,
    project_id: &str,
) -> Result<BTreeMap<String, ToolDecision>, String> {
    Ok(read_file(root)?
        .decisions
        .remove(project_id)
        .unwrap_or_default())
}

#[cfg(test)]
pub fn decision_for(root: &Path, project_id: &str, tool: &str) -> Option<ToolDecision> {
    decisions_for(root, project_id).remove(tool)
}

#[cfg(test)]
pub fn mode_for(root: &Path, project_id: &str) -> ApprovalMode {
    try_mode_for(root, project_id).unwrap_or(ApprovalMode::Custom)
}

fn try_mode_for(root: &Path, project_id: &str) -> Result<ApprovalMode, String> {
    Ok(read_file(root)?.mode_for(project_id))
}

pub fn policy_for(
    root: &Path,
    project_id: &str,
    tool: &str,
) -> Result<(ApprovalMode, Option<ToolDecision>), String> {
    let approvals = read_file(root)?;
    let mode = approvals.mode_for(project_id);
    let decision = approvals
        .decisions
        .get(project_id)
        .and_then(|decisions| decisions.get(tool))
        .copied()
        .filter(|decision| *decision == ToolDecision::Deny || mode == ApprovalMode::Custom);
    Ok((mode, decision))
}

pub fn effective_decision_for(root: &Path, project_id: &str, tool: &str) -> Option<ToolDecision> {
    match policy_for(root, project_id, tool) {
        Ok((_, decision)) => decision,
        Err(_) => Some(ToolDecision::Deny),
    }
}

/// The Oleafly tools whose rules cover an ACP agent's permission request of
/// this kind.
fn tools_for_acp_kind(kind: Option<&str>) -> &'static [&'static str] {
    match kind {
        Some("execute") => &["run_command"],
        Some("edit") => &["write_file", "replace_in_file", "create_file"],
        Some("delete") => &["delete_file"],
        Some("move") => &["rename_file"],
        Some("read") => &["read_file"],
        Some("search") => &["search_project"],
        _ => &[],
    }
}

/// The tool whose deny rule refuses an ACP agent's permission request of this
/// kind, if any. A file that can't be read denies, as everywhere else.
pub fn acp_request_denied_by(
    root: &Path,
    project_id: &str,
    kind: Option<&str>,
) -> Option<&'static str> {
    tools_for_acp_kind(kind)
        .iter()
        .copied()
        .find(|tool| effective_decision_for(root, project_id, tool) == Some(ToolDecision::Deny))
}

/// Whether Full access approves a helper agent's permission request of this
/// kind without asking. A kind no tool's rules cover, such as fetch, think or
/// none at all, asks while the project has any deny rule, because the request
/// may do what a rule forbids. An unreadable file asks.
pub fn helper_request_auto_approved(root: &Path, project_id: &str, kind: Option<&str>) -> bool {
    let Ok(approvals) = read_file(root) else {
        return false;
    };
    if approvals.mode_for(project_id) != ApprovalMode::FullAccess {
        return false;
    }
    let has_deny_rule = approvals
        .decisions
        .get(project_id)
        .is_some_and(|decisions| decisions.values().any(|d| *d == ToolDecision::Deny));
    !tools_for_acp_kind(kind).is_empty() || !has_deny_rule
}

pub fn set_mode(root: &Path, project_id: &str, mode: ApprovalMode) -> Result<(), String> {
    let _guard = APPROVALS_WRITE_LOCK
        .lock()
        .map_err(|_| "approval settings write lock is unavailable".to_string())?;
    let mut approvals = read_file(root)?;
    approvals.modes.insert(project_id.to_string(), mode);
    write_file(root, &approvals)
}

pub fn set_decision(
    root: &Path,
    project_id: &str,
    tool: &str,
    decision: Option<ToolDecision>,
) -> Result<(), String> {
    let _guard = APPROVALS_WRITE_LOCK
        .lock()
        .map_err(|_| "approval settings write lock is unavailable".to_string())?;
    let mut approvals = read_file(root)?;
    match decision {
        Some(decision) => {
            approvals
                .decisions
                .entry(project_id.to_string())
                .or_default()
                .insert(tool.to_string(), decision);
        }
        None => {
            if let Some(project) = approvals.decisions.get_mut(project_id) {
                project.remove(tool);
                if project.is_empty() {
                    approvals.decisions.remove(project_id);
                }
            }
        }
    }
    write_file(root, &approvals)
}

pub fn revoke_project_grants(root: &Path, project_id: &str) -> Result<bool, String> {
    let _guard = APPROVALS_WRITE_LOCK
        .lock()
        .map_err(|_| "approval settings write lock is unavailable".to_string())?;
    let mut approvals = read_file(root)?;
    let mut changed = approvals.modes.remove(project_id).is_some();
    if let Some(project) = approvals.decisions.get_mut(project_id) {
        let before = project.len();
        project.retain(|_, decision| *decision == ToolDecision::Deny);
        changed |= project.len() != before;
        if project.is_empty() {
            approvals.decisions.remove(project_id);
        }
    }
    if changed {
        write_file(root, &approvals)?;
    }
    Ok(changed)
}

pub fn read_raw(root: &Path) -> Result<String, String> {
    match std::fs::read_to_string(approvals_path(root)) {
        Ok(raw) => Ok(raw),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(format!("failed to read approvals: {error}")),
    }
}

/// Saves the rules file as written. Rules that name no tool still save, since
/// an MCP server can add tools later, and come back so the editor can say so.
pub fn write_raw(root: &Path, text: &str) -> Result<Vec<UnknownTool>, String> {
    let _guard = APPROVALS_WRITE_LOCK
        .lock()
        .map_err(|_| "approvals are being written by another task".to_string())?;
    let parsed: ApprovalsFile =
        toml::from_str(text).map_err(|error| format!("The file is not valid: {error}"))?;
    for (project, tools) in &parsed.decisions {
        if project.trim().is_empty() {
            return Err("A project table needs a project id as its name.".to_string());
        }
        for tool in tools.keys() {
            if tool.trim().is_empty() {
                return Err(format!("A rule under [{project}] has an empty tool name."));
            }
        }
    }
    std::fs::create_dir_all(root).map_err(|e| format!("failed to create data dir: {e}"))?;
    let tmp = approvals_path(root).with_extension("toml.tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("failed to write approvals: {e}"))?;
    crate::sandbox::replace_file(&tmp, &approvals_path(root))
        .map_err(|e| format!("failed to replace approvals: {e}"))?;
    Ok(unknown_tools(&parsed))
}

#[tauri::command]
pub fn approvals_read_raw() -> Result<String, String> {
    read_raw(&crate::paths::oleafly_root()?)
}

/// Saves the rules file and returns a warning for each rule that names no
/// tool, ready to show next to the saved message.
#[tauri::command]
pub fn approvals_write_raw(text: String) -> Result<Vec<String>, String> {
    let unknown = write_raw(&crate::paths::oleafly_root()?, &text)?;
    Ok(unknown.iter().map(unknown_tool_warning).collect())
}

#[tauri::command]
pub fn approvals_list(project_id: String) -> Result<BTreeMap<String, ToolDecision>, String> {
    crate::paths::validate_project_id(&project_id)?;
    try_decisions_for(&crate::paths::oleafly_root()?, &project_id)
}

#[tauri::command]
pub fn approvals_set(
    project_id: String,
    tool: String,
    decision: Option<ToolDecision>,
) -> Result<(), String> {
    crate::paths::validate_project_id(&project_id)?;
    set_decision(&crate::paths::oleafly_root()?, &project_id, &tool, decision)
}

#[tauri::command]
pub fn approvals_mode_get(project_id: String) -> Result<ApprovalMode, String> {
    crate::paths::validate_project_id(&project_id)?;
    try_mode_for(&crate::paths::oleafly_root()?, &project_id)
}

// FullAccess suppresses the native run_command confirmation, so switching the
// renderer into it must clear a trusted native boundary. Only a transition
// INTO FullAccess from a lesser mode is gated; re-affirming FullAccess or
// moving to a stricter mode never prompts, and neither escalates privilege.
pub fn full_access_needs_confirmation(current: ApprovalMode, requested: ApprovalMode) -> bool {
    requested == ApprovalMode::FullAccess && current != ApprovalMode::FullAccess
}

fn ensure_mode_allowed(project_id: &str, mode: ApprovalMode) -> Result<(), String> {
    if mode == ApprovalMode::FullAccess {
        crate::trust::require_trusted(project_id, crate::trust::Capability::FullAccess)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn approvals_mode_set(
    app: tauri::AppHandle,
    project_id: String,
    mode: ApprovalMode,
) -> Result<(), String> {
    crate::paths::validate_project_id(&project_id)?;
    ensure_mode_allowed(&project_id, mode)?;
    let root = crate::paths::oleafly_root()?;
    if full_access_needs_confirmation(try_mode_for(&root, &project_id)?, mode)
        && !confirm_full_access(app).await?
    {
        return Err(crate::app_error::AppError::new("approvals.full_access_declined").into());
    }
    set_mode(&root, &project_id, mode)
}

async fn confirm_full_access(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(crate::i18n::t("dialog.fullAccess.message"))
        .title(crate::i18n::t("dialog.fullAccess.title"))
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            crate::i18n::t("dialog.fullAccess.confirm"),
            crate::i18n::t("dialog.cancel"),
        ))
        .show(move |confirmed| {
            let _ = sender.send(confirmed);
        });
    receiver
        .await
        .map_err(|_| crate::i18n::t("errors.fullAccessDismissed"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn full_access_needs_a_trusted_folder() {
        let _restricted = crate::trust::testing::restrict("restricted-approvals");
        let refused =
            super::ensure_mode_allowed("restricted-approvals", super::ApprovalMode::FullAccess)
                .unwrap_err();
        assert!(
            refused.contains("\"code\":\"trust.full_access\""),
            "{refused}"
        );
        assert!(super::ensure_mode_allowed(
            "restricted-approvals",
            super::ApprovalMode::ApproveForMe
        )
        .is_ok());
    }

    #[test]
    fn raw_edits_round_trip_and_keep_comments() {
        let root =
            std::env::temp_dir().join(format!("oleafly-approvals-raw-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let text = "# my rules\n[\"$approval_modes\"]\nproj = \"custom\"\n\n[proj]\nrun_command = \"deny\"\n";
        super::write_raw(&root, text).unwrap();
        assert_eq!(super::read_raw(&root).unwrap(), text);
        assert_eq!(super::mode_for(&root, "proj"), super::ApprovalMode::Custom);
        assert_eq!(
            super::decisions_for(&root, "proj").get("run_command"),
            Some(&super::ToolDecision::Deny)
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn deny_rules_cover_the_acp_request_kinds_of_their_tools() {
        let root = temp_root("acp-kinds");
        set_mode(&root, "proj", ApprovalMode::FullAccess).unwrap();
        assert_eq!(acp_request_denied_by(&root, "proj", Some("execute")), None);
        set_decision(&root, "proj", "delete_file", Some(ToolDecision::Allow)).unwrap();
        // With no deny rule, Full access approves every kind, even ones no
        // tool's rules cover. An allow rule doesn't change that.
        for kind in [Some("execute"), Some("fetch"), Some("think"), None] {
            assert!(
                helper_request_auto_approved(&root, "proj", kind),
                "{kind:?}"
            );
        }
        set_decision(&root, "proj", "run_command", Some(ToolDecision::Deny)).unwrap();
        set_decision(&root, "proj", "replace_in_file", Some(ToolDecision::Deny)).unwrap();
        // Once a deny rule exists, a kind no rule covers goes to the card.
        assert!(helper_request_auto_approved(&root, "proj", Some("delete")));
        for kind in [Some("fetch"), Some("think"), Some("other"), None] {
            assert!(
                !helper_request_auto_approved(&root, "proj", kind),
                "{kind:?}"
            );
        }
        assert_eq!(
            acp_request_denied_by(&root, "proj", Some("execute")),
            Some("run_command")
        );
        assert_eq!(
            acp_request_denied_by(&root, "proj", Some("edit")),
            Some("replace_in_file")
        );
        assert_eq!(acp_request_denied_by(&root, "proj", Some("delete")), None);
        assert_eq!(acp_request_denied_by(&root, "proj", Some("think")), None);
        assert_eq!(acp_request_denied_by(&root, "proj", None), None);
        assert_eq!(acp_request_denied_by(&root, "other", Some("execute")), None);
        set_mode(&root, "proj", ApprovalMode::AskForApproval).unwrap();
        assert!(!helper_request_auto_approved(&root, "proj", Some("delete")));
        std::fs::write(approvals_path(&root), "[proj\nrun_command = deny").unwrap();
        assert_eq!(
            acp_request_denied_by(&root, "proj", Some("move")),
            Some("rename_file")
        );
        assert!(!helper_request_auto_approved(&root, "proj", Some("delete")));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rules_that_name_no_tool_save_and_come_back_with_the_closest_name() {
        let root = std::env::temp_dir().join(format!(
            "oleafly-approvals-raw-unknown-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let text = "[proj]\nrun-command = \"deny\"\nRun_Command = \"deny\"\ndelete_files = \"deny\"\nrun_command = \"deny\"\nmcp_ext_papers_find_0a1b2c3d4e5f = \"deny\"\nfrobnicate = \"deny\"\n";
        let unknown = super::write_raw(&root, text).unwrap();
        assert_eq!(super::read_raw(&root).unwrap(), text);
        let found = |name: &str| unknown.iter().find(|item| item.name == name).cloned();
        assert_eq!(
            found("run-command").and_then(|item| item.suggestion),
            Some("run_command")
        );
        assert_eq!(
            found("Run_Command").and_then(|item| item.suggestion),
            Some("run_command")
        );
        assert_eq!(
            found("delete_files").and_then(|item| item.suggestion),
            Some("delete_file")
        );
        assert_eq!(found("frobnicate").map(|item| item.suggestion), Some(None));
        assert_eq!(found("run_command"), None);
        assert_eq!(found("mcp_ext_papers_find_0a1b2c3d4e5f"), None);
        assert_eq!(unknown.len(), 4);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_misspelled_tool_used_in_several_projects_warns_once() {
        let root = temp_root("raw-unknown-repeated");
        let text = "[one]\nrun-command = \"deny\"\n\n[two]\nrun-command = \"deny\"\nfrobnicate = \"deny\"\n";
        let unknown = super::write_raw(&root, text).unwrap();
        let names: Vec<_> = unknown.iter().map(|item| item.name.as_str()).collect();
        assert_eq!(names, ["frobnicate", "run-command"]);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn unknown_tool_warnings_name_the_rule_and_the_likely_tool() {
        let warning = super::unknown_tool_warning(&super::UnknownTool {
            name: "run-command".into(),
            suggestion: Some("run_command"),
        });
        assert!(warning.contains("run-command"), "{warning}");
        assert!(warning.contains("run_command"), "{warning}");
        let warning = super::unknown_tool_warning(&super::UnknownTool {
            name: "frobnicate".into(),
            suggestion: None,
        });
        assert!(warning.contains("frobnicate"), "{warning}");
        assert!(!warning.contains("approvals."), "{warning}");
    }

    #[test]
    fn raw_edits_are_refused_when_invalid() {
        let root =
            std::env::temp_dir().join(format!("oleafly-approvals-raw-bad-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        assert!(super::write_raw(&root, "[proj\nrun_command = deny").is_err());
        assert!(super::write_raw(&root, "[proj]\nrun_command = \"maybe\"").is_err());
        assert!(super::write_raw(&root, "[\"$approval_modes\"]\nproj = \"yolo\"").is_err());
        assert_eq!(super::read_raw(&root).unwrap(), "");
        std::fs::remove_dir_all(&root).ok();
    }

    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("oleafly-approvals-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn decisions_round_trip_per_project() {
        let root = temp_root("roundtrip");
        set_decision(&root, "proj-a", "write_file", Some(ToolDecision::Allow)).unwrap();
        set_decision(&root, "proj-a", "delete_file", Some(ToolDecision::Deny)).unwrap();
        set_decision(&root, "proj-b", "write_file", Some(ToolDecision::Deny)).unwrap();

        assert_eq!(
            decision_for(&root, "proj-a", "write_file"),
            Some(ToolDecision::Allow)
        );
        assert_eq!(
            decision_for(&root, "proj-a", "delete_file"),
            Some(ToolDecision::Deny)
        );
        assert_eq!(
            decision_for(&root, "proj-b", "write_file"),
            Some(ToolDecision::Deny)
        );
        assert_eq!(decision_for(&root, "proj-b", "delete_file"), None);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn clearing_the_last_decision_removes_the_project_table() {
        let root = temp_root("clear");
        set_decision(&root, "proj", "write_file", Some(ToolDecision::Allow)).unwrap();
        set_decision(&root, "proj", "write_file", None).unwrap();

        assert!(decisions_for(&root, "proj").is_empty());
        let raw = std::fs::read_to_string(approvals_path(&root)).unwrap();
        assert!(!raw.contains("proj"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn unreadable_file_yields_empty_decisions() {
        let root = temp_root("missing");
        assert!(decisions_for(&root, "anything").is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn mode_metadata_does_not_discard_legacy_decisions() {
        let root = temp_root("metadata-with-rules");
        std::fs::write(
            approvals_path(&root),
            r#"["$approval_modes"]
proj = "full-access"

[proj]
write_file = "allow"
"#,
        )
        .unwrap();

        assert_eq!(
            decision_for(&root, "proj", "write_file"),
            Some(ToolDecision::Allow)
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn fresh_projects_default_to_approve_for_me() {
        let root = temp_root("mode-default");
        assert_eq!(mode_for(&root, "proj"), ApprovalMode::ApproveForMe);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn legacy_rules_infer_custom_mode() {
        let root = temp_root("legacy-custom");
        set_decision(&root, "proj", "write_file", Some(ToolDecision::Allow)).unwrap();

        assert_eq!(mode_for(&root, "proj"), ApprovalMode::Custom);
        assert_eq!(
            effective_decision_for(&root, "proj", "write_file"),
            Some(ToolDecision::Allow)
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn explicit_modes_round_trip_without_destroying_project_rules() {
        let root = temp_root("mode-roundtrip");
        set_decision(&root, "proj", "run_command", Some(ToolDecision::Deny)).unwrap();
        set_mode(&root, "proj", ApprovalMode::FullAccess).unwrap();

        assert_eq!(mode_for(&root, "proj"), ApprovalMode::FullAccess);
        assert_eq!(
            decision_for(&root, "proj", "run_command"),
            Some(ToolDecision::Deny)
        );
        assert_eq!(
            effective_decision_for(&root, "proj", "run_command"),
            Some(ToolDecision::Deny)
        );

        set_mode(&root, "proj", ApprovalMode::Custom).unwrap();
        assert_eq!(
            effective_decision_for(&root, "proj", "run_command"),
            Some(ToolDecision::Deny)
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn deny_rules_apply_in_every_mode_and_allow_rules_only_in_custom() {
        let root = temp_root("deny-every-mode");
        set_decision(&root, "proj", "run_command", Some(ToolDecision::Deny)).unwrap();
        set_decision(&root, "proj", "write_file", Some(ToolDecision::Allow)).unwrap();

        for mode in [
            ApprovalMode::AskForApproval,
            ApprovalMode::ApproveForMe,
            ApprovalMode::FullAccess,
            ApprovalMode::Custom,
        ] {
            set_mode(&root, "proj", mode).unwrap();
            let allow = (mode == ApprovalMode::Custom).then_some(ToolDecision::Allow);
            assert_eq!(
                policy_for(&root, "proj", "run_command").unwrap(),
                (mode, Some(ToolDecision::Deny)),
                "{mode:?}"
            );
            assert_eq!(
                effective_decision_for(&root, "proj", "run_command"),
                Some(ToolDecision::Deny),
                "{mode:?}"
            );
            assert_eq!(
                policy_for(&root, "proj", "write_file").unwrap(),
                (mode, allow),
                "{mode:?}"
            );
            assert_eq!(
                effective_decision_for(&root, "proj", "write_file"),
                allow,
                "{mode:?}"
            );
            assert_eq!(
                policy_for(&root, "proj", "compile").unwrap(),
                (mode, None),
                "{mode:?}"
            );
        }
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn malformed_mode_metadata_fails_closed_without_overwriting_rules() {
        let root = temp_root("malformed-mode");
        let malformed = r#"["$approval_modes"]
proj = "unexpected"

[proj]
write_file = "allow"
"#;
        std::fs::write(approvals_path(&root), malformed).unwrap();

        assert!(try_mode_for(&root, "proj").is_err());
        assert!(try_decisions_for(&root, "proj").is_err());
        assert_eq!(
            effective_decision_for(&root, "proj", "write_file"),
            Some(ToolDecision::Deny)
        );
        assert!(set_mode(&root, "proj", ApprovalMode::FullAccess).is_err());
        assert_eq!(
            std::fs::read_to_string(approvals_path(&root)).unwrap(),
            malformed
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn malformed_files_fail_closed_and_are_not_overwritten() {
        let root = temp_root("malformed-file");
        let malformed = "[proj\nwrite_file = \"allow\"\n";
        std::fs::write(approvals_path(&root), malformed).unwrap();

        assert!(try_mode_for(&root, "proj").is_err());
        assert_eq!(
            effective_decision_for(&root, "proj", "write_file"),
            Some(ToolDecision::Deny)
        );
        assert!(set_mode(&root, "proj", ApprovalMode::FullAccess).is_err());
        assert_eq!(
            std::fs::read_to_string(approvals_path(&root)).unwrap(),
            malformed
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn repeated_mode_updates_replace_the_existing_file() {
        let root = temp_root("mode-replace");
        set_mode(&root, "proj", ApprovalMode::AskForApproval).unwrap();
        set_mode(&root, "proj", ApprovalMode::FullAccess).unwrap();

        assert_eq!(mode_for(&root, "proj"), ApprovalMode::FullAccess);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn concurrent_updates_preserve_every_project_entry() {
        let root = temp_root("concurrent-updates");
        let threads = (0..16)
            .map(|index| {
                let root = root.clone();
                std::thread::spawn(move || {
                    if index % 2 == 0 {
                        set_mode(&root, &format!("mode-{index}"), ApprovalMode::FullAccess)
                    } else {
                        set_decision(
                            &root,
                            &format!("rule-{index}"),
                            "run_command",
                            Some(ToolDecision::Deny),
                        )
                    }
                })
            })
            .collect::<Vec<_>>();

        for thread in threads {
            thread.join().unwrap().unwrap();
        }
        for index in 0..16 {
            if index % 2 == 0 {
                assert_eq!(
                    mode_for(&root, &format!("mode-{index}")),
                    ApprovalMode::FullAccess
                );
            } else {
                assert_eq!(
                    decision_for(&root, &format!("rule-{index}"), "run_command"),
                    Some(ToolDecision::Deny)
                );
            }
        }
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn revoking_grants_drops_full_access_and_allows_but_keeps_denials_and_other_projects() {
        let root = temp_root("revoke-grants");
        set_mode(&root, "proj", ApprovalMode::FullAccess).unwrap();
        set_decision(&root, "proj", "write_file", Some(ToolDecision::Allow)).unwrap();
        set_decision(&root, "proj", "run_command", Some(ToolDecision::Deny)).unwrap();
        set_mode(&root, "other", ApprovalMode::FullAccess).unwrap();
        set_decision(&root, "other", "write_file", Some(ToolDecision::Allow)).unwrap();

        assert!(revoke_project_grants(&root, "proj").unwrap());

        assert_eq!(
            policy_for(&root, "proj", "write_file").unwrap(),
            (ApprovalMode::Custom, None)
        );
        assert_eq!(
            policy_for(&root, "proj", "run_command").unwrap(),
            (ApprovalMode::Custom, Some(ToolDecision::Deny))
        );
        assert_eq!(mode_for(&root, "other"), ApprovalMode::FullAccess);
        assert_eq!(
            decision_for(&root, "other", "write_file"),
            Some(ToolDecision::Allow)
        );
        assert!(!revoke_project_grants(&root, "proj").unwrap());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn revoking_grants_without_denials_returns_the_project_to_the_default_mode() {
        let root = temp_root("revoke-default");
        set_mode(&root, "proj", ApprovalMode::FullAccess).unwrap();
        set_decision(&root, "proj", "write_file", Some(ToolDecision::Allow)).unwrap();
        assert!(revoke_project_grants(&root, "proj").unwrap());
        assert_eq!(mode_for(&root, "proj"), ApprovalMode::ApproveForMe);
        assert!(decisions_for(&root, "proj").is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn revoking_grants_fails_closed_on_a_malformed_file() {
        let root = temp_root("revoke-malformed");
        std::fs::write(approvals_path(&root), "[proj\nwrite_file = allow").unwrap();
        assert!(revoke_project_grants(&root, "proj").is_err());
        assert_eq!(
            std::fs::read_to_string(approvals_path(&root)).unwrap(),
            "[proj\nwrite_file = allow"
        );
        std::fs::remove_dir_all(&root).ok();
    }
}
