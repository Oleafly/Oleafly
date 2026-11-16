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
use crate::collab::live::payloads::{LiveInfo, StatusPayload};
use crate::collab::live::session::{guard, io, live_for, not_live, Live, ACTIVE, LIFECYCLE};
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

pub(crate) async fn start(
    host: Arc<dyn LiveHost>,
    paths: &oleafly_collab::CollabPaths,
    project_id: &str,
) -> Result<LiveInfo, CollabError> {
    let _lifecycle = LIFECYCLE.lock().await;
    if let Some(Live::Overleaf(live)) = live_for(project_id) {
        live.repeat_status();
        return Ok(live.info());
    }
    let link = match live_backend_for(paths, project_id, true)? {
        Some(Backend::Overleaf(link)) => link,
        Some(Backend::Server | Backend::Both) => return Err(collab_shared()),
        None => return Err(not_live()),
    };
    let Some((http, session)) =
        crate::overleaf::live_session(&link.server).map_err(CollabError::Io)?
    else {
        host.status(StatusPayload {
            project_id: project_id.to_owned(),
            status: LiveStatus::Ended {
                reason: EndReason::SignedOut,
            },
            pending: 0,
        });
        return Err(signed_out());
    };
    stop_any().await;
    let root = crate::paths::project_dir(project_id).map_err(CollabError::Io)?;
    let data = crate::paths::oleafly_root().map_err(CollabError::Io)?;
    let journal = open_journal(
        data.clone(),
        link.server.clone(),
        link.project_id.clone(),
        root.clone(),
    )
    .await?;
    let parts = Parts {
        project_id: project_id.to_owned(),
        mirror_dir: mirror_dir(&data, &link, project_id)?,
        root,
        host,
        config: SessionConfig {
            http,
            session,
            project_id: link.project_id.clone(),
            carriers: vec![Carrier::WebSocket, Carrier::XhrPolling],
            tuning: SessionTuning::default(),
        },
        link,
        journal,
    };
    let live = OverleafLive::start_with(parts).await?;
    *guard(&ACTIVE) = Some(Live::Overleaf(Arc::clone(&live)));
    let importing = Arc::clone(&live);
    tauri::async_runtime::spawn(async move {
        let _ = importing.import_paths(None).await;
    });
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
    mark_paused(&link).await?;
    Ok(PauseOutcome {
        paused: true,
        unsent: Vec::new(),
    })
}

async fn mark_paused(link: &OverleafLink) -> Result<(), CollabError> {
    let data = crate::paths::oleafly_root().map_err(CollabError::Io)?;
    let started = Instant::now();
    loop {
        match Journal::open(&data, &link.server, &link.project_id, None) {
            Ok(mut journal) => {
                let mut manifest = journal.manifest().clone();
                manifest.paused = true;
                journal.set_manifest(manifest);
                return journal.flush().map_err(CollabError::Io);
            }
            Err(JournalError::Busy) if started.elapsed() < JOURNAL_WAIT => {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(JournalError::Busy) => return Err(live_elsewhere()),
            Err(error) => return Err(CollabError::Io(error.to_string())),
        }
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
