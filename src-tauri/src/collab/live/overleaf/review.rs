use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant};

use oleafly_collab::comments::{
    mention_spans, CommentAnchor, CommentMember, CommentMessage, CommentRange, CommentResolution,
    CommentThread,
};
use oleafly_collab::suggestions::{EditMode, Suggestion, SuggestionKind};
use oleafly_collab_protocol::projects::{project_role_allows, ProjectAction, ProjectRole};
use oleafly_online::live::doc::{ChangeSpan, CommentSpan, ReviewOp};
use oleafly_online::live::format::{ChangeKind, Decision as Choice, DocFormat};
use oleafly_online::live::rest::{RestError, ReviewError, MAX_COMMENT_UNITS};
use oleafly_online::live::session::{
    DocReview, ModeLock, OverleafSession, ReviewChange, ReviewWriteError, ThreadsView, TrackScope,
};
use oleafly_online::realtime::events::{ReviewUser, Thread, ThreadMessage};
use oleafly_online::realtime::DocId;
use oleafly_ot::utf16_len;

use super::people::person_name;
use super::{Mirror, OverleafLive};
use crate::collab::commands::{now_ms, CollabCommandError};
use crate::collab::comments::{
    status_of, CommentCount, CommentSwitches, CommentThreadList, CommentsChangedPayload,
    CommentsStatus, CommentsStatusPayload, MentionedPayload,
};
use crate::collab::live::session::guard;
use crate::collab::suggesting::{
    Decision, EditModeLock, EditModeScope, EditModeState, SuggestionCount, SuggestionList,
    SuggestionsChangedPayload,
};

const ECHO_WINDOW: Duration = Duration::from_secs(30);
const MENTION_ID: usize = 24;

pub(crate) type OnlineThread = CommentThread<String, String>;
pub(crate) type OnlineMessage = CommentMessage<String, String>;
pub(crate) type OnlineMember = CommentMember<String>;
pub(crate) type OnlineSuggestion = Suggestion<String, String, String>;

#[derive(Default)]
pub(crate) struct Memory {
    me: OnceLock<String>,
    since: OnceLock<i64>,
    seen: Mutex<Option<Arc<BTreeMap<String, Thread>>>>,
    status: Mutex<Option<CommentsStatus>>,
    trouble: Mutex<Option<String>>,
    unplaced: Mutex<Vec<(String, ThreadMessage, Instant)>>,
    digests: Mutex<BTreeMap<DocId, Digest>>,
    echoes: Mutex<Echoes>,
    shown: Mutex<Shown>,
}

#[derive(Default)]
struct Echoes {
    docs: BTreeMap<DocId, Instant>,
    threads: BTreeMap<String, Instant>,
}

struct Pending {
    doc: DocId,
    quote: String,
    range: CommentRange,
    first: OnlineMessage,
}

#[derive(Default)]
struct Shown {
    pending: BTreeMap<String, Pending>,
    resolved: BTreeMap<String, (bool, i64, Instant)>,
    deleted: BTreeMap<String, (DocId, Instant)>,
}

fn fresh(at: Instant, now: Instant) -> bool {
    now.saturating_duration_since(at) < ECHO_WINDOW
}

impl Echoes {
    fn prune(&mut self, now: Instant) {
        self.docs.retain(|_, at| fresh(*at, now));
        self.threads.retain(|_, at| fresh(*at, now));
    }
}

impl Shown {
    fn prune(&mut self, now: Instant) {
        self.resolved.retain(|_, (_, _, at)| fresh(*at, now));
        self.deleted.retain(|_, (_, at)| fresh(*at, now));
    }
}

impl Memory {
    pub(super) fn know_me(&self, me: &str) {
        let _ = self.me.set(me.to_owned());
        let _ = self.since.set(now_ms());
    }

    fn echo(&self, docs: &[&DocId], threads: &[&str]) {
        let now = Instant::now();
        let mut echoes = guard(&self.echoes);
        echoes.prune(now);
        for doc in docs {
            echoes.docs.insert((*doc).clone(), now);
        }
        for thread in threads {
            echoes.threads.insert((*thread).to_owned(), now);
        }
    }

    fn echoed(&self) -> (BTreeSet<DocId>, BTreeSet<String>) {
        let mut echoes = guard(&self.echoes);
        echoes.prune(Instant::now());
        (
            echoes.docs.keys().cloned().collect(),
            echoes.threads.keys().cloned().collect(),
        )
    }
}

#[derive(Clone, PartialEq, Eq)]
struct Digest {
    comments: BTreeMap<String, (Option<bool>, bool)>,
    changes: BTreeMap<String, (ChangeKind, Option<String>)>,
}

impl Digest {
    fn of(review: Option<&DocReview>) -> Digest {
        let in_doc = review.is_some_and(|review| review.format == DocFormat::HistoryOt);
        Digest {
            comments: review
                .into_iter()
                .flat_map(|review| &review.comments)
                .map(|span| {
                    let attached = span.ranges.iter().any(|(from, to)| from < to);
                    let resolved = span.resolved.filter(|_| in_doc);
                    (span.thread.clone(), (resolved, attached))
                })
                .collect(),
            changes: review
                .into_iter()
                .flat_map(|review| &review.changes)
                .map(|change| (change.id.clone(), (change.kind, change.user.clone())))
                .collect(),
        }
    }
}

#[derive(Default)]
struct Moved {
    news: Vec<String>,
    quiet: Vec<String>,
    mentions: Vec<(String, ThreadMessage)>,
}

#[derive(Clone, Copy)]
enum Act {
    Create,
    Reply,
    Thread,
    Decide,
    Switch,
}

pub(super) fn rest_code(error: &RestError) -> &'static str {
    match error {
        RestError::NotAllowed => "forbidden",
        RestError::RateLimited(_) => "rate_limited",
        RestError::SignedOut => "signed_out",
        RestError::Lost(_) | RestError::Unreachable(_) => "unreachable",
        RestError::TooLarge | RestError::Refused { status: 413, .. } => "too_large",
        RestError::Refused {
            status: 400 | 422, ..
        } => "invalid",
        RestError::Refused { .. } | RestError::Unreadable(_) | RestError::Short => "server",
    }
}

fn code_of(error: &ReviewWriteError, act: Act) -> &'static str {
    let comments = matches!(act, Act::Create | Act::Reply | Act::Thread);
    match error {
        ReviewWriteError::Ended if comments => "comment_not_live",
        ReviewWriteError::Ended | ReviewWriteError::UnknownDoc => "not_found",
        ReviewWriteError::Stale => "comment_selection_changed",
        ReviewWriteError::Absent | ReviewWriteError::Rest(ReviewError::Absent) if comments => {
            "comment_off_server"
        }
        ReviewWriteError::Absent | ReviewWriteError::Rest(ReviewError::Absent) => {
            "review_off_server"
        }
        ReviewWriteError::NotAllowed
        | ReviewWriteError::Rest(ReviewError::Rest(RestError::NotAllowed)) => match act {
            Act::Create | Act::Reply => "comment_viewer",
            Act::Thread => "comment_not_yours",
            Act::Decide | Act::Switch => "suggestion_role",
        },
        ReviewWriteError::Restricted if comments => "comment_off_project",
        ReviewWriteError::Restricted => "suggestion_role",
        ReviewWriteError::Gone => match act {
            Act::Create => "comment_selection_changed",
            Act::Reply | Act::Thread => "not_found",
            Act::Decide | Act::Switch => "suggestion_gone",
        },
        ReviewWriteError::Invalid(_) | ReviewWriteError::Rest(ReviewError::Invalid(_)) => "invalid",
        ReviewWriteError::Rest(ReviewError::TimedOut(_)) => "unreachable",
        ReviewWriteError::Rest(ReviewError::Rest(error)) => rest_code(error),
    }
}

fn object_id(id: &str) -> bool {
    id.len() == MENTION_ID
        && id
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn wire_body(body: &str, members: &[OnlineMember]) -> (String, Vec<String>) {
    let mut wire = String::with_capacity(body.len());
    let mut mentions: Vec<String> = Vec::new();
    let mut at = 0;
    for (span, id) in mention_spans(body, members) {
        if span.start < at || !object_id(&id) {
            continue;
        }
        wire.push_str(&body[at..span.start]);
        wire.push_str("@[");
        wire.push_str(&id);
        wire.push(']');
        if !mentions.contains(&id) {
            mentions.push(id);
        }
        at = span.end;
    }
    wire.push_str(&body[at..]);
    (wire, mentions)
}

fn shown_body(content: &str, names: &BTreeMap<String, String>) -> (String, Vec<String>) {
    let mut body = String::with_capacity(content.len());
    let mut mentions: Vec<String> = Vec::new();
    let mut rest = content;
    while let Some(at) = rest.find("@[") {
        body.push_str(&rest[..at]);
        let tail = &rest[at + 2..];
        let id = tail
            .get(..MENTION_ID)
            .filter(|id| object_id(id) && tail[MENTION_ID..].starts_with(']'));
        let Some(id) = id else {
            body.push_str("@[");
            rest = tail;
            continue;
        };
        match names.get(id) {
            Some(name) => {
                body.push('@');
                body.push_str(name);
            }
            None => body.push_str(&rest[at..at + MENTION_ID + 3]),
        }
        if !mentions.iter().any(|known| known == id) {
            mentions.push(id.to_owned());
        }
        rest = &tail[MENTION_ID + 1..];
    }
    body.push_str(rest);
    (body, mentions)
}

fn mentions_of(content: &str) -> Vec<String> {
    shown_body(content, &BTreeMap::new()).1
}

fn user_name(user: &ReviewUser) -> Option<String> {
    person_name(
        user.first_name.as_deref().unwrap_or_default(),
        user.last_name.as_deref().unwrap_or_default(),
        user.email.as_deref().unwrap_or_default(),
    )
}

fn quote_at(text: &str, from: usize, to: usize) -> String {
    let units: Vec<u16> = text
        .encode_utf16()
        .skip(from)
        .take(to.saturating_sub(from))
        .collect();
    String::from_utf16_lossy(&units)
}

fn message_of(message: &ThreadMessage, names: &BTreeMap<String, String>) -> OnlineMessage {
    let (body, mentions) = shown_body(&message.content, names);
    CommentMessage {
        id: message.id.clone(),
        author: message.user_id.clone().unwrap_or_default(),
        at: message.timestamp.unwrap_or_default(),
        body,
        edited_at: message.edited_at,
        deleted: false,
        mentions,
        verified: true,
        reactions: Vec::new(),
        removed: false,
        pending: false,
    }
}

fn first_range(span: &CommentSpan) -> Option<CommentRange> {
    span.ranges
        .first()
        .filter(|(from, to)| from < to)
        .map(|(from, to)| CommentRange {
            from: *from,
            to: *to,
        })
}

fn resolution_of(thread: &Thread, resolved: bool) -> Option<CommentResolution<String>> {
    resolved.then(|| CommentResolution {
        by: thread
            .resolved
            .as_ref()
            .and_then(|resolution| resolution.by.as_ref())
            .map(|user| user.id.clone())
            .unwrap_or_default(),
        at: thread
            .resolved
            .as_ref()
            .and_then(|resolution| resolution.at)
            .unwrap_or_default(),
        verified: true,
    })
}

fn suggestion_of(doc: &DocId, change: &ChangeSpan) -> OnlineSuggestion {
    Suggestion {
        id: change.id.clone(),
        file_id: doc.0.clone(),
        kind: match change.kind {
            ChangeKind::Insert => SuggestionKind::Insert,
            ChangeKind::Delete => SuggestionKind::Delete,
        },
        author: change.user.clone().unwrap_or_default(),
        created_at: change.at.unwrap_or_default(),
        from: change.from,
        to: change.to,
        text: change.text.clone(),
        thread_id: None,
        verified: true,
    }
}

fn commenting_role(role: ProjectRole) -> ProjectRole {
    match role {
        ProjectRole::Viewer => ProjectRole::Commenter,
        other => other,
    }
}

fn lock_of(lock: ModeLock) -> EditModeLock {
    match lock {
        ModeLock::Reviewer => EditModeLock::Reviewer,
        ModeLock::Everyone => EditModeLock::Everyone,
        ModeLock::Plan => EditModeLock::Plan,
        ModeLock::Server => EditModeLock::Server,
    }
}

fn log_line(project_id: &str, line: impl std::fmt::Display) -> String {
    format!("Overleaf comments and changes in project {project_id}: {line}")
}

fn log(project_id: &str, line: impl std::fmt::Display) {
    let _ = crate::project::append_app_log(log_line(project_id, line));
}

pub(super) fn trouble_lines(mirror: &Mirror, change: &ReviewChange) -> Vec<String> {
    let project_id = &mirror.disk.project_id;
    let mut lines: Vec<String> = change
        .dropped
        .iter()
        .map(|(doc, op)| {
            let what = match op {
                ReviewOp::Anchor { .. } => "comment anchor",
                ReviewOp::Resolve { .. } => "resolve or reopen",
                ReviewOp::Uncomment { .. } => "comment removal",
                ReviewOp::Decide { .. } => "decision on tracked changes",
            };
            log_line(
                project_id,
                format_args!(
                    "dropped a {what} for document {} because what it pointed at is gone",
                    doc.0
                ),
            )
        })
        .collect();
    let mut logged = guard(&mirror.review.trouble);
    if *logged != change.trouble {
        logged.clone_from(&change.trouble);
        if let Some(trouble) = &change.trouble {
            lines.push(log_line(
                project_id,
                format_args!("could not load the comment threads: {trouble}"),
            ));
        }
    }
    lines
}

impl Mirror {
    fn live_session(&self) -> Option<Arc<OverleafSession>> {
        self.session.get().and_then(Weak::upgrade)
    }

    fn known_role(&self) -> ProjectRole {
        self.role().map_or(ProjectRole::Viewer, |(role, _)| role)
    }

    fn review_status(&self) -> CommentsStatus {
        let threads = self
            .live_session()
            .is_some_and(|session| session.review_support().threads);
        let restricted = guard(&self.flags).0;
        let role = self.known_role();
        CommentsStatus {
            moderate: matches!(role, ProjectRole::Owner | ProjectRole::Editor),
            typing: false,
            suggestion_threads: false,
            ..status_of(
                CommentSwitches {
                    server: threads,
                    project: !restricted,
                    reactions: false,
                },
                commenting_role(role),
            )
        }
    }

    pub(super) fn tell_review_status(&self) {
        let mut last = guard(&self.review.status);
        let status = self.review_status();
        if *last == Some(status) {
            return;
        }
        *last = Some(status);
        self.host.comments_status(CommentsStatusPayload {
            project_id: self.disk.project_id.clone(),
            status,
        });
    }

    fn review_paths(&self, docs: &[DocId]) -> Vec<Option<String>> {
        let mut paths: Vec<Option<String>> = {
            let disk = guard(&self.disk.disk);
            docs.iter()
                .map(|doc| disk.layout.get(&doc.0).map(|placed| placed.path.clone()))
                .collect()
        };
        if paths.iter().any(Option::is_none) {
            if let Some(session) = self.live_session() {
                self.files(&session.nodes());
            }
            for (path, doc) in paths.iter_mut().zip(docs) {
                if path.is_none() {
                    *path = self.laid_path(&doc.0);
                }
            }
        }
        paths
    }

    fn tell_comments(&self, docs: Vec<DocId>, mentioned: Vec<MentionedPayload>, local: bool) {
        if docs.is_empty() && mentioned.is_empty() {
            return;
        }
        let paths = self.review_paths(&docs);
        self.host.comments_changed(CommentsChangedPayload {
            project_id: self.disk.project_id.clone(),
            file_ids: docs.into_iter().map(|doc| doc.0).collect(),
            paths: paths.into_iter().flatten().collect(),
            mentioned,
            local,
        });
    }

    fn tell_suggestions(&self, docs: &[DocId], local: bool) {
        let paths: Vec<String> = self.review_paths(docs).into_iter().flatten().collect();
        if paths.is_empty() {
            return;
        }
        self.host.suggestions_changed(SuggestionsChangedPayload {
            project_id: self.disk.project_id.clone(),
            paths,
            local,
        });
    }

    pub(super) fn typed(&self, doc: &DocId) {
        self.review.echo(&[doc], &[]);
        if self.role().is_some_and(|(_, tracking)| tracking) {
            self.tell_suggestions(std::slice::from_ref(doc), true);
        }
    }

    fn threads_moved(&self, view: &ThreadsView, me: &str) -> Moved {
        let mut seen = guard(&self.review.seen);
        if !view.loaded {
            let before = seen.take();
            return Moved {
                quiet: before
                    .map(|before| before.keys().cloned().collect())
                    .unwrap_or_default(),
                ..Moved::default()
            };
        }
        let previous = seen.replace(Arc::clone(&view.threads)).unwrap_or_default();
        drop(seen);
        let mut moved = Moved::default();
        if Arc::ptr_eq(&previous, &view.threads) {
            return moved;
        }
        let since = self.review.since.get().copied().unwrap_or_default();
        let recent = |message: &&ThreadMessage| message.timestamp.is_some_and(|at| at >= since);
        for (id, thread) in view.threads.iter() {
            let before = previous.get(id);
            if before == Some(thread) {
                continue;
            }
            let known: BTreeSet<&str> = before
                .map(|before| {
                    before
                        .messages
                        .iter()
                        .map(|known| known.id.as_str())
                        .collect()
                })
                .unwrap_or_default();
            let fresh: Vec<&ThreadMessage> = thread
                .messages
                .iter()
                .filter(|message| !known.contains(message.id.as_str()))
                .filter(recent)
                .collect();
            if before.is_some() || !fresh.is_empty() {
                moved.news.push(id.clone());
            } else {
                moved.quiet.push(id.clone());
            }
            moved.mentions.extend(
                fresh
                    .into_iter()
                    .filter(|message| message.user_id.as_deref() != Some(me))
                    .filter(|message| {
                        mentions_of(&message.content)
                            .iter()
                            .any(|id| id.as_str() == me)
                    })
                    .map(|message| (id.clone(), message.clone())),
            );
        }
        moved.news.extend(
            previous
                .keys()
                .filter(|id| !view.threads.contains_key(*id))
                .cloned(),
        );
        moved
    }

    fn mentioned_payloads(
        &self,
        mentioned: Vec<(DocId, String, ThreadMessage)>,
    ) -> Vec<MentionedPayload> {
        let docs: Vec<DocId> = mentioned.iter().map(|(doc, _, _)| doc.clone()).collect();
        mentioned
            .into_iter()
            .zip(self.review_paths(&docs))
            .map(|((doc, thread, message), path)| MentionedPayload {
                file_id: doc.0,
                path,
                thread_id: thread,
                message_id: message.id,
                author: message.user_id.unwrap_or_default(),
            })
            .collect()
    }

    pub(super) fn review_noticed(&self, change: ReviewChange) {
        let me = self.review.me.get().cloned().unwrap_or_default();
        if change.support {
            self.tell_review_status();
        }
        {
            let mut shown = guard(&self.review.shown);
            for (_, op) in &change.dropped {
                if let ReviewOp::Anchor { thread, .. } = op {
                    shown.pending.remove(thread);
                }
            }
        }
        let (echo_docs, mut echo_threads) = self.review.echoed();
        let unplaced = !guard(&self.review.unplaced).is_empty();
        let session = self.live_session();
        let view = session
            .as_ref()
            .filter(|_| change.threads || unplaced)
            .map(|session| session.threads());
        let mut threads_at: BTreeMap<DocId, Vec<String>> = BTreeMap::new();
        let mut mentioned = Vec::new();
        if let Some(view) = &view {
            let pending: BTreeMap<String, DocId> = guard(&self.review.shown)
                .pending
                .iter()
                .map(|(thread, pending)| (thread.clone(), pending.doc.clone()))
                .collect();
            let doc_of = |thread: &str| {
                view.anchored
                    .get(thread)
                    .or_else(|| pending.get(thread))
                    .cloned()
            };
            let now = Instant::now();
            let mut heard: Vec<(String, ThreadMessage, Instant)> = Vec::new();
            if change.threads {
                let moved = self.threads_moved(view, &me);
                heard.extend(
                    moved
                        .mentions
                        .into_iter()
                        .map(|(thread, message)| (thread, message, now)),
                );
                let quiet = moved.quiet.into_iter().map(|thread| (thread, true));
                for (thread, quiet) in moved
                    .news
                    .into_iter()
                    .map(|thread| (thread, false))
                    .chain(quiet)
                {
                    if let Some(doc) = doc_of(&thread) {
                        threads_at.entry(doc).or_default().push(thread.clone());
                    }
                    if quiet {
                        echo_threads.insert(thread);
                    }
                }
            }
            let mut waiting = guard(&self.review.unplaced);
            heard.extend(waiting.drain(..).filter(|(_, _, at)| fresh(*at, now)));
            for (thread, message, at) in heard {
                match doc_of(&thread) {
                    Some(doc) => {
                        threads_at
                            .entry(doc.clone())
                            .or_default()
                            .push(thread.clone());
                        mentioned.push((doc, thread, message));
                    }
                    None => waiting.push((thread, message, at)),
                }
            }
        }
        let fresh_digests: Vec<Digest> = change
            .docs
            .iter()
            .map(|doc| {
                Digest::of(
                    session
                        .as_ref()
                        .and_then(|session| session.review(doc))
                        .as_ref(),
                )
            })
            .collect();
        let mut quiet_comments: BTreeSet<DocId> = BTreeSet::new();
        let mut quiet_changes: BTreeSet<DocId> = BTreeSet::new();
        {
            let mut digests = guard(&self.review.digests);
            for (doc, digest) in change.docs.iter().zip(fresh_digests) {
                let before = digests.insert(doc.clone(), digest.clone());
                let echoed = echo_docs.contains(doc);
                if echoed
                    || before
                        .as_ref()
                        .is_none_or(|before| before.comments == digest.comments)
                {
                    quiet_comments.insert(doc.clone());
                }
                if echoed
                    || before
                        .as_ref()
                        .is_none_or(|before| before.changes == digest.changes)
                {
                    quiet_changes.insert(doc.clone());
                }
            }
        }
        let reshaped: BTreeSet<DocId> = change.docs.iter().cloned().collect();
        let mut own = Vec::new();
        let mut others = Vec::new();
        for doc in reshaped
            .iter()
            .chain(threads_at.keys())
            .collect::<BTreeSet<_>>()
        {
            let ranges_own = !reshaped.contains(doc) || quiet_comments.contains(doc);
            let threads_own = threads_at
                .get(doc)
                .is_none_or(|threads| threads.iter().all(|thread| echo_threads.contains(thread)));
            if ranges_own && threads_own {
                own.push(doc.clone());
            } else {
                others.push(doc.clone());
            }
        }
        let mentioned = self.mentioned_payloads(mentioned);
        self.tell_comments(own, Vec::new(), true);
        self.tell_comments(others, mentioned, false);
        let (own_changes, other_changes): (Vec<DocId>, Vec<DocId>) = change
            .docs
            .into_iter()
            .partition(|doc| quiet_changes.contains(doc));
        self.tell_suggestions(&own_changes, true);
        self.tell_suggestions(&other_changes, false);
    }
}

impl OverleafLive {
    fn refusal(&self, what: &str, code: &'static str, message: String) -> CollabCommandError {
        log(
            self.project_id(),
            format_args!("could not {what}: {code}: {message}"),
        );
        CollabCommandError { code, message }
    }

    fn write_failed(&self, what: &str, act: Act, error: &ReviewWriteError) -> CollabCommandError {
        self.refusal(what, code_of(error, act), error.to_string())
    }

    pub(crate) fn comments_switch_refused(&self) -> CollabCommandError {
        self.refusal(
            "switch comments",
            "forbidden",
            "Overleaf projects have no switch for comments".to_owned(),
        )
    }

    pub(crate) fn reactions_refused(&self) -> CollabCommandError {
        self.refusal(
            "react to a comment",
            "forbidden",
            "Overleaf has no reactions on comments".to_owned(),
        )
    }

    pub(crate) fn suggestion_reply_refused(&self) -> CollabCommandError {
        self.refusal(
            "reply on a tracked change",
            "forbidden",
            "Overleaf has no replies on tracked changes".to_owned(),
        )
    }

    pub(crate) fn comments_status(&self) -> CommentsStatus {
        self.mirror.review_status()
    }

    fn may_comment(&self, what: &str) -> Result<(), CollabCommandError> {
        let status = self.comments_status();
        let refused = if !status.project_enabled {
            Some(("comment_off_project", "link viewers can't use comments"))
        } else if !status.server_allowed {
            Some(("comment_off_server", "this Overleaf server has no comments"))
        } else if !status.can_comment {
            Some(("comment_viewer", "your role doesn't allow comments"))
        } else {
            None
        };
        match refused {
            Some((code, message)) => Err(self.refusal(what, code, message.to_owned())),
            None => Ok(()),
        }
    }

    fn wire(
        &self,
        what: &str,
        body: &str,
        members: &[OnlineMember],
    ) -> Result<String, CollabCommandError> {
        if body.trim().is_empty() {
            return Err(self.refusal(what, "comment_empty", "the comment is empty".to_owned()));
        }
        let (wire, _) = wire_body(body, members);
        if utf16_len(&wire) > MAX_COMMENT_UNITS {
            return Err(self.refusal(
                what,
                "comment_too_long",
                format!("Overleaf takes at most {MAX_COMMENT_UNITS} characters"),
            ));
        }
        Ok(wire)
    }

    fn doc_for(&self, what: &str, path: &str) -> Result<DocId, CollabCommandError> {
        self.doc_at(path).ok_or_else(|| {
            self.refusal(
                what,
                "not_found",
                format!("{path} is not a live Overleaf document"),
            )
        })
    }

    fn names(&self, view: &ThreadsView) -> BTreeMap<String, String> {
        let mut names: BTreeMap<String, String> = self
            .members()
            .into_iter()
            .map(|member| (member.person.account_id, member.person.display_name))
            .collect();
        let users = view
            .threads
            .values()
            .flat_map(|thread| &thread.messages)
            .filter_map(|message| message.user.as_ref());
        for user in users {
            if !names.contains_key(&user.id) {
                if let Some(name) = user_name(user) {
                    names.insert(user.id.clone(), name);
                }
            }
        }
        names
    }

    fn own_message(
        &self,
        id: String,
        wire: &str,
        names: &BTreeMap<String, String>,
    ) -> OnlineMessage {
        let (body, mentions) = shown_body(wire, names);
        CommentMessage {
            id,
            author: self.me.clone(),
            at: now_ms(),
            body,
            edited_at: None,
            deleted: false,
            mentions,
            verified: true,
            reactions: Vec::new(),
            removed: false,
            pending: true,
        }
    }

    fn thread_of(
        &self,
        doc: &DocId,
        span: &CommentSpan,
        format: DocFormat,
        thread: &Thread,
        names: &BTreeMap<String, String>,
    ) -> OnlineThread {
        let first = thread.messages.first();
        let resolved = match format {
            DocFormat::HistoryOt => span.resolved.unwrap_or(false),
            DocFormat::ShareJs => thread.resolved.is_some(),
        };
        CommentThread {
            id: span.thread.clone(),
            file_id: doc.0.clone(),
            anchor: CommentAnchor {
                quote: span.quote.clone(),
                range: first_range(span),
            },
            created_by: first
                .and_then(|message| message.user_id.clone())
                .unwrap_or_default(),
            created_at: first
                .and_then(|message| message.timestamp)
                .unwrap_or_default(),
            resolved: resolution_of(thread, resolved),
            messages: thread
                .messages
                .iter()
                .map(|message| message_of(message, names))
                .collect(),
            verified: true,
        }
    }

    fn listed(
        &self,
        doc: &DocId,
        review: Option<&DocReview>,
        view: &ThreadsView,
    ) -> Vec<OnlineThread> {
        let names = self.names(view);
        let mut shown = guard(&self.mirror.review.shown);
        shown.prune(Instant::now());
        let anchored: BTreeSet<&str> = review
            .map(|review| {
                review
                    .comments
                    .iter()
                    .map(|span| span.thread.as_str())
                    .collect()
            })
            .unwrap_or_default();
        shown
            .pending
            .retain(|thread, _| !anchored.contains(thread.as_str()));
        shown.deleted.retain(|thread, (deleted_in, _)| {
            deleted_in != doc || anchored.contains(thread.as_str())
        });
        let mut listed = Vec::new();
        if let Some(review) = review {
            for span in &review.comments {
                if shown.deleted.contains_key(&span.thread) {
                    continue;
                }
                let Some(thread) = view
                    .threads
                    .get(&span.thread)
                    .filter(|thread| !thread.messages.is_empty())
                else {
                    continue;
                };
                let mut mapped = self.thread_of(doc, span, review.format, thread, &names);
                if let Some((resolved, at, _)) = shown.resolved.get(&span.thread).copied() {
                    if mapped.resolved.is_some() == resolved {
                        shown.resolved.remove(&span.thread);
                    } else {
                        mapped.resolved = resolved.then(|| CommentResolution {
                            by: self.me.clone(),
                            at,
                            verified: true,
                        });
                    }
                }
                listed.push(mapped);
            }
        }
        for (id, pending) in shown
            .pending
            .iter()
            .filter(|(_, pending)| pending.doc == *doc)
        {
            let mut messages: Vec<OnlineMessage> = view
                .threads
                .get(id)
                .filter(|thread| !thread.messages.is_empty())
                .map(|thread| {
                    thread
                        .messages
                        .iter()
                        .map(|message| message_of(message, &names))
                        .collect()
                })
                .unwrap_or_else(|| vec![pending.first.clone()]);
            for message in &mut messages {
                message.pending = true;
            }
            listed.push(CommentThread {
                id: id.clone(),
                file_id: doc.0.clone(),
                anchor: CommentAnchor {
                    quote: pending.quote.clone(),
                    range: Some(pending.range),
                },
                created_by: self.me.clone(),
                created_at: pending.first.at,
                resolved: None,
                messages,
                verified: true,
            });
        }
        listed
    }

    pub(crate) fn thread_list(
        &self,
        path: &str,
    ) -> Result<CommentThreadList<OnlineThread>, CollabCommandError> {
        let doc = self.doc_at(path).ok_or_else(|| CollabCommandError {
            code: "not_found",
            message: format!("{path} is not a live Overleaf document"),
        })?;
        let review = self.session.review(&doc);
        let view = self.session.threads();
        Ok(CommentThreadList {
            rev: review.as_ref().and_then(|review| review.rev),
            threads: self.listed(&doc, review.as_ref(), &view),
        })
    }

    pub(crate) fn file_path(&self, file_id: &str) -> Option<String> {
        self.mirror.path_of(&DocId(file_id.to_owned()))
    }

    pub(crate) fn comment_counts(&self) -> Vec<CommentCount> {
        let view = self.session.threads();
        let pending: BTreeSet<DocId> = guard(&self.mirror.review.shown)
            .pending
            .values()
            .map(|pending| pending.doc.clone())
            .collect();
        let docs: Vec<DocId> = view
            .anchored
            .iter()
            .filter(|(thread, _)| {
                view.threads
                    .get(*thread)
                    .is_some_and(|thread| !thread.messages.is_empty())
            })
            .map(|(_, doc)| doc.clone())
            .chain(pending)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let paths = self.mirror.review_paths(&docs);
        let mut counts: Vec<CommentCount> = docs
            .iter()
            .zip(paths)
            .filter_map(|(doc, path)| {
                let path = path?;
                let listed = self.listed(doc, self.session.review(doc).as_ref(), &view);
                let resolved = listed
                    .iter()
                    .filter(|thread| thread.resolved.is_some())
                    .count();
                (!listed.is_empty()).then(|| CommentCount {
                    path,
                    open: listed.len() - resolved,
                    resolved,
                    waiting: listed
                        .iter()
                        .flat_map(|thread| &thread.messages)
                        .filter(|message| message.pending)
                        .count(),
                })
            })
            .collect();
        counts.sort_by(|left, right| left.path.cmp(&right.path));
        counts
    }

    fn told(&self, doc: &DocId, thread: &str) {
        self.mirror.review.echo(&[doc], &[thread]);
        self.mirror
            .tell_comments(vec![doc.clone()], Vec::new(), true);
    }

    fn cached_message(&self, thread: &str, message: &str) -> Option<ThreadMessage> {
        self.session
            .threads()
            .threads
            .get(thread)?
            .messages
            .iter()
            .find(|known| known.id == message)
            .cloned()
    }

    fn started_by_me(&self, thread: &str) -> bool {
        let first = self
            .session
            .threads()
            .threads
            .get(thread)
            .and_then(|thread| {
                thread
                    .messages
                    .first()
                    .and_then(|first| first.user_id.clone())
            });
        let pending = guard(&self.mirror.review.shown)
            .pending
            .contains_key(thread);
        pending || first.as_deref() == Some(self.me.as_str())
    }

    fn may_moderate(&self, what: &str, thread: &str) -> Result<(), CollabCommandError> {
        match self.role_now() {
            ProjectRole::Owner | ProjectRole::Editor => Ok(()),
            ProjectRole::Reviewer if self.started_by_me(thread) => Ok(()),
            _ => Err(self.refusal(
                what,
                "comment_not_yours",
                "only owners, editors and the person who started the thread can do that".to_owned(),
            )),
        }
    }

    pub(crate) async fn comment(
        &self,
        path: &str,
        from: usize,
        to: usize,
        rev: Option<u64>,
        body: &str,
        members: &[OnlineMember],
    ) -> Result<OnlineThread, CollabCommandError> {
        const WHAT: &str = "add a comment";
        self.may_comment(WHAT)?;
        let doc = self.doc_for(WHAT, path)?;
        let wire = self.wire(WHAT, body, members)?;
        let text = self.session.text(&doc).unwrap_or_default();
        if from >= to || to > utf16_len(&text) {
            return Err(self.refusal(
                WHAT,
                "comment_selection_changed",
                format!("{from}..{to} is not a selection in {path}"),
            ));
        }
        let quote = quote_at(&text, from, to);
        let added = self
            .session
            .comment(&doc, from, to, rev, &wire)
            .await
            .map_err(|error| self.write_failed(WHAT, Act::Create, &error))?;
        let names = self.names(&self.session.threads());
        let mut first = match &added.message {
            Some(message) => message_of(message, &names),
            None => self.own_message(String::new(), &wire, &names),
        };
        first.pending = true;
        let range = CommentRange { from, to };
        guard(&self.mirror.review.shown).pending.insert(
            added.thread.clone(),
            Pending {
                doc: doc.clone(),
                quote: quote.clone(),
                range,
                first: first.clone(),
            },
        );
        self.told(&doc, &added.thread);
        Ok(CommentThread {
            id: added.thread,
            file_id: doc.0,
            anchor: CommentAnchor {
                quote,
                range: Some(range),
            },
            created_by: self.me.clone(),
            created_at: first.at,
            resolved: None,
            messages: vec![first],
            verified: true,
        })
    }

    pub(crate) async fn reply(
        &self,
        file_id: &str,
        thread: &str,
        body: &str,
        members: &[OnlineMember],
    ) -> Result<OnlineMessage, CollabCommandError> {
        const WHAT: &str = "reply to a comment";
        self.may_comment(WHAT)?;
        let wire = self.wire(WHAT, body, members)?;
        let posted = self
            .session
            .reply(thread, &wire)
            .await
            .map_err(|error| self.write_failed(WHAT, Act::Reply, &error))?;
        let names = self.names(&self.session.threads());
        let message = match posted {
            Some(message) => message_of(&message, &names),
            None => self.own_message(String::new(), &wire, &names),
        };
        self.told(&DocId(file_id.to_owned()), thread);
        Ok(message)
    }

    fn mine(&self, what: &str, thread: &str, message: &str) -> Result<(), CollabCommandError> {
        match self.cached_message(thread, message) {
            Some(found) if found.user_id.as_deref() != Some(self.me.as_str()) => Err(self.refusal(
                what,
                "comment_not_yours",
                "only the person who wrote it can change it".to_owned(),
            )),
            _ => Ok(()),
        }
    }

    pub(crate) async fn edit_message(
        &self,
        file_id: &str,
        thread: &str,
        message: &str,
        body: &str,
        members: &[OnlineMember],
    ) -> Result<OnlineMessage, CollabCommandError> {
        const WHAT: &str = "edit a comment";
        self.may_comment(WHAT)?;
        self.mine(WHAT, thread, message)?;
        let wire = self.wire(WHAT, body, members)?;
        self.session
            .edit_message(thread, message, &wire)
            .await
            .map_err(|error| self.write_failed(WHAT, Act::Thread, &error))?;
        let names = self.names(&self.session.threads());
        let edited = match self.cached_message(thread, message) {
            Some(found) => message_of(&found, &names),
            None => CommentMessage {
                edited_at: Some(now_ms()),
                pending: false,
                ..self.own_message(message.to_owned(), &wire, &names)
            },
        };
        self.told(&DocId(file_id.to_owned()), thread);
        Ok(edited)
    }

    pub(crate) async fn delete_message(
        &self,
        file_id: &str,
        thread: &str,
        message: &str,
        own: bool,
    ) -> Result<(), CollabCommandError> {
        let what = if own {
            "delete a comment"
        } else {
            "remove someone else's comment"
        };
        if own {
            self.mine(what, thread, message)?;
        } else if !self.comments_status().moderate {
            return Err(self.refusal(
                what,
                "comment_not_yours",
                "only owners and editors can remove someone else's comment".to_owned(),
            ));
        }
        self.session
            .delete_message(thread, message, own)
            .await
            .map_err(|error| self.write_failed(what, Act::Thread, &error))?;
        self.told(&DocId(file_id.to_owned()), thread);
        Ok(())
    }

    fn thread_now(&self, doc: &DocId, thread: &str) -> Option<OnlineThread> {
        let review = self.session.review(doc);
        let view = self.session.threads();
        self.listed(doc, review.as_ref(), &view)
            .into_iter()
            .find(|listed| listed.id == thread)
    }

    pub(crate) async fn set_resolved(
        &self,
        file_id: &str,
        thread: &str,
        resolved: bool,
    ) -> Result<OnlineThread, CollabCommandError> {
        let what = if resolved {
            "resolve a comment"
        } else {
            "reopen a comment"
        };
        self.may_moderate(what, thread)?;
        let doc = DocId(file_id.to_owned());
        self.session
            .set_resolved(&doc, thread, resolved)
            .await
            .map_err(|error| self.write_failed(what, Act::Thread, &error))?;
        let at = now_ms();
        guard(&self.mirror.review.shown)
            .resolved
            .insert(thread.to_owned(), (resolved, at, Instant::now()));
        self.told(&doc, thread);
        let found = self
            .thread_now(&doc, thread)
            .unwrap_or_else(|| CommentThread {
                id: thread.to_owned(),
                file_id: doc.0.clone(),
                anchor: CommentAnchor {
                    quote: String::new(),
                    range: None,
                },
                created_by: String::new(),
                created_at: 0,
                resolved: None,
                messages: Vec::new(),
                verified: true,
            });
        Ok(CommentThread {
            resolved: resolved.then(|| CommentResolution {
                by: self.me.clone(),
                at,
                verified: true,
            }),
            ..found
        })
    }

    pub(crate) async fn delete_thread(
        &self,
        file_id: &str,
        thread: &str,
    ) -> Result<(), CollabCommandError> {
        const WHAT: &str = "delete a comment thread";
        self.may_moderate(WHAT, thread)?;
        let doc = DocId(file_id.to_owned());
        self.session
            .delete_thread(&doc, thread)
            .await
            .map_err(|error| self.write_failed(WHAT, Act::Thread, &error))?;
        {
            let mut shown = guard(&self.mirror.review.shown);
            shown.pending.remove(thread);
            shown
                .deleted
                .insert(thread.to_owned(), (doc.clone(), Instant::now()));
        }
        self.told(&doc, thread);
        Ok(())
    }

    pub(crate) fn suggestion_list(
        &self,
        path: &str,
    ) -> Result<SuggestionList<OnlineSuggestion>, CollabCommandError> {
        let doc = self.doc_at(path).ok_or_else(|| CollabCommandError {
            code: "not_found",
            message: format!("{path} is not a live Overleaf document"),
        })?;
        let review = self.session.review(&doc);
        let deciding = project_role_allows(self.role_now(), ProjectAction::Resolve);
        Ok(SuggestionList {
            rev: review.as_ref().and_then(|review| review.rev),
            suggestions: review
                .as_ref()
                .map(|review| {
                    review
                        .changes
                        .iter()
                        .map(|change| suggestion_of(&doc, change))
                        .collect()
                })
                .unwrap_or_default(),
            can_accept: deciding && review.is_some_and(|review| review.can_accept),
        })
    }

    pub(crate) fn suggestion_counts(&self) -> Vec<SuggestionCount> {
        let counted: Vec<(DocId, usize)> = self
            .session
            .review_counts()
            .into_iter()
            .filter(|(_, counts)| counts.changes > 0)
            .map(|(doc, counts)| (doc, counts.changes))
            .collect();
        let docs: Vec<DocId> = counted.iter().map(|(doc, _)| doc.clone()).collect();
        let mut counts: Vec<SuggestionCount> = counted
            .into_iter()
            .zip(self.mirror.review_paths(&docs))
            .filter_map(|((_, pending), path)| {
                Some(SuggestionCount {
                    path: path?,
                    pending,
                })
            })
            .collect();
        counts.sort_by(|left, right| left.path.cmp(&right.path));
        counts
    }

    fn changes_by_id(
        &self,
        ids: &[String],
    ) -> BTreeMap<String, (DocId, DocFormat, Option<String>)> {
        let wanted: BTreeSet<&str> = ids.iter().map(String::as_str).collect();
        let mut found = BTreeMap::new();
        for (doc, counts) in self.session.review_counts() {
            if counts.changes == 0 || found.len() == wanted.len() {
                continue;
            }
            let Some(review) = self.session.review(&doc) else {
                continue;
            };
            for change in review.changes {
                if wanted.contains(change.id.as_str()) {
                    found.insert(change.id, (doc.clone(), review.format, change.user));
                }
            }
        }
        found
    }

    fn decided(&self, what: &str, docs: Vec<DocId>, missing: &[String]) {
        if !missing.is_empty() {
            log(
                self.project_id(),
                format_args!(
                    "{what}: {} of the changes were already gone: {}",
                    missing.len(),
                    missing.join(", ")
                ),
            );
        }
        let refs: Vec<&DocId> = docs.iter().collect();
        self.mirror.review.echo(&refs, &[]);
        self.mirror.tell_suggestions(&docs, true);
    }

    fn may_decide(&self, what: &str, decision: Decision) -> Result<(), CollabCommandError> {
        let action = match decision {
            Decision::Accept | Decision::Reject => ProjectAction::Resolve,
            Decision::Withdraw => ProjectAction::Suggest,
        };
        if project_role_allows(self.role_now(), action) {
            return Ok(());
        }
        Err(self.refusal(
            what,
            "suggestion_role",
            "your role in this project doesn't allow this".to_owned(),
        ))
    }

    pub(crate) async fn decide(
        &self,
        ids: &[String],
        decision: Decision,
    ) -> Result<(), CollabCommandError> {
        let what = match decision {
            Decision::Accept => "accept tracked changes",
            Decision::Reject => "reject tracked changes",
            Decision::Withdraw => "withdraw tracked changes",
        };
        self.may_decide(what, decision)?;
        let found = self.changes_by_id(ids);
        if found.is_empty() {
            return Err(self.refusal(
                what,
                "suggestion_gone",
                "none of these changes is still there".to_owned(),
            ));
        }
        if decision == Decision::Withdraw {
            if found
                .values()
                .any(|(_, _, user)| user.as_deref() != Some(self.me.as_str()))
            {
                return Err(self.refusal(
                    what,
                    "suggestion_not_yours",
                    "only the person who made a change can withdraw it".to_owned(),
                ));
            }
            let edits = project_role_allows(self.role_now(), ProjectAction::Edit);
            if !edits
                && found
                    .values()
                    .any(|(_, format, _)| *format == DocFormat::HistoryOt)
            {
                return Err(self.refusal(
                    what,
                    "review_off_server",
                    "Overleaf doesn't let a reviewer withdraw a change in this file".to_owned(),
                ));
            }
        }
        let choice = match decision {
            Decision::Accept => Choice::Accept,
            Decision::Reject | Decision::Withdraw => Choice::Reject,
        };
        let wanted: Vec<String> = found.keys().cloned().collect();
        let done = self
            .session
            .decide(&wanted, choice)
            .await
            .map_err(|error| self.write_failed(what, Act::Decide, &error))?;
        let mut missing = done.missing;
        missing.extend(ids.iter().filter(|id| !found.contains_key(*id)).cloned());
        let docs: BTreeSet<DocId> = found.into_values().map(|(doc, _, _)| doc).collect();
        self.decided(what, docs.into_iter().collect(), &missing);
        Ok(())
    }

    pub(crate) async fn decide_file(
        &self,
        path: &str,
        decision: Decision,
    ) -> Result<(), CollabCommandError> {
        let what = match decision {
            Decision::Accept => "accept every change in a file",
            _ => "reject every change in a file",
        };
        self.may_decide(what, decision)?;
        let doc = self.doc_for(what, path)?;
        let ids: Vec<String> = self
            .session
            .review(&doc)
            .map(|review| review.changes.into_iter().map(|change| change.id).collect())
            .unwrap_or_default();
        if ids.is_empty() {
            return Ok(());
        }
        let choice = match decision {
            Decision::Accept => Choice::Accept,
            _ => Choice::Reject,
        };
        let done = self
            .session
            .decide(&ids, choice)
            .await
            .map_err(|error| self.write_failed(what, Act::Decide, &error))?;
        self.decided(what, vec![doc], &done.missing);
        Ok(())
    }

    pub(crate) fn edit_mode_state(&self) -> EditModeState {
        let view = self.session.edit_mode();
        EditModeState {
            mode: if view.tracking {
                EditMode::Suggesting
            } else {
                EditMode::Editing
            },
            switchable: view.switchable,
            locked: view.locked.map(lock_of),
            everyone: Some(view.everyone),
            guests: Some(view.guests),
            manage: view.manage,
        }
    }

    pub(crate) async fn set_edit_mode(
        &self,
        mode: EditMode,
        scope: EditModeScope,
    ) -> Result<(), CollabCommandError> {
        const WHAT: &str = "switch track changes";
        let scope = match scope {
            EditModeScope::Me => TrackScope::Me,
            EditModeScope::Everyone => TrackScope::Everyone,
            EditModeScope::Guests => TrackScope::Guests,
        };
        self.session
            .set_track_changes(scope, mode == EditMode::Suggesting)
            .await
            .map_err(|error| self.write_failed(WHAT, Act::Switch, &error))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOB: &str = "0123456789abcdef01234567";
    const CAROL: &str = "fedcba9876543210fedcba98";

    fn member(id: &str, name: &str) -> OnlineMember {
        CommentMember {
            account_id: id.to_owned(),
            display_name: name.to_owned(),
            login: None,
        }
    }

    #[test]
    fn mentions_go_out_as_overleaf_ids_and_come_back_as_names() {
        let members = [member(BOB, "Bob Tester"), member("not-an-id", "Nobody")];
        let (wire, mentions) = wire_body("Thanks @Bob Tester, and @Nobody `@Bob Tester`", &members);
        assert_eq!(wire, format!("Thanks @[{BOB}], and @Nobody `@Bob Tester`"));
        assert_eq!(mentions, vec![BOB.to_owned()]);
        let names = BTreeMap::from([(BOB.to_owned(), "Bob Tester".to_owned())]);
        let content = format!("@[{BOB}] and @[{CAROL}] then @[{BOB}] but @[nothex] or @[{BOB}");
        let (shown, mentioned) = shown_body(&content, &names);
        assert_eq!(
            shown,
            format!("@Bob Tester and @[{CAROL}] then @Bob Tester but @[nothex] or @[{BOB}")
        );
        assert_eq!(mentioned, vec![BOB.to_owned(), CAROL.to_owned()]);
        let (again, _) = wire_body(&shown, &members);
        assert_eq!(again, content);
        assert_eq!(shown_body("Größe @[ ☕", &names).0, "Größe @[ ☕");
    }

    #[test]
    fn a_quote_is_cut_in_editor_units() {
        assert_eq!(quote_at("a☕b😀c", 1, 4), "☕b\u{fffd}");
        assert_eq!(quote_at("a☕b😀c", 1, 5), "☕b😀");
        assert_eq!(quote_at("short", 3, 99), "rt");
    }

    #[test]
    fn every_write_failure_has_a_code_the_app_knows() {
        let cases = [
            (ReviewWriteError::Ended, Act::Reply, "comment_not_live"),
            (ReviewWriteError::Ended, Act::Decide, "not_found"),
            (ReviewWriteError::UnknownDoc, Act::Create, "not_found"),
            (
                ReviewWriteError::Stale,
                Act::Create,
                "comment_selection_changed",
            ),
            (ReviewWriteError::Absent, Act::Reply, "comment_off_server"),
            (ReviewWriteError::Absent, Act::Decide, "review_off_server"),
            (ReviewWriteError::Absent, Act::Switch, "review_off_server"),
            (ReviewWriteError::NotAllowed, Act::Create, "comment_viewer"),
            (
                ReviewWriteError::NotAllowed,
                Act::Thread,
                "comment_not_yours",
            ),
            (ReviewWriteError::NotAllowed, Act::Decide, "suggestion_role"),
            (
                ReviewWriteError::Restricted,
                Act::Reply,
                "comment_off_project",
            ),
            (ReviewWriteError::Restricted, Act::Switch, "suggestion_role"),
            (
                ReviewWriteError::Gone,
                Act::Create,
                "comment_selection_changed",
            ),
            (ReviewWriteError::Gone, Act::Thread, "not_found"),
            (ReviewWriteError::Gone, Act::Decide, "suggestion_gone"),
            (ReviewWriteError::Invalid("x"), Act::Reply, "invalid"),
            (
                ReviewWriteError::Rest(ReviewError::TimedOut(Duration::from_secs(1))),
                Act::Reply,
                "unreachable",
            ),
            (
                ReviewWriteError::Rest(ReviewError::Rest(RestError::NotAllowed)),
                Act::Thread,
                "comment_not_yours",
            ),
            (
                ReviewWriteError::Rest(ReviewError::Rest(RestError::SignedOut)),
                Act::Decide,
                "signed_out",
            ),
            (
                ReviewWriteError::Rest(ReviewError::Rest(RestError::RateLimited(None))),
                Act::Reply,
                "rate_limited",
            ),
            (
                ReviewWriteError::Rest(ReviewError::Rest(RestError::Refused {
                    status: 500,
                    message: String::new(),
                })),
                Act::Reply,
                "server",
            ),
        ];
        for (error, act, code) in cases {
            assert_eq!(code_of(&error, act), code, "{error:?}");
        }
        for code in ["suggestion_gone", "review_off_server"] {
            let passed = CollabCommandError::from(oleafly_collab::CollabError::Api {
                status: 404,
                code: code.to_owned(),
                message: String::new(),
            });
            assert_eq!(passed.code, code);
        }
    }
}
