use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::app_error::AppError;

pub(crate) const BASE_REF: &str = "refs/heads/oleafly-base";
pub(crate) const REMOTE_REF: &str = "refs/remotes/overleaf/master";
const REMOTE_BRANCH: &str = "refs/heads/master";
const MAX_FILES: usize = 5_000;
const MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_LISTED: usize = 200;
const IGNORED_NAMES: [&str; 5] = ["__macosx", ".ds_store", "thumbs.db", "desktop.ini", ".git"];

static RUNNING: Mutex<Option<HashSet<String>>> = Mutex::new(None);

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Local,
    Remote,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncLink {
    pub server: String,
    pub remote_id: String,
    pub linked_at: u64,
    pub auto: bool,
    #[serde(default)]
    pub last_sync_at: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Integration {
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
pub(crate) enum LinkOutcome {
    Linked { written: Vec<String> },
    NeedsChoice(Vec<String>),
}

#[derive(Debug)]
pub(crate) struct RunGuard(String);

impl Drop for RunGuard {
    fn drop(&mut self) {
        let mut running = RUNNING
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(set) = running.as_mut() {
            set.remove(&self.0);
        }
    }
}

pub(crate) fn claim(project_id: &str) -> Result<RunGuard, String> {
    let mut running = RUNNING
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let set = running.get_or_insert_with(HashSet::new);
    if !set.insert(project_id.to_string()) {
        return Err(AppError::new("overleaf.sync_busy").into());
    }
    Ok(RunGuard(project_id.to_string()))
}

pub(crate) fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

pub(crate) fn mirror_dir(project_id: &str) -> Result<PathBuf, String> {
    crate::paths::validate_project_id(project_id)?;
    Ok(crate::paths::oleafly_root()?
        .join("overleaf-sync")
        .join(project_id))
}

pub(crate) fn repo_dir(project_id: &str) -> Result<PathBuf, String> {
    Ok(mirror_dir(project_id)?.join("repo"))
}

fn link_path(project_id: &str) -> Result<PathBuf, String> {
    Ok(mirror_dir(project_id)?.join("link.json"))
}

pub(crate) fn read_link(project_id: &str) -> Result<Option<SyncLink>, String> {
    let path = link_path(project_id)?;
    match std::fs::read_to_string(&path) {
        Ok(raw) => Ok(serde_json::from_str(&raw).ok()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not read the sync link: {error}")),
    }
}

pub(crate) fn write_link(project_id: &str, link: &SyncLink) -> Result<(), String> {
    let path = link_path(project_id)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let raw = serde_json::to_vec_pretty(link).map_err(|error| error.to_string())?;
    crate::sandbox::atomic_write(&path, &raw)
}

pub(crate) fn remove_link(project_id: &str) -> Result<(), String> {
    let dir = mirror_dir(project_id)?;
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not remove the sync copy: {error}")),
    }
}

pub(crate) fn remote_url(server: &str, remote_id: &str) -> Result<String, String> {
    if !super::client::valid_project_id(remote_id) {
        return Err(AppError::new("overleaf.project_unavailable").into());
    }
    if cfg!(test) && server.starts_with("file://") {
        return Ok(format!("{server}/{remote_id}"));
    }
    if server == super::session::DEFAULT_SERVER {
        return Ok(format!("https://git.overleaf.com/{remote_id}"));
    }
    Ok(format!("{server}/git/{remote_id}"))
}

pub(crate) fn credential_origin(url: &str) -> String {
    tauri::Url::parse(url)
        .map(|parsed| parsed.origin().ascii_serialization())
        .unwrap_or_default()
}

fn git(repo: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    crate::git::run_mirror_git(repo, args)
}

fn git_ok(repo: &Path, args: &[&str]) -> Result<String, String> {
    let output = git(repo, args)?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(crate::git::git_failure_text(&output))
    }
}

fn git_lines(repo: &Path, args: &[&str]) -> Result<Vec<String>, String> {
    let output = git(repo, args)?;
    if !output.status.success() {
        return Err(crate::git::git_failure_text(&output));
    }
    Ok(output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .map(|entry| String::from_utf8_lossy(entry).into_owned())
        .collect())
}

pub(crate) fn rev(repo: &Path, name: &str) -> Option<String> {
    let commit = format!("{name}^{{commit}}");
    git(repo, &["rev-parse", "--verify", "--quiet", &commit])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|sha| !sha.is_empty())
}

pub(crate) fn ensure_repo(repo: &Path) -> Result<(), String> {
    if repo.join(".git").is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(repo)
        .map_err(|error| format!("could not create the sync copy: {error}"))?;
    git_ok(repo, &["init", "--quiet"])?;
    Ok(())
}

pub(crate) fn classify_remote_failure(text: &str) -> String {
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
        return AppError::new("overleaf.git_token_rejected").into();
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
        return AppError::new("overleaf.git_unavailable").into();
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
        return AppError::new("overleaf.sync_offline")
            .detail(first_line(text))
            .into();
    }
    AppError::new("overleaf.sync_failed")
        .detail(first_line(text))
        .into()
}

fn first_line(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default()
        .chars()
        .take(300)
        .collect()
}

pub(crate) fn fetch(repo: &Path, url: &str, token: &str) -> Result<String, String> {
    ensure_repo(repo)?;
    let refspec = format!("+{REMOTE_BRANCH}:{REMOTE_REF}");
    let origin = credential_origin(url);
    let output = crate::git::run_mirror_git_remote(
        repo,
        &origin,
        token,
        &[
            "fetch",
            "--quiet",
            "--no-tags",
            "--no-recurse-submodules",
            url,
            &refspec,
        ],
    )?;
    if !output.status.success() {
        return Err(classify_remote_failure(&crate::git::git_failure_text(
            &output,
        )));
    }
    rev(repo, REMOTE_REF).ok_or_else(|| AppError::new("overleaf.git_unavailable").into())
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PushResult {
    Pushed,
    Rejected,
}

pub(crate) fn push(
    repo: &Path,
    url: &str,
    token: &str,
    commit: &str,
) -> Result<PushResult, String> {
    let refspec = format!("{commit}:{REMOTE_BRANCH}");
    let origin = credential_origin(url);
    let output = crate::git::run_mirror_git_remote(
        repo,
        &origin,
        token,
        &["push", "--quiet", "--porcelain", url, &refspec],
    )?;
    if output.status.success() {
        return Ok(PushResult::Pushed);
    }
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        crate::git::git_failure_text(&output)
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

pub(crate) fn set_base(repo: &Path, commit: &str) -> Result<(), String> {
    git_ok(repo, &["update-ref", BASE_REF, commit]).map(|_| ())
}

pub(crate) fn excluded(rel: &str) -> bool {
    if rel == "project.json" {
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

fn windows_invalid(rel: &str) -> bool {
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

pub(crate) fn check_remote_paths(paths: &[String]) -> Result<(), String> {
    let mut seen: BTreeMap<String, &String> = BTreeMap::new();
    let mut clashes: BTreeSet<String> = BTreeSet::new();
    let mut invalid: BTreeSet<String> = BTreeSet::new();
    for path in paths {
        if !safe_relative(path) || (cfg!(windows) && windows_invalid(path)) {
            invalid.insert(path.clone());
            continue;
        }
        if let Some(other) = seen.insert(path.to_lowercase(), path) {
            clashes.insert(other.clone());
            clashes.insert(path.clone());
        }
    }
    if !clashes.is_empty() {
        return Err(AppError::new("overleaf.sync_case_clash")
            .param(
                "files",
                clashes.into_iter().take(10).collect::<Vec<_>>().join(", "),
            )
            .into());
    }
    if !invalid.is_empty() {
        return Err(AppError::new("overleaf.sync_invalid_names")
            .param(
                "files",
                invalid.into_iter().take(10).collect::<Vec<_>>().join(", "),
            )
            .into());
    }
    Ok(())
}

pub(crate) fn project_files(root: &Path) -> Result<BTreeMap<String, PathBuf>, String> {
    let mut files = BTreeMap::new();
    let mut total: u64 = 0;
    let mut stack = vec![(root.to_path_buf(), String::new())];
    while let Some((dir, prefix)) = stack.pop() {
        let entries = std::fs::read_dir(&dir)
            .map_err(|error| format!("could not read {}: {error}", dir.display()))?;
        for entry in entries {
            let entry = entry.map_err(|error| error.to_string())?;
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
            let metadata =
                std::fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
            if metadata.is_dir() {
                stack.push((entry.path(), rel));
            } else if metadata.is_file() {
                if metadata.len() > MAX_FILE_BYTES {
                    return Err(AppError::new("overleaf.sync_file_too_large")
                        .param("file", &rel)
                        .into());
                }
                total = total.saturating_add(metadata.len());
                files.insert(rel, entry.path());
                if files.len() > MAX_FILES || total > MAX_TOTAL_BYTES {
                    return Err(AppError::new("overleaf.sync_too_large").into());
                }
            }
        }
    }
    Ok(files)
}

fn tracked_files(repo: &Path) -> Result<BTreeSet<String>, String> {
    Ok(git_lines(repo, &["ls-files", "-z"])?.into_iter().collect())
}

fn tree_files(repo: &Path, commit: &str) -> Result<Vec<String>, String> {
    git_lines(repo, &["ls-tree", "-r", "-z", "--name-only", commit])
}

fn reset_to(repo: &Path, commit: &str) -> Result<(), String> {
    git_ok(
        repo,
        &["checkout", "--quiet", "--force", "--detach", commit],
    )?;
    git_ok(repo, &["clean", "--quiet", "-ffdx"])?;
    Ok(())
}

fn copy_into(source: &Path, destination: &Path) -> Result<bool, String> {
    let bytes = std::fs::read(source)
        .map_err(|error| format!("could not read {}: {error}", source.display()))?;
    if std::fs::read(destination).is_ok_and(|existing| existing == bytes) {
        return Ok(false);
    }
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(destination, &bytes)
        .map_err(|error| format!("could not write {}: {error}", destination.display()))?;
    Ok(true)
}

fn stage_project(project: &Path, repo: &Path, remove_missing: bool) -> Result<bool, String> {
    let files = project_files(project)?;
    for (rel, source) in &files {
        copy_into(source, &repo.join(rel))?;
    }
    if remove_missing {
        for rel in tracked_files(repo)? {
            if !excluded(&rel) && !files.contains_key(&rel) {
                let path = repo.join(&rel);
                if std::fs::symlink_metadata(&path).is_ok() {
                    std::fs::remove_file(&path).map_err(|error| error.to_string())?;
                }
            }
        }
    }
    git_ok(repo, &["add", "--all", "--force", "--", "."])?;
    let staged = git(repo, &["diff", "--cached", "--quiet"])?;
    Ok(!staged.status.success())
}

fn commit(repo: &Path, message: &str) -> Result<String, String> {
    git_ok(repo, &["commit", "--quiet", "--no-verify", "-m", message])?;
    rev(repo, "HEAD").ok_or_else(|| "the sync copy has no commit".to_string())
}

fn changed_paths(repo: &Path, from: &str, to: &str) -> Result<(Vec<String>, Vec<String>), String> {
    let entries = git_lines(
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

fn write_back(
    project: &Path,
    repo: &Path,
    written: &[String],
    removed: &[String],
) -> Result<(Vec<String>, Vec<String>), String> {
    let mut wrote = Vec::new();
    let mut deleted = Vec::new();
    for rel in written {
        if excluded(rel) || !safe_relative(rel) {
            continue;
        }
        let source = repo.join(rel);
        let metadata = std::fs::symlink_metadata(&source).map_err(|error| error.to_string())?;
        if !metadata.is_file() {
            continue;
        }
        let destination = project.join(rel);
        if std::fs::symlink_metadata(&destination).is_ok_and(|existing| !existing.is_file()) {
            return Err(AppError::new("overleaf.sync_path_blocked")
                .param("file", rel)
                .into());
        }
        let bytes = std::fs::read(&source).map_err(|error| error.to_string())?;
        if std::fs::read(&destination).is_ok_and(|existing| existing == bytes) {
            continue;
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        crate::sandbox::atomic_write(&destination, &bytes)?;
        wrote.push(rel.clone());
    }
    for rel in removed {
        if excluded(rel) || !safe_relative(rel) {
            continue;
        }
        let destination = project.join(rel);
        match std::fs::symlink_metadata(&destination) {
            Ok(metadata) if metadata.is_file() => {
                std::fs::remove_file(&destination).map_err(|error| error.to_string())?;
                prune_empty_parents(project, &destination);
                deleted.push(rel.clone());
            }
            _ => {}
        }
    }
    Ok((wrote, deleted))
}

fn conflicted_paths(repo: &Path) -> Result<Vec<String>, String> {
    let mut paths: Vec<String> =
        git_lines(repo, &["diff", "--name-only", "--diff-filter=U", "-z"])?;
    paths.sort();
    paths.dedup();
    Ok(paths)
}

fn stages(repo: &Path, path: &str) -> Result<BTreeSet<u8>, String> {
    let entries = git_lines(repo, &["ls-files", "-u", "-z", "--", path])?;
    Ok(entries
        .iter()
        .filter_map(|entry| entry.split('\t').next())
        .filter_map(|meta| meta.split_whitespace().nth(2))
        .filter_map(|stage| stage.parse().ok())
        .collect())
}

fn resolve(repo: &Path, path: &str, side: Side) -> Result<(), String> {
    let present = stages(repo, path)?;
    let (stage, flag) = match side {
        Side::Local => (2, "--ours"),
        Side::Remote => (3, "--theirs"),
    };
    if present.contains(&stage) {
        git_ok(repo, &["checkout", flag, "--", path])?;
        git_ok(repo, &["add", "--force", "--", path])?;
    } else {
        git_ok(
            repo,
            &["rm", "--quiet", "--cached", "--ignore-unmatch", "--", path],
        )?;
        let file = repo.join(path);
        if std::fs::symlink_metadata(&file).is_ok() {
            std::fs::remove_file(&file).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

pub(crate) fn integrate(
    project: &Path,
    repo: &Path,
    base: &str,
    remote: &str,
    resolutions: &BTreeMap<String, Side>,
) -> Result<Integration, String> {
    check_remote_paths(&tree_files(repo, remote)?)?;
    reset_to(repo, base)?;
    let local = if stage_project(project, repo, true)? {
        commit(repo, "Changes from Oleafly")?
    } else {
        base.to_string()
    };
    if remote == base && local == base {
        return Ok(Integration::UpToDate);
    }
    if remote == base {
        return Ok(Integration::Merged {
            merged: local,
            push: true,
            written: Vec::new(),
            removed: Vec::new(),
        });
    }
    if local == base {
        reset_to(repo, remote)?;
        let (written, removed) = changed_paths(repo, base, remote)?;
        let (written, removed) = write_back(project, repo, &written, &removed)?;
        return Ok(Integration::Merged {
            merged: remote.to_string(),
            push: false,
            written,
            removed,
        });
    }
    let merge = git(
        repo,
        &[
            "merge",
            "--no-ff",
            "--no-edit",
            "-m",
            "Merge changes from Overleaf",
            remote,
        ],
    )?;
    if !merge.status.success() {
        let conflicts = conflicted_paths(repo)?;
        if conflicts.is_empty() {
            let _ = git(repo, &["merge", "--abort"]);
            reset_to(repo, base)?;
            return Err(AppError::new("overleaf.sync_failed")
                .detail(first_line(&crate::git::git_failure_text(&merge)))
                .into());
        }
        let unresolved: Vec<String> = conflicts
            .iter()
            .filter(|path| !resolutions.contains_key(*path))
            .cloned()
            .collect();
        if !unresolved.is_empty() {
            let _ = git(repo, &["merge", "--abort"]);
            reset_to(repo, base)?;
            return Ok(Integration::Conflicts(
                conflicts.into_iter().take(MAX_LISTED).collect(),
            ));
        }
        for path in &conflicts {
            resolve(repo, path, resolutions[path])?;
        }
        if !conflicted_paths(repo)?.is_empty() {
            let _ = git(repo, &["merge", "--abort"]);
            reset_to(repo, base)?;
            return Err(AppError::new("overleaf.sync_failed").into());
        }
        git_ok(repo, &["commit", "--quiet", "--no-verify", "--no-edit"])?;
    }
    let merged = rev(repo, "HEAD").ok_or_else(|| "the sync copy has no commit".to_string())?;
    let (written, removed) = changed_paths(repo, &local, &merged)?;
    let (written, removed) = write_back(project, repo, &written, &removed)?;
    Ok(Integration::Merged {
        merged,
        push: true,
        written,
        removed,
    })
}

pub(crate) fn link_local(
    project: &Path,
    repo: &Path,
    remote: &str,
    prefer: Option<Side>,
) -> Result<LinkOutcome, String> {
    let remote_paths = tree_files(repo, remote)?;
    check_remote_paths(&remote_paths)?;
    reset_to(repo, remote)?;
    let local = project_files(project)?;
    let mut differing = Vec::new();
    for (rel, source) in &local {
        let mirrored = repo.join(rel);
        if !mirrored.is_file() {
            continue;
        }
        let ours = std::fs::read(source).map_err(|error| error.to_string())?;
        let theirs = std::fs::read(&mirrored).map_err(|error| error.to_string())?;
        if ours != theirs {
            differing.push(rel.clone());
        }
    }
    if !differing.is_empty() && prefer.is_none() {
        return Ok(LinkOutcome::NeedsChoice(
            differing.into_iter().take(MAX_LISTED).collect(),
        ));
    }
    if prefer == Some(Side::Remote) && !differing.is_empty() {
        for (rel, source) in &local {
            copy_into(source, &repo.join(rel))?;
        }
        git_ok(repo, &["add", "--all", "--force", "--", "."])?;
        if !git(repo, &["diff", "--cached", "--quiet"])?
            .status
            .success()
        {
            let backup = commit(repo, "Oleafly copy before linking")?;
            let name = format!("refs/oleafly/before-link-{}", now_seconds());
            git_ok(repo, &["update-ref", &name, &backup])?;
        }
        reset_to(repo, remote)?;
    }
    let mut to_write: Vec<String> = remote_paths
        .iter()
        .filter(|rel| !excluded(rel) && !local.contains_key(*rel))
        .cloned()
        .collect();
    if prefer == Some(Side::Remote) {
        to_write.extend(differing.iter().cloned());
    }
    let (written, _) = write_back(project, repo, &to_write, &[])?;
    set_base(repo, remote)?;
    Ok(LinkOutcome::Linked { written })
}
