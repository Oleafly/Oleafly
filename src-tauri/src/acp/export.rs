//! Conversation export as pretty JSON: `{ "session": …, "exportInfo": …,
//! "events": […] }`. Nothing in it says where the project lives: the
//! session leaves out its path and remote target, paths in the events are
//! written relative to the project, and the agent's stderr is left out.
//!
//! Events are streamed from the store one page at a time, so a transcript
//! near the 64 MiB session limit is never held in memory twice.

use super::{store::Store, types::SessionRecord};
use oleafly_acp::controls::ConfigKind;
use serde::ser::{Error as _, Serialize, SerializeSeq, SerializeStruct, Serializer};
use serde_json::{json, Value};
use std::io::Write;

const PAGE: usize = 500;

struct Events<'a> {
    store: &'a Store,
    id: &'a str,
    /// Where the project lives, as events spell it, longest first.
    roots: Vec<String>,
}

/// The ways an event names the project folder: as a `file://` link and as
/// a path, with `/` and (on Windows) `\`. `folder` is the project's
/// canonical path, `spelled` the one the agent was started in, `remote` the
/// folder on another machine.
fn project_spellings(folder: &str, spelled: &str, remote: Option<&str>) -> Vec<String> {
    let mut roots = Vec::new();
    for root in [Some(folder), Some(spelled), remote].into_iter().flatten() {
        let root = root.trim_end_matches(['/', '\\']);
        if root.is_empty() {
            continue;
        }
        let forward = root.replace('\\', "/");
        let link = if forward.starts_with('/') {
            format!("file://{forward}")
        } else {
            format!("file:///{forward}")
        };
        roots.extend([link, root.to_owned(), forward]);
    }
    roots.sort_by_key(|root| std::cmp::Reverse(root.len()));
    roots.dedup();
    roots
}

/// `text` with the project folder taken out of every path in it.
fn relative_text(text: &str, roots: &[String]) -> String {
    let mut output = text.to_owned();
    for root in roots {
        if output == *root {
            return ".".into();
        }
        for separator in ['/', '\\'] {
            output = output.replace(&format!("{root}{separator}"), "");
        }
    }
    output
}

/// An event as exported: paths relative to the project, no stderr.
fn exported_event(event: &super::types::AcpEvent, roots: &[String]) -> super::types::AcpEvent {
    fn walk(value: &mut Value, roots: &[String]) {
        match value {
            Value::String(text) => *text = relative_text(text, roots),
            Value::Array(values) => values.iter_mut().for_each(|value| walk(value, roots)),
            Value::Object(values) => values.values_mut().for_each(|value| walk(value, roots)),
            _ => {}
        }
    }
    let mut event = event.clone();
    if event.kind == "diagnostics" {
        if let Some(data) = event.data.as_object_mut() {
            data.shift_remove("stderr");
        }
    }
    walk(&mut event.data, roots);
    event
}

impl Serialize for Events<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut sequence = serializer.serialize_seq(None)?;
        let mut after = 0;
        loop {
            let page = self
                .store
                .events(self.id, after, PAGE)
                .map_err(S::Error::custom)?;
            for event in &page.events {
                after = event.sequence;
                sequence.serialize_element(&exported_event(event, &self.roots))?;
            }
            if !page.has_more || page.events.is_empty() {
                break;
            }
        }
        sequence.end()
    }
}

struct Export<'a> {
    session: Value,
    info: Value,
    events: Events<'a>,
}

impl Serialize for Export<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut export = serializer.serialize_struct("Export", 3)?;
        export.serialize_field("session", &self.session)?;
        export.serialize_field("exportInfo", &self.info)?;
        export.serialize_field("events", &self.events)?;
        export.end()
    }
}

/// The current choice of the option in `category`, by display name.
fn option_choice(session: &SessionRecord, category: &str) -> Value {
    let Some(option) = session.controls.by_category(category) else {
        return Value::Null;
    };
    match &option.kind {
        ConfigKind::Select {
            current_value: Some(current),
            options,
        } => json!(options
            .iter()
            .find(|choice| &choice.value == current)
            .map_or(current.as_str(), |choice| choice.name.as_str())),
        ConfigKind::Boolean { current_value } => json!(current_value),
        _ => Value::Null,
    }
}

/// What the export says about how the conversation ran.
pub(super) fn export_info(session: &SessionRecord) -> Value {
    let mode = match option_choice(session, "mode") {
        Value::Null => json!(session.controls.mode_id),
        mode => mode,
    };
    json!({
        "agent": session.agent_id,
        "agentVersion": session.agent_version,
        "model": session.controls.model_id,
        "mode": mode,
        "effort": option_choice(session, "thought_level"),
        "permissionProfile": session.permission_profile,
        "startRevision": session.start_revision,
        "startDirty": session.start_dirty,
        "commits": session.commits,
    })
}

/// The session as exported: without the project path and remote target.
fn exported_session(session: &SessionRecord) -> Result<Value, String> {
    let mut value = serde_json::to_value(session).map_err(|e| e.to_string())?;
    if let Some(object) = value.as_object_mut() {
        object.shift_remove("projectPath");
        object.shift_remove("remote");
    }
    Ok(value)
}

/// Writes the saved conversation `id` to `destination`, an absolute path the
/// user chose. The file appears only once it is complete.
pub(super) fn write_export(store: &Store, id: &str, destination: &str) -> Result<(), String> {
    let session = store.get(id)?;
    let spelled = super::runtime::launch_root_for(std::path::Path::new(&session.project_path));
    let roots = project_spellings(
        &session.project_path,
        &spelled.to_string_lossy(),
        session.remote.as_ref().map(|remote| remote.folder.as_str()),
    );
    let mut file = crate::sandbox::AtomicFile::for_export(destination)?;
    {
        let mut writer = std::io::BufWriter::new(file.staging_file_mut());
        serde_json::to_writer_pretty(
            &mut writer,
            &Export {
                session: exported_session(&session)?,
                info: export_info(&session),
                events: Events { store, id, roots },
            },
        )
        .map_err(|_| "The conversation could not be exported.")?;
        writer
            .write_all(b"\n")
            .and_then(|_| writer.flush())
            .map_err(|_| "The conversation could not be exported.")?;
    }
    file.commit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::AcpEvent;

    fn event(kind: &str, data: Value) -> AcpEvent {
        AcpEvent {
            session_id: "s".into(),
            project_id: "p".into(),
            agent_id: "a".into(),
            model_id: None,
            task_id: None,
            turn_id: None,
            sequence: 1,
            timestamp: 1,
            kind: kind.into(),
            data,
            owner: None,
        }
    }

    #[test]
    fn exported_events_name_project_files_relative_to_it_and_carry_no_stderr() {
        let roots = project_spellings(
            "/Users/me/thesis",
            "/Users/me/thesis",
            Some("/home/me/thesis"),
        );
        let call = exported_event(
            &event(
                "tool_call",
                json!({"title": "Read /Users/me/thesis/ch1/intro.tex",
                    "locations": [{"path": "/Users/me/thesis/main.tex"}, {"path": "/Users/me/thesis"}],
                    "content": [{"type": "resource_link", "uri": "file:///Users/me/thesis/refs.bib"},
                        {"type": "text", "text": "remote /home/me/thesis/out.log"}]}),
            ),
            &roots,
        );
        assert_eq!(call.data["title"], "Read ch1/intro.tex");
        assert_eq!(call.data["locations"][0]["path"], "main.tex");
        assert_eq!(call.data["locations"][1]["path"], ".");
        assert_eq!(call.data["content"][0]["uri"], "refs.bib");
        assert_eq!(call.data["content"][1]["text"], "remote out.log");
        let text = serde_json::to_string(&call).unwrap();
        assert!(!text.contains("/Users/me"), "{text}");
        let diagnostics = exported_event(
            &event("diagnostics", json!({"stderr": "ssh: me@lab: refused"})),
            &roots,
        );
        assert!(diagnostics.data.get("stderr").is_none());
    }

    #[test]
    fn windows_paths_are_made_relative_with_either_separator() {
        let roots = project_spellings(r"C:\Users\me\thesis", r"C:\Users\me\thesis", None);
        assert_eq!(
            relative_text(
                r"C:\Users\me\thesis\ch1\a.tex and C:/Users/me/thesis/b.tex",
                &roots
            ),
            r"ch1\a.tex and b.tex"
        );
        assert_eq!(
            relative_text("file:///C:/Users/me/thesis/c.pdf", &roots),
            "c.pdf"
        );
    }
}
