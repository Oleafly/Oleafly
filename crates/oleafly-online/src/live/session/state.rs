use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use oleafly_ot::{
    diff, utf16_len, ChannelError, DocMessage, DocOpened, DocSink, EditorChannel, OtError,
    TextOperation,
};
use serde_json::Value;

use super::catch_up::History;
use super::{
    Account, DocStopReason, LiveEnd, LiveError, LivePeer, LivePort, LiveState, MergeReview,
    OutsideText, Overlap, Resolution, Seed, Seeded, SignedIn, UnsentDoc,
};
use crate::live::doc::{
    Applied, DocError, DocFault, Limit, Origin, OutgoingUpdate, OverleafDoc, Rejoin,
};
use crate::live::format::{pieces_from_json, CodecError, DocFormat, FormatState, Piece};
use crate::live::history_ot::{edits_from_json, Edit};
use crate::live::join::{JoinFailure, JoinedDoc};
use crate::live::journal::{plain_doc_id, DocRecord, Journal, ProjectManifest, WRITE_EVERY};
use crate::live::tree_queue::Queued;
use crate::live::{AppliedUpdate, DocId, PublicId, SendMode, Tracking};
use crate::realtime::events::{AccessEvent, EntityId, ProjectEvent};
use crate::realtime::project::{Members, ProjectState, Rejoined, Role};
use crate::realtime::tree::{NodeKind, PathChange};

mod chat;
mod fill;
mod peers;
mod people;
mod review;
mod tree;

pub(super) use chat::{ChatTicket, Paged};
pub(super) use review::IdsReady;
pub(super) use tree::{name_of, parent_of, Finished, Job};

const JOURNAL_BACKOFF: Duration = Duration::from_millis(250);
const JOURNAL_BACKOFF_MAX: Duration = Duration::from_secs(5);
const UNSTEADY_WITHIN: Duration = Duration::from_secs(10 * 60);
const OWN_KEPT: usize = 16;

pub(super) enum Notice {
    State(LiveState),
    Role(Role, bool),
    Flags(bool, bool),
    MembersChanged,
    Texts(Vec<DocId>),
    RemoteEdit(DocId, Option<String>),
    Tree(Vec<PathChange>),
    Peer(LivePeer),
    PeerLeft(PublicId),
    Stopped(DocId, DocStopReason),
    Project(ProjectEvent),
    Merged(DocId, MergeReview),
    Unsent {
        doc: DocId,
        path: Option<String>,
        text: String,
    },
    Journal(Option<String>),
    Pending(DocId, bool),
    AccountChanged(Account),
    Editor(DocSink, DocMessage),
    Maintenance(String, Duration),
    SlowAck(bool),
    Unsteady(DocId),
    Queue(Vec<Queued>),
    Uploaded {
        path: String,
        tag: String,
        hash: Option<String>,
    },
    External(DocId),
    Replaced(DocId),
    Review(super::ReviewChange),
    Chat(super::ChatChange),
    Filling(usize, usize),
    Seeded(String, Seeded),
}

pub(super) fn deliver_to_editors(notices: Vec<Notice>) -> Vec<Notice> {
    let mut rest = Vec::with_capacity(notices.len());
    for notice in notices {
        match notice {
            Notice::Editor(sink, message) => sink(message),
            other => rest.push(other),
        }
    }
    rest
}

pub(super) fn deliver(port: &dyn LivePort, notices: Vec<Notice>) {
    let mut edited = BTreeSet::new();
    for notice in notices {
        match notice {
            Notice::State(state) => port.state(state),
            Notice::Role(role, tracking) => port.role(role, tracking),
            Notice::Flags(restricted, deleted) => port.project_flags(restricted, deleted),
            Notice::MembersChanged => port.members_changed(),
            Notice::Texts(docs) => port.texts_changed(docs),
            Notice::RemoteEdit(doc, user_id) => {
                if edited.insert((doc.clone(), user_id.clone())) {
                    port.remote_edit(&doc, user_id.as_deref());
                }
            }
            Notice::Tree(changes) => port.tree_changed(changes),
            Notice::Peer(peer) => port.peer(peer),
            Notice::PeerLeft(id) => port.peer_left(&id),
            Notice::Stopped(doc, reason) => port.doc_stopped(&doc, reason),
            Notice::Project(event) => port.project_event(event),
            Notice::Merged(doc, review) => port.merged(&doc, review),
            Notice::Unsent { doc, path, text } => {
                let on_disk = path.and_then(|path| port.disk_text(&path));
                let review = if on_disk.as_ref() == Some(&text) {
                    MergeReview::InFile
                } else {
                    MergeReview::Kept { text }
                };
                port.merged(&doc, review);
            }
            Notice::Journal(reason) => port.journal_failed(reason),
            Notice::External(doc) => port.external_update(&doc),
            Notice::Replaced(doc) => port.characters_replaced(&doc),
            Notice::Pending(doc, pending) => port.doc_pending(&doc, pending),
            Notice::AccountChanged(account) => port.account_changed(account),
            Notice::Editor(sink, message) => sink(message),
            Notice::Maintenance(message, delay) => port.maintenance(&message, delay),
            Notice::SlowAck(waiting) => port.slow_ack(waiting),
            Notice::Unsteady(doc) => port.doc_unsteady(&doc),
            Notice::Queue(changes) => port.tree_queue(changes),
            Notice::Uploaded { path, tag, hash } => port.uploaded(&path, &tag, hash.as_deref()),
            Notice::Review(change) => port.review_changed(change),
            Notice::Chat(change) => port.chat_changed(change),
            Notice::Filling(done, total) => port.filling(done, total),
            Notice::Seeded(path, outcome) => port.seeded(&path, outcome),
        }
    }
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

pub(super) fn iso_time(ms: u64) -> String {
    crate::realtime::events::iso_time(i64::try_from(ms).unwrap_or(i64::MAX))
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum Phase {
    #[default]
    Unjoined,
    Wanted,
    CatchUp,
    Joined,
    Held,
    Stopped,
}

struct Editor {
    channel: EditorChannel,
    sink: DocSink,
    session: u64,
}

#[derive(Default)]
struct Slot {
    doc: Option<OverleafDoc>,
    editor: Option<Editor>,
    buffer: Vec<AppliedUpdate>,
    listed: Vec<(Option<PublicId>, u64)>,
    phase: Phase,
    resume: Option<DocRecord>,
    held: Option<DocRecord>,
    errors: u8,
    foreign: Option<Instant>,
    shown_pending: bool,
    dirty: bool,
    missed_fresh: bool,
    reloading: Option<String>,
}

impl Slot {
    fn unconfirmed(&self) -> bool {
        self.resume.is_some()
            || (self.phase == Phase::Held && self.held.is_some())
            || self.doc.as_ref().is_some_and(|doc| !doc.is_settled())
    }

    fn already_listed(&mut self, update: &AppliedUpdate) -> bool {
        let found = self
            .listed
            .iter()
            .position(|(source, v)| *source == update.source && *v == update.v)
            .filter(|_| update.op.is_some());
        if let Some(index) = found {
            self.listed.swap_remove(index);
        }
        found.is_some()
    }

    fn waits_for_server(&self) -> bool {
        !matches!(self.phase, Phase::Held | Phase::Stopped) && self.unconfirmed()
    }

    fn record(&self) -> Option<DocRecord> {
        if self.phase == Phase::Held {
            return self.held.clone();
        }
        if let Some(record) = &self.resume {
            return Some(record.clone());
        }
        let known = self.doc.as_ref().filter(|known| !known.is_settled())?;
        known.record().ok()
    }

    fn unsent_edits(&self) -> bool {
        self.resume.is_some()
            || (self.phase == Phase::Held && self.held.is_some())
            || self.doc.as_ref().is_some_and(OverleafDoc::has_unsent_text)
    }

    fn unsent_text(&mut self) -> Option<String> {
        let unsent = self.doc.take().filter(|known| !known.is_settled());
        self.resume
            .take()
            .or_else(|| self.held.take())
            .map(|record| record.local_text)
            .or_else(|| unsent.map(|known| known.text().to_string()))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum JoinKind {
    Fresh,
    From(u64),
}

#[derive(Default)]
pub(super) struct JournalBatch {
    pub(super) manifest: Option<ProjectManifest>,
    pub(super) docs: Vec<(DocId, Option<DocRecord>)>,
    pub(super) tree: Option<Vec<Queued>>,
}

pub(super) struct State {
    pub(super) project: ProjectState,
    pub(super) notices: Vec<Notice>,
    pub(super) page_limit: Option<usize>,
    pub(super) ended: Option<LiveEnd>,
    me: String,
    email: String,
    signed_out: bool,
    port: Arc<dyn LivePort>,
    connected_wall_ms: u64,
    broadcasts: BTreeSet<DocId>,
    slots: BTreeMap<DocId, Slot>,
    own: Vec<PublicId>,
    current: Option<PublicId>,
    online: bool,
    urgent: VecDeque<DocId>,
    paced: VecDeque<DocId>,
    pace: Option<(usize, Duration)>,
    next_paced: Option<Instant>,
    queued: BTreeSet<DocId>,
    next_session: u64,
    presence: Option<(DocId, usize)>,
    presence_due: bool,
    check_project: bool,
    manifest: ProjectManifest,
    manifest_dirty: bool,
    history_target: Option<u64>,
    journal_written: Option<Instant>,
    journal_retry: Option<(Instant, Duration)>,
    journal_failing: bool,
    last_pending: Option<u64>,
    acks: u64,
    tree_work: tree::TreeWork,
    seeds: Vec<Seed>,
    replaced_shown: bool,
    unreadable: u8,
    after_change: Option<BTreeSet<DocId>>,
    peers: peers::Peers,
    review: review::ReviewBook,
    chat: chat::ChatBook,
    people: people::PeopleBook,
    filling: Option<fill::Filling>,
    filled: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Handshake {
    Joined,
    Unreadable,
    Ended,
}

const UNREADABLE_HANDSHAKES: u8 = 3;

impl State {
    pub(super) fn new(
        project: ProjectState,
        account: Account,
        journal: &Journal,
        port: Arc<dyn LivePort>,
    ) -> State {
        let mut state = State {
            project,
            notices: Vec::new(),
            page_limit: None,
            ended: None,
            me: account.user_id,
            email: account.email,
            signed_out: false,
            port,
            connected_wall_ms: 0,
            broadcasts: BTreeSet::new(),
            slots: BTreeMap::new(),
            own: Vec::new(),
            current: None,
            online: false,
            urgent: VecDeque::new(),
            paced: VecDeque::new(),
            pace: None,
            next_paced: None,
            queued: BTreeSet::new(),
            next_session: 0,
            presence: None,
            presence_due: false,
            check_project: false,
            manifest: journal.manifest().clone(),
            manifest_dirty: false,
            history_target: None,
            journal_written: None,
            journal_retry: None,
            journal_failing: false,
            last_pending: None,
            acks: 0,
            tree_work: tree::TreeWork::default(),
            seeds: Vec::new(),
            replaced_shown: false,
            unreadable: 0,
            after_change: None,
            peers: peers::Peers::default(),
            review: review::ReviewBook::default(),
            chat: chat::ChatBook::default(),
            people: people::PeopleBook::default(),
            filling: None,
            filled: false,
        };
        state.take_journal(journal.docs());
        state.take_tree_queue(journal.tree_queue());
        state
    }

    fn take_journal(&mut self, records: &BTreeMap<DocId, DocRecord>) {
        let previous = Account {
            user_id: std::mem::take(&mut self.manifest.user_id),
            email: std::mem::take(&mut self.manifest.user_email),
        };
        let foreign = !previous.user_id.is_empty() && previous.user_id != self.me;
        for (doc, record) in records {
            let slot = self.slots.entry(doc.clone()).or_default();
            if foreign {
                slot.dirty = true;
                self.notices.push(Notice::Merged(
                    doc.clone(),
                    MergeReview::Kept {
                        text: record.local_text.clone(),
                    },
                ));
                continue;
            }
            slot.resume = Some(record.clone());
            slot.phase = Phase::CatchUp;
            self.want(doc);
        }
        if foreign && !records.is_empty() {
            self.notices.push(Notice::AccountChanged(previous));
        }
        self.note_account();
    }

    fn note_account(&mut self) {
        self.manifest.user_id = self.me.clone();
        self.manifest.user_email = self.email.clone();
        self.manifest_dirty = true;
    }

    pub(super) fn park_signed_out(&mut self) {
        if self.ended.is_none() {
            self.forget_peers();
            self.online = false;
            self.signed_out = true;
            self.last_pending = None;
        }
    }

    pub(super) fn is_signed_out(&self) -> bool {
        self.signed_out
    }

    pub(super) fn account(&self) -> Account {
        Account {
            user_id: self.me.clone(),
            email: self.email.clone(),
        }
    }

    pub(super) fn signed_in(&mut self, account: Account) -> SignedIn {
        self.signed_out = false;
        if account.user_id == self.me {
            self.email = account.email;
            self.note_account();
            return SignedIn::Resumed;
        }
        let typed_as = Account {
            user_id: std::mem::replace(&mut self.me, account.user_id),
            email: std::mem::replace(&mut self.email, account.email),
        };
        self.hand_back_all();
        self.note_account();
        self.notices.push(Notice::AccountChanged(typed_as.clone()));
        SignedIn::AccountChanged { typed_as }
    }

    fn hand_back_all(&mut self) {
        self.hand_back(|slot| slot.phase != Phase::Stopped || slot.doc.is_some());
    }

    fn hand_back_unsendable(&mut self) {
        if !self.project.role.can_review() {
            self.hand_back(Slot::unsent_edits);
        }
    }

    fn hand_back(&mut self, which: impl Fn(&Slot) -> bool) {
        let docs: Vec<DocId> = self
            .slots
            .iter()
            .filter(|(_, slot)| which(slot))
            .map(|(doc, _)| doc.clone())
            .collect();
        for doc in docs {
            let Some(slot) = self.slots.get_mut(&doc) else {
                continue;
            };
            let unsent = slot.unsent_text();
            slot.buffer.clear();
            slot.errors = 0;
            slot.dirty = true;
            slot.phase = Phase::Unjoined;
            let open = slot.editor.is_some();
            if let Some(text) = unsent {
                self.notices
                    .push(Notice::Merged(doc.clone(), MergeReview::Kept { text }));
            }
            if open {
                self.want(&doc);
            }
        }
    }

    fn keep_unsent(&mut self) {
        let docs: Vec<DocId> = self
            .slots
            .iter()
            .filter(|(_, slot)| slot.unconfirmed())
            .map(|(doc, _)| doc.clone())
            .collect();
        for doc in docs {
            let path = self.path_of(&doc);
            let Some(slot) = self.slots.get_mut(&doc) else {
                continue;
            };
            let unsent = slot.unsent_text();
            slot.buffer.clear();
            slot.dirty = true;
            if let Some(text) = unsent {
                self.notices.push(Notice::Unsent { doc, path, text });
            }
        }
        self.forget_tree_queue();
    }

    pub(super) fn connected(&mut self, public_id: PublicId, wall_ms: u64) {
        if !self.own.contains(&public_id) {
            self.own.push(public_id.clone());
        }
        if self.own.len() > OWN_KEPT {
            self.own.remove(0);
        }
        self.current = Some(public_id);
        self.connected_wall_ms = wall_ms;
        self.broadcasts.clear();
    }

    pub(super) fn connected_wall_ms(&self) -> u64 {
        self.connected_wall_ms
    }

    pub(super) fn announce(&mut self) {
        self.online = true;
        self.notices.push(Notice::Flags(
            self.project.restricted,
            self.project.deleted_externally,
        ));
        self.announce_role();
        self.report_pending(true);
    }

    fn announce_role(&mut self) {
        let tracking = self.tracking();
        self.notices.push(Notice::Role(self.project.role, tracking));
    }

    fn tracking(&self) -> bool {
        self.project.role == Role::Reviewer
            || (self.project.role.can_edit() && self.project.tracks_changes_for(&self.me))
    }

    fn mode(&self) -> SendMode {
        if !self.project.role.can_review() {
            return SendMode::Hold;
        }
        if !self.tracking() {
            return SendMode::Edit;
        }
        let tracking = Tracking {
            user_id: self.me.clone(),
            ts: iso_time(now_ms()),
        };
        if self.project.role == Role::Reviewer {
            SendMode::Review(tracking)
        } else {
            SendMode::Suggest(tracking)
        }
    }

    fn pending(&self) -> u64 {
        self.slots
            .values()
            .filter(|slot| slot.unconfirmed())
            .count() as u64
    }

    pub(super) fn report_pending(&mut self, always: bool) {
        if self.ended.is_some() || !(self.online || self.signed_out) {
            return;
        }
        let pending = self.pending();
        if always || self.last_pending != Some(pending) {
            self.last_pending = Some(pending);
            let state = if self.signed_out {
                LiveState::SignedOut { pending }
            } else {
                LiveState::Online { pending }
            };
            self.notices.push(Notice::State(state));
        }
    }

    pub(super) fn report_docs(&mut self) {
        for (doc, slot) in &mut self.slots {
            let pending = slot.unconfirmed();
            if pending != slot.shown_pending {
                slot.shown_pending = pending;
                self.notices.push(Notice::Pending(doc.clone(), pending));
            }
        }
    }

    pub(super) fn offline(&mut self, retry_in: Duration) {
        if self.ended.is_some() {
            return;
        }
        self.forget_peers();
        self.online = false;
        self.last_pending = None;
        let pending = self.pending();
        self.notices
            .push(Notice::State(LiveState::Offline { retry_in, pending }));
    }

    pub(super) fn idle(&mut self) {
        if self.ended.is_none() {
            self.forget_peers();
            self.online = false;
            self.last_pending = None;
            self.notices.push(Notice::State(LiveState::Idle));
        }
    }

    pub(super) fn maintenance(&mut self, message: String, delay: Duration) {
        self.notices.push(Notice::Maintenance(message, delay));
    }

    pub(super) fn slow_ack(&mut self, waiting: bool) {
        self.notices.push(Notice::SlowAck(waiting));
    }

    pub(super) fn is_online(&self) -> bool {
        self.online
    }

    pub(super) fn acks(&self) -> u64 {
        self.acks
    }

    pub(super) fn needs_server(&self) -> bool {
        self.slots.values().any(Slot::waits_for_server)
    }

    pub(super) fn can_rest(&self) -> bool {
        !self.needs_server() && !self.journal_due() && !self.tree_work.has_waiting()
    }

    pub(super) fn end(&mut self, end: LiveEnd) {
        if self.ended.is_none() {
            if matches!(end, LiveEnd::Removed | LiveEnd::ProjectGone) {
                self.keep_unsent();
            }
            self.forget_peers();
            self.forget_chat();
            self.forget_people();
            self.online = false;
            self.ended = Some(end.clone());
            self.notices.push(Notice::State(LiveState::Ended(end)));
        }
    }

    pub(super) fn unsent(&self) -> Vec<UnsentDoc> {
        self.slots
            .iter()
            .filter(|(_, slot)| slot.unconfirmed())
            .map(|(doc, _)| UnsentDoc {
                doc: doc.clone(),
                path: self.path_of(doc).unwrap_or_default(),
            })
            .collect()
    }

    pub(super) fn is_settled(&self) -> bool {
        self.pending() == 0 && !self.journal_due()
    }

    fn is_text_doc(&self, doc: &DocId) -> bool {
        self.project
            .tree
            .node(&EntityId::from(doc))
            .is_some_and(|node| node.kind == NodeKind::Doc)
    }

    pub(super) fn seed(&mut self, seeds: Vec<Seed>) {
        self.seeds.extend(seeds);
        let joined = self.current.is_some();
        let writable = self.project.role.can_edit();
        for seed in std::mem::take(&mut self.seeds) {
            let target = self.seed_target(&seed);
            if !joined && (target.is_none() || !writable) {
                self.seeds.push(seed);
                continue;
            }
            let outcome = match target {
                None => Seeded::NoDoc,
                Some(doc) if writable && self.seed_doc(&doc, seed.base, &seed.local) => {
                    Seeded::Taken
                }
                Some(_) => Seeded::Left,
            };
            self.notices.push(Notice::Seeded(seed.path, outcome));
        }
    }

    fn seed_target(&self, seed: &Seed) -> Option<DocId> {
        seed.doc
            .clone()
            .filter(|doc| self.is_text_doc(doc))
            .or_else(|| self.doc_at(&seed.path))
    }

    fn seed_doc(&mut self, doc: &DocId, base: Option<String>, local: &str) -> bool {
        let slot = self.slots.entry(doc.clone()).or_default();
        if slot.doc.is_some()
            || slot.resume.is_some()
            || !matches!(slot.phase, Phase::Unjoined | Phase::Wanted)
        {
            return false;
        }
        let Some((known, seeded, corrected)) = outside_doc(doc, base, local) else {
            return false;
        };
        slot.doc = Some(known);
        slot.dirty = true;
        self.mark_unbased(doc, seeded);
        if corrected {
            self.replaced(doc);
        }
        self.show(doc);
        self.want(doc);
        true
    }

    fn mark_unbased(&mut self, doc: &DocId, seeded: Option<String>) {
        let known = self.manifest.unbased.get(&doc.0).cloned();
        if known == seeded {
            return;
        }
        match seeded {
            Some(hash) => self.manifest.unbased.insert(doc.0.clone(), hash),
            None => self.manifest.unbased.remove(&doc.0),
        };
        self.manifest_dirty = true;
    }

    pub(super) fn outside_edit(
        &mut self,
        doc: &DocId,
        base: Option<String>,
        text: &str,
        overlap: Overlap,
    ) -> Result<(), LiveError> {
        if self.ended.is_some() {
            return Err(LiveError::Ended);
        }
        if !self.is_text_doc(doc) {
            return Err(LiveError::UnknownDoc);
        }
        match self.slots.get(doc).map(|slot| slot.phase) {
            Some(Phase::Stopped) => return Err(LiveError::Stopped),
            Some(Phase::Held) => return Err(LiveError::NotWritable),
            _ if self.mode() == SendMode::Hold => return Err(LiveError::NotWritable),
            _ => {}
        }
        let reloading = self.slots.get(doc).and_then(|slot| slot.reloading.clone());
        if reloading.as_deref() == Some(text) {
            return Ok(());
        }
        let loaded = self
            .slots
            .get(doc)
            .is_some_and(|slot| slot.doc.is_some() || slot.resume.is_some());
        let Some(current) = self.text(doc).filter(|_| loaded) else {
            return if self.seed_doc(doc, reloading.or(base), text) {
                Ok(())
            } else {
                Err(LiveError::NotWritable)
            };
        };
        if current == text {
            return Ok(());
        }
        let op = base.as_deref().and_then(|base| {
            oleafly_ot::rebase(base, text, &current)
                .filter(|rebased| overlap == Overlap::Weave || !rebased.overlapped)
                .map(|rebased| rebased.operation)
        });
        match op {
            Some(op) if op.is_noop() => Ok(()),
            Some(op) => {
                self.forward(doc, op.clone());
                self.take_local(doc, op, Some(current), None)
            }
            None => self.hold_outside(doc, base, text, current),
        }
    }

    fn hold_outside(
        &mut self,
        doc: &DocId,
        base: Option<String>,
        text: &str,
        theirs: String,
    ) -> Result<(), LiveError> {
        let (mine, seeded, corrected) =
            outside_doc(doc, base, text).ok_or(LiveError::NotWritable)?;
        let record = mine.record().map_err(|_| LiveError::NotWritable)?;
        if self
            .slots
            .get(doc)
            .is_some_and(|slot| slot.doc.is_none() && slot.resume.is_some())
        {
            let resumed = self.take_base(doc);
            self.slots.entry(doc.clone()).or_default().doc = resumed;
        }
        let slot = self.slots.entry(doc.clone()).or_default();
        slot.dirty = true;
        let unsent = slot
            .doc
            .as_ref()
            .filter(|known| known.has_unsent_text())
            .map(|known| known.text().to_string());
        if let Some(text) = unsent {
            self.notices
                .push(Notice::Merged(doc.clone(), MergeReview::Kept { text }));
        }
        self.mark_unbased(doc, seeded);
        self.hold(doc, Some(record), mine.text().to_string(), theirs);
        if corrected {
            self.replaced(doc);
        }
        self.show(doc);
        Ok(())
    }

    fn shown(&self, doc: &DocId) -> Option<String> {
        let editor = self.slots.get(doc)?.editor.as_ref()?;
        Some(editor.channel.text())
    }

    fn show(&mut self, doc: &DocId) {
        if let Some((shown, now)) = self.shown(doc).zip(self.text(doc)) {
            self.forward(doc, diff(&shown, &now));
        }
    }

    fn hold(&mut self, doc: &DocId, record: Option<DocRecord>, mine: String, theirs: String) {
        let reviewed = self
            .under_review(doc)
            .map(|held| held.local_text.clone())
            .filter(|reviewed| *reviewed != mine);
        let mine = match reviewed {
            Some(reviewed) => {
                self.notices.push(Notice::Merged(
                    doc.clone(),
                    MergeReview::Kept { text: mine },
                ));
                reviewed
            }
            None => {
                if let Some(slot) = self.slots.get_mut(doc) {
                    slot.phase = Phase::Held;
                    slot.held = record;
                }
                mine
            }
        };
        self.notices.push(Notice::Merged(
            doc.clone(),
            MergeReview::NeedsReview { mine, theirs },
        ));
    }

    fn under_review(&self, doc: &DocId) -> Option<&DocRecord> {
        let slot = self.slots.get(doc)?;
        slot.held.as_ref().filter(|_| slot.phase == Phase::Held)
    }

    fn hold_unbased(
        &mut self,
        doc: &DocId,
        known: &OverleafDoc,
        version: u64,
        text: String,
        format: FormatState,
    ) -> OverleafDoc {
        let mine = known.text().to_string();
        self.hold(doc, known.record().ok(), mine, text.clone());
        OverleafDoc::joined(doc.clone(), version, text, format)
    }

    pub(super) fn doc_at(&self, path: &str) -> Option<DocId> {
        let id = self.project.tree.id_at(path)?;
        let node = self.project.tree.node(id)?;
        (node.kind == NodeKind::Doc).then(|| DocId(id.0.clone()))
    }

    fn path_of(&self, doc: &DocId) -> Option<String> {
        self.project.tree.path_of(&EntityId::from(doc))
    }

    fn want(&mut self, doc: &DocId) {
        let slot = self.slots.entry(doc.clone()).or_default();
        if slot.phase == Phase::Unjoined {
            slot.phase = Phase::Wanted;
        }
        if self.queued.insert(doc.clone()) {
            self.urgent.push_back(doc.clone());
        }
    }

    pub(super) fn want_text(&mut self, doc: &DocId) {
        let joined = self
            .slots
            .get(doc)
            .is_some_and(|slot| slot.phase != Phase::Unjoined);
        if !joined && self.is_text_doc(doc) {
            self.want(doc);
        }
    }

    fn pace_all(&mut self, batch: usize, every: Duration) {
        self.pace = Some((batch, every));
        let docs = self.project.tree.nodes();
        for node in docs.into_iter().filter(|node| node.kind == NodeKind::Doc) {
            let doc = DocId(node.id.0);
            let joined = self
                .slots
                .get(&doc)
                .is_some_and(|slot| slot.phase != Phase::Unjoined);
            if !joined && !self.paced.contains(&doc) {
                self.paced.push_back(doc);
            }
        }
    }

    pub(super) fn next_joins(
        &mut self,
        now: Instant,
        urgent_batch: usize,
    ) -> Vec<(DocId, JoinKind)> {
        let mut picked = Vec::new();
        while picked.len() < urgent_batch {
            let Some(doc) = self.urgent.pop_front() else {
                break;
            };
            self.queued.remove(&doc);
            picked.extend(self.joinable(doc));
        }
        let Some((batch, every)) = self.pace else {
            return picked;
        };
        if self.paced.is_empty() || self.next_paced.is_some_and(|due| now < due) {
            return picked;
        }
        self.next_paced = Some(now + every);
        for doc in self.take_paced(batch) {
            picked.extend(self.joinable(doc));
        }
        picked
    }

    fn joinable(&mut self, doc: DocId) -> Option<(DocId, JoinKind)> {
        let kind = self.join_kind(&doc)?;
        if plain_doc_id(&doc.0) {
            return Some((doc, kind));
        }
        self.fault(
            &doc,
            DocFault::Unsupported("a document id that can't name a journal file".into()),
        );
        None
    }

    fn take_paced(&mut self, batch: usize) -> Vec<DocId> {
        let mut taken = Vec::new();
        while taken.len() < batch {
            let Some(doc) = self.paced.pop_front() else {
                break;
            };
            let slot = self.slots.entry(doc.clone()).or_default();
            if slot.phase == Phase::Unjoined {
                slot.phase = Phase::Wanted;
                taken.push(doc);
            }
        }
        taken
    }

    fn join_kind(&self, doc: &DocId) -> Option<JoinKind> {
        let slot = self.slots.get(doc)?;
        if let Some(record) = &slot.resume {
            return Some(if record.provisional {
                JoinKind::Fresh
            } else {
                JoinKind::From(record.base_version)
            });
        }
        match (slot.phase, &slot.doc) {
            (Phase::CatchUp, Some(known)) if !known.is_provisional() => {
                Some(JoinKind::From(known.version()))
            }
            (Phase::Wanted | Phase::CatchUp, _) => Some(JoinKind::Fresh),
            _ => None,
        }
    }

    pub(super) fn requeue(&mut self, joins: &[(DocId, JoinKind)]) {
        for (doc, _) in joins {
            self.want(doc);
        }
    }

    pub(super) fn needs_disk_at(&self, path: &str) -> bool {
        self.doc_at(path)
            .is_some_and(|doc| self.with_text(&doc, |_| ()).is_none())
    }

    pub(super) fn open(
        &mut self,
        path: &str,
        sink: DocSink,
        on_disk: Option<String>,
    ) -> Option<DocOpened> {
        let doc = self.doc_at(path)?;
        let text = self.text(&doc).or(on_disk).unwrap_or_default();
        self.next_session += 1;
        let session = self.next_session;
        let channel = EditorChannel::new(text.clone());
        let rev = channel.rev();
        let slot = self.slots.entry(doc.clone()).or_default();
        slot.editor = Some(Editor {
            channel,
            sink,
            session,
        });
        self.want_if_unjoined(&doc);
        Some(DocOpened {
            file_id: doc.0,
            rev,
            text,
            session,
        })
    }

    pub(super) fn close(&mut self, doc: &DocId, session: u64) {
        if let Some(slot) = self.slots.get_mut(doc) {
            if slot
                .editor
                .as_ref()
                .is_some_and(|editor| editor.session == session)
            {
                slot.editor = None;
            }
        }
    }

    pub(super) fn text(&self, doc: &DocId) -> Option<String> {
        self.with_text(doc, str::to_string)
    }

    pub(super) fn with_text<T>(&self, doc: &DocId, read: impl FnOnce(&str) -> T) -> Option<T> {
        let slot = self.slots.get(doc)?;
        if let Some(held) = self.under_review(doc) {
            return Some(read(&held.local_text));
        }
        if let Some(known) = &slot.doc {
            return Some(read(known.text()));
        }
        if let Some(record) = &slot.resume {
            return Some(read(&record.local_text));
        }
        slot.editor
            .as_ref()
            .map(|editor| read(&editor.channel.text()))
    }

    pub(super) fn path_without_text(&self, doc: &DocId) -> Option<String> {
        self.with_text(doc, |_| ())
            .is_none()
            .then(|| self.path_of(doc))
            .flatten()
    }

    fn reset_editor(&mut self, doc: &DocId) {
        let text = self.text(doc);
        self.reset_editor_to(doc, text);
    }

    fn reset_editor_to(&mut self, doc: &DocId, text: Option<String>) {
        let Some(editor) = self
            .slots
            .get_mut(doc)
            .and_then(|slot| slot.editor.as_mut())
        else {
            return;
        };
        let text = text.unwrap_or_else(|| editor.channel.text());
        let rev = editor.channel.reset(text.clone());
        self.notices.push(Notice::Editor(
            Arc::clone(&editor.sink),
            DocMessage::Reset { rev, text },
        ));
    }

    fn forward(&mut self, doc: &DocId, op: TextOperation) {
        if op.is_noop() {
            return;
        }
        let Some(editor) = self
            .slots
            .get_mut(doc)
            .and_then(|slot| slot.editor.as_mut())
        else {
            return;
        };
        if editor.channel.remote(op.clone()).is_err() {
            self.reset_editor(doc);
            return;
        }
        self.notices.push(Notice::Editor(
            Arc::clone(&editor.sink),
            DocMessage::Remote {
                rev: editor.channel.rev(),
                op,
                length: editor.channel.length(),
            },
        ));
    }

    pub(super) fn editor_change(
        &mut self,
        doc: &DocId,
        rev: u64,
        op: TextOperation,
        origin: Option<Origin>,
    ) -> Result<(), LiveError> {
        if self.ended.is_some() {
            return Err(LiveError::Ended);
        }
        let hold = self.mode() == SendMode::Hold;
        let removed = !self.is_text_doc(doc) && !self.tree_work.deleted_by_me(doc);
        let slot = self.slots.get_mut(doc).ok_or(LiveError::UnknownDoc)?;
        let editor = slot.editor.as_mut().ok_or(LiveError::UnknownDoc)?;
        let before = (slot.doc.is_none() && slot.resume.is_none()).then(|| editor.channel.text());
        let applied = match editor.channel.receive(rev, op) {
            Ok(applied) => applied,
            Err(ChannelError::BeforeReset) => return Ok(()),
            Err(_) => {
                self.reset_editor(doc);
                return Ok(());
            }
        };
        self.notices.push(Notice::Editor(
            Arc::clone(&editor.sink),
            DocMessage::Ack {
                rev: editor.channel.rev(),
                length: editor.channel.length(),
            },
        ));
        if hold {
            let text = before.or_else(|| self.text(doc));
            self.reset_editor_to(doc, text);
            return Ok(());
        }
        match slot.phase {
            Phase::Held => {
                let mine = editor.channel.text();
                if let Some(held) = slot.held.as_mut() {
                    held.local_text = mine;
                    slot.dirty = true;
                }
                Ok(())
            }
            Phase::Stopped if removed && !applied.is_noop() => {
                let text = editor.channel.text();
                self.notices
                    .push(Notice::Merged(doc.clone(), MergeReview::Kept { text }));
                Ok(())
            }
            Phase::Stopped => Ok(()),
            _ => self.take_local(doc, applied, before, origin),
        }
    }

    fn take_local(
        &mut self,
        doc: &DocId,
        op: TextOperation,
        before: Option<String>,
        origin: Option<Origin>,
    ) -> Result<(), LiveError> {
        if self
            .slots
            .get(doc)
            .is_some_and(|slot| slot.doc.is_none() && slot.resume.is_some())
        {
            let resumed = self.take_base(doc);
            self.slots.entry(doc.clone()).or_default().doc = resumed;
        }
        let slot = self.slots.entry(doc.clone()).or_default();
        let local = slot.doc.get_or_insert_with(|| {
            OverleafDoc::provisional(doc.clone(), before.unwrap_or_default())
        });
        match local.local_from(op, origin) {
            Ok(correction) => {
                slot.dirty = true;
                if let Some(correction) = correction {
                    self.forward(doc, correction);
                    self.replaced(doc);
                }
                self.want_if_unjoined(doc);
                Ok(())
            }
            Err(error) => {
                self.reset_editor(doc);
                Err(LiveError::Invalid(match error {
                    DocError::Local(error) => error,
                    _ => OtError::Incompatible,
                }))
            }
        }
    }

    fn want_if_unjoined(&mut self, doc: &DocId) {
        if self
            .slots
            .get(doc)
            .is_some_and(|slot| slot.phase == Phase::Unjoined)
        {
            self.want(doc);
        }
    }

    pub(super) fn local_edit_with(
        &mut self,
        doc: &DocId,
        edit: impl FnOnce(&str) -> Option<TextOperation>,
        on_disk: Option<String>,
    ) -> Result<bool, LiveError> {
        if self.ended.is_some() {
            return Err(LiveError::Ended);
        }
        if !self.is_text_doc(doc) {
            return Err(LiveError::UnknownDoc);
        }
        let phase = self.slots.get(doc).map(|slot| slot.phase);
        if phase == Some(Phase::Stopped) {
            return Err(LiveError::Stopped);
        }
        if phase == Some(Phase::Held) || self.mode() == SendMode::Hold {
            return Err(LiveError::NotWritable);
        }
        let reloading = self.slots.get(doc).and_then(|slot| slot.reloading.clone());
        let before = reloading
            .or_else(|| self.text(doc))
            .or(on_disk)
            .unwrap_or_default();
        let Some(op) = edit(&before).filter(|op| !op.is_noop()) else {
            return Ok(false);
        };
        if op.base_len() != utf16_len(&before) {
            return Err(LiveError::Invalid(OtError::LengthMismatch));
        }
        self.forward(doc, op.clone());
        self.take_local(doc, op, Some(before), None).map(|()| true)
    }

    pub(super) fn on_applied(&mut self, update: AppliedUpdate) {
        let doc = update.doc.clone();
        self.broadcasts.insert(doc.clone());
        if !self.slots.contains_key(&doc) && !self.is_text_doc(&doc) {
            return;
        }
        let slot = self.slots.entry(doc.clone()).or_default();
        match slot.phase {
            Phase::Joined | Phase::Held => self.apply_remote(&doc, &update),
            Phase::Stopped => {}
            Phase::Unjoined => {
                slot.buffer.push(update);
                self.want(&doc);
            }
            Phase::Wanted | Phase::CatchUp => slot.buffer.push(update),
        }
    }

    fn apply_remote(&mut self, doc: &DocId, update: &AppliedUpdate) {
        let own = self.own.clone();
        let Some(slot) = self.slots.get_mut(doc) else {
            return;
        };
        let held = slot.phase == Phase::Held;
        let counted = slot
            .doc
            .as_ref()
            .is_some_and(|known| known.format().format() == DocFormat::HistoryOt);
        if counted && slot.already_listed(update) {
            if !held {
                self.tell_foreign(doc, update, DocFormat::HistoryOt);
            }
            return;
        }
        if counted && held {
            if update.external {
                self.notices.push(Notice::External(doc.clone()));
            }
            return;
        }
        let Some(known) = slot.doc.as_mut() else {
            return;
        };
        let applied = known.applied(update, &own);
        self.note_review_doc(doc);
        let Some(slot) = self.slots.get_mut(doc) else {
            return;
        };
        match applied {
            Ok(Applied::Remote(op)) => {
                slot.dirty = true;
                if !held {
                    self.forward(doc, op);
                    self.notices.push(Notice::Texts(vec![doc.clone()]));
                    self.notices
                        .push(Notice::RemoteEdit(doc.clone(), update.user_id.clone()));
                }
                if update.external {
                    self.notices.push(Notice::External(doc.clone()));
                }
            }
            Ok(Applied::Acknowledged) => {
                slot.dirty = true;
                slot.errors = 0;
                self.acks += 1;
            }
            Ok(Applied::Ignored) => {}
            Err(error) => self.doc_failed(doc, error, Some(update.clone())),
        }
    }

    fn doc_failed(&mut self, doc: &DocId, error: DocError, update: Option<AppliedUpdate>) {
        match error {
            DocError::Codec(CodecError::Unsupported(kind)) => {
                self.fault(doc, DocFault::Unsupported(kind))
            }
            DocError::Gap { .. } | DocError::Blocked(Limit::TooOld) => {
                self.rejoin(doc, Phase::CatchUp, update)
            }
            DocError::Blocked(limit) => match limit.fault() {
                Some(fault) => self.fault(doc, fault),
                None => self.rejoin(doc, Phase::Wanted, update),
            },
            _ => self.rejoin(doc, Phase::Wanted, update),
        }
    }

    fn fault(&mut self, doc: &DocId, fault: DocFault) {
        let unsupported = matches!(fault, DocFault::Unsupported(_));
        self.stop_doc(doc, DocStopReason::Fault(fault));
        self.after_change_fault(doc, unsupported);
    }

    fn after_change_fault(&mut self, doc: &DocId, unsupported: bool) {
        let Some(waiting) = self.after_change.as_mut() else {
            return;
        };
        if !waiting.remove(doc) {
            return;
        }
        if !unsupported {
            self.after_change = None;
        } else if waiting.is_empty() {
            self.after_change = None;
            self.end(LiveEnd::Unsupported(
                "every document is in a form this version can't edit".into(),
            ));
        }
    }

    fn rejoin(&mut self, doc: &DocId, phase: Phase, update: Option<AppliedUpdate>) {
        let Some(slot) = self.slots.get_mut(doc) else {
            return;
        };
        if matches!(slot.phase, Phase::Held | Phase::Stopped) {
            return;
        }
        slot.phase = phase;
        slot.buffer.extend(update);
        self.want(doc);
    }

    fn stop_doc(&mut self, doc: &DocId, reason: DocStopReason) {
        self.review_dirty(doc);
        let resumed = self.take_base(doc);
        if let Some(slot) = self.slots.get_mut(doc) {
            slot.doc = resumed;
            slot.phase = Phase::Stopped;
            slot.buffer.clear();
        }
        self.notices.push(Notice::Stopped(doc.clone(), reason));
    }

    fn drop_unsent(&mut self, doc: &DocId) {
        if self.keep_dropped(doc) {
            self.notices
                .push(Notice::Stopped(doc.clone(), DocStopReason::Removed));
        }
    }

    fn keep_dropped(&mut self, doc: &DocId) -> bool {
        let mine = self.tree_work.deleted_by_me(doc);
        let Some(slot) = self.slots.get_mut(doc) else {
            return false;
        };
        let unsent = slot.unsent_text().filter(|_| !mine);
        slot.buffer.clear();
        slot.phase = Phase::Stopped;
        slot.dirty = true;
        self.review.dirty_doc(doc);
        if let Some(text) = unsent {
            self.notices
                .push(Notice::Merged(doc.clone(), MergeReview::Kept { text }));
        }
        true
    }

    pub(super) fn joined(
        &mut self,
        doc: &DocId,
        kind: JoinKind,
        reply: Result<JoinedDoc, JoinFailure>,
    ) {
        if reply.is_ok()
            && self
                .after_change
                .as_ref()
                .is_some_and(|waiting| waiting.contains(doc))
        {
            self.after_change = None;
        }
        match reply {
            Ok(joined) if kind == JoinKind::Fresh => self.fresh(doc, joined),
            Ok(joined) => self.caught_up(doc, joined),
            Err(JoinFailure::MissingOps) if kind == JoinKind::Fresh => self.missed_fresh(doc),
            Err(JoinFailure::MissingOps) => self.missing_ops(doc),
            Err(JoinFailure::Refused(message)) if message.contains("not found") => {
                self.drop_unsent(doc)
            }
            Err(JoinFailure::Refused(message)) => self.fault(doc, DocFault::from_server(&message)),
            Err(JoinFailure::Codec(CodecError::Unsupported(kind))) => {
                self.fault(doc, DocFault::Unsupported(kind))
            }
            Err(JoinFailure::Codec(error)) => {
                self.fault(doc, DocFault::Unsupported(error.to_string()))
            }
        }
        self.settle_history();
    }

    fn missed_fresh(&mut self, doc: &DocId) {
        let again = self
            .slots
            .get_mut(doc)
            .is_some_and(|slot| std::mem::replace(&mut slot.missed_fresh, true));
        if again {
            self.fault(doc, DocFault::Unavailable);
            return;
        }
        self.check_project = true;
        self.missing_ops(doc);
    }

    pub(super) fn take_project_check(&mut self) -> bool {
        std::mem::take(&mut self.check_project)
    }

    fn missing_ops(&mut self, doc: &DocId) {
        let base = self.take_base(doc);
        if let Some(slot) = self.slots.get_mut(doc) {
            slot.doc = base;
        }
        self.rejoin(doc, Phase::Wanted, None);
    }

    fn take_base(&mut self, doc: &DocId) -> Option<OverleafDoc> {
        let slot = self.slots.get_mut(doc)?;
        let known = slot.doc.take();
        let Some(record) = slot.resume.take() else {
            return known;
        };
        match OverleafDoc::resume(doc.clone(), &record, Instant::now()) {
            Ok(resumed) => Some(resumed),
            Err(_) => {
                slot.dirty = true;
                self.notices.push(Notice::Merged(
                    doc.clone(),
                    MergeReview::Kept {
                        text: record.local_text,
                    },
                ));
                known
            }
        }
    }

    fn fresh(&mut self, doc: &DocId, joined: JoinedDoc) {
        let JoinedDoc {
            version,
            text,
            format,
            ..
        } = joined;
        let kind = format.format();
        let seeded = match self.under_review(doc) {
            Some(_) => None,
            None => self.manifest.unbased.get(&doc.0).cloned(),
        };
        let mut known = match (self.take_base(doc), seeded) {
            (Some(known), Some(seeded)) if seeded == seed_hash(&text) => {
                self.mark_unbased(doc, None);
                let (based, corrected) = on_server_text(doc, known, &text);
                if corrected {
                    self.replaced(doc);
                }
                self.rebase_onto(doc, based, version, text, format)
            }
            (Some(known), Some(_)) => self.hold_unbased(doc, &known, version, text, format),
            (Some(known), None) => self.rebase_onto(doc, known, version, text, format),
            (None, _) => self.first_join(doc, version, text, format),
        };
        if let Some(limit) = self.page_limit {
            known.limit_length(limit);
        }
        self.install(doc, known);
        match kind {
            DocFormat::ShareJs => self.apply_buffered(doc),
            DocFormat::HistoryOt => self.catch_up_buffered(doc),
        }
    }

    fn first_join(
        &mut self,
        doc: &DocId,
        version: u64,
        text: String,
        format: FormatState,
    ) -> OverleafDoc {
        let known = OverleafDoc::joined(doc.clone(), version, text, format);
        if let Some(shown) = self.shown(doc) {
            self.forward(doc, diff(&shown, known.text()));
        }
        known
    }

    fn rebase_onto(
        &mut self,
        doc: &DocId,
        mut known: OverleafDoc,
        version: u64,
        text: String,
        format: FormatState,
    ) -> OverleafDoc {
        let before = known.text().to_string();
        let record = known.record().ok();
        match known.rejoin_fresh(version, text, format) {
            Rejoin::Clean(op) => self.forward(doc, op),
            Rejoin::Merged(op) if op.is_noop() => {}
            Rejoin::Merged(op) => {
                self.forward(doc, op);
                let after = known.text().to_string();
                self.notices.push(Notice::Merged(
                    doc.clone(),
                    MergeReview::Merged { before, after },
                ));
            }
            Rejoin::Conflict { mine, theirs } => self.hold(doc, record, mine, theirs),
        }
        known
    }

    fn install(&mut self, doc: &DocId, known: OverleafDoc) {
        let slot = self.slots.entry(doc.clone()).or_default();
        slot.missed_fresh = false;
        slot.reloading = None;
        if slot.phase != Phase::Held {
            slot.phase = Phase::Joined;
        }
        if known.is_settled() {
            slot.errors = 0;
        }
        slot.doc = Some(known);
        slot.dirty = true;
        self.notices.push(Notice::Texts(vec![doc.clone()]));
        self.note_review_doc(doc);
        self.review_dirty(doc);
    }

    fn apply_buffered(&mut self, doc: &DocId) {
        let Some(slot) = self.slots.get_mut(doc) else {
            return;
        };
        let Some(known) = slot.doc.as_ref() else {
            return;
        };
        let (format, version) = (known.format().format(), known.version());
        let buffered = std::mem::take(&mut slot.buffer);
        let mirrored = slot.phase != Phase::Held;
        for update in buffered {
            if mirrored && format == DocFormat::ShareJs && update.v < version {
                self.tell_foreign(doc, &update, format);
            }
            self.apply_remote(doc, &update);
        }
    }

    fn catch_up_buffered(&mut self, doc: &DocId) {
        let Some(slot) = self.slots.get_mut(doc) else {
            return;
        };
        let buffered = std::mem::take(&mut slot.buffer);
        if buffered.is_empty() {
            return;
        }
        if slot.phase != Phase::Held {
            for update in &buffered {
                self.tell_foreign(doc, update, DocFormat::HistoryOt);
            }
        }
        self.rejoin(doc, Phase::CatchUp, None);
    }

    fn tell_foreign(&mut self, doc: &DocId, update: &AppliedUpdate, format: DocFormat) {
        if self.foreign_edit(update, format) {
            self.notices
                .push(Notice::RemoteEdit(doc.clone(), update.user_id.clone()));
        }
    }

    fn foreign_edit(&self, update: &AppliedUpdate, format: DocFormat) -> bool {
        let theirs = update
            .source
            .as_ref()
            .is_none_or(|source| !self.own.contains(source));
        let Some(op) = update.op.as_ref().filter(|_| theirs && !update.dup) else {
            return false;
        };
        match format {
            DocFormat::ShareJs => pieces_from_json(op).is_ok_and(|pieces| {
                pieces
                    .iter()
                    .any(|piece| !matches!(piece, Piece::Comment { .. }))
            }),
            DocFormat::HistoryOt => edits_from_json(op).is_ok_and(|edits| {
                edits
                    .iter()
                    .any(|edit| matches!(edit, Edit::Text(raw) if !raw.is_noop()))
            }),
        }
    }

    fn caught_up(&mut self, doc: &DocId, joined: JoinedDoc) {
        let Some(mut known) = self.take_base(doc) else {
            self.fresh(doc, joined);
            return;
        };
        if known.format().format() != joined.format.format() {
            self.keep_and_rejoin(doc, known);
            return;
        }
        let own = self.own.clone();
        let Ok(remote) = known.catch_up(&joined.updates, &own) else {
            self.keep_and_rejoin(doc, known);
            return;
        };
        for op in remote {
            self.forward(doc, op);
        }
        if known.needs_rejoin() {
            self.keep_and_rejoin(doc, known);
            return;
        }
        let listed = match joined.format.format() {
            DocFormat::ShareJs => Vec::new(),
            DocFormat::HistoryOt => joined
                .updates
                .into_iter()
                .map(|update| (update.source, update.v))
                .collect(),
        };
        let fits = known.adopt_join(joined.version, &joined.text, joined.format);
        if known.is_settled() && !fits {
            self.keep_and_rejoin(doc, known);
            return;
        }
        if let Some(limit) = self.page_limit {
            known.limit_length(limit);
        }
        self.install(doc, known);
        if let Some(slot) = self.slots.get_mut(doc) {
            slot.listed = listed;
        }
        self.apply_buffered(doc);
    }

    fn keep_and_rejoin(&mut self, doc: &DocId, known: OverleafDoc) {
        if let Some(slot) = self.slots.get_mut(doc) {
            slot.doc = Some(known);
            slot.dirty = true;
        }
        self.rejoin(doc, Phase::Wanted, None);
    }

    pub(super) fn next_sends(&mut self, now: Instant) -> Vec<OutgoingUpdate> {
        let Some(on) = self.current.clone() else {
            return Vec::new();
        };
        let mode = self.mode();
        let joined: Vec<DocId> = self
            .slots
            .iter()
            .filter(|(_, slot)| slot.phase == Phase::Joined)
            .map(|(doc, _)| doc.clone())
            .collect();
        let mut sends = Vec::new();
        for doc in joined {
            let Some(slot) = self.slots.get_mut(&doc) else {
                continue;
            };
            let Some(known) = slot.doc.as_mut() else {
                continue;
            };
            let next = known.next_update(&on, &mode, now);
            let shown = known.take_shown();
            if !shown.is_empty() {
                slot.dirty = true;
                for op in shown {
                    self.forward(&doc, op);
                }
                self.notices.push(Notice::Texts(vec![doc.clone()]));
            }
            self.note_review_doc(&doc);
            let Some(slot) = self.slots.get_mut(&doc) else {
                continue;
            };
            match next {
                Ok(Some(update)) => {
                    slot.dirty = true;
                    sends.push(update);
                }
                Ok(None) => {}
                Err(error) => self.doc_failed(&doc, error, None),
            }
        }
        sends
    }

    pub(super) fn send_refused(&mut self, doc: &DocId, message: &str) {
        self.fault(doc, DocFault::from_server(message));
    }

    pub(super) fn update_error(&mut self, doc: &DocId, message: &str) {
        let Some(slot) = self.slots.get_mut(doc) else {
            return;
        };
        if matches!(slot.phase, Phase::Held | Phase::Stopped) {
            return;
        }
        if message.contains("not found") {
            self.drop_unsent(doc);
            return;
        }
        let ours = slot.doc.as_ref().is_some_and(|known| !known.is_settled());
        let fault = DocFault::from_server(message);
        slot.errors = slot.errors.saturating_add(u8::from(ours));
        if ours && (fault.is_limit() || slot.errors > 1) {
            self.fault(doc, fault);
            return;
        }
        if !ours {
            let now = Instant::now();
            let again = slot
                .foreign
                .replace(now)
                .is_some_and(|last| now.duration_since(last) < UNSTEADY_WITHIN);
            if again {
                self.notices.push(Notice::Unsteady(doc.clone()));
            }
        }
        self.rejoin(doc, Phase::CatchUp, None);
    }

    pub(super) fn resolve(&mut self, doc: &DocId, choice: Resolution) -> Result<(), LiveError> {
        let slot = self.slots.get_mut(doc).ok_or(LiveError::UnknownDoc)?;
        if slot.phase != Phase::Held || slot.doc.is_none() {
            return Err(LiveError::NotWritable);
        }
        let mine = slot
            .held
            .take()
            .map(|record| record.local_text)
            .unwrap_or_default();
        slot.phase = Phase::Joined;
        slot.dirty = true;
        self.mark_unbased(doc, None);
        match choice {
            Resolution::Mine => self.keep_mine(doc, &mine)?,
            Resolution::Theirs => {
                self.notices.push(Notice::Merged(
                    doc.clone(),
                    MergeReview::Kept { text: mine },
                ));
                self.reset_editor(doc);
            }
        }
        self.notices.push(Notice::Texts(vec![doc.clone()]));
        self.rejoin(doc, Phase::CatchUp, None);
        Ok(())
    }

    pub(super) fn retry(
        &mut self,
        doc: &DocId,
        outside: Option<OutsideText>,
    ) -> Result<(), LiveError> {
        self.stopped_path(doc)?;
        let known = self.slots.get_mut(doc).and_then(|slot| slot.doc.as_mut());
        let mut corrected = false;
        let seed = match (known, outside) {
            (Some(known), Some(OutsideText { base, text: mine })) => {
                let op = base
                    .and_then(|base| oleafly_ot::rebase(&base, &mine, known.text()))
                    .map_or_else(|| diff(known.text(), &mine), |rebased| rebased.operation);
                if !op.is_noop() {
                    corrected = known
                        .local(op)
                        .map_err(|_| LiveError::NotWritable)?
                        .is_some();
                }
                None
            }
            (None, Some(outside)) if !outside.text.is_empty() => Some(outside),
            _ => None,
        };
        if corrected {
            self.replaced(doc);
        }
        self.restart(doc, seed);
        Ok(())
    }

    pub(super) fn keep_and_reload(
        &mut self,
        doc: &DocId,
        on_disk: Option<String>,
    ) -> Result<(), LiveError> {
        self.stopped_path(doc)?;
        let mine = on_disk.or_else(|| self.text(doc)).unwrap_or_default();
        if let Some(slot) = self.slots.get_mut(doc) {
            slot.doc = None;
            slot.resume = None;
            slot.held = None;
            slot.reloading = Some(mine.clone());
        }
        self.mark_unbased(doc, None);
        self.notices.push(Notice::Merged(
            doc.clone(),
            MergeReview::Kept { text: mine },
        ));
        self.restart(doc, None);
        Ok(())
    }

    pub(super) fn stopped_path(&self, doc: &DocId) -> Result<Option<String>, LiveError> {
        let slot = self.slots.get(doc).ok_or(LiveError::UnknownDoc)?;
        if slot.phase != Phase::Stopped {
            return Err(LiveError::NotWritable);
        }
        Ok(self.path_of(doc))
    }

    fn restart(&mut self, doc: &DocId, seed: Option<OutsideText>) {
        if let Some(slot) = self.slots.get_mut(doc) {
            slot.phase = Phase::Unjoined;
            slot.errors = 0;
            slot.buffer.clear();
            slot.dirty = true;
        }
        if let Some(OutsideText { base, text }) = seed {
            self.seed_doc(doc, base, &text);
        }
        self.want(doc);
    }

    fn keep_mine(&mut self, doc: &DocId, mine: &str) -> Result<(), LiveError> {
        let known = self
            .slots
            .get_mut(doc)
            .and_then(|slot| slot.doc.as_mut())
            .ok_or(LiveError::UnknownDoc)?;
        let op = diff(known.text(), mine);
        let correction = known.local(op).map_err(|error| match error {
            DocError::Local(error) => LiveError::Invalid(error),
            _ => LiveError::Invalid(OtError::Incompatible),
        })?;
        if let Some(correction) = correction {
            self.forward(doc, correction);
            self.replaced(doc);
        }
        Ok(())
    }

    fn replaced(&mut self, doc: &DocId) {
        if !std::mem::replace(&mut self.replaced_shown, true) {
            self.notices.push(Notice::Replaced(doc.clone()));
        }
    }

    pub(super) fn rejoined(&mut self, public_id: PublicId, response: Value) -> Handshake {
        match self.project.rejoin(response) {
            Ok(Rejoined::Repaired(changes)) => self.tree_changed(changes),
            Ok(Rejoined::Everything { .. }) => {
                self.relay_tree();
                let joined = self.joined_docs();
                self.after_change = (!joined.is_empty()).then_some(joined);
                self.rejoin_all(Phase::Wanted);
            }
            Err(unsupported) => return self.unreadable(&unsupported),
        }
        self.unreadable = 0;
        self.review_rejoined();
        self.chat_rejoined();
        self.connected(public_id, now_ms());
        self.seed(Vec::new());
        self.hand_back_unsendable();
        self.rejoin_all(Phase::CatchUp);
        self.presence_asked();
        self.announce();
        Handshake::Joined
    }

    fn unreadable(&mut self, unsupported: &impl std::fmt::Debug) -> Handshake {
        self.unreadable = self.unreadable.saturating_add(1);
        if self.unreadable < UNREADABLE_HANDSHAKES {
            return Handshake::Unreadable;
        }
        self.end(LiveEnd::Unsupported(format!("{unsupported:?}")));
        Handshake::Ended
    }

    fn joined_docs(&self) -> BTreeSet<DocId> {
        self.slots
            .iter()
            .filter(|(_, slot)| matches!(slot.phase, Phase::Joined | Phase::CatchUp))
            .map(|(doc, _)| doc.clone())
            .collect()
    }

    fn rejoin_all(&mut self, phase: Phase) {
        for doc in self.joined_docs() {
            self.rejoin(&doc, phase, None);
        }
    }

    pub(super) fn tree_changed(&mut self, changes: Vec<PathChange>) {
        let removed: Vec<DocId> = changes.iter().filter_map(removed_doc).collect();
        self.tree_followed(&changes);
        let stopped: Vec<DocId> = removed
            .into_iter()
            .filter(|doc| self.keep_dropped(doc))
            .collect();
        if !changes.is_empty() {
            self.notices.push(Notice::Tree(changes));
        }
        for doc in stopped {
            self.notices
                .push(Notice::Stopped(doc, DocStopReason::Removed));
        }
    }

    pub(super) fn project_event(&mut self, event: ProjectEvent) {
        self.project.apply_project(&event);
        if event == ProjectEvent::DeletedOrRenamedExternally {
            self.notices.push(Notice::Flags(
                self.project.restricted,
                self.project.deleted_externally,
            ));
        }
        self.notices.push(Notice::Project(event));
    }

    pub(super) fn access(&mut self, event: &AccessEvent) -> bool {
        match event {
            AccessEvent::Revoked => {
                self.end(LiveEnd::Removed);
                false
            }
            AccessEvent::UserRemoved(Some(user)) if *user == self.me => {
                self.end(LiveEnd::Removed);
                false
            }
            AccessEvent::TrackChanges(_) => {
                self.project.apply_access(event);
                self.announce_role();
                false
            }
            AccessEvent::MembersChanged { invites, .. } => {
                if *invites {
                    self.want_invites();
                }
                self.project.apply_access(event)
            }
            _ => self.project.apply_access(event),
        }
    }

    pub(super) fn members_refreshed(&mut self, members: Members) {
        self.project.members = members;
        self.notices.push(Notice::MembersChanged);
        let Some(role) = self.project.members.role_of(&self.me) else {
            return;
        };
        if role != self.project.role {
            self.project.role = role;
            self.hand_back_unsendable();
            self.announce_role();
            self.report_pending(false);
        }
    }

    pub(super) fn report_tick(&mut self) {
        self.report_review();
        self.report_chat();
        self.report_people();
        self.report_fill();
    }

    pub(super) fn start_history(
        &mut self,
        history: History,
        trickle: Duration,
        fill: Option<(usize, Duration)>,
    ) {
        self.review_trickle(trickle);
        self.history_target = history.latest;
        match history.changed {
            Some(paths) => {
                for doc in paths
                    .iter()
                    .filter_map(|path| self.doc_at(path))
                    .collect::<Vec<_>>()
                {
                    self.want(&doc);
                }
            }
            None => match fill {
                Some((batch, every)) => self.start_fill(batch, every),
                None if self.pace.is_none() => self.pace_all(1, trickle),
                None => {}
            },
        }
        self.settle_history();
    }

    fn settle_history(&mut self) {
        let joining = !self.urgent.is_empty()
            || !self.paced.is_empty()
            || self
                .slots
                .values()
                .any(|slot| matches!(slot.phase, Phase::Wanted | Phase::CatchUp));
        if joining {
            return;
        }
        if let Some(version) = self.history_target.take() {
            if self.manifest.history_version != Some(version) {
                self.manifest.history_version = Some(version);
                self.manifest_dirty = true;
            }
        }
    }

    pub(super) fn history_version(&self) -> Option<u64> {
        self.manifest.history_version
    }

    #[cfg(test)]
    pub(super) fn doc(&self, doc: &DocId) -> Option<&OverleafDoc> {
        self.slots.get(doc)?.doc.as_ref()
    }

    #[cfg(test)]
    pub(super) fn own_ids(&self) -> &[PublicId] {
        &self.own
    }

    #[cfg(test)]
    pub(super) fn forget_connection(&mut self) {
        self.current = None;
    }

    pub(super) fn legacy_from(
        &mut self,
        paths: &BTreeSet<String>,
        batch: usize,
        every: Duration,
    ) -> bool {
        let missed = paths
            .iter()
            .filter_map(|path| self.doc_at(path))
            .any(|doc| !self.broadcasts.contains(&doc));
        if missed {
            self.next_paced = None;
            self.pace_all(batch, every);
        }
        missed
    }

    fn journal_due(&self) -> bool {
        self.manifest_dirty
            || self.tree_work.is_dirty()
            || self.slots.values().any(|slot| slot.dirty)
    }

    pub(super) fn journal_ready(&self, now: Instant, forced: bool) -> bool {
        if !self.journal_due() {
            return false;
        }
        let waiting = self
            .journal_written
            .is_some_and(|written| now < written + WRITE_EVERY);
        forced || !(waiting || self.journal_backing_off(now))
    }

    pub(super) fn journal_backing_off(&self, now: Instant) -> bool {
        self.journal_retry.is_some_and(|(at, _)| now < at)
    }

    pub(super) fn take_journal_batch(
        &mut self,
        now: Instant,
        forced: bool,
    ) -> Option<JournalBatch> {
        if !self.journal_ready(now, forced) {
            return None;
        }
        let tree = &self.project.tree;
        let mut docs = Vec::new();
        for (doc, slot) in &mut self.slots {
            if std::mem::take(&mut slot.dirty) && plain_doc_id(&doc.0) {
                let path = tree.path_of(&EntityId::from(doc));
                let record = slot.record().map(|mut record| {
                    record.path = path.or(record.path.take());
                    record
                });
                docs.push((doc.clone(), record));
            }
        }
        let manifest = std::mem::take(&mut self.manifest_dirty).then(|| self.manifest.clone());
        let tree = self.tree_work.take_dirty();
        Some(JournalBatch {
            manifest,
            docs,
            tree,
        })
    }

    pub(super) fn journal_result(
        &mut self,
        batch: JournalBatch,
        result: Result<(), String>,
        now: Instant,
    ) {
        self.journal_written = Some(now);
        let Err(reason) = result else {
            self.journal_retry = None;
            if std::mem::take(&mut self.journal_failing) {
                self.notices.push(Notice::Journal(None));
            }
            return;
        };
        let wait = self.journal_retry.map_or(JOURNAL_BACKOFF, |(_, wait)| {
            (wait * 2).min(JOURNAL_BACKOFF_MAX)
        });
        self.journal_retry = Some((now + wait, wait));
        for (doc, _) in batch.docs {
            if let Some(slot) = self.slots.get_mut(&doc) {
                slot.dirty = true;
            }
        }
        self.manifest_dirty |= batch.manifest.is_some();
        if batch.tree.is_some() {
            self.tree_work.mark_dirty();
        }
        if !std::mem::replace(&mut self.journal_failing, true) {
            self.notices.push(Notice::Journal(Some(reason)));
        }
    }
}

fn outside_doc(
    doc: &DocId,
    base: Option<String>,
    text: &str,
) -> Option<(OverleafDoc, Option<String>, bool)> {
    let seeded = base.is_none().then(|| seed_hash(text));
    let base = base.unwrap_or_default();
    let mut known = OverleafDoc::provisional(doc.clone(), base.clone());
    let correction = known.local(diff(&base, text)).ok()?;
    Some((known, seeded, correction.is_some()))
}

fn seed_hash(text: &str) -> String {
    oleafly_core::encoding::hex_lower(
        ring::digest::digest(&ring::digest::SHA256, text.as_bytes()).as_ref(),
    )
}

fn on_server_text(doc: &DocId, known: OverleafDoc, server: &str) -> (OverleafDoc, bool) {
    let mut based = OverleafDoc::provisional(doc.clone(), server.to_string());
    match based.local(diff(server, known.text())) {
        Ok(correction) => (based, correction.is_some()),
        Err(_) => (known, false),
    }
}

fn removed_doc(change: &PathChange) -> Option<DocId> {
    match change {
        PathChange::Removed {
            id,
            kind: NodeKind::Doc,
            ..
        }
        | PathChange::Replaced {
            old: id,
            from: NodeKind::Doc,
            ..
        } => Some(DocId(id.0.clone())),
        _ => None,
    }
}
