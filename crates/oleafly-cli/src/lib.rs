extern crate self as oleafly_cli;

mod desktop_link;
mod launcher;
mod native;
mod process;
mod typst;
mod typst_settings;

#[cfg(test)]
#[path = "../tests/support/mod.rs"]
mod support;

use clap::{Args, Parser, Subcommand, ValueEnum};
use native::{
    rejected_override_message, BuildOptions, BuildResult, BuildTools, CompilerLog, NativeCompiler,
};
use notify::{Config, Event, EventKind, PollWatcher, RecursiveMode, Watcher};
use oleafly_core::typst_toolchain::{typst_version_of, TYPST_VERSION_TIMEOUT};
use oleafly_core::{
    is_generated_directory, DoctorCheck, DoctorReport, DoctorStatus, Engine, Error, ErrorKind,
    InitOptions, TypstSpec, Workspace,
};
use serde_json::{json, Value};
use std::ffi::{OsStr, OsString};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use tokio::sync::mpsc;
use typst::{resolve_pinned, TypstInventory};
use typst_settings::{
    chosen_variant, unsupported_settings, SettingsRequest, SettingsSummary, TypstSettings,
};

pub use native::executable_name;

const EXIT_SUCCESS: u8 = 0;
const EXIT_PROJECT: u8 = 3;
const EXIT_ENVIRONMENT: u8 = 4;
const EXIT_BUILD: u8 = 5;
const WATCH_DEBOUNCE: Duration = Duration::from_millis(300);
const DEFAULT_TIMEOUT_SECONDS: u64 = 300;

const UNSTABLE_NOTICE: &str = "\
This is a 0.x release and nothing about its interface is stable yet. JSON
fields may be added, renamed, or removed and exit codes may change in any
release before 1.0.0. Pin an exact version if you script against it.";

#[derive(Debug, Parser)]
#[command(
    name = "oleafly",
    bin_name = "oleafly",
    version,
    about = "Build and manage Oleafly projects",
    after_help = UNSTABLE_NOTICE,
    after_long_help = UNSTABLE_NOTICE
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
    #[command(about = "Open a folder in the Oleafly app")]
    Open(OpenCommand),
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
    #[command(about = "Print a shell completion script")]
    Completions {
        #[arg(value_enum, help = "Shell to generate a completion script for")]
        shell: clap_complete::Shell,
    },
    #[command(about = "Print the manual page in roff format")]
    Man,
}

#[derive(Debug, Args)]
pub struct OpenCommand {
    #[arg(
        value_name = "PATH",
        help = "Folder to open. Without one, oleafly opens the current folder"
    )]
    pub path: Option<PathBuf>,
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

#[derive(Clone, Debug, Args)]
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
    #[arg(
        long,
        value_name = "NAME",
        help = "Compile a Typst project with this variant from project.json"
    )]
    pub variant: Option<String>,
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

impl From<&BuildCommand> for BuildOptions {
    fn from(value: &BuildCommand) -> Self {
        Self {
            offline: value.offline,
            fast: value.fast,
            halt_on_error: value.halt_on_error,
        }
    }
}

#[derive(Clone)]
struct BuildRequest {
    options: BuildOptions,
    timeout: Duration,
    reporter: Reporter,
    variant: Option<String>,
}

impl BuildRequest {
    fn new(command: BuildCommand, reporter: Reporter) -> Self {
        Self {
            options: BuildOptions::from(&command),
            timeout: Duration::from_secs(command.timeout_seconds),
            reporter,
            variant: command.variant,
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

pub fn main() -> std::process::ExitCode {
    let arguments = expand_open_shorthand(std::env::args_os());
    let cli = match Cli::try_parse_from(&arguments) {
        Ok(cli) => cli,
        Err(error) => with_open_tip(error).exit(),
    };
    match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => std::process::ExitCode::from(runtime.block_on(run(cli))),
        Err(error) => {
            eprintln!("error: could not start the async runtime: {error}");
            std::process::ExitCode::from(EXIT_ENVIRONMENT)
        }
    }
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
            Some("-C" | "--project") => index += 2,
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
        || <Cli as clap::CommandFactory>::command()
            .get_subcommands()
            .any(|command| {
                command.get_name() == name || command.get_all_aliases().any(|alias| alias == name)
            })
}

pub async fn run(cli: Cli) -> u8 {
    let reporter = Reporter { json: cli.json };
    let command_name = command_name(&cli.command);
    let result = match cli.command {
        Command::Open(command) => run_open(&cli.project, command, reporter),
        Command::Init(command) => run_init(&cli.project, command, reporter),
        Command::Build(command) => {
            run_build(&cli.project, BuildRequest::new(command, reporter)).await
        }
        Command::Watch(command) => {
            run_watch(&cli.project, BuildRequest::new(command, reporter)).await
        }
        Command::Clean => run_clean(&cli.project, reporter),
        Command::Doctor => run_doctor(&cli.project, reporter),
        Command::Project {
            command: ProjectCommand::Info,
        } => run_project_info(&cli.project, reporter),
        Command::Completions { shell } => run_completions(shell),
        Command::Man => run_man(),
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
        Command::Open(_) => "open",
        Command::Init(_) => "init",
        Command::Build(_) => "build",
        Command::Watch(_) => "watch",
        Command::Clean => "clean",
        Command::Doctor => "doctor",
        Command::Project { .. } => "project info",
        Command::Completions { .. } => "completions",
        Command::Man => "man",
    }
}

fn run_completions(shell: clap_complete::Shell) -> Result<u8, Error> {
    let mut command = <Cli as clap::CommandFactory>::command();
    let name = command.get_name().to_string();
    clap_complete::generate(shell, &mut command, name, &mut std::io::stdout());
    Ok(EXIT_SUCCESS)
}

fn run_man() -> Result<u8, Error> {
    let command = <Cli as clap::CommandFactory>::command();
    clap_mangen::Man::new(command).render(&mut std::io::stdout())?;
    Ok(EXIT_SUCCESS)
}

fn run_open(project: &Path, command: OpenCommand, reporter: Reporter) -> Result<u8, Error> {
    let requested = command.path.as_deref().unwrap_or(project);
    let current = std::env::current_dir().map_err(|error| {
        Error::new(
            ErrorKind::Io,
            format!("could not read the current folder: {error}"),
        )
    })?;
    let folder = launcher::resolve_folder(requested, &current)?;
    launcher::open_in_app(&folder)?;
    reporter.value(json!({"ok": true, "command": "open", "folder": folder}))?;
    Ok(EXIT_SUCCESS)
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

async fn run_build(path: &Path, request: BuildRequest) -> Result<u8, Error> {
    let workspace = open_or_detect(path, request.reporter)?;
    note_ignored_options(&workspace, &request);
    typst_variant(&workspace, &request)?;
    let tools = build_tools(&workspace, None);
    note_unapplied_settings(&workspace, &tools, request.reporter);
    let result = compile(&workspace, &request, tools).await?;
    report_build(&result, request.reporter, "build")?;
    Ok(if result.ok { EXIT_SUCCESS } else { EXIT_BUILD })
}

fn open_or_detect(path: &Path, reporter: Reporter) -> Result<Workspace, Error> {
    let (workspace, detected) = detected_workspace(path)?;
    if detected && !reporter.json {
        eprintln!(
            "No Oleafly project.json here, so building {}",
            workspace.manifest().main_doc
        );
    }
    Ok(workspace)
}

fn note_ignored_options(workspace: &Workspace, request: &BuildRequest) {
    if request.reporter.json {
        return;
    }
    let Ok(engine) = workspace.manifest().engine() else {
        return;
    };
    let variant = (request.variant.is_some() && engine != Engine::Typst).then_some("--variant");
    for flag in request
        .options
        .ignored_by(engine)
        .into_iter()
        .chain(variant)
    {
        eprintln!(
            "note: {flag} is ignored for {} projects",
            engine.canonical_name()
        );
    }
}

fn is_typst_workspace(workspace: &Workspace) -> bool {
    matches!(workspace.manifest().engine(), Ok(Engine::Typst))
}

fn typst_variant(workspace: &Workspace, request: &BuildRequest) -> Result<Option<String>, Error> {
    if !is_typst_workspace(workspace) {
        return Ok(None);
    }
    chosen_variant(
        workspace.manifest().typst.as_ref(),
        request.variant.as_deref(),
    )
}

fn unapplied_settings(workspace: &Workspace, tools: &BuildTools) -> Vec<String> {
    if !is_typst_workspace(workspace) || tools.typst.is_none() {
        return Vec::new();
    }
    unsupported_settings(
        workspace.manifest().typst.as_ref(),
        tools.typst_capabilities(),
        &tools.typst_version_label(),
    )
}

fn note_unapplied_settings(workspace: &Workspace, tools: &BuildTools, reporter: Reporter) {
    if reporter.json {
        return;
    }
    for note in unapplied_settings(workspace, tools) {
        eprintln!("note: {note}");
    }
}

async fn typst_settings(
    workspace: &Workspace,
    request: &BuildRequest,
) -> Result<TypstSettings, Error> {
    if !is_typst_workspace(workspace) {
        return Ok(TypstSettings::default());
    }
    let spec = workspace.manifest().typst.as_ref();
    let variant = chosen_variant(spec, request.variant.as_deref())?;
    let commit_time = if spec.is_some_and(|spec| spec.reproducible) {
        typst_settings::head_commit_time(workspace.root()).await
    } else {
        None
    };
    let data_root = desktop_link::data_root();
    Ok(TypstSettings::resolve(&SettingsRequest {
        spec,
        project_root: workspace.root(),
        data_root: data_root.as_deref(),
        variant: variant.as_deref(),
        offline: request.options.offline,
        commit_time,
    }))
}

fn detected_workspace(path: &Path) -> Result<(Workspace, bool), Error> {
    match Workspace::open(path) {
        Err(error) if error.kind() == ErrorKind::NotInitialized => {
            let saved = desktop_link::saved_project(path);
            let workspace = Workspace::detected(path, saved.main_doc.as_deref())?;
            with_saved_typst(workspace, saved.typst).map(|workspace| (workspace, true))
        }
        opened => opened.map(|workspace| (workspace, false)),
    }
}

fn with_saved_typst(workspace: Workspace, saved: Option<TypstSpec>) -> Result<Workspace, Error> {
    let Some(saved) = saved else {
        return Ok(workspace);
    };
    let mut manifest = workspace.manifest().clone();
    manifest.typst = Some(overlay_typst(manifest.typst.take(), saved));
    Workspace::from_manifest(workspace.root(), manifest)
}

fn overlay_typst(current: Option<TypstSpec>, saved: TypstSpec) -> TypstSpec {
    let Some(current) = current else {
        return saved;
    };
    let fields = |spec: &TypstSpec| match serde_json::to_value(spec) {
        Ok(Value::Object(fields)) => fields,
        _ => serde_json::Map::new(),
    };
    let mut merged = fields(&current);
    merged.extend(fields(&saved));
    serde_json::from_value(Value::Object(merged)).unwrap_or(saved)
}

fn typst_project_pin(workspace: &Workspace) -> Option<&str> {
    match workspace.manifest().engine() {
        Ok(Engine::Typst) => workspace.manifest().typst_version_pin(),
        _ => None,
    }
}

fn build_tools(workspace: &Workspace, inventory: Option<&TypstInventory>) -> BuildTools {
    let mut tools = BuildTools::discover(workspace.root());
    if let Some(pin) = typst_project_pin(workspace) {
        let discovered;
        let inventory = match inventory {
            Some(inventory) => inventory,
            None => {
                discovered = TypstInventory::discover(workspace.root());
                &discovered
            }
        };
        tools.use_pinned_typst(resolve_pinned(pin, inventory));
    } else if let (true, Some(path)) = (is_typst_workspace(workspace), tools.typst.clone()) {
        let version = match inventory {
            Some(inventory) => inventory.version_of(&path),
            None => typst_version_of(&path, TYPST_VERSION_TIMEOUT),
        };
        tools.use_typst_version(version);
    }
    tools
}

async fn compile(
    workspace: &Workspace,
    request: &BuildRequest,
    tools: BuildTools,
) -> Result<BuildResult, Error> {
    let settings = typst_settings(workspace, request).await?;
    NativeCompiler::new(tools)
        .with_typst_settings(settings)
        .with_log(request.reporter.compiler_log())
        .with_timeout(request.timeout)
        .build(workspace, request.options)
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
    let (removed, build_directory) = match Workspace::open(path) {
        Ok(workspace) => (workspace.clean()?, workspace.build_dir_path()),
        Err(error) if error.kind() == ErrorKind::NotInitialized => (
            Workspace::clean_build_directory(path)?,
            Workspace::build_directory_path(path)?,
        ),
        Err(error) => return Err(error),
    };
    reporter.value(json!({
        "ok": true,
        "command": "clean",
        "removed": removed,
        "build_directory": build_directory
    }))?;
    if !reporter.json {
        if removed {
            println!("Removed {}", build_directory.display());
        } else {
            println!("Build directory is already clean");
        }
    }
    Ok(EXIT_SUCCESS)
}

fn install_hint(tool: &str) -> Option<String> {
    let (macos, linux, windows, home) = match tool {
        "tectonic" => (
            Some("brew install tectonic"),
            Some("cargo install tectonic"),
            None,
            "https://tectonic-typesetting.github.io/en-US/install.html",
        ),
        "typst" => (
            Some("brew install typst"),
            Some("cargo install typst-cli"),
            None,
            "https://github.com/typst/typst/releases",
        ),
        "pandoc" => (
            Some("brew install pandoc"),
            Some("sudo apt install pandoc"),
            None,
            "https://pandoc.org/installing.html",
        ),
        "latexmk" => (
            Some("brew install texlive"),
            Some("sudo apt install latexmk"),
            None,
            "https://www.tug.org/texlive/acquire.html",
        ),
        _ => return None,
    };
    let command = if cfg!(target_os = "macos") {
        macos
    } else if cfg!(target_os = "windows") {
        windows
    } else {
        linux
    };
    Some(match command {
        Some(command) => format!("Install it with `{command}`, or see {home}"),
        None => format!("See {home}"),
    })
}

fn run_doctor(path: &Path, reporter: Reporter) -> Result<u8, Error> {
    let (workspace, detected) = detected_workspace(path)?;
    let engine = workspace.manifest().engine()?;
    let inventory = (engine == Engine::Typst).then(|| TypstInventory::discover(workspace.root()));
    let tools = build_tools(&workspace, inventory.as_ref());
    let mut report = workspace.doctor();
    if detected {
        if let Some(check) = report
            .checks
            .iter_mut()
            .find(|check| check.name == "manifest")
        {
            check.status = DoctorStatus::Warning;
            check.message = format!(
                "No Oleafly project.json here, so these checks use {}",
                workspace.manifest().main_doc
            );
        }
    }
    for (name, path) in tools.required_for_engine(engine) {
        let rejected = tools.rejected_override(name);
        if let (None, Some(message)) = (path, tools.typst_pin_error().filter(|_| name == "typst")) {
            report.checks.push(DoctorCheck {
                name: format!("compiler_{name}"),
                status: DoctorStatus::Fail,
                message: message.to_string(),
            });
            continue;
        }
        let found = inventory
            .as_ref()
            .zip(path)
            .and_then(|(inventory, path)| inventory.find(path));
        report.checks.push(match (path, rejected) {
            (Some(path), Some((variable, rejected))) => DoctorCheck {
                name: format!("compiler_{name}"),
                status: DoctorStatus::Warning,
                message: format!(
                    "Using {}. {}",
                    path.display(),
                    rejected_override_message(variable, rejected)
                ),
            },
            (Some(path), None) => DoctorCheck {
                name: format!("compiler_{name}"),
                status: DoctorStatus::Pass,
                message: match found {
                    Some(found) => format!("{} ({})", path.display(), found.describe()),
                    None => path.display().to_string(),
                },
            },
            (None, Some((variable, rejected))) => DoctorCheck {
                name: format!("compiler_{name}"),
                status: DoctorStatus::Fail,
                message: rejected_override_message(variable, rejected),
            },
            (None, None) => DoctorCheck {
                name: format!("compiler_{name}"),
                status: DoctorStatus::Fail,
                message: match install_hint(name) {
                    Some(hint) => format!("{name} was not found. {hint}"),
                    None => format!("{name} was not found"),
                },
            },
        });
    }
    let pin = typst_project_pin(&workspace);
    if inventory.is_some() {
        report
            .checks
            .push(typst_version_check(pin, &tools, inventory.as_ref()));
        let unapplied = unapplied_settings(&workspace, &tools);
        if !unapplied.is_empty() {
            report.checks.push(DoctorCheck {
                name: "typst_settings".to_string(),
                status: DoctorStatus::Warning,
                message: unapplied.join(". "),
            });
        }
    }
    report.ok = report
        .checks
        .iter()
        .all(|check| check.status != DoctorStatus::Fail);
    let settings = inventory.is_some().then(|| {
        SettingsSummary::of(
            workspace.manifest().typst.as_ref(),
            workspace.root(),
            desktop_link::data_root().as_deref(),
        )
    });
    let mut value = json!({"ok": report.ok, "command": "doctor", "report": report});
    if let Some(inventory) = &inventory {
        value["typst"] = json!({"pinned": pin, "found": inventory.found, "settings": settings});
    }
    reporter.value(value)?;
    if !reporter.json {
        print_doctor(&report, inventory.as_ref());
        if let Some(settings) = &settings {
            print_typst_settings(pin, settings);
        }
    }
    Ok(if report.ok {
        EXIT_SUCCESS
    } else {
        EXIT_ENVIRONMENT
    })
}

fn typst_version_check(
    pin: Option<&str>,
    tools: &BuildTools,
    inventory: Option<&TypstInventory>,
) -> DoctorCheck {
    let resolved = tools
        .typst
        .as_deref()
        .and_then(|path| inventory.and_then(|inventory| inventory.find(path)));
    let (status, message) = match (pin, tools.typst_pin_error()) {
        (Some(pin), Some(_)) => (
            DoctorStatus::Fail,
            format!("This project pins Typst {pin}, but no Typst {pin} was found"),
        ),
        (Some(pin), None) => (DoctorStatus::Pass, format!("This project pins Typst {pin}")),
        (None, _) => (
            DoctorStatus::Pass,
            match resolved.and_then(|found| found.version.as_ref()) {
                Some(version) => {
                    format!("No Typst version is pinned, so builds use Typst {version}")
                }
                None => "No Typst version is pinned".to_string(),
            },
        ),
    };
    DoctorCheck {
        name: "typst_version".to_string(),
        status,
        message,
    }
}

fn print_doctor(report: &DoctorReport, inventory: Option<&TypstInventory>) {
    for check in &report.checks {
        let status = match check.status {
            DoctorStatus::Pass => "PASS",
            DoctorStatus::Warning => "WARN",
            DoctorStatus::Fail => "FAIL",
        };
        println!("{status} {}: {}", check.name, check.message);
    }
    let Some(inventory) = inventory else {
        return;
    };
    if inventory.found.is_empty() {
        println!("Typst found: none");
        return;
    }
    println!("Typst found:");
    for found in &inventory.found {
        let version = found
            .version
            .as_ref()
            .map_or_else(|| "unknown".to_string(), ToString::to_string);
        println!(
            "  {version:<12} {:<13} {}",
            found.source.label(),
            found.path.display()
        );
    }
}

fn listed(items: Vec<String>) -> String {
    if items.is_empty() {
        "none".to_string()
    } else {
        items.join(", ")
    }
}

fn assignments(inputs: &std::collections::BTreeMap<String, String>) -> Vec<String> {
    inputs
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect()
}

fn on_off(value: bool) -> String {
    if value { "on" } else { "off" }.to_string()
}

fn typst_settings_lines(pin: Option<&str>, settings: &SettingsSummary) -> Vec<String> {
    let path = |path: &Option<PathBuf>| {
        path.as_ref()
            .map_or_else(|| "none".to_string(), |path| path.display().to_string())
    };
    let variants = settings
        .variants
        .iter()
        .map(|(name, inputs)| match assignments(inputs).as_slice() {
            [] => name.clone(),
            inputs => format!("{name} ({})", inputs.join(", ")),
        })
        .collect();
    [
        ("Version pin", pin.unwrap_or("none").to_string()),
        ("Vendored packages", on_off(settings.vendor_packages)),
        ("Package folder", path(&settings.package_path)),
        ("Package cache", path(&settings.package_cache_path)),
        (
            "Font folders",
            listed(
                settings
                    .font_dirs
                    .iter()
                    .map(|directory| directory.display().to_string())
                    .collect(),
            ),
        ),
        (
            "System fonts",
            if settings.system_fonts {
                "used"
            } else {
                "ignored"
            }
            .to_string(),
        ),
        ("Reproducible", on_off(settings.reproducible)),
        ("Inputs", listed(assignments(&settings.inputs))),
        ("Variants", listed(variants)),
    ]
    .into_iter()
    .map(|(label, value)| format!("  {label:<18} {value}"))
    .collect()
}

fn print_typst_settings(pin: Option<&str>, settings: &SettingsSummary) {
    println!("Typst settings:");
    for line in typst_settings_lines(pin, settings) {
        println!("{line}");
    }
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

async fn run_watch(path: &Path, request: BuildRequest) -> Result<u8, Error> {
    let reporter = request.reporter;
    let workspace = open_or_detect(path, reporter)?;
    note_ignored_options(&workspace, &request);
    typst_variant(&workspace, &request)?;
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
    if !watch_build(&workspace_root, &request, true).await? {
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
        if !watch_build(&workspace_root, &request, false).await? {
            return Ok(EXIT_SUCCESS);
        }
    }
}

fn create_watcher(
    sender: mpsc::UnboundedSender<notify::Result<Event>>,
) -> Result<Box<dyn Watcher + Send>, Error> {
    let handler = move |event| {
        let _ = sender.send(event);
    };
    if std::env::var_os("OLEAFLY_WATCH_POLL").is_some() {
        PollWatcher::new(
            handler,
            Config::default().with_poll_interval(Duration::from_millis(100)),
        )
        .map(|watcher| Box::new(watcher) as Box<dyn Watcher + Send>)
        .map_err(notify_error)
    } else {
        notify::recommended_watcher(handler)
            .map(|watcher| Box::new(watcher) as Box<dyn Watcher + Send>)
            .map_err(notify_error)
    }
}

async fn watch_build(path: &Path, request: &BuildRequest, first: bool) -> Result<bool, Error> {
    let reporter = request.reporter;
    reporter.value(json!({"ok": true, "event": "build_started"}))?;
    let result = tokio::select! {
        result = async {
            let (workspace, _) = detected_workspace(path)?;
            let tools = build_tools(&workspace, None);
            if first {
                note_unapplied_settings(&workspace, &tools, reporter);
            }
            compile(&workspace, request, tools).await
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
            |component| matches!(component, Component::Normal(value) if is_generated_directory(value)),
        )
    })
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
        let Command::Open(command) = cli.command else {
            panic!("expected open command");
        };
        assert_eq!(command.path, None);
        assert_eq!(cli.project, PathBuf::from("."));

        let cli = Cli::try_parse_from(["oleafly", "open", "build"]).unwrap();
        let Command::Open(command) = cli.command else {
            panic!("expected open command");
        };
        assert_eq!(command.path, Some(PathBuf::from("build")));

        let cli = Cli::try_parse_from(expand_open_shorthand(["oleafly", ".."])).unwrap();
        let Command::Open(command) = cli.command else {
            panic!("expected open command");
        };
        assert_eq!(command.path, Some(PathBuf::from("..")));

        let cli = Cli::try_parse_from(expand_open_shorthand(["oleafly", "build"])).unwrap();
        assert!(matches!(cli.command, Command::Build(_)));
        assert_eq!(command_name(&cli.command), "build");
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
    fn build_and_watch_take_a_typst_variant() {
        for command in ["build", "watch"] {
            let cli =
                Cli::try_parse_from(["oleafly", command, "--variant", "camera-ready"]).unwrap();
            let (Command::Build(parsed) | Command::Watch(parsed)) = cli.command else {
                panic!("expected a build command");
            };
            assert_eq!(parsed.variant.as_deref(), Some("camera-ready"));
            let request = BuildRequest::new(parsed, Reporter { json: false });
            assert_eq!(request.variant.as_deref(), Some("camera-ready"));
        }
        let cli = Cli::try_parse_from(["oleafly", "build"]).unwrap();
        let Command::Build(parsed) = cli.command else {
            panic!("expected build command");
        };
        assert_eq!(parsed.variant, None);
    }

    #[test]
    fn doctor_lists_the_effective_typst_settings() {
        let summary = SettingsSummary {
            vendor_packages: true,
            package_path: Some(PathBuf::from("/p/typst-packages")),
            package_cache_path: Some(PathBuf::from("/data/typst/packages-cache")),
            font_dirs: vec![PathBuf::from("/p/fonts"), PathBuf::from("/p/assets/type")],
            system_fonts: false,
            reproducible: true,
            inputs: [("draft".to_string(), "true".to_string())].into(),
            variants: [
                (
                    "review".to_string(),
                    [("anonymous".to_string(), "true".to_string())].into(),
                ),
                ("plain".to_string(), Default::default()),
            ]
            .into(),
        };
        let lines = typst_settings_lines(Some("0.13.1"), &summary);
        let value = |label: &str| {
            lines
                .iter()
                .find_map(|line| line.trim_start().strip_prefix(label))
                .map(str::trim)
                .unwrap_or_else(|| panic!("no {label} line in {lines:?}"))
                .to_string()
        };
        assert_eq!(value("Version pin"), "0.13.1");
        assert_eq!(value("Vendored packages"), "on");
        assert_eq!(value("Package folder"), "/p/typst-packages");
        assert_eq!(value("Font folders"), "/p/fonts, /p/assets/type");
        assert_eq!(value("System fonts"), "ignored");
        assert_eq!(value("Reproducible"), "on");
        assert_eq!(value("Inputs"), "draft=true");
        assert_eq!(value("Variants"), "plain, review (anonymous=true)");

        let empty = SettingsSummary::of(None, Path::new("/nowhere"), None);
        let lines = typst_settings_lines(None, &empty);
        for label in [
            "Version pin",
            "Package folder",
            "Font folders",
            "Inputs",
            "Variants",
        ] {
            assert!(
                lines
                    .iter()
                    .any(|line| line.trim_start().starts_with(label) && line.ends_with(" none")),
                "{label}: {lines:?}"
            );
        }
        assert!(lines.iter().any(|line| line.ends_with(" used")));
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
            BuildOptions::from(&BuildCommand {
                offline: true,
                fast: true,
                halt_on_error: true,
                timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
                variant: Some("review".into()),
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
            variant: None,
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
    fn every_engine_tool_has_an_install_hint() {
        for tool in ["tectonic", "latexmk", "typst", "pandoc"] {
            let hint = install_hint(tool).unwrap_or_else(|| panic!("no install hint for {tool}"));
            assert!(
                hint.contains("https://"),
                "the {tool} hint must name a source: {hint}"
            );
        }
        assert!(install_hint("not-a-compiler").is_none());
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

    fn typst_spec(value: Value) -> TypstSpec {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn the_saved_typst_settings_reach_a_detected_folder_whole() {
        let directory = tempfile::TempDir::new().unwrap();
        std::fs::write(directory.path().join("main.typ"), "= Paper\n").unwrap();
        let detected = Workspace::detected(directory.path(), None).unwrap();
        let saved = json!({
            "version": "0.13.1",
            "vendor_packages": true,
            "font_paths": ["fonts"],
            "future": {"enabled": true}
        });
        let workspace = with_saved_typst(detected, Some(typst_spec(saved.clone()))).unwrap();
        let manifest = workspace.manifest();
        assert_eq!(manifest.typst_version_pin(), Some("0.13.1"));
        assert!(manifest.typst_vendor_packages());
        assert_eq!(serde_json::to_value(&manifest.typst).unwrap(), saved);

        let untouched = Workspace::detected(directory.path(), None).unwrap();
        let unchanged = with_saved_typst(untouched, None).unwrap();
        assert!(unchanged.manifest().typst.is_none());
    }

    #[test]
    fn saved_typst_settings_keep_the_fields_a_manifest_already_has() {
        let directory = tempfile::TempDir::new().unwrap();
        std::fs::write(directory.path().join("main.typ"), "= Paper\n").unwrap();
        let manifest = oleafly_core::ProjectManifest {
            main_doc: "main.typ".into(),
            engine: "typst".into(),
            typst: Some(typst_spec(json!({
                "version": "0.12.0",
                "inputs": {"draft": "true"}
            }))),
            ..oleafly_core::ProjectManifest::default()
        };
        let workspace = Workspace::from_manifest(directory.path(), manifest).unwrap();
        let saved = typst_spec(json!({"version": "0.13.1", "vendor_packages": true}));
        let workspace = with_saved_typst(workspace, Some(saved)).unwrap();
        assert_eq!(
            serde_json::to_value(&workspace.manifest().typst).unwrap(),
            json!({
                "version": "0.13.1",
                "vendor_packages": true,
                "inputs": {"draft": "true"}
            })
        );
    }
}
