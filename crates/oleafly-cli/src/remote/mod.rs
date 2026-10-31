pub(crate) mod latexdiff;
pub(crate) mod list;
pub(crate) mod scope;
pub(crate) mod sync;

use std::path::PathBuf;
use std::sync::Arc;

use clap::{Args, Subcommand, ValueEnum};

use crate::auth::shared::{note_failure_files, Env};
use crate::commands::CommandModule;
use crate::contract::{path_arg, CliError, Context, Outcome};

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// Work with projects in your online LaTeX service account
    #[command(subcommand)]
    Remote(RemoteCommand),
}

#[derive(Debug, Subcommand)]
pub enum RemoteCommand {
    /// List the projects in your online account
    List(ServerArgs),
    /// Download online projects into new folders
    Import(ImportArgs),
    /// Link this folder to an online project through Git
    Link(LinkArgs),
    /// Show this folder's link and what changed
    Status(StatusArgs),
    /// Show what differs between this folder and the online project
    Diff(DiffArgs),
    /// Merge online changes here and send yours
    Sync(SyncArgs),
    /// Stop syncing this folder
    Unlink(UnlinkArgs),
    /// Open the online project in your browser
    Open(OpenArgs),
}

#[derive(Debug, Default, Args)]
pub struct ServerArgs {
    #[arg(long, value_name = "URL", help = "Server address")]
    pub server: Option<String>,
}

#[derive(Debug, Default, Args)]
pub struct ImportArgs {
    #[arg(
        required = true,
        value_name = "PROJECT",
        help = "Project IDs or addresses"
    )]
    pub projects: Vec<String>,
    #[arg(long, value_name = "DIR", value_parser = path_arg, help = "Folder to create projects in")]
    pub into: Option<PathBuf>,
    #[arg(long, value_name = "URL", help = "Server address")]
    pub server: Option<String>,
    #[arg(long, help = "Show what would change without changing anything")]
    pub dry_run: bool,
}

#[derive(Debug, Default, Args)]
pub struct LinkArgs {
    #[arg(
        value_name = "PROJECT",
        help = "Project ID or address (default: where this folder came from)"
    )]
    pub target: Option<String>,
    #[arg(long, value_name = "URL", help = "Server address")]
    pub server: Option<String>,
    #[arg(
        long,
        value_enum,
        value_name = "SIDE",
        help = "Which copy wins for files that differ when linking"
    )]
    pub prefer: Option<SideArg>,
    #[arg(long, help = "Show what would change without changing anything")]
    pub dry_run: bool,
}

#[derive(Debug, Default, Args)]
pub struct StatusArgs {
    #[arg(long, help = "Check the online project for changes first")]
    pub fetch: bool,
}

#[derive(Debug, Default, Args)]
pub struct DiffArgs {
    #[arg(long, help = "Exit with 9 when files differ, or 8 when they conflict")]
    pub exit_code: bool,
    #[arg(long, help = "List changed files without the patch")]
    pub name_only: bool,
    #[arg(long, help = "Compare with the last online version Oleafly saw")]
    pub no_fetch: bool,
    #[arg(long, help = "Write a latexdiff of the main document")]
    pub latexdiff: bool,
    #[arg(
        long,
        requires = "latexdiff",
        help = "Compile the latexdiff into a PDF"
    )]
    pub pdf: bool,
    #[arg(short = 'o', long, value_name = "FILE", value_parser = path_arg, help = "Where to write the result")]
    pub output: Option<PathBuf>,
}

#[derive(Debug, Default, Args)]
pub struct SyncArgs {
    #[arg(long, help = "Show what would change without changing anything")]
    pub dry_run: bool,
    #[arg(long, help = "Merge here without sending your changes")]
    pub no_push: bool,
    #[arg(
        long = "resolve",
        value_name = "PATH=local|remote",
        help = "Keep the local or remote version of a file that changed on both sides"
    )]
    pub resolve: Vec<String>,
}

#[derive(Debug, Default, Args)]
pub struct UnlinkArgs {
    #[arg(long, help = "Show what would change without changing anything")]
    pub dry_run: bool,
}

#[derive(Debug, Default, Args)]
pub struct OpenArgs {
    #[arg(long, help = "Print the address instead of opening it")]
    pub print: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum SideArg {
    Local,
    Remote,
}

impl CommandModule for Commands {
    fn name(&self) -> &'static str {
        let Self::Remote(command) = self;
        match command {
            RemoteCommand::List(_) => "remote list",
            RemoteCommand::Import(_) => "remote import",
            RemoteCommand::Link(_) => "remote link",
            RemoteCommand::Status(_) => "remote status",
            RemoteCommand::Diff(_) => "remote diff",
            RemoteCommand::Sync(_) => "remote sync",
            RemoteCommand::Unlink(_) => "remote unlink",
            RemoteCommand::Open(_) => "remote open",
        }
    }

    async fn run(self, ctx: &Context) -> Result<Outcome, CliError> {
        let Self::Remote(command) = self;
        let env = Env::from_context(ctx)?;
        let folder = ctx.project().to_path_buf();
        let result = match command {
            RemoteCommand::List(args) => list::list(&env, args.server.as_deref()).await,
            RemoteCommand::Import(args) => {
                let progress = list::progress_reporter(ctx);
                list::import(&env, args, &progress).await
            }
            RemoteCommand::Status(args) => tokio::task::block_in_place(|| {
                list::status(&env, &sync::system_deps, &folder, &args)
            }),
            RemoteCommand::Unlink(args) => tokio::task::block_in_place(|| {
                list::unlink(&env, &sync::system_deps, &folder, args.dry_run)
            }),
            RemoteCommand::Open(args) => list::open(&env, &folder, args.print),
            RemoteCommand::Link(args) => tokio::task::block_in_place(|| {
                let deps = sync::system_deps(&folder)?;
                sync::link(&env, &deps, &folder, args)
            }),
            RemoteCommand::Sync(args) => tokio::task::block_in_place(|| {
                let deps = sync::system_deps(&folder)?;
                sync::sync(&env, &deps, &folder, args)
            }),
            RemoteCommand::Diff(args) => tokio::task::block_in_place(|| {
                let deps = sync::system_deps(&folder)?;
                sync::diff(&env, &deps, &folder, args)
            }),
        };
        match result {
            Ok(report) => Ok(report.deliver(ctx)),
            Err(error) => {
                if !ctx.json() {
                    note_failure_files(ctx, &error);
                }
                Err(error)
            }
        }
    }
}

pub(crate) struct RemoteDeps {
    pub git: Arc<dyn oleafly_online::git::MirrorGit>,
    pub url_for: fn(&str, &str) -> Result<String, oleafly_online::OnlineError>,
}
