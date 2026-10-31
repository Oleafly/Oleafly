use super::{redact::Redactor, types::PermissionDiff};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
};

pub(super) const MAX_DIFF_BYTES: usize = 96 * 1024;
const MAX_LOCATIONS: usize = 16;
const MAX_DIFFS: usize = 16;
const MAX_TRACKED_PATHS: usize = 256;
const UNTRACKED_PATH: &str = "../untracked";
const MAX_KIND_CHARS: usize = 32;
const MAX_TRACKED_CALLS: usize = 64;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct ToolCallView {
    pub kind: Option<String>,
    pub locations: Vec<String>,
    pub diffs: Vec<ProposedDiff>,
    pub input_paths: Vec<String>,
    pub overflowed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ProposedDiff {
    pub path: String,
    pub old_text: Option<String>,
    pub new_text: Option<String>,
    pub oversized: bool,
}

impl ToolCallView {
    pub(super) fn apply(&mut self, update: &Value) {
        if let Some(kind) = update["kind"].as_str() {
            self.kind = Some(kind.chars().take(MAX_KIND_CHARS).collect());
        }
        if let Some(locations) = update["locations"].as_array() {
            let paths = locations
                .iter()
                .filter_map(|location| location["path"].as_str());
            self.overflowed |= paths.clone().nth(MAX_TRACKED_PATHS).is_some();
            self.locations = paths.take(MAX_TRACKED_PATHS).map(str::to_owned).collect();
        }
        if update["rawInput"].is_object() {
            let paths = oleafly_acp::paths::raw_input_paths(update);
            let mut kept = Vec::new();
            for path in paths {
                if kept.len() == MAX_TRACKED_PATHS {
                    self.overflowed = true;
                    break;
                }
                kept.push(path.to_owned());
            }
            self.input_paths = kept;
        }
        if let Some(content) = update["content"].as_array() {
            self.overflowed |= content
                .iter()
                .filter(|item| item["type"] == "diff")
                .nth(MAX_TRACKED_PATHS)
                .is_some();
            self.diffs = proposed_diffs(content);
        }
    }

    fn policy_paths(&self) -> impl Iterator<Item = &str> {
        self.locations
            .iter()
            .chain(self.input_paths.iter())
            .map(String::as_str)
            .chain(self.diffs.iter().map(|diff| diff.path.as_str()))
            .chain(self.overflowed.then_some(UNTRACKED_PATH))
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
            let oversized = size > remaining || new_text.is_none();
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
        .take(MAX_TRACKED_PATHS)
        .collect()
}

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
        .take(MAX_LOCATIONS)
        .map(|path| redactor.text(&display_path(root, path)))
        .collect();
    let mut remaining = MAX_DIFF_BYTES;
    let diffs = view
        .diffs
        .iter()
        .take(MAX_DIFFS)
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

pub(super) fn policy_view(remembered: Option<&ToolCallView>, tool_call: &Value) -> Value {
    let mut request = ToolCallView::default();
    request.apply(tool_call);
    let kind = request
        .kind
        .as_deref()
        .or_else(|| remembered.and_then(|call| call.kind.as_deref()));
    let paths = remembered
        .into_iter()
        .flat_map(ToolCallView::policy_paths)
        .chain(request.policy_paths())
        .map(|path| json!({"path": path}))
        .collect::<Vec<_>>();
    json!({"kind": kind, "locations": paths})
}

pub(super) fn names_paths(policy: &Value) -> bool {
    policy["locations"]
        .as_array()
        .is_some_and(|paths| !paths.is_empty())
}

pub(super) fn refused_path(
    root: &Path,
    policy: &Value,
    inside: impl Fn(&str) -> bool,
    home: Option<&Path>,
) -> Option<String> {
    let raw = policy["locations"]
        .as_array()?
        .iter()
        .filter_map(|location| location["path"].as_str())
        .find(|path| *path != UNTRACKED_PATH && !inside(path))?;
    let shown = display_path(root, raw);
    if shown != raw {
        return Some(shown);
    }
    let from_home = home
        .and_then(|home| Path::new(raw).strip_prefix(home).ok())
        .and_then(slash_path)
        .map(|rest| {
            if rest == "." {
                "~".to_owned()
            } else {
                format!("~/{rest}")
            }
        });
    Some(from_home.unwrap_or_else(|| raw.to_owned()))
}

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
    fn a_diff_cut_on_the_way_in_shows_as_too_large() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path().canonicalize().unwrap();
        let file = root.join("refs.bib");
        let (_, locations, diffs) = permission_view(
            &root,
            None,
            &json!({"toolCallId": "w", "kind": "edit", "locations": [{"path": file}], "content": [{"type": "diff", "path": file, "oldText": null, "newText": null}]}),
            &Redactor::new(&[]),
        );
        assert_eq!(locations, vec!["refs.bib".to_owned()]);
        assert_eq!(diffs.len(), 1);
        assert!(diffs[0].truncated);
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

    #[cfg(unix)]
    #[test]
    fn a_refused_path_is_shown_from_home_or_as_the_agent_wrote_it() {
        let root = Path::new("/project");
        let home = Some(Path::new("/home/me"));
        let inside = |path: &str| path.starts_with("/project/");
        let policy = json!({"locations": [
            {"path": "/project/a.tex"},
            {"path": "/home/me/notes/todo.md"},
            {"path": "/etc/passwd"}
        ]});
        assert_eq!(
            refused_path(root, &policy, inside, home).as_deref(),
            Some("~/notes/todo.md")
        );
        assert_eq!(
            refused_path(
                root,
                &json!({"locations": [{"path": "/etc/passwd"}]}),
                inside,
                home
            )
            .as_deref(),
            Some("/etc/passwd")
        );
        assert_eq!(
            refused_path(
                root,
                &json!({"locations": [{"path": "../outside.tex"}]}),
                inside,
                home
            )
            .as_deref(),
            Some("../outside.tex")
        );
        assert_eq!(
            refused_path(
                root,
                &json!({"locations": [{"path": "/home/me"}]}),
                inside,
                home
            )
            .as_deref(),
            Some("~")
        );
        assert_eq!(
            refused_path(
                root,
                &json!({"locations": [{"path": UNTRACKED_PATH}]}),
                inside,
                home
            ),
            None
        );
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
    fn the_policy_sees_the_paths_of_the_announced_call_and_of_the_request() {
        let mut calls = HashMap::new();
        track(
            &mut calls,
            &json!({"toolCallId": "t", "kind": "edit",
                "locations": [{"path": "/project/a.tex"}],
                "rawInput": {"notebook_path": "/elsewhere/n.ipynb"},
                "content": [{"type": "diff", "path": "/project/b.tex", "oldText": "1", "newText": "2"}]}),
        );
        let policy = policy_view(
            calls.get("t"),
            &json!({"toolCallId": "t", "locations": [{"path": "/project/c.tex"}]}),
        );
        assert_eq!(policy["kind"], "edit");
        let paths: Vec<&str> = policy["locations"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|location| location["path"].as_str())
            .collect();
        assert_eq!(
            paths,
            [
                "/project/a.tex",
                "/elsewhere/n.ipynb",
                "/project/b.tex",
                "/project/c.tex"
            ]
        );
        assert!(names_paths(&policy));
        assert!(!names_paths(&policy_view(
            None,
            &json!({"toolCallId": "t"})
        )));
    }

    #[test]
    fn a_call_with_more_paths_than_are_kept_is_judged_as_outside() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path().canonicalize().unwrap();
        let mut calls = HashMap::new();
        let locations: Vec<_> = (0..MAX_TRACKED_PATHS + 1)
            .map(|index| json!({"path": format!("a{index}.tex")}))
            .collect();
        track(
            &mut calls,
            &json!({"toolCallId": "many", "kind": "edit", "locations": locations}),
        );
        let policy = policy_view(calls.get("many"), &json!({"toolCallId": "many"}));
        assert!(!oleafly_acp::paths::permission_paths_allowed(
            &root, &root, &policy
        ));
        let (_, shown, _) = permission_view(
            &root,
            calls.get("many"),
            &json!({"toolCallId": "many"}),
            &redactor(),
        );
        assert_eq!(shown.len(), MAX_LOCATIONS);
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
