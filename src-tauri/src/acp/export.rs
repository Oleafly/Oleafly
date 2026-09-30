//! Conversation export as pretty JSON: `{ "session": …, "events": […] }`.
//!
//! Events are streamed from the store one page at a time, so a transcript
//! near the 64 MiB session limit is never held in memory twice.

use super::{store::Store, types::SessionRecord};
use serde::ser::{Error as _, Serialize, SerializeSeq, SerializeStruct, Serializer};
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
    session: &'a SessionRecord,
    events: Events<'a>,
}

impl Serialize for Export<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut export = serializer.serialize_struct("Export", 2)?;
        export.serialize_field("session", self.session)?;
        export.serialize_field("events", &self.events)?;
        export.end()
    }
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
                session: &session,
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
