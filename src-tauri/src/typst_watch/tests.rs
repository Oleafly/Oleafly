use super::*;

use std::sync::Mutex as StdMutex;

fn finished(events: &[ParsedEvent]) -> Vec<(CycleOutcome, Option<u64>, String)> {
    events
        .iter()
        .filter_map(|event| match event {
            ParsedEvent::Finished {
                outcome,
                duration_ms,
                log,
            } => Some((*outcome, *duration_ms, log.clone())),
            ParsedEvent::Started => None,
        })
        .collect()
}

const HEADER: &str = "watching main.typ\nwriting to out/main.pdf\n\n";

#[test]
fn a_successful_cycle_finishes_at_its_status_line() {
    let mut parser = WatchParser::default();
    let events = parser.push(&format!(
        "{HEADER}[14:07:23] compiling ...\n\n{HEADER}[14:07:23] compiled successfully in 46.22 ms\n"
    ));
    assert_eq!(events.first(), Some(&ParsedEvent::Started));
    let done = finished(&events);
    assert_eq!(done.len(), 1);
    assert_eq!(done[0].0, CycleOutcome::Success);
    assert_eq!(done[0].1, Some(46));
    assert!(!parser.has_pending());
}

#[test]
fn error_cycles_wait_for_quiet_or_the_next_header() {
    let mut parser = WatchParser::default();
    let events = parser.push(&format!(
        "{HEADER}[14:07:24] compiled with errors\n\nerror: unknown variable: undefined\n  ┌─ main.typ:3:6\n  │\n3 │ Some #undefined text.\n  │       ^^^^^^^^^\n\n"
    ));
    assert!(finished(&events).is_empty());
    assert!(parser.has_pending());
    let flushed = parser.flush().expect("pending cycle");
    let ParsedEvent::Finished { outcome, log, .. } = flushed else {
        panic!("expected a finished cycle");
    };
    assert_eq!(outcome, CycleOutcome::Errors);
    assert!(log.contains("error: unknown variable: undefined"));
    assert!(log.contains("main.typ:3:6"));
    assert!(!log.contains("watching"));

    let mut parser = WatchParser::default();
    parser.push("[1] compiled with errors\n\nerror: boom\n");
    let events = parser.push(&format!("{HEADER}[2] compiling ...\n"));
    let done = finished(&events);
    assert_eq!(done.len(), 1);
    assert!(done[0].2.contains("error: boom"));
    assert_eq!(events.last(), Some(&ParsedEvent::Started));
}

#[test]
fn warning_cycles_keep_their_diagnostics() {
    let mut parser = WatchParser::default();
    parser.push(
        "[14:09:54] compiled with warnings in 6.36 ms\n\nwarning: unknown font family: nosuchfontxyz\n  ┌─ main.typ:1:16\n",
    );
    let Some(ParsedEvent::Finished {
        outcome,
        duration_ms,
        log,
    }) = parser.flush()
    else {
        panic!("expected a finished cycle");
    };
    assert_eq!(outcome, CycleOutcome::Warnings);
    assert_eq!(duration_ms, Some(6));
    assert!(log.contains("warning: unknown font family"));
}

#[test]
fn split_chunks_carriage_returns_and_escape_codes_are_normalized() {
    let mut parser = WatchParser::default();
    assert!(parser.push("\u{1b}[2J\u{1b}[1;1H[1] compi").is_empty());
    let events = parser.push("ling ...\r\n[1] compiled succ");
    assert_eq!(events, vec![ParsedEvent::Started]);
    let events = parser.push("essfully in 1.2s\r\n");
    assert_eq!(finished(&events)[0].1, Some(1200));
}

#[test]
fn status_lines_without_a_timestamp_are_still_recognized() {
    let mut parser = WatchParser::default();
    let events = parser.push("compiling ...\ncompiled successfully in 3.00ms\n");
    assert_eq!(events.first(), Some(&ParsedEvent::Started));
    assert_eq!(finished(&events)[0].1, Some(3));
}

#[test]
fn durations_parse_in_every_unit_typst_prints() {
    assert_eq!(parse_duration_ms("46.22 ms"), Some(46));
    assert_eq!(parse_duration_ms("46.22ms"), Some(46));
    assert_eq!(parse_duration_ms("1.25 s"), Some(1250));
    assert_eq!(parse_duration_ms("900 µs"), Some(1));
    assert_eq!(parse_duration_ms("900us"), Some(1));
    assert_eq!(parse_duration_ms("12 ns"), Some(0));
    assert_eq!(parse_duration_ms("soon"), None);
}

#[test]
fn cycle_logs_and_stray_text_are_bounded() {
    let mut parser = WatchParser::default();
    parser.push("[1] compiled with errors\n");
    let line = format!("{}\n", "x".repeat(1024));
    for _ in 0..(MAX_CYCLE_LOG_BYTES / 1024 + 8) {
        parser.push(&line);
    }
    let Some(ParsedEvent::Finished { log, .. }) = parser.flush() else {
        panic!("expected a finished cycle");
    };
    assert!(log.len() <= MAX_CYCLE_LOG_BYTES + LOG_TRUNCATED.len());
    assert!(log.ends_with(LOG_TRUNCATED));

    let mut parser = WatchParser::default();
    for _ in 0..64 {
        parser.push(&line);
    }
    assert!(parser.take_stray().len() <= MAX_STRAY_BYTES);
}

#[test]
fn watch_args_swap_only_the_subcommand_and_add_serve_flags_from_0_14() {
    let compile: Vec<String> = [
        "--color=never",
        "compile",
        "/p/main.typ",
        "/s/out.pdf",
        "--root",
        "/p",
        "--diagnostic-format",
        "human",
        "--input",
        "compile=yes",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    let modern = ToolchainVersion::parse("0.14.2").unwrap();
    let args = watch_args(&compile, &modern).unwrap();
    assert_eq!(args[1], "watch");
    assert_eq!(&args[2..10], &compile[2..10]);
    assert_eq!(&args[10..], ["--no-serve", "--no-reload"]);

    let old = ToolchainVersion::parse("0.13.1").unwrap();
    let args = watch_args(&compile, &old).unwrap();
    assert_eq!(args.len(), compile.len());
    assert_eq!(args[1], "watch");
    assert_eq!(args[9], "compile=yes");

    let broken: Vec<String> = vec!["--color=never".into(), "query".into()];
    assert!(watch_args(&broken, &modern).is_err());
}

fn command(program: &str, args: &[&str], variables: &[(&str, &str)]) -> WatchCommand {
    WatchCommand {
        program: PathBuf::from(program),
        args: args.iter().map(|arg| (*arg).to_owned()).collect(),
        working_dir: PathBuf::from("/p"),
        variables: variables
            .iter()
            .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
            .collect(),
    }
}

#[test]
fn target_keys_ignore_the_source_date_epoch_only() {
    let first = command(
        "/t/typst",
        &["--color=never", "watch"],
        &[("SOURCE_DATE_EPOCH", "1"), ("TYPST_PACKAGE_PATH", "/a")],
    );
    let later = command(
        "/t/typst",
        &["--color=never", "watch"],
        &[("SOURCE_DATE_EPOCH", "2"), ("TYPST_PACKAGE_PATH", "/a")],
    );
    let moved = command(
        "/t/typst",
        &["--color=never", "watch"],
        &[("SOURCE_DATE_EPOCH", "2"), ("TYPST_PACKAGE_PATH", "/b")],
    );
    assert_eq!(first.key(), later.key());
    assert_ne!(first.key(), moved.key());
    let other_binary = command("/t/other", &["--color=never", "watch"], &[]);
    assert_ne!(first.key(), other_binary.key());
}

fn pdf_bytes(marker: &str) -> Vec<u8> {
    format!("%PDF-1.7\n1 0 obj << /Type/Pages/Count 1 >> endobj\n% {marker}\n%%EOF\n").into_bytes()
}

#[test]
fn publication_copies_complete_pdfs_and_rejects_partial_ones() {
    let directory = tempfile::tempdir().unwrap();
    let staged = directory.path().join("stage/out.pdf");
    let build = directory.path().join("build/out.pdf");
    std::fs::create_dir_all(staged.parent().unwrap()).unwrap();
    let paths = PublishPaths {
        staged_pdf: staged.clone(),
        build_pdf: build.clone(),
        staged_deps: Some(directory.path().join("stage/out.deps.json")),
        build_deps: Some(directory.path().join("build/out.deps.json")),
    };

    std::fs::write(&staged, b"%PDF-1.7\n1 0 obj").unwrap();
    assert!(publish_files(&paths).is_err());
    assert!(!build.exists());

    std::fs::write(&staged, pdf_bytes("one")).unwrap();
    std::fs::write(
        directory.path().join("stage/out.deps.json"),
        "{\"inputs\":[]}",
    )
    .unwrap();
    let id = publish_files(&paths).unwrap();
    assert_eq!(std::fs::read(&build).unwrap(), pdf_bytes("one"));
    assert_eq!(
        id,
        crate::document_engine::fingerprint_compile_output(&pdf_bytes("one"))
    );
    assert!(directory.path().join("build/out.deps.json").is_file());
    let leftovers: Vec<_> = std::fs::read_dir(directory.path().join("build"))
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(leftovers.len(), 2, "{leftovers:?}");
}

#[test]
fn backoff_doubles_up_to_the_ceiling() {
    let config = WatchConfig {
        backoff: Duration::from_millis(100),
        max_backoff: Duration::from_millis(350),
        ..WatchConfig::default()
    };
    assert_eq!(config.backoff_for(1), Duration::from_millis(100));
    assert_eq!(config.backoff_for(2), Duration::from_millis(200));
    assert_eq!(config.backoff_for(3), Duration::from_millis(350));
    assert_eq!(config.backoff_for(30), Duration::from_millis(350));
}

#[cfg_attr(target_os = "windows", allow(dead_code))]
#[derive(Debug, Clone)]
enum Seen {
    Status(WatchState, Option<String>),
    Result(u64, bool, Option<u64>),
}

struct TestHost {
    seen: StdMutex<Vec<Seen>>,
    revision: AtomicU64,
}

impl TestHost {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            seen: StdMutex::new(Vec::new()),
            revision: AtomicU64::new(0),
        })
    }

    #[cfg_attr(target_os = "windows", allow(dead_code))]
    fn statuses(&self) -> Vec<WatchState> {
        self.seen
            .lock()
            .unwrap()
            .iter()
            .filter_map(|seen| match seen {
                Seen::Status(state, _) => Some(*state),
                Seen::Result(..) => None,
            })
            .collect()
    }

    #[cfg_attr(target_os = "windows", allow(dead_code))]
    fn results(&self) -> Vec<(u64, bool, Option<u64>)> {
        self.seen
            .lock()
            .unwrap()
            .iter()
            .filter_map(|seen| match seen {
                Seen::Result(cycle, ok, revision) => Some((*cycle, *ok, *revision)),
                Seen::Status(..) => None,
            })
            .collect()
    }
}

impl WatchHost for TestHost {
    fn emit_status(&self, payload: &StatusPayload) {
        self.seen
            .lock()
            .unwrap()
            .push(Seen::Status(payload.state, payload.message.clone()));
    }

    fn emit_result(&self, payload: &ResultPayload) {
        self.seen.lock().unwrap().push(Seen::Result(
            payload.cycle,
            payload.result.ok,
            payload.result.output_revision,
        ));
    }

    fn publish(&self, target: Arc<WatchTarget>) -> BoxFuture<Result<Published, String>> {
        let revision = self.revision.fetch_add(1, Ordering::SeqCst) + 1;
        Box::pin(async move {
            let output_id = publish_files(&target.publish_paths())?;
            Ok(Published {
                output_id,
                output_revision: revision,
            })
        })
    }

    fn diagnose(&self, target: Arc<WatchTarget>, log: String) -> BoxFuture<DiagnosedLog> {
        Box::pin(async move {
            crate::document_engine::typst_log_errors(
                log.clone(),
                &target.main_document,
                target.project_dir.clone(),
                target.command.working_dir.clone(),
            )
            .await
            .unwrap_or((log, Vec::new(), Vec::new()))
        })
    }
}

#[cfg_attr(target_os = "windows", allow(dead_code))]
fn fast_config() -> WatchConfig {
    WatchConfig {
        quiet: Duration::from_millis(40),
        backoff: Duration::from_millis(20),
        max_backoff: Duration::from_millis(80),
        max_failures: 3,
        stop_timeout: Duration::from_secs(2),
        grace: Duration::from_millis(400),
        wait_timeout: Duration::from_secs(20),
        ..WatchConfig::default()
    }
}

#[cfg(unix)]
mod processes {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    const FAKE_WATCH: &str = r#"#!/bin/sh
input="$3"
output="$4"
cycle() {
  printf 'watching %s\nwriting to %s\n\n[00:00:00] compiling ...\n' "$input" "$output" >&2
  if grep -q BROKEN "$input"; then
    printf '\nwatching %s\n\n[00:00:00] compiled with errors\n\nerror: unknown variable: broken\n  \342\224\214\342\224\200 main.typ:1:2\n  \342\224\202\n1 \342\224\202 #BROKEN\n  \342\224\202  ^^^^^^\n\n' "$input" >&2
  else
    printf '%%PDF-1.7\n1 0 obj << /Type/Pages/Count 1 >> endobj\n%% %s\n%%%%EOF\n' "$(cat "$input")" > "$output"
    printf '\nwatching %s\n\n[00:00:00] compiled successfully in 1.50 ms\n' "$input" >&2
  fi
}
if grep -q CRASH "$input"; then
  printf 'error: the fake watcher crashed\n' >&2
  exit 3
fi
last="$(cat "$input")"
cycle
while true; do
  sleep 0.05
  now="$(cat "$input")"
  if [ "$now" != "$last" ]; then
    last="$now"
    cycle
  fi
done
"#;

    struct Fixture {
        directory: tempfile::TempDir,
        target: WatchTarget,
    }

    impl Fixture {
        fn new(project_id: &str, source: &str) -> Self {
            let directory = tempfile::tempdir().unwrap();
            let root = directory.path().join("project");
            let staging = directory.path().join("staging");
            let build = directory.path().join("build");
            for folder in [&root, &staging, &build] {
                std::fs::create_dir_all(folder).unwrap();
            }
            let script = directory.path().join("fake-typst");
            std::fs::write(&script, FAKE_WATCH).unwrap();
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
            std::fs::write(root.join("main.typ"), source).unwrap();
            let input = root.join("main.typ");
            let staged = staging.join("out.pdf");
            let target = WatchTarget {
                project_id: project_id.to_owned(),
                main_document: "main.typ".into(),
                command: WatchCommand {
                    program: script,
                    args: vec![
                        "--color=never".into(),
                        "watch".into(),
                        input.to_string_lossy().into_owned(),
                        staged.to_string_lossy().into_owned(),
                    ],
                    working_dir: root.clone(),
                    variables: Vec::new(),
                },
                project_dir: root,
                staging_dir: staging,
                staged_pdf: staged,
                build_pdf: build.join("out.pdf"),
                staged_deps: None,
                build_deps: None,
                engine_name: "typst".into(),
                toolchain_identity: "typst 0.15.1".into(),
            };
            Self { directory, target }
        }

        fn write(&self, source: &str) {
            std::fs::write(self.target.project_dir.join("main.typ"), source).unwrap();
        }

        fn build_pdf(&self) -> Vec<u8> {
            std::fs::read(self.directory.path().join("build/out.pdf")).unwrap_or_default()
        }
    }

    async fn eventually<F: Fn() -> bool>(check: F) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !check() {
            assert!(
                Instant::now() < deadline,
                "condition was not reached in time"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    #[tokio::test]
    async fn the_fake_watcher_publishes_successes_and_reports_errors_with_locations() {
        let fixture = Fixture::new("watch-a", "= Hello\n");
        let host = TestHost::new();
        let registry = Registry::new(fast_config());
        let (session, started) = registry.ensure(host.clone(), fixture.target.clone()).await;
        assert!(started);
        let first = session.compile(false, started).await.unwrap();
        assert!(first.result.ok);
        assert_eq!(first.result.output_revision, Some(1));
        assert!(String::from_utf8_lossy(&fixture.build_pdf()).contains("= Hello"));

        fixture.write("#BROKEN\n");
        eventually(|| host.results().len() == 2).await;
        let record = session.latest().unwrap();
        assert!(!record.result.ok);
        assert!(!record.result.has_pdf);
        assert_eq!(record.result.output_revision, None);
        assert_eq!(record.result.errors[0].message, "unknown variable: broken");
        assert_eq!(record.result.errors[0].line, Some(1));
        assert_eq!(record.result.errors[0].file.as_deref(), Some("main.typ"));
        assert!(String::from_utf8_lossy(&fixture.build_pdf()).contains("= Hello"));

        fixture.write("= Fixed\n");
        eventually(|| host.results().len() == 3).await;
        let record = session.latest().unwrap();
        assert!(record.result.ok);
        assert_eq!(record.result.output_revision, Some(2));
        assert!(String::from_utf8_lossy(&fixture.build_pdf()).contains("= Fixed"));
        assert!(host.statuses().contains(&WatchState::Compiling));

        registry.stop("watch-a").await;
        eventually(|| host.statuses().last() == Some(&WatchState::Stopped)).await;
    }

    #[tokio::test]
    async fn compile_requests_wait_for_the_edit_and_fresh_ones_restart_the_process() {
        let fixture = Fixture::new("watch-b", "one\n");
        let host = TestHost::new();
        let registry = Registry::new(fast_config());
        let (session, started) = registry.ensure(host.clone(), fixture.target.clone()).await;
        session.compile(false, started).await.unwrap();

        fixture.write("two\n");
        let waited = session.compile(false, false).await.unwrap();
        assert!(String::from_utf8_lossy(&fixture.build_pdf()).contains("two"));
        assert_eq!(waited.result.output_revision, Some(2));

        let unchanged = session.compile(false, false).await.unwrap();
        assert_eq!(unchanged.id, waited.id);

        let fresh = session.compile(true, false).await.unwrap();
        assert!(fresh.generation > waited.generation);
        assert!(fresh.id > waited.id);
        assert_eq!(fresh.result.output_revision, Some(3));

        let (same, started_again) = registry.ensure(host.clone(), fixture.target.clone()).await;
        assert!(!started_again);
        assert_eq!(same.serial, session.serial);
        registry.stop("watch-b").await;
    }

    #[tokio::test]
    async fn a_changed_target_replaces_the_session_and_the_registry_is_capped() {
        let host = TestHost::new();
        let registry = Registry::new(WatchConfig {
            max_sessions: 2,
            ..fast_config()
        });
        let first = Fixture::new("watch-c", "c\n");
        let (session, _) = registry.ensure(host.clone(), first.target.clone()).await;
        let mut changed = first.target.clone();
        changed
            .command
            .variables
            .push(("TYPST_FEATURES".into(), "html".into()));
        let (replacement, started) = registry.ensure(host.clone(), changed).await;
        assert!(started);
        assert_ne!(replacement.serial, session.serial);
        assert_eq!(session.state(), WatchState::Stopped);
        let rebuilt = replacement.compile(false, true).await.unwrap();
        assert!(rebuilt.result.ok, "{}", rebuilt.result.log);

        let second = Fixture::new("watch-d", "d\n");
        let third = Fixture::new("watch-e", "e\n");
        registry.ensure(host.clone(), second.target.clone()).await;
        tokio::time::sleep(Duration::from_millis(20)).await;
        registry.ensure(host.clone(), third.target.clone()).await;
        assert_eq!(registry.len(), 2);
        assert!(registry.session("watch-c").is_none());
        eventually(|| replacement.state() == WatchState::Stopped).await;
        registry.kill_all_now();
        assert_eq!(registry.len(), 0);
    }

    #[tokio::test]
    async fn a_crashing_watcher_restarts_with_backoff_then_gives_up() {
        let fixture = Fixture::new("watch-f", "CRASH\n");
        let host = TestHost::new();
        let registry = Registry::new(fast_config());
        let (session, started) = registry.ensure(host.clone(), fixture.target.clone()).await;
        let outcome = session.compile(false, started).await;
        assert!(outcome.is_err());
        eventually(|| session.state() == WatchState::Failed).await;
        let statuses = host.statuses();
        assert_eq!(
            statuses
                .iter()
                .filter(|state| **state == WatchState::Restarting)
                .count(),
            fast_config().max_failures as usize - 1
        );
        let failure = host
            .seen
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find_map(|seen| match seen {
                Seen::Status(WatchState::Failed, message) => message.clone(),
                _ => None,
            });
        assert!(failure
            .unwrap_or_default()
            .contains("the fake watcher crashed"));
    }

    #[tokio::test]
    async fn stopping_ends_the_process_and_releases_waiters() {
        let fixture = Fixture::new("watch-g", "g\n");
        let host = TestHost::new();
        let registry = Registry::new(fast_config());
        let (session, started) = registry.ensure(host.clone(), fixture.target.clone()).await;
        session.compile(false, started).await.unwrap();
        let waiter = {
            let session = session.clone();
            tokio::spawn(async move { session.wait_after(session.latest_id()).await })
        };
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(registry.stop("watch-g").await);
        assert!(waiter.await.unwrap().is_err());
        assert_eq!(session.state(), WatchState::Stopped);
        assert!(!registry.stop("watch-g").await);
    }

    #[tokio::test]
    async fn an_idle_watcher_stops_itself() {
        let fixture = Fixture::new("watch-h", "h\n");
        let host = TestHost::new();
        let registry = Registry::new(WatchConfig {
            idle: Duration::from_secs(1),
            ..fast_config()
        });
        let (session, started) = registry.ensure(host.clone(), fixture.target.clone()).await;
        session.compile(false, started).await.unwrap();
        eventually(|| session.state() == WatchState::Idle).await;
        assert!(host.statuses().contains(&WatchState::Idle));
    }
}

fn bundled_typst() -> Option<PathBuf> {
    let target = oleafly_core::typst_toolchain::host_target()?;
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("typst-{target}{suffix}"));
    path.is_file().then_some(path)
}

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            copy_tree(&path, &to.join(entry.file_name()));
        } else {
            std::fs::copy(&path, to.join(entry.file_name())).unwrap();
        }
    }
}

#[tokio::test]
#[ignore = "runs the bundled Typst binary on a research seed"]
async fn real_typst_watch_recompiles_a_research_seed_after_each_edit() {
    let Some(typst) = bundled_typst() else {
        panic!("the bundled Typst sidecar is missing");
    };
    let seed = std::env::var("OLEAFLY_LIVE_SEED")
        .unwrap_or_else(|_| "robotics-masters-thesis-typst".into());
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../fixtures/research-seeds")
        .join(&seed);
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("project");
    copy_tree(&fixtures, &root);
    let main = ["main.typ", "thesis.typ", "paper.typ"]
        .into_iter()
        .find(|name| root.join(name).is_file())
        .unwrap_or("main.typ")
        .to_owned();
    let staging = directory.path().join("staging");
    let build = directory.path().join("build");
    std::fs::create_dir_all(&staging).unwrap();
    std::fs::create_dir_all(&build).unwrap();
    let engine = crate::document_engine::engine_for("typst", &main).unwrap();
    let spec = engine
        .compile_spec(
            &staging,
            &root,
            crate::document_engine::CompileTarget::Main {
                main_document: &main,
            },
            crate::document_engine::CompileOptions::default(),
        )
        .unwrap();
    let version = oleafly_core::typst_toolchain::bundled_typst_version().clone();
    let target = WatchTarget {
        project_id: "real-watch".into(),
        main_document: main.clone(),
        command: WatchCommand {
            program: typst,
            args: watch_args(&spec.args, &version).unwrap(),
            working_dir: spec.working_dir.clone(),
            variables: spec.environment.variables().to_vec(),
        },
        project_dir: root.clone(),
        staging_dir: staging.clone(),
        staged_pdf: spec.artifacts.pdf.clone().unwrap(),
        build_pdf: build.join("out.pdf"),
        staged_deps: None,
        build_deps: None,
        engine_name: "typst".into(),
        toolchain_identity: format!("typst {version}"),
    };
    let host = TestHost::new();
    let registry = Registry::new(WatchConfig::default());
    let started_at = Instant::now();
    let (session, started) = registry.ensure(host.clone(), target).await;
    let first = session.compile(false, started).await.unwrap();
    assert!(first.result.ok, "{}", first.result.log);
    let cold = started_at.elapsed();

    let source_path = root.join(&main);
    let original = std::fs::read_to_string(&source_path).unwrap();
    let mut samples = Vec::new();
    for round in 0..5 {
        let before = session.latest_id();
        let edited = format!("{original}\nLive preview edit {round}.\n");
        let edited_at = Instant::now();
        std::fs::write(&source_path, edited).unwrap();
        let record = session.wait_after(before).await.unwrap();
        assert!(record.result.ok, "{}", record.result.log);
        samples.push((edited_at.elapsed(), record.result.compile_time_ms));
    }
    std::fs::write(
        &source_path,
        format!("{original}\n#undefined-live-call()\n"),
    )
    .unwrap();
    let before = session.latest_id();
    let broken = session.wait_after(before).await.unwrap();
    assert!(!broken.result.ok);
    assert!(broken
        .result
        .errors
        .iter()
        .any(|error| error.kind == "error"));
    registry.stop("real-watch").await;
    eprintln!("live preview seed {seed}: first compile {cold:?}");
    for (elapsed, compile) in samples {
        eprintln!(
            "live preview seed {seed}: save to published PDF {elapsed:?} (typst {compile} ms)"
        );
    }
}
