use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use loro::cursor::{Cursor, PosType, Side};
use loro::event::{ContainerDiff, Diff};
use loro::{
    Container, ContainerID, Index, LoroDoc, LoroList, LoroMap, LoroText, LoroValue,
    ValueOrContainer, VersionVector, ID,
};
use oleafly_collab_protocol::ids::{AccountId, CommentId};
use serde::{Deserialize, Serialize};

use crate::doc::ProjectDoc;
use crate::CollabError;

pub const COMMENTS: &str = "comments";
pub const MAX_BODY_CHARS: usize = 20_000;
pub const MAX_QUOTE_CHARS: usize = 2_000;
const START: &str = "start";
const END: &str = "end";
const QUOTE: &str = "quote";
const CREATED_BY: &str = "created_by";
const CREATED_AT: &str = "created_at";
const RESOLVED: &str = "resolved";
const DELETED: &str = "deleted";
const MESSAGES: &str = "messages";
const ID: &str = "id";
const AUTHOR: &str = "author";
const AT: &str = "at";
const BODY: &str = "body";
const EDITED_AT: &str = "edited_at";
const MENTIONS: &str = "mentions";
const SUGGESTION: &str = "suggestion";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentRange {
    pub from: usize,
    pub to: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentAnchor {
    pub quote: String,
    pub range: Option<CommentRange>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentResolution {
    pub by: AccountId,
    pub at: i64,
    pub verified: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentMessage {
    pub id: CommentId,
    pub author: AccountId,
    pub at: i64,
    pub body: String,
    pub edited_at: Option<i64>,
    pub deleted: bool,
    pub mentions: Vec<AccountId>,
    pub verified: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentThread {
    pub id: CommentId,
    pub file_id: String,
    pub anchor: CommentAnchor,
    pub created_by: AccountId,
    pub created_at: i64,
    pub resolved: Option<CommentResolution>,
    pub messages: Vec<CommentMessage>,
    pub verified: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentMember {
    pub account_id: AccountId,
    pub display_name: String,
    #[serde(default)]
    pub login: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentMention {
    pub file_id: String,
    pub thread_id: CommentId,
    pub message_id: CommentId,
    pub author: AccountId,
    pub mentions: Vec<AccountId>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Witness {
    Account(AccountId),
    Disputed,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Authorship {
    peers: BTreeMap<u64, Witness>,
    #[serde(default)]
    vouched: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    awaiting: bool,
}

#[derive(Clone, Copy)]
pub(crate) struct Judge<'a> {
    authors: &'a Authorship,
    own_peer: u64,
    me: Option<AccountId>,
}

impl Authorship {
    pub fn is_empty(&self) -> bool {
        self.peers.is_empty()
    }

    pub fn vouched(&self) -> bool {
        self.vouched
    }

    fn checking(&self) -> bool {
        self.vouched || self.awaiting || !self.peers.is_empty()
    }

    pub fn await_vouch(&mut self) -> bool {
        let changed = !self.awaiting;
        self.awaiting = true;
        changed
    }

    pub fn vouch(&mut self, listed: impl IntoIterator<Item = (u64, AccountId)>) -> bool {
        let mut changed = !self.vouched || self.awaiting;
        self.vouched = true;
        self.awaiting = false;
        for (peer, account) in listed {
            changed |= self.witness([peer], account);
        }
        changed
    }

    pub fn account_of(&self, peer: u64) -> Option<AccountId> {
        match self.peers.get(&peer) {
            Some(Witness::Account(account)) => Some(*account),
            _ => None,
        }
    }

    pub fn witness(&mut self, peers: impl IntoIterator<Item = u64>, account: AccountId) -> bool {
        let mut changed = false;
        for peer in peers {
            let next = match self.peers.get(&peer) {
                None => Witness::Account(account),
                Some(Witness::Account(known)) if *known == account => continue,
                Some(_) => Witness::Disputed,
            };
            changed |= self.peers.insert(peer, next) != Some(next);
        }
        changed
    }
}

impl Judge<'_> {
    fn checking(&self) -> bool {
        self.authors.checking()
    }

    fn allows(&self, peer: Option<u64>, claimed: AccountId) -> bool {
        let Some(peer) = peer else {
            return true;
        };
        if peer == self.own_peer {
            return self.me.is_none_or(|me| me == claimed);
        }
        match self.authors.peers.get(&peer) {
            None => !self.checking(),
            Some(Witness::Account(account)) => *account == claimed,
            Some(Witness::Disputed) => false,
        }
    }

    pub(crate) fn wrote(&self, map: &LoroMap, keys: &[&str], claimed: AccountId) -> bool {
        !self.checking()
            || keys
                .iter()
                .all(|key| self.allows(map.get_last_editor(key), claimed))
    }

    pub(crate) fn wrote_all(&self, map: &LoroMap, claimed: AccountId) -> bool {
        !self.checking()
            || map
                .keys()
                .all(|key| self.allows(map.get_last_editor(&key), claimed))
    }
}

const THREAD_KEYS: [&str; 5] = [CREATED_BY, CREATED_AT, QUOTE, START, END];

fn message_maps(thread: &LoroMap) -> Vec<Option<LoroMap>> {
    let Some(ValueOrContainer::Container(Container::List(messages))) = thread.get(MESSAGES) else {
        return Vec::new();
    };
    (0..messages.len())
        .map(|index| match messages.get(index) {
            Some(ValueOrContainer::Container(Container::Map(map))) => Some(map),
            _ => None,
        })
        .collect()
}

#[derive(Clone, Debug, Default)]
pub struct CommentEvents {
    threads: BTreeSet<(String, String)>,
    messages: Vec<(String, String, ContainerID)>,
}

impl CommentEvents {
    pub fn is_empty(&self) -> bool {
        self.threads.is_empty()
    }

    pub fn files(&self) -> BTreeSet<String> {
        self.threads.iter().map(|(file, _)| file.clone()).collect()
    }

    pub fn extend(&mut self, other: CommentEvents) {
        self.threads.extend(other.threads);
        self.messages.extend(other.messages);
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsentComment {
    pub file_id: String,
    pub thread_id: CommentId,
    pub quote: String,
    pub body: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CommentChanges {
    pub files: BTreeSet<String>,
    pub mentions: Vec<CommentMention>,
}

impl CommentChanges {
    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }
}

fn is_comments_root(id: &ContainerID) -> bool {
    matches!(id, ContainerID::Root { name, .. } if name.as_str() == COMMENTS)
}

pub(crate) fn in_comments(doc: &LoroDoc, container: &ContainerID) -> bool {
    match container {
        ContainerID::Root { .. } => is_comments_root(container),
        ContainerID::Normal { .. } => doc
            .get_path_to_container(container)
            .and_then(|path| path.into_iter().next())
            .is_some_and(|(root, _)| is_comments_root(&root)),
    }
}

fn split_key(key: &str) -> Option<(String, String)> {
    let (file, thread) = key.split_once('/')?;
    (!file.is_empty() && !thread.is_empty()).then(|| (file.to_owned(), thread.to_owned()))
}

pub(crate) fn record(events: &mut CommentEvents, change: &ContainerDiff<'_>) -> bool {
    let rooted = match change.path.first() {
        Some((root, _)) => is_comments_root(root),
        None => is_comments_root(change.target),
    };
    if !rooted {
        return false;
    }
    match change.path.get(1) {
        None => {
            if let Diff::Map(delta) = &change.diff {
                events
                    .threads
                    .extend(delta.updated.keys().filter_map(|key| split_key(key)));
            }
        }
        Some((_, Index::Key(key))) => {
            if let Some((file, thread)) = split_key(key) {
                let message = change.path.len() == 4
                    && matches!(&change.path[2].1, Index::Key(list) if list.as_str() == MESSAGES);
                if let Diff::Map(delta) = &change.diff {
                    if message && delta.updated.contains_key(MENTIONS) {
                        events
                            .messages
                            .push((file.clone(), thread.clone(), change.target.clone()));
                    }
                }
                events.threads.insert((file, thread));
            }
        }
        Some(_) => {}
    }
    true
}

fn word_character(character: char) -> bool {
    character.is_alphanumeric() || character == '_'
}

fn handle_length(rest: &str, handle: &str) -> Option<usize> {
    let count = handle.chars().count();
    if count == 0 {
        return None;
    }
    let end = rest
        .char_indices()
        .nth(count)
        .map_or(rest.len(), |(index, _)| index);
    let candidate = rest.get(..end)?;
    if candidate.chars().count() != count || candidate.to_lowercase() != handle.to_lowercase() {
        return None;
    }
    match rest[end..].chars().next() {
        Some(next) if word_character(next) => None,
        _ => Some(end),
    }
}

pub fn mentions_in(body: &str, members: &[CommentMember]) -> Vec<AccountId> {
    let mut found: Vec<AccountId> = Vec::new();
    let mut previous: Option<char> = None;
    for (index, character) in body.char_indices() {
        let at_word_start = previous.is_none_or(|before| !word_character(before) && before != '@');
        previous = Some(character);
        if character != '@' || !at_word_start {
            continue;
        }
        let rest = &body[index + 1..];
        let best = members
            .iter()
            .flat_map(|member| {
                std::iter::once(member.display_name.trim())
                    .chain(member.login.as_deref().map(str::trim))
                    .filter_map(move |handle| {
                        handle_length(rest, handle).map(|length| (length, member.account_id))
                    })
            })
            .max_by_key(|(length, _)| *length);
        if let Some((_, account)) = best {
            if !found.contains(&account) {
                found.push(account);
            }
        }
    }
    found
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

fn thread_gone() -> CollabError {
    refused(404, "not_found", "this comment thread is gone")
}

fn message_gone() -> CollabError {
    refused(404, "not_found", "this comment is gone")
}

fn not_yours() -> CollabError {
    refused(
        403,
        "not_yours",
        "only the person who wrote it can change it",
    )
}

fn thread_key(file_id: &str, thread: CommentId) -> String {
    format!("{file_id}/{thread}")
}

fn checked_body(body: &str) -> Result<&str, CollabError> {
    let body = body.trim();
    if body.is_empty() {
        return Err(refused(400, "empty", "a comment needs some text"));
    }
    if body.chars().count() > MAX_BODY_CHARS {
        return Err(refused(413, "too_large", "this comment is too long"));
    }
    Ok(body)
}

fn quoted(text: &str, from: usize, to: usize) -> Option<String> {
    if from >= to {
        return None;
    }
    let units: Vec<u16> = text.encode_utf16().collect();
    let quote = String::from_utf16(units.get(from..to)?).ok()?;
    Some(quote.chars().take(MAX_QUOTE_CHARS).collect())
}

fn unique(accounts: &[AccountId]) -> Vec<AccountId> {
    let mut seen = Vec::new();
    for account in accounts {
        if !seen.contains(account) {
            seen.push(*account);
        }
    }
    seen
}

fn mention_value(mentions: &[AccountId]) -> LoroValue {
    LoroValue::from(
        mentions
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<String>>(),
    )
}

pub(crate) fn string_of(value: Option<&LoroValue>) -> Option<String> {
    match value {
        Some(LoroValue::String(text)) => Some(text.to_string()),
        _ => None,
    }
}

pub(crate) fn number_of(value: Option<&LoroValue>) -> Option<i64> {
    match value {
        Some(LoroValue::I64(number)) => Some(*number),
        _ => None,
    }
}

pub(crate) fn flag_of(value: Option<&LoroValue>) -> bool {
    matches!(value, Some(LoroValue::Bool(true)))
}

pub(crate) fn parsed<T: std::str::FromStr>(value: Option<&LoroValue>) -> Option<T> {
    string_of(value)?.parse().ok()
}

fn cursor_of(value: Option<&LoroValue>) -> Option<&[u8]> {
    match value {
        Some(LoroValue::Binary(bytes)) if Cursor::decode(bytes).is_ok() => Some(bytes),
        _ => None,
    }
}

fn accounts_of(value: Option<&LoroValue>) -> Vec<AccountId> {
    match value {
        Some(LoroValue::List(items)) => {
            items.iter().filter_map(|item| parsed(Some(item))).collect()
        }
        _ => Vec::new(),
    }
}

fn message_of(value: &LoroValue) -> Option<CommentMessage> {
    let LoroValue::Map(fields) = value else {
        return None;
    };
    let deleted = flag_of(fields.get(DELETED));
    Some(CommentMessage {
        id: parsed(fields.get(ID))?,
        author: parsed(fields.get(AUTHOR))?,
        at: number_of(fields.get(AT))?,
        body: if deleted {
            String::new()
        } else {
            string_of(fields.get(BODY)).unwrap_or_default()
        },
        edited_at: number_of(fields.get(EDITED_AT)),
        deleted,
        mentions: if deleted {
            Vec::new()
        } else {
            accounts_of(fields.get(MENTIONS))
        },
        verified: true,
    })
}

fn resolution_of(value: Option<&LoroValue>) -> Option<CommentResolution> {
    let Some(LoroValue::Map(fields)) = value else {
        return None;
    };
    Some(CommentResolution {
        by: parsed(fields.get("by"))?,
        at: number_of(fields.get("at"))?,
        verified: true,
    })
}

#[derive(Default)]
pub(crate) struct Anchors {
    checked: VersionVector,
    moved: HashMap<Vec<u8>, Cursor>,
    #[cfg(test)]
    replays: usize,
}

fn follows(doc: &LoroDoc, first: ID, checked: &VersionVector) -> Option<bool> {
    let change = doc.get_change(first)?;
    let mut past = doc.frontiers_to_vv(&change.deps)?;
    if first.counter > change.id.counter {
        past.extend_to_include_last_id(ID::new(first.peer, first.counter - 1));
    }
    Some(past.includes_vv(checked))
}

fn concurrent_containers(
    doc: &LoroDoc,
    checked: &VersionVector,
    now: &VersionVector,
) -> Option<HashSet<ContainerID>> {
    let mut touched = HashSet::new();
    for (peer, end) in now.iter() {
        let start = checked.get(peer).copied().unwrap_or(0);
        if start >= *end {
            continue;
        }
        let first = ID::new(*peer, start);
        if !follows(doc, first, checked)? {
            let span = usize::try_from(end - start).ok()?;
            touched.extend(doc.get_changed_containers_in(first, span));
        }
    }
    Some(touched)
}

impl Anchors {
    fn settle(&mut self, doc: &LoroDoc) {
        let now = doc.oplog_vv();
        if now == self.checked {
            return;
        }
        if !self.moved.is_empty() {
            match concurrent_containers(doc, &self.checked, &now) {
                Some(touched) => self
                    .moved
                    .retain(|_, cursor| !touched.contains(&cursor.container)),
                None => self.moved.clear(),
            }
        }
        self.checked = now;
    }

    fn boundary(&mut self, doc: &LoroDoc, stored: &[u8]) -> Option<usize> {
        let cursor = match self.moved.get(stored) {
            Some(moved) => moved.clone(),
            None => Cursor::decode(stored).ok()?,
        };
        let found = doc.get_cursor_pos(&cursor).ok()?;
        let at = found.current.pos;
        let at = if cursor.id.is_none() || found.current.side == Side::Left {
            at
        } else {
            at + 1
        };
        if let Some(update) = found.update {
            #[cfg(test)]
            {
                self.replays += 1;
            }
            self.moved.insert(stored.to_vec(), update);
        }
        Some(at)
    }

    pub(crate) fn position(&mut self, doc: &LoroDoc, stored: &[u8]) -> Option<usize> {
        self.settle(doc);
        self.boundary(doc, stored)
    }

    fn resolve(
        &mut self,
        doc: &LoroDoc,
        text: &LoroText,
        start: &[u8],
        end: &[u8],
    ) -> Option<CommentRange> {
        self.settle(doc);
        let from = self.boundary(doc, start)?;
        let to = self.boundary(doc, end)?;
        if from >= to {
            return None;
        }
        Some(CommentRange {
            from: text.convert_pos(from, PosType::Event, PosType::Utf16)?,
            to: text.convert_pos(to, PosType::Event, PosType::Utf16)?,
        })
    }
}

fn write_message(
    messages: &LoroList,
    author: AccountId,
    at: i64,
    body: &str,
    mentions: &[AccountId],
) -> Result<CommentId, CollabError> {
    let id = CommentId::new_v7();
    let message = messages
        .push_container(LoroMap::new())
        .map_err(loro_error)?;
    message.insert(ID, id.to_string()).map_err(loro_error)?;
    message
        .insert(AUTHOR, author.to_string())
        .map_err(loro_error)?;
    message.insert(AT, at).map_err(loro_error)?;
    message.insert(BODY, body).map_err(loro_error)?;
    message
        .insert(MENTIONS, mention_value(&unique(mentions)))
        .map_err(loro_error)?;
    Ok(id)
}

struct FoundMessage {
    map: LoroMap,
    message: CommentMessage,
}

pub(crate) fn unsent_comments(before: &ProjectDoc, after: &ProjectDoc) -> Vec<UnsentComment> {
    let mut keys = Vec::new();
    before.loro().get_map(COMMENTS).for_each(|key, _| {
        if let Some(found) = split_key(key) {
            keys.push(found);
        }
    });
    let mut threads: Vec<CommentThread> = keys
        .into_iter()
        .filter_map(|(file, thread)| {
            let id: CommentId = thread.parse().ok()?;
            before.comment_thread(&file, id).ok().flatten()
        })
        .collect();
    threads.sort_by(|left, right| {
        (&left.file_id, left.created_at, left.id).cmp(&(&right.file_id, right.created_at, right.id))
    });
    let mut unsent = Vec::new();
    for thread in threads {
        let kept: HashMap<CommentId, String> = after
            .comment_thread(&thread.file_id, thread.id)
            .ok()
            .flatten()
            .map(|found| {
                found
                    .messages
                    .into_iter()
                    .map(|message| (message.id, message.body))
                    .collect()
            })
            .unwrap_or_default();
        for message in thread.messages.iter().filter(|message| !message.deleted) {
            if kept.get(&message.id) == Some(&message.body) {
                continue;
            }
            unsent.push(UnsentComment {
                file_id: thread.file_id.clone(),
                thread_id: thread.id,
                quote: thread.anchor.quote.clone(),
                body: message.body.clone(),
            });
        }
    }
    unsent
}

impl ProjectDoc {
    fn thread_container(&self, file_id: &str, thread: CommentId) -> Option<LoroMap> {
        match self
            .loro()
            .get_map(COMMENTS)
            .get(&thread_key(file_id, thread))
        {
            Some(ValueOrContainer::Container(Container::Map(map))) => Some(map),
            _ => None,
        }
    }

    fn read_thread(
        &self,
        file_id: &str,
        id: CommentId,
        map: &LoroMap,
        text: &LoroText,
    ) -> Option<CommentThread> {
        let LoroValue::Map(fields) = map.get_deep_value() else {
            return None;
        };
        let created_by: AccountId = parsed(fields.get(CREATED_BY))?;
        let authors = self.judge();
        let maps = if authors.checking() {
            message_maps(map)
        } else {
            Vec::new()
        };
        let messages: Vec<CommentMessage> = match fields.get(MESSAGES) {
            Some(LoroValue::List(items)) => items
                .iter()
                .enumerate()
                .filter_map(|(index, item)| {
                    let mut message = message_of(item)?;
                    if let Some(Some(written)) = maps.get(index) {
                        message.verified = authors.wrote_all(written, message.author);
                    }
                    Some(message)
                })
                .collect(),
            _ => Vec::new(),
        };
        if messages.is_empty() {
            return None;
        }
        let answered = messages
            .iter()
            .any(|message| message.author != created_by && !message.deleted);
        let tombstoned = flag_of(fields.get(DELETED)) && authors.wrote(map, &[DELETED], created_by);
        if tombstoned && !answered {
            return None;
        }
        let resolved = resolution_of(fields.get(RESOLVED)).map(|resolution| CommentResolution {
            verified: authors.wrote(map, &[RESOLVED], resolution.by),
            ..resolution
        });
        let start = cursor_of(fields.get(START))?;
        let end = cursor_of(fields.get(END))?;
        Some(CommentThread {
            id,
            file_id: file_id.to_owned(),
            anchor: CommentAnchor {
                quote: string_of(fields.get(QUOTE)).unwrap_or_default(),
                range: self.anchors().resolve(self.loro(), text, start, end),
            },
            created_by,
            created_at: number_of(fields.get(CREATED_AT)).unwrap_or_default(),
            resolved,
            messages,
            verified: authors.wrote(map, &THREAD_KEYS, created_by),
        })
    }

    fn open_thread(
        &self,
        file_id: &str,
        thread: CommentId,
    ) -> Result<(LoroMap, CommentThread), CollabError> {
        let text = self.text_of(file_id)?;
        let map = self
            .thread_container(file_id, thread)
            .ok_or_else(thread_gone)?;
        let view = self
            .read_thread(file_id, thread, &map, &text)
            .ok_or_else(thread_gone)?;
        Ok((map, view))
    }

    fn writable_thread(&self, file_id: &str, thread: CommentId) -> Result<LoroMap, CollabError> {
        let text = self.text_of(file_id)?;
        let map = self
            .thread_container(file_id, thread)
            .ok_or_else(thread_gone)?;
        let tombstoned = matches!(
            map.get(DELETED),
            Some(ValueOrContainer::Value(LoroValue::Bool(true)))
        );
        if tombstoned && self.read_thread(file_id, thread, &map, &text).is_none() {
            return Err(thread_gone());
        }
        Ok(map)
    }

    fn find_message(
        &self,
        file_id: &str,
        thread: CommentId,
        message: CommentId,
    ) -> Result<FoundMessage, CollabError> {
        let map = self.writable_thread(file_id, thread)?;
        let Some(ValueOrContainer::Container(Container::List(messages))) = map.get(MESSAGES) else {
            return Err(message_gone());
        };
        let LoroValue::List(items) = messages.get_deep_value() else {
            return Err(message_gone());
        };
        let index = items
            .iter()
            .position(|item| message_of(item).is_some_and(|found| found.id == message))
            .ok_or_else(message_gone)?;
        let mut found = message_of(&items[index]).ok_or_else(message_gone)?;
        match messages.get(index) {
            Some(ValueOrContainer::Container(Container::Map(map))) => {
                found.verified = self.judge().wrote_all(&map, found.author);
                Ok(FoundMessage {
                    map,
                    message: found,
                })
            }
            _ => Err(message_gone()),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_comment_thread(
        &mut self,
        file_id: &str,
        from: usize,
        to: usize,
        author: AccountId,
        at: i64,
        body: &str,
        mentions: &[AccountId],
    ) -> Result<CommentThread, CollabError> {
        self.writable()?;
        let body = checked_body(body)?;
        let text = self.text_of(file_id)?;
        let stale = || {
            refused(
                409,
                "selection_changed",
                "the selected text changed, select it again",
            )
        };
        let quote = quoted(&text.to_string(), from, to).ok_or_else(stale)?;
        let first = text
            .convert_pos(from, PosType::Utf16, PosType::Event)
            .ok_or_else(stale)?;
        let after = text
            .convert_pos(to, PosType::Utf16, PosType::Event)
            .ok_or_else(stale)?;
        let start = text.get_cursor(first, Side::Left).ok_or_else(stale)?;
        let end = text
            .get_cursor(after.checked_sub(1).ok_or_else(stale)?, Side::Right)
            .ok_or_else(stale)?;
        let id = CommentId::new_v7();
        let thread = self
            .loro()
            .get_map(COMMENTS)
            .insert_container(&thread_key(file_id, id), LoroMap::new())
            .map_err(loro_error)?;
        thread.insert(START, start.encode()).map_err(loro_error)?;
        thread.insert(END, end.encode()).map_err(loro_error)?;
        thread.insert(QUOTE, quote).map_err(loro_error)?;
        thread
            .insert(CREATED_BY, author.to_string())
            .map_err(loro_error)?;
        thread.insert(CREATED_AT, at).map_err(loro_error)?;
        let messages = thread
            .insert_container(MESSAGES, LoroList::new())
            .map_err(loro_error)?;
        write_message(&messages, author, at, body, mentions)?;
        self.loro().commit();
        self.comment_thread(file_id, id)?.ok_or_else(thread_gone)
    }

    pub fn comment_threads(&self, file_id: &str) -> Result<Vec<CommentThread>, CollabError> {
        let text = self.text_of(file_id)?;
        let prefix = format!("{file_id}/");
        let mut found = Vec::new();
        self.loro().get_map(COMMENTS).for_each(|key, value| {
            let Some(id) = key.strip_prefix(&prefix).and_then(|id| id.parse().ok()) else {
                return;
            };
            if let ValueOrContainer::Container(Container::Map(map)) = value {
                found.push((id, map));
            }
        });
        let mut threads: Vec<CommentThread> = found
            .iter()
            .filter_map(|(id, map)| self.read_thread(file_id, *id, map, &text))
            .collect();
        threads.sort_by_key(|thread| {
            (
                thread.anchor.range.is_none(),
                thread.anchor.range.map(|range| (range.from, range.to)),
                thread.created_at,
                thread.id,
            )
        });
        Ok(threads)
    }

    pub fn commented_files(&self) -> BTreeSet<String> {
        let mut files = BTreeSet::new();
        self.loro().get_map(COMMENTS).for_each(|key, _| {
            if let Some((file, _)) = split_key(key) {
                files.insert(file);
            }
        });
        files
    }

    pub fn comment_thread(
        &self,
        file_id: &str,
        thread: CommentId,
    ) -> Result<Option<CommentThread>, CollabError> {
        let text = self.text_of(file_id)?;
        Ok(self
            .thread_container(file_id, thread)
            .and_then(|map| self.read_thread(file_id, thread, &map, &text)))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn reply_to_comment(
        &mut self,
        file_id: &str,
        thread: CommentId,
        author: AccountId,
        at: i64,
        body: &str,
        mentions: &[AccountId],
    ) -> Result<CommentMessage, CollabError> {
        self.writable()?;
        let body = checked_body(body)?;
        let map = self.writable_thread(file_id, thread)?;
        let Some(ValueOrContainer::Container(Container::List(messages))) = map.get(MESSAGES) else {
            return Err(thread_gone());
        };
        let id = write_message(&messages, author, at, body, mentions)?;
        self.loro().commit();
        Ok(CommentMessage {
            id,
            author,
            at,
            body: body.to_owned(),
            edited_at: None,
            deleted: false,
            mentions: unique(mentions),
            verified: true,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn edit_comment(
        &mut self,
        file_id: &str,
        thread: CommentId,
        message: CommentId,
        by: AccountId,
        at: i64,
        body: &str,
        mentions: &[AccountId],
    ) -> Result<CommentMessage, CollabError> {
        self.writable()?;
        let body = checked_body(body)?;
        let found = self.find_message(file_id, thread, message)?;
        if found.message.author != by {
            return Err(not_yours());
        }
        if found.message.deleted {
            return Err(refused(409, "message_deleted", "this comment was deleted"));
        }
        found.map.insert(BODY, body).map_err(loro_error)?;
        found.map.insert(EDITED_AT, at).map_err(loro_error)?;
        let mentions = unique(mentions);
        if mentions != found.message.mentions {
            found
                .map
                .insert(MENTIONS, mention_value(&mentions))
                .map_err(loro_error)?;
        }
        self.loro().commit();
        Ok(CommentMessage {
            body: body.to_owned(),
            edited_at: Some(at),
            mentions,
            ..found.message
        })
    }

    pub fn delete_comment(
        &mut self,
        file_id: &str,
        thread: CommentId,
        message: CommentId,
        by: AccountId,
    ) -> Result<(), CollabError> {
        self.writable()?;
        let found = self.find_message(file_id, thread, message)?;
        if found.message.author != by {
            return Err(not_yours());
        }
        if found.message.deleted {
            return Ok(());
        }
        found.map.insert(DELETED, true).map_err(loro_error)?;
        found.map.insert(BODY, "").map_err(loro_error)?;
        self.loro().commit();
        Ok(())
    }

    pub fn resolve_comment_thread(
        &mut self,
        file_id: &str,
        thread: CommentId,
        by: AccountId,
        at: i64,
    ) -> Result<(), CollabError> {
        self.writable()?;
        let map = self.writable_thread(file_id, thread)?;
        let resolution = HashMap::from([
            ("by".to_owned(), LoroValue::from(by.to_string())),
            ("at".to_owned(), LoroValue::from(at)),
        ]);
        map.insert(RESOLVED, resolution).map_err(loro_error)?;
        self.loro().commit();
        Ok(())
    }

    pub fn reopen_comment_thread(
        &mut self,
        file_id: &str,
        thread: CommentId,
    ) -> Result<(), CollabError> {
        self.writable()?;
        let map = self.writable_thread(file_id, thread)?;
        map.insert(RESOLVED, LoroValue::Null).map_err(loro_error)?;
        self.loro().commit();
        Ok(())
    }

    pub fn delete_comment_thread(
        &mut self,
        file_id: &str,
        thread: CommentId,
        by: AccountId,
    ) -> Result<(), CollabError> {
        self.writable()?;
        let (map, view) = self.open_thread(file_id, thread)?;
        if view.created_by != by {
            return Err(not_yours());
        }
        if view
            .messages
            .iter()
            .any(|message| message.author != by && !message.deleted)
        {
            return Err(refused(
                409,
                "someone_replied",
                "someone else replied, so this thread stays",
            ));
        }
        map.insert(DELETED, true).map_err(loro_error)?;
        self.loro().commit();
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn open_suggestion_thread(
        &self,
        file_id: &str,
        start: &[u8],
        end: &[u8],
        quote: &str,
        suggestion: &str,
        author: AccountId,
        at: i64,
        body: &str,
        mentions: &[AccountId],
    ) -> Result<CommentId, CollabError> {
        self.writable()?;
        let body = checked_body(body)?;
        self.text_of(file_id)?;
        let id = CommentId::new_v7();
        let thread = self
            .loro()
            .get_map(COMMENTS)
            .insert_container(&thread_key(file_id, id), LoroMap::new())
            .map_err(loro_error)?;
        thread.insert(START, start.to_vec()).map_err(loro_error)?;
        thread.insert(END, end.to_vec()).map_err(loro_error)?;
        let quote: String = quote.chars().take(MAX_QUOTE_CHARS).collect();
        thread.insert(QUOTE, quote).map_err(loro_error)?;
        thread
            .insert(CREATED_BY, author.to_string())
            .map_err(loro_error)?;
        thread.insert(CREATED_AT, at).map_err(loro_error)?;
        thread.insert(SUGGESTION, suggestion).map_err(loro_error)?;
        let messages = thread
            .insert_container(MESSAGES, LoroList::new())
            .map_err(loro_error)?;
        write_message(&messages, author, at, body, mentions)?;
        Ok(id)
    }

    pub(crate) fn suggestion_threads(&self, file_id: &str) -> HashMap<String, CommentId> {
        let prefix = format!("{file_id}/");
        let mut found: Vec<(i64, CommentId, String)> = Vec::new();
        self.loro().get_map(COMMENTS).for_each(|key, value| {
            let Some(id) = key
                .strip_prefix(&prefix)
                .and_then(|id| id.parse::<CommentId>().ok())
            else {
                return;
            };
            let ValueOrContainer::Container(Container::Map(map)) = value else {
                return;
            };
            let LoroValue::Map(fields) = map.get_deep_value() else {
                return;
            };
            if flag_of(fields.get(DELETED)) {
                return;
            }
            if let Some(suggestion) = string_of(fields.get(SUGGESTION)) {
                let at = number_of(fields.get(CREATED_AT)).unwrap_or_default();
                found.push((at, id, suggestion));
            }
        });
        found.sort();
        let mut threads = HashMap::new();
        for (_, id, suggestion) in found {
            threads.entry(suggestion).or_insert(id);
        }
        threads
    }

    pub fn authorship(&self) -> &Authorship {
        self.authors()
    }

    pub(crate) fn judge(&self) -> Judge<'_> {
        Judge {
            authors: self.authors(),
            own_peer: self.loro().peer_id(),
            me: self.author_account(),
        }
    }

    pub fn set_authorship(&mut self, authorship: Authorship) {
        *self.authors_mut() = authorship;
    }

    pub fn comment_changes(&self, events: CommentEvents) -> CommentChanges {
        let files = events.files();
        let mut seen = std::collections::HashSet::new();
        let mut mentions = Vec::new();
        for (file_id, thread, container) in events.messages {
            if !seen.insert(container.clone()) {
                continue;
            }
            let Ok(thread_id) = thread.parse() else {
                continue;
            };
            let written = self.loro().get_map(container);
            let Some(message) = message_of(&written.get_deep_value()) else {
                continue;
            };
            if message.deleted
                || message.mentions.is_empty()
                || !self.judge().wrote_all(&written, message.author)
            {
                continue;
            }
            mentions.push(CommentMention {
                file_id,
                thread_id,
                message_id: message.id,
                author: message.author,
                mentions: message.mentions,
            });
        }
        CommentChanges { files, mentions }
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use oleafly_collab_protocol::ids::DeviceId;
    use oleafly_collab_protocol::projects::ProjectRole;
    use oleafly_collab_protocol::snapshots::ProjectPeer;

    use super::*;
    use crate::doc::NodeKind;
    use crate::live::LiveProject;
    use crate::ot::TextOperation;

    const TEXT: &str = "The quick brown fox jumps over the lazy dog.\nSecond line 🦊 here.\n";

    fn pair() -> (ProjectDoc, ProjectDoc, String) {
        let mut owner = ProjectDoc::create().unwrap();
        let main = owner
            .add_node(None, "main.tex", NodeKind::Text, None, TEXT)
            .unwrap();
        let joiner = ProjectDoc::load(&owner.snapshot().unwrap()).unwrap();
        (owner, joiner, main)
    }

    fn sync(from: &ProjectDoc, to: &mut ProjectDoc) {
        to.import(&from.export_since(&to.version()).unwrap())
            .unwrap();
    }

    fn sync_both(left: &mut ProjectDoc, right: &mut ProjectDoc) {
        let to_right = left.export_since(&right.version()).unwrap();
        let to_left = right.export_since(&left.version()).unwrap();
        right.import(&to_right).unwrap();
        left.import(&to_left).unwrap();
    }

    fn units(text: &str) -> usize {
        text.encode_utf16().count()
    }

    fn range_of(text: &str, needle: &str) -> (usize, usize) {
        let at = text.find(needle).unwrap();
        let from = units(&text[..at]);
        (from, from + units(needle))
    }

    fn slice(text: &str, range: CommentRange) -> String {
        let all: Vec<u16> = text.encode_utf16().collect();
        String::from_utf16(&all[range.from..range.to]).unwrap()
    }

    fn insert_at(doc: &mut ProjectDoc, id: &str, at: usize, inserted: &str) {
        let length = units(&doc.text(id).unwrap());
        let mut operation = TextOperation::new();
        operation.retain(at).insert(inserted).retain(length - at);
        doc.apply_operation(id, &operation).unwrap();
    }

    fn delete_range(doc: &mut ProjectDoc, id: &str, from: usize, to: usize) {
        let length = units(&doc.text(id).unwrap());
        let mut operation = TextOperation::new();
        operation.retain(from).delete(to - from).retain(length - to);
        doc.apply_operation(id, &operation).unwrap();
    }

    fn start_thread(
        doc: &mut ProjectDoc,
        file: &str,
        needle: &str,
        author: AccountId,
        body: &str,
    ) -> CommentThread {
        let (from, to) = range_of(&doc.text(file).unwrap(), needle);
        doc.create_comment_thread(file, from, to, author, 10, body, &[])
            .unwrap()
    }

    fn resolved_text(doc: &ProjectDoc, file: &str, thread: CommentId) -> Option<String> {
        let found = doc.comment_thread(file, thread).unwrap().unwrap();
        found
            .anchor
            .range
            .map(|range| slice(&doc.text(file).unwrap(), range))
    }

    fn refused_code(error: CollabError) -> String {
        match error {
            CollabError::Api { code, .. } => code,
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn a_thread_starts_with_its_quote_its_range_and_its_first_message() {
        let (mut owner, _joiner, main) = pair();
        let alice = AccountId::new_v7();
        let (from, to) = range_of(TEXT, "brown fox");
        let created = owner
            .create_comment_thread(&main, from, to, alice, 42, "  Which fox?  ", &[])
            .unwrap();
        assert_eq!(created.file_id, main);
        assert_eq!(created.anchor.quote, "brown fox");
        assert_eq!(created.anchor.range, Some(CommentRange { from, to }));
        assert_eq!(created.created_by, alice);
        assert_eq!(created.created_at, 42);
        assert_eq!(created.resolved, None);
        assert_eq!(created.messages.len(), 1);
        assert_eq!(created.messages[0].author, alice);
        assert_eq!(created.messages[0].body, "Which fox?");
        assert_eq!(created.messages[0].at, 42);
        assert!(!created.messages[0].deleted);
        assert_eq!(owner.comment_threads(&main).unwrap(), vec![created.clone()]);
        let reloaded = ProjectDoc::load(&owner.snapshot().unwrap()).unwrap();
        assert_eq!(reloaded.comment_threads(&main).unwrap(), vec![created]);
    }

    #[test]
    fn a_thread_needs_a_real_selection_and_a_message() {
        let (mut owner, _joiner, main) = pair();
        let alice = AccountId::new_v7();
        let fox = TEXT.find('🦊').unwrap();
        let inside_fox = units(&TEXT[..fox]) + 1;
        for (from, to, body) in [
            (3, 3, "empty"),
            (5, 3, "backwards"),
            (0, units(TEXT) + 1, "past the end"),
            (inside_fox, inside_fox + 2, "half a character"),
            (0, 3, "   "),
        ] {
            assert!(
                owner
                    .create_comment_thread(&main, from, to, alice, 1, body, &[])
                    .is_err(),
                "{body}"
            );
        }
        assert!(owner
            .create_comment_thread("no-such-file", 0, 3, alice, 1, "hi", &[])
            .is_err());
        assert!(owner.comment_threads(&main).unwrap().is_empty());
        let whole_fox = owner
            .create_comment_thread(&main, inside_fox - 1, inside_fox + 1, alice, 1, "ok", &[])
            .unwrap();
        assert_eq!(whole_fox.anchor.quote, "🦊");
    }

    #[test]
    fn replies_edits_and_deletes_follow_their_author() {
        let (mut owner, _joiner, main) = pair();
        let (alice, bob) = (AccountId::new_v7(), AccountId::new_v7());
        let thread = start_thread(&mut owner, &main, "lazy dog", alice, "Too lazy?");
        let reply = owner
            .reply_to_comment(&main, thread.id, bob, 20, "I like it", &[])
            .unwrap();
        let mine = owner
            .reply_to_comment(&main, thread.id, alice, 30, "Fine", &[])
            .unwrap();
        let edited = owner
            .edit_comment(
                &main,
                thread.id,
                thread.messages[0].id,
                alice,
                40,
                "Too lazy, maybe?",
                &[],
            )
            .unwrap();
        assert_eq!(edited.body, "Too lazy, maybe?");
        assert_eq!(edited.edited_at, Some(40));
        let refused = owner
            .edit_comment(
                &main,
                thread.id,
                thread.messages[0].id,
                bob,
                41,
                "Hijack",
                &[],
            )
            .unwrap_err();
        assert_eq!(refused_code(refused), "not_yours");
        assert_eq!(
            refused_code(
                owner
                    .delete_comment(&main, thread.id, reply.id, alice)
                    .unwrap_err()
            ),
            "not_yours"
        );
        owner
            .delete_comment(&main, thread.id, reply.id, bob)
            .unwrap();
        let after = owner.comment_thread(&main, thread.id).unwrap().unwrap();
        let ids: Vec<CommentId> = after.messages.iter().map(|message| message.id).collect();
        assert_eq!(ids, vec![thread.messages[0].id, reply.id, mine.id]);
        assert!(after.messages[1].deleted);
        assert_eq!(after.messages[1].body, "");
        assert_eq!(after.messages[1].author, bob);
        assert_eq!(after.messages[0].body, "Too lazy, maybe?");
        assert!(owner
            .edit_comment(&main, thread.id, reply.id, bob, 50, "Back", &[])
            .is_err());
        assert_eq!(
            refused_code(
                owner
                    .reply_to_comment(&main, CommentId::new_v7(), bob, 1, "lost", &[])
                    .unwrap_err()
            ),
            "not_found"
        );
    }

    #[test]
    fn a_thread_can_be_resolved_and_reopened() {
        let (mut owner, mut joiner, main) = pair();
        let (alice, bob) = (AccountId::new_v7(), AccountId::new_v7());
        let thread = start_thread(&mut owner, &main, "quick", alice, "Fast enough?");
        owner
            .resolve_comment_thread(&main, thread.id, bob, 77)
            .unwrap();
        sync(&owner, &mut joiner);
        let resolved = joiner.comment_thread(&main, thread.id).unwrap().unwrap();
        assert_eq!(
            resolved.resolved,
            Some(CommentResolution {
                by: bob,
                at: 77,
                verified: true
            })
        );
        joiner.reopen_comment_thread(&main, thread.id).unwrap();
        sync(&joiner, &mut owner);
        assert_eq!(
            owner
                .comment_thread(&main, thread.id)
                .unwrap()
                .unwrap()
                .resolved,
            None
        );
    }

    #[test]
    fn only_the_author_deletes_a_thread_and_only_without_replies_from_others() {
        let (mut owner, mut joiner, main) = pair();
        let (alice, bob) = (AccountId::new_v7(), AccountId::new_v7());
        let lonely = start_thread(&mut owner, &main, "quick", alice, "Hmm");
        owner
            .reply_to_comment(&main, lonely.id, alice, 11, "Never mind", &[])
            .unwrap();
        assert_eq!(
            refused_code(
                owner
                    .delete_comment_thread(&main, lonely.id, bob)
                    .unwrap_err()
            ),
            "not_yours"
        );
        owner
            .delete_comment_thread(&main, lonely.id, alice)
            .unwrap();
        assert!(owner.comment_thread(&main, lonely.id).unwrap().is_none());
        let discussed = start_thread(&mut owner, &main, "lazy", alice, "Why?");
        owner
            .reply_to_comment(&main, discussed.id, bob, 12, "Because", &[])
            .unwrap();
        assert_eq!(
            refused_code(
                owner
                    .delete_comment_thread(&main, discussed.id, alice)
                    .unwrap_err()
            ),
            "someone_replied"
        );
        let raced = start_thread(&mut owner, &main, "jumps", alice, "Typo?");
        sync(&owner, &mut joiner);
        owner.delete_comment_thread(&main, raced.id, alice).unwrap();
        joiner
            .reply_to_comment(&main, raced.id, bob, 13, "No, it is right", &[])
            .unwrap();
        sync_both(&mut owner, &mut joiner);
        for doc in [&owner, &joiner] {
            let kept = doc.comment_thread(&main, raced.id).unwrap().unwrap();
            assert_eq!(kept.messages.len(), 2);
            assert_eq!(kept.messages[1].author, bob);
        }
        let listed: Vec<CommentId> = owner
            .comment_threads(&main)
            .unwrap()
            .iter()
            .map(|thread| thread.id)
            .collect();
        assert!(listed.contains(&discussed.id));
        assert!(listed.contains(&raced.id));
        assert!(!listed.contains(&lonely.id));
    }

    #[test]
    fn an_anchor_follows_concurrent_edits_before_after_and_inside_it() {
        let (mut owner, mut joiner, main) = pair();
        let alice = AccountId::new_v7();
        let thread = start_thread(&mut owner, &main, "brown fox", alice, "Colour?");
        sync(&owner, &mut joiner);
        let (from, to) = range_of(TEXT, "brown fox");
        insert_at(&mut owner, &main, to, "🦊!!");
        insert_at(&mut owner, &main, 0, "Well, ");
        insert_at(&mut joiner, &main, from + units("brown "), "red ");
        insert_at(&mut joiner, &main, from, "very ");
        let end = units(&joiner.text(&main).unwrap());
        insert_at(&mut joiner, &main, end, "Tail.\n");
        sync_both(&mut owner, &mut joiner);
        let text = owner.text(&main).unwrap();
        assert_eq!(text, joiner.text(&main).unwrap());
        assert!(text.starts_with("Well, The quick very brown red fox🦊!! jumps"));
        for doc in [&owner, &joiner] {
            assert_eq!(
                resolved_text(doc, &main, thread.id).as_deref(),
                Some("brown red fox")
            );
        }
        let second = start_thread(&mut owner, &main, "🦊 here", alice, "Emoji?");
        insert_at(&mut owner, &main, 0, "😀😀");
        assert_eq!(
            resolved_text(&owner, &main, second.id).as_deref(),
            Some("🦊 here")
        );
    }

    #[test]
    fn deleting_the_anchored_text_detaches_the_thread_and_keeps_its_quote() {
        let (mut owner, mut joiner, main) = pair();
        let alice = AccountId::new_v7();
        let gone = start_thread(&mut owner, &main, "jumps over", alice, "Verb?");
        let shrunk = start_thread(&mut owner, &main, "lazy dog", alice, "Noun?");
        sync(&owner, &mut joiner);
        let (from, to) = range_of(TEXT, "fox jumps over the");
        delete_range(&mut joiner, &main, from, to);
        let (from, to) = range_of(&joiner.text(&main).unwrap(), "lazy ");
        delete_range(&mut joiner, &main, from, to);
        sync(&joiner, &mut owner);
        for doc in [&owner, &joiner] {
            let detached = doc.comment_thread(&main, gone.id).unwrap().unwrap();
            assert_eq!(detached.anchor.range, None);
            assert_eq!(detached.anchor.quote, "jumps over");
            assert_eq!(resolved_text(doc, &main, shrunk.id).as_deref(), Some("dog"));
        }
        let (at, _) = range_of(&owner.text(&main).unwrap(), " dog");
        insert_at(&mut owner, &main, at, " cat leaps over the");
        assert_eq!(
            owner
                .comment_thread(&main, gone.id)
                .unwrap()
                .unwrap()
                .anchor
                .range,
            None
        );
        assert_eq!(
            resolved_text(&owner, &main, shrunk.id).as_deref(),
            Some("dog")
        );
    }

    #[test]
    fn comments_made_offline_on_two_peers_merge() {
        let (mut owner, mut joiner, main) = pair();
        let (alice, bob) = (AccountId::new_v7(), AccountId::new_v7());
        let shared = start_thread(&mut owner, &main, "quick", alice, "Start");
        sync(&owner, &mut joiner);
        let from_alice = start_thread(&mut owner, &main, "lazy", alice, "Alice's");
        owner
            .reply_to_comment(&main, shared.id, alice, 20, "Alice offline", &[])
            .unwrap();
        let from_bob = start_thread(&mut joiner, &main, "Second", bob, "Bob's");
        joiner
            .reply_to_comment(&main, shared.id, bob, 21, "Bob offline", &[])
            .unwrap();
        joiner
            .resolve_comment_thread(&main, from_bob.id, bob, 22)
            .unwrap();
        sync_both(&mut owner, &mut joiner);
        let left = owner.comment_threads(&main).unwrap();
        let right = joiner.comment_threads(&main).unwrap();
        assert_eq!(left, right);
        assert_eq!(left.len(), 3);
        let merged = owner.comment_thread(&main, shared.id).unwrap().unwrap();
        let bodies: BTreeSet<String> = merged
            .messages
            .iter()
            .map(|message| message.body.clone())
            .collect();
        assert_eq!(
            bodies,
            BTreeSet::from([
                "Start".to_owned(),
                "Alice offline".to_owned(),
                "Bob offline".to_owned()
            ])
        );
        assert_eq!(merged.messages[0].body, "Start");
        assert!(owner
            .comment_thread(&main, from_alice.id)
            .unwrap()
            .is_some());
        assert!(owner
            .comment_thread(&main, from_bob.id)
            .unwrap()
            .unwrap()
            .resolved
            .is_some());
    }

    #[test]
    fn threads_are_listed_per_file_in_document_order_with_detached_ones_last() {
        let (mut owner, _joiner, main) = pair();
        let notes = owner
            .add_node(None, "notes.md", NodeKind::Text, None, "Some notes\n")
            .unwrap();
        let alice = AccountId::new_v7();
        let late = start_thread(&mut owner, &main, "lazy", alice, "b");
        let early = start_thread(&mut owner, &main, "quick", alice, "a");
        let lost = start_thread(&mut owner, &main, "jumps", alice, "c");
        let (from, to) = range_of(&owner.text(&main).unwrap(), "jumps");
        delete_range(&mut owner, &main, from, to);
        let elsewhere = start_thread(&mut owner, &notes, "notes", alice, "d");
        let order: Vec<CommentId> = owner
            .comment_threads(&main)
            .unwrap()
            .iter()
            .map(|thread| thread.id)
            .collect();
        assert_eq!(order, vec![early.id, late.id, lost.id]);
        let other: Vec<CommentId> = owner
            .comment_threads(&notes)
            .unwrap()
            .iter()
            .map(|thread| thread.id)
            .collect();
        assert_eq!(other, vec![elsewhere.id]);
    }

    fn member(name: &str, login: Option<&str>) -> CommentMember {
        CommentMember {
            account_id: AccountId::new_v7(),
            display_name: name.to_owned(),
            login: login.map(str::to_owned),
        }
    }

    #[test]
    fn mentions_match_member_names_and_logins_at_word_starts() {
        let alice = member("Alice Smith", Some("asmith"));
        let al = member("Al", None);
        let bob = member("Bob", Some("bob"));
        let members = vec![al.clone(), alice.clone(), bob.clone()];
        assert_eq!(
            mentions_in("Thanks @Alice Smith and @BOB, cc @al.", &members),
            vec![alice.account_id, bob.account_id, al.account_id]
        );
        assert_eq!(
            mentions_in("@asmith @asmith @Alice Smith", &members),
            vec![alice.account_id]
        );
        assert!(mentions_in("mail me at x@bob or @Alice Smithson", &members).is_empty());
        assert!(mentions_in("no mentions here @ all", &members).is_empty());
        assert_eq!(mentions_in("(@bob)", &members), vec![bob.account_id]);
    }

    #[test]
    fn mentions_are_kept_with_each_message() {
        let (mut owner, _joiner, main) = pair();
        let (alice, bob) = (AccountId::new_v7(), AccountId::new_v7());
        let (from, to) = range_of(TEXT, "quick");
        let thread = owner
            .create_comment_thread(&main, from, to, alice, 1, "@Bob look", &[bob])
            .unwrap();
        assert_eq!(thread.messages[0].mentions, vec![bob]);
        let edited = owner
            .edit_comment(
                &main,
                thread.id,
                thread.messages[0].id,
                alice,
                2,
                "never mind",
                &[],
            )
            .unwrap();
        assert!(edited.mentions.is_empty());
    }

    #[test]
    fn a_long_thread_stays_fast() {
        let (mut owner, mut joiner, main) = pair();
        let (alice, bob) = (AccountId::new_v7(), AccountId::new_v7());
        let thread = start_thread(&mut owner, &main, "fox", alice, "Long one");
        let started = Instant::now();
        let mut last = None;
        for round in 0..3_000i64 {
            let author = if round % 2 == 0 { alice } else { bob };
            last = Some(
                owner
                    .reply_to_comment(
                        &main,
                        thread.id,
                        author,
                        round,
                        &format!("reply {round}"),
                        &[],
                    )
                    .unwrap(),
            );
        }
        let replying = started.elapsed();
        let last = last.unwrap();
        let started = Instant::now();
        let listed = owner.comment_threads(&main).unwrap();
        owner
            .edit_comment(&main, thread.id, last.id, last.author, 5, "edited", &[])
            .unwrap();
        sync(&owner, &mut joiner);
        let joined = joiner.comment_thread(&main, thread.id).unwrap().unwrap();
        let reading = started.elapsed();
        assert_eq!(listed[0].messages.len(), 3_001);
        assert_eq!(joined.messages.len(), 3_001);
        assert_eq!(joined.messages[3_000].body, "edited");
        assert!(
            replying < Duration::from_secs(20),
            "replying took {replying:?}"
        );
        assert!(reading < Duration::from_secs(5), "reading took {reading:?}");
    }

    #[test]
    fn an_import_reports_comment_changes_per_file_and_never_as_tree_changes() {
        let (mut owner, mut joiner, main) = pair();
        let alice = AccountId::new_v7();
        let since = joiner.version();
        let thread = start_thread(&mut owner, &main, "quick", alice, "First");
        let imported = joiner.import(&owner.export_since(&since).unwrap()).unwrap();
        assert!(!imported.changes.tree);
        assert!(imported.changes.texts.is_empty());
        assert!(!imported.changes.is_empty());
        assert_eq!(
            imported.changes.comments.files(),
            BTreeSet::from([main.clone()])
        );
        let since = joiner.version();
        owner
            .reply_to_comment(&main, thread.id, alice, 2, "Second", &[])
            .unwrap();
        let imported = joiner.import(&owner.export_since(&since).unwrap()).unwrap();
        assert!(!imported.changes.tree);
        assert_eq!(imported.changes.comments.files(), BTreeSet::from([main]));
    }

    fn live_pair() -> (LiveProject, LiveProject, String) {
        let (owner, joiner, main) = pair();
        (
            LiveProject::new(owner, 0, ProjectRole::Owner),
            LiveProject::new(joiner, 0, ProjectRole::Editor),
            main,
        )
    }

    #[test]
    fn remote_comment_changes_and_mentions_are_handed_out_once_without_disk_work() {
        let (mut alice_side, mut bob_side, main) = live_pair();
        let (alice, bob) = (AccountId::new_v7(), AccountId::new_v7());
        let (from, to) = range_of(TEXT, "quick");
        let thread = alice_side
            .comment_doc()
            .create_comment_thread(&main, from, to, alice, 1, "@Bob see this", &[bob])
            .unwrap();
        assert!(alice_side.take_comment_changes().is_empty());
        assert!(alice_side.take_disk_work().is_empty());
        let outgoing = alice_side.next_outgoing().unwrap().unwrap();
        bob_side.take_disk_work();
        assert!(bob_side.import_update(1, &outgoing.payload).unwrap());
        assert!(bob_side.take_disk_work().is_empty());
        let changes = bob_side.take_comment_changes();
        assert_eq!(changes.files, BTreeSet::from([main.clone()]));
        assert_eq!(
            changes.mentions,
            vec![CommentMention {
                file_id: main.clone(),
                thread_id: thread.id,
                message_id: thread.messages[0].id,
                author: alice,
                mentions: vec![bob],
            }]
        );
        assert!(bob_side.take_comment_changes().is_empty());
        alice_side.acknowledged(outgoing.batch, 1);
        let reply = alice_side
            .comment_doc()
            .reply_to_comment(&main, thread.id, alice, 2, "no mention", &[])
            .unwrap();
        alice_side
            .comment_doc()
            .edit_comment(
                &main,
                thread.id,
                thread.messages[0].id,
                alice,
                3,
                "@Bob see this one",
                &[bob],
            )
            .unwrap();
        let outgoing = alice_side.next_outgoing().unwrap().unwrap();
        bob_side.import_update(2, &outgoing.payload).unwrap();
        let changes = bob_side.take_comment_changes();
        assert_eq!(changes.files, BTreeSet::from([main.clone()]));
        assert!(changes.mentions.is_empty(), "{:?}", changes.mentions);
        alice_side.acknowledged(outgoing.batch, 2);
        alice_side
            .comment_doc()
            .edit_comment(&main, thread.id, reply.id, alice, 4, "@Bob too", &[bob])
            .unwrap();
        let outgoing = alice_side.next_outgoing().unwrap().unwrap();
        bob_side.import_update(3, &outgoing.payload).unwrap();
        assert_eq!(
            bob_side.take_comment_changes().mentions,
            vec![CommentMention {
                file_id: main,
                thread_id: thread.id,
                message_id: reply.id,
                author: alice,
                mentions: vec![bob],
            }]
        );
    }

    fn live_trio() -> (LiveProject, LiveProject, LiveProject, String) {
        let (owner, joiner, main) = pair();
        let third = ProjectDoc::load(&owner.snapshot().unwrap()).unwrap();
        (
            LiveProject::new(owner, 0, ProjectRole::Owner),
            LiveProject::new(joiner, 0, ProjectRole::Editor),
            LiveProject::new(third, 0, ProjectRole::Editor),
            main,
        )
    }

    fn signed(
        from: &mut LiveProject,
        seq: u64,
        to: &mut [&mut LiveProject],
        signer: Option<AccountId>,
    ) -> Vec<u8> {
        let outgoing = from.next_outgoing().unwrap().unwrap();
        for side in to.iter_mut() {
            assert!(side
                .import_update_from(seq, &outgoing.payload, signer)
                .unwrap());
        }
        from.acknowledged(outgoing.batch, seq);
        outgoing.payload
    }

    fn start_on(
        side: &mut LiveProject,
        main: &str,
        needle: &str,
        author: AccountId,
        body: &str,
    ) -> CommentThread {
        let (from, to) = range_of(TEXT, needle);
        side.comment_doc()
            .create_comment_thread(main, from, to, author, 1, body, &[])
            .unwrap()
    }

    fn seen(side: &LiveProject, main: &str, thread: CommentId) -> CommentThread {
        side.doc().comment_thread(main, thread).unwrap().unwrap()
    }

    #[test]
    fn a_comment_forged_by_another_device_is_never_shown_as_the_claimed_author() {
        let (mut alice_side, mut mallory_side, mut bob_side, main) = live_trio();
        let (alice, mallory) = (AccountId::new_v7(), AccountId::new_v7());
        let honest = start_on(&mut alice_side, &main, "quick", alice, "Mine");
        signed(
            &mut alice_side,
            1,
            &mut [&mut mallory_side, &mut bob_side],
            Some(alice),
        );
        let forged = start_on(
            &mut mallory_side,
            &main,
            "lazy",
            alice,
            "Alice never said this",
        );
        mallory_side
            .comment_doc()
            .reply_to_comment(&main, honest.id, alice, 3, "Nor this", &[])
            .unwrap();
        signed(&mut mallory_side, 2, &mut [&mut bob_side], Some(mallory));
        let fake = seen(&bob_side, &main, forged.id);
        assert!(!fake.verified);
        assert!(!fake.messages[0].verified);
        let real = seen(&bob_side, &main, honest.id);
        assert!(real.verified);
        assert!(real.messages[0].verified);
        assert_eq!(real.messages[1].author, alice);
        assert!(!real.messages[1].verified);
    }

    #[test]
    fn honest_messages_edits_deletes_and_resolves_are_verified_on_every_side() {
        let (mut alice_side, mut bob_side, mut carol_side, main) = live_trio();
        let (alice, bob) = (AccountId::new_v7(), AccountId::new_v7());
        let thread = start_on(&mut alice_side, &main, "quick", alice, "First");
        signed(
            &mut alice_side,
            1,
            &mut [&mut bob_side, &mut carol_side],
            Some(alice),
        );
        let reply = bob_side
            .comment_doc()
            .reply_to_comment(&main, thread.id, bob, 2, "Second", &[])
            .unwrap();
        bob_side
            .comment_doc()
            .resolve_comment_thread(&main, thread.id, bob, 3)
            .unwrap();
        signed(
            &mut bob_side,
            2,
            &mut [&mut alice_side, &mut carol_side],
            Some(bob),
        );
        alice_side
            .comment_doc()
            .edit_comment(
                &main,
                thread.id,
                thread.messages[0].id,
                alice,
                4,
                "First, fixed",
                &[],
            )
            .unwrap();
        signed(
            &mut alice_side,
            3,
            &mut [&mut bob_side, &mut carol_side],
            Some(alice),
        );
        bob_side
            .comment_doc()
            .delete_comment(&main, thread.id, reply.id, bob)
            .unwrap();
        signed(
            &mut bob_side,
            4,
            &mut [&mut alice_side, &mut carol_side],
            Some(bob),
        );
        for side in [&alice_side, &bob_side, &carol_side] {
            let view = seen(side, &main, thread.id);
            assert!(view.verified);
            assert_eq!(view.messages[0].body, "First, fixed");
            assert!(view.messages.iter().all(|message| message.verified));
            assert!(view.messages[1].deleted);
            assert_eq!(
                view.resolved,
                Some(CommentResolution {
                    by: bob,
                    at: 3,
                    verified: true
                })
            );
        }
    }

    #[test]
    fn a_forged_resolve_is_not_shown_as_resolved_by_the_claimed_person() {
        let (mut alice_side, mut mallory_side, mut bob_side, main) = live_trio();
        let (alice, mallory) = (AccountId::new_v7(), AccountId::new_v7());
        let thread = start_on(&mut alice_side, &main, "quick", alice, "Please check");
        signed(
            &mut alice_side,
            1,
            &mut [&mut mallory_side, &mut bob_side],
            Some(alice),
        );
        mallory_side
            .comment_doc()
            .resolve_comment_thread(&main, thread.id, alice, 9)
            .unwrap();
        signed(&mut mallory_side, 2, &mut [&mut bob_side], Some(mallory));
        let view = seen(&bob_side, &main, thread.id);
        let resolution = view.resolved.unwrap();
        assert_eq!(resolution.by, alice);
        assert!(!resolution.verified);
        assert!(view.verified);
    }

    #[test]
    fn a_forged_edit_of_someone_elses_message_is_not_shown_as_theirs() {
        let (mut alice_side, mut mallory_side, mut bob_side, main) = live_trio();
        let (alice, mallory) = (AccountId::new_v7(), AccountId::new_v7());
        let thread = start_on(&mut alice_side, &main, "quick", alice, "Looks good");
        signed(
            &mut alice_side,
            1,
            &mut [&mut mallory_side, &mut bob_side],
            Some(alice),
        );
        mallory_side
            .comment_doc()
            .edit_comment(
                &main,
                thread.id,
                thread.messages[0].id,
                alice,
                2,
                "Looks awful",
                &[],
            )
            .unwrap();
        signed(&mut mallory_side, 2, &mut [&mut bob_side], Some(mallory));
        let view = seen(&bob_side, &main, thread.id);
        assert_eq!(view.messages[0].body, "Looks awful");
        assert!(!view.messages[0].verified);
    }

    #[test]
    fn writing_with_another_devices_peer_makes_that_peer_unverifiable_in_any_order() {
        let (mut alice_side, mut mallory_side, mut bob_side, main) = live_trio();
        let mut carol_side = LiveProject::new(
            ProjectDoc::load(&bob_side.doc().snapshot().unwrap()).unwrap(),
            0,
            ProjectRole::Editor,
        );
        let (alice, mallory) = (AccountId::new_v7(), AccountId::new_v7());
        let thread = start_on(&mut alice_side, &main, "quick", alice, "Mine");
        let first = signed(&mut alice_side, 1, &mut [&mut mallory_side], Some(alice));
        let stolen = alice_side.doc().loro().peer_id();
        mallory_side
            .comment_doc()
            .loro()
            .set_peer_id(stolen)
            .unwrap();
        mallory_side
            .comment_doc()
            .reply_to_comment(&main, thread.id, alice, 2, "Signed as Alice's laptop", &[])
            .unwrap();
        let second = mallory_side.next_outgoing().unwrap().unwrap().payload;
        bob_side.import_update_from(1, &first, Some(alice)).unwrap();
        bob_side
            .import_update_from(2, &second, Some(mallory))
            .unwrap();
        carol_side
            .import_update_from(2, &second, Some(mallory))
            .unwrap();
        carol_side
            .import_update_from(1, &first, Some(alice))
            .unwrap();
        let on_bob = seen(&bob_side, &main, thread.id);
        assert_eq!(on_bob.messages.len(), 2);
        assert!(on_bob.messages.iter().all(|message| !message.verified));
        assert!(!on_bob.verified);
        assert_eq!(on_bob, seen(&carol_side, &main, thread.id));
    }

    fn table(peers: &[(u64, AccountId)]) -> Vec<ProjectPeer> {
        peers
            .iter()
            .map(|(peer, account)| ProjectPeer {
                peer: *peer,
                device_id: DeviceId::new_v7(),
                account_id: *account,
            })
            .collect()
    }

    #[test]
    fn a_comment_from_a_writer_nobody_vouched_for_is_unverified_once_authors_are_known() {
        let (mut alice_side, mut mallory_side, mut bob_side, main) = live_trio();
        let alice = AccountId::new_v7();
        let honest = start_on(&mut alice_side, &main, "quick", alice, "Mine");
        signed(
            &mut alice_side,
            1,
            &mut [&mut mallory_side, &mut bob_side],
            Some(alice),
        );
        let forged = start_on(
            &mut mallory_side,
            &main,
            "lazy",
            alice,
            "Nobody signed this",
        );
        let outgoing = mallory_side.next_outgoing().unwrap().unwrap();
        bob_side.import_update(2, &outgoing.payload).unwrap();
        assert!(seen(&bob_side, &main, honest.id).verified);
        let fake = seen(&bob_side, &main, forged.id);
        assert!(!fake.verified);
        assert!(!fake.messages[0].verified);
    }

    #[test]
    fn authors_from_history_show_verified_only_when_the_server_table_vouches_for_them() {
        let (mut alice_side, mut mallory_side, _bob_side, main) = live_trio();
        let (alice, mallory) = (AccountId::new_v7(), AccountId::new_v7());
        let honest = start_on(&mut alice_side, &main, "quick", alice, "Mine");
        let shared = alice_side.next_outgoing().unwrap().unwrap();
        mallory_side.import_update(1, &shared.payload).unwrap();
        let forged = start_on(&mut mallory_side, &main, "lazy", alice, "Unsigned");
        let history = mallory_side.doc().snapshot().unwrap();
        let alice_peer = alice_side.doc().loro().peer_id();
        let mallory_peer = mallory_side.doc().loro().peer_id();
        let late = || LiveProject::new(ProjectDoc::load(&history).unwrap(), 2, ProjectRole::Editor);
        let before_table = late();
        assert!(seen(&before_table, &main, honest.id).verified);
        let mut joiner = late();
        joiner.pin_peers(table(&[(alice_peer, alice), (mallory_peer, mallory)]));
        assert!(joiner.peers_vouched());
        assert!(seen(&joiner, &main, honest.id).verified);
        let fake = seen(&joiner, &main, forged.id);
        assert!(!fake.verified);
        assert!(!fake.messages[0].verified);
        let mut partial = late();
        partial.pin_peers(table(&[(mallory_peer, mallory)]));
        assert!(!seen(&partial, &main, honest.id).verified);
        let mut empty = late();
        empty.pin_peers(Vec::new());
        assert!(!seen(&empty, &main, honest.id).verified);
        assert!(!seen(&empty, &main, forged.id).verified);
        let dir = tempfile::tempdir().unwrap();
        joiner.save(dir.path()).unwrap();
        let reloaded = LiveProject::load(dir.path(), ProjectRole::Editor).unwrap();
        assert!(reloaded.peers_vouched());
        assert!(seen(&reloaded, &main, honest.id).verified);
        assert!(!seen(&reloaded, &main, forged.id).verified);
    }

    #[test]
    fn this_copy_vouches_for_its_own_writer_only_as_the_signed_in_person() {
        let (mut alice_side, mut bob_side, _carol_side, main) = live_trio();
        let (alice, bob) = (AccountId::new_v7(), AccountId::new_v7());
        bob_side.doc_mut().set_author(&bob.to_string(), "Bob");
        let theirs = start_on(&mut alice_side, &main, "quick", alice, "Hi");
        signed(&mut alice_side, 1, &mut [&mut bob_side], Some(alice));
        let mine = start_on(&mut bob_side, &main, "lazy", bob, "Mine");
        let claimed = start_on(&mut bob_side, &main, "brown", alice, "Not mine");
        assert!(seen(&bob_side, &main, theirs.id).verified);
        assert!(seen(&bob_side, &main, mine.id).verified);
        assert!(!seen(&bob_side, &main, claimed.id).verified);
        let outgoing = bob_side.next_outgoing().unwrap().unwrap();
        bob_side.acknowledged(outgoing.batch, 2);
        bob_side.bind_own_peer(DeviceId::new_v7());
        let dir = tempfile::tempdir().unwrap();
        bob_side.save(dir.path()).unwrap();
        let mut later = LiveProject::load(dir.path(), ProjectRole::Editor).unwrap();
        later.doc_mut().set_author(&bob.to_string(), "Bob");
        assert!(seen(&later, &main, mine.id).verified);
        assert!(!seen(&later, &main, claimed.id).verified);
    }

    #[test]
    fn a_forged_message_never_raises_a_mention() {
        let (mut alice_side, mut mallory_side, mut bob_side, main) = live_trio();
        let (alice, mallory, bob) = (
            AccountId::new_v7(),
            AccountId::new_v7(),
            AccountId::new_v7(),
        );
        let thread = start_on(&mut alice_side, &main, "quick", alice, "Hi");
        signed(
            &mut alice_side,
            1,
            &mut [&mut mallory_side, &mut bob_side],
            Some(alice),
        );
        bob_side.take_comment_changes();
        mallory_side
            .comment_doc()
            .reply_to_comment(&main, thread.id, alice, 2, "@Bob urgent", &[bob])
            .unwrap();
        signed(&mut mallory_side, 2, &mut [&mut bob_side], Some(mallory));
        let changes = bob_side.take_comment_changes();
        assert_eq!(changes.files, BTreeSet::from([main]));
        assert!(changes.mentions.is_empty(), "{:?}", changes.mentions);
    }

    #[test]
    fn what_was_witnessed_survives_a_save_and_load() {
        let (mut alice_side, mut mallory_side, mut bob_side, main) = live_trio();
        let (alice, mallory) = (AccountId::new_v7(), AccountId::new_v7());
        let forged = start_on(&mut mallory_side, &main, "lazy", alice, "Forged");
        signed(&mut mallory_side, 1, &mut [&mut bob_side], Some(mallory));
        let honest = start_on(&mut alice_side, &main, "quick", alice, "Real");
        signed(&mut alice_side, 2, &mut [&mut bob_side], Some(alice));
        let dir = tempfile::tempdir().unwrap();
        bob_side.save(dir.path()).unwrap();
        let loaded = LiveProject::load(dir.path(), ProjectRole::Editor).unwrap();
        assert!(!seen(&loaded, &main, forged.id).messages[0].verified);
        assert!(seen(&loaded, &main, honest.id).messages[0].verified);
    }

    #[test]
    fn a_long_signed_thread_stays_fast_to_read() {
        let (mut alice_side, mut bob_side, _carol_side, main) = live_trio();
        let alice = AccountId::new_v7();
        let thread = start_on(&mut alice_side, &main, "fox", alice, "Long one");
        for round in 0..3_000i64 {
            alice_side
                .comment_doc()
                .reply_to_comment(
                    &main,
                    thread.id,
                    alice,
                    round,
                    &format!("reply {round}"),
                    &[],
                )
                .unwrap();
        }
        signed(&mut alice_side, 1, &mut [&mut bob_side], Some(alice));
        assert!(!bob_side.doc().authorship().is_empty());
        let started = Instant::now();
        let listed = bob_side.doc().comment_threads(&main).unwrap();
        let reading = started.elapsed();
        assert_eq!(listed[0].messages.len(), 3_001);
        assert!(listed[0].messages.iter().all(|message| message.verified));
        assert!(reading < Duration::from_secs(1), "reading took {reading:?}");
    }

    #[test]
    fn every_refusal_names_what_went_wrong() {
        let (mut owner, _joiner, main) = pair();
        let alice = AccountId::new_v7();
        let (from, to) = range_of(TEXT, "quick");
        let refusal = |error: CollabError| match error {
            CollabError::Api { status, code, .. } => (status, code),
            other => panic!("expected a refusal, got {other:?}"),
        };
        assert_eq!(
            refusal(
                owner
                    .create_comment_thread(&main, from, to, alice, 1, "  \n ", &[])
                    .unwrap_err()
            ),
            (400, "empty".to_owned())
        );
        let long = "x".repeat(MAX_BODY_CHARS + 1);
        assert_eq!(
            refusal(
                owner
                    .create_comment_thread(&main, from, to, alice, 1, &long, &[])
                    .unwrap_err()
            ),
            (413, "too_large".to_owned())
        );
        assert_eq!(
            refusal(
                owner
                    .create_comment_thread(&main, 0, units(TEXT) + 4, alice, 1, "Gone", &[])
                    .unwrap_err()
            ),
            (409, "selection_changed".to_owned())
        );
        let thread = owner
            .create_comment_thread(&main, from, to, alice, 1, "Hello", &[])
            .unwrap();
        owner
            .delete_comment(&main, thread.id, thread.messages[0].id, alice)
            .unwrap();
        assert_eq!(
            refusal(
                owner
                    .edit_comment(
                        &main,
                        thread.id,
                        thread.messages[0].id,
                        alice,
                        2,
                        "Back",
                        &[]
                    )
                    .unwrap_err()
            ),
            (409, "message_deleted".to_owned())
        );
    }

    fn fresh(doc: &ProjectDoc) -> ProjectDoc {
        ProjectDoc::load(&doc.snapshot().unwrap()).unwrap()
    }

    fn deliver(docs: &mut [ProjectDoc], from: usize, to: usize) {
        let bytes = docs[from].export_since(&docs[to].version()).unwrap();
        docs[to].import(&bytes).unwrap();
    }

    #[test]
    fn a_reading_taken_before_someone_typed_inside_deleted_text_matches_a_fresh_one() {
        let (mut owner, mut joiner, main) = pair();
        let alice = AccountId::new_v7();
        let gone = start_thread(&mut owner, &main, "jumps over", alice, "Verb?");
        let shrunk = start_thread(&mut owner, &main, "lazy dog", alice, "Noun?");
        sync(&owner, &mut joiner);
        let (from, to) = range_of(TEXT, "jumps over");
        delete_range(&mut owner, &main, from, to);
        let (from, to) = range_of(&owner.text(&main).unwrap(), "lazy ");
        delete_range(&mut owner, &main, from, to);
        assert_eq!(resolved_text(&owner, &main, gone.id), None);
        assert_eq!(
            resolved_text(&owner, &main, shrunk.id).as_deref(),
            Some("dog")
        );
        let (at, _) = range_of(TEXT, "s over");
        insert_at(&mut joiner, &main, at, "ing");
        let (at, _) = range_of(&joiner.text(&main).unwrap(), "y dog");
        insert_at(&mut joiner, &main, at, "zz");
        sync_both(&mut owner, &mut joiner);
        let expected = fresh(&owner).comment_threads(&main).unwrap();
        assert_eq!(owner.comment_threads(&main).unwrap(), expected);
        assert_eq!(joiner.comment_threads(&main).unwrap(), expected);
        assert_eq!(
            resolved_text(&owner, &main, gone.id).as_deref(),
            Some("ing")
        );
        assert_eq!(
            resolved_text(&owner, &main, shrunk.id).as_deref(),
            Some("zzdog")
        );
    }

    #[test]
    fn a_moved_anchor_is_found_again_without_replaying_history() {
        let (mut owner, mut joiner, main) = pair();
        let alice = AccountId::new_v7();
        let notes = owner
            .add_node(None, "notes.md", NodeKind::Text, None, "Some notes here\n")
            .unwrap();
        start_thread(&mut owner, &main, "jumps over", alice, "Verb?");
        start_thread(&mut owner, &main, "lazy dog", alice, "Noun?");
        start_thread(&mut owner, &notes, "notes", alice, "Notes?");
        let (from, to) = range_of(TEXT, "jumps over");
        delete_range(&mut owner, &main, from, to);
        let (from, to) = range_of(&owner.text(&main).unwrap(), "lazy ");
        delete_range(&mut owner, &main, from, to);
        let (from, to) = range_of("Some notes here\n", "notes");
        delete_range(&mut owner, &notes, from, to);
        sync(&owner, &mut joiner);
        owner.comment_threads(&main).unwrap();
        owner.comment_threads(&notes).unwrap();
        assert!(owner.anchors().replays > 0);
        owner.anchors().replays = 0;
        insert_at(&mut owner, &main, 0, "Well, ");
        sync(&owner, &mut joiner);
        let end = units(&joiner.text(&main).unwrap());
        insert_at(&mut joiner, &main, end, "More.\n");
        insert_at(&mut joiner, &notes, 0, "Hi. ");
        sync(&joiner, &mut owner);
        assert_eq!(
            owner.comment_threads(&main).unwrap(),
            fresh(&owner).comment_threads(&main).unwrap()
        );
        assert_eq!(
            owner.comment_threads(&notes).unwrap(),
            fresh(&owner).comment_threads(&notes).unwrap()
        );
        assert_eq!(
            owner.anchors().replays,
            0,
            "edits made after the last reading replayed the history"
        );
        insert_at(&mut owner, &main, 0, "So. ");
        owner.comment_threads(&main).unwrap();
        insert_at(&mut joiner, &notes, 0, "Hey. ");
        sync_both(&mut owner, &mut joiner);
        assert_eq!(
            owner.comment_threads(&main).unwrap(),
            fresh(&owner).comment_threads(&main).unwrap()
        );
        assert_eq!(
            owner.anchors().replays,
            0,
            "an edit made at the same time in another file replayed this file's history"
        );
        assert_eq!(
            owner.comment_threads(&notes).unwrap(),
            fresh(&owner).comment_threads(&notes).unwrap()
        );
    }

    #[test]
    fn threads_on_a_file_emptied_and_written_again_read_like_a_fresh_copy() {
        let (mut owner, mut joiner, main) = pair();
        let alice = AccountId::new_v7();
        start_thread(&mut owner, &main, "quick", alice, "Adjective?");
        start_thread(&mut owner, &main, "here", alice, "Where?");
        delete_range(&mut owner, &main, 0, units(TEXT));
        assert!(owner
            .comment_threads(&main)
            .unwrap()
            .iter()
            .all(|thread| thread.anchor.range.is_none()));
        insert_at(&mut owner, &main, 0, "A new start.\n");
        sync(&owner, &mut joiner);
        let end = units(&joiner.text(&main).unwrap());
        insert_at(&mut joiner, &main, end, "And more here.\n");
        sync(&joiner, &mut owner);
        assert_eq!(
            owner.comment_threads(&main).unwrap(),
            fresh(&owner).comment_threads(&main).unwrap()
        );
    }

    #[test]
    fn listing_after_a_long_history_replays_it_once_and_not_on_every_listing() {
        let (mut owner, mut joiner, main) = pair();
        let alice = AccountId::new_v7();
        start_thread(&mut owner, &main, "jumps over", alice, "Verb?");
        start_thread(&mut owner, &main, "lazy dog", alice, "Noun?");
        let (from, to) = range_of(TEXT, "jumps over");
        delete_range(&mut owner, &main, from, to);
        let (from, to) = range_of(&owner.text(&main).unwrap(), "lazy ");
        delete_range(&mut owner, &main, from, to);
        for round in 0..4_000usize {
            let text = owner.text(&main).unwrap();
            let line = units(text.split('\n').next().unwrap_or_default());
            insert_at(&mut owner, &main, (round * 7_919) % line, "x");
        }
        sync(&owner, &mut joiner);
        let started = Instant::now();
        let first = owner.comment_threads(&main).unwrap();
        let cold = started.elapsed();
        assert_eq!(first, fresh(&owner).comment_threads(&main).unwrap());
        let mut warm = Duration::ZERO;
        for round in 0..20 {
            if round % 2 == 0 {
                insert_at(&mut owner, &main, 0, "y");
            } else {
                sync(&owner, &mut joiner);
                insert_at(&mut joiner, &main, 0, "z");
                sync(&joiner, &mut owner);
            }
            let started = Instant::now();
            let listed = owner.comment_threads(&main).unwrap();
            warm += started.elapsed();
            assert_eq!(listed.len(), 2);
        }
        assert_eq!(
            owner.comment_threads(&main).unwrap(),
            fresh(&owner).comment_threads(&main).unwrap()
        );
        assert!(
            warm < cold,
            "twenty listings between edits took {warm:?}, the first listing {cold:?}"
        );
    }

    #[test]
    fn readings_kept_between_random_edits_on_three_copies_match_fresh_ones() {
        let mut state = 0x9e37_79b9_7f4a_7c15_u64;
        let mut next = move |below: usize| -> usize {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state % below.max(1) as u64) as usize
        };
        let base = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu\n";
        let mut first = ProjectDoc::create().unwrap();
        let main = first
            .add_node(None, "main.tex", NodeKind::Text, None, base)
            .unwrap();
        let alice = AccountId::new_v7();
        for needle in ["beta", "gamma delta", "zeta", "iota kappa", "mu"] {
            start_thread(&mut first, &main, needle, alice, "Note");
        }
        let snapshot = first.snapshot().unwrap();
        let mut docs = [
            first,
            ProjectDoc::load(&snapshot).unwrap(),
            ProjectDoc::load(&snapshot).unwrap(),
        ];
        let words = ["a", "bc", "def", " ", "xy z"];
        for step in 0..400usize {
            let who = next(3);
            let length = units(&docs[who].text(&main).unwrap());
            match next(10) {
                0..=4 => {
                    let word = words[next(words.len())];
                    insert_at(&mut docs[who], &main, next(length + 1), word);
                }
                5..=7 if length > 0 => {
                    let from = next(length);
                    let to = (from + 1 + next(8)).min(length);
                    delete_range(&mut docs[who], &main, from, to);
                }
                _ => {
                    let other = (who + 1 + next(2)) % 3;
                    deliver(&mut docs, who, other);
                }
            }
            if step % 5 == 0 {
                let reader = next(3);
                assert_eq!(
                    docs[reader].comment_threads(&main).unwrap(),
                    fresh(&docs[reader]).comment_threads(&main).unwrap(),
                    "copy {reader} at step {step}"
                );
            }
        }
        for from in 0..3 {
            for to in 0..3 {
                if from != to {
                    deliver(&mut docs, from, to);
                }
            }
        }
        let expected = fresh(&docs[0]).comment_threads(&main).unwrap();
        for doc in &docs {
            assert_eq!(doc.comment_threads(&main).unwrap(), expected);
        }
    }
}
