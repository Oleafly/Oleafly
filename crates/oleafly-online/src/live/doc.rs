#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use oleafly_ot::{diff, rebase, utf16_len, Bias, Component, OtError, TextOperation};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use super::format::{
    byte_at, pieces_of_flagged, Accepted, ChangeKind, CodecError, Decision, DocFormat, Echo, Extra,
    FormatState, RangeChange, SentComment, ShareJsRanges, MAX_CHANGES, MAX_COMMENTS,
};
use super::history_ot::{Edit, RawDoc};
use super::journal::{DocRecord, InflightRecord, SCHEMA};
use super::{AppliedUpdate, DocId, PublicId, SendMode};

pub const RESEND_AFTER: Duration = Duration::from_secs(5);
pub const MAX_UPDATE_BYTES: usize = 7 * 1024 * 1024 + 64 * 1024;
pub const LOCAL_CHANGE: &str = "local-";
const FRAME_ALLOWANCE: usize = 1024;
const REMEMBERED_REMOVALS: usize = 16;
const MAX_REPAIRS: u8 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Limit {
    Empty,
    BaseLength,
    DocLength,
    UpdateSize,
    TooOld,
    RangeCount,
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum DocError {
    #[error("updates are missing between version {expected} and {got}")]
    Gap { expected: u64, got: u64 },
    #[error(transparent)]
    Codec(#[from] CodecError),
    #[error("the change was held back: {0:?}")]
    Blocked(Limit),
    #[error("the editor sent a change that does not fit: {0}")]
    Local(OtError),
    #[error("the document is out of step with the server")]
    OutOfStep,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DocFault {
    DeleteMismatch,
    BadHash,
    TooLong,
    TooLarge,
    TooManyRanges,
    TypeMismatch,
    Unavailable,
    Unsupported(String),
    Refused(String),
}

const SERVER_FAULTS: [(&str, DocFault); 6] = [
    ("delete component", DocFault::DeleteMismatch),
    ("invalid hash", DocFault::BadHash),
    ("max doc size", DocFault::TooLong),
    ("update is too large", DocFault::TooLarge),
    (
        "too many comments or tracked changes",
        DocFault::TooManyRanges,
    ),
    ("ot type mismatch", DocFault::TypeMismatch),
];

impl DocFault {
    pub fn from_server(message: &str) -> DocFault {
        let lower = message.to_lowercase();
        SERVER_FAULTS
            .iter()
            .find(|(text, _)| lower.contains(text))
            .map_or_else(
                || DocFault::Refused(message.to_string()),
                |(_, fault)| fault.clone(),
            )
    }

    pub fn is_limit(&self) -> bool {
        matches!(
            self,
            DocFault::TooLong | DocFault::TooLarge | DocFault::TooManyRanges
        )
    }
}

impl Limit {
    pub fn fault(self) -> Option<DocFault> {
        match self {
            Limit::DocLength => Some(DocFault::TooLong),
            Limit::UpdateSize => Some(DocFault::TooLarge),
            Limit::RangeCount => Some(DocFault::TooManyRanges),
            Limit::Empty | Limit::BaseLength | Limit::TooOld => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Origin {
    Undo,
    Redo,
    Cut,
    Paste,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReviewOp {
    Anchor {
        thread: String,
        ranges: Vec<(usize, usize)>,
        #[serde(default)]
        ride: bool,
    },
    Resolve {
        thread: String,
        resolved: bool,
    },
    Uncomment {
        thread: String,
    },
    Decide {
        changes: Vec<Target>,
        decision: Decision,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Target {
    pub id: String,
    pub kind: ChangeKind,
    pub at: usize,
    pub text: String,
    pub user: Option<String>,
}

impl Target {
    pub fn of(change: &ChangeSpan) -> Target {
        Target {
            id: change.id.clone(),
            kind: change.kind,
            at: change.from,
            text: change.text.clone(),
            user: change.user.clone(),
        }
    }

    fn looks_like(&self, change: &ChangeSpan) -> bool {
        change.kind == self.kind && change.user == self.user && change.text == self.text
    }
}

fn moved_range(op: &TextOperation, (from, to): (usize, usize)) -> (usize, usize) {
    let from = op.map_position(from, Bias::After);
    (from, op.map_position(to, Bias::Before).max(from))
}

impl ReviewOp {
    fn moved(&mut self, op: &TextOperation) {
        match self {
            ReviewOp::Anchor { ranges, .. } => {
                for range in ranges.iter_mut() {
                    *range = moved_range(op, *range);
                }
            }
            ReviewOp::Decide { changes, .. } => {
                for change in changes.iter_mut() {
                    change.at = op.map_position(change.at, Bias::After);
                }
            }
            ReviewOp::Resolve { .. } | ReviewOp::Uncomment { .. } => {}
        }
    }

    fn thread(&self) -> Option<&str> {
        match self {
            ReviewOp::Anchor { thread, .. }
            | ReviewOp::Resolve { thread, .. }
            | ReviewOp::Uncomment { thread } => Some(thread),
            ReviewOp::Decide { .. } => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Unit {
    Text { op: TextOperation, undo: bool },
    Review(ReviewOp),
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Removed {
    text: String,
    comments: Vec<(String, usize, usize)>,
    cut: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommentSpan {
    pub thread: String,
    pub ranges: Vec<(usize, usize)>,
    pub quote: String,
    pub resolved: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChangeSpan {
    pub id: String,
    pub kind: ChangeKind,
    pub from: usize,
    pub to: usize,
    pub text: String,
    pub user: Option<String>,
    pub at: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DocRanges {
    pub comments: Vec<CommentSpan>,
    pub changes: Vec<ChangeSpan>,
}

enum Resend {
    Wait,
    Send,
    Nothing,
    Resync,
}

enum Built {
    Dead,
    Waits,
    Ready {
        op: TextOperation,
        extra: Extra,
        consumed: usize,
        shown: bool,
    },
}

#[derive(Clone, Debug, PartialEq)]
struct Inflight {
    op: TextOperation,
    sent_versions: Vec<u64>,
    sent_on: Vec<PublicId>,
    sent_at: Instant,
    echo: Echo,
    doubt: bool,
    decided: Option<ReviewOp>,
    landed: bool,
}

impl Inflight {
    fn reinserts(&self) -> bool {
        matches!(self.echo, Echo::ShareJs { undo: true, .. })
            && self
                .op
                .components()
                .iter()
                .any(|component| matches!(component, Component::Insert(_)))
    }

    fn kept_out(&self) -> bool {
        self.echo.accepts_by_ops() || (self.decided.is_some() && self.reinserts())
    }

    fn reinserted(&self) -> Vec<(usize, String)> {
        if let Echo::ShareJs { accepts, .. } = &self.echo {
            if !accepts.is_empty() {
                return accepts
                    .iter()
                    .filter(|accepted| accepted.kind == ChangeKind::Delete)
                    .map(|accepted| (accepted.at, accepted.text.clone()))
                    .collect();
            }
        }
        if !self.reinserts() {
            return Vec::new();
        }
        let mut found = Vec::new();
        let mut at = 0;
        for component in self.op.components() {
            match component {
                Component::Retain(count) => at += count,
                Component::Insert(text) => {
                    found.push((at, text.clone()));
                    at += utf16_len(text);
                }
                Component::Delete(_) => {}
            }
        }
        found
    }
}

struct Landing {
    base: String,
    spots: Vec<(usize, String)>,
    decided: Option<ReviewOp>,
    kept_out: bool,
    tracked_by: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Applied {
    Acknowledged,
    Remote(TextOperation),
    Ignored,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Rejoin {
    Clean(TextOperation),
    Merged(TextOperation),
    Conflict { mine: String, theirs: String },
}

#[derive(Clone, Debug, PartialEq)]
pub struct OutgoingUpdate {
    pub doc: DocId,
    pub v: u64,
    pub op: Value,
    pub dup_if_source: Vec<PublicId>,
    pub last_v: Option<u64>,
    pub tc: Option<String>,
}

impl OutgoingUpdate {
    pub fn payload(&self) -> Value {
        let mut update = Map::new();
        update.insert("doc".into(), json!(self.doc));
        update.insert("op".into(), self.op.clone());
        update.insert("v".into(), json!(self.v));
        if let Some(last_v) = self.last_v {
            update.insert("lastV".into(), json!(last_v));
        }
        if !self.dup_if_source.is_empty() {
            update.insert("dupIfSource".into(), json!(self.dup_if_source));
        }
        if let Some(tc) = &self.tc {
            update.insert("meta".into(), json!({ "tc": tc }));
        }
        Value::Object(update)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct OverleafDoc {
    id: DocId,
    version: u64,
    known: u64,
    confirmed: String,
    local: String,
    inflight: Option<Inflight>,
    outgoing: Vec<Unit>,
    format: FormatState,
    page_limit: Option<usize>,
    last_sent: Option<u64>,
    provisional: bool,
    marks: BTreeMap<u64, Vec<(usize, usize)>>,
    next_mark: u64,
    removed: Vec<Removed>,
    shown: Vec<TextOperation>,
    dropped: Vec<ReviewOp>,
    reshaped: bool,
    doubt: bool,
    repairs: u8,
}

fn identity(length: usize) -> TextOperation {
    let mut op = TextOperation::new();
    op.retain(length);
    op
}

fn slice(text: &str, from: usize, to: usize) -> Option<&str> {
    Some(&text[byte_at(text, from)?..byte_at(text, to)?])
}

fn slices(text: &str, wanted: &[(usize, usize)]) -> Vec<String> {
    let mut order: Vec<usize> = (0..wanted.len()).collect();
    order.sort_by_key(|index| wanted[*index].0);
    let mut found = vec![String::new(); wanted.len()];
    let mut characters = text.char_indices();
    let (mut unit, mut byte) = (0, 0);
    for index in order {
        let (from, to) = wanted[index];
        while unit < from {
            let Some((at, character)) = characters.next() else {
                break;
            };
            unit += character.len_utf16();
            byte = at + character.len_utf8();
        }
        if unit != from {
            continue;
        }
        let rest = &text[byte..];
        if let Some(end) = byte_at(rest, to.saturating_sub(from)) {
            found[index] = rest[..end].to_string();
        }
    }
    found
}

impl OverleafDoc {
    pub fn joined(id: DocId, version: u64, text: String, format: FormatState) -> OverleafDoc {
        OverleafDoc {
            id,
            version,
            known: version,
            confirmed: text.clone(),
            local: text,
            inflight: None,
            outgoing: Vec::new(),
            page_limit: None,
            format,
            last_sent: None,
            provisional: false,
            marks: BTreeMap::new(),
            next_mark: 0,
            removed: Vec::new(),
            shown: Vec::new(),
            dropped: Vec::new(),
            reshaped: false,
            doubt: false,
            repairs: 0,
        }
    }

    pub fn provisional(id: DocId, text: String) -> OverleafDoc {
        OverleafDoc {
            provisional: true,
            ..OverleafDoc::joined(id, 0, text, FormatState::ShareJs(Default::default()))
        }
    }

    pub fn is_provisional(&self) -> bool {
        self.provisional
    }

    pub fn resume(id: DocId, record: &DocRecord, now: Instant) -> Result<OverleafDoc, DocError> {
        let format = DocFormat::from_join_type(&record.format)?;
        let state = FormatState::restored(format, record.base_raw.as_ref())?;
        let mut doc = OverleafDoc::joined(id, record.base_version, record.base_text.clone(), state);
        let mut after = doc.confirmed.clone();
        if let Some(inflight) = &record.inflight {
            after = inflight
                .op
                .apply(&doc.confirmed)
                .map_err(|_| DocError::OutOfStep)?;
            doc.inflight = Some(Inflight {
                op: inflight.op.clone(),
                sent_versions: vec![inflight.base_version],
                sent_on: inflight.public_ids.clone(),
                sent_at: now,
                echo: Echo::restored(format, inflight)?,
                doubt: false,
                decided: inflight.decided.clone(),
                landed: false,
            });
            doc.last_sent = Some(inflight.base_version);
        }
        let pending = diff(&after, &record.local_text);
        if !pending.is_noop() {
            doc.outgoing.push(Unit::Text {
                op: pending,
                undo: false,
            });
        }
        doc.outgoing
            .extend(record.queued.iter().cloned().map(Unit::Review));
        doc.local = record.local_text.clone();
        doc.provisional = record.provisional;
        Ok(doc)
    }

    pub fn record(&self) -> Result<DocRecord, CodecError> {
        let inflight = self
            .inflight
            .as_ref()
            .map(|inflight| -> Result<InflightRecord, CodecError> {
                let mut record = InflightRecord {
                    op: inflight.op.clone(),
                    public_ids: inflight.sent_on.clone(),
                    base_version: inflight
                        .sent_versions
                        .last()
                        .copied()
                        .unwrap_or(self.version),
                    decided: inflight.decided.clone(),
                    ..InflightRecord::default()
                };
                inflight.echo.record_into(&mut record)?;
                Ok(record)
            })
            .transpose()?;
        Ok(DocRecord {
            schema: SCHEMA,
            format: self.format.format().wire_name().to_string(),
            base_text: self.confirmed.clone(),
            base_raw: self.format.snapshot()?,
            base_version: self.version,
            local_text: self.local.clone(),
            inflight,
            provisional: self.provisional,
            path: None,
            queued: self.queued_in_local_space(),
        })
    }

    fn queued_in_local_space(&self) -> Vec<ReviewOp> {
        let mut queued = Vec::new();
        for (index, unit) in self.outgoing.iter().enumerate() {
            let Unit::Review(review) = unit else {
                continue;
            };
            let mut review = review.clone();
            for later in &self.outgoing[index + 1..] {
                if let Unit::Text { op, .. } = later {
                    review.moved(op);
                }
            }
            queued.push(review);
        }
        queued
    }

    pub fn adopt_join(&mut self, version: u64, text: &str, format: FormatState) -> bool {
        let fits = version == self.version
            && text == self.confirmed
            && format.format() == self.format.format()
            && (self.inflight.is_none() || format.format() == DocFormat::ShareJs);
        if fits {
            match (&mut self.format, &format) {
                (FormatState::ShareJs(mine), FormatState::ShareJs(fresh)) => {
                    self.reshaped |= mine.adopt_all(fresh).reshaped();
                }
                _ => {
                    self.reshaped |= self.format != format;
                    self.format = format;
                }
            }
        }
        fits
    }

    pub fn adopt_ranges(&mut self, version: u64, format: &FormatState) -> bool {
        if version != self.version {
            return false;
        }
        let (FormatState::ShareJs(mine), FormatState::ShareJs(fresh)) = (&mut self.format, format)
        else {
            return true;
        };
        self.reshaped |= mine.adopt_all(fresh).reshaped();
        true
    }

    pub fn ids_known(&self) -> bool {
        match &self.format {
            FormatState::ShareJs(ranges) => ranges.all_ids_known(),
            FormatState::HistoryOt(_) => true,
        }
    }

    pub fn version(&self) -> u64 {
        self.version
    }

    pub fn format(&self) -> &FormatState {
        &self.format
    }

    pub fn limit_length(&mut self, max_length: usize) {
        self.page_limit = Some(max_length);
    }

    fn max_length(&self) -> usize {
        let limit = self.format.limits().max_length;
        match (self.format.format(), self.page_limit) {
            (DocFormat::ShareJs, Some(page)) => limit.min(page),
            _ => limit,
        }
    }

    pub fn text(&self) -> &str {
        &self.local
    }

    pub fn is_settled(&self) -> bool {
        self.inflight.is_none() && self.outgoing.is_empty()
    }

    pub fn has_unsent_text(&self) -> bool {
        self.outgoing
            .iter()
            .any(|unit| matches!(unit, Unit::Text { .. }))
            || self
                .inflight
                .as_ref()
                .is_some_and(|inflight| !inflight.echo.view_only(&inflight.op))
    }

    #[cfg(test)]
    pub fn in_flight(&self) -> bool {
        self.inflight.is_some()
    }

    #[cfg(test)]
    pub fn repairs(&self) -> u8 {
        self.repairs
    }

    #[cfg(test)]
    pub fn clashed(&self) -> bool {
        self.inflight
            .as_ref()
            .is_some_and(|inflight| inflight.echo.clashed())
    }

    pub fn take_shown(&mut self) -> Vec<TextOperation> {
        std::mem::take(&mut self.shown)
    }

    pub fn take_dropped(&mut self) -> Vec<ReviewOp> {
        std::mem::take(&mut self.dropped)
    }

    pub fn take_reshaped(&mut self) -> bool {
        std::mem::take(&mut self.reshaped)
    }

    pub fn take_doubt(&mut self) -> bool {
        std::mem::take(&mut self.doubt)
    }

    pub fn local(&mut self, op: TextOperation) -> Result<Option<TextOperation>, DocError> {
        self.local_from(op, None)
    }

    pub fn local_from(
        &mut self,
        op: TextOperation,
        origin: Option<Origin>,
    ) -> Result<Option<TextOperation>, DocError> {
        if op.base_len() != utf16_len(&self.local) {
            return Err(DocError::Local(OtError::LengthMismatch));
        }
        if op.is_noop() {
            return Ok(None);
        }
        let sanitized = self.format.sanitize(&op);
        let local = sanitized.send.apply(&self.local).map_err(DocError::Local)?;
        self.remember_removed(&sanitized.send, origin);
        self.push_text(sanitized.send.clone(), origin == Some(Origin::Undo))?;
        self.local = local;
        self.move_marks(&sanitized.send);
        if matches!(origin, Some(Origin::Paste | Origin::Undo)) {
            self.restore_removed(&sanitized.send, origin == Some(Origin::Paste));
        }
        Ok(sanitized.correction)
    }

    fn push_text(&mut self, op: TextOperation, undo: bool) -> Result<(), DocError> {
        match self.outgoing.last_mut() {
            Some(Unit::Text {
                op: last,
                undo: flagged,
            }) if *flagged == undo => {
                *last = last.compose(&op).map_err(|_| DocError::OutOfStep)?;
                if last.is_noop() {
                    self.outgoing.pop();
                }
            }
            _ => self.outgoing.push(Unit::Text { op, undo }),
        }
        Ok(())
    }

    pub fn queue_review(&mut self, review: ReviewOp) {
        self.outgoing.push(Unit::Review(review));
    }

    pub fn mark(&mut self, ranges: Vec<(usize, usize)>) -> u64 {
        self.next_mark += 1;
        self.marks.insert(self.next_mark, ranges);
        self.next_mark
    }

    pub fn unmark(&mut self, key: u64) -> Option<Vec<(usize, usize)>> {
        self.marks.remove(&key)
    }

    fn move_marks(&mut self, op: &TextOperation) {
        for ranges in self.marks.values_mut() {
            for range in ranges.iter_mut() {
                *range = moved_range(op, *range);
            }
        }
    }

    fn to_local_chain(&self) -> Vec<&TextOperation> {
        self.inflight
            .iter()
            .map(|inflight| &inflight.op)
            .chain(self.outgoing.iter().filter_map(|unit| match unit {
                Unit::Text { op, .. } => Some(op),
                Unit::Review(_) => None,
            }))
            .collect()
    }

    fn confirmed_comments(&self) -> Vec<CommentSpan> {
        let span = |thread: &str, ranges, resolved| CommentSpan {
            thread: thread.to_string(),
            ranges,
            quote: String::new(),
            resolved,
        };
        match &self.format {
            FormatState::ShareJs(ranges) => ranges
                .comments()
                .iter()
                .map(|comment| {
                    span(
                        &comment.thread,
                        vec![(comment.at, comment.at + comment.text.len())],
                        None,
                    )
                })
                .collect(),
            FormatState::HistoryOt(raw) => {
                let review = raw.review();
                let mut points = review.comments.into_iter();
                raw.comments()
                    .iter()
                    .map(|comment| {
                        let ranges = points
                            .next()
                            .map(|visible| visible.ranges)
                            .unwrap_or_default();
                        let ranges = if ranges.is_empty() {
                            comment
                                .ranges
                                .first()
                                .map(|(pos, _)| {
                                    let at = raw.to_visible(*pos);
                                    vec![(at, at)]
                                })
                                .unwrap_or_default()
                        } else {
                            ranges
                        };
                        span(&comment.id, ranges, Some(comment.resolved))
                    })
                    .collect()
            }
        }
    }

    fn local_comments(&self) -> Vec<CommentSpan> {
        let chain = self.to_local_chain();
        let mut comments = self.confirmed_comments();
        for comment in &mut comments {
            for range in comment.ranges.iter_mut() {
                *range = chain
                    .iter()
                    .fold(*range, |range, op| moved_range(op, range));
            }
        }
        comments
    }

    fn remember_removed(&mut self, op: &TextOperation, origin: Option<Origin>) {
        let deletes: Vec<(usize, usize)> = {
            let mut at = 0;
            let mut deletes = Vec::new();
            for component in op.components() {
                match component {
                    Component::Retain(count) => at += count,
                    Component::Insert(_) => {}
                    Component::Delete(count) => {
                        deletes.push((at, at + count));
                        at += count;
                    }
                }
            }
            deletes
        };
        if deletes.is_empty() || self.format.counts().0 == 0 {
            return;
        }
        let cut = origin == Some(Origin::Cut);
        if cut {
            self.removed.retain(|removed| !removed.cut);
        }
        let comments = self.local_comments();
        for (start, end) in deletes {
            let inside: Vec<(String, usize, usize)> = comments
                .iter()
                .flat_map(|comment| {
                    comment
                        .ranges
                        .iter()
                        .filter(|(from, to)| from < to && start <= *from && *to <= end)
                        .map(move |(from, to)| (comment.thread.clone(), from - start, to - from))
                })
                .collect();
            if inside.is_empty() {
                continue;
            }
            let Some(text) = slice(&self.local, start, end) else {
                continue;
            };
            self.removed.push(Removed {
                text: text.to_string(),
                comments: inside,
                cut,
            });
        }
        if self.removed.len() > REMEMBERED_REMOVALS {
            let extra = self.removed.len() - REMEMBERED_REMOVALS;
            self.removed.drain(..extra);
        }
    }

    fn restore_removed(&mut self, op: &TextOperation, paste: bool) {
        if self.removed.is_empty() {
            return;
        }
        let comments = self.local_comments();
        let mut at = 0;
        let mut anchors: BTreeMap<String, Vec<(usize, usize)>> = BTreeMap::new();
        for component in op.components() {
            match component {
                Component::Retain(count) => at += count,
                Component::Delete(_) => {}
                Component::Insert(text) => {
                    let found = self
                        .removed
                        .iter()
                        .rposition(|removed| removed.text == *text && (!paste || removed.cut));
                    if let Some(found) = found {
                        let removed = if paste {
                            self.removed[found].clone()
                        } else {
                            self.removed.remove(found)
                        };
                        for (thread, offset, length) in removed.comments {
                            let current = comments.iter().find(|comment| comment.thread == thread);
                            let detached = current.is_some_and(|comment| {
                                comment.ranges.iter().all(|(from, to)| from == to)
                            });
                            if current.is_none() || (!paste && !detached) {
                                continue;
                            }
                            let from = at + offset;
                            anchors
                                .entry(thread)
                                .or_default()
                                .push((from, from + length));
                        }
                    }
                    at += utf16_len(text);
                }
            }
        }
        if paste {
            self.removed.retain(|removed| !removed.cut);
        }
        for (thread, ranges) in anchors {
            let ranges = match self.format.format() {
                DocFormat::ShareJs => ranges.into_iter().take(1).collect(),
                DocFormat::HistoryOt => ranges,
            };
            self.outgoing.push(Unit::Review(ReviewOp::Anchor {
                thread,
                ranges,
                ride: true,
            }));
        }
    }

    pub fn review(&self) -> DocRanges {
        let chain = self.to_local_chain();
        let to_local =
            |range: (usize, usize)| chain.iter().fold(range, |range, op| moved_range(op, range));
        let mut comments = self.confirmed_comments();
        for comment in &mut comments {
            for range in comment.ranges.iter_mut() {
                *range = to_local(*range);
            }
        }
        let mut changes = self.review_in_confirmed();
        for change in &mut changes {
            (change.from, change.to) = to_local((change.from, change.to));
        }
        let mut wanted: Vec<(usize, usize)> = comments
            .iter()
            .map(|comment| comment.ranges.first().copied().unwrap_or_default())
            .collect();
        let inserts: Vec<usize> = changes
            .iter()
            .enumerate()
            .filter(|(_, change)| change.kind == ChangeKind::Insert)
            .map(|(index, _)| index)
            .collect();
        wanted.extend(
            inserts
                .iter()
                .map(|index| (changes[*index].from, changes[*index].to)),
        );
        let mut quotes = slices(&self.local, &wanted).into_iter();
        for comment in &mut comments {
            comment.quote = quotes.next().unwrap_or_default();
        }
        for index in inserts {
            if let Some(text) = quotes.next() {
                changes[index].text = text;
            }
        }
        DocRanges { comments, changes }
    }

    pub fn counts(&self) -> (usize, usize) {
        self.format.counts()
    }

    pub fn threads(&self) -> Vec<&str> {
        match &self.format {
            FormatState::ShareJs(ranges) => ranges
                .comments()
                .iter()
                .map(|comment| comment.thread.as_str())
                .collect(),
            FormatState::HistoryOt(raw) => raw
                .comments()
                .iter()
                .map(|comment| comment.id.as_str())
                .collect(),
        }
    }

    pub fn comment_resolved(&self, thread: &str) -> Option<bool> {
        match &self.format {
            FormatState::ShareJs(_) => None,
            FormatState::HistoryOt(raw) => raw.comment(thread).map(|comment| comment.resolved),
        }
    }

    fn change_key(&self, id: &str) -> Option<u64> {
        let FormatState::ShareJs(ranges) = &self.format else {
            return None;
        };
        match id.strip_prefix(LOCAL_CHANGE) {
            Some(key) => key
                .parse()
                .ok()
                .filter(|key| ranges.change_by_key(*key).is_some()),
            None => ranges.change(id).map(|change| change.key()),
        }
    }

    pub fn change_ids(&self) -> Vec<String> {
        match &self.format {
            FormatState::ShareJs(ranges) => ranges
                .changes()
                .iter()
                .flat_map(|change| {
                    let local = format!("{LOCAL_CHANGE}{}", change.key());
                    change.id().map(str::to_string).into_iter().chain([local])
                })
                .collect(),
            FormatState::HistoryOt(raw) => raw
                .review()
                .changes
                .into_iter()
                .map(|change| change.id)
                .collect(),
        }
    }

    pub fn change_author(&self, id: &str) -> Option<Option<String>> {
        match &self.format {
            FormatState::ShareJs(ranges) => {
                let key = self.change_key(id)?;
                ranges.change_by_key(key).map(|change| change.user.clone())
            }
            FormatState::HistoryOt(raw) => raw
                .review()
                .changes
                .into_iter()
                .find(|change| change.id == id)
                .map(|change| change.user),
        }
    }

    pub fn change_id_state(&self, id: &str) -> Option<Option<String>> {
        match &self.format {
            FormatState::ShareJs(ranges) => {
                let key = self.change_key(id)?;
                ranges
                    .change_by_key(key)
                    .map(|change| change.id().map(str::to_string))
            }
            FormatState::HistoryOt(_) => self.change_author(id).map(|_| Some(id.to_string())),
        }
    }

    pub fn server_change_id(&self, id: &str) -> Option<String> {
        let FormatState::ShareJs(ranges) = &self.format else {
            return Some(id.to_string());
        };
        let key = self.change_key(id)?;
        ranges
            .change_by_key(key)
            .and_then(|change| change.id().map(str::to_string))
    }

    pub fn accept_locally(&mut self, ids: &[String]) -> usize {
        let FormatState::ShareJs(ranges) = &mut self.format else {
            return 0;
        };
        let removed = ranges.remove_changes(ids);
        self.reshaped |= removed > 0;
        removed
    }

    pub fn drop_comment(&mut self, thread: &str) -> bool {
        let FormatState::ShareJs(ranges) = &mut self.format else {
            return false;
        };
        let removed = ranges.remove_comment(thread);
        self.reshaped |= removed;
        removed
    }

    pub fn next_update(
        &mut self,
        on: &PublicId,
        mode: &SendMode,
        now: Instant,
    ) -> Result<Option<OutgoingUpdate>, DocError> {
        if self.provisional {
            return Ok(None);
        }
        match self.resend(on, mode, now) {
            Resend::Wait => return Ok(None),
            Resend::Resync => return Err(DocError::OutOfStep),
            Resend::Send => {
                let Some(inflight) = &self.inflight else {
                    return Ok(None);
                };
                let (op, extra) = (inflight.op.clone(), inflight.echo.extra());
                return self.send(op, extra, on, mode, now).map(Some);
            }
            Resend::Nothing => {}
        }
        loop {
            self.ready_decision(mode);
            let built = match self.build(mode) {
                Ok(built) => built,
                Err(_) if self.head_is_review() => Built::Dead,
                Err(error) => return Err(error),
            };
            match built {
                Built::Waits => return Ok(None),
                Built::Dead => self.drop_head(),
                Built::Ready {
                    op,
                    extra,
                    consumed,
                    shown,
                } => {
                    let review = self.head_is_review();
                    let decided = match self.outgoing.first() {
                        Some(Unit::Review(decide @ ReviewOp::Decide { .. })) => {
                            Some(decide.clone())
                        }
                        _ => None,
                    };
                    match self.send(op.clone(), extra, on, mode, now) {
                        Ok(update) => {
                            if let Some(inflight) = self.inflight.as_mut() {
                                inflight.decided = decided;
                            }
                            self.outgoing.drain(..consumed);
                            if shown {
                                let step = self.pass_over(op)?;
                                self.local =
                                    step.apply(&self.local).map_err(|_| DocError::OutOfStep)?;
                                self.move_marks(&step);
                                self.shown.push(step);
                            }
                            return Ok(Some(update));
                        }
                        Err(DocError::Blocked(_)) if review => self.drop_head(),
                        Err(error) => return Err(error),
                    }
                }
            }
        }
    }

    fn head_is_review(&self) -> bool {
        matches!(self.outgoing.first(), Some(Unit::Review(_)))
    }

    fn drop_head(&mut self) {
        if self.outgoing.is_empty() {
            return;
        }
        if let Unit::Review(review) = self.outgoing.remove(0) {
            self.dropped.push(review);
        }
    }

    fn ready_decision(&mut self, mode: &SendMode) {
        let Some(Unit::Review(ReviewOp::Decide { changes, decision })) = self.outgoing.first()
        else {
            return;
        };
        if *mode == SendMode::Hold {
            return;
        }
        let decision = *decision;
        let (found, missing) = self.resolve_targets(changes);
        if found.is_empty() {
            return;
        }
        let apart = decision == Decision::Reject && !self.rejects_together(&found);
        let (first, second): (Vec<Target>, Vec<Target>) = found
            .into_iter()
            .map(|(target, _)| target)
            .partition(|target| !apart || target.kind == ChangeKind::Delete);
        let parts = [first, second]
            .into_iter()
            .filter(|changes| !changes.is_empty())
            .map(|changes| Unit::Review(ReviewOp::Decide { changes, decision }));
        self.outgoing.splice(0..1, parts);
        if !missing.is_empty() {
            self.dropped.push(ReviewOp::Decide {
                changes: missing,
                decision,
            });
        }
    }

    fn rejects_together(&self, found: &[(Target, ChangeSpan)]) -> bool {
        let FormatState::ShareJs(ranges) = &self.format else {
            return true;
        };
        let keys: Vec<u64> = found
            .iter()
            .filter_map(|(_, change)| self.change_key(&change.id))
            .collect();
        ranges
            .reject_op(&keys, utf16_len(&self.confirmed))
            .and_then(|op| pieces_of_flagged(&self.confirmed, &op, true).ok())
            .is_none_or(|pieces| ranges.rejects_cleanly(&keys, &pieces))
    }

    fn build(&self, mode: &SendMode) -> Result<Built, DocError> {
        let Some(head) = self.outgoing.first() else {
            return Ok(Built::Waits);
        };
        let hold = *mode == SendMode::Hold;
        match head {
            Unit::Text { op, undo } => {
                if hold {
                    return Ok(Built::Waits);
                }
                self.build_text(op, *undo, mode)
            }
            Unit::Review(ReviewOp::Anchor { thread, ranges, .. }) => {
                self.build_anchor(thread, ranges)
            }
            Unit::Review(_) if hold => Ok(Built::Waits),
            Unit::Review(ReviewOp::Resolve { thread, resolved }) => {
                self.build_comment_edit(mode, thread, || Edit::SetCommentState {
                    id: thread.clone(),
                    resolved: *resolved,
                })
            }
            Unit::Review(ReviewOp::Uncomment { thread }) => {
                self.build_comment_edit(mode, thread, || Edit::DeleteComment(thread.clone()))
            }
            Unit::Review(ReviewOp::Decide { changes, decision }) => {
                self.build_decision(changes, *decision, mode)
            }
        }
    }

    fn build_text(
        &self,
        op: &TextOperation,
        undo: bool,
        mode: &SendMode,
    ) -> Result<Built, DocError> {
        let mut extra = Extra {
            undo: undo && self.format.format() == DocFormat::ShareJs,
            unhide: undo && mode.may_edit() && self.format.format() == DocFormat::HistoryOt,
            ..Extra::default()
        };
        let mut consumed = 1;
        let Some(Unit::Review(ReviewOp::Anchor {
            thread,
            ranges,
            ride: true,
        })) = self.outgoing.get(1)
        else {
            return Ok(Built::Ready {
                op: op.clone(),
                extra,
                consumed,
                shown: false,
            });
        };
        match &self.format {
            FormatState::ShareJs(_) => {
                if let Some((from, to)) = ranges.first().copied().filter(|(from, to)| from < to) {
                    extra.comments = vec![SentComment {
                        thread: thread.clone(),
                        from,
                        to,
                    }];
                    consumed = 2;
                }
            }
            FormatState::HistoryOt(raw) if mode.may_edit() => {
                let tracking = mode.tracking().map(|tracking| {
                    json!({ "type": "insert", "userId": tracking.user_id, "ts": tracking.ts })
                });
                let unhide = extra.unhide.then(|| {
                    mode.tracking()
                        .map_or("", |tracking| tracking.user_id.as_str())
                });
                let sent = raw.encode_with(op, tracking.as_ref(), unhide)?;
                let mut after: RawDoc = raw.clone();
                after.apply(&sent)?;
                let resolved = raw.comment(thread).is_some_and(|comment| comment.resolved);
                if let Some(edit) = after.comment_edit(thread, ranges, resolved) {
                    extra.edits = vec![edit];
                    extra.fixed = Some(sent);
                    consumed = 2;
                }
            }
            FormatState::HistoryOt(_) => {}
        }
        Ok(Built::Ready {
            op: op.clone(),
            extra,
            consumed,
            shown: false,
        })
    }

    fn build_anchor(&self, thread: &str, ranges: &[(usize, usize)]) -> Result<Built, DocError> {
        let length = utf16_len(&self.confirmed);
        let mut extra = Extra::default();
        match &self.format {
            FormatState::ShareJs(_) => {
                let Some((from, to)) = ranges
                    .first()
                    .copied()
                    .filter(|(from, to)| from < to && *to <= length)
                    .filter(|(from, to)| slice(&self.confirmed, *from, *to).is_some())
                else {
                    return Ok(Built::Dead);
                };
                extra.comments = vec![SentComment {
                    thread: thread.to_string(),
                    from,
                    to,
                }];
            }
            FormatState::HistoryOt(raw) => {
                let resolved = raw.comment(thread).is_some_and(|comment| comment.resolved);
                let Some(edit) = raw.comment_edit(thread, ranges, resolved) else {
                    return Ok(Built::Dead);
                };
                extra.edits = vec![edit];
            }
        }
        Ok(Built::Ready {
            op: identity(length),
            extra,
            consumed: 1,
            shown: false,
        })
    }

    fn build_comment_edit(
        &self,
        mode: &SendMode,
        thread: &str,
        edit: impl FnOnce() -> Edit,
    ) -> Result<Built, DocError> {
        let FormatState::HistoryOt(raw) = &self.format else {
            return Ok(Built::Dead);
        };
        if !mode.may_edit() || raw.comment(thread).is_none() {
            return Ok(Built::Dead);
        }
        Ok(Built::Ready {
            op: identity(utf16_len(&self.confirmed)),
            extra: Extra {
                edits: vec![edit()],
                ..Extra::default()
            },
            consumed: 1,
            shown: false,
        })
    }

    fn resolve_targets(&self, targets: &[Target]) -> (Vec<(Target, ChangeSpan)>, Vec<Target>) {
        let changes: Vec<ChangeSpan> = self.review_in_confirmed();
        let by_id = self.format.format() == DocFormat::ShareJs;
        let mut taken: Vec<bool> = vec![false; changes.len()];
        let (mut found, mut missing) = (Vec::new(), Vec::new());
        for target in targets {
            let named = !target.id.starts_with(LOCAL_CHANGE);
            let index = changes
                .iter()
                .position(|change| {
                    by_id && change.id == target.id && (named || target.looks_like(change))
                })
                .or_else(|| {
                    changes.iter().enumerate().position(|(index, change)| {
                        !taken[index] && change.from == target.at && target.looks_like(change)
                    })
                });
            match index {
                Some(index) if taken[index] => {}
                Some(index) => {
                    taken[index] = true;
                    found.push((target.clone(), changes[index].clone()));
                }
                None => missing.push(target.clone()),
            }
        }
        (found, missing)
    }

    fn review_in_confirmed(&self) -> Vec<ChangeSpan> {
        match &self.format {
            FormatState::ShareJs(ranges) => ranges
                .changes()
                .iter()
                .map(|change| ChangeSpan {
                    id: change
                        .id()
                        .map_or_else(|| format!("{LOCAL_CHANGE}{}", change.key()), str::to_string),
                    kind: change.kind,
                    from: change.at,
                    to: match change.kind {
                        ChangeKind::Insert => change.at + change.text.len(),
                        ChangeKind::Delete => change.at,
                    },
                    text: String::from_utf16_lossy(&change.text),
                    user: change.user.clone(),
                    at: change.ts,
                })
                .collect(),
            FormatState::HistoryOt(raw) => raw
                .review()
                .changes
                .into_iter()
                .map(|change| ChangeSpan {
                    id: change.id,
                    kind: change.kind,
                    from: change.from,
                    to: change.to,
                    text: change.text,
                    user: change.user,
                    at: change.ts,
                })
                .collect(),
        }
    }

    fn build_decision(
        &self,
        targets: &[Target],
        decision: Decision,
        mode: &SendMode,
    ) -> Result<Built, DocError> {
        let length = utf16_len(&self.confirmed);
        let (found, _) = self.resolve_targets(targets);
        let chosen: Vec<ChangeSpan> = found.into_iter().map(|(_, change)| change).collect();
        let ids: Vec<String> = chosen.iter().map(|change| change.id.clone()).collect();
        match &self.format {
            FormatState::ShareJs(ranges) if decision == Decision::Accept => {
                self.build_accept(ranges, &chosen, mode, length)
            }
            FormatState::ShareJs(ranges) => {
                let reviewer = match mode {
                    SendMode::Review(tracking) => Some(tracking.user_id.as_str()),
                    _ => None,
                };
                let keys: Vec<u64> = chosen
                    .iter()
                    .filter(|change| reviewer.is_none_or(|me| change.user.as_deref() == Some(me)))
                    .filter_map(|change| self.change_key(&change.id))
                    .collect();
                let Some(op) = ranges.reject_op(&keys, length) else {
                    return Ok(Built::Dead);
                };
                Ok(Built::Ready {
                    op,
                    extra: Extra {
                        undo: true,
                        ..Extra::default()
                    },
                    consumed: 1,
                    shown: true,
                })
            }
            FormatState::HistoryOt(raw) => {
                if !mode.may_edit() {
                    return Ok(Built::Dead);
                }
                let Some(sent) = raw.decision_op(&ids, decision) else {
                    return Ok(Built::Dead);
                };
                let op = raw.project(&sent)?;
                Ok(Built::Ready {
                    op,
                    extra: Extra {
                        fixed: Some(sent),
                        ..Extra::default()
                    },
                    consumed: 1,
                    shown: true,
                })
            }
        }
    }

    fn build_accept(
        &self,
        ranges: &ShareJsRanges,
        chosen: &[ChangeSpan],
        mode: &SendMode,
        length: usize,
    ) -> Result<Built, DocError> {
        if !mode.may_edit() {
            return Ok(Built::Dead);
        }
        let fits = |change: &ChangeSpan| match change.kind {
            ChangeKind::Insert => {
                slice(&self.confirmed, change.from, change.to) == Some(&change.text)
            }
            ChangeKind::Delete => {
                !change.text.is_empty() && byte_at(&self.confirmed, change.from).is_some()
            }
        };
        let accepts: Vec<Accepted> = chosen
            .iter()
            .filter(|change| fits(change))
            .map(|change| Accepted {
                kind: change.kind,
                at: change.from,
                text: change.text.clone(),
            })
            .collect();
        if accepts.is_empty() {
            return Ok(Built::Dead);
        }
        let comments = ranges
            .comments()
            .iter()
            .filter(|comment| !comment.text.is_empty())
            .map(|comment| SentComment {
                thread: comment.thread.clone(),
                from: comment.at,
                to: comment.at + comment.text.len(),
            })
            .filter(|comment| {
                chosen.iter().any(|change| {
                    change.kind == ChangeKind::Insert
                        && comment.from.max(change.from) < comment.to.min(change.to)
                })
            })
            .collect();
        Ok(Built::Ready {
            op: identity(length),
            extra: Extra {
                accepts,
                comments,
                ..Extra::default()
            },
            consumed: 1,
            shown: false,
        })
    }

    pub fn targets(&self, ids: &[String]) -> Option<Vec<Target>> {
        let changes = self.review().changes;
        ids.iter()
            .map(|id| {
                changes
                    .iter()
                    .find(|change| change.id == *id)
                    .map(Target::of)
            })
            .collect()
    }

    fn pass_over(&mut self, mut step: TextOperation) -> Result<TextOperation, DocError> {
        for unit in &mut self.outgoing {
            match unit {
                Unit::Text { op, .. } => {
                    let (ours, theirs) =
                        TextOperation::transform(op, &step).map_err(|_| DocError::OutOfStep)?;
                    *op = ours;
                    step = theirs;
                }
                Unit::Review(review) => review.moved(&step),
            }
        }
        self.outgoing
            .retain(|unit| !matches!(unit, Unit::Text { op, .. } if op.is_noop()));
        Ok(step)
    }

    fn resend(&mut self, on: &PublicId, mode: &SendMode, now: Instant) -> Resend {
        let Some(inflight) = &self.inflight else {
            return Resend::Nothing;
        };
        let this_connection = inflight.sent_on.contains(on);
        if this_connection && now.saturating_duration_since(inflight.sent_at) < RESEND_AFTER {
            return Resend::Wait;
        }
        let repeatable = match (inflight.echo.clashed(), this_connection) {
            (false, true) => true,
            (true, false) => false,
            (true, true) | (false, false) => !inflight.echo.accepts_by_ops(),
        };
        if !repeatable {
            return Resend::Resync;
        }
        if inflight.op.is_noop() && !inflight.echo.carries_edits() {
            if this_connection {
                return Resend::Wait;
            }
            self.inflight = None;
            return Resend::Nothing;
        }
        if *mode == SendMode::Hold && !inflight.echo.view_only(&inflight.op) {
            return Resend::Wait;
        }
        let tracked_by = mode.tracking().map(|tracking| tracking.user_id.as_str());
        let mode_changed = inflight.echo.tracked_by() != tracked_by;
        if this_connection && mode_changed && !self.format.reencodes_on_one_connection() {
            return Resend::Wait;
        }
        Resend::Send
    }

    fn send(
        &mut self,
        op: TextOperation,
        extra: Extra,
        on: &PublicId,
        mode: &SendMode,
        now: Instant,
    ) -> Result<OutgoingUpdate, DocError> {
        let tracking = mode.tracking();
        let limits = self.format.limits();
        if op.base_len() != utf16_len(&self.confirmed) {
            return Err(DocError::Blocked(Limit::BaseLength));
        }
        if self.known.saturating_sub(self.version) > limits.replay_window {
            return Err(DocError::Blocked(Limit::TooOld));
        }
        let previous = self.inflight.as_ref().map(|inflight| &inflight.echo);
        let encoded = self
            .format
            .encode(&self.confirmed, &op, tracking, previous, &extra)?;
        if encoded.op.as_array().is_none_or(Vec::is_empty) {
            return Err(DocError::Blocked(Limit::Empty));
        }
        if self.format.length_after(&op, &encoded.echo) > self.max_length() {
            return Err(DocError::Blocked(Limit::DocLength));
        }
        if let Some((comments, changes)) =
            self.format
                .range_counts_after(&self.confirmed, &op, &encoded.echo)?
        {
            if comments > MAX_COMMENTS || changes > MAX_CHANGES {
                return Err(DocError::Blocked(Limit::RangeCount));
            }
        }
        let dup_if_source = self
            .inflight
            .as_ref()
            .map(|inflight| inflight.sent_on.clone())
            .unwrap_or_default();
        let update = OutgoingUpdate {
            doc: self.id.clone(),
            v: self.version,
            op: encoded.op,
            dup_if_source,
            last_v: self.last_sent,
            tc: encoded.tc,
        };
        let size = serde_json::to_vec(&update.payload()).map_or(usize::MAX, |bytes| bytes.len());
        if size.saturating_add(FRAME_ALLOWANCE) > MAX_UPDATE_BYTES {
            return Err(DocError::Blocked(Limit::UpdateSize));
        }
        self.last_sent = Some(self.version);
        match &mut self.inflight {
            Some(inflight) => {
                if inflight.sent_on.contains(on) {
                    inflight.doubt |= inflight.echo.author() != encoded.echo.author();
                } else {
                    inflight.sent_on.push(on.clone());
                }
                inflight.sent_versions.push(self.version);
                inflight.sent_at = now;
                inflight.echo = encoded.echo;
            }
            None => {
                self.inflight = Some(Inflight {
                    op,
                    sent_versions: vec![self.version],
                    sent_on: vec![on.clone()],
                    sent_at: now,
                    echo: encoded.echo,
                    doubt: false,
                    decided: None,
                    landed: false,
                });
            }
        }
        Ok(update)
    }

    pub fn applied(
        &mut self,
        update: &AppliedUpdate,
        own: &[PublicId],
    ) -> Result<Applied, DocError> {
        if update.doc != self.id {
            return Ok(Applied::Ignored);
        }
        let ours = update.source.as_ref().is_some_and(|source| {
            own.contains(source)
                || self
                    .inflight
                    .as_ref()
                    .is_some_and(|inflight| inflight.sent_on.contains(source))
        });
        let counted = self.format.format() == DocFormat::HistoryOt;
        if !counted {
            if update.v < self.version {
                return Ok(Applied::Ignored);
            }
            if update.v > self.version {
                self.known = self.known.max(update.v.saturating_add(1));
                return Err(DocError::Gap {
                    expected: self.version,
                    got: update.v,
                });
            }
        }
        if update.op.is_none() {
            let matches = self
                .inflight
                .as_ref()
                .is_some_and(|inflight| !counted || inflight.sent_versions.contains(&update.v));
            if !matches {
                return Ok(Applied::Ignored);
            }
            return self.acknowledge();
        }
        if ours && self.inflight.is_some() {
            return self.acknowledge();
        }
        self.remote(update)
    }

    fn fitted(&mut self, inflight: &Inflight) -> Option<(RangeChange, String)> {
        if inflight.echo.clashed() {
            return None;
        }
        let confirmed = inflight.op.apply(&self.confirmed).ok()?;
        let change = self
            .format
            .acknowledge_ranges(&self.confirmed, &inflight.op, &inflight.echo)
            .ok()?;
        Some((change, confirmed))
    }

    fn acknowledge(&mut self) -> Result<Applied, DocError> {
        let Some(mut inflight) = self.inflight.take() else {
            return Ok(Applied::Ignored);
        };
        let Some((change, confirmed)) = self.fitted(&inflight) else {
            inflight.landed = true;
            self.inflight = Some(inflight);
            return Err(DocError::OutOfStep);
        };
        self.repairs = 0;
        self.reshaped |= change.reshaped();
        self.doubt |= inflight.doubt;
        self.confirmed = confirmed;
        self.version = self.version.saturating_add(1);
        self.known = self.known.max(self.version);
        Ok(Applied::Acknowledged)
    }

    fn remote(&mut self, update: &AppliedUpdate) -> Result<Applied, DocError> {
        let inflight = self
            .inflight
            .as_mut()
            .map(|inflight| (&mut inflight.op, &mut inflight.echo));
        let (steps, change) = self
            .format
            .decode_ranges(&self.confirmed, update, inflight)?;
        self.reshaped |= change.reshaped();
        let mut editor = identity(utf16_len(&self.local));
        for step in steps {
            self.confirmed = step
                .confirmed
                .apply(&self.confirmed)
                .map_err(|_| DocError::OutOfStep)?;
            let step = self.pass_over(step.past_inflight)?;
            self.local = step.apply(&self.local).map_err(|_| DocError::OutOfStep)?;
            self.move_marks(&step);
            editor = editor.compose(&step).map_err(|_| DocError::OutOfStep)?;
        }
        self.version = self.version.saturating_add(1);
        self.known = self.known.max(self.version);
        if editor.is_noop() {
            return Ok(Applied::Ignored);
        }
        Ok(Applied::Remote(editor))
    }

    pub fn catch_up(
        &mut self,
        updates: &[AppliedUpdate],
        own: &[PublicId],
    ) -> Result<Vec<TextOperation>, DocError> {
        let mut remote = Vec::new();
        for update in updates {
            match self.applied(update, own) {
                Ok(Applied::Remote(op)) => remote.push(op),
                Ok(_) => {}
                Err(DocError::OutOfStep) if self.needs_rejoin() => break,
                Err(error) => return Err(error),
            }
        }
        Ok(remote)
    }

    pub fn needs_rejoin(&self) -> bool {
        self.inflight
            .as_ref()
            .is_some_and(|inflight| inflight.landed)
    }

    fn unsent_comments(&self) -> Vec<ReviewOp> {
        let Some(inflight) = self
            .inflight
            .as_ref()
            .filter(|inflight| inflight.op.is_noop())
        else {
            return Vec::new();
        };
        match (&inflight.echo, &self.format) {
            (Echo::ShareJs { comments, .. }, _) => comments
                .iter()
                .map(|comment| ReviewOp::Anchor {
                    thread: comment.thread.clone(),
                    ranges: vec![(comment.from, comment.to)],
                    ride: false,
                })
                .collect(),
            (Echo::HistoryOt { edits, .. }, FormatState::HistoryOt(raw)) => edits
                .iter()
                .filter_map(|edit| match edit {
                    Edit::AddComment(comment) => Some(ReviewOp::Anchor {
                        thread: comment.id.clone(),
                        ranges: comment
                            .ranges
                            .iter()
                            .map(|(pos, length)| {
                                (raw.to_visible(*pos), raw.to_visible(pos + length))
                            })
                            .collect(),
                        ride: false,
                    }),
                    _ => None,
                })
                .collect(),
            (Echo::HistoryOt { .. }, FormatState::ShareJs(_)) => Vec::new(),
        }
    }

    pub fn rejoin_fresh(&mut self, version: u64, text: String, format: FormatState) -> Rejoin {
        let landing = self.landing(&text);
        let rejoin = self.rejoin_onto(version, text, format, landing.base.clone());
        self.after_landing(landing, matches!(rejoin, Rejoin::Conflict { .. }));
        rejoin
    }

    fn landing(&self, text: &str) -> Landing {
        let inflight = self.inflight.as_ref();
        let applied = inflight.and_then(|inflight| inflight.op.apply(&self.confirmed).ok());
        let landed =
            inflight.is_some_and(|inflight| inflight.landed) || applied.as_deref() == Some(text);
        let kept_out = inflight.is_some_and(Inflight::kept_out);
        let base = match applied {
            Some(applied) if landed || kept_out => applied,
            _ => self.confirmed.clone(),
        };
        Landing {
            base,
            spots: inflight
                .filter(|_| landed)
                .map(Inflight::reinserted)
                .unwrap_or_default(),
            decided: inflight.and_then(|inflight| inflight.decided.clone()),
            kept_out,
            tracked_by: inflight
                .and_then(|inflight| inflight.echo.tracked_by())
                .map(str::to_string),
        }
    }

    fn after_landing(&mut self, landing: Landing, conflict: bool) {
        let leftovers = self.leftovers(&landing);
        if !leftovers.is_empty() {
            let repair = ReviewOp::Decide {
                changes: leftovers,
                decision: Decision::Accept,
            };
            if conflict || self.repairs >= MAX_REPAIRS {
                self.dropped.push(repair);
            } else {
                self.repairs += 1;
                self.outgoing.insert(0, Unit::Review(repair));
            }
            return;
        }
        let Some(ReviewOp::Decide { changes, decision }) =
            landing.decided.filter(|_| landing.kept_out)
        else {
            return;
        };
        let left = self.review_in_confirmed();
        let remaining: Vec<Target> = changes
            .iter()
            .filter_map(|target| {
                left.iter()
                    .find(|change| change.id == target.id)
                    .or_else(|| left.iter().find(|change| target.looks_like(change)))
            })
            .map(Target::of)
            .collect();
        if !remaining.is_empty() {
            self.dropped.push(ReviewOp::Decide {
                changes: remaining,
                decision,
            });
        }
    }

    fn leftovers(&self, landing: &Landing) -> Vec<Target> {
        if landing.spots.is_empty() || !matches!(self.format, FormatState::ShareJs(_)) {
            return Vec::new();
        }
        let shift = diff(&landing.base, &self.confirmed);
        let changes = self.review_in_confirmed();
        let mut found: Vec<Target> = Vec::new();
        for (at, text) in &landing.spots {
            let length = utf16_len(text);
            let near = [
                shift.map_position(*at, Bias::Before),
                shift.map_position(*at, Bias::After),
            ];
            let markers = changes.iter().filter(|change| {
                change.kind == ChangeKind::Delete
                    && change.text == *text
                    && near
                        .iter()
                        .any(|spot| change.from == *spot || change.from == spot + length)
            });
            for marker in markers {
                let Some(start) = marker.from.checked_sub(length) else {
                    continue;
                };
                if slice(&self.confirmed, start, marker.from) != Some(text.as_str()) {
                    continue;
                }
                let mine = changes.iter().find(|change| {
                    change.kind == ChangeKind::Insert
                        && (change.from, change.to) == (start, marker.from)
                        && change.user.is_some()
                        && change.user == landing.tracked_by
                });
                for change in std::iter::once(marker).chain(mine) {
                    if !found.iter().any(|known| known.id == change.id) {
                        found.push(Target::of(change));
                    }
                }
            }
        }
        found
    }

    fn rejoin_onto(
        &mut self,
        version: u64,
        text: String,
        format: FormatState,
        base: String,
    ) -> Rejoin {
        let mine = std::mem::take(&mut self.local);
        let mut carried = self.queued_in_local_space();
        let unsent: Vec<ReviewOp> = self
            .unsent_comments()
            .into_iter()
            .filter(|review| {
                review
                    .thread()
                    .is_some_and(|thread| !format_has(&format, thread))
            })
            .collect();
        let marks = std::mem::take(&mut self.marks);
        let next_mark = self.next_mark;
        let confirmed_before = std::mem::take(&mut self.confirmed);
        *self = OverleafDoc {
            page_limit: self.page_limit,
            next_mark,
            reshaped: true,
            repairs: self.repairs,
            ..OverleafDoc::joined(self.id.clone(), version, text, format)
        };
        let carry = |doc: &mut OverleafDoc, op: &TextOperation, carried: Vec<ReviewOp>| {
            for (key, mut ranges) in marks.clone() {
                for range in ranges.iter_mut() {
                    *range = moved_range(op, *range);
                }
                doc.marks.insert(key, ranges);
            }
            for mut review in carried {
                review.moved(op);
                doc.outgoing.push(Unit::Review(review));
            }
        };
        if !unsent.is_empty() {
            let shift = diff(&confirmed_before, &mine);
            let mut moved = Vec::new();
            for mut review in unsent {
                review.moved(&shift);
                moved.push(review);
            }
            carried.splice(0..0, moved);
        }
        if mine == base || mine == self.local {
            let op = diff(&mine, &self.local);
            carry(self, &op, carried);
            return Rejoin::Clean(op);
        }
        let rebased = rebase(&base, &mine, &self.local)
            .filter(|rebased| !rebased.overlapped)
            .and_then(|rebased| {
                let merged = rebased.operation.apply(&self.local).ok()?;
                Some((rebased.operation, merged))
            });
        let Some((operation, merged)) = rebased else {
            carry(self, &diff(&mine, &self.local), carried);
            return Rejoin::Conflict {
                mine,
                theirs: self.local.clone(),
            };
        };
        let op = diff(&mine, &merged);
        self.local = merged;
        if !operation.is_noop() {
            self.outgoing.push(Unit::Text {
                op: operation,
                undo: false,
            });
        }
        carry(self, &op, carried);
        Rejoin::Merged(op)
    }
}

fn format_has(format: &FormatState, thread: &str) -> bool {
    match format {
        FormatState::ShareJs(ranges) => ranges.comment(thread).is_some(),
        FormatState::HistoryOt(raw) => raw.comment(thread).is_some(),
    }
}
