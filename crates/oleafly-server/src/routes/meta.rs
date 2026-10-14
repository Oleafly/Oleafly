use std::io::Write;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use oleafly_collab_protocol::capabilities::{
    CapabilityManifest, EncryptionSupport, Features, Limits, ProtocolRange, PROTOCOL_VERSION,
    WELL_KNOWN_PATH,
};
use serde_json::{json, Value};
use tokio::sync::Mutex;
use tokio::time::Instant;

use crate::auth::email_link;
use crate::db;
use crate::error::ServerError;
use crate::members;
use crate::settings;
use crate::state::AppState;
use crate::tokens::random_token;

const GUESTS_IMPLEMENTED: bool = true;
const READINESS_REUSED_FOR: Duration = Duration::from_secs(5);
const READINESS_KEY: &str = "readiness_probe";

pub const PROTOCOLS: ProtocolRange = ProtocolRange {
    min: PROTOCOL_VERSION,
    max: PROTOCOL_VERSION,
};

pub fn spoken_protocol(asked: u32) -> Option<u32> {
    chosen_protocol(PROTOCOLS, asked)
}

fn chosen_protocol(range: ProtocolRange, asked: u32) -> Option<u32> {
    (range.min..=range.max).contains(&asked).then_some(asked)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Failing {
    Database,
    Storage,
}

impl Failing {
    fn name(self) -> &'static str {
        match self {
            Failing::Database => "database",
            Failing::Storage => "storage",
        }
    }
}

#[derive(Default)]
struct Readiness {
    last: Mutex<Option<(Instant, Result<(), Failing>)>>,
}

pub fn router() -> Router<AppState> {
    let readiness = Arc::new(Readiness::default());
    Router::new()
        .route(WELL_KNOWN_PATH, get(manifest))
        .route("/healthz", get(healthz))
        .route(
            "/readyz",
            get(move |State(state): State<AppState>| readyz(state, Arc::clone(&readiness))),
        )
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
        protocol: PROTOCOLS,
        needs_setup: admins == 0,
        providers: email_link::with_email_link(
            state.providers.infos(),
            email_link::available(state.mailer.is_configured(), &runtime),
        ),
        features: Features {
            email: state.mailer.is_configured(),
            guests: GUESTS_IMPLEMENTED && runtime.guests_enabled,
            link_sharing: runtime.link_sharing_allowed,
            access_logs: runtime.access_logs_allowed,
            comments: runtime.comments_allowed,
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

async fn readyz(state: AppState, readiness: Arc<Readiness>) -> Response {
    let mut last = readiness.last.lock().await;
    let outcome = match *last {
        Some((checked, outcome)) if checked.elapsed() < READINESS_REUSED_FOR => outcome,
        previous => {
            let outcome = probe(&state).await;
            if previous.is_some_and(|(_, before)| before.is_err()) && outcome.is_ok() {
                tracing::info!("The server can store data again and is ready.");
            }
            *last = Some((Instant::now(), outcome));
            outcome
        }
    };
    drop(last);
    match outcome {
        Ok(()) => Json(json!({"status": "ready"})).into_response(),
        Err(failing) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"status": "unavailable", "failing": failing.name()})),
        )
            .into_response(),
    }
}

async fn probe(state: &AppState) -> Result<(), Failing> {
    let now = state.clock.now_ms();
    let database = state
        .db
        .call(move |conn| {
            let transaction = conn.transaction()?;
            db::meta_set(&transaction, READINESS_KEY, &now.to_string())?;
            db::meta_delete(&transaction, READINESS_KEY)?;
            transaction.commit()?;
            Ok(())
        })
        .await;
    if let Err(error) = database {
        tracing::warn!("The database does not accept writes, so the server is not ready: {error}");
        return Err(Failing::Database);
    }
    let data_dir = state.config.data_dir.clone();
    let storage = tokio::task::spawn_blocking(move || write_probe(&data_dir))
        .await
        .unwrap_or_else(|error| Err(std::io::Error::other(error.to_string())));
    if let Err(error) = storage {
        tracing::warn!(
            "The data folder {} does not accept writes, so the server is not ready: {error}",
            state.config.data_dir.display()
        );
        return Err(Failing::Storage);
    }
    Ok(())
}

fn write_probe(data_dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let path = data_dir.join(format!(".oleafly-ready-{}", random_token()));
    let written = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .and_then(|mut file| {
            file.write_all(b"ready")?;
            file.sync_all()
        });
    let removed = std::fs::remove_file(&path);
    written.and(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hello_inside_the_advertised_range_is_answered_with_its_own_version() {
        let range = ProtocolRange { min: 2, max: 4 };
        assert_eq!(chosen_protocol(range, 1), None);
        assert_eq!(chosen_protocol(range, 2), Some(2));
        assert_eq!(chosen_protocol(range, 3), Some(3));
        assert_eq!(chosen_protocol(range, 4), Some(4));
        assert_eq!(chosen_protocol(range, 5), None);
        assert_eq!(spoken_protocol(PROTOCOL_VERSION), Some(PROTOCOL_VERSION));
        assert_eq!(spoken_protocol(PROTOCOLS.max + 1), None);
    }
}
