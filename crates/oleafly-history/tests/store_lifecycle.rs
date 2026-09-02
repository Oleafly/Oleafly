use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::sync::{mpsc, Arc, Barrier};
use std::thread;
use std::time::Duration;

use oleafly_history::{
    Candidate, CaptureInput, CompileEvidence, ContentHash, PublishOutcome, ReplayedInput, Store,
};
use rusqlite::Connection;
use tempfile::tempdir;

fn capture_inputs(project: &std::path::Path, paths: &[&str]) -> Vec<CaptureInput> {
    paths
        .iter()
        .map(|path| {
            if *path == "project.json" {
                CaptureInput::explicit(*path).unwrap()
            } else {
                CaptureInput::proven(
                    *path,
                    project.join(path).canonicalize().unwrap(),
                    ContentHash::digest(&fs::read(project.join(path)).unwrap()),
                )
                .unwrap()
            }
        })
        .collect()
}

fn evidence_with_output(
    candidate: &Candidate,
    completed_at_unix_ms: i64,
    output: &[u8],
) -> CompileEvidence {
    let main_document = candidate
        .proven_files()
        .iter()
        .find(|file| file.relative_path.rsplit('/').next() == Some("main.tex"))
        .expect("test candidate has a proven main document")
        .relative_path
        .clone();
    CompileEvidence::new(
        "tectonic",
        "tectonic-test@1",
        main_document,
        ContentHash::digest(output),
        completed_at_unix_ms,
        candidate
            .proven_files()
            .iter()
            .map(|file| ReplayedInput::new(&file.relative_path, file.content_hash).unwrap())
            .collect(),
    )
    .expect("valid compile evidence")
}

fn evidence(candidate: &Candidate, completed_at_unix_ms: i64) -> CompileEvidence {
    evidence_with_output(candidate, completed_at_unix_ms, b"validated-pdf")
}

fn publish(
    store: &Store,
    candidate: Candidate,
    completed_at_unix_ms: i64,
) -> oleafly_history::Result<PublishOutcome> {
    let evidence = evidence(&candidate, completed_at_unix_ms);
    store.publish(candidate, evidence)
}

#[test]
fn explicit_inputs_publish_once_without_capturing_unlisted_files() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), br#"{"main":"main.tex"}"#).unwrap();
    fs::write(project.join("main.tex"), b"first source").unwrap();
    fs::write(project.join("unused-large.bin"), vec![7_u8; 256 * 1024]).unwrap();

    let store = Store::open(temp.path().join("history")).unwrap();
    let inputs = capture_inputs(&project, &["project.json", "main.tex"]);

    let first = store.stage_candidate(&project, &inputs).unwrap();
    assert_eq!(
        fs::read(first.sealed_root().join("main.tex")).unwrap(),
        b"first source"
    );
    assert!(!first.sealed_root().join("unused-large.bin").exists());
    let first_root = *first.snapshot_root();

    assert!(matches!(
        publish(&store, first, 10).unwrap(),
        PublishOutcome::Created(checkpoint) if checkpoint.snapshot_root == first_root
    ));
    let stats_after_first = store.stats().unwrap();

    let repeated = store.stage_candidate(&project, &inputs).unwrap();
    assert_eq!(repeated.snapshot_root(), &first_root);
    let repeated_evidence = evidence_with_output(&repeated, 20, b"revalidated-pdf");
    assert!(matches!(
        store.publish(repeated, repeated_evidence).unwrap(),
        PublishOutcome::Existing(checkpoint) if checkpoint.snapshot_root == first_root
    ));

    let checkpoints = store.list().unwrap();
    assert_eq!(checkpoints.len(), 1);
    assert_eq!(checkpoints[0].completed_at_unix_ms, 20);
    assert_eq!(
        checkpoints[0].output_hash,
        ContentHash::digest(b"revalidated-pdf")
    );
    assert_eq!(store.stats().unwrap(), stats_after_first);
}

#[test]
fn repeated_root_becomes_newest_and_keep_latest_uses_catalog_sequence() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), br#"{"main":"main.tex"}"#).unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();

    fs::write(project.join("main.tex"), b"source-a").unwrap();
    let first_a = store
        .stage_candidate(
            &project,
            &capture_inputs(&project, &["project.json", "main.tex"]),
        )
        .unwrap();
    let root_a = *first_a.snapshot_root();
    assert!(matches!(
        publish(&store, first_a, 100).unwrap(),
        PublishOutcome::Created(checkpoint) if checkpoint.snapshot_root == root_a
    ));

    fs::write(project.join("main.tex"), b"source-b").unwrap();
    let candidate_b = store
        .stage_candidate(
            &project,
            &capture_inputs(&project, &["project.json", "main.tex"]),
        )
        .unwrap();
    let root_b = *candidate_b.snapshot_root();
    assert!(matches!(
        publish(&store, candidate_b, 200).unwrap(),
        PublishOutcome::Created(checkpoint) if checkpoint.snapshot_root == root_b
    ));

    fs::write(project.join("main.tex"), b"source-a").unwrap();
    let repeated_a = store
        .stage_candidate(
            &project,
            &capture_inputs(&project, &["project.json", "main.tex"]),
        )
        .unwrap();
    assert_eq!(repeated_a.snapshot_root(), &root_a);
    assert!(matches!(
        publish(&store, repeated_a, 50).unwrap(),
        PublishOutcome::Existing(checkpoint)
            if checkpoint.snapshot_root == root_a && checkpoint.completed_at_unix_ms == 50
    ));

    let listed = store.list().unwrap();
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].snapshot_root, root_a);
    assert_eq!(listed[0].completed_at_unix_ms, 50);
    assert_eq!(listed[1].snapshot_root, root_b);
    assert_eq!(listed[1].completed_at_unix_ms, 200);

    assert_eq!(store.keep_latest().unwrap(), 1);
    let retained = store.list().unwrap();
    assert_eq!(retained.len(), 1);
    assert_eq!(retained[0].snapshot_root, root_a);
}

#[test]
fn retention_removes_visible_roots_before_reclaiming_unreachable_packs() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), br#"{"main":"main.tex"}"#).unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();

    let mut roots = Vec::new();
    for (index, source) in ["one", "two", "three"].into_iter().enumerate() {
        fs::write(project.join("main.tex"), source).unwrap();
        let inputs = capture_inputs(&project, &["project.json", "main.tex"]);
        let candidate = store.stage_candidate(&project, &inputs).unwrap();
        roots.push(*candidate.snapshot_root());
        publish(&store, candidate, (index + 1) as i64).unwrap();
    }

    let listed = store.list().unwrap();
    assert_eq!(
        listed
            .iter()
            .map(|checkpoint| checkpoint.completed_at_unix_ms)
            .collect::<Vec<_>>(),
        vec![3, 2, 1]
    );
    let packs_before_delete = store.stats().unwrap().pack_count;

    assert!(store.delete_checkpoint(&roots[1]).unwrap());
    assert!(!store.delete_checkpoint(&roots[1]).unwrap());
    assert!(store.checkpoint(&roots[1]).unwrap().is_none());
    assert_eq!(store.stats().unwrap().pack_count, packs_before_delete);
    assert!(store.stats().unwrap().reclaimable_pack_bytes > 0);

    let first_gc = store.garbage_collect().unwrap();
    assert_eq!(first_gc.deleted_packs, 1);
    assert_eq!(store.stats().unwrap().pack_count, packs_before_delete - 1);

    assert_eq!(store.keep_latest().unwrap(), 1);
    assert_eq!(store.list().unwrap()[0].snapshot_root, roots[2]);
    assert_eq!(store.reset().unwrap(), 1);
    assert!(store.list().unwrap().is_empty());
    assert_eq!(
        fs::read_to_string(project.join("main.tex")).unwrap(),
        "three"
    );

    let final_gc = store.garbage_collect().unwrap();
    assert!(final_gc.deleted_packs >= 1);
    let final_stats = store.stats().unwrap();
    assert_eq!(final_stats.checkpoint_count, 0);
    assert_eq!(final_stats.manifest_count, 0);
    assert_eq!(final_stats.pack_count, 0);
    assert_eq!(final_stats.chunk_count, 0);
    assert_eq!(final_stats.stored_pack_bytes, 0);
}

#[test]
fn read_only_open_and_candidate_evidence_preserve_lazy_store_creation() {
    let temp = tempdir().unwrap();
    let history = temp.path().join("history");
    assert!(Store::open_existing(&history).unwrap().is_none());
    assert!(!history.exists());

    let project = temp.path().join("project");
    fs::create_dir_all(project.join("chapters")).unwrap();
    let project_json = br#"{"main":"chapters/main.tex"}"#;
    let source = b"sealed source";
    fs::write(project.join("project.json"), project_json).unwrap();
    fs::write(project.join("chapters/main.tex"), source).unwrap();
    let inputs = capture_inputs(&project, &["chapters/main.tex", "project.json"]);

    let store = Store::open(&history).unwrap();
    let candidate = store.stage_candidate(&project, &inputs).unwrap();
    let files = candidate.sealed_files();
    assert_eq!(files.len(), 2);
    assert_eq!(files[0].relative_path, "chapters/main.tex");
    assert_eq!(files[0].content_hash, ContentHash::digest(source));
    assert_eq!(files[1].relative_path, "project.json");
    assert_eq!(files[1].content_hash, ContentHash::digest(project_json));
    let root_text = candidate.snapshot_root().to_string();
    assert_eq!(
        oleafly_history::SnapshotRoot::parse(&root_text).unwrap(),
        *candidate.snapshot_root()
    );
    assert!(oleafly_history::SnapshotRoot::parse("not-a-root").is_err());
    publish(&store, candidate, 30).unwrap();

    let reopened = Store::open_existing(&history).unwrap().unwrap();
    let checkpoint = reopened.list().unwrap().pop().unwrap();
    assert_eq!(checkpoint.file_count, 2);
    assert_eq!(
        checkpoint.logical_bytes,
        (project_json.len() + source.len()) as u64
    );
}

#[test]
fn concurrent_first_open_uses_one_complete_format_marker() {
    let temp = tempdir().unwrap();
    let history = temp.path().join("history");
    let barrier = Arc::new(Barrier::new(12));
    let mut threads = Vec::new();
    for _ in 0..12 {
        let history = history.clone();
        let barrier = Arc::clone(&barrier);
        threads.push(thread::spawn(move || {
            barrier.wait();
            Store::open(history)
        }));
    }
    for worker in threads {
        worker.join().unwrap().unwrap();
    }
    assert_eq!(
        Store::open_existing(&history)
            .unwrap()
            .unwrap()
            .list()
            .unwrap(),
        vec![]
    );
}

#[test]
fn materialization_rehashes_the_root_and_rejects_corrupt_payloads() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(project.join("chapters")).unwrap();
    fs::write(project.join("project.json"), br#"{"main":"main.tex"}"#).unwrap();
    fs::write(project.join("main.tex"), b"root input").unwrap();
    fs::write(project.join("chapters/one.tex"), b"nested input").unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();
    let inputs = capture_inputs(&project, &["project.json", "main.tex", "chapters/one.tex"]);
    let candidate = store.stage_candidate(&project, &inputs).unwrap();
    let root = *candidate.snapshot_root();
    publish(&store, candidate, 40).unwrap();

    let verified = store.verify().unwrap();
    assert_eq!(verified.checked_checkpoints, 1);
    assert_eq!(verified.checked_files, 3);
    assert!(verified.checked_chunk_references >= 3);

    let restored = temp.path().join("restored");
    let result = store.materialize(&root, &restored).unwrap();
    assert_eq!(result.file_count, 3);
    assert_eq!(fs::read(restored.join("main.tex")).unwrap(), b"root input");
    assert_eq!(
        fs::read(restored.join("chapters/one.tex")).unwrap(),
        b"nested input"
    );

    let pack = fs::read_dir(store.root().join("packs"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let mut file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(pack)
        .unwrap();
    let final_offset = file.seek(SeekFrom::End(-1)).unwrap();
    let mut byte = [0_u8; 1];
    file.read_exact(&mut byte).unwrap();
    file.seek(SeekFrom::Start(final_offset)).unwrap();
    file.write_all(&[byte[0] ^ 0xff]).unwrap();
    file.sync_all().unwrap();

    assert!(store.verify().is_err());
    let corrupt_destination = temp.path().join("corrupt-restored");
    assert!(store.materialize(&root, &corrupt_destination).is_err());
    assert!(!corrupt_destination.exists());
}

#[test]
fn catalog_pack_names_cannot_escape_the_pack_directory() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"source").unwrap();
    let history = temp.path().join("history");
    let store = Store::open(&history).unwrap();
    let candidate = store
        .stage_candidate(
            &project,
            &capture_inputs(&project, &["project.json", "main.tex"]),
        )
        .unwrap();
    let root = *candidate.snapshot_root();
    publish(&store, candidate, 45).unwrap();

    let victim = temp.path().join("victim");
    fs::write(&victim, b"must remain untouched").unwrap();
    let catalog = Connection::open(history.join("catalog.sqlite3")).unwrap();
    catalog
        .execute("UPDATE packs SET file_name = '../../victim'", [])
        .unwrap();

    assert!(store.verify().is_err());
    let destination = temp.path().join("escaped-materialization");
    assert!(store.materialize(&root, &destination).is_err());
    assert!(!destination.exists());
    assert_eq!(fs::read(&victim).unwrap(), b"must remain untouched");
}

#[test]
fn verification_checks_checkpoint_summary_and_compile_evidence() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"source").unwrap();
    let history = temp.path().join("history");
    let store = Store::open(&history).unwrap();
    let candidate = store
        .stage_candidate(
            &project,
            &capture_inputs(&project, &["project.json", "main.tex"]),
        )
        .unwrap();
    publish(&store, candidate, 45).unwrap();
    let catalog = Connection::open(history.join("catalog.sqlite3")).unwrap();

    catalog
        .execute(
            "UPDATE checkpoints SET logical_bytes = logical_bytes + 1",
            [],
        )
        .unwrap();
    assert!(store.verify().is_err());
    catalog
        .execute(
            "UPDATE checkpoints SET logical_bytes = logical_bytes - 1, main_document = 'missing.tex'",
            [],
        )
        .unwrap();
    assert!(store.verify().is_err());
}

#[test]
fn garbage_collection_validates_pack_names_before_catalog_mutation() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"source").unwrap();
    let history = temp.path().join("history");
    let store = Store::open(&history).unwrap();
    let candidate = store
        .stage_candidate(
            &project,
            &capture_inputs(&project, &["project.json", "main.tex"]),
        )
        .unwrap();
    let root = *candidate.snapshot_root();
    publish(&store, candidate, 46).unwrap();
    assert!(store.delete_checkpoint(&root).unwrap());

    let victim = temp.path().join("victim");
    fs::write(&victim, b"must remain untouched").unwrap();
    let catalog = Connection::open(history.join("catalog.sqlite3")).unwrap();
    catalog
        .execute("UPDATE packs SET file_name = '../../victim'", [])
        .unwrap();

    assert!(store.garbage_collect().is_err());
    let pack_count: i64 = catalog
        .query_row("SELECT COUNT(*) FROM packs", [], |row| row.get(0))
        .unwrap();
    assert_eq!(pack_count, 1);
    assert_eq!(fs::read(&victim).unwrap(), b"must remain untouched");
}

#[test]
fn fastcdc_streaming_reuses_unchanged_chunks_and_compresses_only_when_smaller() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), br#"{"main":"main.tex"}"#).unwrap();
    let mut source = vec![b'a'; 10 * 1024 * 1024];
    fs::write(project.join("main.tex"), &source).unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();
    let inputs = capture_inputs(&project, &["project.json", "main.tex"]);
    let first = store.stage_candidate(&project, &inputs).unwrap();
    let main_file = first
        .sealed_files()
        .into_iter()
        .find(|file| file.relative_path == "main.tex")
        .unwrap();
    assert!(main_file.chunk_count >= 3);
    publish(&store, first, 50).unwrap();
    let first_stats = store.stats().unwrap();
    assert!(first_stats.chunk_count >= 2);
    assert!(first_stats.compressed_chunk_count >= 1);
    assert!(first_stats.raw_chunk_count >= 1);
    assert!(first_stats.max_raw_chunk_bytes <= 4 * 1024 * 1024);
    assert!(first_stats.stored_chunk_bytes <= first_stats.logical_chunk_bytes);

    source[5 * 1024 * 1024] = b'b';
    fs::write(project.join("main.tex"), &source).unwrap();
    let inputs = capture_inputs(&project, &["project.json", "main.tex"]);
    let changed = store.stage_candidate(&project, &inputs).unwrap();
    publish(&store, changed, 60).unwrap();
    let changed_stats = store.stats().unwrap();
    assert!(changed_stats.chunk_count > first_stats.chunk_count);
    assert!(
        changed_stats.logical_chunk_bytes - first_stats.logical_chunk_bytes
            <= 2 * first_stats.max_raw_chunk_bytes
    );
}

#[test]
fn portable_checkpoint_stream_imports_atomically_and_deduplicates() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), br#"{"main":"main.tex"}"#).unwrap();
    fs::write(project.join("main.tex"), b"portable source").unwrap();
    let source_store = Store::open(temp.path().join("source-history")).unwrap();
    let inputs = capture_inputs(&project, &["project.json", "main.tex"]);
    let candidate = source_store.stage_candidate(&project, &inputs).unwrap();
    let root = *candidate.snapshot_root();
    publish(&source_store, candidate, 70).unwrap();

    let mut archive = Vec::new();
    let exported = source_store.export_checkpoint(&root, &mut archive).unwrap();
    assert_eq!(exported.snapshot_root, root);
    assert_eq!(exported.file_count, 2);
    assert_eq!(exported.logical_bytes, 34);

    let imported_store = Store::open(temp.path().join("imported-history")).unwrap();
    assert!(matches!(
        imported_store.import_checkpoint(archive.as_slice()).unwrap(),
        PublishOutcome::Created(checkpoint) if checkpoint.snapshot_root == root
    ));
    let stats_after_first = imported_store.stats().unwrap();
    assert!(matches!(
        imported_store.import_checkpoint(archive.as_slice()).unwrap(),
        PublishOutcome::Existing(checkpoint) if checkpoint.snapshot_root == root
    ));
    assert_eq!(imported_store.stats().unwrap(), stats_after_first);
    let imported = imported_store.list().unwrap().pop().unwrap();
    assert_eq!(imported.toolchain_identity, "tectonic-test@1");
    assert_eq!(imported.replayed_inputs().len(), 1);
    assert_eq!(imported.replayed_inputs()[0].relative_path, "main.tex");
    assert_eq!(
        imported.replayed_inputs()[0].content_hash,
        ContentHash::digest(b"portable source")
    );

    let truncated_store = Store::open(temp.path().join("truncated-history")).unwrap();
    assert!(truncated_store
        .import_checkpoint(&archive[..archive.len() - 1])
        .is_err());
    assert!(truncated_store.list().unwrap().is_empty());
    assert_eq!(truncated_store.stats().unwrap().pack_count, 0);
}

#[test]
fn full_history_import_is_atomic_when_the_last_entry_is_truncated() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    let source_store = Store::open(temp.path().join("source-history")).unwrap();
    for (time, source) in [(100, "first"), (110, "second")] {
        fs::write(project.join("main.tex"), source).unwrap();
        let inputs = capture_inputs(&project, &["project.json", "main.tex"]);
        let candidate = source_store.stage_candidate(&project, &inputs).unwrap();
        publish(&source_store, candidate, time).unwrap();
    }

    let mut archive = Vec::new();
    let exported = source_store.export_history(&mut archive).unwrap();
    assert_eq!(exported.checkpoint_count, 2);
    assert_eq!(exported.logical_bytes, 15);

    let imported_store = Store::open(temp.path().join("imported-history")).unwrap();
    let imported = imported_store.import_history(archive.as_slice()).unwrap();
    assert_eq!(imported.created_checkpoints, 2);
    assert_eq!(imported.existing_checkpoints, 0);
    assert_eq!(
        imported_store
            .list()
            .unwrap()
            .iter()
            .map(|checkpoint| checkpoint.completed_at_unix_ms)
            .collect::<Vec<_>>(),
        vec![110, 100]
    );
    let imported_stats = imported_store.stats().unwrap();
    assert_eq!(imported_stats.visible_logical_bytes, 15);
    let repeated = imported_store.import_history(archive.as_slice()).unwrap();
    assert_eq!(repeated.created_checkpoints, 0);
    assert_eq!(repeated.existing_checkpoints, 2);
    assert_eq!(imported_store.stats().unwrap(), imported_stats);

    let truncated_store = Store::open(temp.path().join("truncated-history")).unwrap();
    assert!(truncated_store
        .import_history(&archive[..archive.len() - 1])
        .is_err());
    assert!(truncated_store.list().unwrap().is_empty());
    assert_eq!(truncated_store.stats().unwrap().pack_count, 0);
    assert_eq!(
        truncated_store
            .import_history(archive.as_slice())
            .unwrap()
            .created_checkpoints,
        2
    );
}

#[test]
fn importing_older_history_does_not_replace_the_latest_local_checkpoint() {
    let temp = tempdir().unwrap();
    let old_project = temp.path().join("old-project");
    fs::create_dir_all(&old_project).unwrap();
    fs::write(old_project.join("project.json"), b"{}").unwrap();
    fs::write(old_project.join("main.tex"), b"old source").unwrap();
    let old_store = Store::open(temp.path().join("old-history")).unwrap();
    let inputs = capture_inputs(&old_project, &["project.json", "main.tex"]);
    let old_candidate = old_store.stage_candidate(&old_project, &inputs).unwrap();
    let old_root = *old_candidate.snapshot_root();
    publish(&old_store, old_candidate, 30).unwrap();
    let mut archive = Vec::new();
    old_store.export_history(&mut archive).unwrap();

    let current_project = temp.path().join("current-project");
    fs::create_dir_all(&current_project).unwrap();
    fs::write(current_project.join("project.json"), b"{}").unwrap();
    fs::write(current_project.join("main.tex"), b"current source").unwrap();
    let current_store = Store::open(temp.path().join("current-history")).unwrap();
    current_store.import_history(archive.as_slice()).unwrap();
    let inputs = capture_inputs(&current_project, &["project.json", "main.tex"]);
    let current_candidate = current_store
        .stage_candidate(&current_project, &inputs)
        .unwrap();
    publish(&current_store, current_candidate, 20).unwrap();
    assert!(current_store.delete_checkpoint(&old_root).unwrap());

    let repeated = current_store.import_history(archive.as_slice()).unwrap();
    assert_eq!(repeated.created_checkpoints, 1);
    assert_eq!(repeated.existing_checkpoints, 0);
    assert_eq!(
        current_store
            .list()
            .unwrap()
            .iter()
            .map(|checkpoint| checkpoint.completed_at_unix_ms)
            .collect::<Vec<_>>(),
        vec![20, 30]
    );
    assert_eq!(current_store.keep_latest().unwrap(), 1);
    assert_eq!(current_store.list().unwrap()[0].completed_at_unix_ms, 20);
}

#[test]
fn nonempty_store_rejects_a_foreign_history_lineage() {
    let temp = tempdir().unwrap();
    let source_project = temp.path().join("source-project");
    fs::create_dir_all(&source_project).unwrap();
    fs::write(source_project.join("project.json"), b"{}").unwrap();
    fs::write(source_project.join("main.tex"), b"source").unwrap();
    let source_store = Store::open(temp.path().join("source-history")).unwrap();
    let candidate = source_store
        .stage_candidate(
            &source_project,
            &capture_inputs(&source_project, &["project.json", "main.tex"]),
        )
        .unwrap();
    publish(&source_store, candidate, 10).unwrap();
    let mut archive = Vec::new();
    source_store.export_history(&mut archive).unwrap();

    let destination_project = temp.path().join("destination-project");
    fs::create_dir_all(&destination_project).unwrap();
    fs::write(destination_project.join("project.json"), b"{}").unwrap();
    fs::write(destination_project.join("main.tex"), b"destination").unwrap();
    let destination_store = Store::open(temp.path().join("destination-history")).unwrap();
    let candidate = destination_store
        .stage_candidate(
            &destination_project,
            &capture_inputs(&destination_project, &["project.json", "main.tex"]),
        )
        .unwrap();
    publish(&destination_store, candidate, 20).unwrap();
    let before = destination_store.list().unwrap();

    let error = destination_store
        .import_history(archive.as_slice())
        .unwrap_err();
    assert!(error.to_string().contains("different Checkpoints store"));
    assert_eq!(destination_store.list().unwrap(), before);
}

#[test]
fn protected_internal_roots_are_never_valid_capture_inputs() {
    for path in [
        ".git/config",
        ".GIT/config",
        ".git/objects/aa/bb",
        ".oleafly/build/main.pdf",
        ".OLEAFLY/build/main.pdf",
        ".oleafly/checkpoints/data",
    ] {
        assert!(
            CaptureInput::explicit(path).is_err(),
            "accepted protected path {path}"
        );
    }
}

#[cfg(unix)]
#[test]
fn capture_rejects_a_symlinked_ancestor_even_when_it_resolves_inside_the_project() {
    use std::os::unix::fs::symlink;

    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(project.join(".git")).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join(".git/config"), b"private git config").unwrap();
    symlink(".git", project.join("alias")).unwrap();

    let store = Store::open(temp.path().join("history")).unwrap();
    let inputs = [
        CaptureInput::explicit("project.json").unwrap(),
        CaptureInput::explicit("alias/config").unwrap(),
    ];

    let error = store.stage_candidate(&project, &inputs).unwrap_err();
    assert!(
        error.to_string().contains("symbolic link"),
        "unexpected error: {error}"
    );
}

#[test]
fn a_deleted_root_can_be_published_again_before_garbage_collection() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"same source").unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();
    let inputs = capture_inputs(&project, &["project.json", "main.tex"]);
    let first = store.stage_candidate(&project, &inputs).unwrap();
    let root = *first.snapshot_root();
    publish(&store, first, 80).unwrap();
    let stats_before_delete = store.stats().unwrap();
    assert!(store.delete_checkpoint(&root).unwrap());

    let repeated = store.stage_candidate(&project, &inputs).unwrap();
    assert!(matches!(
        publish(&store, repeated, 90).unwrap(),
        PublishOutcome::Created(checkpoint)
            if checkpoint.snapshot_root == root && checkpoint.completed_at_unix_ms == 90
    ));
    assert_eq!(
        store.stats().unwrap().pack_count,
        stats_before_delete.pack_count
    );
}

#[test]
fn staging_rejects_same_size_changes_after_the_compiler_first_read() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"first").unwrap();
    let inputs = capture_inputs(&project, &["project.json", "main.tex"]);

    fs::write(project.join("main.tex"), b"other").unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();
    let error = store.stage_candidate(&project, &inputs).unwrap_err();
    assert!(
        error.to_string().contains("after the compiler first read"),
        "unexpected error: {error}"
    );
}

#[test]
fn staging_rejects_a_resolved_identity_mismatch() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"source").unwrap();
    let inputs = [
        CaptureInput::explicit("project.json").unwrap(),
        CaptureInput::proven(
            "main.tex",
            project.join("project.json").canonicalize().unwrap(),
            ContentHash::digest(b"source"),
        )
        .unwrap(),
    ];

    let store = Store::open(temp.path().join("history")).unwrap();
    let error = store.stage_candidate(&project, &inputs).unwrap_err();
    assert!(
        error.to_string().contains("resolved as"),
        "unexpected error: {error}"
    );
}

#[test]
fn publication_requires_exact_replay_evidence_and_a_proven_main_document() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"source").unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();

    let explicit_candidate = store
        .stage_candidate(
            &project,
            &[
                CaptureInput::explicit("project.json").unwrap(),
                CaptureInput::explicit("main.tex").unwrap(),
            ],
        )
        .unwrap();
    let missing_main_evidence = CompileEvidence::new(
        "tectonic",
        "tectonic-test@1",
        "main.tex",
        ContentHash::digest(b"validated-pdf"),
        1,
        Vec::new(),
    )
    .unwrap();
    let error = store
        .publish(explicit_candidate, missing_main_evidence)
        .unwrap_err();
    assert!(error.to_string().contains("lacks first-read"));

    let inputs = capture_inputs(&project, &["project.json", "main.tex"]);
    let candidate = store.stage_candidate(&project, &inputs).unwrap();
    let unexpected_replay = CompileEvidence::new(
        "tectonic",
        "tectonic-test@1",
        "main.tex",
        ContentHash::digest(b"validated-pdf"),
        2,
        vec![
            ReplayedInput::new("main.tex", ContentHash::digest(b"source")).unwrap(),
            ReplayedInput::new("unexpected.tex", ContentHash::digest(b"unexpected")).unwrap(),
        ],
    )
    .unwrap();
    let error = store.publish(candidate, unexpected_replay).unwrap_err();
    assert!(error
        .to_string()
        .contains("not present in the sealed candidate"));

    fs::write(project.join("chapter.tex"), b"chapter").unwrap();
    let inputs = capture_inputs(&project, &["project.json", "main.tex", "chapter.tex"]);
    let candidate = store.stage_candidate(&project, &inputs).unwrap();
    let missing_replay = CompileEvidence::new(
        "tectonic",
        "tectonic-test@1",
        "main.tex",
        ContentHash::digest(b"validated-pdf"),
        3,
        vec![ReplayedInput::new("main.tex", ContentHash::digest(b"source")).unwrap()],
    )
    .unwrap();
    let error = store.publish(candidate, missing_replay).unwrap_err();
    assert!(error.to_string().contains("do not exactly match"));
}

#[test]
fn compile_evidence_requires_a_toolchain_identity() {
    assert!(CompileEvidence::new(
        "tectonic",
        " ",
        "main.tex",
        ContentHash::digest(b"validated-pdf"),
        1,
        vec![ReplayedInput::new("main.tex", ContentHash::digest(b"source")).unwrap()],
    )
    .is_err());
}

#[test]
fn publication_rejects_a_mutated_sealed_replay_tree() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"source").unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();
    let inputs = capture_inputs(&project, &["project.json", "main.tex"]);
    let candidate = store.stage_candidate(&project, &inputs).unwrap();
    let evidence = evidence(&candidate, 1);

    fs::write(candidate.sealed_root().join("main.tex"), b"tamper").unwrap();
    let error = store.publish(candidate, evidence).unwrap_err();
    assert!(
        error.to_string().contains("changed before publication"),
        "unexpected error: {error}"
    );
    assert!(store.list().unwrap().is_empty());
}

#[test]
fn candidate_lock_blocks_other_store_handles_until_publication_finishes() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"source").unwrap();
    let history = temp.path().join("history");
    let store = Store::open(&history).unwrap();
    let inputs = capture_inputs(&project, &["project.json", "main.tex"]);
    let candidate = store.stage_candidate(&project, &inputs).unwrap();

    let (sent, received) = mpsc::channel();
    let other_history = history.clone();
    let worker = thread::spawn(move || {
        let other = Store::open_existing(other_history).unwrap().unwrap();
        sent.send(other.list().unwrap()).unwrap();
    });
    assert!(matches!(
        received.recv_timeout(Duration::from_millis(100)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));

    drop(candidate);
    assert!(received
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .is_empty());
    worker.join().unwrap();
}

#[test]
fn exclusive_recovery_removes_abandoned_staging_entries() {
    let temp = tempdir().unwrap();
    let history = temp.path().join("history");
    let store = Store::open(&history).unwrap();
    fs::create_dir_all(history.join("staging/abandoned/nested")).unwrap();
    fs::write(history.join("staging/abandoned/nested/data"), b"partial").unwrap();
    drop(store);

    Store::open(&history).unwrap();
    assert!(fs::read_dir(history.join("staging"))
        .unwrap()
        .next()
        .is_none());
}

#[test]
fn namespace_locked_destroy_waits_for_candidates_and_allows_clean_recreation() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"source").unwrap();
    let history = temp.path().join("history");
    let store = Store::open(&history).unwrap();
    let inputs = capture_inputs(&project, &["project.json", "main.tex"]);
    let candidate = store.stage_candidate(&project, &inputs).unwrap();

    let (sent, received) = mpsc::channel();
    let removed_history = history.clone();
    let worker = thread::spawn(move || {
        sent.send(Store::destroy(&removed_history)).unwrap();
    });
    assert!(matches!(
        received.recv_timeout(Duration::from_millis(100)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));

    drop(candidate);
    assert!(received
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap());
    worker.join().unwrap();
    assert!(!history.exists());
    assert!(store.list().is_err());
    assert!(Store::open_existing(&history).unwrap().is_none());

    let recreated = Store::open(&history).unwrap();
    assert!(recreated.list().unwrap().is_empty());
}

#[cfg(unix)]
#[test]
fn destroy_retry_reaps_the_exact_detached_store_after_recursive_cleanup_failed() {
    use std::os::unix::net::UnixListener;

    let temp = tempdir().unwrap();
    let history = temp.path().join("history");
    let store = Store::open(&history).unwrap();
    let unsupported = UnixListener::bind(history.join("blocked.sock")).unwrap();
    drop(store);

    assert!(Store::destroy(&history).is_err());
    assert!(!history.exists());
    drop(unsupported);

    let tombstone = fs::read_dir(temp.path())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(".history.deleting."))
        })
        .expect("failed destroy keeps its detached store");
    fs::remove_file(tombstone.join("blocked.sock")).unwrap();

    assert!(Store::destroy(&history).unwrap());
    assert!(!history.exists());
    assert!(fs::read_dir(temp.path())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .all(|path| {
            !path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(".history.deleting."))
        }));
}

#[test]
fn destroy_refuses_a_non_store_directory_without_removing_it() {
    let temp = tempdir().unwrap();
    let unrelated = temp.path().join("unrelated");
    fs::create_dir(&unrelated).unwrap();
    let sentinel = unrelated.join("sentinel.txt");
    fs::write(&sentinel, b"keep me").unwrap();

    assert!(Store::destroy(&unrelated).is_err());
    assert!(unrelated.is_dir());
    assert_eq!(fs::read(&sentinel).unwrap(), b"keep me");
}

#[cfg(unix)]
#[test]
fn store_open_rejects_symlinked_roots_locks_and_internal_nodes() {
    use std::os::unix::fs::symlink;

    let temp = tempdir().unwrap();
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    let linked_root = temp.path().join("linked-history");
    symlink(&outside, &linked_root).unwrap();
    assert!(Store::open(&linked_root).is_err());
    assert!(fs::read_dir(&outside).unwrap().next().is_none());

    let history = temp.path().join("history");
    drop(Store::open(&history).unwrap());
    fs::remove_dir(history.join("packs")).unwrap();
    symlink(&outside, history.join("packs")).unwrap();
    assert!(Store::open_existing(&history).is_err());
    fs::remove_file(history.join("packs")).unwrap();
    fs::create_dir(history.join("packs")).unwrap();

    fs::remove_file(history.join("operation.lock")).unwrap();
    let outside_lock = temp.path().join("outside.lock");
    fs::write(&outside_lock, b"not a store lock").unwrap();
    symlink(&outside_lock, history.join("operation.lock")).unwrap();
    assert!(Store::open_existing(&history).is_err());
}

#[cfg(unix)]
#[test]
fn store_canonicalizes_a_benign_symlinked_ancestor_before_sqlite_open() {
    use std::os::unix::fs::symlink;

    let temp = tempdir().unwrap();
    let real_parent = temp.path().join("real-parent");
    fs::create_dir(&real_parent).unwrap();
    fs::create_dir(real_parent.join("nested")).unwrap();
    let alias = temp.path().join("alias");
    symlink(&real_parent, &alias).unwrap();

    let store = Store::open(alias.join("nested/history")).unwrap();
    assert_eq!(
        store.root(),
        real_parent.canonicalize().unwrap().join("nested/history")
    );
    assert!(store.list().unwrap().is_empty());
}
