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

pub(crate) fn paths(project_id: &str) -> Result<SyncPaths, String> {
    crate::paths::validate_project_id(project_id)?;
    SyncPaths::for_app_project(&crate::paths::oleafly_root()?, project_id).map_err(app_error)
}

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

pub(crate) fn remove_link(project_id: &str) -> Result<(), String> {
    oleafly_online::sync::remove_link(&paths(project_id)?).map_err(app_error)
}

pub(crate) fn backups_dir(project_id: &str) -> Result<PathBuf, String> {
    crate::paths::validate_project_id(project_id)?;
    Ok(crate::paths::oleafly_root()?
        .join("overleaf-sync-backups")
        .join(project_id))
}

pub(crate) fn retire_mirror(project_id: &str) -> Result<Option<PathBuf>, String> {
    let paths = paths(project_id)?;
    let folder = backups_dir(project_id)?;
    let kept = match oleafly_online::sync::export_link_backups(&AppMirrorGit, &paths, &folder) {
        Ok(saved) if saved.is_empty() => None,
        Ok(saved) => {
            let names: Vec<&str> = saved.iter().map(|backup| backup.name.as_str()).collect();
            let _ = crate::project::append_app_log(format!(
                "Stopped syncing project {project_id} with Overleaf. The local files the link replaced are saved in {} ({}).",
                folder.display(),
                names.join(", ")
            ));
            Some(folder)
        }
        Err(error) => {
            let error = app_error(error);
            let aside = folder.join(format!("sync-copy-{}", now_seconds()));
            std::fs::create_dir_all(&folder)
                .and_then(|()| std::fs::rename(&paths.repo, &aside))
                .map_err(|_| error.clone())?;
            let _ = crate::project::append_app_log(format!(
                "Stopped syncing project {project_id} with Overleaf. Its sync copy could not be read ({}), so it was kept in {}.",
                crate::app_error::english_error(&error),
                aside.display()
            ));
            Some(folder)
        }
    };
    remove_link(project_id)?;
    Ok(kept)
}

pub(crate) fn maintain(repo: &Path) {
    oleafly_online::sync::maintain(&AppMirrorGit, repo);
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
