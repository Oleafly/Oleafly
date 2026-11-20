use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use loro::cursor::{Cursor, Side};
use loro::{
    ContainerID, ContainerTrait, ContainerType, Frontiers, IdSpan, Index, JsonListOp, JsonMapOp,
    JsonOpContent, LoroDoc, LoroList, LoroMap, LoroValue, ValueOrContainer, ID,
};
use oleafly_collab_protocol::ids::AccountId;
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_collab_protocol::reactions::{
    reactions_counted, ReactionKey, MAX_REACTIONS_PER_PERSON, MAX_REACTION_KEYS,
};
use oleafly_collab_protocol::schema::{
    ANCHOR, AUTHOR, CHAT, CHAT_REACTIONS, COMMENTS, CREATED_AT, CREATED_BY, DELETE, DELETED, END,
    FILE_ID, ID as ID_KEY, INSERT, KIND, MAX_MENTIONS, MENTIONS, MESSAGES, QUOTE, REACTIONS,
    REMOVED, RESOLVED, START, SUGGESTION, SUGGESTIONS, TEXT, TEXT_PREFIX,
};

use crate::peers;
use crate::snapshots;

const ANCHORED: [&str; 6] = [CREATED_BY, CREATED_AT, QUOTE, START, END, SUGGESTION];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoleVerdict {
    Allowed,
    ChangesComments,
    Refused,
    Unreadable,
    Unchecked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Judged {
    pub verdict: RoleVerdict,
    pub comments: bool,
}

impl From<RoleVerdict> for Judged {
    fn from(verdict: RoleVerdict) -> Judged {
        Judged {
            verdict,
            comments: false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RoleRule {
    pub role: ProjectRole,
    pub account: AccountId,
    pub comments_off: bool,
}

impl RoleRule {
    pub fn needed(role: ProjectRole) -> bool {
        matches!(
            role,
            ProjectRole::Editor | ProjectRole::Reviewer | ProjectRole::Commenter
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Root {
    Comments,
    Chat,
    ChatReactions,
    Suggestions,
    Text,
    Detached,
    Other,
}

fn root_kind(root: &ContainerID) -> Root {
    let ContainerID::Root {
        name,
        container_type,
    } = root
    else {
        return Root::Other;
    };
    match (name.as_str(), container_type) {
        (COMMENTS, ContainerType::Map) => Root::Comments,
        (CHAT, ContainerType::List) => Root::Chat,
        (CHAT_REACTIONS, ContainerType::Map) => Root::ChatReactions,
        (SUGGESTIONS, ContainerType::Map) => Root::Suggestions,
        (name, ContainerType::Text) if name.starts_with(TEXT_PREFIX) => Root::Text,
        _ => Root::Other,
    }
}

struct Placed {
    root: Root,
    file: Option<String>,
    record: Option<String>,
}

fn placed(doc: &LoroDoc, container: &ContainerID) -> Placed {
    let unplaced = Placed {
        root: Root::Other,
        file: None,
        record: None,
    };
    let path = match container {
        ContainerID::Root { .. } => vec![(container.clone(), Index::Seq(0))],
        ContainerID::Normal { .. } => match doc.get_path_to_container(container) {
            Some(path) if !path.is_empty() => path,
            _ => {
                return Placed {
                    root: Root::Detached,
                    ..unplaced
                }
            }
        },
    };
    let root = root_kind(&path[0].0);
    let file = match (&path[0].0, root) {
        (ContainerID::Root { name, .. }, Root::Text) => {
            name.strip_prefix(TEXT_PREFIX).map(str::to_owned)
        }
        _ => None,
    };
    let record = match (root, path.get(1)) {
        (Root::Suggestions, Some((_, Index::Key(key)))) => Some(key.to_string()),
        _ => None,
    };
    Placed { root, file, record }
}

struct Piece {
    peer: u64,
    from: i32,
    to: i32,
    before: Frontiers,
    after: Frontiers,
}

impl Piece {
    fn made(&self, container: &ContainerID) -> bool {
        matches!(
            container,
            ContainerID::Normal { peer, counter, .. }
                if *peer == self.peer && (self.from..self.to).contains(counter)
        )
    }
}

fn pieces_of(doc: &LoroDoc, spans: &[(u64, i32, i32)]) -> Option<Vec<Piece>> {
    let mut pieces = Vec::new();
    for (peer, start, end) in spans {
        let mut counter = *start;
        while counter < *end {
            let change = doc.get_change(ID::new(*peer, counter))?;
            let change_end = change
                .id
                .counter
                .saturating_add(i32::try_from(change.len).ok()?);
            let to = change_end.min(*end);
            if to <= counter {
                return None;
            }
            let before = if counter == change.id.counter {
                change.deps.clone()
            } else {
                Frontiers::from(ID::new(*peer, counter - 1))
            };
            pieces.push(Piece {
                peer: *peer,
                from: counter,
                to,
                before,
                after: Frontiers::from(ID::new(*peer, to - 1)),
            });
            counter = to;
        }
    }
    Some(pieces)
}

#[derive(Clone, PartialEq)]
struct Entry {
    container: Option<ContainerID>,
    value: LoroValue,
}

fn entries(doc: &LoroDoc) -> BTreeMap<String, Entry> {
    let mut found = BTreeMap::new();
    doc.get_map(SUGGESTIONS).for_each(|key, value| {
        let entry = match value {
            ValueOrContainer::Container(loro::Container::Map(map)) => Entry {
                container: Some(map.id()),
                value: map.get_deep_value(),
            },
            ValueOrContainer::Container(other) => Entry {
                container: Some(other.id()),
                value: LoroValue::Null,
            },
            ValueOrContainer::Value(value) => Entry {
                container: None,
                value,
            },
        };
        found.insert(key.to_owned(), entry);
    });
    found
}

fn field<'a>(entry: &'a Entry, key: &str) -> Option<&'a LoroValue> {
    match &entry.value {
        LoroValue::Map(fields) => fields.get(key),
        _ => None,
    }
}

fn text_field(entry: &Entry, key: &str) -> Option<String> {
    match field(entry, key) {
        Some(LoroValue::String(text)) => Some(text.to_string()),
        _ => None,
    }
}

fn bytes_field<'a>(entry: &'a Entry, key: &str) -> Option<&'a [u8]> {
    match field(entry, key) {
        Some(LoroValue::Binary(bytes)) => Some(bytes),
        _ => None,
    }
}

fn written_by(entry: &Entry, account: &str) -> bool {
    entry.container.is_some() && text_field(entry, AUTHOR).as_deref() == Some(account)
}

fn text_name(file: &str) -> String {
    format!("{TEXT_PREFIX}{file}")
}

fn boundary(doc: &LoroDoc, file: &str, stored: &[u8]) -> Option<usize> {
    let cursor = Cursor::decode(stored).ok()?;
    if cursor.container != ContainerID::new_root(&text_name(file), ContainerType::Text) {
        return None;
    }
    let found = doc.get_cursor_pos(&cursor).ok()?;
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

fn base_text(
    doc: &LoroDoc,
    file: &str,
    touched: &BTreeSet<String>,
    all: &BTreeMap<String, Entry>,
) -> Option<String> {
    let text = doc.get_text(text_name(file)).to_string();
    let chars: Vec<char> = text.chars().collect();
    let mut removed = vec![false; chars.len()];
    let mut added: Vec<(usize, String, String)> = Vec::new();
    for id in touched {
        let Some(entry) = all.get(id) else {
            continue;
        };
        if text_field(entry, FILE_ID).as_deref() != Some(file) {
            continue;
        }
        match text_field(entry, KIND).as_deref() {
            Some(INSERT) => {
                let from = boundary(doc, file, bytes_field(entry, START)?)?;
                let to = boundary(doc, file, bytes_field(entry, END)?)?;
                if from > to || to > chars.len() {
                    return None;
                }
                for slot in &mut removed[from..to] {
                    *slot = true;
                }
            }
            Some(DELETE) => {
                let at = boundary(doc, file, bytes_field(entry, ANCHOR)?)?;
                if at > chars.len() {
                    return None;
                }
                added.push((at, id.clone(), text_field(entry, TEXT)?));
            }
            _ => return None,
        }
    }
    added.sort();
    let mut base = String::with_capacity(text.len());
    let mut next = added.iter().peekable();
    for (index, character) in chars.iter().enumerate() {
        while let Some((_, _, text)) = next.next_if(|(at, _, _)| *at == index) {
            base.push_str(text);
        }
        if !removed[index] {
            base.push(*character);
        }
    }
    for (_, _, text) in next {
        base.push_str(text);
    }
    Some(base)
}

struct Checked<'a> {
    doc: &'a LoroDoc,
    moved: bool,
}

impl Checked<'_> {
    fn to(&mut self, version: &Frontiers) -> bool {
        self.moved = true;
        self.doc.checkout(version).is_ok()
    }
}

impl Drop for Checked<'_> {
    fn drop(&mut self) {
        if self.moved {
            self.doc.checkout_to_latest();
            self.doc.free_history_cache();
        }
    }
}

fn reviewed(
    doc: &LoroDoc,
    piece: &Piece,
    files: BTreeSet<String>,
    records: BTreeSet<String>,
    account: &str,
) -> bool {
    let mut checked = Checked { doc, moved: false };
    if !checked.to(&piece.before) {
        return false;
    }
    let before = entries(doc);
    if !checked.to(&piece.after) {
        return false;
    }
    let after = entries(doc);
    let mut touched = records;
    for (id, entry) in &before {
        if after.get(id) != Some(entry) {
            touched.insert(id.clone());
        }
    }
    for id in after.keys() {
        if !before.contains_key(id) {
            touched.insert(id.clone());
        }
    }
    let mut files = files;
    for id in &touched {
        for side in [&before, &after] {
            let Some(entry) = side.get(id) else {
                continue;
            };
            if !written_by(entry, account) {
                return false;
            }
            match text_field(entry, FILE_ID) {
                Some(file) => {
                    files.insert(file);
                }
                None => return false,
            }
        }
    }
    let mut later = Vec::with_capacity(files.len());
    for file in &files {
        match base_text(doc, file, &touched, &after) {
            Some(base) => later.push(base),
            None => return false,
        }
    }
    if !checked.to(&piece.before) {
        return false;
    }
    files
        .iter()
        .zip(later)
        .all(|(file, base)| base_text(doc, file, &touched, &before) == Some(base))
}

fn value_at<'a>(value: &'a LoroValue, key: &str) -> Option<&'a LoroValue> {
    match value {
        LoroValue::Map(fields) => fields.get(key),
        _ => None,
    }
}

fn keys_of(value: &LoroValue) -> BTreeSet<&str> {
    match value {
        LoroValue::Map(fields) => fields.keys().map(String::as_str).collect(),
        _ => BTreeSet::new(),
    }
}

fn truthy(value: Option<&LoroValue>) -> bool {
    matches!(value, Some(LoroValue::Bool(true)))
}

fn names(value: Option<&LoroValue>, account: &str) -> bool {
    matches!(value, Some(LoroValue::String(text)) if text.as_str() == account)
}

fn listed(value: Option<&LoroValue>) -> Option<&[LoroValue]> {
    match value {
        Some(LoroValue::List(items)) => Some(items.as_slice()),
        _ => None,
    }
}

fn own(item: &LoroValue, account: &str) -> bool {
    matches!(item, LoroValue::Map(_)) && names(value_at(item, AUTHOR), account)
}

fn items_kept(before: &[LoroValue], after: &[LoroValue], account: &str) -> bool {
    after.len() >= before.len()
        && before.iter().zip(after).all(|(old, new)| {
            old == new
                || (own(old, account)
                    && own(new, account)
                    && value_at(old, ID_KEY) == value_at(new, ID_KEY)
                    && value_at(old, REMOVED) == value_at(new, REMOVED))
        })
        && after[before.len()..]
            .iter()
            .all(|new| own(new, account) && value_at(new, REMOVED).is_none())
}

struct Said<'a> {
    author: Option<&'a str>,
    removed: Option<&'a LoroValue>,
    whole: &'a LoroValue,
}

fn said_in(comments: &LoroValue) -> BTreeMap<(&str, &str), Said<'_>> {
    let mut found = BTreeMap::new();
    for thread in keys_of(comments) {
        let Some(messages) = value_at(comments, thread) else {
            continue;
        };
        for message in thread_messages(messages) {
            let Some(LoroValue::String(id)) = value_at(message, ID_KEY) else {
                continue;
            };
            let author = match value_at(message, AUTHOR) {
                Some(LoroValue::String(author)) => Some(author.as_str()),
                _ => None,
            };
            found.insert(
                (thread, id.as_str()),
                Said {
                    author,
                    removed: value_at(message, REMOVED),
                    whole: message,
                },
            );
        }
    }
    found
}

fn reactions_in<'a>(comments: &'a LoroValue, thread: &str) -> Option<&'a LoroValue> {
    value_at(comments, thread).and_then(|thread| value_at(thread, REACTIONS))
}

fn messages_of<'a>(comments: &'a LoroValue, thread: &str) -> &'a [LoroValue] {
    value_at(comments, thread).map_or(&[], thread_messages)
}

fn editor_kept(before: &LoroValue, after: &LoroValue, account: &str) -> bool {
    let (old, new) = (said_in(before), said_in(after));
    old.iter().all(|(key, was)| {
        new.get(key).is_some_and(|now| {
            if was.author == Some(account) {
                now.removed == was.removed && now.author == was.author
            } else {
                now.whole == was.whole
            }
        })
    }) && new
        .iter()
        .all(|(key, now)| old.contains_key(key) || now.removed.is_none())
        && anchors_kept(before, after)
        && keys_of(before).union(&keys_of(after)).all(|thread| {
            reactions_kept(
                reactions_in(before, thread),
                reactions_in(after, thread),
                account,
                messages_of(after, thread),
            )
        })
}

fn mentions_capped(before: &[LoroValue], after: &[LoroValue]) -> bool {
    after.iter().enumerate().all(|(index, message)| {
        let named = value_at(message, MENTIONS);
        before
            .get(index)
            .is_some_and(|old| value_at(old, MENTIONS) == named)
            || listed(named).is_none_or(|named| named.len() <= MAX_MENTIONS)
    })
}

fn discussion_capped(before: &Discussion, after: &Discussion) -> bool {
    let chat = listed(Some(&before.chat)).unwrap_or_default();
    mentions_capped(chat, listed(Some(&after.chat)).unwrap_or_default())
        && keys_of(&after.comments).into_iter().all(|thread| {
            mentions_capped(
                messages_of(&before.comments, thread),
                messages_of(&after.comments, thread),
            )
        })
}

fn anchors_kept(before: &LoroValue, after: &LoroValue) -> bool {
    keys_of(before).intersection(&keys_of(after)).all(|thread| {
        let (old, new) = (value_at(before, thread), value_at(after, thread));
        ANCHORED.iter().all(|key| {
            old.and_then(|old| value_at(old, key)) == new.and_then(|new| value_at(new, key))
        })
    })
}

fn thread_messages(thread: &LoroValue) -> &[LoroValue] {
    listed(value_at(thread, MESSAGES)).unwrap_or_default()
}

fn thread_added(thread: &LoroValue, account: &str) -> bool {
    names(value_at(thread, CREATED_BY), account)
        && thread_messages(thread)
            .iter()
            .all(|message| own(message, account))
        && reactions_kept(
            None,
            value_at(thread, REACTIONS),
            account,
            thread_messages(thread),
        )
}

fn thread_removable(thread: &LoroValue, account: &str) -> bool {
    names(value_at(thread, CREATED_BY), account)
        && thread_messages(thread)
            .iter()
            .all(|message| own(message, account) || truthy(value_at(message, DELETED)))
}

fn own_reaction(key: &str, account: &str) -> bool {
    ReactionKey::parse(key).is_some_and(|parsed| parsed.account.to_string() == account)
}

fn ids_in(messages: &[LoroValue]) -> HashSet<&str> {
    messages
        .iter()
        .filter_map(|message| match value_at(message, ID_KEY) {
            Some(LoroValue::String(id)) => Some(id.as_str()),
            _ => None,
        })
        .collect()
}

fn reactions_kept(
    before: Option<&LoroValue>,
    after: Option<&LoroValue>,
    account: &str,
    messages: &[LoroValue],
) -> bool {
    let mapped =
        |value: Option<&LoroValue>| value.is_none_or(|value| matches!(value, LoroValue::Map(_)));
    if !mapped(before) || !mapped(after) {
        return false;
    }
    if before == after {
        return true;
    }
    let old = before.map(keys_of).unwrap_or_default();
    let new = after.map(keys_of).unwrap_or_default();
    let mut ids: Option<HashSet<&str>> = None;
    let mut grown = BTreeSet::new();
    let kept = old.union(&new).all(|key| {
        let was = before.and_then(|value| value_at(value, key));
        let now = after.and_then(|value| value_at(value, key));
        if was == now {
            return true;
        }
        if !own_reaction(key, account)
            || !now.is_none_or(|value| matches!(value, LoroValue::I64(_)))
        {
            return false;
        }
        let Some(parsed) = now.and(ReactionKey::parse(key)) else {
            return true;
        };
        if was.is_none() {
            grown.insert(parsed.message);
        }
        ids.get_or_insert_with(|| ids_in(messages))
            .contains(parsed.message)
    });
    if !kept || grown.is_empty() {
        return kept;
    }
    let Ok(person) = account.parse() else {
        return false;
    };
    let counted = reactions_counted(new.iter().copied(), person);
    new.len() <= old.len().max(MAX_REACTION_KEYS)
        && grown.iter().all(|message| {
            counted.get(*message).copied().unwrap_or_default() <= MAX_REACTIONS_PER_PERSON
        })
}

fn thread_kept(before: &LoroValue, after: &LoroValue, account: &str) -> bool {
    let fields: BTreeSet<&str> = keys_of(before).union(&keys_of(after)).copied().collect();
    fields.into_iter().all(|name| {
        let (old, new) = (value_at(before, name), value_at(after, name));
        if old == new {
            return true;
        }
        match name {
            RESOLVED => true,
            MESSAGES => match (old, listed(new)) {
                (None, Some(added)) => items_kept(&[], added, account),
                (Some(_), Some(added)) => {
                    listed(old).is_some_and(|kept| items_kept(kept, added, account))
                }
                _ => false,
            },
            DELETED => !truthy(old) && truthy(new) && thread_removable(after, account),
            REACTIONS => reactions_kept(old, new, account, thread_messages(after)),
            _ => false,
        }
    })
}

fn threads_kept(before: &LoroValue, after: &LoroValue, account: &str) -> bool {
    if before == after {
        return true;
    }
    let threads: BTreeSet<&str> = keys_of(before).union(&keys_of(after)).copied().collect();
    threads
        .into_iter()
        .all(|key| match (value_at(before, key), value_at(after, key)) {
            (Some(old), Some(new)) => old == new || thread_kept(old, new, account),
            (None, Some(new)) => thread_added(new, account),
            (Some(_), None) => false,
            (None, None) => true,
        })
}

fn chat_kept(before: &LoroValue, after: &LoroValue, account: &str) -> bool {
    match (before, after) {
        _ if before == after => true,
        (LoroValue::List(old), LoroValue::List(new)) => items_kept(old, new, account),
        _ => false,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Held {
    Threads,
    Thread,
    Comment,
    Chat,
    Reactions,
}

struct Stamped {
    held: Held,
    by: Option<String>,
    keys: BTreeMap<String, Option<LoroValue>>,
}

#[derive(Default)]
struct Stamps {
    maps: HashMap<ContainerID, Stamped>,
    lists: HashMap<ContainerID, HashSet<ContainerID>>,
}

impl Stamps {
    fn read(doc: &LoroDoc) -> Stamps {
        let mut stamps = Stamps::default();
        stamps.map(&doc.get_map(COMMENTS), Held::Threads);
        stamps.list(&doc.get_list(CHAT), true);
        stamps.map(&doc.get_map(CHAT_REACTIONS), Held::Reactions);
        stamps
    }

    fn map(&mut self, map: &LoroMap, held: Held) {
        let mut keys = BTreeMap::new();
        let mut children = Vec::new();
        map.for_each(|key, value| {
            let plain = match value {
                ValueOrContainer::Value(value) => Some(value),
                ValueOrContainer::Container(child) => {
                    children.push((key.to_owned(), child));
                    None
                }
            };
            keys.insert(key.to_owned(), plain);
        });
        for (key, child) in children {
            match (held, key.as_str(), child) {
                (Held::Threads, _, loro::Container::Map(thread)) => self.map(&thread, Held::Thread),
                (Held::Thread, MESSAGES, loro::Container::List(messages)) => {
                    self.list(&messages, false)
                }
                (Held::Thread, REACTIONS, loro::Container::Map(reactions)) => {
                    self.map(&reactions, Held::Reactions)
                }
                _ => {}
            }
        }
        let writer = if held == Held::Thread {
            CREATED_BY
        } else {
            AUTHOR
        };
        let by = match keys.get(writer) {
            Some(Some(LoroValue::String(by))) => Some(by.to_string()),
            _ => None,
        };
        self.maps.insert(map.id(), Stamped { held, by, keys });
    }

    fn list(&mut self, list: &LoroList, chat: bool) {
        let mut items = HashSet::new();
        list.for_each(|item| {
            if let ValueOrContainer::Container(loro::Container::Map(message)) = item {
                items.insert(message.id());
                self.map(&message, if chat { Held::Chat } else { Held::Comment });
            }
        });
        self.lists.insert(list.id(), items);
    }
}

#[derive(Default)]
struct Written {
    keys: HashSet<(ContainerID, String)>,
    misshapen: HashSet<ContainerID>,
}

fn holds_a(value: &LoroValue, kind: ContainerType) -> bool {
    matches!(value, LoroValue::Container(id) if id.container_type() == kind)
}

fn written_in(doc: &LoroDoc, piece: &Piece) -> Written {
    let mut written = Written::default();
    for change in doc.export_json_in_id_span(IdSpan::new(piece.peer, piece.from, piece.to)) {
        for op in change.ops {
            match op.content {
                JsonOpContent::Map(JsonMapOp::Insert { key, value }) => {
                    if key == MESSAGES && !holds_a(&value, ContainerType::List) {
                        written.misshapen.insert(op.container.clone());
                    }
                    written.keys.insert((op.container, key));
                }
                JsonOpContent::Map(JsonMapOp::Delete { key }) => {
                    written.keys.insert((op.container, key));
                }
                JsonOpContent::List(JsonListOp::Insert { value, .. })
                    if !value.iter().all(|item| holds_a(item, ContainerType::Map)) =>
                {
                    written.misshapen.insert(op.container);
                }
                _ => {}
            }
        }
    }
    written
}

fn shaped(after: &Stamps, written: &Written) -> bool {
    written.misshapen.iter().all(|container| {
        !after.lists.contains_key(container)
            && after
                .maps
                .get(container)
                .is_none_or(|map| map.held != Held::Thread)
    })
}

fn rewritable(map: &Stamped, key: &str, account: &str, editor: bool) -> bool {
    let own = map.by.as_deref() == Some(account);
    match map.held {
        Held::Reactions => own_reaction(key, account),
        Held::Threads => false,
        Held::Thread => match key {
            RESOLVED => true,
            MESSAGES | REACTIONS => false,
            _ if ANCHORED.contains(&key) => own,
            _ => editor || own,
        },
        Held::Comment | Held::Chat => key != REMOVED && own,
    }
}

fn stamps_kept(
    before: &Stamps,
    after: &Stamps,
    written: &HashSet<(ContainerID, String)>,
    account: &str,
    editor: bool,
) -> bool {
    let rewrites_kept = written.iter().all(|(id, key)| {
        let (Some(was), Some(now)) = (before.maps.get(id), after.maps.get(id)) else {
            return true;
        };
        match (was.keys.get(key), now.keys.get(key)) {
            (Some(old), Some(new)) if old.is_none() || new.is_none() || old == new => {
                rewritable(was, key, account, editor)
            }
            _ => true,
        }
    });
    rewrites_kept
        && before
            .lists
            .iter()
            .all(|(id, items)| after.lists.get(id).is_none_or(|kept| items.is_subset(kept)))
}

struct Discussion {
    comments: LoroValue,
    chat: LoroValue,
    chat_reactions: LoroValue,
    stamps: Stamps,
}

fn discussion(doc: &LoroDoc) -> Discussion {
    Discussion {
        comments: doc.get_map(COMMENTS).get_deep_value(),
        chat: doc.get_list(CHAT).get_deep_value(),
        chat_reactions: doc.get_map(CHAT_REACTIONS).get_deep_value(),
        stamps: Stamps::read(doc),
    }
}

fn discussed(doc: &LoroDoc, piece: &Piece, account: &str, editor: bool) -> bool {
    let written = written_in(doc, piece);
    let mut checked = Checked { doc, moved: false };
    if !checked.to(&piece.before) {
        return false;
    }
    let before = discussion(doc);
    if !checked.to(&piece.after) {
        return false;
    }
    let after = discussion(doc);
    let comments = if editor {
        editor_kept(&before.comments, &after.comments, account)
    } else {
        threads_kept(&before.comments, &after.comments, account)
    };
    comments
        && chat_kept(&before.chat, &after.chat, account)
        && reactions_kept(
            Some(&before.chat_reactions),
            Some(&after.chat_reactions),
            account,
            listed(Some(&after.chat)).unwrap_or_default(),
        )
        && discussion_capped(&before, &after)
        && shaped(&after.stamps, &written)
        && stamps_kept(
            &before.stamps,
            &after.stamps,
            &written.keys,
            account,
            editor,
        )
}

fn placed_in_piece(doc: &LoroDoc, piece: &Piece, changed: &[ContainerID]) -> Option<Vec<Placed>> {
    let mut found: Vec<Placed> = changed
        .iter()
        .map(|container| placed(doc, container))
        .collect();
    let earlier: Vec<usize> = found
        .iter()
        .zip(changed)
        .enumerate()
        .filter(|(_, (place, container))| place.root == Root::Detached && !piece.made(container))
        .map(|(index, _)| index)
        .collect();
    if earlier.is_empty() {
        return Some(found);
    }
    let mut checked = Checked { doc, moved: false };
    if !checked.to(&piece.before) {
        return None;
    }
    for index in earlier {
        found[index] = placed(doc, &changed[index]);
    }
    Some(found)
}

fn judge_piece(doc: &LoroDoc, piece: &Piece, rule: &RoleRule) -> Judged {
    let length = usize::try_from(piece.to - piece.from).unwrap_or(0);
    let changed: Vec<ContainerID> = doc
        .get_changed_containers_in(ID::new(piece.peer, piece.from), length)
        .into_iter()
        .collect();
    let Some(found) = placed_in_piece(doc, piece, &changed) else {
        return RoleVerdict::Refused.into();
    };
    let mut files = BTreeSet::new();
    let mut records = BTreeSet::new();
    let mut comments = false;
    let mut chat = false;
    let mut review = false;
    for (container, found) in changed.iter().zip(found) {
        match (found.root, rule.role) {
            (Root::Comments, _) => comments = true,
            (Root::Chat | Root::ChatReactions, _) => chat = true,
            (Root::Detached, _) if piece.made(container) => {}
            (Root::Suggestions, ProjectRole::Reviewer) => {
                review = true;
                records.extend(found.record);
            }
            (Root::Text, ProjectRole::Reviewer) => {
                review = true;
                files.extend(found.file);
            }
            (_, ProjectRole::Editor) => {}
            _ => return RoleVerdict::Refused.into(),
        }
    }
    let judged = |verdict| Judged { verdict, comments };
    if comments && rule.comments_off {
        return judged(RoleVerdict::ChangesComments);
    }
    let account = rule.account.to_string();
    let editor = rule.role == ProjectRole::Editor;
    if (comments || chat) && !discussed(doc, piece, &account, editor) {
        return RoleVerdict::Refused.into();
    }
    if review && !reviewed(doc, piece, files, records, &account) {
        return RoleVerdict::Refused.into();
    }
    judged(RoleVerdict::Allowed)
}

fn judge_spans(doc: &LoroDoc, spans: &[(u64, i32, i32)], rule: &RoleRule) -> Judged {
    if !RoleRule::needed(rule.role) {
        return RoleVerdict::Refused.into();
    }
    let Some(pieces) = pieces_of(doc, spans) else {
        return RoleVerdict::Unreadable.into();
    };
    let mut overall = Judged::from(RoleVerdict::Allowed);
    for piece in &pieces {
        let judged = judge_piece(doc, piece, rule);
        overall.comments |= judged.comments;
        match judged.verdict {
            RoleVerdict::Allowed => {}
            RoleVerdict::ChangesComments => overall.verdict = RoleVerdict::ChangesComments,
            _ => return judged,
        }
    }
    overall
}

pub fn judge_imported(doc: &LoroDoc, spans: &[(u64, i32, i32)], rule: &RoleRule) -> RoleVerdict {
    judge_spans(doc, spans, rule).verdict
}

fn builds_on(doc: &LoroDoc, payload: &[u8]) -> bool {
    peers::update_reach(payload).is_some_and(|reach| snapshots::builds_on(&reach, &doc.oplog_vv()))
}

fn imported(doc: &LoroDoc, payload: &[u8]) -> Option<Vec<(u64, i32, i32)>> {
    let status = snapshots::import_update(doc, payload).ok()?;
    if status.pending.is_some() {
        return None;
    }
    Some(
        status
            .success
            .iter()
            .map(|(peer, (start, end))| (*peer, *start, *end))
            .collect(),
    )
}

fn spared(doc: &LoroDoc, spans: &[(u64, i32, i32)]) -> bool {
    spans.iter().all(|(peer, start, end)| {
        let length = usize::try_from(end.saturating_sub(*start)).unwrap_or(0);
        doc.get_changed_containers_in(ID::new(*peer, *start), length)
            .iter()
            .all(|container| {
                matches!(container, ContainerID::Root { .. })
                    && !matches!(
                        root_kind(container),
                        Root::Comments | Root::Chat | Root::ChatReactions
                    )
            })
    })
}

pub fn spares_comments(doc: &LoroDoc, payload: &[u8]) -> Option<bool> {
    if !builds_on(doc, payload) {
        return None;
    }
    imported(doc, payload).map(|spans| spared(doc, &spans))
}

pub fn judge_change(doc: &LoroDoc, payload: &[u8], rule: &RoleRule) -> (Judged, bool) {
    if !builds_on(doc, payload) {
        return (RoleVerdict::Unreadable.into(), true);
    }
    let judged = match imported(doc, payload) {
        Some(spans) => judge_spans(doc, &spans, rule),
        None => RoleVerdict::Unreadable.into(),
    };
    (judged, judged.verdict == RoleVerdict::Allowed)
}

pub fn judge(doc: &LoroDoc, payload: &[u8], rule: &RoleRule) -> (RoleVerdict, bool) {
    let (judged, intact) = judge_change(doc, payload, rule);
    (judged.verdict, intact)
}

#[cfg(test)]
mod tests {
    use loro::ExportMode;

    use super::*;
    use crate::test_support::suggestions::{
        existing, file_text, remove_suggestion, set_range, suggest_delete, suggest_insert,
    };

    const FILE: &str = "f1";
    const TEXT_START: &str = "Hello world";

    fn reviewer() -> AccountId {
        "01920000-0000-7000-8000-0000000000a1".parse().unwrap()
    }

    fn editor() -> AccountId {
        "01920000-0000-7000-8000-0000000000e1".parse().unwrap()
    }

    fn rule(role: ProjectRole) -> RoleRule {
        RoleRule {
            role,
            account: reviewer(),
            comments_off: false,
        }
    }

    fn shared() -> Vec<u8> {
        let doc = LoroDoc::new();
        doc.set_peer_id(1).unwrap();
        file_text(&doc, FILE).insert(0, TEXT_START).unwrap();
        doc.get_map(COMMENTS)
            .insert_container("f1/t1", LoroMap::new())
            .unwrap()
            .insert("quote", "Hello")
            .unwrap();
        doc.commit();
        doc.export(ExportMode::Snapshot).unwrap()
    }

    fn loaded(bytes: &[&[u8]], peer: u64) -> LoroDoc {
        let doc = LoroDoc::new();
        for piece in bytes {
            doc.import(piece).unwrap();
        }
        doc.set_peer_id(peer).unwrap();
        doc
    }

    fn change(on: &[&[u8]], peer: u64, edit: impl FnOnce(&LoroDoc)) -> Vec<u8> {
        let doc = loaded(on, peer);
        let before = doc.oplog_vv();
        edit(&doc);
        doc.commit();
        doc.export(ExportMode::updates(&before)).unwrap()
    }

    fn judged_whole(held: &[&[u8]], update: &[u8], rule: RoleRule) -> Judged {
        let doc = loaded(held, 99);
        let (judged, _) = judge_change(&doc, update, &rule);
        assert_eq!(
            doc.state_frontiers(),
            doc.oplog_frontiers(),
            "the document is back at its latest version"
        );
        judged
    }

    fn judged(held: &[&[u8]], update: &[u8], rule: RoleRule) -> RoleVerdict {
        judged_whole(held, update, rule).verdict
    }

    fn me() -> String {
        reviewer().to_string()
    }

    #[test]
    fn a_suggested_insertion_and_deletion_are_allowed() {
        let base = shared();
        let insert = change(&[&base], 2, |doc| {
            suggest_insert(doc, "s1", FILE, 5, ", dear", &me());
        });
        assert_eq!(
            judged(&[&base], &insert, rule(ProjectRole::Reviewer)),
            RoleVerdict::Allowed
        );
        let delete = change(&[&base], 2, |doc| {
            suggest_delete(doc, "s2", FILE, 5, 11, &me());
        });
        assert_eq!(
            judged(&[&base], &delete, rule(ProjectRole::Reviewer)),
            RoleVerdict::Allowed
        );
    }

    #[test]
    fn typing_or_deleting_without_a_suggestion_is_refused() {
        let base = shared();
        let typed = change(&[&base], 2, |doc| {
            file_text(doc, FILE).insert(5, "!").unwrap();
        });
        assert_eq!(
            judged(&[&base], &typed, rule(ProjectRole::Reviewer)),
            RoleVerdict::Refused
        );
        let deleted = change(&[&base], 2, |doc| {
            file_text(doc, FILE).delete(0, 5).unwrap();
        });
        assert_eq!(
            judged(&[&base], &deleted, rule(ProjectRole::Reviewer)),
            RoleVerdict::Refused
        );
    }

    #[test]
    fn a_suggestion_that_does_not_match_the_change_is_refused() {
        let base = shared();
        let wrong_text = change(&[&base], 2, |doc| {
            suggest_delete(doc, "s1", FILE, 0, 5, &me());
            existing(doc, "s1").insert("text", "Howdy").unwrap();
        });
        assert_eq!(
            judged(&[&base], &wrong_text, rule(ProjectRole::Reviewer)),
            RoleVerdict::Refused
        );
        let too_short = change(&[&base], 2, |doc| {
            suggest_insert(doc, "s1", FILE, 5, "abc", &me());
            set_range(doc, "s1", FILE, 5, 7);
        });
        assert_eq!(
            judged(&[&base], &too_short, rule(ProjectRole::Reviewer)),
            RoleVerdict::Refused
        );
        let covers_more = change(&[&base], 2, |doc| {
            suggest_insert(doc, "s1", FILE, 5, "abc", &me());
            set_range(doc, "s1", FILE, 0, 8);
        });
        assert_eq!(
            judged(&[&base], &covers_more, rule(ProjectRole::Reviewer)),
            RoleVerdict::Refused
        );
        let elsewhere = change(&[&base], 2, |doc| {
            suggest_delete(doc, "s1", FILE, 0, 5, &me());
            existing(doc, "s1")
                .insert(
                    "anchor",
                    LoroValue::from(crate::test_support::suggestions::cursor_at(
                        &file_text(doc, FILE),
                        3,
                    )),
                )
                .unwrap();
        });
        assert_eq!(
            judged(&[&base], &elsewhere, rule(ProjectRole::Reviewer)),
            RoleVerdict::Refused
        );
    }

    #[test]
    fn a_suggestion_in_someone_elses_name_is_refused() {
        let base = shared();
        let forged = change(&[&base], 2, |doc| {
            suggest_insert(doc, "s1", FILE, 5, "!", &editor().to_string());
        });
        assert_eq!(
            judged(&[&base], &forged, rule(ProjectRole::Reviewer)),
            RoleVerdict::Refused
        );
        let mine = change(&[&base], 2, |doc| {
            suggest_insert(doc, "s1", FILE, 5, "!", &me());
        });
        let renamed = change(&[&base, &mine], 2, |doc| {
            existing(doc, "s1")
                .insert("author", editor().to_string())
                .unwrap();
        });
        assert_eq!(
            judged(&[&base, &mine], &renamed, rule(ProjectRole::Reviewer)),
            RoleVerdict::Refused
        );
    }

    #[test]
    fn accepting_is_refused_and_withdrawing_is_allowed() {
        let base = shared();
        let theirs = change(&[&base], 3, |doc| {
            suggest_insert(doc, "s1", FILE, 5, " there", &editor().to_string());
        });
        let accepted = change(&[&base, &theirs], 2, |doc| {
            remove_suggestion(doc, "s1");
        });
        assert_eq!(
            judged(&[&base, &theirs], &accepted, rule(ProjectRole::Reviewer)),
            RoleVerdict::Refused
        );
        let mine = change(&[&base], 2, |doc| {
            suggest_insert(doc, "s2", FILE, 5, " there", &me());
        });
        let self_accepted = change(&[&base, &mine], 2, |doc| {
            remove_suggestion(doc, "s2");
        });
        assert_eq!(
            judged(&[&base, &mine], &self_accepted, rule(ProjectRole::Reviewer)),
            RoleVerdict::Refused
        );
        let withdrawn = change(&[&base, &mine], 2, |doc| {
            file_text(doc, FILE).delete(5, 6).unwrap();
            remove_suggestion(doc, "s2");
        });
        assert_eq!(
            judged(&[&base, &mine], &withdrawn, rule(ProjectRole::Reviewer)),
            RoleVerdict::Allowed
        );
        let deleted = change(&[&base], 2, |doc| {
            suggest_delete(doc, "s3", FILE, 0, 6, &me());
        });
        let restored = change(&[&base, &deleted], 2, |doc| {
            file_text(doc, FILE).insert(0, "Hello ").unwrap();
            remove_suggestion(doc, "s3");
        });
        assert_eq!(
            judged(&[&base, &deleted], &restored, rule(ProjectRole::Reviewer)),
            RoleVerdict::Allowed
        );
        let left_out = change(&[&base, &deleted], 2, |doc| {
            remove_suggestion(doc, "s3");
        });
        assert_eq!(
            judged(&[&base, &deleted], &left_out, rule(ProjectRole::Reviewer)),
            RoleVerdict::Refused
        );
    }

    #[test]
    fn typing_on_and_deleting_inside_an_own_insertion_is_allowed() {
        let base = shared();
        let first = change(&[&base], 2, |doc| {
            suggest_insert(doc, "s1", FILE, 5, " t", &me());
        });
        let more = change(&[&base, &first], 2, |doc| {
            file_text(doc, FILE).insert(7, "here").unwrap();
            set_range(doc, "s1", FILE, 5, 11);
        });
        assert_eq!(
            judged(&[&base, &first], &more, rule(ProjectRole::Reviewer)),
            RoleVerdict::Allowed
        );
        let shrunk = change(&[&base, &first, &more], 2, |doc| {
            file_text(doc, FILE).delete(5, 2).unwrap();
            set_range(doc, "s1", FILE, 5, 9);
        });
        assert_eq!(
            judged(
                &[&base, &first, &more],
                &shrunk,
                rule(ProjectRole::Reviewer)
            ),
            RoleVerdict::Allowed
        );
        let untouched = change(&[&base, &first, &more], 2, |doc| {
            file_text(doc, FILE).insert(8, "x").unwrap();
        });
        assert_eq!(
            judged(
                &[&base, &first, &more],
                &untouched,
                rule(ProjectRole::Reviewer)
            ),
            RoleVerdict::Refused
        );
    }

    #[test]
    fn a_suggestion_typed_and_taken_back_before_it_was_sent_is_allowed() {
        let base = shared();
        let doc = loaded(&[&base], 2);
        let before = doc.oplog_vv();
        suggest_insert(&doc, "s1", FILE, 5, "x", &me());
        doc.commit();
        file_text(&doc, FILE).delete(5, 1).unwrap();
        remove_suggestion(&doc, "s1");
        doc.commit();
        let both = doc.export(ExportMode::updates(&before)).unwrap();
        assert_eq!(
            judged(&[&base], &both, rule(ProjectRole::Reviewer)),
            RoleVerdict::Allowed
        );
    }

    #[test]
    fn typing_on_an_own_insertion_and_withdrawing_it_in_one_change_is_allowed() {
        let base = shared();
        let first = change(&[&base], 2, |doc| {
            suggest_insert(doc, "s1", FILE, 5, " t", &me());
        });
        let doc = loaded(&[&base, &first], 2);
        let before = doc.oplog_vv();
        file_text(&doc, FILE).insert(7, "o").unwrap();
        set_range(&doc, "s1", FILE, 5, 8);
        doc.commit();
        file_text(&doc, FILE).delete(5, 3).unwrap();
        remove_suggestion(&doc, "s1");
        doc.commit();
        let both = doc.export(ExportMode::updates(&before)).unwrap();
        assert_eq!(
            judged(&[&base, &first], &both, rule(ProjectRole::Reviewer)),
            RoleVerdict::Allowed
        );
    }

    #[test]
    fn a_suggestion_over_text_someone_else_wrote_is_refused() {
        let base = shared();
        let claimed = change(&[&base], 2, |doc| {
            suggest_insert(doc, "s1", FILE, 5, "!", &me());
            set_range(doc, "s1", FILE, 0, 6);
        });
        assert_eq!(
            judged(&[&base], &claimed, rule(ProjectRole::Reviewer)),
            RoleVerdict::Refused
        );
    }

    #[test]
    fn a_suggestion_made_beside_a_concurrent_edit_is_judged_on_what_its_writer_saw() {
        let base = shared();
        let edited = change(&[&base], 3, |doc| {
            file_text(doc, FILE).delete(0, 6).unwrap();
            file_text(doc, FILE).insert(0, "Big ").unwrap();
        });
        let suggested = change(&[&base], 2, |doc| {
            suggest_insert(doc, "s1", FILE, 11, "!", &me());
            suggest_delete(doc, "s2", FILE, 6, 8, &me());
        });
        assert_eq!(
            judged(&[&base, &edited], &suggested, rule(ProjectRole::Reviewer)),
            RoleVerdict::Allowed
        );
    }

    #[test]
    fn reviewers_and_commenters_never_touch_the_file_tree_or_settings() {
        let base = shared();
        for role in [ProjectRole::Reviewer, ProjectRole::Commenter] {
            let tree = change(&[&base], 2, |doc| {
                doc.get_tree("tree")
                    .create(loro::TreeParentId::Root)
                    .unwrap();
            });
            assert_eq!(judged(&[&base], &tree, rule(role)), RoleVerdict::Refused);
            let meta = change(&[&base], 2, |doc| {
                doc.get_map("meta").insert("main", "other.tex").unwrap();
            });
            assert_eq!(judged(&[&base], &meta, rule(role)), RoleVerdict::Refused);
        }
    }

    #[test]
    fn commenters_comment_and_chat_and_nothing_else() {
        let base = shared();
        let commenter = rule(ProjectRole::Commenter);
        let comment = change(&[&base], 2, |doc| {
            let thread = doc
                .get_map(COMMENTS)
                .insert_container("f1/t2", LoroMap::new())
                .unwrap();
            thread.insert("quote", "world").unwrap();
            thread.insert("created_by", me()).unwrap();
            let messages = thread
                .insert_container("messages", LoroList::new())
                .unwrap();
            said(&messages, &me(), "m2");
        });
        assert_eq!(judged(&[&base], &comment, commenter), RoleVerdict::Allowed);
        let chat = change(&[&base], 2, |doc| {
            said(&doc.get_list(CHAT), &me(), "c2");
        });
        assert_eq!(judged(&[&base], &chat, commenter), RoleVerdict::Allowed);
        let typed = change(&[&base], 2, |doc| {
            file_text(doc, FILE).insert(0, "x").unwrap();
        });
        assert_eq!(judged(&[&base], &typed, commenter), RoleVerdict::Refused);
        let suggested = change(&[&base], 2, |doc| {
            suggest_insert(doc, "s1", FILE, 5, "!", &me());
        });
        assert_eq!(
            judged(&[&base], &suggested, commenter),
            RoleVerdict::Refused
        );
        let wrong_kind = change(&[&base], 2, |doc| {
            doc.get_map(CHAT).insert("body", "hi").unwrap();
        });
        assert_eq!(
            judged(&[&base], &wrong_kind, commenter),
            RoleVerdict::Refused
        );
    }

    type Edit = Box<dyn Fn(&LoroDoc)>;

    fn said(list: &LoroList, author: &str, id: &str) -> LoroMap {
        let message = list.push_container(LoroMap::new()).unwrap();
        message.insert("id", id).unwrap();
        message.insert("author", author).unwrap();
        message.insert("body", format!("{id} body")).unwrap();
        message
    }

    fn map_in(value: Option<ValueOrContainer>) -> LoroMap {
        match value {
            Some(ValueOrContainer::Container(loro::Container::Map(map))) => map,
            other => panic!("not a map: {other:?}"),
        }
    }

    fn list_in(value: Option<ValueOrContainer>) -> LoroList {
        match value {
            Some(ValueOrContainer::Container(loro::Container::List(list))) => list,
            other => panic!("not a list: {other:?}"),
        }
    }

    fn their_thread(doc: &LoroDoc) -> LoroMap {
        map_in(doc.get_map(COMMENTS).get("f1/t1"))
    }

    fn their_message(doc: &LoroDoc) -> LoroMap {
        map_in(list_in(their_thread(doc).get("messages")).get(0))
    }

    fn their_chat(doc: &LoroDoc) -> LoroMap {
        map_in(doc.get_list(CHAT).get(0))
    }

    fn discussed_base() -> Vec<u8> {
        let doc = LoroDoc::new();
        doc.set_peer_id(1).unwrap();
        file_text(&doc, FILE).insert(0, TEXT_START).unwrap();
        let thread = doc
            .get_map(COMMENTS)
            .insert_container("f1/t1", LoroMap::new())
            .unwrap();
        thread.insert("quote", "Hello").unwrap();
        thread.insert("created_by", editor().to_string()).unwrap();
        let messages = thread
            .insert_container("messages", LoroList::new())
            .unwrap();
        said(&messages, &editor().to_string(), "m1");
        said(&doc.get_list(CHAT), &editor().to_string(), "c1");
        doc.commit();
        doc.export(ExportMode::Snapshot).unwrap()
    }

    #[test]
    fn reviewers_and_commenters_cannot_remove_or_rewrite_what_others_wrote() {
        let base = discussed_base();
        let refused: Vec<(&str, Edit)> = vec![
            (
                "removing a thread",
                Box::new(|doc| doc.get_map(COMMENTS).delete("f1/t1").unwrap()),
            ),
            (
                "rewriting another person's comment",
                Box::new(|doc| their_message(doc).insert("body", "changed").unwrap()),
            ),
            (
                "deleting another person's comment",
                Box::new(|doc| {
                    let message = their_message(doc);
                    message.insert("deleted", true).unwrap();
                    message.insert("body", "").unwrap();
                }),
            ),
            (
                "removing another person's comment from the list",
                Box::new(|doc| {
                    list_in(their_thread(doc).get("messages"))
                        .delete(0, 1)
                        .unwrap()
                }),
            ),
            (
                "deleting another person's thread",
                Box::new(|doc| their_thread(doc).insert("deleted", true).unwrap()),
            ),
            (
                "moving another person's thread",
                Box::new(|doc| their_thread(doc).insert("quote", "world").unwrap()),
            ),
            (
                "replying in someone else's name",
                Box::new(|doc| {
                    said(
                        &list_in(their_thread(doc).get("messages")),
                        &editor().to_string(),
                        "m2",
                    );
                }),
            ),
            (
                "starting a thread in someone else's name",
                Box::new(|doc| {
                    let thread = doc
                        .get_map(COMMENTS)
                        .insert_container("f1/t2", LoroMap::new())
                        .unwrap();
                    thread.insert("created_by", editor().to_string()).unwrap();
                }),
            ),
            (
                "clearing the chat",
                Box::new(|doc| {
                    let message = their_chat(doc);
                    message.insert("deleted", true).unwrap();
                    message.insert("body", "").unwrap();
                }),
            ),
            (
                "removing a chat message",
                Box::new(|doc| doc.get_list(CHAT).delete(0, 1).unwrap()),
            ),
            (
                "posting in someone else's name",
                Box::new(|doc| {
                    said(&doc.get_list(CHAT), &editor().to_string(), "c2");
                }),
            ),
        ];
        for role in [ProjectRole::Reviewer, ProjectRole::Commenter] {
            for (what, edit) in &refused {
                let update = change(&[&base], 2, |doc| edit(doc));
                assert_eq!(
                    judged(&[&base], &update, rule(role)),
                    RoleVerdict::Refused,
                    "{what} as {role:?}"
                );
            }
        }
    }

    #[test]
    fn reviewers_and_commenters_reply_resolve_and_manage_their_own_words() {
        let base = discussed_base();
        let mine = change(&[&base], 2, |doc| {
            said(&list_in(their_thread(doc).get("messages")), &me(), "m2");
            said(&doc.get_list(CHAT), &me(), "c2");
        });
        let allowed: Vec<(&str, Edit)> = vec![
            (
                "resolving a thread",
                Box::new(|doc| their_thread(doc).insert("resolved", "done").unwrap()),
            ),
            (
                "editing an own reply",
                Box::new(|doc| {
                    map_in(list_in(their_thread(doc).get("messages")).get(1))
                        .insert("body", "edited")
                        .unwrap();
                }),
            ),
            (
                "deleting an own chat message",
                Box::new(|doc| {
                    let message = map_in(doc.get_list(CHAT).get(1));
                    message.insert("deleted", true).unwrap();
                    message.insert("body", "").unwrap();
                }),
            ),
            (
                "starting and deleting an own thread",
                Box::new(|doc| {
                    let thread = doc
                        .get_map(COMMENTS)
                        .insert_container("f1/t3", LoroMap::new())
                        .unwrap();
                    thread.insert("created_by", me()).unwrap();
                    let messages = thread
                        .insert_container("messages", LoroList::new())
                        .unwrap();
                    said(&messages, &me(), "m3");
                    doc.commit();
                    thread.insert("deleted", true).unwrap();
                }),
            ),
        ];
        assert_eq!(
            judged(&[&base], &mine, rule(ProjectRole::Commenter)),
            RoleVerdict::Allowed
        );
        for role in [ProjectRole::Reviewer, ProjectRole::Commenter] {
            for (what, edit) in &allowed {
                let update = change(&[&base, &mine], 2, |doc| edit(doc));
                assert_eq!(
                    judged(&[&base, &mine], &update, rule(role)),
                    RoleVerdict::Allowed,
                    "{what} as {role:?}"
                );
            }
        }
    }

    fn reaction_key(message: &str, emoji: &str, account: &str) -> String {
        format!("{message}|{emoji}|{account}")
    }

    fn reactions_on(doc: &LoroDoc) -> LoroMap {
        match their_thread(doc).get("reactions") {
            Some(ValueOrContainer::Container(loro::Container::Map(map))) => map,
            _ => their_thread(doc)
                .insert_container("reactions", LoroMap::new())
                .unwrap(),
        }
    }

    #[test]
    fn reviewers_and_commenters_react_and_take_back_reactions_only_in_their_own_name() {
        let base = discussed_base();
        let theirs = change(&[&base], 3, |doc| {
            reactions_on(doc)
                .insert(&reaction_key("m1", "🎉", &editor().to_string()), 1)
                .unwrap();
            doc.get_map(CHAT_REACTIONS)
                .insert(&reaction_key("c1", "🎉", &editor().to_string()), 1)
                .unwrap();
        });
        let mine = change(&[&base, &theirs], 2, |doc| {
            reactions_on(doc)
                .insert(&reaction_key("m1", "👍", &me()), 2)
                .unwrap();
            doc.get_map(CHAT_REACTIONS)
                .insert(&reaction_key("c1", "👍", &me()), 2)
                .unwrap();
        });
        let held: [&[u8]; 3] = [&base, &theirs, &mine];
        let allowed: Vec<(&str, Edit)> = vec![
            (
                "reacting again with another emoji",
                Box::new(|doc| {
                    reactions_on(doc)
                        .insert(&reaction_key("m1", "👀", &me()), 3)
                        .unwrap();
                    doc.get_map(CHAT_REACTIONS)
                        .insert(&reaction_key("c1", "👀", &me()), 3)
                        .unwrap();
                }),
            ),
            (
                "taking back an own reaction",
                Box::new(|doc| {
                    reactions_on(doc)
                        .delete(&reaction_key("m1", "👍", &me()))
                        .unwrap();
                    doc.get_map(CHAT_REACTIONS)
                        .delete(&reaction_key("c1", "👍", &me()))
                        .unwrap();
                }),
            ),
        ];
        let refused: Vec<(&str, Edit)> = vec![
            (
                "reacting in someone else's name",
                Box::new(|doc| {
                    reactions_on(doc)
                        .insert(&reaction_key("m1", "👀", &editor().to_string()), 3)
                        .unwrap();
                }),
            ),
            (
                "reacting in the chat in someone else's name",
                Box::new(|doc| {
                    doc.get_map(CHAT_REACTIONS)
                        .insert(&reaction_key("c1", "👀", &editor().to_string()), 3)
                        .unwrap();
                }),
            ),
            (
                "taking back someone else's reaction",
                Box::new(|doc| {
                    reactions_on(doc)
                        .delete(&reaction_key("m1", "🎉", &editor().to_string()))
                        .unwrap();
                }),
            ),
            (
                "taking back someone else's chat reaction",
                Box::new(|doc| {
                    doc.get_map(CHAT_REACTIONS)
                        .delete(&reaction_key("c1", "🎉", &editor().to_string()))
                        .unwrap();
                }),
            ),
            (
                "replacing the reactions on a thread",
                Box::new(|doc| {
                    their_thread(doc)
                        .insert_container("reactions", LoroMap::new())
                        .unwrap()
                        .insert(&reaction_key("m1", "👍", &me()), 4)
                        .unwrap();
                }),
            ),
            (
                "a key that is not a reaction",
                Box::new(|doc| {
                    reactions_on(doc).insert("m1|👍", 3).unwrap();
                }),
            ),
            (
                "a key with an account that does not parse",
                Box::new(|doc| {
                    doc.get_map(CHAT_REACTIONS)
                        .insert("c1|👍|not-an-account", 3)
                        .unwrap();
                }),
            ),
            (
                "an emoji with a space in it",
                Box::new(|doc| {
                    reactions_on(doc)
                        .insert(&reaction_key("m1", "thumbs up", &me()), 3)
                        .unwrap();
                }),
            ),
            (
                "a reaction that is not a time",
                Box::new(|doc| {
                    reactions_on(doc)
                        .insert(&reaction_key("m1", "👀", &me()), "soon")
                        .unwrap();
                }),
            ),
            (
                "chat reactions kept as a list",
                Box::new(|doc| {
                    doc.get_list(CHAT_REACTIONS).push("c1").unwrap();
                }),
            ),
        ];
        for role in [ProjectRole::Reviewer, ProjectRole::Commenter] {
            assert_eq!(
                judged(&[&base, &theirs], &mine, rule(role)),
                RoleVerdict::Allowed,
                "reacting as {role:?}"
            );
            for (what, edit) in &allowed {
                let update = change(&held, 2, |doc| edit(doc));
                assert_eq!(
                    judged(&held, &update, rule(role)),
                    RoleVerdict::Allowed,
                    "{what} as {role:?}"
                );
            }
            for (what, edit) in &refused {
                let update = change(&held, 2, |doc| edit(doc));
                assert_eq!(
                    judged(&held, &update, rule(role)),
                    RoleVerdict::Refused,
                    "{what} as {role:?}"
                );
            }
        }
    }

    #[test]
    fn an_editor_reacts_and_takes_back_reactions_only_in_their_own_name() {
        let base = discussed_base();
        let theirs = change(&[&base], 3, |doc| {
            reactions_on(doc)
                .insert(&reaction_key("m1", "🎉", &editor().to_string()), 1)
                .unwrap();
            doc.get_map(CHAT_REACTIONS)
                .insert(&reaction_key("c1", "🎉", &editor().to_string()), 1)
                .unwrap();
        });
        let held: [&[u8]; 2] = [&base, &theirs];
        let allowed: Vec<(&str, Edit)> = vec![
            (
                "reacting in their own name",
                Box::new(|doc| {
                    reactions_on(doc)
                        .insert(&reaction_key("m1", "👍", &me()), 2)
                        .unwrap();
                    doc.get_map(CHAT_REACTIONS)
                        .insert(&reaction_key("c1", "👍", &me()), 2)
                        .unwrap();
                }),
            ),
            (
                "typing",
                Box::new(|doc| {
                    file_text(doc, FILE).insert(0, "x").unwrap();
                }),
            ),
        ];
        let refused: Vec<(&str, Edit)> = vec![
            (
                "reacting in someone else's name",
                Box::new(|doc| {
                    reactions_on(doc)
                        .insert(&reaction_key("m1", "👀", &editor().to_string()), 3)
                        .unwrap();
                }),
            ),
            (
                "reacting in the chat in someone else's name",
                Box::new(|doc| {
                    doc.get_map(CHAT_REACTIONS)
                        .insert(&reaction_key("c1", "👀", &editor().to_string()), 3)
                        .unwrap();
                }),
            ),
            (
                "taking back someone else's reaction",
                Box::new(|doc| {
                    reactions_on(doc)
                        .delete(&reaction_key("m1", "🎉", &editor().to_string()))
                        .unwrap();
                }),
            ),
            (
                "taking back someone else's chat reaction",
                Box::new(|doc| {
                    doc.get_map(CHAT_REACTIONS)
                        .delete(&reaction_key("c1", "🎉", &editor().to_string()))
                        .unwrap();
                }),
            ),
        ];
        let editor_rule = rule(ProjectRole::Editor);
        for (what, edit) in &allowed {
            let update = change(&held, 2, |doc| edit(doc));
            assert_eq!(
                judged(&held, &update, editor_rule),
                RoleVerdict::Allowed,
                "{what}"
            );
        }
        for (what, edit) in &refused {
            let update = change(&held, 2, |doc| edit(doc));
            assert_eq!(
                judged(&held, &update, editor_rule),
                RoleVerdict::Refused,
                "{what}"
            );
            let doc = loaded(&held, 99);
            doc.detach();
            assert_eq!(spares_comments(&doc, &update), Some(false), "{what}");
        }
    }

    fn rewrite(map: &LoroMap, key: &str) {
        let Some(ValueOrContainer::Value(value)) = map.get(key) else {
            panic!("{key} holds a value");
        };
        map.delete(key).unwrap();
        map.insert(key, value).unwrap();
    }

    fn copy_into(map: &LoroMap, from: &LoroValue) {
        let LoroValue::Map(fields) = from else {
            panic!("a map to copy");
        };
        for (key, value) in fields.iter() {
            map.insert(key, value.clone()).unwrap();
        }
    }

    #[test]
    fn writing_back_the_same_value_over_what_someone_else_wrote_is_refused() {
        let base = discussed_base();
        let theirs = change(&[&base], 3, |doc| {
            reactions_on(doc)
                .insert(&reaction_key("m1", "🎉", &editor().to_string()), 1)
                .unwrap();
            doc.get_map(CHAT_REACTIONS)
                .insert(&reaction_key("c1", "🎉", &editor().to_string()), 1)
                .unwrap();
            tombstone(&their_message(doc));
        });
        let mine = change(&[&base, &theirs], 2, |doc| {
            reactions_on(doc)
                .insert(&reaction_key("m1", "👍", &me()), 2)
                .unwrap();
            said(&doc.get_list(CHAT), &me(), "c2");
        });
        let held: [&[u8]; 3] = [&base, &theirs, &mine];
        let allowed: Vec<(&str, Edit)> = vec![
            (
                "writing back an own reaction",
                Box::new(|doc| rewrite(&reactions_on(doc), &reaction_key("m1", "👍", &me()))),
            ),
            (
                "writing back an own chat message",
                Box::new(|doc| rewrite(&map_in(doc.get_list(CHAT).get(1)), "body")),
            ),
        ];
        let refused: Vec<(&str, Edit)> = vec![
            (
                "writing back someone else's reaction",
                Box::new(|doc| {
                    rewrite(
                        &reactions_on(doc),
                        &reaction_key("m1", "🎉", &editor().to_string()),
                    );
                }),
            ),
            (
                "writing back someone else's chat reaction",
                Box::new(|doc| {
                    rewrite(
                        &doc.get_map(CHAT_REACTIONS),
                        &reaction_key("c1", "🎉", &editor().to_string()),
                    );
                }),
            ),
            (
                "writing back an owner's removal",
                Box::new(|doc| rewrite(&their_message(doc), "removed")),
            ),
            (
                "writing back who wrote someone else's chat message",
                Box::new(|doc| rewrite(&their_chat(doc), "author")),
            ),
            (
                "replacing the reactions on a thread with a copy",
                Box::new(|doc| {
                    let kept = reactions_on(doc).get_deep_value();
                    let copy = their_thread(doc)
                        .insert_container("reactions", LoroMap::new())
                        .unwrap();
                    copy_into(&copy, &kept);
                }),
            ),
            (
                "replacing someone else's chat message with a copy",
                Box::new(|doc| {
                    let kept = their_chat(doc).get_deep_value();
                    let chat = doc.get_list(CHAT);
                    chat.delete(0, 1).unwrap();
                    copy_into(&chat.insert_container(0, LoroMap::new()).unwrap(), &kept);
                }),
            ),
        ];
        for role in [
            ProjectRole::Editor,
            ProjectRole::Reviewer,
            ProjectRole::Commenter,
        ] {
            for (what, edit) in &allowed {
                let update = change(&held, 2, |doc| edit(doc));
                assert_eq!(
                    judged(&held, &update, rule(role)),
                    RoleVerdict::Allowed,
                    "{what} as {role:?}"
                );
            }
            for (what, edit) in &refused {
                let update = change(&held, 2, |doc| edit(doc));
                let doc = loaded(&held, 98);
                doc.import(&update).unwrap();
                assert_eq!(
                    doc.get_deep_value(),
                    loaded(&held, 97).get_deep_value(),
                    "{what} leaves every value as it was"
                );
                assert_eq!(
                    judged(&held, &update, rule(role)),
                    RoleVerdict::Refused,
                    "{what} as {role:?}"
                );
            }
        }
    }

    #[test]
    fn a_first_reaction_on_a_thread_without_reactions_is_allowed() {
        let base = discussed_base();
        let first = change(&[&base], 2, |doc| {
            their_thread(doc)
                .insert_container("reactions", LoroMap::new())
                .unwrap()
                .insert(&reaction_key("m1", "👍", &me()), 1)
                .unwrap();
        });
        assert_eq!(
            judged(&[&base], &first, rule(ProjectRole::Commenter)),
            RoleVerdict::Allowed
        );
        let started = |account: String| {
            change(&[&base], 2, move |doc| {
                let thread = doc
                    .get_map(COMMENTS)
                    .insert_container("f1/t2", LoroMap::new())
                    .unwrap();
                thread.insert("created_by", me()).unwrap();
                said(
                    &thread
                        .insert_container("messages", LoroList::new())
                        .unwrap(),
                    &me(),
                    "m2",
                );
                thread
                    .insert_container("reactions", LoroMap::new())
                    .unwrap()
                    .insert(&reaction_key("m2", "👍", &account), 1)
                    .unwrap();
            })
        };
        assert_eq!(
            judged(&[&base], &started(me()), rule(ProjectRole::Commenter)),
            RoleVerdict::Allowed
        );
        assert_eq!(
            judged(
                &[&base],
                &started(editor().to_string()),
                rule(ProjectRole::Commenter)
            ),
            RoleVerdict::Refused
        );
        let off = RoleRule {
            comments_off: true,
            ..rule(ProjectRole::Commenter)
        };
        assert_eq!(judged(&[&base], &first, off), RoleVerdict::ChangesComments);
    }

    fn tombstone(message: &LoroMap) {
        message.insert("deleted", true).unwrap();
        message.insert("removed", true).unwrap();
        message.insert("body", "").unwrap();
        message
            .insert("mentions", LoroValue::from(Vec::<String>::new()))
            .unwrap();
    }

    fn varint(bytes: &[u8]) -> Option<(usize, usize)> {
        let mut value = 0usize;
        for (index, byte) in bytes.iter().take(5).enumerate() {
            value |= usize::from(byte & 0x7f) << (7 * index);
            if byte & 0x80 == 0 {
                return Some((value, index + 1));
            }
        }
        None
    }

    fn push_varint(mut value: usize, out: &mut Vec<u8>) {
        loop {
            let byte = u8::try_from(value & 0x7f).unwrap();
            value >>= 7;
            if value == 0 {
                out.push(byte);
                return;
            }
            out.push(byte | 0x80);
        }
    }

    fn arena_starts(mut bytes: &[u8]) -> Option<Vec<usize>> {
        let (mut at, mut starts) = (0, Vec::new());
        while !bytes.is_empty() {
            let (length, prefix) = varint(bytes)?;
            let entry = bytes.get(prefix..prefix + length)?;
            std::str::from_utf8(entry).ok()?;
            starts.push(at);
            at += prefix + length;
            bytes = &bytes[prefix + length..];
        }
        (!starts.is_empty()).then_some(starts)
    }

    fn with_overlong_key(update: &[u8], key: &[u8]) -> Vec<u8> {
        let mut plain = vec![u8::try_from(key.len()).unwrap()];
        plain.extend_from_slice(key);
        let (header, body) = update.split_at(22);
        let (block_length, used) = varint(body).unwrap();
        assert_eq!(used + block_length, body.len(), "one block of changes");
        let block = &body[used..];
        let at = block
            .windows(plain.len())
            .position(|window| window == plain.as_slice())
            .expect("the key is in the update");
        let (start, length, prefix) = (0..at)
            .rev()
            .find_map(|start| {
                let (length, prefix) = varint(&block[start..])?;
                let arena = block.get(start + prefix..start + prefix + length)?;
                let starts = arena_starts(arena)?;
                starts
                    .contains(&(at - start - prefix))
                    .then_some((start, length, prefix))
            })
            .expect("the keys arena");
        let mut patched = block[..start].to_vec();
        push_varint(length + 1, &mut patched);
        patched.extend_from_slice(&block[start + prefix..at]);
        patched.extend_from_slice(&[plain[0] | 0x80, 0]);
        patched.extend_from_slice(&block[at + 1..]);
        let mut crafted = header.to_vec();
        push_varint(patched.len(), &mut crafted);
        crafted.extend_from_slice(&patched);
        let sum = xxhash_rust::xxh32::xxh32(&crafted[20..], u32::from_le_bytes(*b"LORO"));
        crafted[16..20].copy_from_slice(&sum.to_le_bytes());
        crafted
    }

    fn flag(map: &LoroMap, key: &str) -> Option<bool> {
        match map.get(key) {
            Some(ValueOrContainer::Value(LoroValue::Bool(flag))) => Some(flag),
            _ => None,
        }
    }

    #[test]
    fn an_editor_change_is_judged_by_what_it_does_and_not_by_how_its_keys_are_spelled() {
        let base = discussed_base();
        let removal = change(&[&base], 2, |doc| tombstone(&their_message(doc)));
        let hidden = with_overlong_key(&removal, b"removed");
        assert!(removal.windows(8).any(|window| window == b"\x07removed"));
        assert!(!hidden.windows(8).any(|window| window == b"\x07removed"));
        let read = loaded(&[&base], 7);
        read.import(&hidden).unwrap();
        assert_eq!(flag(&their_message(&read), "removed"), Some(true));
        assert!(RoleRule::needed(ProjectRole::Editor));
        assert_eq!(
            judged(&[&base], &hidden, rule(ProjectRole::Editor)),
            RoleVerdict::Refused
        );
    }

    #[test]
    fn an_editor_typing_is_cleared_without_reading_the_document_and_anything_near_comments_is_not()
    {
        let base = discussed_base();
        let spared = |held: &[&[u8]], update: &[u8]| {
            let doc = loaded(held, 99);
            doc.detach();
            let state = doc.state_frontiers();
            let spared = spares_comments(&doc, update);
            assert_eq!(doc.state_frontiers(), state);
            spared
        };
        let typed = change(&[&base], 2, |doc| {
            file_text(doc, FILE).insert(0, "x").unwrap();
        });
        assert_eq!(spared(&[&base], &typed), Some(true));
        let reply = change(&[&base], 2, |doc| {
            said(&list_in(their_thread(doc).get("messages")), &me(), "m2");
        });
        assert_eq!(spared(&[&base], &reply), Some(false));
        let removal = change(&[&base], 2, |doc| tombstone(&their_message(doc)));
        assert_eq!(
            spared(&[&base], &with_overlong_key(&removal, b"removed")),
            Some(false)
        );
        let later = change(&[&base, &typed], 3, |doc| {
            file_text(doc, FILE).insert(0, "y").unwrap();
        });
        assert_eq!(spared(&[&base], &later), None);
        assert_eq!(spared(&[&base, &typed], &later), Some(true));
    }

    #[test]
    fn an_editor_deletes_only_their_own_comments_and_never_touches_a_removal() {
        let base = discussed_base();
        let editor = rule(ProjectRole::Editor);
        let deleted = change(&[&base], 2, |doc| {
            let message = their_message(doc);
            message.insert("deleted", true).unwrap();
            message.insert("body", "").unwrap();
        });
        assert_eq!(judged(&[&base], &deleted, editor), RoleVerdict::Refused);
        let dropped = change(&[&base], 2, |doc| {
            list_in(their_thread(doc).get("messages"))
                .delete(0, 1)
                .unwrap();
        });
        assert_eq!(judged(&[&base], &dropped, editor), RoleVerdict::Refused);
        let moderated = change(&[&base], 3, |doc| tombstone(&their_message(doc)));
        let held: [&[u8]; 2] = [&base, &moderated];
        let undone = change(&held, 2, |doc| {
            their_message(doc).delete("removed").unwrap();
        });
        assert_eq!(judged(&held, &undone, editor), RoleVerdict::Refused);
        let restored = change(&held, 2, |doc| {
            their_message(doc).insert("deleted", false).unwrap();
        });
        assert_eq!(judged(&held, &restored, editor), RoleVerdict::Refused);
        let reply = change(&[&base], 2, |doc| {
            said(&list_in(their_thread(doc).get("messages")), &me(), "m2");
        });
        assert_eq!(judged(&[&base], &reply, editor), RoleVerdict::Allowed);
        let own_delete = change(&[&base, &reply], 2, |doc| {
            let message = map_in(list_in(their_thread(doc).get("messages")).get(1));
            message.insert("deleted", true).unwrap();
            message.insert("body", "").unwrap();
        });
        assert_eq!(
            judged(&[&base, &reply], &own_delete, editor),
            RoleVerdict::Allowed
        );
        let typed = change(&[&base], 2, |doc| {
            file_text(doc, FILE).insert(0, "x").unwrap();
        });
        assert_eq!(judged(&[&base], &typed, editor), RoleVerdict::Allowed);
    }

    fn plain(author: &str, id: &str) -> LoroValue {
        LoroValue::from(HashMap::from([
            ("id".to_owned(), LoroValue::from(id)),
            ("author".to_owned(), LoroValue::from(author)),
            ("at".to_owned(), LoroValue::from(5_i64)),
            ("body".to_owned(), LoroValue::from(format!("{id} body"))),
        ]))
    }

    #[test]
    fn a_message_that_is_not_a_map_of_its_own_is_refused_for_every_role() {
        let base = discussed_base();
        let refused: Vec<(&str, Edit)> = vec![
            (
                "a plain reply in someone else's name",
                Box::new(|doc| {
                    list_in(their_thread(doc).get("messages"))
                        .push(plain(&editor().to_string(), "m2"))
                        .unwrap();
                }),
            ),
            (
                "a plain reply in an own name",
                Box::new(|doc| {
                    list_in(their_thread(doc).get("messages"))
                        .push(plain(&me(), "m2"))
                        .unwrap();
                }),
            ),
            (
                "a plain chat message",
                Box::new(|doc| {
                    doc.get_list(CHAT).push(plain(&me(), "c2")).unwrap();
                }),
            ),
            (
                "a text where a message goes",
                Box::new(|doc| {
                    list_in(their_thread(doc).get("messages"))
                        .push_container(loro::LoroText::new())
                        .unwrap();
                }),
            ),
            (
                "a new thread whose messages are a plain list",
                Box::new(|doc| {
                    let thread = doc
                        .get_map(COMMENTS)
                        .insert_container("f1/t3", LoroMap::new())
                        .unwrap();
                    thread.insert("created_by", me()).unwrap();
                    thread
                        .insert("messages", LoroValue::from(vec![plain(&me(), "m3")]))
                        .unwrap();
                }),
            ),
            (
                "a new thread whose messages are a map",
                Box::new(|doc| {
                    let thread = doc
                        .get_map(COMMENTS)
                        .insert_container("f1/t3", LoroMap::new())
                        .unwrap();
                    thread.insert("created_by", me()).unwrap();
                    thread.insert_container("messages", LoroMap::new()).unwrap();
                }),
            ),
        ];
        for role in [
            ProjectRole::Editor,
            ProjectRole::Reviewer,
            ProjectRole::Commenter,
        ] {
            for (what, edit) in &refused {
                let update = change(&[&base], 2, |doc| edit(doc));
                assert_eq!(
                    judged(&[&base], &update, rule(role)),
                    RoleVerdict::Refused,
                    "{what} as {role:?}"
                );
            }
            let reply = change(&[&base], 2, |doc| {
                said(&list_in(their_thread(doc).get("messages")), &me(), "m2");
            });
            assert_eq!(
                judged(&[&base], &reply, rule(role)),
                RoleVerdict::Allowed,
                "a reply of its own as {role:?}"
            );
        }
    }

    #[test]
    fn an_editor_never_takes_a_message_or_a_thread_out_and_never_renames_a_message() {
        let base = discussed_base();
        let editor = rule(ProjectRole::Editor);
        let mine = change(&[&base], 2, |doc| {
            said(&list_in(their_thread(doc).get("messages")), &me(), "m2");
            let thread = doc
                .get_map(COMMENTS)
                .insert_container("f1/t3", LoroMap::new())
                .unwrap();
            thread.insert("created_by", me()).unwrap();
            let messages = thread
                .insert_container("messages", LoroList::new())
                .unwrap();
            said(&messages, &me(), "m3");
        });
        let held: [&[u8]; 2] = [&base, &mine];
        let refused: Vec<(&str, Edit)> = vec![
            (
                "taking an own reply out of the thread",
                Box::new(|doc| {
                    list_in(their_thread(doc).get("messages"))
                        .delete(1, 1)
                        .unwrap();
                }),
            ),
            (
                "taking an own thread out of the comments",
                Box::new(|doc| doc.get_map(COMMENTS).delete("f1/t3").unwrap()),
            ),
            (
                "giving an own reply another id",
                Box::new(|doc| {
                    map_in(list_in(their_thread(doc).get("messages")).get(1))
                        .insert("id", "m4")
                        .unwrap();
                }),
            ),
        ];
        for (what, edit) in &refused {
            let update = change(&held, 2, |doc| edit(doc));
            assert_eq!(
                judged(&held, &update, editor),
                RoleVerdict::Refused,
                "{what}"
            );
        }
        let deleted = change(&held, 2, |doc| {
            let message = map_in(list_in(their_thread(doc).get("messages")).get(1));
            message.insert("deleted", true).unwrap();
            message.insert("body", "").unwrap();
        });
        assert_eq!(judged(&held, &deleted, editor), RoleVerdict::Allowed);
    }

    fn carol() -> String {
        "01920000-0000-7000-8000-0000000000c1".to_string()
    }

    fn anchored(doc: &LoroDoc, key: &str, by: &str) -> LoroList {
        let thread = doc
            .get_map(COMMENTS)
            .insert_container(key, LoroMap::new())
            .unwrap();
        let text = file_text(doc, FILE);
        let cursor = crate::test_support::suggestions::cursor_at;
        thread.insert("quote", "Hello").unwrap();
        thread.insert("created_by", by).unwrap();
        thread.insert("created_at", 1_i64).unwrap();
        thread.insert("start", cursor(&text, 0)).unwrap();
        thread.insert("end", cursor(&text, 4)).unwrap();
        thread
            .insert_container("messages", LoroList::new())
            .unwrap()
    }

    fn timed(list: &LoroList, author: &str, id: &str) {
        said(list, author, id).insert("at", 1_i64).unwrap();
    }

    fn message_at(doc: &LoroDoc, key: &str, index: usize) -> LoroMap {
        map_in(list_in(map_in(doc.get_map(COMMENTS).get(key)).get("messages")).get(index))
    }

    #[test]
    fn an_editor_never_rewrites_another_persons_authorship_or_time_or_any_threads_anchor() {
        let doc = LoroDoc::new();
        doc.set_peer_id(1).unwrap();
        file_text(&doc, FILE).insert(0, TEXT_START).unwrap();
        let messages = anchored(&doc, "f1/t1", &editor().to_string());
        timed(&messages, &editor().to_string(), "m1");
        timed(&messages, &carol(), "m2");
        doc.commit();
        let base = doc.export(ExportMode::Snapshot).unwrap();
        let mine = change(&[&base], 2, |doc| {
            let messages = anchored(doc, "f1/t2", &me());
            timed(&messages, &me(), "m3");
        });
        let answered = change(&[&base, &mine], 4, |doc| {
            timed(
                &list_in(map_in(doc.get_map(COMMENTS).get("f1/t2")).get("messages")),
                &carol(),
                "m4",
            );
        });
        let held: [&[u8]; 3] = [&base, &mine, &answered];
        let editor_rule = rule(ProjectRole::Editor);
        let thread = |doc: &LoroDoc, key: &str| map_in(doc.get_map(COMMENTS).get(key));
        let refused: Vec<(&str, Edit)> = vec![
            (
                "breaking the time of someone else's comment",
                Box::new(|doc| message_at(doc, "f1/t1", 0).insert("at", "soon").unwrap()),
            ),
            (
                "breaking the author of someone else's reply",
                Box::new(|doc| {
                    message_at(doc, "f1/t1", 1)
                        .insert("author", "nobody")
                        .unwrap()
                }),
            ),
            (
                "writing someone else's time again as it was",
                Box::new(|doc| rewrite(&message_at(doc, "f1/t1", 0), "at")),
            ),
            (
                "giving an own comment to someone else",
                Box::new(|doc| {
                    message_at(doc, "f1/t2", 0)
                        .insert("author", editor().to_string())
                        .unwrap()
                }),
            ),
            (
                "moving someone else's thread",
                Box::new(move |doc| thread(doc, "f1/t1").insert("start", "gone").unwrap()),
            ),
            (
                "handing someone else's thread to nobody",
                Box::new(move |doc| thread(doc, "f1/t1").insert("created_by", "nobody").unwrap()),
            ),
            (
                "changing when someone else's thread started",
                Box::new(move |doc| thread(doc, "f1/t1").insert("created_at", 2_i64).unwrap()),
            ),
            (
                "writing someone else's anchor again as it was",
                Box::new(move |doc| rewrite(&thread(doc, "f1/t1"), "start")),
            ),
            (
                "moving an own thread that someone answered",
                Box::new(move |doc| thread(doc, "f1/t2").insert("start", "gone").unwrap()),
            ),
            (
                "rewriting someone else's comment",
                Box::new(|doc| {
                    message_at(doc, "f1/t1", 0)
                        .insert("body", "changed")
                        .unwrap()
                }),
            ),
            (
                "blanking someone else's reply",
                Box::new(|doc| message_at(doc, "f1/t1", 1).insert("body", "").unwrap()),
            ),
            (
                "changing whom someone else's comment mentions",
                Box::new(|doc| {
                    message_at(doc, "f1/t1", 0)
                        .insert("mentions", LoroValue::from(vec![carol()]))
                        .unwrap()
                }),
            ),
            (
                "marking someone else's comment as edited",
                Box::new(|doc| {
                    message_at(doc, "f1/t1", 0)
                        .insert("edited_at", 2_i64)
                        .unwrap()
                }),
            ),
            (
                "writing someone else's comment again as it was",
                Box::new(|doc| rewrite(&message_at(doc, "f1/t1", 0), "body")),
            ),
            (
                "answering in an own thread by rewriting the reply someone wrote there",
                Box::new(|doc| {
                    message_at(doc, "f1/t2", 1)
                        .insert("body", "changed")
                        .unwrap()
                }),
            ),
        ];
        let mut wrong = Vec::new();
        for (what, edit) in &refused {
            let update = change(&held, 2, |doc| edit(doc));
            let verdict = judged(&held, &update, editor_rule);
            if verdict != RoleVerdict::Refused {
                wrong.push(format!("{what}: {verdict:?}"));
            }
        }
        let allowed: Vec<(&str, Edit)> = vec![
            (
                "editing an own comment",
                Box::new(|doc| {
                    let message = message_at(doc, "f1/t2", 0);
                    message.insert("body", "changed").unwrap();
                    message.insert("edited_at", 2_i64).unwrap();
                    message
                        .insert("mentions", LoroValue::from(vec![carol()]))
                        .unwrap();
                }),
            ),
            (
                "resolving someone else's thread",
                Box::new(move |doc| thread(doc, "f1/t1").insert("resolved", "done").unwrap()),
            ),
            (
                "changing the time of an own comment",
                Box::new(|doc| message_at(doc, "f1/t2", 0).insert("at", 2_i64).unwrap()),
            ),
            (
                "deleting an own comment",
                Box::new(|doc| {
                    let message = message_at(doc, "f1/t2", 0);
                    message.insert("deleted", true).unwrap();
                    message.insert("body", "").unwrap();
                }),
            ),
        ];
        for (what, edit) in &allowed {
            let update = change(&held, 2, |doc| edit(doc));
            let verdict = judged(&held, &update, editor_rule);
            if verdict != RoleVerdict::Allowed {
                wrong.push(format!("{what}: {verdict:?}"));
            }
        }
        assert!(wrong.is_empty(), "{wrong:#?}");
    }

    #[test]
    fn a_change_is_judged_with_whether_it_touched_comments() {
        let base = discussed_base();
        let touched = |update: &[u8], role: ProjectRole| {
            let judged = judged_whole(&[&base], update, rule(role));
            assert_eq!(judged.verdict, RoleVerdict::Allowed, "{role:?}");
            judged.comments
        };
        let typed = change(&[&base], 2, |doc| {
            file_text(doc, FILE).insert(0, "x").unwrap();
        });
        let suggested = change(&[&base], 2, |doc| {
            suggest_insert(doc, "s1", FILE, 5, "!", &me());
        });
        let chatted = change(&[&base], 2, |doc| {
            said(&doc.get_list(CHAT), &me(), "c2");
        });
        let bare = change(&[&base], 2, |doc| {
            let message = list_in(their_thread(doc).get("messages"))
                .push_container(LoroMap::new())
                .unwrap();
            message.insert("id", "m2").unwrap();
            message.insert("author", me()).unwrap();
        });
        let resolved = change(&[&base], 2, |doc| {
            their_thread(doc).insert("resolved", "done").unwrap();
        });
        assert!(!touched(&typed, ProjectRole::Editor));
        assert!(!touched(&suggested, ProjectRole::Reviewer));
        assert!(!touched(&chatted, ProjectRole::Commenter));
        for role in [
            ProjectRole::Editor,
            ProjectRole::Reviewer,
            ProjectRole::Commenter,
        ] {
            assert!(touched(&bare, role), "{role:?}");
            assert!(touched(&resolved, role), "{role:?}");
        }
    }

    #[test]
    fn an_editor_changes_only_their_own_chat_messages() {
        let base = discussed_base();
        let judge_as = rule(ProjectRole::Editor);
        let mine = change(&[&base], 2, |doc| {
            said(&doc.get_list(CHAT), &me(), "c2");
        });
        assert_eq!(judged(&[&base], &mine, judge_as), RoleVerdict::Allowed);
        let held: [&[u8]; 2] = [&base, &mine];
        let own_deleted = change(&held, 2, |doc| {
            let message = map_in(doc.get_list(CHAT).get(1));
            message.insert("deleted", true).unwrap();
            message.insert("body", "").unwrap();
        });
        assert_eq!(judged(&held, &own_deleted, judge_as), RoleVerdict::Allowed);
        let refused: Vec<(&str, Edit)> = vec![
            (
                "deleting someone else's chat message",
                Box::new(|doc| {
                    let message = their_chat(doc);
                    message.insert("deleted", true).unwrap();
                    message.insert("body", "").unwrap();
                }),
            ),
            (
                "rewriting someone else's chat message",
                Box::new(|doc| their_chat(doc).insert("body", "changed").unwrap()),
            ),
            (
                "removing a chat message",
                Box::new(|doc| doc.get_list(CHAT).delete(0, 1).unwrap()),
            ),
            (
                "posting in someone else's name",
                Box::new(|doc| {
                    said(&doc.get_list(CHAT), &editor().to_string(), "c3");
                }),
            ),
        ];
        for (what, edit) in &refused {
            let update = change(&held, 2, |doc| edit(doc));
            assert_eq!(
                judged(&held, &update, judge_as),
                RoleVerdict::Refused,
                "{what}"
            );
            let doc = loaded(&held, 99);
            doc.detach();
            assert_eq!(spares_comments(&doc, &update), Some(false), "{what}");
        }
    }

    #[test]
    fn only_an_owner_may_remove_someone_elses_comment() {
        let base = discussed_base();
        let removal = change(&[&base], 2, |doc| tombstone(&their_message(doc)));
        let typed = change(&[&base], 2, |doc| {
            file_text(doc, FILE).insert(0, "x").unwrap();
        });
        assert!(!RoleRule::needed(ProjectRole::Owner));
        let reply = change(&[&base], 2, |doc| {
            said(&list_in(their_thread(doc).get("messages")), &me(), "m2");
        });
        let own_removed = change(&[&base, &reply], 2, |doc| {
            tombstone(&map_in(list_in(their_thread(doc).get("messages")).get(1)));
        });
        for role in [
            ProjectRole::Editor,
            ProjectRole::Reviewer,
            ProjectRole::Commenter,
        ] {
            assert_eq!(
                judged(&[&base], &removal, rule(role)),
                RoleVerdict::Refused,
                "removing another person's comment as {role:?}"
            );
            assert_eq!(
                judged(&[&base, &reply], &own_removed, rule(role)),
                RoleVerdict::Refused,
                "marking an own comment as removed as {role:?}"
            );
        }
        let editor = rule(ProjectRole::Editor);
        assert_eq!(judged(&[&base], &typed, editor), RoleVerdict::Allowed);
        assert_eq!(judged(&[&base], &reply, editor), RoleVerdict::Allowed);
        let off = RoleRule {
            comments_off: true,
            ..editor
        };
        assert_eq!(judged(&[&base], &reply, off), RoleVerdict::ChangesComments);
        assert_eq!(judged(&[&base], &typed, off), RoleVerdict::Allowed);
    }

    #[test]
    fn with_comments_off_a_reviewer_comment_reads_as_a_comment_change() {
        let base = shared();
        let comment = change(&[&base], 2, |doc| {
            let thread = doc
                .get_map(COMMENTS)
                .insert_container("f1/t2", LoroMap::new())
                .unwrap();
            thread
                .insert_container("messages", LoroList::new())
                .unwrap();
        });
        let off = RoleRule {
            comments_off: true,
            ..rule(ProjectRole::Reviewer)
        };
        assert_eq!(
            judged(&[&base], &comment, off),
            RoleVerdict::ChangesComments
        );
    }

    #[test]
    fn a_change_that_builds_on_changes_the_server_lacks_cannot_be_judged() {
        let base = shared();
        let first = change(&[&base], 2, |doc| {
            suggest_insert(doc, "s1", FILE, 5, "a", &me());
        });
        let second = change(&[&base, &first], 2, |doc| {
            suggest_insert(doc, "s2", FILE, 0, "b", &me());
        });
        assert_eq!(
            judged(&[&base], &second, rule(ProjectRole::Reviewer)),
            RoleVerdict::Unreadable
        );
        assert_eq!(
            judged(&[&base], b"not a change", rule(ProjectRole::Reviewer)),
            RoleVerdict::Unreadable
        );
    }

    const DISCUSSING: [ProjectRole; 3] = [
        ProjectRole::Editor,
        ProjectRole::Reviewer,
        ProjectRole::Commenter,
    ];

    fn judged_as_every_role(held: &[&[u8]], edits: &[(&str, Edit)], expected: RoleVerdict) {
        let mut wrong = Vec::new();
        for role in DISCUSSING {
            for (what, edit) in edits {
                let update = change(held, 2, |doc| edit(doc));
                let verdict = judged(held, &update, rule(role));
                if verdict != expected {
                    wrong.push(format!("{what} as {role:?}: {verdict:?}"));
                }
            }
        }
        assert!(wrong.is_empty(), "{wrong:#?}");
    }

    #[test]
    fn a_reaction_names_an_emoji_and_a_message_that_is_there() {
        let base = discussed_base();
        let stale = {
            let doc = loaded(&[&base], 1);
            reactions_on(&doc)
                .insert(&reaction_key("m9", "👍", &me()), 1)
                .unwrap();
            doc.get_map(CHAT_REACTIONS)
                .insert(&reaction_key("c9", "👍", &me()), 1)
                .unwrap();
            doc.commit();
            doc.export(ExportMode::all_updates()).unwrap()
        };
        let held: [&[u8]; 2] = [&base, &stale];
        let refused: Vec<(&str, Edit)> = vec![
            (
                "a word instead of an emoji",
                Box::new(|doc| {
                    reactions_on(doc)
                        .insert(&reaction_key("m1", "ok", &me()), 2)
                        .unwrap();
                }),
            ),
            (
                "a reaction to a comment that is not in the thread",
                Box::new(|doc| {
                    reactions_on(doc)
                        .insert(&reaction_key("m2", "👍", &me()), 2)
                        .unwrap();
                }),
            ),
            (
                "a reaction to a chat message that is not in the chat",
                Box::new(|doc| {
                    doc.get_map(CHAT_REACTIONS)
                        .insert(&reaction_key("c2", "👍", &me()), 2)
                        .unwrap();
                }),
            ),
            (
                "a chat reaction naming a comment",
                Box::new(|doc| {
                    doc.get_map(CHAT_REACTIONS)
                        .insert(&reaction_key("m1", "👍", &me()), 2)
                        .unwrap();
                }),
            ),
            (
                "a comment reaction naming a chat message",
                Box::new(|doc| {
                    reactions_on(doc)
                        .insert(&reaction_key("c1", "👍", &me()), 2)
                        .unwrap();
                }),
            ),
            (
                "a reaction kept again on a comment that is gone",
                Box::new(|doc| {
                    reactions_on(doc)
                        .insert(&reaction_key("m9", "👍", &me()), 3)
                        .unwrap();
                }),
            ),
        ];
        let allowed: Vec<(&str, Edit)> = vec![
            (
                "reacting to a comment and a chat message that are there",
                Box::new(|doc| {
                    reactions_on(doc)
                        .insert(&reaction_key("m1", "🇳🇴", &me()), 2)
                        .unwrap();
                    doc.get_map(CHAT_REACTIONS)
                        .insert(&reaction_key("c1", "👍🏽", &me()), 2)
                        .unwrap();
                }),
            ),
            (
                "taking back reactions to messages that are gone",
                Box::new(|doc| {
                    reactions_on(doc)
                        .delete(&reaction_key("m9", "👍", &me()))
                        .unwrap();
                    doc.get_map(CHAT_REACTIONS)
                        .delete(&reaction_key("c9", "👍", &me()))
                        .unwrap();
                }),
            ),
        ];
        judged_as_every_role(&held, &refused, RoleVerdict::Refused);
        judged_as_every_role(&held, &allowed, RoleVerdict::Allowed);
    }

    const EMOJI: [&str; 21] = [
        "👍", "🎉", "❤️", "😄", "👀", "🚀", "🍕", "👋", "🙏", "🔥", "✅", "💯", "🤔", "😂", "🥳",
        "👏", "🙌", "😮", "😢", "🇳🇴", "1️⃣",
    ];

    #[test]
    fn one_person_adds_at_most_twenty_reactions_to_a_message() {
        let base = discussed_base();
        let mine = change(&[&base], 2, |doc| {
            for emoji in &EMOJI[..MAX_REACTIONS_PER_PERSON] {
                reactions_on(doc)
                    .insert(&reaction_key("m1", emoji, &me()), 1)
                    .unwrap();
                doc.get_map(CHAT_REACTIONS)
                    .insert(&reaction_key("c1", emoji, &me()), 1)
                    .unwrap();
            }
        });
        for role in DISCUSSING {
            assert_eq!(
                judged(&[&base], &mine, rule(role)),
                RoleVerdict::Allowed,
                "{role:?}"
            );
        }
        let held: [&[u8]; 2] = [&base, &mine];
        let more = EMOJI[MAX_REACTIONS_PER_PERSON];
        let refused: Vec<(&str, Edit)> = vec![
            (
                "one more on a comment",
                Box::new(move |doc| {
                    reactions_on(doc)
                        .insert(&reaction_key("m1", more, &me()), 2)
                        .unwrap();
                }),
            ),
            (
                "one more on a chat message",
                Box::new(move |doc| {
                    doc.get_map(CHAT_REACTIONS)
                        .insert(&reaction_key("c1", more, &me()), 2)
                        .unwrap();
                }),
            ),
        ];
        let allowed: Vec<(&str, Edit)> = vec![
            (
                "swapping one for another",
                Box::new(move |doc| {
                    let reactions = reactions_on(doc);
                    reactions.delete(&reaction_key("m1", "👍", &me())).unwrap();
                    reactions
                        .insert(&reaction_key("m1", more, &me()), 2)
                        .unwrap();
                }),
            ),
            (
                "taking one back",
                Box::new(|doc| {
                    reactions_on(doc)
                        .delete(&reaction_key("m1", "🎉", &me()))
                        .unwrap();
                }),
            ),
            (
                "one more on another message",
                Box::new(move |doc| {
                    let message = said(&list_in(their_thread(doc).get("messages")), &me(), "m2");
                    message.insert("at", 3_i64).unwrap();
                    reactions_on(doc)
                        .insert(&reaction_key("m2", more, &me()), 2)
                        .unwrap();
                }),
            ),
        ];
        judged_as_every_role(&held, &refused, RoleVerdict::Refused);
        judged_as_every_role(&held, &allowed, RoleVerdict::Allowed);
    }

    #[test]
    fn a_full_reactions_map_takes_no_new_reaction_but_lets_people_take_theirs_back() {
        let base = discussed_base();
        let filled = {
            let doc = loaded(&[&base], 1);
            let reactions = doc.get_map(CHAT_REACTIONS);
            for index in 0..MAX_REACTION_KEYS {
                reactions
                    .insert(&reaction_key(&format!("c{index}"), "👍", &carol()), 1)
                    .unwrap();
            }
            reactions
                .insert(&reaction_key("c1", "🎉", &me()), 1)
                .unwrap();
            doc.commit();
            doc.export(ExportMode::all_updates()).unwrap()
        };
        let held: [&[u8]; 2] = [&base, &filled];
        let refused: Vec<(&str, Edit)> = vec![(
            "a new chat reaction",
            Box::new(|doc| {
                doc.get_map(CHAT_REACTIONS)
                    .insert(&reaction_key("c1", "👍", &me()), 2)
                    .unwrap();
            }),
        )];
        let allowed: Vec<(&str, Edit)> = vec![
            (
                "taking an own reaction back",
                Box::new(|doc| {
                    doc.get_map(CHAT_REACTIONS)
                        .delete(&reaction_key("c1", "🎉", &me()))
                        .unwrap();
                }),
            ),
            (
                "swapping an own reaction for another",
                Box::new(|doc| {
                    let reactions = doc.get_map(CHAT_REACTIONS);
                    reactions.delete(&reaction_key("c1", "🎉", &me())).unwrap();
                    reactions
                        .insert(&reaction_key("c1", "👍", &me()), 2)
                        .unwrap();
                }),
            ),
            (
                "a reaction on a comment",
                Box::new(|doc| {
                    reactions_on(doc)
                        .insert(&reaction_key("m1", "👍", &me()), 2)
                        .unwrap();
                }),
            ),
            (
                "typing",
                Box::new(|doc| {
                    file_text(doc, FILE).insert(0, "x").unwrap();
                }),
            ),
        ];
        judged_as_every_role(&held, &refused, RoleVerdict::Refused);
        for (what, edit) in &allowed {
            let update = change(&held, 2, |doc| edit(doc));
            let verdict = judged(&held, &update, rule(ProjectRole::Editor));
            assert_eq!(verdict, RoleVerdict::Allowed, "{what}");
        }
        judged_as_every_role(&held, &allowed[..3], RoleVerdict::Allowed);
    }

    fn named(count: usize) -> LoroValue {
        LoroValue::from(
            (0..count)
                .map(|index| format!("01920000-0000-7000-8000-{index:012x}"))
                .collect::<Vec<String>>(),
        )
    }

    #[test]
    fn a_message_names_at_most_a_hundred_people() {
        let base = discussed_base();
        let crowded = {
            let doc = loaded(&[&base], 1);
            their_message(&doc)
                .insert("mentions", named(MAX_MENTIONS * 2))
                .unwrap();
            said(&doc.get_list(CHAT), &me(), "c0")
                .insert("mentions", named(MAX_MENTIONS * 2))
                .unwrap();
            doc.commit();
            doc.export(ExportMode::all_updates()).unwrap()
        };
        let mine = change(&[&base, &crowded], 2, |doc| {
            said(&list_in(their_thread(doc).get("messages")), &me(), "m2")
                .insert("mentions", named(MAX_MENTIONS))
                .unwrap();
            said(&doc.get_list(CHAT), &me(), "c2")
                .insert("mentions", named(MAX_MENTIONS))
                .unwrap();
        });
        for role in DISCUSSING {
            assert_eq!(
                judged(&[&base, &crowded], &mine, rule(role)),
                RoleVerdict::Allowed,
                "{role:?}"
            );
        }
        let held: [&[u8]; 3] = [&base, &crowded, &mine];
        let refused: Vec<(&str, Edit)> = vec![
            (
                "a reply naming too many people",
                Box::new(|doc| {
                    said(&list_in(their_thread(doc).get("messages")), &me(), "m3")
                        .insert("mentions", named(MAX_MENTIONS + 1))
                        .unwrap();
                }),
            ),
            (
                "a chat message naming too many people",
                Box::new(|doc| {
                    said(&doc.get_list(CHAT), &me(), "c3")
                        .insert("mentions", named(MAX_MENTIONS + 1))
                        .unwrap();
                }),
            ),
            (
                "an own reply edited to name too many people",
                Box::new(|doc| {
                    map_in(list_in(their_thread(doc).get("messages")).get(1))
                        .insert("mentions", named(MAX_MENTIONS + 1))
                        .unwrap();
                }),
            ),
            (
                "a new thread naming too many people",
                Box::new(|doc| {
                    let thread = doc
                        .get_map(COMMENTS)
                        .insert_container("f1/t3", LoroMap::new())
                        .unwrap();
                    thread.insert("created_by", me()).unwrap();
                    said(
                        &thread
                            .insert_container("messages", LoroList::new())
                            .unwrap(),
                        &me(),
                        "m4",
                    )
                    .insert("mentions", named(MAX_MENTIONS + 1))
                    .unwrap();
                }),
            ),
        ];
        let allowed: Vec<(&str, Edit)> = vec![
            (
                "a reply beside a message that already names many",
                Box::new(|doc| {
                    said(&list_in(their_thread(doc).get("messages")), &me(), "m5");
                }),
            ),
            (
                "deleting an own message written before the cap",
                Box::new(|doc| {
                    let message = map_in(doc.get_list(CHAT).get(1));
                    message.insert("deleted", true).unwrap();
                    message.insert("body", "").unwrap();
                }),
            ),
        ];
        judged_as_every_role(&held, &refused, RoleVerdict::Refused);
        judged_as_every_role(&held, &allowed, RoleVerdict::Allowed);
    }
}
