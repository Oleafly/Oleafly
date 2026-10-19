//! `oleafly build` and `oleafly watch`.
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use clap::Args;
use notify::{Config, Event, EventKind, PollWatcher, RecursiveMode, Watcher};
use oleafly_core::engine_spec::EngineFlags;
use oleafly_core::{is_generated_directory, Engine};
use serde_json::json;
use tokio::sync::mpsc;

use super::common::{build_json, print_build, CliCompiler};
use super::CommandModule;
use crate::contract::{path_arg, CliError, Context, ErrorKind, Exit, LogMode, Outcome};
use crate::engine::{build_opened, open_project, BuildRequest, OpenedProject};
use crate::native::{ignored_flags, CompilerLog};

pub const DEFAULT_TIMEOUT_SECONDS: u64 = 300;
const WATCH_DEBOUNCE: Duration = Duration::from_millis(300);

#[derive(Debug, clap::Subcommand)]
pub enum Commands {
    /// Build the project PDF
    Build(BuildArgs),
    /// Build now and rebuild when project files change
    Watch(BuildArgs),
}

#[derive(Clone, Debug, Args)]
pub struct BuildArgs {
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
    #[arg(
        long,
        value_name = "FILE",
        help = "Build this file instead of the project's main document"
    )]
    pub main: Option<String>,
    #[arg(
        long,
        value_enum,
        value_name = "COMPILER",
        help = "The LaTeX compiler latexmk runs"
    )]
    pub compiler: Option<CliCompiler>,
    #[arg(short = 'o', long = "output", value_name = "PATH", value_parser = path_arg, help = "Copy the PDF here after a good build (a .pdf file or a folder)")]
    pub output: Option<PathBuf>,
}

impl BuildArgs {
    pub fn flags(&self) -> EngineFlags {
        EngineFlags {
            offline: self.offline,
            fast: self.fast,
            halt_on_error: self.halt_on_error,
        }
    }
}

impl CommandModule for Commands {
    fn name(&self) -> &'static str {
        match self {
            Self::Build(_) => "build",
            Self::Watch(_) => "watch",
        }
    }

    fn handles_interrupt(&self) -> bool {
        matches!(self, Self::Watch(_))
    }

    async fn run(self, ctx: &Context) -> Result<Outcome, CliError> {
        match self {
            Self::Build(args) => run_build(ctx, args).await,
            Self::Watch(args) => run_watch(ctx, args).await,
        }
    }
}

/// Compiler output streams to stderr for people who asked for the full log.
fn streams_compiler_output(ctx: &Context) -> bool {
    !ctx.json() && !ctx.quiet() && ctx.log_mode() == LogMode::Full
}

fn request_for(ctx: &Context, args: &BuildArgs) -> BuildRequest {
    let log = if streams_compiler_output(ctx) {
        CompilerLog::new(|text| eprint!("{text}"))
    } else {
        CompilerLog::default()
    };
    let on_lock_wait: Arc<dyn Fn() + Send + Sync> = {
        let json = ctx.json();
        let events = ctx.events();
        let quiet = ctx.quiet();
        let command = ctx.command();
        Arc::new(move || {
            if events {
                let line = json!({
                    "schema_version": crate::contract::SCHEMA_VERSION,
                    "type": "event",
                    "command": command,
                    "event": "lock_wait",
                });
                println!("{line}");
            } else if !json && !quiet {
                crate::human::note("Waiting for another Oleafly build of this project to finish.");
            }
        })
    };
    BuildRequest {
        flags: args.flags(),
        timeout: Duration::from_secs(args.timeout_seconds),
        variant: args.variant.clone(),
        main: args.main.clone(),
        compiler: args.compiler.map(Into::into),
        output: args.output.clone(),
        log,
        on_lock_wait: Some(on_lock_wait),
    }
}

fn warn_ignored_flags(ctx: &Context, opened: &OpenedProject, args: &BuildArgs) {
    let Ok(engine) = opened.workspace.manifest().engine() else {
        return;
    };
    let variant = (args.variant.is_some() && engine != Engine::Typst).then_some("--variant");
    for flag in ignored_flags(args.flags(), engine)
        .into_iter()
        .chain(variant)
    {
        ctx.warn(
            "build.flag_ignored",
            format!(
                "{flag} is ignored for {} projects.",
                engine.canonical_name()
            ),
        );
    }
}

fn open(ctx: &Context, args: &BuildArgs) -> Result<OpenedProject, CliError> {
    let opened = open_project(
        ctx.project(),
        args.main.as_deref(),
        args.compiler.map(Into::into),
    )?;
    for warning in &opened.warnings {
        ctx.warn(warning.code.clone(), warning.message.clone());
    }
    warn_ignored_flags(ctx, &opened, args);
    Ok(opened)
}

async fn run_build(ctx: &Context, args: BuildArgs) -> Result<Outcome, CliError> {
    let opened = open(ctx, &args)?;
    let request = request_for(ctx, &args);
    ctx.event(
        "build_started",
        json!({
            "main_document": opened.workspace.manifest().main_doc,
            "build_directory": opened.workspace.build_dir_path(),
        }),
    )?;
    let result = build_opened(&opened, &request).await?;
    for warning in &result.warnings {
        ctx.warn(warning.code.clone(), warning.message.clone());
    }
    print_build(ctx, &result, streams_compiler_output(ctx));
    let fields = json!({"build": build_json(&result, ctx.log_mode())});
    Ok(if result.ok {
        Outcome::success(fields)
    } else {
        Outcome::failure(Exit::BuildFailed, fields)
    })
}

async fn run_watch(ctx: &Context, args: BuildArgs) -> Result<Outcome, CliError> {
    let opened = open(ctx, &args)?;
    // An unknown variant is an error, not a build to wait out.
    crate::engine::typst_variant(&opened.workspace, args.variant.as_deref())?;
    let root = opened.workspace.root().to_path_buf();
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let mut watcher = create_watcher(sender)?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(notify_error)?;
    // `ok` as 0.4.7 sent it on every watch event.
    ctx.stream_event(
        "watching",
        json!({"ok": true, "project": opened.workspace.info()?}),
    )?;
    if !ctx.json() {
        ctx.say(format!("Watching {}", root.display()));
    }
    let request = request_for(ctx, &args);
    if !watch_build(ctx, &root, &args, &request, true).await? {
        return Ok(Outcome::printed());
    }
    loop {
        let event = tokio::select! {
            signal = tokio::signal::ctrl_c() => {
                signal.map_err(CliError::from)?;
                return Ok(Outcome::printed());
            }
            event = receiver.recv() => event.ok_or_else(|| {
                CliError::new(ErrorKind::Io, "watch.stopped", "The file watcher stopped unexpectedly.")
            })?,
        };
        match event {
            Ok(event) if relevant_event(&event, &root) => {}
            Ok(_) => continue,
            Err(error) => {
                emit_watch_error(ctx, &error)?;
                continue;
            }
        }
        tokio::time::sleep(WATCH_DEBOUNCE).await;
        while let Ok(event) = receiver.try_recv() {
            if let Err(error) = event {
                emit_watch_error(ctx, &error)?;
            }
        }
        if !watch_build(ctx, &root, &args, &request, false).await? {
            return Ok(Outcome::printed());
        }
    }
}

fn create_watcher(
    sender: mpsc::UnboundedSender<notify::Result<Event>>,
) -> Result<Box<dyn Watcher + Send>, CliError> {
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

/// One build in watch mode; `false` when Ctrl+C ended it. Settings the
/// Typst can't apply are only reported for the `first` build.
async fn watch_build(
    ctx: &Context,
    root: &Path,
    args: &BuildArgs,
    request: &BuildRequest,
    first: bool,
) -> Result<bool, CliError> {
    ctx.stream_event("build_started", json!({"ok": true}))?;
    let result = tokio::select! {
        result = async {
            let opened = open_project(root, args.main.as_deref(), args.compiler.map(Into::into))?;
            build_opened(&opened, request).await
        } => result,
        signal = tokio::signal::ctrl_c() => {
            signal.map_err(CliError::from)?;
            return Ok(false);
        }
    };
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            ctx.stream_event("build_error", json!({"ok": false, "error": error}))?;
            if !ctx.json() {
                crate::human::error(&format!("{} Waiting for changes.", error.message));
            }
            return Ok(true);
        }
    };
    ctx.stream_event(
        "build_finished",
        json!({"ok": result.ok, "build": build_json(&result, ctx.log_mode())}),
    )?;
    if !ctx.json() {
        for warning in result
            .warnings
            .iter()
            .filter(|warning| first || warning.code != crate::engine::TYPST_SETTING_UNSUPPORTED)
        {
            ctx.warn(warning.code.clone(), warning.message.clone());
        }
        print_build(ctx, &result, streams_compiler_output(ctx));
        if !result.ok {
            ctx.note("Waiting for changes.");
        }
    }
    Ok(true)
}

pub(crate) fn relevant_event(event: &Event, root: &Path) -> bool {
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

pub(crate) fn ignored_path(path: &Path, root: &Path) -> bool {
    path.strip_prefix(root).is_ok_and(|relative| {
        relative
            .components()
            .any(|component| matches!(component, Component::Normal(value) if is_generated_directory(value)))
    })
}

fn emit_watch_error(ctx: &Context, error: &notify::Error) -> Result<(), CliError> {
    ctx.stream_event(
        "watch_error",
        json!({"ok": false, "error": error.to_string()}),
    )?;
    if !ctx.json() {
        crate::human::warning(&format!("The file watcher reported a problem: {error}"));
    }
    Ok(())
}

fn notify_error(error: notify::Error) -> CliError {
    CliError::new(
        ErrorKind::Io,
        "watch.failed",
        format!("Oleafly couldn't watch the project's files: {error}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, CreateKind, ModifyKind, RemoveKind};

    #[test]
    fn a_watcher_failure_keeps_its_cause_and_a_stable_kind() {
        let error = notify_error(notify::Error::generic("backend unavailable"));
        assert_eq!(
            (error.kind, error.code.as_ref()),
            (ErrorKind::Io, "watch.failed")
        );
        assert!(
            error.message.contains("backend unavailable"),
            "{}",
            error.message
        );
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
    fn watcher_errors_keep_context_and_stable_kinds() {
        let watcher = notify_error(notify::Error::generic("backend unavailable"));
        assert_eq!(watcher.kind, ErrorKind::Io);
        assert!(watcher.message.contains("backend unavailable"));
    }
}
