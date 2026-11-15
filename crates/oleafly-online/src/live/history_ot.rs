#[cfg(test)]
mod tests;

use oleafly_ot::{Component, TextOperation};
use serde_json::{json, Map, Value};

use super::format::CodecError;

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
pub(crate) enum Edit {
    Text(RawOp),
    AddComment(CommentRanges),
    DeleteComment(String),
    SetCommentState { id: String, resolved: bool },
    NoOp,
}

fn is_deleted(mark: &Option<Value>) -> bool {
    mark.as_ref()
        .and_then(|mark| mark.get("type"))
        .and_then(Value::as_str)
        == Some("delete")
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
        .map(|count| count as usize)
        .ok_or_else(|| malformed("a range has no position or length"))
}

impl RawOp {
    pub fn base_len(&self) -> usize {
        self.base
    }

    pub fn target_len(&self) -> usize {
        self.target
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
                    op.insert(text.encode_utf16().collect(), None, None)
                }
                Value::Object(object) => op.push_marked(object)?,
                _ => return Err(malformed("unknown text operation step")),
            }
        }
        Ok(op)
    }

    fn push_count(&mut self, count: Option<i64>) -> Result<(), CodecError> {
        match count {
            Some(count) if count > 0 => self.retain(count as usize, None, None),
            Some(count) if count < 0 => self.delete(count.unsigned_abs() as usize),
            _ => return Err(malformed("a text operation step is zero or not whole")),
        }
        Ok(())
    }

    fn push_marked(&mut self, object: &Map<String, Value>) -> Result<(), CodecError> {
        let tracking = object.get("tracking").cloned();
        let comment_ids = object.get("commentIds").cloned();
        if let Some(count) = object.get("r") {
            let count = count
                .as_u64()
                .filter(|count| *count > 0)
                .ok_or_else(|| malformed("a retain has no length"))?;
            self.retain(count as usize, tracking, comment_ids);
            return Ok(());
        }
        if let Some(Value::String(text)) = object.get("i") {
            self.insert(text.encode_utf16().collect(), tracking, comment_ids);
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

pub(crate) fn edits_from_json(op: &Value) -> Result<Vec<Edit>, CodecError> {
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
            if range.pos < at || range.pos + range.length > doc.content.len() {
                return Err(malformed("tracked changes overlap or run past the end"));
            }
            runs.push(Run {
                length: range.pos - at,
                mark: None,
            });
            runs.push(Run {
                length: range.length,
                mark: Some(range.tracking.clone()),
            });
            at = range.pos + range.length;
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
                ranges,
                resolved: comment["resolved"].as_bool().unwrap_or(false),
            });
        }
        Ok(doc)
    }

    pub fn length(&self) -> usize {
        self.content.len()
    }

    pub fn content(&self) -> Result<String, CodecError> {
        text_of(&self.content)
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

    fn comment_ids_at(&self, raw: usize) -> Option<Value> {
        let ids: Vec<Value> = self
            .comments
            .iter()
            .filter(|comment| {
                comment
                    .ranges
                    .iter()
                    .any(|(pos, length)| *pos < raw && raw < pos + length)
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
                    until(&mut raw, &mut at, pos)?;
                    let marked = tracking.map(|tracking| with_type(tracking, "insert"));
                    raw.insert(
                        text.encode_utf16().collect(),
                        marked,
                        self.comment_ids_at(pos),
                    );
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

    pub fn apply(&mut self, op: &RawOp) -> Result<(), CodecError> {
        if op.base != self.content.len() {
            return Err(CodecError::Mismatch);
        }
        let mut content = Vec::with_capacity(op.target);
        let mut runs = Vec::new();
        let mut walker = Walker::new(&self.runs);
        let mut at = 0;
        let mut shifts: Vec<(usize, isize, Option<Value>)> = Vec::new();
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
                RawPart::Insert {
                    text,
                    tracking,
                    comment_ids,
                } => {
                    shifts.push((content.len(), text.len() as isize, comment_ids.clone()));
                    content.extend_from_slice(text);
                    runs.push(Run {
                        length: text.len(),
                        mark: resolve(tracking),
                    });
                }
                RawPart::Delete { count } => {
                    shifts.push((content.len(), -(*count as isize), None));
                    walker.take(*count);
                    at += count;
                }
            }
        }
        self.content = content;
        self.runs = normalised(runs);
        self.shift_comments(&shifts);
        Ok(())
    }

    fn shift_comments(&mut self, shifts: &[(usize, isize, Option<Value>)]) {
        for comment in &mut self.comments {
            for (pos, length) in &mut comment.ranges {
                let mut range = (*pos, *pos + *length);
                for (at, by, ids) in shifts {
                    let named = names(ids, &comment.id);
                    range = match usize::try_from(*by) {
                        Ok(by) => grown(range, *at, by, named),
                        Err(_) => shrunk(range, *at, by.unsigned_abs()),
                    };
                }
                *pos = range.0;
                *length = range.1 - range.0;
            }
        }
    }

    pub(crate) fn edit_comments(&mut self, edit: &Edit) {
        match edit {
            Edit::AddComment(comment) => {
                self.comments.retain(|existing| existing.id != comment.id);
                self.comments.push(comment.clone());
            }
            Edit::DeleteComment(id) => self.comments.retain(|existing| existing.id != *id),
            Edit::SetCommentState { id, resolved } => {
                for comment in &mut self.comments {
                    if comment.id == *id {
                        comment.resolved = *resolved;
                    }
                }
            }
            Edit::Text(_) | Edit::NoOp => {}
        }
    }
}

fn names(ids: &Option<Value>, id: &str) -> bool {
    ids.as_ref()
        .and_then(Value::as_array)
        .is_some_and(|ids| ids.iter().any(|named| named == id))
}

fn grown((start, end): (usize, usize), at: usize, by: usize, named: bool) -> (usize, usize) {
    if at < start || (at == start && !named) {
        (start + by, end + by)
    } else if at < end || (at == end && named) {
        (start, end + by)
    } else {
        (start, end)
    }
}

fn shrunk((start, end): (usize, usize), at: usize, gone: usize) -> (usize, usize) {
    let cut_end = at + gone;
    let removed_before = cut_end.min(start).saturating_sub(at);
    let removed_inside = cut_end.min(end).saturating_sub(at.max(start));
    (
        start - removed_before,
        end - removed_before - removed_inside,
    )
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
