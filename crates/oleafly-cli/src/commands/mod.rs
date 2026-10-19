//! Every command lives in a module here (or in a feature's own module) and
//! is listed once in `registry.rs`. A module's `Commands` enum holds its
//! top-level verbs; the registry flattens them into `oleafly`'s commands.
use crate::contract::{CliError, Context, Outcome};

pub mod build;
pub mod checkpoint;
pub mod cite;
pub mod common;
pub mod config;
pub mod context;
pub mod docs;
pub mod doctor;
pub mod mcp_cmd;
pub mod meta;
pub mod registry;
pub mod templates;
pub mod typst_cmd;
pub mod workspace;

/// What a command module provides.
pub trait CommandModule: clap::Subcommand + std::fmt::Debug + Send + Sized + 'static {
    /// Stable name for the JSON envelope's `command`, such as "remote sync".
    fn name(&self) -> &'static str;

    fn run(
        self,
        ctx: &Context,
    ) -> impl std::future::Future<Output = Result<Outcome, CliError>> + Send;

    /// True when the command handles Ctrl+C itself (watch, mcp, agent run).
    fn handles_interrupt(&self) -> bool {
        false
    }
}

/// Generates `Command` (every module's verbs, flattened) with its `name`,
/// `handles_interrupt` and `run`.
#[macro_export]
macro_rules! command_modules {
    ($( $(#[$attr:meta])* $variant:ident => $ty:ty ),* $(,)?) => {
        #[derive(Debug, clap::Subcommand)]
        pub enum Command {
            $( $(#[$attr])* #[command(flatten)] $variant($ty), )*
        }

        impl Command {
            pub fn name(&self) -> &'static str {
                match self {
                    $( $(#[$attr])* Self::$variant(command) => $crate::commands::CommandModule::name(command), )*
                }
            }

            pub fn handles_interrupt(&self) -> bool {
                match self {
                    $( $(#[$attr])* Self::$variant(command) => $crate::commands::CommandModule::handles_interrupt(command), )*
                }
            }

            pub async fn run(
                self,
                ctx: &$crate::contract::Context,
            ) -> Result<$crate::contract::Outcome, $crate::contract::CliError> {
                match self {
                    $( $(#[$attr])* Self::$variant(command) => $crate::commands::CommandModule::run(command, ctx).await, )*
                }
            }
        }
    };
}

#[cfg(test)]
mod tests {
    #[test]
    fn registry_names_every_command_uniquely_and_publicly() {
        let cli = <crate::Cli as clap::CommandFactory>::command();
        let names: Vec<_> = cli
            .get_subcommands()
            .map(|command| command.get_name().to_string())
            .collect();
        let unique: std::collections::BTreeSet<_> = names.iter().collect();
        assert_eq!(unique.len(), names.len(), "{names:?}");
        assert!(names.iter().all(|name| !name.contains("oleaflyc")));
        for expected in [
            "build",
            "watch",
            "open",
            "init",
            "clean",
            "project",
            "doctor",
            "version",
            "help",
            "completions",
            "man",
        ] {
            assert!(names.iter().any(|name| name == expected), "{expected}");
        }
    }

    fn visible_commands() -> Vec<String> {
        let cli = <crate::Cli as clap::CommandFactory>::command();
        cli.get_subcommands()
            .filter(|command| !command.is_hide_set())
            .map(|command| command.get_name().to_string())
            .collect()
    }

    #[test]
    fn docs_cli_md_covers_every_command_and_exit_code() {
        let docs = include_str!("../../../../docs/cli.md");
        for name in visible_commands() {
            assert!(
                docs.contains(&format!("`oleafly {name}")),
                "docs/cli.md doesn't cover `oleafly {name}`"
            );
        }
        for code in ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "130"] {
            assert!(
                docs.contains(&format!("| {code} |")),
                "docs/cli.md has no row for exit code {code}"
            );
        }
        for line in docs.lines().filter(|line| line.contains("oleaflyc")) {
            assert!(
                line.contains("cargo run") || line.contains("binary target"),
                "{line}"
            );
        }
    }

    #[test]
    fn the_bundled_skill_names_only_real_commands() {
        let commands = visible_commands();
        let texts = [
            include_str!("../../../../src-tauri/resources/skills/oleafly-cli/SKILL.md"),
            include_str!(
                "../../../../src-tauri/resources/skills/oleafly-cli/references/json-contract.md"
            ),
        ];
        for text in texts {
            for piece in text.split('`').skip(1).step_by(2) {
                let Some(rest) = piece.strip_prefix("oleafly ") else {
                    continue;
                };
                let word = rest
                    .split_whitespace()
                    .find(|word| !word.starts_with('-'))
                    .unwrap_or("");
                assert!(
                    commands.iter().any(|name| name == word),
                    "the skill names `oleafly {word}`, which isn't a command"
                );
            }
        }
    }

    #[test]
    fn the_bundled_skill_follows_the_agent_skills_name_rules() {
        let text = include_str!("../../../../src-tauri/resources/skills/oleafly-cli/SKILL.md");
        let fields = crate::skills_read::parse_frontmatter(text);
        let name = &fields["name"];
        assert_eq!(name, "oleafly-cli");
        assert!(
            name.len() <= 64
                && name
                    .chars()
                    .all(|character| character.is_ascii_lowercase() || character == '-')
        );
        assert!(fields["description"].chars().count() <= 1024);
        assert!(fields["compatibility"].chars().count() <= 500);
    }

    #[test]
    fn every_command_has_help_text() {
        let cli = <crate::Cli as clap::CommandFactory>::command();
        for command in cli
            .get_subcommands()
            .filter(|command| !command.is_hide_set())
        {
            assert!(
                command.get_about().is_some(),
                "{} has no help text",
                command.get_name()
            );
        }
    }
}
