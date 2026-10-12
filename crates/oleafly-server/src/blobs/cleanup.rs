use std::collections::BTreeMap;

use axum::body::Bytes;
use oleafly_collab_protocol::ids::SharedProjectId;

use crate::blobs::BlobStore;
use crate::db::Db;
use crate::error::ServerError;
use crate::projects::{self, PendingRemoval, Removal};
use crate::snapshots::Snapshots;
use crate::state::DAY_MS;

pub const UNUSED_FILE_GRACE_MS: i64 = 30 * DAY_MS;
const REMOVALS_PER_PASS: usize = 500;
const FAILURES_BEFORE_PAUSE: usize = 3;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnusedFile {
    pub project: SharedProjectId,
    pub hash: String,
}

pub async fn upload(
    db: &Db,
    blobs: &BlobStore,
    project: SharedProjectId,
    hash: &str,
    bytes: Bytes,
    now: i64,
) -> Result<(), ServerError> {
    let _held = blobs.hold(hash).await;
    let size = bytes.len() as u64;
    blobs.put(hash, bytes).await?;
    let hash = hash.to_string();
    db.call(move |conn| projects::add_blob(conn, project, &hash, size, now))
        .await
}

pub async fn unused_files(
    db: &Db,
    snapshots: &Snapshots,
    now: i64,
) -> Result<Vec<UnusedFile>, ServerError> {
    let used_before = now - UNUSED_FILE_GRACE_MS;
    let candidates = db
        .call(move |conn| projects::blobs_unused_since(conn, used_before))
        .await?;
    let mut by_project: BTreeMap<SharedProjectId, Vec<String>> = BTreeMap::new();
    for (project, hash) in candidates {
        by_project.entry(project).or_default().push(hash);
    }
    let mut unused = Vec::new();
    for (project, hashes) in by_project {
        let in_use = match snapshots.files_in_use(db, project).await {
            Ok(Some(in_use)) => in_use,
            Ok(None) => continue,
            Err(error) => {
                tracing::warn!(
                    "Kept every file of project {project} because its document could not be read: {error}"
                );
                continue;
            }
        };
        let (used, stale): (Vec<String>, Vec<String>) =
            hashes.into_iter().partition(|hash| in_use.contains(hash));
        if !used.is_empty() {
            db.call(move |conn| projects::blobs_used(conn, project, &used, now))
                .await?;
        }
        unused.extend(stale.into_iter().map(|hash| UnusedFile { project, hash }));
    }
    Ok(unused)
}

pub async fn remove_unused_files(
    db: &Db,
    blobs: &BlobStore,
    unused: Vec<UnusedFile>,
    now: i64,
) -> Result<usize, ServerError> {
    let used_before = now - UNUSED_FILE_GRACE_MS;
    let mut queued = 0;
    for file in unused {
        let _held = blobs.hold(&file.hash).await;
        let (project, hash) = (file.project, file.hash);
        if db
            .call(move |conn| projects::drop_unused_blob(conn, project, &hash, used_before, now))
            .await?
        {
            queued += 1;
        }
    }
    Ok(queued)
}

async fn remove_file(db: &Db, blobs: &BlobStore, hash: &str) -> bool {
    let removed = blobs.remove(hash).await;
    let (noted, succeeded) = (hash.to_string(), removed.is_ok());
    let recorded = db
        .call(move |conn| {
            if succeeded {
                projects::finish_removal(conn, Removal::File, None, &noted)
            } else {
                projects::removal_failed(conn, Removal::File, None, &noted)
            }
        })
        .await;
    if let Err(error) = recorded {
        tracing::warn!("Could not note the removal of file {hash}: {error}");
    }
    match removed {
        Ok(()) => true,
        Err(error) => {
            tracing::warn!(
                "Could not remove file {hash} from the blob store, so the server tries again at its next maintenance pass: {error}"
            );
            false
        }
    }
}

pub async fn finish_removals(
    db: &Db,
    blobs: &BlobStore,
    snapshots: &Snapshots,
) -> Result<usize, ServerError> {
    let pending = db
        .call(|conn| projects::pending_removals(conn, REMOVALS_PER_PASS))
        .await?;
    let mut finished = 0;
    let mut failures_in_a_row = 0;
    for removal in pending {
        let PendingRemoval {
            kind,
            project,
            hash,
        } = &removal;
        let done = match (kind, project) {
            (Removal::File, _) => retry_file(db, blobs, hash).await?,
            (Removal::Snapshot, Some(project)) => snapshots.retry_removal(db, *project, hash).await,
            (Removal::Snapshot, None) => {
                let lookup = hash.clone();
                db.call(move |conn| {
                    projects::finish_removal(conn, Removal::Snapshot, None, &lookup)
                })
                .await?;
                true
            }
        };
        if done {
            finished += 1;
            failures_in_a_row = 0;
        } else {
            failures_in_a_row += 1;
            if failures_in_a_row >= FAILURES_BEFORE_PAUSE {
                tracing::warn!(
                    "Stopped removing stored files for this maintenance pass because the blob store keeps failing"
                );
                break;
            }
        }
    }
    Ok(finished)
}

async fn retry_file(db: &Db, blobs: &BlobStore, hash: &str) -> Result<bool, ServerError> {
    let _held = blobs.hold(hash).await;
    let lookup = hash.to_string();
    let used = db
        .call(move |conn| {
            if projects::blob_in_use(conn, &lookup)? {
                projects::finish_removal(conn, Removal::File, None, &lookup)?;
                return Ok(true);
            }
            Ok(false)
        })
        .await?;
    Ok(used || remove_file(db, blobs, hash).await)
}
