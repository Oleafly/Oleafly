use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use loro::{Frontiers, LoroMap, LoroValue, TreeID, TreeParentId, ValueOrContainer, VersionVector};
use oleafly_collab_protocol::ids::AccountId;

use super::{doc_error, meta_string, NodeKind, NodeParent, ProjectDoc, TRASH_ID};
use crate::CollabError;

const RENAME_WINDOW: Duration = Duration::from_secs(5 * 60);
const TRASH_KEYS: [&str; 3] = ["trashed_from", "trashed_at", "trashed_by"];

#[derive(Clone, Debug)]
struct Author {
    account: String,
    name: String,
}

#[derive(Clone, Debug)]
struct LocalRename {
    id: String,
    before: String,
    name: String,
    at: Instant,
}

#[derive(Debug, Default)]
pub(super) struct TreeLog {
    author: Option<Author>,
    renames: Mutex<Vec<LocalRename>>,
    unsettled: AtomicBool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Trashed {
    pub id: String,
    pub name: String,
    pub kind: NodeKind,
    pub folder_id: Option<String>,
    pub folder: Option<String>,
    pub deleted_by: Option<String>,
    pub deleted_at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LostRename {
    pub id: String,
    pub before: String,
    pub ours: String,
    pub theirs: String,
    pub by: Option<String>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

fn meta_number(meta: &LoroMap, key: &str) -> Option<i64> {
    match meta.get(key) {
        Some(ValueOrContainer::Value(LoroValue::I64(value))) => Some(value),
        Some(ValueOrContainer::Value(LoroValue::Double(value))) if value.is_finite() => {
            Some(value as i64)
        }
        _ => None,
    }
}

impl TreeLog {
    fn renames(&self) -> std::sync::MutexGuard<'_, Vec<LocalRename>> {
        self.renames.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(super) fn created(&self, meta: &LoroMap) -> Result<(), CollabError> {
        let Some(author) = &self.author else {
            return Ok(());
        };
        meta.insert("author", author.account.as_str())
            .map_err(doc_error)?;
        if !author.name.is_empty() {
            meta.insert("author_name", author.name.as_str())
                .map_err(doc_error)?;
        }
        Ok(())
    }

    pub(super) fn renaming(&self, id: &str, meta: &LoroMap, name: &str) -> Result<(), CollabError> {
        let before = meta_string(meta, "name").unwrap_or_default();
        if before != name {
            let mut renames = self.renames();
            renames.retain(|rename| rename.id != id);
            renames.push(LocalRename {
                id: id.to_owned(),
                before,
                name: name.to_owned(),
                at: Instant::now(),
            });
        }
        if let Some(author) = &self.author {
            meta.insert("renamed_by", author.account.as_str())
                .map_err(doc_error)?;
        }
        Ok(())
    }

    pub(super) fn tree_changed(&self) {
        self.unsettled.store(true, Ordering::SeqCst);
    }
}

impl ProjectDoc {
    pub fn set_author(&mut self, account: &str, name: &str) {
        self.log.author = Some(Author {
            account: account.to_owned(),
            name: name.trim().to_owned(),
        });
    }

    pub fn author_account(&self) -> Option<AccountId> {
        self.log
            .author
            .as_ref()
            .and_then(|author| author.account.parse().ok())
    }

    pub fn author_key(&self) -> Option<&str> {
        self.log
            .author
            .as_ref()
            .map(|author| author.account.as_str())
    }

    pub fn author_name(&self) -> Option<&str> {
        self.log
            .author
            .as_ref()
            .map(|author| author.name.as_str())
            .filter(|name| !name.is_empty())
    }

    pub fn take_unsettled(&self) -> bool {
        self.log.unsettled.swap(false, Ordering::SeqCst)
    }

    pub(super) fn stamp_trashed(&self, node: TreeID) -> Result<(), CollabError> {
        if !self.alive(node) {
            return Ok(());
        }
        let meta = self.tree.get_meta(node).map_err(doc_error)?;
        let from = match self.tree.parent(node) {
            Some(TreeParentId::Node(parent)) => {
                meta_string(&self.tree.get_meta(parent).map_err(doc_error)?, "id")
                    .unwrap_or_default()
            }
            _ => String::new(),
        };
        meta.insert("trashed_from", from).map_err(doc_error)?;
        meta.insert("trashed_at", now_ms()).map_err(doc_error)?;
        match &self.log.author {
            Some(author) => meta
                .insert("trashed_by", author.account.as_str())
                .map_err(doc_error)?,
            None if meta.get("trashed_by").is_some() => {
                meta.delete("trashed_by").map_err(doc_error)?;
            }
            None => {}
        }
        Ok(())
    }

    fn alive(&self, node: TreeID) -> bool {
        let mut current = node;
        for _ in 0..=self.ids.len() + 1 {
            match self.tree.parent(current) {
                Some(TreeParentId::Root) => return true,
                Some(TreeParentId::Node(parent))
                    if Some(parent) == self.trash || self.is_trash_folder(parent) =>
                {
                    return false
                }
                Some(TreeParentId::Node(parent)) => current = parent,
                _ => return false,
            }
        }
        false
    }

    fn is_trash_folder(&self, node: TreeID) -> bool {
        self.tree
            .get_meta(node)
            .ok()
            .and_then(|meta| meta_string(&meta, "id"))
            .is_some_and(|id| id == TRASH_ID)
    }

    fn name_path(&self, id: &str) -> Option<String> {
        let mut names = Vec::new();
        let mut current = *self.ids.get(id)?;
        for _ in 0..=self.ids.len() {
            let meta = self.tree.get_meta(current).ok()?;
            names.push(meta_string(&meta, "name").unwrap_or_default());
            match self.tree.parent(current) {
                Some(TreeParentId::Node(parent)) if Some(parent) != self.trash => {
                    current = parent;
                }
                _ => break,
            }
        }
        names.reverse();
        Some(names.join("/"))
    }

    pub fn trashed(&self) -> Result<Vec<Trashed>, CollabError> {
        let mut items = Vec::new();
        for node in self.nodes()? {
            if node.parent != NodeParent::Trash {
                continue;
            }
            let meta = self
                .tree
                .get_meta(self.tree_id(&node.id)?)
                .map_err(doc_error)?;
            let folder_id = meta_string(&meta, "trashed_from")
                .filter(|folder| !folder.is_empty() && self.ids.contains_key(folder));
            items.push(Trashed {
                folder: folder_id
                    .as_deref()
                    .and_then(|folder| self.name_path(folder)),
                folder_id,
                deleted_by: meta_string(&meta, "trashed_by"),
                deleted_at: meta_number(&meta, "trashed_at"),
                id: node.id,
                name: node.name,
                kind: node.kind,
            });
        }
        items.sort_by(|left, right| {
            right
                .deleted_at
                .cmp(&left.deleted_at)
                .then_with(|| left.name.cmp(&right.name))
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(items)
    }

    pub fn restore(&mut self, id: &str) -> Result<(), CollabError> {
        let node = self.tree_id(id)?;
        if self.alive(node) {
            return Ok(());
        }
        let meta = self.tree.get_meta(node).map_err(doc_error)?;
        let target = meta_string(&meta, "trashed_from")
            .and_then(|folder| self.ids.get(&folder).copied())
            .filter(|folder| self.alive(*folder))
            .map_or(TreeParentId::Root, TreeParentId::Node);
        self.tree.mov(node, target).map_err(doc_error)?;
        for key in TRASH_KEYS {
            if meta.get(key).is_some() {
                meta.delete(key).map_err(doc_error)?;
            }
        }
        self.doc.commit();
        Ok(())
    }

    pub fn trash_seen(&self, id: &str) -> Option<VersionVector> {
        let node = *self.ids.get(id)?;
        if self.alive(node) {
            return None;
        }
        let moved = self.tree.get_last_move_id(&node)?;
        self.doc.frontiers_to_vv(&Frontiers::from_id(moved))
    }

    pub fn lost_renames(&self) -> Vec<LostRename> {
        let own = self
            .log
            .author
            .as_ref()
            .map(|author| author.account.as_str());
        let mut lost = Vec::new();
        let mut renames = self.log.renames();
        renames.retain(|rename| {
            if rename.at.elapsed() > RENAME_WINDOW {
                return false;
            }
            let Some(meta) = self
                .ids
                .get(&rename.id)
                .and_then(|node| self.tree.get_meta(*node).ok())
            else {
                return false;
            };
            let current = meta_string(&meta, "name").unwrap_or_default();
            if current == rename.name {
                return true;
            }
            let by = meta_string(&meta, "renamed_by");
            if by.is_none() || by.as_deref() != own {
                lost.push(LostRename {
                    id: rename.id.clone(),
                    before: rename.before.clone(),
                    ours: rename.name.clone(),
                    theirs: current,
                    by,
                });
            }
            false
        });
        lost
    }

    pub fn merge_identical_blobs(&mut self) -> Result<usize, CollabError> {
        let duplicates = crate::materialize::duplicate_blobs(&self.nodes()?);
        for id in &duplicates {
            let node = self.tree_id(id)?;
            self.tree.delete(node).map_err(doc_error)?;
            self.ids.remove(id);
        }
        if !duplicates.is_empty() {
            self.doc.commit();
        }
        Ok(duplicates.len())
    }

    #[cfg(test)]
    fn age_renames(&self, by: Duration) {
        for rename in self.log.renames().iter_mut() {
            rename.at = rename.at.checked_sub(by).unwrap_or(rename.at);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::materialize::layout;

    const ALICE: &str = "acct-alice";
    const BOB: &str = "acct-bob";

    fn signed(doc: &mut ProjectDoc, account: &str, name: &str) {
        doc.set_author(account, name);
    }

    fn pair() -> (ProjectDoc, ProjectDoc) {
        let mut alice = ProjectDoc::create().unwrap();
        signed(&mut alice, ALICE, "Alice Chen");
        let mut bob = ProjectDoc::load(&alice.snapshot().unwrap()).unwrap();
        signed(&mut bob, BOB, "Bob Smith");
        (alice, bob)
    }

    fn exchange(left: &mut ProjectDoc, right: &mut ProjectDoc) {
        let left_base = right.version();
        let right_base = left.version();
        let from_left = left.export_since(&left_base).unwrap();
        let from_right = right.export_since(&right_base).unwrap();
        right.import(&from_left).unwrap();
        left.import(&from_right).unwrap();
    }

    fn sync(from: &ProjectDoc, to: &mut ProjectDoc) {
        to.import(&from.export_since(&to.version()).unwrap())
            .unwrap();
    }

    fn paths(doc: &ProjectDoc) -> Vec<String> {
        let mut paths: Vec<String> = layout(&doc.nodes().unwrap())
            .into_values()
            .map(|placed| placed.path)
            .collect();
        paths.sort();
        paths
    }

    fn parent_of(doc: &ProjectDoc, id: &str) -> NodeParent {
        doc.nodes()
            .unwrap()
            .into_iter()
            .find(|node| node.id == id)
            .unwrap()
            .parent
    }

    #[test]
    fn a_new_node_records_who_created_it() {
        let (mut alice, _bob) = pair();
        let id = alice
            .add_node(None, "plot.png", NodeKind::Blob, Some("h1"), "")
            .unwrap();
        let meta = alice.tree.get_meta(alice.tree_id(&id).unwrap()).unwrap();
        assert_eq!(meta_string(&meta, "author").as_deref(), Some(ALICE));
        let node = alice
            .nodes()
            .unwrap()
            .into_iter()
            .find(|node| node.id == id);
        assert_eq!(node.unwrap().author_name.as_deref(), Some("Alice Chen"));
        let mut anonymous = ProjectDoc::create().unwrap();
        let unsigned = anonymous
            .add_node(None, "a.tex", NodeKind::Text, None, "")
            .unwrap();
        let meta = anonymous
            .tree
            .get_meta(anonymous.tree_id(&unsigned).unwrap())
            .unwrap();
        assert_eq!(meta_string(&meta, "author"), None);
    }

    #[test]
    fn a_deleted_file_is_listed_and_restored_to_its_old_folder_for_everyone() {
        let (mut alice, mut bob) = pair();
        let chapters = alice
            .add_node(None, "chapters", NodeKind::Dir, None, "")
            .unwrap();
        let intro = alice
            .add_node(Some(&chapters), "intro.tex", NodeKind::Text, None, "Intro")
            .unwrap();
        let before = now_ms();
        alice.trash(&intro).unwrap();
        sync(&alice, &mut bob);
        let listed = bob.trashed().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, intro);
        assert_eq!(listed[0].name, "intro.tex");
        assert_eq!(listed[0].kind, NodeKind::Text);
        assert_eq!(listed[0].folder.as_deref(), Some("chapters"));
        assert_eq!(listed[0].folder_id.as_deref(), Some(chapters.as_str()));
        assert_eq!(listed[0].deleted_by.as_deref(), Some(ALICE));
        assert!(listed[0].deleted_at.is_some_and(|at| at >= before));
        bob.restore(&intro).unwrap();
        assert_eq!(parent_of(&bob, &intro), NodeParent::Node(chapters.clone()));
        assert!(bob.trashed().unwrap().is_empty());
        sync(&bob, &mut alice);
        assert_eq!(paths(&alice), vec!["chapters", "chapters/intro.tex"]);
        assert_eq!(alice.text(&intro).unwrap(), "Intro");
        alice.trash(&intro).unwrap();
        let again = alice.trashed().unwrap();
        assert_eq!(again[0].deleted_by.as_deref(), Some(ALICE));
    }

    #[test]
    fn a_file_whose_folder_is_gone_comes_back_at_the_top() {
        let (mut alice, _bob) = pair();
        let chapters = alice
            .add_node(None, "chapters", NodeKind::Dir, None, "")
            .unwrap();
        let intro = alice
            .add_node(Some(&chapters), "intro.tex", NodeKind::Text, None, "Intro")
            .unwrap();
        alice.trash(&intro).unwrap();
        std::thread::sleep(Duration::from_millis(3));
        alice.trash(&chapters).unwrap();
        let listed: Vec<String> = alice
            .trashed()
            .unwrap()
            .into_iter()
            .map(|item| item.id)
            .collect();
        assert_eq!(listed, vec![chapters.clone(), intro.clone()]);
        alice.restore(&intro).unwrap();
        assert_eq!(parent_of(&alice, &intro), NodeParent::Root);
        assert_eq!(paths(&alice), vec!["intro.tex"]);
        alice.restore(&intro).unwrap();
        assert_eq!(parent_of(&alice, &intro), NodeParent::Root);
    }

    #[test]
    fn a_restored_file_whose_name_was_taken_is_named_for_its_creator() {
        let (mut alice, _bob) = pair();
        let chapters = alice
            .add_node(None, "chapters", NodeKind::Dir, None, "")
            .unwrap();
        let old = alice
            .add_node(Some(&chapters), "intro.tex", NodeKind::Text, None, "old")
            .unwrap();
        alice.trash(&old).unwrap();
        let new = alice
            .add_node(Some(&chapters), "Intro.tex", NodeKind::Text, None, "new")
            .unwrap();
        alice.restore(&old).unwrap();
        let placed = layout(&alice.nodes().unwrap());
        assert_eq!(placed[&new].path, "chapters/Intro.tex");
        assert_eq!(placed[&old].path, "chapters/intro (from Alice Chen).tex");
    }

    #[test]
    fn two_people_adding_different_figures_with_the_same_name_keep_both() {
        let (mut alice, mut bob) = pair();
        let figs = alice
            .add_node(None, "figs", NodeKind::Dir, None, "")
            .unwrap();
        sync(&alice, &mut bob);
        let from_alice = alice
            .add_node(Some(&figs), "plot.png", NodeKind::Blob, Some("aaa"), "")
            .unwrap();
        let from_bob = bob
            .add_node(Some(&figs), "plot.png", NodeKind::Blob, Some("bbb"), "")
            .unwrap();
        exchange(&mut alice, &mut bob);
        let placed = layout(&alice.nodes().unwrap());
        assert_eq!(placed, layout(&bob.nodes().unwrap()));
        assert_eq!(placed[&from_alice].blob.as_deref(), Some("aaa"));
        assert_eq!(placed[&from_bob].blob.as_deref(), Some("bbb"));
        let mut got = vec![
            placed[&from_alice].path.clone(),
            placed[&from_bob].path.clone(),
        ];
        got.sort();
        let later_is_bob = placed[&from_alice].path == "figs/plot.png";
        let credited = if later_is_bob {
            "figs/plot (from Bob Smith).png"
        } else {
            "figs/plot (from Alice Chen).png"
        };
        let mut want = vec!["figs/plot.png".to_owned(), credited.to_owned()];
        want.sort();
        assert_eq!(got, want);
        assert_eq!(alice.merge_identical_blobs().unwrap(), 0);
    }

    #[test]
    fn identical_figures_added_by_two_people_merge_into_one() {
        let (mut alice, mut bob) = pair();
        let figs = alice
            .add_node(None, "figs", NodeKind::Dir, None, "")
            .unwrap();
        sync(&alice, &mut bob);
        alice
            .add_node(Some(&figs), "plot.png", NodeKind::Blob, Some("same"), "")
            .unwrap();
        bob.add_node(Some(&figs), "plot.png", NodeKind::Blob, Some("same"), "")
            .unwrap();
        exchange(&mut alice, &mut bob);
        assert_eq!(paths(&alice).len(), 3);
        assert_eq!(alice.merge_identical_blobs().unwrap(), 1);
        assert_eq!(bob.merge_identical_blobs().unwrap(), 1);
        exchange(&mut alice, &mut bob);
        assert_eq!(paths(&alice), vec!["figs", "figs/plot.png"]);
        assert_eq!(paths(&bob), paths(&alice));
        assert!(alice.trashed().unwrap().is_empty());
        let reloaded = ProjectDoc::load(&alice.snapshot().unwrap()).unwrap();
        assert_eq!(paths(&reloaded), paths(&alice));
    }

    #[test]
    fn a_replaced_figure_remembers_what_it_replaced_and_who_put_each_version_in() {
        let (mut alice, mut bob) = pair();
        let plot = alice
            .add_node(None, "plot.png", NodeKind::Blob, Some("h0"), "")
            .unwrap();
        sync(&alice, &mut bob);
        alice.set_blob(&plot, "hA").unwrap();
        bob.set_blob(&plot, "hB").unwrap();
        exchange(&mut alice, &mut bob);
        let current = layout(&alice.nodes().unwrap())[&plot].blob.clone().unwrap();
        assert_eq!(
            layout(&bob.nodes().unwrap())[&plot].blob,
            Some(current.clone())
        );
        assert_eq!(alice.blob_was(&plot).as_deref(), Some("h0"));
        assert_eq!(alice.blob_setter(&plot, "hA").as_deref(), Some(ALICE));
        assert_eq!(alice.blob_setter(&plot, "hB").as_deref(), Some(BOB));
        bob.set_blob(&plot, "hC").unwrap();
        sync(&bob, &mut alice);
        assert_eq!(alice.blob_was(&plot), Some(current));
        assert_eq!(alice.blob_setter(&plot, "hC").as_deref(), Some(BOB));
        assert_eq!(alice.blob_setter(&plot, "hA"), None);
        assert_eq!(alice.blob_setter(&plot, "hB"), None);
        assert_eq!(alice.author_of(&plot).as_deref(), Some(ALICE));
        assert_eq!(bob.author_name(), Some("Bob Smith"));
    }

    #[test]
    fn a_rename_that_loses_to_someone_elses_is_reported_once_on_the_losing_side() {
        let (mut alice, mut bob) = pair();
        let intro = alice
            .add_node(None, "intro.tex", NodeKind::Text, None, "x")
            .unwrap();
        sync(&alice, &mut bob);
        assert!(bob.take_unsettled());
        assert!(!bob.take_unsettled());
        alice.rename(&intro, "background.tex").unwrap();
        bob.rename(&intro, "overview.tex").unwrap();
        exchange(&mut alice, &mut bob);
        let alice_unsettled = alice.take_unsettled();
        let bob_unsettled = bob.take_unsettled();
        let from_alice = alice.lost_renames();
        let from_bob = bob.lost_renames();
        let winner = alice
            .nodes()
            .unwrap()
            .into_iter()
            .find(|node| node.id == intro);
        if winner.unwrap().name == "background.tex" {
            assert!(bob_unsettled);
            assert!(from_alice.is_empty());
            assert_eq!(
                from_bob,
                vec![LostRename {
                    id: intro.clone(),
                    before: "intro.tex".to_owned(),
                    ours: "overview.tex".to_owned(),
                    theirs: "background.tex".to_owned(),
                    by: Some(ALICE.to_owned()),
                }]
            );
        } else {
            assert!(alice_unsettled);
            assert!(from_bob.is_empty());
            assert_eq!(
                from_alice,
                vec![LostRename {
                    id: intro.clone(),
                    before: "intro.tex".to_owned(),
                    ours: "background.tex".to_owned(),
                    theirs: "overview.tex".to_owned(),
                    by: Some(BOB.to_owned()),
                }]
            );
        }
        assert!(alice.lost_renames().is_empty());
        assert!(bob.lost_renames().is_empty());
    }

    #[test]
    fn an_old_rename_or_one_by_yourself_elsewhere_is_not_reported() {
        let (mut alice, mut bob) = pair();
        let intro = alice
            .add_node(None, "intro.tex", NodeKind::Text, None, "x")
            .unwrap();
        sync(&alice, &mut bob);
        bob.rename(&intro, "overview.tex").unwrap();
        bob.age_renames(RENAME_WINDOW + Duration::from_secs(1));
        sync(&bob, &mut alice);
        alice.rename(&intro, "background.tex").unwrap();
        sync(&alice, &mut bob);
        assert_eq!(bob.nodes().unwrap()[0].name, "background.tex");
        assert!(bob.lost_renames().is_empty());
        let mut laptop = ProjectDoc::load(&alice.snapshot().unwrap()).unwrap();
        signed(&mut laptop, ALICE, "Alice Chen");
        laptop.rename(&intro, "laptop.tex").unwrap();
        alice.rename(&intro, "desktop.tex").unwrap();
        exchange(&mut alice, &mut laptop);
        assert!(alice.lost_renames().is_empty());
        assert!(laptop.lost_renames().is_empty());
    }
}
