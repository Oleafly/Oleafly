use super::*;
use tokio::io::AsyncWriteExt;

fn context(root: &Path) -> TaskRunContext {
    TaskRunContext {
        task_id: "task".into(),
        execution_generation: 1,
        session_id: "session".into(),
        project_id: "project".into(),
        execution_root: root.to_string_lossy().into_owned(),
        title: "Task".into(),
        prompt: "Task prompt".into(),
        runtime_id: "builtin".into(),
        agent_id: "openai".into(),
        model_id: "test".into(),
        skill_ids: Vec::new(),
        source_revision: "snapshot".into(),
        allowed_paths: vec!["analysis".into()],
    }
}

#[test]
fn workspace_requires_a_directory_and_explicit_nonempty_scope() {
    let root = tempfile::tempdir().unwrap();
    let ordinary_file = root.path().join("file");
    std::fs::write(&ordinary_file, "original").unwrap();
    assert!(TaskFiles::open(&ordinary_file, &["analysis".into()]).is_err());
    assert!(TaskFiles::open(&root.path().join("missing"), &["analysis".into()]).is_err());
    assert!(TaskFiles::open(root.path(), &[]).is_err());
    for path in [
        "",
        ".",
        "..",
        "/",
        "analysis/../outside",
        "analysis/.OLEAFLY/state",
    ] {
        assert!(
            TaskFiles::open(root.path(), &[path.into()]).is_err(),
            "{path}"
        );
    }
    assert_eq!(std::fs::read_to_string(ordinary_file).unwrap(), "original");
}

#[test]
fn listing_leaf_scopes_traverses_parents_without_exposing_siblings() {
    let root = tempfile::tempdir().unwrap();
    for (path, content) in [
        ("analysis/allowed/answer.md", "needle answer"),
        ("analysis/allowed/extra.md", "needle extra"),
        ("analysis/hidden.md", "needle hidden"),
        ("analysis-neighbor/hidden.md", "needle neighbor"),
        ("data/source.csv", "needle source"),
    ] {
        let path = root.path().join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }
    let files = TaskFiles::open(
        root.path(),
        &[
            "analysis/allowed/answer.md".into(),
            "data/source.csv".into(),
        ],
    )
    .unwrap();
    assert_eq!(
        files.list("").unwrap(),
        (
            vec![
                "analysis/allowed/answer.md".into(),
                "data/source.csv".into()
            ],
            false
        )
    );
    assert_eq!(
        files.list("analysis").unwrap(),
        (vec!["analysis/allowed/answer.md".into()], false)
    );
    assert!(files.list("analysis-neighbor").is_err());
    assert!(files.list("analysis/hidden.md").is_err());
    assert!(files.read("analysis/allowed/extra.md").is_err());
    let matches = files.search("needle").unwrap();
    assert_eq!(matches["matches"].as_array().unwrap().len(), 2);
    assert_eq!(matches["truncated"], false);
}

#[test]
fn writes_reject_directory_destinations_and_file_parents_without_losing_data() {
    let root = tempfile::tempdir().unwrap();
    let files = TaskFiles::open(root.path(), &["analysis".into()]).unwrap();
    files.write("analysis/existing.md", "original").unwrap();
    assert!(files.write("analysis", "replacement").is_err());
    assert!(files
        .write("analysis/existing.md/child", "replacement")
        .is_err());
    assert_eq!(files.read("analysis/existing.md").unwrap(), "original");
    assert_eq!(files.list("").unwrap().0, vec!["analysis/existing.md"]);
    assert!(files.read("analysis").is_err());
}

#[cfg(unix)]
#[test]
fn fifo_and_symlink_roots_are_rejected_without_opening_external_files() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let linked = root.path().join("linked");
    symlink(root.path(), &linked).unwrap();
    assert!(TaskFiles::open(&linked, &["analysis".into()]).is_err());
    std::fs::create_dir(root.path().join("analysis")).unwrap();
    let fifo = root.path().join("analysis/pipe");
    let fifo_name = std::ffi::CString::new(fifo.as_os_str().as_encoded_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(fifo_name.as_ptr(), 0o600) }, 0);
    let files = TaskFiles::open(root.path(), &["analysis".into()]).unwrap();
    assert!(files.read("analysis/pipe").is_err());
    assert!(files.write("analysis/pipe", "text").is_err());
    assert!(files.list("").unwrap().0.is_empty());
}

#[test]
fn search_caps_matches_and_unicode_line_output_and_validates_queries() {
    let root = tempfile::tempdir().unwrap();
    let files = TaskFiles::open(root.path(), &["analysis".into()]).unwrap();
    files
        .write(
            "analysis/matches.md",
            &format!("needle {}\n", "🍃".repeat(400)).repeat(40),
        )
        .unwrap();
    let result = files.search("needle").unwrap();
    let matches = result["matches"].as_array().unwrap();
    assert_eq!(matches.len(), 32);
    assert_eq!(result["truncated"], true);
    for (index, entry) in matches.iter().enumerate() {
        assert_eq!(entry["path"], "analysis/matches.md");
        assert_eq!(entry["line"], index + 1);
        let text = entry["text"].as_str().unwrap();
        assert!(text.starts_with("needle 🍃"));
        assert!(text.ends_with("\n[output truncated]"));
        assert!(!text.contains('\u{fffd}'));
        assert!(text.len() <= 1024 + "\n[output truncated]".len());
    }
    assert!(files.search("").is_err());
    assert!(files.search(&"x".repeat(1025)).is_err());
    let missing = files.search("absent").unwrap();
    assert!(missing["matches"].as_array().unwrap().is_empty());
    assert_eq!(missing["truncated"], false);
}

#[test]
fn search_reports_when_its_total_scan_budget_leaves_files_unread() {
    let root = tempfile::tempdir().unwrap();
    let analysis = root.path().join("analysis");
    std::fs::create_dir(&analysis).unwrap();
    let data = vec![b'x'; MAX_FILE_BYTES];
    for index in 0..17 {
        std::fs::write(analysis.join(format!("{index:02}.txt")), &data).unwrap();
    }
    std::fs::write(analysis.join("99.txt"), "needle").unwrap();
    let files = TaskFiles::open(root.path(), &["analysis".into()]).unwrap();
    let result = files.search("needle").unwrap();
    assert!(result["matches"].as_array().unwrap().is_empty());
    assert_eq!(result["truncated"], true);
}

#[test]
fn listing_reports_truncation_without_exceeding_its_output_budget() {
    let root = tempfile::tempdir().unwrap();
    let analysis = root.path().join("analysis");
    std::fs::create_dir(&analysis).unwrap();
    for index in 0..150 {
        std::fs::write(
            analysis.join(format!("{index:03}-{}.txt", "a".repeat(190))),
            "",
        )
        .unwrap();
    }
    let files = TaskFiles::open(root.path(), &["analysis".into()]).unwrap();
    let (listed, truncated) = files.list("").unwrap();
    assert!(truncated);
    assert!(!listed.is_empty());
    assert!(listed.len() < 150);
    assert!(listed.iter().map(|path| path.len() + 4).sum::<usize>() <= MAX_OUTPUT_BYTES / 2);
    assert!(listed.windows(2).all(|pair| pair[0] < pair[1]));
    assert!(listed
        .iter()
        .all(|path| files.read(path).unwrap().is_empty()));
}

#[test]
fn sandbox_rejects_invalid_temporary_folders_and_overbroad_read_grants() {
    let root = tempfile::tempdir().unwrap();
    let program = std::env::current_exe().unwrap();
    let allowed = vec!["analysis".into()];
    let temp_file = root.path().join("temp-file");
    std::fs::write(&temp_file, "original").unwrap();
    for temp in [root.path().join("missing"), temp_file.clone()] {
        assert!(sandbox_task_command(&program, &[], root.path(), &allowed, &temp, false).is_err());
    }
    let temp = tempfile::tempdir().unwrap();
    let filesystem_root = program.ancestors().last().unwrap().to_path_buf();
    for read in [filesystem_root, root.path().join("missing-read")] {
        assert!(sandbox_task_command_with_reads(
            &program,
            &[],
            root.path(),
            &allowed,
            temp.path(),
            false,
            &[read]
        )
        .is_err());
    }
    assert_eq!(std::fs::read_to_string(temp_file).unwrap(), "original");
}

#[cfg(unix)]
#[test]
fn sandbox_rejects_linked_write_grants_and_linked_temporary_folders() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let temp = tempfile::tempdir().unwrap();
    symlink(outside.path(), root.path().join("analysis")).unwrap();
    let program = std::env::current_exe().unwrap();
    assert!(sandbox_task_command(
        &program,
        &[],
        root.path(),
        &["analysis".into()],
        temp.path(),
        false
    )
    .is_err());
    let linked_temp = root.path().join("linked-temp");
    symlink(temp.path(), &linked_temp).unwrap();
    assert!(sandbox_task_command(
        &program,
        &[],
        root.path(),
        &["other".into()],
        &linked_temp,
        false
    )
    .is_err());
    assert!(std::fs::read_dir(outside.path()).unwrap().next().is_none());
    assert!(!root.path().join("other").exists());
}

#[tokio::test]
async fn output_reader_drains_backpressure_after_reaching_its_retention_limit() {
    let (mut writer, reader) = tokio::io::duplex(1024);
    let output = tokio::spawn(read_output(reader));
    tokio::time::timeout(Duration::from_secs(5), async {
        writer
            .write_all(&vec![b'x'; MAX_OUTPUT_BYTES * 4])
            .await
            .unwrap();
        writer.shutdown().await.unwrap();
        let output = output.await.unwrap();
        assert_eq!(output.len(), MAX_OUTPUT_BYTES + 1);
        assert!(output.iter().all(|byte| *byte == b'x'));
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn cancelled_and_invalid_commands_do_not_create_task_files() {
    let root = tempfile::tempdir().unwrap();
    let context = context(root.path());
    let jobs = CommandJobs::default();
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    assert!(jobs
        .run(
            context.clone(),
            "printf changed > analysis/result".into(),
            cancelled
        )
        .await
        .is_err());
    for command in [" \n\t".to_string(), "x".repeat(16 * 1024 + 1)] {
        assert!(jobs
            .run(context.clone(), command, CancellationToken::new())
            .await
            .is_err());
    }
    jobs.finish().await;
    assert!(lock(&jobs.tasks).is_empty());
    assert!(std::fs::read_dir(root.path()).unwrap().next().is_none());
}

#[tokio::test]
async fn active_task_cleanup_cancels_its_children_and_notifies_completion() {
    let parent = CancellationToken::new();
    let token = parent.child();
    let child = token.child();
    let sessions = Arc::new(Mutex::new(HashMap::new()));
    let (done, mut completion) = tokio::sync::watch::channel(false);
    lock(&sessions).insert(
        "session".into(),
        ActiveTaskRun {
            token: token.clone(),
            done: completion.clone(),
        },
    );
    let (_other_done, other_completion) = tokio::sync::watch::channel(false);
    let other_token = CancellationToken::new();
    lock(&sessions).insert(
        "other".into(),
        ActiveTaskRun {
            token: other_token.clone(),
            done: other_completion,
        },
    );
    let active = ActiveToken {
        sessions: sessions.clone(),
        session_id: "session".into(),
        token,
        done,
    };
    assert!(!*completion.borrow_and_update());
    drop(active);
    completion.changed().await.unwrap();
    assert!(*completion.borrow());
    assert!(child.is_cancelled());
    assert!(!parent.is_cancelled());
    assert!(!other_token.is_cancelled());
    assert!(!lock(&sessions).contains_key("session"));
    assert!(lock(&sessions).contains_key("other"));
}
