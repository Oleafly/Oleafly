#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};

use oleafly_ot::{Component, TextOperation};
use serde_json::{json, Map, Value};

use super::format::{bounded, ChangeKind, CodecError, Decision, RangeChange, MAX_UNITS};
use crate::realtime::events::stamp_ms;

#[derive(Clone, Debug, PartialEq)]
pub struct TrackedRange {
    pub pos: usize,
    pub length: usize,
    pub tracking: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CommentRanges {
    pub id: String,
    pub ranges: Vec<(usize, usize)>,
    pub resolved: bool,
}

#[derive(Clone, Debug, PartialEq)]
struct Run {
    length: usize,
    mark: Option<Value>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RawDoc {
    content: Vec<u16>,
    runs: Vec<Run>,
    comments: Vec<CommentRanges>,
}

#[derive(Clone, Debug, PartialEq)]
enum RawPart {
    Retain {
        count: usize,
        tracking: Option<Value>,
        comment_ids: Option<Value>,
    },
    Insert {
        text: Vec<u16>,
        tracking: Option<Value>,
        comment_ids: Option<Value>,
    },
    Delete {
        count: usize,
    },
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RawOp {
    parts: Vec<RawPart>,
    base: usize,
    target: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Edit {
    Text(RawOp),
    AddComment(CommentRanges),
    DeleteComment(String),
    SetCommentState { id: String, resolved: bool },
    NoOp,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VisibleChange {
    pub id: String,
    pub kind: ChangeKind,
    pub from: usize,
    pub to: usize,
    pub text: String,
    pub user: Option<String>,
    pub ts: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VisibleComment {
    pub id: String,
    pub ranges: Vec<(usize, usize)>,
    pub resolved: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Review {
    pub comments: Vec<VisibleComment>,
    pub changes: Vec<VisibleChange>,
}

impl Edit {
    pub fn to_json(&self) -> Result<Value, CodecError> {
        Ok(match self {
            Edit::Text(op) => json!({ "textOperation": op.to_json()? }),
            Edit::AddComment(comment) => {
                let ranges: Vec<Value> = comment
                    .ranges
                    .iter()
                    .map(|(pos, length)| json!({ "pos": pos, "length": length }))
                    .collect();
                let mut added = json!({ "commentId": comment.id, "ranges": ranges });
                if comment.resolved {
                    added["resolved"] = json!(true);
                }
                added
            }
            Edit::DeleteComment(id) => json!({ "deleteComment": id }),
            Edit::SetCommentState { id, resolved } => {
                json!({ "commentId": id, "resolved": resolved })
            }
            Edit::NoOp => json!({ "noOp": true }),
        })
    }

    pub fn is_comment(&self) -> bool {
        matches!(
            self,
            Edit::AddComment(_) | Edit::DeleteComment(_) | Edit::SetCommentState { .. }
        )
    }
}

pub fn edits_to_json(edits: &[Edit]) -> Result<Value, CodecError> {
    edits
        .iter()
        .map(Edit::to_json)
        .collect::<Result<Vec<Value>, CodecError>>()
        .map(Value::Array)
}

fn is_deleted(mark: &Option<Value>) -> bool {
    mark.as_ref()
        .and_then(|mark| mark.get("type"))
        .and_then(Value::as_str)
        == Some("delete")
}

fn field<'a>(mark: &'a Option<Value>, name: &str) -> Option<&'a str> {
    mark.as_ref()?.get(name)?.as_str()
}

fn joinable(left: &Option<Value>, right: &Option<Value>) -> bool {
    left.is_some()
        && right.is_some()
        && field(left, "type") == field(right, "type")
        && field(left, "userId") == field(right, "userId")
}

fn stamp(mark: &Option<Value>) -> Option<i64> {
    mark.as_ref()?.get("ts").and_then(stamp_ms)
}

fn earliest(left: Option<Value>, right: &Option<Value>) -> Option<Value> {
    match (stamp(&left), stamp(right)) {
        (Some(kept), Some(other)) if other < kept => right.clone(),
        _ => left,
    }
}

fn fnv(parts: &[&str]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for part in parts {
        for byte in part.bytes().chain([0]) {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0100_0000_01b3);
        }
    }
    hash
}

fn resolve(mark: &Option<Value>) -> Option<Value> {
    match mark {
        Some(value) if value.get("type").and_then(Value::as_str) == Some("none") => None,
        other => other.clone(),
    }
}

fn malformed(message: &str) -> CodecError {
    CodecError::Malformed(message.to_string())
}

fn text_of(units: &[u16]) -> Result<String, CodecError> {
    String::from_utf16(units).map_err(|_| malformed("the text splits a character"))
}

fn count(value: &Value) -> Result<usize, CodecError> {
    value
        .as_u64()
        .and_then(bounded)
        .ok_or_else(|| malformed("a range has no position or length"))
}

impl RawOp {
    #[cfg(test)]
    pub fn base_len(&self) -> usize {
        self.base
    }

    pub fn target_len(&self) -> usize {
        self.target
    }

    pub fn is_noop(&self) -> bool {
        self.parts
            .iter()
            .all(|part| matches!(part, RawPart::Retain { tracking: None, .. }))
    }

    fn shifts(&self) -> Vec<(usize, isize, Option<Value>)> {
        let mut shifts = Vec::new();
        let mut cursor = 0;
        for part in &self.parts {
            match part {
                RawPart::Retain { count, .. } => cursor += count,
                RawPart::Insert {
                    text, comment_ids, ..
                } => {
                    shifts.push((cursor, text.len() as isize, comment_ids.clone()));
                    cursor += text.len();
                }
                RawPart::Delete { count } => shifts.push((cursor, -(*count as isize), None)),
            }
        }
        shifts
    }

    fn retain(&mut self, count: usize, tracking: Option<Value>, comment_ids: Option<Value>) {
        if count == 0 {
            return;
        }
        self.base += count;
        self.target += count;
        if let Some(RawPart::Retain {
            count: last,
            tracking: last_tracking,
            comment_ids: last_ids,
        }) = self.parts.last_mut()
        {
            if *last_tracking == tracking && *last_ids == comment_ids {
                *last += count;
                return;
            }
        }
        self.parts.push(RawPart::Retain {
            count,
            tracking,
            comment_ids,
        });
    }

    fn insert(&mut self, text: Vec<u16>, tracking: Option<Value>, comment_ids: Option<Value>) {
        if text.is_empty() {
            return;
        }
        self.target += text.len();
        let at = match self.parts.last() {
            Some(RawPart::Delete { .. }) => self.parts.len() - 1,
            _ => self.parts.len(),
        };
        if let Some(RawPart::Insert {
            text: before,
            tracking: before_tracking,
            comment_ids: before_ids,
        }) = at
            .checked_sub(1)
            .and_then(|index| self.parts.get_mut(index))
        {
            if *before_tracking == tracking && *before_ids == comment_ids {
                before.extend(text);
                return;
            }
        }
        self.parts.insert(
            at,
            RawPart::Insert {
                text,
                tracking,
                comment_ids,
            },
        );
    }

    fn delete(&mut self, count: usize) {
        if count == 0 {
            return;
        }
        self.base += count;
        if let Some(RawPart::Delete { count: last }) = self.parts.last_mut() {
            *last += count;
            return;
        }
        self.parts.push(RawPart::Delete { count });
    }

    pub fn from_json(value: &Value) -> Result<RawOp, CodecError> {
        let mut op = RawOp::default();
        let parts = value
            .as_array()
            .ok_or_else(|| malformed("a text operation is not a list"))?;
        for part in parts {
            match part {
                Value::Number(number) => op.push_count(number.as_i64())?,
                Value::String(text) if !text.is_empty() => {
                    let text: Vec<u16> = text.encode_utf16().collect();
                    op.room(0, text.len())?;
                    op.insert(text, None, None)
                }
                Value::Object(object) => op.push_marked(object)?,
                _ => return Err(malformed("unknown text operation step")),
            }
        }
        Ok(op)
    }

    fn room(&self, base: usize, target: usize) -> Result<(), CodecError> {
        let within =
            |total: usize, more: usize| total.checked_add(more).is_some_and(|sum| sum <= MAX_UNITS);
        if within(self.base, base) && within(self.target, target) {
            Ok(())
        } else {
            Err(malformed("a text operation is longer than any document"))
        }
    }

    fn push_count(&mut self, count: Option<i64>) -> Result<(), CodecError> {
        let length = count
            .and_then(|count| bounded(count.unsigned_abs()))
            .filter(|length| *length > 0)
            .ok_or_else(|| malformed("a text operation step is zero or not whole"))?;
        if count.is_some_and(|count| count > 0) {
            self.room(length, length)?;
            self.retain(length, None, None);
        } else {
            self.room(length, 0)?;
            self.delete(length);
        }
        Ok(())
    }

    fn push_marked(&mut self, object: &Map<String, Value>) -> Result<(), CodecError> {
        let tracking = object.get("tracking").cloned();
        let comment_ids = object.get("commentIds").cloned();
        if let Some(count) = object.get("r") {
            let count = count
                .as_u64()
                .and_then(bounded)
                .filter(|count| *count > 0)
                .ok_or_else(|| malformed("a retain has no length"))?;
            self.room(count, count)?;
            self.retain(count, tracking, comment_ids);
            return Ok(());
        }
        if let Some(Value::String(text)) = object.get("i") {
            let text: Vec<u16> = text.encode_utf16().collect();
            self.room(0, text.len())?;
            self.insert(text, tracking, comment_ids);
            return Ok(());
        }
        Err(CodecError::Unsupported(format!(
            "a text operation step with {}",
            keys(object)
        )))
    }

    pub fn to_json(&self) -> Result<Value, CodecError> {
        let marked = |key: &str, value: Value, tracking: &Option<Value>, ids: &Option<Value>| {
            let mut object = Map::new();
            object.insert(key.to_string(), value);
            if let Some(tracking) = tracking {
                object.insert("tracking".into(), tracking.clone());
            }
            if let Some(ids) = ids {
                object.insert("commentIds".into(), ids.clone());
            }
            Value::Object(object)
        };
        self.parts
            .iter()
            .map(|part| {
                Ok(match part {
                    RawPart::Retain {
                        count,
                        tracking: None,
                        comment_ids: None,
                    } => json!(count),
                    RawPart::Retain {
                        count,
                        tracking,
                        comment_ids,
                    } => marked("r", json!(count), tracking, comment_ids),
                    RawPart::Insert {
                        text,
                        tracking: None,
                        comment_ids: None,
                    } => json!(text_of(text)?),
                    RawPart::Insert {
                        text,
                        tracking,
                        comment_ids,
                    } => marked("i", json!(text_of(text)?), tracking, comment_ids),
                    RawPart::Delete { count } => json!(-(*count as i64)),
                })
            })
            .collect::<Result<Vec<Value>, CodecError>>()
            .map(Value::Array)
    }

    pub fn transform(first: &RawOp, second: &RawOp) -> Result<(RawOp, RawOp), CodecError> {
        if first.base != second.base {
            return Err(CodecError::Mismatch);
        }
        let mut first_prime = RawOp::default();
        let mut second_prime = RawOp::default();
        let mut ones = first.parts.iter().cloned();
        let mut twos = second.parts.iter().cloned();
        let mut one = ones.next();
        let mut two = twos.next();
        loop {
            match (one.take(), two.take()) {
                (None, None) => break,
                (
                    Some(RawPart::Insert {
                        text,
                        tracking,
                        comment_ids,
                    }),
                    next,
                ) => {
                    second_prime.retain(text.len(), None, None);
                    first_prime.insert(text, tracking, comment_ids);
                    one = ones.next();
                    two = next;
                }
                (
                    next,
                    Some(RawPart::Insert {
                        text,
                        tracking,
                        comment_ids,
                    }),
                ) => {
                    first_prime.retain(text.len(), None, None);
                    second_prime.insert(text, tracking, comment_ids);
                    one = next;
                    two = twos.next();
                }
                (None, _) | (_, None) => return Err(CodecError::Mismatch),
                (Some(a), Some(b)) => {
                    let step = length(&a).min(length(&b));
                    match (&a, &b) {
                        (
                            RawPart::Retain {
                                tracking: first_tracking,
                                comment_ids: first_ids,
                                ..
                            },
                            RawPart::Retain {
                                tracking: second_tracking,
                                comment_ids: second_ids,
                                ..
                            },
                        ) => {
                            first_prime.retain(step, first_tracking.clone(), first_ids.clone());
                            let kept = if first_tracking.is_some() {
                                None
                            } else {
                                second_tracking.clone()
                            };
                            second_prime.retain(step, kept, second_ids.clone());
                        }
                        (RawPart::Delete { .. }, RawPart::Delete { .. }) => {}
                        (RawPart::Delete { .. }, RawPart::Retain { .. }) => {
                            first_prime.delete(step)
                        }
                        (RawPart::Retain { .. }, RawPart::Delete { .. }) => {
                            second_prime.delete(step)
                        }
                        _ => return Err(CodecError::Mismatch),
                    }
                    one = shrink(a, step).or_else(|| ones.next());
                    two = shrink(b, step).or_else(|| twos.next());
                }
            }
        }
        Ok((first_prime, second_prime))
    }
}

fn length(part: &RawPart) -> usize {
    match part {
        RawPart::Retain { count, .. } | RawPart::Delete { count } => *count,
        RawPart::Insert { text, .. } => text.len(),
    }
}

fn shrink(part: RawPart, by: usize) -> Option<RawPart> {
    match part {
        RawPart::Retain {
            count,
            tracking,
            comment_ids,
        } if count > by => Some(RawPart::Retain {
            count: count - by,
            tracking,
            comment_ids,
        }),
        RawPart::Delete { count } if count > by => Some(RawPart::Delete { count: count - by }),
        _ => None,
    }
}

fn keys(object: &Map<String, Value>) -> String {
    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    keys.join(", ")
}

pub fn edits_from_json(op: &Value) -> Result<Vec<Edit>, CodecError> {
    let edits = op
        .as_array()
        .ok_or_else(|| malformed("the update is not a list of edits"))?;
    edits
        .iter()
        .map(|edit| {
            let object = edit
                .as_object()
                .ok_or_else(|| malformed("an edit is not an object"))?;
            if let Some(text) = object.get("textOperation") {
                return Ok(Edit::Text(RawOp::from_json(text)?));
            }
            if let Some(id) = object.get("deleteComment") {
                return Ok(Edit::DeleteComment(
                    id.as_str()
                        .ok_or_else(|| malformed("a comment id is not text"))?
                        .to_string(),
                ));
            }
            if object.contains_key("noOp") {
                return Ok(Edit::NoOp);
            }
            let id = object.get("commentId").and_then(Value::as_str);
            match (id, object.get("ranges"), object.get("resolved")) {
                (Some(id), Some(ranges), resolved) => {
                    let ranges = ranges
                        .as_array()
                        .ok_or_else(|| malformed("comment ranges are not a list"))?
                        .iter()
                        .map(|range| Ok((count(&range["pos"])?, count(&range["length"])?)))
                        .collect::<Result<Vec<_>, CodecError>>()?;
                    Ok(Edit::AddComment(CommentRanges {
                        id: id.to_string(),
                        ranges,
                        resolved: resolved.and_then(Value::as_bool).unwrap_or(false),
                    }))
                }
                (Some(id), None, Some(resolved)) => Ok(Edit::SetCommentState {
                    id: id.to_string(),
                    resolved: resolved.as_bool().unwrap_or(false),
                }),
                _ => Err(CodecError::Unsupported(format!(
                    "an edit with {}",
                    keys(object)
                ))),
            }
        })
        .collect()
}

impl RawDoc {
    pub fn from_raw(lines: &Value) -> Result<RawDoc, CodecError> {
        let content: Vec<u16> = lines
            .get("content")
            .and_then(Value::as_str)
            .ok_or_else(|| malformed("the snapshot has no content"))?
            .encode_utf16()
            .collect();
        let mut doc = RawDoc {
            runs: vec![Run {
                length: content.len(),
                mark: None,
            }],
            content,
            comments: Vec::new(),
        };
        let mut tracked: Vec<TrackedRange> = Vec::new();
        for change in lines
            .get("trackedChanges")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
        {
            tracked.push(TrackedRange {
                pos: count(&change["range"]["pos"])?,
                length: count(&change["range"]["length"])?,
                tracking: change["tracking"].clone(),
            });
        }
        tracked.sort_by_key(|range| range.pos);
        let mut runs = Vec::new();
        let mut at = 0;
        for range in &tracked {
            let end = range
                .pos
                .checked_add(range.length)
                .filter(|end| range.pos >= at && *end <= doc.content.len())
                .ok_or_else(|| malformed("tracked changes overlap or run past the end"))?;
            runs.push(Run {
                length: range.pos - at,
                mark: None,
            });
            runs.push(Run {
                length: range.length,
                mark: Some(range.tracking.clone()),
            });
            at = end;
        }
        runs.push(Run {
            length: doc.content.len() - at,
            mark: None,
        });
        doc.runs = normalised(runs);
        for comment in lines
            .get("comments")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
        {
            let ranges = comment["ranges"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|range| Ok((count(&range["pos"])?, count(&range["length"])?)))
                .collect::<Result<Vec<_>, CodecError>>()?;
            doc.comments.push(CommentRanges {
                id: comment["id"].as_str().unwrap_or_default().to_string(),
                ranges: merged_ranges(ranges),
                resolved: comment["resolved"].as_bool().unwrap_or(false),
            });
        }
        Ok(doc)
    }

    #[cfg(test)]
    pub fn length(&self) -> usize {
        self.content.len()
    }

    pub fn content(&self) -> Result<String, CodecError> {
        text_of(&self.content)
    }

    pub fn to_json(&self) -> Result<Value, CodecError> {
        let tracked: Vec<Value> = self
            .tracked()
            .into_iter()
            .map(|range| json!({ "range": { "pos": range.pos, "length": range.length }, "tracking": range.tracking }))
            .collect();
        let comments: Vec<Value> = self
            .comments
            .iter()
            .map(|comment| {
                let ranges: Vec<Value> = comment
                    .ranges
                    .iter()
                    .map(|(pos, length)| json!({ "pos": pos, "length": length }))
                    .collect();
                json!({ "id": comment.id, "ranges": ranges, "resolved": comment.resolved })
            })
            .collect();
        Ok(json!({ "content": self.content()?, "trackedChanges": tracked, "comments": comments }))
    }

    pub fn comments(&self) -> &[CommentRanges] {
        &self.comments
    }

    pub fn tracked(&self) -> Vec<TrackedRange> {
        let mut at = 0;
        let mut ranges = Vec::new();
        for run in &self.runs {
            if let Some(tracking) = &run.mark {
                ranges.push(TrackedRange {
                    pos: at,
                    length: run.length,
                    tracking: tracking.clone(),
                });
            }
            at += run.length;
        }
        ranges
    }

    pub fn visible(&self) -> Result<String, CodecError> {
        let mut kept = Vec::with_capacity(self.content.len());
        let mut at = 0;
        for run in &self.runs {
            if !is_deleted(&run.mark) {
                kept.extend_from_slice(&self.content[at..at + run.length]);
            }
            at += run.length;
        }
        text_of(&kept)
    }

    pub fn visible_len(&self) -> usize {
        self.runs
            .iter()
            .filter(|run| !is_deleted(&run.mark))
            .map(|run| run.length)
            .sum()
    }

    pub fn to_raw(&self, visible: usize) -> usize {
        let mut seen = 0;
        let mut raw = 0;
        for run in &self.runs {
            if is_deleted(&run.mark) {
                if seen == visible {
                    return raw;
                }
            } else if seen + run.length >= visible {
                return raw + (visible - seen);
            } else {
                seen += run.length;
            }
            raw += run.length;
        }
        raw
    }

    pub fn to_raw_after(&self, visible: usize) -> usize {
        let mut seen = 0;
        let mut raw = 0;
        for run in &self.runs {
            if is_deleted(&run.mark) {
                raw += run.length;
                continue;
            }
            if seen + run.length > visible {
                return raw + (visible - seen);
            }
            seen += run.length;
            raw += run.length;
        }
        raw
    }

    pub fn to_visible(&self, raw: usize) -> usize {
        let mut seen = 0;
        let mut at = 0;
        for run in &self.runs {
            if raw <= at {
                break;
            }
            let inside = (raw - at).min(run.length);
            if !is_deleted(&run.mark) {
                seen += inside;
            }
            at += run.length;
        }
        seen
    }

    pub fn counts(&self) -> (usize, usize) {
        (
            self.comments.len(),
            self.runs.iter().filter(|run| run.mark.is_some()).count(),
        )
    }

    pub fn comment(&self, id: &str) -> Option<&CommentRanges> {
        self.comments.iter().find(|comment| comment.id == id)
    }

    pub fn review(&self) -> Review {
        let mut ends: Vec<(usize, usize)> = Vec::new();
        for (index, comment) in self.comments.iter().enumerate() {
            for (pos, length) in &comment.ranges {
                ends.push((*pos, index));
                ends.push((pos.saturating_add(*length), index));
            }
        }
        ends.sort_unstable();
        let mut mapped: Vec<Vec<usize>> = vec![Vec::new(); self.comments.len()];
        let mut ordinals: HashMap<u64, usize> = HashMap::new();
        let mut changes = Vec::new();
        let mut pending = ends.iter().peekable();
        let (mut raw, mut visible) = (0, 0);
        for run in &self.runs {
            let deleted = is_deleted(&run.mark);
            while let Some(&&(pos, index)) = pending.peek() {
                if pos > raw + run.length || (pos == raw + run.length && deleted) {
                    break;
                }
                let inside = if deleted { 0 } else { pos.saturating_sub(raw) };
                mapped[index].push(visible + inside.min(run.length));
                pending.next();
            }
            if run.mark.is_some() {
                let kind = if deleted {
                    ChangeKind::Delete
                } else {
                    ChangeKind::Insert
                };
                let (kind_name, user) = (
                    field(&run.mark, "type").unwrap_or_default(),
                    field(&run.mark, "userId"),
                );
                let ts = run
                    .mark
                    .as_ref()
                    .and_then(|mark| mark.get("ts"))
                    .map(Value::to_string)
                    .unwrap_or_default();
                let hash = fnv(&[kind_name, user.unwrap_or_default(), &ts]);
                let ordinal = ordinals.entry(hash).or_default();
                let id = format!("{hash:016x}{:04x}", *ordinal);
                *ordinal += 1;
                changes.push(VisibleChange {
                    id,
                    kind,
                    from: visible,
                    to: if deleted {
                        visible
                    } else {
                        visible + run.length
                    },
                    text: String::from_utf16_lossy(&self.content[raw..raw + run.length]),
                    user: user.map(str::to_string),
                    ts: stamp(&run.mark),
                });
            }
            raw += run.length;
            if !deleted {
                visible += run.length;
            }
        }
        for (_, index) in pending {
            mapped[*index].push(visible);
        }
        let comments = self
            .comments
            .iter()
            .zip(mapped)
            .map(|(comment, points)| VisibleComment {
                id: comment.id.clone(),
                ranges: points
                    .chunks(2)
                    .filter_map(|pair| match pair {
                        [from, to] if from < to => Some((*from, *to)),
                        _ => None,
                    })
                    .collect(),
                resolved: comment.resolved,
            })
            .collect();
        Review { comments, changes }
    }

    fn tracked_spans(&self, ids: &[String]) -> Vec<(usize, usize, bool)> {
        let review = self.review();
        let mut spans = Vec::new();
        let mut raw = 0;
        let mut index = 0;
        for run in &self.runs {
            if run.mark.is_some() {
                if ids.contains(&review.changes[index].id) {
                    spans.push((raw, run.length, is_deleted(&run.mark)));
                }
                index += 1;
            }
            raw += run.length;
        }
        spans
    }

    pub fn decision_op(&self, ids: &[String], decision: Decision) -> Option<RawOp> {
        let spans = self.tracked_spans(ids);
        if spans.is_empty() {
            return None;
        }
        let cleared = || Some(json!({ "type": "none" }));
        let mut op = RawOp::default();
        let mut at = 0;
        for (pos, length, deleted) in spans {
            op.retain(pos - at, None, None);
            match (decision, deleted) {
                (Decision::Accept, false) => op.retain(length, cleared(), None),
                (Decision::Reject, true) => self.restore(&mut op, pos, length),
                (Decision::Accept, true) | (Decision::Reject, false) => op.delete(length),
            }
            at = pos + length;
        }
        op.retain(self.content.len() - at, None, None);
        Some(op)
    }

    pub fn add_comment(&self, id: &str, from: usize, to: usize, resolved: bool) -> Option<Edit> {
        self.comment_edit(id, &[(from, to)], resolved)
    }

    pub fn comment_edit(
        &self,
        id: &str,
        ranges: &[(usize, usize)],
        resolved: bool,
    ) -> Option<Edit> {
        let visible = self.visible_len();
        let raw: Vec<(usize, usize)> = ranges
            .iter()
            .filter(|(from, to)| from < to && *to <= visible)
            .map(|(from, to)| (self.to_raw_after(*from), self.to_raw(*to)))
            .filter(|(start, end)| start < end)
            .map(|(start, end)| (start, end - start))
            .collect();
        (!raw.is_empty()).then(|| {
            Edit::AddComment(CommentRanges {
                id: id.to_string(),
                ranges: merged_ranges(raw),
                resolved,
            })
        })
    }

    fn signature(&self) -> (u64, u64) {
        let mut shape = DefaultHasher::new();
        let mut places = DefaultHasher::new();
        let mut at = 0;
        for run in &self.runs {
            if run.mark.is_some() {
                (
                    field(&run.mark, "type"),
                    field(&run.mark, "userId"),
                    run.length,
                )
                    .hash(&mut shape);
                at.hash(&mut places);
            }
            at += run.length;
        }
        for comment in &self.comments {
            (&comment.id, comment.resolved).hash(&mut shape);
            for (pos, length) in &comment.ranges {
                length.hash(&mut shape);
                pos.hash(&mut places);
            }
        }
        (shape.finish(), places.finish())
    }

    fn restore(&self, op: &mut RawOp, pos: usize, length: usize) {
        let end = pos + length;
        let mut cuts = vec![pos, end];
        for comment in &self.comments {
            for (start, size) in &comment.ranges {
                for edge in [*start, start + size] {
                    if pos < edge && edge < end {
                        cuts.push(edge);
                    }
                }
            }
        }
        cuts.sort_unstable();
        cuts.dedup();
        for window in cuts.windows(2) {
            let (from, to) = (window[0], window[1]);
            let ids: Vec<Value> = self
                .comments
                .iter()
                .filter(|comment| {
                    comment
                        .ranges
                        .iter()
                        .any(|(start, size)| *start <= from && to <= start + size)
                })
                .map(|comment| json!(comment.id))
                .collect();
            let ids = (!ids.is_empty()).then_some(Value::Array(ids));
            op.insert(self.content[from..to].to_vec(), None, ids);
        }
        op.delete(length);
    }

    fn comment_ids_at(&self, raw: usize) -> Option<Value> {
        let ids: Vec<Value> = self
            .comments
            .iter()
            .filter(|comment| {
                comment
                    .ranges
                    .iter()
                    .any(|(pos, length)| *pos < raw && raw < pos.saturating_add(*length))
            })
            .map(|comment| json!(comment.id))
            .collect();
        (!ids.is_empty()).then_some(Value::Array(ids))
    }

    pub fn encode(
        &self,
        op: &TextOperation,
        tracking: Option<&Value>,
    ) -> Result<RawOp, CodecError> {
        self.encode_with(op, tracking, None)
    }

    fn hidden_at(&self, raw: usize, text: &[u16], user: &str) -> bool {
        let mut at = 0;
        for run in &self.runs {
            if at == raw {
                return is_deleted(&run.mark)
                    && run.length >= text.len()
                    && (user.is_empty() || field(&run.mark, "userId") == Some(user))
                    && self.content[raw..raw + text.len()] == *text;
            }
            if at > raw {
                return false;
            }
            at += run.length;
        }
        false
    }

    pub fn encode_with(
        &self,
        op: &TextOperation,
        tracking: Option<&Value>,
        unhide: Option<&str>,
    ) -> Result<RawOp, CodecError> {
        if op.base_len() != self.visible_len() {
            return Err(CodecError::Mismatch);
        }
        let mut raw = RawOp::default();
        let mut at = 0;
        let mut visible = 0;
        let until = |raw: &mut RawOp, at: &mut usize, target: usize| -> Result<(), CodecError> {
            if target < *at {
                return Err(CodecError::Mismatch);
            }
            raw.retain(target - *at, None, None);
            *at = target;
            Ok(())
        };
        for component in op.components() {
            match component {
                Component::Retain(count) => visible += count,
                Component::Insert(text) => {
                    let pos = self.to_raw(visible);
                    let units: Vec<u16> = text.encode_utf16().collect();
                    if pos >= at && unhide.is_some_and(|user| self.hidden_at(pos, &units, user)) {
                        until(&mut raw, &mut at, pos)?;
                        self.restore(&mut raw, pos, units.len());
                        at = pos + units.len();
                        continue;
                    }
                    until(&mut raw, &mut at, pos)?;
                    let marked = tracking.map(|tracking| with_type(tracking, "insert"));
                    raw.insert(units, marked, self.comment_ids_at(pos));
                }
                Component::Delete(count) => {
                    let start = self.to_raw(visible);
                    let end = self.to_raw(visible + count);
                    until(&mut raw, &mut at, start)?;
                    match tracking {
                        Some(tracking) => {
                            raw.retain(end - start, Some(with_type(tracking, "delete")), None)
                        }
                        None => raw.delete(end - start),
                    }
                    at = end;
                    visible += count;
                }
            }
        }
        until(&mut raw, &mut at, self.content.len())?;
        Ok(raw)
    }

    pub fn project(&self, op: &RawOp) -> Result<TextOperation, CodecError> {
        if op.base != self.content.len() {
            return Err(CodecError::Mismatch);
        }
        let mut visible = TextOperation::new();
        let mut walker = Walker::new(&self.runs);
        let mut at = 0;
        for part in &op.parts {
            self.project_part(part, &mut walker, &mut at, &mut visible)?;
        }
        Ok(visible)
    }

    fn project_part(
        &self,
        part: &RawPart,
        walker: &mut Walker,
        at: &mut usize,
        visible: &mut TextOperation,
    ) -> Result<(), CodecError> {
        match part {
            RawPart::Retain {
                count, tracking, ..
            } => {
                for (length, mark) in walker.take(*count) {
                    self.project_retain(visible, *at, length, &mark, tracking)?;
                    *at += length;
                }
            }
            RawPart::Insert { text, tracking, .. } => {
                if !is_deleted(tracking) {
                    visible.insert(&text_of(text)?);
                }
            }
            RawPart::Delete { count } => {
                for (length, mark) in walker.take(*count) {
                    if !is_deleted(&mark) {
                        visible.delete(length);
                    }
                    *at += length;
                }
            }
        }
        Ok(())
    }

    fn project_retain(
        &self,
        visible: &mut TextOperation,
        at: usize,
        length: usize,
        mark: &Option<Value>,
        tracking: &Option<Value>,
    ) -> Result<(), CodecError> {
        let before = is_deleted(mark);
        let after = match tracking {
            None => before,
            Some(_) => is_deleted(tracking),
        };
        match (before, after) {
            (false, false) => {
                visible.retain(length);
            }
            (false, true) => {
                visible.delete(length);
            }
            (true, false) => {
                visible.insert(&text_of(&self.content[at..at + length])?);
            }
            (true, true) => {}
        }
        Ok(())
    }

    pub fn apply(&mut self, op: &RawOp) -> Result<RangeChange, CodecError> {
        if op.base != self.content.len() {
            return Err(CodecError::Mismatch);
        }
        let before = self.signature();
        let mut content = Vec::with_capacity(op.target);
        let mut runs = Vec::new();
        let mut walker = Walker::new(&self.runs);
        let mut at = 0;
        for part in &op.parts {
            match part {
                RawPart::Retain {
                    count, tracking, ..
                } => {
                    for (length, mark) in walker.take(*count) {
                        content.extend_from_slice(&self.content[at..at + length]);
                        let mark = match tracking {
                            None => mark,
                            Some(_) => resolve(tracking),
                        };
                        runs.push(Run { length, mark });
                        at += length;
                    }
                }
                RawPart::Insert { text, tracking, .. } => {
                    content.extend_from_slice(text);
                    runs.push(Run {
                        length: text.len(),
                        mark: resolve(tracking),
                    });
                }
                RawPart::Delete { count } => {
                    walker.take(*count);
                    at += count;
                }
            }
        }
        self.content = content;
        self.runs = normalised(runs);
        let shifts = op.shifts();
        if !shifts.is_empty() {
            for comment in &mut self.comments {
                comment.shift(&shifts);
            }
        }
        Ok(RangeChange::between(before, self.signature()))
    }

    pub fn edit_comments(&mut self, edit: &Edit) -> RangeChange {
        let before = self.signature();
        edit_comment_list(&mut self.comments, edit);
        RangeChange::between(before, self.signature())
    }
}

pub fn edit_comment_list(comments: &mut Vec<CommentRanges>, edit: &Edit) {
    match edit {
        Edit::AddComment(comment) => {
            let added = CommentRanges {
                ranges: merged_ranges(comment.ranges.clone()),
                ..comment.clone()
            };
            match comments
                .iter_mut()
                .find(|existing| existing.id == comment.id)
            {
                Some(existing) => *existing = added,
                None => comments.push(added),
            }
        }
        Edit::DeleteComment(id) => comments.retain(|existing| existing.id != *id),
        Edit::SetCommentState { id, resolved } => {
            for comment in comments.iter_mut() {
                if comment.id == *id {
                    comment.resolved = *resolved;
                }
            }
        }
        Edit::Text(_) | Edit::NoOp => {}
    }
}

impl CommentRanges {
    fn shift(&mut self, shifts: &[(usize, isize, Option<Value>)]) {
        let mut ranges = std::mem::take(&mut self.ranges);
        for (at, by, ids) in shifts {
            ranges = match usize::try_from(*by) {
                Ok(by) => grown(&ranges, *at, by, names(ids, &self.id)),
                Err(_) => shrunk(&ranges, *at, by.unsigned_abs()),
            };
        }
        self.ranges = ranges;
    }

    pub fn moved(&self, op: &RawOp) -> CommentRanges {
        let mut moved = self.clone();
        moved.shift(&op.shifts());
        moved
    }
}

fn names(ids: &Option<Value>, id: &str) -> bool {
    ids.as_ref()
        .and_then(Value::as_array)
        .is_some_and(|ids| ids.iter().any(|named| named == id))
}

fn merged_ranges(mut ranges: Vec<(usize, usize)>) -> Vec<(usize, usize)> {
    ranges.retain(|(_, length)| *length > 0);
    ranges.sort_unstable();
    let mut merged: Vec<(usize, usize)> = Vec::with_capacity(ranges.len());
    for (pos, length) in ranges {
        let end = pos.saturating_add(length);
        match merged.last_mut() {
            Some((last, last_length)) if pos <= last.saturating_add(*last_length) => {
                *last_length = end.max(last.saturating_add(*last_length)) - *last;
            }
            _ => merged.push((pos, length)),
        }
    }
    merged
}

fn grown(ranges: &[(usize, usize)], at: usize, by: usize, named: bool) -> Vec<(usize, usize)> {
    let mut out = Vec::with_capacity(ranges.len() + 1);
    let mut extended = false;
    for &(pos, length) in ranges {
        let end = pos.saturating_add(length);
        if at == end || at == pos {
            if named {
                out.push((pos, length.saturating_add(by)));
                extended = true;
            } else if at == end {
                out.push((pos, length));
            } else {
                out.push((pos.saturating_add(by), length));
            }
        } else if pos > at {
            out.push((pos.saturating_add(by), length));
        } else if at < end {
            if named {
                out.push((pos, length.saturating_add(by)));
                extended = true;
            } else {
                out.push((pos, at - pos));
                out.push((at.saturating_add(by), end - at));
            }
        } else {
            out.push((pos, length));
        }
    }
    if named && !extended {
        out.push((at, by));
    }
    merged_ranges(out)
}

fn shrunk(ranges: &[(usize, usize)], at: usize, gone: usize) -> Vec<(usize, usize)> {
    let cut_end = at.saturating_add(gone);
    let out = ranges
        .iter()
        .map(|&(pos, length)| {
            let end = pos.saturating_add(length);
            let removed_before = cut_end.min(pos).saturating_sub(at);
            let removed_inside = cut_end.min(end).saturating_sub(at.max(pos));
            (pos - removed_before, length - removed_inside)
        })
        .collect();
    merged_ranges(out)
}

fn with_type(tracking: &Value, kind: &str) -> Value {
    let mut tracking = tracking.clone();
    tracking["type"] = json!(kind);
    tracking
}

fn normalised(runs: Vec<Run>) -> Vec<Run> {
    let mut merged: Vec<Run> = Vec::with_capacity(runs.len());
    for run in runs {
        if run.length == 0 {
            continue;
        }
        match merged.last_mut() {
            Some(last) if last.mark == run.mark => last.length += run.length,
            Some(last) if joinable(&last.mark, &run.mark) => {
                last.length += run.length;
                last.mark = earliest(last.mark.take(), &run.mark);
            }
            _ => merged.push(run),
        }
    }
    merged
}

struct Walker<'a> {
    runs: &'a [Run],
    index: usize,
    used: usize,
}

impl<'a> Walker<'a> {
    fn new(runs: &'a [Run]) -> Walker<'a> {
        Walker {
            runs,
            index: 0,
            used: 0,
        }
    }

    fn take(&mut self, mut count: usize) -> Vec<(usize, Option<Value>)> {
        let mut spans = Vec::new();
        while count > 0 {
            let Some(run) = self.runs.get(self.index) else {
                break;
            };
            let length = (run.length - self.used).min(count);
            spans.push((length, run.mark.clone()));
            count -= length;
            self.used += length;
            if self.used == run.length {
                self.index += 1;
                self.used = 0;
            }
        }
        spans
    }
}
