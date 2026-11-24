mod ranges;
#[cfg(test)]
mod tests;

use oleafly_ot::{utf16_len, Bias, Component, TextOperation};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

pub use ranges::{
    Author, ChangeKind, CommentAnchor, RangeChange, ShareJsRanges, TrackedChange, MAX_CHANGES,
    MAX_COMMENTS,
};

use super::history_ot::{edits_from_json, edits_to_json, Edit, RawDoc, RawOp};
use super::journal::InflightRecord;
use super::{AppliedUpdate, Tracking};
use crate::realtime::events::iso_ms;

pub const SHAREJS_TYPE: &str = "sharejs-text-ot";
pub const HISTORY_OT_TYPE: &str = "history-ot";
pub const SHAREJS_MAX_DOC_LENGTH: usize = 2 * 1024 * 1024;
pub const SHAREJS_REPLAY_WINDOW: u64 = 80;
pub const HISTORY_OT_MAX_LENGTH: usize = 3 * 1024 * 1024;
pub const HISTORY_OT_REPLAY_WINDOW: u64 = 100;
pub(crate) const MAX_UNITS: usize = u32::MAX as usize;
const REPLACEMENT: char = '\u{FFFD}';

pub(crate) fn bounded(count: u64) -> Option<usize> {
    usize::try_from(count)
        .ok()
        .filter(|units| *units <= MAX_UNITS)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Decision {
    Accept,
    Reject,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum DocFormat {
    ShareJs,
    HistoryOt,
}

impl DocFormat {
    pub fn from_join_type(kind: &str) -> Result<DocFormat, CodecError> {
        match kind {
            SHAREJS_TYPE => Ok(DocFormat::ShareJs),
            HISTORY_OT_TYPE => Ok(DocFormat::HistoryOt),
            other => Err(CodecError::Unsupported(other.to_string())),
        }
    }

    pub fn wire_name(self) -> &'static str {
        match self {
            DocFormat::ShareJs => SHAREJS_TYPE,
            DocFormat::HistoryOt => HISTORY_OT_TYPE,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum CodecError {
    #[error("this kind of change is not supported yet: {0}")]
    Unsupported(String),
    #[error("the change does not match the document")]
    Mismatch,
    #[error("the change could not be read: {0}")]
    Malformed(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sanitized {
    pub send: TextOperation,
    pub correction: Option<TextOperation>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    pub max_length: usize,
    pub replay_window: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SentComment {
    pub thread: String,
    pub from: usize,
    pub to: usize,
}

impl SentComment {
    fn moved(&self, op: &TextOperation) -> SentComment {
        let from = op.map_position(self.from, Bias::After);
        SentComment {
            thread: self.thread.clone(),
            from,
            to: op.map_position(self.to, Bias::Before).max(from),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Accepted {
    pub kind: ChangeKind,
    pub at: usize,
    pub text: String,
}

impl Accepted {
    fn pieces(&self) -> [Piece; 2] {
        let text = self.text.clone();
        match self.kind {
            ChangeKind::Insert => [
                Piece::Insert {
                    p: self.at + utf16_len(&self.text),
                    text: text.clone(),
                    undo: false,
                },
                Piece::Delete {
                    p: self.at,
                    text,
                    undo: false,
                },
            ],
            ChangeKind::Delete => [
                Piece::Insert {
                    p: self.at,
                    text: text.clone(),
                    undo: true,
                },
                Piece::Delete {
                    p: self.at,
                    text,
                    undo: false,
                },
            ],
        }
    }

    fn end(&self) -> usize {
        match self.kind {
            ChangeKind::Insert => self.at + utf16_len(&self.text),
            ChangeKind::Delete => self.at,
        }
    }

    fn moved(&mut self, step: &TextOperation) -> bool {
        let (from, to) = (self.at, self.end());
        let mut at = 0;
        let mut touched = false;
        for component in step.components() {
            match component {
                Component::Retain(count) => at += count,
                Component::Insert(_) => touched |= from <= at && at <= to,
                Component::Delete(count) => {
                    touched |= at <= to && from <= at + count;
                    at += count;
                }
            }
        }
        self.at = step.map_position(self.at, Bias::After);
        touched
    }
}

pub fn accepted_pieces(accepts: &[Accepted]) -> Vec<Piece> {
    let mut order: Vec<&Accepted> = accepts.iter().collect();
    order.sort_by(|a, b| {
        b.at.cmp(&a.at).then_with(|| match (a.kind, b.kind) {
            (ChangeKind::Insert, ChangeKind::Delete) => std::cmp::Ordering::Less,
            (ChangeKind::Delete, ChangeKind::Insert) => std::cmp::Ordering::Greater,
            _ => std::cmp::Ordering::Equal,
        })
    });
    order.into_iter().flat_map(Accepted::pieces).collect()
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Extra {
    pub undo: bool,
    pub unhide: bool,
    pub comments: Vec<SentComment>,
    pub edits: Vec<Edit>,
    pub fixed: Option<RawOp>,
    pub accepts: Vec<Accepted>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Echo {
    ShareJs {
        tracked_by: Option<String>,
        tc: Option<String>,
        ts: Option<i64>,
        undo: bool,
        comments: Vec<SentComment>,
        accepts: Vec<Accepted>,
        clashed: bool,
    },
    HistoryOt {
        raw: RawOp,
        tracked_by: Option<String>,
        edits: Vec<Edit>,
        fixed: bool,
    },
}

impl Echo {
    pub fn restored(format: DocFormat, record: &InflightRecord) -> Result<Echo, CodecError> {
        match (format, &record.raw) {
            (DocFormat::ShareJs, _) => Ok(Echo::ShareJs {
                tracked_by: record.tracked_by.clone(),
                tc: record.tc.clone(),
                ts: record.ts,
                undo: record.undo,
                comments: record.comments.clone(),
                accepts: record.accepts.clone(),
                clashed: false,
            }),
            (DocFormat::HistoryOt, Some(raw)) => Ok(Echo::HistoryOt {
                raw: RawOp::from_json(raw)?,
                tracked_by: record.tracked_by.clone(),
                edits: match &record.edits {
                    Some(edits) => edits_from_json(edits)?,
                    None => Vec::new(),
                },
                fixed: record.fixed,
            }),
            (DocFormat::HistoryOt, None) => Err(CodecError::Malformed(
                "a history-ot op without its raw form".into(),
            )),
        }
    }

    pub fn record_into(&self, record: &mut InflightRecord) -> Result<(), CodecError> {
        record.tracked_by = self.tracked_by().map(str::to_string);
        match self {
            Echo::ShareJs {
                tc,
                ts,
                undo,
                comments,
                accepts,
                ..
            } => {
                record.raw = None;
                record.tc.clone_from(tc);
                record.ts = *ts;
                record.undo = *undo;
                record.comments.clone_from(comments);
                record.accepts.clone_from(accepts);
            }
            Echo::HistoryOt {
                raw, edits, fixed, ..
            } => {
                record.raw = Some(raw.to_json()?);
                record.edits = (!edits.is_empty())
                    .then(|| edits_to_json(edits))
                    .transpose()?;
                record.fixed = *fixed;
            }
        }
        Ok(())
    }

    pub fn author(&self) -> Author<'_> {
        match self {
            Echo::ShareJs {
                tracked_by, tc, ts, ..
            } => Author {
                user: tracked_by.as_deref(),
                ts: *ts,
                tracked: tracked_by.is_some(),
                seed: tc.as_deref(),
            },
            Echo::HistoryOt { tracked_by, .. } => Author {
                user: tracked_by.as_deref(),
                ts: None,
                tracked: tracked_by.is_some(),
                seed: None,
            },
        }
    }

    pub fn clashed(&self) -> bool {
        matches!(self, Echo::ShareJs { clashed: true, .. })
    }

    pub fn accepts_by_ops(&self) -> bool {
        matches!(self, Echo::ShareJs { accepts, .. } if !accepts.is_empty())
    }

    pub fn tracked_by(&self) -> Option<&str> {
        match self {
            Echo::ShareJs { tracked_by, .. } | Echo::HistoryOt { tracked_by, .. } => {
                tracked_by.as_deref()
            }
        }
    }

    pub fn extra(&self) -> Extra {
        match self {
            Echo::ShareJs {
                undo,
                comments,
                accepts,
                ..
            } => Extra {
                undo: *undo,
                comments: comments.clone(),
                accepts: accepts.clone(),
                ..Extra::default()
            },
            Echo::HistoryOt {
                raw, edits, fixed, ..
            } => Extra {
                edits: edits.clone(),
                fixed: fixed.then(|| raw.clone()),
                ..Extra::default()
            },
        }
    }

    pub fn carries_edits(&self) -> bool {
        match self {
            Echo::ShareJs {
                comments, accepts, ..
            } => !accepts.is_empty() || comments.iter().any(|comment| comment.from < comment.to),
            Echo::HistoryOt { raw, edits, .. } => !edits.is_empty() || !raw.is_noop(),
        }
    }

    pub fn view_only(&self, op: &TextOperation) -> bool {
        match self {
            Echo::ShareJs {
                comments, accepts, ..
            } => {
                op.is_noop()
                    && accepts.is_empty()
                    && comments.iter().any(|comment| comment.from < comment.to)
            }
            Echo::HistoryOt { raw, edits, .. } => {
                raw.is_noop()
                    && !edits.is_empty()
                    && edits.iter().all(|edit| matches!(edit, Edit::AddComment(_)))
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Encoded {
    pub op: Value,
    pub tc: Option<String>,
    pub echo: Echo,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Step {
    pub confirmed: TextOperation,
    pub past_inflight: TextOperation,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Piece {
    Insert {
        p: usize,
        text: String,
        undo: bool,
    },
    Delete {
        p: usize,
        text: String,
        undo: bool,
    },
    Comment {
        p: usize,
        text: String,
        thread: String,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub enum FormatState {
    ShareJs(ShareJsRanges),
    HistoryOt(RawDoc),
}

fn yield_to(ours: &mut Edit, theirs: &Edit) {
    let Edit::AddComment(comment) = ours else {
        return;
    };
    match theirs {
        Edit::AddComment(other) if other.id == comment.id => *ours = Edit::NoOp,
        Edit::DeleteComment(id) if *id == comment.id => *ours = Edit::NoOp,
        Edit::SetCommentState { id, resolved } if *id == comment.id => {
            comment.resolved = *resolved;
        }
        _ => {}
    }
}

fn tracking_props(tracking: &Tracking) -> Value {
    json!({ "type": "insert", "userId": tracking.user_id, "ts": tracking.ts })
}

impl FormatState {
    pub fn from_join(
        format: DocFormat,
        lines: &Value,
        ranges: &Value,
    ) -> Result<(String, FormatState), CodecError> {
        match format {
            DocFormat::ShareJs => {
                let lines = lines
                    .as_array()
                    .ok_or_else(|| CodecError::Malformed("the lines are not a list".into()))?;
                let mut packed = Vec::with_capacity(lines.len());
                for line in lines {
                    packed.push(
                        line.as_str()
                            .ok_or_else(|| CodecError::Malformed("a line is not text".into()))?,
                    );
                }
                let text = unpack(&packed.join("\n"))?;
                Ok((
                    text,
                    FormatState::ShareJs(ShareJsRanges::from_join(ranges)?),
                ))
            }
            DocFormat::HistoryOt => {
                let raw = RawDoc::from_raw(lines)?;
                Ok((raw.visible()?, FormatState::HistoryOt(raw)))
            }
        }
    }

    pub fn format(&self) -> DocFormat {
        match self {
            FormatState::ShareJs(_) => DocFormat::ShareJs,
            FormatState::HistoryOt(_) => DocFormat::HistoryOt,
        }
    }

    pub fn restored(format: DocFormat, raw: Option<&Value>) -> Result<FormatState, CodecError> {
        match (format, raw) {
            (DocFormat::ShareJs, _) => Ok(FormatState::ShareJs(ShareJsRanges::default())),
            (DocFormat::HistoryOt, Some(raw)) => Ok(FormatState::HistoryOt(RawDoc::from_raw(raw)?)),
            (DocFormat::HistoryOt, None) => Err(CodecError::Malformed(
                "a history-ot doc without its raw snapshot".into(),
            )),
        }
    }

    pub fn snapshot(&self) -> Result<Option<Value>, CodecError> {
        match self {
            FormatState::ShareJs(_) => Ok(None),
            FormatState::HistoryOt(raw) => raw.to_json().map(Some),
        }
    }

    pub fn limits(&self) -> Limits {
        match self {
            FormatState::ShareJs(_) => Limits {
                max_length: SHAREJS_MAX_DOC_LENGTH,
                replay_window: SHAREJS_REPLAY_WINDOW,
            },
            FormatState::HistoryOt(_) => Limits {
                max_length: HISTORY_OT_MAX_LENGTH,
                replay_window: HISTORY_OT_REPLAY_WINDOW,
            },
        }
    }

    pub fn decode_ranges(
        &mut self,
        visible: &str,
        update: &AppliedUpdate,
        mut inflight: Option<(&mut TextOperation, &mut Echo)>,
    ) -> Result<(Vec<Step>, RangeChange), CodecError> {
        let op = update.op.as_ref().unwrap_or(&Value::Null);
        match self {
            FormatState::ShareJs(ranges) => {
                let pieces = pieces_from_json(op)?;
                let steps = steps_of(visible, &pieces)?;
                let author = Author::of(update.user_id.as_deref(), update.ts, update.tc.as_deref());
                let change = ranges.apply_update(&pieces, &author)?;
                if let Some((ours, Echo::ShareJs { undo, clashed, .. })) = inflight.as_mut() {
                    let reinserts = ours
                        .components()
                        .iter()
                        .any(|component| matches!(component, Component::Insert(_)));
                    if *undo && reinserts {
                        *clashed = true;
                    } else {
                        *undo = false;
                    }
                }
                let steps = steps
                    .into_iter()
                    .map(|step| match inflight.as_mut() {
                        Some((ours, echo)) => {
                            let (ours_after, theirs) = TextOperation::transform(ours, &step)
                                .map_err(|_| CodecError::Mismatch)?;
                            **ours = ours_after;
                            if let Echo::ShareJs {
                                comments,
                                accepts,
                                clashed,
                                ..
                            } = echo
                            {
                                for comment in comments.iter_mut() {
                                    *comment = comment.moved(&theirs);
                                }
                                for accepted in accepts.iter_mut() {
                                    let undone = accepted.kind == ChangeKind::Delete;
                                    *clashed |= accepted.moved(&step) || undone;
                                }
                            }
                            Ok(Step {
                                confirmed: step,
                                past_inflight: theirs,
                            })
                        }
                        None => Ok(Step {
                            past_inflight: step.clone(),
                            confirmed: step,
                        }),
                    })
                    .collect::<Result<Vec<Step>, CodecError>>()?;
                Ok((steps, change))
            }
            FormatState::HistoryOt(raw) => {
                let mut steps = Vec::new();
                let mut change = RangeChange::Same;
                for edit in edits_from_json(op)? {
                    let Edit::Text(remote) = edit else {
                        if let Some((_, Echo::HistoryOt { edits, .. })) = inflight.as_mut() {
                            for ours in edits.iter_mut() {
                                yield_to(ours, &edit);
                            }
                        }
                        change = change.and(raw.edit_comments(&edit));
                        continue;
                    };
                    let confirmed = raw.project(&remote)?;
                    match inflight.as_mut() {
                        Some((
                            ours,
                            Echo::HistoryOt {
                                raw: sent, edits, ..
                            },
                        )) => {
                            let (sent_after, remote_after) = RawOp::transform(sent, &remote)?;
                            let mut mine = raw.clone();
                            mine.apply(sent)?;
                            let past_inflight = mine.project(&remote_after)?;
                            change = change.and(raw.apply(&remote)?);
                            **ours = raw.project(&sent_after)?;
                            *sent = sent_after;
                            for edit in edits.iter_mut() {
                                if let Edit::AddComment(comment) = edit {
                                    *comment = comment.moved(&remote_after);
                                }
                            }
                            steps.push(Step {
                                confirmed,
                                past_inflight,
                            });
                        }
                        Some((_, Echo::ShareJs { .. })) => return Err(CodecError::Mismatch),
                        None => {
                            change = change.and(raw.apply(&remote)?);
                            steps.push(Step {
                                past_inflight: confirmed.clone(),
                                confirmed,
                            });
                        }
                    }
                }
                Ok((steps, change))
            }
        }
    }

    pub fn encode(
        &self,
        visible: &str,
        op: &TextOperation,
        tracking: Option<&Tracking>,
        previous: Option<&Echo>,
        extra: &Extra,
    ) -> Result<Encoded, CodecError> {
        let tracked_by = tracking.map(|tracking| tracking.user_id.clone());
        match self {
            FormatState::ShareJs(_) => {
                let mut pieces = pieces_of_flagged(visible, op, extra.undo)?;
                let texts = !pieces.is_empty();
                pieces.splice(0..0, accepted_pieces(&extra.accepts));
                let comments = if extra.comments.is_empty() {
                    Vec::new()
                } else {
                    let after = op.apply(visible).map_err(|_| CodecError::Mismatch)?;
                    let kept: Vec<SentComment> = extra
                        .comments
                        .iter()
                        .filter(|comment| comment.from < comment.to)
                        .filter_map(|comment| {
                            let piece =
                                comment_piece(&after, comment.from, comment.to, &comment.thread)
                                    .ok()?;
                            pieces.push(piece);
                            Some(comment.clone())
                        })
                        .collect();
                    kept
                };
                let kept = match previous {
                    Some(Echo::ShareJs {
                        tracked_by: before,
                        tc: Some(tc),
                        ts,
                        ..
                    }) if *before == tracked_by => Some((tc.clone(), *ts)),
                    _ => None,
                };
                let (tc, ts) = match (tracking.filter(|_| texts), kept) {
                    (None, _) => (None, None),
                    (Some(_), Some((tc, ts))) => (Some(tc), ts),
                    (Some(tracking), None) => (Some(tc_seed()?), iso_ms(&tracking.ts)),
                };
                Ok(Encoded {
                    op: pieces_to_json(&pieces),
                    tc: tc.clone(),
                    echo: Echo::ShareJs {
                        tracked_by: tracked_by.filter(|_| texts),
                        tc,
                        ts,
                        undo: extra.undo,
                        comments,
                        accepts: extra.accepts.clone(),
                        clashed: false,
                    },
                })
            }
            FormatState::HistoryOt(raw) => {
                let (sent, fixed) = match (&extra.fixed, previous) {
                    (Some(fixed), _) => (fixed.clone(), true),
                    (
                        None,
                        Some(Echo::HistoryOt {
                            raw: sent,
                            tracked_by: before,
                            ..
                        }),
                    ) if *before == tracked_by => (sent.clone(), false),
                    _ => {
                        let unhide = extra
                            .unhide
                            .then(|| tracking.map_or("", |tracking| tracking.user_id.as_str()));
                        let props = tracking.map(tracking_props);
                        (raw.encode_with(op, props.as_ref(), unhide)?, false)
                    }
                };
                let mut wire = Vec::with_capacity(1 + extra.edits.len());
                if !sent.is_noop() {
                    wire.push(json!({ "textOperation": sent.to_json()? }));
                }
                for edit in &extra.edits {
                    wire.push(edit.to_json()?);
                }
                Ok(Encoded {
                    op: Value::Array(wire),
                    tc: None,
                    echo: Echo::HistoryOt {
                        raw: sent,
                        tracked_by: tracked_by.filter(|_| !fixed),
                        edits: extra.edits.clone(),
                        fixed,
                    },
                })
            }
        }
    }

    pub fn acknowledge_ranges(
        &mut self,
        visible: &str,
        op: &TextOperation,
        echo: &Echo,
    ) -> Result<RangeChange, CodecError> {
        match (self, echo) {
            (
                FormatState::ShareJs(ranges),
                Echo::ShareJs {
                    undo,
                    comments,
                    accepts,
                    ..
                },
            ) => {
                let mut pieces = accepted_pieces(accepts);
                pieces.extend(pieces_of_flagged(visible, op, *undo)?);
                if !comments.is_empty() {
                    let after = op.apply(visible).map_err(|_| CodecError::Mismatch)?;
                    pieces.extend(comments.iter().filter_map(|comment| {
                        comment_piece(&after, comment.from, comment.to, &comment.thread).ok()
                    }));
                }
                ranges.apply_update(&pieces, &echo.author())
            }
            (
                FormatState::HistoryOt(raw),
                Echo::HistoryOt {
                    raw: sent, edits, ..
                },
            ) => {
                let mut change = raw.apply(sent)?;
                for edit in edits {
                    change = change.and(raw.edit_comments(edit));
                }
                let expected = op.apply(visible).map_err(|_| CodecError::Mismatch)?;
                if raw.visible()? == expected {
                    Ok(change)
                } else {
                    Err(CodecError::Mismatch)
                }
            }
            _ => Err(CodecError::Mismatch),
        }
    }

    pub fn length_after(&self, op: &TextOperation, echo: &Echo) -> usize {
        match echo {
            Echo::HistoryOt { raw, .. } => raw.target_len(),
            Echo::ShareJs { .. } => op.target_len(),
        }
    }

    pub fn range_counts_after(
        &self,
        visible: &str,
        op: &TextOperation,
        echo: &Echo,
    ) -> Result<Option<(usize, usize)>, CodecError> {
        let (
            FormatState::ShareJs(ranges),
            Echo::ShareJs {
                undo,
                comments,
                accepts,
                ..
            },
        ) = (self, echo)
        else {
            return Ok(None);
        };
        let mut pieces = accepted_pieces(accepts);
        pieces.extend(pieces_of_flagged(visible, op, *undo)?);
        if !comments.is_empty() {
            let after = op.apply(visible).map_err(|_| CodecError::Mismatch)?;
            pieces.extend(comments.iter().filter_map(|comment| {
                comment_piece(&after, comment.from, comment.to, &comment.thread).ok()
            }));
        }
        ranges.counts_after(&pieces, &echo.author()).map(Some)
    }

    pub fn counts(&self) -> (usize, usize) {
        match self {
            FormatState::ShareJs(ranges) => ranges.counts(),
            FormatState::HistoryOt(raw) => raw.counts(),
        }
    }

    pub fn reencodes_on_one_connection(&self) -> bool {
        matches!(self, FormatState::ShareJs(_))
    }

    pub fn sanitize(&self, op: &TextOperation) -> Sanitized {
        sanitize(op)
    }
}

fn sanitize(op: &TextOperation) -> Sanitized {
    let mut send = TextOperation::new();
    let mut correction = TextOperation::new();
    let mut changed = false;
    for component in op.components() {
        match component {
            Component::Retain(count) => {
                send.retain(*count);
                correction.retain(*count);
            }
            Component::Delete(count) => {
                send.delete(*count);
            }
            Component::Insert(text) => {
                let clean = clean_insert(text, &mut correction);
                changed |= clean != *text;
                send.insert(&clean);
            }
        }
    }
    Sanitized {
        send,
        correction: changed.then_some(correction),
    }
}

fn clean_insert(text: &str, correction: &mut TextOperation) -> String {
    let mut clean = String::with_capacity(text.len());
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '\0' => {
                clean.push(REPLACEMENT);
                correction.delete(1).insert("\u{FFFD}");
            }
            '\r' if characters.peek() == Some(&'\n') => {
                correction.delete(1);
            }
            '\r' => {
                clean.push('\n');
                correction.delete(1).insert("\n");
            }
            wide if wide.len_utf16() == 2 => {
                clean.push(REPLACEMENT);
                clean.push(REPLACEMENT);
                correction.delete(2).insert("\u{FFFD}\u{FFFD}");
            }
            plain => {
                clean.push(plain);
                correction.retain(plain.len_utf16());
            }
        }
    }
    clean
}

fn random_hex(bytes: usize) -> Result<String, CodecError> {
    let mut seed = vec![0_u8; bytes];
    SystemRandom::new()
        .fill(&mut seed)
        .map_err(|_| CodecError::Malformed("no random source for a new id".into()))?;
    Ok(oleafly_core::encoding::hex_lower(&seed))
}

fn tc_seed() -> Result<String, CodecError> {
    random_hex(9)
}

pub fn new_thread_id() -> Result<String, CodecError> {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    Ok(format!(
        "{:08x}{}000001",
        seconds & 0xffff_ffff,
        random_hex(5)?
    ))
}

pub(crate) fn pack(text: &str) -> String {
    text.bytes().map(char::from).collect()
}

pub(crate) fn unpack(packed: &str) -> Result<String, CodecError> {
    let mut bytes = Vec::with_capacity(packed.len());
    for character in packed.chars() {
        let code = u32::from(character);
        if code > 0xFF {
            return Err(CodecError::Malformed(
                "the text is not in the packed form".into(),
            ));
        }
        bytes.push(code as u8);
    }
    String::from_utf8(bytes)
        .map_err(|_| CodecError::Malformed("the packed text is not UTF-8".into()))
}

pub(crate) fn byte_at(text: &str, unit: usize) -> Option<usize> {
    let mut units = 0;
    for (index, character) in text.char_indices() {
        if units == unit {
            return Some(index);
        }
        units += character.len_utf16();
        if units > unit {
            return None;
        }
    }
    (units == unit).then_some(text.len())
}

fn field<'a>(object: &'a Map<String, Value>, name: &str) -> Result<Option<&'a str>, CodecError> {
    match object.get(name) {
        None => Ok(None),
        Some(Value::String(text)) => Ok(Some(text)),
        Some(_) => Err(CodecError::Malformed(format!("{name} is not text"))),
    }
}

pub fn pieces_from_json(op: &Value) -> Result<Vec<Piece>, CodecError> {
    let components = op
        .as_array()
        .ok_or_else(|| CodecError::Malformed("the op is not a list".into()))?;
    components
        .iter()
        .map(|component| {
            let object = component
                .as_object()
                .ok_or_else(|| CodecError::Malformed("a component is not an object".into()))?;
            let p = object
                .get("p")
                .and_then(Value::as_u64)
                .and_then(bounded)
                .ok_or_else(|| CodecError::Malformed("a component has no position".into()))?;
            let undo = object.get("u").and_then(Value::as_bool).unwrap_or(false);
            if let Some(text) = field(object, "i")? {
                return Ok(Piece::Insert {
                    p,
                    text: text.to_string(),
                    undo,
                });
            }
            if let Some(text) = field(object, "d")? {
                return Ok(Piece::Delete {
                    p,
                    text: text.to_string(),
                    undo,
                });
            }
            if let Some(text) = field(object, "c")? {
                return Ok(Piece::Comment {
                    p,
                    text: text.to_string(),
                    thread: field(object, "t")?.unwrap_or_default().to_string(),
                });
            }
            let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
            keys.sort_unstable();
            Err(CodecError::Unsupported(format!(
                "a change with {}",
                keys.join(", ")
            )))
        })
        .collect()
}

pub fn piece_to_json(piece: &Piece) -> Value {
    let flagged = |mut component: Value, undo: bool| {
        if undo {
            component["u"] = json!(true);
        }
        component
    };
    match piece {
        Piece::Insert { p, text, undo } => flagged(json!({ "p": p, "i": text }), *undo),
        Piece::Delete { p, text, undo } => flagged(json!({ "p": p, "d": text }), *undo),
        Piece::Comment { p, text, thread } => json!({ "p": p, "c": text, "t": thread }),
    }
}

pub fn pieces_to_json(pieces: &[Piece]) -> Value {
    Value::Array(pieces.iter().map(piece_to_json).collect())
}

pub fn comment_piece(
    visible: &str,
    from: usize,
    to: usize,
    thread: &str,
) -> Result<Piece, CodecError> {
    let start = byte_at(visible, from).ok_or(CodecError::Mismatch)?;
    let end = byte_at(visible, to).ok_or(CodecError::Mismatch)?;
    if start > end || thread.is_empty() {
        return Err(CodecError::Mismatch);
    }
    Ok(Piece::Comment {
        p: from,
        text: visible[start..end].to_string(),
        thread: thread.to_string(),
    })
}

pub(crate) fn steps_of(visible: &str, pieces: &[Piece]) -> Result<Vec<TextOperation>, CodecError> {
    let mut text = visible.to_string();
    let mut steps = Vec::with_capacity(pieces.len());
    for piece in pieces {
        let length = utf16_len(&text);
        let mut step = TextOperation::new();
        match piece {
            Piece::Insert {
                p, text: inserted, ..
            } => {
                if *p > length || byte_at(&text, *p).is_none() {
                    return Err(CodecError::Mismatch);
                }
                step.retain(*p).insert(inserted).retain(length - p);
            }
            Piece::Delete {
                p, text: deleted, ..
            } => {
                let count = utf16_len(deleted);
                let start = byte_at(&text, *p).ok_or(CodecError::Mismatch)?;
                let end = byte_at(&text, p + count).ok_or(CodecError::Mismatch)?;
                if &text[start..end] != deleted.as_str() {
                    return Err(CodecError::Mismatch);
                }
                step.retain(*p).delete(count).retain(length - p - count);
            }
            Piece::Comment { .. } => continue,
        }
        text = step.apply(&text).map_err(|_| CodecError::Mismatch)?;
        steps.push(step);
    }
    Ok(steps)
}

#[cfg(test)]
pub(crate) fn operation_of(visible: &str, pieces: &[Piece]) -> Result<TextOperation, CodecError> {
    let mut total = TextOperation::new();
    total.retain(utf16_len(visible));
    for step in steps_of(visible, pieces)? {
        total = total.compose(&step).map_err(|_| CodecError::Mismatch)?;
    }
    Ok(total)
}

pub fn pieces_of_flagged(
    visible: &str,
    op: &TextOperation,
    undo: bool,
) -> Result<Vec<Piece>, CodecError> {
    if op.base_len() != utf16_len(visible) {
        return Err(CodecError::Mismatch);
    }
    let mut pieces = Vec::new();
    let mut rest = visible;
    let mut at = 0;
    for component in op.components() {
        match component {
            Component::Retain(count) => {
                let split = byte_at(rest, *count).ok_or(CodecError::Mismatch)?;
                rest = &rest[split..];
                at += count;
            }
            Component::Insert(text) => {
                pieces.push(Piece::Insert {
                    p: at,
                    text: text.clone(),
                    undo,
                });
                at += utf16_len(text);
            }
            Component::Delete(count) => {
                let split = byte_at(rest, *count).ok_or(CodecError::Mismatch)?;
                pieces.push(Piece::Delete {
                    p: at,
                    text: rest[..split].to_string(),
                    undo,
                });
                rest = &rest[split..];
            }
        }
    }
    Ok(pieces)
}
