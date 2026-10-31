use axum::body::Body;
use axum::extract::rejection::PathRejection;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use oleafly_collab_protocol::admin::SecurityEventKind;
use oleafly_collab_protocol::ids::{AccountId, SharedProjectId};
use oleafly_collab_protocol::outputs::{encode_main_file, OutputKind, MAIN_FILE_HEADER};
use oleafly_collab_protocol::projects::{ProjectRole, ProjectStatus};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::{json, Value};

use crate::error::ServerError;
use crate::members;
use crate::outputs;
use crate::projects;
use crate::routes::outputs::{project_and_kind, store_upload};
use crate::routes::projects::{access, project_and_hash};
use crate::routes::{path_id, ClientIp};
use crate::security_log::{self, NewSecurityEvent};
use crate::settings;
use crate::state::AppState;
use crate::web::frames::{WebOutput, WebText};
use crate::web::{changing, pending_core, Refusal, WebOn, WebUser};
use crate::web_sessions;

const BLOB_POLICY: &str = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";

fn answer(value: impl Serialize) -> Response {
    let mut response = Json(value).into_response();
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response
}

fn role_name(role: ProjectRole) -> Value {
    serde_json::to_value(role).unwrap_or(Value::Null)
}

fn person(summary: &oleafly_collab_protocol::projects::PersonSummary) -> Value {
    json!({
        "accountId": summary.account_id,
        "displayName": summary.display_name,
        "login": summary.login,
        "avatarUrl": summary.avatar_url,
    })
}

fn updated_at(conn: &Connection, project: SharedProjectId) -> Result<i64, ServerError> {
    Ok(conn.query_row(
        "SELECT MAX(p.created_at, COALESCE(p.committed_at, 0), \
           COALESCE((SELECT u.created_at FROM project_updates u WHERE u.project_id = p.id ORDER BY u.seq DESC LIMIT 1), 0)) \
         FROM projects p WHERE p.id = ?1",
        params![project.to_string()],
        |row| row.get(0),
    )?)
}

fn summary_of(
    conn: &Connection,
    summary: &oleafly_collab_protocol::projects::ProjectSummary,
) -> Result<Value, ServerError> {
    Ok(json!({
        "id": summary.project_id,
        "name": summary.title,
        "title": summary.title,
        "role": role_name(summary.role),
        "ownerName": summary.owner.display_name,
        "owner": person(&summary.owner),
        "updatedAt": updated_at(conn, summary.project_id)?,
    }))
}

pub async fn me(State(state): State<AppState>, user: WebUser) -> Result<Response, ServerError> {
    let account = user.caller.account_id;
    let summary = state
        .db
        .read(move |conn| members::account_summary(conn, account))
        .await?
        .ok_or(ServerError::Unauthorized)?;
    Ok(answer(json!({
        "account": {
            "id": summary.account_id,
            "displayName": summary.display_name,
            "login": summary.logins.first(),
            "email": summary.emails.first(),
            "avatarUrl": summary.avatar_url,
        },
        "server": { "name": state.config.server_name },
    })))
}

pub async fn projects(
    State(state): State<AppState>,
    user: WebUser,
) -> Result<Response, ServerError> {
    let account = user.caller.account_id;
    let listed = state
        .db
        .read(move |conn| {
            projects::list_for_account(conn, account)?
                .iter()
                .map(|summary| summary_of(conn, summary))
                .collect::<Result<Vec<Value>, ServerError>>()
        })
        .await?;
    Ok(answer(json!({ "projects": listed })))
}

fn shared(status: ProjectStatus) -> Result<(), ServerError> {
    match status {
        ProjectStatus::Active => Ok(()),
        ProjectStatus::Pending => Err(ServerError::Refused {
            status: StatusCode::NOT_FOUND,
            code: "project_not_shared",
            message: "This project is not shared yet.".to_string(),
        }),
        ProjectStatus::Archived | ProjectStatus::Unknown => Err(ServerError::Refused {
            status: StatusCode::NOT_FOUND,
            code: "archived",
            message: "This project is no longer shared.".to_string(),
        }),
    }
}

fn active_access(
    conn: &Connection,
    project: SharedProjectId,
    account: AccountId,
) -> Result<(projects::ProjectRow, ProjectRole), ServerError> {
    let (row, role) = access(conn, project, account)?;
    shared(row.status)?;
    Ok((row, role))
}

pub async fn project(
    State(state): State<AppState>,
    user: WebUser,
    path: Result<Path<String>, PathRejection>,
) -> Result<Response, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let account = user.caller.account_id;
    let (summary, role, people, comments) = state
        .db
        .read(move |conn| {
            let (row, role) = active_access(conn, project, account)?;
            let summary = summary_of(conn, &projects::summary(conn, &row, role)?)?;
            let people: Vec<Value> = projects::members(conn, project, false)?
                .iter()
                .map(|member| person(&member.person))
                .collect();
            let comments = settings::load(conn)?.comments_allowed && row.comments_enabled;
            Ok((summary, role, people, comments))
        })
        .await?;
    let room = state.web.room(project);
    let files = room.ready(&state).await.unwrap_or_default();
    state.web.linger(account, room);
    Ok(answer(json!({
        "project": summary,
        "role": role_name(role),
        "files": files,
        "members": people,
        "features": {
            "comments": comments,
            "suggestions": pending_core::SUGGESTIONS_READY,
            "chat": pending_core::CHAT_READY,
        },
    })))
}

#[derive(Serialize)]
struct Texts {
    files: Vec<WebText>,
}

fn not_opened(refusal: Refusal) -> ServerError {
    let (status, code) = match refusal.code.as_str() {
        "project_too_large" => (StatusCode::CONFLICT, "project_too_large"),
        "server_busy" => (StatusCode::SERVICE_UNAVAILABLE, "server_busy"),
        _ => (StatusCode::INTERNAL_SERVER_ERROR, "server"),
    };
    ServerError::Refused {
        status,
        code,
        message: refusal.message,
    }
}

pub async fn texts(
    State(state): State<AppState>,
    user: WebUser,
    path: Result<Path<String>, PathRejection>,
) -> Result<Response, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let account = user.caller.account_id;
    state
        .db
        .read(move |conn| active_access(conn, project, account).map(drop))
        .await?;
    let room = state.web.room(project);
    let texts = match room.ready(&state).await {
        Ok(_) => room.texts().await,
        Err(refusal) => Err(refusal),
    };
    state.web.linger(account, room);
    let files = texts.map_err(not_opened)?;
    Ok(answer(Texts { files }))
}

pub fn sniffed(bytes: &[u8]) -> &'static str {
    let start = &bytes[..bytes.len().min(512)];
    let text = String::from_utf8_lossy(start).to_ascii_lowercase();
    if start.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if start.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg"
    } else if start.starts_with(b"GIF87a") || start.starts_with(b"GIF89a") {
        "image/gif"
    } else if start.len() >= 12 && &start[..4] == b"RIFF" && &start[8..12] == b"WEBP" {
        "image/webp"
    } else if start.starts_with(b"%PDF-") {
        "application/pdf"
    } else if text.trim_start().starts_with("<svg")
        || (text.contains("<?xml") && text.contains("<svg"))
    {
        "image/svg+xml"
    } else {
        "application/octet-stream"
    }
}

pub async fn blob(
    State(state): State<AppState>,
    user: WebUser,
    path: Result<Path<(String, String)>, PathRejection>,
) -> Result<Response, ServerError> {
    let (project, hash) = project_and_hash(path)?;
    let account = user.caller.account_id;
    let lookup = hash.clone();
    let size = state
        .db
        .read(move |conn| {
            active_access(conn, project, account)?;
            projects::blob_size(conn, project, &lookup)?.ok_or(ServerError::NotFound)
        })
        .await?;
    let reader = state
        .blobs
        .open(&hash)
        .await?
        .ok_or(ServerError::NotFound)?;
    if reader.size() != size {
        return Err(ServerError::Internal(format!(
            "the stored file {hash} holds {} bytes, not the {size} it was stored with",
            reader.size()
        )));
    }
    let _room = state.transfers.hold(account, size).await?;
    let bytes = reader
        .read_all()
        .await
        .map_err(|error| ServerError::Internal(format!("could not read a stored file: {error}")))?;
    let kind = sniffed(&bytes);
    let mut response = (StatusCode::OK, bytes).into_response();
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(kind));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(BLOB_POLICY),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=3600"),
    );
    Ok(response)
}

pub async fn outputs(
    State(state): State<AppState>,
    user: WebUser,
    path: Result<Path<String>, PathRejection>,
) -> Result<Response, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let account = user.caller.account_id;
    let listed = state
        .db
        .read(move |conn| {
            active_access(conn, project, account)?;
            outputs::list(conn, project)
        })
        .await?;
    let items: Vec<WebOutput> = listed.into_iter().map(WebOutput::from).collect();
    Ok(answer(json!({ "items": items })))
}

pub async fn output(
    State(state): State<AppState>,
    user: WebUser,
    path: Result<Path<(String, String)>, PathRejection>,
) -> Result<Response, ServerError> {
    let Path((project, kind)) =
        path.map_err(|rejection| ServerError::BadRequest(rejection.body_text()))?;
    let project: SharedProjectId = project
        .parse()
        .map_err(|_| ServerError::BadRequest(format!("{project} is not a valid id.")))?;
    let kind = OutputKind::parse(&kind).ok_or(ServerError::NotFound)?;
    let account = user.caller.account_id;
    state
        .db
        .read(move |conn| active_access(conn, project, account).map(drop))
        .await?;
    let opened = outputs::open(&state, project, kind)
        .await?
        .ok_or(ServerError::NotFound)?;
    let room = state.transfers.hold(account, opened.reader.size()).await?;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(kind.content_type()),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Ok(etag) = HeaderValue::from_str(&format!("\"{}\"", opened.hash)) {
        headers.insert(header::ETAG, etag);
    }
    if let Ok(main) = HeaderValue::from_str(&encode_main_file(&opened.output.main_file)) {
        headers.insert(HeaderName::from_static(MAIN_FILE_HEADER), main);
    }
    Ok((headers, room.send(opened.reader).await?).into_response())
}

pub async fn put_output(
    State(state): State<AppState>,
    headers: HeaderMap,
    path: Result<Path<(String, String)>, PathRejection>,
    body: Body,
) -> Result<Response, ServerError> {
    let user = changing(&state, &headers).await?;
    let (project, kind) = project_and_kind(path)?;
    let stored = store_upload(
        &state,
        user.caller.account_id,
        project,
        kind,
        &headers,
        body,
    )
    .await?;
    Ok(answer(WebOutput::from(stored)))
}

pub async fn sign_out(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
) -> Result<Response, ServerError> {
    let user = changing(&state, &headers).await?;
    let (account, device) = (user.caller.account_id, user.caller.device_id);
    let now = state.clock.now_ms();
    state
        .db
        .call(move |conn| {
            let transaction = conn.transaction()?;
            security_log::record(
                &transaction,
                now,
                NewSecurityEvent {
                    actor: Some(account),
                    kind: SecurityEventKind::DeviceSignedOut,
                    target: Some(device.to_string()),
                    ip,
                    detail: json!({ "by": "self", "platform": web_sessions::PLATFORM }),
                },
            )?;
            web_sessions::sign_out(&transaction, device, now)?;
            transaction.commit()?;
            Ok(())
        })
        .await?;
    state.sockets.revoke(device, None);
    let mut response = StatusCode::NO_CONTENT.into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        web_sessions::cleared_cookie(&state.config),
    );
    Ok(response)
}

pub async fn unknown(_on: WebOn) -> ServerError {
    ServerError::NotFound
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stored_files_are_typed_by_their_bytes() {
        assert_eq!(sniffed(b"\x89PNG\r\n\x1a\nrest"), "image/png");
        assert_eq!(sniffed(&[0xff, 0xd8, 0xff, 0xe0]), "image/jpeg");
        assert_eq!(sniffed(b"GIF89a.."), "image/gif");
        assert_eq!(sniffed(b"RIFF\0\0\0\0WEBPVP8 "), "image/webp");
        assert_eq!(sniffed(b"%PDF-1.7"), "application/pdf");
        assert_eq!(
            sniffed(b"  <svg xmlns=\"http://www.w3.org/2000/svg\"/>"),
            "image/svg+xml"
        );
        assert_eq!(
            sniffed(b"<?xml version=\"1.0\"?>\n<svg></svg>"),
            "image/svg+xml"
        );
        assert_eq!(
            sniffed(b"\\documentclass{article}"),
            "application/octet-stream"
        );
        assert_eq!(sniffed(b""), "application/octet-stream");
    }
}
