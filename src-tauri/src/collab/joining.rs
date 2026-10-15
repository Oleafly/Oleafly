use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use oleafly_collab::{CollabError, CollabPaths, ServerClient, SessionManager};
use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};
use serde::Serialize;
use tauri::Emitter;

use super::commands::{parse_id, with_access, CollabCommandError};
use super::disk::sha256_hex;
use super::share::Progress;
use super::state::{CollabState, JoinTicket};

pub const JOIN_PROGRESS_EVENT: &str = "collab-join-progress";
const DOWNLOADS: &str = ".joins";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinProgress {
    pub server_id: ServerId,
    pub shared_project_id: SharedProjectId,
    pub done: usize,
    pub total: usize,
}

pub(crate) type JoinReport<'a> = &'a (dyn Fn(JoinProgress) + Send + Sync);

pub(crate) fn emit(app: &tauri::AppHandle, progress: JoinProgress) {
    let _ = app.emit(JOIN_PROGRESS_EVENT, progress);
}

pub(crate) fn cancelled() -> CollabError {
    CollabError::Api {
        status: 409,
        code: "cancelled".to_owned(),
        message: "the download was cancelled".to_owned(),
    }
}

fn io(error: impl std::fmt::Display) -> CollabError {
    CollabError::Io(error.to_string())
}

pub(crate) async fn cancellable<T>(
    ticket: &JoinTicket<'_>,
    work: impl std::future::Future<Output = Result<T, CollabError>>,
) -> Result<T, CollabError> {
    if ticket.is_cancelled() {
        return Err(cancelled());
    }
    tokio::select! {
        done = work => done,
        () = ticket.until_cancelled() => Err(cancelled()),
    }
}

pub(crate) fn download_dir(paths: &CollabPaths, shared: SharedProjectId) -> PathBuf {
    paths.root().join(DOWNLOADS).join(shared.to_string())
}

pub(crate) fn forget_download(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
}

fn is_hash(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(crate) struct Downloads<'a> {
    pub(crate) ticket: &'a JoinTicket<'a>,
    pub(crate) sessions: &'a SessionManager,
    pub(crate) server: ServerId,
    pub(crate) client: &'a ServerClient,
    pub(crate) shared: SharedProjectId,
    pub(crate) dir: &'a Path,
}

impl Downloads<'_> {
    pub(crate) fn check(&self) -> Result<(), CollabError> {
        if self.ticket.is_cancelled() {
            Err(cancelled())
        } else {
            Ok(())
        }
    }

    pub(crate) async fn guarded<T>(
        &self,
        work: impl std::future::Future<Output = Result<T, CollabError>>,
    ) -> Result<T, CollabError> {
        cancellable(self.ticket, work).await
    }

    pub(crate) async fn fetch(
        &self,
        blobs: &BTreeMap<String, String>,
        progress: Progress<'_>,
    ) -> Result<(), CollabError> {
        tokio::fs::create_dir_all(self.dir).await.map_err(io)?;
        let total = blobs.len();
        progress(0, total);
        for (done, (hash, path)) in blobs.iter().enumerate() {
            self.check()?;
            if !is_hash(hash) {
                return Err(CollabError::Corrupt(format!(
                    "{path} has no valid file hash"
                )));
            }
            let target = self.dir.join(hash);
            if !target.is_file() {
                self.fetch_one(hash, path, &target).await?;
            }
            progress(done + 1, total);
        }
        self.check()
    }

    async fn fetch_one(&self, hash: &str, path: &str, target: &Path) -> Result<(), CollabError> {
        let shared = self.shared;
        let fetched = self
            .guarded(with_access(
                self.sessions,
                self.server,
                self.client,
                |client, access| {
                    let hash = hash.to_owned();
                    Box::pin(async move { client.get_blob(access, shared, &hash).await })
                },
            ))
            .await?;
        if sha256_hex(&fetched) != hash {
            return Err(CollabError::Corrupt(format!("{path} arrived damaged")));
        }
        let part = target.with_extension("part");
        tokio::fs::write(&part, fetched).await.map_err(io)?;
        tokio::fs::rename(&part, target).await.map_err(io)
    }
}

pub(crate) fn place_blob(
    dir: &Path,
    hash: &str,
    target: &Path,
    last_use: bool,
) -> Result<(), String> {
    let source = dir.join(hash);
    if last_use && std::fs::rename(&source, target).is_ok() {
        return Ok(());
    }
    std::fs::copy(&source, target)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub fn cancel_join(state: &CollabState, server: ServerId, shared: SharedProjectId) {
    if !state.cancel_join(server, shared) {
        if let Ok(paths) = state.paths() {
            forget_download(&download_dir(paths, shared));
        }
    }
}

#[tauri::command]
pub async fn collab_join_cancel(
    state: tauri::State<'_, CollabState>,
    server_id: String,
    shared_project_id: String,
) -> Result<(), CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    let shared = parse_id(&shared_project_id, "project")?;
    cancel_join(state.inner(), server, shared);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_progress_reaches_the_window_in_camel_case() {
        let (server, shared) = (ServerId::new_v7(), SharedProjectId::new_v7());
        assert_eq!(JOIN_PROGRESS_EVENT, "collab-join-progress");
        assert_eq!(
            serde_json::to_value(JoinProgress {
                server_id: server,
                shared_project_id: shared,
                done: 2,
                total: 5,
            })
            .unwrap(),
            serde_json::json!({
                "serverId": server.to_string(),
                "sharedProjectId": shared.to_string(),
                "done": 2,
                "total": 5,
            })
        );
    }

    #[test]
    fn only_a_sha256_names_a_downloaded_file() {
        assert!(is_hash(&sha256_hex(b"figure")));
        for name in ["", "../escape", "ABCDEF", &"a".repeat(63), &"g".repeat(64)] {
            assert!(!is_hash(name), "{name}");
        }
    }

    #[test]
    fn a_blob_used_twice_is_copied_first_and_moved_last() {
        let dir = tempfile::tempdir().unwrap();
        let downloads = dir.path().join("downloads");
        std::fs::create_dir_all(&downloads).unwrap();
        let hash = sha256_hex(b"plot");
        std::fs::write(downloads.join(&hash), b"plot").unwrap();
        let (first, second) = (dir.path().join("a.png"), dir.path().join("b.png"));
        place_blob(&downloads, &hash, &first, false).unwrap();
        assert!(downloads.join(&hash).is_file());
        place_blob(&downloads, &hash, &second, true).unwrap();
        assert!(!downloads.join(&hash).exists());
        assert_eq!(std::fs::read(first).unwrap(), b"plot");
        assert_eq!(std::fs::read(second).unwrap(), b"plot");
    }

    #[test]
    fn cancelling_with_no_join_running_removes_a_download_left_behind() {
        let dir = tempfile::tempdir().unwrap();
        let state = CollabState::new(
            CollabPaths::new(dir.path().join("collab")),
            std::sync::Arc::new(oleafly_collab::MemorySecrets::default()),
        );
        let shared = SharedProjectId::new_v7();
        let left = download_dir(state.paths().unwrap(), shared);
        std::fs::create_dir_all(&left).unwrap();
        std::fs::write(left.join(sha256_hex(b"x")), b"x").unwrap();
        cancel_join(&state, ServerId::new_v7(), shared);
        assert!(!left.exists());
    }
}
