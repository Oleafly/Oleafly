pub mod auth;
pub mod cli;
pub mod clock;
pub mod config;
pub mod db;
pub mod error;
pub mod healthcheck;
pub mod members;
pub mod routes;
pub mod security_log;
pub mod settings;
pub mod sockets;
pub mod state;
#[cfg(any(test, feature = "test-support"))]
pub mod test_support;
pub mod tokens;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::DefaultBodyLimit;
use axum::Router;

use crate::clock::SystemClock;
use crate::config::ServerConfig;
use crate::error::ServerError;
use crate::state::AppState;

pub const MAX_BODY_BYTES: usize = 256 * 1024;
const MAINTENANCE_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

pub fn build_router(state: AppState) -> Router {
    let prefix = state.config.path_prefix().to_string();
    let mut router = Router::new().merge(routes::api_routes());
    if !prefix.is_empty() {
        router = router.nest(&prefix, routes::api_routes());
    }
    router
        .fallback(routes::not_found)
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(state)
}

pub async fn serve(config: ServerConfig) -> Result<(), ServerError> {
    if config.providers.is_empty() {
        tracing::warn!(
            "No sign-in provider is configured, so nobody can sign in yet. Set OLEAFLY_GITHUB_CLIENT_ID and OLEAFLY_GITHUB_CLIENT_SECRET, or an OLEAFLY_OIDC_<NAME>_ISSUER block."
        );
    }
    let bind = config.bind;
    let state = AppState::new(config, Arc::new(SystemClock)).await?;
    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .map_err(|error| ServerError::Internal(format!("could not listen on {bind}: {error}")))?;
    tracing::info!(
        "Oleafly Server {} is listening on {bind} for {}",
        env!("CARGO_PKG_VERSION"),
        state.config.public_url
    );
    let maintenance = tokio::spawn(maintenance_loop(state.clone()));
    let app = build_router(state).into_make_service_with_connect_info::<SocketAddr>();
    let result = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await;
    maintenance.abort();
    result.map_err(|error| ServerError::Internal(format!("the server stopped: {error}")))
}

async fn maintenance_loop(state: AppState) {
    let mut interval = tokio::time::interval(MAINTENANCE_INTERVAL);
    loop {
        interval.tick().await;
        match state.run_maintenance().await {
            Ok(report) => tracing::debug!(
                "Maintenance removed {} security events and {} expired sign-in rows",
                report.security_events,
                report.expired_rows
            ),
            Err(error) => tracing::warn!("Maintenance failed: {error}"),
        }
    }
}

async fn shutdown_signal() {
    let interrupt = async {
        if tokio::signal::ctrl_c().await.is_err() {
            std::future::pending::<()>().await;
        }
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut stream) => {
                stream.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = interrupt => {}
        () = terminate => {}
    }
    tracing::info!("Shutting down");
}
