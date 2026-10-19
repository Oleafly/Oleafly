//! Conversation export as pretty JSON: `{ "session": …, "exportInfo": …,
//! "events": […] }`. The session leaves out where the project lives.
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
                sequence.serialize_element(event)?;
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
    let mut file = crate::sandbox::AtomicFile::for_export(destination)?;
    {
        let mut writer = std::io::BufWriter::new(file.staging_file_mut());
        serde_json::to_writer_pretty(
            &mut writer,
            &Export {
                session: exported_session(&session)?,
                info: export_info(&session),
                events: Events { store, id },
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
