use axum::body::Body;
use axum::extract::rejection::PathRejection;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use oleafly_collab_protocol::ids::{AccountId, SharedProjectId};
use oleafly_collab_protocol::outputs::{
    decode_main_file, encode_main_file, OutputKind, ProjectOutput, FOR_PDF_HEADER,
    MAIN_FILE_HEADER, MAX_MAIN_FILE_CHARS,
};
use oleafly_collab_protocol::projects::{ProjectAction, ProjectStatus};

use crate::error::ServerError;
use crate::outputs::{self, NewOutput};
use crate::quotas::Storage;
use crate::routes::projects::{access, content_length_within, megabytes, require};
use crate::routes::{path_id, Authenticated};
use crate::state::AppState;
use crate::transfers::declared_length;

const PDF_HEADER_WITHIN: usize = 1024;
const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/projects/{project}/output", get(list))
        .route(
            "/api/v1/projects/{project}/output/{kind}",
            get(get_output).put(put_output),
        )
        .layer(axum::middleware::map_response(crate::transfers::retry_soon))
}

pub(crate) fn project_and_kind(
    path: Result<Path<(String, String)>, PathRejection>,
) -> Result<(SharedProjectId, OutputKind), ServerError> {
    let Path((project, kind)) =
        path.map_err(|rejection| ServerError::BadRequest(rejection.body_text()))?;
    let project = project
        .parse::<SharedProjectId>()
        .map_err(|_| ServerError::BadRequest(format!("{project} is not a valid id.")))?;
    let kind = OutputKind::parse(&kind).ok_or_else(|| {
        ServerError::BadRequest("A compiled output is either pdf or synctex.".to_string())
    })?;
    Ok((project, kind))
}

fn main_file(headers: &HeaderMap) -> Result<String, ServerError> {
    let missing = || {
        ServerError::BadRequest(format!(
            "Name the compiled main file in the {MAIN_FILE_HEADER} header."
        ))
    };
    let raw = headers
        .get(MAIN_FILE_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(missing)?;
    let decoded = decode_main_file(raw.trim()).ok_or_else(missing)?;
    let name = decoded.trim();
    if name.is_empty()
        || name.chars().count() > MAX_MAIN_FILE_CHARS
        || name.chars().any(char::is_control)
    {
        return Err(missing());
    }
    Ok(name.to_string())
}

fn for_pdf(kind: OutputKind, headers: &HeaderMap) -> Result<Option<String>, ServerError> {
    let Some(value) = headers.get(FOR_PDF_HEADER) else {
        return Ok(None);
    };
    let hash = value
        .to_str()
        .map(str::trim)
        .ok()
        .filter(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| {
            ServerError::BadRequest(format!(
                "{FOR_PDF_HEADER} names the PDF by its SHA-256 in hex."
            ))
        })?;
    if kind != OutputKind::Synctex {
        return Err(ServerError::BadRequest(format!(
            "Only SyncTeX output names its PDF in {FOR_PDF_HEADER}."
        )));
    }
    Ok(Some(hash.to_ascii_lowercase()))
}

fn looks_like(kind: OutputKind, bytes: &[u8]) -> bool {
    match kind {
        OutputKind::Pdf => bytes[..bytes.len().min(PDF_HEADER_WITHIN)]
            .windows(5)
            .any(|window| window == b"%PDF-"),
        OutputKind::Synctex => bytes.starts_with(&GZIP_MAGIC),
        OutputKind::Unknown => false,
    }
}

async fn list(
    State(state): State<AppState>,
    auth: Authenticated,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<Vec<ProjectOutput>>, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let account = auth.account_id;
    let listed = state
        .db
        .read(move |conn| {
            access(conn, project, account)?;
            outputs::list(conn, project)
        })
        .await?;
    Ok(Json(listed))
}

async fn put_output(
    State(state): State<AppState>,
    auth: Authenticated,
    path: Result<Path<(String, String)>, PathRejection>,
    headers: HeaderMap,
    body: Body,
) -> Result<Json<ProjectOutput>, ServerError> {
    let (project, kind) = project_and_kind(path)?;
    let stored = store_upload(&state, auth.account_id, project, kind, &headers, body).await?;
    Ok(Json(stored))
}

pub(crate) async fn store_upload(
    state: &AppState,
    account: AccountId,
    project: SharedProjectId,
    kind: OutputKind,
    headers: &HeaderMap,
    body: Body,
) -> Result<ProjectOutput, ServerError> {
    let main_file = main_file(headers)?;
    let for_pdf = for_pdf(kind, headers)?;
    let limit = megabytes(state.config.limits.max_file_mb);
    content_length_within(headers, limit)?;
    let owner = state
        .db
        .call(move |conn| {
            let (row, role) = access(conn, project, account)?;
            require(role, ProjectAction::Edit)?;
            if row.status == ProjectStatus::Archived {
                return Err(ServerError::Conflict(
                    "This project is no longer shared.".to_string(),
                ));
            }
            Ok(row.owner)
        })
        .await?;
    let _room = state
        .transfers
        .hold(
            account,
            declared_length(headers).unwrap_or(limit).min(limit),
        )
        .await?;
    let Some(bytes) = state.transfers.read_body(body, headers, limit).await? else {
        return Err(ServerError::BadRequest(format!(
            "This file is larger than the server allows ({} MB).",
            state.config.limits.max_file_mb
        )));
    };
    if !looks_like(kind, &bytes) {
        return Err(ServerError::BadRequest(match kind {
            OutputKind::Synctex => "SyncTeX output must be gzip compressed.".to_string(),
            _ => "This is not a PDF.".to_string(),
        }));
    }
    let new = NewOutput {
        project,
        kind,
        compiled_by: account,
        main_file,
        storage: Storage::for_upload(owner, account, state.config.quotas.storage_mb),
        for_pdf,
    };
    let stored = outputs::store(state, new, bytes, state.clock.now_ms()).await?;
    #[cfg(feature = "web")]
    crate::web::output_changed(state, project).await;
    Ok(stored)
}

async fn get_output(
    State(state): State<AppState>,
    auth: Authenticated,
    path: Result<Path<(String, String)>, PathRejection>,
) -> Result<Response, ServerError> {
    let (project, kind) = project_and_kind(path)?;
    let account = auth.account_id;
    state
        .db
        .read(move |conn| access(conn, project, account).map(drop))
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
    if let Ok(etag) = HeaderValue::from_str(&format!("\"{}\"", opened.hash)) {
        headers.insert(header::ETAG, etag);
    }
    if let Ok(main) = HeaderValue::from_str(&encode_main_file(&opened.output.main_file)) {
        headers.insert(HeaderName::from_static(MAIN_FILE_HEADER), main);
    }
    Ok((headers, room.send(opened.reader).await?).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pdf_is_known_by_its_header_and_synctex_by_gzip() {
        assert!(looks_like(OutputKind::Pdf, b"%PDF-1.7\n"));
        let mut late = vec![b' '; 900];
        late.extend_from_slice(b"%PDF-1.5");
        assert!(looks_like(OutputKind::Pdf, &late));
        let mut too_late = vec![b' '; 1100];
        too_late.extend_from_slice(b"%PDF-1.5");
        assert!(!looks_like(OutputKind::Pdf, &too_late));
        assert!(!looks_like(OutputKind::Pdf, b"<html>"));
        assert!(looks_like(OutputKind::Synctex, &[0x1f, 0x8b, 8, 0]));
        assert!(!looks_like(OutputKind::Synctex, b"SyncTeX Version:1"));
    }

    #[test]
    fn the_main_file_header_is_required_and_decoded() {
        let mut headers = HeaderMap::new();
        assert!(main_file(&headers).is_err());
        headers.insert(
            MAIN_FILE_HEADER,
            HeaderValue::from_static("chapters/one%20two.tex"),
        );
        assert_eq!(main_file(&headers).unwrap(), "chapters/one two.tex");
        headers.insert(MAIN_FILE_HEADER, HeaderValue::from_static("%0A"));
        assert!(main_file(&headers).is_err());
        headers.insert(MAIN_FILE_HEADER, HeaderValue::from_static("%20"));
        assert!(main_file(&headers).is_err());
        let long = "a".repeat(MAX_MAIN_FILE_CHARS + 1);
        headers.insert(MAIN_FILE_HEADER, HeaderValue::from_str(&long).unwrap());
        assert!(main_file(&headers).is_err());
    }

    #[test]
    fn only_synctex_names_its_pdf_and_only_by_hash() {
        let mut headers = HeaderMap::new();
        assert_eq!(for_pdf(OutputKind::Synctex, &headers).unwrap(), None);
        let hash = "AB".repeat(32);
        headers.insert(FOR_PDF_HEADER, HeaderValue::from_str(&hash).unwrap());
        assert_eq!(
            for_pdf(OutputKind::Synctex, &headers).unwrap(),
            Some("ab".repeat(32))
        );
        assert!(for_pdf(OutputKind::Pdf, &headers).is_err());
        headers.insert(FOR_PDF_HEADER, HeaderValue::from_static("not-a-hash"));
        assert!(for_pdf(OutputKind::Synctex, &headers).is_err());
    }
}
