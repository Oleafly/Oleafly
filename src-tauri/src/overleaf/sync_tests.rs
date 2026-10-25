//! The app's side of sync: its Git adapter and the commands. The sync
//! engine itself is tested in `oleafly-online`.
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use oleafly_online::sync::Mode;

use super::sync::{self, AppMirrorGit, LinkOutcome, Side};

const TOKEN: &str = "test-token-123";
const PROJECT: &str = "abc123";

static CLONES: AtomicU64 = AtomicU64::new(0);

fn run(dir: &Path, args: &[&str]) -> String {
    let mut command = Command::new(crate::git::git_program());
    crate::git::clear_inherited_git_env(&mut command);
    let output = command
        .args([
            "-c",
            "user.name=Co Author",
            "-c",
            "user.email=co@example.org",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .current_dir(dir)
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

/// A bare remote seeded with a small project, served over `file://`.
struct Remote {
    temp: tempfile::TempDir,
    server: String,
}

impl Remote {
    fn seeded() -> Remote {
        let temp = tempfile::tempdir().unwrap();
        let remotes = temp.path().join("remotes");
        let seed = temp.path().join("seed");
        std::fs::create_dir_all(&remotes).unwrap();
        std::fs::create_dir_all(&seed).unwrap();
        run(
            &remotes,
            &[
                "init",
                "--quiet",
                "--bare",
                "--initial-branch=master",
                PROJECT,
            ],
        );
        run(&seed, &["init", "--quiet", "--initial-branch=master"]);
        for (path, body) in [
            (
                "main.tex",
                "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n",
            ),
            ("refs.bib", "@book{a, title={A}}\n"),
            ("notes.tex", "Notes\n"),
        ] {
            std::fs::write(seed.join(path), body).unwrap();
        }
        run(&seed, &["add", "-A"]);
        run(&seed, &["commit", "--quiet", "-m", "Initial"]);
        let bare = remotes.join(PROJECT);
        run(
            &seed,
            &["push", "--quiet", bare.to_str().unwrap(), "master:master"],
        );
        let server = tauri::Url::from_directory_path(&remotes)
            .unwrap()
            .to_string()
            .trim_end_matches('/')
            .to_string();
        Remote { temp, server }
    }

    fn url(&self) -> String {
        sync::remote_url(&self.server, PROJECT).unwrap()
    }

    fn bare(&self) -> PathBuf {
        self.temp.path().join("remotes").join(PROJECT)
    }

    fn coauthor(&self, changes: &[(&str, &str)]) {
        let clone = self
            .temp
            .path()
            .join(format!("clone-{}", CLONES.fetch_add(1, Ordering::SeqCst)));
        run(
            self.temp.path(),
            &[
                "clone",
                "--quiet",
                self.bare().to_str().unwrap(),
                clone.to_str().unwrap(),
            ],
        );
        for (path, body) in changes {
            std::fs::write(clone.join(path), body).unwrap();
        }
        run(&clone, &["add", "-A"]);
        run(&clone, &["commit", "--quiet", "-m", "Co-author edit"]);
        run(&clone, &["push", "--quiet", "origin", "HEAD:master"]);
    }

    fn remote_file(&self, path: &str) -> Option<String> {
        let mut command = Command::new(crate::git::git_program());
        crate::git::clear_inherited_git_env(&mut command);
        let output = command
            .arg("--git-dir")
            .arg(self.bare())
            .args(["show", &format!("master:{path}")])
            .output()
            .unwrap();
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
    }
}

/// A library project that says it was imported from `world`'s project.
fn imported_project(world: &Remote) -> (String, PathBuf) {
    let project_id = crate::project::create_blank_project("Synced".into()).unwrap();
    let root = crate::paths::project_dir(&project_id).unwrap();
    let mut meta = crate::project::read_meta(&project_id).unwrap();
    meta.extra.insert(
        "importedFrom".to_string(),
        serde_json::json!({ "service": "overleaf", "server": world.server, "projectId": PROJECT }),
    );
    crate::project::write_meta(&project_id, &meta).unwrap();
    super::session::save_git_token(&world.server, TOKEN).unwrap();
    (project_id, root)
}

fn linked_record(world: &Remote) -> sync::SyncLink {
    sync::SyncLink {
        server: world.server.clone(),
        remote_id: PROJECT.to_string(),
        linked_at: 0,
        auto: true,
        last_sync_at: None,
    }
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap()
}

#[test]
fn stopping_the_sync_keeps_the_files_overleaf_s_versions_replaced() {
    let _guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let world = Remote::seeded();
    let (project_id, root) = imported_project(&world);
    std::fs::write(root.join("notes.tex"), "My own notes\n").unwrap();
    let repo = sync::repo_dir(&project_id).unwrap();
    let remote = sync::fetch(&repo, &world.url(), TOKEN).unwrap();
    assert!(matches!(
        sync::link_local(&root, &repo, &remote, Some(Side::Remote)).unwrap(),
        LinkOutcome::Linked { .. }
    ));
    sync::write_link(&project_id, &linked_record(&world)).unwrap();
    assert_eq!(
        std::fs::read_to_string(root.join("notes.tex")).unwrap(),
        "Notes\n"
    );

    let status = runtime()
        .block_on(super::overleaf_sync_unlink(project_id.clone()))
        .unwrap();
    assert!(!status.linked);
    assert!(!repo.exists());
    let folder = PathBuf::from(status.backups_folder.expect("the copies are kept"));
    assert_eq!(folder, sync::backups_dir(&project_id).unwrap());
    let saved: Vec<PathBuf> = std::fs::read_dir(&folder)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    assert_eq!(saved.len(), 1);
    assert_eq!(
        std::fs::read_to_string(saved[0].join("notes.tex")).unwrap(),
        "My own notes\n"
    );
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

#[cfg(unix)]
#[test]
fn a_push_refused_after_the_merge_reloads_the_files_and_says_they_changed() {
    use std::os::unix::fs::PermissionsExt;
    use tauri::{Listener, Manager};

    let _guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let world = Remote::seeded();
    let (project_id, root) = imported_project(&world);
    let repo = sync::repo_dir(&project_id).unwrap();
    let remote = sync::fetch(&repo, &world.url(), TOKEN).unwrap();
    sync::link_local(&root, &repo, &remote, Some(Side::Local)).unwrap();
    sync::write_link(&project_id, &linked_record(&world)).unwrap();
    let runtime = runtime();
    assert_eq!(
        runtime
            .block_on(super::overleaf_sync_check(project_id.clone()))
            .unwrap()
            .outcome,
        "synced"
    );

    world.coauthor(&[("refs.bib", "@book{late}\n")]);
    std::fs::write(root.join("notes.tex"), "Edited here\n").unwrap();
    let hook = world.bare().join("hooks").join("pre-receive");
    std::fs::create_dir_all(hook.parent().unwrap()).unwrap();
    std::fs::write(&hook, "#!/bin/sh\nexit 1\n").unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();

    let app = tauri::test::mock_builder()
        .manage(crate::state::AppState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let published = std::sync::Arc::new(AtomicU64::new(0));
    let heard = published.clone();
    app.listen_any("project-state-changed", move |_| {
        heard.fetch_add(1, Ordering::SeqCst);
    });
    let error = runtime
        .block_on(super::overleaf_sync_now(
            app.handle().clone(),
            app.state::<crate::state::AppState>(),
            project_id.clone(),
            None,
            None,
            None,
        ))
        .err()
        .expect("the push is refused");
    assert!(error.contains("\"overleaf.sync_incomplete\""), "{error}");
    assert_eq!(
        std::fs::read_to_string(root.join("refs.bib")).unwrap(),
        "@book{late}\n"
    );
    assert_eq!(published.load(Ordering::SeqCst), 1, "the editor reloads");
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

#[test]
fn the_app_git_adapter_fetches_and_links_a_local_remote() {
    let remote = Remote::seeded();
    let project = remote.temp.path().join("project");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::write(project.join("notes.tex"), "Notes\n").unwrap();
    let repo = remote.temp.path().join("mirror").join("repo");
    let tip =
        oleafly_online::sync::fetch(&AppMirrorGit, &repo, &remote.url(), "tok_12345678").unwrap();
    assert_eq!(
        oleafly_online::sync::remote_tip(&AppMirrorGit, &repo).as_deref(),
        Some(tip.as_str())
    );
    let outcome =
        oleafly_online::sync::link_local(&AppMirrorGit, &project, &repo, &tip, None, Mode::Apply)
            .unwrap();
    let oleafly_online::sync::LinkOutcome::Linked { written } = outcome else {
        panic!("expected a link");
    };
    assert!(written.contains(&"main.tex".to_string()));
    assert!(project.join("refs.bib").is_file());
    assert_eq!(
        oleafly_online::sync::rev(&AppMirrorGit, &repo, sync::BASE_REF),
        Some(tip)
    );
}

#[test]
fn the_check_pushes_local_edits_and_hands_remote_changes_to_the_merge() {
    let _guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let world = Remote::seeded();
    let project_id = crate::project::create_blank_project("Synced".into()).unwrap();
    let root = crate::paths::project_dir(&project_id).unwrap();
    let mut meta = crate::project::read_meta(&project_id).unwrap();
    meta.extra.insert(
        "importedFrom".to_string(),
        serde_json::json!({ "service": "overleaf", "server": world.server, "projectId": PROJECT }),
    );
    crate::project::write_meta(&project_id, &meta).unwrap();
    super::session::save_git_token(&world.server, TOKEN).unwrap();
    let repo = sync::repo_dir(&project_id).unwrap();
    assert!(repo.starts_with(data.path()));
    let remote = sync::fetch(&repo, &world.url(), TOKEN).unwrap();
    assert!(matches!(
        sync::link_local(&root, &repo, &remote, Some(Side::Local)).unwrap(),
        LinkOutcome::Linked { .. }
    ));
    sync::write_link(
        &project_id,
        &sync::SyncLink {
            server: world.server.clone(),
            remote_id: PROJECT.to_string(),
            linked_at: 0,
            auto: true,
            last_sync_at: None,
        },
    )
    .unwrap();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let check = |id: &str| runtime.block_on(super::overleaf_sync_check(id.to_string()));

    let first = check(&project_id).unwrap();
    assert_eq!(first.outcome, "synced");
    assert!(first.pushed);
    assert_eq!(check(&project_id).unwrap().outcome, "up-to-date");
    std::fs::write(root.join("notes.tex"), "Edited here\n").unwrap();
    let pushed = check(&project_id).unwrap();
    assert_eq!((pushed.outcome.as_str(), pushed.pushed), ("synced", true));
    assert_eq!(
        world.remote_file("notes.tex").as_deref(),
        Some("Edited here\n")
    );
    assert!(sync::read_link(&project_id)
        .unwrap()
        .unwrap()
        .last_sync_at
        .is_some());

    // The CLI and the app share the sync lock.
    let held = sync::claim(&project_id).unwrap();
    assert!(check(&project_id)
        .err()
        .unwrap()
        .contains("\"overleaf.sync_busy\""));
    drop(held);

    world.coauthor(&[("refs.bib", "@book{late}\n")]);
    assert_eq!(check(&project_id).unwrap().outcome, "needs-merge");
    assert!(super::sync_status(&project_id).unwrap().linked);

    meta.extra.insert(
        "importedFrom".to_string(),
        serde_json::json!({ "service": "overleaf", "server": world.server, "projectId": "someoneelse" }),
    );
    crate::project::write_meta(&project_id, &meta).unwrap();
    assert!(!super::sync_status(&project_id).unwrap().linked);
    let error = check(&project_id).err().unwrap();
    assert!(error.contains("overleaf.sync_not_linked"), "{error}");

    super::forget_sync_copy(&project_id).unwrap();
    assert!(!repo.exists());
    std::env::remove_var("OLEAFLY_DATA_DIR");
}
