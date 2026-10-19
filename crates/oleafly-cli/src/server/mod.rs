//! `oleafly server`: Oleafly collaboration servers from the command line.
//! The command line signs in as its own device (`server sign-in`), then
//! lists shared projects, manages sharing and members, and reads and writes
//! comments. Sharing a project for the first time stays in the app, which
//! builds the live document.
pub(crate) mod account;
pub(crate) mod comments;
pub(crate) mod projects;
pub(crate) mod target;

use clap::{Args, Subcommand, ValueEnum};
use oleafly_collab_protocol::roles::ProjectRole;

use crate::auth::shared::Env;
use crate::auth::ServerLogin;
use crate::commands::CommandModule;
use crate::contract::{CliError, Context, Outcome};

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// Work with Oleafly collaboration servers
    #[command(subcommand)]
    Server(ServerCommand),
}

#[derive(Debug, Subcommand)]
pub enum ServerCommand {
    /// Show servers, sign-ins and this project's sharing
    Status(StatusArgs),
    /// Sign in to a server as this command line
    SignIn(ServerLogin),
    /// List shared projects on your servers
    Projects(ProjectsArgs),
    /// Show or change how this project is shared
    Share(ShareArgs),
    /// List, add or remove people on this project
    Members(MembersArgs),
    /// Read and write comments on this project
    Comments(CommentsArgs),
}

/// Which shared project: this folder's, or `--shared` on `--server`.
#[derive(Debug, Default, Args)]
pub struct ProjectArgs {
    #[arg(
        long,
        global = true,
        value_name = "SHARED_ID",
        help = "Shared project ID"
    )]
    pub shared: Option<String>,
    #[arg(
        long,
        global = true,
        value_name = "SERVER",
        help = "Server address, name or ID"
    )]
    pub server: Option<String>,
}

#[derive(Debug, Default, Args)]
pub struct StatusArgs {
    #[arg(value_name = "SERVER", help = "Server address, name or ID")]
    pub which: Option<String>,
    #[arg(long, help = "Test the connection to each server")]
    pub check: bool,
}

#[derive(Debug, Default, Args)]
pub struct ProjectsArgs {
    #[arg(long, value_name = "SERVER", help = "Server address, name or ID")]
    pub server: Option<String>,
}

#[derive(Debug, Default, Args)]
pub struct ShareArgs {
    #[command(flatten)]
    pub target: ProjectArgs,
    #[arg(
        long,
        value_enum,
        value_name = "on|off",
        help = "Turn link sharing on or off"
    )]
    pub link: Option<Switch>,
    #[arg(
        long,
        value_enum,
        value_name = "ROLE",
        help = "Role for people who open the link"
    )]
    pub link_role: Option<RoleArg>,
    #[arg(
        long,
        value_enum,
        value_name = "on|off",
        help = "Turn comments on or off"
    )]
    pub comments: Option<Switch>,
    #[arg(long, help = "Show what would change without changing anything")]
    pub dry_run: bool,
}

#[derive(Debug, Args)]
pub struct MembersArgs {
    #[command(flatten)]
    pub target: ProjectArgs,
    #[command(subcommand)]
    pub action: Option<MembersAction>,
}

#[derive(Debug, Subcommand)]
pub enum MembersAction {
    /// List the people on this project
    List,
    /// Add someone by email address or login
    Add {
        #[arg(value_name = "WHO", help = "Email address or login")]
        who: String,
        #[arg(long, value_enum, default_value = "editor", help = "Role to give")]
        role: RoleArg,
        #[arg(long, help = "Show what would change without changing anything")]
        dry_run: bool,
    },
    /// Remove someone from this project
    Remove {
        #[arg(value_name = "WHO", help = "Email address, login or name")]
        who: String,
        #[arg(long, help = "Show what would change without changing anything")]
        dry_run: bool,
    },
    /// Change someone's role
    Role {
        #[arg(value_name = "WHO", help = "Email address, login or name")]
        who: String,
        #[arg(value_enum, value_name = "ROLE", help = "Role to give")]
        role: RoleArg,
        #[arg(long, help = "Show what would change without changing anything")]
        dry_run: bool,
    },
}

#[derive(Debug, Args)]
pub struct CommentsArgs {
    #[command(flatten)]
    pub target: ProjectArgs,
    #[command(subcommand)]
    pub action: comments::CommentsAction,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum RoleArg {
    Editor,
    Viewer,
}

impl RoleArg {
    pub(crate) fn role(self) -> ProjectRole {
        match self {
            Self::Editor => ProjectRole::Editor,
            Self::Viewer => ProjectRole::Viewer,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum Switch {
    On,
    Off,
}

impl Switch {
    pub(crate) fn on(self) -> bool {
        self == Self::On
    }
}

/// A role as people read it.
pub(crate) fn role_name(role: ProjectRole) -> &'static str {
    match role {
        ProjectRole::Owner => "owner",
        ProjectRole::Editor => "editor",
        ProjectRole::Viewer => "viewer",
        ProjectRole::Unknown => "unknown",
    }
}

impl CommandModule for Commands {
    fn name(&self) -> &'static str {
        let Self::Server(command) = self;
        match command {
            ServerCommand::Status(_) => "server status",
            ServerCommand::SignIn(_) => "server sign-in",
            ServerCommand::Projects(_) => "server projects",
            ServerCommand::Share(_) => "server share",
            ServerCommand::Members(MembersArgs {
                action: None | Some(MembersAction::List),
                ..
            }) => "server members",
            ServerCommand::Members(MembersArgs {
                action: Some(MembersAction::Add { .. }),
                ..
            }) => "server members add",
            ServerCommand::Members(MembersArgs {
                action: Some(MembersAction::Remove { .. }),
                ..
            }) => "server members remove",
            ServerCommand::Members(MembersArgs {
                action: Some(MembersAction::Role { .. }),
                ..
            }) => "server members role",
            ServerCommand::Comments(args) => args.action.name(),
        }
    }

    async fn run(self, ctx: &Context) -> Result<Outcome, CliError> {
        let Self::Server(command) = self;
        let env = Env::from_context(ctx)?;
        let collab = account::CliCollab::open(&env);
        let folder = ctx.project().to_path_buf();
        let report = match command {
            ServerCommand::Status(args) => projects::status(&collab, &env, &folder, &args).await?,
            ServerCommand::SignIn(args) => {
                account::sign_in_from(ctx, &env, &args.url, args.setup_code, args.open).await?
            }
            ServerCommand::Projects(args) => {
                projects::projects(&collab, args.server.as_deref()).await?
            }
            ServerCommand::Share(args) => {
                let target = target::resolve_target(&collab, &env, &folder, &args.target)?;
                projects::share(&collab, &target, &args).await?
            }
            ServerCommand::Members(args) => {
                let target = target::resolve_target(&collab, &env, &folder, &args.target)?;
                projects::members(&collab, &target, args.action.unwrap_or(MembersAction::List))
                    .await?
            }
            ServerCommand::Comments(args) => {
                let target = target::resolve_target(&collab, &env, &folder, &args.target)?;
                comments::run(&collab, &target, args.action).await?
            }
        };
        Ok(report.deliver(ctx))
    }
}
