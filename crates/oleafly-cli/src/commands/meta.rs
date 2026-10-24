//! `oleafly help`, `version`, `completions` and `man`.
use clap::{Args, CommandFactory};
use serde_json::json;

use super::CommandModule;
use crate::contract::{CliError, Context, Outcome, SCHEMA_VERSION};
use crate::native::{BuildTools, Discovery};
use crate::typst::TypstInventory;
use crate::version::{engine_reports, APP_VERSION, COMMIT, TARGET};

pub const HELP_EXIT_CODES: &str = "\
Exit codes

  0    It worked.
  1    Something inside Oleafly went wrong (a bug).
  2    The command was used wrongly, or it needs --yes to go ahead.
  3    The project is missing or invalid, or a path points outside it.
  4    A tool or the Oleafly app it needs isn't installed, or a file outside
       the project (a client's settings) couldn't be read or written.
  5    The build failed.
  6    You need to sign in.
  7    The network failed.
  8    Something else holds the project (another build, the app).
  9    A check found problems.
  10   The agent stopped at its step or time limit.
  130  You pressed Ctrl+C.
";

pub const HELP_ENVIRONMENT: &str = "\
Environment

  OLEAFLY_DATA_DIR        Oleafly's data folder (default: ~/.oleafly).
  OLEAFLY_TECTONIC        The tectonic to build LaTeX with.
  OLEAFLY_LATEXMK         The latexmk to use for latexmk projects.
  OLEAFLY_TYPST           The typst to build Typst with.
  OLEAFLY_PANDOC          The pandoc to build Markdown with (2.19 or newer).
  OLEAFLY_APP             The Oleafly app to open folders in.
  OLEAFLY_TEX_BUNDLE_URL  The TeX bundle Tectonic downloads packages from.
  OLEAFLY_PACKS_BASE_URL  Where template packs are downloaded from.
  OLEAFLY_WATCH_POLL      Set it to make `oleafly watch` poll for changes.
  OLEAFLY_CLI             Set for programs Oleafly starts: this command's path.
  OLEAFLY_ONLINE_GIT_TOKEN
                          A Git token for the online LaTeX service, used
                          instead of a saved one (for CI). It goes only to the
                          service's own server, one you name with --server, or
                          one you've signed in to.
  OLEAFLY_SANDBOX_FORWARD_URL_LOGINS
                          Set it to 1 to keep user names and passwords in
                          proxy and package-index addresses for sandboxed
                          commands. By default they are removed.
  OLEAFLY_PROVIDER        The provider for `oleafly agent` and `oleafly ask`.
  OLEAFLY_MODEL           The model for `oleafly agent` and `oleafly ask`.
  OLEAFLY_API_KEY         A key for that provider, used when its own variable
                          isn't set.
  CODEX_HOME              Where Codex keeps its settings (for `mcp config`).
  CI                      When set to anything but 0 or false, Oleafly never
                          asks questions.
  NO_COLOR                When set, output has no color.
";

pub const HELP_JSON: &str = "\
JSON output

  With --json, a command writes one JSON result object to stdout and
  nothing else. Every result has:

    schema_version  1 today. It changes only when a field is removed or
                    changes meaning, like `cargo metadata --format-version`.
    type            \"result\"
    ok              true or false
    command         the command, such as \"build\" or \"project info\"
    warnings        [{code, message}], possibly empty
    error           on failure: {kind, code, message, hint?, retryable?, details?}

  The exit code matches `error.kind` (see `oleafly help exit-codes`).

  --events adds progress lines before the result, each with
  type \"event\" and an `event` name. `oleafly watch --json` writes only
  events. Notes, progress and warnings for people go to stderr.
";

const TOPICS: [(&str, &str); 3] = [
    ("exit-codes", HELP_EXIT_CODES),
    ("environment", HELP_ENVIRONMENT),
    ("json", HELP_JSON),
];

#[derive(Debug, clap::Subcommand)]
pub enum Commands {
    /// Show help for a command or a topic (exit-codes, environment, json)
    Help(HelpArgs),
    /// Show the version and the engines Oleafly would use
    Version,
    /// Print a shell completion script
    Completions {
        #[arg(value_enum, help = "Shell to generate a completion script for")]
        shell: clap_complete::Shell,
    },
    /// Print the manual page in roff format
    Man,
    /// Commands the app's installer runs
    #[command(hide = true, subcommand)]
    Internal(InternalCommand),
}

#[derive(Debug, clap::Subcommand)]
pub enum InternalCommand {
    /// Remove the Windows terminal command if this app installed it
    RemoveCommandLineTool,
}

#[derive(Debug, Args)]
pub struct HelpArgs {
    #[arg(
        value_name = "TOPIC",
        help = "A command (such as `build` or `project info`) or a topic"
    )]
    pub topic: Vec<String>,
}

impl CommandModule for Commands {
    fn name(&self) -> &'static str {
        match self {
            Self::Help(_) => "help",
            Self::Version => "version",
            Self::Completions { .. } => "completions",
            Self::Man => "man",
            Self::Internal(InternalCommand::RemoveCommandLineTool) => {
                "internal remove-command-line-tool"
            }
        }
    }

    async fn run(self, ctx: &Context) -> Result<Outcome, CliError> {
        match self {
            Self::Help(args) => run_help(args),
            Self::Version => run_version(ctx),
            Self::Completions { shell } => {
                let mut command = crate::Cli::command();
                let name = command.get_name().to_string();
                // Into memory first: `generate` panics on a closed pipe.
                let mut script = Vec::new();
                clap_complete::generate(shell, &mut command, name, &mut script);
                crate::human::write_stdout(&script)?;
                Ok(Outcome::printed())
            }
            Self::Man => {
                let mut page = Vec::new();
                clap_mangen::Man::new(crate::Cli::command())
                    .render(&mut page)
                    .map_err(CliError::from)?;
                crate::human::write_stdout(&page)?;
                Ok(Outcome::printed())
            }
            Self::Internal(InternalCommand::RemoveCommandLineTool) => {
                // The uninstaller ignores the result; this never fails.
                crate::install::remove_command_line_tool();
                Ok(Outcome::success(json!({})))
            }
        }
    }
}

fn run_help(args: HelpArgs) -> Result<Outcome, CliError> {
    let words: Vec<&str> = args.topic.iter().map(String::as_str).collect();
    if let [topic] = words.as_slice() {
        if let Some((_, text)) = TOPICS.iter().find(|(name, _)| name == topic) {
            crate::human::write_stdout(text.as_bytes())?;
            return Ok(Outcome::printed());
        }
    }
    let mut command = crate::Cli::command();
    command.build();
    let mut current = &mut command;
    for word in &words {
        current = match current.find_subcommand_mut(word) {
            Some(next) => next,
            None => {
                return Err(CliError::usage(format!(
                    "There's no command or help topic called `{}`. Run `oleafly help` to see them.",
                    words.join(" ")
                )))
            }
        };
    }
    current
        .print_long_help()
        .map_err(crate::human::stdout_failed)?;
    Ok(Outcome::printed())
}

fn run_version(ctx: &Context) -> Result<Outcome, CliError> {
    let root = std::env::current_dir().unwrap_or_default();
    let discovery = Discovery::from_env(&root);
    let mut tools = BuildTools::discover_with(&discovery);
    tools.resolve_pandoc(&discovery);
    let inventory = TypstInventory::discover_with(&discovery);
    let engines = engine_reports(&tools, &inventory);
    let app = discovery
        .app
        .as_ref()
        .map(|app| json!({"executable": app.executable, "resources": app.resources_dir}));
    if !ctx.json() {
        ctx.say(format!("oleafly {}", crate::version::VERSION_LINE));
        ctx.say(format!("JSON schema {SCHEMA_VERSION} · {TARGET}"));
        for (name, report) in &engines {
            match report {
                Some(report) => ctx.say(format!(
                    "{name:<9} {:<10} {} ({})",
                    report.version.as_deref().unwrap_or("unknown"),
                    report.path.display(),
                    report.source
                )),
                None => ctx.say(format!("{name:<9} not found")),
            }
        }
        match &discovery.app {
            Some(app) => ctx.say(format!("app       {}", app.executable.display())),
            None => ctx.say("app       not found"),
        }
    }
    Ok(Outcome::success(json!({
        "version": APP_VERSION,
        "commit": COMMIT,
        "target": TARGET,
        "engines": engines,
        "typst_found": inventory.found,
        "app": app,
        "data_root": discovery.data_root,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn help_topics_name_their_contents() {
        assert!(HELP_EXIT_CODES.contains("130") && HELP_EXIT_CODES.contains('9'));
        assert!(
            HELP_ENVIRONMENT.contains("OLEAFLY_DATA_DIR") && HELP_ENVIRONMENT.contains("NO_COLOR")
        );
        assert!(HELP_JSON.contains("schema_version"));
    }

    #[test]
    fn help_environment_lists_every_variable_the_guide_documents() {
        // A Windows checkout has CRLF line ends.
        let guide = include_str!("../../../../docs/cli.md").replace("\r\n", "\n");
        let section = guide
            .split("\n## Environment\n")
            .nth(1)
            .and_then(|rest| rest.split("\n## ").next())
            .expect("docs/cli.md has an Environment section");
        let mut documented = Vec::new();
        for row in section.lines().filter(|line| line.starts_with("| `")) {
            let first_cell = row.split('|').nth(1).unwrap_or_default();
            documented.extend(first_cell.split('`').skip(1).step_by(2));
        }
        assert!(documented.len() > 10, "{documented:?}");
        for variable in documented {
            assert!(
                HELP_ENVIRONMENT.contains(variable),
                "`oleafly help environment` leaves out {variable}"
            );
        }
        // `CI=0` and `CI=false` don't count, so "when set" alone is wrong.
        assert!(HELP_ENVIRONMENT.contains("anything but 0 or false"));
    }

    #[test]
    fn unknown_help_topics_are_usage_errors() {
        let error = run_help(HelpArgs {
            topic: vec!["nonsense".into()],
        })
        .unwrap_err();
        assert_eq!(error.code, "usage.invalid");
    }
}
