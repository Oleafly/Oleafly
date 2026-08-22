use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use oleafly_realtime_server::{router, storage::Storage, AppState, ServerConfig};
use tracing::info;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "oleafly-realtime-server", version, about)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run the experimental control and sync HTTP service.
    Serve,
    /// Apply this server package's PostgreSQL migrations.
    Migrate,
    /// Verify configuration, PostgreSQL, migrations, and the instance identity.
    Doctor,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
    let cli = Cli::parse();
    let config = ServerConfig::from_env()?;
    match cli.command {
        Command::Serve => serve(config).await,
        Command::Migrate => migrate(config).await,
        Command::Doctor => doctor(config).await,
    }
}

async fn serve(config: ServerConfig) -> Result<()> {
    let bind = config.bind;
    let state = AppState::initialize(config).await?;
    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .with_context(|| format!("bind realtime server to {bind}"))?;
    info!(%bind, instance_id = %state.instance_id, "Oleafly realtime server listening (experimental)");
    axum::serve(
        listener,
        router(state).into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .context("serve realtime HTTP/WebSocket traffic")
}

async fn migrate(config: ServerConfig) -> Result<()> {
    let storage = Storage::connect(&config.database_url, config.master_key).await?;
    storage.migrate().await?;
    info!("realtime migrations are current");
    Ok(())
}

async fn doctor(config: ServerConfig) -> Result<()> {
    let state = AppState::initialize(config).await?;
    anyhow::ensure!(
        state.storage.ready().await,
        "PostgreSQL readiness check failed"
    );
    info!(instance_id = %state.instance_id, "realtime server checks passed");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("install Ctrl+C signal handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM signal handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
}
