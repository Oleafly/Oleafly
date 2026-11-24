use std::collections::HashSet;
use std::future::Future;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use clap::Args;
use notify::event::ModifyKind;
use notify::{Config, Event, EventKind, PollWatcher, RecommendedWatcher, RecursiveMode, Watcher};
use oleafly_core::engine_spec::EngineFlags;
use oleafly_core::exclude::is_quietly_ignored_name;
use oleafly_core::{is_generated_directory, Engine};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::common::{build_json, print_build, CliCompiler};
use super::CommandModule;
use crate::contract::{
    event_line, path_arg, CliError, Context, ErrorKind, Exit, LogMode, Outcome, Warning,
};
use crate::engine::{build_opened, open_project, output_destination, BuildRequest, OpenedProject};
use crate::native::{ignored_flags, CompilerLog};

pub const DEFAULT_TIMEOUT_SECONDS: u64 = 300;
const WATCH_DEBOUNCE: Duration = Duration::from_millis(300);
const FALLBACK_POLL: Duration = Duration::from_secs(1);
const FORCED_POLL: Duration = Duration::from_millis(100);

type WatchEvents = mpsc::UnboundedSender<notify::Result<Event>>;

pub(crate) struct FolderWatcher {
    _watcher: Box<dyn Watcher + Send>,
    native_failure: Option<notify::Error>,
}

impl FolderWatcher {
    pub(crate) fn fallback_warning(&self) -> Option<String> {
        self.native_failure.as_ref().map(|error| {
            format!(
                "Oleafly checks the project for changes every second, because the system's file watcher failed: {error}"
            )
        })
    }
}

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
                crate::human::out_line(&event_line(command, "lock_wait", Value::Null));
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
    let mut stop = Box::pin(crate::daemon::serve::termination());
    let opened = open(ctx, &args)?;
    crate::engine::typst_variant(&opened.workspace, args.variant.as_deref())?;
    let root = opened.workspace.root().to_path_buf();
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let watcher = create_watcher(&root, sender)?;
    if let Some(warning) = watcher.fallback_warning() {
        ctx.warn("watch.polling", warning);
    }
    ctx.stream_event(
        "watching",
        json!({"ok": true, "project": opened.workspace.info()?, "warnings": ctx.warnings()}),
    )?;
    if !ctx.json() {
        ctx.say(format!("Watching {}", root.display()));
    }
    let request = request_for(ctx, &args);
    let output = watched_output(&root, &args, &opened.workspace.manifest().main_doc);
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
            Err(error) if vanished_during_scan(&error, &root) => continue,
            Err(error) => {
                emit_watch_error(ctx, &error)?;
                continue;
            }
        }
        tokio::time::sleep(WATCH_DEBOUNCE).await;
        while let Ok(event) = receiver.try_recv() {
            match event {
                Err(error) if !vanished_during_scan(&error, &root) => {
                    emit_watch_error(ctx, &error)?
                }
                _ => {}
            }
        }
        if !watch_build(ctx, &root, &args, &request, false, &mut stop).await? {
            return Ok(Outcome::printed());
        }
    }
}

pub(crate) fn create_watcher(root: &Path, events: WatchEvents) -> Result<FolderWatcher, CliError> {
    if std::env::var_os("OLEAFLY_WATCH_POLL").is_some() {
        return polling(root, events, FORCED_POLL, None);
    }
    native_or_polling(root, events, native_watcher)
}

fn native_watcher(root: &Path, events: WatchEvents) -> notify::Result<Box<dyn Watcher + Send>> {
    let mut watcher = RecommendedWatcher::new(
        move |event| {
            let _ = events.send(event);
        },
        Config::default().with_follow_symlinks(false),
    )?;
    watcher.watch(root, RecursiveMode::Recursive)?;
    Ok(Box::new(watcher))
}

fn native_or_polling(
    root: &Path,
    events: WatchEvents,
    native: impl FnOnce(&Path, WatchEvents) -> notify::Result<Box<dyn Watcher + Send>>,
) -> Result<FolderWatcher, CliError> {
    match native(root, events.clone()) {
        Ok(watcher) => Ok(FolderWatcher {
            _watcher: watcher,
            native_failure: None,
        }),
        Err(error) if out_of_watches(&error) => polling(root, events, FALLBACK_POLL, Some(error)),
        Err(error) => Err(notify_error(error)),
    }
}

fn out_of_watches(error: &notify::Error) -> bool {
    match &error.kind {
        notify::ErrorKind::MaxFilesWatch | notify::ErrorKind::Generic(_) => true,
        notify::ErrorKind::Io(io) => {
            io.kind() == std::io::ErrorKind::OutOfMemory || out_of_handles(io)
        }
        _ => false,
    }
}

#[cfg(unix)]
fn out_of_handles(error: &std::io::Error) -> bool {
    matches!(
        error.raw_os_error(),
        Some(libc::EMFILE | libc::ENFILE | libc::ENOSPC)
    )
}

#[cfg(not(unix))]
fn out_of_handles(_: &std::io::Error) -> bool {
    false
}

fn polling(
    root: &Path,
    events: WatchEvents,
    every: Duration,
    native_failure: Option<notify::Error>,
) -> Result<FolderWatcher, CliError> {
    let mut watcher = PollWatcher::new(
        each_error_once(root, events),
        Config::default()
            .with_poll_interval(every)
            .with_follow_symlinks(false),
    )
    .map_err(notify_error)?;
    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(notify_error)?;
    Ok(FolderWatcher {
        _watcher: Box::new(watcher),
        native_failure,
    })
}

fn each_error_once(
    root: &Path,
    events: WatchEvents,
) -> impl FnMut(notify::Result<Event>) + Send + 'static {
    let root = root.to_path_buf();
    let mut reported = HashSet::new();
    move |event| {
        if let Err(error) = &event {
            if !vanished_during_scan(error, &root) && !reported.insert(error.to_string()) {
                return;
            }
        }
        let _ = events.send(event);
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
                crate::human::error(&watch_error_text(&error));
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
    matches!(
        kind,
        EventKind::Modify(ModifyKind::Data(_) | ModifyKind::Metadata(_) | ModifyKind::Any)
    ) && path.is_dir()
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

pub(crate) fn vanished_during_scan(error: &notify::Error, root: &Path) -> bool {
    let not_found = matches!(&error.kind, notify::ErrorKind::Io(io) if io.kind() == std::io::ErrorKind::NotFound);
    not_found
        && !error.paths.is_empty()
        && error
            .paths
            .iter()
            .all(|path| path != root && path.starts_with(root))
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

fn watch_error_text(error: &CliError) -> String {
    format!("{}\nWaiting for changes.", error.with_hint_text())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, CreateKind, RemoveKind};

    #[test]
    fn a_failed_watch_build_shows_the_hint_before_it_waits() {
        let missing = |message: &str| {
            CliError::new(
                ErrorKind::MissingTool,
                "environment.missing_tool",
                message.to_owned(),
            )
        };
        let error = missing("typst was not found. Install it or set OLEAFLY_TYPST").hint(
            "Run `oleafly typst install 0.15.1`, or see https://github.com/typst/typst/releases",
        );
        assert_eq!(
            watch_error_text(&error),
            "typst was not found. Install it or set OLEAFLY_TYPST. Run `oleafly typst install 0.15.1`, or see https://github.com/typst/typst/releases\nWaiting for changes."
        );
        assert_eq!(
            watch_error_text(&missing("pandoc was not found.")),
            "pandoc was not found.\nWaiting for changes."
        );
    }

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
    fn a_folders_own_time_moving_is_not_an_edit_but_its_rename_is() {
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
        for kind in [
            ModifyKind::Any,
            ModifyKind::Data(notify::event::DataChange::Content),
        ] {
            assert!(!relevant_event(
                &Event::new(EventKind::Modify(kind)).add_path(root.join("out")),
                root,
                None
            ));
        }
        for mode in [
            notify::event::RenameMode::Any,
            notify::event::RenameMode::To,
        ] {
            assert!(relevant_event(
                &Event::new(EventKind::Modify(ModifyKind::Name(mode))).add_path(root.join("out")),
                root,
                None
            ));
        }
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
    fn an_entry_that_vanished_during_a_scan_is_not_a_watch_error() {
        let root = Path::new("/project");
        let missing = |path: &Path| {
            notify::Error::io(std::io::Error::from(std::io::ErrorKind::NotFound))
                .add_path(path.to_path_buf())
        };
        assert!(vanished_during_scan(
            &missing(&root.join(".oleafly/build/tex-defaults/.font.fd.oleafly-1.tmp")),
            root
        ));
        assert!(vanished_during_scan(
            &missing(&root.join("chapters/one.tex")),
            root
        ));
        assert!(!vanished_during_scan(&missing(root), root));
        assert!(!vanished_during_scan(
            &missing(Path::new("/elsewhere/one.tex")),
            root
        ));
        assert!(!vanished_during_scan(
            &notify::Error::io(std::io::Error::from(std::io::ErrorKind::NotFound)),
            root
        ));
        assert!(!vanished_during_scan(
            &notify::Error::io(std::io::Error::from(std::io::ErrorKind::PermissionDenied))
                .add_path(root.join("chapters/one.tex")),
            root
        ));
        assert!(!vanished_during_scan(
            &notify::Error::generic("backend unavailable").add_path(root.join("chapters/one.tex")),
            root
        ));
    }

    #[tokio::test]
    async fn the_watcher_falls_back_to_polling() {
        let project = tempfile::tempdir().unwrap();
        let root = project.path();
        let file = root.join("main.tex");
        std::fs::write(&file, "before").unwrap();
        std::fs::File::options()
            .write(true)
            .open(&file)
            .unwrap()
            .set_modified(std::time::SystemTime::now() - Duration::from_secs(60))
            .unwrap();
        let (native_events, _native_received) = mpsc::unbounded_channel();
        let native = native_or_polling(root, native_events, native_watcher).unwrap();
        assert!(native.fallback_warning().is_none());
        let (events, mut received) = mpsc::unbounded_channel();
        let watcher = native_or_polling(root, events, |_, _| {
            Err(notify::Error::new(notify::ErrorKind::MaxFilesWatch))
        })
        .unwrap();
        let warning = watcher.fallback_warning().unwrap();
        assert!(warning.contains("OS file watch limit reached"), "{warning}");
        let (refused_events, _refused_received) = mpsc::unbounded_channel();
        let Err(refused) = native_or_polling(root, refused_events, |_, _| {
            Err(
                notify::Error::io(std::io::Error::from(std::io::ErrorKind::PermissionDenied))
                    .add_path(root.join("private")),
            )
        }) else {
            panic!("an unreadable folder fell back to polling");
        };
        assert_eq!(refused.code, "watch.failed");
        #[cfg(unix)]
        assert!(out_of_watches(&notify::Error::io(
            std::io::Error::from_raw_os_error(libc::EMFILE)
        )));
        std::fs::write(&file, "after").unwrap();
        let seen = tokio::time::timeout(Duration::from_secs(20), async {
            while let Some(event) = received.recv().await {
                if event.is_ok_and(|event| {
                    relevant_event(&event, root, None) && event.paths.contains(&file)
                }) {
                    return true;
                }
            }
            false
        })
        .await;
        assert_eq!(seen, Ok(true), "polling never saw the edit");
    }

    #[test]
    fn a_poller_reports_each_lasting_error_once() {
        let root = Path::new("/project");
        let (events, mut received) = mpsc::unbounded_channel();
        let mut forward = each_error_once(root, events);
        let denied = || {
            notify::Error::io(std::io::Error::from(std::io::ErrorKind::PermissionDenied))
                .add_path(root.join("private"))
        };
        let vanished = || {
            notify::Error::io(std::io::Error::from(std::io::ErrorKind::NotFound))
                .add_path(root.join("main.aux"))
        };
        for _ in 0..3 {
            forward(Err(denied()));
            forward(Err(vanished()));
            forward(Ok(
                Event::new(EventKind::Any).add_path(root.join("main.tex"))
            ));
        }
        let mut errors = Vec::new();
        let mut changes = 0;
        while let Ok(event) = received.try_recv() {
            match event {
                Ok(_) => changes += 1,
                Err(error) => errors.push(error.to_string()),
            }
        }
        assert_eq!(changes, 3);
        assert_eq!(
            errors,
            [
                denied().to_string(),
                vanished().to_string(),
                vanished().to_string(),
                vanished().to_string()
            ]
        );
    }
}
