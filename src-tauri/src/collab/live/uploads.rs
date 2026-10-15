use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex, Weak};
use std::time::{Duration, Instant};

use oleafly_collab::sync::{LiveLink, LiveStatus};
use oleafly_collab::{CollabError, TransferProgress};
use oleafly_collab_protocol::ids::{DeviceId, ServerId, SharedProjectId};
use serde::Serialize;

use super::{active_for, guard, not_live, Active, LiveHost};
use crate::collab::commands::{with_access, CollabCommandError};
use crate::collab::disk::safe_target;

pub const LIVE_UPLOADS_EVENT: &str = "collab-live-uploads";
pub const UPLOAD_PROGRESS_EVENT: &str = "collab-upload-progress";
// The window hears how far a figure's upload got at most this often, and
// once more when it has all been sent.
const PROGRESS_EVERY: Duration = Duration::from_millis(250);
const MEBIBYTE: u64 = 1024 * 1024;
const CHECK_ABOVE: u64 = 4 * MEBIBYTE;
const FIRST_RETRY: Duration = Duration::from_secs(2);
const LONGEST_RETRY: Duration = Duration::from_secs(60);
const RETRIES: u32 = 6;
const LIMIT_KEPT: Duration = Duration::from_secs(600);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UploadState {
    Waiting,
    Failed,
    TooLarge,
    ProjectTooLarge,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadFile {
    pub path: String,
    pub state: UploadState,
    pub size: u64,
    pub limit: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadsPayload {
    pub project_id: String,
    pub files: Vec<UploadFile>,
}

// How many of a figure's bytes have gone up so far.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadProgress {
    pub project_id: String,
    pub path: String,
    pub done: u64,
    pub total: u64,
}

// Tells the window how a figure's upload goes, a few times a second at
// most, since the sync engine reports every 64 KiB.
pub(super) fn progress_for(
    host: Arc<dyn LiveHost>,
    project_id: &str,
    path: &str,
) -> TransferProgress {
    let (project_id, path) = (project_id.to_owned(), path.to_owned());
    let told: Mutex<Option<Instant>> = Mutex::new(None);
    Arc::new(move |done, total| {
        let now = Instant::now();
        {
            let mut told = guard(&told);
            let due = told.is_none_or(|at| now.duration_since(at) >= PROGRESS_EVERY);
            if !due && done < total {
                return;
            }
            *told = Some(now);
        }
        host.upload_progress(UploadProgress {
            project_id: project_id.clone(),
            path: path.clone(),
            done,
            total,
        });
    })
}

// What makes the waiting figures go out again.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Retry {
    // The next try of a figure that failed, after its wait.
    Timer,
    // The session came back online. A figure the server refused because the
    // project was full goes again only if the server's limit has changed.
    Reconnect,
    // The person asked with Retry.
    Asked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Outcome {
    Sent,
    Retry,
    Refused,
    TooLarge(Option<u64>),
    ProjectTooLarge(Option<u64>),
}

struct Pending {
    hash: String,
    size: u64,
    attempts: u32,
    state: UploadState,
    limit: Option<u64>,
}

#[derive(Default)]
struct Uploads {
    files: BTreeMap<String, Pending>,
    told: Option<Vec<UploadFile>>,
    timer: u64,
    active: Option<Weak<Active>>,
}

type Key = (SharedProjectId, DeviceId);

static UPLOADS: LazyLock<Mutex<HashMap<Key, Uploads>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
#[derive(Clone, Copy)]
struct Limits {
    file: u64,
    project: u64,
}

static LIMITS: LazyLock<Mutex<HashMap<ServerId, (Limits, Instant)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn key(link: &LiveLink) -> Key {
    (link.project, link.device_id)
}

fn judged(error: &CollabError) -> Outcome {
    match error {
        CollabError::Api {
            status: 413, code, ..
        } if code == "project_too_large" => Outcome::ProjectTooLarge(None),
        CollabError::Api { status: 413, .. } => Outcome::TooLarge(None),
        CollabError::Api { status, .. }
            if (400..500).contains(status) && !matches!(status, 401 | 408 | 425 | 429) =>
        {
            Outcome::Refused
        }
        _ => Outcome::Retry,
    }
}

async fn server_limits(link: &LiveLink, fresh: bool) -> Option<Limits> {
    let cached = guard(&LIMITS).get(&link.server_id).copied();
    if let Some((limits, _)) = cached.filter(|(_, at)| !fresh && at.elapsed() < LIMIT_KEPT) {
        return Some(limits);
    }
    match link.client.capabilities().await {
        Ok(manifest) => {
            let limits = Limits {
                file: manifest.limits.max_file_mb.saturating_mul(MEBIBYTE),
                project: manifest.limits.max_project_mb.saturating_mul(MEBIBYTE),
            };
            guard(&LIMITS).insert(link.server_id, (limits, Instant::now()));
            Some(limits)
        }
        Err(_) => cached.map(|(limits, _)| limits),
    }
}

async fn server_limit(link: &LiveLink, fresh: bool) -> Option<u64> {
    server_limits(link, fresh).await.map(|limits| limits.file)
}

pub(super) async fn send(
    link: &LiveLink,
    root: &Path,
    blobs: &[(String, String, u64)],
    online: bool,
    progress: &(dyn Fn(&str) -> TransferProgress + Sync),
) -> BTreeSet<String> {
    if blobs.is_empty() {
        return BTreeSet::new();
    }
    let big = blobs.iter().any(|(_, _, size)| *size > CHECK_ABOVE);
    let mut limit = if big {
        server_limit(link, false).await
    } else {
        None
    };
    let mut known: BTreeMap<&str, Outcome> = BTreeMap::new();
    let mut results = Vec::new();
    for (path, hash, size) in blobs {
        let size = *size;
        let outcome = match known.get(hash.as_str()) {
            Some(outcome) => *outcome,
            None => {
                let mut outcome = if limit.is_some_and(|limit| size > limit) {
                    Outcome::TooLarge(limit)
                } else {
                    match sent(link, root, path, hash, progress(path)).await {
                        Ok(()) => Outcome::Sent,
                        Err(error) => judged(&error),
                    }
                };
                if matches!(outcome, Outcome::Refused | Outcome::TooLarge(None)) {
                    limit = server_limit(link, true).await.or(limit);
                    if let Some(limit) = limit.filter(|limit| size > *limit) {
                        outcome = Outcome::TooLarge(Some(limit));
                    }
                }
                if outcome == Outcome::ProjectTooLarge(None) {
                    let project = server_limits(link, true).await.map(|limits| limits.project);
                    outcome = Outcome::ProjectTooLarge(project);
                }
                known.insert(hash, outcome);
                outcome
            }
        };
        results.push((path.clone(), hash.clone(), size, outcome));
    }
    record(key(link), results, online)
}

// The figure is read from disk for each try, so a large one is never
// held in memory between tries or copied once per retry.
async fn sent(
    link: &LiveLink,
    root: &Path,
    path: &str,
    hash: &str,
    progress: TransferProgress,
) -> Result<(), CollabError> {
    let file = safe_target(root, path)
        .ok_or_else(|| CollabError::Io(format!("refused to read {path}")))?;
    let project = link.project;
    with_access(
        &link.sessions,
        link.server_id,
        &link.client,
        |client, access| {
            let (file, hash, progress) = (file.clone(), hash.to_owned(), Arc::clone(&progress));
            Box::pin(async move {
                let bytes = crate::collab::share::sendable_blob(&file, &hash).await?;
                client
                    .put_blob_with(access, project, &hash, bytes, Some(progress))
                    .await
            })
        },
    )
    .await
}

fn record(
    key: Key,
    results: Vec<(String, String, u64, Outcome)>,
    online: bool,
) -> BTreeSet<String> {
    let mut all = guard(&UPLOADS);
    let uploads = all.entry(key).or_default();
    let mut failed = BTreeSet::new();
    for (path, hash, size, outcome) in results {
        if outcome == Outcome::Sent {
            uploads.files.remove(&path);
            continue;
        }
        failed.insert(hash.clone());
        let pending = uploads.files.entry(path).or_insert_with(|| Pending {
            hash: hash.clone(),
            size,
            attempts: 0,
            state: UploadState::Waiting,
            limit: None,
        });
        if pending.hash != hash {
            pending.attempts = 0;
        }
        pending.hash = hash;
        pending.size = size;
        pending.limit = None;
        match outcome {
            Outcome::Retry => {
                if online {
                    pending.attempts += 1;
                }
                pending.state = if pending.attempts >= RETRIES {
                    UploadState::Failed
                } else {
                    UploadState::Waiting
                };
            }
            Outcome::Refused => {
                pending.attempts = RETRIES;
                pending.state = UploadState::Failed;
            }
            Outcome::TooLarge(limit) => {
                pending.state = UploadState::TooLarge;
                pending.limit = limit;
            }
            Outcome::ProjectTooLarge(limit) => {
                pending.state = UploadState::ProjectTooLarge;
                pending.limit = limit;
            }
            Outcome::Sent => {}
        }
    }
    failed
}

fn listed(uploads: &Uploads) -> Vec<UploadFile> {
    uploads
        .files
        .iter()
        .map(|(path, pending)| UploadFile {
            path: path.clone(),
            state: pending.state,
            size: pending.size,
            limit: pending.limit,
        })
        .collect()
}

fn delay(attempts: u32) -> Duration {
    let doubled = FIRST_RETRY.saturating_mul(1 << attempts.saturating_sub(1).min(8));
    doubled.min(LONGEST_RETRY)
}

pub(super) fn attach(active: &Arc<Active>) {
    guard(&UPLOADS)
        .entry(active.upload_key())
        .or_default()
        .active = Some(Arc::downgrade(active));
}

impl Active {
    fn upload_key(&self) -> Key {
        key(&self.link)
    }

    pub(super) fn online(&self) -> bool {
        matches!(*guard(&self.last_status), LiveStatus::Online)
    }

    pub(super) fn upload_list(&self) -> Vec<UploadFile> {
        guard(&UPLOADS)
            .get(&self.upload_key())
            .map(listed)
            .unwrap_or_default()
    }

    pub(super) fn announce_uploads(&self) {
        let online = self.online();
        let (payload, timer) = {
            let mut all = guard(&UPLOADS);
            let Some(uploads) = all.get_mut(&self.upload_key()) else {
                return;
            };
            let files = listed(uploads);
            let payload = (uploads.told.as_ref() != Some(&files)).then(|| UploadsPayload {
                project_id: self.project_id.clone(),
                files: files.clone(),
            });
            uploads.told = Some(files);
            let waiting = uploads
                .files
                .values()
                .filter(|pending| pending.state == UploadState::Waiting && pending.attempts > 0)
                .map(|pending| pending.attempts)
                .max();
            let timer = match (waiting, uploads.active.clone()) {
                (Some(attempts), Some(active)) if online => {
                    uploads.timer += 1;
                    Some((delay(attempts), uploads.timer, active))
                }
                _ => None,
            };
            (payload, timer)
        };
        if let Some(payload) = payload {
            self.host.uploads(payload);
        }
        if let Some((wait, token, active)) = timer {
            // A server that asked with Retry-After to be left alone for a
            // while gets at least that long before the next try.
            let wait = wait.max(self.link.client.asked_wait().unwrap_or_default());
            let key = self.upload_key();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(wait).await;
                let current = guard(&UPLOADS)
                    .get(&key)
                    .is_some_and(|uploads| uploads.timer == token);
                if let (true, Some(active)) = (current, active.upgrade()) {
                    active.retry_uploads(Retry::Timer).await;
                }
            });
        }
    }

    fn waits_on_a_full_project(&self) -> bool {
        guard(&UPLOADS)
            .get(&self.upload_key())
            .is_some_and(|uploads| {
                uploads
                    .files
                    .values()
                    .any(|pending| pending.state == UploadState::ProjectTooLarge)
            })
    }

    pub(super) async fn retry_uploads(&self, why: Retry) {
        let project_limit = if why == Retry::Reconnect && self.waits_on_a_full_project() {
            server_limits(&self.link, true)
                .await
                .map(|limits| limits.project)
        } else {
            None
        };
        let paths: Vec<String> = {
            let hashes = guard(&self.disk).hashes.clone();
            let mut all = guard(&UPLOADS);
            let Some(uploads) = all.get_mut(&self.upload_key()) else {
                return;
            };
            uploads.files.retain(|path, pending| {
                safe_target(&self.root, path).is_some_and(|target| target.is_file())
                    && hashes.get(path) != Some(&pending.hash)
            });
            for pending in uploads.files.values_mut() {
                let again = match (why, pending.state) {
                    (Retry::Timer, _) | (_, UploadState::TooLarge) => false,
                    (Retry::Reconnect, UploadState::ProjectTooLarge) => {
                        project_limit.is_some() && project_limit != pending.limit
                    }
                    (Retry::Reconnect | Retry::Asked, _) => true,
                };
                if again {
                    pending.attempts = 0;
                    pending.state = UploadState::Waiting;
                }
            }
            uploads
                .files
                .iter()
                .filter(|(_, pending)| pending.state == UploadState::Waiting)
                .map(|(path, _)| path.clone())
                .collect()
        };
        if !paths.is_empty() {
            let _ = self.import_paths(Some(paths)).await;
        }
        self.announce_uploads();
    }

    pub(super) fn reconnected(self: &Arc<Self>) {
        let waiting = guard(&UPLOADS)
            .get(&self.upload_key())
            .is_some_and(|uploads| {
                uploads
                    .files
                    .values()
                    .any(|pending| pending.state != UploadState::TooLarge)
            });
        if waiting {
            let active = Arc::clone(self);
            tauri::async_runtime::spawn(async move {
                active.retry_uploads(Retry::Reconnect).await;
            });
        }
    }

    fn dismiss_upload(&self, path: &str) {
        if let Some(uploads) = guard(&UPLOADS).get_mut(&self.upload_key()) {
            uploads.files.remove(path);
        }
        self.announce_uploads();
    }
}

#[tauri::command]
pub async fn collab_upload_list(project_id: String) -> Result<Vec<UploadFile>, CollabCommandError> {
    Ok(active_for(&project_id)
        .map(|active| active.upload_list())
        .unwrap_or_default())
}

#[tauri::command]
pub async fn collab_upload_retry(project_id: String) -> Result<(), CollabCommandError> {
    let active = active_for(&project_id).ok_or_else(|| CollabCommandError::from(not_live()))?;
    active.retry_uploads(Retry::Asked).await;
    Ok(())
}

#[tauri::command]
pub async fn collab_upload_dismiss(
    project_id: String,
    path: String,
) -> Result<(), CollabCommandError> {
    if let Some(active) = active_for(&project_id) {
        active.dismiss_upload(&path);
    }
    Ok(())
}

#[cfg(test)]
#[path = "uploads_tests.rs"]
mod tests;
