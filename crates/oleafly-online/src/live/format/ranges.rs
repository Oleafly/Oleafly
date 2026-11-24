use std::hash::{DefaultHasher, Hash, Hasher};

use oleafly_ot::TextOperation;
use serde_json::{json, Map, Value};

use super::{bounded, pack, unpack, CodecError, Piece};
use crate::realtime::events::{iso_time, plain, stamp_ms};

pub const MAX_COMMENTS: usize = 500;
pub const MAX_CHANGES: usize = 2_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub enum RangeChange {
    #[default]
    Same,
    Moved,
    Reshaped,
}

impl RangeChange {
    pub fn and(self, other: RangeChange) -> RangeChange {
        self.max(other)
    }

    pub fn reshaped(self) -> bool {
        self == RangeChange::Reshaped
    }

    pub(crate) fn between(before: (u64, u64), after: (u64, u64)) -> RangeChange {
        if before.0 != after.0 {
            RangeChange::Reshaped
        } else if before.1 != after.1 {
            RangeChange::Moved
        } else {
            RangeChange::Same
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Author<'a> {
    pub user: Option<&'a str>,
    pub ts: Option<i64>,
    pub tracked: bool,
    pub seed: Option<&'a str>,
}

impl<'a> Author<'a> {
    pub fn of(user: Option<&'a str>, ts: Option<i64>, tc: Option<&'a str>) -> Author<'a> {
        Author {
            user,
            ts,
            tracked: tc.is_some(),
            seed: tc,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommentAnchor {
    pub thread: String,
    pub at: usize,
    pub text: Vec<u16>,
    pub user: Option<String>,
    pub ts: Option<i64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Insert,
    Delete,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrackedChange {
    key: u64,
    id: Option<String>,
    pub kind: ChangeKind,
    pub at: usize,
    pub text: Vec<u16>,
    pub user: Option<String>,
    pub ts: Option<i64>,
}

impl TrackedChange {
    pub fn key(&self) -> u64 {
        self.key
    }

    pub fn id(&self) -> Option<&str> {
        self.id.as_deref()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Seed {
    prefix: Option<String>,
    issued: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ShareJsRanges {
    comments: Vec<CommentAnchor>,
    changes: Vec<TrackedChange>,
    next_key: u64,
    seed: Seed,
}

enum Edit {
    Insert { at: usize, text: Vec<u16> },
    Delete { at: usize, text: Vec<u16> },
}

fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

fn packed_units(value: &Value) -> Result<Option<Vec<u16>>, CodecError> {
    match value {
        Value::Null => Ok(None),
        Value::String(text) => Ok(Some(units(&unpack(text)?))),
        _ => Err(CodecError::Malformed("a range text is not text".into())),
    }
}

fn position(value: &Value) -> Result<usize, CodecError> {
    value
        .as_u64()
        .and_then(bounded)
        .ok_or_else(|| CodecError::Malformed("a range has no position".into()))
}

fn metadata(entry: &Value) -> (Option<String>, Option<i64>) {
    let meta = entry.get("metadata").unwrap_or(&Value::Null);
    (
        meta.get("user_id")
            .and_then(Value::as_str)
            .map(str::to_string),
        meta.get("ts").and_then(stamp_ms),
    )
}

fn earlier(a: Option<i64>, b: Option<i64>) -> Option<i64> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    }
}

fn wire_text(text: &[u16], packed: bool) -> String {
    let text = String::from_utf16_lossy(text);
    if packed {
        pack(&text)
    } else {
        text
    }
}

fn metadata_json(user: Option<&str>, ts: Option<i64>) -> Value {
    let mut meta = Map::new();
    if let Some(user) = user {
        meta.insert("user_id".into(), json!(user));
    }
    if let Some(ts) = ts {
        meta.insert("ts".into(), json!(iso_time(ts)));
    }
    Value::Object(meta)
}

impl ShareJsRanges {
    pub fn from_join(ranges: &Value) -> Result<ShareJsRanges, CodecError> {
        let mut parsed = ShareJsRanges::default();
        let list = |name: &str| ranges.get(name).and_then(Value::as_array).cloned();
        for comment in list("comments").unwrap_or_default() {
            let op = &comment["op"];
            let thread = op["t"]
                .as_str()
                .or_else(|| comment["id"].as_str())
                .unwrap_or_default()
                .to_string();
            let (user, ts) = metadata(&comment);
            parsed.comments.push(CommentAnchor {
                thread,
                at: position(&op["p"])?,
                text: packed_units(&op["c"])?.unwrap_or_default(),
                user,
                ts,
            });
        }
        for change in list("changes").unwrap_or_default() {
            let op = &change["op"];
            let (user, ts) = metadata(&change);
            let at = position(&op["p"])?;
            let (kind, text) = match (packed_units(&op["i"])?, packed_units(&op["d"])?) {
                (Some(text), None) => (ChangeKind::Insert, text),
                (None, Some(text)) => (ChangeKind::Delete, text),
                _ => {
                    return Err(CodecError::Malformed(
                        "a tracked change needs i or d".into(),
                    ))
                }
            };
            let key = parsed.key();
            parsed.changes.push(TrackedChange {
                key,
                id: change["id"].as_str().map(str::to_string).and_then(plain),
                kind,
                at,
                text,
                user,
                ts,
            });
        }
        Ok(parsed)
    }

    pub fn to_json(&self, packed: bool) -> Value {
        let mut ranges = Map::new();
        if !self.changes.is_empty() {
            let changes: Vec<Value> = self
                .changes
                .iter()
                .map(|change| {
                    let field = match change.kind {
                        ChangeKind::Insert => "i",
                        ChangeKind::Delete => "d",
                    };
                    let mut entry = json!({
                        "op": { field: wire_text(&change.text, packed), "p": change.at },
                        "metadata": metadata_json(change.user.as_deref(), change.ts),
                    });
                    if let Some(id) = &change.id {
                        entry["id"] = json!(id);
                    }
                    entry
                })
                .collect();
            ranges.insert("changes".into(), Value::Array(changes));
        }
        if !self.comments.is_empty() {
            let comments: Vec<Value> = self
                .comments
                .iter()
                .map(|comment| {
                    json!({
                        "id": comment.thread,
                        "op": { "c": wire_text(&comment.text, packed), "p": comment.at, "t": comment.thread },
                        "metadata": metadata_json(comment.user.as_deref(), comment.ts),
                    })
                })
                .collect();
            ranges.insert("comments".into(), Value::Array(comments));
        }
        Value::Object(ranges)
    }

    pub fn comments(&self) -> &[CommentAnchor] {
        &self.comments
    }

    pub fn changes(&self) -> &[TrackedChange] {
        &self.changes
    }

    pub fn counts(&self) -> (usize, usize) {
        (self.comments.len(), self.changes.len())
    }

    pub fn comment(&self, thread: &str) -> Option<&CommentAnchor> {
        self.comments
            .iter()
            .find(|comment| comment.thread == thread)
    }

    pub fn change(&self, id: &str) -> Option<&TrackedChange> {
        self.changes
            .iter()
            .find(|change| change.id.as_deref() == Some(id))
    }

    pub fn change_by_key(&self, key: u64) -> Option<&TrackedChange> {
        self.changes.iter().find(|change| change.key == key)
    }

    pub fn all_ids_known(&self) -> bool {
        self.changes.iter().all(|change| change.id.is_some())
    }

    pub fn remove_changes(&mut self, ids: &[String]) -> usize {
        let before = self.changes.len();
        self.changes.retain(|change| {
            change
                .id
                .as_ref()
                .is_none_or(|id| !ids.iter().any(|gone| gone == id))
        });
        before - self.changes.len()
    }

    pub fn remove_comment(&mut self, thread: &str) -> bool {
        let before = self.comments.len();
        self.comments.retain(|comment| comment.thread != thread);
        before != self.comments.len()
    }

    pub fn adopt_all(&mut self, fresh: &ShareJsRanges) -> RangeChange {
        let before = self.signature();
        let mut old: Vec<TrackedChange> = std::mem::take(&mut self.changes);
        let mut changes = Vec::with_capacity(fresh.changes.len());
        for change in &fresh.changes {
            let same = |known: &TrackedChange| match (&known.id, &change.id) {
                (Some(known), Some(fresh)) => known == fresh,
                _ => (known.kind, known.at, &known.text) == (change.kind, change.at, &change.text),
            };
            let key = match old.iter().position(same) {
                Some(found) => old.remove(found).key,
                None => self.key(),
            };
            changes.push(TrackedChange {
                key,
                ..change.clone()
            });
        }
        self.changes = changes;
        self.comments.clone_from(&fresh.comments);
        let after = self.signature();
        match RangeChange::between(before, after) {
            RangeChange::Same if old.is_empty() => RangeChange::Same,
            RangeChange::Same => RangeChange::Reshaped,
            change => change,
        }
    }

    pub fn reject_op(&self, keys: &[u64], visible_len: usize) -> Option<TextOperation> {
        let mut chosen: Vec<&TrackedChange> = self
            .changes
            .iter()
            .filter(|change| keys.contains(&change.key))
            .collect();
        if chosen.is_empty() {
            return None;
        }
        chosen.sort_by(|a, b| {
            a.at.cmp(&b.at).then_with(|| match (a.kind, b.kind) {
                (ChangeKind::Delete, ChangeKind::Insert) => std::cmp::Ordering::Less,
                (ChangeKind::Insert, ChangeKind::Delete) => std::cmp::Ordering::Greater,
                _ => std::cmp::Ordering::Equal,
            })
        });
        let mut op = TextOperation::new();
        let mut at = 0;
        for change in chosen {
            let end = match change.kind {
                ChangeKind::Insert => change.at + change.text.len(),
                ChangeKind::Delete => change.at,
            };
            if change.at < at || end > visible_len {
                return None;
            }
            op.retain(change.at - at);
            match change.kind {
                ChangeKind::Insert => {
                    op.delete(change.text.len());
                }
                ChangeKind::Delete => {
                    op.insert(&String::from_utf16(&change.text).ok()?);
                }
            }
            at = end;
        }
        op.retain(visible_len - at);
        Some(op)
    }

    fn key(&mut self) -> u64 {
        self.next_key += 1;
        self.next_key
    }

    fn next_id(&mut self) -> Option<String> {
        let prefix = self.seed.prefix.as_ref()?;
        self.seed.issued += 1;
        Some(format!("{prefix}{:06x}", self.seed.issued))
    }

    fn signature(&self) -> (u64, u64) {
        let mut shape = DefaultHasher::new();
        let mut places = DefaultHasher::new();
        for change in &self.changes {
            (change.key, change.kind, change.text.len()).hash(&mut shape);
            change.at.hash(&mut places);
        }
        for comment in &self.comments {
            (&comment.thread, comment.text.len()).hash(&mut shape);
            comment.at.hash(&mut places);
        }
        (shape.finish(), places.finish())
    }

    pub fn apply_update(
        &mut self,
        pieces: &[Piece],
        author: &Author,
    ) -> Result<RangeChange, CodecError> {
        self.seed = Seed {
            prefix: author.seed.map(str::to_string),
            issued: 0,
        };
        let before = self.signature();
        for piece in pieces {
            self.apply(piece, author)?;
        }
        Ok(RangeChange::between(before, self.signature()))
    }

    pub fn counts_after(
        &self,
        pieces: &[Piece],
        author: &Author,
    ) -> Result<(usize, usize), CodecError> {
        let mut after = self.clone();
        after.apply_update(pieces, author)?;
        Ok(after.counts())
    }

    fn apply(&mut self, piece: &Piece, author: &Author) -> Result<(), CodecError> {
        match piece {
            Piece::Insert { p, text, undo } => {
                let text = units(text);
                self.insert_into_changes(*p, &text, *undo, author);
                self.insert_into_comments(*p, &text);
                Ok(())
            }
            Piece::Delete { p, text, .. } => {
                let text = units(text);
                self.delete_from_changes(*p, &text, author)?;
                self.delete_from_comments(*p, &text)
            }
            Piece::Comment { p, text, thread } => {
                let text = units(text);
                match self
                    .comments
                    .iter_mut()
                    .find(|comment| comment.thread == *thread)
                {
                    Some(comment) => {
                        comment.at = *p;
                        comment.text = text;
                    }
                    None => {
                        let thread = if thread.is_empty() {
                            self.next_id().unwrap_or_default()
                        } else {
                            thread.clone()
                        };
                        self.comments.push(CommentAnchor {
                            thread,
                            at: *p,
                            text,
                            user: author.user.map(str::to_string),
                            ts: author.ts,
                        });
                    }
                }
                Ok(())
            }
        }
    }

    fn add(&mut self, mut change: TrackedChange) {
        change.key = self.key();
        change.id = self.next_id();
        self.changes.push(change);
        self.changes.sort_by(|a, b| {
            a.at.cmp(&b.at).then_with(|| match (a.kind, b.kind) {
                (ChangeKind::Delete, ChangeKind::Insert) => std::cmp::Ordering::Less,
                (ChangeKind::Insert, ChangeKind::Delete) => std::cmp::Ordering::Greater,
                _ => std::cmp::Ordering::Equal,
            })
        });
    }

    fn insert_into_changes(&mut self, p: usize, text: &[u16], undo: bool, author: &Author) {
        let mut pass = InsertPass {
            p,
            text,
            tracked: author.tracked,
            undo,
            user: author.user,
            ts: author.ts,
            merged: false,
            previous: None,
            deletes_here: Vec::new(),
            emptied: Vec::new(),
            split: Vec::new(),
        };
        for index in 0..self.changes.len() {
            match self.changes[index].kind {
                ChangeKind::Delete => self.insert_at_delete(index, &mut pass),
                ChangeKind::Insert => self.insert_at_insert(index, &mut pass),
            }
            pass.previous = Some(index);
        }
        if author.tracked && !pass.merged {
            self.add(TrackedChange {
                key: 0,
                id: None,
                kind: ChangeKind::Insert,
                at: p,
                text: text.to_vec(),
                user: author.user.map(str::to_string),
                ts: author.ts,
            });
        }
        for change in pass.split {
            self.add(change);
        }
        self.changes
            .retain(|change| !pass.emptied.contains(&change.key));
    }

    fn insert_at_delete(&mut self, index: usize, pass: &mut InsertPass) {
        let length = pass.text.len();
        let change = &mut self.changes[index];
        if pass.p < change.at {
            change.at += length;
            return;
        }
        if pass.p != change.at {
            return;
        }
        if !pass.merged && pass.undo && change.text.starts_with(pass.text) {
            change.text.drain(..length);
            change.at += length;
            if change.text.is_empty() {
                pass.emptied.push(change.key);
            }
            pass.merged = true;
            for &earlier in &pass.deletes_here {
                self.changes[earlier].at -= length;
            }
            return;
        }
        change.at += length;
        if !pass.merged {
            pass.deletes_here.push(index);
        }
    }

    fn cancels_next_delete(&self, index: usize, change_end: usize, pass: &InsertPass) -> bool {
        let Some(next) = self.changes.get(index + 1) else {
            return false;
        };
        next.kind == ChangeKind::Delete
            && pass.p == change_end
            && next.at == pass.p
            && next.text.starts_with(pass.text)
    }

    fn blocked_by_delete(&self, pass: &InsertPass) -> bool {
        let end = pass.p + pass.text.len();
        pass.previous.is_some_and(|before| {
            self.changes[before].kind == ChangeKind::Delete && self.changes[before].at == end
        })
    }

    fn insert_at_insert(&mut self, index: usize, pass: &mut InsertPass) {
        let p = pass.p;
        let start = self.changes[index].at;
        let change_end = start + self.changes[index].text.len();
        let overlapping = p >= start && p <= change_end;
        let same_user = pass.user == self.changes[index].user.as_deref();
        let cancels_next = pass.undo && self.cancels_next_delete(index, change_end, pass);
        let blocked = self.blocked_by_delete(pass);
        let merges = pass.tracked && overlapping && !blocked && !pass.merged && !cancels_next;
        let change = &mut self.changes[index];
        if merges && same_user {
            let offset = p - start;
            change
                .text
                .splice(offset..offset, pass.text.iter().copied());
            change.ts = earlier(change.ts, pass.ts);
            pass.merged = true;
        } else if p <= start {
            change.at += pass.text.len();
        } else if (!same_user || !pass.tracked) && start < p && p < change_end {
            let offset = p - start;
            let after = change.text.split_off(offset);
            pass.split.push(TrackedChange {
                key: 0,
                id: None,
                kind: ChangeKind::Insert,
                at: start + offset + pass.text.len(),
                text: after,
                user: change.user.clone(),
                ts: change.ts,
            });
        }
    }

    fn delete_from_changes(
        &mut self,
        p: usize,
        deleted: &[u16],
        author: &Author,
    ) -> Result<(), CodecError> {
        let mut pass = DeletePass {
            p,
            deleted,
            tracked: author.tracked,
            removed: Vec::new(),
            edits: Vec::new(),
        };
        for change in &mut self.changes {
            match change.kind {
                ChangeKind::Insert => delete_over_insert(change, &mut pass),
                ChangeKind::Delete => delete_over_delete(change, &mut pass),
            }
        }
        let remaining = apply_edits(deleted, pass.edits)?;
        let remaining = self.reuse_removed_delete(pass.removed, remaining, p, author);
        if author.tracked && !remaining.is_empty() {
            self.add(TrackedChange {
                key: 0,
                id: None,
                kind: ChangeKind::Delete,
                at: p,
                text: remaining,
                user: author.user.map(str::to_string),
                ts: author.ts,
            });
        } else {
            self.merge_neighbours();
        }
        Ok(())
    }

    fn reuse_removed_delete(
        &mut self,
        removed: Vec<u64>,
        mut remaining: Vec<u16>,
        p: usize,
        author: &Author,
    ) -> Vec<u16> {
        let mut dropped: Vec<u64> = Vec::new();
        for key in removed {
            let Some(change) = self.changes.iter_mut().find(|change| change.key == key) else {
                continue;
            };
            let reusable = change.kind == ChangeKind::Delete
                && p <= change.at
                && change.at <= p + remaining.len();
            if !remaining.is_empty() && reusable {
                change.at = p;
                change.text = std::mem::take(&mut remaining);
                change.user = author.user.map(str::to_string);
                change.ts = author.ts;
            } else {
                dropped.push(key);
            }
        }
        self.changes.retain(|change| !dropped.contains(&change.key));
        remaining
    }

    fn merge_neighbours(&mut self) {
        let mut previous: Option<usize> = None;
        let mut dropped: Vec<usize> = Vec::new();
        for index in 0..self.changes.len() {
            let Some(before) = previous else {
                previous = Some(index);
                continue;
            };
            let (left, right) = self.changes.split_at_mut(index);
            let (earlier_change, current) = (&mut left[before], &mut right[0]);
            match (earlier_change.kind, current.kind) {
                (ChangeKind::Insert, ChangeKind::Insert) => {
                    if earlier_change.at + earlier_change.text.len() == current.at
                        && earlier_change.user == current.user
                    {
                        earlier_change.text.extend_from_slice(&current.text);
                        earlier_change.ts = earlier(earlier_change.ts, current.ts);
                        dropped.push(index);
                    }
                }
                (ChangeKind::Delete, ChangeKind::Delete) if earlier_change.at == current.at => {
                    earlier_change.text.extend_from_slice(&current.text);
                    dropped.push(index);
                }
                _ => previous = Some(index),
            }
        }
        let mut index = 0;
        self.changes.retain(|_| {
            let keep = !dropped.contains(&index);
            index += 1;
            keep
        });
    }

    fn insert_into_comments(&mut self, p: usize, text: &[u16]) {
        for comment in &mut self.comments {
            if p <= comment.at {
                comment.at += text.len();
            } else if p < comment.at + comment.text.len() {
                let offset = p - comment.at;
                comment.text.splice(offset..offset, text.iter().copied());
            }
        }
    }

    fn delete_from_comments(&mut self, p: usize, deleted: &[u16]) -> Result<(), CodecError> {
        let length = deleted.len();
        let end = p + length;
        for comment in &mut self.comments {
            let start = comment.at;
            let comment_end = start + comment.text.len();
            if end <= start {
                comment.at -= length;
            } else if p < comment_end {
                let before = p.saturating_sub(start);
                let after = if end >= comment_end {
                    comment.text.len()
                } else {
                    end - start
                };
                let offset = start.saturating_sub(p);
                let cut = &comment.text[before..after];
                let matching = deleted.get(offset..offset + cut.len());
                if matching != Some(cut) {
                    return Err(CodecError::Mismatch);
                }
                comment.text.drain(before..after);
                comment.at = start.min(p);
            }
        }
        Ok(())
    }
}

struct InsertPass<'a> {
    p: usize,
    text: &'a [u16],
    tracked: bool,
    undo: bool,
    user: Option<&'a str>,
    ts: Option<i64>,
    merged: bool,
    previous: Option<usize>,
    deletes_here: Vec<usize>,
    emptied: Vec<u64>,
    split: Vec<TrackedChange>,
}

struct DeletePass<'a> {
    p: usize,
    deleted: &'a [u16],
    tracked: bool,
    removed: Vec<u64>,
    edits: Vec<Edit>,
}

fn delete_over_insert(change: &mut TrackedChange, pass: &mut DeletePass) {
    let (p, length) = (pass.p, pass.deleted.len());
    let end = p + length;
    let start = change.at;
    let change_end = start + change.text.len();
    if end <= start {
        change.at -= length;
        return;
    }
    if p >= change_end {
        return;
    }
    let (kept_before, inserted_before) = if p >= start {
        (0, change.text[..p - start].to_vec())
    } else {
        (start - p, Vec::new())
    };
    let (kept_after, inserted_after) = if end <= change_end {
        (0, change.text[end - start..].to_vec())
    } else {
        (end - change_end, Vec::new())
    };
    let mut remaining = inserted_before;
    remaining.extend(inserted_after);
    if remaining.is_empty() {
        pass.removed.push(change.key);
    } else {
        change.text = remaining;
        change.at = start.min(p);
    }
    let cut = length - kept_before - kept_after;
    if cut > 0 {
        pass.edits.push(Edit::Delete {
            at: kept_before,
            text: pass.deleted[kept_before..kept_before + cut].to_vec(),
        });
    }
}

fn delete_over_delete(change: &mut TrackedChange, pass: &mut DeletePass) {
    let end = pass.p + pass.deleted.len();
    let start = change.at;
    if end < start || (!pass.tracked && end == start) {
        change.at -= pass.deleted.len();
    } else if pass.p <= start && start <= end {
        if pass.tracked {
            pass.edits.push(Edit::Insert {
                at: start - pass.p,
                text: change.text.clone(),
            });
            pass.removed.push(change.key);
        } else {
            change.at = pass.p;
        }
    }
}

fn apply_edits(content: &[u16], mut edits: Vec<Edit>) -> Result<Vec<u16>, CodecError> {
    let at = |edit: &Edit| match edit {
        Edit::Insert { at, .. } | Edit::Delete { at, .. } => *at,
    };
    edits.sort_by(|a, b| {
        at(b).cmp(&at(a)).then_with(|| match (a, b) {
            (Edit::Insert { .. }, Edit::Delete { .. }) => std::cmp::Ordering::Greater,
            (Edit::Delete { .. }, Edit::Insert { .. }) => std::cmp::Ordering::Less,
            _ => std::cmp::Ordering::Equal,
        })
    });
    let mut content = content.to_vec();
    for edit in edits {
        match edit {
            Edit::Insert { at, text } => {
                let at = at.min(content.len());
                content.splice(at..at, text);
            }
            Edit::Delete { at, text } => {
                if content.get(at..at + text.len()) != Some(text.as_slice()) {
                    return Err(CodecError::Mismatch);
                }
                content.drain(at..at + text.len());
            }
        }
    }
    Ok(content)
}
