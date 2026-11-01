use std::future::Future;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use clap::Args;
use notify::{Config, Event, EventKind, PollWatcher, RecursiveMode, Watcher};
use oleafly_core::engine_spec::EngineFlags;
use oleafly_core::exclude::is_quietly_ignored_name;
use oleafly_core::{is_generated_directory, Engine};
use serde_json::json;
use tokio::sync::mpsc;

use super::common::{build_json, print_build, CliCompiler};
use super::CommandModule;
use crate::contract::{path_arg, CliError, Context, ErrorKind, Exit, LogMode, Outcome, Warning};
use crate::engine::{build_opened, open_project, output_destination, BuildRequest, OpenedProject};
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

fn streams_compiler_output(ctx: &Context) -> bool {
    !ctx.json() && !ctx.quiet() && ctx.log_mode() == LogMode::Full
}

fn request_for(ctx: &Context, args: &BuildArgs) -> BuildRequest {
    let log = if streams_compiler_output(ctx) {
        CompilerLog::new(crate::human::stream)
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
                crate::human::out_line(&line.to_string());
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
    crate::engine::typst_variant(&opened.workspace, args.variant.as_deref())?;
    let root = opened.workspace.root().to_path_buf();
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let mut watcher = create_watcher(sender)?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(notify_error)?;
    ctx.stream_event(
        "watching",
        json!({"ok": true, "project": opened.workspace.info()?, "warnings": ctx.warnings()}),
    )?;
    if !ctx.json() {
        ctx.say(format!("Watching {}", root.display()));
    }
    let request = request_for(ctx, &args);
    let output = watched_output(&root, &args, &opened.workspace.manifest().main_doc);
    let mut stop = Box::pin(crate::stop_requested());
    if !watch_build(ctx, &root, &args, &request, true, &mut stop).await? {
        return Ok(Outcome::printed());
    }
    loop {
        let event = tokio::select! {
            () = &mut stop => return Ok(Outcome::printed()),
            event = receiver.recv() => event.ok_or_else(|| {
                CliError::new(ErrorKind::Io, "watch.stopped", "The file watcher stopped unexpectedly.")
            })?,
        };
        match event {
            Ok(event) if relevant_event(&event, &root, output.as_deref()) => {}
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
        if !watch_build(ctx, &root, &args, &request, false, &mut stop).await? {
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

async fn watch_build(
    ctx: &Context,
    root: &Path,
    args: &BuildArgs,
    request: &BuildRequest,
    first: bool,
    stop: &mut (impl Future<Output = ()> + Unpin),
) -> Result<bool, CliError> {
    ctx.stream_event("build_started", json!({"ok": true}))?;
    let result = tokio::select! {
        result = async {
            let opened = open_project(root, args.main.as_deref(), args.compiler.map(Into::into))?;
            build_opened(&opened, request).await
        } => result,
        () = stop => return Ok(false),
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
    let warnings: Vec<&Warning> = result
        .warnings
        .iter()
        .filter(|warning| first || warning.code != crate::engine::TYPST_SETTING_UNSUPPORTED)
        .collect();
    ctx.stream_event(
        "build_finished",
        json!({"ok": result.ok, "build": build_json(&result, ctx.log_mode()), "warnings": warnings}),
    )?;
    if !ctx.json() {
        for warning in warnings {
            ctx.warn(warning.code.clone(), warning.message.clone());
        }
        print_build(ctx, &result, streams_compiler_output(ctx));
        if !result.ok {
            ctx.note("Waiting for changes.");
        }
    }
    Ok(true)
}

pub(crate) fn relevant_event(event: &Event, root: &Path, output: Option<&Path>) -> bool {
    if !matches!(
        event.kind,
        EventKind::Any | EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    ) {
        return false;
    }
    event.paths.is_empty()
        || event.paths.iter().any(|path| {
            path.starts_with(root)
                && !ignored_path(path, root)
                && !written_by_oleafly(path, root, output)
                && !folder_changed(event.kind, path)
        })
}

fn folder_changed(kind: EventKind, path: &Path) -> bool {
    matches!(kind, EventKind::Modify(_)) && path.is_dir()
}

fn written_by_oleafly(path: &Path, root: &Path, output: Option<&Path>) -> bool {
    if path
        .file_name()
        .is_some_and(|name| is_quietly_ignored_name(&name.to_string_lossy()))
    {
        return true;
    }
    let (Some(output), Ok(relative)) = (output, path.strip_prefix(root)) else {
        return false;
    };
    // Case-blind: macOS and Windows may report the name in another case.
    relative
        .to_string_lossy()
        .eq_ignore_ascii_case(&output.to_string_lossy())
}

fn watched_output(root: &Path, args: &BuildArgs, main_document: &str) -> Option<PathBuf> {
    let destination = output_destination(args.output.as_deref()?, main_document).ok()?;
    let parent = destination
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent = dunce::canonicalize(parent).ok()?;
    let root = dunce::canonicalize(root).ok()?;
    Some(
        parent
            .strip_prefix(root)
            .ok()?
            .join(destination.file_name()?),
    )
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
                root,
                None
            ));
        }
        assert!(relevant_event(&Event::new(EventKind::Any), root, None));
        assert!(!relevant_event(
            &Event::new(EventKind::Access(AccessKind::Any)).add_path(root.join("chapters/one.tex")),
            root,
            None
        ));
        assert!(!relevant_event(
            &Event::new(EventKind::Modify(ModifyKind::Any))
                .add_path(root.join(".oleafly/build/out.pdf")),
            root,
            None
        ));
        assert!(!relevant_event(
            &Event::new(EventKind::Modify(ModifyKind::Any))
                .add_path(PathBuf::from("another-project/paper.tex")),
            root,
            None
        ));
    }

    #[test]
    fn the_output_copy_does_not_start_the_next_build() {
        let root = Path::new("workspace");
        let output = Path::new("out/paper.pdf");
        let modified = |path: PathBuf| {
            relevant_event(
                &Event::new(EventKind::Modify(ModifyKind::Any)).add_path(path),
                root,
                Some(output),
            )
        };
        assert!(!modified(root.join("out/paper.pdf")));
        assert!(!modified(root.join("out/Paper.PDF")));
        assert!(!modified(root.join("out/.paper.pdf.oleafly-x1y2.tmp")));
        assert!(!relevant_event(
            &Event::new(EventKind::Modify(ModifyKind::Name(
                notify::event::RenameMode::Both
            )))
            .add_path(root.join("out/.paper.pdf.oleafly-x1y2.tmp"))
            .add_path(root.join("out/paper.pdf")),
            root,
            Some(output)
        ));
        assert!(!modified(root.join("chapters/.one.tex.swp")));
        assert!(!modified(root.join("chapters/one.tex~")));
        assert!(modified(root.join("chapters/one.tex")));
        assert!(modified(root.join("figures/plot.pdf")));
        assert!(modified(root.join("paper.pdf")));
    }

    #[test]
    fn a_folders_own_time_moving_is_not_an_edit() {
        use notify::event::MetadataKind;
        let project = tempfile::tempdir().unwrap();
        let root = project.path();
        std::fs::create_dir(root.join("out")).unwrap();
        std::fs::write(root.join("main.tex"), "x").unwrap();
        let metadata = EventKind::Modify(ModifyKind::Metadata(MetadataKind::WriteTime));
        let on = |path: PathBuf| relevant_event(&Event::new(metadata).add_path(path), root, None);
        assert!(!on(root.to_path_buf()));
        assert!(!on(root.join("out")));
        assert!(on(root.join("main.tex")));
        assert!(relevant_event(
            &Event::new(EventKind::Create(CreateKind::Folder)).add_path(root.join("out")),
            root,
            None
        ));
    }

    #[test]
    fn the_watched_output_is_found_inside_the_project_only() {
        let project = tempfile::tempdir().unwrap();
        let root = project.path();
        let outside = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.join("out")).unwrap();
        let args = |output: PathBuf| BuildArgs {
            offline: false,
            fast: false,
            halt_on_error: false,
            timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
            variant: None,
            main: None,
            compiler: None,
            output: Some(output),
        };
        assert_eq!(
            watched_output(root, &args(root.join("out/paper.pdf")), "main.tex"),
            Some(PathBuf::from("out/paper.pdf"))
        );
        assert_eq!(
            watched_output(root, &args(root.join("out")), "chapters/main.tex"),
            Some(PathBuf::from("out/main.pdf"))
        );
        assert_eq!(
            watched_output(root, &args(root.join("paper.pdf")), "main.tex"),
            Some(PathBuf::from("paper.pdf"))
        );
        assert_eq!(
            watched_output(root, &args(outside.path().join("paper.pdf")), "main.tex"),
            None
        );
        let mut without = args(root.join("paper.pdf"));
        without.output = None;
        assert_eq!(watched_output(root, &without, "main.tex"), None);
    }

    #[test]
    fn watcher_errors_keep_context_and_stable_kinds() {
        let watcher = notify_error(notify::Error::generic("backend unavailable"));
        assert_eq!(watcher.kind, ErrorKind::Io);
        assert!(watcher.message.contains("backend unavailable"));
    }
}
