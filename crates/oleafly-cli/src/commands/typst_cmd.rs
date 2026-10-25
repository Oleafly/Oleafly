//! `oleafly typst versions|install|default|remove`: the Typst versions the
//! app manages under Settings › Downloads, from the command line. The rules
//! and the verified download are the app's (`oleafly_downloads::typst`).
use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};

use clap::{Args, Subcommand};
use oleafly_core::typst_toolchain::TypstSource;
use oleafly_core::Engine;
use oleafly_downloads::toolchain::{InstallPhase, ToolchainInstallErrorKind};
use oleafly_downloads::typst::{
    install_version, installing_version, SystemLookup, TypstInstallProgress, TypstToolchain,
    TypstToolchainError, TypstToolchainStatus, VERSION_MISSING,
};
use serde_json::{json, Value};

use super::CommandModule;
use crate::contract::{CliError, Context, ErrorKind, Outcome};
use crate::native::Discovery;

const DEFAULT_KEY: &str = "typst_default_version";

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// List, install and choose Typst versions
    #[command(subcommand)]
    Typst(TypstCommand),
}

#[derive(Debug, Subcommand)]
pub enum TypstCommand {
    /// List the Typst versions Oleafly offers and where each is installed
    #[command(visible_alias = "list")]
    Versions,
    /// Download and install a Typst version
    Install(VersionArgs),
    /// Show or set the Typst version projects without a pin use
    Default(DefaultArgs),
    /// Remove a downloaded Typst version
    Remove(VersionArgs),
}

#[derive(Debug, Args)]
pub struct VersionArgs {
    #[arg(value_name = "VERSION", help = "A Typst version, such as 0.13.1")]
    pub version: String,
}

#[derive(Debug, Args)]
pub struct DefaultArgs {
    #[arg(
        value_name = "VERSION",
        help = "The new default (an installed version)"
    )]
    pub version: Option<String>,
    #[arg(
        long,
        conflicts_with = "version",
        help = "Go back to the version that ships with Oleafly"
    )]
    pub unset: bool,
}

impl CommandModule for Commands {
    fn name(&self) -> &'static str {
        match self {
            Self::Typst(TypstCommand::Versions) => "typst versions",
            Self::Typst(TypstCommand::Install(_)) => "typst install",
            Self::Typst(TypstCommand::Default(_)) => "typst default",
            Self::Typst(TypstCommand::Remove(_)) => "typst remove",
        }
    }

    async fn run(self, ctx: &Context) -> Result<Outcome, CliError> {
        match self {
            Self::Typst(TypstCommand::Versions) => run_versions(ctx).await,
            Self::Typst(TypstCommand::Install(args)) => run_install(ctx, args).await,
            Self::Typst(TypstCommand::Default(args)) => run_default(ctx, args).await,
            Self::Typst(TypstCommand::Remove(args)) => run_remove(ctx, args).await,
        }
    }
}

/// A Typst failure, with the exit code it deserves.
pub(crate) fn typst_error(error: TypstToolchainError) -> CliError {
    let version = error.version.clone();
    let (kind, code): (ErrorKind, &'static str) = match (error.code, error.install) {
        (Some("typst_toolchain.unknown_version"), _) => {
            (ErrorKind::Usage, "typst_toolchain.unknown_version")
        }
        (Some("typst_toolchain.busy"), _) => (ErrorKind::Conflict, "conflict.install_running"),
        (Some(VERSION_MISSING), _) => (ErrorKind::MissingTool, VERSION_MISSING),
        (Some("typst_toolchain.not_offered"), _) => {
            (ErrorKind::MissingTool, "typst_toolchain.not_offered")
        }
        (Some("typst_toolchain.install_unverified"), _) => {
            (ErrorKind::MissingTool, "environment.install_failed")
        }
        (Some(code), _) => (ErrorKind::InvalidInput, code),
        (None, Some(ToolchainInstallErrorKind::DownloadFailed)) => {
            (ErrorKind::Network, "network.unreachable")
        }
        (None, Some(ToolchainInstallErrorKind::AlreadyInstalling)) => {
            (ErrorKind::Conflict, "conflict.install_running")
        }
        (None, Some(ToolchainInstallErrorKind::Cancelled)) => {
            (ErrorKind::Interrupted, "interrupted")
        }
        (None, Some(_)) => (ErrorKind::MissingTool, "environment.install_failed"),
        (None, None) => (ErrorKind::Io, "io.failed"),
    };
    let mut cli = CliError::new(kind, code, error.message);
    match code {
        VERSION_MISSING => {
            let version = version.unwrap_or_default();
            cli = cli.hint(format!(
                "Install it with `oleafly typst install {version}`."
            ));
        }
        "network.unreachable" => {
            cli = cli
                .hint("Check your internet connection, then try again.")
                .retryable()
        }
        "conflict.install_running" => {
            cli = cli
                .hint("Wait for the other install to finish.")
                .retryable()
        }
        "typst_toolchain.unknown_version" => {
            cli = cli.hint("See the versions with `oleafly typst versions`.")
        }
        _ => {}
    }
    cli
}

fn data_root(ctx: &Context) -> Result<PathBuf, CliError> {
    ctx.data_root().map(Path::to_path_buf).ok_or_else(|| {
        CliError::new(
            ErrorKind::InvalidInput,
            "environment.no_data_folder",
            "Oleafly couldn't find its data folder.",
        )
        .hint("Set OLEAFLY_DATA_DIR, or HOME (USERPROFILE on Windows).")
    })
}

/// The toolchain as the app sees it: its data folder, the Typst that ships
/// with Oleafly, and the app's default.
fn toolchain(ctx: &Context, lookup: SystemLookup) -> Result<TypstToolchain, CliError> {
    let data_root = data_root(ctx)?;
    let discovery = Discovery::from_env(ctx.project());
    let bundled = discovery
        .bundled_candidates("typst")
        .into_iter()
        .find(|path| path.is_file());
    let default_choice = crate::app_config::typst_default_choice(&data_root);
    Ok(TypstToolchain::new(
        data_root,
        oleafly_core::typst_toolchain::host_target(),
        bundled,
        default_choice,
        lookup,
    ))
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, CliError> + Send + 'static,
) -> Result<T, CliError> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| CliError::internal(format!("A background task failed: {error}")))?
}

/// The version the project in `-C` pins, when it is a Typst project.
fn project_pin(ctx: &Context) -> Option<String> {
    let opened = crate::engine::open_project(ctx.project(), None, None).ok()?;
    let manifest = opened.workspace.manifest();
    (manifest.engine().ok()? == Engine::Typst)
        .then(|| manifest.typst_version_pin().map(str::to_string))
        .flatten()
}

fn source_name(source: &TypstSource) -> &'static str {
    match source {
        TypstSource::Bundled => "bundled",
        TypstSource::Downloaded => "downloaded",
        TypstSource::System => "system",
    }
}

fn status_json(status: &TypstToolchainStatus, pin: Option<&str>) -> Value {
    let mut value = serde_json::to_value(status).unwrap_or_else(|_| json!({}));
    if let Some(fields) = value.as_object_mut() {
        fields.insert("project_pin".into(), json!(pin));
    }
    value
}

fn print_versions(ctx: &Context, status: &TypstToolchainStatus, pin: Option<&str>) {
    if ctx.json() {
        return;
    }
    if ctx.quiet() {
        ctx.say(&status.default_version);
        return;
    }
    let width = status
        .versions
        .iter()
        .map(|entry| entry.version.len())
        .max()
        .unwrap_or(7)
        .max(7);
    ctx.say(format!(
        "{:<width$}  {:<10}  INSTALLED",
        "VERSION", "RELEASED"
    ));
    for entry in &status.versions {
        let installed = if entry.sources.is_empty() {
            "-".to_string()
        } else {
            entry
                .sources
                .iter()
                .map(source_name)
                .collect::<Vec<_>>()
                .join(", ")
        };
        let mut marks = Vec::new();
        if entry.version == status.default_version {
            marks.push("default");
        }
        if pin == Some(entry.version.as_str()) {
            marks.push("this project");
        }
        if status.installing.as_deref() == Some(entry.version.as_str()) {
            marks.push("installing");
        }
        let marks = if marks.is_empty() {
            String::new()
        } else {
            format!("  ({})", marks.join(", "))
        };
        let released = entry
            .released_at
            .as_deref()
            .map(|date| date.get(..10).unwrap_or(date))
            .unwrap_or("-");
        ctx.say(format!(
            "{:<width$}  {released:<10}  {installed}{marks}",
            entry.version
        ));
    }
}

async fn run_versions(ctx: &Context) -> Result<Outcome, CliError> {
    let pin = project_pin(ctx);
    let toolchain = toolchain(ctx, SystemLookup::Fresh)?;
    let status = blocking(move || Ok(toolchain.status(installing_version()))).await?;
    print_versions(ctx, &status, pin.as_deref());
    Ok(Outcome::success(
        json!({"typst": status_json(&status, pin.as_deref())}),
    ))
}

fn phase_label(phase: InstallPhase) -> &'static str {
    match phase {
        InstallPhase::Downloading => "Downloading",
        InstallPhase::Verifying => "Checking",
        InstallPhase::Extracting => "Unpacking",
        InstallPhase::Done => "Done",
    }
}

/// Shows install progress: events with `--events`, a line that updates in
/// place on a terminal, one line per phase otherwise.
struct ProgressReport {
    terminal: bool,
    last_phase: Option<InstallPhase>,
    open_line: bool,
}

impl ProgressReport {
    fn show(&mut self, ctx: &Context, progress: &TypstInstallProgress) -> Result<(), CliError> {
        ctx.event(
            "progress",
            json!({"version": progress.version, "phase": progress.phase, "received": progress.received_bytes, "total": progress.total_bytes}),
        )?;
        if ctx.json() || ctx.quiet() {
            return Ok(());
        }
        let label = phase_label(progress.phase);
        let percent = (progress.total_bytes > 0).then(|| {
            progress.received_bytes.min(progress.total_bytes) * 100 / progress.total_bytes
        });
        let mut stderr = std::io::stderr().lock();
        if self.terminal {
            let text = match percent {
                Some(percent) if progress.phase == InstallPhase::Downloading => {
                    format!("{label} Typst {} {percent}%", progress.version)
                }
                _ => format!("{label} Typst {}", progress.version),
            };
            let _ = write!(stderr, "\r\x1b[2K{text}");
            self.open_line = progress.phase != InstallPhase::Done;
            if !self.open_line {
                let _ = writeln!(stderr);
            }
        } else if self.last_phase != Some(progress.phase) {
            let _ = writeln!(stderr, "{label} Typst {}", progress.version);
        }
        let _ = stderr.flush();
        self.last_phase = Some(progress.phase);
        Ok(())
    }

    fn finish(&mut self) {
        if self.open_line {
            let _ = writeln!(std::io::stderr());
            self.open_line = false;
        }
    }
}

async fn run_install(ctx: &Context, args: VersionArgs) -> Result<Outcome, CliError> {
    let toolchain = toolchain(ctx, SystemLookup::Lazy)?;
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel::<TypstInstallProgress>();
    let install = install_version(&toolchain, &args.version, move |progress| {
        sender.send(progress).is_ok()
    });
    tokio::pin!(install);
    let mut report = ProgressReport {
        terminal: std::io::stderr().is_terminal(),
        last_phase: None,
        open_line: false,
    };
    let result = loop {
        tokio::select! {
            result = &mut install => break result,
            Some(progress) = receiver.recv() => report.show(ctx, &progress)?,
        }
    };
    while let Ok(progress) = receiver.try_recv() {
        report.show(ctx, &progress)?;
    }
    report.finish();
    let binary = result.map_err(typst_error)?;
    let version = oleafly_downloads::typst::parse_version(&args.version)
        .map_err(typst_error)?
        .to_string();
    let refreshed = toolchain.clone();
    let status = blocking(move || Ok(refreshed.status(None))).await?;
    if !ctx.json() {
        if ctx.quiet() {
            ctx.say(binary.display().to_string());
        } else {
            ctx.say(format!("Installed Typst {version}"));
            if status.default_version != version {
                ctx.note(format!("Make it the default with `oleafly typst default {version}`, or pin it in a project's project.json."));
            }
        }
    }
    Ok(Outcome::success(
        json!({"installed": version, "path": binary, "typst": status_json(&status, None)}),
    ))
}

fn write_default(data_root: &Path, choice: Option<&str>) -> Result<(), CliError> {
    crate::app_config::update_app_config(data_root, |config| {
        match choice {
            Some(version) => {
                config.insert(DEFAULT_KEY.into(), json!(version));
            }
            None => {
                config.remove(DEFAULT_KEY);
            }
        }
        Ok(())
    })
}

async fn run_default(ctx: &Context, args: DefaultArgs) -> Result<Outcome, CliError> {
    let data_root = data_root(ctx)?;
    if args.version.is_none() && !args.unset {
        let toolchain = toolchain(ctx, SystemLookup::Lazy)?;
        let default = toolchain.default_version();
        let follows_app = toolchain.default_choice.is_none();
        if !ctx.json() {
            if follows_app && !ctx.quiet() {
                ctx.say(format!("{default} (the version that ships with Oleafly)"));
            } else {
                ctx.say(&default);
            }
        }
        return Ok(Outcome::success(
            json!({"default_version": default, "follows_app": follows_app}),
        ));
    }
    let toolchain = toolchain(ctx, SystemLookup::Cached)?;
    let choice = match args.version.as_deref() {
        Some(version) => toolchain
            .default_choice_for(Some(version))
            .map_err(typst_error)?,
        None => None,
    };
    let root = data_root.clone();
    let stored = choice.clone();
    blocking(move || write_default(&root, stored.as_deref())).await?;
    let default = choice
        .clone()
        .unwrap_or_else(oleafly_downloads::typst::bundled_version);
    if !ctx.json() {
        if ctx.quiet() {
            ctx.say(&default);
        } else if choice.is_some() {
            ctx.say(format!("Projects without a pin now use Typst {default}."));
        } else {
            ctx.say(format!(
                "Projects without a pin use the Typst that ships with Oleafly ({default})."
            ));
        }
    }
    Ok(Outcome::success(
        json!({"default_version": default, "follows_app": choice.is_none()}),
    ))
}

async fn run_remove(ctx: &Context, args: VersionArgs) -> Result<Outcome, CliError> {
    let toolchain = toolchain(ctx, SystemLookup::Cached)?;
    let version = args.version.clone();
    let status = blocking(move || {
        toolchain
            .remove_downloaded(&version, installing_version().as_deref())
            .map_err(typst_error)
    })
    .await?;
    if !ctx.json() && !ctx.quiet() {
        ctx.say(format!("Removed Typst {}", args.version.trim()));
    }
    Ok(Outcome::success(
        json!({"removed": args.version.trim(), "typst": status_json(&status, None)}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typst_errors_get_the_exit_codes_the_contract_names() {
        let missing = typst_error(TypstToolchainError::coded(VERSION_MISSING, "0.13.1"));
        assert_eq!(
            (missing.kind, missing.code.as_ref()),
            (ErrorKind::MissingTool, VERSION_MISSING)
        );
        assert!(missing
            .hint
            .as_deref()
            .is_some_and(|hint| hint.contains("oleafly typst install 0.13.1")));
        let unknown = typst_error(TypstToolchainError::coded(
            "typst_toolchain.unknown_version",
            "9.9.9",
        ));
        assert_eq!(unknown.exit(), crate::contract::Exit::Usage);
        let busy = typst_error(TypstToolchainError::coded("typst_toolchain.busy", "0.13.1"));
        assert_eq!(busy.exit(), crate::contract::Exit::Conflict);
        let offline = typst_error(TypstToolchainError {
            install: Some(ToolchainInstallErrorKind::DownloadFailed),
            ..TypstToolchainError::other("could not connect")
        });
        assert_eq!(
            (offline.exit(), offline.retryable),
            (crate::contract::Exit::Network, true)
        );
    }

    #[test]
    fn the_default_is_written_beside_every_other_setting() {
        let data = tempfile::tempdir().unwrap();
        std::fs::write(
            data.path().join("config.json"),
            r#"{"theme":"dark","typst_default_version":"0.12.0"}"#,
        )
        .unwrap();
        write_default(data.path(), Some("0.13.1")).unwrap();
        let config: Value =
            serde_json::from_slice(&std::fs::read(data.path().join("config.json")).unwrap())
                .unwrap();
        assert_eq!(
            config,
            json!({"theme": "dark", "typst_default_version": "0.13.1"})
        );
        write_default(data.path(), None).unwrap();
        let config: Value =
            serde_json::from_slice(&std::fs::read(data.path().join("config.json")).unwrap())
                .unwrap();
        assert_eq!(config, json!({"theme": "dark"}));
    }
}
