use std::collections::{BTreeSet, HashMap};

use loro::event::ContainerDiff;
use loro::{
    CommitOptions, Container, ContainerID, Frontiers, Index, LoroMap, LoroValue, TreeID,
    UpdateOptions, ValueOrContainer, VersionVector, ID,
};
use oleafly_collab_protocol::crypto::{b64url_decode, b64url_encode};
use oleafly_collab_protocol::ids::{AccountId, VersionId};
use serde::Serialize;

use crate::comments::{number_of, parsed, string_of};
use crate::doc::{DocChanges, ProjectDoc};
use crate::CollabError;

pub const VERSIONS: &str = "versions";
pub const MAX_VERSION_NAME_CHARS: usize = 120;
pub const MAX_HISTORY_PAGE: usize = 200;
pub const RESTORE_MESSAGE: &str = "restore";
pub const MERGE_SECONDS: i64 = 60;
const GAP_MS: i64 = 10 * 60 * 1000;
const SPAN_MS: i64 = 60 * 60 * 1000;
const TEXT_PREFIX: &str = "text:";
const TREE: &str = "tree";
const NAME: &str = "name";
const FRONTIERS: &str = "frontiers";
const BY: &str = "by";
const AT: &str = "at";
const RESTORE_TIMEOUT_MS: f64 = 2_000.0;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub at: i64,
    pub until: i64,
    pub authors: Vec<AccountId>,
    pub files: Vec<String>,
    pub name: Option<String>,
    pub version_id: Option<VersionId>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub entries: Vec<HistoryEntry>,
    pub next_before: Option<String>,
}

struct Step {
    end: ID,
    at: i64,
    lamport: u32,
    restore: bool,
    files: BTreeSet<String>,
    author: Option<AccountId>,
}

struct Named {
    id: VersionId,
    name: String,
    at: i64,
    version: VersionVector,
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

pub fn history_unavailable() -> CollabError {
    refused(
        404,
        "history_unavailable",
        "this copy of the project does not hold that version",
    )
}

fn is_versions_root(id: &ContainerID) -> bool {
    matches!(id, ContainerID::Root { name, .. } if name.as_str() == VERSIONS)
}

pub(crate) fn record(change: &ContainerDiff<'_>) -> bool {
    match change.path.first() {
        Some((root, _)) => is_versions_root(root),
        None => is_versions_root(change.target),
    }
}

pub fn encode_frontiers(frontiers: &Frontiers) -> String {
    b64url_encode(&frontiers.encode())
}

fn decode_frontiers(version: &str) -> Result<Frontiers, CollabError> {
    let bytes = b64url_decode(version).map_err(|_| history_unavailable())?;
    Frontiers::decode(&bytes).map_err(|_| history_unavailable())
}

fn checked_name(name: &str) -> Result<&str, CollabError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(refused(400, "empty", "a version name needs some text"));
    }
    if name.chars().count() > MAX_VERSION_NAME_CHARS {
        return Err(refused(413, "too_large", "this version name is too long"));
    }
    Ok(name)
}

fn same_version(left: &VersionVector, right: &VersionVector) -> bool {
    left.includes_vv(right) && right.includes_vv(left)
}

fn starts_new_entry(open: Option<&(HistoryEntry, bool)>, step: &Step) -> bool {
    match open {
        None => true,
        Some((entry, restore)) => {
            (entry.at == 0) != (step.at == 0)
                || *restore != step.restore
                || (step.at > 0 && (step.at - entry.until > GAP_MS || step.at - entry.at > SPAN_MS))
        }
    }
}

fn absorb_step(entry: &mut HistoryEntry, step: Step) {
    entry.until = entry.until.max(step.at);
    if let Some(author) = step.author {
        if !entry.authors.contains(&author) {
            entry.authors.push(author);
        }
    }
    for file in step.files {
        if !entry.files.contains(&file) {
            entry.files.push(file);
        }
    }
}

impl ProjectDoc {
    pub fn version_of(&self, version: &str) -> Result<VersionVector, CollabError> {
        let frontiers = decode_frontiers(version)?;
        let loro = self.loro();
        let vv = loro
            .frontiers_to_vv(&frontiers)
            .ok_or_else(history_unavailable)?;
        let trimmed = loro.shallow_since_vv().to_vv();
        if !loro.oplog_vv().includes_vv(&vv) || !vv.includes_vv(&trimmed) {
            return Err(history_unavailable());
        }
        Ok(vv)
    }

    pub fn at_history(&self, version: &str) -> Result<ProjectDoc, CollabError> {
        let vv = self.version_of(version)?;
        self.at_version(&vv)
    }

    pub fn current_version_id(&self) -> String {
        encode_frontiers(&self.loro().oplog_frontiers())
    }

    fn version_map(&self) -> LoroMap {
        self.loro().get_map(VERSIONS)
    }

    fn named_versions(&self) -> Vec<Named> {
        let loro = self.loro();
        let mut named = Vec::new();
        self.version_map().for_each(|key, value| {
            let ValueOrContainer::Container(Container::Map(map)) = value else {
                return;
            };
            let LoroValue::Map(fields) = map.get_deep_value() else {
                return;
            };
            let (Ok(id), Some(name)) = (key.parse::<VersionId>(), string_of(fields.get(NAME)))
            else {
                return;
            };
            let Some(LoroValue::Binary(bytes)) = fields.get(FRONTIERS) else {
                return;
            };
            let Some(version) = Frontiers::decode(bytes)
                .ok()
                .and_then(|frontiers| loro.frontiers_to_vv(&frontiers))
            else {
                return;
            };
            named.push(Named {
                id,
                name,
                at: number_of(fields.get(AT)).unwrap_or_default(),
                version,
            });
        });
        named.sort_by_key(|named| std::cmp::Reverse((named.at, named.id)));
        named
    }

    fn files_by_node(&self) -> HashMap<TreeID, String> {
        self.file_ids()
            .into_iter()
            .map(|(id, node)| (node, id))
            .collect()
    }

    fn files_in_change(
        &self,
        id: ID,
        length: usize,
        nodes: &HashMap<TreeID, String>,
    ) -> Option<BTreeSet<String>> {
        let mut files = BTreeSet::new();
        let mut touched = false;
        for container in self.loro().get_changed_containers_in(id, length) {
            match &container {
                ContainerID::Root { name, .. } => {
                    if let Some(file) = name.strip_prefix(TEXT_PREFIX) {
                        files.insert(file.to_owned());
                        touched = true;
                    } else if name.as_str() == TREE {
                        touched = true;
                    }
                }
                ContainerID::Normal { .. } => {
                    let Some(path) = self.loro().get_path_to_container(&container) else {
                        continue;
                    };
                    let under_tree = matches!(
                        path.first(),
                        Some((ContainerID::Root { name, .. }, _)) if name.as_str() == TREE
                    );
                    if !under_tree {
                        continue;
                    }
                    touched = true;
                    for (_, index) in &path {
                        if let Index::Node(node) = index {
                            if let Some(file) = nodes.get(node) {
                                files.insert(file.clone());
                            }
                        }
                    }
                }
            }
        }
        touched.then_some(files)
    }

    fn author_of_peer(&self, peer: u64) -> Option<AccountId> {
        if peer == self.loro().peer_id() {
            if let Some(me) = self.author_account() {
                return Some(me);
            }
        }
        self.authorship().account_of(peer)
    }

    fn steps(&self, named: &[Named]) -> Vec<Step> {
        let loro = self.loro();
        let nodes = self.files_by_node();
        let trimmed = loro.shallow_since_vv().to_vv();
        let mut cuts: HashMap<u64, BTreeSet<i32>> = HashMap::new();
        for version in named {
            for (peer, end) in version.version.iter() {
                cuts.entry(*peer).or_default().insert(*end);
            }
        }
        let mut steps = Vec::new();
        for (peer, end) in loro.oplog_vv().iter() {
            let mut counter = trimmed.get(peer).copied().unwrap_or(0);
            while counter < *end {
                let Some(change) = loro.get_change(ID::new(*peer, counter)) else {
                    break;
                };
                let start = change.id.counter.max(counter);
                let change_end = change
                    .id
                    .counter
                    .saturating_add(i32::try_from(change.len).unwrap_or(i32::MAX))
                    .min(*end);
                if change_end <= start {
                    break;
                }
                let step_end = cuts
                    .get(peer)
                    .and_then(|cuts| cuts.range(start + 1..change_end).next().copied())
                    .unwrap_or(change_end);
                let length = usize::try_from(step_end - start).unwrap_or(0);
                if let Some(files) = self.files_in_change(ID::new(*peer, start), length, &nodes) {
                    let offset = u32::try_from(start - change.id.counter).unwrap_or(0);
                    steps.push(Step {
                        end: ID::new(*peer, step_end - 1),
                        at: change.timestamp.saturating_mul(1000),
                        lamport: change.lamport.saturating_add(offset),
                        restore: change.message.as_deref() == Some(RESTORE_MESSAGE),
                        files,
                        author: self.author_of_peer(*peer),
                    });
                }
                counter = step_end;
            }
        }
        steps.sort_by_key(|step| (step.at, step.lamport, step.end.peer, step.end.counter));
        steps
    }

    fn close_entry(
        &self,
        named: &[Named],
        open: &mut Option<(HistoryEntry, bool)>,
        entries: &mut Vec<HistoryEntry>,
        reached: &VersionVector,
    ) {
        if let Some((mut entry, _)) = open.take() {
            entry.id = encode_frontiers(&self.loro().vv_to_frontiers(reached));
            if let Some(found) = named
                .iter()
                .find(|named| same_version(&named.version, reached))
            {
                entry.name = Some(found.name.clone());
                entry.version_id = Some(found.id);
            }
            entries.push(entry);
        }
    }

    fn entries(&self) -> Vec<HistoryEntry> {
        let loro = self.loro();
        let named = self.named_versions();
        let mut entries: Vec<HistoryEntry> = Vec::new();
        let mut reached = VersionVector::new();
        let mut open: Option<(HistoryEntry, bool)> = None;
        for step in self.steps(&named) {
            if starts_new_entry(open.as_ref(), &step) {
                self.close_entry(&named, &mut open, &mut entries, &reached);
                open = Some((
                    HistoryEntry {
                        id: String::new(),
                        at: step.at,
                        until: step.at,
                        authors: Vec::new(),
                        files: Vec::new(),
                        name: None,
                        version_id: None,
                    },
                    step.restore,
                ));
            }
            if let Some(past) = loro.frontiers_to_vv(&Frontiers::from(step.end)) {
                reached.merge(&past);
            }
            if let Some((entry, _)) = open.as_mut() {
                absorb_step(entry, step);
            }
            if named
                .iter()
                .any(|named| same_version(&named.version, &reached))
            {
                self.close_entry(&named, &mut open, &mut entries, &reached);
            }
        }
        self.close_entry(&named, &mut open, &mut entries, &reached);
        entries.reverse();
        entries
    }

    pub fn history(&self, before: Option<&str>, limit: usize) -> HistoryPage {
        let entries = self.entries();
        let start = match before {
            Some(before) => match entries.iter().position(|entry| entry.id == before) {
                Some(index) => index + 1,
                None => return HistoryPage::default(),
            },
            None => 0,
        };
        let limit = limit.clamp(1, MAX_HISTORY_PAGE);
        let page: Vec<HistoryEntry> = entries.iter().skip(start).take(limit).cloned().collect();
        let next_before = (start + page.len() < entries.len())
            .then(|| page.last().map(|entry| entry.id.clone()))
            .flatten();
        HistoryPage {
            entries: page,
            next_before,
        }
    }

    pub fn name_version(
        &mut self,
        version: &str,
        name: &str,
        by: AccountId,
        at: i64,
    ) -> Result<VersionId, CollabError> {
        self.writable()?;
        let name = checked_name(name)?;
        let named = version
            .parse::<VersionId>()
            .ok()
            .filter(|id| self.named_versions().iter().any(|named| named.id == *id));
        if let Some(id) = named {
            if let Some(ValueOrContainer::Container(Container::Map(map))) =
                self.version_map().get(&id.to_string())
            {
                map.insert(NAME, name).map_err(loro_error)?;
                map.insert(BY, by.to_string()).map_err(loro_error)?;
                map.insert(AT, at).map_err(loro_error)?;
                self.loro().commit();
                return Ok(id);
            }
        }
        let wanted = self.version_of(version)?;
        let frontiers = self.loro().vv_to_frontiers(&wanted);
        let existing = self
            .named_versions()
            .into_iter()
            .find(|named| same_version(&named.version, &wanted))
            .map(|named| named.id);
        let id = existing.unwrap_or_else(VersionId::new_v7);
        let map = self
            .version_map()
            .insert_container(&id.to_string(), LoroMap::new())
            .map_err(loro_error)?;
        map.insert(NAME, name).map_err(loro_error)?;
        map.insert(FRONTIERS, LoroValue::from(frontiers.encode()))
            .map_err(loro_error)?;
        map.insert(BY, by.to_string()).map_err(loro_error)?;
        map.insert(AT, at).map_err(loro_error)?;
        self.loro().commit();
        Ok(id)
    }

    pub fn unname_version(&mut self, version: &str) -> Result<bool, CollabError> {
        self.writable()?;
        let named = self.named_versions();
        let removed: Vec<VersionId> = match version.parse::<VersionId>() {
            Ok(id) if named.iter().any(|named| named.id == id) => vec![id],
            _ => {
                let wanted = self.version_of(version)?;
                named
                    .iter()
                    .filter(|named| same_version(&named.version, &wanted))
                    .map(|named| named.id)
                    .collect()
            }
        };
        for id in &removed {
            self.version_map()
                .delete(&id.to_string())
                .map_err(loro_error)?;
        }
        if !removed.is_empty() {
            self.loro().commit();
        }
        Ok(!removed.is_empty())
    }

    pub fn version_name_of(&self, id: VersionId) -> Option<String> {
        self.named_versions()
            .into_iter()
            .find(|named| named.id == id)
            .map(|named| named.name)
    }

    pub fn version_author(&self, id: VersionId) -> Option<AccountId> {
        match self.version_map().get(&id.to_string()) {
            Some(ValueOrContainer::Container(Container::Map(map))) => match map.get_deep_value() {
                LoroValue::Map(fields) => parsed(fields.get(BY)),
                _ => None,
            },
            _ => None,
        }
    }

    pub(crate) fn restore_text(
        &mut self,
        id: &str,
        content: &str,
    ) -> Result<DocChanges, CollabError> {
        let text = self.text_of(id)?;
        if text.to_string() == content {
            return Ok(DocChanges::default());
        }
        let options = UpdateOptions {
            timeout_ms: Some(RESTORE_TIMEOUT_MS),
            use_refined_diff: true,
        };
        let (done, changes) = self.recording(|doc| {
            if text.update(content, options).is_err() {
                let length = text.len_utf16();
                text.splice_utf16(0, length, content).map_err(loro_error)?;
            }
            doc.commit_with(CommitOptions::new().commit_msg(RESTORE_MESSAGE));
            Ok(())
        });
        done?;
        Ok(changes)
    }

    pub(crate) fn restore_node(&mut self, id: &str) -> Result<(), CollabError> {
        self.loro().set_next_commit_message(RESTORE_MESSAGE);
        self.restore(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::NodeKind;
    use crate::ot::TextOperation;

    fn account(seed: u8) -> AccountId {
        format!("01920000-0000-7000-8000-0000000000{seed:02x}")
            .parse()
            .unwrap()
    }

    fn later(seconds: i64) -> i64 {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        i64::try_from(now).unwrap() + seconds
    }

    fn type_at(doc: &mut ProjectDoc, file: &str, at_seconds: i64, typed: &str) {
        doc.loro().set_next_commit_timestamp(at_seconds);
        let length = doc.text(file).unwrap().encode_utf16().count();
        let mut operation = TextOperation::new();
        operation.retain(length).insert(typed);
        doc.apply_operation(file, &operation).unwrap();
    }

    fn started(at: i64) -> (ProjectDoc, String) {
        let mut doc = ProjectDoc::create().unwrap();
        doc.set_author(&account(1).to_string(), "Owen");
        doc.loro().set_next_commit_timestamp(at);
        let file = doc
            .add_node(None, "main.tex", NodeKind::Text, None, "a")
            .unwrap();
        (doc, file)
    }

    #[test]
    fn changes_group_into_entries_by_time_newest_first() {
        let start = later(0);
        let (mut doc, file) = started(start);
        type_at(&mut doc, &file, start + 100, "b");
        type_at(&mut doc, &file, start + 200, "c");
        type_at(&mut doc, &file, start + 9_000, "d");
        type_at(&mut doc, &file, start + 9_100, "e");
        assert!(doc.text(&file).unwrap() == "abcde");
        let page = doc.history(None, 10);
        assert_eq!(page.entries.len(), 2, "{:?}", page.entries);
        let newest = &page.entries[0];
        assert_eq!(
            (newest.at, newest.until),
            ((start + 9_000) * 1000, (start + 9_100) * 1000)
        );
        assert_eq!(newest.files, vec![file.clone()]);
        assert_eq!(newest.authors, vec![account(1)]);
        let older = &page.entries[1];
        assert!(
            (start * 1000..=(start + 5) * 1000).contains(&older.at),
            "{older:?}"
        );
        assert_eq!(older.until, (start + 200) * 1000);
        assert_eq!(page.next_before, None);
        let first = doc.at_history(&older.id).unwrap();
        assert_eq!(first.text(&file).unwrap(), "abc");
        let latest = doc.at_history(&newest.id).unwrap();
        assert_eq!(latest.text(&file).unwrap(), "abcde");
        let paged = doc.history(None, 1);
        assert_eq!(paged.entries.len(), 1);
        assert_eq!(paged.next_before.as_deref(), Some(newest.id.as_str()));
        let rest = doc.history(paged.next_before.as_deref(), 1);
        assert_eq!(rest.entries, vec![older.clone()]);
        assert_eq!(rest.next_before, None);
    }

    #[test]
    fn changes_made_before_times_were_kept_collapse_into_one_entry() {
        let raw = loro::LoroDoc::new();
        raw.set_peer_id(7).unwrap();
        let tree = raw.get_tree("tree");
        tree.enable_fractional_index(0);
        let trash = tree.create(loro::TreeParentId::Root).unwrap();
        let meta = tree.get_meta(trash).unwrap();
        meta.insert("id", crate::doc::TRASH_ID).unwrap();
        meta.insert("name", crate::doc::TRASH_ID).unwrap();
        meta.insert("kind", "dir").unwrap();
        let node = tree.create(loro::TreeParentId::Root).unwrap();
        let meta = tree.get_meta(node).unwrap();
        let file = oleafly_collab_protocol::ids::FileId::new_v7().to_string();
        meta.insert("id", file.as_str()).unwrap();
        meta.insert("name", "main.tex").unwrap();
        meta.insert("kind", "text").unwrap();
        raw.commit();
        raw.get_text(format!("text:{file}"))
            .insert(0, "old")
            .unwrap();
        raw.commit();
        let mut doc = ProjectDoc::load(&raw.export(loro::ExportMode::Snapshot).unwrap()).unwrap();
        doc.set_author(&account(1).to_string(), "Owen");
        let at = later(0);
        type_at(&mut doc, &file, at, "!");
        let page = doc.history(None, 10);
        assert_eq!(page.entries.len(), 2, "{:?}", page.entries);
        assert_eq!((page.entries[1].at, page.entries[1].until), (0, 0));
        assert_eq!(page.entries[0].at, at * 1000);
        let before = doc.at_history(&page.entries[1].id).unwrap();
        assert_eq!(before.text(&file).unwrap(), "old");
    }

    #[test]
    fn a_named_version_ends_its_entry_and_can_be_renamed_or_unnamed() {
        let start = later(0);
        let (mut doc, file) = started(start);
        type_at(&mut doc, &file, start + 10, "b");
        let before = doc.current_version_id();
        let id = doc
            .name_version(&before, "  First draft ", account(1), 5)
            .unwrap();
        type_at(&mut doc, &file, start + 20, "c");
        let page = doc.history(None, 10);
        assert_eq!(page.entries.len(), 2, "{:?}", page.entries);
        assert_eq!(page.entries[1].name.as_deref(), Some("First draft"));
        assert_eq!(page.entries[1].version_id, Some(id));
        assert_eq!(page.entries[1].id, before);
        let again = doc
            .name_version(&before, "Draft one", account(1), 6)
            .unwrap();
        assert_eq!(again, id);
        assert_eq!(doc.version_name_of(id).as_deref(), Some("Draft one"));
        let renamed = doc
            .name_version(&id.to_string(), "Draft two", account(1), 7)
            .unwrap();
        assert_eq!(renamed, id);
        assert_eq!(doc.version_name_of(id).as_deref(), Some("Draft two"));
        assert!(doc.unname_version(&id.to_string()).unwrap());
        assert!(!doc.unname_version(&before).unwrap());
        assert!(doc
            .history(None, 10)
            .entries
            .iter()
            .all(|entry| entry.name.is_none()));
        assert!(matches!(
            doc.name_version(&before, " ", account(1), 7),
            Err(CollabError::Api { code, .. }) if code == "empty"
        ));
        assert!(matches!(
            doc.name_version("not-a-version", "x", account(1), 7),
            Err(CollabError::Api { code, .. }) if code == "history_unavailable"
        ));
    }

    #[test]
    fn a_restored_text_starts_its_own_entry() {
        let start = later(0);
        let (mut doc, file) = started(start);
        type_at(&mut doc, &file, start + 10, "b");
        let version = doc.current_version_id();
        type_at(&mut doc, &file, start + 20, "c");
        let old = doc.at_history(&version).unwrap();
        doc.loro().set_next_commit_timestamp(start + 30);
        let changes = doc.restore_text(&file, &old.text(&file).unwrap()).unwrap();
        assert!(!changes.is_empty());
        assert_eq!(doc.text(&file).unwrap(), "ab");
        let page = doc.history(None, 10);
        assert_eq!(page.entries.len(), 2, "{:?}", page.entries);
        let restored = doc.at_history(&page.entries[1].id).unwrap();
        assert_eq!(restored.text(&file).unwrap(), "abc");
    }
}
