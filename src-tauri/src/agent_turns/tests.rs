use super::*;
use std::path::PathBuf;
use tauri::test::MockRuntime;
use tauri::Manager as _;

const DAY_MS: u64 = 24 * 60 * 60 * 1000;

struct Project {
    id: String,
    root: PathBuf,
    _folder: Option<tempfile::TempDir>,
    _data: tempfile::TempDir,
    _env: MutexGuard<'static, ()>,
}

impl Project {
    fn new(id: &str) -> Self {
        let env = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let root = crate::paths::create_project_dir(id).unwrap();
        // Undo runs inside the project transaction, which needs a main
        // document to reconcile the project's settings.
        std::fs::write(root.join("main.tex"), "\\documentclass{article}").unwrap();
        walk::set_test_placeholders(&[]);
        walk::set_test_listing_errors(&[]);
        Self {
            id: id.to_owned(),
            root,
            _folder: None,
            _data: data,
            _env: env,
        }
    }

    /// An opened-in-place folder instead of a library project.
    fn linked() -> Self {
        let env = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let outside = tempfile::tempdir().unwrap();
        let folder = outside.path().join("thesis");
        std::fs::create_dir(&folder).unwrap();
        let record = crate::linked_registry::register_folder_for_test(&folder);
        walk::set_test_placeholders(&[]);
        walk::set_test_listing_errors(&[]);
        Self {
            id: record.id,
            root: folder.canonicalize().unwrap(),
            _folder: Some(outside),
            _data: data,
            _env: env,
        }
    }

    fn write(&self, path: &str, content: impl AsRef<[u8]>) {
        let target = self.root.join(path);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(target, content).unwrap();
    }

    fn read(&self, path: &str) -> String {
        std::fs::read_to_string(self.root.join(path)).unwrap()
    }

    fn exists(&self, path: &str) -> bool {
        std::fs::symlink_metadata(self.root.join(path)).is_ok()
    }

    fn remove(&self, path: &str) {
        std::fs::remove_file(self.root.join(path)).unwrap();
    }

    /// Top-level names matching `name` in any case, as the disk spells them.
    fn names(&self, name: &str) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(&self.root)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|entry| entry.eq_ignore_ascii_case(name))
            .collect();
        names.sort();
        names
    }

    fn begin(&self) -> String {
        self.begin_with(&Limits::DEFAULT)
    }

    fn begin_with(&self, limits: &Limits) -> String {
        let began = begin_with(&self.id, "Test agent", limits, now_ms());
        assert_eq!(began.unavailable, None);
        began.snapshot_id.unwrap()
    }

    fn finish(&self, snapshot: &str) -> TurnChanges {
        let changes = finish(&self.id, snapshot, None);
        assert_eq!(changes.unavailable, None);
        changes
    }

    fn store(&self) -> PathBuf {
        store::store_dir(&self.id).unwrap()
    }

    fn blob_count(&self) -> usize {
        let Ok(folders) = std::fs::read_dir(self.store().join("blobs")) else {
            return 0;
        };
        folders
            .flatten()
            .map(|folder| std::fs::read_dir(folder.path()).unwrap().count())
            .sum()
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        walk::set_test_placeholders(&[]);
        walk::set_test_listing_errors(&[]);
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}

fn app() -> tauri::App<MockRuntime> {
    tauri::test::mock_builder()
        .manage(crate::state::AppState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap()
}

async fn apply(
    app: &tauri::App<MockRuntime>,
    project: &Project,
    snapshot: &str,
    indices: Option<Vec<u32>>,
    direction: Direction,
) -> TurnRevertResult {
    let generation = crate::project::project_mutation_generation(project.id.clone()).unwrap();
    apply_turn(
        app.handle(),
        &app.state::<crate::state::AppState>(),
        project.id.clone(),
        snapshot.to_owned(),
        indices,
        generation,
        direction,
    )
    .await
    .unwrap()
}

fn listed(changes: &TurnChanges) -> Vec<(&str, TurnChangeKind)> {
    changes
        .files
        .iter()
        .map(|file| (file.path.as_str(), file.change))
        .collect()
}

fn file<'a>(changes: &'a TurnChanges, path: &str) -> &'a TurnChange {
    changes
        .files
        .iter()
        .find(|file| file.path == path)
        .unwrap_or_else(|| panic!("{path} is not listed"))
}

fn states(status: &TurnStatus) -> Vec<TurnFileState> {
    status.files.iter().map(|file| file.state).collect()
}

fn in_the_past(project: &Project, path: &str) {
    let past = SystemTime::now() - Duration::from_secs(3600);
    std::fs::File::options()
        .write(true)
        .open(project.root.join(path))
        .unwrap()
        .set_modified(past)
        .unwrap();
}

use TurnChangeKind::{Added, Deleted, Modified};

#[tokio::test]
async fn a_turn_is_reviewed_undone_and_redone() {
    let project = Project::new("turns-round-trip");
    project.write("main.tex", "A\nB\n");
    project.write("notes.md", "keep\n");
    project.write("old.txt", "old\n");
    let snapshot = project.begin();

    project.write("main.tex", "A\nC\nD\n");
    project.remove("old.txt");
    project.write("figures/new.tex", "new\n");
    let changes = project.finish(&snapshot);

    assert_eq!(changes.snapshot_id.as_deref(), Some(snapshot.as_str()));
    assert_eq!(
        listed(&changes),
        [
            ("figures/new.tex", Added),
            ("main.tex", Modified),
            ("old.txt", Deleted)
        ]
    );
    assert_eq!(
        changes
            .files
            .iter()
            .map(|file| file.index)
            .collect::<Vec<_>>(),
        [0, 1, 2]
    );
    let main = file(&changes, "main.tex");
    assert_eq!((main.added, main.removed), (Some(2), Some(1)));
    assert_eq!((main.before_size, main.after_size), (Some(4), Some(6)));
    let added = file(&changes, "figures/new.tex");
    assert_eq!((added.added, added.removed), (Some(1), Some(0)));
    assert_eq!((added.before_size, added.after_size), (None, Some(4)));
    let deleted = file(&changes, "old.txt");
    assert_eq!((deleted.added, deleted.removed), (Some(0), Some(1)));
    assert_eq!(changes.more_files, 0);
    assert!(changes.skipped.is_empty());
    assert!(!changes.overlapped);
    assert!(changes
        .files
        .iter()
        .all(|file| !file.build && !file.also_edited_here));

    let current = status(&project.id, &snapshot).unwrap();
    assert!(!current.expired);
    assert_eq!(states(&current), [TurnFileState::Applied; 3]);

    let shown = preview(&project.id, &snapshot, main.index).unwrap();
    assert_eq!(shown.path, "main.tex");
    assert_eq!(shown.before.as_deref(), Some("A\nB\n"));
    assert_eq!(shown.after.as_deref(), Some("A\nC\nD\n"));
    assert!(!shown.binary && !shown.too_large);
    assert_eq!(shown.state, TurnFileState::Applied);
    let shown = preview(&project.id, &snapshot, added.index).unwrap();
    assert_eq!(
        (shown.before, shown.after.as_deref()),
        (None, Some("new\n"))
    );

    let app = app();
    let undone = apply(&app, &project, &snapshot, None, Direction::Undo).await;
    assert_eq!(undone.reverted, [0, 1, 2]);
    assert!(undone.skipped.is_empty());
    assert_eq!(undone.project_state.reason, "agent-turn-revert");
    assert!(undone.project_state.files_changed);
    assert_eq!(project.read("main.tex"), "A\nB\n");
    assert_eq!(project.read("old.txt"), "old\n");
    assert!(!project.exists("figures/new.tex"));
    assert!(
        !project.exists("figures"),
        "the folder the turn made is gone"
    );
    assert_eq!(project.read("notes.md"), "keep\n");
    assert_eq!(
        states(&status(&project.id, &snapshot).unwrap()),
        [TurnFileState::Undone; 3]
    );

    let redone = apply(&app, &project, &snapshot, None, Direction::Redo).await;
    assert_eq!(redone.reverted, [0, 1, 2]);
    assert_eq!(redone.project_state.reason, "agent-turn-redo");
    assert_eq!(project.read("main.tex"), "A\nC\nD\n");
    assert!(!project.exists("old.txt"));
    assert_eq!(project.read("figures/new.tex"), "new\n");
    assert_eq!(
        states(&status(&project.id, &snapshot).unwrap()),
        [TurnFileState::Applied; 3]
    );

    let single = apply(&app, &project, &snapshot, Some(vec![1]), Direction::Undo).await;
    assert_eq!(single.reverted, [1]);
    assert_eq!(project.read("main.tex"), "A\nB\n");
    assert_eq!(project.read("figures/new.tex"), "new\n");
}

#[tokio::test]
async fn undo_leaves_a_file_edited_after_the_turn_alone() {
    let project = Project::new("turns-edited");
    project.write("a.tex", "a1");
    project.write("b.tex", "b1");
    let snapshot = project.begin();
    project.write("a.tex", "a2");
    project.write("b.tex", "b2");
    let changes = project.finish(&snapshot);
    project.write("a.tex", "mine");

    assert_eq!(
        states(&status(&project.id, &snapshot).unwrap()),
        [TurnFileState::Edited, TurnFileState::Applied]
    );
    let a = file(&changes, "a.tex").index;
    let b = file(&changes, "b.tex").index;
    let undone = apply(&app(), &project, &snapshot, None, Direction::Undo).await;
    assert_eq!(undone.reverted, [b]);
    assert_eq!(
        undone.skipped,
        [TurnRevertSkipped {
            index: a,
            reason: TurnRevertSkipReason::Edited
        }]
    );
    assert_eq!(project.read("a.tex"), "mine");
    assert_eq!(project.read("b.tex"), "b1");

    let redo = apply(&app(), &project, &snapshot, Some(vec![a]), Direction::Redo).await;
    assert_eq!(redo.skipped[0].reason, TurnRevertSkipReason::Edited);
    assert_eq!(project.read("a.tex"), "mine");
}

#[tokio::test]
async fn a_case_only_rename_is_undone_and_redone() {
    let project = Project::new("turns-case-rename");
    project.write("Intro.tex", "intro text");
    let snapshot = project.begin();
    std::fs::rename(
        project.root.join("Intro.tex"),
        project.root.join("intro.tex"),
    )
    .unwrap();
    let changes = project.finish(&snapshot);
    assert_eq!(
        listed(&changes),
        [("Intro.tex", Deleted), ("intro.tex", Added)]
    );

    let app = app();
    let undone = apply(&app, &project, &snapshot, None, Direction::Undo).await;
    assert_eq!(undone.reverted, [0, 1]);
    assert_eq!(project.names("intro.tex"), ["Intro.tex"]);
    assert_eq!(project.read("Intro.tex"), "intro text");

    let redone = apply(&app, &project, &snapshot, None, Direction::Redo).await;
    assert_eq!(redone.reverted, [0, 1]);
    assert_eq!(project.names("intro.tex"), ["intro.tex"]);
    assert_eq!(project.read("intro.tex"), "intro text");
}

#[tokio::test]
async fn files_saved_in_oleafly_during_the_turn_are_kept_out_of_undo_all() {
    let project = Project::new("turns-also-edited");
    project.write("main.tex", "draft");
    project.write("refs.bib", "@a{}");
    let snapshot = project.begin();
    project.write("refs.bib", "@a{} @b{}");
    crate::project::admit_project_file_write(project.id.clone(), "main.tex".into(), None)
        .unwrap()
        .write(b"typed by the user")
        .unwrap();
    let changes = project.finish(&snapshot);
    assert!(file(&changes, "main.tex").also_edited_here);
    assert!(!file(&changes, "refs.bib").also_edited_here);

    let undone = apply(&app(), &project, &snapshot, None, Direction::Undo).await;
    assert_eq!(undone.reverted, [file(&changes, "refs.bib").index]);
    assert_eq!(project.read("main.tex"), "typed by the user");
    assert_eq!(project.read("refs.bib"), "@a{}");

    // The assistant's own tool writes go through the same path but belong to
    // the turn.
    let snapshot = project.begin();
    crate::project::admit_project_file_write(project.id.clone(), "./main.tex".into(), None)
        .unwrap()
        .write(b"written by a tool")
        .unwrap();
    let changes = finish(&project.id, &snapshot, Some(&["main.tex".to_owned()]));
    assert!(!file(&changes, "main.tex").also_edited_here);
}

#[test]
fn saves_outside_a_turn_are_not_remembered() {
    let project = Project::new("turns-no-open-turn");
    project.write("main.tex", "one");
    note_app_write(&project.id, "main.tex");
    let snapshot = project.begin();
    project.write("main.tex", "two");
    let changes = project.finish(&snapshot);
    assert!(!file(&changes, "main.tex").also_edited_here);
    note_app_write(&project.id, "main.tex");
    assert!(open_turns().get(&project.id).is_none());
}

#[test]
fn overlapping_turns_are_flagged() {
    let project = Project::new("turns-overlap");
    project.write("x.tex", "x");
    let first = project.begin();
    let second = project.begin();
    project.write("x.tex", "y");
    assert!(project.finish(&second).overlapped);
    assert!(project.finish(&first).overlapped);

    let third = project.begin();
    project.write("x.tex", "z");
    assert!(!project.finish(&third).overlapped);
}

#[tokio::test]
async fn build_output_is_listed_but_never_undone() {
    let project = Project::new("turns-build");
    project.write("main.tex", "\\begin{document}\\end{document}");
    project.write("main.log", "old log");
    let snapshot = project.begin();
    let blobs = project.blob_count();
    project.write("main.tex", "\\begin{document}x\\end{document}");
    project.write("main.aux", "\\relax");
    project.write("main.log", "new log, longer");
    project.write("main.pdf", "%PDF-1.7");
    project.write("figures/plot.pdf", "%PDF-1.7 figure");
    let changes = project.finish(&snapshot);
    assert_eq!(
        listed(&changes),
        [
            ("figures/plot.pdf", Added),
            ("main.tex", Modified),
            ("main.aux", Added),
            ("main.log", Modified),
            ("main.pdf", Added),
        ]
    );
    assert_eq!(
        changes
            .files
            .iter()
            .map(|file| file.build)
            .collect::<Vec<_>>(),
        [false, false, true, true, true]
    );
    let aux = file(&changes, "main.aux");
    assert_eq!((aux.added, aux.removed), (None, None));
    // Two new blobs: the changed manuscript and the figure. Build output is
    // never kept.
    assert_eq!(project.blob_count(), blobs + 2);

    let app = app();
    let undone = apply(&app, &project, &snapshot, None, Direction::Undo).await;
    assert_eq!(undone.reverted, [0, 1]);
    assert!(project.exists("main.aux") && project.exists("main.pdf"));
    assert_eq!(project.read("main.log"), "new log, longer");
    assert!(!project.exists("figures/plot.pdf"));
    assert_eq!(project.read("main.tex"), "\\begin{document}\\end{document}");

    let explicit = apply(
        &app,
        &project,
        &snapshot,
        Some(vec![aux.index]),
        Direction::Undo,
    )
    .await;
    assert!(explicit.reverted.is_empty());
    assert_eq!(explicit.skipped[0].reason, TurnRevertSkipReason::Expired);
    assert!(project.exists("main.aux"));

    let current = status(&project.id, &snapshot).unwrap();
    assert_eq!(current.files[2].state, TurnFileState::Applied);
    let shown = preview(&project.id, &snapshot, aux.index).unwrap();
    assert!(shown.binary);
    assert_eq!((shown.before, shown.after), (None, None));
}

#[test]
fn limits_make_the_turn_unavailable() {
    let project = Project::new("turns-limits");
    project.write("a.tex", "aaaa");
    project.write("b.tex", "bbbb");
    let began = |limits: Limits| begin_with(&project.id, "Test agent", &limits, now_ms());

    let few_files = began(Limits {
        max_files: 1,
        ..Limits::DEFAULT
    });
    assert_eq!(few_files.snapshot_id, None);
    assert_eq!(few_files.unavailable, Some(TurnUnavailable::TooManyFiles));

    let little_content = began(Limits {
        max_total_bytes: 7,
        ..Limits::DEFAULT
    });
    assert_eq!(little_content.unavailable, Some(TurnUnavailable::TooLarge));

    let no_time = began(Limits {
        budget: Duration::ZERO,
        ..Limits::DEFAULT
    });
    assert_eq!(no_time.unavailable, Some(TurnUnavailable::Timeout));

    let missing = begin("turns-no-such-project", "Test agent");
    assert_eq!(missing.unavailable, Some(TurnUnavailable::Error));

    let snapshot = project.begin();
    let late = finish_with(
        &project.id,
        &snapshot,
        None,
        &Limits {
            budget: Duration::ZERO,
            ..Limits::DEFAULT
        },
    );
    assert_eq!(late.unavailable, Some(TurnUnavailable::Timeout));
    assert!(late.files.is_empty());
    // A finished turn stays finished.
    assert_eq!(
        finish(&project.id, &snapshot, None).unavailable,
        Some(TurnUnavailable::Timeout)
    );
    assert!(!status(&project.id, &snapshot).unwrap().expired);
}

#[test]
fn files_that_cannot_be_kept_are_reported_only_when_they_change() {
    let project = Project::new("turns-skipped");
    let limits = Limits {
        max_file_bytes: 10,
        ..Limits::DEFAULT
    };
    project.write("big.csv", "0123456789abcdef");
    project.write("still-big.csv", "0123456789abcdef");
    project.write("cloud.pdf", "remote");
    project.write("small.tex", "one");
    walk::set_test_placeholders(&["cloud.pdf", "new-cloud.pdf"]);
    let snapshot = project.begin_with(&limits);
    project.write("big.csv", "0123456789abcdefgh");
    project.write("cloud.pdf", "remote, changed");
    project.write("new-cloud.pdf", "remote");
    project.write("small.tex", "two");
    project.write("new-big.csv", "0123456789abcdefgh");
    let changes = finish_with(&project.id, &snapshot, None, &limits);
    assert_eq!(listed(&changes), [("small.tex", Modified)]);
    let mut skipped: Vec<(&str, TurnSkipReason)> = changes
        .skipped
        .iter()
        .map(|skipped| (skipped.path.as_str(), skipped.reason))
        .collect();
    skipped.sort_by(|left, right| left.0.cmp(right.0));
    assert_eq!(
        skipped,
        [
            ("big.csv", TurnSkipReason::TooLarge),
            ("cloud.pdf", TurnSkipReason::CloudPlaceholder),
            ("new-big.csv", TurnSkipReason::TooLarge),
            ("new-cloud.pdf", TurnSkipReason::CloudPlaceholder),
        ]
    );
}

#[test]
fn a_full_store_keeps_nothing_new() {
    let project = Project::new("turns-store-full");
    let limits = Limits {
        store_bytes: 1,
        ..Limits::DEFAULT
    };
    project.write("main.tex", "content");
    let snapshot = project.begin_with(&limits);
    assert_eq!(project.blob_count(), 0);
    project.write("main.tex", "changed");
    project.write("new.tex", "added");
    let changes = finish_with(&project.id, &snapshot, None, &limits);
    assert!(changes.files.is_empty());
    let mut skipped: Vec<_> = changes
        .skipped
        .iter()
        .map(|skipped| (skipped.path.as_str(), skipped.reason))
        .collect();
    skipped.sort_by(|left, right| left.0.cmp(right.0));
    assert_eq!(
        skipped,
        [
            ("main.tex", TurnSkipReason::StoreFull),
            ("new.tex", TurnSkipReason::StoreFull)
        ]
    );
}

#[cfg(unix)]
#[test]
fn symbolic_links_are_skipped() {
    let project = Project::new("turns-symlink");
    project.write("main.tex", "text");
    project.write("old-link-target.tex", "text");
    std::os::unix::fs::symlink("old-link-target.tex", project.root.join("kept.tex")).unwrap();
    let snapshot = project.begin();
    std::os::unix::fs::symlink("main.tex", project.root.join("link.tex")).unwrap();
    let changes = project.finish(&snapshot);
    assert!(changes.files.is_empty());
    assert_eq!(
        changes.skipped,
        [TurnSkipped {
            path: "link.tex".into(),
            reason: TurnSkipReason::Symlink
        }]
    );
}

#[test]
fn generated_folders_and_os_files_are_left_out() {
    let project = Project::new("turns-left-out");
    project.write("main.tex", "text");
    let snapshot = project.begin();
    for path in [
        ".git/index",
        ".oleafly/state.json",
        "node_modules/x/index.js",
        ".venv/bin/python",
        "__pycache__/x.pyc",
        "_minted-main/x.pygtex",
        "_minted/x.pygtex",
        "pythontex-files-main/x.out",
        ".DS_Store",
        "chapters/Thumbs.db",
        "desktop.ini",
        "project.json",
    ] {
        project.write(path, "generated");
    }
    let changes = project.finish(&snapshot);
    assert_eq!(listed(&changes), [] as [(&str, TurnChangeKind); 0]);
    assert!(changes.skipped.is_empty());
}

#[test]
fn finishing_twice_returns_the_same_changes() {
    let project = Project::new("turns-idempotent");
    project.write("main.tex", "one");
    let snapshot = project.begin();
    project.write("main.tex", "two");
    let first = project.finish(&snapshot);
    project.write("main.tex", "three");
    assert_eq!(finish(&project.id, &snapshot, None), first);
}

#[tokio::test]
async fn the_payload_is_capped_and_undo_all_covers_the_rest() {
    let project = Project::new("turns-payload");
    for name in ["a.tex", "b.tex", "c.tex"] {
        project.write(name, "before");
    }
    let snapshot = project.begin();
    for name in ["a.tex", "b.tex", "c.tex"] {
        project.write(name, "after");
    }
    let changes = finish_with(
        &project.id,
        &snapshot,
        None,
        &Limits {
            max_payload_files: 2,
            ..Limits::DEFAULT
        },
    );
    assert_eq!(changes.files.len(), 2);
    assert_eq!(changes.more_files, 1);
    assert_eq!(status(&project.id, &snapshot).unwrap().files.len(), 2);
    let undone = apply(&app(), &project, &snapshot, None, Direction::Undo).await;
    assert_eq!(undone.reverted, [0, 1, 2]);
    for name in ["a.tex", "b.tex", "c.tex"] {
        assert_eq!(project.read(name), "before");
    }

    let tiny = shown_count(
        &[stored_change("a.tex", Modified, None, None)],
        &[],
        &Limits {
            max_payload_bytes: 10,
            ..Limits::DEFAULT
        },
    );
    assert_eq!(tiny, 0);
}

#[test]
fn previews_flag_binary_and_very_long_files() {
    let project = Project::new("turns-preview");
    project.write("data.bin", [0_u8, 1, 2, 3]);
    project.write("long.txt", "short");
    let snapshot = project.begin();
    project.write("data.bin", [0_u8, 1, 2, 3, 4]);
    project.write("long.txt", "x".repeat(PREVIEW_CHARS + 1));
    let changes = project.finish(&snapshot);
    let binary = preview(&project.id, &snapshot, file(&changes, "data.bin").index).unwrap();
    assert!(binary.binary);
    assert_eq!((binary.before, binary.after), (None, None));
    let long = preview(&project.id, &snapshot, file(&changes, "long.txt").index).unwrap();
    assert!(long.too_large && !long.binary);
    assert_eq!((long.before, long.after), (None, None));
    assert_eq!(
        preview(&project.id, &snapshot, 99).unwrap_err(),
        NOT_IN_TURN
    );
}

#[tokio::test]
async fn old_turns_expire_and_their_content_is_swept() {
    let project = Project::new("turns-retention");
    let limits = Limits {
        keep_newest: 2,
        ..Limits::DEFAULT
    };
    let now = now_ms();
    let turn = |days_ago: u64, content: &str| {
        let began = begin_with(&project.id, "Test agent", &limits, now - days_ago * DAY_MS);
        let snapshot = began.snapshot_id.unwrap();
        project.write("main.tex", content);
        project.finish(&snapshot);
        snapshot
    };
    project.write("main.tex", "v1");
    let oldest = turn(30, "v2");
    let older = turn(20, "v3");
    let old = turn(16, "v4");
    let blob = |content: &str| {
        let sha = store::sha256_hex(content.as_bytes());
        project.store().join("blobs").join(&sha[..2]).join(sha)
    };
    assert!(blob("v1").is_file());

    let current = begin_with(&project.id, "Test agent", &limits, now);
    assert!(current.snapshot_id.is_some());
    assert!(status(&project.id, &oldest).unwrap().expired);
    assert!(!status(&project.id, &older).unwrap().expired);
    assert!(!status(&project.id, &old).unwrap().expired);
    assert!(!blob("v1").exists(), "only the expired turn used v1");
    assert!(blob("v2").is_file() && blob("v4").is_file());

    let undone = apply(&app(), &project, &oldest, Some(vec![0]), Direction::Undo).await;
    assert_eq!(
        undone.skipped,
        [TurnRevertSkipped {
            index: 0,
            reason: TurnRevertSkipReason::Expired
        }]
    );
    assert!(preview(&project.id, &oldest, 0).is_err());
    assert_eq!(project.read("main.tex"), "v4");
}

#[test]
fn young_turns_are_kept_even_beyond_the_newest_count() {
    let project = Project::new("turns-young");
    let limits = Limits {
        keep_newest: 1,
        ..Limits::DEFAULT
    };
    project.write("main.tex", "v1");
    let first = project.begin_with(&limits);
    project.finish(&first);
    let second = project.begin_with(&limits);
    project.finish(&second);
    project.begin_with(&limits);
    assert!(!status(&project.id, &first).unwrap().expired);
}

#[test]
fn removing_a_project_deletes_its_turns() {
    let project = Project::new("turns-remove");
    project.write("main.tex", "text");
    let snapshot = project.begin();
    assert!(project.store().is_dir());
    remove_project(&project.id);
    assert!(!project.store().exists());
    assert!(open_turns().get(&project.id).is_none());
    assert!(status(&project.id, &snapshot).unwrap().expired);
    assert_eq!(
        finish(&project.id, &snapshot, None).unavailable,
        Some(TurnUnavailable::Error)
    );
    remove_project(&project.id);
}

#[test]
fn kept_content_is_zstd_compressed_and_verified() {
    let project = Project::new("turns-zstd");
    let text = "\\section{Results}\n".repeat(1000);
    project.write("main.tex", &text);
    project.begin();
    let sha = store::sha256_hex(text.as_bytes());
    let path = project.store().join("blobs").join(&sha[..2]).join(&sha);
    let stored = std::fs::read(&path).unwrap();
    assert_eq!(&stored[..4], &[0x28, 0xB5, 0x2F, 0xFD]);
    assert!(stored.len() < text.len() / 10);

    let store = Store::lock(&project.id, Instant::now() + STORE_WAIT, false)
        .ok()
        .flatten()
        .unwrap();
    assert_eq!(
        store.read_blob(&sha, text.len() as u64).unwrap(),
        text.as_bytes()
    );
    assert!(store.read_blob(&sha, 3).is_none(), "wrong size is refused");
    assert!(!path.exists(), "a blob that fails verification is dropped");
    let mut budget = Budget::lazy(u64::MAX);
    assert!(store.put_blob(&sha, text.as_bytes(), &mut budget).unwrap());
    assert!(store.read_blob(&sha, text.len() as u64).is_some());
    assert!(store.put_blob("../../escape", b"x", &mut budget).is_err());
}

#[test]
fn unchanged_files_come_from_the_stat_cache() {
    let project = Project::new("turns-stat-cache");
    project.write("main.tex", "text");
    in_the_past(&project, "main.tex");
    let first = project.begin();
    project.finish(&first);
    let index = std::fs::read_to_string(project.store().join("index.json")).unwrap();
    assert!(index.contains("main.tex"));

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let target = project.root.join("main.tex");
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o000)).unwrap();
        let readable = std::fs::read(&target).is_ok();
        let second = project.begin();
        let changes = project.finish(&second);
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o644)).unwrap();
        if !readable {
            // The copy came from the cache: nothing was reported unreadable.
            assert!(changes.skipped.is_empty(), "{:?}", changes.skipped);
            assert!(changes.files.is_empty());
        }
    }
}

#[tokio::test]
async fn a_read_only_file_is_still_undone() {
    let project = Project::new("turns-read-only");
    project.write("main.tex", "before");
    let snapshot = project.begin();
    project.write("main.tex", "after");
    project.finish(&snapshot);
    let target = project.root.join("main.tex");
    let mut permissions = std::fs::metadata(&target).unwrap().permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(&target, permissions).unwrap();

    let undone = apply(&app(), &project, &snapshot, None, Direction::Undo).await;
    assert_eq!(undone.reverted, [0]);
    assert_eq!(project.read("main.tex"), "before");
    let mut permissions = std::fs::metadata(&target).unwrap().permissions();
    #[cfg(windows)]
    assert!(permissions.readonly(), "the read-only flag is put back");
    #[allow(clippy::permissions_set_readonly_false)]
    permissions.set_readonly(false);
    std::fs::set_permissions(&target, permissions).unwrap();
}

#[tokio::test]
async fn a_folder_opened_in_place_is_undone_in_place() {
    let project = Project::linked();
    project.write("main.tex", "before");
    project.write("sections/a.tex", "a");
    let snapshot = project.begin();
    project.write("main.tex", "after");
    project.remove("sections/a.tex");
    let changes = project.finish(&snapshot);
    assert_eq!(
        listed(&changes),
        [("main.tex", Modified), ("sections/a.tex", Deleted)]
    );
    let undone = apply(&app(), &project, &snapshot, None, Direction::Undo).await;
    assert_eq!(undone.reverted, [0, 1]);
    assert_eq!(project.read("main.tex"), "before");
    assert_eq!(project.read("sections/a.tex"), "a");
}

#[tokio::test]
async fn unknown_or_expired_turns_are_reported_as_expired() {
    let project = Project::new("turns-expired");
    project.write("main.tex", "text");
    assert!(
        status(&project.id, "0000000000000-deadbeef")
            .unwrap()
            .expired
    );
    assert!(status(&project.id, "../escape").unwrap().expired);
    assert!(preview(&project.id, "0000000000000-deadbeef", 0).is_err());
    let undone = apply(
        &app(),
        &project,
        "0000000000000-deadbeef",
        Some(vec![0, 3]),
        Direction::Undo,
    )
    .await;
    assert!(undone.reverted.is_empty());
    assert_eq!(undone.skipped.len(), 2);
    assert!(!undone.project_state.files_changed);
    assert_eq!(
        finish(&project.id, "../escape", None).unavailable,
        Some(TurnUnavailable::Error)
    );
}

#[test]
fn a_turn_that_changed_nothing_lists_nothing() {
    let project = Project::new("turns-nothing");
    project.write("main.tex", "text");
    let snapshot = project.begin();
    let changes = project.finish(&snapshot);
    assert!(changes.files.is_empty() && changes.skipped.is_empty());
    assert_eq!(changes.more_files, 0);
    assert_eq!(changes.unavailable, None);
}

#[test]
fn relative_paths_are_normalized_like_the_walk() {
    assert_eq!(
        normalize_relative("./chapters//intro.tex"),
        "chapters/intro.tex"
    );
    assert_eq!(normalize_relative("main.tex"), "main.tex");
    assert_eq!(normalize_relative("."), "");
    assert_eq!(ancestors("a/b/c.tex").collect::<Vec<_>>(), ["a/b", "a"]);
    assert!(valid_snapshot_id("0001234567890-0a1b2c3d"));
    assert!(!valid_snapshot_id("../x"));
    assert!(!valid_snapshot_id(""));
}

fn skipped_paths(changes: &TurnChanges) -> Vec<(&str, TurnSkipReason)> {
    let mut skipped: Vec<(&str, TurnSkipReason)> = changes
        .skipped
        .iter()
        .map(|skipped| (skipped.path.as_str(), skipped.reason))
        .collect();
    skipped.sort_by(|left, right| left.0.cmp(right.0));
    skipped
}

#[tokio::test]
async fn a_linked_manifest_keeps_the_role_it_had_when_the_turn_began() {
    let project = Project::linked();
    project.write("main.tex", "\\documentclass{article}");
    let manifest = r#"{"main_doc":"main.tex"}"#;
    project.write("project.json", manifest);
    let snapshot = project.begin();
    // The turn breaks the Oleafly manifest, so it no longer reads as one.
    let broken = r#"{"main_doc":"main.tex","engine":"pdflatex"}"#;
    project.write("project.json", broken);
    project.write("main.tex", "\\documentclass{report}");
    let changes = project.finish(&snapshot);
    assert_eq!(listed(&changes), [("main.tex", Modified)]);
    let app = app();
    let undone = apply(&app, &project, &snapshot, None, Direction::Undo).await;
    assert_eq!(undone.reverted, [0]);
    assert_eq!(
        project.read("project.json"),
        broken,
        "never deleted by Undo"
    );

    // A foreign project.json the turn turns into a manifest is compared like
    // any other file, not listed as deleted.
    let snapshot = project.begin();
    project.write("project.json", manifest);
    let changes = project.finish(&snapshot);
    assert_eq!(listed(&changes), [("project.json", Modified)]);
    let undone = apply(&app, &project, &snapshot, None, Direction::Undo).await;
    assert_eq!(undone.reverted, [0]);
    assert_eq!(project.read("project.json"), broken);

    // A manifest that only appears during the turn is Oleafly's own (saving
    // the settings to the folder writes one), so Undo leaves it alone.
    project.remove("project.json");
    let snapshot = project.begin();
    project.write("project.json", manifest);
    let changes = project.finish(&snapshot);
    assert!(changes.files.is_empty(), "{:?}", changes.files);
}

#[tokio::test]
async fn a_folder_that_was_empty_before_the_turn_survives_undo() {
    let project = Project::new("turns-empty-folder");
    std::fs::create_dir(project.root.join("figures")).unwrap();
    let snapshot = project.begin();
    project.write("figures/plot.png", [0x89, b'P', b'N', b'G']);
    project.write("new/deep/file.tex", "new");
    let changes = project.finish(&snapshot);
    assert_eq!(
        listed(&changes),
        [("figures/plot.png", Added), ("new/deep/file.tex", Added)]
    );
    let undone = apply(&app(), &project, &snapshot, None, Direction::Undo).await;
    assert_eq!(undone.reverted, [0, 1]);
    assert!(!project.exists("figures/plot.png"));
    assert!(
        project.root.join("figures").is_dir(),
        "the folder made before the turn is kept"
    );
    assert!(!project.exists("new"), "the folders the turn made are gone");
}

#[cfg(unix)]
#[tokio::test]
async fn files_in_a_folder_unreadable_at_finish_are_never_listed_as_deleted() {
    use std::os::unix::fs::PermissionsExt as _;
    let project = Project::new("turns-unreadable-after");
    project.write("main.tex", "before");
    project.write("chapters/a.tex", "chapter a");
    let snapshot = project.begin();
    project.write("main.tex", "after");
    let chapters = project.root.join("chapters");
    std::fs::set_permissions(&chapters, std::fs::Permissions::from_mode(0o000)).unwrap();
    let blocked = std::fs::read_dir(&chapters).is_err();
    let changes = finish(&project.id, &snapshot, None);
    std::fs::set_permissions(&chapters, std::fs::Permissions::from_mode(0o755)).unwrap();
    if !blocked {
        // Running with permissions that read every folder.
        return;
    }
    assert_eq!(changes.unavailable, None);
    assert_eq!(listed(&changes), [("main.tex", Modified)]);
    assert_eq!(
        skipped_paths(&changes),
        [
            ("chapters", TurnSkipReason::Unreadable),
            ("chapters/a.tex", TurnSkipReason::Unreadable)
        ]
    );
    let app = app();
    apply(&app, &project, &snapshot, None, Direction::Undo).await;
    apply(&app, &project, &snapshot, None, Direction::Redo).await;
    assert_eq!(project.read("main.tex"), "after");
    assert_eq!(project.read("chapters/a.tex"), "chapter a");
}

#[tokio::test]
async fn a_folder_listing_that_fails_part_way_is_never_undone_as_added_or_deleted() {
    let project = Project::new("turns-listing-error");
    project.write("sections/a.tex", "mine");
    walk::set_test_listing_errors(&["sections"]);
    let snapshot = project.begin();
    walk::set_test_listing_errors(&[]);
    project.write("main.tex", "changed");
    let changes = project.finish(&snapshot);
    assert_eq!(listed(&changes), [("main.tex", Modified)]);
    assert!(
        skipped_paths(&changes).contains(&("sections/a.tex", TurnSkipReason::Unreadable)),
        "{:?}",
        changes.skipped
    );
    let app = app();
    apply(&app, &project, &snapshot, None, Direction::Undo).await;
    assert_eq!(project.read("sections/a.tex"), "mine");

    // The same at finish: the file is not listed as deleted.
    let snapshot = project.begin();
    project.write("main.tex", "changed again");
    walk::set_test_listing_errors(&["sections"]);
    let changes = project.finish(&snapshot);
    walk::set_test_listing_errors(&[]);
    assert_eq!(listed(&changes), [("main.tex", Modified)]);
    apply(&app, &project, &snapshot, None, Direction::Undo).await;
    apply(&app, &project, &snapshot, None, Direction::Redo).await;
    assert_eq!(project.read("sections/a.tex"), "mine");

    // When the project folder itself cannot be listed, Undo is unavailable.
    walk::set_test_listing_errors(&[""]);
    let began = begin_with(&project.id, "Test agent", &Limits::DEFAULT, now_ms());
    assert_eq!(began.unavailable, Some(TurnUnavailable::Error));
    walk::set_test_listing_errors(&[]);
    let snapshot = project.begin();
    walk::set_test_listing_errors(&[""]);
    let late = finish(&project.id, &snapshot, None);
    walk::set_test_listing_errors(&[]);
    assert_eq!(late.unavailable, Some(TurnUnavailable::Error));
}

#[tokio::test]
async fn single_rows_of_a_case_only_rename_never_touch_the_other_name() {
    let project = Project::new("turns-case-rows");
    project.write("Intro.tex", "intro text");
    let snapshot = project.begin();
    std::fs::rename(
        project.root.join("Intro.tex"),
        project.root.join("intro.tex"),
    )
    .unwrap();
    let insensitive = project.exists("INTRO.TEX");
    let changes = project.finish(&snapshot);
    assert_eq!(
        listed(&changes),
        [("Intro.tex", Deleted), ("intro.tex", Added)]
    );
    assert_eq!(
        states(&status(&project.id, &snapshot).unwrap()),
        [TurnFileState::Applied, TurnFileState::Applied]
    );
    let app = app();
    // Redo of the deleted old name must not delete the file under its new
    // name.
    apply(&app, &project, &snapshot, Some(vec![0]), Direction::Redo).await;
    assert_eq!(project.names("intro.tex"), ["intro.tex"]);
    assert_eq!(project.read("intro.tex"), "intro text");
    if insensitive {
        // Bringing the old name back alone would overwrite the new one.
        let undone = apply(&app, &project, &snapshot, Some(vec![0]), Direction::Undo).await;
        assert!(undone.reverted.is_empty());
        assert_eq!(
            undone.skipped,
            [TurnRevertSkipped {
                index: 0,
                reason: TurnRevertSkipReason::Edited
            }]
        );
        assert_eq!(project.names("intro.tex"), ["intro.tex"]);
    }
    // The card's Undo all with explicit rows.
    let undone = apply(&app, &project, &snapshot, Some(vec![0, 1]), Direction::Undo).await;
    assert_eq!(undone.reverted, [0, 1]);
    assert_eq!(project.names("intro.tex"), ["Intro.tex"]);
    assert_eq!(
        states(&status(&project.id, &snapshot).unwrap()),
        [TurnFileState::Undone, TurnFileState::Undone]
    );
    // Undo of the added new name must not delete the file under its old name.
    apply(&app, &project, &snapshot, Some(vec![1]), Direction::Undo).await;
    assert_eq!(project.names("intro.tex"), ["Intro.tex"]);
    if insensitive {
        let redone = apply(&app, &project, &snapshot, Some(vec![1]), Direction::Redo).await;
        assert!(redone.reverted.is_empty());
        assert_eq!(project.names("intro.tex"), ["Intro.tex"]);
    }
    let redone = apply(&app, &project, &snapshot, Some(vec![0, 1]), Direction::Redo).await;
    assert_eq!(redone.reverted, [0, 1]);
    assert_eq!(project.names("intro.tex"), ["intro.tex"]);
    assert_eq!(project.read("intro.tex"), "intro text");
}

#[tokio::test]
async fn retention_keeps_a_turn_it_cannot_read_for_a_moment() {
    let project = Project::new("turns-retention-unreadable");
    project.write("main.tex", "v1");
    let snapshot = project.begin();
    project.write("main.tex", "v2");
    project.finish(&snapshot);
    let file = project
        .store()
        .join("snapshots")
        .join(format!("{snapshot}.json"));
    let saved = std::fs::read(&file).unwrap();
    std::fs::write(&file, b"{ not yet readable").unwrap();
    project.begin();
    assert!(file.exists(), "a turn retention keeps is never deleted");
    std::fs::write(&file, &saved).unwrap();
    assert!(!status(&project.id, &snapshot).unwrap().expired);
    let undone = apply(&app(), &project, &snapshot, None, Direction::Undo).await;
    assert_eq!(undone.reverted, [0]);
    assert_eq!(project.read("main.tex"), "v1");
}

#[test]
fn an_abandoned_copy_never_keeps_its_turn_open() {
    let project = Project::new("turns-abandoned-begin");
    project.write("main.tex", "one");
    let snapshots = || {
        std::fs::read_dir(project.store().join("snapshots"))
            .map(|entries| entries.count())
            .unwrap_or(0)
    };

    // Given up before the copy was registered: it never is, and its copy is
    // not kept.
    let ticket = BeginTicket::default();
    ticket.abandon();
    let late = begin_for(&project.id, "Test agent", &ticket);
    assert_eq!(late.snapshot_id, None);
    assert_eq!(late.unavailable, Some(TurnUnavailable::Timeout));
    assert!(open_turns().get(&project.id).is_none());
    assert_eq!(snapshots(), 0);

    // Given up after it was registered: the turn is closed again.
    let ticket = BeginTicket::default();
    assert!(begin_for(&project.id, "Test agent", &ticket)
        .snapshot_id
        .is_some());
    assert!(open_turns().get(&project.id).is_some());
    ticket.abandon();
    assert!(open_turns().get(&project.id).is_none());

    let next = project.begin();
    project.write("main.tex", "two");
    assert!(!project.finish(&next).overlapped);
}
