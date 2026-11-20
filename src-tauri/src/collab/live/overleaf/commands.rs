use std::sync::Arc;
use std::time::{Duration, Instant};

use oleafly_collab::sync::{EndReason, LiveStatus};
use oleafly_collab::CollabError;
use oleafly_online::live::journal::{Journal, JournalError};
use oleafly_online::live::session::{SessionConfig, SessionTuning};
use oleafly_online::realtime::Carrier;
use serde::Serialize;

use super::{collab_shared, live_backend_for, mirror_dir, Backend, OverleafLive, Parts};
use crate::collab::commands::{signed_out, CollabCommandError};
use crate::collab::live::host::{AppLiveHost, LiveHost};
use crate::collab::live::lifecycle::{stop, stop_any};
use crate::collab::live::payloads::{LiveInfo, OverleafMember, StatusPayload};
use crate::collab::live::session::{
    guard, io, live_for, not_live, Live, Starting, ACTIVE, LIFECYCLE, STARTING,
};
use crate::collab::state::CollabState;
use crate::overleaf::OverleafLink;

fn live_elsewhere() -> CollabError {
    CollabError::Api {
        status: 409,
        code: "live_elsewhere".to_owned(),
        message: "this project is live in another Oleafly window".to_owned(),
    }
}

async fn open_journal(
    data: std::path::PathBuf,
    server: String,
    project: String,
    root: std::path::PathBuf,
) -> Result<Journal, CollabError> {
    tauri::async_runtime::spawn_blocking(move || {
        Journal::open(&data, &server, &project, Some(&root))
    })
    .await
    .map_err(io)?
    .map_err(|error| match error {
        JournalError::Busy => live_elsewhere(),
        other => CollabError::Io(other.to_string()),
    })
}

struct Prepared {
    link: OverleafLink,
    http: oleafly_online::client::Http,
    session: oleafly_online::session::SessionHandle,
    root: std::path::PathBuf,
    data: std::path::PathBuf,
    mirror_dir: std::path::PathBuf,
    git_mirror: Option<std::path::PathBuf>,
}

fn prepare(
    paths: &oleafly_collab::CollabPaths,
    project_id: &str,
) -> Result<Option<Prepared>, CollabError> {
    let link = match live_backend_for(paths, project_id, true)? {
        Some(Backend::Overleaf(link)) => link,
        Some(Backend::Server | Backend::Both) => return Err(collab_shared()),
        None => return Err(not_live()),
    };
    let Some((http, session)) =
        crate::overleaf::live_session(&link.server).map_err(CollabError::Io)?
    else {
        return Ok(None);
    };
    let root = crate::paths::project_dir(project_id).map_err(CollabError::Io)?;
    let data = crate::paths::oleafly_root().map_err(CollabError::Io)?;
    Ok(Some(Prepared {
        mirror_dir: mirror_dir(&data, &link, project_id)?,
        git_mirror: crate::overleaf::linked_mirror(project_id),
        link,
        http,
        session,
        root,
        data,
    }))
}

fn joining(project_id: &str) -> Option<Arc<tokio::sync::Mutex<()>>> {
    guard(&STARTING)
        .as_ref()
        .filter(|starting| starting.project_id == project_id)
        .map(|starting| Arc::clone(&starting.joined))
}

fn end_start(joined: &Arc<tokio::sync::Mutex<()>>) -> bool {
    let mut slot = guard(&STARTING);
    let ours = slot
        .as_ref()
        .is_some_and(|starting| Arc::ptr_eq(&starting.joined, joined));
    let wanted = ours && slot.as_ref().is_some_and(|starting| starting.wanted);
    if ours {
        *slot = None;
    }
    wanted
}

pub(crate) async fn start(
    host: Arc<dyn LiveHost>,
    paths: &oleafly_collab::CollabPaths,
    project_id: &str,
) -> Result<LiveInfo, CollabError> {
    if let Some(Live::Overleaf(live)) = live_for(project_id) {
        live.repeat_status();
        return Ok(live.info());
    }
    let checked = {
        let (paths, id) = (paths.clone(), project_id.to_owned());
        tauri::async_runtime::spawn_blocking(move || prepare(&paths, &id))
            .await
            .map_err(io)??
    };
    let Some(prepared) = checked else {
        host.status(StatusPayload {
            project_id: project_id.to_owned(),
            status: LiveStatus::Ended {
                reason: EndReason::SignedOut,
            },
            pending: 0,
        });
        return Err(signed_out());
    };
    let (joined, held, journal) = loop {
        let lifecycle = LIFECYCLE.lock().await;
        if let Some(Live::Overleaf(live)) = live_for(project_id) {
            live.repeat_status();
            return Ok(live.info());
        }
        if let Some(joined) = joining(project_id) {
            drop(lifecycle);
            drop(joined.lock().await);
            continue;
        }
        stop_any().await;
        let joined = Arc::new(tokio::sync::Mutex::new(()));
        let held = Arc::clone(&joined).lock_owned().await;
        *guard(&STARTING) = Some(Starting {
            project_id: project_id.to_owned(),
            joined: Arc::clone(&joined),
            wanted: true,
        });
        let journal = open_journal(
            prepared.data.clone(),
            prepared.link.server.clone(),
            prepared.link.project_id.clone(),
            prepared.root.clone(),
        )
        .await;
        match journal {
            Ok(journal) => break (joined, held, journal),
            Err(error) => {
                end_start(&joined);
                return Err(error);
            }
        }
    };
    let Prepared {
        link,
        http,
        session,
        root,
        mirror_dir,
        git_mirror,
        ..
    } = prepared;
    let parts = Parts {
        project_id: project_id.to_owned(),
        mirror_dir,
        root,
        host,
        config: SessionConfig {
            http,
            session,
            project_id: link.project_id.clone(),
            carriers: vec![Carrier::WebSocket, Carrier::XhrPolling],
            tuning: SessionTuning::default(),
            seeds: Vec::new(),
        },
        link,
        journal,
        git_mirror,
    };
    let started = OverleafLive::start_with(parts).await;
    let lifecycle = LIFECYCLE.lock().await;
    let ours = end_start(&joined);
    let live = started?;
    if !ours || guard(&ACTIVE).is_some() {
        drop(lifecycle);
        live.finish().await;
        drop(live);
        drop(held);
        return Err(not_live());
    }
    *guard(&ACTIVE) = Some(Live::Overleaf(Arc::clone(&live)));
    drop(lifecycle);
    drop(held);
    Live::Overleaf(Arc::clone(&live)).import_later(None);
    Ok(live.info())
}

#[tauri::command]
pub async fn overleaf_live_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
) -> Result<LiveInfo, CollabCommandError> {
    let host: Arc<dyn LiveHost> = Arc::new(AppLiveHost::new(app.clone()));
    let info = start(host, state.paths()?, &project_id)
        .await
        .map_err(CollabCommandError::from)?;
    crate::collab::live::commands::settle_started(app, project_id).await;
    Ok(info)
}

#[tauri::command]
pub async fn overleaf_live_stop(project_id: String) -> Result<(), CollabCommandError> {
    stop(&project_id).await;
    Ok(())
}

const PAUSE_WAIT: Duration = Duration::from_secs(10);
const JOURNAL_WAIT: Duration = Duration::from_secs(5);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PauseOutcome {
    pub paused: bool,
    pub unsent: Vec<String>,
}

pub(crate) async fn pause(
    project_id: &str,
    anyway: bool,
    wait: Duration,
) -> Result<PauseOutcome, CollabError> {
    let live = match live_for(project_id) {
        Some(Live::Overleaf(live)) => live,
        Some(Live::Server(_)) | None => return Err(not_live()),
    };
    if !anyway {
        let unsent = live.session.unsent(wait).await;
        if !unsent.is_empty() {
            return Ok(PauseOutcome {
                paused: false,
                unsent: unsent.into_iter().map(|doc| doc.path).collect(),
            });
        }
    }
    let link = live.link.clone();
    drop(live);
    stop(project_id).await;
    set_paused(&link, true).await?;
    Ok(PauseOutcome {
        paused: true,
        unsent: Vec::new(),
    })
}

fn write_paused(link: &OverleafLink, paused: bool) -> Result<bool, CollabError> {
    let data = crate::paths::oleafly_root().map_err(CollabError::Io)?;
    match Journal::open(&data, &link.server, &link.project_id, None) {
        Ok(mut journal) => {
            if journal.manifest().paused != paused {
                let mut manifest = journal.manifest().clone();
                manifest.paused = paused;
                journal.set_manifest(manifest);
                journal.flush().map_err(CollabError::Io)?;
            }
            Ok(true)
        }
        Err(JournalError::Busy) => Ok(false),
        Err(error) => Err(CollabError::Io(error.to_string())),
    }
}

async fn set_paused(link: &OverleafLink, paused: bool) -> Result<(), CollabError> {
    let started = Instant::now();
    loop {
        let link = link.clone();
        let written = tauri::async_runtime::spawn_blocking(move || write_paused(&link, paused))
            .await
            .map_err(io)??;
        if written {
            return Ok(());
        }
        if started.elapsed() >= JOURNAL_WAIT {
            return Err(live_elsewhere());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[tauri::command]
pub async fn overleaf_live_pause(
    project_id: String,
    anyway: Option<bool>,
) -> Result<PauseOutcome, CollabCommandError> {
    pause(&project_id, anyway.unwrap_or(false), PAUSE_WAIT)
        .await
        .map_err(CollabCommandError::from)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverleafLiveProject {
    pub server: String,
    pub remote_id: String,
    pub signed_in: bool,
    pub paused: bool,
}

pub(crate) fn live_project(project_id: &str) -> Result<Option<OverleafLiveProject>, CollabError> {
    let Some(link) = crate::overleaf::overleaf_link_of(project_id).map_err(CollabError::Io)? else {
        return Ok(None);
    };
    let signed_in = crate::overleaf::live_session(&link.server)
        .map_err(CollabError::Io)?
        .is_some();
    let live = matches!(live_for(project_id), Some(Live::Overleaf(_)));
    Ok(Some(OverleafLiveProject {
        paused: !live && paused(&link)?,
        server: link.server,
        remote_id: link.project_id,
        signed_in,
    }))
}

fn paused(link: &OverleafLink) -> Result<bool, CollabError> {
    let data = crate::paths::oleafly_root().map_err(CollabError::Io)?;
    let dir = oleafly_online::live::journal::journal_dir(&data, &link.server, &link.project_id)
        .map_err(|error| CollabError::Io(error.to_string()))?;
    if !dir.is_dir() {
        return Ok(false);
    }
    match Journal::open(&data, &link.server, &link.project_id, None) {
        Ok(journal) => Ok(journal.manifest().paused),
        Err(JournalError::Busy) => Ok(false),
        Err(error) => Err(CollabError::Io(error.to_string())),
    }
}

#[tauri::command]
pub async fn overleaf_live_members(project_id: String) -> Vec<OverleafMember> {
    match live_for(&project_id) {
        Some(Live::Overleaf(live)) => live.members(),
        _ => Vec::new(),
    }
}

#[tauri::command]
pub async fn overleaf_live_project(
    project_id: String,
) -> Result<Option<OverleafLiveProject>, CollabCommandError> {
    tauri::async_runtime::spawn_blocking(move || live_project(&project_id))
        .await
        .map_err(io)
        .and_then(|result| result)
        .map_err(CollabCommandError::from)
}

pub(crate) async fn resume(project_id: &str) -> Result<(), CollabError> {
    let id = project_id.to_owned();
    let link = tauri::async_runtime::spawn_blocking(move || crate::overleaf::overleaf_link_of(&id))
        .await
        .map_err(io)?
        .map_err(CollabError::Io)?
        .ok_or_else(not_live)?;
    set_paused(&link, false).await
}

#[tauri::command]
pub async fn overleaf_live_resume(project_id: String) -> Result<(), CollabCommandError> {
    resume(&project_id).await.map_err(CollabCommandError::from)
}

fn overleaf_unsent() -> CollabError {
    CollabError::Api {
        status: 409,
        code: "overleaf_unsent".to_owned(),
        message: "this project has changes that haven't reached Overleaf".to_owned(),
    }
}

pub(crate) async fn unlink(project_id: &str) -> Result<(), CollabError> {
    if let Some(Live::Overleaf(live)) = live_for(project_id) {
        if !live.session.unsent(PAUSE_WAIT).await.is_empty() {
            return Err(overleaf_unsent());
        }
        drop(live);
        stop(project_id).await;
    }
    let id = project_id.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(link) = crate::overleaf::overleaf_link_of(&id).map_err(CollabError::Io)? {
            if super::unsent_journal(&link)? {
                return Err(overleaf_unsent());
            }
        }
        crate::overleaf::unlink_project(&id).map_err(CollabError::Io)
    })
    .await
    .map_err(io)?
}

#[tauri::command]
pub async fn overleaf_live_unlink(project_id: String) -> Result<(), CollabCommandError> {
    unlink(&project_id).await.map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn overleaf_live_delete(
    project_id: String,
    paths: Vec<String>,
    on_overleaf: bool,
) -> Result<(), CollabCommandError> {
    let Some(Live::Overleaf(live)) = live_for(&project_id) else {
        return Err(CollabCommandError::from(not_live()));
    };
    live.decide_deletes(&paths, on_overleaf);
    Ok(())
}

#[tauri::command]
pub async fn overleaf_live_restore(
    project_id: String,
    path: String,
) -> Result<(), CollabCommandError> {
    let Some(Live::Overleaf(live)) = live_for(&project_id) else {
        return Err(CollabCommandError::from(not_live()));
    };
    live.restore(&path).await.map_err(CollabCommandError::from)
}
