use axum::body::Bytes;
use oleafly_collab_protocol::ids::{AccountId, SharedProjectId};
use oleafly_collab_protocol::outputs::{OutputKind, ProjectOutput};
use oleafly_collab_protocol::projects::ProjectStatus;
use rusqlite::{params, Connection, OptionalExtension};

use crate::blobs::{cleanup, sha256_hex, BlobReader};
use crate::db::parse_id;
use crate::error::ServerError;
use crate::projects::{self, Removal};
use crate::quotas::Storage;
use crate::state::AppState;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NewOutput {
    pub project: SharedProjectId,
    pub kind: OutputKind,
    pub compiled_by: AccountId,
    pub main_file: String,
    pub storage: Option<Storage>,
    pub for_pdf: Option<String>,
}

pub struct OpenedOutput {
    pub output: ProjectOutput,
    pub hash: String,
    pub reader: BlobReader,
}

fn kind_from(text: &str) -> Result<OutputKind, ServerError> {
    OutputKind::parse(text)
        .ok_or_else(|| ServerError::Internal(format!("unknown output kind {text}")))
}

fn size_from(value: i64) -> u64 {
    u64::try_from(value).unwrap_or(0)
}

fn row_output(
    kind: String,
    size: i64,
    compiled_by: String,
    compiled_at: i64,
    main_file: String,
) -> Result<ProjectOutput, ServerError> {
    Ok(ProjectOutput {
        kind: kind_from(&kind)?,
        size: size_from(size),
        compiled_by: parse_id(&compiled_by)?,
        compiled_at,
        main_file,
    })
}

pub fn list(
    conn: &Connection,
    project: SharedProjectId,
) -> Result<Vec<ProjectOutput>, ServerError> {
    let mut statement = conn.prepare(
        "SELECT kind, size, compiled_by, compiled_at, main_file FROM project_outputs \
         WHERE project_id = ?1 ORDER BY kind",
    )?;
    let rows = statement
        .query_map([project.to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(kind, size, by, at, main)| row_output(kind, size, by, at, main))
        .collect()
}

pub fn find(
    conn: &Connection,
    project: SharedProjectId,
    kind: OutputKind,
) -> Result<Option<(ProjectOutput, String)>, ServerError> {
    let row = conn
        .query_row(
            "SELECT kind, size, compiled_by, compiled_at, main_file, blob_hash FROM project_outputs \
             WHERE project_id = ?1 AND kind = ?2",
            params![project.to_string(), kind.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()?;
    row.map(|(kind, size, by, at, main, hash)| Ok((row_output(kind, size, by, at, main)?, hash)))
        .transpose()
}

fn give_back(conn: &Connection, hash: &str, now: i64) -> Result<(), ServerError> {
    if !projects::blob_in_use(conn, hash)? {
        projects::queue_removal(conn, Removal::File, None, hash, now)?;
    }
    Ok(())
}

fn unused(
    conn: &Connection,
    old: &str,
    hash: &str,
    now: i64,
) -> Result<Option<String>, ServerError> {
    if old == hash || projects::blob_in_use(conn, old)? {
        return Ok(None);
    }
    projects::queue_removal(conn, Removal::File, None, old, now)?;
    Ok(Some(old.to_owned()))
}

fn record(
    conn: &mut Connection,
    new: &NewOutput,
    hash: &str,
    size: u64,
    now: i64,
) -> Result<(ProjectOutput, Vec<String>), ServerError> {
    let transaction = conn.transaction()?;
    let shared = projects::project_row(&transaction, new.project)?
        .is_some_and(|row| row.status != ProjectStatus::Archived);
    if !shared {
        give_back(&transaction, hash, now)?;
        transaction.commit()?;
        return Err(ServerError::Conflict(
            "This project is no longer shared.".to_string(),
        ));
    }
    if let Some(wanted) = new.for_pdf.as_deref() {
        let current = find(&transaction, new.project, OutputKind::Pdf)?;
        if current.as_ref().map(|(_, pdf)| pdf.as_str()) != Some(wanted) {
            give_back(&transaction, hash, now)?;
            transaction.commit()?;
            return Err(ServerError::Conflict(
                "A newer PDF replaced the one this SyncTeX belongs to.".to_string(),
            ));
        }
    }
    let previous = find(&transaction, new.project, new.kind)?;
    let stale = match new.kind {
        OutputKind::Pdf => find(&transaction, new.project, OutputKind::Synctex)?,
        _ => None,
    };
    let freeing = [&previous, &stale]
        .into_iter()
        .flatten()
        .map(|(output, _)| output.size)
        .sum();
    if let Some(storage) = new.storage {
        if let Some(refused) = storage.refusal(&transaction, size, freeing)? {
            give_back(&transaction, hash, now)?;
            transaction.commit()?;
            return Err(refused);
        }
    }
    transaction.execute(
        "INSERT INTO project_outputs (project_id, kind, blob_hash, size, compiled_by, compiled_at, main_file) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
         ON CONFLICT (project_id, kind) DO UPDATE SET blob_hash = excluded.blob_hash, size = excluded.size, \
         compiled_by = excluded.compiled_by, compiled_at = excluded.compiled_at, main_file = excluded.main_file",
        params![
            new.project.to_string(),
            new.kind.as_str(),
            hash,
            i64::try_from(size).unwrap_or(i64::MAX),
            new.compiled_by.to_string(),
            now,
            new.main_file,
        ],
    )?;
    projects::finish_removal(&transaction, Removal::File, None, hash)?;
    let mut orphans = Vec::new();
    if let Some((_, old)) = previous {
        orphans.extend(unused(&transaction, &old, hash, now)?);
    }
    if let Some((_, old)) = stale {
        transaction.execute(
            "DELETE FROM project_outputs WHERE project_id = ?1 AND kind = ?2",
            params![new.project.to_string(), OutputKind::Synctex.as_str()],
        )?;
        orphans.extend(unused(&transaction, &old, hash, now)?);
    }
    transaction.commit()?;
    let output = ProjectOutput {
        kind: new.kind,
        size,
        compiled_by: new.compiled_by,
        compiled_at: now,
        main_file: new.main_file.clone(),
    };
    Ok((output, orphans))
}

pub async fn store(
    state: &AppState,
    new: NewOutput,
    bytes: Bytes,
    now: i64,
) -> Result<ProjectOutput, ServerError> {
    let size = bytes.len() as u64;
    let hashed = bytes.clone();
    let hash = tokio::task::spawn_blocking(move || sha256_hex(&hashed))
        .await
        .map_err(|error| ServerError::Internal(format!("an output task failed: {error}")))?;
    let (output, orphans) = {
        let _held = state.blobs.hold(&hash).await;
        state.blobs.put(&hash, bytes).await?;
        let recorded = hash.clone();
        state
            .db
            .call(move |conn| record(conn, &new, &recorded, size, now))
            .await?
    };
    for orphan in orphans {
        if let Err(error) = cleanup::remove_if_unused(&state.db, &state.blobs, &orphan).await {
            tracing::warn!(
                "Could not remove the replaced output {orphan} yet, so maintenance removes it later: {error}"
            );
        }
    }
    Ok(output)
}

pub async fn open(
    state: &AppState,
    project: SharedProjectId,
    kind: OutputKind,
) -> Result<Option<OpenedOutput>, ServerError> {
    let Some((output, hash)) = state.db.read(move |conn| find(conn, project, kind)).await? else {
        return Ok(None);
    };
    let reader = state.blobs.open(&hash).await?.ok_or_else(|| {
        ServerError::Internal(format!(
            "the stored output {hash} is missing from the blob store"
        ))
    })?;
    if reader.size() != output.size {
        return Err(ServerError::Internal(format!(
            "the stored output {hash} holds {} bytes, not the {} it was stored with",
            reader.size(),
            output.size
        )));
    }
    Ok(Some(OpenedOutput {
        output,
        hash,
        reader,
    }))
}
