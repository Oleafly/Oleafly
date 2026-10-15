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
pub mod i18n;
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
pub mod transfers;

use std::future::Future;
use std::net::SocketAddr;
use std::path::Path;
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
// Documents kept between comment checks and mention scans are dropped once
// idle, even when no check or scan comes along to do it.
const KEPT_SWEEP_INTERVAL: Duration = Duration::from_secs(60);
// Sockets are told the server is restarting and get this long to close.
const SOCKET_FAREWELL: Duration = Duration::from_secs(2);

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

#[derive(Debug)]
pub enum ServeError {
    // A setting or the machine stops the server from starting. The message
    // names the setting to check.
    CannotStart(String),
    Failed(ServerError),
}

impl std::fmt::Display for ServeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ServeError::CannotStart(message) => {
                write!(formatter, "Oleafly Server cannot start. {message}")
            }
            ServeError::Failed(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for ServeError {}

fn cannot_listen(bind: SocketAddr, error: &std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::AddrInUse {
        let mut free = bind;
        free.set_port(bind.port().checked_add(1).unwrap_or(8081));
        format!(
            "Port {} is already in use. Stop the other program, or set OLEAFLY_BIND to a free address such as {free}.",
            bind.port()
        )
    } else {
        format!(
            "It could not listen on {bind} ({error}). Set OLEAFLY_BIND to an address and port this machine lets it use."
        )
    }
}

fn bucket_refused(error: &ServerError) -> String {
    let detail = match error {
        ServerError::Internal(detail) => detail.clone(),
        other => other.to_string(),
    };
    let check = [
        (
            "SignatureDoesNotMatch",
            "Check OLEAFLY_S3_SECRET_ACCESS_KEY.",
        ),
        ("InvalidAccessKeyId", "Check OLEAFLY_S3_ACCESS_KEY_ID."),
        (
            "NoSuchBucket",
            "Check the bucket name in OLEAFLY_BLOB_STORE.",
        ),
        (
            "RequestTimeTooSkewed",
            "Set this machine's clock to the right time.",
        ),
        (
            "AccessDenied",
            "Let the key in OLEAFLY_S3_ACCESS_KEY_ID put, get and delete objects in the bucket.",
        ),
        (
            "could not reach",
            "Check OLEAFLY_S3_ENDPOINT and the network.",
        ),
    ]
    .iter()
    .find(|(sign, _)| detail.contains(sign))
    .map_or(
        "Check OLEAFLY_BLOB_STORE and the OLEAFLY_S3_ settings.",
        |(_, check)| check,
    );
    format!("The S3 bucket did not accept a test file: {detail}. {check}")
}

fn check_data_dir(data_dir: &Path) -> Result<(), String> {
    let unwritable = |error: std::io::Error| {
        format!(
            "The server can't write to {} (OLEAFLY_DATA_DIR): {error}. Make that folder writable by the user the server runs as (uid 10001 in the Docker image).",
            data_dir.display()
        )
    };
    std::fs::create_dir_all(data_dir).map_err(unwritable)?;
    let probe = data_dir.join(format!(".oleafly-write-check-{}", tokens::random_token()));
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .map_err(unwritable)?;
    std::fs::remove_file(&probe).map_err(unwritable)
}

pub async fn serve(config: ServerConfig) -> Result<(), ServeError> {
    let bind = config.bind;
    let data_dir = config.data_dir.clone();
    tokio::task::spawn_blocking(move || check_data_dir(&data_dir))
        .await
        .map_err(|error| ServeError::CannotStart(error.to_string()))?
        .map_err(ServeError::CannotStart)?;
    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .map_err(|error| ServeError::CannotStart(cannot_listen(bind, &error)))?;
    let state = AppState::new(config, Arc::new(SystemClock))
        .await
        .map_err(|error| ServeError::CannotStart(error.to_string()))?;
    state
        .blobs
        .probe()
        .await
        .map_err(|error| ServeError::CannotStart(bucket_refused(&error)))?;
    tracing::info!(
        "Oleafly Server {} is listening on {bind} for {}",
        env!("CARGO_PKG_VERSION"),
        state.config.public_url
    );
    serve_on(state, listener, shutdown_signal())
        .await
        .map_err(ServeError::Failed)
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
    let sweeping = tokio::spawn(sweep_kept_loop(state.snapshots.clone()));
    let polls = Arc::clone(&state.polls);
    let sockets = Arc::clone(&state.sockets);
    let app = build_router(state).into_make_service_with_connect_info::<SocketAddr>();
    let farewell = Arc::clone(&sockets);
    let result = axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            shutdown.await;
            polls.stop_waiting();
            farewell.restart_all();
        })
        .await;
    let deadline = tokio::time::Instant::now() + SOCKET_FAREWELL;
    while sockets.open_sockets() > 0 && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    maintenance.abort();
    sweeping.abort();
    result.map_err(|error| ServerError::Internal(format!("the server stopped: {error}")))
}

async fn sweep_kept_loop(snapshots: snapshots::Snapshots) {
    let mut interval = tokio::time::interval(KEPT_SWEEP_INTERVAL);
    loop {
        interval.tick().await;
        snapshots.sweep_kept();
    }
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

    use super::{log_filter, serve, ServeError};
    use crate::test_support::test_config;

    async fn cannot_start(config: crate::config::ServerConfig) -> String {
        match serve(config).await {
            Err(ServeError::CannotStart(message)) => message,
            Err(other) => panic!("the server failed another way: {other}"),
            Ok(()) => panic!("the server started"),
        }
    }

    #[tokio::test]
    async fn a_port_in_use_is_reported_with_the_setting_to_change() {
        let directory = tempfile::tempdir().unwrap();
        let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let mut config = test_config();
        config.data_dir = directory.path().to_path_buf();
        config.bind = taken.local_addr().unwrap();
        let message = cannot_start(config).await;
        assert!(message.contains("already in use"), "{message}");
        assert!(message.contains("OLEAFLY_BIND"), "{message}");
    }

    #[tokio::test]
    async fn a_bucket_that_refuses_the_keys_stops_the_server_and_names_the_setting() {
        let mock = crate::test_support::MockS3::start().await;
        let directory = tempfile::tempdir().unwrap();
        let mut bucket = mock.config("oleafly");
        bucket.secret_access_key = "not-the-secret".to_owned();
        let mut config = test_config();
        config.data_dir = directory.path().to_path_buf();
        config.bind = "127.0.0.1:0".parse().unwrap();
        config.blob_store = crate::config::BlobStoreConfig::S3(Box::new(bucket));
        let message = cannot_start(config).await;
        assert!(
            message.contains("OLEAFLY_S3_SECRET_ACCESS_KEY"),
            "{message}"
        );
        assert!(!message.contains("not-the-secret"), "{message}");
        assert!(mock.keys().is_empty());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_data_folder_the_server_cannot_write_is_reported_with_the_setting_to_fix() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let locked = directory.path().join("data");
        std::fs::create_dir(&locked).unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o500)).unwrap();
        if std::fs::write(locked.join("probe"), b"x").is_ok() {
            // Running as root, which ignores the folder's permissions.
            return;
        }
        let mut config = test_config();
        config.data_dir = locked.clone();
        config.bind = "127.0.0.1:0".parse().unwrap();
        let message = cannot_start(config).await;
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(message.contains("OLEAFLY_DATA_DIR"), "{message}");
        assert!(message.contains("uid 10001"), "{message}");
    }

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
