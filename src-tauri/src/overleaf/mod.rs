mod client;
pub(crate) mod create;
mod errors;
mod html;
mod import;
pub(crate) mod links;
mod session;
mod signin;
mod sync;
pub(crate) mod template;

#[cfg(test)]
mod flow_tests;
#[cfg(test)]
mod sync_tests;
#[cfg(test)]
mod tests;

use oleafly_online::projects::ImportedFrom;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime};

pub(crate) use import::sweep_import_staging;
pub use import::{ImportEvent, ImportOutcome, OpenedLive, RemoteProject};
pub(crate) use oleafly_online::projects::OverleafLink;
pub(crate) use signin::sweep_browser_profiles;
pub(crate) use signin::LABEL_PREFIX as SIGN_IN_LABEL_PREFIX;
pub(crate) use sync::AppMirrorGit;
pub use sync::Side;

use std::collections::BTreeMap;

use crate::app_error::AppError;
use crate::collab::live::overleaf::account::{
    overleaf_signed_in, overleaf_signed_out, overleaf_stop_live, overleaf_unsent,
};
use crate::collab::live::overleaf::off_runtime;
use crate::collab::live::{UnsentProject, SIGN_OUT_WAIT};

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OverleafStatus {
    pub server: String,
    pub signed_in: bool,
    pub email: Option<String>,
    pub user_id: Option<String>,
    pub accounts: Vec<OverleafAccount>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OverleafAccount {
    pub user_id: String,
    pub email: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OverleafSignIn {
    pub server: String,
    pub user_id: String,
    pub email: Option<String>,
    pub current: bool,
    pub signed_in_at: Option<i64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OverleafProjects {
    pub status: OverleafStatus,
    pub projects: Vec<RemoteProject>,
    pub invites: Vec<oleafly_online::client::ProjectInvite>,
}

fn email_of(session: &session::Session) -> Option<String> {
    known_email(&session.email)
}

fn known_email(email: &str) -> Option<String> {
    Some(email.to_owned()).filter(|email| !email.is_empty())
}

fn status_for(base: &str, accounts: &[session::Session]) -> OverleafStatus {
    let current = accounts.first();
    OverleafStatus {
        server: base.to_string(),
        signed_in: current.is_some(),
        email: current.and_then(email_of),
        user_id: current.map(|session| session.user_id.clone()),
        accounts: accounts
            .iter()
            .map(|session| OverleafAccount {
                user_id: session.user_id.clone(),
                email: email_of(session),
            })
            .collect(),
    }
}

async fn stored_status(base: &str) -> Result<OverleafStatus, String> {
    let base = base.to_owned();
    blocking(move || Ok(status_for(&base, &session::accounts(&base)?))).await
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    off_runtime(work).await?
}

async fn keep_session(base: String, signed_in: session::Session) -> Result<OverleafStatus, String> {
    blocking(move || {
        session::save(&base, &signed_in)?;
        overleaf_signed_in(&base, &signed_in)?;
        Ok(status_for(&base, &session::accounts(&base)?))
    })
    .await
}

#[tauri::command]
pub async fn overleaf_status(server: Option<String>) -> Result<OverleafStatus, String> {
    let base = session::normalize_server(server.as_deref())?;
    stored_status(&base).await
}

#[tauri::command]
pub async fn overleaf_sign_ins() -> Result<Vec<OverleafSignIn>, String> {
    blocking(|| {
        Ok(session::sign_ins()?
            .into_iter()
            .map(|sign_in| OverleafSignIn {
                email: known_email(&sign_in.email),
                server: sign_in.server,
                user_id: sign_in.user_id,
                current: sign_in.current,
                signed_in_at: sign_in.signed_in_at,
            })
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn overleaf_use_account(
    server: Option<String>,
    account: String,
) -> Result<OverleafStatus, String> {
    let base = session::normalize_server(server.as_deref())?;
    blocking(move || {
        if !session::use_account(&base, &account)? {
            return Err(AppError::new("overleaf.signed_out").into());
        }
        Ok(status_for(&base, &session::accounts(&base)?))
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
    keep_session(base, signed_in).await
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SignInBrowser {
    pub key: String,
    pub name: String,
}

fn main_window_only<R: Runtime>(webview: &tauri::Webview<R>) -> Result<(), String> {
    if crate::caller::own_window_label(webview).as_deref() == Some("main") {
        Ok(())
    } else {
        Err(AppError::new("overleaf.sign_in_failed").into())
    }
}

#[tauri::command]
pub async fn overleaf_sign_in_browsers<R: Runtime>(
    webview: tauri::Webview<R>,
) -> Result<Vec<SignInBrowser>, String> {
    main_window_only(&webview)?;
    blocking(|| {
        Ok(signin::sign_in_browsers()
            .iter()
            .map(|browser| SignInBrowser {
                key: browser.key(),
                name: browser.name(),
            })
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn overleaf_browser_icons<R: Runtime>(
    webview: tauri::Webview<R>,
) -> Result<BTreeMap<String, String>, String> {
    main_window_only(&webview)?;
    blocking(|| Ok(signin::browser_icons())).await
}

#[tauri::command]
pub async fn overleaf_sign_in_with_browser<R: Runtime>(
    webview: tauri::Webview<R>,
    server: Option<String>,
    browser: String,
) -> Result<OverleafStatus, String> {
    main_window_only(&webview)?;
    let base = session::normalize_server(server.as_deref())?;
    let chosen = blocking(move || {
        signin::sign_in_browsers()
            .into_iter()
            .find(|installed| installed.key() == browser)
            .ok_or_else(|| AppError::new("overleaf.browser_missing").into())
    })
    .await?;
    let signed_in = signin::sign_in_with_browser(&base, chosen).await?;
    keep_session(base, signed_in).await
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
    main_window_only(&webview)?;
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
    keep_session(base, signed_in).await
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

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OverleafSignOut {
    #[serde(flatten)]
    pub status: OverleafStatus,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unsent: Vec<UnsentProject>,
}

pub(crate) async fn sign_out_within(
    base: String,
    account: Option<String>,
    keep_local_copy: bool,
    wait: std::time::Duration,
) -> Result<OverleafSignOut, String> {
    let account = account.as_deref();
    let unsent = overleaf_unsent(&base, account, wait).await?;
    if !unsent.is_empty() && !keep_local_copy {
        let status = stored_status(&base).await?;
        return Ok(OverleafSignOut { status, unsent });
    }
    overleaf_stop_live(&base, account).await;
    let (forget_base, forget_account) = (base.clone(), account.map(str::to_owned));
    blocking(move || session::forget(&forget_base, forget_account.as_deref())).await?;
    overleaf_signed_out(&base, account).await;
    Ok(OverleafSignOut {
        status: stored_status(&base).await?,
        unsent,
    })
}

#[tauri::command]
pub async fn overleaf_sign_out(
    server: Option<String>,
    account: Option<String>,
    keep_local_copy: Option<bool>,
) -> Result<OverleafSignOut, String> {
    let base = session::normalize_server(server.as_deref())?;
    sign_out_within(
        base,
        account,
        keep_local_copy.unwrap_or(false),
        SIGN_OUT_WAIT,
    )
    .await
}

#[tauri::command]
pub async fn overleaf_list_projects(
    server: Option<String>,
    account: Option<String>,
) -> Result<OverleafProjects, String> {
    let base = session::normalize_server(server.as_deref())?;
    let listing = import::list(&base, account.as_deref()).await?;
    Ok(OverleafProjects {
        status: stored_status(&base).await?,
        projects: listing.projects,
        invites: listing.invites,
    })
}

#[tauri::command]
pub async fn overleaf_import_projects<R: Runtime>(
    app: AppHandle<R>,
    server: Option<String>,
    account: Option<String>,
    ids: Vec<String>,
    on_event: Channel<ImportEvent>,
) -> Result<Vec<ImportOutcome>, String> {
    let base = session::normalize_server(server.as_deref())?;
    let emit = move |event: ImportEvent| {
        let _ = on_event.send(event);
    };
    let outcomes = import::import(&base, account.as_deref(), &ids, &emit).await?;
    for project_id in outcomes
        .iter()
        .filter_map(|outcome| outcome.project_id.as_deref())
    {
        crate::project::record_tex_spec_for_new_project(&app, project_id);
    }
    Ok(outcomes)
}

#[tauri::command]
pub async fn overleaf_open_live<R: Runtime>(
    app: AppHandle<R>,
    server: Option<String>,
    account: Option<String>,
    remote_id: String,
) -> Result<OpenedLive, String> {
    let base = session::normalize_server(server.as_deref())?;
    let opened = import::open_live(&base, account.as_deref(), &remote_id).await?;
    if !opened.reused {
        crate::project::record_tex_spec_for_new_project(&app, &opened.project_id);
    }
    Ok(opened)
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
    oleafly_online::projects::imported_from(meta.extra.get("importedFrom")?)
}

pub(crate) fn unlink_project(project_id: &str) -> Result<(), String> {
    let _guard = sync::claim(project_id)?;
    if sync::read_link(project_id)?.is_some() {
        sync::retire_mirror(project_id)?;
    }
    let mut meta = crate::project::read_meta(project_id)?;
    if meta.extra.remove("importedFrom").is_some() {
        crate::project::write_meta(project_id, &meta)?;
    }
    Ok(())
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

pub(crate) fn overleaf_link_of(project_id: &str) -> Result<Option<OverleafLink>, String> {
    Ok(oleafly_online::projects::live_link(
        current_link(project_id)?,
        imported_from(project_id),
    ))
}

pub(crate) fn linked_account(project_id: &str) -> Option<OverleafAccount> {
    let origin = imported_from(project_id)?;
    Some(OverleafAccount {
        user_id: origin.user_id?,
        email: origin.email,
    })
}

pub(crate) fn record_linked_account(
    project_id: &str,
    link: &OverleafLink,
    user_id: &str,
    email: &str,
) -> Result<bool, String> {
    crate::project::update_imported_from(project_id, |record| {
        let origin = oleafly_online::projects::imported_from(record);
        if origin.is_none_or(|origin| {
            origin.server != link.server
                || origin.project_id != link.project_id
                || origin.user_id.is_some()
        }) {
            return false;
        }
        oleafly_online::projects::record_account(record, user_id, email)
    })
}

pub(crate) fn live_session(
    link: &OverleafLink,
) -> Result<
    Option<(
        oleafly_online::client::Http,
        oleafly_online::session::SessionHandle,
    )>,
    String,
> {
    let Some(stored) = session::load(&link.server, link.user_id.as_deref())? else {
        return Ok(None);
    };
    let http = client::Http::new(&link.server)?.online().clone();
    let store = crate::secrets::store()?;
    Ok(Some((
        http,
        oleafly_online::session::SessionHandle::new(&link.server, stored, Some(store)),
    )))
}

pub(crate) fn linked_git(project_id: &str) -> Option<oleafly_live::overleaf::GitBase> {
    sync::read_link(project_id).ok().flatten()?;
    Some(oleafly_live::overleaf::GitBase {
        repo: sync::repo_dir(project_id).ok()?,
        git: std::sync::Arc::new(AppMirrorGit),
    })
}

fn linked(project_id: &str) -> Result<sync::SyncLink, String> {
    current_link(project_id)?.ok_or_else(|| AppError::new("overleaf.sync_not_linked").into())
}

fn sync_status(project_id: &str) -> Result<SyncStatus, String> {
    let link = current_link(project_id)?;
    let imported = imported_from(project_id);
    let link_of = overleaf_link_of(project_id)?;
    let account = link_of.as_ref().and_then(|link| link.user_id.clone());
    let server = link_of
        .map(|link| link.server)
        .unwrap_or_else(|| session::DEFAULT_SERVER.to_string());
    Ok(SyncStatus {
        token_saved: session::git_token(&server, account.as_deref())?.is_some(),
        linked: link.is_some(),
        remote_id: link.as_ref().map(|link| link.remote_id.clone()),
        auto: link.as_ref().is_some_and(|link| link.auto),
        last_sync_at: link.as_ref().and_then(|link| link.last_sync_at),
        imported_from: imported,
        server,
        backups_folder: None,
    })
}

fn required_token(base: &str, account: Option<&str>) -> Result<String, String> {
    session::git_token(base, account)?
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
pub async fn overleaf_git_token_status(
    server: Option<String>,
    account: Option<String>,
) -> Result<bool, String> {
    let base = session::normalize_server(server.as_deref())?;
    blocking(move || Ok(session::git_token(&base, account.as_deref())?.is_some())).await
}

#[tauri::command]
pub async fn overleaf_git_token_set(
    server: Option<String>,
    account: Option<String>,
    token: String,
) -> Result<(), String> {
    let base = session::normalize_server(server.as_deref())?;
    blocking(move || session::save_git_token(&base, account.as_deref(), &token)).await
}

#[tauri::command]
pub async fn overleaf_git_token_clear(
    server: Option<String>,
    account: Option<String>,
) -> Result<(), String> {
    let base = session::normalize_server(server.as_deref())?;
    blocking(move || session::forget_git_token(&base, account.as_deref())).await
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
    let (token_project, token_base, token_remote) =
        (project_id.clone(), base.clone(), remote_id.clone());
    let token = blocking(move || {
        let account = imported_from(&token_project)
            .filter(|origin| origin.server == token_base && origin.project_id == token_remote)
            .and_then(|origin| origin.user_id);
        required_token(&token_base, account.as_deref())
    })
    .await?;
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
    let (link, token) = blocking(move || {
        let link = linked(&link_id)?;
        let account = imported_from(&link_id).and_then(|origin| origin.user_id);
        let token = required_token(&link.server, account.as_deref())?;
        Ok((link, token))
    })
    .await?;
    let url = sync::remote_url(&link.server, &link.remote_id)?;
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

async fn live_stands_down(project_id: &str) -> Result<(), String> {
    let id = project_id.to_owned();
    if blocking(move || {
        crate::collab::live::overleaf::git_sync_waits(&id).map_err(|error| error.to_string())
    })
    .await?
    {
        return Err(errors::app_error(oleafly_online::error::OnlineError::new(
            oleafly_online::error::OnlineErrorKind::SyncBusy,
        )));
    }
    Ok(())
}

#[tauri::command]
pub async fn overleaf_sync_check(project_id: String) -> Result<SyncReport, String> {
    live_stands_down(&project_id).await?;
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
    live_stands_down(&project_id).await?;
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
