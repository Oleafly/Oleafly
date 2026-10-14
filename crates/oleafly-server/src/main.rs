use std::collections::BTreeMap;
use std::process::ExitCode;

use oleafly_server::cli::{self, Command};
use oleafly_server::config::ServerConfig;
use oleafly_server::healthcheck;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

#[tokio::main]
async fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args_os()
        .skip(1)
        .map(|argument| argument.to_string_lossy().into_owned())
        .collect();
    match cli::parse_command(&arguments) {
        Ok(Command::Version) => {
            println!("{}", cli::version_line());
            ExitCode::SUCCESS
        }
        Ok(Command::Healthcheck) => run_healthcheck().await,
        Ok(Command::Serve) => run_server().await,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::from(64)
        }
    }
}

async fn run_healthcheck() -> ExitCode {
    let vars: BTreeMap<String, String> = std::env::var("OLEAFLY_BIND")
        .ok()
        .map(|value| ("OLEAFLY_BIND".to_string(), value))
        .into_iter()
        .collect();
    let result = match healthcheck::target(&vars) {
        Ok(address) => healthcheck::check(address).await,
        Err(message) => Err(message),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("oleafly-server healthcheck: {message}");
            ExitCode::FAILURE
        }
    }
}

async fn run_server() -> ExitCode {
    let config = match ServerConfig::from_env() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("Oleafly Server cannot start. {error}");
            return ExitCode::from(2);
        }
    };
    if let Err(error) = config.require_sign_in() {
        eprintln!("Oleafly Server cannot start. {error}");
        return ExitCode::from(2);
    }
    let level = config
        .log_level
        .parse::<tracing::Level>()
        .unwrap_or(tracing::Level::INFO);
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_target(false),
        )
        .with(oleafly_server::log_filter(level))
        .init();
    match oleafly_server::serve(config).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!("{error}");
            ExitCode::FAILURE
        }
    }
}
