use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;

use oleafly_collab::doc::{NodeKind, NodeParent, Trashed};
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize::{self, Layout, Placed};
use oleafly_collab::{load_binding, CollabError};

pub use oleafly_live::live::moves::*;

use super::super::disk::DiskState;
use super::super::state::CollabState;
use super::{
    active_for, by_path, ensure_dir, guard, live_for, lock, name_of, parent_of, Active, Live,
    LocalImport, WrittenTexts,
};

pub const LIVE_REMOVED_EVENT: &str = "collab-live-removed";
pub(super) fn adopt_move(
    live: &mut LiveProject,
    disk: &mut DiskState,
    bases: &mut WrittenTexts,
    from: &str,
    to: &str,
) -> Result<bool, CollabError> {
    if from == to {
        return Ok(false);
    }
    let Some(id) = on_disk(disk, live, from)? else {
        return Ok(false);
    };
    let nodes = live.doc().nodes()?;
    let Some(node) = nodes.iter().find(|node| node.id == id).cloned() else {
        return Ok(false);
    };
    let mut placed = by_path(&materialize::layout(&nodes));
    let folded = to.to_lowercase();
    let replaced = placed
        .iter()
        .find(|(path, (other, _, _))| path.to_lowercase() == folded && *other != id)
        .map(|(path, (other, _, _))| (path.clone(), other.clone()));
    if let Some((path, other)) = &replaced {
        live.doc_mut().trash(other)?;
        placed.retain(|known, _| !covers(path, known));
        forget_under(disk, bases, path);
    }
    let known: BTreeSet<String> = placed.keys().cloned().collect();
    let parent = ensure_dir(live, &mut placed, parent_of(to))?;
    let current = match &node.parent {
        NodeParent::Node(parent) => Some(parent.clone()),
        NodeParent::Root | NodeParent::Trash => None,
    };
    if current != parent || node.parent == NodeParent::Trash {
        live.doc_mut().move_to(&id, parent.as_deref())?;
    }
    if node.name != name_of(to) {
        live.doc_mut().rename(&id, name_of(to))?;
    }
    for (path, (dir, kind, _)) in &placed {
        if *kind == NodeKind::Dir && !known.contains(path) {
            disk.layout.insert(
                dir.clone(),
                Placed {
                    path: path.clone(),
                    kind: NodeKind::Dir,
                    blob: None,
                },
            );
        }
    }
    for placed in disk.layout.values_mut() {
        if covers(from, &placed.path) {
            placed.path = moved_to(from, to, &placed.path);
        }
    }
    disk.hashes = std::mem::take(&mut disk.hashes)
        .into_iter()
        .map(|(path, hash)| {
            if covers(from, &path) {
                (moved_to(from, to, &path), hash)
            } else {
                (path, hash)
            }
        })
        .collect();
    let written: Vec<String> = bases
        .texts
        .keys()
        .filter(|path| covers(from, path))
        .cloned()
        .collect();
    for path in written {
        bases.rename(&path, &moved_to(from, to, &path));
    }
    Ok(true)
}

pub(super) fn adopt_removal(
    live: &mut LiveProject,
    disk: &mut DiskState,
    bases: &mut WrittenTexts,
    path: &str,
) -> Result<Option<String>, CollabError> {
    let Some(id) = on_disk(disk, live, path)? else {
        return Ok(None);
    };
    live.doc_mut().trash(&id)?;
    forget_under(disk, bases, path);
    Ok(Some(id))
}

pub(super) fn adopt_folder_moves(
    live: &mut LiveProject,
    disk: &mut DiskState,
    bases: &mut WrittenTexts,
    import: &mut LocalImport,
) -> Result<bool, CollabError> {
    if import.removed.is_empty() || import.dirs.is_empty() {
        return Ok(false);
    }
    let placed = by_path(&materialize::layout(&live.doc().nodes()?));
    let arrived = arrived_paths(import);
    let mut moved = false;
    for old in outermost_gone_dirs(import, &placed) {
        let Some(new) = folder_arrival(&import.dirs, &arrived, disk, &old) else {
            continue;
        };
        let Some((id, _, _)) = placed.get(&old) else {
            continue;
        };
        if !adopt_move(live, disk, bases, &old, &new)? {
            continue;
        }
        import.moved_dirs.push((id.clone(), new.clone()));
        took_folder_move(import, disk, &old, &new);
        moved = true;
    }
    if moved {
        let now = by_path(&materialize::layout(&live.doc().nodes()?));
        import.dirs.retain(|path| {
            !now.contains_key(path) && !disk.layout.values().any(|placed| placed.path == *path)
        });
    }
    Ok(moved)
}

pub(super) fn removed_notices(
    project_id: &str,
    live: &mut LiveProject,
    previous: &Layout,
    removed: &[String],
) -> Option<RemovedPayload> {
    let trashed: HashMap<String, Trashed> = live
        .doc()
        .trashed()
        .ok()?
        .into_iter()
        .map(|item| (item.id.clone(), item))
        .collect();
    let mut files = Vec::new();
    for path in removed {
        let Some((id, placed)) = previous.iter().find(|(_, placed)| placed.path == *path) else {
            continue;
        };
        let Some(item) = trashed.get(id) else {
            continue;
        };
        let texts: Vec<String> = previous
            .iter()
            .filter(|(_, inside)| inside.kind == NodeKind::Text && covers(path, &inside.path))
            .map(|(text, _)| text.clone())
            .collect();
        let mut yours = false;
        for text in texts {
            yours |= live.take_offline_loss(&text);
        }
        files.push(RemovedFile {
            path: path.clone(),
            id: id.clone(),
            kind: placed.kind,
            by: item.deleted_by.clone(),
            yours,
            copy: None,
        });
    }
    (!files.is_empty()).then(|| RemovedPayload {
        project_id: project_id.to_owned(),
        files,
        restored: Vec::new(),
    })
}

fn notices_in(state: &CollabState, project_id: &str) -> Result<PathBuf, CollabError> {
    if let Some(live) = live_for(project_id) {
        return Ok(live.local().notices_file());
    }
    let paths = state.paths()?;
    if load_binding(paths, project_id)?.is_none() {
        if let Some(link) =
            crate::overleaf::overleaf_link_of(project_id).map_err(CollabError::Io)?
        {
            let data = crate::paths::oleafly_root().map_err(CollabError::Io)?;
            return Ok(super::overleaf::mirror_dir(&data, &link, project_id)?.join(NOTICES_FILE));
        }
    }
    Ok(paths.project_dir(project_id)?.join(NOTICES_FILE))
}

pub(crate) fn lost_notices(
    state: &CollabState,
    project_id: &str,
) -> Result<Vec<RemovedFile>, CollabError> {
    Ok(remembered(&notices_in(state, project_id)?))
}

pub(crate) fn dismiss_notice(
    state: &CollabState,
    project_id: &str,
    id: &str,
) -> Result<(), CollabError> {
    if let Err(line) = forget_notice(&notices_in(state, project_id)?, id) {
        let _ = crate::project::append_app_log(line);
    }
    Ok(())
}

pub(crate) fn restored(project_id: &str, id: &str) {
    if let Some(active) = active_for(project_id) {
        if let Err(line) = forget_notice(&active.local.notices_file(), id) {
            active.local.log(line);
        }
    }
}

impl Active {
    pub(super) fn announce_removed(&self, previous: &Layout, removed: &[String]) {
        let told = if removed.is_empty() {
            None
        } else {
            removed_notices(
                &self.local.project_id,
                &mut lock(&self.live),
                previous,
                removed,
            )
        };
        self.local.tell_removed(previous, told);
    }

    fn settle_structure(&self) {
        let _ = self.local.save_index(&guard(&self.local.disk));
        self.handle.flush();
        self.kick();
        self.refresh_pending();
    }

    fn adopting<R>(
        &self,
        work: impl FnOnce() -> Result<R, String>,
        adopt: impl FnOnce(
            &R,
            &mut LiveProject,
            &mut DiskState,
            &mut WrittenTexts,
        ) -> Result<bool, CollabError>,
    ) -> Result<R, String> {
        if !lock(&self.live).can_edit() {
            return work();
        }
        let (outcome, adopted) = {
            let mut disk = guard(&self.local.disk);
            let outcome = work()?;
            let mut live = lock(&self.live);
            let mut bases = guard(&self.local.bases);
            let adopted = match adopt(&outcome, &mut live, &mut disk, &mut bases) {
                Ok(adopted) => adopted,
                Err(error) => {
                    let _ = crate::project::append_app_log(format!(
                        "Live collaboration could not apply a file move or delete in project {}: {error}",
                        self.local.project_id
                    ));
                    false
                }
            };
            (outcome, adopted)
        };
        if adopted {
            self.settle_structure();
        }
        Ok(outcome)
    }

    pub(super) fn rename_with<R>(
        &self,
        from: &str,
        work: impl FnOnce() -> Result<R, String>,
        landed: impl FnOnce(&R) -> Option<String>,
    ) -> Result<R, String> {
        self.adopting(work, |outcome, live, disk, bases| {
            let Some(to) = landed(outcome) else {
                return Ok(false);
            };
            let inside = paths_under(disk, from);
            let adopted = adopt_move(live, disk, bases, from, &to)?;
            if adopted {
                for path in inside {
                    self.local.note_own(&path, false);
                    self.local.note_own(&moved_to(from, &to, &path), true);
                }
            }
            Ok(adopted)
        })
    }

    pub(super) fn delete_with<R>(
        &self,
        path: &str,
        work: impl FnOnce() -> Result<R, String>,
    ) -> Result<R, String> {
        self.adopting(work, |_, live, disk, bases| {
            let inside = paths_under(disk, path);
            let adopted = adopt_removal(live, disk, bases, path)?.is_some();
            if adopted {
                for gone in inside {
                    self.local.note_own(&gone, false);
                }
            }
            Ok(adopted)
        })
    }
}

pub(crate) fn renaming<R>(
    project_id: &str,
    from: &str,
    work: impl FnOnce() -> Result<R, String>,
    landed: impl FnOnce(&R) -> Option<String>,
) -> Result<R, String> {
    match live_for(project_id) {
        Some(Live::Server(active)) => active.rename_with(from, work, landed),
        Some(Live::Overleaf(live)) => live.rename_with(from, work, landed),
        None => work(),
    }
}

pub(crate) fn deleting<R>(
    project_id: &str,
    path: &str,
    work: impl FnOnce() -> Result<R, String>,
) -> Result<R, String> {
    match live_for(project_id) {
        Some(Live::Server(active)) => active.delete_with(path, work),
        Some(live @ Live::Overleaf(_)) => {
            let outcome = work()?;
            live.import_later(Some(vec![path.to_owned()]));
            Ok(outcome)
        }
        None => work(),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};

    use oleafly_collab::doc::ProjectDoc;
    use oleafly_collab::sync::{spawn_live, LiveLink, SharedLive};
    use oleafly_collab::{ServerClient, ServerUrl};
    use oleafly_collab_protocol::ids::{AccountId, DeviceId, ServerId, SharedProjectId};
    use oleafly_collab_protocol::projects::ProjectRole;
    use oleafly_ot::{DocMessage, DocSink, TextOperation};
    use tokio::sync::mpsc;

    use super::super::super::disk::{exists_exact, move_path, sha256_hex};
    use super::super::{
        apply_local_import, apply_to_disk, initial_bases, read_local_changes, DiskPass, LiveDisk,
        LiveHost,
    };
    use super::*;
    use crate::collab::state::CollabState;
    use crate::collab::tree::{trash_list, trash_restore};

    struct Peer {
        dir: tempfile::TempDir,
        root: PathBuf,
        live: LiveProject,
        disk: DiskState,
        bases: WrittenTexts,
        seq: u64,
    }

    fn parent_id(
        doc: &mut ProjectDoc,
        made: &mut BTreeMap<String, String>,
        path: &str,
    ) -> Option<String> {
        let (parent, _) = path.rsplit_once('/')?;
        if let Some(id) = made.get(parent) {
            return Some(id.clone());
        }
        let above = parent_id(doc, made, parent);
        let name = parent.rsplit_once('/').map_or(parent, |(_, name)| name);
        let id = doc
            .add_node(above.as_deref(), name, NodeKind::Dir, None, "")
            .unwrap();
        made.insert(parent.to_owned(), id.clone());
        Some(id)
    }

    impl Peer {
        fn first(account: &str, files: &[(&str, &str)]) -> Peer {
            let mut doc = ProjectDoc::create().unwrap();
            doc.set_author(account, account);
            let mut made = BTreeMap::new();
            for (path, text) in files {
                let parent = parent_id(&mut doc, &mut made, path);
                let name = path.rsplit_once('/').map_or(*path, |(_, name)| name);
                doc.add_node(parent.as_deref(), name, NodeKind::Text, None, text)
                    .unwrap();
            }
            Peer::placed(LiveProject::new(doc, 0, ProjectRole::Owner))
        }

        fn join(&self, account: &str) -> Peer {
            let mut doc = ProjectDoc::load(&self.live.doc().snapshot().unwrap()).unwrap();
            doc.set_author(account, account);
            Peer::placed(LiveProject::new(doc, 0, ProjectRole::Editor))
        }

        fn placed(mut live: LiveProject) -> Peer {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().join("project");
            std::fs::create_dir_all(&root).unwrap();
            let layout = materialize::layout(&live.doc().nodes().unwrap());
            let mut hashes = BTreeMap::new();
            for (id, placed) in &layout {
                let target = root.join(&placed.path);
                if placed.kind == NodeKind::Dir {
                    std::fs::create_dir_all(&target).unwrap();
                } else if placed.kind == NodeKind::Text {
                    let text = live.doc().text(id).unwrap();
                    std::fs::create_dir_all(target.parent().unwrap()).unwrap();
                    std::fs::write(&target, &text).unwrap();
                    hashes.insert(placed.path.clone(), sha256_hex(text.as_bytes()));
                }
            }
            let disk = DiskState {
                layout,
                hashes,
                owed: Default::default(),
            };
            live.take_disk_work();
            let bases = initial_bases(&root, &disk, &live);
            Peer {
                dir,
                root,
                live,
                disk,
                bases,
                seq: 0,
            }
        }

        fn id_of(&self, path: &str) -> String {
            by_path(&materialize::layout(&self.live.doc().nodes().unwrap()))[path]
                .0
                .clone()
        }

        fn path_of(&self, id: &str) -> Option<String> {
            materialize::layout(&self.live.doc().nodes().unwrap())
                .get(id)
                .map(|placed| placed.path.clone())
        }

        fn rename(&mut self, from: &str, to: &str) {
            assert!(move_path(&self.root, from, to), "{from} -> {to}");
            assert!(
                adopt_move(&mut self.live, &mut self.disk, &mut self.bases, from, to).unwrap(),
                "{from} -> {to} never reached the shared tree"
            );
        }

        fn delete(&mut self, path: &str) -> String {
            let target = self.root.join(path);
            if target.is_dir() {
                std::fs::remove_dir_all(&target).unwrap();
            } else {
                std::fs::remove_file(&target).unwrap();
            }
            adopt_removal(&mut self.live, &mut self.disk, &mut self.bases, path)
                .unwrap()
                .expect("the deleted file never reached the shared tree")
        }

        fn write_out(&mut self) -> DiskPass {
            let previous = self.disk.layout.clone();
            let work = self.live.take_disk_work();
            let next = materialize::layout(&self.live.doc().nodes().unwrap());
            let mut ids = work.texts.clone();
            for (id, placed) in &next {
                let moved_or_new = previous
                    .get(id)
                    .is_none_or(|before| before.path != placed.path);
                if placed.kind == NodeKind::Text && moved_or_new {
                    ids.insert(id.clone());
                }
            }
            let texts: Vec<(String, String)> = ids
                .iter()
                .filter_map(|id| {
                    next.get(id)
                        .filter(|placed| placed.kind == NodeKind::Text)
                        .map(|placed| (placed.path.clone(), self.live.doc().text(id).unwrap()))
                })
                .collect();
            let crlf: BTreeSet<String> = ids
                .iter()
                .filter(|id| self.live.doc().crlf(id))
                .filter_map(|id| next.get(id).map(|placed| placed.path.clone()))
                .collect();
            let plan = materialize::plan(&previous, &next);
            apply_to_disk(
                &self.root,
                &mut self.disk,
                &mut self.bases,
                plan,
                next,
                &texts,
                &crlf,
                &super::super::disk_pass::NOTHING_LEFT,
            )
            .unwrap()
        }

        fn files(&self) -> Vec<(String, String)> {
            fn walk(root: &Path, at: &Path, out: &mut Vec<(String, String)>) {
                for entry in std::fs::read_dir(at).unwrap() {
                    let path = entry.unwrap().path();
                    if path.is_dir() {
                        walk(root, &path, out);
                    } else {
                        let relative = path
                            .strip_prefix(root)
                            .unwrap()
                            .to_string_lossy()
                            .replace('\\', "/");
                        out.push((relative, std::fs::read_to_string(&path).unwrap()));
                    }
                }
            }
            let mut out = Vec::new();
            walk(&self.root, &self.root, &mut out);
            out.sort();
            out
        }

        fn names(&self) -> Vec<String> {
            self.files().into_iter().map(|(path, _)| path).collect()
        }
    }

    fn deliver(from: &Peer, to: &mut Peer) {
        let payload = from
            .live
            .doc()
            .export_since(&to.live.doc().version())
            .unwrap();
        to.seq += 1;
        to.live.import_update(to.seq, &payload).unwrap();
    }

    fn exchange(left: &mut Peer, right: &mut Peer) {
        deliver(left, right);
        deliver(right, left);
    }

    fn recorder() -> (DocSink, Arc<Mutex<Vec<DocMessage>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let copy = Arc::clone(&seen);
        let sink: DocSink = Arc::new(move |message| copy.lock().unwrap().push(message));
        (sink, seen)
    }

    fn type_at_end(peer: &mut Peer, id: &str, text: &str) {
        let current = peer.live.doc().text(id).unwrap();
        let length = current.encode_utf16().count();
        let mut operation = TextOperation::new();
        operation.retain(length).insert(text);
        let rev = peer.live.editor_rev(id).unwrap();
        peer.live.editor_change(id, rev, operation).unwrap();
    }

    fn resets(seen: &Arc<Mutex<Vec<DocMessage>>>) -> usize {
        seen.lock()
            .unwrap()
            .iter()
            .filter(|message| matches!(message, DocMessage::Reset { .. }))
            .count()
    }

    #[test]
    fn renaming_a_file_someone_is_typing_in_keeps_one_file_its_comments_and_their_editor() {
        let mut alice = Peer::first(
            "acct-alice",
            &[("sections/results.tex", "results\n"), ("ai2.tex", "ai\n")],
        );
        let mut carol = alice.join("acct-carol");
        let id = alice.id_of("sections/results.tex");
        alice
            .live
            .comment_doc()
            .create_comment_thread(&id, 0, 7, AccountId::new_v7(), 1, "Check this", &[])
            .unwrap();
        deliver(&alice, &mut carol);
        carol.write_out();
        let (sink, seen) = recorder();
        carol.live.open_file(&id, sink).unwrap();
        type_at_end(&mut carol, &id, "carol one\n");
        alice.rename("sections/results.tex", "sections/findings.tex");
        let own = alice.write_out();
        assert!(own.moved.is_empty() && own.removed.is_empty());
        exchange(&mut alice, &mut carol);
        type_at_end(&mut carol, &id, "carol two\n");
        deliver(&carol, &mut alice);
        let theirs = carol.write_out();
        alice.write_out();
        assert_eq!(
            theirs.moved,
            vec![(
                "sections/results.tex".to_owned(),
                "sections/findings.tex".to_owned()
            )]
        );
        assert!(theirs.removed.is_empty());
        let expected = vec![
            ("ai2.tex".to_owned(), "ai\n".to_owned()),
            (
                "sections/findings.tex".to_owned(),
                "results\ncarol one\ncarol two\n".to_owned(),
            ),
        ];
        assert_eq!(alice.files(), expected);
        assert_eq!(carol.files(), expected);
        for peer in [&alice, &carol] {
            assert_eq!(peer.path_of(&id).as_deref(), Some("sections/findings.tex"));
            assert!(trash_list(&peer.live).unwrap().is_empty());
            assert_eq!(peer.live.doc().comment_threads(&id).unwrap().len(), 1);
        }
        assert!(carol.live.is_open(&id));
        assert_eq!(resets(&seen), 0);
    }

    #[test]
    fn two_people_renaming_the_same_file_at_once_end_with_one_file_under_one_name() {
        let mut alice = Peer::first("acct-alice", &[("results.tex", "r\n")]);
        let mut bob = alice.join("acct-bob");
        let id = alice.id_of("results.tex");
        alice.rename("results.tex", "results-A.tex");
        bob.rename("results.tex", "results-B.tex");
        alice.write_out();
        bob.write_out();
        exchange(&mut alice, &mut bob);
        alice.write_out();
        bob.write_out();
        let winner = alice.path_of(&id).unwrap();
        assert!(winner == "results-A.tex" || winner == "results-B.tex");
        assert_eq!(bob.path_of(&id).as_deref(), Some(winner.as_str()));
        assert_eq!(alice.files(), vec![(winner.clone(), "r\n".to_owned())]);
        assert_eq!(bob.files(), vec![(winner, "r\n".to_owned())]);
    }

    #[test]
    fn a_rename_that_only_changes_case_while_someone_types_keeps_one_file_everywhere() {
        let mut alice = Peer::first("acct-alice", &[("chapters/intro.tex", "intro\n")]);
        let mut carol = alice.join("acct-carol");
        let id = alice.id_of("chapters/intro.tex");
        let (sink, _seen) = recorder();
        carol.live.open_file(&id, sink).unwrap();
        type_at_end(&mut carol, &id, "one\n");
        alice.rename("chapters/intro.tex", "chapters/Intro.tex");
        alice.write_out();
        exchange(&mut alice, &mut carol);
        type_at_end(&mut carol, &id, "two\n");
        deliver(&carol, &mut alice);
        carol.write_out();
        alice.write_out();
        let expected = vec![(
            "chapters/Intro.tex".to_owned(),
            "intro\none\ntwo\n".to_owned(),
        )];
        assert_eq!(alice.files(), expected);
        assert_eq!(carol.files(), expected);
        assert!(exists_exact(&carol.root, "chapters/Intro.tex"));
        assert!(exists_exact(&alice.root, "chapters/Intro.tex"));
    }

    #[test]
    fn renaming_a_folder_moves_everything_inside_and_leaves_nothing_in_recently_deleted() {
        let mut alice = Peer::first(
            "acct-alice",
            &[("sections/a.tex", "a\n"), ("sections/b.tex", "b\n")],
        );
        let mut bob = alice.join("acct-bob");
        let a = alice.id_of("sections/a.tex");
        let (sink, _seen) = recorder();
        bob.live.open_file(&a, sink).unwrap();
        type_at_end(&mut bob, &a, "bob\n");
        alice.rename("sections", "parts");
        alice.write_out();
        exchange(&mut alice, &mut bob);
        bob.write_out();
        alice.write_out();
        let expected = vec![
            ("parts/a.tex".to_owned(), "a\nbob\n".to_owned()),
            ("parts/b.tex".to_owned(), "b\n".to_owned()),
        ];
        assert_eq!(alice.files(), expected);
        assert_eq!(bob.files(), expected);
        assert!(!alice.root.join("sections").exists());
        assert!(!bob.root.join("sections").exists());
        for peer in [&alice, &bob] {
            assert!(trash_list(&peer.live).unwrap().is_empty());
            assert_eq!(peer.path_of(&a).as_deref(), Some("parts/a.tex"));
        }
    }

    #[test]
    fn moving_a_file_into_a_new_folder_adds_the_folder_to_the_shared_tree() {
        let mut alice = Peer::first("acct-alice", &[("main.tex", "m\n")]);
        let mut bob = alice.join("acct-bob");
        let id = alice.id_of("main.tex");
        std::fs::create_dir_all(alice.root.join("drafts")).unwrap();
        alice.rename("main.tex", "drafts/main.tex");
        let own = alice.write_out();
        assert!(own.moved.is_empty() && own.removed.is_empty());
        deliver(&alice, &mut bob);
        bob.write_out();
        assert_eq!(
            bob.files(),
            vec![("drafts/main.tex".to_owned(), "m\n".to_owned())]
        );
        assert_eq!(bob.path_of(&id).as_deref(), Some("drafts/main.tex"));
    }

    #[test]
    fn renaming_onto_a_replaced_file_moves_the_replaced_one_to_recently_deleted() {
        let mut alice = Peer::first("acct-alice", &[("a.tex", "a\n"), ("b.tex", "b\n")]);
        let mut bob = alice.join("acct-bob");
        let a = alice.id_of("a.tex");
        std::fs::remove_file(alice.root.join("b.tex")).unwrap();
        alice.rename("a.tex", "b.tex");
        alice.write_out();
        deliver(&alice, &mut bob);
        bob.write_out();
        assert_eq!(bob.files(), vec![("b.tex".to_owned(), "a\n".to_owned())]);
        assert_eq!(bob.path_of(&a).as_deref(), Some("b.tex"));
        let trashed = trash_list(&bob.live).unwrap();
        assert_eq!(trashed.len(), 1);
        assert_eq!(trashed[0].name, "b.tex");
    }

    #[test]
    fn renaming_onto_a_file_whose_name_differs_only_by_case_replaces_it() {
        let mut alice = Peer::first("acct-alice", &[("a.tex", "a\n"), ("b.tex", "b\n")]);
        let mut bob = alice.join("acct-bob");
        let a = alice.id_of("a.tex");
        std::fs::remove_file(alice.root.join("b.tex")).unwrap();
        alice.rename("a.tex", "B.tex");
        alice.write_out();
        deliver(&alice, &mut bob);
        bob.write_out();
        assert_eq!(bob.files(), vec![("B.tex".to_owned(), "a\n".to_owned())]);
        assert_eq!(alice.files(), vec![("B.tex".to_owned(), "a\n".to_owned())]);
        assert_eq!(bob.path_of(&a).as_deref(), Some("B.tex"));
        assert_eq!(trash_list(&bob.live).unwrap().len(), 1);
    }

    #[test]
    fn deleting_a_file_others_are_typing_in_wins_and_keeps_their_typing_for_restore() {
        let mut bob = Peer::first(
            "acct-bob",
            &[("discussion.tex", "d\n"), ("big.tex", "big\n")],
        );
        let mut alice = bob.join("acct-alice");
        let id = bob.id_of("discussion.tex");
        let (sink, _seen) = recorder();
        alice.live.open_file(&id, sink).unwrap();
        type_at_end(&mut alice, &id, "alice one\n");
        bob.delete("discussion.tex");
        bob.write_out();
        deliver(&alice, &mut bob);
        let after_typing = bob.write_out();
        assert!(
            after_typing.conflicts.is_empty(),
            "{:?}",
            after_typing.conflicts
        );
        assert_eq!(bob.names(), vec!["big.tex".to_owned()]);
        deliver(&bob, &mut alice);
        type_at_end(&mut alice, &id, "alice two\n");
        let theirs = alice.write_out();
        assert_eq!(theirs.removed, vec!["discussion.tex".to_owned()]);
        assert_eq!(
            alice.files(),
            vec![("big.tex".to_owned(), "big\n".to_owned())]
        );
        deliver(&alice, &mut bob);
        bob.write_out();
        assert_eq!(bob.names(), vec!["big.tex".to_owned()]);
        let trashed = trash_list(&bob.live).unwrap();
        assert_eq!(trashed.len(), 1);
        assert_eq!(trashed[0].id, id);
        assert_eq!(trashed[0].deleted_by.as_deref(), Some("acct-bob"));
        trash_restore(&mut bob.live, &id).unwrap();
        bob.write_out();
        assert_eq!(
            bob.files(),
            vec![
                ("big.tex".to_owned(), "big\n".to_owned()),
                (
                    "discussion.tex".to_owned(),
                    "d\nalice one\nalice two\n".to_owned()
                ),
            ]
        );
    }

    #[test]
    fn a_file_deleted_here_is_not_written_back_by_someone_elses_typing() {
        let mut bob = Peer::first("acct-bob", &[("discussion.tex", "d\n")]);
        let mut alice = bob.join("acct-alice");
        let id = bob.id_of("discussion.tex");
        std::fs::remove_file(bob.root.join("discussion.tex")).unwrap();
        let (sink, _seen) = recorder();
        alice.live.open_file(&id, sink).unwrap();
        type_at_end(&mut alice, &id, "typed elsewhere\n");
        deliver(&alice, &mut bob);
        let pass = bob.write_out();
        assert!(!bob.root.join("discussion.tex").exists());
        assert_eq!(pass.conflicts, vec!["discussion.tex".to_owned()]);
        let import =
            read_local_changes(&bob.root, &bob.disk, &bob.live, Some(&pass.conflicts)).unwrap();
        apply_local_import(
            &mut bob.live,
            &mut bob.disk,
            &mut bob.bases,
            import,
            &bob.root,
        )
        .unwrap();
        let trashed = trash_list(&bob.live).unwrap();
        assert_eq!(trashed.len(), 1);
        assert_eq!(trashed[0].id, id);
        assert_eq!(bob.live.doc().text(&id).unwrap(), "d\ntyped elsewhere\n");
    }

    #[test]
    fn a_figure_deleted_here_is_not_fetched_back_when_someone_replaces_it() {
        let mut bob = Peer::first("acct-bob", &[("main.tex", "m\n")]);
        let bytes = [0x89, b'P', 1, 2];
        let hash = sha256_hex(&bytes);
        let id = bob
            .live
            .doc_mut()
            .add_node(None, "plot.png", NodeKind::Blob, Some(&hash), "")
            .unwrap();
        std::fs::write(bob.root.join("plot.png"), bytes).unwrap();
        bob.disk.hashes.insert("plot.png".to_owned(), hash);
        bob.disk.layout = materialize::layout(&bob.live.doc().nodes().unwrap());
        bob.live.take_disk_work();
        let mut alice = bob.join("acct-alice");
        alice.live.doc_mut().set_blob(&id, "replaced").unwrap();
        deliver(&alice, &mut bob);
        std::fs::remove_file(bob.root.join("plot.png")).unwrap();
        let pass = bob.write_out();
        assert!(pass.blobs.is_empty(), "{:?}", pass.blobs);
        assert_eq!(pass.conflicts, vec!["plot.png".to_owned()]);
    }

    #[test]
    fn a_folder_renamed_outside_the_app_keeps_its_files_and_leaves_nothing_in_recently_deleted() {
        let mut alice = Peer::first(
            "acct-alice",
            &[("sections/a.tex", "a\n"), ("sections/b.tex", "b\n")],
        );
        let a = alice.id_of("sections/a.tex");
        let b = alice.id_of("sections/b.tex");
        let folder = alice.id_of("sections");
        std::fs::rename(alice.root.join("sections"), alice.root.join("parts")).unwrap();
        std::fs::write(alice.root.join("parts/a.tex"), "a\ntyped while renaming\n").unwrap();
        let mut import = read_local_changes(&alice.root, &alice.disk, &alice.live, None).unwrap();
        adopt_folder_moves(
            &mut alice.live,
            &mut alice.disk,
            &mut alice.bases,
            &mut import,
        )
        .unwrap();
        apply_local_import(
            &mut alice.live,
            &mut alice.disk,
            &mut alice.bases,
            import,
            &alice.root,
        )
        .unwrap();
        assert!(trash_list(&alice.live).unwrap().is_empty());
        assert_eq!(alice.path_of(&a).as_deref(), Some("parts/a.tex"));
        assert_eq!(alice.path_of(&b).as_deref(), Some("parts/b.tex"));
        assert_eq!(alice.path_of(&folder).as_deref(), Some("parts"));
        assert_eq!(
            alice.live.doc().text(&a).unwrap(),
            "a\ntyped while renaming\n"
        );
    }

    #[test]
    fn someone_elses_delete_is_announced_with_who_and_whether_offline_work_went_with_it() {
        let mut bob = Peer::first("acct-bob", &[("plan.tex", "p\n"), ("notes.tex", "n\n")]);
        let mut alice = bob.join("acct-alice");
        let plan = bob.id_of("plan.tex");
        let notes = bob.id_of("notes.tex");
        alice
            .live
            .local_text(&plan, "p\nwritten offline\n")
            .unwrap();
        bob.delete("plan.tex");
        bob.delete("notes.tex");
        bob.write_out();
        deliver(&bob, &mut alice);
        let previous = alice.disk.layout.clone();
        let pass = alice.write_out();
        let payload = removed_notices("grant", &mut alice.live, &previous, &pass.removed).unwrap();
        assert_eq!(payload.project_id, "grant");
        let mut files = payload.files;
        files.sort_by(|left, right| left.path.cmp(&right.path));
        assert_eq!(
            files,
            vec![
                RemovedFile {
                    path: "notes.tex".to_owned(),
                    id: notes,
                    kind: NodeKind::Text,
                    by: Some("acct-bob".to_owned()),
                    yours: false,
                    copy: None,
                },
                RemovedFile {
                    path: "plan.tex".to_owned(),
                    id: plan,
                    kind: NodeKind::Text,
                    by: Some("acct-bob".to_owned()),
                    yours: true,
                    copy: None,
                },
            ]
        );
    }

    struct Heard(Mutex<Vec<RemovedPayload>>);

    impl oleafly_live::DiskHost for Heard {
        fn removed(&self, payload: RemovedPayload) {
            guard(&self.0).push(payload);
        }
    }

    impl LiveHost for Heard {}

    struct Rig {
        root: PathBuf,
        active: Arc<Active>,
        host: Arc<Heard>,
        runtime: tokio::runtime::Runtime,
        collab: PathBuf,
        _peer: tempfile::TempDir,
        _dir: tempfile::TempDir,
    }

    fn rig(peer: Peer) -> Rig {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let Peer {
            dir: peer_dir,
            root,
            live,
            disk,
            bases,
            ..
        } = peer;
        let host = Arc::new(Heard(Mutex::new(Vec::new())));
        let collab = dir.path().join("collab");
        let project_dir = collab.join("moving");
        std::fs::create_dir_all(&project_dir).unwrap();
        let active = runtime.block_on(async {
            let state = CollabState::new(
                oleafly_collab::CollabPaths::new(dir.path().join("keys")),
                Arc::new(oleafly_collab::secret_port::MemorySecrets::default()),
            );
            let keys = state.keys().await.unwrap();
            let link = LiveLink {
                client: Arc::new(
                    ServerClient::new(ServerUrl::parse("http://127.0.0.1:9").unwrap()).unwrap(),
                ),
                server_id: ServerId::new_v7(),
                project: SharedProjectId::new_v7(),
                device_id: DeviceId::new_v7(),
                key: Arc::clone(&keys.key),
                sessions: Arc::clone(&keys.sessions),
            };
            let shared: SharedLive = Arc::new(Mutex::new(live));
            let (events, _events) = mpsc::unbounded_channel();
            let (writer, _writer) = mpsc::unbounded_channel();
            let handle = spawn_live(link.clone(), Arc::clone(&shared), events);
            let local = LiveDisk::assembled(
                "moving",
                root.clone(),
                project_dir.join("materializer-index.json"),
                disk,
                bases,
                host.clone(),
                writer,
            );
            Arc::new(Active::assembled(
                local,
                Arc::clone(&host) as Arc<dyn LiveHost>,
                dir.path().join("document"),
                shared,
                handle,
                link,
            ))
        });
        Rig {
            root,
            active,
            host,
            runtime,
            collab,
            _peer: peer_dir,
            _dir: dir,
        }
    }

    impl Drop for Rig {
        fn drop(&mut self) {
            self.active.handle.stop();
        }
    }

    impl Rig {
        fn layout(&self) -> Layout {
            materialize::layout(&lock(&self.active.live).doc().nodes().unwrap())
        }

        fn import(&self, paths: &[&str]) {
            let only: Vec<String> = paths.iter().map(|path| (*path).to_owned()).collect();
            self.runtime
                .block_on(self.active.import_paths(Some(only)))
                .unwrap();
        }

        fn write_out(&self) {
            self.runtime.block_on(self.active.write_out()).unwrap();
        }

        fn state(&self) -> CollabState {
            CollabState::new(
                oleafly_collab::CollabPaths::new(self.collab.clone()),
                Arc::new(oleafly_collab::secret_port::MemorySecrets::default()),
            )
        }

        fn arrive(&self, from: &Peer) {
            let mut live = lock(&self.active.live);
            let payload = from.live.doc().export_since(&live.doc().version()).unwrap();
            live.import_update(1, &payload).unwrap();
        }
    }

    fn offline_work_deleted_by_bob() -> (Rig, String) {
        let mut bob = Peer::first("acct-bob", &[("plan.tex", "p\n"), ("notes.tex", "n\n")]);
        let mut alice = bob.join("acct-alice");
        let plan = bob.id_of("plan.tex");
        alice
            .live
            .local_text(&plan, "p\nwritten offline\n")
            .unwrap();
        let rig = rig(alice);
        bob.delete("plan.tex");
        bob.delete("notes.tex");
        rig.arrive(&bob);
        rig.write_out();
        (rig, plan)
    }

    #[test]
    fn offline_work_lost_to_a_delete_is_announced_again_after_a_restart_until_dismissed() {
        let (rig, plan) = offline_work_deleted_by_bob();
        let state = rig.state();
        let remembered = lost_notices(&state, "moving").unwrap();
        assert_eq!(
            remembered,
            vec![RemovedFile {
                path: "plan.tex".to_owned(),
                id: plan.clone(),
                kind: NodeKind::Text,
                by: Some("acct-bob".to_owned()),
                yours: true,
                copy: None,
            }]
        );
        dismiss_notice(&state, "moving", &plan).unwrap();
        assert!(lost_notices(&state, "moving").unwrap().is_empty());
    }

    #[test]
    fn restoring_a_file_forgets_the_notice_about_its_lost_offline_work() {
        let (rig, plan) = offline_work_deleted_by_bob();
        let state = rig.state();
        assert_eq!(lost_notices(&state, "moving").unwrap().len(), 1);
        let turn = super::super::write::rig::live_turn();
        *guard(&super::super::ACTIVE) = Some(super::super::Live::Server(Arc::clone(&rig.active)));
        let restored = rig
            .runtime
            .block_on(crate::collab::tree::collab_trash_restore(
                "moving".to_owned(),
                plan.clone(),
            ));
        *guard(&super::super::ACTIVE) = None;
        drop(turn);
        restored.unwrap();
        assert!(lost_notices(&state, "moving").unwrap().is_empty());
    }

    #[test]
    fn an_in_app_rename_moves_the_file_in_the_shared_tree_before_anyone_scans_the_disk() {
        let peer = Peer::first("acct-alice", &[("results.tex", "r\n")]);
        let id = peer.id_of("results.tex");
        let rig = rig(peer);
        let root = rig.root.clone();
        let landed = rig
            .active
            .rename_with(
                "results.tex",
                || {
                    std::fs::write(root.join("results.tex"), "r\ntyped just before\n").unwrap();
                    std::fs::rename(root.join("results.tex"), root.join("findings.tex"))
                        .map_err(|error| error.to_string())?;
                    Ok("findings.tex".to_owned())
                },
                |path| Some(path.clone()),
            )
            .unwrap();
        assert_eq!(landed, "findings.tex");
        assert_eq!(rig.layout()[&id].path, "findings.tex");
        rig.import(&["results.tex", "findings.tex"]);
        rig.write_out();
        let layout = rig.layout();
        assert_eq!(layout.len(), 1);
        assert_eq!(layout[&id].path, "findings.tex");
        let live = lock(&rig.active.live);
        assert!(trash_list(&live).unwrap().is_empty());
        assert_eq!(live.doc().text(&id).unwrap(), "r\ntyped just before\n");
    }

    #[test]
    fn an_in_app_delete_moves_the_file_to_recently_deleted_at_once() {
        let peer = Peer::first("acct-bob", &[("discussion.tex", "d\n"), ("big.tex", "b\n")]);
        let id = peer.id_of("discussion.tex");
        let rig = rig(peer);
        let root = rig.root.clone();
        rig.active
            .delete_with("discussion.tex", || {
                std::fs::remove_file(root.join("discussion.tex")).map_err(|error| error.to_string())
            })
            .unwrap();
        assert!(!rig.layout().contains_key(&id));
        lock(&rig.active.live)
            .local_text(&id, "d\ntyped by someone\n")
            .unwrap();
        rig.write_out();
        rig.import(&["discussion.tex"]);
        assert!(!root.join("discussion.tex").exists());
        let trashed = trash_list(&lock(&rig.active.live)).unwrap();
        assert_eq!(trashed.len(), 1);
        assert_eq!(trashed[0].id, id);
        assert!(guard(&rig.host.0).is_empty());
    }

    #[test]
    fn writing_out_someone_elses_delete_announces_it() {
        let mut bob = Peer::first("acct-bob", &[("plan.tex", "p\n")]);
        let alice = bob.join("acct-alice");
        let plan = bob.id_of("plan.tex");
        let rig = rig(alice);
        bob.delete("plan.tex");
        {
            let mut live = lock(&rig.active.live);
            let payload = bob.live.doc().export_since(&live.doc().version()).unwrap();
            live.import_update(1, &payload).unwrap();
        }
        rig.write_out();
        assert!(!rig.root.join("plan.tex").exists());
        let heard = guard(&rig.host.0).clone();
        assert_eq!(heard.len(), 1);
        assert_eq!(heard[0].project_id, "moving");
        assert_eq!(heard[0].files.len(), 1);
        assert_eq!(heard[0].files[0].id, plan);
        assert_eq!(heard[0].files[0].by.as_deref(), Some("acct-bob"));
    }

    #[test]
    fn a_file_restored_by_a_third_person_clears_every_notice_about_its_delete() {
        let mut bob = Peer::first(
            "acct-bob",
            &[("plan.tex", "p\n"), ("discussion.tex", "d\n")],
        );
        let mut alice = bob.join("acct-alice");
        let mut carol = bob.join("acct-carol");
        let plan = bob.id_of("plan.tex");
        let discussion = bob.id_of("discussion.tex");
        alice
            .live
            .local_text(&plan, "p\nwritten offline\n")
            .unwrap();
        let rig = rig(alice);
        bob.delete("plan.tex");
        bob.delete("discussion.tex");
        rig.arrive(&bob);
        rig.write_out();
        let state = rig.state();
        assert_eq!(lost_notices(&state, "moving").unwrap().len(), 1);
        let told: Vec<String> = guard(&rig.host.0)[0]
            .files
            .iter()
            .map(|file| file.id.clone())
            .collect();
        assert_eq!(told.len(), 2);
        deliver(&bob, &mut carol);
        trash_restore(&mut carol.live, &plan).unwrap();
        trash_restore(&mut carol.live, &discussion).unwrap();
        {
            let mut live = lock(&rig.active.live);
            let payload = carol
                .live
                .doc()
                .export_since(&live.doc().version())
                .unwrap();
            assert!(live.import_update(2, &payload).unwrap());
        }
        rig.write_out();
        assert!(rig.root.join("plan.tex").exists());
        assert!(rig.root.join("discussion.tex").exists());
        assert!(lost_notices(&state, "moving").unwrap().is_empty());
        let heard = guard(&rig.host.0).clone();
        assert_eq!(heard.len(), 2, "{heard:?}");
        assert!(heard[1].files.is_empty());
        let mut restored = heard[1].restored.clone();
        restored.sort();
        let mut expected = vec![plan, discussion];
        expected.sort();
        assert_eq!(restored, expected);
    }

    #[test]
    fn a_file_someone_else_adds_is_not_announced_as_restored() {
        let mut bob = Peer::first("acct-bob", &[("plan.tex", "p\n")]);
        let alice = bob.join("acct-alice");
        let rig = rig(alice);
        bob.live
            .doc_mut()
            .add_node(None, "fresh.tex", NodeKind::Text, None, "f\n")
            .unwrap();
        rig.arrive(&bob);
        rig.write_out();
        assert!(rig.root.join("fresh.tex").exists());
        assert!(guard(&rig.host.0).is_empty());
    }
}
