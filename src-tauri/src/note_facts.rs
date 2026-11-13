use std::collections::HashSet;

use oleafly_core::encoding::hex_lower;
use oleafly_core::markdown_scan::{FenceLine, Fences};
use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::note_search::IndexedNote;

const PREVIEW_CHARS: usize = 300;
const MANAGED_KEYS: [&str; 6] = ["title", "kind", "id", "icon", "color", "agent"];

#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct HeadFacts {
    title: Option<String>,
    icon: Option<String>,
    color: Option<String>,
    agent: Option<String>,
    properties: Map<String, Value>,
    heading: Option<String>,
    preview: String,
    preview_after_heading: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFacts {
    pub id: String,
    pub note_id: Option<String>,
    pub title: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub agent: Option<String>,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
    pub properties: Map<String, Value>,
    pub preview: String,
    pub related_project: Option<String>,
    pub updated_at: f64,
    pub knowledge: String,
    pub task_digest: String,
}

pub(crate) fn task_digest(text: &str) -> String {
    let tasks = serde_json::to_vec(&crate::note_tasks::scan_tasks(text)).unwrap_or_default();
    hex_lower(&Sha256::digest(tasks))
}

pub(crate) fn head_facts(front_matter: &[&str], body: &[&str]) -> HeadFacts {
    let scalar = |key: &str| oleafly_core::front_matter::scalar(front_matter, key);
    let blocks = blocks_of(body);
    let heading = blocks
        .first()
        .and_then(|block| block.first())
        .and_then(|line| heading_one(line));
    let after_heading: Vec<Vec<&str>> = match (heading.as_ref(), blocks.split_first()) {
        (Some(_), Some((first, rest))) => std::iter::once(first[1..].to_vec())
            .filter(|lines| !lines.is_empty())
            .chain(rest.iter().cloned())
            .collect(),
        _ => blocks.clone(),
    };
    HeadFacts {
        title: scalar("title"),
        icon: scalar("icon"),
        color: scalar("color"),
        agent: scalar("agent"),
        properties: properties(front_matter),
        preview: preview(&blocks),
        preview_after_heading: preview(&after_heading),
        heading,
    }
}

fn properties(front_matter: &[&str]) -> Map<String, Value> {
    let Ok(Value::Object(values)) = serde_norway::from_str::<Value>(&front_matter.join("\n"))
    else {
        return Map::new();
    };
    values
        .into_iter()
        .filter(|(key, value)| !MANAGED_KEYS.contains(&key.as_str()) && flat(value))
        .collect()
}

fn flat(value: &Value) -> bool {
    match value {
        Value::Object(_) => false,
        Value::Array(items) => items
            .iter()
            .all(|item| !matches!(item, Value::Object(_) | Value::Array(_))),
        _ => true,
    }
}

fn blocks_of<'a>(body: &[&'a str]) -> Vec<Vec<&'a str>> {
    let mut fences = Fences::default();
    let mut blocks = Vec::new();
    let mut current = Vec::new();
    for line in body {
        let fenced = fences.line(line) != FenceLine::Text;
        if !fenced && line.trim().is_empty() {
            if !current.is_empty() {
                blocks.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(*line);
    }
    if !current.is_empty() {
        blocks.push(current);
    }
    blocks
}

fn heading_one(line: &str) -> Option<String> {
    let indent = line.len() - line.trim_start_matches(' ').len();
    let rest = line[indent..].strip_prefix('#')?;
    if indent > 3 || !rest.starts_with([' ', '\t']) {
        return None;
    }
    let text = rest.trim();
    let text = match text.trim_end_matches('#') {
        stripped if stripped.len() < text.len() && stripped.ends_with([' ', '\t']) => {
            stripped.trim_end()
        }
        _ => text,
    };
    (!text.is_empty()).then(|| text.to_string())
}

fn preview(blocks: &[Vec<&str>]) -> String {
    let mut kept: Vec<String> = Vec::new();
    let mut size = 0;
    for block in blocks {
        let text = block.join("\n");
        let length = text.chars().count();
        let next = size + if kept.is_empty() { 0 } else { 2 } + length;
        if next > PREVIEW_CHARS {
            if kept.is_empty() {
                kept.push(cut(block));
            }
            break;
        }
        kept.push(text);
        size = next;
    }
    kept.join("\n\n")
}

fn cut(block: &[&str]) -> String {
    let mut lines = Vec::new();
    let mut size = 0;
    for line in block {
        let next = size + usize::from(!lines.is_empty()) + line.chars().count();
        if next > PREVIEW_CHARS {
            break;
        }
        lines.push(*line);
        size = next;
    }
    if !lines.is_empty() {
        return lines.join("\n");
    }
    let start: String = block
        .first()
        .map_or("", |line| line)
        .chars()
        .take(PREVIEW_CHARS)
        .collect();
    let kept = match start.rfind(' ') {
        Some(space) if start[..space].chars().count() > PREVIEW_CHARS / 2 => &start[..space],
        _ => start.as_str(),
    };
    format!("{}…", kept.trim_end())
}

fn knowledge(note: &IndexedNote, links: &[crate::note_links::LinkTarget]) -> String {
    let parsed = note.parsed();
    let derived = serde_json::json!([
        note.title(),
        parsed.note_id(),
        parsed.head().title,
        parsed.aliases(),
        parsed.tags(),
        links,
    ]);
    hex_lower(&Sha256::digest(derived.to_string().as_bytes()))
}

fn facts_of(note: &IndexedNote, links: &[crate::note_links::LinkTarget]) -> NoteFacts {
    let parsed = note.parsed();
    let head = parsed.head();
    let preview = match &head.heading {
        Some(heading) if heading.to_lowercase() == note.title().trim().to_lowercase() => {
            head.preview_after_heading.clone()
        }
        _ => head.preview.clone(),
    };
    NoteFacts {
        id: note.id().to_string(),
        note_id: parsed.note_id().map(str::to_string),
        title: note.title().to_string(),
        icon: head.icon.clone(),
        color: head.color.clone(),
        agent: head.agent.clone(),
        tags: parsed.tag_labels().to_vec(),
        aliases: parsed.aliases().to_vec(),
        properties: head.properties.clone(),
        preview,
        related_project: note.related_project().map(str::to_string),
        updated_at: note.updated_at(),
        knowledge: knowledge(note, links),
        task_digest: parsed.task_digest().to_string(),
    }
}

pub(crate) fn note_facts_blocking(
    ids: Option<&[String]>,
    related_project: Option<&str>,
) -> Result<Vec<NoteFacts>, String> {
    let wanted: Option<HashSet<&str>> = ids.map(|ids| ids.iter().map(String::as_str).collect());
    let entries = crate::note_index::notes()?;
    let chosen = entries.iter().filter(|entry| {
        wanted
            .as_ref()
            .is_none_or(|wanted| wanted.contains(entry.id.as_str()))
            && related_project
                .is_none_or(|related| entry.related_project.as_deref() == Some(related))
    });
    let mut facts = Vec::new();
    for (entry, note) in crate::note_search::index_entries(chosen) {
        let links = crate::note_links::links_of(entry).unwrap_or_default();
        facts.push(facts_of(&note, &links));
    }
    Ok(facts)
}

#[tauri::command]
pub async fn note_facts(
    ids: Option<Vec<String>>,
    related_project: Option<String>,
) -> Result<Vec<NoteFacts>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        note_facts_blocking(ids.as_deref(), related_project.as_deref())
    })
    .await
    .map_err(|error| format!("reading note facts failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::create_note_project_from;

    fn facts_for(text: &str) -> HeadFacts {
        let front = oleafly_core::front_matter::split(text);
        let lines = front.as_ref().map_or(&[][..], |front| front.lines());
        let body: Vec<&str> = front
            .as_ref()
            .map_or(text, |front| front.body())
            .split('\n')
            .collect();
        head_facts(lines, &body)
    }

    #[test]
    fn the_head_gives_its_declared_look_and_flat_properties() {
        let facts = facts_for(
            "---\ntitle: Masking\nkind: note\nid: n-1\nicon: \"🧪\"\ncolor: rose\nagent: helper\nstatus: draft\nscore: 4.5\ndone: true\ndue: 2026-11-09\nauthors: [Ada, Grace]\nnested:\n  a: 1\n---\n# Masking\n\nRun 3 reached 64.1%.\n",
        );

        assert_eq!(facts.title.as_deref(), Some("Masking"));
        assert_eq!(facts.icon.as_deref(), Some("🧪"));
        assert_eq!(facts.color.as_deref(), Some("rose"));
        assert_eq!(facts.agent.as_deref(), Some("helper"));
        assert_eq!(
            Value::Object(facts.properties),
            serde_json::json!({
                "status": "draft",
                "score": 4.5,
                "done": true,
                "due": "2026-11-09",
                "authors": ["Ada", "Grace"],
            })
        );
        assert_eq!(facts.heading.as_deref(), Some("Masking"));
        assert_eq!(facts.preview, "# Masking\n\nRun 3 reached 64.1%.");
        assert_eq!(facts.preview_after_heading, "Run 3 reached 64.1%.");
    }

    #[test]
    fn a_preview_keeps_whole_blocks_and_fences_and_cuts_one_long_line() {
        let fenced = facts_for("Intro\n\n```\na\n\nb\n```\n\nTail");
        let long_word = "word ".repeat(100);
        let long = facts_for(&format!("{long_word}\n\nNext"));
        let many = facts_for(&format!("{}\n\nSecond", "x".repeat(299)));
        let broken = facts_for("---\ntags: [a\n---\nBody");

        assert_eq!(fenced.preview, "Intro\n\n```\na\n\nb\n```\n\nTail");
        assert!(long.preview.ends_with('…'));
        assert!(long.preview.chars().count() <= PREVIEW_CHARS + 1);
        assert!(!long.preview.contains("Next"));
        assert_eq!(many.preview, "x".repeat(299));
        assert!(broken.properties.is_empty());
        assert_eq!(broken.preview, "Body");
    }

    #[test]
    fn facts_are_filtered_by_id_or_related_project_and_track_what_the_index_derives() {
        let library = crate::collab::testing::TempLibrary::new();
        library.project("facts-paper", &[("main.tex", "x")]);
        let linked = create_note_project_from(
            "Linked".into(),
            "---\nid: n-linked\ntags: [lab]\n---\n# Linked\n\nSee [the paper](oleafly://project/facts-paper).\n".into(),
            Some("facts-paper".into()),
        )
        .unwrap();
        let loose = create_note_project_from("Loose".into(), "Loose body\n".into(), None).unwrap();

        let all = note_facts_blocking(None, None).unwrap();
        let by_project = note_facts_blocking(None, Some("facts-paper")).unwrap();
        let by_id = note_facts_blocking(Some(std::slice::from_ref(&loose)), None).unwrap();
        let before = by_project[0].knowledge.clone();
        let dir = crate::paths::project_dir(&linked).unwrap();
        std::fs::write(
            dir.join(crate::project::NOTE_FILE),
            "---\nid: n-linked\ntags: [lab]\n---\n# Linked\n\nSee [the paper](oleafly://project/facts-paper).\n\nMore words.\n",
        )
        .unwrap();
        let prose_only = note_facts_blocking(Some(std::slice::from_ref(&linked)), None).unwrap();
        std::fs::write(
            dir.join(crate::project::NOTE_FILE),
            "---\nid: n-linked\ntags: [lab, method]\n---\n# Linked\n\nSee the paper.\n\nMore words.\n",
        )
        .unwrap();
        let relinked = note_facts_blocking(Some(std::slice::from_ref(&linked)), None).unwrap();

        assert_eq!(all.len(), 2);
        assert_eq!(by_project.len(), 1);
        let linked_facts = &by_project[0];
        assert_eq!(linked_facts.id, linked);
        assert_eq!(linked_facts.note_id.as_deref(), Some("n-linked"));
        assert_eq!(linked_facts.title, "Linked");
        assert_eq!(linked_facts.tags, ["lab"]);
        assert_eq!(linked_facts.related_project.as_deref(), Some("facts-paper"));
        assert_eq!(
            linked_facts.preview,
            "See [the paper](oleafly://project/facts-paper)."
        );
        assert_eq!(by_id.len(), 1);
        assert_eq!(by_id[0].id, loose);
        assert_eq!(by_id[0].preview, "Loose body");
        assert_eq!(prose_only[0].knowledge, before);
        assert_ne!(relinked[0].knowledge, before);
        assert_eq!(relinked[0].tags, ["lab", "method"]);
    }

    #[test]
    fn a_due_date_moves_the_task_digest_and_leaves_the_knowledge_alone() {
        let _library = crate::collab::testing::TempLibrary::new();
        let id = create_note_project_from(
            "Plan".into(),
            "# Plan\n\n- [ ] Send the draft\n".into(),
            None,
        )
        .unwrap();
        let dir = crate::paths::project_dir(&id).unwrap();
        let read =
            || note_facts_blocking(Some(std::slice::from_ref(&id)), None).unwrap()[0].clone();
        let before = read();
        std::fs::write(
            dir.join(crate::project::NOTE_FILE),
            "# Plan\n\n- [ ] Send the draft\n\nA longer note.\n",
        )
        .unwrap();
        let prose = read();
        std::fs::write(
            dir.join(crate::project::NOTE_FILE),
            "# Plan\n\n- [ ] Send the draft [due:: 2026-11-12]\n\nA longer note.\n",
        )
        .unwrap();
        let due = read();

        assert_eq!(prose.task_digest, before.task_digest);
        assert_ne!(due.task_digest, before.task_digest);
        assert_eq!(due.knowledge, before.knowledge);
        assert_eq!(task_digest("Intro\n"), task_digest("Other words\n"));
    }
}
