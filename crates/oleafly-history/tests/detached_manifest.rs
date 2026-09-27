use std::fs;

use oleafly_history::{
    conflicting_portable_paths, CaptureInput, CompileEvidence, ContentHash, HistoryError,
    ManifestLayout, ProjectManifestBytes, SnapshotRoot, Store, DETACHED_MANIFEST_PATH,
};
use tempfile::tempdir;

const GOLDEN: &str = "3d318d99bcde77e943c1f9218045feb538fe62fee9b7ad5aa2413ed4e1a8e6aa";

fn evidence(main: &str, at: i64) -> CompileEvidence {
    CompileEvidence::new(
        "tectonic",
        "tectonic-test@1",
        main,
        ContentHash::digest(b"pdf"),
        at,
    )
    .unwrap()
}

fn explicit(paths: &[&str]) -> Vec<CaptureInput> {
    paths
        .iter()
        .map(|path| CaptureInput::explicit(*path).unwrap())
        .collect()
}

fn listed(store: &Store, root: &SnapshotRoot) -> Vec<String> {
    let mut paths = store
        .checkpoint_files(root)
        .unwrap()
        .unwrap()
        .into_iter()
        .map(|file| file.relative_path)
        .collect::<Vec<_>>();
    paths.sort();
    paths
}

#[test]
fn in_project_snapshot_roots_are_unchanged() {
    let temp = tempdir().unwrap();
    let folder = temp.path().join("project");
    fs::create_dir(&folder).unwrap();
    fs::write(folder.join("project.json"), b"{}").unwrap();
    fs::write(folder.join("main.tex"), b"source").unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();
    let candidate = store
        .stage_candidate(&folder, &explicit(&["main.tex", "project.json"]))
        .unwrap();
    assert_eq!(candidate.snapshot_root().to_string(), GOLDEN);
}

#[test]
fn a_detached_manifest_is_sealed_from_outside_the_folder_and_project_json_stays_content() {
    let temp = tempdir().unwrap();
    let folder = temp.path().join("folder");
    let state = temp.path().join("state");
    fs::create_dir_all(&folder).unwrap();
    fs::create_dir_all(&state).unwrap();
    let foreign: &[u8] = br#"{"name":"nx-app","targets":{}}"#;
    fs::write(folder.join("project.json"), foreign).unwrap();
    fs::write(folder.join("main.tex"), b"\\documentclass{article}").unwrap();
    let sidecar = state.join("project.json");
    fs::write(
        &sidecar,
        br#"{"name":"Thesis","main_doc":"main.tex","engine":"tectonic"}"#,
    )
    .unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();
    let mut inputs = explicit(&["main.tex", "project.json"]);
    inputs.push(CaptureInput::detached_manifest(&sidecar));

    let candidate = store.stage_detached_candidate(&folder, &inputs).unwrap();
    let root = *candidate.snapshot_root();
    store.publish(candidate, evidence("main.tex", 1)).unwrap();

    assert_eq!(
        listed(&store, &root),
        vec![DETACHED_MANIFEST_PATH, "main.tex", "project.json"]
    );
    assert_eq!(
        store.checkpoint_layout(&root).unwrap(),
        Some(ManifestLayout::Detached)
    );
    let restored = temp.path().join("restored");
    let materialized = store.materialize(&root, &restored).unwrap();
    assert_eq!(materialized.layout, ManifestLayout::Detached);
    assert_eq!(fs::read(restored.join("project.json")).unwrap(), foreign);
    assert_eq!(
        fs::read(restored.join(DETACHED_MANIFEST_PATH)).unwrap(),
        fs::read(&sidecar).unwrap()
    );
    assert!(!folder.join(DETACHED_MANIFEST_PATH).exists());
}

#[test]
fn a_detached_layout_needs_no_manifest_while_the_in_project_layout_still_does() {
    let temp = tempdir().unwrap();
    let folder = temp.path().join("folder");
    fs::create_dir_all(&folder).unwrap();
    fs::write(folder.join("main.typ"), b"= Title").unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();
    assert!(matches!(
        store.stage_candidate(&folder, &explicit(&["main.typ"])),
        Err(HistoryError::MissingProjectManifest)
    ));
    let candidate = store
        .stage_detached_candidate(&folder, &explicit(&["main.typ"]))
        .unwrap();
    let root = *candidate.snapshot_root();
    store.publish(candidate, evidence("main.typ", 1)).unwrap();
    assert_eq!(listed(&store, &root), vec!["main.typ"]);
    assert_eq!(
        store.checkpoint_layout(&root).unwrap(),
        Some(ManifestLayout::Detached)
    );
}

#[test]
fn the_detached_path_is_reserved_and_detached_inputs_need_the_detached_layout() {
    let temp = tempdir().unwrap();
    let folder = temp.path().join("folder");
    fs::create_dir_all(&folder).unwrap();
    for name in [DETACHED_MANIFEST_PATH, "main.tex", "project.json"] {
        fs::write(folder.join(name), b"{}").unwrap();
    }
    let sidecar = temp.path().join("sidecar.json");
    fs::write(&sidecar, b"{}").unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();
    assert!(matches!(
        store.stage_detached_candidate(&folder, &explicit(&[DETACHED_MANIFEST_PATH, "main.tex"])),
        Err(HistoryError::InvalidInput(_))
    ));
    let mut library = explicit(&["main.tex", "project.json"]);
    library.push(CaptureInput::detached_manifest(&sidecar));
    assert!(matches!(
        store.stage_candidate(&folder, &library),
        Err(HistoryError::InvalidInput(_))
    ));
    store
        .stage_candidate(
            &folder,
            &explicit(&[DETACHED_MANIFEST_PATH, "main.tex", "project.json"]),
        )
        .unwrap();
}

#[test]
fn layouts_never_share_a_snapshot_root() {
    let temp = tempdir().unwrap();
    let folder = temp.path().join("folder");
    fs::create_dir_all(&folder).unwrap();
    fs::write(folder.join("project.json"), b"{}").unwrap();
    fs::write(folder.join("main.tex"), b"source").unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();
    let in_project = *store
        .stage_candidate(&folder, &explicit(&["main.tex", "project.json"]))
        .unwrap()
        .snapshot_root();
    let detached = *store
        .stage_detached_candidate(&folder, &explicit(&["main.tex", "project.json"]))
        .unwrap()
        .snapshot_root();
    assert_ne!(in_project, detached);
}

#[test]
fn a_detached_history_exports_and_imports_with_its_manifest_bytes() {
    let temp = tempdir().unwrap();
    let folder = temp.path().join("folder");
    fs::create_dir_all(&folder).unwrap();
    let sidecar = temp.path().join("sidecar.json");
    let settings: &[u8] = br#"{"name":"Thesis","main_doc":"main.tex"}"#;
    fs::write(&sidecar, settings).unwrap();
    let source = Store::open(temp.path().join("history")).unwrap();
    fs::write(folder.join("main.tex"), b"one").unwrap();
    let mut inputs = explicit(&["main.tex"]);
    inputs.push(CaptureInput::detached_manifest(&sidecar));
    let candidate = source.stage_detached_candidate(&folder, &inputs).unwrap();
    source.publish(candidate, evidence("main.tex", 1)).unwrap();
    fs::write(folder.join("main.tex"), b"two").unwrap();
    let candidate = source
        .stage_detached_candidate(&folder, &explicit(&["main.tex"]))
        .unwrap();
    source.publish(candidate, evidence("main.tex", 2)).unwrap();
    let mut archive = Vec::new();
    source.export_history(&mut archive).unwrap();

    let destination = Store::open(temp.path().join("imported")).unwrap();
    let mut seen = Vec::new();
    destination
        .import_history_validated(archive.as_slice(), |_, _, manifest| {
            seen.push(match manifest {
                ProjectManifestBytes::InProject(bytes) => ("in_project", Some(bytes.to_vec())),
                ProjectManifestBytes::Detached(bytes) => ("detached", bytes.map(<[u8]>::to_vec)),
            });
            Ok(())
        })
        .unwrap();
    assert_eq!(
        seen,
        vec![("detached", Some(settings.to_vec())), ("detached", None)]
    );
    assert_eq!(destination.list().unwrap(), source.list().unwrap());
}

#[test]
fn a_single_detached_checkpoint_round_trips_through_the_portable_stream() {
    let temp = tempdir().unwrap();
    let folder = temp.path().join("folder");
    fs::create_dir_all(&folder).unwrap();
    let sidecar = temp.path().join("sidecar.json");
    fs::write(&sidecar, br#"{"name":"Thesis","main_doc":"main.tex"}"#).unwrap();
    fs::write(folder.join("main.tex"), b"one").unwrap();
    let source = Store::open(temp.path().join("history")).unwrap();
    let mut inputs = explicit(&["main.tex"]);
    inputs.push(CaptureInput::detached_manifest(&sidecar));
    let candidate = source.stage_detached_candidate(&folder, &inputs).unwrap();
    let root = *candidate.snapshot_root();
    source.publish(candidate, evidence("main.tex", 1)).unwrap();
    let mut stream = Vec::new();
    source.export_checkpoint(&root, &mut stream).unwrap();

    let destination = Store::open(temp.path().join("imported")).unwrap();
    destination.import_checkpoint(stream.as_slice()).unwrap();
    assert_eq!(
        listed(&destination, &root),
        vec![DETACHED_MANIFEST_PATH, "main.tex"]
    );
    assert_eq!(
        destination.checkpoint_layout(&root).unwrap(),
        Some(ManifestLayout::Detached)
    );
}

#[test]
fn conflicting_portable_paths_keep_one_spelling_and_drop_descendants_of_files() {
    let dropped =
        conflicting_portable_paths(["main.tex", "Main.tex", "a", "a.txt", "A/b", "figs/x.png"]);
    assert_eq!(
        dropped.into_iter().collect::<Vec<_>>(),
        vec!["A/b".to_string(), "main.tex".to_string()]
    );
}

#[cfg(unix)]
#[test]
fn a_linked_detached_manifest_is_refused() {
    let temp = tempdir().unwrap();
    let folder = temp.path().join("folder");
    fs::create_dir_all(&folder).unwrap();
    fs::write(folder.join("main.tex"), b"x").unwrap();
    let real = temp.path().join("real.json");
    fs::write(&real, b"{}").unwrap();
    let link = temp.path().join("link.json");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();
    let mut inputs = explicit(&["main.tex"]);
    inputs.push(CaptureInput::detached_manifest(&link));
    assert!(store.stage_detached_candidate(&folder, &inputs).is_err());
}
