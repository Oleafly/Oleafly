use clap::{Args, Parser, Subcommand, ValueEnum};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use oleafly_core::{
    BuildOptions, BuildResult, BuildTools, CompilerLog, DoctorStatus, Engine, Error, ErrorKind,
    InitOptions, NativeCompiler, Workspace,
};
use serde_json::{json, Value};
use std::ffi::OsStr;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use tokio::sync::mpsc;

const EXIT_SUCCESS: u8 = 0;
const EXIT_PROJECT: u8 = 3;
const EXIT_ENVIRONMENT: u8 = 4;
const EXIT_BUILD: u8 = 5;
const WATCH_DEBOUNCE: Duration = Duration::from_millis(300);

#[derive(Debug, Parser)]
#[command(
    name = "oleaflyc",
    version,
    about = "Build and manage Oleafly projects"
)]
pub struct Cli {
    #[arg(
        short = 'C',
        long,
        global = true,
        default_value = ".",
        value_name = "PATH",
        help = "Run against this project directory"
    )]
    pub project: PathBuf,
    #[arg(long, global = true, help = "Write machine-readable JSON to stdout")]
    pub json: bool,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    #[command(about = "Initialize an Oleafly project")]
    Init(InitCommand),
    #[command(about = "Build the project PDF")]
    Build(BuildCommand),
    #[command(about = "Build now and rebuild when project files change")]
    Watch(BuildCommand),
    #[command(about = "Remove generated build output")]
    Clean,
    #[command(about = "Check the project and required build tools")]
    Doctor,
    #[command(about = "Inspect project metadata")]
    Project {
        #[command(subcommand)]
        command: ProjectCommand,
    },
}

#[derive(Debug, Args)]
pub struct InitCommand {
    #[arg(long, help = "Set the project display name")]
    pub name: Option<String>,
    #[arg(long, value_name = "FILE", help = "Set or create the main document")]
    pub main: Option<String>,
    #[arg(long, value_enum, help = "Select the document engine")]
    pub engine: Option<CliEngine>,
}

#[derive(Clone, Copy, Debug, Args)]
pub struct BuildCommand {
    #[arg(long, help = "Do not download compiler resources")]
    pub offline: bool,
    #[arg(long, help = "Use the engine's fastest supported build mode")]
    pub fast: bool,
    #[arg(long, help = "Stop after the first document error")]
    pub halt_on_error: bool,
}

#[derive(Debug, Subcommand)]
pub enum ProjectCommand {
    #[command(about = "Show the resolved project configuration")]
    Info,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub enum CliEngine {
    #[value(alias = "xetex", alias = "latex")]
    Tectonic,
    Latexmk,
    Typst,
    #[value(alias = "pandoc", alias = "md")]
    Markdown,
}

impl From<CliEngine> for Engine {
    fn from(value: CliEngine) -> Self {
        match value {
            CliEngine::Tectonic => Self::Tectonic,
            CliEngine::Latexmk => Self::Latexmk,
            CliEngine::Typst => Self::Typst,
            CliEngine::Markdown => Self::Markdown,
        }
    }
}

impl From<BuildCommand> for BuildOptions {
    fn from(value: BuildCommand) -> Self {
        Self {
            offline: value.offline,
            fast: value.fast,
            halt_on_error: value.halt_on_error,
        }
    }
}

#[derive(Clone, Copy)]
struct Reporter {
    json: bool,
}

impl Reporter {
    fn value(&self, value: Value) -> Result<(), Error> {
        if self.json {
            let stdout = std::io::stdout();
            let mut output = stdout.lock();
            serde_json::to_writer(&mut output, &value).map_err(json_output_error)?;
            writeln!(output).map_err(output_error)?;
        }
        Ok(())
    }

    fn error(&self, command: &str, error: &Error) {
        if self.json {
            let value = json!({
                "ok": false,
                "command": command,
                "error": {
                    "kind": error.kind(),
                    "message": error.message()
                }
            });
            let stdout = std::io::stdout();
            let mut output = stdout.lock();
            let _ = serde_json::to_writer(&mut output, &value);
            let _ = writeln!(output);
        } else {
            eprintln!("error: {error}");
        }
    }

    fn compiler_log(&self) -> CompilerLog {
        if self.json {
            CompilerLog::default()
        } else {
            CompilerLog::new(|text| eprint!("{text}"))
        }
    }
}

pub async fn run(cli: Cli) -> u8 {
    let reporter = Reporter { json: cli.json };
    let command_name = command_name(&cli.command);
    let result = match cli.command {
        Command::Init(command) => run_init(&cli.project, command, reporter),
        Command::Build(command) => run_build(&cli.project, command.into(), reporter).await,
        Command::Watch(command) => run_watch(&cli.project, command.into(), reporter).await,
        Command::Clean => run_clean(&cli.project, reporter),
        Command::Doctor => run_doctor(&cli.project, reporter),
        Command::Project {
            command: ProjectCommand::Info,
        } => run_project_info(&cli.project, reporter),
    };
    match result {
        Ok(code) => code,
        Err(error) => {
            reporter.error(command_name, &error);
            exit_for_error(&error)
        }
    }
}

fn command_name(command: &Command) -> &'static str {
    match command {
        Command::Init(_) => "init",
        Command::Build(_) => "build",
        Command::Watch(_) => "watch",
        Command::Clean => "clean",
        Command::Doctor => "doctor",
        Command::Project { .. } => "project info",
    }
}

fn run_init(path: &Path, command: InitCommand, reporter: Reporter) -> Result<u8, Error> {
    let workspace = Workspace::init(
        path,
        InitOptions {
            name: command.name,
            main_document: command.main,
            engine: command.engine.map(Into::into),
        },
    )?;
    let info = workspace.info()?;
    reporter.value(json!({"ok": true, "command": "init", "project": info}))?;
    if !reporter.json {
        println!(
            "Initialized Oleafly project at {}",
            workspace.root().display()
        );
    }
    Ok(EXIT_SUCCESS)
}

async fn run_build(path: &Path, options: BuildOptions, reporter: Reporter) -> Result<u8, Error> {
    let workspace = Workspace::open(path)?;
    let result = compile(&workspace, options, reporter).await?;
    report_build(&result, reporter, "build")?;
    Ok(if result.ok { EXIT_SUCCESS } else { EXIT_BUILD })
}

async fn compile(
    workspace: &Workspace,
    options: BuildOptions,
    reporter: Reporter,
) -> Result<BuildResult, Error> {
    let tools = BuildTools::discover(workspace.root());
    NativeCompiler::new(tools)
        .with_log(reporter.compiler_log())
        .build(workspace, options)
        .await
}

fn report_build(result: &BuildResult, reporter: Reporter, command: &str) -> Result<(), Error> {
    reporter.value(json!({"ok": result.ok, "command": command, "build": result}))?;
    if !reporter.json {
        if result.ok {
            if let Some(output) = &result.output {
                println!(
                    "Built {} in {} ms",
                    output.display(),
                    result.compile_time_ms
                );
            }
        } else {
            eprintln!("Build failed in {} ms", result.compile_time_ms);
        }
    }
    Ok(())
}

fn run_clean(path: &Path, reporter: Reporter) -> Result<u8, Error> {
    let workspace = Workspace::open(path)?;
    let removed = workspace.clean()?;
    reporter.value(json!({
        "ok": true,
        "command": "clean",
        "removed": removed,
        "build_directory": workspace.build_dir_path()
    }))?;
    if !reporter.json {
        if removed {
            println!("Removed {}", workspace.build_dir_path().display());
        } else {
            println!("Build directory is already clean");
        }
    }
    Ok(EXIT_SUCCESS)
}

fn run_doctor(path: &Path, reporter: Reporter) -> Result<u8, Error> {
    let workspace = Workspace::open(path)?;
    let tools = BuildTools::discover(workspace.root());
    let report = workspace.doctor(&tools);
    reporter.value(json!({"ok": report.ok, "command": "doctor", "report": report}))?;
    if !reporter.json {
        for check in &report.checks {
            let status = match check.status {
                DoctorStatus::Pass => "PASS",
                DoctorStatus::Warning => "WARN",
                DoctorStatus::Fail => "FAIL",
            };
            println!("{status} {}: {}", check.name, check.message);
        }
    }
    Ok(if report.ok {
        EXIT_SUCCESS
    } else {
        EXIT_ENVIRONMENT
    })
}

fn run_project_info(path: &Path, reporter: Reporter) -> Result<u8, Error> {
    let workspace = Workspace::open(path)?;
    let info = workspace.info()?;
    reporter.value(json!({"ok": true, "command": "project info", "project": info}))?;
    if !reporter.json {
        println!("Name: {}", info.name);
        println!("Root: {}", info.root.display());
        println!("Main document: {}", info.main_document);
        println!("Engine: {}", info.engine.canonical_name());
        println!("Build directory: {}", info.build_directory.display());
    }
    Ok(EXIT_SUCCESS)
}

async fn run_watch(path: &Path, options: BuildOptions, reporter: Reporter) -> Result<u8, Error> {
    let workspace = Workspace::open(path)?;
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let mut watcher = create_watcher(sender)?;
    watcher
        .watch(workspace.root(), RecursiveMode::Recursive)
        .map_err(notify_error)?;
    reporter.value(json!({
        "ok": true,
        "event": "watching",
        "project": workspace.info()?
    }))?;
    if !reporter.json {
        println!("Watching {}", workspace.root().display());
    }
    if !watch_build(&workspace, options, reporter).await? {
        return Ok(EXIT_SUCCESS);
    }
    loop {
        let event = tokio::select! {
            signal = tokio::signal::ctrl_c() => {
                signal.map_err(|error| Error::new(ErrorKind::Io, error.to_string()))?;
                return Ok(EXIT_SUCCESS);
            }
            event = receiver.recv() => event.ok_or_else(|| {
                Error::new(ErrorKind::Io, "file watcher stopped unexpectedly")
            })?,
        };
        match event {
            Ok(event) if relevant_event(&event, workspace.root()) => {}
            Ok(_) => continue,
            Err(error) => {
                emit_watch_error(reporter, &error)?;
                continue;
            }
        }
        tokio::time::sleep(WATCH_DEBOUNCE).await;
        while let Ok(event) = receiver.try_recv() {
            if let Err(error) = event {
                emit_watch_error(reporter, &error)?;
            }
        }
        if !watch_build(&workspace, options, reporter).await? {
            return Ok(EXIT_SUCCESS);
        }
    }
}

fn create_watcher(
    sender: mpsc::UnboundedSender<notify::Result<Event>>,
) -> Result<RecommendedWatcher, Error> {
    notify::recommended_watcher(move |event| {
        let _ = sender.send(event);
    })
    .map_err(notify_error)
}

async fn watch_build(
    workspace: &Workspace,
    options: BuildOptions,
    reporter: Reporter,
) -> Result<bool, Error> {
    reporter.value(json!({"ok": true, "event": "build_started"}))?;
    let result = tokio::select! {
        result = compile(workspace, options, reporter) => result?,
        signal = tokio::signal::ctrl_c() => {
            signal.map_err(|error| Error::new(ErrorKind::Io, error.to_string()))?;
            return Ok(false);
        }
    };
    reporter.value(json!({"ok": result.ok, "event": "build_finished", "build": result}))?;
    if !reporter.json {
        if result.ok {
            if let Some(output) = result.output {
                println!(
                    "Built {} in {} ms",
                    output.display(),
                    result.compile_time_ms
                );
            }
        } else {
            eprintln!(
                "Build failed in {} ms. Waiting for changes",
                result.compile_time_ms
            );
        }
    }
    Ok(true)
}

fn relevant_event(event: &Event, root: &Path) -> bool {
    if !matches!(
        event.kind,
        EventKind::Any | EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    ) {
        return false;
    }
    event.paths.is_empty()
        || event
            .paths
            .iter()
            .any(|path| path.starts_with(root) && !ignored_path(path, root))
}

fn ignored_path(path: &Path, root: &Path) -> bool {
    path.strip_prefix(root).is_ok_and(|relative| {
        relative.components().any(
            |component| matches!(component, Component::Normal(value) if ignored_component(value)),
        )
    })
}

fn ignored_component(value: &OsStr) -> bool {
    value == OsStr::new(".oleafly")
        || value == OsStr::new(".git")
        || value == OsStr::new("node_modules")
        || value == OsStr::new("target")
}

fn emit_watch_error(reporter: Reporter, error: &notify::Error) -> Result<(), Error> {
    reporter.value(json!({
        "ok": false,
        "event": "watch_error",
        "error": error.to_string()
    }))?;
    if !reporter.json {
        eprintln!("watch error: {error}");
    }
    Ok(())
}

fn notify_error(error: notify::Error) -> Error {
    Error::new(ErrorKind::Io, format!("file watcher error: {error}"))
}

fn output_error(error: std::io::Error) -> Error {
    Error::new(ErrorKind::Io, format!("failed to write output: {error}"))
}

fn json_output_error(error: serde_json::Error) -> Error {
    Error::new(
        ErrorKind::Io,
        format!("failed to serialize output: {error}"),
    )
}

fn exit_for_error(error: &Error) -> u8 {
    match error.kind() {
        ErrorKind::MissingTool => EXIT_ENVIRONMENT,
        ErrorKind::Build => EXIT_BUILD,
        ErrorKind::InvalidInput
        | ErrorKind::NotInitialized
        | ErrorKind::InvalidManifest
        | ErrorKind::UnsafePath
        | ErrorKind::Io => EXIT_PROJECT,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_accepts_every_initial_command() {
        for command in [
            vec!["oleaflyc", "init"],
            vec!["oleaflyc", "build"],
            vec!["oleaflyc", "watch"],
            vec!["oleaflyc", "clean"],
            vec!["oleaflyc", "doctor"],
            vec!["oleaflyc", "project", "info"],
        ] {
            Cli::try_parse_from(command).unwrap();
        }
    }

    #[test]
    fn watcher_ignores_generated_and_dependency_trees() {
        let root = Path::new("workspace");
        assert!(ignored_path(&root.join(".oleafly/build/out.pdf"), root));
        assert!(ignored_path(&root.join("node_modules/pkg/index.js"), root));
        assert!(!ignored_path(&root.join("chapters/one.tex"), root));
    }

    #[test]
    fn error_exit_codes_are_stable() {
        assert_eq!(
            exit_for_error(&Error::new(ErrorKind::MissingTool, "missing")),
            EXIT_ENVIRONMENT
        );
        assert_eq!(
            exit_for_error(&Error::new(ErrorKind::Build, "failed")),
            EXIT_BUILD
        );
        assert_eq!(
            exit_for_error(&Error::new(ErrorKind::InvalidManifest, "invalid")),
            EXIT_PROJECT
        );
    }
}
