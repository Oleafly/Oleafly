use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Output;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use oleafly_secrets::SecretStore;

use super::*;
use crate::error::OnlineErrorKind;
use crate::git::{git_on_path, SystemGit};
use crate::service::DEFAULT_SERVER;
use crate::session;

const TOKEN: &str = "test-token-123";
const PROJECT: &str = "abc123";

static CLONES: AtomicU64 = AtomicU64::new(0);

fn git_program() -> PathBuf {
    static PROGRAM: OnceLock<PathBuf> = OnceLock::new();
    PROGRAM
        .get_or_init(|| git_on_path().expect("git is on PATH"))
        .clone()
}

fn system_git() -> SystemGit {
    SystemGit::new(git_program())
}

/// Plain Git as a co-author would run it, with the mirror's isolation from
/// the developer's own settings.
fn run(dir: &Path, args: &[&str]) -> String {
    let mut full = vec![
        "-c",
        "user.name=Co Author",
        "-c",
        "user.email=co@example.org",
    ];
    full.extend_from_slice(args);
    let output = system_git()
        .command(dir, &full, None)
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
    temp: tempfile::TempDir,
    remotes: PathBuf,
    server: String,
    project: PathBuf,
    paths: SyncPaths,
    repo: PathBuf,
    branch: &'static str,
    git: SystemGit,
}

impl World {
    fn new(files: &[(&str, &[u8])]) -> Self {
        Self::on_branch("master", files)
    }

    fn on_branch(branch: &'static str, files: &[(&str, &[u8])]) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let remotes = temp.path().join("remotes");
        let seed = temp.path().join("seed");
        std::fs::create_dir_all(&remotes).unwrap();
        std::fs::create_dir_all(&seed).unwrap();
        let initial = format!("--initial-branch={branch}");
        run(&remotes, &["init", "--quiet", "--bare", &initial, PROJECT]);
        run(&seed, &["init", "--quiet", &initial]);
        for (path, body) in files {
            let target = seed.join(path);
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::write(target, body).unwrap();
        }
        run(&seed, &["add", "-A"]);
        run(&seed, &["commit", "--quiet", "-m", "Initial"]);
        let bare = remotes.join(PROJECT);
        let refspec = format!("{branch}:{branch}");
        run(
            &seed,
            &["push", "--quiet", bare.to_str().unwrap(), &refspec],
        );
        let project = temp.path().join("project");
        std::fs::create_dir_all(&project).unwrap();
        for (path, body) in files {
            let target = project.join(path);
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::write(target, body).unwrap();
        }
        let server = url::Url::from_directory_path(&remotes)
            .unwrap()
            .to_string()
            .trim_end_matches('/')
            .to_string();
        let paths = SyncPaths::for_folder(&temp.path().join("mirror-owner"));
        World {
            repo: paths.repo.clone(),
            paths,
            temp,
            remotes,
            server,
            project,
            branch,
            git: system_git(),
        }
    }

    fn url(&self) -> String {
        remote_url(&self.server, PROJECT).unwrap()
    }

    fn bare(&self) -> PathBuf {
        self.remotes.join(PROJECT)
    }

    fn clone_dir(&self) -> PathBuf {
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
        clone
    }

    fn coauthor(&self, changes: &[(&str, Option<&str>)]) {
        let clone = self.clone_dir();
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
        let refspec = format!("HEAD:{}", self.branch);
        run(&clone, &["push", "--quiet", "origin", &refspec]);
    }

    fn coauthor_git(&self, commands: &[&[&str]]) {
        let clone = self.clone_dir();
        for command in commands {
            run(&clone, command);
        }
        run(&clone, &["commit", "--quiet", "-m", "Co-author rename"]);
        let refspec = format!("HEAD:{}", self.branch);
        run(&clone, &["push", "--quiet", "origin", &refspec]);
    }

    fn remote_file(&self, path: &str) -> Option<String> {
        let bare = self.bare();
        let object = format!("{}:{path}", self.branch);
        let output = self
            .git
            .command(
                self.temp.path(),
                &["--git-dir", bare.to_str().unwrap(), "show", &object],
                None,
            )
            .output()
            .unwrap();
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
    }

    fn remote_branches(&self) -> Vec<String> {
        run(
            &self.bare(),
            &["for-each-ref", "--format=%(refname)", "refs/heads/"],
        )
        .lines()
        .map(str::to_string)
        .collect()
    }

    fn local(&self, path: &str) -> Option<String> {
        std::fs::read_to_string(self.project.join(path)).ok()
    }

    fn write(&self, path: &str, body: &str) {
        let target = self.project.join(path);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(target, body).unwrap();
    }

    fn link_at(&self, paths: &SyncPaths, project: &Path, prefer: Option<Side>) -> LinkOutcome {
        link_project(
            &self.git,
            paths,
            project,
            &self.server,
            PROJECT,
            &self.url(),
            TOKEN,
            prefer,
            Mode::Apply,
            None,
            true,
        )
        .unwrap()
    }

    fn link(&self, prefer: Option<Side>) -> LinkOutcome {
        self.link_at(&self.paths, &self.project, prefer)
    }

    fn sync_at(&self, paths: &SyncPaths, project: &Path, options: &SyncOptions) -> SyncSummary {
        sync_project(&self.git, paths, project, &self.url(), TOKEN, options).unwrap()
    }

    fn sync_with(&self, resolutions: &BTreeMap<String, Side>) -> SyncSummary {
        let options = SyncOptions {
            resolutions: resolutions.clone(),
            mode: Mode::Apply,
            push: true,
            worktree: None,
        };
        self.sync_at(&self.paths, &self.project, &options)
    }

    fn sync(&self) -> SyncSummary {
        self.sync_with(&BTreeMap::new())
    }

    fn base(&self) -> String {
        rev(&self.git, &self.repo, BASE_REF).unwrap()
    }
}

const SEEDED: &[(&str, &[u8])] = &[
    (
        "main.tex",
        b"\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n",
    ),
    ("refs.bib", b"@book{a, title={A}}\n"),
    ("notes.tex", b"Notes\n"),
    ("img/fig.png", &[0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]),
];

fn seeded() -> World {
    World::new(SEEDED)
}

fn merged(summary: &SyncSummary) -> bool {
    matches!(summary.outcome, SyncOutcome::Synced | SyncOutcome::Pulled)
}

fn conflicts(summary: &SyncSummary) -> Option<&[String]> {
    (summary.outcome == SyncOutcome::Conflicts).then_some(summary.conflicts.as_slice())
}

fn plan() -> SyncOptions {
    SyncOptions {
        resolutions: BTreeMap::new(),
        mode: Mode::Plan,
        push: true,
        worktree: None,
    }
}

/// Every file outside `.oleafly`, with its bytes.
fn snapshot_of(dir: &Path) -> Vec<(String, Vec<u8>)> {
    let mut files = Vec::new();
    let mut stack = vec![(dir.to_path_buf(), String::new())];
    while let Some((folder, prefix)) = stack.pop() {
        for entry in std::fs::read_dir(&folder).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().to_string_lossy().into_owned();
            let rel = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if rel == ".oleafly" {
                continue;
            }
            if entry.file_type().unwrap().is_dir() {
                stack.push((entry.path(), rel));
            } else {
                files.push((rel, std::fs::read(entry.path()).unwrap()));
            }
        }
    }
    files.sort();
    files
}

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target).unwrap();
        }
    }
}

/// Git that counts remote calls.
struct CountingGit {
    inner: SystemGit,
    remote: AtomicUsize,
}

impl CountingGit {
    fn remote_calls(&self) -> usize {
        self.remote.load(Ordering::SeqCst)
    }
}

impl MirrorGit for CountingGit {
    fn run(&self, repo: &Path, args: &[&str]) -> Result<Output, OnlineError> {
        self.inner.run(repo, args)
    }

    fn run_remote(
        &self,
        repo: &Path,
        credential_origin: &str,
        token: &str,
        args: &[&str],
    ) -> Result<Output, OnlineError> {
        self.remote.fetch_add(1, Ordering::SeqCst);
        self.inner.run_remote(repo, credential_origin, token, args)
    }
}

fn sample_link() -> SyncLink {
    SyncLink {
        server: "https://latex.example.edu".into(),
        remote_id: "64a1f0".into(),
        linked_at: 1,
        auto: true,
        last_sync_at: Some(2),
    }
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

    assert_eq!(world.sync().outcome, SyncOutcome::UpToDate);
    world.write(
        "main.tex",
        "\\documentclass{article}\n\\begin{document}\nHello there.\n\\end{document}\n",
    );
    let summary = world.sync();
    assert_eq!(summary.outcome, SyncOutcome::Synced);
    assert!(summary.pushed);
    assert!(world
        .remote_file("main.tex")
        .unwrap()
        .contains("Hello there."));
    assert_eq!(world.remote_file("project.json"), None);
    assert_eq!(world.remote_file(".oleafly/build/main.pdf"), None);
    assert_eq!(world.remote_file(".DS_Store"), None);
    assert_eq!(world.sync().outcome, SyncOutcome::UpToDate);
}

#[test]
fn a_project_on_main_links_pulls_and_pushes_without_a_new_branch() {
    let world = World::on_branch("main", SEEDED);
    assert_eq!(
        world.link(None),
        LinkOutcome::Linked {
            written: Vec::new()
        }
    );
    world.coauthor(&[("refs.bib", Some("@book{m, title={M}}\n"))]);
    world.write("notes.tex", "Notes from here\n");
    assert_eq!(world.sync().outcome, SyncOutcome::Synced);
    assert_eq!(
        world.local("refs.bib").as_deref(),
        Some("@book{m, title={M}}\n")
    );
    assert_eq!(
        world.remote_file("notes.tex").as_deref(),
        Some("Notes from here\n")
    );
    assert_eq!(world.remote_branches(), vec!["refs/heads/main".to_string()]);
}

#[test]
fn a_renamed_remote_branch_is_followed() {
    let world = seeded();
    world.link(None);
    run(&world.bare(), &["branch", "-m", "master", "main"]);
    world.write("notes.tex", "After the rename\n");
    assert_eq!(world.sync().outcome, SyncOutcome::Synced);
    assert_eq!(
        run(&world.bare(), &["show", "main:notes.tex"]),
        "After the rename"
    );
    assert_eq!(world.remote_branches(), vec!["refs/heads/main".to_string()]);
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
    let summary = world.sync();
    assert!(merged(&summary), "{summary:?}");
    assert!(summary.written.contains(&"refs.bib".to_string()));
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
    let summary = world.sync();
    assert!(merged(&summary), "{summary:?}");
    assert_eq!(summary.removed, vec!["sections/intro.tex".to_string()]);
    assert!(!world.project.join("sections").exists());
}

#[test]
fn edits_to_different_files_on_both_sides_merge() {
    let world = seeded();
    world.link(None);
    world.coauthor(&[("refs.bib", Some("@book{c, title={C}}\n"))]);
    world.write("notes.tex", "Notes, revised\n");
    assert_eq!(world.sync().outcome, SyncOutcome::Synced);
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
        conflicts(&world.sync()),
        Some(&["notes.tex".to_string()][..])
    );
    assert_eq!(world.local("notes.tex").as_deref(), Some("Mine\n"));
    assert_eq!(world.remote_file("notes.tex").as_deref(), Some("Theirs\n"));

    let keep_mine = BTreeMap::from([("notes.tex".to_string(), Side::Local)]);
    assert!(merged(&world.sync_with(&keep_mine)));
    assert_eq!(world.remote_file("notes.tex").as_deref(), Some("Mine\n"));
    assert_eq!(world.local("notes.tex").as_deref(), Some("Mine\n"));

    world.coauthor(&[("notes.tex", Some("Theirs again\n"))]);
    world.write("notes.tex", "Mine again\n");
    let take_theirs = BTreeMap::from([("notes.tex".to_string(), Side::Remote)]);
    assert!(merged(&world.sync_with(&take_theirs)));
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
        conflicts(&world.sync()),
        Some(&["notes.tex".to_string()][..])
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
    assert_eq!(read_link(&world.paths).unwrap(), None);
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
    let base = world.base();
    let remote = fetch(&world.git, &world.repo, &world.url(), TOKEN).unwrap();
    let Integration::Merged { merged, .. } = integrate(
        &world.git,
        &world.project,
        &world.repo,
        &base,
        &remote,
        &BTreeMap::new(),
        Mode::Apply,
    )
    .unwrap() else {
        panic!("expected a local commit");
    };
    world.coauthor(&[("refs.bib", Some("@book{late, title={Late}}\n"))]);
    assert_eq!(
        push(&world.git, &world.repo, &world.url(), TOKEN, &merged).unwrap(),
        PushResult::Rejected
    );
    assert_eq!(world.base(), base);
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
    let clash = check_remote_paths(&["Main.tex".to_string(), "main.tex".to_string()]).unwrap_err();
    assert_eq!(clash.kind, OnlineErrorKind::SyncCaseClash);
    assert_eq!(
        check_remote_paths(&["../escape.tex".to_string()])
            .unwrap_err()
            .kind,
        OnlineErrorKind::SyncInvalidNames
    );
    assert!(check_remote_paths(&["a/b.tex".to_string(), "c.tex".to_string()]).is_ok());
    assert!(excluded("project.json"));
    assert!(excluded(".oleafly/build/main.pdf"));
    assert!(excluded("figures/.DS_Store"));
    assert!(excluded("sub/.git/config"));
    assert!(!excluded("sub/project.json"));
    assert!(!excluded("main.tex"));
    assert_eq!(
        remote_url(DEFAULT_SERVER, "64a1f0").unwrap(),
        "https://git.overleaf.com/64a1f0"
    );
    assert_eq!(
        remote_url("https://latex.uni.edu", "64a1f0").unwrap(),
        "https://latex.uni.edu/git/64a1f0"
    );
    assert!(remote_url("https://latex.uni.edu", "../x").is_err());
    assert_eq!(
        credential_origin("https://git.overleaf.com/64a1f0"),
        "https://git.overleaf.com"
    );
    assert!(session::valid_git_token("olp_abcdefghijklmnop"));
    assert!(!session::valid_git_token("short"));
    assert!(!session::valid_git_token("has space inside"));
    assert!(!session::valid_git_token("quote\"inside1"));
    assert_eq!(
        classify_remote_failure("fatal: Authentication failed for 'https://git.overleaf.com/x'")
            .kind,
        OnlineErrorKind::GitTokenRejected
    );
    assert_eq!(
        classify_remote_failure("remote: Repository not found.").kind,
        OnlineErrorKind::GitUnavailable
    );
    assert_eq!(
        classify_remote_failure("fatal: unable to access: Could not resolve host").kind,
        OnlineErrorKind::SyncOffline
    );
    assert_eq!(
        classify_remote_failure("something odd").kind,
        OnlineErrorKind::SyncFailed
    );
}

/// Claims `paths` within 2 s. A lock dropped by this test can stay held for a
/// moment by a process another test is starting, whose copy of our
/// descriptors closes when it execs.
fn claimed_soon(paths: &SyncPaths) -> bool {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if claim(paths).is_ok() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn only_one_sync_runs_per_project_at_a_time() {
    let data = tempfile::tempdir().unwrap();
    let one = SyncPaths::for_app_project(data.path(), "project-one").unwrap();
    let two = SyncPaths::for_app_project(data.path(), "project-two").unwrap();
    let first = claim(&one).unwrap();
    assert_eq!(claim(&one).unwrap_err().kind, OnlineErrorKind::SyncBusy);
    let other = claim(&two).unwrap();
    drop(first);
    assert!(claimed_soon(&one));
    drop(other);
}

#[test]
fn claim_fails_fast_when_another_process_holds_the_sync_lock() {
    let project = tempfile::tempdir().unwrap();
    let paths = SyncPaths::for_folder(project.path());
    std::fs::create_dir_all(paths.lock.parent().unwrap()).unwrap();
    let held = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&paths.lock)
        .unwrap();
    // Stands in for the other process.
    oleafly_core::locking::lock_file(&held, true, Duration::ZERO).unwrap();
    let started = Instant::now();
    assert_eq!(claim(&paths).err().unwrap().kind, OnlineErrorKind::SyncBusy);
    assert!(started.elapsed() < Duration::from_secs(1));
    drop(held);
    assert!(claimed_soon(&paths));
}

#[test]
fn claim_waits_out_a_lock_that_is_released_a_moment_later() {
    let project = tempfile::tempdir().unwrap();
    let paths = SyncPaths::for_folder(project.path());
    std::fs::create_dir_all(paths.lock.parent().unwrap()).unwrap();
    let held = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&paths.lock)
        .unwrap();
    // Stands in for a process another thread is starting: its copy of the
    // descriptor keeps the lock until it execs.
    oleafly_core::locking::lock_file(&held, true, Duration::ZERO).unwrap();
    let releaser = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(10));
        drop(held);
    });
    // One attempt, no retry: the claim itself has to wait it out.
    assert!(claim(&paths).is_ok());
    releaser.join().unwrap();
}

#[test]
fn unlink_works_while_another_sync_lock_is_open() {
    let project = tempfile::tempdir().unwrap();
    let paths = SyncPaths::for_folder(project.path());
    write_link(&paths, &sample_link()).unwrap();
    let _claim = claim(&paths).unwrap();
    assert!(!paths.lock.starts_with(&paths.dir));
    remove_link(&paths).unwrap();
    assert!(!paths.dir.exists());
}

#[test]
fn a_0_4_7_link_record_loads() {
    let data = tempfile::tempdir().unwrap();
    let paths = SyncPaths::for_app_project(data.path(), "my-project").unwrap();
    std::fs::create_dir_all(&paths.dir).unwrap();
    std::fs::write(
        &paths.link,
        r#"{"server":"https://latex.example.edu","remoteId":"64a1f0","linkedAt":1,"auto":true}"#,
    )
    .unwrap();
    let link = read_link(&paths).unwrap().unwrap();
    assert_eq!(link.remote_id, "64a1f0");
    assert_eq!(link.last_sync_at, None);
}

#[test]
fn a_wrong_project_id_reports_no_git_access() {
    let world = seeded();
    let url = remote_url(&world.server, "missing0").unwrap();
    let error = fetch(&world.git, &world.repo, &url, TOKEN).unwrap_err();
    assert!(
        matches!(
            error.kind,
            OnlineErrorKind::GitUnavailable | OnlineErrorKind::SyncFailed
        ),
        "{error}"
    );
}

#[test]
fn sync_links_round_trip_and_unlink_removes_the_copy() {
    let data = tempfile::tempdir().unwrap();
    let paths = SyncPaths::for_app_project(data.path(), "my-project").unwrap();
    let link = SyncLink {
        server: DEFAULT_SERVER.into(),
        remote_id: "64a1f0".into(),
        linked_at: 1,
        auto: true,
        last_sync_at: Some(2),
    };
    write_link(&paths, &link).unwrap();
    assert_eq!(read_link(&paths).unwrap(), Some(link));
    assert!(paths.repo.starts_with(data.path()));
    assert!(SyncPaths::for_app_project(data.path(), "../escape").is_err());
    remove_link(&paths).unwrap();
    assert_eq!(read_link(&paths).unwrap(), None);

    let store = SecretStore::at(data.path());
    session::save_git_token(&store, DEFAULT_SERVER, "  olp_token_12345  ").unwrap();
    assert_eq!(
        session::git_token(&store, DEFAULT_SERVER)
            .unwrap()
            .as_deref(),
        Some("olp_token_12345")
    );
    assert!(session::save_git_token(&store, DEFAULT_SERVER, "bad token").is_err());
    assert!(session::forget_git_token(&store, DEFAULT_SERVER).unwrap());
    assert_eq!(session::git_token(&store, DEFAULT_SERVER).unwrap(), None);
}

#[test]
fn a_case_only_rename_online_keeps_the_file_here_and_online() {
    let world = World::new(&[("main.tex", b"Main\n"), ("Plot.tex", b"Plot\n")]);
    world.link(None);
    world.coauthor_git(&[&["mv", "-f", "Plot.tex", "plot.tex"]]);
    world.sync();
    assert_eq!(world.local("plot.tex").as_deref(), Some("Plot\n"));
    world.sync();
    assert_eq!(world.remote_file("plot.tex").as_deref(), Some("Plot\n"));
}

#[test]
fn a_case_only_rename_here_never_deletes_the_file_online() {
    let world = World::new(&[("main.tex", b"Main\n"), ("Plot.tex", b"Plot\n")]);
    world.link(None);
    let moved = world.project.join("moved.tmp");
    std::fs::rename(world.project.join("Plot.tex"), &moved).unwrap();
    std::fs::rename(&moved, world.project.join("plot.tex")).unwrap();
    world.sync();
    let online = world
        .remote_file("plot.tex")
        .or_else(|| world.remote_file("Plot.tex"));
    assert_eq!(online.as_deref(), Some("Plot\n"));
}

#[test]
fn a_file_that_became_a_folder_online_arrives() {
    let world = World::new(&[("main.tex", b"Main\n"), ("chapter", b"Old\n")]);
    world.link(None);
    world.coauthor(&[("chapter", None), ("chapter/one.tex", Some("One\n"))]);
    world.sync();
    assert_eq!(world.local("chapter/one.tex").as_deref(), Some("One\n"));
}

#[test]
fn a_retry_merges_from_what_it_already_pulled() {
    let world = seeded();
    world.link(None);
    world.write("main.tex", "Mine\n");
    world.coauthor(&[("notes.tex", Some("First\n"))]);
    let base = world.base();
    let first_remote = fetch(&world.git, &world.repo, &world.url(), TOKEN).unwrap();
    let Integration::Merged { merged, .. } = integrate(
        &world.git,
        &world.project,
        &world.repo,
        &base,
        &first_remote,
        &BTreeMap::new(),
        Mode::Apply,
    )
    .unwrap() else {
        panic!("expected a merge");
    };
    assert_eq!(world.local("notes.tex").as_deref(), Some("First\n"));
    world.coauthor(&[("notes.tex", Some("Second\n"))]);
    assert_eq!(
        push(&world.git, &world.repo, &world.url(), TOKEN, &merged).unwrap(),
        PushResult::Rejected
    );
    let second_remote = fetch(&world.git, &world.repo, &world.url(), TOKEN).unwrap();
    let retried = integrate(
        &world.git,
        &world.project,
        &world.repo,
        &first_remote,
        &second_remote,
        &BTreeMap::new(),
        Mode::Apply,
    )
    .unwrap();
    assert!(matches!(retried, Integration::Merged { .. }), "{retried:?}");
    assert_eq!(world.local("notes.tex").as_deref(), Some("Second\n"));
    assert_eq!(world.local("main.tex").as_deref(), Some("Mine\n"));
}

#[test]
fn clashes_list_the_files_still_waiting_for_a_choice() {
    let world = seeded();
    world.link(None);
    world.coauthor(&[
        ("notes.tex", Some("Theirs\n")),
        ("refs.bib", Some("@book{t}\n")),
    ]);
    world.write("notes.tex", "Mine\n");
    world.write("refs.bib", "@book{m}\n");
    let one = BTreeMap::from([("notes.tex".to_string(), Side::Local)]);
    assert_eq!(
        conflicts(&world.sync_with(&one)),
        Some(&["refs.bib".to_string()][..])
    );
}

#[test]
fn a_local_commit_is_made_only_when_something_changed() {
    let world = seeded();
    world.link(None);
    let base = world.base();
    assert_eq!(
        commit_local(&world.git, &world.project, &world.repo, &base).unwrap(),
        None
    );
    world.write("notes.tex", "Changed\n");
    let commit = commit_local(&world.git, &world.project, &world.repo, &base)
        .unwrap()
        .unwrap();
    assert_ne!(commit, base);
    assert_eq!(world.base(), base);
}

#[test]
fn the_sync_copy_keeps_bytes_and_recovers_from_a_stale_lock() {
    let world = seeded();
    world.link(None);
    let attributes = world.repo.join(".git").join("info").join("attributes");
    assert_eq!(
        std::fs::read_to_string(&attributes).unwrap(),
        "* -text -filter -ident\n"
    );
    let lock = world.repo.join(".git").join("index.lock");
    std::fs::write(&lock, "").unwrap();
    clear_stale_lock(&world.repo);
    assert!(!lock.exists());
    clear_stale_lock(&world.repo);
    assert!(excluded("Project.json"));
    assert!(excluded("PROJECT.JSON"));
    assert!(!excluded("chapters/project.json"));
}

#[test]
fn remote_failures_name_the_line_git_reported() {
    let text = "remote: Counting objects: 100% (3/3), done.\nfatal: unable to write the pack\n";
    let error = classify_remote_failure(text);
    assert!(error
        .detail
        .as_deref()
        .is_some_and(|detail| detail.contains("unable to write the pack")));
}

#[test]
fn plan_mode_reports_changes_and_touches_nothing() {
    let world = seeded();
    world.link(None);
    world.coauthor(&[("refs.bib", Some("@book{x}\n"))]);
    world.write("notes.tex", "Mine\n");
    let before = snapshot_of(&world.project);
    let base = world.base();
    let link = read_link(&world.paths).unwrap();
    let summary = sync_project(
        &world.git,
        &world.paths,
        &world.project,
        &world.url(),
        TOKEN,
        &plan(),
    )
    .unwrap();
    assert_eq!(summary.outcome, SyncOutcome::Planned);
    assert_eq!(summary.written, vec!["refs.bib".to_string()]);
    assert_eq!(snapshot_of(&world.project), before);
    assert_eq!(world.base(), base);
    assert_eq!(read_link(&world.paths).unwrap(), link);
    assert_ne!(world.remote_file("notes.tex").as_deref(), Some("Mine\n"));
}

#[test]
fn no_push_merges_here_and_moves_the_base_to_the_remote() {
    let world = seeded();
    world.link(None);
    world.coauthor(&[("refs.bib", Some("@book{x}\n"))]);
    world.write("notes.tex", "Mine\n");
    let options = SyncOptions {
        resolutions: BTreeMap::new(),
        mode: Mode::Apply,
        push: false,
        worktree: None,
    };
    let summary = world.sync_at(&world.paths, &world.project, &options);
    assert_eq!(summary.outcome, SyncOutcome::Pulled);
    assert!(!summary.pushed);
    assert_eq!(world.local("refs.bib").as_deref(), Some("@book{x}\n"));
    assert_eq!(
        rev(&world.git, &world.repo, BASE_REF),
        remote_tip(&world.git, &world.repo)
    );
    assert_eq!(world.remote_file("notes.tex").as_deref(), Some("Notes\n"));

    let summary = world.sync();
    assert_eq!(summary.outcome, SyncOutcome::Synced);
    assert!(summary.pushed);
    assert_eq!(world.remote_file("notes.tex").as_deref(), Some("Mine\n"));
}

#[test]
fn an_interrupted_sync_converges_on_the_next_run() {
    let world = seeded();
    world.link(None);
    world.coauthor(&[("refs.bib", Some("@book{x}\n"))]);
    world.write("notes.tex", "Mine\n");
    let base = world.base();
    let remote = fetch(&world.git, &world.repo, &world.url(), TOKEN).unwrap();
    // The remote changes reach the folder, then the process dies before the
    // base moves or anything is pushed.
    integrate(
        &world.git,
        &world.project,
        &world.repo,
        &base,
        &remote,
        &BTreeMap::new(),
        Mode::Apply,
    )
    .unwrap();
    assert_eq!(world.local("refs.bib").as_deref(), Some("@book{x}\n"));
    assert_eq!(world.base(), base);

    let summary = world.sync();
    assert!(
        matches!(summary.outcome, SyncOutcome::Synced | SyncOutcome::UpToDate),
        "{summary:?}"
    );
    assert!(summary.conflicts.is_empty());
    assert_eq!(world.remote_file("refs.bib").as_deref(), Some("@book{x}\n"));
    assert_eq!(world.remote_file("notes.tex").as_deref(), Some("Mine\n"));
}

#[test]
fn a_copied_folder_keeps_a_base_that_matches_its_files() {
    let world = seeded();
    let folder_a = world.project.clone();
    let paths_a = SyncPaths::for_folder(&folder_a);
    assert!(matches!(
        world.link_at(&paths_a, &folder_a, None),
        LinkOutcome::Linked { .. }
    ));
    assert_eq!(
        std::fs::read_to_string(paths_a.dir.join(".gitignore")).unwrap(),
        "*\n"
    );
    let options = SyncOptions {
        resolutions: BTreeMap::new(),
        mode: Mode::Apply,
        push: true,
        worktree: None,
    };
    assert_eq!(
        world.sync_at(&paths_a, &folder_a, &options).outcome,
        SyncOutcome::UpToDate
    );

    let folder_b = world.temp.path().join("copy");
    copy_tree(&folder_a, &folder_b);
    let paths_b = SyncPaths::for_folder(&folder_b);

    std::fs::write(folder_a.join("notes.tex"), "Edited in A\n").unwrap();
    assert_eq!(
        world.sync_at(&paths_a, &folder_a, &options).outcome,
        SyncOutcome::Synced
    );

    let summary = world.sync_at(&paths_b, &folder_b, &options);
    assert!(
        matches!(summary.outcome, SyncOutcome::Pulled | SyncOutcome::Synced),
        "{summary:?}"
    );
    assert_eq!(
        std::fs::read_to_string(folder_b.join("notes.tex")).unwrap(),
        "Edited in A\n"
    );
    assert_eq!(
        world.remote_file("notes.tex").as_deref(),
        Some("Edited in A\n")
    );
}

#[test]
fn sync_waits_for_the_worktree_lock_then_reports_busy() {
    let world = seeded();
    world.link(None);
    world.write("notes.tex", "Mine\n");
    let lock_path = world.temp.path().join("locks").join("worktree.lock");
    std::fs::create_dir_all(lock_path.parent().unwrap()).unwrap();
    let held = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&lock_path)
        .unwrap();
    oleafly_core::locking::lock_file(&held, true, Duration::ZERO).unwrap();
    let options = SyncOptions {
        resolutions: BTreeMap::new(),
        mode: Mode::Apply,
        push: true,
        worktree: Some(WorktreeLock {
            path: lock_path,
            budget: Duration::from_millis(50),
        }),
    };
    let error = sync_project(
        &world.git,
        &world.paths,
        &world.project,
        &world.url(),
        TOKEN,
        &options,
    )
    .unwrap_err();
    assert_eq!(error.kind, OnlineErrorKind::WorktreeBusy);
    assert_eq!(world.remote_file("notes.tex").as_deref(), Some("Notes\n"));
}

#[test]
fn a_folder_over_5000_files_is_refused_before_git_runs() {
    let world = seeded();
    write_link(
        &world.paths,
        &SyncLink {
            server: world.server.clone(),
            remote_id: PROJECT.to_string(),
            linked_at: 1,
            auto: true,
            last_sync_at: None,
        },
    )
    .unwrap();
    let many = world.project.join("many");
    std::fs::create_dir_all(&many).unwrap();
    for index in 0..5_001 {
        std::fs::write(many.join(format!("{index}.txt")), "x").unwrap();
    }
    let counting = CountingGit {
        inner: system_git(),
        remote: AtomicUsize::new(0),
    };
    let options = SyncOptions {
        resolutions: BTreeMap::new(),
        mode: Mode::Apply,
        push: true,
        worktree: None,
    };
    let error = sync_project(
        &counting,
        &world.paths,
        &world.project,
        &world.url(),
        TOKEN,
        &options,
    )
    .unwrap_err();
    assert_eq!(error.kind, OnlineErrorKind::SyncTooLarge);
    assert_eq!(counting.remote_calls(), 0);
}

#[test]
fn an_unlinked_folder_reports_not_linked() {
    let world = seeded();
    let error = sync_project(
        &world.git,
        &world.paths,
        &world.project,
        &world.url(),
        TOKEN,
        &plan(),
    )
    .unwrap_err();
    assert_eq!(error.kind, OnlineErrorKind::SyncNotLinked);
}

#[test]
fn linking_a_folder_to_a_second_project_is_refused() {
    let world = seeded();
    world.link(None);
    let error = link_project(
        &world.git,
        &world.paths,
        &world.project,
        &world.server,
        "other1",
        &world.url(),
        TOKEN,
        None,
        Mode::Apply,
        None,
        true,
    )
    .unwrap_err();
    assert_eq!(error.kind, OnlineErrorKind::SyncAlreadyLinked);
}

#[test]
fn diff_lists_changes_marks_conflicts_and_leaves_the_mirror_at_base() {
    let world = seeded();
    world.link(None);
    world.coauthor(&[
        (
            "main.tex",
            Some("\\documentclass{article}\n\\begin{document}\nTheirs.\n\\end{document}\n"),
        ),
        ("refs.bib", Some("@book{r}\n")),
    ]);
    world.write(
        "main.tex",
        "\\documentclass{article}\n\\begin{document}\nMine.\n\\end{document}\n",
    );
    world.write("new.tex", "New\n");
    let options = DiffOptions {
        fetch: true,
        patch: true,
        max_patch_bytes: 8 * 1024 * 1024,
    };
    let summary = diff_project(
        &world.git,
        &world.paths,
        &world.project,
        &world.url(),
        TOKEN,
        &options,
        None,
    )
    .unwrap();
    assert_eq!(summary.conflicts, vec!["main.tex".to_string()]);
    assert!(summary.changes.contains(&FileChange {
        path: "new.tex".into(),
        change: ChangeKind::Added
    }));
    assert!(summary.changes.contains(&FileChange {
        path: "main.tex".into(),
        change: ChangeKind::Modified
    }));
    assert!(!summary.truncated);
    assert!(summary.patch.unwrap().contains("+++ b/new.tex"));
    assert_eq!(
        rev(&world.git, &world.repo, "HEAD"),
        rev(&world.git, &world.repo, BASE_REF)
    );
    assert_eq!(
        world.local("refs.bib").as_deref(),
        Some("@book{a, title={A}}\n")
    );
}

#[test]
fn a_huge_patch_is_truncated_and_says_so() {
    let world = seeded();
    world.link(None);
    let big: String = (0..2_000)
        .map(|line| format!("Line {line} of a long chapter\n"))
        .collect();
    assert!(big.len() > 50_000);
    world.write("chapter.tex", &big);
    let options = DiffOptions {
        fetch: false,
        patch: true,
        max_patch_bytes: 1024,
    };
    let summary = diff_project(
        &world.git,
        &world.paths,
        &world.project,
        &world.url(),
        TOKEN,
        &options,
        None,
    )
    .unwrap();
    assert!(summary.truncated);
    let patch = summary.patch.unwrap();
    assert!(!patch.is_empty() && patch.len() <= 1024);
    assert!(patch.ends_with('\n'));
}

#[test]
fn probe_reports_each_side_without_merging() {
    let world = seeded();
    world.link(None);
    let quiet = probe(
        &world.git,
        &world.paths,
        &world.project,
        &world.url(),
        TOKEN,
        None,
    )
    .unwrap();
    assert_eq!(
        quiet,
        Probe {
            remote_changed: false,
            local_changed: false
        }
    );
    world.coauthor(&[("refs.bib", Some("@book{p}\n"))]);
    world.write("notes.tex", "Mine\n");
    let busy = probe(
        &world.git,
        &world.paths,
        &world.project,
        &world.url(),
        TOKEN,
        None,
    )
    .unwrap();
    assert_eq!(
        busy,
        Probe {
            remote_changed: true,
            local_changed: true
        }
    );
    assert_eq!(
        world.local("refs.bib").as_deref(),
        Some("@book{a, title={A}}\n")
    );
    assert_eq!(world.remote_file("notes.tex").as_deref(), Some("Notes\n"));
}

#[test]
fn checkout_remote_puts_the_remote_files_in_the_mirror() {
    let world = seeded();
    world.link(None);
    world.coauthor(&[("refs.bib", Some("@book{tip}\n"))]);
    fetch(&world.git, &world.repo, &world.url(), TOKEN).unwrap();
    let tree = checkout_remote(&world.git, &world.paths).unwrap();
    assert_eq!(
        std::fs::read_to_string(tree.join("refs.bib")).unwrap(),
        "@book{tip}\n"
    );
    assert_eq!(
        world.local("refs.bib").as_deref(),
        Some("@book{a, title={A}}\n")
    );
}

#[test]
fn windows_rules_apply_on_every_os() {
    assert!(
        windows_invalid("con.tex")
            && windows_invalid("a:b.tex")
            && windows_invalid("dir./x.tex")
            && windows_invalid("x.tex ")
    );
    assert!(!windows_invalid("chapters/intro.tex"));
    assert_eq!(
        check_remote_paths_on(&["aux.tex".into()], true)
            .unwrap_err()
            .kind,
        OnlineErrorKind::SyncInvalidNames
    );
    assert!(check_remote_paths_on(&["aux.tex".into()], false).is_ok());
}
