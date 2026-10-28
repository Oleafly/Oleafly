use std::collections::{BTreeMap, BTreeSet};

use loro::cursor::{Cursor, Side};
use loro::{
    ContainerID, ContainerTrait, ContainerType, Frontiers, Index, LoroDoc, LoroValue,
    ValueOrContainer, ID,
};
use oleafly_collab_protocol::ids::AccountId;
use oleafly_collab_protocol::projects::ProjectRole;

use crate::comment_guard::COMMENTS;
use crate::peers;
use crate::snapshots;

pub const CHAT: &str = "chat";
pub const SUGGESTIONS: &str = "suggestions";
const TEXT_PREFIX: &str = "text:";
const FILE_ID: &str = "file_id";
const KIND: &str = "kind";
const AUTHOR: &str = "author";
const START: &str = "start";
const END: &str = "end";
const ANCHOR: &str = "anchor";
const TEXT: &str = "text";
const INSERT: &str = "insert";
const DELETE: &str = "delete";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoleVerdict {
    Allowed,
    ChangesComments,
    Refused,
    Unreadable,
    Unchecked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RoleRule {
    pub role: ProjectRole,
    pub account: AccountId,
    pub comments_off: bool,
}

impl RoleRule {
    pub fn needed(role: ProjectRole) -> bool {
        matches!(role, ProjectRole::Reviewer | ProjectRole::Commenter)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Root {
    Comments,
    Chat,
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

fn judge_piece(doc: &LoroDoc, piece: &Piece, rule: &RoleRule) -> RoleVerdict {
    let length = usize::try_from(piece.to - piece.from).unwrap_or(0);
    let changed: Vec<ContainerID> = doc
        .get_changed_containers_in(ID::new(piece.peer, piece.from), length)
        .into_iter()
        .collect();
    let Some(found) = placed_in_piece(doc, piece, &changed) else {
        return RoleVerdict::Refused;
    };
    let mut files = BTreeSet::new();
    let mut records = BTreeSet::new();
    let mut comments = false;
    let mut review = false;
    for (container, found) in changed.iter().zip(found) {
        match (found.root, rule.role) {
            (Root::Comments, _) => comments = true,
            (Root::Chat, _) => {}
            (Root::Detached, _) if piece.made(container) => {}
            (Root::Suggestions, ProjectRole::Reviewer) => {
                review = true;
                records.extend(found.record);
            }
            (Root::Text, ProjectRole::Reviewer) => {
                review = true;
                files.extend(found.file);
            }
            _ => return RoleVerdict::Refused,
        }
    }
    if comments && rule.comments_off {
        return RoleVerdict::ChangesComments;
    }
    if review && !reviewed(doc, piece, files, records, &rule.account.to_string()) {
        return RoleVerdict::Refused;
    }
    RoleVerdict::Allowed
}

pub fn judge_imported(doc: &LoroDoc, spans: &[(u64, i32, i32)], rule: &RoleRule) -> RoleVerdict {
    if !RoleRule::needed(rule.role) {
        return RoleVerdict::Refused;
    }
    let Some(pieces) = pieces_of(doc, spans) else {
        return RoleVerdict::Unreadable;
    };
    let mut verdict = RoleVerdict::Allowed;
    for piece in &pieces {
        match judge_piece(doc, piece, rule) {
            RoleVerdict::Allowed => {}
            RoleVerdict::ChangesComments => verdict = RoleVerdict::ChangesComments,
            refused => return refused,
        }
    }
    verdict
}

fn read_in(doc: &LoroDoc, payload: &[u8], rule: &RoleRule) -> RoleVerdict {
    let Ok(status) = snapshots::import_update(doc, payload) else {
        return RoleVerdict::Unreadable;
    };
    if status.pending.is_some() {
        return RoleVerdict::Unreadable;
    }
    let spans: Vec<(u64, i32, i32)> = status
        .success
        .iter()
        .map(|(peer, (start, end))| (*peer, *start, *end))
        .collect();
    judge_imported(doc, &spans, rule)
}

pub fn judge(doc: &LoroDoc, payload: &[u8], rule: &RoleRule) -> (RoleVerdict, bool) {
    let attached = peers::update_reach(payload)
        .is_some_and(|reach| snapshots::builds_on(&reach, &doc.oplog_vv()));
    if !attached {
        return (RoleVerdict::Unreadable, true);
    }
    let verdict = read_in(doc, payload, rule);
    (verdict, verdict == RoleVerdict::Allowed)
}

#[cfg(test)]
mod tests {
    use loro::{ExportMode, LoroList, LoroMap};

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

    fn judged(held: &[&[u8]], update: &[u8], rule: RoleRule) -> RoleVerdict {
        let doc = loaded(held, 99);
        let (verdict, _) = judge(&doc, update, &rule);
        assert_eq!(
            doc.state_frontiers(),
            doc.oplog_frontiers(),
            "the document is back at its latest version"
        );
        verdict
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
            doc.get_map(COMMENTS)
                .insert_container("f1/t2", LoroMap::new())
                .unwrap()
                .insert("quote", "world")
                .unwrap();
        });
        assert_eq!(judged(&[&base], &comment, commenter), RoleVerdict::Allowed);
        let chat = change(&[&base], 2, |doc| {
            doc.get_list(CHAT)
                .push_container(LoroMap::new())
                .unwrap()
                .insert("body", "hi")
                .unwrap();
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
}
