//! `oleafly agent run`, `oleafly ask` and `oleafly agent apply`: the
//! Oleafly agent without a window. It uses the app's providers, keys and
//! MCP servers, works on a copy of the project (review mode) or the project
//! itself (`--apply`), and prints one result.
pub mod desktop_config;
pub mod events;
pub mod mcp;
pub mod policy;
pub mod prompt;
pub mod provider;
pub mod run;
pub mod tools;
pub mod usage_spool;
pub mod workspace;

use std::path::PathBuf;

use crate::contract::{CliError, Context, Outcome};

#[derive(Debug, clap::Subcommand)]
pub enum Commands {
    /// Run the Oleafly agent on this project without a window
    #[command(subcommand)]
    Agent(AgentCommand),
    /// Ask a question about this project; nothing is changed
    Ask(AskArgs),
}

#[derive(Debug, clap::Subcommand)]
pub enum AgentCommand {
    /// Do a task in this project
    Run(AgentRunArgs),
    /// Apply a saved review folder to the project
    Apply(AgentApplyArgs),
}

#[derive(Debug, clap::Args)]
pub struct AgentRunArgs {
    #[arg(
        value_name = "PROMPT",
        help = "What the agent should do. Use - to read it from stdin"
    )]
    pub prompt: Option<String>,
    #[arg(long, value_name = "FILE", conflicts_with = "prompt", value_parser = crate::contract::path_arg, help = "Read the prompt from this file")]
    pub prompt_file: Option<PathBuf>,
    #[command(flatten)]
    pub model: ModelArgs,
    #[arg(
        long = "allow",
        value_name = "WHAT",
        value_delimiter = ',',
        value_parser = ["read", "write", "commands", "network"],
        help = "What the agent may do besides reading: write, commands, network"
    )]
    pub allow: Vec<String>,
    #[arg(
        long,
        conflicts_with = "review_dir",
        help = "Write changes straight into the project instead of a review folder"
    )]
    pub apply: bool,
    #[arg(long, value_name = "DIR", value_parser = crate::contract::path_arg, help = "Save the review here (default: .oleafly/agent-runs/<run id>)")]
    pub review_dir: Option<PathBuf>,
    #[arg(long, default_value_t = 50, value_parser = clap::value_parser!(u32).range(1..=2000), help = "Stop after this many steps")]
    pub max_steps: u32,
    #[arg(
        long = "timeout",
        default_value_t = 1800,
        value_name = "SECONDS",
        value_parser = clap::value_parser!(u64).range(10..=86_400),
        help = "Stop after this many seconds"
    )]
    pub timeout_seconds: u64,
    #[arg(
        long = "skill",
        value_name = "ID",
        help = "Use this skill (repeat for more)"
    )]
    pub skills: Vec<String>,
    #[arg(
        long = "mcp",
        value_name = "NAME",
        conflicts_with = "no_mcp",
        help = "Use only this MCP server (repeat for more)"
    )]
    pub mcp: Vec<String>,
    #[arg(long, help = "Use none of your MCP servers")]
    pub no_mcp: bool,
    #[arg(long, help = "Keep the working copy in the review folder")]
    pub keep_workspace: bool,
    #[arg(
        long,
        help = "Where no sandbox works, let commands run as you in a review run too (they can change files outside the review copy)"
    )]
    pub unsandboxed_commands: bool,
}

#[derive(Debug, clap::Args)]
pub struct ModelArgs {
    #[arg(
        long,
        value_name = "ID",
        help = "The AI provider (default: the one picked in Oleafly)"
    )]
    pub provider: Option<String>,
    #[arg(
        long,
        value_name = "ID",
        help = "The model (default: the one picked in Oleafly)"
    )]
    pub model: Option<String>,
    #[arg(long, value_enum, default_value_t = EffortArg::Auto, help = "How hard the model thinks")]
    pub effort: EffortArg,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum EffortArg {
    Auto,
    None,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

#[derive(Debug, clap::Args)]
pub struct AskArgs {
    #[arg(
        value_name = "QUESTION",
        help = "Your question. Use - to read it from stdin"
    )]
    pub question: Option<String>,
    #[command(flatten)]
    pub model: ModelArgs,
    #[arg(
        long = "allow",
        value_name = "WHAT",
        value_delimiter = ',',
        value_parser = ["read", "network"],
        help = "Let the agent use the network as well: network"
    )]
    pub allow: Vec<String>,
    #[arg(long, default_value_t = 30, value_parser = clap::value_parser!(u32).range(1..=200), help = "Stop after this many steps")]
    pub max_steps: u32,
    #[arg(
        long = "timeout",
        default_value_t = 600,
        value_name = "SECONDS",
        value_parser = clap::value_parser!(u64).range(10..=86_400),
        help = "Stop after this many seconds"
    )]
    pub timeout_seconds: u64,
    #[arg(long, help = "Use none of your MCP servers")]
    pub no_mcp: bool,
}

#[derive(Debug, clap::Args)]
pub struct AgentApplyArgs {
    #[arg(value_name = "REVIEW_DIR", value_parser = crate::contract::path_arg, help = "The review folder an agent run saved")]
    pub review_dir: PathBuf,
    #[arg(long, help = "List the changes without writing them")]
    pub dry_run: bool,
}

impl crate::commands::CommandModule for Commands {
    fn name(&self) -> &'static str {
        match self {
            Self::Agent(AgentCommand::Run(_)) => "agent run",
            Self::Agent(AgentCommand::Apply(_)) => "agent apply",
            Self::Ask(_) => "ask",
        }
    }

    /// A run keeps the work done so far and prints its own result on Ctrl+C;
    /// an apply finishes and says what it applied.
    fn handles_interrupt(&self) -> bool {
        matches!(
            self,
            Self::Agent(AgentCommand::Run(_) | AgentCommand::Apply(_)) | Self::Ask(_)
        )
    }

    async fn run(self, ctx: &Context) -> Result<Outcome, CliError> {
        match self {
            Self::Agent(AgentCommand::Run(args)) => run::agent_run(ctx, args).await,
            Self::Agent(AgentCommand::Apply(args)) => run::agent_apply(ctx, args).await,
            Self::Ask(args) => run::ask(ctx, args).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use clap::Parser;

    use super::*;
    use crate::{expand_open_shorthand, Cli, Command};

    fn parse(line: &str) -> Command {
        let mut arguments = vec!["oleafly"];
        arguments.extend(line.split_whitespace());
        Cli::try_parse_from(arguments).unwrap().command
    }

    fn to_os(values: [&str; 3]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    #[test]
    fn allow_lists_parse_from_commas_and_repeats() {
        let cli = Cli::try_parse_from([
            "oleafly",
            "agent",
            "run",
            "fix refs",
            "--allow",
            "write,network",
            "--allow",
            "commands",
            "--apply",
        ])
        .unwrap();
        let Command::Agent(Commands::Agent(AgentCommand::Run(args))) = cli.command else {
            panic!("expected agent run");
        };
        assert_eq!(args.allow, ["write", "network", "commands"]);
        assert!(args.apply);
        assert_eq!(args.prompt.as_deref(), Some("fix refs"));
        assert_eq!((args.max_steps, args.timeout_seconds), (50, 1800));
    }

    #[test]
    fn apply_and_review_dir_conflict() {
        assert!(Cli::try_parse_from([
            "oleafly",
            "agent",
            "run",
            "x",
            "--apply",
            "--review-dir",
            "r"
        ])
        .is_err());
    }

    #[test]
    fn a_prompt_and_a_prompt_file_conflict() {
        assert!(
            Cli::try_parse_from(["oleafly", "agent", "run", "x", "--prompt-file", "p.txt"])
                .is_err()
        );
    }

    #[test]
    fn ask_refuses_write_and_commands() {
        for flag in ["write", "commands"] {
            assert!(
                Cli::try_parse_from(["oleafly", "ask", "why?", "--allow", flag]).is_err(),
                "{flag}"
            );
        }
        assert!(Cli::try_parse_from(["oleafly", "ask", "why?", "--allow", "network"]).is_ok());
    }

    #[test]
    fn effort_accepts_the_seven_levels_and_auto() {
        for level in [
            "auto", "none", "minimal", "low", "medium", "high", "xhigh", "max",
        ] {
            assert!(
                Cli::try_parse_from(["oleafly", "ask", "q", "--effort", level]).is_ok(),
                "{level}"
            );
        }
        assert!(Cli::try_parse_from(["oleafly", "ask", "q", "--effort", "extreme"]).is_err());
    }

    #[test]
    fn step_and_time_limits_are_bounded() {
        assert!(Cli::try_parse_from(["oleafly", "agent", "run", "x", "--max-steps", "0"]).is_err());
        assert!(
            Cli::try_parse_from(["oleafly", "agent", "run", "x", "--max-steps", "2001"]).is_err()
        );
        assert!(Cli::try_parse_from(["oleafly", "agent", "run", "x", "--timeout", "9"]).is_err());
        assert!(Cli::try_parse_from(["oleafly", "ask", "x", "--max-steps", "201"]).is_err());
    }

    #[test]
    fn agent_ask_and_daemon_are_commands_not_folders() {
        assert_eq!(
            expand_open_shorthand(["oleafly", "ask", "what is in ./paper?"]),
            to_os(["oleafly", "ask", "what is in ./paper?"])
        );
        assert_eq!(
            expand_open_shorthand(["oleafly", "daemon", "status"]),
            to_os(["oleafly", "daemon", "status"])
        );
        assert_eq!(
            expand_open_shorthand(["oleafly", "agent", "run"]),
            to_os(["oleafly", "agent", "run"])
        );
    }

    #[test]
    fn command_names_are_stable() {
        assert_eq!(parse("agent run x").name(), "agent run");
        assert_eq!(parse("agent apply r").name(), "agent apply");
        assert_eq!(parse("ask why").name(), "ask");
        assert_eq!(parse("daemon status").name(), "daemon status");
        assert_eq!(parse("daemon run").name(), "daemon run");
        assert_eq!(parse("daemon stop").name(), "daemon stop");
    }

    #[test]
    fn runs_and_questions_handle_ctrl_c_themselves() {
        assert!(parse("agent run x").handles_interrupt());
        assert!(parse("ask x").handles_interrupt());
        assert!(parse("agent apply r").handles_interrupt());
    }

    #[test]
    fn the_current_platform_matches_the_build_target() {
        use crate::app_paths::Platform;
        #[cfg(windows)]
        assert_eq!(Platform::current(), Platform::Windows);
        #[cfg(target_os = "macos")]
        assert_eq!(Platform::current(), Platform::MacOs);
        #[cfg(target_os = "linux")]
        assert_eq!(Platform::current(), Platform::Linux);
    }

    #[test]
    fn agent_commands_are_listed_with_help() {
        let names: Vec<String> = <Cli as clap::CommandFactory>::command()
            .get_subcommands()
            .map(|command| command.get_name().to_string())
            .collect();
        for expected in ["agent", "ask", "daemon"] {
            assert!(names.iter().any(|name| name == expected), "{expected}");
        }
        let help = <Cli as clap::CommandFactory>::command()
            .find_subcommand_mut("agent")
            .unwrap()
            .render_long_help()
            .to_string();
        assert!(help.contains("run") && help.contains("apply"));
    }
}
