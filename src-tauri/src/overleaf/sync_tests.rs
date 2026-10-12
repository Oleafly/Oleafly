use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use super::sync::{self, Integration, LinkOutcome, PushResult, Side};

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

struct World {
    _temp: tempfile::TempDir,
    remotes: PathBuf,
    server: String,
    project: PathBuf,
    repo: PathBuf,
}

impl World {
    fn new(files: &[(&str, &[u8])]) -> Self {
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
        for (path, body) in files {
            let target = seed.join(path);
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::write(target, body).unwrap();
        }
        run(&seed, &["add", "-A"]);
        run(&seed, &["commit", "--quiet", "-m", "Initial"]);
        let bare = remotes.join(PROJECT);
        run(
            &seed,
            &["push", "--quiet", bare.to_str().unwrap(), "master:master"],
        );
        let project = temp.path().join("project");
        std::fs::create_dir_all(&project).unwrap();
        for (path, body) in files {
            let target = project.join(path);
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::write(target, body).unwrap();
        }
        let server = tauri::Url::from_directory_path(&remotes)
            .unwrap()
            .to_string();
        let server = server.trim_end_matches('/').to_string();
        let repo = temp.path().join("mirror").join("repo");
        World {
            _temp: temp,
            remotes,
            server,
            project,
            repo,
        }
    }

    fn url(&self) -> String {
        sync::remote_url(&self.server, PROJECT).unwrap()
    }

    fn bare(&self) -> PathBuf {
        self.remotes.join(PROJECT)
    }

    fn coauthor(&self, changes: &[(&str, Option<&str>)]) {
        let clone = self
            ._temp
            .path()
            .join(format!("clone-{}", CLONES.fetch_add(1, Ordering::SeqCst)));
        run(
            self._temp.path(),
            &[
                "clone",
                "--quiet",
                self.bare().to_str().unwrap(),
                clone.to_str().unwrap(),
            ],
        );
        for (path, body) in changes {
            let target = clone.join(path);
            match body {
                Some(body) => {
                    std::fs::create_dir_all(target.parent().unwrap()).unwrap();
                    std::fs::write(target, body).unwrap();
                }
                None => {
                    std::fs::remove_file(target).unwrap();
                }
            }
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

    fn local(&self, path: &str) -> Option<String> {
        std::fs::read_to_string(self.project.join(path)).ok()
    }

    fn write(&self, path: &str, body: &str) {
        let target = self.project.join(path);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(target, body).unwrap();
    }

    fn link(&self, prefer: Option<Side>) -> LinkOutcome {
        let remote = sync::fetch(&self.repo, &self.url(), TOKEN).unwrap();
        sync::link_local(&self.project, &self.repo, &remote, prefer).unwrap()
    }

    fn sync_with(&self, resolutions: &BTreeMap<String, Side>) -> Integration {
        for _ in 0..3 {
            let base = sync::rev(&self.repo, sync::BASE_REF).unwrap();
            let remote = sync::fetch(&self.repo, &self.url(), TOKEN).unwrap();
            let integration =
                sync::integrate(&self.project, &self.repo, &base, &remote, resolutions).unwrap();
            match &integration {
                Integration::Merged { merged, push, .. } => {
                    if *push
                        && *merged != remote
                        && sync::push(&self.repo, &self.url(), TOKEN, merged).unwrap()
                            == PushResult::Rejected
                    {
                        continue;
                    }
                    sync::set_base(&self.repo, merged).unwrap();
                    return integration;
                }
                _ => return integration,
            }
        }
        panic!("sync kept being rejected");
    }

    fn sync(&self) -> Integration {
        self.sync_with(&BTreeMap::new())
    }
}

fn seeded() -> World {
    World::new(&[
        (
            "main.tex",
            b"\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n",
        ),
        ("refs.bib", b"@book{a, title={A}}\n"),
        ("notes.tex", b"Notes\n"),
        ("img/fig.png", &[0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]),
    ])
}

#[test]
fn linking_identical_trees_then_local_edits_push_without_app_files() {
    let world = seeded();
    world.write("project.json", "{\"name\":\"x\"}");
    world.write(".oleafly/build/main.pdf", "pdf");
    world.write(".DS_Store", "junk");
    assert_eq!(
        world.link(None),
        LinkOutcome::Linked {
            written: Vec::new()
        }
    );

    assert_eq!(world.sync(), Integration::UpToDate);
    world.write(
        "main.tex",
        "\\documentclass{article}\n\\begin{document}\nHello there.\n\\end{document}\n",
    );
    assert!(matches!(
        world.sync(),
        Integration::Merged { push: true, .. }
    ));
    assert!(world
        .remote_file("main.tex")
        .unwrap()
        .contains("Hello there."));
    assert_eq!(world.remote_file("project.json"), None);
    assert_eq!(world.remote_file(".oleafly/build/main.pdf"), None);
    assert_eq!(world.remote_file(".DS_Store"), None);
    assert_eq!(world.sync(), Integration::UpToDate);
}

#[test]
fn co_author_changes_arrive_and_local_deletions_leave() {
    let world = seeded();
    world.link(None);
    world.coauthor(&[
        ("refs.bib", Some("@book{b, title={B}}\n")),
        ("sections/intro.tex", Some("Intro\n")),
    ]);
    std::fs::remove_file(world.project.join("notes.tex")).unwrap();
    let Integration::Merged { written, .. } = world.sync() else {
        panic!("expected a merge");
    };
    assert!(written.contains(&"refs.bib".to_string()));
    assert_eq!(
        world.local("refs.bib").as_deref(),
        Some("@book{b, title={B}}\n")
    );
    assert_eq!(
        world.local("sections/intro.tex").as_deref(),
        Some("Intro\n")
    );
    assert_eq!(world.remote_file("notes.tex"), None);
    assert_eq!(
        std::fs::read(world.project.join("img/fig.png")).unwrap(),
        vec![0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]
    );

    world.coauthor(&[("sections/intro.tex", None)]);
    let Integration::Merged { removed, .. } = world.sync() else {
        panic!("expected a merge");
    };
    assert_eq!(removed, vec!["sections/intro.tex".to_string()]);
    assert!(!world.project.join("sections").exists());
}

#[test]
fn edits_to_different_files_on_both_sides_merge() {
    let world = seeded();
    world.link(None);
    world.coauthor(&[("refs.bib", Some("@book{c, title={C}}\n"))]);
    world.write("notes.tex", "Notes, revised\n");
    assert!(matches!(
        world.sync(),
        Integration::Merged { push: true, .. }
    ));
    assert_eq!(
        world.local("refs.bib").as_deref(),
        Some("@book{c, title={C}}\n")
    );
    assert_eq!(
        world.remote_file("notes.tex").as_deref(),
        Some("Notes, revised\n")
    );
    assert_eq!(
        world.remote_file("refs.bib").as_deref(),
        Some("@book{c, title={C}}\n")
    );
}

#[test]
fn a_clash_changes_nothing_until_a_side_is_chosen() {
    let world = seeded();
    world.link(None);
    world.coauthor(&[("notes.tex", Some("Theirs\n"))]);
    world.write("notes.tex", "Mine\n");
    assert_eq!(
        world.sync(),
        Integration::Conflicts(vec!["notes.tex".to_string()])
    );
    assert_eq!(world.local("notes.tex").as_deref(), Some("Mine\n"));
    assert_eq!(world.remote_file("notes.tex").as_deref(), Some("Theirs\n"));

    let keep_mine = BTreeMap::from([("notes.tex".to_string(), Side::Local)]);
    assert!(matches!(
        world.sync_with(&keep_mine),
        Integration::Merged { .. }
    ));
    assert_eq!(world.remote_file("notes.tex").as_deref(), Some("Mine\n"));
    assert_eq!(world.local("notes.tex").as_deref(), Some("Mine\n"));

    world.coauthor(&[("notes.tex", Some("Theirs again\n"))]);
    world.write("notes.tex", "Mine again\n");
    let take_theirs = BTreeMap::from([("notes.tex".to_string(), Side::Remote)]);
    assert!(matches!(
        world.sync_with(&take_theirs),
        Integration::Merged { .. }
    ));
    assert_eq!(world.local("notes.tex").as_deref(), Some("Theirs again\n"));
    assert_eq!(
        world.remote_file("notes.tex").as_deref(),
        Some("Theirs again\n")
    );
}

#[test]
fn a_delete_against_an_edit_is_a_clash_too() {
    let world = seeded();
    world.link(None);
    world.coauthor(&[("notes.tex", None)]);
    world.write("notes.tex", "Still needed\n");
    assert_eq!(
        world.sync(),
        Integration::Conflicts(vec!["notes.tex".to_string()])
    );
    let take_theirs = BTreeMap::from([("notes.tex".to_string(), Side::Remote)]);
    world.sync_with(&take_theirs);
    assert_eq!(world.local("notes.tex"), None);
    assert_eq!(world.remote_file("notes.tex"), None);
}

#[test]
fn linking_different_trees_asks_and_never_deletes() {
    let world = seeded();
    world.write("notes.tex", "Local notes\n");
    world.write("local-only.tex", "Only here\n");
    world.coauthor(&[("remote-only.tex", Some("Only there\n"))]);
    assert_eq!(
        world.link(None),
        LinkOutcome::NeedsChoice(vec!["notes.tex".to_string()])
    );
    assert_eq!(world.local("remote-only.tex"), None);
    assert_eq!(world.local("notes.tex").as_deref(), Some("Local notes\n"));

    let LinkOutcome::Linked { written } = world.link(Some(Side::Remote)) else {
        panic!("expected a link");
    };
    assert!(written.contains(&"remote-only.tex".to_string()));
    assert_eq!(world.local("notes.tex").as_deref(), Some("Notes\n"));
    assert_eq!(
        world.local("local-only.tex").as_deref(),
        Some("Only here\n")
    );
    let backups = run(
        &world.repo,
        &["for-each-ref", "--format=%(refname)", "refs/oleafly/"],
    );
    assert!(backups.contains("refs/oleafly/before-link-"));

    world.sync();
    assert_eq!(
        world.remote_file("local-only.tex").as_deref(),
        Some("Only here\n")
    );
    assert_eq!(
        world.remote_file("remote-only.tex").as_deref(),
        Some("Only there\n")
    );
}

#[test]
fn linking_with_my_version_uploads_mine() {
    let world = seeded();
    world.write("notes.tex", "Local notes\n");
    assert!(matches!(
        world.link(Some(Side::Local)),
        LinkOutcome::Linked { .. }
    ));
    assert_eq!(world.local("notes.tex").as_deref(), Some("Local notes\n"));
    world.sync();
    assert_eq!(
        world.remote_file("notes.tex").as_deref(),
        Some("Local notes\n")
    );
}

#[test]
fn a_push_rejected_by_a_newer_remote_retries_and_keeps_both_changes() {
    let world = seeded();
    world.link(None);
    world.write("notes.tex", "Local change\n");
    let base = sync::rev(&world.repo, sync::BASE_REF).unwrap();
    let remote = sync::fetch(&world.repo, &world.url(), TOKEN).unwrap();
    let Integration::Merged { merged, .. } = sync::integrate(
        &world.project,
        &world.repo,
        &base,
        &remote,
        &BTreeMap::new(),
    )
    .unwrap() else {
        panic!("expected a local commit");
    };
    world.coauthor(&[("refs.bib", Some("@book{late, title={Late}}\n"))]);
    assert_eq!(
        sync::push(&world.repo, &world.url(), TOKEN, &merged).unwrap(),
        PushResult::Rejected
    );
    assert_eq!(sync::rev(&world.repo, sync::BASE_REF).unwrap(), base);
    world.sync();
    assert_eq!(
        world.remote_file("notes.tex").as_deref(),
        Some("Local change\n")
    );
    assert_eq!(
        world.local("refs.bib").as_deref(),
        Some("@book{late, title={Late}}\n")
    );
}

#[test]
fn a_remote_project_json_is_never_written_over_the_app_metadata() {
    let world = seeded();
    world.write("project.json", "{\"name\":\"mine\"}");
    world.link(None);
    world.coauthor(&[
        ("project.json", Some("{\"name\":\"theirs\"}")),
        (".oleafly/evil", Some("x")),
    ]);
    world.sync();
    assert_eq!(
        world.local("project.json").as_deref(),
        Some("{\"name\":\"mine\"}")
    );
    assert_eq!(world.local(".oleafly/evil"), None);
    world.write("notes.tex", "Edited\n");
    world.sync();
    assert_eq!(
        world.remote_file("project.json").as_deref(),
        Some("{\"name\":\"theirs\"}")
    );
}

#[test]
fn guards_refuse_unsafe_trees_tokens_and_ids() {
    let clash =
        sync::check_remote_paths(&["Main.tex".to_string(), "main.tex".to_string()]).unwrap_err();
    assert!(clash.contains("overleaf.sync_case_clash"));
    assert!(sync::check_remote_paths(&["../escape.tex".to_string()])
        .unwrap_err()
        .contains("overleaf.sync_invalid_names"));
    assert!(sync::check_remote_paths(&["a/b.tex".to_string(), "c.tex".to_string()]).is_ok());
    assert!(sync::excluded("project.json"));
    assert!(sync::excluded(".oleafly/build/main.pdf"));
    assert!(sync::excluded("figures/.DS_Store"));
    assert!(sync::excluded("sub/.git/config"));
    assert!(!sync::excluded("sub/project.json"));
    assert!(!sync::excluded("main.tex"));
    assert_eq!(
        sync::remote_url(super::session::DEFAULT_SERVER, "64a1f0").unwrap(),
        "https://git.overleaf.com/64a1f0"
    );
    assert_eq!(
        sync::remote_url("https://latex.uni.edu", "64a1f0").unwrap(),
        "https://latex.uni.edu/git/64a1f0"
    );
    assert!(sync::remote_url("https://latex.uni.edu", "../x").is_err());
    assert_eq!(
        sync::credential_origin("https://git.overleaf.com/64a1f0"),
        "https://git.overleaf.com"
    );
    assert!(super::session::valid_git_token("olp_abcdefghijklmnop"));
    assert!(!super::session::valid_git_token("short"));
    assert!(!super::session::valid_git_token("has space inside"));
    assert!(!super::session::valid_git_token("quote\"inside1"));
    assert!(sync::classify_remote_failure(
        "fatal: Authentication failed for 'https://git.overleaf.com/x'"
    )
    .contains("overleaf.git_token_rejected"));
    assert!(
        sync::classify_remote_failure("remote: Repository not found.")
            .contains("overleaf.git_unavailable")
    );
    assert!(
        sync::classify_remote_failure("fatal: unable to access: Could not resolve host")
            .contains("overleaf.sync_offline")
    );
    assert!(sync::classify_remote_failure("something odd").contains("overleaf.sync_failed"));
}

#[test]
fn only_one_sync_runs_per_project_at_a_time() {
    let first = sync::claim("project-one").unwrap();
    assert!(sync::claim("project-one")
        .unwrap_err()
        .contains("overleaf.sync_busy"));
    let other = sync::claim("project-two").unwrap();
    drop(first);
    assert!(sync::claim("project-one").is_ok());
    drop(other);
}

#[test]
fn a_wrong_project_id_reports_no_git_access() {
    let world = seeded();
    let url = sync::remote_url(&world.server, "missing0").unwrap();
    let error = sync::fetch(&world.repo, &url, TOKEN).unwrap_err();
    assert!(
        error.contains("overleaf.git_unavailable") || error.contains("overleaf.sync_failed"),
        "{error}"
    );
}

#[test]
fn sync_links_round_trip_and_unlink_removes_the_copy() {
    let _guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let link = sync::SyncLink {
        server: "https://www.overleaf.com".into(),
        remote_id: "64a1f0".into(),
        linked_at: 1,
        auto: true,
        last_sync_at: Some(2),
    };
    sync::write_link("my-project", &link).unwrap();
    assert_eq!(sync::read_link("my-project").unwrap(), Some(link));
    assert!(sync::repo_dir("my-project")
        .unwrap()
        .starts_with(data.path()));
    assert!(sync::mirror_dir("../escape").is_err());
    sync::remove_link("my-project").unwrap();
    assert_eq!(sync::read_link("my-project").unwrap(), None);
    super::session::save_git_token("https://www.overleaf.com", "  olp_token_12345  ").unwrap();
    assert_eq!(
        super::session::git_token("https://www.overleaf.com")
            .unwrap()
            .as_deref(),
        Some("olp_token_12345")
    );
    assert!(super::session::save_git_token("https://www.overleaf.com", "bad token").is_err());
    super::session::forget_git_token("https://www.overleaf.com").unwrap();
    assert_eq!(
        super::session::git_token("https://www.overleaf.com").unwrap(),
        None
    );
    std::env::remove_var("OLEAFLY_DATA_DIR");
}
