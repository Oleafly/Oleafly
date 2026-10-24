use std::process::Command;

use super::*;
use crate::test_support::FakeEnv;

/// Git for the isolation code, as the app passes it.
fn git_env() -> Option<GitEnv> {
    crate::host::default_git_env()
}

/// Git for building fixture repositories, without the caller's Git
/// environment (a test run from a Git hook would otherwise write into the
/// outer repository).
fn git_command() -> Command {
    let mut command = Command::new("git");
    for (name, _) in std::env::vars_os() {
        if name.to_string_lossy().starts_with("GIT_") {
            command.env_remove(name);
        }
    }
    command
}

#[test]
fn staged_isolation_copies_dirty_files_without_touching_the_source() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir(&project).unwrap();
    fs::write(project.join("main.tex"), "dirty manuscript").unwrap();
    fs::write(project.join(".env"), "SECRET=hidden").unwrap();
    fs::create_dir(project.join(".Private")).unwrap();
    fs::write(project.join(".Private/notes.md"), "private research").unwrap();
    let destination = temp.path().join("managed").join("task").join("1");

    let isolation = prepare_at(
        &project,
        &destination,
        IsolationSource::Repository,
        git_env().as_ref(),
        &CancellationToken::new(),
    )
    .unwrap();

    assert_eq!(isolation.kind, TaskIsolationKind::StagedProject);
    assert_eq!(
        fs::read_to_string(project.join("main.tex")).unwrap(),
        "dirty manuscript"
    );
    assert_eq!(
        fs::read_to_string(destination.join("main.tex")).unwrap(),
        "dirty manuscript"
    );
    assert!(!destination.join(".env").exists());
    assert!(!destination.join(".Private").exists());
}

#[test]
fn staged_isolation_leaves_out_keys_and_credential_folders() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    let secrets = [
        ".ssh/config",
        ".gnupg/pubring.kbx",
        ".aws/credentials",
        ".kube/config",
        ".docker/config.json",
        ".config/gcloud/application_default_credentials.json",
        "id_rsa",
        "keys/id_ed25519_work",
        "deploy_key",
        ".netrc",
        ".pgpass",
        "vault.kdbx",
    ];
    let kept = [
        "main.tex",
        "id_ed25519.pub",
        "data/id_map.csv",
        ".config/latexmk/latexmkrc",
    ];
    for path in secrets.iter().chain(&kept) {
        let file = project.join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, "content").unwrap();
    }
    let destination = temp.path().join("managed/task/1");

    prepare_at(
        &project,
        &destination,
        IsolationSource::Repository,
        git_env().as_ref(),
        &CancellationToken::new(),
    )
    .unwrap();

    for path in secrets {
        assert!(!destination.join(path).exists(), "{path} was copied");
    }
    for path in kept {
        assert!(destination.join(path).exists(), "{path} was left out");
    }
}

#[cfg(unix)]
#[test]
fn staged_isolation_preserves_executable_permissions() {
    use std::os::unix::fs::PermissionsExt;

    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir(&project).unwrap();
    let script = project.join("analysis.sh");
    fs::write(&script, "#!/bin/sh\n").unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
    let destination = temp.path().join("managed/task/1");

    prepare_at(
        &project,
        &destination,
        IsolationSource::Repository,
        git_env().as_ref(),
        &CancellationToken::new(),
    )
    .unwrap();

    assert_ne!(
        fs::metadata(destination.join("analysis.sh"))
            .unwrap()
            .permissions()
            .mode()
            & 0o111,
        0
    );
}

// 0.4.8 KSB: a link to a file inside the project is copied as that file; a
// link that leaves the project is skipped and listed, never followed.
#[test]
fn source_links_are_copied_as_files_or_skipped_never_followed_out() {
    if !crate::test_support::symlinks_permitted() {
        return;
    }
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir(&project).unwrap();
    fs::write(project.join("outside.tex"), "outside").unwrap();
    let secret = temp.path().join("secret.txt");
    fs::write(&secret, "secret").unwrap();
    let link = project.join("main.tex");
    let away = project.join("away.tex");
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(project.join("outside.tex"), &link).unwrap();
        std::os::unix::fs::symlink(&secret, &away).unwrap();
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_file(project.join("outside.tex"), &link).unwrap();
        std::os::windows::fs::symlink_file(&secret, &away).unwrap();
    }

    let isolation = prepare_at(
        &project,
        &temp.path().join("managed/task/1"),
        IsolationSource::Repository,
        git_env().as_ref(),
        &CancellationToken::new(),
    )
    .unwrap();

    let root = Path::new(&isolation.execution_root);
    let copied = root.join("main.tex");
    assert!(!fs::symlink_metadata(&copied)
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(fs::read_to_string(&copied).unwrap(), "outside");
    assert!(fs::symlink_metadata(root.join("away.tex")).is_err());
    assert!(isolation
        .skipped
        .iter()
        .any(|entry| entry.path == "away.tex" && entry.reason == SkipReason::LinkOutside));
}

#[test]
fn cancellation_stops_snapshot_creation_before_files_are_copied() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir(&project).unwrap();
    fs::write(project.join("main.tex"), "manuscript").unwrap();
    let cancel = CancellationToken::new();
    cancel.cancel();

    let error = prepare_at(
        &project,
        &temp.path().join("managed/task/1"),
        IsolationSource::Repository,
        git_env().as_ref(),
        &cancel,
    )
    .unwrap_err();

    assert!(error.contains("cancelled"));
    assert!(!temp.path().join("managed/task/1").exists());
}

#[test]
fn review_rejects_output_outside_the_path_allowlist() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir(&project).unwrap();
    fs::write(project.join("main.tex"), "manuscript").unwrap();
    let destination = temp.path().join("managed/task/1");
    let isolation = prepare_at(
        &project,
        &destination,
        IsolationSource::Repository,
        git_env().as_ref(),
        &CancellationToken::new(),
    )
    .unwrap();
    fs::write(destination.join("surprise.tex"), "unexpected").unwrap();

    let error = collect_review_changes(&isolation, &CancellationToken::new()).unwrap_err();

    assert!(error.contains("outside its allowed"));
}

// Logs, caches and data a script leaves outside the allowed paths are left
// out of the review instead of failing the task, as 0.4.7 did.
#[test]
fn review_leaves_out_non_source_files_outside_the_allowlist() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir(&project).unwrap();
    fs::write(project.join("main.tex"), "manuscript").unwrap();
    let destination = temp.path().join("managed/task/1");
    let isolation = prepare_at(
        &project,
        &destination,
        IsolationSource::Repository,
        git_env().as_ref(),
        &CancellationToken::new(),
    )
    .unwrap();
    fs::write(destination.join("train.log"), "epoch 1").unwrap();
    fs::create_dir_all(destination.join(".pytest_cache/v")).unwrap();
    fs::write(destination.join(".pytest_cache/v/cache"), "x").unwrap();
    fs::write(destination.join("main.tex"), "revised").unwrap();

    let changes = collect_review_changes(&isolation, &CancellationToken::new()).unwrap();

    assert_eq!(
        changes
            .iter()
            .map(|change| change.path.as_str())
            .collect::<Vec<_>>(),
        ["main.tex"]
    );
}

#[test]
fn a_resumed_task_gets_back_the_baseline_a_review_pruned() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(project.join("sections")).unwrap();
    fs::write(project.join("main.tex"), "manuscript").unwrap();
    fs::write(project.join("sections/intro.tex"), "intro").unwrap();
    fs::write(project.join("refs.bib"), "@misc{a}").unwrap();
    let destination = temp.path().join("managed/task/1");
    let isolation = prepare_at(
        &project,
        &destination,
        IsolationSource::Repository,
        git_env().as_ref(),
        &CancellationToken::new(),
    )
    .unwrap();
    fs::write(destination.join("main.tex"), "revised").unwrap();
    let changes = collect_review_changes(&isolation, &CancellationToken::new()).unwrap();
    assert_eq!(prune_baseline(&isolation, &changes).unwrap(), 2);
    let baseline = PathBuf::from(&isolation.baseline_root);
    assert!(!baseline.join("sections/intro.tex").exists());
    // The project's bibliography changed since the task started.
    fs::write(project.join("refs.bib"), "@misc{b}").unwrap();

    assert_eq!(restore_baseline(&isolation, &project), 1);
    assert_eq!(
        fs::read_to_string(baseline.join("sections/intro.tex")).unwrap(),
        "intro"
    );
    assert!(!baseline.join("refs.bib").exists());
    assert_eq!(
        fs::read_to_string(baseline.join("main.tex")).unwrap(),
        "manuscript"
    );
}

#[cfg(unix)]
#[test]
fn a_tracked_symlink_cannot_redirect_the_dirty_overlay() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    let victim = temp.path().join("victim.tex");
    fs::create_dir(&project).unwrap();
    fs::write(&victim, "do not touch").unwrap();
    let run = |arguments: &[&str]| {
        let mut command = git_command();
        let output = command
            .arg("-C")
            .arg(&project)
            .args(arguments)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    run(&["init"]);
    run(&["config", "user.name", "Fixture"]);
    run(&["config", "user.email", "fixture@example.invalid"]);
    let hook = project.join(".git/hooks/post-checkout");
    fs::write(&hook, "#!/bin/sh\nexit 91\n").unwrap();
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(&hook).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&hook, permissions).unwrap();
    std::os::unix::fs::symlink(&victim, project.join("main.tex")).unwrap();
    run(&["add", "main.tex"]);
    run(&["commit", "-m", "fixture"]);
    fs::remove_file(project.join("main.tex")).unwrap();
    fs::write(project.join("main.tex"), "dirty manuscript").unwrap();

    let destination = temp.path().join("managed/task/1");
    let isolation = prepare_at(
        &project,
        &destination,
        IsolationSource::Repository,
        git_env().as_ref(),
        &CancellationToken::new(),
    )
    .unwrap();

    assert_eq!(isolation.kind, TaskIsolationKind::GitWorktree);
    assert_eq!(fs::read_to_string(&victim).unwrap(), "do not touch");
    assert_eq!(
        fs::read_to_string(destination.join("main.tex")).unwrap(),
        "dirty manuscript"
    );
    let metadata = fs::symlink_metadata(destination.join("main.tex")).unwrap();
    assert!(metadata.is_file());
    assert!(!metadata.file_type().is_symlink());
}
#[test]
fn purging_a_task_removes_both_generations_and_unregisters_its_git_worktree() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir(&project).unwrap();
    fs::write(project.join("main.tex"), "manuscript").unwrap();
    let run = |arguments: &[&str]| {
        let mut command = git_command();
        let output = command
            .arg("-C")
            .arg(&project)
            .args(arguments)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    run(&["init"]);
    run(&["config", "user.name", "Fixture"]);
    run(&["config", "user.email", "fixture@example.invalid"]);
    run(&["add", "main.tex"]);
    run(&["commit", "-m", "fixture"]);

    let store_root = temp.path().join("store");
    let task_root = task_workspace_root(&store_root, "task-one");
    let first = task_root.join("1");
    let second = task_root.join("2");
    for generation in [&first, &second] {
        let isolation = prepare_at(
            &project,
            generation,
            IsolationSource::Repository,
            git_env().as_ref(),
            &CancellationToken::new(),
        )
        .unwrap();
        assert_eq!(isolation.kind, TaskIsolationKind::GitWorktree);
    }
    let registrations = project.join(".git/worktrees");
    assert_eq!(fs::read_dir(&registrations).unwrap().count(), 2);
    assert!(first.with_file_name("1-baseline").is_dir());

    purge_task_workspaces(Some(&project), git_env().as_ref(), &task_root);

    assert!(!task_root.exists());
    assert!(
        fs::read_dir(&registrations)
            .map(|entries| entries.count())
            .unwrap_or(0)
            == 0
    );
    assert_eq!(
        fs::read_to_string(project.join("main.tex")).unwrap(),
        "manuscript"
    );
}

#[test]
fn purging_a_task_without_a_project_still_removes_its_snapshots() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir(&project).unwrap();
    fs::write(project.join("main.tex"), "manuscript").unwrap();
    let store_root = temp.path().join("store");
    let task_root = task_workspace_root(&store_root, "task-two");
    let isolation = prepare_at(
        &project,
        &task_root.join("1"),
        IsolationSource::Repository,
        git_env().as_ref(),
        &CancellationToken::new(),
    )
    .unwrap();
    assert_eq!(isolation.kind, TaskIsolationKind::StagedProject);
    fs::remove_dir_all(&project).unwrap();

    purge_task_workspaces(None, git_env().as_ref(), &task_root);

    assert!(!task_root.exists());
}

#[test]
fn prepare_refuses_an_untrusted_project_before_touching_disk() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir(&project).unwrap();
    fs::write(project.join("main.tex"), "manuscript").unwrap();
    let store_root = temp.path().join("store");
    fs::create_dir(&store_root).unwrap();
    let store = TaskStore::new(store_root).unwrap();
    let task = store
        .create(crate::test_support::draft("paper", "Review"))
        .unwrap();
    let env = FakeEnv::new()
        .with_project("paper", &project)
        .untrusted("paper");
    let error = prepare(&store, &env, &task, &CancellationToken::new()).unwrap_err();
    assert!(error.contains("trust.research_tasks"), "{error}");
    assert!(!task_workspace_root(store.root(), &task.id).exists());
}

#[test]
fn prepare_gives_up_after_the_lock_stays_busy() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    fs::create_dir(&project).unwrap();
    fs::write(project.join("main.tex"), "manuscript").unwrap();
    let store_root = temp.path().join("store");
    fs::create_dir(&store_root).unwrap();
    let store = TaskStore::new(store_root).unwrap();
    let task = store
        .create(crate::test_support::draft("paper", "Review"))
        .unwrap();
    let env = FakeEnv::new()
        .with_project("paper", &project)
        .writer_locked("paper")
        .lock_timeout(std::time::Duration::from_millis(50));
    let error = prepare(&store, &env, &task, &CancellationToken::new()).unwrap_err();
    assert!(error.contains("stayed busy"), "{error}");
}

#[test]
fn copy_into_a_workspace_path_with_spaces_and_unicode_keeps_the_content() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("Mein Projekt");
    fs::create_dir_all(project.join("Kapitel 1")).unwrap();
    fs::write(
        project.join("Kapitel 1/Ergebnis ü.tex"),
        "Ergebnisse: ü, ß, 漢字",
    )
    .unwrap();
    let destination = temp.path().join("verwaltet ü/task/1");
    let isolation = prepare_at(
        &project,
        &destination,
        IsolationSource::Snapshot,
        None,
        &CancellationToken::new(),
    )
    .unwrap();
    assert_eq!(isolation.kind, TaskIsolationKind::StagedProject);
    assert_eq!(
        fs::read_to_string(destination.join("Kapitel 1/Ergebnis ü.tex")).unwrap(),
        "Ergebnisse: ü, ß, 漢字"
    );
    let leftovers: Vec<_> = fs::read_dir(destination.join("Kapitel 1"))
        .unwrap()
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty());
}
