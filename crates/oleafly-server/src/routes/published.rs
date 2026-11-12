use axum::body::Body;
use axum::extract::rejection::PathRejection;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use oleafly_collab_protocol::published::{
    AdminPublishedNote, PublishNote, PublishedNote, PublishedNotes, MAX_PAGE_BYTES,
};
use oleafly_collab_protocol::roles::{server_role_allows, ServerAction};

use crate::error::ServerError;
use crate::i18n::{Key, PageLocale};
use crate::published::{self, Change, Publish, Upload};
use crate::quotas::Storage;
use crate::rate_limit::client_key;
use crate::routes::projects::{body_within, megabytes};
use crate::routes::sign_in_pages::{notice, Tone};
use crate::routes::{Authenticated, ClientIp};
use crate::settings;
use crate::state::AppState;
use crate::transfers::declared_length;

pub const CONTENT_SECURITY_POLICY: &str = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const ROBOTS: HeaderName = HeaderName::from_static("x-robots-tag");
const NO_INDEX: &str = "noindex, nofollow";
const JSON_ROOM: u64 = 64 * 1024;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/published-notes", get(list).post(publish))
        .route("/api/v1/published-notes/{id}", delete(unpublish))
        .route("/api/v1/admin/published-notes", get(admin_list))
        .route(
            "/api/v1/admin/published-notes/{id}/take-down",
            post(take_down),
        )
        .route("/api/v1/admin/published-notes/{id}/restore", post(restore))
        .route("/n/{slug}", get(show))
        .layer(axum::middleware::map_response(crate::transfers::retry_soon))
}

fn page_limit(state: &AppState) -> u64 {
    MAX_PAGE_BYTES.min(megabytes(state.config.limits.max_file_mb))
}

async fn list(
    State(state): State<AppState>,
    auth: Authenticated,
) -> Result<Json<PublishedNotes>, ServerError> {
    let account = auth.account_id;
    let may_publish = server_role_allows(auth.role, ServerAction::ShareProjects);
    let base = state.config.public_url.clone();
    let listed = state
        .db
        .read(move |conn| {
            Ok(PublishedNotes {
                allowed: may_publish && settings::load(conn)?.public_notes_allowed,
                notes: published::list(conn, account, &base)?,
            })
        })
        .await?;
    Ok(Json(listed))
}

async fn publish(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    body: Body,
) -> Result<Json<PublishedNote>, ServerError> {
    auth.require(ServerAction::ShareProjects)?;
    let account = auth.account_id;
    if !state
        .published
        .publishes
        .allow(&account.to_string(), state.clock.now_ms())
    {
        return Err(ServerError::RateLimited);
    }
    let limit = page_limit(&state);
    let within = limit.saturating_add(limit / 4).saturating_add(JSON_ROOM);
    let body = body_within(&headers, body, within)
        .await
        .map_err(|_| published::too_large(limit))?;
    if !state
        .db
        .read(|conn| Ok(settings::load(conn)?.public_notes_allowed))
        .await?
    {
        return Err(published::turned_off());
    }
    let _room = state
        .transfers
        .hold(
            account,
            declared_length(&headers).unwrap_or(within).min(within),
        )
        .await?;
    let Some(bytes) = state.transfers.read_body(body, &headers, within).await? else {
        return Err(published::too_large(limit));
    };
    let note: PublishNote = serde_json::from_slice(&bytes)
        .map_err(|error| ServerError::BadRequest(format!("The page is not valid JSON: {error}")))?;
    drop(bytes);
    let upload = Upload {
        source: note.source,
        title: note.title,
        html: note.html,
    };
    published::check_upload(&upload, limit)?;
    let upload = tokio::task::spawn_blocking(move || Upload {
        html: published::sanitize(&upload.html),
        ..upload
    })
    .await
    .map_err(|error| ServerError::Internal(format!("cleaning a page failed: {error}")))?;
    if upload.html.len() as u64 > limit {
        return Err(published::too_large(limit));
    }
    let storage = Storage::for_upload(account, account, state.config.quotas.storage_mb);
    let uploads = state.config.quotas.uploads_per_hour;
    let base = state.config.public_url.clone();
    let now = state.clock.now_ms();
    let stored = state
        .db
        .call(move |conn| {
            published::store(
                conn,
                Publish {
                    account,
                    upload: &upload,
                    storage,
                    uploads,
                    base: &base,
                    ip,
                    now,
                },
            )
        })
        .await?;
    Ok(Json(stored))
}

fn page_id(path: Result<Path<String>, PathRejection>) -> Result<String, ServerError> {
    let Path(id) = path.map_err(|rejection| ServerError::BadRequest(rejection.body_text()))?;
    uuid::Uuid::parse_str(&id)
        .map(|_| id)
        .map_err(|_| ServerError::NotFound)
}

async fn unpublish(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
) -> Result<StatusCode, ServerError> {
    let id = page_id(path)?;
    let base = state.config.public_url.clone();
    let now = state.clock.now_ms();
    let actor = auth.account_id;
    state
        .db
        .call(move |conn| {
            published::remove(
                conn,
                Change {
                    actor,
                    id: &id,
                    base: &base,
                    ip,
                    now,
                },
            )
        })
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn admin_list(
    State(state): State<AppState>,
    auth: Authenticated,
) -> Result<Json<Vec<AdminPublishedNote>>, ServerError> {
    auth.require(ServerAction::ManageMembers)?;
    let base = state.config.public_url.clone();
    let listed = state
        .db
        .read(move |conn| published::admin_list(conn, &base))
        .await?;
    Ok(Json(listed))
}

async fn set_taken_down(
    state: AppState,
    auth: Authenticated,
    ip: Option<String>,
    path: Result<Path<String>, PathRejection>,
    down: bool,
) -> Result<Json<AdminPublishedNote>, ServerError> {
    auth.require(ServerAction::ManageMembers)?;
    let id = page_id(path)?;
    let base = state.config.public_url.clone();
    let now = state.clock.now_ms();
    let actor = auth.account_id;
    let changed = state
        .db
        .call(move |conn| {
            published::set_taken_down(
                conn,
                Change {
                    actor,
                    id: &id,
                    base: &base,
                    ip,
                    now,
                },
                down,
            )
        })
        .await?;
    Ok(Json(changed))
}

async fn take_down(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<AdminPublishedNote>, ServerError> {
    set_taken_down(state, auth, ip, path, true).await
}

async fn restore(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<AdminPublishedNote>, ServerError> {
    set_taken_down(state, auth, ip, path, false).await
}

fn guarded(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(ROBOTS, HeaderValue::from_static(NO_INDEX));
    response
}

fn gone(locale: crate::i18n::Locale) -> Response {
    guarded(notice(
        locale,
        StatusCode::NOT_FOUND,
        Tone::Info,
        Key::PublishedGoneTitle,
        Key::PublishedGoneBody,
    ))
}

fn page_headers(headers: &mut HeaderMap, etag: &str) {
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    if let Ok(value) = HeaderValue::from_str(etag) {
        headers.insert(header::ETAG, value);
    }
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(CONTENT_SECURITY_POLICY),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(ROBOTS, HeaderValue::from_static(NO_INDEX));
}

fn unchanged(request: &HeaderMap, etag: &str) -> bool {
    request
        .get_all(header::IF_NONE_MATCH)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .any(|candidate| candidate == "*" || candidate.trim_start_matches("W/") == etag)
}

async fn show(
    State(state): State<AppState>,
    PageLocale(locale): PageLocale,
    ClientIp(ip): ClientIp,
    request: HeaderMap,
    path: Result<Path<String>, PathRejection>,
) -> Response {
    let key = ip.as_deref().map(client_key).unwrap_or_default();
    if !state.published.pages.allow(&key, state.clock.now_ms()) {
        return guarded(
            (
                StatusCode::TOO_MANY_REQUESTS,
                [(header::RETRY_AFTER, "60")],
                "Too many requests. Try again in a minute.",
            )
                .into_response(),
        );
    }
    let Ok(Path(slug)) = path else {
        return gone(locale);
    };
    let found = state
        .db
        .read(move |conn| published::page(conn, &slug))
        .await;
    let page = match found {
        Ok(Some(page)) => page,
        Ok(None) => return gone(locale),
        Err(error) => return error.into_response(),
    };
    let etag = published::page_etag(&page, &state.config.server_name);
    if unchanged(&request, &etag) {
        let mut response = StatusCode::NOT_MODIFIED.into_response();
        page_headers(response.headers_mut(), &etag);
        return response;
    }
    let mut response = published::render(&page, &state.config.server_name).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    page_headers(headers, &etag);
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_matching_etag_in_any_form_means_unchanged() {
        let mut request = HeaderMap::new();
        assert!(!unchanged(&request, "\"a.b\""));
        request.insert(
            header::IF_NONE_MATCH,
            HeaderValue::from_static("\"x\", W/\"a.b\""),
        );
        assert!(unchanged(&request, "\"a.b\""));
        assert!(!unchanged(&request, "\"c.d\""));
        request.insert(header::IF_NONE_MATCH, HeaderValue::from_static("*"));
        assert!(unchanged(&request, "\"c.d\""));
    }

    #[test]
    fn the_page_policy_sandboxes_the_page_and_allows_only_embedded_images() {
        for part in [
            "sandbox",
            "default-src 'none'",
            "img-src data:",
            "base-uri 'none'",
            "form-action 'none'",
            "frame-ancestors 'none'",
        ] {
            assert!(CONTENT_SECURITY_POLICY.contains(part), "{part}");
        }
        assert!(!CONTENT_SECURITY_POLICY.contains("script-src"));
    }
}
