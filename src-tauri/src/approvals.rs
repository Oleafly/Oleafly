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
    let decision = (mode == ApprovalMode::Custom)
        .then(|| {
            approvals
                .decisions
                .get(project_id)
                .and_then(|decisions| decisions.get(tool))
                .copied()
        })
        .flatten();
    Ok((mode, decision))
}

pub fn effective_decision_for(root: &Path, project_id: &str, tool: &str) -> Option<ToolDecision> {
    match policy_for(root, project_id, tool) {
        Ok((_, decision)) => decision,
        Err(_) => Some(ToolDecision::Deny),
    }
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

#[tauri::command]
pub fn approvals_mode_set(project_id: String, mode: ApprovalMode) -> Result<(), String> {
    crate::paths::validate_project_id(&project_id)?;
    set_mode(&crate::paths::oleafly_root()?, &project_id, mode)
}

#[cfg(test)]
mod tests {
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
        assert_eq!(effective_decision_for(&root, "proj", "run_command"), None);

        set_mode(&root, "proj", ApprovalMode::Custom).unwrap();
        assert_eq!(
            effective_decision_for(&root, "proj", "run_command"),
            Some(ToolDecision::Deny)
        );
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
}
