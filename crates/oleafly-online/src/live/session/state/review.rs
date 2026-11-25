use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::time::Duration;

use oleafly_ot::utf16_len;
use serde_json::{json, Map, Value};

use super::{now_ms, Notice, Phase, State};
use crate::live::doc::{OverleafDoc, ReviewOp};
use crate::live::format::{byte_at, Decision, DocFormat};
use crate::live::rest::TrackChangesUpdate;
use crate::live::session::review::{
    DocReview, EditModeView, ModeLock, ReviewChange, ReviewCounts, ReviewSupport, ReviewWriteError,
    ThreadsView, TrackScope,
};
use crate::live::DocId;
use crate::realtime::events::{
    AccessEvent, Resolution, ReviewEvent, ReviewUser, Thread, ThreadMessage,
};
use crate::realtime::project::{Role, TrackChanges};

const ID_CHECKS: u8 = 5;
const GUESTS: &str = "__guests__";
const EVERY_DOC_TRICKLE: Duration = Duration::from_secs(1);

#[derive(Default)]
pub(in crate::live::session) struct ReviewBook {
    support: ReviewSupport,
    threads: Arc<BTreeMap<String, Thread>>,
    loaded: bool,
    fetching: bool,
    stale: bool,
    replay: Vec<ReviewEvent>,
    dirty_docs: BTreeSet<DocId>,
    threads_dirty: bool,
    support_dirty: bool,
    probe_wanted: bool,
    dropped: Vec<(DocId, ReviewOp)>,
    trouble: Option<String>,
    id_checks: BTreeMap<DocId, u8>,
    id_failed: BTreeSet<DocId>,
    every_doc: bool,
    trickle: Option<Duration>,
}

impl ReviewBook {
    pub(super) fn dirty_doc(&mut self, doc: &DocId) {
        self.dirty_docs.insert(doc.clone());
    }
}

pub(in crate::live::session) enum IdsReady {
    Known(Vec<String>),
    Waiting,
    Failed,
}

fn thread_entry<'a>(threads: &'a mut BTreeMap<String, Thread>, id: &str) -> &'a mut Thread {
    threads.entry(id.to_string()).or_insert_with(|| Thread {
        id: id.to_string(),
        messages: Vec::new(),
        resolved: None,
    })
}

fn add_message(thread: &mut Thread, message: ThreadMessage) {
    if thread.messages.iter().any(|known| known.id == message.id) {
        return;
    }
    thread.messages.push(message);
    thread.messages.sort_by_key(|message| message.timestamp);
}

fn patch(threads: &mut BTreeMap<String, Thread>, event: &ReviewEvent, now: i64) -> bool {
    match event {
        ReviewEvent::NewComment { thread, message } => {
            add_message(thread_entry(threads, thread), (**message).clone());
            true
        }
        ReviewEvent::Threads(list) => {
            for thread in list {
                threads.insert(thread.id.clone(), thread.clone());
            }
            !list.is_empty()
        }
        ReviewEvent::MessageEdited {
            thread,
            message,
            content,
        } => threads
            .get_mut(thread)
            .and_then(|thread| {
                thread
                    .messages
                    .iter_mut()
                    .find(|known| known.id == *message)
            })
            .map(|found| {
                found.content.clone_from(content);
                found.edited_at = Some(now);
            })
            .is_some(),
        ReviewEvent::MessageDeleted { thread, message } => threads
            .get_mut(thread)
            .map(|thread| {
                let before = thread.messages.len();
                thread.messages.retain(|known| known.id != *message);
                before != thread.messages.len()
            })
            .unwrap_or(false),
        ReviewEvent::Resolved { thread, by } => {
            thread_entry(threads, thread).resolved = Some(Resolution {
                by: by.as_deref().cloned(),
                at: Some(now),
            });
            true
        }
        ReviewEvent::Reopened { thread } => threads
            .get_mut(thread)
            .map(|thread| thread.resolved.take().is_some())
            .unwrap_or(false),
        ReviewEvent::ThreadDeleted { thread } => threads.remove(thread).is_some(),
        ReviewEvent::Accepted { .. } => false,
    }
}

impl State {
    pub(in crate::live::session) fn review_support(&self) -> ReviewSupport {
        self.review.support
    }

    pub(in crate::live::session) fn set_review_support(&mut self, threads: bool) {
        let support = ReviewSupport {
            probed: true,
            threads,
            accept_rest: threads,
            switch_rest: threads,
            plan_allows_tracking: self.project.plan_tracks_changes(),
        };
        if support != self.review.support {
            self.review.support = support;
            self.review.support_dirty = true;
        }
        if threads {
            self.want_change_authors();
        }
        if !threads {
            self.review.stale = false;
            self.review.loaded = false;
            self.review.fetching = false;
            self.review.replay.clear();
            self.clear_review_trouble();
            if !self.review.threads.is_empty() {
                self.review.threads = Arc::default();
                self.review.threads_dirty = true;
            }
        }
    }

    pub(in crate::live::session) fn review_rejoined(&mut self) {
        self.refetch_threads();
        self.review.probe_wanted = true;
    }

    pub(in crate::live::session) fn refetch_threads(&mut self) {
        self.review.stale = true;
    }

    pub(in crate::live::session) fn take_review_probe(&mut self) -> Option<bool> {
        if !std::mem::take(&mut self.review.probe_wanted) || self.ended.is_some() {
            return None;
        }
        Some(self.project.restricted)
    }

    pub(in crate::live::session) fn review_probe_wanted(&self) -> bool {
        self.review.probe_wanted && self.ended.is_none()
    }

    pub(in crate::live::session) fn thread_fetch_wanted(&self) -> bool {
        self.review.stale
            && self.review.support.threads
            && !self.project.restricted
            && self.ended.is_none()
    }

    pub(in crate::live::session) fn take_thread_fetch(&mut self) -> bool {
        let wanted = self.thread_fetch_wanted();
        if wanted {
            self.review.stale = false;
            self.review.fetching = true;
        }
        wanted
    }

    pub(in crate::live::session) fn threads_fetched(&mut self, threads: Vec<Thread>) {
        self.saw_threads(&threads);
        let mut fresh: BTreeMap<String, Thread> = threads
            .into_iter()
            .map(|thread| (thread.id.clone(), thread))
            .collect();
        let now = now_ms() as i64;
        for event in std::mem::take(&mut self.review.replay) {
            patch(&mut fresh, &event, now);
        }
        self.review.fetching = false;
        self.review.loaded = true;
        self.clear_review_trouble();
        if *self.review.threads != fresh {
            self.review.threads = Arc::new(fresh);
            self.review.threads_dirty = true;
        }
    }

    pub(in crate::live::session) fn thread_fetch_failed(&mut self, trouble: Option<String>) {
        self.review.fetching = false;
        self.review.replay.clear();
        if let Some(reason) = trouble {
            self.review_trouble(reason);
        }
    }

    fn saw_review_users(&mut self, event: &ReviewEvent) {
        match event {
            ReviewEvent::NewComment { message, .. } => {
                self.saw_messages(std::slice::from_ref(&**message));
            }
            ReviewEvent::Threads(threads) => self.saw_threads(threads),
            ReviewEvent::Resolved { by: Some(by), .. } => self.saw_user(by),
            _ => {}
        }
    }

    pub(in crate::live::session) fn review_trickle(&mut self, trickle: Duration) {
        self.review.trickle = Some(trickle);
    }

    pub(in crate::live::session) fn want_every_doc(&mut self) {
        if std::mem::replace(&mut self.review.every_doc, true) || self.pace.is_some() {
            return;
        }
        let trickle = self.review.trickle.unwrap_or(EVERY_DOC_TRICKLE);
        self.pace_all(1, trickle);
    }

    fn clear_review_trouble(&mut self) {
        if self.review.trouble.take().is_some() {
            self.review.threads_dirty = true;
        }
    }

    pub(in crate::live::session) fn review_trouble(&mut self, reason: String) {
        if self.review.trouble.as_ref() != Some(&reason) {
            self.review.trouble = Some(reason);
            self.review.threads_dirty = true;
        }
    }

    pub(in crate::live::session) fn review_event(&mut self, event: ReviewEvent) {
        if self.project.restricted {
            return;
        }
        if let ReviewEvent::Accepted { doc, changes } = &event {
            self.changes_accepted(doc, changes);
            return;
        }
        if let ReviewEvent::ThreadDeleted { thread } = &event {
            self.forget_comment(thread);
        }
        self.saw_review_users(&event);
        if self.review.fetching {
            self.review.replay.push(event.clone());
        }
        if !self.review.loaded {
            return;
        }
        let now = now_ms() as i64;
        if patch(Arc::make_mut(&mut self.review.threads), &event, now) {
            self.review.threads_dirty = true;
        }
    }

    fn forget_comment(&mut self, thread: &str) {
        let docs: Vec<DocId> = self
            .slots
            .iter_mut()
            .filter_map(|(doc, slot)| {
                let known = slot.doc.as_mut()?;
                known.drop_comment(thread).then(|| doc.clone())
            })
            .collect();
        for doc in docs {
            self.review_dirty(&doc);
            if let Some(slot) = self.slots.get_mut(&doc) {
                slot.dirty = true;
            }
        }
    }

    fn changes_accepted(&mut self, doc: &DocId, changes: &[String]) {
        let Some(known) = self.slots.get_mut(doc).and_then(|slot| slot.doc.as_mut()) else {
            return;
        };
        let removed = known.accept_locally(changes);
        let unknown = !known.ids_known();
        if removed > 0 {
            self.review_dirty(doc);
        }
        if removed < changes.len() && unknown {
            self.want_ranges(doc);
        }
    }

    pub(in crate::live::session) fn review_dirty(&mut self, doc: &DocId) {
        self.review.dirty_docs.insert(doc.clone());
    }

    pub(in crate::live::session) fn report_review(&mut self) {
        let book = &mut self.review;
        let due = !book.dirty_docs.is_empty()
            || book.threads_dirty
            || book.support_dirty
            || !book.dropped.is_empty();
        if !due {
            return;
        }
        let change = ReviewChange {
            docs: std::mem::take(&mut book.dirty_docs).into_iter().collect(),
            threads: std::mem::take(&mut book.threads_dirty),
            support: std::mem::take(&mut book.support_dirty),
            dropped: std::mem::take(&mut book.dropped),
            trouble: book.trouble.clone(),
        };
        self.notices.push(Notice::Review(change));
    }

    pub(in crate::live::session) fn note_review_doc(&mut self, doc: &DocId) {
        let Some(known) = self.slots.get_mut(doc).and_then(|slot| slot.doc.as_mut()) else {
            return;
        };
        let reshaped = known.take_reshaped();
        let dropped = known.take_dropped();
        if known.take_doubt() {
            self.want_ranges(doc);
        }
        if reshaped || !dropped.is_empty() {
            self.review.dirty_docs.insert(doc.clone());
        }
        self.review
            .dropped
            .extend(dropped.into_iter().map(|review| (doc.clone(), review)));
    }

    pub(in crate::live::session) fn want_ranges(&mut self, doc: &DocId) {
        self.review.id_failed.remove(doc);
        self.review.id_checks.entry(doc.clone()).or_insert(0);
    }

    pub(in crate::live::session) fn take_range_checks(&mut self) -> Vec<(DocId, u64)> {
        let docs: Vec<DocId> = self.review.id_checks.keys().cloned().collect();
        let mut checks = Vec::new();
        for doc in docs {
            let joined = self
                .slots
                .get(&doc)
                .filter(|slot| slot.phase == Phase::Joined)
                .and_then(|slot| slot.doc.as_ref());
            match joined {
                Some(known) => checks.push((doc.clone(), known.version())),
                None => {
                    self.review.id_checks.remove(&doc);
                    self.review.id_failed.insert(doc);
                }
            }
        }
        checks
    }

    pub(in crate::live::session) fn ranges_checked(
        &mut self,
        doc: &DocId,
        version: u64,
        fresh: Option<crate::live::format::FormatState>,
    ) {
        let known = self
            .slots
            .get_mut(doc)
            .filter(|slot| slot.phase == Phase::Joined)
            .and_then(|slot| slot.doc.as_mut());
        let done = match (known, fresh) {
            (Some(known), Some(fresh)) => known.adopt_ranges(version, &fresh),
            (Some(_) | None, _) => false,
        };
        if done {
            self.review.id_checks.remove(doc);
            self.review_dirty(doc);
            return;
        }
        let tries = self.review.id_checks.entry(doc.clone()).or_insert(0);
        *tries = tries.saturating_add(1);
        if *tries >= ID_CHECKS {
            self.review.id_checks.remove(doc);
            self.review.id_failed.insert(doc.clone());
        }
    }

    pub(in crate::live::session) fn server_ids(
        &self,
        doc: &DocId,
        ids: &[String],
        asked: bool,
    ) -> IdsReady {
        let Some(known) = self.slots.get(doc).and_then(|slot| slot.doc.as_ref()) else {
            return IdsReady::Failed;
        };
        let mut found = Vec::with_capacity(ids.len());
        for id in ids {
            match known.change_id_state(id) {
                None => return IdsReady::Failed,
                Some(Some(server)) => found.push(server),
                Some(None) => {
                    let gave_up = self.review.id_failed.contains(doc)
                        || !self.review.id_checks.contains_key(doc);
                    return if asked && gave_up {
                        IdsReady::Failed
                    } else {
                        IdsReady::Waiting
                    };
                }
            }
        }
        IdsReady::Known(found)
    }

    fn rev_of(&self, doc: &DocId) -> Option<u64> {
        self.slots
            .get(doc)?
            .editor
            .as_ref()
            .map(|editor| editor.channel.rev())
    }

    pub(in crate::live::session) fn doc_review(&self, doc: &DocId) -> Option<DocReview> {
        let slot = self.slots.get(doc)?;
        if slot.phase != Phase::Joined {
            return None;
        }
        let known = slot.doc.as_ref().filter(|known| !known.is_provisional())?;
        let format = known.format().format();
        let mut ranges = known.review();
        if format == DocFormat::ShareJs {
            for comment in &mut ranges.comments {
                comment.resolved = self
                    .review
                    .threads
                    .get(&comment.thread)
                    .map(|thread| thread.resolved.is_some());
            }
        }
        Some(DocReview {
            rev: self.rev_of(doc),
            format,
            comments: ranges.comments,
            changes: ranges.changes,
            can_accept: self.project.role.can_edit(),
        })
    }

    pub(in crate::live::session) fn review_counts(&self) -> Vec<(DocId, ReviewCounts)> {
        self.slots
            .iter()
            .filter(|(_, slot)| slot.phase == Phase::Joined)
            .filter_map(|(doc, slot)| {
                let known = slot.doc.as_ref().filter(|known| !known.is_provisional())?;
                let (comments, changes) = known.counts();
                let resolved = known
                    .threads()
                    .into_iter()
                    .filter(|thread| {
                        known.comment_resolved(thread).unwrap_or_else(|| {
                            self.review
                                .threads
                                .get(*thread)
                                .is_some_and(|known| known.resolved.is_some())
                        })
                    })
                    .count();
                Some((
                    doc.clone(),
                    ReviewCounts {
                        open: comments - resolved,
                        resolved,
                        changes,
                    },
                ))
            })
            .collect()
    }

    pub(in crate::live::session) fn threads_view(&self) -> ThreadsView {
        let mut anchored = BTreeMap::new();
        for (doc, slot) in &self.slots {
            if let Some(known) = slot.doc.as_ref() {
                for thread in known.threads() {
                    anchored.insert(thread.to_string(), doc.clone());
                }
            }
        }
        ThreadsView {
            loaded: self.review.loaded,
            threads: Arc::clone(&self.review.threads),
            anchored,
        }
    }

    pub(in crate::live::session) fn edit_mode(&self) -> EditModeView {
        let role = self.project.role;
        let everyone = self.everyone_tracked();
        let guests = matches!(
            self.project.track_changes,
            TrackChanges::Some { guests: true, .. }
        );
        let support = self.review.support;
        let locked = if role == Role::Reviewer {
            Some(ModeLock::Reviewer)
        } else if !support.switch_rest {
            Some(ModeLock::Server)
        } else if !support.plan_allows_tracking {
            Some(ModeLock::Plan)
        } else if self.project.track_changes == TrackChanges::Everyone && role != Role::Owner {
            Some(ModeLock::Everyone)
        } else {
            None
        };
        EditModeView {
            tracking: self.tracking(),
            role,
            switchable: role.can_edit() && locked.is_none(),
            locked,
            everyone,
            guests,
            manage: role == Role::Owner && locked.is_none(),
        }
    }

    fn member_ids(&self) -> BTreeSet<String> {
        let mut ids: BTreeSet<String> = self
            .project
            .members
            .all()
            .map(|member| member.id.clone())
            .collect();
        if !self.me.is_empty() {
            ids.insert(self.me.clone());
        }
        ids
    }

    fn everyone_tracked(&self) -> bool {
        match &self.project.track_changes {
            TrackChanges::Everyone => true,
            TrackChanges::Off => false,
            TrackChanges::Some { users, .. } => {
                let members = self.member_ids();
                !members.is_empty() && members.is_subset(users)
            }
        }
    }

    pub(in crate::live::session) fn track_changes_body(
        &self,
        scope: TrackScope,
        on: bool,
    ) -> Result<(TrackChangesUpdate, Value), ReviewWriteError> {
        self.review_writable()?;
        let role = self.project.role;
        let support = self.review.support;
        if support.probed && !support.switch_rest {
            return Err(ReviewWriteError::Absent);
        }
        if support.probed && !support.plan_allows_tracking {
            return Err(ReviewWriteError::NotAllowed);
        }
        let allowed = match scope {
            TrackScope::Me => role.can_edit(),
            TrackScope::Everyone | TrackScope::Guests => role == Role::Owner,
        };
        if !allowed {
            return Err(ReviewWriteError::NotAllowed);
        }
        let (mut users, mut guests) = match &self.project.track_changes {
            TrackChanges::Off => (BTreeSet::new(), false),
            TrackChanges::Everyone => (self.member_ids(), false),
            TrackChanges::Some { users, guests } => (users.clone(), *guests),
        };
        let update = match scope {
            TrackScope::Me => {
                let mut members: BTreeMap<String, bool> =
                    users.iter().map(|user| (user.clone(), true)).collect();
                members.insert(self.me.clone(), on);
                if on {
                    users.insert(self.me.clone());
                } else {
                    users.remove(&self.me);
                }
                TrackChangesUpdate::Members(members)
            }
            TrackScope::Everyone => {
                let everyone = self.member_ids();
                let members = everyone.iter().map(|user| (user.clone(), on)).collect();
                users = if on { everyone } else { BTreeSet::new() };
                TrackChangesUpdate::Members(members)
            }
            TrackScope::Guests => {
                guests = on;
                TrackChangesUpdate::Guests(on)
            }
        };
        let mut state: Map<String, Value> =
            users.into_iter().map(|user| (user, json!(true))).collect();
        if guests {
            state.insert(GUESTS.into(), json!(true));
        }
        Ok((update, Value::Object(state)))
    }

    pub(in crate::live::session) fn track_changes_saved(&mut self, state: Value) {
        self.access(&AccessEvent::TrackChanges(state));
        self.review.support_dirty = true;
    }

    pub(in crate::live::session) fn review_writable(&self) -> Result<(), ReviewWriteError> {
        if self.ended.is_some() {
            return Err(ReviewWriteError::Ended);
        }
        if self.project.restricted {
            return Err(ReviewWriteError::Restricted);
        }
        Ok(())
    }

    pub(in crate::live::session) fn threads_writable(&self) -> Result<(), ReviewWriteError> {
        self.review_writable()?;
        let support = self.review.support;
        if support.probed && !support.threads {
            return Err(ReviewWriteError::Absent);
        }
        Ok(())
    }

    pub(in crate::live::session) fn doc_format(&self, doc: &DocId) -> Option<DocFormat> {
        self.slots
            .get(doc)?
            .doc
            .as_ref()
            .filter(|known| !known.is_provisional())
            .map(|known| known.format().format())
    }

    pub(in crate::live::session) fn reserve_comment(
        &mut self,
        doc: &DocId,
        from: usize,
        to: usize,
        rev: Option<u64>,
    ) -> Result<u64, ReviewWriteError> {
        self.threads_writable()?;
        let current = self.rev_of(doc);
        let slot = self
            .slots
            .get_mut(doc)
            .ok_or(ReviewWriteError::UnknownDoc)?;
        if matches!(slot.phase, Phase::Held | Phase::Stopped) {
            return Err(ReviewWriteError::UnknownDoc);
        }
        let known = slot
            .doc
            .as_mut()
            .filter(|known| !known.is_provisional())
            .ok_or(ReviewWriteError::UnknownDoc)?;
        if rev.is_some() && current.is_some() && rev != current {
            return Err(ReviewWriteError::Stale);
        }
        let text = known.text();
        let fits = from < to
            && to <= utf16_len(text)
            && byte_at(text, from).is_some()
            && byte_at(text, to).is_some();
        if !fits {
            return Err(ReviewWriteError::Invalid("a selection outside the text"));
        }
        Ok(known.mark(vec![(from, to)]))
    }

    pub(in crate::live::session) fn finish_comment(
        &mut self,
        doc: &DocId,
        key: u64,
        thread: &str,
        message: Option<Option<ThreadMessage>>,
    ) -> Result<(), ReviewWriteError> {
        let ranges = self
            .slots
            .get_mut(doc)
            .and_then(|slot| slot.doc.as_mut())
            .and_then(|known| known.unmark(key));
        let Some(message) = message else {
            return Ok(());
        };
        if let Some(message) = message {
            self.add_own_message(thread, message);
        }
        let ranges = ranges
            .filter(|ranges| ranges.iter().any(|(from, to)| from < to))
            .ok_or(ReviewWriteError::Gone)?;
        self.queue_doc_review(
            doc,
            ReviewOp::Anchor {
                thread: thread.to_string(),
                ranges,
                ride: false,
            },
        )
    }

    pub(in crate::live::session) fn add_own_message(
        &mut self,
        thread: &str,
        message: ThreadMessage,
    ) {
        let message = ThreadMessage {
            user_id: message.user_id.or_else(|| Some(self.me.clone())),
            ..message
        };
        if self.review.fetching {
            self.review.replay.push(ReviewEvent::NewComment {
                thread: thread.to_string(),
                message: Box::new(message.clone()),
            });
        }
        add_message(
            thread_entry(Arc::make_mut(&mut self.review.threads), thread),
            message,
        );
        self.review.threads_dirty = true;
    }

    pub(in crate::live::session) fn patch_threads(&mut self, event: ReviewEvent) {
        if self.review.fetching {
            self.review.replay.push(event.clone());
        }
        let now = now_ms() as i64;
        if patch(Arc::make_mut(&mut self.review.threads), &event, now) {
            self.review.threads_dirty = true;
        }
    }

    pub(in crate::live::session) fn me_as_user(&self) -> ReviewUser {
        let member = self
            .project
            .members
            .all()
            .find(|member| member.id == self.me);
        let named = |name: &str| (!name.trim().is_empty()).then(|| name.to_string());
        ReviewUser {
            id: self.me.clone(),
            first_name: member.and_then(|member| named(&member.first_name)),
            last_name: member.and_then(|member| named(&member.last_name)),
            email: named(&self.email),
        }
    }

    pub(in crate::live::session) fn queue_doc_review(
        &mut self,
        doc: &DocId,
        review: ReviewOp,
    ) -> Result<(), ReviewWriteError> {
        let slot = self
            .slots
            .get_mut(doc)
            .ok_or(ReviewWriteError::UnknownDoc)?;
        let reserved = matches!(review, ReviewOp::Anchor { .. });
        if slot.phase == Phase::Stopped || (slot.phase == Phase::Held && !reserved) {
            return Err(ReviewWriteError::UnknownDoc);
        }
        let known = slot
            .doc
            .as_mut()
            .filter(|known| !known.is_provisional())
            .ok_or(ReviewWriteError::UnknownDoc)?;
        known.queue_review(review);
        slot.dirty = true;
        self.want_if_unjoined(doc);
        Ok(())
    }

    pub(in crate::live::session) fn may_send_comment_ops(&self) -> bool {
        self.project.role.can_edit()
    }

    pub(in crate::live::session) fn docs_of_changes(
        &self,
        ids: &[String],
    ) -> (BTreeMap<DocId, Vec<String>>, Vec<String>) {
        let mut owners: BTreeMap<String, &DocId> = BTreeMap::new();
        for (doc, slot) in &self.slots {
            let joined = slot.doc.as_ref().filter(|_| slot.phase == Phase::Joined);
            for id in joined.map(OverleafDoc::change_ids).unwrap_or_default() {
                owners.entry(id).or_insert(doc);
            }
        }
        let mut found: BTreeMap<DocId, Vec<String>> = BTreeMap::new();
        let mut missing = Vec::new();
        for id in ids {
            match owners.get(id) {
                Some(doc) => found.entry((*doc).clone()).or_default().push(id.clone()),
                None => missing.push(id.clone()),
            }
        }
        (found, missing)
    }

    pub(in crate::live::session) fn queue_decision(
        &mut self,
        doc: &DocId,
        ids: Vec<String>,
        decision: Decision,
    ) -> Result<(), ReviewWriteError> {
        self.review_writable()?;
        let format = self.doc_format(doc).ok_or(ReviewWriteError::UnknownDoc)?;
        let role = self.project.role;
        let allowed = match (format, decision, role) {
            (_, _, Role::Owner | Role::Editor) => true,
            (DocFormat::ShareJs, Decision::Reject, Role::Reviewer) => {
                let me = Some(self.me.clone());
                let known = self.slots.get(doc).and_then(|slot| slot.doc.as_ref());
                known.is_some_and(|known| {
                    ids.iter()
                        .all(|id| known.change_author(id).is_some_and(|author| author == me))
                })
            }
            _ => false,
        };
        if !allowed {
            return Err(ReviewWriteError::NotAllowed);
        }
        let changes = self
            .slots
            .get(doc)
            .and_then(|slot| slot.doc.as_ref())
            .and_then(|known| known.targets(&ids))
            .ok_or(ReviewWriteError::Gone)?;
        self.queue_doc_review(doc, ReviewOp::Decide { changes, decision })
    }

    pub(in crate::live::session) fn accepted_by_rest(&mut self, doc: &DocId, ids: &[String]) {
        if let Some(slot) = self.slots.get_mut(doc) {
            if let Some(known) = slot.doc.as_mut() {
                if known.accept_locally(ids) > 0 {
                    slot.dirty = true;
                }
            }
        }
        self.note_review_doc(doc);
        self.want_ranges(doc);
    }

    pub(in crate::live::session) fn thread_removed_by_rest(&mut self, thread: &str) {
        self.forget_comment(thread);
        self.patch_threads(ReviewEvent::ThreadDeleted {
            thread: thread.to_string(),
        });
    }
}
