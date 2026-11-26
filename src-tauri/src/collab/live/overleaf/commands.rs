use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use oleafly_collab::sync::{EndReason, LiveStatus};
use oleafly_collab::CollabError;
use oleafly_core::app_log::AppLog;
use oleafly_online::live::journal::{self, Holder, HolderKind, Journal, JournalError};
use oleafly_online::live::session::linked::LinkedError;
use oleafly_online::live::session::spelling::{SpellStop, SPELL_BATCH};
use oleafly_online::live::session::{SessionConfig, SessionTuning};
use oleafly_online::realtime::Carrier;
use serde::Serialize;

use super::{
    collab_shared, holding, live_backend_for, mirror_dir, off_runtime, Backend, GitBase, Holding,
    OverleafLive, Parts,
};
use crate::app_error::AppError;
use crate::collab::commands::{signed_out, CollabCommandError};
use crate::collab::live::host::{AppLiveHost, DiskHost, LiveHost};
use crate::collab::live::lifecycle::{stop, stop_any};
use crate::collab::live::live_tree::LiveTree;
use crate::collab::live::payloads::{LiveInfo, OverleafMember, StatusPayload};
use crate::collab::live::session::{
    app_runtime, guard, io, links_changed, links_seen, live_for, not_live, Live, Starting, ACTIVE,
    LIFECYCLE, STARTING,
};
use crate::collab::state::CollabState;
use crate::overleaf::OverleafLink;

const JOURNAL_WAIT: Duration = Duration::from_secs(5);
const JOURNAL_CALL_WAIT: Duration = Duration::from_secs(10);
const RETRY_EVERY: Duration = Duration::from_millis(50);

pub(crate) fn live_elsewhere(holder: Option<Holder>) -> CollabError {
    let detail = JournalError::LiveElsewhere(holder.clone()).to_string();
    let message = match holder {
        Some(holder) => {
            let named = AppError::new("collab.live_elsewhere")
                .param("pid", holder.pid)
                .detail(detail);
            match serde_json::to_value(holder.by) {
                Ok(serde_json::Value::String(by)) => named.param("by", by),
                _ => named,
            }
            .into()
        }
        None => detail,
    };
    CollabError::Api {
        status: 409,
        code: "live_elsewhere".to_owned(),
        message,
    }
}

async fn journal_call<T: Send + 'static>(
    doing: &str,
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, CollabError> {
    match tokio::time::timeout(JOURNAL_CALL_WAIT, off_runtime(work)).await {
        Ok(done) => done.map_err(io),
        Err(_) => {
            let message = format!(
                "the live journal did not answer within {} s",
                JOURNAL_CALL_WAIT.as_secs()
            );
            let _ = crate::project::append_app_log(format!("{doing} failed: {message}"));
            Err(CollabError::Io(message))
        }
    }
}

async fn when_free<T: Send + 'static>(
    doing: &str,
    attempt: impl Fn() -> Result<Result<T, Holding>, CollabError> + Send + Sync + 'static,
) -> Result<T, CollabError> {
    let attempt = Arc::new(attempt);
    let started = Instant::now();
    loop {
        let step = Arc::clone(&attempt);
        match journal_call(doing, move || step()).await?? {
            Ok(done) => return Ok(done),
            Err(Holding::Elsewhere(holder)) => return Err(live_elsewhere(holder)),
            Err(Holding::Ours | Holding::Free) if started.elapsed() < JOURNAL_WAIT => {
                tokio::time::sleep(RETRY_EVERY).await;
            }
            Err(Holding::Ours | Holding::Free) => return Err(live_elsewhere(None)),
        }
    }
}

fn opened(
    data: &Path,
    link: &OverleafLink,
    root: &Path,
) -> Result<Result<Journal, Holding>, CollabError> {
    let held = holding(data, link, Some(root));
    if !matches!(held, Holding::Free) {
        return Ok(Err(held));
    }
    match Journal::open_live(data, &link.server, &link.project_id, root, HolderKind::App) {
        Ok(journal) => Ok(Ok(journal)),
        Err(JournalError::Busy | JournalError::LiveElsewhere(_)) => {
            Ok(Err(holding(data, link, Some(root))))
        }
        Err(error) => Err(CollabError::Io(error.to_string())),
    }
}

async fn open_journal(
    data: PathBuf,
    link: OverleafLink,
    root: PathBuf,
) -> Result<Journal, CollabError> {
    when_free("Starting Overleaf live editing", move || {
        opened(&data, &link, &root)
    })
    .await
}

struct Prepared {
    link: OverleafLink,
    http: oleafly_online::client::Http,
    session: oleafly_online::session::SessionHandle,
    root: PathBuf,
    data: PathBuf,
    mirror_dir: PathBuf,
    git: Option<GitBase>,
    opening: bool,
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
    let Some((http, session)) = crate::overleaf::live_session(&link).map_err(CollabError::Io)?
    else {
        return Ok(None);
    };
    let root = crate::paths::project_dir(project_id).map_err(CollabError::Io)?;
    let data = crate::paths::oleafly_root().map_err(CollabError::Io)?;
    let mirror_dir = mirror_dir(&data, &link, project_id)?;
    Ok(Some(Prepared {
        opening: super::opening::marked(&mirror_dir),
        mirror_dir,
        git: crate::overleaf::linked_git(project_id),
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

pub(crate) fn live_now(project_id: &str) -> Option<Arc<OverleafLive>> {
    live_for(project_id)
        .and_then(|live| live.overleaf().cloned())
        .filter(|live| !live.ended())
}

async fn check(
    paths: &oleafly_collab::CollabPaths,
    project_id: &str,
) -> Result<Option<Prepared>, CollabError> {
    let (paths, id) = (paths.clone(), project_id.to_owned());
    off_runtime(move || prepare(&paths, &id))
        .await
        .map_err(io)?
}

fn stopped(host: &dyn LiveHost, project_id: &str, reason: EndReason) {
    host.status(StatusPayload {
        project_id: project_id.to_owned(),
        status: LiveStatus::Ended { reason },
        pending: 0,
    });
}

pub(crate) async fn start(
    host: Arc<dyn LiveHost>,
    paths: &oleafly_collab::CollabPaths,
    project_id: &str,
) -> Result<LiveInfo, CollabError> {
    if let Some(live) = live_now(project_id) {
        live.repeat_status();
        return Ok(live.info());
    }
    let mut seen = links_seen();
    let mut checked = check(paths, project_id).await?;
    let (prepared, joined, held, journal, cancelled) = loop {
        let Some(prepared) = checked.take() else {
            stopped(host.as_ref(), project_id, EndReason::SignedOut);
            return Err(signed_out());
        };
        let lifecycle = LIFECYCLE.lock().await;
        if let Some(live) = live_now(project_id) {
            live.repeat_status();
            return Ok(live.info());
        }
        if let Some(joined) = joining(project_id) {
            drop(lifecycle);
            drop(joined.lock().await);
            checked = Some(prepared);
            continue;
        }
        if links_seen() != seen {
            drop(lifecycle);
            seen = links_seen();
            checked = check(paths, project_id).await?;
            continue;
        }
        stop_any().await;
        let joined = Arc::new(tokio::sync::Mutex::new(()));
        let held = Arc::clone(&joined).lock_owned().await;
        let cancelled = Arc::new(tokio::sync::Notify::new());
        *guard(&STARTING) = Some(Starting {
            project_id: project_id.to_owned(),
            server: prepared.link.server.clone(),
            user: prepared.session.user_id().to_owned(),
            joined: Arc::clone(&joined),
            cancelled: Arc::clone(&cancelled),
            wanted: true,
        });
        let journal = open_journal(
            prepared.data.clone(),
            prepared.link.clone(),
            prepared.root.clone(),
        )
        .await;
        match journal {
            Ok(journal) => break (prepared, joined, held, journal, cancelled),
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
        data,
        mirror_dir,
        git,
        opening,
    } = prepared;
    let parts = Parts {
        project_id: project_id.to_owned(),
        mirror_dir,
        root,
        host: Arc::clone(&host) as Arc<dyn DiskHost>,
        config: SessionConfig {
            http,
            session,
            project_id: link.project_id.clone(),
            carriers: vec![Carrier::WebSocket, Carrier::XhrPolling],
            tuning: SessionTuning::default(),
            seeds: Vec::new(),
            fill: opening,
        },
        link,
        journal,
        git,
        runtime: app_runtime(),
        log: AppLog::at(&data),
    };
    let started = tokio::select! {
        started = OverleafLive::start_with(parts, Arc::clone(&host)) => Some(started),
        () = cancelled.notified() => None,
    };
    let lifecycle = LIFECYCLE.lock().await;
    let ours = end_start(&joined);
    let Some(started) = started else {
        drop(lifecycle);
        drop(held);
        stopped(host.as_ref(), project_id, EndReason::Stopped);
        return Err(not_live());
    };
    let live = started?;
    if !ours || live.ended() || guard(&ACTIVE).is_some() {
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
    set_paused(project_id, &link, true).await?;
    Ok(PauseOutcome {
        paused: true,
        unsent: Vec::new(),
    })
}

fn write_paused(
    project_id: &str,
    link: &OverleafLink,
    paused: bool,
) -> Result<Result<(), Holding>, CollabError> {
    let data = crate::paths::oleafly_root().map_err(CollabError::Io)?;
    let folder = crate::paths::project_dir(project_id).ok();
    let held = holding(&data, link, folder.as_deref());
    if !matches!(held, Holding::Free) {
        return Ok(Err(held));
    }
    match Journal::open(&data, &link.server, &link.project_id, None) {
        Ok(mut journal) => {
            if journal.manifest().paused != paused {
                let mut manifest = journal.manifest().clone();
                manifest.paused = paused;
                journal.set_manifest(manifest);
                journal.flush().map_err(CollabError::Io)?;
            }
            Ok(Ok(()))
        }
        Err(JournalError::Busy) => Ok(Err(holding(&data, link, folder.as_deref()))),
        Err(error) => Err(CollabError::Io(error.to_string())),
    }
}

async fn set_paused(
    project_id: &str,
    link: &OverleafLink,
    paused: bool,
) -> Result<(), CollabError> {
    let (id, link) = (project_id.to_owned(), link.clone());
    let doing = if paused {
        "Pausing Overleaf live editing"
    } else {
        "Resuming Overleaf live editing"
    };
    when_free(doing, move || write_paused(&id, &link, paused)).await
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
    pub account: Option<crate::overleaf::OverleafAccount>,
    pub unfilled: bool,
}

pub(crate) fn live_project(project_id: &str) -> Result<Option<OverleafLiveProject>, CollabError> {
    let Some(link) = crate::overleaf::overleaf_link_of(project_id).map_err(CollabError::Io)? else {
        return Ok(None);
    };
    let signed_in = crate::overleaf::live_session(&link)
        .map_err(CollabError::Io)?
        .is_some();
    let live = matches!(live_for(project_id), Some(Live::Overleaf(_)));
    Ok(Some(OverleafLiveProject {
        unfilled: unfilled(&link, project_id)?,
        paused: !live && paused(&link)?,
        account: crate::overleaf::linked_account(project_id),
        server: link.server,
        remote_id: link.project_id,
        signed_in,
    }))
}

fn unfilled(link: &OverleafLink, project_id: &str) -> Result<bool, CollabError> {
    let data = crate::paths::oleafly_root().map_err(CollabError::Io)?;
    if !super::opening::marked(&mirror_dir(&data, link, project_id)?) {
        return Ok(false);
    }
    let root = crate::paths::project_dir(project_id).map_err(CollabError::Io)?;
    let scan = crate::collab::disk::scan_folder(&root).map_err(CollabError::Io)?;
    Ok(scan.files.is_empty())
}

fn paused(link: &OverleafLink) -> Result<bool, CollabError> {
    let data = crate::paths::oleafly_root().map_err(CollabError::Io)?;
    Ok(journal::manifest_of(&data, &link.server, &link.project_id)
        .is_some_and(|manifest| manifest.paused))
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
    off_runtime(move || live_project(&project_id))
        .await
        .map_err(io)
        .and_then(|result| result)
        .map_err(CollabCommandError::from)
}

pub(crate) async fn resume(project_id: &str) -> Result<(), CollabError> {
    let id = project_id.to_owned();
    let link = off_runtime(move || crate::overleaf::overleaf_link_of(&id))
        .await
        .map_err(io)?
        .map_err(CollabError::Io)?
        .ok_or_else(not_live)?;
    set_paused(project_id, &link, false).await
}

#[tauri::command]
pub async fn overleaf_live_resume(project_id: String) -> Result<(), CollabCommandError> {
    resume(&project_id).await.map_err(CollabCommandError::from)
}

pub(super) fn overleaf_unsent() -> CollabError {
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
    }
    stop(project_id).await;
    let id = project_id.to_owned();
    let link = when_free("Unlinking the Overleaf project", move || {
        unlink_allowed(&id)
    })
    .await?;
    let id = project_id.to_owned();
    off_runtime(move || crate::overleaf::unlink_project(&id))
        .await
        .map_err(io)?
        .map_err(CollabError::Io)?;
    links_changed();
    stop(project_id).await;
    let Some(link) = link else {
        return Ok(());
    };
    let id = project_id.to_owned();
    off_runtime(move || {
        let folder = crate::paths::project_dir(&id).ok();
        let _ = super::forget_overleaf_project(&link, &id, folder.as_deref());
    })
    .await
    .map_err(io)
}

fn unlink_allowed(project_id: &str) -> Result<Result<Option<OverleafLink>, Holding>, CollabError> {
    let link = crate::overleaf::overleaf_link_of(project_id).map_err(CollabError::Io)?;
    if let Some(link) = &link {
        let data = crate::paths::oleafly_root().map_err(CollabError::Io)?;
        let folder = crate::paths::project_dir(project_id).ok();
        if let held @ Holding::Elsewhere(_) = holding(&data, link, folder.as_deref()) {
            return Ok(Err(held));
        }
        if super::unsent_journal(link)? {
            return Err(overleaf_unsent());
        }
    }
    Ok(Ok(link))
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

fn live_or_not(project_id: &str) -> Result<Arc<OverleafLive>, CollabCommandError> {
    live_now(project_id).ok_or_else(|| CollabCommandError::from(not_live()))
}

#[tauri::command]
pub async fn overleaf_live_refresh_linked(
    project_id: String,
    path: String,
) -> Result<(), CollabCommandError> {
    let live = live_or_not(&project_id)?;
    live.refresh_linked(&path)
        .await
        .map_err(CollabCommandError::from)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnedWords {
    pub account: String,
    pub words: Option<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordsSent {
    pub learned: Vec<String>,
    pub unlearned: Vec<String>,
    pub stopped: Option<&'static str>,
}

impl OverleafLive {
    pub(crate) async fn refresh_linked(&self, path: &str) -> Result<(), CollabError> {
        let project = &self.mirror.disk.project_id;
        let refused = |status: u16, code: &str, message: &str| {
            self.mirror.disk.log(format!(
                "Overleaf did not refresh the linked file {path} in project {project}: {message}"
            ));
            CollabError::Api {
                status,
                code: code.to_owned(),
                message: message.to_owned(),
            }
        };
        if !self.can_edit() {
            return Err(refused(
                403,
                "forbidden",
                "your role on this Overleaf project doesn't allow it",
            ));
        }
        let Some((file, _)) = self.mirror.linked_at(path) else {
            return Err(refused(
                400,
                "invalid",
                "that file isn't linked to a source",
            ));
        };
        match self.session.refresh_linked(&file).await {
            Ok(_) => Ok(()),
            Err(error) => Err(linked_failed(project, path, error)),
        }
    }

    pub(crate) fn learned_words(&self) -> LearnedWords {
        LearnedWords {
            account: format!(
                "{}\n{}",
                oleafly_online::session::origin_of(&self.link.server),
                self.me
            ),
            words: self.session.learned_words(),
        }
    }

    pub(crate) async fn learn_words(
        &self,
        learn: &[String],
        unlearn: &[String],
    ) -> Result<WordsSent, CollabError> {
        if learn.len() + unlearn.len() > SPELL_BATCH {
            return Err(CollabError::Api {
                status: 400,
                code: "invalid".to_owned(),
                message: format!("at most {SPELL_BATCH} words at a time"),
            });
        }
        let spelled = self.session.spell(learn, unlearn).await;
        let stopped = spelled.stopped.map(|stop| {
            let code = match stop {
                SpellStop::Ended => "cancelled",
                SpellStop::Full => "too_large",
                SpellStop::TimedOut => "unreachable",
                SpellStop::Refused(error) => {
                    let failed = CollabCommandError::from(super::history::rest_failed(error));
                    let _ = crate::project::append_app_log(format!(
                        "Overleaf did not take the learned words for project {}: {}",
                        self.mirror.disk.project_id, failed.message
                    ));
                    return failed.code;
                }
            };
            let _ = crate::project::append_app_log(format!(
                "Overleaf learned words stopped for project {}: {code}",
                self.mirror.disk.project_id
            ));
            code
        });
        Ok(WordsSent {
            learned: spelled.learned,
            unlearned: spelled.unlearned,
            stopped,
        })
    }
}

#[tauri::command]
pub async fn overleaf_live_learned_words(
    project_id: String,
) -> Result<LearnedWords, CollabCommandError> {
    Ok(live_or_not(&project_id)?.learned_words())
}

#[tauri::command]
pub async fn overleaf_live_learn_words(
    project_id: String,
    learn: Vec<String>,
    unlearn: Vec<String>,
) -> Result<WordsSent, CollabCommandError> {
    live_or_not(&project_id)?
        .learn_words(&learn, &unlearn)
        .await
        .map_err(CollabCommandError::from)
}

fn linked_failed(project: &str, path: &str, error: LinkedError) -> CollabError {
    let api = |status: u16, code: &str, message: String| CollabError::Api {
        status,
        code: code.to_owned(),
        message,
    };
    let told = match &error {
        LinkedError::Refused { status, .. } => format!("Overleaf refused it ({status})"),
        other => other.to_string(),
    };
    let _ = crate::project::append_app_log(format!(
        "Overleaf did not refresh the linked file {path} in project {project}: {told}"
    ));
    match error {
        LinkedError::Ended => not_live(),
        LinkedError::Unknown | LinkedError::Gone => {
            api(404, "not_found", "that file changed on Overleaf".to_owned())
        }
        LinkedError::NotLinked => api(
            400,
            "invalid",
            "that file isn't linked to a source".to_owned(),
        ),
        LinkedError::Off => api(
            400,
            "linked_off_server",
            "this Overleaf server doesn't refresh linked files".to_owned(),
        ),
        LinkedError::NotAllowed => api(
            403,
            "forbidden",
            "your role on this Overleaf project doesn't allow it".to_owned(),
        ),
        LinkedError::Refused { status, message } => api(status, "linked_refresh_failed", message),
        LinkedError::TimedOut(_) => api(503, "unreachable", error.to_string()),
        LinkedError::Rest(rest) => super::history::rest_failed(rest),
    }
}
