extern crate self as oleafly_cli;

// 0.4.8 L: the headless agent and the background helper.
pub mod agent;
pub mod daemon;

pub mod app_config;
pub mod app_paths;
// 0.4.8 F2: accounts, the online LaTeX service and collaboration servers.
pub mod auth;
pub mod check;
pub mod commands;
pub mod contract;
mod desktop_link;
pub mod engine;
pub mod human;
pub mod install;
mod launcher;
pub mod lint;
pub mod mcp;
mod native;
mod process;
pub mod record;
pub mod remote;
pub mod server;
pub mod skills_read;
mod typst;
mod typst_settings;
pub mod version;

#[cfg(test)]
#[path = "../tests/support/mod.rs"]
mod support;

use clap::{CommandFactory, FromArgMatches, Parser};
use contract::{CliError, Context, ErrorKind, Exit, GlobalArgs, Outcome};
use std::ffi::{OsStr, OsString};
use std::io::Write;
use std::path::Path;
use std::process::ExitCode;

pub use commands::registry::Command;
pub use native::executable_name;

const CONTRACT_NOTICE: &str = "\
Run `oleafly help json` for the --json contract and `oleafly help exit-codes`
for what each exit code means.";

#[derive(Debug, Parser)]
#[command(
    name = "oleafly",
    bin_name = "oleafly",
    version = crate::version::VERSION_LINE,
    about = "Build and manage Oleafly projects",
    disable_help_subcommand = true,
    after_help = CONTRACT_NOTICE,
    after_long_help = CONTRACT_NOTICE
)]
pub struct Cli {
    #[command(flatten)]
    pub global: GlobalArgs,
    #[command(subcommand)]
    pub command: Command,
}

pub fn main() -> ExitCode {
    // MCP servers in this process report the CLI's version.
    oleafly_research::mcp::protocol::set_server_version(crate::version::APP_VERSION);
    // 0.4.8 L: a sandboxed command, a detached run supervisor and the
    // research tool bridge re-enter this binary with their own flags (the
    // background helper started by `oleafly daemon run` runs them).
    if let Some(code) = daemon::reentry() {
        return ExitCode::from(u8::try_from(code).unwrap_or(1));
    }
    let arguments = expand_open_shorthand(std::env::args_os());
    let matches = match Cli::command().try_get_matches_from(&arguments) {
        Ok(matches) => matches,
        Err(error) => return parse_failure(error, &arguments),
    };
    let project_explicit =
        matches.value_source("project") == Some(clap::parser::ValueSource::CommandLine);
    let cli = match Cli::from_arg_matches(&matches) {
        Ok(cli) => cli,
        Err(error) => return parse_failure(error, &arguments),
    };
    match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => ExitCode::from(runtime.block_on(run(cli, project_explicit))),
        Err(error) => {
            human::error(&format!("Oleafly couldn't start: {error}"));
            ExitCode::from(Exit::Internal as u8)
        }
    }
}

/// `--json` or `--events` among the options (before `--`).
fn wants_json(arguments: &[OsString]) -> bool {
    arguments
        .iter()
        .skip(1)
        .take_while(|argument| argument.as_os_str() != "--")
        .any(|argument| argument == "--json" || argument == "--events")
}

/// clap's message without colour, the `error: ` label or usage lines.
fn clap_message(error: &clap::Error) -> String {
    let rendered = error.render().to_string();
    let first = rendered
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default()
        .trim();
    first.strip_prefix("error: ").unwrap_or(first).to_string()
}

fn parse_failure(error: clap::Error, arguments: &[OsString]) -> ExitCode {
    use clap::error::ErrorKind as Kind;
    if matches!(error.kind(), Kind::DisplayHelp | Kind::DisplayVersion) {
        let _ = error.print();
        return ExitCode::SUCCESS;
    }
    if wants_json(arguments) && error.kind() != Kind::DisplayHelpOnMissingArgumentOrSubcommand {
        let envelope = contract::error_envelope(None, &CliError::usage(clap_message(&error)), &[]);
        let mut stdout = std::io::stdout().lock();
        let _ = writeln!(stdout, "{envelope}");
        return ExitCode::from(Exit::Usage as u8);
    }
    with_open_tip(error).exit()
}

fn with_open_tip(mut error: clap::Error) -> clap::Error {
    use clap::error::{ContextKind, ContextValue};
    if error.kind() != clap::error::ErrorKind::InvalidSubcommand {
        return error;
    }
    let Some(ContextValue::String(name)) = error.get(ContextKind::InvalidSubcommand) else {
        return error;
    };
    if !Path::new(name).is_dir() {
        return error;
    }
    let tip = clap::builder::StyledStr::from(format!(
        "to open the folder '{name}', use 'oleafly ./{name}'"
    ));
    let mut tips = match error.get(ContextKind::Suggested) {
        Some(ContextValue::StyledStrs(existing)) => existing.clone(),
        _ => Vec::new(),
    };
    tips.push(tip);
    error.insert(ContextKind::Suggested, ContextValue::StyledStrs(tips));
    error
}

/// `oleafly <folder>` means `oleafly open <folder>`.
pub fn expand_open_shorthand<I, T>(arguments: I) -> Vec<OsString>
where
    I: IntoIterator<Item = T>,
    T: Into<OsString>,
{
    let mut arguments: Vec<OsString> = arguments.into_iter().map(Into::into).collect();
    let mut index = 1;
    while let Some(argument) = arguments.get(index) {
        match argument.to_str() {
            Some("--") => break,
            Some("-C" | "--project" | "--log" | "--color") => index += 2,
            Some(option) if option.starts_with('-') => index += 1,
            _ => {
                if names_a_folder(argument) {
                    arguments.insert(index, OsString::from("open"));
                }
                break;
            }
        }
    }
    arguments
}

fn names_a_folder(argument: &OsStr) -> bool {
    if is_subcommand(argument) {
        return false;
    }
    argument == "."
        || argument == ".."
        || argument
            .to_string_lossy()
            .chars()
            .any(std::path::is_separator)
}

fn is_subcommand(argument: &OsStr) -> bool {
    let Some(name) = argument.to_str() else {
        return false;
    };
    name == "help"
        || Cli::command().get_subcommands().any(|command| {
            command.get_name() == name || command.get_all_aliases().any(|alias| alias == name)
        })
}

/// Resolves when the process is asked to stop: Ctrl+C, and on Unix SIGTERM
/// and SIGHUP too (never, when the handlers can't be set). A process ended by
/// a signal runs no destructors, so the compiler a build started would keep
/// running and the outputs it was holding aside would not go back.
pub(crate) async fn stop_requested() {
    daemon::serve::termination().await;
}

async fn interrupted() -> CliError {
    stop_requested().await;
    CliError::new(ErrorKind::Interrupted, "interrupted", "Stopped.")
}

/// What a panic said, as the internal error a command ends with.
fn panic_error(payload: &(dyn std::any::Any + Send)) -> CliError {
    let said = payload
        .downcast_ref::<&str>()
        .map(|text| (*text).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "no reason given".to_string());
    CliError::internal(format!("Oleafly stopped on a bug: {said}"))
        .hint("Run the command again with RUST_BACKTRACE=1 and report the output as a bug.")
}

/// Runs a command; a panic in it becomes an internal error, so `--json` still
/// gets its one result object and the exit code is the documented one (the
/// panic itself is still reported on stderr).
async fn guarded(
    work: impl std::future::Future<Output = Result<Outcome, CliError>>,
) -> Result<Outcome, CliError> {
    use futures_util::FutureExt;
    match std::panic::AssertUnwindSafe(work).catch_unwind().await {
        Ok(result) => result,
        Err(payload) => Err(panic_error(payload.as_ref())),
    }
}

pub async fn run(cli: Cli, project_explicit: bool) -> u8 {
    human::init_color(cli.global.color);
    let ctx = Context::from_global(&cli.global, project_explicit, cli.command.name());
    let result = guarded(async {
        if cli.command.handles_interrupt() {
            cli.command.run(&ctx).await
        } else {
            tokio::select! {
                result = cli.command.run(&ctx) => result,
                error = interrupted() => Err(error),
            }
        }
    })
    .await;
    finish(&ctx, result)
}

fn print_json(value: &serde_json::Value) {
    let mut stdout = std::io::stdout().lock();
    let _ = serde_json::to_writer(&mut stdout, value);
    let _ = writeln!(stdout);
    let _ = stdout.flush();
}

fn finish(ctx: &Context, result: Result<Outcome, CliError>) -> u8 {
    let warnings = ctx.warnings();
    match result {
        Ok(outcome) => {
            if ctx.json() && outcome.print_envelope {
                print_json(&contract::envelope(ctx.command(), &outcome, &warnings));
            }
            outcome.exit as u8
        }
        Err(error) => {
            if ctx.json() {
                print_json(&contract::error_envelope(
                    Some(ctx.command()),
                    &error,
                    &warnings,
                ));
            } else {
                human::error(&error.message);
                if let Some(hint) = &error.hint {
                    human::hint(hint);
                }
            }
            error.exit() as u8
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use commands::build::Commands as BuildCommands;
    use commands::workspace::Commands as WorkspaceCommands;
    use std::path::PathBuf;

    #[tokio::test]
    async fn a_panic_in_a_command_is_an_internal_error_not_a_crash() {
        let error = guarded(async { panic!("the index is out of range") })
            .await
            .unwrap_err();
        assert_eq!(error.kind, ErrorKind::Internal);
        assert_eq!(error.exit(), Exit::Internal);
        assert!(error.message.contains("the index is out of range"));
        // A formatted message arrives as a String.
        let reason = String::from("byte index 9 is not a char boundary");
        let error = guarded(async move { panic!("{reason}") })
            .await
            .unwrap_err();
        assert!(error.message.contains("byte index 9"));
        assert!(error.hint.is_some());
        // The envelope --json prints for it is the usual error object.
        let envelope = contract::error_envelope(Some("check"), &error, &[]);
        assert_eq!(envelope["ok"], false);
        assert_eq!(envelope["error"]["code"], "internal");
        // A command that finishes is left alone.
        assert!(guarded(async { Ok(Outcome::printed()) }).await.is_ok());
    }

    #[test]
    fn parser_accepts_every_initial_command() {
        for command in [
            vec!["oleaflyc", "init"],
            vec!["oleaflyc", "build"],
            vec!["oleaflyc", "watch"],
            vec!["oleaflyc", "clean"],
            vec!["oleaflyc", "doctor"],
            vec!["oleaflyc", "project", "info"],
            vec!["oleaflyc", "version"],
            vec!["oleaflyc", "help", "build"],
        ] {
            Cli::try_parse_from(command).unwrap();
        }
    }

    fn expanded(arguments: &[&str]) -> Vec<String> {
        expand_open_shorthand(arguments.iter().map(OsString::from))
            .into_iter()
            .map(|argument| argument.into_string().unwrap())
            .collect()
    }

    #[test]
    fn a_path_in_place_of_a_command_opens_that_folder() {
        for (arguments, expected) in [
            (vec!["oleafly", "."], vec!["oleafly", "open", "."]),
            (vec!["oleafly", ".."], vec!["oleafly", "open", ".."]),
            (
                vec!["oleafly", "./build"],
                vec!["oleafly", "open", "./build"],
            ),
            (
                vec!["oleafly", "../thesis"],
                vec!["oleafly", "open", "../thesis"],
            ),
            (
                vec!["oleafly", "/home/me/thesis"],
                vec!["oleafly", "open", "/home/me/thesis"],
            ),
            (
                vec!["oleafly", "papers/my thesis"],
                vec!["oleafly", "open", "papers/my thesis"],
            ),
            (
                vec!["oleafly", "論文/café"],
                vec!["oleafly", "open", "論文/café"],
            ),
            (
                vec!["oleafly", "--json", "."],
                vec!["oleafly", "--json", "open", "."],
            ),
            (
                vec!["oleafly", "-C", "elsewhere", "./x"],
                vec!["oleafly", "-C", "elsewhere", "open", "./x"],
            ),
            (
                vec!["oleafly", "--project", "elsewhere", "."],
                vec!["oleafly", "--project", "elsewhere", "open", "."],
            ),
            (
                vec!["oleafly", "--project=elsewhere", ".."],
                vec!["oleafly", "--project=elsewhere", "open", ".."],
            ),
            (
                vec!["oleafly", "--log", "full", "."],
                vec!["oleafly", "--log", "full", "open", "."],
            ),
            (
                vec!["oleafly", "--color", "never", "."],
                vec!["oleafly", "--color", "never", "open", "."],
            ),
        ] {
            assert_eq!(expanded(&arguments), expected, "{arguments:?}");
        }
    }

    #[test]
    fn commands_and_bare_names_are_left_to_the_parser() {
        for arguments in [
            vec!["oleafly"],
            vec!["oleafly", "build"],
            vec!["oleafly", "build", "./chapters"],
            vec!["oleafly", "--json", "doctor"],
            vec!["oleafly", "-C", "./thesis", "build"],
            vec!["oleafly", "open"],
            vec!["oleafly", "open", "build"],
            vec!["oleafly", "project", "info"],
            vec!["oleafly", "help"],
            vec!["oleafly", "thesis"],
            vec!["oleafly", "--", "."],
            vec!["oleafly", "--help"],
        ] {
            assert_eq!(expanded(&arguments), arguments, "{arguments:?}");
        }
        assert_eq!(
            expanded(&["oleafly", "a\\b"]).len(),
            if cfg!(windows) { 3 } else { 2 }
        );
    }

    #[test]
    fn open_takes_an_optional_folder_that_may_be_named_like_a_command() {
        let cli = Cli::try_parse_from(["oleafly", "open"]).unwrap();
        let Command::Workspace(WorkspaceCommands::Open(command)) = cli.command else {
            panic!("expected open command");
        };
        assert_eq!(command.path, None);
        assert_eq!(cli.global.project, PathBuf::from("."));

        let cli = Cli::try_parse_from(["oleafly", "open", "build"]).unwrap();
        let Command::Workspace(WorkspaceCommands::Open(command)) = cli.command else {
            panic!("expected open command");
        };
        assert_eq!(command.path, Some(PathBuf::from("build")));

        let cli = Cli::try_parse_from(expand_open_shorthand(["oleafly", ".."])).unwrap();
        let Command::Workspace(WorkspaceCommands::Open(command)) = cli.command else {
            panic!("expected open command");
        };
        assert_eq!(command.path, Some(PathBuf::from("..")));

        let cli = Cli::try_parse_from(expand_open_shorthand(["oleafly", "build"])).unwrap();
        assert!(matches!(
            cli.command,
            Command::Build(BuildCommands::Build(_))
        ));
        assert_eq!(cli.command.name(), "build");
    }

    #[test]
    fn build_timeout_is_explicit_and_nonzero() {
        let cli = Cli::try_parse_from(["oleaflyc", "build", "--timeout", "900"]).unwrap();
        let Command::Build(BuildCommands::Build(command)) = cli.command else {
            panic!("expected build command");
        };
        assert_eq!(command.timeout_seconds, 900);
        assert!(Cli::try_parse_from(["oleaflyc", "watch", "--timeout", "0"]).is_err());
    }

    #[test]
    fn build_and_watch_take_a_typst_variant() {
        for command in ["build", "watch"] {
            let cli =
                Cli::try_parse_from(["oleafly", command, "--variant", "camera-ready"]).unwrap();
            let Command::Build(BuildCommands::Build(parsed) | BuildCommands::Watch(parsed)) =
                cli.command
            else {
                panic!("expected a build command");
            };
            assert_eq!(parsed.variant.as_deref(), Some("camera-ready"));
        }
        let cli = Cli::try_parse_from(["oleafly", "build"]).unwrap();
        let Command::Build(BuildCommands::Build(parsed)) = cli.command else {
            panic!("expected build command");
        };
        assert_eq!(parsed.variant, None);
    }

    #[test]
    fn command_names_preserve_the_public_cli_contract() {
        for (arguments, name) in [
            (vec!["oleafly", "init"], "init"),
            (vec!["oleafly", "build"], "build"),
            (vec!["oleafly", "watch"], "watch"),
            (vec!["oleafly", "clean"], "clean"),
            (vec!["oleafly", "doctor"], "doctor"),
            (vec!["oleafly", "project", "info"], "project info"),
            (vec!["oleafly", "version"], "version"),
        ] {
            assert_eq!(Cli::try_parse_from(arguments).unwrap().command.name(), name);
        }
    }

    #[test]
    fn global_options_parse_anywhere() {
        let cli = Cli::try_parse_from([
            "oleafly",
            "build",
            "--json",
            "-q",
            "--log",
            "none",
            "--color",
            "never",
            "--no-input",
        ])
        .unwrap();
        assert!(cli.global.json && cli.global.quiet && cli.global.no_input);
        assert_eq!(cli.global.log, Some(contract::LogMode::None));
        assert!(Cli::try_parse_from(["oleafly", "-C", "a\u{7}b", "build"]).is_err());
    }

    #[test]
    fn json_usage_errors_are_detected_before_the_separator() {
        let arguments = |values: &[&str]| values.iter().map(OsString::from).collect::<Vec<_>>();
        assert!(wants_json(&arguments(&[
            "oleafly",
            "--json",
            "build",
            "--timeout",
            "0"
        ])));
        assert!(wants_json(&arguments(&["oleafly", "build", "--events"])));
        assert!(!wants_json(&arguments(&[
            "oleafly", "build", "--", "--json"
        ])));
    }
}
