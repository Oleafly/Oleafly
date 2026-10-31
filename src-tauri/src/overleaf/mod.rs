mod client;
mod errors;
mod html;
mod import;
mod session;
mod signin;
mod socket;
mod sync;
pub(crate) mod template;

#[cfg(test)]
mod sync_tests;
#[cfg(test)]
mod tests;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime};

pub use import::{ImportEvent, ImportOutcome, RemoteProject};
pub use sync::Side;

use std::collections::BTreeMap;

use crate::app_error::AppError;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OverleafStatus {
    pub server: String,
    pub signed_in: bool,
    pub email: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OverleafProjects {
    pub status: OverleafStatus,
    pub projects: Vec<RemoteProject>,
}

fn status_for(base: &str, stored: Option<&session::Session>) -> OverleafStatus {
    OverleafStatus {
        server: base.to_string(),
        signed_in: stored.is_some(),
        email: stored
            .map(|session| session.email.clone())
            .filter(|email| !email.is_empty()),
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn overleaf_status(server: Option<String>) -> Result<OverleafStatus, String> {
    let base = session::normalize_server(server.as_deref())?;
    blocking(move || {
        let stored = session::load(&base)?;
        Ok(status_for(&base, stored.as_ref()))
    })
    .await
}

#[tauri::command]
pub async fn overleaf_sign_in<R: Runtime>(
    app: AppHandle<R>,
    server: Option<String>,
    title: String,
) -> Result<OverleafStatus, String> {
    let base = session::normalize_server(server.as_deref())?;
    let signed_in = signin::sign_in_with_window(&app, &base, &title).await?;
    let saved = signed_in.clone();
    let save_base = base.clone();
    blocking(move || session::save(&save_base, &saved)).await?;
    Ok(status_for(&base, Some(&signed_in)))
}

pub(crate) type AppCookie = (String, String, Option<String>, Option<String>, bool);

const KEPT_SIGN_IN_ERRORS: &[&str] = &[
    "\"overleaf.unreachable\"",
    "\"overleaf.rate_limited\"",
    "\"overleaf.invalid_server\"",
];

/// Signs in to the online LaTeX service with the cookies the browser sign-in
/// copy put in the main webview's cookie store, without opening a window.
/// Async because reading cookies deadlocks in sync commands on Windows.
#[tauri::command]
pub async fn overleaf_sign_in_with_app_cookies<R: Runtime>(
    webview: tauri::Webview<R>,
    server: Option<String>,
) -> Result<OverleafStatus, String> {
    if crate::caller::own_window_label(&webview).as_deref() != Some("main") {
        return Err(AppError::new("overleaf.sign_in_failed").into());
    }
    let base = session::normalize_server(server.as_deref())?;
    let stored = webview
        .cookies()
        .map_err(|_| String::from(AppError::new("overleaf.sign_in_failed")))?;
    let cookies: Vec<AppCookie> = stored
        .iter()
        .map(|cookie| {
            (
                cookie.name().to_string(),
                cookie.value().to_string(),
                cookie.domain().map(str::to_string),
                cookie.path().map(str::to_string),
                cookie.secure().unwrap_or(false),
            )
        })
        .collect();
    let header = app_cookie_header(&cookies, &base);
    // The copied cookies were only a way in. The session is saved encrypted
    // below, nothing else in the app reads the webview's copy, and WebKit
    // would keep it on disk unencrypted until it expires.
    for at in copied_cookies(&cookies, &base) {
        let _ = webview.delete_cookie(stored[at].clone());
    }
    let header = header?;
    let signed_in = signin::session_from_cookie(&base, header)
        .await
        .map_err(|error| {
            if KEPT_SIGN_IN_ERRORS.iter().any(|code| error.contains(code)) {
                error
            } else {
                String::from(AppError::new("overleaf.browser_sign_in_failed"))
            }
        })?;
    let saved = signed_in.clone();
    let save_base = base.clone();
    blocking(move || session::save(&save_base, &saved)).await?;
    Ok(status_for(&base, Some(&signed_in)))
}

fn copied_cookies(cookies: &[AppCookie], base: &str) -> Vec<usize> {
    let Ok(url) = tauri::Url::parse(base) else {
        return Vec::new();
    };
    cookies
        .iter()
        .enumerate()
        .filter(|(_, (_, _, domain, path, secure))| {
            session::cookie_applies(domain.as_deref(), path.as_deref(), *secure, &url)
        })
        .map(|(at, _)| at)
        .collect()
}

fn app_cookie_header(cookies: &[AppCookie], base: &str) -> Result<String, String> {
    let url = tauri::Url::parse(base).map_err(|_| {
        String::from(AppError::new("overleaf.invalid_server").param("server", base))
    })?;
    let header = session::cookie_header(
        cookies
            .iter()
            .filter(|(_, _, domain, path, secure)| {
                session::cookie_applies(domain.as_deref(), path.as_deref(), *secure, &url)
            })
            .map(|(name, value, _, _, _)| (name.clone(), value.clone())),
    );
    if header.is_empty() {
        let host = url.host_str().unwrap_or(base).to_string();
        return Err(AppError::new("overleaf.browser_sign_in_missing")
            .param("server", host)
            .into());
    }
    Ok(header)
}

#[tauri::command]
pub async fn overleaf_sign_out(server: Option<String>) -> Result<OverleafStatus, String> {
    let base = session::normalize_server(server.as_deref())?;
    let forget_base = base.clone();
    blocking(move || session::forget(&forget_base)).await?;
    Ok(status_for(&base, None))
}

#[tauri::command]
pub async fn overleaf_list_projects(server: Option<String>) -> Result<OverleafProjects, String> {
    let base = session::normalize_server(server.as_deref())?;
    let (signed_in, projects) = import::list(&base).await?;
    Ok(OverleafProjects {
        status: status_for(&base, Some(&signed_in)),
        projects,
    })
}

#[tauri::command]
pub async fn overleaf_import_projects<R: Runtime>(
    app: AppHandle<R>,
    server: Option<String>,
    ids: Vec<String>,
    on_event: Channel<ImportEvent>,
) -> Result<Vec<ImportOutcome>, String> {
    let base = session::normalize_server(server.as_deref())?;
    let emit = move |event: ImportEvent| {
        let _ = on_event.send(event);
    };
    let outcomes = import::import(&base, &ids, &emit).await?;
    for project_id in outcomes
        .iter()
        .filter_map(|outcome| outcome.project_id.as_deref())
    {
        crate::project::record_tex_spec_for_new_project(&app, project_id);
    }
    Ok(outcomes)
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFrom {
    pub server: String,
    pub project_id: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub linked: bool,
    pub server: String,
    pub remote_id: Option<String>,
    pub auto: bool,
    pub last_sync_at: Option<u64>,
    pub token_saved: bool,
    pub imported_from: Option<ImportedFrom>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backups_folder: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub outcome: String,
    pub files: Vec<String>,
    pub pulled: usize,
    pub pushed: bool,
    pub state: Option<crate::project::ProjectStateChanged>,
}

fn imported_from(project_id: &str) -> Option<ImportedFrom> {
    let meta = crate::project::read_meta(project_id).ok()?;
    let origin = oleafly_online::projects::imported_from(meta.extra.get("importedFrom")?)?;
    Some(ImportedFrom {
        server: origin.server,
        project_id: origin.project_id,
    })
}

pub(crate) fn forget_sync_copy(project_id: &str) -> Result<(), String> {
    sync::remove_link(project_id)
}

fn current_link(project_id: &str) -> Result<Option<sync::SyncLink>, String> {
    let Some(link) = sync::read_link(project_id)? else {
        return Ok(None);
    };
    let owned = imported_from(project_id).is_some_and(|origin| origin.project_id == link.remote_id);
    Ok(owned.then_some(link))
}

fn linked(project_id: &str) -> Result<sync::SyncLink, String> {
    current_link(project_id)?.ok_or_else(|| AppError::new("overleaf.sync_not_linked").into())
}

fn sync_status(project_id: &str) -> Result<SyncStatus, String> {
    let link = current_link(project_id)?;
    let imported = imported_from(project_id);
    let server = link
        .as_ref()
        .map(|link| link.server.clone())
        .or_else(|| imported.as_ref().map(|origin| origin.server.clone()))
        .unwrap_or_else(|| session::DEFAULT_SERVER.to_string());
    Ok(SyncStatus {
        token_saved: session::git_token(&server)?.is_some(),
        linked: link.is_some(),
        remote_id: link.as_ref().map(|link| link.remote_id.clone()),
        auto: link.as_ref().is_some_and(|link| link.auto),
        last_sync_at: link.as_ref().and_then(|link| link.last_sync_at),
        imported_from: imported,
        server,
        backups_folder: None,
    })
}

fn required_token(base: &str) -> Result<String, String> {
    session::git_token(base)?
        .ok_or_else(|| String::from(AppError::new("overleaf.git_token_missing")))
}

fn publish(
    app: &AppHandle<impl Runtime>,
    state: &crate::state::AppState,
    project_id: &str,
    project: crate::project::ProjectMeta,
    changed: bool,
    generation: u64,
) -> Result<crate::project::ProjectStateChanged, String> {
    crate::project::publish_project_state_changed(
        app,
        state,
        project_id,
        project,
        "overleaf-sync",
        changed,
        Some(generation),
    )
}

#[tauri::command]
pub async fn overleaf_sync_status(project_id: String) -> Result<SyncStatus, String> {
    blocking(move || sync_status(&project_id)).await
}

#[tauri::command]
pub async fn overleaf_git_token_status(server: Option<String>) -> Result<bool, String> {
    let base = session::normalize_server(server.as_deref())?;
    blocking(move || Ok(session::git_token(&base)?.is_some())).await
}

#[tauri::command]
pub async fn overleaf_git_token_set(server: Option<String>, token: String) -> Result<(), String> {
    let base = session::normalize_server(server.as_deref())?;
    blocking(move || session::save_git_token(&base, &token)).await
}

#[tauri::command]
pub async fn overleaf_git_token_clear(server: Option<String>) -> Result<(), String> {
    let base = session::normalize_server(server.as_deref())?;
    blocking(move || session::forget_git_token(&base)).await
}

#[tauri::command]
pub async fn overleaf_sync_set_auto(project_id: String, auto: bool) -> Result<SyncStatus, String> {
    blocking(move || {
        let mut link = linked(&project_id)?;
        link.auto = auto;
        sync::write_link(&project_id, &link)?;
        sync_status(&project_id)
    })
    .await
}

#[tauri::command]
pub async fn overleaf_sync_unlink(project_id: String) -> Result<SyncStatus, String> {
    let _guard = sync::claim(&project_id)?;
    blocking(move || {
        let kept = sync::retire_mirror(&project_id)?;
        let mut status = sync_status(&project_id)?;
        status.backups_folder = kept.map(|folder| folder.display().to_string());
        Ok(status)
    })
    .await
}

#[tauri::command]
pub async fn overleaf_sync_link<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    expected_generation: Option<u64>,
    server: Option<String>,
    remote_id: String,
    prefer: Option<Side>,
) -> Result<SyncReport, String> {
    let base = session::normalize_server(server.as_deref())?;
    let _guard = sync::claim(&project_id)?;
    let url = sync::remote_url(&base, &remote_id)?;
    let token = required_token(&base)?;
    let stale_id = project_id.clone();
    let existing = blocking(move || {
        let current = current_link(&stale_id)?;
        if current.is_none() && sync::read_link(&stale_id)?.is_some() {
            sync::retire_mirror(&stale_id)?;
        }
        Ok(current)
    })
    .await?;
    if existing
        .as_ref()
        .is_some_and(|link| link.server != base || link.remote_id != remote_id)
    {
        return Err(AppError::new("overleaf.sync_already_linked").into());
    }
    let repo = sync::repo_dir(&project_id)?;
    sync::clear_stale_lock(&repo);
    let fetch_repo = repo.clone();
    let remote = blocking(move || sync::fetch(&fetch_repo, &url, &token)).await?;
    let mutation = crate::project::mutate_project_worktree(
        &state,
        project_id.clone(),
        expected_generation,
        move |root| {
            let outcome = sync::link_local(root, &repo, &remote, prefer)?;
            let changed =
                matches!(&outcome, sync::LinkOutcome::Linked { written } if !written.is_empty());
            Ok((outcome, changed))
        },
    )
    .await?;
    let generation = mutation.generation;
    let project = mutation.project;
    let outcome = match mutation.value {
        Ok(outcome) => outcome,
        Err(error) => {
            if errors::files_may_have_changed(&error) {
                let _ = publish(&app, &state, &project_id, project, true, generation);
            }
            return Err(error);
        }
    };
    let (label, files, changed) = match &outcome {
        sync::LinkOutcome::Linked { written } => ("linked", written.clone(), !written.is_empty()),
        sync::LinkOutcome::NeedsChoice(files) => ("needs-choice", files.clone(), false),
    };
    let event = publish(&app, &state, &project_id, project, changed, generation)?;
    if label == "linked" {
        let now = sync::now_seconds();
        sync::write_link(
            &project_id,
            &sync::SyncLink {
                server: base,
                remote_id,
                linked_at: now,
                auto: true,
                last_sync_at: Some(now),
            },
        )?;
    }
    Ok(SyncReport {
        outcome: label.to_string(),
        pulled: if changed { files.len() } else { 0 },
        files,
        pushed: false,
        state: Some(event),
    })
}

struct SyncTarget {
    link: sync::SyncLink,
    url: String,
    token: String,
    repo: std::path::PathBuf,
    base: String,
}

async fn sync_target(project_id: &str) -> Result<SyncTarget, String> {
    let link_id = project_id.to_string();
    let link = blocking(move || linked(&link_id)).await?;
    let url = sync::remote_url(&link.server, &link.remote_id)?;
    let token = required_token(&link.server)?;
    let repo = sync::repo_dir(project_id)?;
    let base_repo = repo.clone();
    let base = blocking(move || {
        sync::clear_stale_lock(&base_repo);
        sync::ensure_repo(&base_repo)?;
        sync::rev(&base_repo, sync::BASE_REF)
            .ok_or_else(|| String::from(AppError::new("overleaf.sync_needs_relink")))
    })
    .await?;
    Ok(SyncTarget {
        link,
        url,
        token,
        repo,
        base,
    })
}

async fn fetch_remote(target: &SyncTarget) -> Result<String, String> {
    let repo = target.repo.clone();
    let url = target.url.clone();
    let token = target.token.clone();
    blocking(move || sync::fetch(&repo, &url, &token)).await
}

async fn push_commit(target: &SyncTarget, commit: &str) -> Result<sync::PushResult, String> {
    let repo = target.repo.clone();
    let url = target.url.clone();
    let token = target.token.clone();
    let commit = commit.to_string();
    blocking(move || sync::push(&repo, &url, &token, &commit)).await
}

async fn record_sync(project_id: &str, mut link: sync::SyncLink) -> Result<(), String> {
    link.last_sync_at = Some(sync::now_seconds());
    let save_id = project_id.to_string();
    blocking(move || sync::write_link(&save_id, &link)).await
}

fn quiet_report(outcome: &str, pushed: bool) -> SyncReport {
    SyncReport {
        outcome: outcome.to_string(),
        files: Vec::new(),
        pulled: 0,
        pushed,
        state: None,
    }
}

#[tauri::command]
pub async fn overleaf_sync_check(project_id: String) -> Result<SyncReport, String> {
    let _guard = sync::claim(&project_id)?;
    let target = sync_target(&project_id).await?;
    let remote = fetch_remote(&target).await?;
    if remote != target.base {
        return Ok(quiet_report("needs-merge", false));
    }
    let read_id = project_id.clone();
    let read_repo = target.repo.clone();
    let read_base = target.base.clone();
    let local = blocking(move || {
        crate::project::read_project_worktree(&read_id, |root| {
            sync::commit_local(root, &read_repo, &read_base)
        })
    })
    .await?;
    let pushed = match local {
        None => false,
        Some(commit) => {
            if push_commit(&target, &commit).await? == sync::PushResult::Rejected {
                return Ok(quiet_report("needs-merge", false));
            }
            let base_repo = target.repo.clone();
            blocking(move || sync::set_base(&base_repo, &commit)).await?;
            true
        }
    };
    record_sync(&project_id, target.link).await?;
    maintain(target.repo).await;
    Ok(quiet_report(
        if pushed { "synced" } else { "up-to-date" },
        pushed,
    ))
}

async fn maintain(repo: std::path::PathBuf) {
    let _ = blocking(move || {
        sync::maintain(&repo);
        Ok(())
    })
    .await;
}

struct Progress {
    generation: Option<u64>,
    project: Option<crate::project::ProjectMeta>,
    changed: bool,
    pulled: usize,
}

type Finished = (String, Vec<String>, bool);

async fn merge_rounds(
    state: &crate::state::AppState,
    project_id: &str,
    target: &SyncTarget,
    resolutions: BTreeMap<String, Side>,
    mut reuse_fetch: bool,
    progress: &mut Progress,
) -> Result<Option<Finished>, String> {
    let mut work_base = target.base.clone();
    for _ in 0..3 {
        let known = if reuse_fetch {
            let known_repo = target.repo.clone();
            blocking(move || Ok(sync::remote_tip(&known_repo))).await?
        } else {
            None
        };
        reuse_fetch = false;
        let remote = match known {
            Some(remote) => remote,
            None => fetch_remote(target).await?,
        };
        let work_repo = target.repo.clone();
        let merge_base = work_base.clone();
        let work_resolutions = resolutions.clone();
        let mutation = crate::project::mutate_project_worktree(
            state,
            project_id.to_string(),
            progress.generation,
            move |root| {
                let integration =
                    sync::integrate(root, &work_repo, &merge_base, &remote, &work_resolutions)?;
                let touched = matches!(
                    &integration,
                    sync::Integration::Merged { written, removed, .. } if !written.is_empty() || !removed.is_empty()
                );
                Ok(((integration, remote), touched))
            },
        )
        .await?;
        progress.generation = Some(mutation.generation);
        progress.project = Some(mutation.project);
        let (integration, remote) = mutation.value?;
        match integration {
            sync::Integration::UpToDate => {
                return Ok(Some(("up-to-date".to_string(), Vec::new(), false)));
            }
            sync::Integration::Conflicts(files) => {
                return Ok(Some(("conflicts".to_string(), files, false)));
            }
            sync::Integration::Merged {
                merged,
                push,
                written,
                removed,
            } => {
                if !written.is_empty() || !removed.is_empty() {
                    progress.changed = true;
                    progress.pulled += written.len() + removed.len();
                }
                let pushes = push && merged != remote;
                let result = if pushes {
                    push_commit(target, &merged).await?
                } else {
                    sync::PushResult::Pushed
                };
                let agreed = if result == sync::PushResult::Pushed {
                    merged
                } else {
                    remote
                };
                let base_repo = target.repo.clone();
                let next_base = agreed.clone();
                blocking(move || sync::set_base(&base_repo, &next_base)).await?;
                work_base = agreed;
                if result == sync::PushResult::Pushed {
                    return Ok(Some(("synced".to_string(), Vec::new(), pushes)));
                }
            }
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn overleaf_sync_now<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    expected_generation: Option<u64>,
    resolutions: Option<BTreeMap<String, Side>>,
    fetched: Option<bool>,
) -> Result<SyncReport, String> {
    let _guard = sync::claim(&project_id)?;
    let target = sync_target(&project_id).await?;
    let mut progress = Progress {
        generation: expected_generation,
        project: None,
        changed: false,
        pulled: 0,
    };
    let rounds = merge_rounds(
        &state,
        &project_id,
        &target,
        resolutions.unwrap_or_default(),
        fetched.unwrap_or(false),
        &mut progress,
    )
    .await;
    let finished = match rounds {
        Ok(finished) => finished,
        Err(error) => {
            if !progress.changed && !errors::files_may_have_changed(&error) {
                return Err(error);
            }
            if let (Some(project), Some(generation)) = (progress.project, progress.generation) {
                let _ = publish(&app, &state, &project_id, project, true, generation);
            }
            return Err(errors::after_files_changed(error));
        }
    };
    let project = progress
        .project
        .ok_or_else(|| String::from(AppError::new("overleaf.sync_failed")))?;
    let generation = progress.generation.unwrap_or_default();
    let event = publish(
        &app,
        &state,
        &project_id,
        project,
        progress.changed,
        generation,
    )?;
    let (outcome, files, pushed) =
        finished.ok_or_else(|| String::from(AppError::new("overleaf.sync_kept_changing")))?;
    if outcome != "conflicts" {
        record_sync(&project_id, target.link).await?;
        maintain(target.repo).await;
    }
    Ok(SyncReport {
        outcome,
        files,
        pulled: progress.pulled,
        pushed,
        state: Some(event),
    })
}
