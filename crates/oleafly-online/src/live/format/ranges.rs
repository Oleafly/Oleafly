use serde_json::Value;

use super::{unpack, CodecError, Piece};

pub const MAX_COMMENTS: usize = 500;
pub const MAX_CHANGES: usize = 2_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommentAnchor {
    pub thread: String,
    pub at: usize,
    pub text: Vec<u16>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChangeKind {
    Insert,
    Delete,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrackedChange {
    key: u64,
    pub kind: ChangeKind,
    pub at: usize,
    pub text: Vec<u16>,
    pub user: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ShareJsRanges {
    comments: Vec<CommentAnchor>,
    changes: Vec<TrackedChange>,
    next_key: u64,
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
        .map(|at| at as usize)
        .ok_or_else(|| CodecError::Malformed("a range has no position".into()))
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
            parsed.comments.push(CommentAnchor {
                thread,
                at: position(&op["p"])?,
                text: packed_units(&op["c"])?.unwrap_or_default(),
            });
        }
        for change in list("changes").unwrap_or_default() {
            let op = &change["op"];
            let user = change
                .pointer("/metadata/user_id")
                .and_then(Value::as_str)
                .map(str::to_string);
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
                kind,
                at,
                text,
                user,
            });
        }
        Ok(parsed)
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

    fn key(&mut self) -> u64 {
        self.next_key += 1;
        self.next_key
    }

    pub(crate) fn apply(
        &mut self,
        piece: &Piece,
        tracked: bool,
        user: Option<&str>,
    ) -> Result<(), CodecError> {
        match piece {
            Piece::Insert { p, text, undo } => {
                let text = units(text);
                self.insert_into_changes(*p, &text, tracked, *undo, user);
                self.insert_into_comments(*p, &text);
                Ok(())
            }
            Piece::Delete { p, text, .. } => {
                let text = units(text);
                self.delete_from_changes(*p, &text, tracked, user)?;
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
                    None => self.comments.push(CommentAnchor {
                        thread: thread.clone(),
                        at: *p,
                        text,
                    }),
                }
                Ok(())
            }
        }
    }

    fn add(&mut self, kind: ChangeKind, at: usize, text: Vec<u16>, user: Option<String>) {
        let key = self.key();
        self.changes.push(TrackedChange {
            key,
            kind,
            at,
            text,
            user,
        });
        self.changes.sort_by(|a, b| {
            a.at.cmp(&b.at).then_with(|| match (a.kind, b.kind) {
                (ChangeKind::Delete, ChangeKind::Insert) => std::cmp::Ordering::Less,
                (ChangeKind::Insert, ChangeKind::Delete) => std::cmp::Ordering::Greater,
                _ => std::cmp::Ordering::Equal,
            })
        });
    }

    fn insert_into_changes(
        &mut self,
        p: usize,
        text: &[u16],
        tracked: bool,
        undo: bool,
        user: Option<&str>,
    ) {
        let length = text.len();
        let end = p + length;
        let mut merged = false;
        let mut previous: Option<usize> = None;
        let mut deletes_here: Vec<usize> = Vec::new();
        let mut emptied: Vec<u64> = Vec::new();
        let mut split: Vec<TrackedChange> = Vec::new();
        for index in 0..self.changes.len() {
            match self.changes[index].kind {
                ChangeKind::Delete => {
                    let change = &mut self.changes[index];
                    if p < change.at {
                        change.at += length;
                    } else if p == change.at {
                        if !merged && undo && change.text.starts_with(text) {
                            change.text.drain(..length);
                            change.at += length;
                            if change.text.is_empty() {
                                emptied.push(change.key);
                            }
                            merged = true;
                            for &earlier in &deletes_here {
                                self.changes[earlier].at -= length;
                            }
                        } else {
                            change.at += length;
                            if !merged {
                                deletes_here.push(index);
                            }
                        }
                    }
                }
                ChangeKind::Insert => {
                    let start = self.changes[index].at;
                    let change_end = start + self.changes[index].text.len();
                    let overlapping = p >= start && p <= change_end;
                    let same_user = user == self.changes[index].user.as_deref();
                    let cancels_next = undo
                        && self.changes.get(index + 1).is_some_and(|next| {
                            next.kind == ChangeKind::Delete
                                && p == change_end
                                && next.at == p
                                && next.text.starts_with(text)
                        });
                    let blocked = previous.is_some_and(|before| {
                        self.changes[before].kind == ChangeKind::Delete
                            && self.changes[before].at == end
                    });
                    let change = &mut self.changes[index];
                    if tracked && overlapping && !blocked && !merged && !cancels_next && same_user {
                        let offset = p - start;
                        change.text.splice(offset..offset, text.iter().copied());
                        merged = true;
                    } else if p <= start {
                        change.at += length;
                    } else if (!same_user || !tracked) && start < p && p < change_end {
                        let offset = p - start;
                        let after = change.text.split_off(offset);
                        split.push(TrackedChange {
                            key: 0,
                            kind: ChangeKind::Insert,
                            at: start + offset + length,
                            text: after,
                            user: change.user.clone(),
                        });
                    }
                }
            }
            previous = Some(index);
        }
        if tracked && !merged {
            self.add(
                ChangeKind::Insert,
                p,
                text.to_vec(),
                user.map(str::to_string),
            );
        }
        for change in split {
            self.add(change.kind, change.at, change.text, change.user);
        }
        self.changes.retain(|change| !emptied.contains(&change.key));
    }

    fn delete_from_changes(
        &mut self,
        p: usize,
        deleted: &[u16],
        tracked: bool,
        user: Option<&str>,
    ) -> Result<(), CodecError> {
        let length = deleted.len();
        let end = p + length;
        let mut removed: Vec<u64> = Vec::new();
        let mut edits: Vec<Edit> = Vec::new();
        for change in &mut self.changes {
            let start = change.at;
            match change.kind {
                ChangeKind::Insert => {
                    let change_end = start + change.text.len();
                    if end <= start {
                        change.at -= length;
                    } else if p < change_end {
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
                            removed.push(change.key);
                        } else {
                            change.text = remaining;
                            change.at = start.min(p);
                        }
                        let cut = length - kept_before - kept_after;
                        if cut > 0 {
                            edits.push(Edit::Delete {
                                at: kept_before,
                                text: deleted[kept_before..kept_before + cut].to_vec(),
                            });
                        }
                    }
                }
                ChangeKind::Delete => {
                    if end < start || (!tracked && end == start) {
                        change.at -= length;
                    } else if p <= start && start <= end {
                        if tracked {
                            edits.push(Edit::Insert {
                                at: start - p,
                                text: change.text.clone(),
                            });
                            removed.push(change.key);
                        } else {
                            change.at = p;
                        }
                    }
                }
            }
        }
        let mut remaining = apply_edits(deleted, edits)?;
        let mut dropped: Vec<u64> = Vec::new();
        for key in removed {
            let Some(change) = self.changes.iter_mut().find(|change| change.key == key) else {
                continue;
            };
            if !remaining.is_empty()
                && change.kind == ChangeKind::Delete
                && p <= change.at
                && change.at <= p + remaining.len()
            {
                change.at = p;
                change.text = std::mem::take(&mut remaining);
                change.user = user.map(str::to_string);
            } else {
                dropped.push(key);
            }
        }
        self.changes.retain(|change| !dropped.contains(&change.key));
        if tracked && !remaining.is_empty() {
            self.add(ChangeKind::Delete, p, remaining, user.map(str::to_string));
        } else {
            self.merge_neighbours();
        }
        Ok(())
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
            let (earlier, current) = (&mut left[before], &mut right[0]);
            match (earlier.kind, current.kind) {
                (ChangeKind::Insert, ChangeKind::Insert) => {
                    if earlier.at + earlier.text.len() == current.at && earlier.user == current.user
                    {
                        earlier.text.extend_from_slice(&current.text);
                        dropped.push(index);
                    }
                }
                (ChangeKind::Delete, ChangeKind::Delete) if earlier.at == current.at => {
                    earlier.text.extend_from_slice(&current.text);
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
