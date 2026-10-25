use std::collections::BTreeMap;

use axum::body::Bytes;
use oleafly_collab_protocol::ids::SharedProjectId;

use crate::blobs::BlobStore;
use crate::db::Db;
use crate::error::ServerError;
use crate::projects::{self, PendingRemoval, Removal};
use crate::quotas::Storage;
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

// Stores a file and records it for the project. The project's size limit
// is checked again where the file is recorded, so uploads that pass the
// first check together can't take the project past it: the one that
// would is refused, and its file is removed later unless another project
// holds it.
#[allow(clippy::too_many_arguments)]
pub async fn upload(
    db: &Db,
    blobs: &BlobStore,
    project: SharedProjectId,
    hash: &str,
    bytes: Bytes,
    limit_mb: u64,
    storage: Option<Storage>,
    now: i64,
) -> Result<(), ServerError> {
    let _held = blobs.hold(hash).await;
    let size = bytes.len() as u64;
    blobs.put(hash, bytes).await?;
    let hash = hash.to_string();
    db.call(move |conn| {
        let transaction = conn.transaction()?;
        let held = projects::blob_size(&transaction, project, &hash)?.is_some();
        let after = projects::stored_bytes(&transaction, project)?.saturating_add(size);
        let refused = if held {
            None
        } else if after > limit_mb.saturating_mul(1024 * 1024) {
            Some(projects::too_large_for(limit_mb))
        } else if let Some(storage) = storage {
            storage.refusal(&transaction, size, 0)?
        } else {
            None
        };
        if let Some(refused) = refused {
            if !projects::blob_in_use(&transaction, &hash)? {
                projects::queue_removal(&transaction, Removal::File, None, &hash, now)?;
            }
            transaction.commit()?;
            return Err(refused);
        }
        projects::add_blob(&transaction, project, &hash, size, now)?;
        transaction.commit()?;
        Ok(())
    })
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

pub async fn remove_if_unused(db: &Db, blobs: &BlobStore, hash: &str) -> Result<bool, ServerError> {
    retry_file(db, blobs, hash).await
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blobs::sha256_hex;
    use oleafly_collab_protocol::roles::ServerRole;

    async fn project(db: &Db) -> SharedProjectId {
        let project = SharedProjectId::new_v7();
        db.call(move |conn| {
            let owner = crate::members::create_account(conn, "Ada", None, ServerRole::Member, 1)?;
            conn.execute(
                "INSERT INTO projects (id, owner_account, title, status, created_at) VALUES (?1, ?2, 'Thesis', 'active', 1)",
                rusqlite::params![project.to_string(), owner.to_string()],
            )?;
            Ok(())
        })
        .await
        .unwrap();
        project
    }

    #[tokio::test]
    async fn uploads_that_passed_the_first_check_together_cannot_pass_the_project_limit() {
        let dir = tempfile::tempdir().unwrap();
        let blobs = BlobStore::filesystem(dir.path());
        let db = Db::open_in_memory().unwrap();
        let project = project(&db).await;
        let first = Bytes::from(vec![1u8; 600 * 1024]);
        let second = Bytes::from(vec![2u8; 600 * 1024]);
        let (kept, refused) = (sha256_hex(&first), sha256_hex(&second));
        upload(&db, &blobs, project, &kept, first.clone(), 1, None, 1)
            .await
            .expect("the first file fits");
        let answer = upload(&db, &blobs, project, &refused, second, 1, None, 2).await;
        assert_eq!(
            answer.err().map(|error| error.code()),
            Some("project_too_large")
        );
        let (stored, queued) = db
            .call(move |conn| {
                Ok((
                    projects::stored_bytes(conn, project)?,
                    projects::pending_removals(conn, 10)?,
                ))
            })
            .await
            .unwrap();
        assert_eq!(stored, 600 * 1024);
        assert!(
            queued.iter().any(|removal| removal.hash == refused),
            "the refused file is removed later: {queued:?}"
        );
        upload(&db, &blobs, project, &kept, first, 1, None, 3)
            .await
            .expect("a file the project holds is taken again");
    }

    #[tokio::test]
    async fn an_upload_that_would_fill_the_owners_account_is_refused_where_it_is_recorded() {
        let dir = tempfile::tempdir().unwrap();
        let blobs = BlobStore::filesystem(dir.path());
        let db = Db::open_in_memory().unwrap();
        let project = project(&db).await;
        let owner = db
            .call(move |conn| {
                Ok(projects::project_row(conn, project)?
                    .expect("the project")
                    .owner)
            })
            .await
            .unwrap();
        let storage = Storage {
            owner,
            by: owner,
            limit_mb: 1,
        };
        let first = Bytes::from(vec![3u8; 700 * 1024]);
        let second = Bytes::from(vec![4u8; 400 * 1024]);
        let (kept, refused) = (sha256_hex(&first), sha256_hex(&second));
        upload(
            &db,
            &blobs,
            project,
            &kept,
            first.clone(),
            10,
            Some(storage),
            1,
        )
        .await
        .expect("the first file fits the account");
        let answer = upload(&db, &blobs, project, &refused, second, 10, Some(storage), 2).await;
        assert_eq!(
            answer.err().map(|error| error.code()),
            Some("account_storage_full")
        );
        let queued = db
            .call(|conn| projects::pending_removals(conn, 10))
            .await
            .unwrap();
        assert!(queued.iter().any(|removal| removal.hash == refused));
        upload(&db, &blobs, project, &kept, first, 10, Some(storage), 3)
            .await
            .expect("a file the project holds needs no room");
    }
}
