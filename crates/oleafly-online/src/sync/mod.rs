//! Two-way sync through a private Git mirror of the online project. The
//! mirror keeps a base commit (the last state both sides agreed on); local
//! edits are committed on top of it and merged with the remote tip, and the
//! result is written back here and pushed there.
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs::File;
use std::path::{Component, Path, PathBuf};
use std::process::Output;
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
/// Options that pin every Git call to the mirror's own repository. Without
/// them Git skips a damaged `.git` and works on a repository further up (the
/// user's own, for a folder-scope mirror), where `checkout --force` would
/// rewrite their files. The paths are relative to the mirror, where Git runs.
const MIRROR_PIN: [&str; 3] = ["--git-dir=.git", "--work-tree=.", "--no-replace-objects"];
/// How long a claim waits for another holder of the lock file before calling
/// the project busy. A sync that just ended can leave the lock held for a
/// moment: a process another thread is starting keeps a copy of the
/// descriptor until it execs. A sync that is really running holds it far
/// longer.
const CLAIM_PATIENCE: Duration = Duration::from_millis(250);

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

    /// Refuses a mirror location that goes through a link. A folder that
    /// arrives from elsewhere (an archive, a copy) can carry `.oleafly` as a
    /// link, and Git would then work in whatever it points at.
    fn check_location(&self) -> Result<(), OnlineError> {
        let mut places = Vec::new();
        if self.is_folder_scope() {
            places.extend(self.dir.parent());
        }
        places.push(&self.dir);
        places.push(&self.repo);
        for place in places {
            if std::fs::symlink_metadata(place).is_ok_and(|found| found.file_type().is_symlink()) {
                return Err(OnlineError::new(OnlineErrorKind::SyncNeedsRelink)
                    .detail(format!("{} is a link", place.display())));
            }
        }
        Ok(())
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
    paths.check_location()?;
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
    match oleafly_core::locking::lock_file(&file, true, CLAIM_PATIENCE) {
        Ok(()) => Ok(SyncClaim { key, _file: file }),
        Err(error) => {
            release();
            // Only a lock someone else keeps holding means busy. A file system
            // that refuses locks would otherwise say "busy" forever.
            if error.kind() == std::io::ErrorKind::TimedOut {
                Err(OnlineError::new(OnlineErrorKind::SyncBusy))
            } else {
                Err(OnlineError::io(format!(
                    "could not take the sync lock: {error}"
                )))
            }
        }
    }
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
    // A link record read from a folder is not checked when it is read; the
    // token goes wherever this address points.
    if !crate::session::is_secure_server(server) {
        return Err(OnlineError::new(OnlineErrorKind::InvalidServer).param("server", server));
    }
    Ok(format!("{server}/git/{remote_id}"))
}

pub fn credential_origin(url: &str) -> String {
    url::Url::parse(url)
        .map(|parsed| parsed.origin().ascii_serialization())
        .unwrap_or_default()
}

fn pinned<'a>(args: &[&'a str]) -> Vec<&'a str> {
    let mut full = MIRROR_PIN.to_vec();
    full.extend_from_slice(args);
    full
}

/// `git args` in the mirror, pinned to the mirror's own repository.
fn mirror_run(git: &dyn MirrorGit, repo: &Path, args: &[&str]) -> Result<Output, OnlineError> {
    git.run(repo, &pinned(args))
}

fn mirror_run_remote(
    git: &dyn MirrorGit,
    repo: &Path,
    credential_origin: &str,
    token: &str,
    args: &[&str],
) -> Result<Output, OnlineError> {
    git.run_remote(repo, credential_origin, token, &pinned(args))
}

fn git_ok(git: &dyn MirrorGit, repo: &Path, args: &[&str]) -> Result<String, OnlineError> {
    let output = mirror_run(git, repo, args)?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(OnlineError::io(git.failure_text(&output)))
    }
}

fn git_lines(git: &dyn MirrorGit, repo: &Path, args: &[&str]) -> Result<Vec<String>, OnlineError> {
    let output = mirror_run(git, repo, args)?;
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
    mirror_run(git, repo, &["rev-parse", "--verify", "--quiet", &commit])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|sha| !sha.is_empty())
}

/// The repository-format settings a mirror's `.git/config` keeps, read from
/// text that may have been planted. Only these keys count, and only values of
/// the expected shape; nothing else is carried over.
#[derive(Debug, Default, PartialEq, Eq)]
struct FormatSettings {
    version: Option<&'static str>,
    ignore_case: Option<bool>,
    ref_storage: Option<&'static str>,
    object_format: Option<&'static str>,
}

fn format_settings(config: &str) -> FormatSettings {
    let mut found = FormatSettings::default();
    let mut section = String::new();
    for line in config.lines() {
        let line = line.trim();
        if let Some(header) = line.strip_prefix('[') {
            section = header
                .split(']')
                .next()
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase();
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let (key, value) = (
            key.trim().to_ascii_lowercase(),
            value.trim().to_ascii_lowercase(),
        );
        match (section.as_str(), key.as_str(), value.as_str()) {
            ("core", "repositoryformatversion", "0") => found.version = Some("0"),
            ("core", "repositoryformatversion", "1") => found.version = Some("1"),
            ("core", "ignorecase", "true") => found.ignore_case = Some(true),
            ("core", "ignorecase", "false") => found.ignore_case = Some(false),
            ("extensions", "refstorage", "files") => found.ref_storage = Some("files"),
            ("extensions", "refstorage", "reftable") => found.ref_storage = Some("reftable"),
            ("extensions", "objectformat", "sha1") => found.object_format = Some("sha1"),
            ("extensions", "objectformat", "sha256") => found.object_format = Some("sha256"),
            _ => {}
        }
    }
    found
}

/// The `.git/config` every mirror gets. Git reads that file as trusted, and a
/// mirror inside a folder can arrive with one that names a merge driver, a
/// proxy or a credential helper, so it is rewritten from this text before
/// each use. Everything else a call needs comes from `-c` options.
fn mirror_config_text(old: &str, case_insensitive: bool) -> String {
    let settings = format_settings(old);
    let version = settings.version.unwrap_or("0");
    let ignore_case = settings.ignore_case.unwrap_or(case_insensitive);
    let mut text = format!(
        "[core]\n\trepositoryformatversion = {version}\n\tfilemode = false\n\tbare = false\n\tignorecase = {ignore_case}\n"
    );
    let extensions: Vec<String> = [
        ("refstorage", settings.ref_storage),
        ("objectformat", settings.object_format),
    ]
    .into_iter()
    .filter_map(|(key, value)| Some(format!("\t{key} = {}\n", value?)))
    .collect();
    if version == "1" && !extensions.is_empty() {
        text.push_str("[extensions]\n");
        text.extend(extensions);
    }
    text
}

/// Replaces whatever is at `path` (a link, a folder) with a file holding
/// `bytes`, unless that file already holds them.
fn replace_with_file(path: &Path, bytes: &[u8]) -> Result<(), OnlineError> {
    match std::fs::symlink_metadata(path) {
        Ok(found) if found.is_file() => {
            if std::fs::read(path).is_ok_and(|existing| existing == bytes) {
                return Ok(());
            }
        }
        Ok(found) if found.is_dir() => std::fs::remove_dir_all(path)?,
        Ok(_) => std::fs::remove_file(path).or_else(|_| std::fs::remove_dir(path))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    oleafly_secrets::fs::write_atomic(path, bytes).map_err(OnlineError::io)
}

/// A real folder at `path`, replacing a link or a file that sits there.
fn ensure_real_folder(path: &Path) -> Result<(), OnlineError> {
    match std::fs::symlink_metadata(path) {
        Ok(found) if found.is_dir() => return Ok(()),
        Ok(_) => {
            std::fs::remove_file(path).or_else(|_| std::fs::remove_dir(path))?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    std::fs::create_dir_all(path)?;
    Ok(())
}

/// Puts the mirror's own `.git` files back to what Oleafly expects: the
/// template config, no pointer to another repository's files, and the
/// attributes that keep file bytes as they are.
fn harden_git_dir(git_dir: &Path) -> Result<(), OnlineError> {
    let config = git_dir.join("config");
    let old = std::fs::read_to_string(&config).unwrap_or_default();
    // Git's own probe for a case-insensitive file system.
    let case_insensitive = config.is_file() && git_dir.join("CoNfIg").is_file();
    replace_with_file(
        &config,
        mirror_config_text(&old, case_insensitive).as_bytes(),
    )?;
    for stray in [
        "commondir",
        "config.worktree",
        "objects/info/alternates",
        "objects/info/http-alternates",
    ] {
        // Missing is the usual case; a folder of that name points nowhere.
        let _ = std::fs::remove_file(git_dir.join(stray));
    }
    let info = git_dir.join("info");
    ensure_real_folder(&info)?;
    replace_with_file(&info.join("attributes"), MIRROR_ATTRIBUTES.as_bytes())
}

fn damaged_mirror(detail: impl ToString) -> OnlineError {
    OnlineError::new(OnlineErrorKind::SyncNeedsRelink).detail(detail)
}

pub fn ensure_repo(git: &dyn MirrorGit, repo: &Path) -> Result<(), OnlineError> {
    let git_dir = repo.join(".git");
    if std::fs::symlink_metadata(repo).is_ok_and(|found| found.file_type().is_symlink()) {
        return Err(damaged_mirror("the sync copy is a link"));
    }
    let existed = match std::fs::symlink_metadata(&git_dir) {
        Ok(found) if found.is_dir() => true,
        Ok(_) => return Err(damaged_mirror("the sync copy's .git is not a folder")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(error.into()),
    };
    if existed {
        harden_git_dir(&git_dir)?;
    }
    if !existed || !git_dir.join("HEAD").is_file() {
        std::fs::create_dir_all(repo)
            .map_err(|error| OnlineError::io(format!("could not create the sync copy: {error}")))?;
        // `init` is the one call that must not be pinned: there is no
        // repository yet.
        let output = git.run(repo, &["init", "--quiet"])?;
        if !output.status.success() {
            return Err(OnlineError::io(git.failure_text(&output)));
        }
        harden_git_dir(&git_dir)?;
    }
    // A damaged mirror must fail here, before any call that rewrites files.
    let output = mirror_run(git, repo, &["rev-parse", "--git-dir"])?;
    if !output.status.success() {
        let text = git.failure_text(&output);
        return Err(if text.contains("not a git repository") {
            damaged_mirror(first_line(&text))
        } else {
            OnlineError::io(text)
        });
    }
    Ok(())
}

pub fn clear_stale_lock(repo: &Path) {
    let lock = repo.join(".git").join("index.lock");
    if lock.is_file() {
        let _ = std::fs::remove_file(lock);
    }
}

/// `text` with each address replaced by `<address>`, so a project id or a
/// port inside one never reads as a status code.
fn without_addresses(text: &str) -> String {
    let mut clean = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find("://") {
        let head = &rest[..at];
        let scheme = head
            .rfind(|character: char| {
                !(character.is_ascii_alphanumeric() || matches!(character, '+' | '-' | '.'))
            })
            .map_or(0, |index| index + 1);
        clean.push_str(&head[..scheme]);
        clean.push_str("<address>");
        let after = &rest[at + 3..];
        let end = after
            .find(|character: char| {
                character.is_whitespace() || matches!(character, '\'' | '"' | '<' | '>')
            })
            .unwrap_or(after.len());
        rest = &after[end..];
    }
    clean.push_str(rest);
    clean
}

/// Whether `lower` reports HTTP status `code` ("error: 403", "http 403"),
/// and not a longer number that starts with it.
fn reports_status(lower: &str, code: &str) -> bool {
    ["error: ", "http ", "http/1.1 ", "http/2 ", "status "]
        .iter()
        .any(|lead| {
            let marker = format!("{lead}{code}");
            lower.match_indices(&marker).any(|(at, _)| {
                !lower[at + marker.len()..].starts_with(|next: char| next.is_ascii_digit())
            })
        })
}

pub fn classify_remote_failure(text: &str) -> OnlineError {
    let lower = without_addresses(text).to_ascii_lowercase();
    let says = |markers: &[&str]| markers.iter().any(|marker| lower.contains(marker));
    if says(&[
        "authentication failed",
        "invalid username or password",
        "access denied",
    ]) || reports_status(&lower, "401")
        || reports_status(&lower, "403")
    {
        return OnlineError::new(OnlineErrorKind::GitTokenRejected);
    }
    if says(&[
        "not found",
        "does not appear to be a git repository",
        "repository not found",
    ]) || reports_status(&lower, "404")
    {
        return OnlineError::new(OnlineErrorKind::GitUnavailable);
    }
    if says(&[
        "could not resolve host",
        "failed to connect",
        "timed out",
        "connection refused",
        "network is unreachable",
        "unable to access",
        "connection reset",
    ]) {
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
    let output = mirror_run_remote(
        git,
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
    let output = mirror_run_remote(
        git,
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

/// How often a mirror is tidied at most.
const MAINTENANCE_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
/// When the mirror was last tidied, by its modification time.
const MAINTENANCE_STAMP: &str = "oleafly-maintenance";
/// What `git gc --auto` runs for here. Every other mirror call passes
/// `gc.auto=0`, so this is the only place objects are ever packed, and a
/// sync adds a full copy of each changed file.
const MAINTENANCE: [&str; 12] = [
    "-c",
    "gc.auto=256",
    "-c",
    "gc.autoPackLimit=8",
    "-c",
    "gc.autoDetach=false",
    "-c",
    "maintenance.autoDetach=false",
    "gc",
    "--auto",
    "--prune=now",
    "--quiet",
];

/// Packs the mirror's objects and drops the ones nothing refers to, at most
/// once a day. Call it after a sync that worked, with the sync claim held.
/// Best effort: a failure only means the mirror stays as large as it is.
pub fn maintain(git: &dyn MirrorGit, repo: &Path) {
    let stamp = repo.join(".git").join(MAINTENANCE_STAMP);
    let recent = std::fs::symlink_metadata(&stamp)
        .and_then(|found| found.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .is_some_and(|age| age < MAINTENANCE_INTERVAL);
    // Stamped first, so a gc that keeps failing isn't tried on every sync.
    if recent || oleafly_secrets::fs::write_atomic(&stamp, b"").is_err() {
        return;
    }
    let _ = mirror_run(git, repo, &MAINTENANCE);
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
    // Oleafly's own staging files, editor temp files, `._` copies and cloud
    // conflict copies are never part of the project.
    rel.split('/').any(|part| {
        IGNORED_NAMES.contains(&part.to_ascii_lowercase().as_str())
            || oleafly_core::exclude::is_quietly_ignored_name(part)
    })
}

/// Whose files a sync carries. A folder outside the app's library (the CLI's
/// folder and linked scopes) keeps its mirror inside itself, at
/// `<folder>/.oleafly/online/repo`. Such a folder is often a whole working
/// folder, so more of it stays here: see [`kept_local`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Scope {
    Library,
    Folder,
}

impl Scope {
    fn of(project: &Path, repo: &Path) -> Scope {
        if repo.starts_with(project) {
            Scope::Folder
        } else {
            Scope::Library
        }
    }

    /// Whether `rel` stays out of the sync: never sent online, never
    /// written here from online, and never deleted online for being missing
    /// here.
    fn skips(self, project: &Path, rel: &str) -> bool {
        excluded(rel)
            || (self == Scope::Folder && kept_local(rel, |sibling| project.join(sibling).is_file()))
    }
}

/// A file name that holds secrets: `.env` files, `.private`, private keys
/// and certificate bundles. A public SSH key (`.pub`) is not one.
fn private_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with(".env")
        || lower == ".private"
        || [".pem", ".p12", ".pfx"]
            .iter()
            .any(|extension| lower.ends_with(extension))
        || (["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"]
            .iter()
            .any(|key| lower.starts_with(key))
            && !lower.ends_with(".pub"))
}

/// Whether a folder's file stays here: anything under a dot-folder (or a
/// dependency or build folder, as a linked folder skips them), `.env` files,
/// `.private`, private keys, and TeX build output such as `main.aux`, or
/// `main.pdf` beside `main.tex`. `has_sibling` says whether a project path
/// exists here.
pub fn kept_local(rel: &str, has_sibling: impl Fn(&str) -> bool) -> bool {
    let mut parts: Vec<&str> = rel.split('/').collect();
    let Some(name) = parts.pop() else {
        return false;
    };
    parts
        .iter()
        .any(|folder| oleafly_core::exclude::is_linked_skipped_directory(folder))
        || private_name(name)
        || oleafly_core::exclude::is_build_artifact(rel, has_sibling)
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

/// Every synced file of a library project, by relative path.
pub fn project_files(root: &Path) -> Result<BTreeMap<String, PathBuf>, OnlineError> {
    files_in(root, Scope::Library)
}

/// Every file of `root` that `scope` syncs, by relative path. A folder's
/// skipped folders are never entered.
fn files_in(root: &Path, scope: Scope) -> Result<BTreeMap<String, PathBuf>, OnlineError> {
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
                if scope == Scope::Folder
                    && oleafly_core::exclude::is_linked_skipped_directory(&name)
                {
                    continue;
                }
                stack.push((entry.path(), rel));
            } else if metadata.is_file() {
                if scope.skips(root, &rel) {
                    continue;
                }
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

/// A file's size and SHA-256, to tell later whether it changed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Fingerprint {
    len: u64,
    digest: [u8; 32],
}

fn fingerprint(bytes: &[u8]) -> Fingerprint {
    let digest = ring::digest::digest(&ring::digest::SHA256, bytes);
    let mut hash = [0u8; 32];
    hash.copy_from_slice(digest.as_ref());
    Fingerprint {
        len: bytes.len() as u64,
        digest: hash,
    }
}

/// What each project file held when the sync read it.
type Snapshot = BTreeMap<String, Fingerprint>;

/// Copies `source` over `destination`; true when that changed it. Also
/// returns what `source` held.
fn copy_into(source: &Path, destination: &Path) -> Result<(bool, Fingerprint), OnlineError> {
    let bytes = std::fs::read(source).map_err(|error| {
        OnlineError::io(format!("could not read {}: {error}", source.display()))
    })?;
    let read = fingerprint(&bytes);
    if std::fs::read(destination).is_ok_and(|existing| existing == bytes) {
        return Ok((false, read));
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
    Ok((true, read))
}

/// Whether a link sits on the way to `rel` in `project`, at the file or in a
/// folder above it. Oleafly neither reads nor writes through links.
fn link_on_path(project: &Path, rel: &str) -> bool {
    let mut current = project.to_path_buf();
    for part in rel.split('/') {
        current.push(part);
        match std::fs::symlink_metadata(&current) {
            Ok(found) if found.file_type().is_symlink() => return true,
            Ok(_) => {}
            Err(_) => return false,
        }
    }
    false
}

fn sync_stopped(detail: impl ToString) -> OnlineError {
    OnlineError::new(OnlineErrorKind::SyncFailed).detail(detail)
}

/// The project's files as staged in the mirror.
struct Staged {
    /// The mirror differs from its last commit.
    changed: bool,
    /// What each file held when it was copied.
    seen: Snapshot,
}

fn stage_project(
    git: &dyn MirrorGit,
    project: &Path,
    repo: &Path,
    remove_missing: bool,
) -> Result<Staged, OnlineError> {
    let scope = Scope::of(project, repo);
    let files = files_in(project, scope)?;
    if remove_missing {
        let missing: Vec<String> = tracked_files(git, repo)?
            .into_iter()
            .filter(|rel| !scope.skips(project, rel) && !files.contains_key(rel))
            .collect();
        // A file swapped for a link is not a deletion to send online.
        if let Some(rel) = missing.iter().find(|rel| link_on_path(project, rel)) {
            return Err(sync_stopped(format!(
                "{rel} is a link now, and Oleafly doesn't sync links. Replace the link with the file itself, then sync again."
            )));
        }
        for rel in missing {
            let path = repo.join(&rel);
            if std::fs::symlink_metadata(&path).is_ok() {
                std::fs::remove_file(&path)?;
            }
        }
    }
    let mut seen = Snapshot::new();
    for (rel, source) in &files {
        let (_, read) = copy_into(source, &repo.join(rel))?;
        seen.insert(rel.clone(), read);
    }
    match scope {
        // Every file of a library project syncs, whatever a `.gitignore`
        // in it says.
        Scope::Library => git_ok(git, repo, &["add", "--all", "--force", "--", "."])?,
        // A folder's own `.gitignore` files, copied in with the rest, keep
        // what they name here. The user's global excludes don't count, so
        // what syncs doesn't depend on the computer. Git skips an excludes
        // file that doesn't exist, so a name that never does turns them off
        // (Git for Windows refuses NUL as an excludes file).
        Scope::Folder => {
            let none = repo.join(".git").join("oleafly-no-global-excludes");
            let excludes = format!("core.excludesFile={}", none.display());
            git_ok(git, repo, &["-c", &excludes, "add", "--all", "--", "."])?
        }
    };
    let staged = mirror_run(git, repo, &["diff", "--cached", "--quiet"])?;
    Ok(Staged {
        changed: !staged.status.success(),
        seen,
    })
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

/// The parameter an error carries when a failed sync may still have changed
/// files in the project.
pub const FILES_MAY_HAVE_CHANGED: &str = "filesMayHaveChanged";

/// The changes `write_back` makes in the project, kept so a failure partway
/// can undo them. Replaced and removed files are moved aside first and only
/// deleted once every change has gone through.
struct Journal<'a> {
    project: &'a Path,
    steps: Vec<Step>,
    folders: Vec<PathBuf>,
    sequence: u64,
}

enum Step {
    /// A file was moved to `backup`; with `replaced`, a new file took its
    /// place.
    Moved {
        destination: PathBuf,
        backup: PathBuf,
        replaced: bool,
    },
    /// A new file was put where there was none.
    Added { destination: PathBuf },
}

impl<'a> Journal<'a> {
    fn new(project: &'a Path) -> Self {
        Journal {
            project,
            steps: Vec::new(),
            folders: Vec::new(),
            sequence: 0,
        }
    }

    /// A name beside `destination` for a staged or moved-aside file. Oleafly's
    /// scans skip it (`excluded`).
    fn sidecar(&mut self, destination: &Path) -> PathBuf {
        self.sequence += 1;
        let name = destination
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
            .unwrap_or("file");
        destination.with_file_name(oleafly_secrets::fs::staging_name(
            name,
            self.sequence,
            rand::random(),
        ))
    }

    fn make_folder(&mut self, folder: &Path) -> Result<(), OnlineError> {
        let mut missing = Vec::new();
        let mut current = Some(folder);
        while let Some(dir) = current {
            if dir == self.project || dir.exists() {
                break;
            }
            missing.push(dir.to_path_buf());
            current = dir.parent();
        }
        for dir in missing.into_iter().rev() {
            std::fs::create_dir(&dir).map_err(|error| {
                OnlineError::io(format!("could not create {}: {error}", dir.display()))
            })?;
            self.folders.push(dir);
        }
        Ok(())
    }

    fn remove(&mut self, destination: &Path) -> Result<(), OnlineError> {
        let backup = self.sidecar(destination);
        oleafly_secrets::fs::replace_file(destination, &backup).map_err(|error| {
            OnlineError::io(format!(
                "could not remove {}: {error}",
                destination.display()
            ))
        })?;
        self.steps.push(Step::Moved {
            destination: destination.to_path_buf(),
            backup,
            replaced: false,
        });
        Ok(())
    }

    fn put(&mut self, destination: &Path, source: &Path) -> Result<(), OnlineError> {
        let write_error = |error: std::io::Error| {
            OnlineError::io(format!(
                "could not write {}: {error}",
                destination.display()
            ))
        };
        if let Some(parent) = destination.parent() {
            self.make_folder(parent)?;
        }
        let staging = self.sidecar(destination);
        let existing = std::fs::metadata(destination)
            .ok()
            .filter(std::fs::Metadata::is_file);
        std::fs::copy(source, &staging).map_err(write_error)?;
        if let Some(existing) = &existing {
            let _ = std::fs::set_permissions(&staging, existing.permissions());
        }
        let backup = match existing {
            Some(_) => {
                let backup = self.sidecar(destination);
                if let Err(error) = oleafly_secrets::fs::replace_file(destination, &backup) {
                    let _ = std::fs::remove_file(&staging);
                    return Err(write_error(error));
                }
                Some(backup)
            }
            None => None,
        };
        if let Err(error) = oleafly_secrets::fs::replace_file(&staging, destination) {
            if let Some(backup) = &backup {
                let _ = oleafly_secrets::fs::replace_file(backup, destination);
            }
            let _ = std::fs::remove_file(&staging);
            return Err(write_error(error));
        }
        self.steps.push(match backup {
            Some(backup) => Step::Moved {
                destination: destination.to_path_buf(),
                backup,
                replaced: true,
            },
            None => Step::Added {
                destination: destination.to_path_buf(),
            },
        });
        Ok(())
    }

    /// Every change went through: drop the moved-aside files and the
    /// folders that `removed` files left empty.
    fn finish(self, removed: &[PathBuf]) {
        for step in &self.steps {
            if let Step::Moved { backup, .. } = step {
                let _ = std::fs::remove_file(backup);
            }
        }
        for path in removed {
            prune_empty_parents(self.project, path);
        }
    }

    /// A change failed: put every earlier one back. The failure is returned,
    /// with a note when something could not be put back.
    fn undo(self, failure: OnlineError) -> OnlineError {
        let mut stuck = Vec::new();
        for step in self.steps.into_iter().rev() {
            match step {
                Step::Added { destination } => {
                    let _ = std::fs::remove_file(destination);
                }
                Step::Moved {
                    destination,
                    backup,
                    replaced,
                } => {
                    if replaced {
                        let _ = std::fs::remove_file(&destination);
                    }
                    // Something new at the old place wins; the old file stays
                    // under its backup name.
                    if std::fs::symlink_metadata(&destination).is_ok()
                        || oleafly_secrets::fs::replace_file(&backup, &destination).is_err()
                    {
                        stuck.push(backup);
                    }
                }
            }
        }
        for folder in self.folders.iter().rev() {
            let _ = std::fs::remove_dir(folder);
        }
        if stuck.is_empty() {
            return failure;
        }
        let names: Vec<String> = stuck
            .iter()
            .map(|backup| backup.display().to_string())
            .collect();
        let detail = failure
            .detail
            .clone()
            .map_or(String::new(), |detail| format!("{detail} "));
        // Some files here are not as they were: callers that guard against
        // changes made outside an editor look for this.
        OnlineError::io(format!(
            "{detail}The sync stopped partway and could not put back every file. Your earlier versions are saved as {}.",
            names.join(", ")
        ))
        .param(FILES_MAY_HAVE_CHANGED, "true")
    }
}

/// Whether `path` still holds what the sync read (`seen`), or is still
/// missing when the sync read nothing there.
fn unchanged_since_read(path: &Path, seen: Option<&Fingerprint>) -> Result<bool, OnlineError> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(seen == Some(&fingerprint(&bytes))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(seen.is_none()),
        Err(error) => Err(OnlineError::io(format!(
            "could not read {}: {error}",
            path.display()
        ))),
    }
}

fn changed_while_syncing(files: &[String]) -> OnlineError {
    sync_stopped(format!(
        "{} changed while the sync ran. Nothing was written here. Run the sync again.",
        files.iter().take(5).cloned().collect::<Vec<_>>().join(", ")
    ))
}

/// Writes mirror files back to the project (or, without `apply`, only
/// lists what would change). A file that is no longer what the sync read
/// (`seen`), or any failure, stops the run and leaves the project as it was.
fn write_back(
    project: &Path,
    repo: &Path,
    written: &[String],
    removed: &[String],
    apply: bool,
    seen: &Snapshot,
) -> Result<(Vec<String>, Vec<String>), OnlineError> {
    let mut journal = Journal::new(project);
    match write_back_steps(project, repo, written, removed, apply, seen, &mut journal) {
        Ok((wrote, deleted)) => {
            if apply {
                let removed_paths: Vec<PathBuf> =
                    deleted.iter().map(|rel| project.join(rel)).collect();
                journal.finish(&removed_paths);
            }
            Ok((wrote, deleted))
        }
        Err(failure) => Err(journal.undo(failure)),
    }
}

fn write_back_steps(
    project: &Path,
    repo: &Path,
    written: &[String],
    removed: &[String],
    apply: bool,
    seen: &Snapshot,
    journal: &mut Journal<'_>,
) -> Result<(Vec<String>, Vec<String>), OnlineError> {
    let scope = Scope::of(project, repo);
    let deleted = remove_files(project, scope, removed, apply, seen, journal)?;
    let wrote = write_files(project, repo, scope, written, apply, seen, journal)?;
    Ok((wrote, deleted))
}

/// Deletes the project files the mirror removed (only lists them without
/// `apply`) and returns their paths.
fn remove_files(
    project: &Path,
    scope: Scope,
    removed: &[String],
    apply: bool,
    seen: &Snapshot,
    journal: &mut Journal<'_>,
) -> Result<Vec<String>, OnlineError> {
    let mut deleted = Vec::new();
    for rel in removed {
        if scope.skips(project, rel) || !safe_relative(rel) {
            continue;
        }
        if link_on_path(project, rel) {
            return Err(OnlineError::new(OnlineErrorKind::SyncPathBlocked).param("file", rel));
        }
        let destination = project.join(rel);
        match std::fs::symlink_metadata(&destination) {
            Ok(metadata) if metadata.is_file() => {
                if apply {
                    if !unchanged_since_read(&destination, seen.get(rel))? {
                        return Err(changed_while_syncing(std::slice::from_ref(rel)));
                    }
                    journal.remove(&destination)?;
                }
                deleted.push(rel.clone());
            }
            _ => {}
        }
    }
    Ok(deleted)
}

/// The bytes of a project file, or `None` when it doesn't exist.
fn read_current(destination: &Path) -> Result<Option<Vec<u8>>, OnlineError> {
    match std::fs::read(destination) {
        Ok(current) => Ok(Some(current)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(OnlineError::io(format!(
            "could not read {}: {error}",
            destination.display()
        ))),
    }
}

/// Copies the mirror files that differ into the project (only lists them
/// without `apply`) and returns their paths.
fn write_files(
    project: &Path,
    repo: &Path,
    scope: Scope,
    written: &[String],
    apply: bool,
    seen: &Snapshot,
    journal: &mut Journal<'_>,
) -> Result<Vec<String>, OnlineError> {
    let mut wrote = Vec::new();
    for rel in written {
        if scope.skips(project, rel) || !safe_relative(rel) {
            continue;
        }
        let source = repo.join(rel);
        let metadata = std::fs::symlink_metadata(&source)?;
        if !metadata.is_file() {
            continue;
        }
        let destination = project.join(rel);
        if link_on_path(project, rel)
            || std::fs::symlink_metadata(&destination).is_ok_and(|existing| !existing.is_file())
        {
            return Err(OnlineError::new(OnlineErrorKind::SyncPathBlocked).param("file", rel));
        }
        let bytes = std::fs::read(&source)?;
        let current = read_current(&destination)?;
        if current.as_deref() == Some(bytes.as_slice()) {
            continue;
        }
        if apply {
            let as_read = match &current {
                Some(current) => seen.get(rel) == Some(&fingerprint(current)),
                None => !seen.contains_key(rel),
            };
            if !as_read {
                return Err(changed_while_syncing(std::slice::from_ref(rel)));
            }
            journal.put(&destination, &source)?;
        }
        wrote.push(rel.clone());
    }
    Ok(wrote)
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
    if stage_project(git, project, repo, true)?.changed {
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
    let staged = stage_project(git, project, repo, true)?;
    let local = if staged.changed {
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
        let (written, removed) =
            write_back(project, repo, &written, &removed, apply, &staged.seen)?;
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
    let merge = mirror_run(
        git,
        repo,
        &["merge", "--no-ff", "--no-edit", "-m", MERGE_MESSAGE, remote],
    )?;
    if !merge.status.success() {
        let conflicts = conflicted_paths(git, repo)?;
        if conflicts.is_empty() {
            let _ = mirror_run(git, repo, &["merge", "--abort"]);
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
            let _ = mirror_run(git, repo, &["merge", "--abort"]);
            reset_to(git, repo, base)?;
            return Ok(Integration::Conflicts(
                unresolved.into_iter().take(MAX_LISTED).collect(),
            ));
        }
        for path in &conflicts {
            resolve(git, repo, path, resolutions[path])?;
        }
        if !conflicted_paths(git, repo)?.is_empty() {
            let _ = mirror_run(git, repo, &["merge", "--abort"]);
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
    let (written, removed) = write_back(project, repo, &written, &removed, apply, &staged.seen)?;
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
    let scope = Scope::of(project, repo);
    let local = files_in(project, scope)?;
    let mut differing = Vec::new();
    let mut seen = Snapshot::new();
    for (rel, source) in &local {
        let mirrored = repo.join(rel);
        if !mirrored.is_file() {
            continue;
        }
        let ours = std::fs::read(source)?;
        let theirs = std::fs::read(&mirrored)?;
        seen.insert(rel.clone(), fingerprint(&ours));
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
        if !mirror_run(git, repo, &["diff", "--cached", "--quiet"])?
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
        .filter(|rel| !scope.skips(project, rel) && !local.contains_key(*rel))
        .cloned()
        .collect();
    if prefer == Some(Side::Remote) {
        to_write.extend(differing.iter().cloned());
    }
    let (written, _) = write_back(project, repo, &to_write, &[], apply, &seen)?;
    if apply {
        set_base(git, repo, remote)?;
    }
    Ok(LinkOutcome::Linked { written })
}

const BACKUP_REF_PREFIX: &str = "refs/oleafly/";

/// A copy of local files that linking with the online version winning
/// replaced, saved when `link_local` made it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LinkBackup {
    /// Its folder name, `before-link-<time>`.
    pub name: String,
    /// The files it holds.
    pub files: Vec<String>,
}

/// Whether `path` is a link or a Windows reparse point (a junction),
/// read without following it.
fn is_link(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .is_ok_and(|found| found.file_type().is_symlink() || is_reparse_point(&found))
}

#[cfg(windows)]
fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &std::fs::Metadata) -> bool {
    false
}

fn through_a_link(place: &Path) -> OnlineError {
    OnlineError::io(format!(
        "{} is a link, so Oleafly won't save copies there.",
        place.display()
    ))
}

/// Refuses a destination that goes through a link anywhere below the
/// folder that owns the mirror (the project folder, or the app's data
/// folder). A folder from someone else can carry `.oleafly/online-backups`
/// as a link to anywhere.
fn check_destination(paths: &SyncPaths, destination: &Path) -> Result<(), OnlineError> {
    let owner = paths.dir.parent().and_then(Path::parent);
    let below = owner.and_then(|owner| {
        destination
            .strip_prefix(owner)
            .ok()
            .map(|rest| (owner, rest))
    });
    let mut places = Vec::new();
    match below {
        Some((owner, rest)) => {
            let mut current = owner.to_path_buf();
            for part in rest.components() {
                current.push(part);
                places.push(current.clone());
            }
        }
        None => places.push(destination.to_path_buf()),
    }
    match places.into_iter().find(|place| is_link(place)) {
        Some(place) => Err(through_a_link(&place)),
        None => Ok(()),
    }
}

/// Puts each saved copy of replaced local files in its own folder under
/// `destination`, as plain files. A copy that already has its folder is
/// skipped. Returns the copies that now have a folder, so the caller can say
/// where they are before the mirror (their only other home) goes away.
/// Nothing is written through a link below the folder that owns the mirror.
pub fn export_link_backups(
    git: &dyn MirrorGit,
    paths: &SyncPaths,
    destination: &Path,
) -> Result<Vec<LinkBackup>, OnlineError> {
    let repo = &paths.repo;
    if !repo.join(".git").is_dir() {
        return Ok(Vec::new());
    }
    let mut names: Vec<String> = git_ok(
        git,
        repo,
        &["for-each-ref", "--format=%(refname)", BACKUP_REF_PREFIX],
    )?
    .lines()
    .filter_map(|name| name.strip_prefix(BACKUP_REF_PREFIX))
    .filter(|name| name.starts_with("before-link-") && safe_relative(name) && !name.contains('/'))
    .map(str::to_string)
    .collect();
    names.sort();
    let mut exported = Vec::new();
    for name in names {
        let reference = format!("{BACKUP_REF_PREFIX}{name}");
        let parent = format!("{reference}^");
        let entries = git_lines(
            git,
            repo,
            &[
                "diff",
                "--name-status",
                "--no-renames",
                "-z",
                &parent,
                &reference,
            ],
        )?;
        // Only files the link overwrote; files that were only here were never
        // at risk.
        let mut replaced = Vec::new();
        let mut entries = entries.into_iter();
        while let (Some(status), Some(path)) = (entries.next(), entries.next()) {
            if status.starts_with('M') && safe_relative(&path) && !excluded(&path) {
                replaced.push(path);
            }
        }
        if replaced.is_empty() {
            continue;
        }
        check_destination(paths, destination)?;
        let folder = destination.join(&name);
        if is_link(&folder) {
            return Err(through_a_link(&folder));
        }
        if std::fs::symlink_metadata(&folder).is_err() {
            let partial = destination.join(format!(".{name}.oleafly-export.tmp"));
            let _ = std::fs::remove_dir_all(&partial);
            let written = (|| {
                for path in &replaced {
                    let blob = mirror_run(
                        git,
                        repo,
                        &["cat-file", "blob", &format!("{reference}:{path}")],
                    )?;
                    if !blob.status.success() {
                        return Err(OnlineError::io(git.failure_text(&blob)));
                    }
                    let target = partial.join(path);
                    if let Some(parent) = target.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    std::fs::write(&target, &blob.stdout).map_err(|error| {
                        OnlineError::io(format!("could not write {}: {error}", target.display()))
                    })?;
                }
                std::fs::rename(&partial, &folder).map_err(|error| {
                    OnlineError::io(format!("could not write {}: {error}", folder.display()))
                })
            })();
            if let Err(error) = written {
                let _ = std::fs::remove_dir_all(&partial);
                return Err(error);
            }
        }
        exported.push(LinkBackup {
            name,
            files: replaced,
        });
    }
    Ok(exported)
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
    /// A planned run found local changes it would send online.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub would_push: bool,
}

impl SyncSummary {
    fn of(outcome: SyncOutcome) -> SyncSummary {
        SyncSummary {
            outcome,
            conflicts: Vec::new(),
            written: Vec::new(),
            removed: Vec::new(),
            pushed: false,
            would_push: false,
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
    files_in(project, Scope::of(project, repo))?;
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
                merged,
                push: wants_push,
                written,
                removed,
            } if options.mode == Mode::Plan => {
                reset_to(git, repo, &base)?;
                let mut result = SyncSummary::of(SyncOutcome::Planned);
                result.written = written;
                result.removed = removed;
                result.would_push = wants_push && merged != remote && options.push;
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
        maintain(git, repo);
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
        let output = mirror_run(
            git,
            repo,
            &["diff", "--cached", "--no-color", "--no-ext-diff"],
        )?;
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

/// The files here the next sync would send online: those the online copy
/// last fetched lacks, and with `modified` also those it holds differently
/// (a link that keeps the local versions). For a folder this leaves out what
/// stays here ([`kept_local`]) and what its `.gitignore` names, as the sync
/// does. The mirror is left at its base.
pub fn pending_uploads(
    git: &dyn MirrorGit,
    paths: &SyncPaths,
    project: &Path,
    modified: bool,
    worktree: Option<&WorktreeLock>,
) -> Result<Vec<String>, OnlineError> {
    let repo = &paths.repo;
    clear_stale_lock(repo);
    ensure_repo(git, repo)?;
    let remote =
        remote_tip(git, repo).ok_or_else(|| OnlineError::new(OnlineErrorKind::SyncNeedsRelink))?;
    let base = rev(git, repo, BASE_REF);
    let listed = {
        let _held = hold_worktree(worktree, false)?;
        (|| {
            reset_to(git, repo, &remote)?;
            stage_project(git, project, repo, true)?;
            git_lines(
                git,
                repo,
                &["diff", "--cached", "--name-status", "--no-renames", "-z"],
            )
        })()
    };
    reset_to(git, repo, base.as_deref().unwrap_or(&remote))?;
    let mut uploads = Vec::new();
    let mut entries = listed?.into_iter();
    while let (Some(status), Some(path)) = (entries.next(), entries.next()) {
        if status.starts_with('A') || (modified && status.starts_with('M')) {
            uploads.push(path);
        }
    }
    Ok(uploads)
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
