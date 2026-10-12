use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::Arc;

use loro::VersionVector;
use oleafly_collab_protocol::ids::BatchId;
use oleafly_collab_protocol::projects::{project_role_allows, ProjectAction, ProjectRole};
use serde::{Deserialize, Serialize};

use crate::doc::{advance, decode_version, delta_to_operation, DocChanges, ProjectDoc};
use crate::editor::{ChannelError, DocMessage, EditorChannel};
use crate::ot::TextOperation;
use crate::{write_atomic, CollabError};

pub type DocSink = Arc<dyn Fn(DocMessage) + Send + Sync>;

const DOC_FILE: &str = "doc.bin";
const STATE_FILE: &str = "sync.json";
const LOG_FILE: &str = "doc.log";
const LOG_LIMIT: usize = 500;

struct OpenFile {
    channel: EditorChannel,
    sink: DocSink,
}

#[derive(Clone)]
pub struct Outgoing {
    pub batch: BatchId,
    pub payload: Vec<u8>,
    version: VersionVector,
    sent: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DiskWork {
    pub texts: BTreeSet<String>,
    pub tree: bool,
}

impl DiskWork {
    pub fn is_empty(&self) -> bool {
        self.texts.is_empty() && !self.tree
    }
}

#[derive(Serialize, Deserialize)]
struct StoredState {
    last_seq: u64,
    #[serde(with = "crate::live::hex_bytes")]
    confirmed: Vec<u8>,
}

pub struct LiveProject {
    doc: ProjectDoc,
    last_seq: u64,
    confirmed: VersionVector,
    outgoing: Option<Outgoing>,
    open: HashMap<String, OpenFile>,
    disk: DiskWork,
    role: ProjectRole,
    received: u64,
    catch_up: Option<std::collections::BTreeMap<String, u32>>,
    seen: BTreeSet<u64>,
    persisted: Option<VersionVector>,
    log_records: usize,
}

fn read_log(path: &Path) -> Vec<Vec<u8>> {
    let Ok(bytes) = std::fs::read(path) else {
        return Vec::new();
    };
    let mut records = Vec::new();
    let mut at = 0;
    while at + 4 <= bytes.len() {
        let length =
            u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]) as usize;
        let Some(end) = at.checked_add(4 + length).filter(|end| *end <= bytes.len()) else {
            break;
        };
        records.push(bytes[at + 4..end].to_vec());
        at = end;
    }
    records
}

fn append_log(path: &Path, record: &[u8]) -> Result<(), CollabError> {
    use std::io::Write;
    let length = u32::try_from(record.len())
        .map_err(|_| CollabError::Corrupt("a change record is too large".to_owned()))?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| CollabError::Io(error.to_string()))?;
    let mut framed = Vec::with_capacity(record.len() + 4);
    framed.extend_from_slice(&length.to_le_bytes());
    framed.extend_from_slice(record);
    file.write_all(&framed)
        .and_then(|()| file.sync_data())
        .map_err(|error| CollabError::Io(error.to_string()))
}

impl LiveProject {
    pub fn new(doc: ProjectDoc, last_seq: u64, role: ProjectRole) -> LiveProject {
        let confirmed = doc.version();
        LiveProject {
            doc,
            last_seq,
            confirmed,
            outgoing: None,
            open: HashMap::new(),
            disk: DiskWork::default(),
            role,
            received: 0,
            catch_up: None,
            seen: BTreeSet::new(),
            persisted: None,
            log_records: 0,
        }
    }

    pub fn load(dir: &Path, role: ProjectRole) -> Result<LiveProject, CollabError> {
        let bytes = std::fs::read(dir.join(DOC_FILE))
            .map_err(|error| CollabError::Io(error.to_string()))?;
        let state: StoredState = serde_json::from_slice(
            &std::fs::read(dir.join(STATE_FILE))
                .map_err(|error| CollabError::Io(error.to_string()))?,
        )
        .map_err(|error| CollabError::Corrupt(error.to_string()))?;
        let mut doc = ProjectDoc::load(&bytes)?;
        let records = read_log(&dir.join(LOG_FILE));
        for record in &records {
            if doc.import(record).is_err() {
                break;
            }
        }
        let mut live = LiveProject::new(doc, state.last_seq, role);
        live.confirmed = decode_version(&state.confirmed)?;
        live.persisted = Some(live.doc.version());
        live.log_records = records.len();
        Ok(live)
    }

    pub fn save(&mut self, dir: &Path) -> Result<(), CollabError> {
        std::fs::create_dir_all(dir).map_err(|error| CollabError::Io(error.to_string()))?;
        let appendable = self.log_records < LOG_LIMIT && dir.join(DOC_FILE).is_file();
        match self.persisted.as_ref().filter(|_| appendable) {
            Some(persisted) => {
                if self.doc.has_changes_since(persisted) {
                    append_log(&dir.join(LOG_FILE), &self.doc.export_since(persisted)?)?;
                    self.log_records += 1;
                }
            }
            None => {
                write_atomic(&dir.join(DOC_FILE), &self.doc.snapshot()?)?;
                match std::fs::remove_file(dir.join(LOG_FILE)) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(CollabError::Io(error.to_string())),
                }
                self.log_records = 0;
            }
        }
        self.persisted = Some(self.doc.version());
        let state = StoredState {
            last_seq: self.last_seq,
            confirmed: self.confirmed.encode(),
        };
        let json =
            serde_json::to_vec(&state).map_err(|error| CollabError::Corrupt(error.to_string()))?;
        write_atomic(&dir.join(STATE_FILE), &json)
    }

    pub fn exists(dir: &Path) -> bool {
        dir.join(DOC_FILE).is_file() && dir.join(STATE_FILE).is_file()
    }

    pub fn doc(&self) -> &ProjectDoc {
        &self.doc
    }

    pub fn doc_mut(&mut self) -> &mut ProjectDoc {
        self.disk.tree = true;
        &mut self.doc
    }

    pub fn last_seq(&self) -> u64 {
        self.last_seq
    }

    pub fn role(&self) -> ProjectRole {
        self.role
    }

    pub fn set_role(&mut self, role: ProjectRole) {
        self.role = role;
    }

    pub fn can_edit(&self) -> bool {
        project_role_allows(self.role, ProjectAction::Edit)
    }

    pub fn received(&self) -> u64 {
        self.received
    }

    pub fn open_file(&mut self, id: &str, sink: DocSink) -> Result<(u64, String), CollabError> {
        let text = self.doc.text(id)?;
        let channel = EditorChannel::new(text.clone());
        let rev = channel.rev();
        self.open.insert(id.to_owned(), OpenFile { channel, sink });
        Ok((rev, text))
    }

    pub fn close_file(&mut self, id: &str) {
        self.open.remove(id);
    }

    pub fn is_open(&self, id: &str) -> bool {
        self.open.contains_key(id)
    }

    pub fn editor_change(
        &mut self,
        id: &str,
        base_rev: u64,
        operation: TextOperation,
    ) -> Result<(), CollabError> {
        if !self.can_edit() {
            self.reset_file(id)?;
            return Ok(());
        }
        let open = self
            .open
            .get_mut(id)
            .ok_or_else(|| CollabError::Corrupt(format!("the file {id} is not open")))?;
        match open.channel.receive(base_rev, operation) {
            Ok(applied) => {
                let message = DocMessage::Ack {
                    rev: open.channel.rev(),
                    length: open.channel.length(),
                };
                let sink = Arc::clone(&open.sink);
                self.doc.apply_operation(id, &applied)?;
                self.disk.texts.insert(id.to_owned());
                sink(message);
                Ok(())
            }
            Err(ChannelError::Stale | ChannelError::Invalid(_)) => self.reset_file(id),
        }
    }

    fn reset_file(&mut self, id: &str) -> Result<(), CollabError> {
        let text = self.doc.text(id)?;
        if let Some(open) = self.open.get_mut(id) {
            let rev = open.channel.reset(text.clone());
            (open.sink)(DocMessage::Reset { rev, text });
        }
        Ok(())
    }

    fn route(&mut self, changes: DocChanges) -> Result<(), CollabError> {
        if changes.tree {
            self.disk.tree = true;
        }
        for (id, deltas) in changes.texts {
            self.disk.texts.insert(id.clone());
            if let Some(counts) = self.catch_up.as_mut() {
                *counts.entry(id.clone()).or_default() += 1;
            }
            let Some(open) = self.open.get_mut(&id) else {
                continue;
            };
            let routed = delta_to_operation(open.channel.text(), &deltas)
                .ok()
                .and_then(|operation| {
                    open.channel
                        .remote(operation.clone())
                        .ok()
                        .map(|_| operation)
                });
            match routed {
                Some(operation) => (open.sink)(DocMessage::Remote {
                    rev: open.channel.rev(),
                    op: operation,
                    length: open.channel.length(),
                }),
                None => self.reset_file(&id)?,
            }
        }
        Ok(())
    }

    fn mark_seen(&mut self, seq: u64) {
        if seq > self.last_seq {
            self.seen.insert(seq);
        }
        while self.seen.remove(&(self.last_seq + 1)) {
            self.last_seq += 1;
        }
    }

    pub fn import_update(&mut self, seq: u64, payload: &[u8]) -> Result<bool, CollabError> {
        if seq <= self.last_seq || self.seen.contains(&seq) {
            return Ok(false);
        }
        let imported = self.doc.import(payload)?;
        advance(&mut self.confirmed, &imported.arrived);
        self.mark_seen(seq);
        self.received += 1;
        self.route(imported.changes)?;
        Ok(true)
    }

    pub fn import_snapshot(&mut self, seq: u64, snapshot: &[u8]) -> Result<(), CollabError> {
        let imported = self.doc.import(snapshot)?;
        advance(&mut self.confirmed, &imported.arrived);
        self.last_seq = self.last_seq.max(seq);
        self.seen.retain(|known| *known > seq);
        self.mark_seen(seq);
        self.route(imported.changes)
    }

    pub fn begin_catch_up(&mut self) {
        self.catch_up = Some(std::collections::BTreeMap::new());
    }

    pub fn end_catch_up(&mut self) -> std::collections::BTreeMap<String, u32> {
        self.catch_up.take().unwrap_or_default()
    }

    pub fn pending_changes(&self) -> u64 {
        self.doc.pending_since(&self.confirmed)
    }

    pub fn local_text(&mut self, id: &str, content: &str) -> Result<bool, CollabError> {
        let changes = self.doc.set_text(id, content)?;
        let changed = !changes.is_empty();
        self.route(changes)?;
        Ok(changed)
    }

    pub fn local_operation(
        &mut self,
        id: &str,
        operation: &TextOperation,
    ) -> Result<bool, CollabError> {
        if operation.is_noop() {
            return Ok(false);
        }
        self.doc.apply_operation(id, operation)?;
        self.disk.texts.insert(id.to_owned());
        let Some(open) = self.open.get_mut(id) else {
            return Ok(true);
        };
        if open.channel.remote(operation.clone()).is_err() {
            self.reset_file(id)?;
            return Ok(true);
        }
        (open.sink)(DocMessage::Remote {
            rev: open.channel.rev(),
            op: operation.clone(),
            length: open.channel.length(),
        });
        Ok(true)
    }

    pub fn next_outgoing(&mut self) -> Result<Option<Outgoing>, CollabError> {
        if let Some(outgoing) = self.outgoing.as_mut() {
            if outgoing.sent {
                return Ok(None);
            }
            outgoing.sent = true;
            return Ok(Some(outgoing.clone()));
        }
        if !self.can_edit() || !self.doc.has_changes_since(&self.confirmed) {
            return Ok(None);
        }
        let outgoing = Outgoing {
            batch: BatchId::new_v7(),
            payload: self.doc.export_since(&self.confirmed)?,
            version: self.doc.version(),
            sent: true,
        };
        self.outgoing = Some(outgoing.clone());
        Ok(Some(outgoing))
    }

    pub fn acknowledged(&mut self, batch: BatchId, seq: u64) {
        if self
            .outgoing
            .as_ref()
            .is_some_and(|outgoing| outgoing.batch == batch)
        {
            if let Some(outgoing) = self.outgoing.take() {
                self.confirmed.merge(&outgoing.version);
            }
            self.mark_seen(seq);
        }
    }

    pub fn refused(&mut self) {
        self.outgoing = None;
    }

    pub fn disconnected(&mut self) {
        if let Some(outgoing) = self.outgoing.as_mut() {
            outgoing.sent = false;
        }
    }

    pub fn has_unsent(&self) -> bool {
        self.outgoing.is_some() || self.doc.has_changes_since(&self.confirmed)
    }

    pub fn mark_all_dirty(&mut self) -> Result<(), CollabError> {
        self.disk.tree = true;
        for node in self.doc.nodes()? {
            if node.kind == crate::doc::NodeKind::Text {
                self.disk.texts.insert(node.id);
            }
        }
        Ok(())
    }

    pub fn take_disk_work(&mut self) -> DiskWork {
        std::mem::take(&mut self.disk)
    }
}

pub(crate) mod hex_bytes {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
        let text: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        serializer.serialize_str(&text)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<u8>, D::Error> {
        let text = String::deserialize(deserializer)?;
        (0..text.len())
            .step_by(2)
            .map(|index| {
                text.get(index..index + 2)
                    .and_then(|pair| u8::from_str_radix(pair, 16).ok())
                    .ok_or_else(|| serde::de::Error::custom("not hex"))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::doc::NodeKind;

    fn recorder() -> (DocSink, Arc<Mutex<Vec<DocMessage>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let copy = Arc::clone(&seen);
        let sink: DocSink = Arc::new(move |message| copy.lock().unwrap().push(message));
        (sink, seen)
    }

    fn insert(position: usize, text: &str, length: usize) -> TextOperation {
        let mut operation = TextOperation::new();
        operation
            .retain(position)
            .insert(text)
            .retain(length - position);
        operation
    }

    fn pair() -> (LiveProject, LiveProject, String) {
        let mut doc = ProjectDoc::create().unwrap();
        let main = doc
            .add_node(None, "main.tex", NodeKind::Text, None, "abc")
            .unwrap();
        let snapshot = doc.snapshot().unwrap();
        let owner = LiveProject::new(doc, 0, ProjectRole::Owner);
        let editor = LiveProject::new(ProjectDoc::load(&snapshot).unwrap(), 0, ProjectRole::Editor);
        (owner, editor, main)
    }

    #[test]
    fn typing_on_one_side_reaches_the_open_editor_on_the_other() {
        let (mut bob, mut alice, main) = pair();
        let (bob_sink, bob_seen) = recorder();
        let (alice_sink, alice_seen) = recorder();
        bob.open_file(&main, bob_sink).unwrap();
        alice.open_file(&main, alice_sink).unwrap();
        bob.editor_change(&main, 0, insert(3, "d", 3)).unwrap();
        assert_eq!(
            bob_seen.lock().unwrap()[0],
            DocMessage::Ack { rev: 1, length: 4 }
        );
        let outgoing = bob.next_outgoing().unwrap().expect("a change to send");
        assert!(bob.next_outgoing().unwrap().is_none());
        assert!(alice.import_update(1, &outgoing.payload).unwrap());
        assert!(!alice.import_update(1, &outgoing.payload).unwrap());
        assert_eq!(
            alice_seen.lock().unwrap()[0],
            DocMessage::Remote {
                rev: 1,
                op: insert(3, "d", 3),
                length: 4
            }
        );
        bob.acknowledged(outgoing.batch, 1);
        assert!(!bob.has_unsent());
        assert_eq!(bob.last_seq(), 1);
        assert!(!alice.has_unsent());
        let work = alice.take_disk_work();
        assert!(work.texts.contains(&main));
    }

    #[test]
    fn updates_that_arrive_out_of_order_are_all_applied() {
        let (mut bob, mut alice, main) = pair();
        bob.local_text(&main, "abcd").unwrap();
        let first = bob.next_outgoing().unwrap().unwrap();
        bob.acknowledged(first.batch, 1);
        bob.local_text(&main, "abcde").unwrap();
        let second = bob.next_outgoing().unwrap().unwrap();
        assert!(alice.import_update(2, &second.payload).unwrap());
        assert_eq!(alice.last_seq(), 0);
        assert!(alice.import_update(1, &first.payload).unwrap());
        assert_eq!(alice.last_seq(), 2);
        assert_eq!(alice.doc().text(&main).unwrap(), "abcde");
        assert!(!alice.import_update(2, &second.payload).unwrap());
    }

    #[test]
    fn an_own_acknowledgement_fills_the_gap_between_others_updates() {
        let (mut bob, mut alice, main) = pair();
        alice.local_text(&main, "abcX").unwrap();
        let mine = alice.next_outgoing().unwrap().unwrap();
        bob.local_text(&main, "Yabc").unwrap();
        let theirs = bob.next_outgoing().unwrap().unwrap();
        assert!(alice.import_update(2, &theirs.payload).unwrap());
        alice.acknowledged(mine.batch, 1);
        assert_eq!(alice.last_seq(), 2);
    }

    #[test]
    fn an_unacknowledged_change_is_sent_again_after_a_reconnect() {
        let (mut bob, _alice, main) = pair();
        let (sink, _seen) = recorder();
        bob.open_file(&main, sink).unwrap();
        bob.editor_change(&main, 0, insert(0, "x", 3)).unwrap();
        let first = bob.next_outgoing().unwrap().unwrap();
        bob.disconnected();
        let again = bob.next_outgoing().unwrap().unwrap();
        assert_eq!(first.batch, again.batch);
        assert_eq!(first.payload, again.payload);
    }

    #[test]
    fn a_viewer_cannot_change_text_and_gets_the_file_back() {
        let (_bob, mut alice, main) = pair();
        alice.set_role(ProjectRole::Viewer);
        let (sink, seen) = recorder();
        alice.open_file(&main, sink).unwrap();
        alice.editor_change(&main, 0, insert(0, "x", 3)).unwrap();
        assert_eq!(
            seen.lock().unwrap()[0],
            DocMessage::Reset {
                rev: 1,
                text: "abc".to_owned()
            }
        );
        assert!(alice.next_outgoing().unwrap().is_none());
    }

    #[test]
    fn a_disk_edit_reaches_the_open_editor_and_the_outbox() {
        let (mut bob, _alice, main) = pair();
        let (sink, seen) = recorder();
        bob.open_file(&main, sink).unwrap();
        assert!(bob.local_text(&main, "abXc").unwrap());
        assert_eq!(
            seen.lock().unwrap()[0],
            DocMessage::Remote {
                rev: 1,
                op: insert(2, "X", 3),
                length: 4
            }
        );
        assert!(bob.has_unsent());
    }

    #[test]
    fn changes_that_arrive_while_catching_up_are_counted_per_file() {
        let (mut bob, mut alice, main) = pair();
        bob.local_text(&main, "abcd").unwrap();
        let first = bob.next_outgoing().unwrap().unwrap();
        bob.acknowledged(first.batch, 1);
        bob.local_text(&main, "abcde").unwrap();
        let second = bob.next_outgoing().unwrap().unwrap();
        alice.begin_catch_up();
        alice.import_update(1, &first.payload).unwrap();
        alice.import_update(2, &second.payload).unwrap();
        let counts = alice.end_catch_up();
        assert_eq!(counts.get(&main), Some(&2));
        assert!(alice.end_catch_up().is_empty());
        assert_eq!(bob.pending_changes(), 1);
    }

    #[test]
    fn a_local_operation_reaches_the_open_editor_and_the_outbox() {
        let (mut bob, _alice, main) = pair();
        let (sink, seen) = recorder();
        bob.open_file(&main, sink).unwrap();
        assert!(bob.local_operation(&main, &insert(1, "Z", 3)).unwrap());
        assert_eq!(bob.doc().text(&main).unwrap(), "aZbc");
        assert_eq!(
            seen.lock().unwrap()[0],
            DocMessage::Remote {
                rev: 1,
                op: insert(1, "Z", 3),
                length: 4
            }
        );
        assert!(!bob
            .local_operation(&main, &TextOperation::between("aZbc", "aZbc"))
            .unwrap());
    }

    #[test]
    fn state_survives_a_save_and_load() {
        let (mut bob, _alice, main) = pair();
        bob.local_text(&main, "abcdef").unwrap();
        let dir = tempfile::tempdir().unwrap();
        bob.save(dir.path()).unwrap();
        assert!(LiveProject::exists(dir.path()));
        let loaded = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert_eq!(loaded.doc().text(&main).unwrap(), "abcdef");
        assert!(loaded.has_unsent());
    }

    fn type_at_end(live: &mut LiveProject, id: &str, text: &str) {
        let current = live.doc().text(id).unwrap();
        let mut operation = TextOperation::default();
        operation.retain(current.encode_utf16().count());
        operation.insert(text);
        live.local_operation(id, &operation).unwrap();
    }

    #[test]
    fn many_small_saves_reload_every_change() {
        let (mut bob, _alice, main) = pair();
        let dir = tempfile::tempdir().unwrap();
        bob.save(dir.path()).unwrap();
        for round in 0..60 {
            type_at_end(&mut bob, &main, &format!(" {round}"));
            bob.save(dir.path()).unwrap();
        }
        let loaded = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert_eq!(
            loaded.doc().text(&main).unwrap(),
            bob.doc().text(&main).unwrap()
        );
        assert_eq!(loaded.last_seq(), bob.last_seq());
    }

    #[test]
    fn a_small_change_is_appended_instead_of_rewriting_the_whole_document() {
        let (mut bob, _alice, main) = pair();
        let body: String = (0..2_000u64)
            .map(|line| format!("line {line} {:x}\n", line.wrapping_mul(2_654_435_761)))
            .collect();
        bob.local_text(&main, &body).unwrap();
        let dir = tempfile::tempdir().unwrap();
        bob.save(dir.path()).unwrap();
        let snapshot = std::fs::read(dir.path().join(DOC_FILE)).unwrap();
        type_at_end(&mut bob, &main, "x");
        bob.save(dir.path()).unwrap();
        assert_eq!(std::fs::read(dir.path().join(DOC_FILE)).unwrap(), snapshot);
        let log = std::fs::metadata(dir.path().join(LOG_FILE)).unwrap().len() as usize;
        assert!(
            log * 20 < snapshot.len(),
            "log {log} snapshot {}",
            snapshot.len()
        );
    }

    #[test]
    fn a_half_written_change_record_is_ignored_on_load() {
        let (mut bob, _alice, main) = pair();
        let dir = tempfile::tempdir().unwrap();
        bob.save(dir.path()).unwrap();
        type_at_end(&mut bob, &main, " kept");
        bob.save(dir.path()).unwrap();
        let mut log = std::fs::OpenOptions::new()
            .append(true)
            .open(dir.path().join(LOG_FILE))
            .unwrap();
        std::io::Write::write_all(&mut log, &[200, 0, 0, 0, 1, 2, 3]).unwrap();
        let loaded = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert!(loaded.doc().text(&main).unwrap().ends_with(" kept"));
    }

    #[test]
    fn the_change_log_is_folded_into_the_document_after_many_saves() {
        let (mut bob, _alice, main) = pair();
        let dir = tempfile::tempdir().unwrap();
        bob.save(dir.path()).unwrap();
        for round in 0..=LOG_LIMIT {
            type_at_end(&mut bob, &main, &format!("{}", round % 10));
            bob.save(dir.path()).unwrap();
        }
        let log = std::fs::metadata(dir.path().join(LOG_FILE)).map_or(0, |meta| meta.len());
        assert!(log < 1_000, "log still {log} bytes");
        let loaded = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert_eq!(
            loaded.doc().text(&main).unwrap(),
            bob.doc().text(&main).unwrap()
        );
    }
}
