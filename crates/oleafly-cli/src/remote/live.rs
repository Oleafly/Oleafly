mod host;

use std::collections::{BTreeSet, HashSet};
use std::future::Future;
use std::path::{Component, Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::Event;
use oleafly_collab::sync::{EndReason, LiveStatus};
use oleafly_collab::CollabError;
use oleafly_core::app_log::AppLog;
use oleafly_live::live::session::guard;
use oleafly_live::overleaf::{opening, GitBase, OverleafLive, Parts};
use oleafly_live::DiskHost;
use oleafly_online::archive::write_folder_manifest;
use oleafly_online::client::Http;
use oleafly_online::live::journal::{HolderKind, Journal, JournalError};
use oleafly_online::live::session::{Resolution, SessionConfig, SessionTuning};
use oleafly_online::projects::{list_projects, origin_record, OverleafLink};
use oleafly_online::realtime::{project, Carrier};
use oleafly_online::session::{self, Session, SessionHandle};
use oleafly_online::sync::{claim, now_seconds, SyncClaim};
use oleafly_online::{OnlineError, OnlineErrorKind};
use oleafly_secrets::SecretStore;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio::task::{JoinError, JoinHandle};

use self::host::{CliHooks, CliHost, Out, COMMAND};
use super::scope::{parse_remote_ref, project_url, resolve_scope, RemoteRef, RemoteScope};
use super::LiveArgs;
use crate::auth::online::online_error;
use crate::auth::shared::{from_online, live_elsewhere, user_agent, Env};
use crate::commands::build::{
    create_watcher, ignored_path, relevant_event, vanished_during_scan, FolderWatcher,
};
use crate::contract::printer::Printer;
use crate::contract::{
    envelope, error_envelope, event_line, exit_error, CliError, Context, ErrorKind, Exit, Outcome,
};
use crate::daemon::serve::{log_unregistered, Termination, Terminations};

const PRINT_CAPACITY: usize = 256;
const WATCH_ERRORS_TOLD: usize = 16;
const STORE_WAIT: Duration = Duration::from_secs(10);
const JOURNAL_WAIT: Duration = Duration::from_secs(10);
const START_WAIT: Duration = Duration::from_secs(60);
const WATCH_WAIT: Duration = Duration::from_secs(30);
const BASES_WAIT: Duration = Duration::from_secs(60);
const BATCH: Duration = Duration::from_millis(100);
const TICK: Duration = Duration::from_secs(1);
const REREAD_EVERY: Duration = Duration::from_secs(5);
const QUIT_WAIT: Duration = Duration::from_secs(5);
const QUIT_ON_CLOSE: Duration = Duration::from_secs(1);
const QUIT_SLACK: Duration = Duration::from_millis(500);
const IMPORT_GRACE: Duration = Duration::from_secs(1);
const IMPORT_ON_CLOSE: Duration = Duration::from_millis(500);
const PRINTER_WAIT: Duration = Duration::from_secs(1);
const IDLE_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

type Watched = notify::Result<Event>;
type SignIn = Result<Option<Session>, OnlineError>;

pub(crate) async fn run(
    ctx: &Context,
    env: &Env,
    folder: &Path,
    args: LiveArgs,
) -> Result<Outcome, CliError> {
    let log = AppLog::at(&env.data_root);
    let printer = start_printer(ctx.json(), log.clone())?;
    let out = Out::new(printer.sender(), ctx.json(), ctx.quiet());
    let mut closed: Pin<Box<dyn Future<Output = ()> + Send>> = Box::pin(printer.closed());
    let mut terminations = Terminations::register(log_unregistered);
    let started = tokio::select! {
        started = start(ctx, env, folder, &args, &out, &log) => started,
        _ = terminations.next() => Err(exit_error(Exit::Interrupted)),
    };
    let (result, reader_gone) = match started {
        Ok(mut started) => {
            let end = serve(&mut started, &mut terminations, &mut closed, &log).await;
            let reader_gone = matches!(end, End::ReaderGone);
            let result = tokio::select! {
                result = stop(started, &end, &out) => result,
                () = asked_again(&mut terminations) => std::process::exit(i32::from(Exit::Interrupted as u8)),
            };
            (result, reader_gone)
        }
        Err(error) => (Err(error), false),
    };
    close(ctx, printer, &out, &log, result, reader_gone)
}

fn insists(signal: Termination) -> bool {
    matches!(
        signal,
        Termination::Interrupt | Termination::Terminate | Termination::Break
    )
}

async fn asked_again(terminations: &mut Terminations) {
    while !insists(terminations.next().await) {}
}

fn start_printer(json: bool, log: AppLog) -> Result<Printer, CliError> {
    Printer::start(
        std::io::stdout(),
        PRINT_CAPACITY,
        move |count| {
            if json {
                event_line(COMMAND, "skipped", json!({"count": count}))
            } else if count == 1 {
                "1 line was skipped because the output couldn't keep up.".to_owned()
            } else {
                format!("{count} lines were skipped because the output couldn't keep up.")
            }
        },
        {
            let told = AtomicBool::new(false);
            move |error| {
                if !told.swap(true, Ordering::Relaxed) {
                    let _ = log.write(&format!("remote live couldn't write its output: {error}"));
                }
            }
        },
    )
    .map_err(CliError::from)
}

fn close(
    ctx: &Context,
    printer: Printer,
    out: &Out,
    log: &AppLog,
    result: Result<Value, CliError>,
    reader_gone: bool,
) -> Result<Outcome, CliError> {
    if let Err(error) = &result {
        if !reader_gone
            && matches!(
                error.kind,
                ErrorKind::Internal | ErrorKind::Io | ErrorKind::Network
            )
        {
            let _ = log.write(&format!(
                "remote live stopped with {}: {}",
                error.code, error.message
            ));
        }
    }
    let deadline = Instant::now() + PRINTER_WAIT;
    if ctx.json() {
        let warnings = ctx.warnings();
        let line = match &result {
            Ok(fields) => envelope(ctx.command(), &Outcome::success(fields.clone()), &warnings),
            Err(error) => error_envelope(Some(ctx.command()), error, &warnings),
        };
        out.last(line.to_string(), PRINTER_WAIT);
    }
    if !printer.finish(deadline.saturating_duration_since(Instant::now())) {
        let _ = log.write("remote live's output was still blocked when it stopped");
    }
    match (ctx.json(), result) {
        (false, result) => result.map(|_| Outcome::printed()),
        (true, Ok(_)) => Ok(Outcome::printed()),
        (true, Err(error)) => Ok(Outcome {
            print_envelope: false,
            ..Outcome::failure(error.exit(), Value::Null)
        }),
    }
}

fn timed_out(what: &str, within: Duration) -> CliError {
    CliError::new(
        ErrorKind::Io,
        "remote.live_timed_out",
        format!(
            "Oleafly waited {} seconds for {what} and stopped.",
            within.as_secs()
        ),
    )
    .retryable()
}

async fn blocking<T: Send + 'static>(
    within: Duration,
    what: &'static str,
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, CliError> {
    match tokio::time::timeout(within, tokio::task::spawn_blocking(work)).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(CliError::internal(format!(
            "Oleafly stopped on a bug while handling {what}: {error}"
        ))),
        Err(_) => Err(timed_out(what, within)),
    }
}

fn log_off(log: &AppLog, line: String) {
    let log = log.clone();
    tokio::task::spawn_blocking(move || {
        let _ = log.write(&line);
    });
}

pub(crate) async fn record_import(data_root: &Path, link: OverleafLink, folder: &Path) {
    let (data_root, folder) = (data_root.to_path_buf(), folder.to_path_buf());
    let log = AppLog::at(&data_root);
    let shown = folder.display().to_string();
    let recorded = blocking(BASES_WAIT, "the imported files", move || {
        let scope = resolve_scope(&folder, &data_root)?;
        let mirror = scope.live_mirror_dir(&data_root, &link)?;
        oleafly_live::overleaf::record_import_bases(&mirror, scope.root()).map_err(CliError::from)
    })
    .await
    .and_then(|recorded| recorded);
    if let Err(error) = recorded {
        log_off(
            &log,
            format!(
                "remote import couldn't keep the imported text of {shown} for live editing: {}",
                error.message
            ),
        );
    }
}

enum Wanted {
    Linked(OverleafLink),
    Fill(RemoteRef),
}

struct Plan {
    scope: RemoteScope,
    wanted: Wanted,
    git: Option<GitBase>,
    claim: SyncClaim,
}

fn not_linked() -> CliError {
    from_online(&OnlineError::new(OnlineErrorKind::SyncNotLinked)).hint(
        "Name the online project to open it live in an empty folder, or run oleafly remote link first.",
    )
}

fn folder_not_empty() -> CliError {
    CliError::new(
        ErrorKind::InvalidInput,
        "remote.folder_not_empty",
        "This folder has files and isn't linked to an online project.",
    )
    .hint("Run oleafly remote link PROJECT here first, or run oleafly remote live PROJECT in an empty folder.")
}

fn folder_is_empty(root: &Path) -> Result<bool, CliError> {
    Ok(std::fs::read_dir(root)?.all(|entry| {
        entry.is_ok_and(|entry| {
            oleafly_core::exclude::is_quietly_ignored_name(&entry.file_name().to_string_lossy())
        })
    }))
}

fn git_base(scope: &RemoteScope, data_root: &Path) -> Option<GitBase> {
    let repo = scope.sync_paths(data_root).ok()?.repo;
    let deps = super::sync::system_deps(scope.root()).ok()?;
    Some(GitBase {
        repo,
        git: deps.git,
    })
}

fn plan(
    data_root: &Path,
    store: &SecretStore,
    folder: &Path,
    project: Option<&str>,
    server: Option<&str>,
) -> Result<Plan, CliError> {
    let scope = resolve_scope(folder, data_root)?;
    scope.ensure_no_pending_restore()?;
    scope.ensure_worktree_free(data_root)?;
    scope.ensure_not_server_shared(data_root)?;
    let named = project
        .map(|project| parse_remote_ref(project, server, store))
        .transpose()?;
    let wanted = match (scope.live_link(data_root)?, named) {
        (Some(link), Some(named))
            if named.server != link.server || named.project_id != link.project_id =>
        {
            return Err(from_online(&OnlineError::new(
                OnlineErrorKind::SyncAlreadyLinked,
            )))
        }
        (Some(link), named) => {
            if let (None, Some(server)) = (named, server) {
                let server =
                    session::normalize_server(Some(server)).map_err(|error| from_online(&error))?;
                if server != link.server {
                    return Err(CliError::new(
                        ErrorKind::Usage,
                        "remote.server_mismatch",
                        format!(
                            "This folder is linked to a project on {}, not {server}.",
                            link.server
                        ),
                    ));
                }
            }
            Wanted::Linked(link)
        }
        (None, Some(named)) if folder_is_empty(scope.root())? => Wanted::Fill(named),
        (None, Some(_)) => return Err(folder_not_empty()),
        (None, None) => return Err(not_linked()),
    };
    let git = scope
        .current_link(data_root)?
        .and_then(|_| git_base(&scope, data_root));
    let claim = claim(&scope.sync_paths(data_root)?).map_err(|error| from_online(&error))?;
    Ok(Plan {
        scope,
        wanted,
        git,
        claim,
    })
}

fn signed_out(server: &str) -> CliError {
    from_online(&OnlineError::new(OnlineErrorKind::SignedOut).param("server", server))
}

async fn load_session(
    store: &SecretStore,
    server: &str,
    user_id: Option<&str>,
) -> Result<Session, CliError> {
    let (store, base, user) = (store.clone(), server.to_owned(), user_id.map(str::to_owned));
    blocking(STORE_WAIT, "your sign-in", move || {
        session::load_for(&store, &base, user.as_deref())
    })
    .await?
    .map_err(|error| online_error(error, server))?
    .ok_or_else(|| signed_out(server))
}

struct Origin {
    link: OverleafLink,
    account: Session,
    settings: project::ProjectSettings,
    record: Value,
}

async fn find_origin(
    store: &SecretStore,
    named: &RemoteRef,
    log: &AppLog,
) -> Result<Origin, CliError> {
    let server = named.server.as_str();
    load_session(store, server, None).await?;
    let http = Http::new(server, &user_agent()).map_err(|error| online_error(error, server))?;
    let (account, projects) = list_projects(&http, store, None)
        .await
        .map_err(|error| online_error(error, server))?;
    let remote = projects
        .into_iter()
        .find(|remote| remote.id == named.project_id)
        .ok_or_else(|| {
            online_error(
                OnlineError::new(OnlineErrorKind::ProjectUnavailable),
                server,
            )
        })?;
    let settings = match project::fetch_project(&http, &account.cookie, &remote.id).await {
        Ok(fetched) => project::settings_from_project(&fetched),
        Err(error) => {
            log_off(
                log,
                format!(
                    "remote live couldn't read the settings of project {} on {server}: {error}",
                    remote.id
                ),
            );
            project::ProjectSettings::default()
        }
    };
    let record = origin_record(&http.base, &remote, &settings, &account, now_seconds());
    Ok(Origin {
        link: OverleafLink {
            server: named.server.clone(),
            project_id: remote.id,
            user_id: Some(account.user_id.clone()),
        },
        account,
        settings,
        record,
    })
}

struct Opened {
    journal: Journal,
    key: String,
    mirror: PathBuf,
    fill: bool,
    was_paused: bool,
}

fn journal_error(error: JournalError) -> CliError {
    match error {
        JournalError::LiveElsewhere(holder) => live_elsewhere(holder.as_ref()),
        other => from_online(&OnlineError::from(other)),
    }
}

fn open_journal(
    data_root: &Path,
    link: &OverleafLink,
    scope: &RemoteScope,
    fresh: bool,
) -> Result<Opened, CliError> {
    let key = scope.live_key()?;
    let mirror = scope.live_mirror_dir(data_root, link)?;
    if fresh {
        opening::mark(&mirror)?;
    }
    let fill = opening::marked(&mirror);
    let mut journal = Journal::open_live(
        data_root,
        &link.server,
        &link.project_id,
        scope.root(),
        HolderKind::Cli,
    )
    .map_err(journal_error)?;
    let was_paused = journal.manifest().paused;
    if was_paused {
        let mut manifest = journal.manifest().clone();
        manifest.paused = false;
        journal.set_manifest(manifest);
        journal
            .flush()
            .map_err(|error| CliError::new(ErrorKind::Io, "io.failed", error))?;
    }
    Ok(Opened {
        journal,
        key,
        mirror,
        fill,
        was_paused,
    })
}

fn start_error(error: &CollabError, server: &str) -> CliError {
    let online =
        |kind: OnlineErrorKind| from_online(&OnlineError::new(kind).param("server", server));
    match error {
        CollabError::Api { status: 401, .. } => signed_out(server),
        CollabError::Api { status: 403, .. } => ended(EndReason::AccessEnded, server),
        CollabError::Api { status: 429, .. } => online(OnlineErrorKind::RateLimited),
        CollabError::Api { status: 503, .. } | CollabError::Network(_) => {
            online(OnlineErrorKind::Unreachable)
        }
        other => CliError::new(
            ErrorKind::Internal,
            "remote.live_failed",
            "Live editing couldn't start.",
        )
        .details(json!({"cause": other.to_string()})),
    }
}

fn ended(reason: EndReason, server: &str) -> CliError {
    match reason {
        EndReason::Stopped | EndReason::SignedOut => signed_out(server),
        EndReason::AccessEnded | EndReason::AccountSuspended => CliError::new(
            ErrorKind::Auth,
            "remote.live_access_ended",
            "You no longer have access to this project.",
        ),
        EndReason::Removed => CliError::new(
            ErrorKind::Auth,
            "remote.live_removed",
            "You were removed from this project.",
        ),
        EndReason::ProjectDeleted | EndReason::Archived => CliError::new(
            ErrorKind::InvalidInput,
            "remote.live_project_gone",
            "The online project was deleted or moved to the trash.",
        ),
        EndReason::ClientTooOld | EndReason::ServerTooOld | EndReason::ServerChanged => {
            CliError::new(
                ErrorKind::MissingTool,
                "remote.live_unsupported",
                "This version of Oleafly can't edit this project live.",
            )
            .hint("Update Oleafly, then try again.")
        }
        EndReason::Failed | EndReason::EngineSpent => CliError::new(
            ErrorKind::Internal,
            "remote.live_failed",
            "Live editing stopped on an error. The app log has the details.",
        ),
    }
}

struct Started {
    live: Arc<OverleafLive>,
    hooks: Arc<CliHooks>,
    host: Arc<CliHost>,
    watcher: FolderWatcher,
    events: mpsc::UnboundedReceiver<Watched>,
    imports: Imports,
    link: OverleafLink,
    store: SecretStore,
    handle: SessionHandle,
}

async fn start(
    ctx: &Context,
    env: &Env,
    folder: &Path,
    args: &LiveArgs,
    out: &Out,
    log: &AppLog,
) -> Result<Started, CliError> {
    let (data, store) = (env.data_root.clone(), env.store.clone());
    let Plan {
        scope,
        wanted,
        git,
        claim,
    } = {
        let (data, store, folder) = (data.clone(), store.clone(), folder.to_path_buf());
        let (project, server) = (args.target.clone(), args.server.clone());
        blocking(STORE_WAIT, "this folder's link", move || {
            plan(
                &data,
                &store,
                &folder,
                project.as_deref(),
                server.as_deref(),
            )
        })
        .await??
    };
    let (link, origin) = match wanted {
        Wanted::Linked(link) => (link, None),
        Wanted::Fill(named) => {
            let origin = tokio::time::timeout(START_WAIT, find_origin(&store, &named, log))
                .await
                .map_err(|_| timed_out("the online project", START_WAIT))??;
            (origin.link.clone(), Some(origin))
        }
    };
    let Opened {
        journal,
        key,
        mirror,
        fill,
        was_paused,
    } = {
        let (data, link, scope) = (data.clone(), link.clone(), scope.clone());
        let fresh = origin.is_some();
        blocking(JOURNAL_WAIT, "the live editing state", move || {
            open_journal(&data, &link, &scope, fresh)
        })
        .await??
    };
    drop(claim);
    let stored = match origin {
        Some(Origin {
            account,
            settings,
            record,
            ..
        }) => {
            let folder = scope.root().to_path_buf();
            blocking(STORE_WAIT, "project.json", move || {
                write_folder_manifest(&folder, &settings, record)
            })
            .await?
            .map_err(|error| online_error(error, &link.server))?;
            account
        }
        None => load_session(&store, &link.server, link.user_id.as_deref()).await?,
    };
    let http = Http::new(&link.server, &user_agent())
        .map_err(|error| online_error(error, &link.server))?;
    let handle = SessionHandle::new(&link.server, stored, Some(store.clone()));
    let host = Arc::new(CliHost::new(out.clone()));
    let root = scope.root().to_path_buf();
    let parts = Parts {
        project_id: key,
        root: root.clone(),
        mirror_dir: mirror,
        host: Arc::clone(&host) as Arc<dyn DiskHost>,
        link: link.clone(),
        config: SessionConfig {
            http,
            session: handle.clone(),
            project_id: link.project_id.clone(),
            carriers: vec![Carrier::WebSocket, Carrier::XhrPolling],
            tuning: SessionTuning {
                idle_after: IDLE_AFTER,
                ..SessionTuning::default()
            },
            seeds: Vec::new(),
            fill,
        },
        journal,
        git,
        runtime: tokio::runtime::Handle::current(),
        log: log.clone(),
    };
    let hooks_out = out.clone();
    let (live, hooks) = tokio::time::timeout(
        START_WAIT,
        OverleafLive::start_with(parts, move |mirror| {
            Arc::new(CliHooks::new(hooks_out, mirror))
        }),
    )
    .await
    .map_err(|_| timed_out("the online project", START_WAIT))?
    .map_err(|error| start_error(&error, &link.server))?;
    live.set_focused(false);
    host.know(live.members());
    let (sender, events) = mpsc::unbounded_channel();
    let watcher = {
        let root = root.clone();
        blocking(WATCH_WAIT, "the file watcher", move || {
            create_watcher(&root, sender)
        })
        .await??
    };
    if let Some(warning) = watcher.fallback_warning() {
        ctx.warn("watch.polling", warning);
    }
    let url = project_url(&link.server, &link.project_id);
    let role = live.mirror.role().map(|(role, _)| role);
    out.emit(
        "live_started",
        json!({
            "server": link.server,
            "remoteId": link.project_id,
            "url": url,
            "folder": root,
            "scope": scope.kind(),
            "email": handle.email(),
            "role": role,
            "filling": fill,
            "wasPaused": was_paused,
            "warnings": ctx.warnings(),
        }),
        || {
            let started = format!(
                "Editing {} live with {url}. Press Ctrl+C to stop.",
                root.display()
            );
            if was_paused {
                format!("{started}\nLive editing was paused in the app. It runs here now.")
            } else {
                started
            }
        },
    );
    let imports = Imports::new(Arc::clone(&live), root, log.clone());
    Ok(Started {
        live,
        hooks,
        host,
        watcher,
        events,
        imports,
        link,
        store,
        handle,
    })
}

enum Changes {
    All,
    Events(Vec<Watched>),
}

impl Changes {
    fn merge(self, other: Changes) -> Changes {
        match (self, other) {
            (Changes::Events(mut first), Changes::Events(second)) => {
                first.extend(second);
                Changes::Events(first)
            }
            _ => Changes::All,
        }
    }
}

fn relative_path(root: &Path, path: &Path) -> Option<String> {
    let names: Vec<&str> = path
        .strip_prefix(root)
        .ok()?
        .components()
        .map(|component| match component {
            Component::Normal(name) => name.to_str(),
            _ => None,
        })
        .collect::<Option<_>>()?;
    (!names.is_empty()).then(|| names.join("/"))
}

fn changed_paths(
    root: &Path,
    events: Vec<Watched>,
    told: &Mutex<HashSet<String>>,
    log: &AppLog,
) -> Option<Vec<String>> {
    let mut paths = BTreeSet::new();
    for event in events {
        let event = match event {
            Ok(event) => event,
            Err(error) if vanished_during_scan(&error, root) => continue,
            Err(error) => {
                let message = error.to_string();
                let fresh = {
                    let mut told = guard(told);
                    told.len() < WATCH_ERRORS_TOLD && told.insert(message.clone())
                };
                if fresh {
                    let _ = log.write(&format!(
                        "remote live's watch of {} reported: {message}",
                        root.display()
                    ));
                }
                let missed: Option<Vec<String>> = error
                    .paths
                    .iter()
                    .filter(|path| !ignored_path(path, root))
                    .map(|path| relative_path(root, path))
                    .collect();
                match missed {
                    Some(missed) if !error.paths.is_empty() => paths.extend(missed),
                    _ => return None,
                }
                continue;
            }
        };
        if event.need_rescan() || event.paths.is_empty() {
            return None;
        }
        if !relevant_event(&event, root, None) {
            continue;
        }
        for path in &event.paths {
            if ignored_path(path, root) || oleafly_core::own_writes::is_own(path) {
                continue;
            }
            if let Some(relative) = relative_path(root, path) {
                paths.insert(relative);
            }
        }
    }
    Some(paths.into_iter().collect())
}

struct Imports {
    live: Arc<OverleafLive>,
    root: PathBuf,
    log: AppLog,
    told: Arc<Mutex<HashSet<String>>>,
    reading: Arc<Mutex<Vec<String>>>,
    running: Option<JoinHandle<()>>,
    queued: Option<Changes>,
}

impl Imports {
    fn new(live: Arc<OverleafLive>, root: PathBuf, log: AppLog) -> Imports {
        Imports {
            live,
            root,
            log,
            told: Arc::default(),
            reading: Arc::default(),
            running: None,
            queued: None,
        }
    }

    fn want(&mut self, changes: Changes) {
        let changes = match self.queued.take() {
            Some(queued) => queued.merge(changes),
            None => changes,
        };
        if self.running.is_some() {
            self.queued = Some(changes);
        } else {
            self.running = Some(self.spawn(changes));
        }
    }

    fn spawn(&self, changes: Changes) -> JoinHandle<()> {
        let (live, root, log) = (Arc::clone(&self.live), self.root.clone(), self.log.clone());
        let (told, reading) = (Arc::clone(&self.told), Arc::clone(&self.reading));
        tokio::spawn(async move {
            let only = match changes {
                Changes::All => None,
                Changes::Events(events) => {
                    let (folder, watch_log) = (root.clone(), log.clone());
                    match tokio::task::spawn_blocking(move || {
                        changed_paths(&folder, events, &told, &watch_log)
                    })
                    .await
                    {
                        Ok(Some(paths)) if paths.is_empty() => return,
                        Ok(paths) => paths,
                        Err(error) => {
                            log_off(
                                &log,
                                format!("remote live couldn't read the folder's changes: {error}"),
                            );
                            return;
                        }
                    }
                }
            };
            *guard(&reading) = only.clone().unwrap_or_default();
            if let Err(error) = live.import_paths(only).await {
                log_off(
                    &log,
                    format!(
                        "remote live couldn't send the changes in {}: {error}",
                        root.display()
                    ),
                );
            }
            guard(&reading).clear();
        })
    }

    async fn settled(&mut self) -> Result<(), JoinError> {
        match self.running.as_mut() {
            Some(running) => running.await,
            None => std::future::pending().await,
        }
    }

    fn advance(&mut self, joined: Result<(), JoinError>) {
        self.running = None;
        self.joined(joined);
        if let Some(queued) = self.queued.take() {
            self.running = Some(self.spawn(queued));
        }
    }

    fn joined(&self, joined: Result<(), JoinError>) {
        if let Err(error) = joined {
            log_off(
                &self.log,
                format!(
                    "remote live stopped reading the changes in {}: {error}",
                    self.root.display()
                ),
            );
        }
    }

    async fn ended(&self, mut task: JoinHandle<()>, deadline: tokio::time::Instant) -> bool {
        match tokio::time::timeout_at(deadline, &mut task).await {
            Ok(joined) => {
                self.joined(joined);
                true
            }
            Err(_) => {
                task.abort();
                false
            }
        }
    }

    async fn finish(&mut self, within: Duration) -> Vec<String> {
        let deadline = tokio::time::Instant::now() + within;
        let mut done = match self.running.take() {
            Some(running) => self.ended(running, deadline).await,
            None => true,
        };
        if let (true, Some(queued)) = (done, self.queued.take()) {
            done = self.ended(self.spawn(queued), deadline).await;
        }
        if done {
            return Vec::new();
        }
        log_off(
            &self.log,
            format!(
                "remote live stopped before it read every change in {} within {} ms. The next start sends them.",
                self.root.display(),
                within.as_millis()
            ),
        );
        std::mem::take(&mut *guard(&self.reading))
    }
}

#[derive(Default)]
struct Rereads {
    signed_out: bool,
    last: Option<Instant>,
    reading: Option<(Instant, JoinHandle<SignIn>)>,
    tried: Option<String>,
    slow_told: bool,
    failed_told: bool,
}

impl Rereads {
    fn status(&mut self, status: &LiveStatus) {
        self.signed_out = *status == LiveStatus::SignedOut;
    }

    fn due(&mut self, link: &OverleafLink, store: &SecretStore, log: &AppLog) {
        if let Some((since, _)) = &self.reading {
            if since.elapsed() >= STORE_WAIT && !self.slow_told {
                self.slow_told = true;
                log_off(
                    log,
                    format!(
                        "remote live is still reading the sign-in for {} after {} s",
                        link.server,
                        STORE_WAIT.as_secs()
                    ),
                );
            }
            return;
        }
        if !self.signed_out || self.last.is_some_and(|last| last.elapsed() < REREAD_EVERY) {
            return;
        }
        self.last = Some(Instant::now());
        let (store, server, user) = (store.clone(), link.server.clone(), link.user_id.clone());
        let reading = tokio::task::spawn_blocking(move || {
            session::load_for(&store, &server, user.as_deref())
        });
        self.reading = Some((Instant::now(), reading));
    }

    async fn finished(&mut self) -> Option<Result<Option<Session>, String>> {
        let (_, reading) = self.reading.as_mut()?;
        let read = reading.await;
        self.reading = None;
        Some(match read {
            Ok(Ok(found)) => Ok(found),
            Ok(Err(error)) => Err(error.to_string()),
            Err(error) => Err(error.to_string()),
        })
    }

    fn fresh(
        &mut self,
        read: Result<Option<Session>, String>,
        current: &SessionHandle,
        log: &AppLog,
    ) -> Option<Session> {
        let found = match read {
            Ok(found) => found?,
            Err(error) => {
                if !self.failed_told {
                    self.failed_told = true;
                    log_off(
                        log,
                        format!("remote live couldn't read the saved sign-in: {error}"),
                    );
                }
                return None;
            }
        };
        if found.cookie == current.cookie() || self.tried.as_deref() == Some(&found.cookie) {
            return None;
        }
        self.tried = Some(found.cookie.clone());
        Some(found)
    }
}

enum End {
    Signal(Termination),
    Ended(EndReason),
    ReaderGone,
    WatchStopped,
}

fn status_of(live: &OverleafLive) -> LiveStatus {
    guard(&live.mirror.status).0.clone()
}

fn online_wins(live: &Arc<OverleafLive>, paths: Vec<String>, log: &AppLog) {
    if paths.is_empty() {
        return;
    }
    let (live, log) = (Arc::clone(live), log.clone());
    tokio::task::spawn_blocking(move || {
        for path in paths {
            let kept = live
                .resolve(&path, Resolution::Theirs)
                .or_else(|_| live.keep_copy(&path));
            if let Err(error) = kept {
                let _ = log.write(&format!(
                    "remote live couldn't keep a copy of {path} in project {}: {error}",
                    live.project_id()
                ));
            }
        }
    });
}

fn keep_online(live: &Arc<OverleafLive>, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    let live = Arc::clone(live);
    tokio::task::spawn_blocking(move || live.decide_deletes(&paths, false));
}

fn owed(started: &Started, rereads: &mut Rereads, log: &AppLog) -> Option<EndReason> {
    let work = started.host.work();
    online_wins(&started.live, work.reviews, log);
    keep_online(&started.live, work.deletes);
    if work.members {
        started.host.know(started.live.members());
    }
    match work.status? {
        LiveStatus::Ended { reason } => Some(reason),
        status => {
            rereads.status(&status);
            None
        }
    }
}

async fn batch_due(due: Option<tokio::time::Instant>) {
    match due {
        Some(at) => tokio::time::sleep_until(at).await,
        None => std::future::pending().await,
    }
}

async fn serve(
    started: &mut Started,
    terminations: &mut Terminations,
    closed: &mut Pin<Box<dyn Future<Output = ()> + Send>>,
    log: &AppLog,
) -> End {
    started.imports.want(Changes::All);
    let mut batch: Vec<Watched> = Vec::new();
    let mut due: Option<tokio::time::Instant> = None;
    let mut tick = tokio::time::interval(TICK);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut rereads = Rereads::default();
    let host = Arc::clone(&started.host);
    let end = loop {
        tokio::select! {
            signal = terminations.next() => break End::Signal(signal),
            () = closed.as_mut() => break End::ReaderGone,
            event = started.events.recv() => {
                let Some(event) = event else {
                    break End::WatchStopped;
                };
                batch.push(event);
                due.get_or_insert_with(|| tokio::time::Instant::now() + BATCH);
            }
            () = batch_due(due), if due.is_some() => {
                due = None;
                started.imports.want(Changes::Events(std::mem::take(&mut batch)));
            }
            () = host.woken() => {
                if let Some(reason) = owed(started, &mut rereads, log) {
                    break End::Ended(reason);
                }
            }
            joined = started.imports.settled() => started.imports.advance(joined),
            Some(read) = rereads.finished(), if rereads.reading.is_some() => {
                if let Some(found) = rereads.fresh(read, &started.handle, log) {
                    let fresh = SessionHandle::new(&started.link.server, found, Some(started.store.clone()));
                    started.handle = fresh.clone();
                    started.live.session.signed_in(fresh);
                }
            }
            _ = tick.tick() => {
                if let Some(reason) = owed(started, &mut rereads, log) {
                    break End::Ended(reason);
                }
                let status = status_of(&started.live);
                if let LiveStatus::Ended { reason } = status {
                    break End::Ended(reason);
                }
                rereads.status(&status);
                rereads.due(&started.link, &started.store, log);
            }
        }
    };
    if !batch.is_empty() {
        started.imports.want(Changes::Events(batch));
    }
    end
}

fn waits(end: &End) -> (Duration, Duration) {
    match end {
        End::Signal(Termination::Close | Termination::Logoff | Termination::Shutdown) => {
            (IMPORT_ON_CLOSE, QUIT_ON_CLOSE)
        }
        _ => (IMPORT_GRACE, QUIT_WAIT),
    }
}

fn stopped_line(unsent: &[String]) -> String {
    if unsent.is_empty() {
        return "Stopped.".to_owned();
    }
    format!(
        "Stopped. {} not sent yet: {}. Live editing sends what's left the next time it starts.",
        super::sync::files(unsent.len()),
        super::sync::listed(unsent)
    )
}

async fn stop(started: Started, end: &End, out: &Out) -> Result<Value, CliError> {
    let Started {
        live,
        hooks,
        host,
        watcher,
        mut events,
        mut imports,
        link,
        ..
    } = started;
    tokio::task::spawn_blocking(move || drop(watcher));
    let late: Vec<Watched> = std::iter::from_fn(|| events.try_recv().ok()).collect();
    drop(events);
    if !late.is_empty() {
        imports.want(Changes::Events(late));
    }
    let (grace, within) = waits(end);
    let cut = imports.finish(grace).await;
    drop(imports);
    let _ = tokio::time::timeout(within + QUIT_SLACK, live.quit(within)).await;
    let mut unsent: BTreeSet<String> = live
        .session
        .unsent(Duration::ZERO)
        .await
        .into_iter()
        .map(|doc| doc.path)
        .collect();
    unsent.extend(cut);
    let unsent: Vec<String> = unsent.into_iter().collect();
    out.emit("stopped", json!({"unsent": unsent}), || {
        stopped_line(&unsent)
    });
    drop((hooks, host, live));
    match end {
        End::Signal(_) | End::Ended(EndReason::Stopped) => {
            Ok(json!({"stopped": true, "unsent": unsent}))
        }
        End::ReaderGone => Err(CliError::new(
            ErrorKind::Io,
            "io.failed",
            "The output was closed.",
        )),
        End::WatchStopped => Err(CliError::new(
            ErrorKind::Io,
            "watch.stopped",
            "The file watcher stopped unexpectedly.",
        )),
        End::Ended(reason) => Err(ended(*reason, &link.server)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn end_reasons_map_to_exit_codes() {
        let server = "https://latex.example.edu";
        for (reason, exit) in [
            (EndReason::SignedOut, Exit::Auth),
            (EndReason::AccessEnded, Exit::Auth),
            (EndReason::AccountSuspended, Exit::Auth),
            (EndReason::Removed, Exit::Auth),
            (EndReason::ProjectDeleted, Exit::Project),
            (EndReason::Archived, Exit::Project),
            (EndReason::ClientTooOld, Exit::Environment),
            (EndReason::ServerTooOld, Exit::Environment),
            (EndReason::Failed, Exit::Internal),
            (EndReason::EngineSpent, Exit::Internal),
        ] {
            assert_eq!(ended(reason, server).exit(), exit, "{reason:?}");
        }
        assert_eq!(
            ended(EndReason::SignedOut, server).code,
            "online.signed_out"
        );
        let api = |status: u16| CollabError::Api {
            status,
            code: String::new(),
            message: String::new(),
        };
        for (status, exit) in [
            (401, Exit::Auth),
            (403, Exit::Auth),
            (429, Exit::Network),
            (503, Exit::Network),
            (500, Exit::Internal),
        ] {
            assert_eq!(start_error(&api(status), server).exit(), exit, "{status}");
        }
        assert_eq!(
            start_error(&CollabError::Network("refused".into()), server).exit(),
            Exit::Network
        );
        assert_eq!(
            journal_error(JournalError::LiveElsewhere(None)).exit(),
            Exit::Conflict
        );
        assert_eq!(journal_error(JournalError::Busy).exit(), Exit::Conflict);
    }

    #[test]
    fn folder_events_become_project_paths_without_own_writes_or_build_folders() {
        use notify::event::{ModifyKind, RenameMode};
        let dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        let logs = tempfile::tempdir().unwrap();
        let log = AppLog::at(logs.path());
        std::fs::create_dir_all(root.join("sections")).unwrap();
        std::fs::write(root.join("sections/intro.tex"), "Intro\n").unwrap();
        std::fs::write(root.join("main.tex"), "Main\n").unwrap();
        oleafly_core::own_writes::note_write(&root.join("main.tex"));
        let modified = |path: PathBuf| {
            Ok(Event::new(notify::EventKind::Modify(ModifyKind::Data(
                notify::event::DataChange::Content,
            )))
            .add_path(path))
        };
        let told = Mutex::new(HashSet::new());
        let changed = |events: Vec<Watched>| changed_paths(&root, events, &told, &log);
        let events = vec![
            modified(root.join("sections/intro.tex")),
            modified(root.join("main.tex")),
            modified(root.join("node_modules/x.js")),
        ];
        assert_eq!(changed(events), Some(vec!["sections/intro.tex".to_owned()]));
        let renamed = |mode: RenameMode, path: PathBuf| {
            Ok(Event::new(notify::EventKind::Modify(ModifyKind::Name(mode))).add_path(path))
        };
        assert_eq!(
            changed(vec![
                renamed(RenameMode::Any, root.join("chapters")),
                renamed(RenameMode::Any, root.join("sections")),
            ]),
            Some(vec!["chapters".to_owned(), "sections".to_owned()])
        );
        assert_eq!(
            changed(vec![renamed(RenameMode::To, root.join("sections"))]),
            Some(vec!["sections".to_owned()])
        );
        let rescan = Event::new(notify::EventKind::Other)
            .set_flag(notify::event::Flag::Rescan)
            .add_path(root.clone());
        assert_eq!(changed(vec![Ok(rescan)]), None);
        assert_eq!(changed(vec![Err(notify::Error::generic("lost"))]), None);
        let vanished = notify::Error::io(std::io::Error::from(std::io::ErrorKind::NotFound))
            .add_path(root.join("gone.tex"));
        assert_eq!(changed(vec![Err(vanished)]), Some(Vec::new()));
        assert_eq!(relative_path(&root, &root), None);
        let refused = |path: PathBuf| {
            Err(
                notify::Error::io(std::io::Error::from(std::io::ErrorKind::PermissionDenied))
                    .add_path(path),
            )
        };
        assert_eq!(
            changed(vec![refused(root.join("node_modules/locked"))]),
            Some(Vec::new())
        );
        for _ in 0..3 {
            assert_eq!(
                changed(vec![refused(root.join("sections"))]),
                Some(vec!["sections".to_owned()])
            );
        }
        assert_eq!(changed(vec![refused(root.clone())]), None);
        let logged = log.read(64 * 1024).unwrap();
        assert_eq!(logged.matches("reported:").count(), 4, "{logged}");
    }

    #[test]
    fn only_a_second_interrupt_terminate_or_break_quits_at_once() {
        for signal in [
            Termination::Interrupt,
            Termination::Terminate,
            Termination::Break,
        ] {
            assert!(insists(signal), "{signal:?}");
        }
        for signal in [
            Termination::Hangup,
            Termination::Close,
            Termination::Logoff,
            Termination::Shutdown,
        ] {
            assert!(!insists(signal), "{signal:?}");
        }
    }

    #[test]
    fn a_start_on_a_project_paused_in_the_app_clears_the_pause() {
        use oleafly_online::live::journal::{manifest_of, ProjectManifest};
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let root = dir.path().join("paper");
        std::fs::create_dir_all(&root).unwrap();
        let scope = RemoteScope::Folder {
            root: dunce::canonicalize(&root).unwrap(),
        };
        let link = OverleafLink {
            server: "https://latex.example.edu".into(),
            project_id: "64a1f0".into(),
            user_id: None,
        };
        let mut app = Journal::open(&data, &link.server, &link.project_id, None).unwrap();
        app.set_manifest(ProjectManifest {
            paused: true,
            ..ProjectManifest::default()
        });
        app.flush().unwrap();
        drop(app);
        let opened = open_journal(&data, &link, &scope, false).unwrap();
        assert!(opened.was_paused && !opened.fill);
        assert_eq!(opened.key, scope.live_key().unwrap());
        let paused = |data: &Path| {
            manifest_of(data, &link.server, &link.project_id).map(|manifest| manifest.paused)
        };
        assert_eq!(paused(&data), Some(false));
        drop(opened);
        let again = open_journal(&data, &link, &scope, true).unwrap();
        assert!(!again.was_paused && again.fill);
        assert!(opening::marked(&again.mirror));
    }

    #[test]
    fn an_empty_folder_may_hold_only_what_oleafly_and_the_system_leave_there() {
        let dir = tempfile::tempdir().unwrap();
        assert!(folder_is_empty(dir.path()).unwrap());
        std::fs::create_dir_all(dir.path().join(".oleafly/online")).unwrap();
        std::fs::write(dir.path().join(".DS_Store"), "").unwrap();
        assert!(folder_is_empty(dir.path()).unwrap());
        std::fs::write(dir.path().join("main.tex"), "x").unwrap();
        assert!(!folder_is_empty(dir.path()).unwrap());
    }
}
