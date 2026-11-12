use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

use oleafly_core::markdown_scan::{block_id_suffix, FenceLine, Fences};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NoteTask {
    pub line: u32,
    pub checked: bool,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteTasks {
    pub project_id: String,
    pub tasks: Vec<NoteTask>,
}

static CACHE: crate::note_index::ParsedCache<Vec<NoteTask>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[tauri::command]
pub async fn note_tasks() -> Result<Vec<NoteTasks>, String> {
    tauri::async_runtime::spawn_blocking(note_tasks_blocking)
        .await
        .map_err(|error| format!("listing note tasks failed: {error}"))?
}

pub(crate) fn note_tasks_blocking() -> Result<Vec<NoteTasks>, String> {
    let entries = crate::note_index::notes()?;
    let mut seen = HashSet::new();
    let mut found = Vec::new();
    for entry in entries.iter() {
        match crate::note_index::read_parsed(&CACHE, entry, scan_tasks) {
            Ok(Some((path, tasks, _))) => {
                seen.insert(path);
                if !tasks.is_empty() {
                    found.push(NoteTasks {
                        project_id: entry.id.clone(),
                        tasks: tasks.as_ref().clone(),
                    });
                }
            }
            Ok(None) => {}
            Err(error) => {
                let _ = crate::project::append_app_log(format!(
                    "Skipping tasks in note {:?}: {error}",
                    entry.id
                ));
            }
        }
    }
    crate::note_index::keep_only(&CACHE, &seen);
    Ok(found)
}

pub(crate) fn forget_cache() {
    crate::note_index::forget(&CACHE);
}

fn body_start(text: &str) -> (usize, &str) {
    match oleafly_core::front_matter::split(text) {
        Some(front) => {
            let body = front.body();
            let head = &text[..text.len() - body.len()];
            (head.matches('\n').count(), body)
        }
        None => (0, text.strip_prefix('\u{feff}').unwrap_or(text)),
    }
}

fn without_quotes(line: &str) -> &str {
    let mut rest = line.trim_start();
    while let Some(after) = rest.strip_prefix('>') {
        rest = after.trim_start();
    }
    rest
}

fn task_of(line: &str) -> Option<(bool, &str)> {
    let rest = without_quotes(line);
    let mut chars = rest.chars();
    if !matches!(chars.next(), Some('-' | '*' | '+')) {
        return None;
    }
    let after_marker = &rest[1..];
    let item = after_marker.trim_start_matches([' ', '\t']);
    if item.len() == after_marker.len() {
        return None;
    }
    let bytes = item.as_bytes();
    if bytes.len() < 3 || bytes[0] != b'[' || bytes[2] != b']' {
        return None;
    }
    let checked = match bytes[1] {
        b' ' => false,
        b'x' | b'X' => true,
        _ => return None,
    };
    let text = &item[3..];
    if !(text.is_empty() || text.starts_with([' ', '\t'])) {
        return None;
    }
    let text = text.trim();
    let text = block_id_suffix(text)
        .filter(|(end, _)| *end > 0)
        .map_or(text, |(end, _)| &text[..end])
        .trim();
    (!text.is_empty()).then_some((checked, text))
}

pub(crate) fn scan_tasks(text: &str) -> Vec<NoteTask> {
    let (offset, body) = body_start(text);
    let mut fences = Fences::default();
    let mut tasks = Vec::new();
    for (index, raw) in body.split('\n').enumerate() {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if fences.line(line) != FenceLine::Text {
            continue;
        }
        if let Some((checked, task)) = task_of(line) {
            tasks.push(NoteTask {
                line: u32::try_from(offset + index).unwrap_or(u32::MAX),
                checked,
                text: task.to_string(),
            });
        }
    }
    tasks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn found(text: &str) -> Vec<(u32, bool, &str)> {
        scan_tasks(text)
            .into_iter()
            .map(|task| {
                let text: &'static str = Box::leak(task.text.into_boxed_str());
                (task.line, task.checked, text)
            })
            .collect()
    }

    #[test]
    fn finds_open_and_done_tasks_with_file_line_numbers() {
        let text = "---\ntitle: Plan\ntags: [lab]\n---\n\n- [ ] Send [due:: 2026-11-12]\n- [x] Book\r\n  * [X] Nested\n+ [ ]\n- plain item\n";
        assert_eq!(
            found(text),
            vec![
                (5, false, "Send [due:: 2026-11-12]"),
                (6, true, "Book"),
                (7, true, "Nested"),
            ]
        );
    }

    #[test]
    fn reads_tasks_in_quotes_and_skips_code_and_other_lists() {
        let text = "> [!todo] Later\n> - [ ] Ask\n\n```\n- [ ] fenced\n```\n\n1. [ ] numbered\n-[ ] tight\n- [-] cancelled\n- [x]done";
        assert_eq!(found(text), vec![(1, false, "Ask")]);
    }

    #[test]
    fn leaves_a_trailing_block_id_out_of_the_task_text() {
        let text = "- [ ] Send report ^abc123\n> - [x] Ask\t^q-1  \r\n- [ ] ^lone\n- [ ] x^2\n- [ ] tail ^bad_id\n";
        assert_eq!(
            found(text),
            vec![
                (0, false, "Send report"),
                (1, true, "Ask"),
                (2, false, "^lone"),
                (3, false, "x^2"),
                (4, false, "tail ^bad_id"),
            ]
        );
    }

    #[test]
    fn counts_lines_without_front_matter_and_after_a_bom() {
        assert_eq!(
            found("\u{feff}Intro\n- [ ] First"),
            vec![(1, false, "First")]
        );
    }
}
