pub mod acp_task;
pub mod client;
pub mod control;
pub mod hosts;
pub mod lock;
pub mod log;
pub mod login_item;
pub mod notify;
pub mod paths;
pub mod search_dirs;
pub mod serve;
pub mod state;

use std::path::PathBuf;
use std::time::Duration;

use serde_json::json;

pub use client::{HelperStatus, HelperTask};
pub use paths::{helper_paths, HelperPaths};
pub use serve::{serve, AppLaunch, Localizer, ServeMode, ServeOptions};
pub use state::{HelperState, Phase};

use crate::contract::{CliError, Context, ErrorKind, Outcome};

#[derive(Debug, clap::Subcommand)]
pub enum Commands {
    /// Run and inspect the background helper
    #[command(subcommand)]
    Daemon(DaemonCommand),
}

#[derive(Debug, clap::Subcommand)]
pub enum DaemonCommand {
    /// Run the background helper in this terminal
    Run(DaemonRunArgs),
    /// Show whether the background helper is running
    Status,
    /// Stop the background helper; its tasks wait for Oleafly
    Stop(DaemonStopArgs),
}

#[derive(Debug, clap::Args)]
pub struct DaemonRunArgs {
    #[arg(long, help = "Keep running when there is nothing to do")]
    pub stay: bool,
}

#[derive(Debug, clap::Args)]
pub struct DaemonStopArgs {
    #[arg(long, default_value_t = 30, value_name = "SECONDS", value_parser = clap::value_parser!(u64).range(0..=600), help = "How long to wait for the helper to stop")]
    pub wait: u64,
    #[arg(long, help = "End the helper if it doesn't stop in time")]
    pub force: bool,
}

const FOREGROUND_IDLE: Duration = Duration::from_secs(30);
const AFTER_TERMINATE: Duration = Duration::from_secs(5);

fn data_root(ctx: &Context) -> Result<PathBuf, CliError> {
    ctx.data_root()
        .map(std::path::Path::to_path_buf)
        .ok_or_else(|| {
            CliError::new(
                ErrorKind::MissingTool,
                "daemon.no_data_folder",
                "Oleafly's data folder isn't known.",
            )
            .hint("Set OLEAFLY_DATA_DIR, or HOME.")
        })
}

fn io_error(error: std::io::Error) -> CliError {
    CliError::new(ErrorKind::Io, "daemon.io", error.to_string())
}

impl crate::commands::CommandModule for Commands {
    fn name(&self) -> &'static str {
        match self {
            Self::Daemon(DaemonCommand::Run(_)) => "daemon run",
            Self::Daemon(DaemonCommand::Status) => "daemon status",
            Self::Daemon(DaemonCommand::Stop(_)) => "daemon stop",
        }
    }

    fn handles_interrupt(&self) -> bool {
        matches!(self, Self::Daemon(DaemonCommand::Run(_)))
    }

    async fn run(self, ctx: &Context) -> Result<Outcome, CliError> {
        match self {
            Self::Daemon(DaemonCommand::Run(args)) => run_helper(ctx, args).await,
            Self::Daemon(DaemonCommand::Status) => status(ctx).await,
            Self::Daemon(DaemonCommand::Stop(args)) => stop(ctx, args).await,
        }
    }
}

async fn run_helper(ctx: &Context, args: DaemonRunArgs) -> Result<Outcome, CliError> {
    let data_root = data_root(ctx)?;
    let options = ServeOptions {
        mode: ServeMode::Foreground,
        data_root: data_root.clone(),
        exe: crate::app_paths::own_executable()
            .or_else(|| std::env::current_exe().ok())
            .unwrap_or_default(),
        resources_dir: crate::app_paths::installed_app().and_then(|app| app.resources_dir),
        app_launch: None,
        localize: None,
        stay: args.stay,
        log_to_stderr: !ctx.json(),
        idle_grace: FOREGROUND_IDLE,
    };
    ctx.note(format!(
        "The background helper is running. Its log is {}. Press Ctrl+C to stop it.",
        helper_paths(&data_root).log.display()
    ));
    let helper = std::thread::Builder::new()
        .name("oleafly-helper".into())
        .spawn(move || serve(options))
        .map_err(io_error)?;
    let code = tokio::task::spawn_blocking(move || helper.join().unwrap_or(1))
        .await
        .map_err(|_| CliError::internal("The background helper stopped unexpectedly."))?;
    match code {
        0 => Ok(Outcome::success(json!({"daemon": {"stopped": true}}))),
        serve::ALREADY_RUNNING => Err(CliError::new(
            ErrorKind::Conflict,
            "daemon.already_running",
            "Another background helper is already running.",
        )
        .hint("Stop it with: oleafly daemon stop")),
        _ => Err(CliError::internal(format!(
            "The background helper stopped with an error. See its log: {}",
            helper_paths(&data_root).log.display()
        ))),
    }
}

async fn status(ctx: &Context) -> Result<Outcome, CliError> {
    let data_root = data_root(ctx)?;
    let status = tokio::task::spawn_blocking(move || client::status(&data_root))
        .await
        .map_err(|_| CliError::internal("The helper's state could not be read."))?
        .map_err(io_error)?;
    if !ctx.quiet() {
        if status.running {
            let count = status.tasks.len();
            let noun = if count == 1 { "task" } else { "tasks" };
            ctx.say(format!(
                "The background helper is running (pid {}) with {count} {noun}.",
                status
                    .pid
                    .map(|pid| pid.to_string())
                    .unwrap_or_else(|| "unknown".into())
            ));
            for task in &status.tasks {
                ctx.say(format!(
                    "  {} · {} · {}",
                    task.title, task.status, task.project_id
                ));
            }
        } else {
            ctx.say("The background helper isn't running.");
        }
    }
    Ok(Outcome::success(json!({"daemon": status})))
}

async fn stop(ctx: &Context, args: DaemonStopArgs) -> Result<Outcome, CliError> {
    let data_root = data_root(ctx)?;
    let root = data_root.clone();
    let stopped = tokio::task::spawn_blocking(move || -> std::io::Result<(bool, bool)> {
        if !client::status(&root)?.running {
            return Ok((false, true));
        }
        client::request_stop(&root, "cli")?;
        if client::wait_stopped(&root, Duration::from_secs(args.wait))? {
            return Ok((true, true));
        }
        if args.force && client::terminate(&root)? {
            return Ok((true, client::wait_stopped(&root, AFTER_TERMINATE)?));
        }
        Ok((true, false))
    })
    .await
    .map_err(|_| CliError::internal("The helper could not be stopped."))?
    .map_err(io_error)?;
    match stopped {
        (_, false) => Err(CliError::new(
            ErrorKind::Conflict,
            "daemon.still_running",
            "The background helper is still running.",
        )
        .hint("Run again with --force to end it.")
        .retryable()),
        (was_running, true) => {
            if !ctx.quiet() {
                ctx.say(if was_running {
                    "The background helper stopped. Its tasks continue when you open Oleafly."
                } else {
                    "The background helper wasn't running."
                });
            }
            Ok(Outcome::success(
                json!({"daemon": {"running": false, "stopped": was_running}}),
            ))
        }
    }
}

pub fn reentry() -> Option<i32> {
    let config = crate::app_paths::data_root().map(|root| oleafly_sandbox::SandboxConfig {
        state_dir: root.join("sandbox"),
        launcher: None,
    });
    if let Some(code) = oleafly_sandbox::entry(|| config.clone()) {
        return Some(code);
    }
    if let Some(config) = config {
        oleafly_sandbox::configure(config);
    }
    if let Some(code) = oleafly_research::runs::supervisor::run_if_requested() {
        return Some(code);
    }
    if oleafly_research::mcp::stdio_bridge_requested() {
        return Some(oleafly_research::mcp::serve_stdio_bridge());
    }
    None
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    use super::*;
    use crate::{Cli, Command};

    #[test]
    fn daemon_commands_parse_with_their_defaults() {
        let cli = Cli::try_parse_from(["oleafly", "daemon", "stop"]).unwrap();
        let Command::Daemon(Commands::Daemon(DaemonCommand::Stop(args))) = cli.command else {
            panic!("expected daemon stop");
        };
        assert_eq!((args.wait, args.force), (30, false));
        let cli = Cli::try_parse_from(["oleafly", "daemon", "run", "--stay"]).unwrap();
        assert!(matches!(
            cli.command,
            Command::Daemon(Commands::Daemon(DaemonCommand::Run(DaemonRunArgs {
                stay: true
            })))
        ));
        assert!(Cli::try_parse_from(["oleafly", "daemon", "stop", "--wait", "601"]).is_err());
    }

    #[test]
    fn the_daemon_help_names_its_commands_but_not_the_app_flag() {
        let help = <Cli as clap::CommandFactory>::command()
            .find_subcommand_mut("daemon")
            .unwrap()
            .render_long_help()
            .to_string();
        for command in ["run", "status", "stop"] {
            assert!(help.contains(command), "{command}");
        }
        assert!(!help.contains("--oleafly-daemon"));
    }

    #[test]
    fn re_entry_ignores_ordinary_arguments() {
        assert_eq!(reentry(), None);
    }
}
