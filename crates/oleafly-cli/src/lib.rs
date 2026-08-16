mod native;
mod process;

use clap::{Args, Parser, Subcommand, ValueEnum};
use native::{BuildOptions, BuildResult, BuildTools, CompilerLog, NativeCompiler};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use oleafly_core::{DoctorCheck, DoctorStatus, Engine, Error, ErrorKind, InitOptions, Workspace};
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
const DEFAULT_TIMEOUT_SECONDS: u64 = 300;

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
    #[arg(
        long = "timeout",
        default_value_t = DEFAULT_TIMEOUT_SECONDS,
        value_name = "SECONDS",
        value_parser = clap::value_parser!(u64).range(1..),
        help = "Stop a compiler that exceeds this duration"
    )]
    pub timeout_seconds: u64,
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
        Command::Build(command) => {
            run_build(
                &cli.project,
                command.into(),
                Duration::from_secs(command.timeout_seconds),
                reporter,
            )
            .await
        }
        Command::Watch(command) => {
            run_watch(
                &cli.project,
                command.into(),
                Duration::from_secs(command.timeout_seconds),
                reporter,
            )
            .await
        }
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

async fn run_build(
    path: &Path,
    options: BuildOptions,
    timeout: Duration,
    reporter: Reporter,
) -> Result<u8, Error> {
    let workspace = Workspace::open(path)?;
    let result = compile(&workspace, options, timeout, reporter).await?;
    report_build(&result, reporter, "build")?;
    Ok(if result.ok { EXIT_SUCCESS } else { EXIT_BUILD })
}

async fn compile(
    workspace: &Workspace,
    options: BuildOptions,
    timeout: Duration,
    reporter: Reporter,
) -> Result<BuildResult, Error> {
    let tools = BuildTools::discover(workspace.root());
    NativeCompiler::new(tools)
        .with_log(reporter.compiler_log())
        .with_timeout(timeout)
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
    let mut report = workspace.doctor();
    for (name, path) in tools.required_for_engine(workspace.manifest().engine()?) {
        let rejected = tools.rejected_override(name);
        report.checks.push(match (path, rejected) {
            (Some(path), Some((variable, rejected))) => DoctorCheck {
                name: format!("compiler_{name}"),
                status: DoctorStatus::Warning,
                message: format!(
                    "using {}; refused {variable}={} because project-local compiler paths are not allowed",
                    path.display(),
                    rejected.display()
                ),
            },
            (Some(path), None) => DoctorCheck {
                name: format!("compiler_{name}"),
                status: DoctorStatus::Pass,
                message: path.display().to_string(),
            },
            (None, Some((variable, rejected))) => DoctorCheck {
                name: format!("compiler_{name}"),
                status: DoctorStatus::Fail,
                message: format!(
                    "{variable}={} was refused because project-local compiler paths are not allowed",
                    rejected.display()
                ),
            },
            (None, None) => DoctorCheck {
                name: format!("compiler_{name}"),
                status: DoctorStatus::Fail,
                message: format!("{name} was not found"),
            },
        });
    }
    report.ok = report
        .checks
        .iter()
        .all(|check| check.status != DoctorStatus::Fail);
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
        let manifest_engine = workspace.manifest().engine.trim();
        if manifest_engine.eq_ignore_ascii_case(info.engine.canonical_name()) {
            println!("Engine: {manifest_engine}");
        } else {
            let manifest_engine = if manifest_engine.is_empty() {
                "<default>"
            } else {
                manifest_engine
            };
            println!(
                "Engine: {} (project.json: {manifest_engine})",
                info.engine.canonical_name()
            );
        }
        println!("Build directory: {}", info.build_directory.display());
    }
    Ok(EXIT_SUCCESS)
}

async fn run_watch(
    path: &Path,
    options: BuildOptions,
    timeout: Duration,
    reporter: Reporter,
) -> Result<u8, Error> {
    let workspace = Workspace::open(path)?;
    let workspace_root = workspace.root().to_path_buf();
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let mut watcher = create_watcher(sender)?;
    watcher
        .watch(&workspace_root, RecursiveMode::Recursive)
        .map_err(notify_error)?;
    reporter.value(json!({
        "ok": true,
        "event": "watching",
        "project": workspace.info()?
    }))?;
    if !reporter.json {
        println!("Watching {}", workspace_root.display());
    }
    if !watch_build(&workspace_root, options, timeout, reporter).await? {
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
            Ok(event) if relevant_event(&event, &workspace_root) => {}
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
        if !watch_build(&workspace_root, options, timeout, reporter).await? {
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
    path: &Path,
    options: BuildOptions,
    timeout: Duration,
    reporter: Reporter,
) -> Result<bool, Error> {
    reporter.value(json!({"ok": true, "event": "build_started"}))?;
    let result = tokio::select! {
        result = async {
            let workspace = Workspace::open(path)?;
            compile(&workspace, options, timeout, reporter).await
        } => result,
        signal = tokio::signal::ctrl_c() => {
            signal.map_err(|error| Error::new(ErrorKind::Io, error.to_string()))?;
            return Ok(false);
        }
    };
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            reporter.value(json!({
                "ok": false,
                "event": "build_error",
                "error": {
                    "kind": error.kind(),
                    "message": error.message()
                }
            }))?;
            if !reporter.json {
                eprintln!("Build error: {error}. Waiting for changes");
            }
            return Ok(true);
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
    use notify::event::{AccessKind, CreateKind, ModifyKind, RemoveKind};

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
    fn build_timeout_is_explicit_and_nonzero() {
        let cli = Cli::try_parse_from(["oleaflyc", "build", "--timeout", "900"]).unwrap();
        let Command::Build(command) = cli.command else {
            panic!("expected build command");
        };
        assert_eq!(command.timeout_seconds, 900);
        assert!(Cli::try_parse_from(["oleaflyc", "watch", "--timeout", "0"]).is_err());
    }

    #[test]
    fn watcher_ignores_generated_and_dependency_trees() {
        let root = Path::new("workspace");
        assert!(ignored_path(&root.join(".oleafly/build/out.pdf"), root));
        assert!(ignored_path(&root.join("node_modules/pkg/index.js"), root));
        assert!(!ignored_path(&root.join("chapters/one.tex"), root));
    }

    #[test]
    fn watcher_rebuilds_only_for_relevant_project_events() {
        let root = Path::new("workspace");
        for kind in [
            EventKind::Any,
            EventKind::Create(CreateKind::Any),
            EventKind::Modify(ModifyKind::Any),
            EventKind::Remove(RemoveKind::Any),
        ] {
            assert!(relevant_event(
                &Event::new(kind).add_path(root.join("chapters/one.tex")),
                root
            ));
        }
        assert!(relevant_event(&Event::new(EventKind::Any), root));
        assert!(!relevant_event(
            &Event::new(EventKind::Access(AccessKind::Any)).add_path(root.join("chapters/one.tex")),
            root
        ));
        assert!(!relevant_event(
            &Event::new(EventKind::Modify(ModifyKind::Any))
                .add_path(root.join(".oleafly/build/out.pdf")),
            root
        ));
        assert!(!relevant_event(
            &Event::new(EventKind::Modify(ModifyKind::Any))
                .add_path(PathBuf::from("another-project/paper.tex")),
            root
        ));
    }

    #[test]
    fn command_mappings_preserve_the_public_cli_contract() {
        for (cli_engine, engine) in [
            (CliEngine::Tectonic, Engine::Tectonic),
            (CliEngine::Latexmk, Engine::Latexmk),
            (CliEngine::Typst, Engine::Typst),
            (CliEngine::Markdown, Engine::Markdown),
        ] {
            assert_eq!(Engine::from(cli_engine), engine);
        }
        assert_eq!(
            BuildOptions::from(BuildCommand {
                offline: true,
                fast: true,
                halt_on_error: true,
                timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
            }),
            BuildOptions {
                offline: true,
                fast: true,
                halt_on_error: true,
            }
        );

        let init = || {
            Command::Init(InitCommand {
                name: None,
                main: None,
                engine: None,
            })
        };
        let build = || BuildCommand {
            offline: false,
            fast: false,
            halt_on_error: false,
            timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
        };
        assert_eq!(command_name(&init()), "init");
        assert_eq!(command_name(&Command::Build(build())), "build");
        assert_eq!(command_name(&Command::Watch(build())), "watch");
        assert_eq!(command_name(&Command::Clean), "clean");
        assert_eq!(command_name(&Command::Doctor), "doctor");
        assert_eq!(
            command_name(&Command::Project {
                command: ProjectCommand::Info,
            }),
            "project info"
        );
    }

    #[test]
    fn adapter_errors_keep_context_and_stable_kinds() {
        let watcher = notify_error(notify::Error::generic("backend unavailable"));
        assert_eq!(watcher.kind(), ErrorKind::Io);
        assert!(watcher.message().contains("backend unavailable"));

        let output = output_error(std::io::Error::other("closed"));
        assert_eq!(output.kind(), ErrorKind::Io);
        assert!(output.message().contains("failed to write output"));

        let serde_error = serde_json::from_str::<Value>("{").unwrap_err();
        let json = json_output_error(serde_error);
        assert_eq!(json.kind(), ErrorKind::Io);
        assert!(json.message().contains("failed to serialize output"));
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
        for kind in [
            ErrorKind::InvalidInput,
            ErrorKind::NotInitialized,
            ErrorKind::UnsafePath,
            ErrorKind::Io,
        ] {
            assert_eq!(exit_for_error(&Error::new(kind, "project")), EXIT_PROJECT);
        }
    }
}
