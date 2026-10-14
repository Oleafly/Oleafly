use std::collections::BTreeSet;
use std::path::Path;

use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize;
use oleafly_collab_protocol::projects::ProjectRole;

use super::{
    apply_local_import, apply_to_disk, read_local_changes, sha256_hex, writable, WrittenTexts,
};
use crate::collab::disk::DiskState;

pub(super) fn project(root: &Path) -> (LiveProject, DiskState, String) {
    let mut doc = ProjectDoc::create().unwrap();
    let main = doc
        .add_node(None, "main.tex", NodeKind::Text, None, "abc")
        .unwrap();
    std::fs::write(root.join("main.tex"), "abc").unwrap();
    let layout = materialize::layout(&doc.nodes().unwrap());
    let mut hashes = std::collections::BTreeMap::new();
    hashes.insert("main.tex".to_owned(), sha256_hex(b"abc"));
    (
        LiveProject::new(doc, 0, ProjectRole::Owner),
        DiskState { layout, hashes },
        main,
    )
}

fn paths_of(live: &LiveProject) -> Vec<String> {
    let mut paths: Vec<String> = materialize::layout(&live.doc().nodes().unwrap())
        .values()
        .map(|placed| placed.path.clone())
        .collect();
    paths.sort();
    paths
}

#[test]
fn a_different_figure_under_a_name_never_written_here_is_kept_beside_the_shared_one() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let (mut live, mut disk, _main) = project(root);
    live.doc_mut().set_author("acct-bob", "Bob Smith");
    let mut alice = ProjectDoc::load(&live.doc().snapshot().unwrap()).unwrap();
    alice.set_author("acct-alice", "Alice Chen");
    let theirs = alice
        .add_node(None, "plot.png", NodeKind::Blob, Some("alicehash"), "")
        .unwrap();
    let update = alice.export_since(&live.doc().version()).unwrap();
    assert!(live.import_update(1, &update).unwrap());
    let bytes = [0x89, b'P', 1, 2];
    std::fs::write(root.join("plot.png"), bytes).unwrap();
    let only = ["plot.png".to_owned()];
    let import = read_local_changes(root, &disk, &live, Some(&only)).unwrap();
    apply_local_import(
        &mut live,
        &mut disk,
        &mut WrittenTexts::default(),
        import,
        root,
    )
    .unwrap();
    let nodes = live.doc().nodes().unwrap();
    let ours = nodes
        .iter()
        .find(|node| node.kind == NodeKind::Blob && node.id != theirs)
        .expect("the local figure became its own file")
        .id
        .clone();
    let next = materialize::layout(&nodes);
    assert_eq!(next[&theirs].blob.as_deref(), Some("alicehash"));
    assert_eq!(next[&ours].blob, Some(sha256_hex(&bytes)));
    assert_eq!(next[&theirs].path, "plot.png");
    assert_eq!(next[&ours].path, "plot (from Bob Smith).png");
    assert_eq!(
        disk.layout.get(&ours).map(|placed| placed.path.as_str()),
        Some("plot.png")
    );
    assert!(!disk.layout.contains_key(&theirs));
    let plan = materialize::plan(&disk.layout, &next);
    let pass = apply_to_disk(
        root,
        &mut disk,
        &mut WrittenTexts::default(),
        plan,
        next,
        &[],
        &BTreeSet::new(),
        &|_| false,
    )
    .unwrap();
    assert_eq!(
        std::fs::read(root.join("plot (from Bob Smith).png")).unwrap(),
        bytes
    );
    let fetched: Vec<(&str, &str)> = pass
        .blobs
        .iter()
        .map(|(path, hash, _)| (path.as_str(), hash.as_str()))
        .collect();
    assert_eq!(fetched, vec![("plot.png", "alicehash")]);
}

#[test]
fn edits_new_files_and_folders_on_disk_reach_the_document() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let (mut live, mut disk, main) = project(root);
    std::fs::write(root.join("main.tex"), "abcd").unwrap();
    std::fs::write(root.join("new.tex"), "x").unwrap();
    std::fs::create_dir_all(root.join("chapters")).unwrap();
    std::fs::write(root.join("chapters/one.tex"), "y").unwrap();
    std::fs::write(root.join("figure.png"), [0x89, b'P', 0, 7]).unwrap();
    std::fs::write(root.join("project.json"), "{}").unwrap();
    let import = read_local_changes(root, &disk, &live, None).unwrap();
    assert_eq!(import.blobs.len(), 1);
    assert!(apply_local_import(
        &mut live,
        &mut disk,
        &mut WrittenTexts::default(),
        import,
        root
    )
    .unwrap());
    assert_eq!(live.doc().text(&main).unwrap(), "abcd");
    assert_eq!(
        paths_of(&live),
        vec![
            "chapters",
            "chapters/one.tex",
            "figure.png",
            "main.tex",
            "new.tex"
        ]
    );
    assert!(read_local_changes(root, &disk, &live, None)
        .unwrap()
        .is_empty());
    std::fs::remove_file(root.join("new.tex")).unwrap();
    let removed = read_local_changes(root, &disk, &live, Some(&["new.tex".to_owned()])).unwrap();
    assert_eq!(removed.removed, vec!["new.tex".to_owned()]);
    apply_local_import(
        &mut live,
        &mut disk,
        &mut WrittenTexts::default(),
        removed,
        root,
    )
    .unwrap();
    assert!(!paths_of(&live).contains(&"new.tex".to_owned()));
}

fn with_notes(root: &Path) -> (LiveProject, DiskState, String) {
    let (mut live, mut disk, _main) = project(root);
    let notes = live
        .doc_mut()
        .add_node(None, "notes.tex", NodeKind::Text, None, "notes")
        .unwrap();
    std::fs::write(root.join("notes.tex"), "notes").unwrap();
    disk.hashes
        .insert("notes.tex".to_owned(), sha256_hex(b"notes"));
    disk.layout = materialize::layout(&live.doc().nodes().unwrap());
    live.take_disk_work();
    (live, disk, notes)
}

fn edit_main_then_write_out(live: &mut LiveProject, disk: &mut DiskState, root: &Path) {
    std::fs::write(root.join("main.tex"), "abcd").unwrap();
    let only = ["main.tex".to_owned()];
    let import = read_local_changes(root, disk, live, Some(&only)).unwrap();
    let mut bases = WrittenTexts::default();
    assert!(apply_local_import(live, disk, &mut bases, import, root).unwrap());
    let next = materialize::layout(&live.doc().nodes().unwrap());
    let plan = materialize::plan(&disk.layout, &next);
    apply_to_disk(
        root,
        disk,
        &mut bases,
        plan,
        next,
        &[],
        &BTreeSet::new(),
        &|_| false,
    )
    .unwrap();
}

fn rescan(live: &mut LiveProject, disk: &mut DiskState, root: &Path) {
    let import = read_local_changes(root, disk, live, None).unwrap();
    apply_local_import(live, disk, &mut WrittenTexts::default(), import, root).unwrap();
}

#[test]
fn a_file_deleted_elsewhere_is_removed_here_even_when_a_local_edit_is_taken_in_first() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let (mut live, mut disk, notes) = with_notes(root);
    let mut alice = ProjectDoc::load(&live.doc().snapshot().unwrap()).unwrap();
    alice.trash(&notes).unwrap();
    let update = alice.export_since(&live.doc().version()).unwrap();
    assert!(live.import_update(1, &update).unwrap());

    edit_main_then_write_out(&mut live, &mut disk, root);

    assert!(!root.join("notes.tex").exists());
    rescan(&mut live, &mut disk, root);
    assert_eq!(paths_of(&live), vec!["main.tex"]);
}

#[test]
fn a_file_renamed_elsewhere_moves_here_even_when_a_local_edit_is_taken_in_first() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let (mut live, mut disk, notes) = with_notes(root);
    let mut alice = ProjectDoc::load(&live.doc().snapshot().unwrap()).unwrap();
    alice.rename(&notes, "renamed.tex").unwrap();
    let update = alice.export_since(&live.doc().version()).unwrap();
    assert!(live.import_update(1, &update).unwrap());

    edit_main_then_write_out(&mut live, &mut disk, root);

    assert!(!root.join("notes.tex").exists());
    assert_eq!(
        std::fs::read_to_string(root.join("renamed.tex")).unwrap(),
        "notes"
    );
    rescan(&mut live, &mut disk, root);
    assert_eq!(paths_of(&live), vec!["main.tex", "renamed.tex"]);
}

#[test]
fn a_disk_edit_is_merged_onto_newer_remote_text_instead_of_reverting_it() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let (mut live, mut disk, main) = project(root);
    let mut bases = WrittenTexts::default();
    bases.record("main.tex", "abc");
    live.local_text(&main, "abcX").unwrap();
    std::fs::write(root.join("main.tex"), "Zabc").unwrap();
    let import = read_local_changes(root, &disk, &live, None).unwrap();
    apply_local_import(&mut live, &mut disk, &mut bases, import, root).unwrap();
    assert_eq!(live.doc().text(&main).unwrap(), "ZabcX");
    assert_eq!(bases.latest("main.tex").map(String::as_str), Some("Zabc"));
}

#[test]
fn an_outside_write_from_an_older_read_keeps_the_newer_remote_text() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let (mut live, mut disk, main) = project(root);
    let mut bases = WrittenTexts::default();
    bases.record("main.tex", "abc");
    live.local_text(&main, "abcX").unwrap();
    bases.record("main.tex", "abcX");
    std::fs::write(root.join("main.tex"), "Zabc").unwrap();
    let import = read_local_changes(root, &disk, &live, None).unwrap();
    apply_local_import(&mut live, &mut disk, &mut bases, import, root).unwrap();
    assert_eq!(live.doc().text(&main).unwrap(), "ZabcX");
}

fn hashes_for(entries: &[(&str, &str)]) -> std::collections::BTreeMap<String, String> {
    entries
        .iter()
        .map(|(path, text)| ((*path).to_owned(), sha256_hex(text.as_bytes())))
        .collect()
}

#[test]
fn a_case_rename_that_arrives_as_remove_and_add_keeps_the_file() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join("data")).unwrap();
    std::fs::write(root.join("data/sites.tex"), "s").unwrap();
    let mut doc = ProjectDoc::create().unwrap();
    let folder = doc.add_node(None, "data", NodeKind::Dir, None, "").unwrap();
    let old = doc
        .add_node(Some(&folder), "sites.tex", NodeKind::Text, None, "s")
        .unwrap();
    let previous = materialize::layout(&doc.nodes().unwrap());
    doc.trash(&old).unwrap();
    doc.add_node(Some(&folder), "Sites.tex", NodeKind::Text, None, "s")
        .unwrap();
    let next = materialize::layout(&doc.nodes().unwrap());
    let mut disk = DiskState {
        layout: previous.clone(),
        hashes: hashes_for(&[("data/sites.tex", "s")]),
    };
    let plan = materialize::plan(&previous, &next);
    let texts = vec![("data/Sites.tex".to_owned(), "s".to_owned())];
    let pass = apply_to_disk(
        root,
        &mut disk,
        &mut WrittenTexts::default(),
        plan,
        next,
        &texts,
        &BTreeSet::new(),
        &|_| false,
    )
    .unwrap();
    assert!(pass.conflicts.is_empty(), "{:?}", pass.conflicts);
    if root.join("DATA").exists() || std::fs::metadata(root.join("data/SITES.TEX")).is_ok() {
        assert_eq!(
            pass.moved,
            vec![("data/sites.tex".to_owned(), "data/Sites.tex".to_owned())]
        );
    }
    assert!(super::super::disk::exists_exact(root, "data/Sites.tex"));
    assert_eq!(
        std::fs::read_to_string(root.join("data/Sites.tex")).unwrap(),
        "s"
    );
    assert!(disk.hashes.contains_key("data/Sites.tex"));
}

#[test]
fn files_in_a_folder_renamed_elsewhere_stay_writable() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join("data")).unwrap();
    std::fs::write(root.join("data/x.tex"), "x").unwrap();
    let mut doc = ProjectDoc::create().unwrap();
    let folder = doc.add_node(None, "data", NodeKind::Dir, None, "").unwrap();
    doc.add_node(Some(&folder), "x.tex", NodeKind::Text, None, "x")
        .unwrap();
    let previous = materialize::layout(&doc.nodes().unwrap());
    doc.rename(&folder, "results").unwrap();
    let next = materialize::layout(&doc.nodes().unwrap());
    let mut disk = DiskState {
        layout: previous.clone(),
        hashes: hashes_for(&[("data/x.tex", "x")]),
    };
    let plan = materialize::plan(&previous, &next);
    let texts = vec![("results/x.tex".to_owned(), "x".to_owned())];
    let pass = apply_to_disk(
        root,
        &mut disk,
        &mut WrittenTexts::default(),
        plan,
        next,
        &texts,
        &BTreeSet::new(),
        &|_| false,
    )
    .unwrap();
    assert!(pass.conflicts.is_empty(), "{:?}", pass.conflicts);
    assert_eq!(
        std::fs::read_to_string(root.join("results/x.tex")).unwrap(),
        "x"
    );
    assert_eq!(pass.moved, vec![("data".to_owned(), "results".to_owned())]);
    assert!(pass.removed.is_empty());
    assert!(!root.join("data").exists());
    assert!(disk.hashes.contains_key("results/x.tex"));
    assert!(!disk.hashes.contains_key("data/x.tex"));
}

#[test]
fn a_folder_removed_elsewhere_is_reported_once() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join("data")).unwrap();
    std::fs::write(root.join("data/x.tex"), "x").unwrap();
    std::fs::write(root.join("keep.tex"), "k").unwrap();
    let mut doc = ProjectDoc::create().unwrap();
    let folder = doc.add_node(None, "data", NodeKind::Dir, None, "").unwrap();
    doc.add_node(Some(&folder), "x.tex", NodeKind::Text, None, "x")
        .unwrap();
    doc.add_node(None, "keep.tex", NodeKind::Text, None, "k")
        .unwrap();
    let previous = materialize::layout(&doc.nodes().unwrap());
    doc.trash(&folder).unwrap();
    let next = materialize::layout(&doc.nodes().unwrap());
    let mut disk = DiskState {
        layout: previous.clone(),
        hashes: hashes_for(&[("data/x.tex", "x"), ("keep.tex", "k")]),
    };
    let plan = materialize::plan(&previous, &next);
    let pass = apply_to_disk(
        root,
        &mut disk,
        &mut WrittenTexts::default(),
        plan,
        next,
        &[],
        &BTreeSet::new(),
        &|_| false,
    )
    .unwrap();
    assert!(!root.join("data").exists());
    assert!(root.join("keep.tex").exists());
    assert_eq!(pass.removed, vec!["data".to_owned()]);
}

#[test]
fn a_file_renamed_here_keeps_its_identity() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let (mut live, mut disk, main) = project(root);
    std::fs::create_dir_all(root.join("parts")).unwrap();
    std::fs::rename(root.join("main.tex"), root.join("parts/intro.tex")).unwrap();
    let import = read_local_changes(root, &disk, &live, None).unwrap();
    apply_local_import(
        &mut live,
        &mut disk,
        &mut WrittenTexts::default(),
        import,
        root,
    )
    .unwrap();
    assert_eq!(paths_of(&live), vec!["parts", "parts/intro.tex"]);
    let layout = materialize::layout(&live.doc().nodes().unwrap());
    assert_eq!(
        layout.get(&main).map(|placed| placed.path.as_str()),
        Some("parts/intro.tex")
    );
    assert_eq!(live.doc().text(&main).unwrap(), "abc");
    assert!(disk.hashes.contains_key("parts/intro.tex"));
    assert!(!disk.hashes.contains_key("main.tex"));
}

#[test]
fn a_rename_that_only_changes_case_keeps_one_file() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let (mut live, mut disk, main) = project(root);
    let mut bases = WrittenTexts::default();
    std::fs::rename(root.join("main.tex"), root.join("tmp.tex")).unwrap();
    std::fs::rename(root.join("tmp.tex"), root.join("Main.tex")).unwrap();
    let import = read_local_changes(root, &disk, &live, None).unwrap();
    apply_local_import(&mut live, &mut disk, &mut bases, import, root).unwrap();
    assert_eq!(paths_of(&live), vec!["Main.tex"]);
    let layout = materialize::layout(&live.doc().nodes().unwrap());
    assert_eq!(
        layout.get(&main).map(|placed| placed.path.as_str()),
        Some("Main.tex")
    );
}

#[test]
fn only_a_file_left_as_last_written_may_be_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let (_live, disk, _main) = project(root);
    assert!(writable(root, &disk, "main.tex"));
    assert!(writable(root, &disk, "new.tex"));
    std::fs::write(root.join("main.tex"), "changed here").unwrap();
    assert!(!writable(root, &disk, "main.tex"));
    std::fs::write(root.join("new.tex"), "made here").unwrap();
    assert!(!writable(root, &disk, "new.tex"));
}

#[test]
fn a_file_untouched_since_it_was_written_keeps_the_newer_document_text() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let (mut live, disk, main) = project(root);
    live.local_text(&main, "remote edit").unwrap();
    let import = read_local_changes(root, &disk, &live, None).unwrap();
    assert!(import.is_empty());
}

#[test]
fn a_file_changed_again_before_import_is_left_for_the_next_pass() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let (mut live, mut disk, main) = project(root);
    std::fs::write(root.join("main.tex"), "first").unwrap();
    let import = read_local_changes(root, &disk, &live, None).unwrap();
    std::fs::write(root.join("main.tex"), "second").unwrap();
    apply_local_import(
        &mut live,
        &mut disk,
        &mut WrittenTexts::default(),
        import,
        root,
    )
    .unwrap();
    assert_eq!(live.doc().text(&main).unwrap(), "abc");
}
