use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

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

type ApprovalsFile = BTreeMap<String, BTreeMap<String, ToolDecision>>;

fn approvals_path(root: &Path) -> PathBuf {
    root.join("approvals.toml")
}

fn read_file(root: &Path) -> ApprovalsFile {
    let Ok(raw) = std::fs::read_to_string(approvals_path(root)) else {
        return ApprovalsFile::new();
    };
    toml::from_str(&raw).unwrap_or_default()
}

fn write_file(root: &Path, approvals: &ApprovalsFile) -> Result<(), String> {
    let raw = toml::to_string_pretty(approvals)
        .map_err(|e| format!("failed to encode approvals: {e}"))?;
    std::fs::create_dir_all(root).map_err(|e| format!("failed to create data dir: {e}"))?;
    let tmp = approvals_path(root).with_extension("toml.tmp");
    std::fs::write(&tmp, raw).map_err(|e| format!("failed to write approvals: {e}"))?;
    std::fs::rename(&tmp, approvals_path(root))
        .map_err(|e| format!("failed to replace approvals: {e}"))
}

pub fn decisions_for(root: &Path, project_id: &str) -> BTreeMap<String, ToolDecision> {
    read_file(root).remove(project_id).unwrap_or_default()
}

pub fn decision_for(root: &Path, project_id: &str, tool: &str) -> Option<ToolDecision> {
    decisions_for(root, project_id).remove(tool)
}

pub fn set_decision(
    root: &Path,
    project_id: &str,
    tool: &str,
    decision: Option<ToolDecision>,
) -> Result<(), String> {
    let mut approvals = read_file(root);
    match decision {
        Some(decision) => {
            approvals
                .entry(project_id.to_string())
                .or_default()
                .insert(tool.to_string(), decision);
        }
        None => {
            if let Some(project) = approvals.get_mut(project_id) {
                project.remove(tool);
                if project.is_empty() {
                    approvals.remove(project_id);
                }
            }
        }
    }
    write_file(root, &approvals)
}

#[tauri::command]
pub fn approvals_list(project_id: String) -> Result<BTreeMap<String, ToolDecision>, String> {
    crate::paths::validate_project_id(&project_id)?;
    Ok(decisions_for(&crate::paths::oleafly_root()?, &project_id))
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
}
