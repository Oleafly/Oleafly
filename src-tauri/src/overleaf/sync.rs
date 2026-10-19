//! Two-way sync through a private Git mirror (in `oleafly-online`), run
//! with the app's Git runner and kept in the app's data folder. The names
//! and string errors are the ones the commands have used since 0.4.7.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Output;

pub use oleafly_online::sync::Side;
pub(crate) use oleafly_online::sync::{
    Integration, LinkOutcome, PushResult, SyncClaim, SyncLink, SyncPaths, BASE_REF,
};

use oleafly_online::git::MirrorGit;
use oleafly_online::sync::Mode;
use oleafly_online::OnlineError;

use super::errors::app_error;

/// Git through the app's runner, which locates Git and bounds every call.
/// Its errors are already in the app's format and pass through as they are.
pub(crate) struct AppMirrorGit;

impl MirrorGit for AppMirrorGit {
    fn run(&self, repo: &Path, args: &[&str]) -> Result<Output, OnlineError> {
        crate::git::run_mirror_git(repo, args).map_err(OnlineError::io)
    }

    fn run_remote(
        &self,
        repo: &Path,
        credential_origin: &str,
        token: &str,
        args: &[&str],
    ) -> Result<Output, OnlineError> {
        crate::git::run_mirror_git_remote(repo, credential_origin, token, args)
            .map_err(OnlineError::io)
    }

    fn failure_text(&self, output: &Output) -> String {
        crate::git::git_failure_text(output)
    }
}

/// `<data>/overleaf-sync/<project id>` and its lock.
pub(crate) fn paths(project_id: &str) -> Result<SyncPaths, String> {
    crate::paths::validate_project_id(project_id)?;
    SyncPaths::for_app_project(&crate::paths::oleafly_root()?, project_id).map_err(app_error)
}

/// One sync at a time per project, in this app and across the CLI.
pub(crate) fn claim(project_id: &str) -> Result<SyncClaim, String> {
    oleafly_online::sync::claim(&paths(project_id)?).map_err(app_error)
}

pub(crate) fn now_seconds() -> u64 {
    oleafly_online::sync::now_seconds()
}

pub(crate) fn repo_dir(project_id: &str) -> Result<PathBuf, String> {
    Ok(paths(project_id)?.repo)
}

pub(crate) fn read_link(project_id: &str) -> Result<Option<SyncLink>, String> {
    oleafly_online::sync::read_link(&paths(project_id)?).map_err(app_error)
}

pub(crate) fn write_link(project_id: &str, link: &SyncLink) -> Result<(), String> {
    oleafly_online::sync::write_link(&paths(project_id)?, link).map_err(app_error)
}

/// Removes the mirror and the link record.
pub(crate) fn remove_link(project_id: &str) -> Result<(), String> {
    oleafly_online::sync::remove_link(&paths(project_id)?).map_err(app_error)
}

pub(crate) fn remote_url(server: &str, remote_id: &str) -> Result<String, String> {
    oleafly_online::sync::remote_url(server, remote_id).map_err(app_error)
}

pub(crate) fn fetch(repo: &Path, url: &str, token: &str) -> Result<String, String> {
    oleafly_online::sync::fetch(&AppMirrorGit, repo, url, token).map_err(app_error)
}

pub(crate) fn push(
    repo: &Path,
    url: &str,
    token: &str,
    commit: &str,
) -> Result<PushResult, String> {
    oleafly_online::sync::push(&AppMirrorGit, repo, url, token, commit).map_err(app_error)
}

pub(crate) fn rev(repo: &Path, name: &str) -> Option<String> {
    oleafly_online::sync::rev(&AppMirrorGit, repo, name)
}

pub(crate) fn ensure_repo(repo: &Path) -> Result<(), String> {
    oleafly_online::sync::ensure_repo(&AppMirrorGit, repo).map_err(app_error)
}

pub(crate) fn clear_stale_lock(repo: &Path) {
    oleafly_online::sync::clear_stale_lock(repo);
}

pub(crate) fn remote_tip(repo: &Path) -> Option<String> {
    oleafly_online::sync::remote_tip(&AppMirrorGit, repo)
}

pub(crate) fn set_base(repo: &Path, commit: &str) -> Result<(), String> {
    oleafly_online::sync::set_base(&AppMirrorGit, repo, commit).map_err(app_error)
}

pub(crate) fn commit_local(
    project: &Path,
    repo: &Path,
    base: &str,
) -> Result<Option<String>, String> {
    oleafly_online::sync::commit_local(&AppMirrorGit, project, repo, base).map_err(app_error)
}

pub(crate) fn integrate(
    project: &Path,
    repo: &Path,
    base: &str,
    remote: &str,
    resolutions: &BTreeMap<String, Side>,
) -> Result<Integration, String> {
    oleafly_online::sync::integrate(
        &AppMirrorGit,
        project,
        repo,
        base,
        remote,
        resolutions,
        Mode::Apply,
    )
    .map_err(app_error)
}

pub(crate) fn link_local(
    project: &Path,
    repo: &Path,
    remote: &str,
    prefer: Option<Side>,
) -> Result<LinkOutcome, String> {
    oleafly_online::sync::link_local(&AppMirrorGit, project, repo, remote, prefer, Mode::Apply)
        .map_err(app_error)
}
