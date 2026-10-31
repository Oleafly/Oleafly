use std::path::PathBuf;
use std::time::Duration;

use clap::{Args, Subcommand};
use oleafly_core::build_output::BuildLock;
use oleafly_core::{Engine, InitOptions, Workspace};
use serde_json::json;

use super::common::CliEngine;
use super::CommandModule;
use crate::contract::{path_arg, CliError, Context, Outcome};
use crate::engine::open_project;

const CLEAN_LOCK_BUDGET: Duration = Duration::from_secs(5);

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// Open a folder in the Oleafly app
    Open(OpenArgs),
    /// Initialize an Oleafly project
    Init(InitArgs),
    /// Remove generated build output
    Clean,
    /// Inspect project metadata
    Project {
        #[command(subcommand)]
        command: ProjectCommand,
    },
}

#[derive(Debug, Args)]
pub struct OpenArgs {
    #[arg(value_name = "PATH", value_parser = path_arg, help = "Folder to open. Without one, oleafly opens the current folder")]
    pub path: Option<PathBuf>,
}

#[derive(Debug, Args)]
pub struct InitArgs {
    #[arg(long, help = "Set the project display name")]
    pub name: Option<String>,
    #[arg(long, value_name = "FILE", help = "Set or create the main document")]
    pub main: Option<String>,
    #[arg(long, value_enum, help = "Select the document engine")]
    pub engine: Option<CliEngine>,
}

#[derive(Debug, Subcommand)]
pub enum ProjectCommand {
    /// Show the resolved project configuration
    Info,
}

impl CommandModule for Commands {
    fn name(&self) -> &'static str {
        match self {
            Self::Open(_) => "open",
            Self::Init(_) => "init",
            Self::Clean => "clean",
            Self::Project { .. } => "project info",
        }
    }

    async fn run(self, ctx: &Context) -> Result<Outcome, CliError> {
        match self {
            Self::Open(args) => run_open(ctx, args),
            Self::Init(args) => run_init(ctx, args),
            Self::Clean => run_clean(ctx),
            Self::Project {
                command: ProjectCommand::Info,
            } => run_project_info(ctx),
        }
    }
}

fn run_open(ctx: &Context, args: OpenArgs) -> Result<Outcome, CliError> {
    let requested = args.path.as_deref().unwrap_or(ctx.project());
    let current = std::env::current_dir().map_err(|error| {
        CliError::from(error).hint("Run the command from a folder that still exists.")
    })?;
    let folder = crate::launcher::resolve_folder(requested, &current)?;
    crate::launcher::open_in_app(&folder)?;
    Ok(Outcome::success(json!({"folder": folder})))
}

fn default_engine(ctx: &Context, args: &InitArgs) -> Option<Engine> {
    if let Some(engine) = args.engine {
        return Some(engine.into());
    }
    let latex = args
        .main
        .as_deref()
        .is_none_or(|main| Engine::Latexmk.accepts(main));
    let latexmk = ctx
        .data_root()
        .and_then(crate::app_config::latex_default_engine)
        .is_some();
    (latex && latexmk).then_some(Engine::Latexmk)
}

fn run_init(ctx: &Context, args: InitArgs) -> Result<Outcome, CliError> {
    let engine = default_engine(ctx, &args);
    let workspace = crate::engine::with_linked_build(Workspace::init(
        ctx.project(),
        InitOptions {
            name: args.name,
            main_document: args.main,
            engine,
        },
    )?)?;
    let info = workspace.info()?;
    ctx.say(format!(
        "Initialized Oleafly project at {}",
        workspace.root().display()
    ));
    Ok(Outcome::success(json!({"project": info})))
}

fn run_clean(ctx: &Context) -> Result<Outcome, CliError> {
    let path = ctx.project();
    let (removed, build_directory) = match open_project(path, None, None) {
        Ok(opened) => {
            let build = opened.workspace.build_dir_path();
            let removed = if build.is_dir() {
                let _lock = lock_for_clean(&build)?;
                opened.workspace.clean()?
            } else {
                false
            };
            (removed, build)
        }
        Err(error)
            if matches!(
                error.code.as_ref(),
                "project.not_initialized" | "project.invalid_input"
            ) =>
        {
            let build = Workspace::build_directory_path(path)?;
            let removed = if build.is_dir() {
                let _lock = lock_for_clean(&build)?;
                Workspace::clean_build_directory(path)?
            } else {
                false
            };
            (removed, build)
        }
        Err(error) => return Err(error),
    };
    if removed {
        ctx.say(format!("Removed {}", build_directory.display()));
    } else {
        ctx.say("Build directory is already clean");
    }
    Ok(Outcome::success(
        json!({"removed": removed, "build_directory": build_directory}),
    ))
}

fn lock_for_clean(build: &std::path::Path) -> Result<Option<BuildLock>, CliError> {
    match BuildLock::acquire(build, CLEAN_LOCK_BUDGET, &mut || {}) {
        Ok(lock) => Ok(Some(lock)),
        Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {
            Err(crate::native::build_running())
        }
        Err(_) => Ok(None),
    }
}

fn run_project_info(ctx: &Context) -> Result<Outcome, CliError> {
    let workspace = crate::engine::with_linked_build(Workspace::open(ctx.project())?)?;
    let info = workspace.info()?;
    if !ctx.json() {
        ctx.say(format!("Name: {}", info.name));
        ctx.say(format!("Root: {}", info.root.display()));
        ctx.say(format!("Main document: {}", info.main_document));
        let manifest_engine = workspace.manifest().engine.trim();
        if manifest_engine.eq_ignore_ascii_case(info.engine.canonical_name()) {
            ctx.say(format!("Engine: {manifest_engine}"));
        } else {
            let manifest_engine = if manifest_engine.is_empty() {
                "<default>"
            } else {
                manifest_engine
            };
            ctx.say(format!(
                "Engine: {} (project.json: {manifest_engine})",
                info.engine.canonical_name()
            ));
        }
        ctx.say(format!(
            "Build directory: {}",
            info.build_directory.display()
        ));
    }
    Ok(Outcome::success(json!({"project": info})))
}
