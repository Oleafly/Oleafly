use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Barrier};
use std::thread;
use std::time::Duration;

use oleafly_history::{
    Candidate, CaptureInput, CompileEvidence, ContentHash, HistoryError, PublicationGate,
    PublishOutcome, ReplayedInput, Store,
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

struct CancelAfterChecks {
    checks: AtomicUsize,
    cancel_on: usize,
}

impl CancelAfterChecks {
    fn new(cancel_on: usize) -> Self {
        Self {
            checks: AtomicUsize::new(0),
            cancel_on,
        }
    }
}

impl PublicationGate for CancelAfterChecks {
    fn is_cancelled(&self) -> bool {
        self.checks.fetch_add(1, Ordering::SeqCst) + 1 >= self.cancel_on
    }

    fn commit_visibility(
        &self,
        commit: &mut dyn FnMut() -> oleafly_history::Result<()>,
    ) -> oleafly_history::Result<bool> {
        if self.is_cancelled() {
            return Ok(false);
        }
        commit()?;
        Ok(true)
    }
}

struct InstallVisibilityGate {
    target: std::path::PathBuf,
    calls: Arc<AtomicUsize>,
    cancel: bool,
}

impl PublicationGate for InstallVisibilityGate {
    fn is_cancelled(&self) -> bool {
        false
    }

    fn commit_visibility(
        &self,
        commit: &mut dyn FnMut() -> oleafly_history::Result<()>,
    ) -> oleafly_history::Result<bool> {
        assert_eq!(self.calls.fetch_add(1, Ordering::SeqCst), 0);
        assert!(!self.target.exists());
        if self.cancel {
            return Ok(false);
        }
        commit()?;
        assert!(self.target.is_dir());
        Ok(true)
    }
}

#[test]
fn candidate_staging_observes_cancellation_and_removes_private_bytes() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), br#"{"main":"main.tex"}"#).unwrap();
    fs::write(project.join("main.tex"), vec![7_u8; 8 * 1024 * 1024]).unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();
    let inputs = capture_inputs(&project, &["project.json", "main.tex"]);

    let error = store
        .stage_candidate_controlled(&project, &inputs, &CancelAfterChecks::new(6))
        .unwrap_err();

    assert!(matches!(error, HistoryError::PublicationCancelled));
    assert!(store.list().unwrap().is_empty());
    assert_eq!(
        fs::read_dir(store.root().join("staging")).unwrap().count(),
        0
    );
}

#[test]
fn candidate_verification_observes_cancellation_before_root_publication() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), br#"{"main":"main.tex"}"#).unwrap();
    fs::write(project.join("main.tex"), vec![11_u8; 8 * 1024 * 1024]).unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();
    let candidate = store
        .stage_candidate(
            &project,
            &capture_inputs(&project, &["project.json", "main.tex"]),
        )
        .unwrap();
    let evidence = evidence(&candidate, 1);

    let error = store
        .publish_controlled(candidate, evidence, &CancelAfterChecks::new(2))
        .unwrap_err();

    assert!(matches!(error, HistoryError::PublicationCancelled));
    assert!(store.list().unwrap().is_empty());
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
        PublishOutcome::Existing(checkpoint)
            if checkpoint.snapshot_root == first_root && checkpoint.completed_at_unix_ms == 10
    ));

    let checkpoints = store.list().unwrap();
    assert_eq!(checkpoints.len(), 1);
    assert_eq!(checkpoints[0].completed_at_unix_ms, 10);
    assert_eq!(
        checkpoints[0].output_hash,
        ContentHash::digest(b"validated-pdf")
    );
    assert_eq!(store.stats().unwrap(), stats_after_first);
}

#[test]
fn repeated_root_never_reorders_history_and_keep_latest_uses_catalog_sequence() {
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

    let stats_before_repeat = store.stats().unwrap();
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
            if checkpoint.snapshot_root == root_a && checkpoint.completed_at_unix_ms == 100
    ));
    assert_eq!(store.stats().unwrap(), stats_before_repeat);

    let listed = store.list().unwrap();
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].snapshot_root, root_b);
    assert_eq!(listed[0].completed_at_unix_ms, 200);
    assert_eq!(listed[1].snapshot_root, root_a);
    assert_eq!(listed[1].completed_at_unix_ms, 100);

    assert_eq!(store.keep_latest().unwrap(), 1);
    let retained = store.list().unwrap();
    assert_eq!(retained.len(), 1);
    assert_eq!(retained[0].snapshot_root, root_b);
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
    assert!(error.to_string().contains("lacks sealed replay evidence"));

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
fn publication_rejects_an_unportable_header_without_replacing_the_root() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"source").unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();
    let inputs = capture_inputs(&project, &["project.json", "main.tex"]);
    let candidate = store.stage_candidate(&project, &inputs).unwrap();
    let root = *candidate.snapshot_root();
    publish(&store, candidate, 1).unwrap();

    fs::write(project.join("main.tex"), b"changed source").unwrap();
    let inputs = capture_inputs(&project, &["project.json", "main.tex"]);
    let candidate = store.stage_candidate(&project, &inputs).unwrap();
    let rejected_root = *candidate.snapshot_root();
    let evidence = CompileEvidence::new(
        "tectonic",
        "x".repeat(16 * 1024 * 1024),
        "main.tex",
        ContentHash::digest(b"validated-pdf"),
        2,
        candidate
            .proven_files()
            .iter()
            .map(|file| ReplayedInput::new(&file.relative_path, file.content_hash).unwrap())
            .collect(),
    )
    .unwrap();

    let error = store.publish(candidate, evidence).unwrap_err();

    assert!(
        error.to_string().contains("header exceeds 16 MiB"),
        "unexpected error: {error}"
    );
    assert!(store.checkpoint(&rejected_root).unwrap().is_none());
    assert_eq!(
        store
            .checkpoint(&root)
            .unwrap()
            .unwrap()
            .completed_at_unix_ms,
        1
    );
    assert_eq!(store.list().unwrap().len(), 1);
}

#[test]
fn export_fails_closed_when_an_existing_summary_is_not_portable() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"first").unwrap();
    let history = temp.path().join("history");
    let store = Store::open(&history).unwrap();
    let inputs = capture_inputs(&project, &["project.json", "main.tex"]);
    let first = store.stage_candidate(&project, &inputs).unwrap();
    let first_root = *first.snapshot_root();
    publish(&store, first, 1).unwrap();

    let connection = Connection::open(history.join("catalog.sqlite3")).unwrap();
    connection
        .execute(
            "UPDATE checkpoints SET logical_bytes = logical_bytes + 1 \
             WHERE snapshot_root = ?1",
            [first_root.as_hex()],
        )
        .unwrap();
    drop(connection);

    fs::write(project.join("main.tex"), b"second").unwrap();
    let inputs = capture_inputs(&project, &["project.json", "main.tex"]);
    let second = store.stage_candidate(&project, &inputs).unwrap();
    let second_root = *second.snapshot_root();
    publish(&store, second, 2).unwrap();
    assert!(store.checkpoint(&second_root).unwrap().is_some());
    assert_eq!(store.list().unwrap().len(), 2);

    let error = store.export_history(Vec::new()).unwrap_err();

    assert!(
        error.to_string().contains("summary does not match"),
        "unexpected error: {error}"
    );
    let error = store.verify().unwrap_err();
    assert!(
        error.to_string().contains("summary does not match"),
        "unexpected error: {error}"
    );
}

#[test]
fn publication_rejects_a_project_manifest_that_history_import_cannot_accept() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(
        project.join("project.json"),
        vec![b' '; 4 * 1024 * 1024 + 1],
    )
    .unwrap();
    fs::write(project.join("main.tex"), b"source").unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();
    let inputs = capture_inputs(&project, &["project.json", "main.tex"]);
    let candidate = store.stage_candidate(&project, &inputs).unwrap();
    let root = *candidate.snapshot_root();

    let error = publish(&store, candidate, 1).unwrap_err();

    assert!(
        error
            .to_string()
            .contains("project.json exceeds the import limit"),
        "unexpected error: {error}"
    );
    assert!(store.checkpoint(&root).unwrap().is_none());
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

#[test]
fn first_publication_store_is_invisible_until_nonempty_commit() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"source").unwrap();
    let history = temp.path().join("history");

    let publication = Store::open_for_publication(&history).unwrap();
    assert!(!history.exists());
    assert!(Store::open_existing(&history).unwrap().is_none());

    let candidate = publication
        .store()
        .stage_candidate(
            &project,
            &capture_inputs(&project, &["project.json", "main.tex"]),
        )
        .unwrap();
    publish(publication.store(), candidate, 1).unwrap();
    assert!(!history.exists());

    let store = publication.commit().unwrap().into_store();
    assert_eq!(store.list().unwrap().len(), 1);
    assert_eq!(
        Store::open_existing(&history)
            .unwrap()
            .unwrap()
            .list()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn first_publication_cancelled_at_install_cutoff_never_becomes_visible() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"source").unwrap();
    let history = temp.path().join("history");
    let publication = Store::open_for_publication(&history).unwrap();
    let candidate = publication
        .store()
        .stage_candidate(
            &project,
            &capture_inputs(&project, &["project.json", "main.tex"]),
        )
        .unwrap();
    let evidence = evidence(&candidate, 1);
    let calls = Arc::new(AtomicUsize::new(0));

    let error = publication
        .publish_controlled(
            candidate,
            evidence,
            &InstallVisibilityGate {
                target: history.clone(),
                calls: calls.clone(),
                cancel: true,
            },
        )
        .unwrap_err();

    assert!(matches!(error, HistoryError::PublicationCancelled));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(!history.exists());
    assert!(Store::open_existing(&history).unwrap().is_none());
}

#[test]
fn first_publication_crosses_its_only_visibility_cutoff_at_install() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"source").unwrap();
    let history = temp.path().join("history");
    let publication = Store::open_for_publication(&history).unwrap();
    let candidate = publication
        .store()
        .stage_candidate(
            &project,
            &capture_inputs(&project, &["project.json", "main.tex"]),
        )
        .unwrap();
    let evidence = evidence(&candidate, 1);
    let calls = Arc::new(AtomicUsize::new(0));

    let (published, committed) = publication
        .publish_controlled(
            candidate,
            evidence,
            &InstallVisibilityGate {
                target: history.clone(),
                calls: calls.clone(),
                cancel: false,
            },
        )
        .unwrap();

    assert!(matches!(published, PublishOutcome::Created(_)));
    assert!(matches!(
        committed,
        oleafly_history::PublicationCommitOutcome::Durable(_)
    ));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        Store::open_existing(&history)
            .unwrap()
            .unwrap()
            .list()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn failed_first_publication_removes_private_initialization_store() {
    let temp = tempdir().unwrap();
    let history = temp.path().join("history");

    let publication = Store::open_for_publication(&history).unwrap();
    assert!(publication.commit().is_err());
    assert!(!history.exists());
    assert!(Store::open_existing(&history).unwrap().is_none());
    assert!(fs::read_dir(temp.path()).unwrap().all(|entry| {
        let entry = entry.unwrap();
        !entry.path().is_dir()
            || !entry
                .file_name()
                .to_string_lossy()
                .starts_with(".oleafly-checkpoint-init-")
    }));
}

#[test]
fn next_first_publication_reaps_a_crash_left_initialization_directory() {
    let temp = tempdir().unwrap();
    let history = temp.path().join("history");
    let publication = Store::open_for_publication(&history).unwrap();
    let stale = fs::read_dir(temp.path())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| {
            path.is_dir()
                && path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(".oleafly-checkpoint-init-")
        })
        .unwrap();
    drop(publication);
    fs::create_dir(&stale).unwrap();
    fs::write(stale.join("crash-residue"), b"partial").unwrap();

    let next = Store::open_for_publication(&history).unwrap();

    assert!(!stale.exists());
    drop(next);
    assert!(!history.exists());
}

#[test]
fn destroy_waits_for_first_publication_install_and_then_removes_it() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"source").unwrap();
    let history = temp.path().join("history");
    let publication = Store::open_for_publication(&history).unwrap();
    let candidate = publication
        .store()
        .stage_candidate(
            &project,
            &capture_inputs(&project, &["project.json", "main.tex"]),
        )
        .unwrap();
    publish(publication.store(), candidate, 1).unwrap();

    assert!(matches!(
        Store::try_open_for_publication(&history),
        Ok(None)
    ));
    assert_eq!(Store::try_destroy_if_empty(&history).unwrap(), None);
    let (sent, received) = mpsc::channel();
    let removed_history = history.clone();
    let worker = thread::spawn(move || {
        sent.send(Store::destroy(&removed_history)).unwrap();
    });
    assert!(matches!(
        received.recv_timeout(Duration::from_millis(100)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));

    let store = publication.commit().unwrap().into_store();
    assert!(received
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap());
    worker.join().unwrap();
    assert!(!history.exists());
    assert!(store.list().is_err());
}

#[test]
fn destroy_if_empty_removes_only_an_unpublished_store() {
    let temp = tempdir().unwrap();
    let empty_history = temp.path().join("empty-history");
    drop(Store::open(&empty_history).unwrap());

    assert!(Store::destroy_if_empty(&empty_history).unwrap());
    assert!(!empty_history.exists());

    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"source").unwrap();
    let published_history = temp.path().join("published-history");
    let store = Store::open(&published_history).unwrap();
    let candidate = store
        .stage_candidate(
            &project,
            &capture_inputs(&project, &["project.json", "main.tex"]),
        )
        .unwrap();
    publish(&store, candidate, 1).unwrap();
    drop(store);

    assert!(!Store::destroy_if_empty(&published_history).unwrap());
    assert_eq!(
        Store::open_existing(&published_history)
            .unwrap()
            .unwrap()
            .list()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn destroy_if_empty_waits_for_concurrent_publication_and_preserves_it() {
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

    let (sent, received) = mpsc::channel();
    let cleanup_history = history.clone();
    let worker = thread::spawn(move || {
        sent.send(Store::destroy_if_empty(&cleanup_history))
            .unwrap();
    });
    assert!(matches!(
        received.recv_timeout(Duration::from_millis(100)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));

    publish(&store, candidate, 1).unwrap();
    assert!(!received
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap());
    worker.join().unwrap();
    assert_eq!(store.list().unwrap().len(), 1);
}

#[test]
fn try_destroy_if_empty_never_waits_for_concurrent_publication() {
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

    let started = std::time::Instant::now();
    assert_eq!(Store::try_destroy_if_empty(&history).unwrap(), None);
    assert!(started.elapsed() < Duration::from_secs(1));

    publish(&store, candidate, 1).unwrap();
    assert_eq!(Store::try_destroy_if_empty(&history).unwrap(), Some(false));
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

#[test]
fn unstored_required_inputs_are_proven_without_retaining_their_bytes() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(project.join("figures")).unwrap();
    let project_json = br#"{"main":"main.tex"}"#;
    let source = b"source that reads the ignored data set";
    let data = vec![b'x'; 4096];
    fs::write(project.join("project.json"), project_json).unwrap();
    fs::write(project.join("main.tex"), source).unwrap();
    fs::write(project.join("figures/data.csv"), &data).unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();
    let inputs = vec![
        CaptureInput::explicit("project.json").unwrap(),
        CaptureInput::proven(
            "main.tex",
            project.join("main.tex").canonicalize().unwrap(),
            ContentHash::digest(source),
        )
        .unwrap(),
        CaptureInput::replay_required_unstored(
            "figures/data.csv",
            project.join("figures/data.csv").canonicalize().unwrap(),
            ContentHash::digest(&data),
        )
        .unwrap(),
    ];

    let candidate = store.stage_candidate(&project, &inputs).unwrap();
    let root = *candidate.snapshot_root();
    assert_eq!(
        fs::read(candidate.sealed_root().join("figures/data.csv")).unwrap(),
        data,
        "an unstored input is still sealed for the replay compile"
    );
    assert_eq!(
        candidate
            .proven_files()
            .iter()
            .map(|file| file.relative_path.as_str())
            .collect::<Vec<_>>(),
        vec!["figures/data.csv", "main.tex"]
    );
    assert!(matches!(
        publish(&store, candidate, 10).unwrap(),
        PublishOutcome::Created(checkpoint) if checkpoint.snapshot_root == root
    ));

    let files = store.checkpoint_files(&root).unwrap().unwrap();
    assert_eq!(
        files
            .iter()
            .map(|file| (file.relative_path.as_str(), file.stored, file.chunk_count))
            .collect::<Vec<_>>(),
        vec![
            ("figures/data.csv", false, 0),
            ("main.tex", true, 1),
            ("project.json", true, 1),
        ]
    );
    assert_eq!(files[0].logical_bytes, data.len() as u64);
    assert_eq!(files[0].content_hash, ContentHash::digest(&data));

    let stats = store.stats().unwrap();
    assert_eq!(stats.unstored_file_count, 1);
    assert_eq!(stats.unstored_logical_bytes, data.len() as u64);
    assert_eq!(
        stats.visible_logical_bytes,
        (project_json.len() + source.len() + data.len()) as u64
    );
    assert_eq!(
        stats.logical_chunk_bytes,
        (project_json.len() + source.len()) as u64
    );

    let verified = store.verify().unwrap();
    assert_eq!(verified.checked_checkpoints, 1);
    assert_eq!(verified.checked_files, 3);
    assert_eq!(verified.checked_chunk_references, 2);

    let restored = temp.path().join("restored");
    let materialized = store.materialize(&root, &restored).unwrap();
    assert_eq!(materialized.file_count, 2);
    assert_eq!(materialized.omitted, vec!["figures/data.csv".to_string()]);
    assert_eq!(
        materialized.logical_bytes,
        (project_json.len() + source.len()) as u64
    );
    assert!(!restored.join("figures/data.csv").exists());
    assert_eq!(fs::read(restored.join("main.tex")).unwrap(), source);

    let mut archive = Vec::new();
    let exported = store.export_history(&mut archive).unwrap();
    assert_eq!(exported.checkpoint_count, 1);
    assert_eq!(
        exported.logical_bytes,
        (project_json.len() + source.len() + data.len()) as u64
    );
    let imported_store = Store::open(temp.path().join("imported-history")).unwrap();
    let imported = imported_store.import_history(archive.as_slice()).unwrap();
    assert_eq!(imported.created_checkpoints, 1);
    assert_eq!(
        imported_store.checkpoint_files(&root).unwrap().unwrap(),
        files
    );
    assert_eq!(imported_store.stats().unwrap().unstored_file_count, 1);
    assert_eq!(
        imported_store.stats().unwrap().unstored_logical_bytes,
        data.len() as u64
    );
    imported_store.verify().unwrap();

    let mut single = Vec::new();
    store.export_checkpoint(&root, &mut single).unwrap();
    let single_store = Store::open(temp.path().join("single-history")).unwrap();
    let error = single_store
        .import_checkpoint(single.as_slice())
        .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("records figures/data.csv without its bytes"),
        "unexpected error: {error}"
    );
}

#[test]
fn an_unstored_main_document_is_never_publishable() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"source").unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();
    let candidate = store
        .stage_candidate(
            &project,
            &[
                CaptureInput::explicit("project.json").unwrap(),
                CaptureInput::replay_required_unstored(
                    "main.tex",
                    project.join("main.tex").canonicalize().unwrap(),
                    ContentHash::digest(b"source"),
                )
                .unwrap(),
            ],
        )
        .unwrap();

    let error = publish(&store, candidate, 1).unwrap_err();

    assert!(
        error
            .to_string()
            .contains("must always retain its checkpoint bytes"),
        "unexpected error: {error}"
    );
    assert!(store.list().unwrap().is_empty());
}

#[test]
fn a_sealed_candidate_reports_root_visibility_without_taking_new_locks() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"source").unwrap();
    let history = temp.path().join("history");
    let store = Store::open(&history).unwrap();
    let inputs = capture_inputs(&project, &["project.json", "main.tex"]);
    let fresh = store.stage_candidate(&project, &inputs).unwrap();
    assert!(!fresh.root_is_visible().unwrap());
    let root = *fresh.snapshot_root();
    publish(&store, fresh, 10).unwrap();

    let repeated = store.stage_candidate(&project, &inputs).unwrap();
    let (sender, receiver) = std::sync::mpsc::channel();
    let probe = std::thread::spawn(move || {
        let visible = repeated.root_is_visible();
        sender.send(()).unwrap();
        (repeated, visible)
    });
    receiver
        .recv_timeout(std::time::Duration::from_secs(10))
        .expect("visibility must not wait on the locks the candidate already holds");
    let (repeated, visible) = probe.join().unwrap();
    assert!(visible.unwrap());
    assert_eq!(repeated.snapshot_root(), &root);
    drop(repeated);
    assert_eq!(store.list().unwrap().len(), 1);
}

#[test]
fn publishing_an_existing_root_never_mutates_the_catalog() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    fs::write(project.join("main.tex"), b"source").unwrap();
    let history = temp.path().join("history");
    let store = Store::open(&history).unwrap();
    let inputs = capture_inputs(&project, &["project.json", "main.tex"]);
    let candidate = store.stage_candidate(&project, &inputs).unwrap();
    let root = *candidate.snapshot_root();
    publish(&store, candidate, 10).unwrap();
    let before = catalog_checkpoint_row(&history, &root);
    let stats_before = store.stats().unwrap();

    let repeated = store.stage_candidate(&project, &inputs).unwrap();
    assert_eq!(repeated.snapshot_root(), &root);
    let outcome = publish(&store, repeated, 999).unwrap();

    let PublishOutcome::Existing(existing) = outcome else {
        panic!("an already visible root is never republished");
    };
    assert_eq!(existing.snapshot_root, root);
    assert_eq!(existing.completed_at_unix_ms, 10);
    assert_eq!(catalog_checkpoint_row(&history, &root), before);
    assert_eq!(store.stats().unwrap(), stats_before);
    assert_eq!(store.list().unwrap().len(), 1);
    assert_eq!(
        fs::read_dir(store.root().join("staging")).unwrap().count(),
        0
    );
}

fn catalog_checkpoint_row(
    history: &std::path::Path,
    root: &oleafly_history::SnapshotRoot,
) -> (i64, i64) {
    let connection = Connection::open(history.join("catalog.sqlite3")).unwrap();
    connection
        .query_row(
            "SELECT sequence, completed_at_unix_ms FROM checkpoints WHERE snapshot_root = ?1",
            [root.as_hex()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
}

#[test]
fn latest_checkpoint_follows_the_catalog_sequence() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    let store = Store::open(temp.path().join("history")).unwrap();
    assert!(store.latest_checkpoint().unwrap().is_none());

    fs::write(project.join("main.tex"), b"first").unwrap();
    let first = store
        .stage_candidate(
            &project,
            &capture_inputs(&project, &["project.json", "main.tex"]),
        )
        .unwrap();
    let first_root = *first.snapshot_root();
    publish(&store, first, 100).unwrap();
    assert_eq!(
        store.latest_checkpoint().unwrap().unwrap().snapshot_root,
        first_root
    );

    fs::write(project.join("main.tex"), b"second").unwrap();
    let second = store
        .stage_candidate(
            &project,
            &capture_inputs(&project, &["project.json", "main.tex"]),
        )
        .unwrap();
    let second_root = *second.snapshot_root();
    publish(&store, second, 200).unwrap();

    let latest = store.latest_checkpoint().unwrap().unwrap();
    assert_eq!(latest.snapshot_root, second_root);
    assert_eq!(latest.completed_at_unix_ms, 200);

    fs::write(project.join("main.tex"), b"first").unwrap();
    let repeated = store
        .stage_candidate(
            &project,
            &capture_inputs(&project, &["project.json", "main.tex"]),
        )
        .unwrap();
    publish(&store, repeated, 300).unwrap();
    assert_eq!(
        store.latest_checkpoint().unwrap().unwrap().snapshot_root,
        second_root
    );

    assert!(store.delete_checkpoint(&second_root).unwrap());
    assert_eq!(
        store.latest_checkpoint().unwrap().unwrap().snapshot_root,
        first_root
    );
    assert!(store.checkpoint_files(&second_root).unwrap().is_none());
    assert!(store
        .checkpoint_files(
            &oleafly_history::SnapshotRoot::parse(
                "0000000000000000000000000000000000000000000000000000000000000000"
            )
            .unwrap()
        )
        .unwrap()
        .is_none());
}

#[test]
fn inspect_reports_catalog_counts_without_creating_files() {
    let temp = tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("project.json"), b"{}").unwrap();
    let history = temp.path().join("history");
    let store = Store::open(&history).unwrap();
    for (time, source) in [(10, "first"), (20, "second")] {
        fs::write(project.join("main.tex"), source).unwrap();
        let candidate = store
            .stage_candidate(
                &project,
                &capture_inputs(&project, &["project.json", "main.tex"]),
            )
            .unwrap();
        publish(&store, candidate, time).unwrap();
    }
    let history = store.root().to_path_buf();
    let before = store_entries(&history);

    let inspection = store.inspect().unwrap();

    assert_eq!(inspection.root, history);
    assert_eq!(inspection.catalog_path, history.join("catalog.sqlite3"));
    assert!(inspection.catalog_bytes > 0);
    assert_eq!(inspection.format_version, 2);
    assert_eq!(inspection.lineage.len(), 36);
    assert_eq!(inspection.checkpoint_count, 2);
    assert_eq!(inspection.manifest_count, 2);
    assert_eq!(inspection.pack_count, inspection.packs.len() as u64);
    assert_eq!(inspection.pack_count, 2);
    assert_eq!(inspection.chunk_count, 3);
    assert_eq!(inspection.manifest_chunk_count, 4);
    assert_eq!(
        inspection
            .packs
            .iter()
            .map(|pack| pack.chunk_count)
            .sum::<u64>(),
        inspection.chunk_count
    );
    assert!(inspection
        .packs
        .iter()
        .all(|pack| pack.encoded_bytes > 0 && pack.file_name.ends_with(".pack")));
    assert_eq!(store_entries(&history), before);
}

fn store_entries(history: &std::path::Path) -> Vec<String> {
    let mut entries = Vec::new();
    for directory in [
        history.to_path_buf(),
        history.join("packs"),
        history.join("staging"),
    ] {
        for entry in fs::read_dir(&directory).unwrap() {
            entries.push(entry.unwrap().path().display().to_string());
        }
    }
    entries.sort();
    entries
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
