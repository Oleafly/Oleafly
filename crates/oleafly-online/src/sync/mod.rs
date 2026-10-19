//! Two-way sync through a private Git mirror of the online project. The
//! mirror keeps a base commit (the last state both sides agreed on); local
//! edits are committed on top of it and merged with the remote tip, and the
//! result is written back here and pushed there.
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs::File;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::client::valid_project_id;
use crate::error::{OnlineError, OnlineErrorKind};
use crate::git::MirrorGit;
use crate::service::{
    APP_SYNC_DIR, DEFAULT_GIT_ORIGIN, DEFAULT_SERVER, MERGE_MESSAGE, REMOTE_BRANCHES, REMOTE_PREFIX,
};

pub const BASE_REF: &str = "refs/heads/oleafly-base";
/// Where a folder keeps its mirror and link: `<folder>/.oleafly/online`.
pub const FOLDER_STATE: [&str; 2] = [".oleafly", "online"];
const MAX_FILES: usize = 5_000;
const MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_LISTED: usize = 200;
const IGNORED_NAMES: [&str; 5] = ["__macosx", ".ds_store", "thumbs.db", "desktop.ini", ".git"];
const MIRROR_ATTRIBUTES: &str = "* -text -filter -ident\n";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Local,
    Remote,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncLink {
    pub server: String,
    pub remote_id: String,
    pub linked_at: u64,
    pub auto: bool,
    #[serde(default)]
    pub last_sync_at: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Integration {
    UpToDate,
    Merged {
        merged: String,
        push: bool,
        written: Vec<String>,
        removed: Vec<String>,
    },
    Conflicts(Vec<String>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkOutcome {
    Linked { written: Vec<String> },
    NeedsChoice(Vec<String>),
}

#[derive(Debug, PartialEq, Eq)]
pub enum PushResult {
    Pushed,
    Rejected,
}

/// `Plan` computes what a sync would do and leaves files and refs alone.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Apply,
    Plan,
}

/// Where one project's mirror, link record and sync lock live.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SyncPaths {
    pub dir: PathBuf,
    pub repo: PathBuf,
    pub link: PathBuf,
    /// Outside `dir`, so unlinking works while a sync holds the lock.
    pub lock: PathBuf,
}

impl SyncPaths {
    /// The app's mirror of a library project:
    /// `<data>/overleaf-sync/<id>/{repo,link.json}`.
    pub fn for_app_project(data_root: &Path, project_id: &str) -> Result<SyncPaths, OnlineError> {
        if project_id.is_empty()
            || project_id.len() > 128
            || !project_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        {
            return Err(OnlineError::io(format!("invalid project id: {project_id}")));
        }
        let parent = data_root.join(APP_SYNC_DIR);
        let dir = parent.join(project_id);
        Ok(SyncPaths {
            repo: dir.join("repo"),
            link: dir.join("link.json"),
            lock: parent.join(format!("{project_id}.lock")),
            dir,
        })
    }

    /// Any other folder keeps its sync state inside itself, so a copied or
    /// moved folder carries a base that matches its own files.
    pub fn for_folder(folder: &Path) -> SyncPaths {
        let state = folder.join(FOLDER_STATE[0]);
        let dir = state.join(FOLDER_STATE[1]);
        SyncPaths {
            repo: dir.join("repo"),
            link: dir.join("link.json"),
            lock: state.join("online.lock"),
            dir,
        }
    }

    fn is_folder_scope(&self) -> bool {
        self.dir
            .ends_with(Path::new(FOLDER_STATE[0]).join(FOLDER_STATE[1]))
    }
}

static RUNNING: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);

/// One sync at a time per project, across processes. Dropping it releases
/// both the in-process slot and the lock file.
#[derive(Debug)]
pub struct SyncClaim {
    key: PathBuf,
    _file: File,
}

impl Drop for SyncClaim {
    fn drop(&mut self) {
        let mut running = RUNNING
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(set) = running.as_mut() {
            set.remove(&self.key);
        }
    }
}

pub fn claim(paths: &SyncPaths) -> Result<SyncClaim, OnlineError> {
    let key = paths.dir.clone();
    {
        let mut running = RUNNING
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let set = running.get_or_insert_with(HashSet::new);
        if !set.insert(key.clone()) {
            return Err(OnlineError::new(OnlineErrorKind::SyncBusy));
        }
    }
    let release = || {
        let mut running = RUNNING
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(set) = running.as_mut() {
            set.remove(&paths.dir);
        }
    };
    let opened = (|| {
        if let Some(parent) = paths.lock.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&paths.lock)
    })();
    let file = match opened {
        Ok(file) => file,
        Err(error) => {
            release();
            return Err(OnlineError::io(format!(
                "could not open the sync lock: {error}"
            )));
        }
    };
    if oleafly_core::locking::lock_file(&file, true, Duration::ZERO).is_err() {
        release();
        return Err(OnlineError::new(OnlineErrorKind::SyncBusy));
    }
    Ok(SyncClaim { key, _file: file })
}

pub fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

pub fn read_link(paths: &SyncPaths) -> Result<Option<SyncLink>, OnlineError> {
    match std::fs::read_to_string(&paths.link) {
        Ok(raw) => Ok(serde_json::from_str(&raw).ok()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(OnlineError::io(format!(
            "could not read the sync link: {error}"
        ))),
    }
}

pub fn write_link(paths: &SyncPaths, link: &SyncLink) -> Result<(), OnlineError> {
    if let Some(parent) = paths.link.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let raw =
        serde_json::to_vec_pretty(link).map_err(|error| OnlineError::io(error.to_string()))?;
    oleafly_secrets::fs::write_atomic(&paths.link, &raw).map_err(OnlineError::io)
}

/// Removes the mirror and the link record.
pub fn remove_link(paths: &SyncPaths) -> Result<(), OnlineError> {
    match std::fs::remove_dir_all(&paths.dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(OnlineError::io(format!(
            "could not remove the sync copy: {error}"
        ))),
    }
}

pub fn remote_url(server: &str, remote_id: &str) -> Result<String, OnlineError> {
    if !valid_project_id(remote_id) {
        return Err(OnlineError::new(OnlineErrorKind::ProjectUnavailable));
    }
    #[cfg(any(test, feature = "test-support"))]
    if server.starts_with("file://") {
        return Ok(format!("{server}/{remote_id}"));
    }
    if server == DEFAULT_SERVER {
        return Ok(format!("{DEFAULT_GIT_ORIGIN}/{remote_id}"));
    }
    Ok(format!("{server}/git/{remote_id}"))
}

pub fn credential_origin(url: &str) -> String {
    url::Url::parse(url)
        .map(|parsed| parsed.origin().ascii_serialization())
        .unwrap_or_default()
}

fn git_ok(git: &dyn MirrorGit, repo: &Path, args: &[&str]) -> Result<String, OnlineError> {
    let output = git.run(repo, args)?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(OnlineError::io(git.failure_text(&output)))
    }
}

fn git_lines(git: &dyn MirrorGit, repo: &Path, args: &[&str]) -> Result<Vec<String>, OnlineError> {
    let output = git.run(repo, args)?;
    if !output.status.success() {
        return Err(OnlineError::io(git.failure_text(&output)));
    }
    Ok(output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .map(|entry| String::from_utf8_lossy(entry).into_owned())
        .collect())
}

pub fn rev(git: &dyn MirrorGit, repo: &Path, name: &str) -> Option<String> {
    let commit = format!("{name}^{{commit}}");
    git.run(repo, &["rev-parse", "--verify", "--quiet", &commit])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|sha| !sha.is_empty())
}

pub fn ensure_repo(git: &dyn MirrorGit, repo: &Path) -> Result<(), OnlineError> {
    if !repo.join(".git").is_dir() {
        std::fs::create_dir_all(repo)
            .map_err(|error| OnlineError::io(format!("could not create the sync copy: {error}")))?;
        git_ok(git, repo, &["init", "--quiet"])?;
    }
    let attributes = repo.join(".git").join("info").join("attributes");
    if std::fs::read_to_string(&attributes).ok().as_deref() != Some(MIRROR_ATTRIBUTES) {
        if let Some(parent) = attributes.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&attributes, MIRROR_ATTRIBUTES)?;
    }
    Ok(())
}

pub fn clear_stale_lock(repo: &Path) {
    let lock = repo.join(".git").join("index.lock");
    if lock.is_file() {
        let _ = std::fs::remove_file(lock);
    }
}

pub fn classify_remote_failure(text: &str) -> OnlineError {
    let lower = text.to_ascii_lowercase();
    if [
        "authentication failed",
        "invalid username or password",
        "401",
        "403",
        "access denied",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
    {
        return OnlineError::new(OnlineErrorKind::GitTokenRejected);
    }
    if [
        "not found",
        "404",
        "does not appear to be a git repository",
        "repository not found",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
    {
        return OnlineError::new(OnlineErrorKind::GitUnavailable);
    }
    if [
        "could not resolve host",
        "failed to connect",
        "timed out",
        "connection refused",
        "network is unreachable",
        "unable to access",
        "connection reset",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
    {
        return OnlineError::new(OnlineErrorKind::SyncOffline).detail(first_line(text));
    }
    OnlineError::new(OnlineErrorKind::SyncFailed).detail(first_line(text))
}

fn first_line(text: &str) -> String {
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    let reported = lines.iter().find(|line| {
        let lower = line.to_ascii_lowercase();
        ["fatal:", "error:", "remote: error", "!"]
            .iter()
            .any(|marker| lower.starts_with(marker))
    });
    reported
        .or(lines.last())
        .copied()
        .unwrap_or_default()
        .chars()
        .take(300)
        .collect()
}

fn remote_branch(git: &dyn MirrorGit, repo: &Path) -> Option<String> {
    let names = git_ok(
        git,
        repo,
        &["for-each-ref", "--format=%(refname)", REMOTE_PREFIX],
    )
    .ok()?;
    let mut branches = names
        .lines()
        .filter_map(|name| name.strip_prefix(REMOTE_PREFIX));
    let branch = branches.next()?;
    branches.next().is_none().then(|| branch.to_string())
}

pub fn remote_tip(git: &dyn MirrorGit, repo: &Path) -> Option<String> {
    rev(
        git,
        repo,
        &format!("{REMOTE_PREFIX}{}", remote_branch(git, repo)?),
    )
}

pub fn fetch(
    git: &dyn MirrorGit,
    repo: &Path,
    url: &str,
    token: &str,
) -> Result<String, OnlineError> {
    ensure_repo(git, repo)?;
    let origin = credential_origin(url);
    let output = git.run_remote(
        repo,
        &origin,
        token,
        &[
            "fetch",
            "--progress",
            "--prune",
            "--no-tags",
            "--no-recurse-submodules",
            url,
            REMOTE_BRANCHES,
        ],
    )?;
    if !output.status.success() {
        return Err(classify_remote_failure(&git.failure_text(&output)));
    }
    remote_tip(git, repo).ok_or_else(|| OnlineError::new(OnlineErrorKind::GitUnavailable))
}

pub fn push(
    git: &dyn MirrorGit,
    repo: &Path,
    url: &str,
    token: &str,
    commit: &str,
) -> Result<PushResult, OnlineError> {
    let branch = remote_branch(git, repo)
        .ok_or_else(|| OnlineError::new(OnlineErrorKind::GitUnavailable))?;
    let refspec = format!("{commit}:refs/heads/{branch}");
    let origin = credential_origin(url);
    let output = git.run_remote(
        repo,
        &origin,
        token,
        &["push", "--progress", "--porcelain", url, &refspec],
    )?;
    if output.status.success() {
        return Ok(PushResult::Pushed);
    }
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        git.failure_text(&output)
    );
    let lower = text.to_ascii_lowercase();
    if lower.contains("non-fast-forward")
        || lower.contains("fetch first")
        || lower.contains("[rejected]")
    {
        return Ok(PushResult::Rejected);
    }
    Err(classify_remote_failure(&text))
}

pub fn set_base(git: &dyn MirrorGit, repo: &Path, commit: &str) -> Result<(), OnlineError> {
    git_ok(git, repo, &["update-ref", BASE_REF, commit]).map(|_| ())
}

pub fn excluded(rel: &str) -> bool {
    if rel.eq_ignore_ascii_case("project.json") {
        return true;
    }
    let mut parts = rel.split('/');
    if parts
        .next()
        .is_some_and(|first| first.eq_ignore_ascii_case(".oleafly"))
    {
        return true;
    }
    rel.split('/')
        .any(|part| IGNORED_NAMES.contains(&part.to_ascii_lowercase().as_str()))
}

fn safe_relative(rel: &str) -> bool {
    !rel.is_empty()
        && !rel.starts_with('/')
        && !rel.contains('\\')
        && Path::new(rel)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

/// A name Windows cannot hold: reserved device names, `<>:"|?*`, control
/// characters, a trailing dot or space.
pub fn windows_invalid(rel: &str) -> bool {
    const RESERVED: [&str; 22] = [
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
        "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    ];
    rel.split('/').any(|part| {
        let stem = part
            .split('.')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        part.ends_with('.')
            || part.ends_with(' ')
            || part.chars().any(|character| {
                matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*') || character < ' '
            })
            || RESERVED.contains(&stem.as_str())
    })
}

pub fn check_remote_paths(paths: &[String]) -> Result<(), OnlineError> {
    check_remote_paths_on(paths, cfg!(windows))
}

/// Refuses remote file names that clash by case, or (with `windows`) that
/// Windows cannot hold.
pub fn check_remote_paths_on(paths: &[String], windows: bool) -> Result<(), OnlineError> {
    let mut seen: BTreeMap<String, &String> = BTreeMap::new();
    let mut clashes: BTreeSet<String> = BTreeSet::new();
    let mut invalid: BTreeSet<String> = BTreeSet::new();
    for path in paths {
        if !safe_relative(path) || (windows && windows_invalid(path)) {
            invalid.insert(path.clone());
            continue;
        }
        if let Some(other) = seen.insert(path.to_lowercase(), path) {
            clashes.insert(other.clone());
            clashes.insert(path.clone());
        }
    }
    if !clashes.is_empty() {
        return Err(OnlineError::new(OnlineErrorKind::SyncCaseClash).param(
            "files",
            clashes.into_iter().take(10).collect::<Vec<_>>().join(", "),
        ));
    }
    if !invalid.is_empty() {
        return Err(OnlineError::new(OnlineErrorKind::SyncInvalidNames).param(
            "files",
            invalid.into_iter().take(10).collect::<Vec<_>>().join(", "),
        ));
    }
    Ok(())
}

/// Every synced file of a project, by relative path.
pub fn project_files(root: &Path) -> Result<BTreeMap<String, PathBuf>, OnlineError> {
    let mut files = BTreeMap::new();
    let mut total: u64 = 0;
    let mut stack = vec![(root.to_path_buf(), String::new())];
    while let Some((dir, prefix)) = stack.pop() {
        let entries = std::fs::read_dir(&dir).map_err(|error| {
            OnlineError::io(format!("could not read {}: {error}", dir.display()))
        })?;
        for entry in entries {
            let entry = entry?;
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            let rel = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if excluded(&rel) {
                continue;
            }
            let metadata = std::fs::symlink_metadata(entry.path())?;
            if metadata.is_dir() {
                stack.push((entry.path(), rel));
            } else if metadata.is_file() {
                if metadata.len() > MAX_FILE_BYTES {
                    return Err(
                        OnlineError::new(OnlineErrorKind::SyncFileTooLarge).param("file", &rel)
                    );
                }
                total = total.saturating_add(metadata.len());
                files.insert(rel, entry.path());
                if files.len() > MAX_FILES || total > MAX_TOTAL_BYTES {
                    return Err(OnlineError::new(OnlineErrorKind::SyncTooLarge));
                }
            }
        }
    }
    Ok(files)
}

fn tracked_files(git: &dyn MirrorGit, repo: &Path) -> Result<BTreeSet<String>, OnlineError> {
    Ok(git_lines(git, repo, &["ls-files", "-z"])?
        .into_iter()
        .collect())
}

fn tree_files(git: &dyn MirrorGit, repo: &Path, commit: &str) -> Result<Vec<String>, OnlineError> {
    git_lines(git, repo, &["ls-tree", "-r", "-z", "--name-only", commit])
}

fn reset_to(git: &dyn MirrorGit, repo: &Path, commit: &str) -> Result<(), OnlineError> {
    git_ok(
        git,
        repo,
        &["checkout", "--quiet", "--force", "--detach", commit],
    )?;
    git_ok(git, repo, &["clean", "--quiet", "-ffdx"])?;
    Ok(())
}

fn copy_into(source: &Path, destination: &Path) -> Result<bool, OnlineError> {
    let bytes = std::fs::read(source).map_err(|error| {
        OnlineError::io(format!("could not read {}: {error}", source.display()))
    })?;
    if std::fs::read(destination).is_ok_and(|existing| existing == bytes) {
        return Ok(false);
    }
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(destination, &bytes).map_err(|error| {
        OnlineError::io(format!(
            "could not write {}: {error}",
            destination.display()
        ))
    })?;
    Ok(true)
}

fn stage_project(
    git: &dyn MirrorGit,
    project: &Path,
    repo: &Path,
    remove_missing: bool,
) -> Result<bool, OnlineError> {
    let files = project_files(project)?;
    if remove_missing {
        for rel in tracked_files(git, repo)? {
            if !excluded(&rel) && !files.contains_key(&rel) {
                let path = repo.join(&rel);
                if std::fs::symlink_metadata(&path).is_ok() {
                    std::fs::remove_file(&path)?;
                }
            }
        }
    }
    for (rel, source) in &files {
        copy_into(source, &repo.join(rel))?;
    }
    git_ok(git, repo, &["add", "--all", "--force", "--", "."])?;
    let staged = git.run(repo, &["diff", "--cached", "--quiet"])?;
    Ok(!staged.status.success())
}

fn commit(git: &dyn MirrorGit, repo: &Path, message: &str) -> Result<String, OnlineError> {
    git_ok(
        git,
        repo,
        &["commit", "--quiet", "--no-verify", "-m", message],
    )?;
    rev(git, repo, "HEAD").ok_or_else(|| OnlineError::io("the sync copy has no commit"))
}

fn changed_paths(
    git: &dyn MirrorGit,
    repo: &Path,
    from: &str,
    to: &str,
) -> Result<(Vec<String>, Vec<String>), OnlineError> {
    let entries = git_lines(
        git,
        repo,
        &["diff", "--name-status", "--no-renames", "-z", from, to],
    )?;
    let mut written = Vec::new();
    let mut removed = Vec::new();
    let mut iter = entries.into_iter();
    while let Some(status) = iter.next() {
        let Some(path) = iter.next() else {
            break;
        };
        if status.starts_with('D') {
            removed.push(path);
        } else {
            written.push(path);
        }
    }
    Ok((written, removed))
}

fn prune_empty_parents(root: &Path, path: &Path) {
    let mut current = path.parent();
    while let Some(dir) = current {
        if dir == root || !dir.starts_with(root) || std::fs::remove_dir(dir).is_err() {
            break;
        }
        current = dir.parent();
    }
}

/// Writes mirror files back to the project (or, without `apply`, only
/// lists what would change).
fn write_back(
    project: &Path,
    repo: &Path,
    written: &[String],
    removed: &[String],
    apply: bool,
) -> Result<(Vec<String>, Vec<String>), OnlineError> {
    let mut wrote = Vec::new();
    let mut deleted = Vec::new();
    for rel in removed {
        if excluded(rel) || !safe_relative(rel) {
            continue;
        }
        let destination = project.join(rel);
        match std::fs::symlink_metadata(&destination) {
            Ok(metadata) if metadata.is_file() => {
                if apply {
                    std::fs::remove_file(&destination)?;
                    prune_empty_parents(project, &destination);
                }
                deleted.push(rel.clone());
            }
            _ => {}
        }
    }
    for rel in written {
        if excluded(rel) || !safe_relative(rel) {
            continue;
        }
        let source = repo.join(rel);
        let metadata = std::fs::symlink_metadata(&source)?;
        if !metadata.is_file() {
            continue;
        }
        let destination = project.join(rel);
        if std::fs::symlink_metadata(&destination).is_ok_and(|existing| !existing.is_file()) {
            return Err(OnlineError::new(OnlineErrorKind::SyncPathBlocked).param("file", rel));
        }
        let bytes = std::fs::read(&source)?;
        if std::fs::read(&destination).is_ok_and(|existing| existing == bytes) {
            continue;
        }
        if apply {
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent)?;
            }
            oleafly_secrets::fs::write_atomic(&destination, &bytes).map_err(OnlineError::io)?;
        }
        wrote.push(rel.clone());
    }
    Ok((wrote, deleted))
}

fn conflicted_paths(git: &dyn MirrorGit, repo: &Path) -> Result<Vec<String>, OnlineError> {
    let mut paths: Vec<String> =
        git_lines(git, repo, &["diff", "--name-only", "--diff-filter=U", "-z"])?;
    paths.sort();
    paths.dedup();
    Ok(paths)
}

fn stages(git: &dyn MirrorGit, repo: &Path, path: &str) -> Result<BTreeSet<u8>, OnlineError> {
    let entries = git_lines(git, repo, &["ls-files", "-u", "-z", "--", path])?;
    Ok(entries
        .iter()
        .filter_map(|entry| entry.split('\t').next())
        .filter_map(|meta| meta.split_whitespace().nth(2))
        .filter_map(|stage| stage.parse().ok())
        .collect())
}

fn resolve(git: &dyn MirrorGit, repo: &Path, path: &str, side: Side) -> Result<(), OnlineError> {
    let present = stages(git, repo, path)?;
    let (stage, flag) = match side {
        Side::Local => (2, "--ours"),
        Side::Remote => (3, "--theirs"),
    };
    if present.contains(&stage) {
        git_ok(git, repo, &["checkout", flag, "--", path])?;
        git_ok(git, repo, &["add", "--force", "--", path])?;
    } else {
        git_ok(
            git,
            repo,
            &["rm", "--quiet", "--cached", "--ignore-unmatch", "--", path],
        )?;
        let file = repo.join(path);
        if std::fs::symlink_metadata(&file).is_ok() {
            std::fs::remove_file(&file)?;
        }
    }
    Ok(())
}

/// Commits the project's files on top of `base`; `None` when nothing
/// changed.
pub fn commit_local(
    git: &dyn MirrorGit,
    project: &Path,
    repo: &Path,
    base: &str,
) -> Result<Option<String>, OnlineError> {
    reset_to(git, repo, base)?;
    if stage_project(git, project, repo, true)? {
        commit(git, repo, "Changes from Oleafly").map(Some)
    } else {
        Ok(None)
    }
}

pub fn integrate(
    git: &dyn MirrorGit,
    project: &Path,
    repo: &Path,
    base: &str,
    remote: &str,
    resolutions: &BTreeMap<String, Side>,
    mode: Mode,
) -> Result<Integration, OnlineError> {
    let apply = mode == Mode::Apply;
    check_remote_paths(&tree_files(git, repo, remote)?)?;
    reset_to(git, repo, base)?;
    let local = if stage_project(git, project, repo, true)? {
        commit(git, repo, "Changes from Oleafly")?
    } else {
        base.to_string()
    };
    if remote == base && local == base {
        return Ok(Integration::UpToDate);
    }
    if remote == base {
        if !apply {
            reset_to(git, repo, base)?;
        }
        return Ok(Integration::Merged {
            merged: local,
            push: true,
            written: Vec::new(),
            removed: Vec::new(),
        });
    }
    if local == base {
        reset_to(git, repo, remote)?;
        let (written, removed) = changed_paths(git, repo, base, remote)?;
        let (written, removed) = write_back(project, repo, &written, &removed, apply)?;
        if !apply {
            reset_to(git, repo, base)?;
        }
        return Ok(Integration::Merged {
            merged: remote.to_string(),
            push: false,
            written,
            removed,
        });
    }
    let merge = git.run(
        repo,
        &["merge", "--no-ff", "--no-edit", "-m", MERGE_MESSAGE, remote],
    )?;
    if !merge.status.success() {
        let conflicts = conflicted_paths(git, repo)?;
        if conflicts.is_empty() {
            let _ = git.run(repo, &["merge", "--abort"]);
            reset_to(git, repo, base)?;
            return Err(OnlineError::new(OnlineErrorKind::SyncFailed)
                .detail(first_line(&git.failure_text(&merge))));
        }
        let unresolved: Vec<String> = conflicts
            .iter()
            .filter(|path| !resolutions.contains_key(*path))
            .cloned()
            .collect();
        if !unresolved.is_empty() {
            let _ = git.run(repo, &["merge", "--abort"]);
            reset_to(git, repo, base)?;
            return Ok(Integration::Conflicts(
                unresolved.into_iter().take(MAX_LISTED).collect(),
            ));
        }
        for path in &conflicts {
            resolve(git, repo, path, resolutions[path])?;
        }
        if !conflicted_paths(git, repo)?.is_empty() {
            let _ = git.run(repo, &["merge", "--abort"]);
            reset_to(git, repo, base)?;
            return Err(OnlineError::new(OnlineErrorKind::SyncFailed));
        }
        git_ok(
            git,
            repo,
            &["commit", "--quiet", "--no-verify", "--no-edit"],
        )?;
    }
    let merged =
        rev(git, repo, "HEAD").ok_or_else(|| OnlineError::io("the sync copy has no commit"))?;
    let (written, removed) = changed_paths(git, repo, &local, &merged)?;
    let (written, removed) = write_back(project, repo, &written, &removed, apply)?;
    if !apply {
        reset_to(git, repo, base)?;
    }
    Ok(Integration::Merged {
        merged,
        push: true,
        written,
        removed,
    })
}

pub fn link_local(
    git: &dyn MirrorGit,
    project: &Path,
    repo: &Path,
    remote: &str,
    prefer: Option<Side>,
    mode: Mode,
) -> Result<LinkOutcome, OnlineError> {
    let apply = mode == Mode::Apply;
    let remote_paths = tree_files(git, repo, remote)?;
    check_remote_paths(&remote_paths)?;
    reset_to(git, repo, remote)?;
    let local = project_files(project)?;
    let mut differing = Vec::new();
    for (rel, source) in &local {
        let mirrored = repo.join(rel);
        if !mirrored.is_file() {
            continue;
        }
        let ours = std::fs::read(source)?;
        let theirs = std::fs::read(&mirrored)?;
        if ours != theirs {
            differing.push(rel.clone());
        }
    }
    if !differing.is_empty() && prefer.is_none() {
        return Ok(LinkOutcome::NeedsChoice(
            differing.into_iter().take(MAX_LISTED).collect(),
        ));
    }
    if apply && prefer == Some(Side::Remote) && !differing.is_empty() {
        for (rel, source) in &local {
            copy_into(source, &repo.join(rel))?;
        }
        git_ok(git, repo, &["add", "--all", "--force", "--", "."])?;
        if !git
            .run(repo, &["diff", "--cached", "--quiet"])?
            .status
            .success()
        {
            let backup = commit(git, repo, "Oleafly copy before linking")?;
            let name = format!("refs/oleafly/before-link-{}", now_seconds());
            git_ok(git, repo, &["update-ref", &name, &backup])?;
        }
        reset_to(git, repo, remote)?;
    }
    let mut to_write: Vec<String> = remote_paths
        .iter()
        .filter(|rel| !excluded(rel) && !local.contains_key(*rel))
        .cloned()
        .collect();
    if prefer == Some(Side::Remote) {
        to_write.extend(differing.iter().cloned());
    }
    let (written, _) = write_back(project, repo, &to_write, &[], apply)?;
    if apply {
        set_base(git, repo, remote)?;
    }
    Ok(LinkOutcome::Linked { written })
}

// CLI-level operations. The caller holds the sync claim.

/// The app's per-project worktree lock, held while files are written.
#[derive(Clone, Debug)]
pub struct WorktreeLock {
    pub path: PathBuf,
    pub budget: Duration,
}

impl WorktreeLock {
    pub fn new(path: PathBuf) -> WorktreeLock {
        WorktreeLock {
            path,
            budget: oleafly_core::locking::STORAGE_LOCK_TIMEOUT,
        }
    }
}

fn hold_worktree(
    lock: Option<&WorktreeLock>,
    exclusive: bool,
) -> Result<Option<File>, OnlineError> {
    let Some(lock) = lock else {
        return Ok(None);
    };
    if let Some(parent) = lock.path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&lock.path)?;
    oleafly_core::locking::lock_file(&file, exclusive, lock.budget)
        .map_err(|_| OnlineError::new(OnlineErrorKind::WorktreeBusy))?;
    Ok(Some(file))
}

pub struct SyncOptions {
    pub resolutions: BTreeMap<String, Side>,
    pub mode: Mode,
    pub push: bool,
    pub worktree: Option<WorktreeLock>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SyncOutcome {
    UpToDate,
    Synced,
    Pulled,
    LocalOnly,
    Planned,
    Conflicts,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSummary {
    pub outcome: SyncOutcome,
    pub conflicts: Vec<String>,
    pub written: Vec<String>,
    pub removed: Vec<String>,
    pub pushed: bool,
}

impl SyncSummary {
    fn of(outcome: SyncOutcome) -> SyncSummary {
        SyncSummary {
            outcome,
            conflicts: Vec::new(),
            written: Vec::new(),
            removed: Vec::new(),
            pushed: false,
        }
    }
}

/// Fetches, merges, writes back and pushes, retrying when the remote moves
/// on during the push.
pub fn sync_project(
    git: &dyn MirrorGit,
    paths: &SyncPaths,
    project: &Path,
    url: &str,
    token: &str,
    options: &SyncOptions,
) -> Result<SyncSummary, OnlineError> {
    let link = read_link(paths)?.ok_or_else(|| OnlineError::new(OnlineErrorKind::SyncNotLinked))?;
    let repo = &paths.repo;
    clear_stale_lock(repo);
    ensure_repo(git, repo)?;
    // A huge folder fails before any network call.
    project_files(project)?;
    let mut base = rev(git, repo, BASE_REF)
        .ok_or_else(|| OnlineError::new(OnlineErrorKind::SyncNeedsRelink))?;
    let mut summary = None;
    for _ in 0..3 {
        let remote = fetch(git, repo, url, token)?;
        let integration = {
            let _held = hold_worktree(options.worktree.as_ref(), true)?;
            integrate(
                git,
                project,
                repo,
                &base,
                &remote,
                &options.resolutions,
                options.mode,
            )?
        };
        match integration {
            Integration::UpToDate => {
                summary = Some(SyncSummary::of(SyncOutcome::UpToDate));
                break;
            }
            Integration::Conflicts(files) => {
                let mut result = SyncSummary::of(SyncOutcome::Conflicts);
                result.conflicts = files;
                return Ok(result);
            }
            Integration::Merged {
                written, removed, ..
            } if options.mode == Mode::Plan => {
                reset_to(git, repo, &base)?;
                let mut result = SyncSummary::of(SyncOutcome::Planned);
                result.written = written;
                result.removed = removed;
                return Ok(result);
            }
            Integration::Merged {
                merged,
                push: wants_push,
                written,
                removed,
            } => {
                let needs_push = wants_push && merged != remote;
                let changed_here = !(written.is_empty() && removed.is_empty());
                if !needs_push {
                    set_base(git, repo, &remote)?;
                    let mut result = SyncSummary::of(if changed_here {
                        SyncOutcome::Pulled
                    } else {
                        SyncOutcome::UpToDate
                    });
                    result.written = written;
                    result.removed = removed;
                    summary = Some(result);
                    break;
                }
                if !options.push {
                    set_base(git, repo, &remote)?;
                    let mut result = SyncSummary::of(if changed_here {
                        SyncOutcome::Pulled
                    } else {
                        SyncOutcome::LocalOnly
                    });
                    result.written = written;
                    result.removed = removed;
                    summary = Some(result);
                    break;
                }
                match push(git, repo, url, token, &merged)? {
                    PushResult::Pushed => {
                        set_base(git, repo, &merged)?;
                        let mut result = SyncSummary::of(SyncOutcome::Synced);
                        result.written = written;
                        result.removed = removed;
                        result.pushed = true;
                        summary = Some(result);
                        break;
                    }
                    PushResult::Rejected => {
                        set_base(git, repo, &remote)?;
                        base = remote;
                    }
                }
            }
        }
    }
    let summary = summary.ok_or_else(|| OnlineError::new(OnlineErrorKind::SyncKeptChanging))?;
    if options.mode == Mode::Apply {
        write_link(
            paths,
            &SyncLink {
                last_sync_at: Some(now_seconds()),
                ..link
            },
        )?;
    }
    Ok(summary)
}

/// Links a project to an online project: fetches it and, when the two
/// agree (or `prefer` says which side wins), writes the remote files here.
#[allow(clippy::too_many_arguments)]
pub fn link_project(
    git: &dyn MirrorGit,
    paths: &SyncPaths,
    project: &Path,
    server: &str,
    remote_id: &str,
    url: &str,
    token: &str,
    prefer: Option<Side>,
    mode: Mode,
    worktree: Option<&WorktreeLock>,
    auto: bool,
) -> Result<LinkOutcome, OnlineError> {
    // Linking again to the same project keeps the old record until the new
    // link succeeds.
    if let Some(existing) = read_link(paths)? {
        if existing.server != server || existing.remote_id != remote_id {
            return Err(OnlineError::new(OnlineErrorKind::SyncAlreadyLinked));
        }
    }
    let repo = &paths.repo;
    clear_stale_lock(repo);
    ensure_repo(git, repo)?;
    let remote = fetch(git, repo, url, token)?;
    let outcome = {
        let _held = hold_worktree(worktree, true)?;
        link_local(git, project, repo, &remote, prefer, mode)?
    };
    if mode == Mode::Apply && matches!(outcome, LinkOutcome::Linked { .. }) {
        let now = now_seconds();
        write_link(
            paths,
            &SyncLink {
                server: server.to_string(),
                remote_id: remote_id.to_string(),
                linked_at: now,
                auto,
                last_sync_at: Some(now),
            },
        )?;
        if paths.is_folder_scope() {
            let ignore = paths.dir.join(".gitignore");
            if !ignore.exists() {
                std::fs::write(&ignore, "*\n")?;
            }
        }
    }
    Ok(outcome)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Added,
    Removed,
    Modified,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FileChange {
    pub path: String,
    pub change: ChangeKind,
}

pub struct DiffOptions {
    pub fetch: bool,
    pub patch: bool,
    pub max_patch_bytes: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSummary {
    pub remote: String,
    pub base: Option<String>,
    pub changes: Vec<FileChange>,
    pub conflicts: Vec<String>,
    pub patch: Option<String>,
    pub truncated: bool,
}

/// What differs between this project and the online project, and which
/// files changed on both sides since the last sync. The mirror is left at
/// the base.
pub fn diff_project(
    git: &dyn MirrorGit,
    paths: &SyncPaths,
    project: &Path,
    url: &str,
    token: &str,
    options: &DiffOptions,
    worktree: Option<&WorktreeLock>,
) -> Result<DiffSummary, OnlineError> {
    let repo = &paths.repo;
    clear_stale_lock(repo);
    ensure_repo(git, repo)?;
    let remote = if options.fetch {
        fetch(git, repo, url, token)?
    } else {
        remote_tip(git, repo).ok_or_else(|| OnlineError::new(OnlineErrorKind::SyncNeedsRelink))?
    };
    let base = rev(git, repo, BASE_REF);
    let _held = hold_worktree(worktree, false)?;
    let local_changed: BTreeSet<String> = match &base {
        Some(base) => {
            reset_to(git, repo, base)?;
            stage_project(git, project, repo, true)?;
            git_lines(git, repo, &["diff", "--cached", "--name-only", "-z"])?
                .into_iter()
                .collect()
        }
        None => BTreeSet::new(),
    };
    let remote_changed: BTreeSet<String> = match &base {
        Some(base) => {
            let (written, removed) = changed_paths(git, repo, base, &remote)?;
            written.into_iter().chain(removed).collect()
        }
        None => BTreeSet::new(),
    };
    let conflicts: Vec<String> = local_changed
        .intersection(&remote_changed)
        .cloned()
        .collect();
    reset_to(git, repo, &remote)?;
    stage_project(git, project, repo, true)?;
    let entries = git_lines(
        git,
        repo,
        &["diff", "--cached", "--name-status", "--no-renames", "-z"],
    )?;
    let mut changes = Vec::new();
    let mut iter = entries.into_iter();
    while let Some(status) = iter.next() {
        let Some(path) = iter.next() else {
            break;
        };
        // Staged project over the remote: "A" exists only here, "D" only
        // there.
        let change = match status.chars().next() {
            Some('A') => ChangeKind::Added,
            Some('D') => ChangeKind::Removed,
            _ => ChangeKind::Modified,
        };
        changes.push(FileChange { path, change });
    }
    let (patch, truncated) = if options.patch {
        let output = git.run(repo, &["diff", "--cached", "--no-color", "--no-ext-diff"])?;
        let text = String::from_utf8_lossy(&output.stdout).into_owned();
        if text.len() > options.max_patch_bytes {
            let mut end = options.max_patch_bytes;
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            let cut = text[..end].rfind('\n').map_or(end, |at| at + 1);
            (Some(text[..cut].to_string()), true)
        } else {
            (Some(text), false)
        }
    } else {
        (None, false)
    };
    reset_to(git, repo, base.as_deref().unwrap_or(&remote))?;
    Ok(DiffSummary {
        remote,
        base,
        changes,
        conflicts,
        patch,
        truncated,
    })
}

/// Puts the mirror's worktree at the remote tip (for `latexdiff`).
pub fn checkout_remote(git: &dyn MirrorGit, paths: &SyncPaths) -> Result<PathBuf, OnlineError> {
    let remote = remote_tip(git, &paths.repo)
        .ok_or_else(|| OnlineError::new(OnlineErrorKind::SyncNeedsRelink))?;
    reset_to(git, &paths.repo, &remote)?;
    Ok(paths.repo.clone())
}

/// Puts the mirror's worktree back at the last synced version after
/// [`checkout_remote`].
pub fn restore_base(git: &dyn MirrorGit, paths: &SyncPaths) -> Result<(), OnlineError> {
    let target = rev(git, &paths.repo, BASE_REF)
        .or_else(|| remote_tip(git, &paths.repo))
        .ok_or_else(|| OnlineError::new(OnlineErrorKind::SyncNeedsRelink))?;
    reset_to(git, &paths.repo, &target)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    pub remote_changed: bool,
    pub local_changed: bool,
}

/// Whether either side changed since the last sync, without merging.
pub fn probe(
    git: &dyn MirrorGit,
    paths: &SyncPaths,
    project: &Path,
    url: &str,
    token: &str,
    worktree: Option<&WorktreeLock>,
) -> Result<Probe, OnlineError> {
    let repo = &paths.repo;
    clear_stale_lock(repo);
    ensure_repo(git, repo)?;
    let base = rev(git, repo, BASE_REF)
        .ok_or_else(|| OnlineError::new(OnlineErrorKind::SyncNeedsRelink))?;
    let remote = fetch(git, repo, url, token)?;
    let local_changed = {
        let _held = hold_worktree(worktree, false)?;
        commit_local(git, project, repo, &base)?.is_some()
    };
    reset_to(git, repo, &base)?;
    Ok(Probe {
        remote_changed: remote != base,
        local_changed,
    })
}

#[cfg(test)]
mod tests;
