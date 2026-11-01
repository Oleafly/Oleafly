use std::path::PathBuf;
use std::time::Duration;

use clap::{Args, Subcommand, ValueEnum};
use serde_json::json;

use super::CommandModule;
use crate::contract::{path_arg, CliError, Context, ErrorKind, Outcome};
use crate::mcp::bridge;
use crate::mcp::clients::{
    client_config_path, entry_for, snippet, write_entry, Client, ClientEnv, Scope,
};
use crate::mcp::tools::{ToolContext, ToolLimits};

const PING_TIMEOUT: Duration = Duration::from_secs(1);
const BUILD_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, ValueEnum)]
pub enum BridgeMode {
    /// Bridge when the app has this project open, else serve on its own
    #[default]
    Auto,
    /// Always bridge to the app (fail when it isn't running)
    Always,
    /// Never bridge: serve on its own
    Never,
}

#[derive(Debug, clap::Subcommand)]
pub enum Commands {
    /// Serve the project to an AI client over MCP (stdio)
    Mcp(McpArgs),
}

#[derive(Debug, Args)]
pub struct McpArgs {
    #[command(subcommand)]
    pub command: Option<McpSub>,
    #[arg(long, value_enum, default_value_t = BridgeMode::Auto, help = "Bridge to the Oleafly app: auto, always or never")]
    pub bridge: BridgeMode,
}

#[derive(Debug, Subcommand)]
pub enum McpSub {
    /// Print, or add, the oleafly entry for an AI client
    Config(McpConfigArgs),
}

#[derive(Debug, Args)]
pub struct McpConfigArgs {
    #[arg(long, value_enum, help = "The AI client to set up")]
    pub client: Client,
    #[arg(
        long,
        value_enum,
        help = "project (this project's settings) or user (all projects)"
    )]
    pub scope: Option<Scope>,
    #[arg(long, help = "Write the entry into the client's settings file")]
    pub write: bool,
    #[arg(long, short = 'y', help = "Don't ask before writing")]
    pub yes: bool,
    #[arg(long, value_name = "PATH", value_parser = path_arg, help = "The command the client runs (default: oleafly, or this command's path for user scope)")]
    pub command: Option<PathBuf>,
    #[arg(
        long,
        value_name = "NAME",
        default_value = "oleafly",
        help = "The server's name in the client"
    )]
    pub name: String,
}

impl CommandModule for Commands {
    fn name(&self) -> &'static str {
        match self {
            Self::Mcp(McpArgs {
                command: Some(McpSub::Config(_)),
                ..
            }) => "mcp config",
            Self::Mcp(_) => "mcp",
        }
    }

    fn handles_interrupt(&self) -> bool {
        matches!(self, Self::Mcp(McpArgs { command: None, .. }))
    }

    async fn run(self, ctx: &Context) -> Result<Outcome, CliError> {
        match self {
            Self::Mcp(McpArgs {
                command: Some(McpSub::Config(args)),
                ..
            }) => run_config(ctx, args),
            Self::Mcp(McpArgs {
                command: None,
                bridge,
            }) => run_server(ctx, bridge).await,
        }
    }
}

fn app_not_running() -> CliError {
    CliError::new(
        ErrorKind::MissingTool,
        "mcp.app_not_running",
        "The Oleafly app isn't running with its MCP server on.",
    )
    .hint("Turn it on in Settings › Integrations › Oleafly MCP.")
}

async fn run_server(ctx: &Context, mode: BridgeMode) -> Result<Outcome, CliError> {
    let data_root = ctx.data_root().map(std::path::Path::to_path_buf);
    let target = data_root.as_deref().and_then(bridge::discover);
    match mode {
        BridgeMode::Always => {
            let (Some(data_root), Some(target)) = (data_root.as_deref(), target) else {
                return Err(app_not_running());
            };
            if !bridge::ping(&target, PING_TIMEOUT).await {
                return Err(app_not_running());
            }
            bridge::serve_bridge(data_root, target, None).await?;
            return Ok(Outcome::printed());
        }
        BridgeMode::Auto => {
            if let (Some(data_root), Some(target)) = (data_root.as_deref(), target) {
                let root = ctx.project().canonicalize().ok();
                let ours = root
                    .as_deref()
                    .and_then(|root| crate::app_paths::project_identity(root, data_root))
                    .map(|identity| identity.id().to_string());
                let open = bridge::app_project_id(&target).await;
                if open.is_some() && open == ours {
                    bridge::serve_bridge(data_root, target, open).await?;
                    return Ok(Outcome::printed());
                }
                if let (Some(_), Some(root)) = (open, root) {
                    crate::human::note(&format!(
                        "Oleafly has another project open, so this server works on {} by itself.",
                        root.display()
                    ));
                }
            }
        }
        BridgeMode::Never => {}
    }
    let root = ctx.project().canonicalize().map_err(|error| {
        CliError::new(
            ErrorKind::InvalidInput,
            "project.invalid_input",
            format!("{} can't be opened: {error}", ctx.project().display()),
        )
    })?;
    crate::mcp::server::serve_headless(ToolContext {
        root,
        data_root,
        build_timeout: BUILD_TIMEOUT,
        limits: ToolLimits::default(),
    })
    .await?;
    Ok(Outcome::printed())
}

fn on_path(name: &str) -> bool {
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    let file = crate::native::executable_name(name);
    std::env::split_paths(&path).any(|folder| folder.join(&file).is_file())
}

fn run_config(ctx: &Context, args: McpConfigArgs) -> Result<Outcome, CliError> {
    let in_project = crate::engine::open_project(ctx.project(), None, None).is_ok();
    let scope = match (args.scope, args.client) {
        (Some(Scope::Project), Client::ClaudeDesktop) => {
            return Err(CliError::usage(
                "Claude Desktop has no project settings. Use --scope user.",
            ));
        }
        (Some(scope), _) => scope,
        (None, Client::ClaudeDesktop) => Scope::User,
        (None, _) if in_project => Scope::Project,
        (None, _) => Scope::User,
    };
    let command = match (&args.command, scope) {
        (Some(command), _) => command.display().to_string(),
        (None, Scope::Project) => {
            if !on_path("oleafly") {
                ctx.warn(
                    "mcp.command_not_on_path",
                    "`oleafly` isn't on your PATH here, so the client may not find it. Turn on the terminal command in Oleafly's Settings, or pass --command.",
                );
            }
            "oleafly".to_string()
        }
        (None, Scope::User) => crate::app_paths::own_executable()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| "oleafly".to_string()),
    };
    let entry = entry_for(args.client, scope, &command);
    let root = ctx
        .project()
        .canonicalize()
        .unwrap_or_else(|_| ctx.project().to_path_buf());
    let env = ClientEnv::from_env();

    if args.client == Client::ClaudeCode && scope == Scope::User {
        let command_line = format!(
            "claude mcp add --scope user {} -- \"{command}\" mcp",
            args.name
        );
        if args.write {
            return Err(CliError::usage("Claude Code keeps user servers in its own settings. Run the printed command instead.")
                .details(json!({"command_line": command_line})));
        }
        ctx.say(&command_line);
        return Ok(Outcome::success(json!({
            "client": args.client.id(),
            "scope": scope.label(),
            "path": null,
            "entry": entry,
            "action": "printed",
            "command_line": command_line,
        })));
    }
    let path = client_config_path(args.client, scope, &env, &root).ok_or_else(|| {
        CliError::usage(format!(
            "{} has no {} settings file.",
            args.client.label(),
            scope.label()
        ))
    })?;
    if !args.write {
        if !ctx.quiet() {
            ctx.note(format!("Add this to {}:", path.display()));
        }
        ctx.say(snippet(args.client, &args.name, &entry));
        return Ok(Outcome::success(json!({
            "client": args.client.id(),
            "scope": scope.label(),
            "path": path,
            "entry": entry,
            "action": "printed",
        })));
    }
    if !ctx.confirm(
        &format!("Add {} to {}?", args.name, path.display()),
        args.yes,
    )? {
        return Err(CliError::new(
            ErrorKind::Usage,
            "usage.declined",
            "Nothing was written.",
        ));
    }
    let (action, backup) = write_entry(args.client, &path, &args.name, &entry)?;
    match action.label() {
        "unchanged" => ctx.say(format!("{} already lists {}.", path.display(), args.name)),
        _ => ctx.say(format!(
            "Added {} to {}. Restart {} to load it.",
            args.name,
            path.display(),
            args.client.label()
        )),
    }
    let mut fields = json!({
        "client": args.client.id(),
        "scope": scope.label(),
        "path": path,
        "entry": entry,
        "action": action.label(),
    });
    if let Some(backup) = backup {
        fields["backup"] = json!(backup);
    }
    Ok(Outcome::success(fields))
}
