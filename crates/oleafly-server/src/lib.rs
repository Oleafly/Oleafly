pub mod access_log;
pub mod auth;
pub mod blobs;
pub mod cli;
pub mod clock;
pub mod comment_guard;
pub mod config;
pub mod console;
pub mod db;
pub mod error;
pub mod guests;
pub mod healthcheck;
pub mod mail;
pub mod members;
pub mod mentions;
pub mod peers;
pub mod polls;
pub mod projects;
pub mod rate_limit;
pub mod removals;
pub mod rooms;
pub mod routes;
pub mod security_log;
pub mod settings;
pub mod snapshots;
pub mod sockets;
pub mod state;
#[cfg(any(test, feature = "test-support"))]
pub mod test_support;
pub mod tokens;

use std::future::Future;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::DefaultBodyLimit;
use axum::Router;
use tracing::Level;
use tracing_subscriber::filter::Targets;

use crate::clock::SystemClock;
use crate::config::ServerConfig;
use crate::error::ServerError;
use crate::state::AppState;

pub const MAX_BODY_BYTES: usize = 256 * 1024;
const MAINTENANCE_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

pub fn log_filter(level: Level) -> Targets {
    let others = if level >= Level::DEBUG {
        level
    } else {
        level.min(Level::WARN)
    };
    Targets::new()
        .with_default(others)
        .with_target(env!("CARGO_CRATE_NAME"), level)
}

pub fn build_router(state: AppState) -> Router {
    let prefix = state.config.path_prefix().to_string();
    let mut router = Router::new().merge(routes::api_routes());
    if !prefix.is_empty() {
        router = router.nest(&prefix, routes::api_routes());
    }
    router
        .fallback(routes::not_found)
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            rate_limit::limit_sign_in,
        ))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(state)
}

pub async fn serve(config: ServerConfig) -> Result<(), ServerError> {
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
    serve_on(state, listener, shutdown_signal()).await
}

pub async fn serve_on<F>(
    state: AppState,
    listener: tokio::net::TcpListener,
    shutdown: F,
) -> Result<(), ServerError>
where
    F: Future<Output = ()> + Send + 'static,
{
    mentions::resume(&state).await;
    let maintenance = tokio::spawn(maintenance_loop(state.clone()));
    let polls = Arc::clone(&state.polls);
    let app = build_router(state).into_make_service_with_connect_info::<SocketAddr>();
    let result = axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            shutdown.await;
            polls.stop_waiting();
        })
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
                "Maintenance removed {} security events, {} expired sign-in rows and {} old guest invitations",
                report.security_events,
                report.expired_rows,
                report.guest_invitations
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

#[cfg(test)]
mod tests {
    use tracing::Level;

    use super::log_filter;

    #[test]
    fn other_libraries_log_only_warnings_unless_debugging_is_asked_for() {
        let info = log_filter(Level::INFO);
        assert!(info.would_enable("oleafly_server::mail", &Level::INFO));
        assert!(!info.would_enable("oleafly_server::mail", &Level::DEBUG));
        assert!(!info.would_enable("loro_internal::oplog", &Level::INFO));
        assert!(info.would_enable("loro_internal::oplog", &Level::WARN));
        assert!(!info.would_enable("hyper::proto", &Level::INFO));
        let quiet = log_filter(Level::ERROR);
        assert!(!quiet.would_enable("oleafly_server::mail", &Level::WARN));
        assert!(!quiet.would_enable("loro_internal::oplog", &Level::WARN));
        assert!(quiet.would_enable("loro_internal::oplog", &Level::ERROR));
        let debug = log_filter(Level::DEBUG);
        assert!(debug.would_enable("loro_internal::oplog", &Level::DEBUG));
        assert!(!debug.would_enable("loro_internal::oplog", &Level::TRACE));
        let trace = log_filter(Level::TRACE);
        assert!(trace.would_enable("loro_internal::oplog", &Level::TRACE));
    }
}
