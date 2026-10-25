use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use super::*;
use crate::collab::live::write::rig::LiveRig;
use crate::research_tasks::isolation::hash_file;
use crate::research_tasks::model::{
    now_ms, ManifestEntry, ResearchTaskStatus, TaskIsolation, TaskIsolationKind, TaskResultMetadata,
};

struct Fixture {
    _temp: tempfile::TempDir,
    project: PathBuf,
    baseline: PathBuf,
    execution: PathBuf,
    store: TaskStore,
}

type Change<'a> = (&'a str, Option<&'a [u8]>, Option<&'a [u8]>);

impl Fixture {
    fn new() -> Fixture {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir(&project).unwrap();
        Fixture::at(temp, project)
    }

    fn at(temp: tempfile::TempDir, project: PathBuf) -> Fixture {
        let baseline = temp.path().join("baseline");
        let execution = temp.path().join("execution");
        fs::create_dir(&baseline).unwrap();
        fs::create_dir(&execution).unwrap();
        let store = TaskStore::new(temp.path().join("store")).unwrap();
        Fixture {
            _temp: temp,
            project,
            baseline,
            execution,
            store,
        }
    }

    fn place(root: &Path, path: &str, bytes: &[u8]) -> PathBuf {
        let target = root.join(path);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, bytes).unwrap();
        target
    }

    fn task(&self, project_id: &str, changes: &[Change<'_>]) -> ResearchTask {
        let mut changed_files = Vec::new();
        let mut baseline = Vec::new();
        for (path, before, after) in changes {
            let before = before.map(|bytes| {
                let current = fs::read(self.project.join(path)).ok();
                if current.as_deref() != Some(bytes) {
                    Fixture::place(&self.project, path, bytes);
                }
                hash_file(&Fixture::place(&self.baseline, path, bytes)).unwrap()
            });
            let after = after
                .map(|bytes| hash_file(&Fixture::place(&self.execution, path, bytes)).unwrap());
            if let Some((sha256, size)) = &before {
                baseline.push(ManifestEntry {
                    path: (*path).to_owned(),
                    sha256: sha256.clone(),
                    size: *size,
                    resolved_link: false,
                });
            }
            let kind = match (&before, &after) {
                (None, _) => TaskFileChangeKind::Added,
                (_, None) => TaskFileChangeKind::Deleted,
                _ => TaskFileChangeKind::Modified,
            };
            changed_files.push(TaskFileChange {
                path: (*path).to_owned(),
                kind,
                before_sha256: before.as_ref().map(|(sha256, _)| sha256.clone()),
                after_sha256: after.as_ref().map(|(sha256, _)| sha256.clone()),
                before_size: before.as_ref().map(|(_, size)| *size),
                after_size: after.as_ref().map(|(_, size)| *size),
            });
        }
        ResearchTask {
            id: format!("task-{project_id}"),
            project_id: project_id.to_owned(),
            title: "Revise".into(),
            prompt: "Revise the manuscript".into(),
            runtime_id: "fixture".into(),
            agent_id: "fixture".into(),
            model_id: "fixture".into(),
            skill_ids: Vec::new(),
            dependency_ids: Vec::new(),
            status: ResearchTaskStatus::AwaitingReview,
            execution_generation: 1,
            session_id: Some("session".into()),
            native_session_id: None,
            source_revision: Some("snapshot:before".into()),
            isolation: Some(TaskIsolation {
                kind: TaskIsolationKind::StagedProject,
                execution_root: self.execution.to_string_lossy().into_owned(),
                baseline_root: self.baseline.to_string_lossy().into_owned(),
                source_revision: "snapshot:before".into(),
                baseline_hash: "baseline".into(),
                baseline,
                allowed_paths: Vec::new(),
                created_at: now_ms(),
                skipped: Vec::new(),
            }),
            error: None,
            result: Some(TaskResultMetadata {
                summary: "Revised".into(),
                changed_files,
                artifacts: Vec::new(),
                native_session_id: None,
                input_tokens: None,
                output_tokens: None,
            }),
            review: None,
            start_requested: false,
            cancel_requested: false,
            created_at: now_ms(),
            updated_at: now_ms(),
            started_at: Some(now_ms()),
            finished_at: Some(now_ms()),
            brief: Default::default(),
            record_slug: String::new(),
            run_after: None,
            keep_running_after_quit: false,
            owner: Default::default(),
            phase: None,
            plan_approved: false,
            stop_reason: None,
            evidence: None,
            pending_approvals: 0,
            active_ms: 0,
            todos: Vec::new(),
            pending_start: None,
            reclaim_requested: false,
            resumed_from: None,
        }
    }

    fn on_disk(&self, path: &str) -> Option<String> {
        fs::read_to_string(self.project.join(path)).ok()
    }

    fn apply(
        &self,
        task: &ResearchTask,
        paths: &[&str],
        document: Option<&SharedDocument>,
    ) -> Result<bool, String> {
        let paths: Vec<String> = paths.iter().map(|path| (*path).to_owned()).collect();
        apply_review_with_fault(
            &self.store,
            task,
            &self.project,
            &paths,
            document,
            ApplyFault::None,
        )
    }
}

#[test]
fn a_live_apply_merges_against_the_before_text_and_keeps_remote_text_outside_the_changed_lines() {
    let fixture = Fixture::new();
    let rig = LiveRig::start(
        "live-merge",
        &fixture.project,
        &[("main.tex", "one\ntwo\nthree\n")],
    );
    let task = fixture.task(
        "live-merge",
        &[(
            "main.tex",
            Some(b"one\ntwo\nthree\n"),
            Some(b"ONE\ntwo\nthree\n"),
        )],
    );
    rig.remote("main.tex", "one\ntwo\nthree\nfour from a collaborator\n");
    rig.settle();
    assert_eq!(
        fixture.on_disk("main.tex").as_deref(),
        Some("one\ntwo\nthree\nfour from a collaborator\n")
    );

    let applied = fixture.apply(&task, &["main.tex"], Some(&rig.document()));

    assert_eq!(applied, Ok(true));
    let merged = "ONE\ntwo\nthree\nfour from a collaborator\n";
    assert_eq!(rig.text("main.tex").as_deref(), Some(merged));
    assert_eq!(fixture.on_disk("main.tex").as_deref(), Some(merged));
}

#[test]
fn a_live_apply_creates_new_files_through_the_shared_document() {
    let fixture = Fixture::new();
    let rig = LiveRig::start("live-create", &fixture.project, &[("main.tex", "abc\n")]);
    let task = fixture.task(
        "live-create",
        &[("chapters/intro.tex", None, Some(b"Intro\n"))],
    );

    let applied = fixture.apply(&task, &["chapters/intro.tex"], Some(&rig.document()));

    assert_eq!(applied, Ok(true));
    assert_eq!(rig.paths(), ["chapters", "chapters/intro.tex", "main.tex"]);
    assert_eq!(rig.text("chapters/intro.tex").as_deref(), Some("Intro\n"));
    assert_eq!(
        fixture.on_disk("chapters/intro.tex").as_deref(),
        Some("Intro\n")
    );
}

#[test]
fn a_live_apply_the_document_refuses_is_undone_through_the_document_and_keeps_remote_text() {
    let fixture = Fixture::new();
    let rig = LiveRig::start(
        "live-undo",
        &fixture.project,
        &[("main.tex", "one\ntwo\nthree\n")],
    );
    let task = fixture.task(
        "live-undo",
        &[
            ("figure.bin", Some(&[0, 1, 2]), Some(&[0, 9, 9])),
            (
                "main.tex",
                Some(b"one\ntwo\nthree\n"),
                Some(b"ONE\ntwo\nthree\n"),
            ),
            ("notes.tex", None, Some(b"Task notes\n")),
        ],
    );
    let remote = "one\ntwo\nthree\nfour from a collaborator\n";
    rig.remote("main.tex", remote);
    rig.remote_new("notes.tex", "Collaborator notes\n");

    let applied = fixture.apply(
        &task,
        &["figure.bin", "main.tex", "notes.tex"],
        Some(&rig.document()),
    );

    let error = applied.expect_err("the document refused notes.tex");
    assert!(
        error.starts_with("notes.tex changed after this task started"),
        "{error}"
    );
    assert_eq!(rig.text("main.tex").as_deref(), Some(remote));
    assert_eq!(
        rig.text("notes.tex").as_deref(),
        Some("Collaborator notes\n")
    );
    assert_eq!(
        fs::read(fixture.project.join("figure.bin")).unwrap(),
        [0, 1, 2]
    );
    assert!(!has_recovery_journal(&fixture.store, &task).unwrap());
}

fn age(path: &Path) {
    fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(SystemTime::now() - Duration::from_secs(60))
        .unwrap();
}

#[test]
fn a_large_live_apply_never_pauses_sync() {
    use crate::collab::testing::{share, track, RecordedPauses, TempLibrary};
    let library = TempLibrary::new();
    let texts: Vec<String> = (1..=12)
        .map(|index| format!("part{index:02}.tex"))
        .collect();
    let figures: Vec<String> = (1..=4).map(|index| format!("figure{index}.bin")).collect();
    let originals: Vec<(String, String)> = texts
        .iter()
        .map(|path| (path.clone(), format!("{path} starts here\n")))
        .collect();
    let root = library.project("live-large", &[]);
    let temp = tempfile::tempdir().unwrap();
    let fixture = Fixture::at(temp, root.clone());
    let shared_files: Vec<(&str, &str)> = originals
        .iter()
        .map(|(path, text)| (path.as_str(), text.as_str()))
        .collect();
    let rig = LiveRig::start("live-large", &root, &shared_files);
    let edits: Vec<(String, String, String)> = originals
        .iter()
        .map(|(path, text)| (path.clone(), text.clone(), format!("{path} was revised\n")))
        .collect();
    let mut changes: Vec<Change<'_>> = edits
        .iter()
        .map(|(path, before, after)| {
            (
                path.as_str(),
                Some(before.as_bytes()),
                Some(after.as_bytes()),
            )
        })
        .collect();
    let before_figure: &[u8] = &[1, 0, 1];
    let after_figure: &[u8] = &[2, 0, 2];
    for figure in &figures {
        changes.push((figure.as_str(), Some(before_figure), Some(after_figure)));
    }
    let task = fixture.task("live-large", &changes);
    let _shared = share("live-large");
    let tracked: Vec<&str> = texts
        .iter()
        .chain(figures.iter())
        .map(String::as_str)
        .collect();
    track("live-large", &tracked);
    for path in &tracked {
        age(&root.join(path));
    }
    let pauses = Arc::new(RecordedPauses::default());
    let token = crate::folder_watch::watch_project_reporting(
        "live-large",
        Arc::new(|_| {}),
        pauses.clone(),
        Some(crate::folder_watch::WatchMode::Poll(Duration::from_millis(
            50,
        ))),
    )
    .unwrap()
    .expect("a shared library project is watched");
    std::thread::sleep(Duration::from_millis(200));

    let applied = fixture.apply(&task, &tracked, Some(&rig.document()));
    std::thread::sleep(Duration::from_millis(2_500));
    let heard = pauses.taken();
    crate::folder_watch::stop("live-large", Some(token));

    assert_eq!(applied, Ok(true));
    assert!(heard.is_empty(), "{heard:?}");
    for (path, _, after) in &edits {
        assert_eq!(rig.text(path).as_deref(), Some(after.as_str()));
    }
}

#[test]
fn an_unshared_project_keeps_the_journaled_disk_apply() {
    let fixture = Fixture::new();
    let before: &[u8] = b"one\r\ntwo\r\n";
    let after: &[u8] = b"ONE\r\ntwo\r\n";
    let task = fixture.task("unshared-paper", &[("main.tex", Some(before), Some(after))]);

    let applied = apply_review(
        &fixture.store,
        &task,
        &fixture.project,
        &["main.tex".into()],
    );

    assert_eq!(applied, Ok(true));
    assert_eq!(fs::read(fixture.project.join("main.tex")).unwrap(), after);
    assert!(!crate::folder_watch::is_own_write(
        &fixture.project.join("main.tex")
    ));
    assert!(!has_recovery_journal(&fixture.store, &task).unwrap());

    fs::write(fixture.project.join("main.tex"), before).unwrap();
    let interrupted = apply_review_with_fault(
        &fixture.store,
        &task,
        &fixture.project,
        &["main.tex".into()],
        None,
        ApplyFault::InterruptAfterFirst,
    );
    assert!(interrupted.is_err());
    assert_eq!(fs::read(fixture.project.join("main.tex")).unwrap(), after);
    assert!(has_recovery_journal(&fixture.store, &task).unwrap());
    assert_eq!(
        recover_pending_apply(
            &fixture.store,
            &task,
            &fixture.project,
            &["main.tex".into()]
        ),
        Ok(false)
    );
    assert_eq!(fs::read(fixture.project.join("main.tex")).unwrap(), before);
}

fn merged_live_apply(project_id: &str) -> (Fixture, LiveRig, ResearchTask) {
    let fixture = Fixture::new();
    let rig = LiveRig::start(
        project_id,
        &fixture.project,
        &[("main.tex", "one\ntwo\nthree\n")],
    );
    let task = fixture.task(
        project_id,
        &[
            ("figure.bin", Some(&[0, 1, 2]), Some(&[0, 9, 9])),
            (
                "main.tex",
                Some(b"one\ntwo\nthree\n"),
                Some(b"ONE\ntwo\nthree\n"),
            ),
        ],
    );
    rig.remote("main.tex", "one\ntwo\nthree\nfour from a collaborator\n");
    rig.settle();
    (fixture, rig, task)
}

const MERGED: &str = "ONE\ntwo\nthree\nfour from a collaborator\n";

#[test]
fn a_live_apply_interrupted_while_sharing_is_finished_by_recovery_not_rolled_back() {
    let (fixture, rig, task) = merged_live_apply("live-interrupted");

    let interrupted = apply_review_with_fault(
        &fixture.store,
        &task,
        &fixture.project,
        &["figure.bin".into(), "main.tex".into()],
        Some(&rig.document()),
        ApplyFault::InterruptAfterSharing,
    );
    assert!(interrupted.is_err());
    let recovered = recover_pending_apply(
        &fixture.store,
        &task,
        &fixture.project,
        &["figure.bin".into(), "main.tex".into()],
    );

    assert_eq!(recovered, Ok(true));
    assert_eq!(rig.text("main.tex").as_deref(), Some(MERGED));
    assert_eq!(fixture.on_disk("main.tex").as_deref(), Some(MERGED));
    assert_eq!(
        fs::read(fixture.project.join("figure.bin")).unwrap(),
        [0, 9, 9]
    );
    assert!(!has_recovery_journal(&fixture.store, &task).unwrap());
}

#[test]
fn a_finished_live_apply_keeps_its_journal_until_the_task_records_it() {
    let (fixture, rig, task) = merged_live_apply("live-recorded");

    let applied = fixture.apply(&task, &["figure.bin", "main.tex"], Some(&rig.document()));
    let kept = has_recovery_journal(&fixture.store, &task).unwrap();
    release_completed_journal(&fixture.store, &task);

    assert_eq!(applied, Ok(true));
    assert!(kept);
    assert!(!has_recovery_journal(&fixture.store, &task).unwrap());
    assert_eq!(rig.text("main.tex").as_deref(), Some(MERGED));
}

#[test]
fn a_finished_live_apply_the_app_never_recorded_is_completed_by_recovery() {
    let (fixture, rig, task) = merged_live_apply("live-unrecorded");

    let applied = fixture.apply(&task, &["figure.bin", "main.tex"], Some(&rig.document()));
    let recovered = recover_pending_apply(
        &fixture.store,
        &task,
        &fixture.project,
        &["figure.bin".into(), "main.tex".into()],
    );

    assert_eq!(applied, Ok(true));
    assert_eq!(recovered, Ok(true));
    assert!(!has_recovery_journal(&fixture.store, &task).unwrap());
    assert_eq!(fixture.on_disk("main.tex").as_deref(), Some(MERGED));
}

#[cfg(unix)]
struct Unlocked(PathBuf);

#[cfg(unix)]
impl Drop for Unlocked {
    fn drop(&mut self) {
        use std::os::unix::fs::PermissionsExt as _;
        let _ = fs::set_permissions(&self.0, fs::Permissions::from_mode(0o755));
    }
}

#[cfg(unix)]
#[test]
fn a_failed_live_apply_rolls_back_without_pausing_sync() {
    use crate::collab::testing::{share, track, RecordedPauses, TempLibrary};
    use std::os::unix::fs::PermissionsExt as _;
    let library = TempLibrary::new();
    let root = library.project("live-failed", &[]);
    let temp = tempfile::tempdir().unwrap();
    let fixture = Fixture::at(temp, root.clone());
    let rig = LiveRig::start("live-failed", &root, &[("main.tex", "abc\n")]);
    let mut paths: Vec<String> = (1..=12)
        .map(|index| format!("figure{index:02}.bin"))
        .collect();
    paths.push("locked/last.bin".into());
    let before: &[u8] = &[1, 0, 1];
    let after: &[u8] = &[2, 0, 2];
    let changes: Vec<Change<'_>> = paths
        .iter()
        .map(|path| (path.as_str(), Some(before), Some(after)))
        .collect();
    let task = fixture.task("live-failed", &changes);
    let _shared = share("live-failed");
    let tracked: Vec<&str> = paths.iter().map(String::as_str).collect();
    track("live-failed", &tracked);
    for path in &tracked {
        age(&root.join(path));
    }
    fs::set_permissions(root.join("locked"), fs::Permissions::from_mode(0o555)).unwrap();
    let _unlocked = Unlocked(root.join("locked"));
    if fs::File::create(root.join("locked/.probe")).is_ok() {
        return;
    }
    let pauses = Arc::new(RecordedPauses::default());
    let token = crate::folder_watch::watch_project_reporting(
        "live-failed",
        Arc::new(|_| {}),
        pauses.clone(),
        Some(crate::folder_watch::WatchMode::Poll(Duration::from_millis(
            50,
        ))),
    )
    .unwrap()
    .expect("a shared library project is watched");
    std::thread::sleep(Duration::from_millis(200));

    let applied = fixture.apply(&task, &tracked, Some(&rig.document()));
    std::thread::sleep(Duration::from_millis(2_500));
    let heard = pauses.taken();
    crate::folder_watch::stop("live-failed", Some(token));

    assert!(applied.is_err());
    for path in &paths {
        assert_eq!(fs::read(root.join(path)).unwrap(), before, "{path}");
    }
    assert!(heard.is_empty(), "{heard:?}");
}

#[test]
fn a_live_apply_during_an_agent_turn_counts_as_an_edit_made_in_the_app() {
    use crate::collab::testing::TempLibrary;
    let library = TempLibrary::new();
    let root = library.project("live-turn", &[]);
    let temp = tempfile::tempdir().unwrap();
    let fixture = Fixture::at(temp, root.clone());
    let rig = LiveRig::start("live-turn", &root, &[("main.tex", "one\ntwo\n")]);
    let task = fixture.task(
        "live-turn",
        &[("main.tex", Some(b"one\ntwo\n"), Some(b"ONE\ntwo\n"))],
    );
    let snapshot = crate::agent_turns::begin("live-turn", "Test agent")
        .snapshot_id
        .expect("the turn took its copy");

    let applied = fixture.apply(&task, &["main.tex"], Some(&rig.document()));
    let changes = crate::agent_turns::finish("live-turn", &snapshot, None);

    assert_eq!(applied, Ok(true));
    let main = changes
        .files
        .iter()
        .find(|change| change.path == "main.tex")
        .expect("the turn lists main.tex");
    assert!(main.also_edited_here);
}

#[path = "live_preview.rs"]
mod preview_agreement;
