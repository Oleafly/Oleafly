//! What a permission card shows: the tool kind, the target paths and the
//! proposed file changes.
//!
//! Adapters often send the diff in the `tool_call` update and then ask for
//! permission with only the `toolCallId`, so the runtime keeps the latest
//! content of each tool call in memory and joins it here.

use super::{redact::Redactor, types::PermissionDiff};
use serde_json::Value;
use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
};

/// Budget for all proposed diff text on one permission request.
pub(super) const MAX_DIFF_BYTES: usize = 96 * 1024;
const MAX_LOCATIONS: usize = 16;
const MAX_DIFFS: usize = 16;
const MAX_KIND_CHARS: usize = 32;
/// Tool calls remembered per session; older ones are forgotten.
const MAX_TRACKED_CALLS: usize = 64;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct ToolCallView {
    pub kind: Option<String>,
    pub locations: Vec<String>,
    pub diffs: Vec<ProposedDiff>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ProposedDiff {
    pub path: String,
    pub old_text: Option<String>,
    pub new_text: Option<String>,
    /// The text was over budget and was not kept.
    pub oversized: bool,
}

impl ToolCallView {
    /// Applies the fields a `tool_call`, `tool_call_update` or permission
    /// `toolCall` carries. Fields it leaves out keep their earlier values.
    pub(super) fn apply(&mut self, update: &Value) {
        if let Some(kind) = update["kind"].as_str() {
            self.kind = Some(kind.chars().take(MAX_KIND_CHARS).collect());
        }
        if let Some(locations) = update["locations"].as_array() {
            self.locations = locations
                .iter()
                .filter_map(|location| location["path"].as_str())
                .take(MAX_LOCATIONS)
                .map(str::to_owned)
                .collect();
        }
        if let Some(content) = update["content"].as_array() {
            self.diffs = proposed_diffs(content);
        }
    }
}

fn proposed_diffs(content: &[Value]) -> Vec<ProposedDiff> {
    let mut remaining = MAX_DIFF_BYTES;
    content
        .iter()
        .filter(|item| item["type"] == "diff")
        .filter_map(|item| {
            let path = item["path"].as_str()?;
            let old_text = item["oldText"].as_str();
            let new_text = item["newText"].as_str();
            let size = old_text.map_or(0, str::len) + new_text.map_or(0, str::len);
            let oversized = size > remaining;
            if !oversized {
                remaining -= size;
            }
            Some(ProposedDiff {
                path: path.to_owned(),
                old_text: old_text.filter(|_| !oversized).map(str::to_owned),
                new_text: new_text.filter(|_| !oversized).map(str::to_owned),
                oversized,
            })
        })
        .take(MAX_DIFFS)
        .collect()
}

/// Remembers the content of a `tool_call` or `tool_call_update`.
pub(super) fn track(calls: &mut HashMap<String, ToolCallView>, update: &Value) {
    let Some(id) = update["toolCallId"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 512)
    else {
        return;
    };
    if !calls.contains_key(id) && calls.len() >= MAX_TRACKED_CALLS {
        calls.clear();
    }
    calls.entry(id.to_owned()).or_default().apply(update);
}

/// The permission card fields: the remembered tool call overlaid with what the
/// request itself carries, redacted, with paths made project-relative and the
/// diff text capped at [`MAX_DIFF_BYTES`] in total.
pub(super) fn permission_view(
    root: &Path,
    remembered: Option<&ToolCallView>,
    tool_call: &Value,
    redactor: &Redactor,
) -> (Option<String>, Vec<String>, Vec<PermissionDiff>) {
    let mut view = remembered.cloned().unwrap_or_default();
    view.apply(tool_call);
    let kind = view.kind.as_deref().map(|kind| redactor.text(kind));
    let locations = view
        .locations
        .iter()
        .map(|path| redactor.text(&display_path(root, path)))
        .collect();
    let mut remaining = MAX_DIFF_BYTES;
    let diffs = view
        .diffs
        .iter()
        .map(|diff| {
            let path = redactor.text(&display_path(root, &diff.path));
            let old_text = diff.old_text.as_deref().map(|text| redactor.text(text));
            let new_text = diff.new_text.as_deref().map(|text| redactor.text(text));
            let size =
                old_text.as_ref().map_or(0, String::len) + new_text.as_ref().map_or(0, String::len);
            if diff.oversized || size > remaining {
                return PermissionDiff {
                    path,
                    old_text: None,
                    new_text: None,
                    truncated: true,
                };
            }
            remaining -= size;
            PermissionDiff {
                path,
                old_text,
                new_text,
                truncated: false,
            }
        })
        .collect();
    (kind, locations, diffs)
}

/// `raw` relative to the project root with `/` separators when it is inside
/// the root; otherwise unchanged.
pub(super) fn display_path(root: &Path, raw: &str) -> String {
    let path = Path::new(raw);
    if path.is_relative() {
        return slash_path(path).unwrap_or_else(|| raw.to_owned());
    }
    relative_inside(root, path)
        .and_then(|relative| slash_path(&relative))
        .unwrap_or_else(|| raw.to_owned())
}

fn relative_inside(root: &Path, path: &Path) -> Option<PathBuf> {
    if let Ok(relative) = path.strip_prefix(root) {
        return Some(relative.to_path_buf());
    }
    // The root is canonical (`/private/var` on macOS, `\\?\C:\` on Windows),
    // so resolve the part of `path` that exists before comparing.
    let mut existing = path;
    let mut missing = Vec::new();
    while !existing.exists() {
        missing.push(existing.file_name()?);
        existing = existing.parent()?;
    }
    let mut relative = existing
        .canonicalize()
        .ok()?
        .strip_prefix(root)
        .ok()?
        .to_path_buf();
    for part in missing.into_iter().rev() {
        relative.push(part);
    }
    Some(relative)
}

fn slash_path(path: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(if parts.is_empty() {
        ".".into()
    } else {
        parts.join("/")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn redactor() -> Redactor {
        Redactor::new(&[])
    }

    #[test]
    fn a_request_without_content_uses_the_remembered_tool_call() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path().canonicalize().unwrap();
        let mut calls = HashMap::new();
        let file = root.join("chapters").join("intro.tex");
        track(
            &mut calls,
            &json!({
                "toolCallId": "edit-1",
                "kind": "edit",
                "locations": [{"path": file}],
                "content": [{"type": "diff", "path": file, "oldText": "Old line\n", "newText": "New line\n"}]
            }),
        );
        let (kind, locations, diffs) = permission_view(
            &root,
            calls.get("edit-1"),
            &json!({"toolCallId": "edit-1", "title": "Edit intro"}),
            &redactor(),
        );
        assert_eq!(kind.as_deref(), Some("edit"));
        assert_eq!(locations, vec!["chapters/intro.tex".to_owned()]);
        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0].path, "chapters/intro.tex");
        assert_eq!(diffs[0].old_text.as_deref(), Some("Old line\n"));
        assert_eq!(diffs[0].new_text.as_deref(), Some("New line\n"));
        assert!(!diffs[0].truncated);
    }

    #[test]
    fn content_on_the_request_wins_over_the_remembered_call() {
        let root = Path::new("/project");
        let mut calls = HashMap::new();
        track(
            &mut calls,
            &json!({"toolCallId": "t", "kind": "read", "content": [{"type": "diff", "path": "a.tex", "oldText": "1", "newText": "2"}]}),
        );
        let (kind, _, diffs) = permission_view(
            root,
            calls.get("t"),
            &json!({"toolCallId": "t", "kind": "edit", "content": [{"type": "diff", "path": "b.tex", "oldText": null, "newText": "new"}]}),
            &redactor(),
        );
        assert_eq!(kind.as_deref(), Some("edit"));
        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0].path, "b.tex");
        assert_eq!(diffs[0].old_text, None);
        assert_eq!(diffs[0].new_text.as_deref(), Some("new"));
    }

    #[test]
    fn credentials_in_proposed_changes_are_redacted() {
        let root = Path::new("/project");
        let (_, _, diffs) = permission_view(
            root,
            None,
            &json!({"content": [{"type": "diff", "path": "config.env", "oldText": "user = me\n", "newText": "user = me\napi_key = sk-live-secret-value-123456\n"}]}),
            &redactor(),
        );
        let new_text = diffs[0].new_text.as_deref().unwrap();
        assert!(!new_text.contains("sk-live-secret-value-123456"));
        assert!(new_text.contains("[credential omitted]"));
        assert!(new_text.contains("user = me"));
    }

    #[test]
    fn diff_text_is_capped_at_96_kib_across_the_request() {
        let root = Path::new("/project");
        let half = "a".repeat(40 * 1024);
        let (_, _, diffs) = permission_view(
            root,
            None,
            &json!({"content": [
                {"type": "diff", "path": "one.tex", "oldText": half, "newText": half},
                {"type": "diff", "path": "two.tex", "oldText": "x", "newText": half},
                {"type": "diff", "path": "three.tex", "oldText": "small", "newText": "change"}
            ]}),
            &redactor(),
        );
        assert_eq!(diffs.len(), 3);
        assert!(!diffs[0].truncated);
        assert!(diffs[1].truncated);
        assert_eq!(diffs[1].path, "two.tex");
        assert_eq!(diffs[1].old_text, None);
        assert_eq!(diffs[1].new_text, None);
        assert!(!diffs[2].truncated);
        let total: usize = diffs
            .iter()
            .map(|diff| {
                diff.old_text.as_ref().map_or(0, String::len)
                    + diff.new_text.as_ref().map_or(0, String::len)
            })
            .sum();
        assert!(total <= MAX_DIFF_BYTES);
    }

    #[test]
    fn one_whole_file_diff_over_budget_is_marked_truncated() {
        let root = Path::new("/project");
        let mut calls = HashMap::new();
        let big = "b".repeat(200 * 1024);
        track(
            &mut calls,
            &json!({"toolCallId": "big", "content": [{"type": "diff", "path": "refs.bib", "oldText": big, "newText": big}]}),
        );
        let remembered = calls.get("big").unwrap();
        assert!(remembered.diffs[0].oversized);
        assert_eq!(remembered.diffs[0].old_text, None);
        let (_, _, diffs) = permission_view(root, Some(remembered), &json!({}), &redactor());
        assert!(diffs[0].truncated);
        assert_eq!(diffs[0].path, "refs.bib");
    }

    #[test]
    fn paths_outside_the_project_stay_absolute() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path().canonicalize().unwrap();
        let outside = std::env::temp_dir().join("elsewhere").join("notes.txt");
        assert_eq!(
            display_path(&root, &outside.to_string_lossy()),
            outside.to_string_lossy()
        );
        assert_eq!(display_path(&root, "sub/./file.tex"), "sub/file.tex");
        assert_eq!(display_path(&root, &root.to_string_lossy()), ".");
    }

    #[test]
    fn a_path_through_an_alias_of_the_root_is_made_relative() {
        let temp = tempfile::tempdir().unwrap();
        let canonical = temp.path().canonicalize().unwrap();
        std::fs::create_dir(canonical.join("sub")).unwrap();
        // `temp.path()` is the non-canonical spelling on macOS (/var vs
        // /private/var); the file itself does not exist yet.
        let spelled = temp.path().join("sub").join("new.tex");
        assert_eq!(
            display_path(&canonical, &spelled.to_string_lossy()),
            "sub/new.tex"
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_drive_letter_path_matches_the_verbatim_project_root() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        assert!(root.to_string_lossy().starts_with(r"\\?\"));
        let plain = oleafly_core::plain_path(&root)
            .join("chapters")
            .join("one.tex");
        assert!(!plain.to_string_lossy().starts_with(r"\\?\"));
        assert_eq!(
            display_path(&root, &plain.to_string_lossy()),
            "chapters/one.tex"
        );
    }

    #[test]
    fn remembered_calls_stay_bounded() {
        let mut calls = HashMap::new();
        for index in 0..(MAX_TRACKED_CALLS * 2 + 1) {
            track(
                &mut calls,
                &json!({"toolCallId": format!("call-{index}"), "kind": "edit"}),
            );
        }
        assert!(calls.len() <= MAX_TRACKED_CALLS);
        track(&mut calls, &json!({"kind": "edit"}));
        track(&mut calls, &json!({"toolCallId": "", "kind": "edit"}));
        assert!(calls.len() <= MAX_TRACKED_CALLS);
    }
}
