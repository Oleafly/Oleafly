use axum::extract::State;
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use oleafly_collab_protocol::capabilities::{
    CapabilityManifest, EncryptionSupport, Features, Limits, ProtocolRange, PROTOCOL_VERSION,
    WELL_KNOWN_PATH,
};
use serde_json::{json, Value};

use crate::error::ServerError;
use crate::members;
use crate::settings;
use crate::state::AppState;

const EMAIL_IMPLEMENTED: bool = false;
const GUESTS_IMPLEMENTED: bool = false;
const ACCESS_LOGS_IMPLEMENTED: bool = false;
const COMMENTS_IMPLEMENTED: bool = false;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(WELL_KNOWN_PATH, get(manifest))
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
}

async fn manifest(State(state): State<AppState>) -> Result<Response, ServerError> {
    let (admins, runtime) = state
        .db
        .call(|conn| Ok((members::count_admins(conn)?, settings::load(conn)?)))
        .await?;
    let config = &state.config;
    let body = CapabilityManifest {
        server_id: state.server_id,
        name: config.server_name.clone(),
        icon_url: config.server_icon_url.clone(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        protocol: ProtocolRange {
            min: PROTOCOL_VERSION,
            max: PROTOCOL_VERSION,
        },
        needs_setup: admins == 0,
        providers: state.providers.infos(),
        features: Features {
            email: EMAIL_IMPLEMENTED && config.smtp_url.is_some() && config.mail_from.is_some(),
            guests: GUESTS_IMPLEMENTED && runtime.guests_enabled,
            link_sharing: runtime.link_sharing_allowed,
            access_logs: ACCESS_LOGS_IMPLEMENTED && runtime.access_logs_allowed,
            comments: COMMENTS_IMPLEMENTED && runtime.comments_allowed,
            encryption: EncryptionSupport::None,
        },
        limits: Limits {
            max_project_mb: config.limits.max_project_mb,
            max_file_mb: config.limits.max_file_mb,
            max_members_per_project: config.limits.max_members_per_project,
        },
    };
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(body)).into_response())
}

async fn healthz() -> Json<Value> {
    Json(json!({"status": "ok"}))
}

async fn readyz(State(state): State<AppState>) -> Result<Json<Value>, ServerError> {
    state
        .db
        .call(|conn| {
            conn.query_row("SELECT 1", [], |row| row.get::<_, i64>(0))?;
            Ok(())
        })
        .await?;
    Ok(Json(json!({"status": "ready"})))
}
