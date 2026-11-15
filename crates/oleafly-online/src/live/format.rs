mod ranges;
#[cfg(test)]
mod tests;

use oleafly_ot::{utf16_len, Component, TextOperation};
use ring::rand::{SecureRandom, SystemRandom};
use serde_json::{json, Map, Value};

pub use ranges::{
    ChangeKind, CommentAnchor, ShareJsRanges, TrackedChange, MAX_CHANGES, MAX_COMMENTS,
};

use super::history_ot::{edits_from_json, Edit, RawDoc, RawOp};
use super::{AppliedUpdate, Tracking};

pub const SHAREJS_TYPE: &str = "sharejs-text-ot";
pub const HISTORY_OT_TYPE: &str = "history-ot";
pub const SHAREJS_MAX_DOC_LENGTH: usize = 2 * 1024 * 1024;
pub const SHAREJS_REPLAY_WINDOW: u64 = 80;
pub const HISTORY_OT_MAX_LENGTH: usize = 3 * 1024 * 1024;
pub const HISTORY_OT_REPLAY_WINDOW: u64 = 100;
const REPLACEMENT: char = '\u{FFFD}';

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

#[derive(Clone, Debug, PartialEq)]
pub enum Echo {
    ShareJs {
        tracked_by: Option<String>,
    },
    HistoryOt {
        raw: RawOp,
        tracked_by: Option<String>,
    },
}

impl Echo {
    pub fn tracked_by(&self) -> Option<&str> {
        match self {
            Echo::ShareJs { tracked_by } | Echo::HistoryOt { tracked_by, .. } => {
                tracked_by.as_deref()
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
pub(crate) enum Piece {
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

    pub fn decode(
        &mut self,
        visible: &str,
        update: &AppliedUpdate,
        mut inflight: Option<(&mut TextOperation, &mut Echo)>,
    ) -> Result<Vec<Step>, CodecError> {
        let op = update.op.as_ref().unwrap_or(&Value::Null);
        match self {
            FormatState::ShareJs(ranges) => {
                let pieces = pieces_from_json(op)?;
                let steps = steps_of(visible, &pieces)?;
                let tracked = update.tc.is_some();
                for piece in &pieces {
                    ranges.apply(piece, tracked, update.user_id.as_deref())?;
                }
                steps
                    .into_iter()
                    .map(|step| match inflight.as_mut() {
                        Some((ours, _)) => {
                            let (ours_after, theirs) = TextOperation::transform(ours, &step)
                                .map_err(|_| CodecError::Mismatch)?;
                            **ours = ours_after;
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
                    .collect()
            }
            FormatState::HistoryOt(raw) => {
                let mut steps = Vec::new();
                for edit in edits_from_json(op)? {
                    let Edit::Text(remote) = edit else {
                        raw.edit_comments(&edit);
                        continue;
                    };
                    let confirmed = raw.project(&remote)?;
                    match inflight.as_mut() {
                        Some((ours, Echo::HistoryOt { raw: sent, .. })) => {
                            let (sent_after, remote_after) = RawOp::transform(sent, &remote)?;
                            let mut mine = raw.clone();
                            mine.apply(sent)?;
                            let past_inflight = mine.project(&remote_after)?;
                            raw.apply(&remote)?;
                            **ours = raw.project(&sent_after)?;
                            *sent = sent_after;
                            steps.push(Step {
                                confirmed,
                                past_inflight,
                            });
                        }
                        Some((_, Echo::ShareJs { .. })) => return Err(CodecError::Mismatch),
                        None => {
                            raw.apply(&remote)?;
                            steps.push(Step {
                                past_inflight: confirmed.clone(),
                                confirmed,
                            });
                        }
                    }
                }
                Ok(steps)
            }
        }
    }

    pub fn encode(
        &self,
        visible: &str,
        op: &TextOperation,
        tracking: Option<&Tracking>,
        previous: Option<&Echo>,
    ) -> Result<Encoded, CodecError> {
        let tracked_by = tracking.map(|tracking| tracking.user_id.clone());
        match self {
            FormatState::ShareJs(_) => {
                let pieces = pieces_of(visible, op)?;
                let tc = tracking.map(|_| tc_seed()).transpose()?;
                Ok(Encoded {
                    op: Value::Array(pieces.iter().map(piece_to_json).collect()),
                    tc,
                    echo: Echo::ShareJs { tracked_by },
                })
            }
            FormatState::HistoryOt(raw) => {
                let sent = match previous {
                    Some(Echo::HistoryOt {
                        raw: sent,
                        tracked_by: before,
                    }) if *before == tracked_by => sent.clone(),
                    _ => raw.encode(op, tracking.map(tracking_props).as_ref())?,
                };
                Ok(Encoded {
                    op: json!([{ "textOperation": sent.to_json()? }]),
                    tc: None,
                    echo: Echo::HistoryOt {
                        raw: sent,
                        tracked_by,
                    },
                })
            }
        }
    }

    pub fn acknowledge(
        &mut self,
        visible: &str,
        op: &TextOperation,
        echo: &Echo,
    ) -> Result<(), CodecError> {
        match (self, echo) {
            (FormatState::ShareJs(ranges), Echo::ShareJs { tracked_by }) => {
                for piece in pieces_of(visible, op)? {
                    ranges.apply(&piece, tracked_by.is_some(), tracked_by.as_deref())?;
                }
                Ok(())
            }
            (FormatState::HistoryOt(raw), Echo::HistoryOt { raw: sent, .. }) => {
                raw.apply(sent)?;
                let expected = op.apply(visible).map_err(|_| CodecError::Mismatch)?;
                if raw.visible()? == expected {
                    Ok(())
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
        let (FormatState::ShareJs(ranges), Echo::ShareJs { tracked_by }) = (self, echo) else {
            return Ok(None);
        };
        let mut after = ranges.clone();
        for piece in pieces_of(visible, op)? {
            after.apply(&piece, tracked_by.is_some(), tracked_by.as_deref())?;
        }
        Ok(Some(after.counts()))
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
                let mut clean = String::with_capacity(text.len());
                let mut characters = text.chars().peekable();
                while let Some(character) = characters.next() {
                    match character {
                        '\0' => {
                            clean.push(REPLACEMENT);
                            correction.delete(1).insert("\u{FFFD}");
                            changed = true;
                        }
                        '\r' if characters.peek() == Some(&'\n') => {
                            correction.delete(1);
                            changed = true;
                        }
                        '\r' => {
                            clean.push('\n');
                            correction.delete(1).insert("\n");
                            changed = true;
                        }
                        wide if wide.len_utf16() == 2 => {
                            clean.push(REPLACEMENT);
                            clean.push(REPLACEMENT);
                            correction.delete(2).insert("\u{FFFD}\u{FFFD}");
                            changed = true;
                        }
                        plain => {
                            clean.push(plain);
                            correction.retain(plain.len_utf16());
                        }
                    }
                }
                send.insert(&clean);
            }
        }
    }
    Sanitized {
        send,
        correction: changed.then_some(correction),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn tc_seed() -> Result<String, CodecError> {
    let mut seed = [0_u8; 9];
    SystemRandom::new()
        .fill(&mut seed)
        .map_err(|_| CodecError::Malformed("no random source for the suggestion id".into()))?;
    Ok(hex(&seed))
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

pub(crate) fn pieces_from_json(op: &Value) -> Result<Vec<Piece>, CodecError> {
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
                .ok_or_else(|| CodecError::Malformed("a component has no position".into()))?
                as usize;
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

fn piece_to_json(piece: &Piece) -> Value {
    match piece {
        Piece::Insert { p, text, .. } => json!({ "p": p, "i": text }),
        Piece::Delete { p, text, .. } => json!({ "p": p, "d": text }),
        Piece::Comment { p, text, thread } => json!({ "p": p, "c": text, "t": thread }),
    }
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

pub(crate) fn pieces_of(visible: &str, op: &TextOperation) -> Result<Vec<Piece>, CodecError> {
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
                    undo: false,
                });
                at += utf16_len(text);
            }
            Component::Delete(count) => {
                let split = byte_at(rest, *count).ok_or(CodecError::Mismatch)?;
                pieces.push(Piece::Delete {
                    p: at,
                    text: rest[..split].to_string(),
                    undo: false,
                });
                rest = &rest[split..];
            }
        }
    }
    Ok(pieces)
}
