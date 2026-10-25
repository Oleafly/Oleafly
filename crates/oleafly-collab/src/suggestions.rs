use std::collections::{BTreeMap, BTreeSet, HashMap};

use loro::cursor::{Cursor, PosType, Side};
use loro::event::ContainerDiff;
use loro::{
    Container, ContainerID, ContainerTrait, Index, LoroMap, LoroText, LoroValue, ValueOrContainer,
};
use oleafly_collab_protocol::ids::{AccountId, CommentId, DeviceId, SuggestionId};
use serde::{Deserialize, Serialize};

use crate::comments::{number_of, parsed, string_of, CommentThread};
use crate::doc::ProjectDoc;
use crate::ot::{utf16_len, Component, TextOperation};
use crate::CollabError;

pub const SUGGESTIONS: &str = "suggestions";
pub const MAX_DELETED_CHARS: usize = 20_000;
const FILE_ID: &str = "file_id";
const KIND: &str = "kind";
const AUTHOR: &str = "author";
const DEVICE: &str = "device";
const CREATED_AT: &str = "created_at";
const START: &str = "start";
const END: &str = "end";
const ANCHOR: &str = "anchor";
const TEXT: &str = "text";
const THREAD_ID: &str = "thread_id";
const INSERT: &str = "insert";
const DELETE: &str = "delete";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SuggestionKind {
    Insert,
    Delete,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EditMode {
    #[default]
    Editing,
    Suggesting,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub id: SuggestionId,
    pub file_id: String,
    pub kind: SuggestionKind,
    pub author: AccountId,
    pub created_at: i64,
    pub from: usize,
    pub to: usize,
    pub text: String,
    pub thread_id: Option<CommentId>,
    pub verified: bool,
}

struct Record {
    id: SuggestionId,
    map: LoroMap,
    file: String,
    kind: SuggestionKind,
    author: AccountId,
    created_at: i64,
    start: Option<Vec<u8>>,
    end: Option<Vec<u8>>,
    anchor: Option<Vec<u8>>,
    text: String,
    thread: Option<CommentId>,
}

struct DeleteGroup {
    map: Option<LoroMap>,
    text: String,
    at: usize,
}

struct Shrunk {
    map: LoroMap,
    from: usize,
    to: usize,
}

fn loro_error<T: std::fmt::Debug>(error: T) -> CollabError {
    CollabError::Corrupt(format!("{error:?}"))
}

fn refused(status: u16, code: &str, message: &str) -> CollabError {
    CollabError::Api {
        status,
        code: code.to_owned(),
        message: message.to_owned(),
    }
}

pub(crate) fn suggestion_gone() -> CollabError {
    refused(404, "suggestion_not_found", "this suggestion is gone")
}

fn not_yours() -> CollabError {
    refused(
        403,
        "suggestion_not_yours",
        "only the person who made a suggestion can withdraw it",
    )
}

fn changed_under() -> CollabError {
    refused(
        409,
        "suggestion_changed",
        "the text around this suggestion changed, so an owner or editor decides on it",
    )
}

fn too_long() -> CollabError {
    refused(
        413,
        "too_large",
        "a suggested deletion can hold at most 20,000 characters",
    )
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

fn binary(value: Option<&LoroValue>) -> Option<Vec<u8>> {
    match value {
        Some(LoroValue::Binary(bytes)) => Some(bytes.to_vec()),
        _ => None,
    }
}

fn read_record(key: &str, map: LoroMap) -> Option<Record> {
    let LoroValue::Map(fields) = map.get_deep_value() else {
        return None;
    };
    let kind = match string_of(fields.get(KIND)).as_deref() {
        Some(INSERT) => SuggestionKind::Insert,
        Some(DELETE) => SuggestionKind::Delete,
        _ => return None,
    };
    Some(Record {
        id: key.parse().ok()?,
        file: string_of(fields.get(FILE_ID))?,
        kind,
        author: parsed(fields.get(AUTHOR))?,
        created_at: number_of(fields.get(CREATED_AT)).unwrap_or_default(),
        start: binary(fields.get(START)),
        end: binary(fields.get(END)),
        anchor: binary(fields.get(ANCHOR)),
        text: string_of(fields.get(TEXT)).unwrap_or_default(),
        thread: parsed(fields.get(THREAD_ID)),
        map,
    })
}

fn start_cursor(text: &LoroText, from: usize) -> Result<Vec<u8>, CollabError> {
    text.get_cursor(from, Side::Left)
        .map(|cursor| cursor.encode())
        .ok_or_else(|| CollabError::Corrupt("a suggestion starts past its text".to_owned()))
}

fn end_cursor(text: &LoroText, to: usize) -> Result<Vec<u8>, CollabError> {
    to.checked_sub(1)
        .and_then(|last| text.get_cursor(last, Side::Right))
        .map(|cursor| cursor.encode())
        .ok_or_else(|| CollabError::Corrupt("a suggestion ends past its text".to_owned()))
}

fn anchor_cursor(text: &LoroText, at: usize) -> Result<Vec<u8>, CollabError> {
    let length = text.len_unicode();
    let cursor = if at < length {
        text.get_cursor(at, Side::Left)
    } else if length > 0 {
        text.get_cursor(length - 1, Side::Right)
    } else {
        text.get_cursor(0, Side::Left)
    };
    cursor
        .map(|cursor| cursor.encode())
        .ok_or_else(|| CollabError::Corrupt("a suggestion is anchored past its text".to_owned()))
}

fn write_range(map: &LoroMap, text: &LoroText, from: usize, to: usize) -> Result<(), CollabError> {
    map.insert(START, LoroValue::from(start_cursor(text, from)?))
        .map_err(loro_error)?;
    map.insert(END, LoroValue::from(end_cursor(text, to)?))
        .map_err(loro_error)?;
    Ok(())
}

fn unicode_of(text: &LoroText, utf16: usize) -> Result<usize, CollabError> {
    text.convert_pos(utf16, PosType::Utf16, PosType::Unicode)
        .ok_or_else(|| CollabError::Corrupt("a change splits a character".to_owned()))
}

fn utf16_of(text: &LoroText, unicode: usize) -> Option<usize> {
    text.convert_pos(unicode, PosType::Unicode, PosType::Utf16)
}

fn is_suggestions_root(id: &ContainerID) -> bool {
    matches!(id, ContainerID::Root { name, .. } if name.as_str() == SUGGESTIONS)
}

pub(crate) fn record(ids: &mut BTreeSet<String>, change: &ContainerDiff<'_>) -> bool {
    let rooted = match change.path.first() {
        Some((root, _)) => is_suggestions_root(root),
        None => is_suggestions_root(change.target),
    };
    if !rooted {
        return false;
    }
    match change.path.get(1) {
        None => {
            if let loro::event::Diff::Map(delta) = &change.diff {
                ids.extend(delta.updated.keys().map(ToString::to_string));
            }
        }
        Some((_, Index::Key(key))) => {
            ids.insert(key.to_string());
        }
        Some(_) => {}
    }
    true
}

impl ProjectDoc {
    fn suggestion_map(&self) -> LoroMap {
        self.loro().get_map(SUGGESTIONS)
    }

    fn records(&self) -> Vec<Record> {
        let mut found = Vec::new();
        self.suggestion_map().for_each(|key, value| {
            if let ValueOrContainer::Container(Container::Map(map)) = value {
                if let Some(record) = read_record(key, map) {
                    found.push(record);
                }
            }
        });
        found
    }

    fn records_in(&self, file_id: &str) -> Vec<Record> {
        self.records()
            .into_iter()
            .filter(|record| record.file == file_id)
            .collect()
    }

    fn record_of(&self, id: SuggestionId) -> Result<Record, CollabError> {
        match self.suggestion_map().get(&id.to_string()) {
            Some(ValueOrContainer::Container(Container::Map(map))) => {
                read_record(&id.to_string(), map).ok_or_else(suggestion_gone)
            }
            _ => Err(suggestion_gone()),
        }
    }

    pub(crate) fn index_suggestions(&self) -> HashMap<String, String> {
        self.records()
            .into_iter()
            .map(|record| (record.id.to_string(), record.file))
            .collect()
    }

    fn spot(&self, stored: Option<&[u8]>) -> Option<usize> {
        self.anchors().position(self.loro(), stored?)
    }

    fn live_spot(&self, text: &LoroText, stored: Option<&[u8]>) -> Option<usize> {
        let cursor = Cursor::decode(stored?).ok()?;
        if cursor.container != text.id() {
            return None;
        }
        let found = self.loro().get_cursor_pos(&cursor).ok()?;
        if found.update.is_some() {
            return None;
        }
        let at = found.current.pos;
        Some(if cursor.id.is_none() || found.current.side == Side::Left {
            at
        } else {
            at + 1
        })
    }

    fn range(&self, record: &Record) -> Option<(usize, usize)> {
        let from = self.spot(record.start.as_deref())?;
        let to = self.spot(record.end.as_deref())?;
        (from < to).then_some((from, to))
    }

    fn live_range(&self, text: &LoroText, record: &Record) -> Option<(usize, usize)> {
        let from = self.live_spot(text, record.start.as_deref())?;
        let to = self.live_spot(text, record.end.as_deref())?;
        (from < to).then_some((from, to))
    }

    fn new_record(
        &self,
        file_id: &str,
        kind: &str,
        author: AccountId,
        device: Option<DeviceId>,
        at: i64,
    ) -> Result<LoroMap, CollabError> {
        let id = SuggestionId::new_v7().to_string();
        let map = self
            .suggestion_map()
            .insert_container(&id, LoroMap::new())
            .map_err(loro_error)?;
        map.insert(FILE_ID, file_id).map_err(loro_error)?;
        map.insert(KIND, kind).map_err(loro_error)?;
        map.insert(AUTHOR, author.to_string()).map_err(loro_error)?;
        if let Some(device) = device {
            map.insert(DEVICE, device.to_string()).map_err(loro_error)?;
        }
        map.insert(CREATED_AT, at).map_err(loro_error)?;
        self.suggestion_index().insert(id, file_id.to_owned());
        Ok(map)
    }

    fn own_inserts(&self, text: &LoroText, file_id: &str, author: AccountId) -> Vec<Shrunk> {
        self.records_in(file_id)
            .into_iter()
            .filter(|record| record.kind == SuggestionKind::Insert && record.author == author)
            .filter_map(|record| {
                let (from, to) = self.live_range(text, &record)?;
                Some(Shrunk {
                    map: record.map,
                    from,
                    to,
                })
            })
            .collect()
    }

    fn own_deletes(&self, text: &LoroText, file_id: &str, author: AccountId) -> Vec<Record> {
        self.records_in(file_id)
            .into_iter()
            .filter(|record| {
                record.kind == SuggestionKind::Delete
                    && record.author == author
                    && self.live_spot(text, record.anchor.as_deref()).is_some()
            })
            .collect()
    }

    #[allow(clippy::too_many_arguments)]
    fn suggest_insert(
        &self,
        text: &LoroText,
        file_id: &str,
        at: usize,
        inserted: &str,
        author: AccountId,
        device: Option<DeviceId>,
        now: i64,
    ) -> Result<(), CollabError> {
        let count = inserted.chars().count();
        if count == 0 {
            return Ok(());
        }
        let own = self.own_inserts(text, file_id, author);
        let chosen = own
            .iter()
            .find(|range| range.to == at)
            .or_else(|| own.iter().find(|range| range.from < at && at < range.to))
            .or_else(|| own.iter().find(|range| range.from == at));
        text.insert(at, inserted).map_err(loro_error)?;
        match chosen {
            Some(range) => write_range(&range.map, text, range.from.min(at), range.to + count),
            None => {
                let map = self.new_record(file_id, INSERT, author, device, now)?;
                write_range(&map, text, at, at + count)
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn suggest_delete(
        &self,
        text: &LoroText,
        file_id: &str,
        from: usize,
        to: usize,
        author: AccountId,
        device: Option<DeviceId>,
        now: i64,
    ) -> Result<(), CollabError> {
        if from >= to {
            return Ok(());
        }
        let own = self.own_inserts(text, file_id, author);
        let mut points: BTreeSet<usize> = BTreeSet::from([from, to]);
        for range in &own {
            for point in [range.from, range.to] {
                if from < point && point < to {
                    points.insert(point);
                }
            }
        }
        let points: Vec<usize> = points.into_iter().collect();
        let segments: Vec<(usize, usize, Option<usize>)> = points
            .windows(2)
            .map(|pair| {
                let (start, end) = (pair[0], pair[1]);
                let inside = own
                    .iter()
                    .enumerate()
                    .filter(|(_, range)| range.from <= start && end <= range.to)
                    .min_by_key(|(_, range)| range.to - range.from)
                    .map(|(index, _)| index);
                (start, end, inside)
            })
            .collect();
        let outside: usize = segments
            .iter()
            .filter(|(_, _, inside)| inside.is_none())
            .map(|(start, end, _)| end - start)
            .sum();
        let nearby: usize = self
            .own_deletes(text, file_id, author)
            .iter()
            .filter(|record| {
                self.live_spot(text, record.anchor.as_deref())
                    .is_some_and(|at| from <= at && at <= to)
            })
            .map(|record| record.text.chars().count())
            .sum();
        if outside + nearby > MAX_DELETED_CHARS {
            return Err(too_long());
        }
        let mut groups: Vec<DeleteGroup> = Vec::new();
        let mut used: BTreeSet<String> = BTreeSet::new();
        let mut deleted_before: Vec<(usize, usize)> = Vec::new();
        for (start, end, inside) in segments.into_iter().rev() {
            let length = end - start;
            if inside.is_none() {
                let removed = text.slice(start, end).map_err(loro_error)?;
                let current = groups.iter().position(|group| group.at == end);
                match current {
                    Some(index) => {
                        let group = &mut groups[index];
                        group.text.insert_str(0, &removed);
                        group.at = start;
                    }
                    None => {
                        let deletes = self.own_deletes(text, file_id, author);
                        let spot = |record: &Record| {
                            self.live_spot(text, record.anchor.as_deref())
                                .unwrap_or(usize::MAX)
                        };
                        let fresh = |record: &&Record| !used.contains(&record.id.to_string());
                        let before = deletes
                            .iter()
                            .filter(fresh)
                            .find(|record| spot(record) == end);
                        let after = deletes
                            .iter()
                            .filter(fresh)
                            .find(|record| spot(record) == start);
                        let group = match (before, after) {
                            (Some(record), _) => DeleteGroup {
                                map: Some(record.map.clone()),
                                text: format!("{removed}{}", record.text),
                                at: start,
                            },
                            (None, Some(record)) => DeleteGroup {
                                map: Some(record.map.clone()),
                                text: format!("{}{removed}", record.text),
                                at: start,
                            },
                            (None, None) => DeleteGroup {
                                map: None,
                                text: removed,
                                at: start,
                            },
                        };
                        if let Some(record) = before.or(after) {
                            used.insert(record.id.to_string());
                        }
                        for other in &mut groups {
                            if other.at >= end {
                                other.at -= length;
                            }
                        }
                        groups.push(group);
                        text.delete(start, length).map_err(loro_error)?;
                        deleted_before.push((start, end));
                        continue;
                    }
                }
            }
            for group in &mut groups {
                if group.at >= end {
                    group.at -= length;
                }
            }
            text.delete(start, length).map_err(loro_error)?;
            deleted_before.push((start, end));
        }
        let shift = |point: usize| -> usize {
            point
                - deleted_before
                    .iter()
                    .filter(|(_, end)| *end <= point)
                    .map(|(start, end)| end - start)
                    .sum::<usize>()
        };
        for range in &own {
            let touched = deleted_before
                .iter()
                .any(|(start, end)| range.from <= *start && *end <= range.to);
            if !touched {
                continue;
            }
            let (left, right) = (shift(range.from), shift(range.to));
            if left >= right {
                self.drop_record_map(&range.map)?;
            } else {
                write_range(&range.map, text, left, right)?;
            }
        }
        for group in groups {
            let map = match group.map {
                Some(map) => map,
                None => self.new_record(file_id, DELETE, author, device, now)?,
            };
            map.insert(TEXT, group.text).map_err(loro_error)?;
            map.insert(ANCHOR, LoroValue::from(anchor_cursor(text, group.at)?))
                .map_err(loro_error)?;
        }
        Ok(())
    }

    fn drop_record_map(&self, map: &LoroMap) -> Result<(), CollabError> {
        let id = map.id();
        let mut key = None;
        self.suggestion_map().for_each(|found, value| {
            if let ValueOrContainer::Container(Container::Map(other)) = value {
                if other.id() == id {
                    key = Some(found.to_owned());
                }
            }
        });
        if let Some(key) = key {
            self.suggestion_map().delete(&key).map_err(loro_error)?;
        }
        Ok(())
    }

    pub fn suggest_operation(
        &mut self,
        file_id: &str,
        operation: &TextOperation,
        author: AccountId,
        device: Option<DeviceId>,
        now: i64,
    ) -> Result<(), CollabError> {
        self.writable()?;
        let text = self.text_of(file_id)?;
        if text.len_utf16() != operation.base_len() {
            return Err(CollabError::Corrupt(format!(
                "a change for {file_id} does not fit its text"
            )));
        }
        let mut position = 0;
        let outcome = (|| {
            for component in operation.components() {
                match component {
                    Component::Retain(count) => position += count,
                    Component::Insert(inserted) => {
                        let at = unicode_of(&text, position)?;
                        self.suggest_insert(&text, file_id, at, inserted, author, device, now)?;
                        position += utf16_len(inserted);
                    }
                    Component::Delete(count) => {
                        let from = unicode_of(&text, position)?;
                        let to = unicode_of(&text, position + count)?;
                        self.suggest_delete(&text, file_id, from, to, author, device, now)?;
                    }
                }
                self.loro().commit();
            }
            Ok(())
        })();
        self.loro().commit();
        outcome
    }

    pub fn suggest_text(
        &mut self,
        file_id: &str,
        content: &str,
        author: AccountId,
        device: Option<DeviceId>,
        now: i64,
    ) -> Result<TextOperation, CollabError> {
        let current = self.text(file_id)?;
        let operation = TextOperation::between(&current, content);
        if !operation.is_noop() {
            self.suggest_operation(file_id, &operation, author, device, now)?;
        }
        Ok(operation)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn reply_to_suggestion(
        &mut self,
        id: SuggestionId,
        author: AccountId,
        at: i64,
        body: &str,
        mentions: &[AccountId],
        link: bool,
    ) -> Result<CommentThread, CollabError> {
        self.writable()?;
        let record = self.record_of(id)?;
        let key = id.to_string();
        let existing = record
            .thread
            .filter(|thread| {
                self.comment_thread(&record.file, *thread)
                    .ok()
                    .flatten()
                    .is_some()
            })
            .or_else(|| self.suggestion_threads(&record.file).get(&key).copied());
        let thread = match existing {
            Some(thread) => {
                self.reply_to_comment(&record.file, thread, author, at, body, mentions)?;
                thread
            }
            None => {
                let (start, end, quote) = match record.kind {
                    SuggestionKind::Insert => {
                        let text = self.text_of(&record.file)?;
                        let quote = self
                            .range(&record)
                            .and_then(|(from, to)| text.slice(from, to).ok())
                            .unwrap_or_default();
                        let (Some(start), Some(end)) = (record.start.clone(), record.end.clone())
                        else {
                            return Err(suggestion_gone());
                        };
                        (start, end, quote)
                    }
                    SuggestionKind::Delete => {
                        let Some(anchor) = record.anchor.clone() else {
                            return Err(suggestion_gone());
                        };
                        (anchor.clone(), anchor, record.text.clone())
                    }
                };
                let thread = self.open_suggestion_thread(
                    &record.file,
                    &start,
                    &end,
                    &quote,
                    &key,
                    author,
                    at,
                    body,
                    mentions,
                )?;
                if link {
                    record
                        .map
                        .insert(THREAD_ID, thread.to_string())
                        .map_err(loro_error)?;
                }
                self.loro().commit();
                thread
            }
        };
        self.comment_thread(&record.file, thread)?
            .ok_or_else(suggestion_gone)
    }

    pub fn suggestions(&self, file_id: &str) -> Result<Vec<Suggestion>, CollabError> {
        let text = self.text_of(file_id)?;
        let judge = self.judge();
        let threads = self.suggestion_threads(file_id);
        let mut found: Vec<Suggestion> = self
            .records_in(file_id)
            .into_iter()
            .filter_map(|record| {
                let (from, to, shown) = match record.kind {
                    SuggestionKind::Insert => {
                        let (from, to) = self.range(&record)?;
                        let shown = text.slice(from, to).ok()?;
                        (from, to, shown)
                    }
                    SuggestionKind::Delete => {
                        let at = self.spot(record.anchor.as_deref())?;
                        (at, at, record.text.clone())
                    }
                };
                Some(Suggestion {
                    id: record.id,
                    file_id: record.file.clone(),
                    kind: record.kind,
                    author: record.author,
                    created_at: record.created_at,
                    from: utf16_of(&text, from)?,
                    to: utf16_of(&text, to)?,
                    text: shown,
                    thread_id: record
                        .thread
                        .or_else(|| threads.get(&record.id.to_string()).copied()),
                    verified: judge.wrote_all(&record.map, record.author),
                })
            })
            .collect();
        found.sort_by(|left, right| {
            (left.from, left.to, left.created_at, left.id).cmp(&(
                right.from,
                right.to,
                right.created_at,
                right.id,
            ))
        });
        Ok(found)
    }

    pub fn suggestion_counts(&self) -> BTreeMap<String, usize> {
        let mut files: BTreeSet<String> = BTreeSet::new();
        for record in self.records() {
            files.insert(record.file);
        }
        files
            .into_iter()
            .filter_map(|file| {
                let pending = self.suggestions(&file).ok()?.len();
                (pending > 0).then_some((file, pending))
            })
            .collect()
    }

    pub fn suggestion_file(&self, id: SuggestionId) -> Result<String, CollabError> {
        Ok(self.record_of(id)?.file)
    }

    pub fn suggestion_author(&self, id: SuggestionId) -> Result<AccountId, CollabError> {
        Ok(self.record_of(id)?.author)
    }

    fn settle(&self, record: &Record, keep_text: bool, live: bool) -> Result<(), CollabError> {
        let text = self.text_of(&record.file)?;
        if !keep_text {
            match record.kind {
                SuggestionKind::Insert => {
                    let range = if live {
                        let from = self.live_spot(&text, record.start.as_deref());
                        let to = self.live_spot(&text, record.end.as_deref());
                        match (from, to) {
                            (Some(from), Some(to)) => (from < to).then_some((from, to)),
                            _ => return Err(changed_under()),
                        }
                    } else {
                        self.range(record)
                    };
                    if let Some((from, to)) = range {
                        text.delete(from, to - from).map_err(loro_error)?;
                    }
                }
                SuggestionKind::Delete => {
                    let at = if live {
                        self.live_spot(&text, record.anchor.as_deref())
                            .ok_or_else(changed_under)?
                    } else {
                        self.spot(record.anchor.as_deref())
                            .ok_or_else(suggestion_gone)?
                    };
                    if !record.text.is_empty() {
                        text.insert(at.min(text.len_unicode()), &record.text)
                            .map_err(loro_error)?;
                    }
                }
            }
        }
        self.suggestion_map()
            .delete(&record.id.to_string())
            .map_err(loro_error)?;
        Ok(())
    }

    fn settle_all(
        &mut self,
        ids: &[SuggestionId],
        keep_text: bool,
        by: Option<AccountId>,
    ) -> Result<BTreeSet<String>, CollabError> {
        self.writable()?;
        let records = ids
            .iter()
            .map(|id| self.record_of(*id))
            .collect::<Result<Vec<_>, _>>()?;
        if let Some(by) = by {
            if records.iter().any(|record| record.author != by) {
                return Err(not_yours());
            }
        }
        let mut files = BTreeSet::new();
        for record in &records {
            self.settle(record, keep_text, by.is_some())?;
            self.loro().commit();
            files.insert(record.file.clone());
        }
        Ok(files)
    }

    pub fn accept_suggestions(
        &mut self,
        ids: &[SuggestionId],
    ) -> Result<BTreeSet<String>, CollabError> {
        self.settle_all(ids, true, None)
    }

    pub fn reject_suggestions(
        &mut self,
        ids: &[SuggestionId],
    ) -> Result<BTreeSet<String>, CollabError> {
        self.settle_all(ids, false, None)
    }

    pub fn withdraw_suggestions(
        &mut self,
        ids: &[SuggestionId],
        by: AccountId,
    ) -> Result<BTreeSet<String>, CollabError> {
        self.settle_all(ids, false, Some(by))
    }

    fn ids_in(&self, file_id: &str) -> Vec<SuggestionId> {
        self.records_in(file_id)
            .into_iter()
            .map(|record| record.id)
            .collect()
    }

    pub fn accept_file_suggestions(&mut self, file_id: &str) -> Result<usize, CollabError> {
        self.text_of(file_id)?;
        let ids = self.ids_in(file_id);
        self.settle_all(&ids, true, None)?;
        Ok(ids.len())
    }

    pub fn reject_file_suggestions(&mut self, file_id: &str) -> Result<usize, CollabError> {
        self.text_of(file_id)?;
        let mut records = self.records_in(file_id);
        records.sort_by_key(|record| (record.created_at, record.id));
        let ids: Vec<SuggestionId> = records.into_iter().map(|record| record.id).collect();
        self.settle_all(&ids, false, None)?;
        Ok(ids.len())
    }

    pub fn drop_empty_suggestions(&mut self, file_id: &str) -> Result<bool, CollabError> {
        let empty: Vec<String> = self
            .records_in(file_id)
            .into_iter()
            .filter(|record| record.kind == SuggestionKind::Insert && self.range(record).is_none())
            .map(|record| record.id.to_string())
            .collect();
        if empty.is_empty() {
            return Ok(false);
        }
        for id in &empty {
            self.suggestion_map().delete(id).map_err(loro_error)?;
        }
        self.loro().commit();
        Ok(true)
    }

    pub fn files_of_suggestions(&self, ids: &BTreeSet<String>) -> BTreeSet<String> {
        let current = self.index_suggestions();
        let mut known = self.suggestion_index();
        let files = ids
            .iter()
            .filter_map(|id| current.get(id).or_else(|| known.get(id)).cloned())
            .collect();
        *known = current;
        files
    }

    pub fn pending_suggestions(&self) -> usize {
        self.suggestion_counts().values().sum()
    }
}

#[cfg(test)]
mod tests {
    use loro::{ExportMode, LoroDoc, VersionVector};
    use oleafly_collab_protocol::projects::ProjectRole;
    use oleafly_server::role_guard::{judge, RoleRule, RoleVerdict};

    use super::*;
    use crate::doc::NodeKind;

    const TEXT_START: &str = "Hello world\n";

    fn account(seed: u8) -> AccountId {
        format!("01920000-0000-7000-8000-0000000000{seed:02x}")
            .parse()
            .unwrap()
    }

    fn rae() -> AccountId {
        account(0xa1)
    }

    fn sam() -> AccountId {
        account(0xa2)
    }

    struct Room {
        owner: ProjectDoc,
        file: String,
    }

    fn room(text: &str) -> Room {
        let mut owner = ProjectDoc::create().unwrap();
        owner.set_author(&account(0x01).to_string(), "Owen");
        let file = owner
            .add_node(None, "main.tex", NodeKind::Text, None, text)
            .unwrap();
        Room { owner, file }
    }

    fn joined(room: &Room, who: AccountId) -> ProjectDoc {
        let mut doc = ProjectDoc::load(&room.owner.snapshot().unwrap()).unwrap();
        doc.set_author(&who.to_string(), "Someone");
        doc
    }

    fn sync(from: &ProjectDoc, to: &mut ProjectDoc) {
        to.import(&from.export_since(&to.version()).unwrap())
            .unwrap();
    }

    fn units(text: &str) -> usize {
        text.encode_utf16().count()
    }

    fn insert_op(doc: &ProjectDoc, file: &str, at: usize, inserted: &str) -> TextOperation {
        let length = units(&doc.text(file).unwrap());
        let mut operation = TextOperation::new();
        operation.retain(at).insert(inserted).retain(length - at);
        operation
    }

    fn delete_op(doc: &ProjectDoc, file: &str, from: usize, to: usize) -> TextOperation {
        let length = units(&doc.text(file).unwrap());
        let mut operation = TextOperation::new();
        operation.retain(from).delete(to - from).retain(length - to);
        operation
    }

    struct Checked {
        held: Vec<u8>,
    }

    impl Checked {
        fn of(doc: &ProjectDoc) -> Checked {
            Checked {
                held: doc.snapshot().unwrap(),
            }
        }

        fn allows(&mut self, doc: &ProjectDoc, since: &VersionVector, who: AccountId) -> bool {
            self.allows_as(doc, since, who, ProjectRole::Reviewer)
        }

        fn allows_as(
            &mut self,
            doc: &ProjectDoc,
            since: &VersionVector,
            who: AccountId,
            role: ProjectRole,
        ) -> bool {
            let update = doc.export_since(since).unwrap();
            let server = LoroDoc::new();
            server.import(&self.held).unwrap();
            let rule = RoleRule {
                role,
                account: who,
                comments_off: false,
            };
            let (verdict, _) = judge(&server, &update, &rule);
            self.held = server.export(ExportMode::Snapshot).unwrap();
            verdict == RoleVerdict::Allowed
        }
    }

    fn suggest(doc: &mut ProjectDoc, file: &str, operation: TextOperation, who: AccountId) {
        doc.suggest_operation(file, &operation, who, None, 10)
            .unwrap();
    }

    fn type_suggestion(
        doc: &mut ProjectDoc,
        checked: &mut Checked,
        file: &str,
        at: usize,
        typed: &str,
        who: AccountId,
    ) {
        let mut at = at;
        for character in typed.chars() {
            let since = doc.version();
            let operation = insert_op(doc, file, at, &character.to_string());
            suggest(doc, file, operation, who);
            assert!(checked.allows(doc, &since, who), "typing {character:?}");
            at += character.len_utf16();
        }
    }

    fn shown(doc: &ProjectDoc, file: &str) -> Vec<(SuggestionKind, usize, usize, String)> {
        doc.suggestions(file)
            .unwrap()
            .into_iter()
            .map(|found| (found.kind, found.from, found.to, found.text))
            .collect()
    }

    #[test]
    fn typing_in_suggesting_mode_keeps_the_text_and_records_one_insertion() {
        let room = room(TEXT_START);
        let mut rae_doc = joined(&room, rae());
        let mut checked = Checked::of(&rae_doc);
        type_suggestion(&mut rae_doc, &mut checked, &room.file, 5, ", dear", rae());
        assert_eq!(rae_doc.text(&room.file).unwrap(), "Hello, dear world\n");
        assert_eq!(
            shown(&rae_doc, &room.file),
            vec![(SuggestionKind::Insert, 5, 11, ", dear".to_owned())]
        );
        let found = &rae_doc.suggestions(&room.file).unwrap()[0];
        assert_eq!(found.author, rae());
        assert!(found.verified);
        type_suggestion(&mut rae_doc, &mut checked, &room.file, 5, "!", rae());
        assert_eq!(
            shown(&rae_doc, &room.file),
            vec![(SuggestionKind::Insert, 5, 12, "!, dear".to_owned())]
        );
    }

    #[test]
    fn deleting_in_suggesting_mode_strikes_the_text_and_coalesces_backspaces() {
        let room = room(TEXT_START);
        let mut rae_doc = joined(&room, rae());
        let mut checked = Checked::of(&rae_doc);
        for at in [11, 10, 9] {
            let since = rae_doc.version();
            let operation = delete_op(&rae_doc, &room.file, at - 1, at);
            suggest(&mut rae_doc, &room.file, operation, rae());
            assert!(checked.allows(&rae_doc, &since, rae()));
        }
        assert_eq!(rae_doc.text(&room.file).unwrap(), "Hello wo\n");
        assert_eq!(
            shown(&rae_doc, &room.file),
            vec![(SuggestionKind::Delete, 8, 8, "rld".to_owned())]
        );
        let since = rae_doc.version();
        let operation = delete_op(&rae_doc, &room.file, 8, 9);
        suggest(&mut rae_doc, &room.file, operation, rae());
        assert!(checked.allows(&rae_doc, &since, rae()));
        assert_eq!(
            shown(&rae_doc, &room.file),
            vec![(SuggestionKind::Delete, 8, 8, "rld\n".to_owned())]
        );
    }

    #[test]
    fn deleting_inside_an_own_insertion_shrinks_it_and_an_empty_one_is_dropped() {
        let room = room(TEXT_START);
        let mut rae_doc = joined(&room, rae());
        let mut checked = Checked::of(&rae_doc);
        type_suggestion(&mut rae_doc, &mut checked, &room.file, 5, "abc", rae());
        let since = rae_doc.version();
        let operation = delete_op(&rae_doc, &room.file, 6, 7);
        suggest(&mut rae_doc, &room.file, operation, rae());
        assert!(checked.allows(&rae_doc, &since, rae()));
        assert_eq!(
            shown(&rae_doc, &room.file),
            vec![(SuggestionKind::Insert, 5, 7, "ac".to_owned())]
        );
        let since = rae_doc.version();
        let operation = delete_op(&rae_doc, &room.file, 5, 7);
        suggest(&mut rae_doc, &room.file, operation, rae());
        assert!(checked.allows(&rae_doc, &since, rae()));
        assert!(shown(&rae_doc, &room.file).is_empty());
        assert_eq!(rae_doc.text(&room.file).unwrap(), TEXT_START);
        assert!(rae_doc.records_in(&room.file).is_empty());
    }

    #[test]
    fn a_deletion_across_an_own_insertion_strikes_only_what_was_there_before() {
        let room = room("ABCD\n");
        let mut rae_doc = joined(&room, rae());
        let mut checked = Checked::of(&rae_doc);
        type_suggestion(&mut rae_doc, &mut checked, &room.file, 2, "xyz", rae());
        assert_eq!(rae_doc.text(&room.file).unwrap(), "ABxyzCD\n");
        let since = rae_doc.version();
        let operation = delete_op(&rae_doc, &room.file, 1, 6);
        suggest(&mut rae_doc, &room.file, operation, rae());
        assert!(checked.allows(&rae_doc, &since, rae()));
        assert_eq!(rae_doc.text(&room.file).unwrap(), "AD\n");
        assert_eq!(
            shown(&rae_doc, &room.file),
            vec![(SuggestionKind::Delete, 1, 1, "BC".to_owned())]
        );
        rae_doc.reject_file_suggestions(&room.file).unwrap();
        assert_eq!(rae_doc.text(&room.file).unwrap(), "ABCD\n");
    }

    #[test]
    fn replacing_a_word_is_a_deletion_and_an_insertion() {
        let room = room(TEXT_START);
        let mut rae_doc = joined(&room, rae());
        let mut checked = Checked::of(&rae_doc);
        let since = rae_doc.version();
        let length = units(TEXT_START);
        let mut operation = TextOperation::new();
        operation
            .retain(6)
            .delete(5)
            .insert("there")
            .retain(length - 11);
        suggest(&mut rae_doc, &room.file, operation, rae());
        assert!(checked.allows(&rae_doc, &since, rae()));
        assert_eq!(rae_doc.text(&room.file).unwrap(), "Hello there\n");
        let found = shown(&rae_doc, &room.file);
        assert_eq!(found.len(), 2, "{found:?}");
        assert!(found.contains(&(SuggestionKind::Insert, 6, 11, "there".to_owned())));
        assert!(found
            .iter()
            .any(|(kind, _, _, text)| *kind == SuggestionKind::Delete && text == "world"));
        let mut owner = room.owner;
        sync(&rae_doc, &mut owner);
        owner.reject_file_suggestions(&room.file).unwrap();
        assert_eq!(owner.text(&room.file).unwrap(), TEXT_START);
        assert!(shown(&owner, &room.file).is_empty());
    }

    #[test]
    fn accepting_keeps_the_text_and_rejecting_puts_the_original_back() {
        let room = room(TEXT_START);
        let mut rae_doc = joined(&room, rae());
        let operation = insert_op(&rae_doc, &room.file, 5, ", dear");
        suggest(&mut rae_doc, &room.file, operation, rae());
        let operation = delete_op(&rae_doc, &room.file, 0, 5);
        suggest(&mut rae_doc, &room.file, operation, rae());
        assert_eq!(rae_doc.text(&room.file).unwrap(), ", dear world\n");
        let ids: Vec<(SuggestionKind, SuggestionId)> = rae_doc
            .suggestions(&room.file)
            .unwrap()
            .into_iter()
            .map(|found| (found.kind, found.id))
            .collect();
        let insertion = ids
            .iter()
            .find(|(kind, _)| *kind == SuggestionKind::Insert)
            .unwrap()
            .1;
        let deletion = ids
            .iter()
            .find(|(kind, _)| *kind == SuggestionKind::Delete)
            .unwrap()
            .1;
        let mut owner = room.owner;
        sync(&rae_doc, &mut owner);
        let mut accepted = ProjectDoc::load(&owner.snapshot().unwrap()).unwrap();
        accepted.accept_suggestions(&[insertion]).unwrap();
        assert_eq!(accepted.text(&room.file).unwrap(), ", dear world\n");
        accepted.reject_suggestions(&[deletion]).unwrap();
        assert_eq!(accepted.text(&room.file).unwrap(), "Hello, dear world\n");
        assert!(shown(&accepted, &room.file).is_empty());
        owner.accept_file_suggestions(&room.file).unwrap();
        assert_eq!(owner.text(&room.file).unwrap(), ", dear world\n");
        assert!(shown(&owner, &room.file).is_empty());
        assert!(matches!(
            owner.accept_suggestions(&[insertion]),
            Err(CollabError::Api { code, .. }) if code == "suggestion_not_found"
        ));
    }

    #[test]
    fn only_the_author_withdraws_and_a_withdrawal_puts_the_text_back() {
        let room = room(TEXT_START);
        let mut rae_doc = joined(&room, rae());
        let mut checked = Checked::of(&rae_doc);
        type_suggestion(&mut rae_doc, &mut checked, &room.file, 11, "!", rae());
        let operation = delete_op(&rae_doc, &room.file, 0, 6);
        let since = rae_doc.version();
        suggest(&mut rae_doc, &room.file, operation, rae());
        assert!(checked.allows(&rae_doc, &since, rae()));
        let ids: Vec<SuggestionId> = rae_doc
            .suggestions(&room.file)
            .unwrap()
            .into_iter()
            .map(|found| found.id)
            .collect();
        assert!(matches!(
            rae_doc.withdraw_suggestions(&ids, sam()),
            Err(CollabError::Api { code, .. }) if code == "suggestion_not_yours"
        ));
        let since = rae_doc.version();
        rae_doc.withdraw_suggestions(&ids, rae()).unwrap();
        assert!(checked.allows(&rae_doc, &since, rae()));
        assert_eq!(rae_doc.text(&room.file).unwrap(), TEXT_START);
        assert!(shown(&rae_doc, &room.file).is_empty());
    }

    #[test]
    fn an_editor_typing_inside_a_suggestion_keeps_it_whole_and_deleting_it_all_drops_it() {
        let room = room(TEXT_START);
        let mut rae_doc = joined(&room, rae());
        let operation = insert_op(&rae_doc, &room.file, 5, " big");
        suggest(&mut rae_doc, &room.file, operation, rae());
        let mut owner = room.owner;
        sync(&rae_doc, &mut owner);
        let operation = insert_op(&owner, &room.file, 7, "!");
        owner.apply_operation(&room.file, &operation).unwrap();
        owner.drop_empty_suggestions(&room.file).unwrap();
        assert_eq!(
            shown(&owner, &room.file),
            vec![(SuggestionKind::Insert, 5, 10, " b!ig".to_owned())]
        );
        let operation = insert_op(&owner, &room.file, 0, ">> ");
        owner.apply_operation(&room.file, &operation).unwrap();
        assert_eq!(
            shown(&owner, &room.file),
            vec![(SuggestionKind::Insert, 8, 13, " b!ig".to_owned())]
        );
        let operation = delete_op(&owner, &room.file, 8, 13);
        owner.apply_operation(&room.file, &operation).unwrap();
        assert!(owner.drop_empty_suggestions(&room.file).unwrap());
        assert!(owner.records_in(&room.file).is_empty());
        sync(&owner, &mut rae_doc);
        assert!(shown(&rae_doc, &room.file).is_empty());
    }

    #[test]
    fn positions_are_counted_in_utf16_units() {
        let room = room("A 🦊 fox\n");
        let mut rae_doc = joined(&room, rae());
        let mut checked = Checked::of(&rae_doc);
        type_suggestion(&mut rae_doc, &mut checked, &room.file, 4, "🪸x", rae());
        assert_eq!(rae_doc.text(&room.file).unwrap(), "A 🦊🪸x fox\n");
        assert_eq!(
            shown(&rae_doc, &room.file),
            vec![(SuggestionKind::Insert, 4, 7, "🪸x".to_owned())]
        );
        let since = rae_doc.version();
        let operation = delete_op(&rae_doc, &room.file, 2, 4);
        suggest(&mut rae_doc, &room.file, operation, rae());
        assert!(checked.allows(&rae_doc, &since, rae()));
        assert!(shown(&rae_doc, &room.file).contains(&(
            SuggestionKind::Delete,
            2,
            2,
            "🦊".to_owned()
        )));
    }

    #[test]
    fn two_reviewers_suggesting_at_once_converge() {
        let room = room("One two three four\n");
        let mut rae_doc = joined(&room, rae());
        let mut sam_doc = joined(&room, sam());
        let mut rae_checked = Checked::of(&rae_doc);
        let mut sam_checked = Checked::of(&sam_doc);
        type_suggestion(&mut rae_doc, &mut rae_checked, &room.file, 3, " and", rae());
        let since = sam_doc.version();
        let operation = delete_op(&sam_doc, &room.file, 3, 7);
        suggest(&mut sam_doc, &room.file, operation, sam());
        assert!(sam_checked.allows(&sam_doc, &since, sam()));
        type_suggestion(&mut sam_doc, &mut sam_checked, &room.file, 9, "!", sam());
        let to_sam = rae_doc.export_since(&sam_doc.version()).unwrap();
        let to_rae = sam_doc.export_since(&rae_doc.version()).unwrap();
        sam_doc.import(&to_sam).unwrap();
        rae_doc.import(&to_rae).unwrap();
        assert_eq!(
            rae_doc.text(&room.file).unwrap(),
            sam_doc.text(&room.file).unwrap()
        );
        let listed = |doc: &ProjectDoc| -> Vec<(SuggestionId, usize, usize, String)> {
            doc.suggestions(&room.file)
                .unwrap()
                .into_iter()
                .map(|found| (found.id, found.from, found.to, found.text))
                .collect()
        };
        assert_eq!(listed(&rae_doc), listed(&sam_doc));
        assert_eq!(listed(&rae_doc).len(), 3);
        let mut merged = Checked::of(&rae_doc);
        type_suggestion(&mut rae_doc, &mut merged, &room.file, 0, "> ", rae());
        let mut owner = room.owner;
        sync(&rae_doc, &mut owner);
        sync(&sam_doc, &mut owner);
        owner.reject_file_suggestions(&room.file).unwrap();
        assert_eq!(owner.text(&room.file).unwrap(), "One two three four\n");
        sync(&owner, &mut rae_doc);
        sync(&owner, &mut sam_doc);
        assert_eq!(rae_doc.text(&room.file).unwrap(), "One two three four\n");
        assert_eq!(sam_doc.text(&room.file).unwrap(), "One two three four\n");
        assert!(listed(&sam_doc).is_empty());
    }

    #[test]
    fn a_written_text_from_a_tool_becomes_suggestions() {
        let room = room("alpha beta gamma\n");
        let mut rae_doc = joined(&room, rae());
        let mut checked = Checked::of(&rae_doc);
        let since = rae_doc.version();
        rae_doc
            .suggest_text(&room.file, "alpha BETA gamma delta\n", rae(), None, 10)
            .unwrap();
        assert!(checked.allows(&rae_doc, &since, rae()));
        assert_eq!(
            rae_doc.text(&room.file).unwrap(),
            "alpha BETA gamma delta\n"
        );
        assert!(!shown(&rae_doc, &room.file).is_empty());
        rae_doc.reject_file_suggestions(&room.file).unwrap();
        assert_eq!(rae_doc.text(&room.file).unwrap(), "alpha beta gamma\n");
    }

    #[test]
    fn a_deletion_larger_than_a_suggestion_holds_is_refused_and_changes_nothing() {
        let long = "x".repeat(MAX_DELETED_CHARS + 10);
        let room = room(&long);
        let mut rae_doc = joined(&room, rae());
        let operation = delete_op(&rae_doc, &room.file, 0, MAX_DELETED_CHARS + 1);
        assert!(matches!(
            rae_doc.suggest_operation(&room.file, &operation, rae(), None, 10),
            Err(CollabError::Api { code, .. }) if code == "too_large"
        ));
        assert_eq!(rae_doc.text(&room.file).unwrap(), long);
        let operation = delete_op(&rae_doc, &room.file, 5, 6);
        suggest(&mut rae_doc, &room.file, operation, rae());
        let operation = delete_op(&rae_doc, &room.file, 0, 5);
        suggest(&mut rae_doc, &room.file, operation, rae());
        let operation = delete_op(&rae_doc, &room.file, 0, MAX_DELETED_CHARS - 2);
        assert!(rae_doc
            .suggest_operation(&room.file, &operation, rae(), None, 10)
            .is_err());
        assert_eq!(
            rae_doc.text(&room.file).unwrap().chars().count(),
            MAX_DELETED_CHARS + 4
        );
        assert_eq!(
            shown(&rae_doc, &room.file),
            vec![(SuggestionKind::Delete, 0, 0, "x".repeat(6))]
        );
    }

    #[test]
    fn a_reply_opens_one_thread_on_a_suggestion_and_later_replies_join_it() {
        let room = room(TEXT_START);
        let mut rae_doc = joined(&room, rae());
        let mut checked = Checked::of(&rae_doc);
        type_suggestion(&mut rae_doc, &mut checked, &room.file, 5, ", dear", rae());
        let since = rae_doc.version();
        let operation = delete_op(&rae_doc, &room.file, 12, 17);
        suggest(&mut rae_doc, &room.file, operation, rae());
        assert!(checked.allows(&rae_doc, &since, rae()));
        let listed = rae_doc.suggestions(&room.file).unwrap();
        let (insertion, deletion) = (listed[0].id, listed[1].id);
        let since = rae_doc.version();
        let opened = rae_doc
            .reply_to_suggestion(insertion, rae(), 20, "Why this word?", &[], true)
            .unwrap();
        assert!(checked.allows(&rae_doc, &since, rae()));
        assert_eq!(opened.anchor.quote, ", dear");
        assert_eq!(
            opened.anchor.range.map(|range| (range.from, range.to)),
            Some((5, 11))
        );
        let mut sam_doc = joined(&room, sam());
        sync(&rae_doc, &mut sam_doc);
        let since = sam_doc.version();
        let joined_thread = sam_doc
            .reply_to_suggestion(insertion, sam(), 21, "Agreed", &[], false)
            .unwrap();
        assert!(checked.allows_as(&sam_doc, &since, sam(), ProjectRole::Commenter));
        assert_eq!(joined_thread.id, opened.id);
        assert_eq!(joined_thread.messages.len(), 2);
        let since = sam_doc.version();
        let struck = sam_doc
            .reply_to_suggestion(deletion, sam(), 22, "Keep this", &[], false)
            .unwrap();
        assert!(checked.allows_as(&sam_doc, &since, sam(), ProjectRole::Commenter));
        assert_eq!(struck.anchor.quote, "world");
        assert_ne!(struck.id, opened.id);
        let threads: Vec<Option<CommentId>> = sam_doc
            .suggestions(&room.file)
            .unwrap()
            .into_iter()
            .map(|found| found.thread_id)
            .collect();
        assert_eq!(threads, vec![Some(opened.id), Some(struck.id)]);
        let again = sam_doc
            .reply_to_suggestion(deletion, sam(), 23, "Still", &[], false)
            .unwrap();
        assert_eq!(again.id, struck.id);
    }

    #[test]
    fn a_suggestion_made_here_and_settled_elsewhere_still_names_its_file() {
        let room = room(TEXT_START);
        let mut rae_doc = joined(&room, rae());
        let operation = insert_op(&rae_doc, &room.file, 5, ", dear");
        suggest(&mut rae_doc, &room.file, operation, rae());
        let made = rae_doc.suggestions(&room.file).unwrap()[0].id;
        let mut owner = room.owner;
        sync(&rae_doc, &mut owner);
        owner.accept_suggestions(&[made]).unwrap();
        let imported = rae_doc
            .import(&owner.export_since(&rae_doc.version()).unwrap())
            .unwrap();
        assert_eq!(
            imported.changes.suggestions,
            BTreeSet::from([made.to_string()])
        );
        assert_eq!(
            rae_doc.files_of_suggestions(&imported.changes.suggestions),
            BTreeSet::from([room.file.clone()])
        );
        assert!(shown(&rae_doc, &room.file).is_empty());
    }

    #[test]
    fn counts_list_files_with_pending_suggestions() {
        let room = room(TEXT_START);
        let mut rae_doc = joined(&room, rae());
        assert!(rae_doc.suggestion_counts().is_empty());
        let operation = insert_op(&rae_doc, &room.file, 0, "Oh. ");
        suggest(&mut rae_doc, &room.file, operation, rae());
        let operation = delete_op(&rae_doc, &room.file, 10, 15);
        suggest(&mut rae_doc, &room.file, operation, rae());
        assert_eq!(
            rae_doc.suggestion_counts(),
            BTreeMap::from([(room.file.clone(), 2)])
        );
        assert_eq!(rae_doc.pending_suggestions(), 2);
    }
}
