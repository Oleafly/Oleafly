use crate::collab::guard::{MassChangeGuard, SyncPauseHost, SyncResumed};
use notify::event::ModifyKind;
use notify::{Config, Event, EventKind, PollWatcher, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime};

pub(crate) const FOLDER_CHANGED_EVENT: &str = "project-folder-changed";
pub(crate) const DEBOUNCE: Duration = Duration::from_millis(300);
const MAX_LATENCY: Duration = Duration::from_millis(1_500);
const NETWORK_POLL_INTERVAL: Duration = Duration::from_secs(3);
const MAX_BATCH_PATHS: usize = 256;
const OWN_WRITE_WINDOW: Duration = Duration::from_secs(10);
const MAX_OWN_WRITES: usize = 512;
const ROOT_POLL: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderChange {
    pub project_id: String,
    pub paths: Vec<String>,
    pub rescan: bool,
    pub structural: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub renamed: Vec<(String, String)>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub deleted: Vec<String>,
}

pub(crate) type ChangeSink = Arc<dyn Fn(FolderChange) + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WatchMode {
    Native,
    Poll(Duration),
}

struct ActiveWatch {
    project_id: String,
    token: u64,
    _watcher: Box<dyn Watcher + Send>,
}

struct Hub {
    active: Option<ActiveWatch>,
    latest_request: u64,
}

static HUB: Mutex<Hub> = Mutex::new(Hub {
    active: None,
    latest_request: 0,
});

fn hub() -> std::sync::MutexGuard<'static, Hub> {
    HUB.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Fingerprint {
    len: u64,
    modified: Option<SystemTime>,
    identity: u64,
}

struct OwnWrite {
    path: PathBuf,
    fingerprint: Option<Fingerprint>,
    at: Instant,
}

static OWN_WRITES: Mutex<Vec<OwnWrite>> = Mutex::new(Vec::new());

fn own_writes() -> std::sync::MutexGuard<'static, Vec<OwnWrite>> {
    OWN_WRITES.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(unix)]
fn file_identity(metadata: &std::fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt as _;
    metadata.ino()
}

#[cfg(not(unix))]
fn file_identity(_metadata: &std::fs::Metadata) -> u64 {
    0
}

fn fingerprint(path: &Path) -> Option<Fingerprint> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    metadata.is_file().then(|| Fingerprint {
        len: metadata.len(),
        modified: metadata.modified().ok(),
        identity: file_identity(&metadata),
    })
}

pub(crate) fn note_own_write(path: &Path) {
    let Some(fingerprint) = fingerprint(path) else {
        return;
    };
    remember_own_change(path, Some(fingerprint));
}

pub(crate) fn note_own_removal(path: &Path) {
    remember_own_change(path, None);
}

fn remember_own_change(path: &Path, fingerprint: Option<Fingerprint>) {
    let now = Instant::now();
    let mut writes = own_writes();
    writes.retain(|write| now.duration_since(write.at) < OWN_WRITE_WINDOW && write.path != path);
    if writes.len() >= MAX_OWN_WRITES {
        writes.remove(0);
    }
    writes.push(OwnWrite {
        path: path.to_path_buf(),
        fingerprint,
        at: now,
    });
}

pub(crate) fn is_own_write(path: &Path) -> bool {
    let now = Instant::now();
    let mut writes = own_writes();
    writes.retain(|write| now.duration_since(write.at) < OWN_WRITE_WINDOW);
    writes
        .iter()
        .find(|write| write.path == path)
        .is_some_and(|write| {
            fingerprint(path) == write.fingerprint
                && !(write.fingerprint.is_none() && path.exists())
        })
}

fn is_structural(kind: &EventKind) -> bool {
    !matches!(
        kind,
        EventKind::Modify(ModifyKind::Data(_) | ModifyKind::Metadata(_) | ModifyKind::Any)
    )
}

pub(crate) fn relevant_path(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let names: Vec<&str> = relative
        .components()
        .map(|component| component.as_os_str().to_str())
        .collect::<Option<_>>()?;
    let (last, folders) = names.split_last()?;
    if folders
        .iter()
        .any(|folder| oleafly_core::is_skipped_scan_directory(std::ffi::OsStr::new(folder)))
        || folders.first() == Some(&crate::typst_packages::VENDOR_DIR)
    {
        return None;
    }
    if last.eq_ignore_ascii_case(".git")
        || last.eq_ignore_ascii_case(".DS_Store")
        || crate::checkpoint_capture::is_oleafly_owned(last)
        || is_replace_file_scratch(last)
    {
        return None;
    }
    Some(names.join("/"))
}

fn is_replace_file_scratch(name: &str) -> bool {
    let Some((stem, suffix)) = name.rsplit_once("~RF").or_else(|| name.rsplit_once("~rf")) else {
        return false;
    };
    let Some(hex) = suffix
        .strip_suffix(".TMP")
        .or_else(|| suffix.strip_suffix(".tmp"))
    else {
        return false;
    };
    !stem.is_empty()
        && !hex.is_empty()
        && hex.chars().all(|character| character.is_ascii_hexdigit())
}

fn vanished_during_scan(root: &Path, error: &notify::Error) -> bool {
    let not_found = matches!(&error.kind, notify::ErrorKind::Io(io) if io.kind() == std::io::ErrorKind::NotFound);
    not_found
        && !error.paths.is_empty()
        && error
            .paths
            .iter()
            .all(|path| path != root && path.starts_with(root))
}

#[derive(Default)]
pub(crate) struct Batch {
    paths: BTreeMap<String, bool>,
    rescan: bool,
    root_changed: bool,
    first: Option<Instant>,
    last: Option<Instant>,
}

impl Batch {
    pub(crate) fn absorb(&mut self, root: &Path, event: &Event, now: Instant) {
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        let mut touched = event.need_rescan();
        self.rescan |= event.need_rescan();
        let structural = is_structural(&event.kind);
        for path in &event.paths {
            if path == root || root.starts_with(path) {
                self.root_changed = true;
                touched = true;
                continue;
            }
            if let Some(relative) = relevant_path(root, path) {
                touched = true;
                if let Some(known) = self.paths.get_mut(&relative) {
                    *known |= structural;
                } else if self.paths.len() < MAX_BATCH_PATHS {
                    self.paths.insert(relative, structural);
                } else {
                    self.rescan = true;
                }
            }
        }
        if touched {
            self.first.get_or_insert(now);
            self.last = Some(now);
        }
    }

    pub(crate) fn note_error(&mut self, root: &Path, error: &notify::Error, now: Instant) {
        if vanished_during_scan(root, error) {
            return;
        }
        self.rescan = true;
        self.first.get_or_insert(now);
        self.last = Some(now);
    }

    pub(crate) fn wait(&self, now: Instant) -> Option<Duration> {
        let (first, last) = (self.first?, self.last?);
        let quiet = (last + DEBOUNCE).saturating_duration_since(now);
        let latest = (first + MAX_LATENCY).saturating_duration_since(now);
        Some(quiet.min(latest))
    }

    pub(crate) fn take(
        &mut self,
        project_id: &str,
        ours: &dyn Fn(&str) -> bool,
    ) -> Option<FolderChange> {
        let mut batch = std::mem::take(self);
        if !batch.rescan {
            batch.paths.retain(|path, _| !ours(path));
        }
        (batch.rescan || !batch.paths.is_empty()).then(|| FolderChange {
            project_id: project_id.to_owned(),
            structural: batch.rescan || batch.paths.values().any(|structural| *structural),
            paths: if batch.rescan {
                Vec::new()
            } else {
                batch.paths.into_keys().collect()
            },
            rescan: batch.rescan,
            renamed: Vec::new(),
            deleted: Vec::new(),
        })
    }
}

fn native_config() -> Config {
    Config::default().with_follow_symlinks(false)
}

fn create_watcher(
    sender: std::sync::mpsc::Sender<notify::Result<Event>>,
    mode: WatchMode,
    root: &Path,
) -> Result<Box<dyn Watcher + Send>, String> {
    let polling = |interval: Duration, sender| -> Result<Box<dyn Watcher + Send>, String> {
        let mut watcher = PollWatcher::new(
            sender,
            Config::default()
                .with_poll_interval(interval)
                .with_follow_symlinks(false),
        )
        .map_err(|error| error.to_string())?;
        watcher
            .watch(root, RecursiveMode::Recursive)
            .map_err(|error| error.to_string())?;
        Ok(Box::new(watcher))
    };
    match mode {
        WatchMode::Poll(interval) => polling(interval, sender),
        WatchMode::Native => {
            let native =
                RecommendedWatcher::new(sender.clone(), native_config()).and_then(|mut watcher| {
                    watcher.watch(root, RecursiveMode::Recursive)?;
                    Ok(watcher)
                });
            match native {
                Ok(watcher) => Ok(Box::new(watcher)),
                Err(_) => polling(NETWORK_POLL_INTERVAL, sender),
            }
        }
    }
}

fn still_active(project_id: &str, token: u64) -> bool {
    hub()
        .active
        .as_ref()
        .is_some_and(|active| active.project_id == project_id && active.token == token)
}

fn unwanted<'a>(root: &'a Path, project_id: &'a str) -> impl Fn(&str) -> bool + 'a {
    let shared = std::cell::OnceCell::new();
    move |relative: &str| {
        let name = relative.rsplit('/').next().unwrap_or(relative);
        is_own_write(&root.join(relative))
            || (crate::collab::disk::scratch_name(name)
                && !shared
                    .get_or_init(|| crate::collab::live::shared_files(project_id))
                    .contains(relative))
    }
}

fn deliver(
    batch: &mut Batch,
    root: &Path,
    project_id: &str,
    token: u64,
    sink: &ChangeSink,
    on_root_changed: &dyn Fn(),
) {
    let root_changed = batch.root_changed;
    if let Some(change) = batch.take(project_id, &unwanted(root, project_id)) {
        if still_active(project_id, token) {
            sink(change);
        }
    }
    if root_changed && still_active(project_id, token) {
        on_root_changed();
    }
}

fn run(
    receiver: Receiver<notify::Result<Event>>,
    root: PathBuf,
    project_id: String,
    token: u64,
    sink: ChangeSink,
    on_root_changed: Box<dyn Fn() + Send>,
) {
    let mut batch = Batch::default();
    loop {
        let message = match batch.wait(Instant::now()) {
            None => receiver.recv().map_err(|_| RecvTimeoutError::Disconnected),
            Some(wait) => receiver.recv_timeout(wait),
        };
        match message {
            Ok(Ok(event)) => batch.absorb(&root, &event, Instant::now()),
            Ok(Err(error)) => batch.note_error(&root, &error, Instant::now()),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        if batch.wait(Instant::now()) == Some(Duration::ZERO) {
            deliver(
                &mut batch,
                &root,
                &project_id,
                token,
                &sink,
                on_root_changed.as_ref(),
            );
        }
    }
}

pub(crate) fn begin_request() -> u64 {
    let (request, replaced) = {
        let mut hub = hub();
        hub.latest_request += 1;
        (hub.latest_request, hub.active.take())
    };
    drop(replaced);
    request
}

fn is_latest(request: u64) -> bool {
    hub().latest_request == request
}

fn install(
    request: u64,
    project_id: &str,
    root: &Path,
    mode: WatchMode,
    sink: ChangeSink,
    on_root_changed: Box<dyn Fn() + Send>,
) -> Result<Option<u64>, String> {
    if !is_latest(request) {
        return Ok(None);
    }
    let (sender, receiver) = std::sync::mpsc::channel();
    let watcher = create_watcher(sender, mode, root)?;
    let mut hub = hub();
    if hub.latest_request != request {
        drop(hub);
        drop(watcher);
        return Ok(None);
    }
    let worker_root = root.to_path_buf();
    let worker_project = project_id.to_owned();
    std::thread::Builder::new()
        .name("oleafly-folder-watch".into())
        .spawn(move || {
            run(
                receiver,
                worker_root,
                worker_project,
                request,
                sink,
                on_root_changed,
            )
        })
        .map_err(|error| format!("could not start watching the folder: {error}"))?;
    hub.active = Some(ActiveWatch {
        project_id: project_id.to_owned(),
        token: request,
        _watcher: watcher,
    });
    Ok(Some(request))
}

#[cfg(test)]
pub(crate) fn start(
    project_id: &str,
    root: &Path,
    mode: WatchMode,
    sink: ChangeSink,
    on_root_changed: Box<dyn Fn() + Send>,
) -> Result<u64, String> {
    install(
        begin_request(),
        project_id,
        root,
        mode,
        sink,
        on_root_changed,
    )?
    .ok_or_else(|| "a newer watch request replaced this one".to_string())
}

pub(crate) fn is_watching(project_id: &str) -> bool {
    hub()
        .active
        .as_ref()
        .is_some_and(|active| active.project_id == project_id)
}

pub(crate) fn stop(project_id: &str, token: Option<u64>) -> bool {
    let removed = {
        let mut hub = hub();
        let matches = hub.active.as_ref().is_some_and(|active| {
            active.project_id == project_id && token.is_none_or(|token| token == active.token)
        });
        if matches {
            hub.active.take()
        } else {
            None
        }
    };
    removed.is_some()
}

#[cfg(test)]
pub(crate) fn stop_all() {
    let removed = hub().active.take();
    drop(removed);
}

#[cfg(test)]
pub(crate) fn active_token(project_id: &str) -> Option<u64> {
    hub()
        .active
        .as_ref()
        .filter(|active| active.project_id == project_id)
        .map(|active| active.token)
}

#[cfg(test)]
pub(crate) fn watch_project(
    project_id: &str,
    sink: ChangeSink,
    mode_override: Option<WatchMode>,
) -> Result<Option<u64>, String> {
    watch_project_reporting(
        project_id,
        sink,
        Arc::new(crate::collab::testing::RecordedPauses::default()),
        mode_override,
    )
}

#[cfg(test)]
pub(crate) fn watch_project_reporting(
    project_id: &str,
    sink: ChangeSink,
    host: Arc<dyn SyncPauseHost>,
    mode_override: Option<WatchMode>,
) -> Result<Option<u64>, String> {
    watch_project_as(begin_request(), project_id, sink, host, mode_override, true)
}

fn watch_project_as(
    request: u64,
    project_id: &str,
    sink: ChangeSink,
    host: Arc<dyn SyncPauseHost>,
    mode_override: Option<WatchMode>,
    fresh: bool,
) -> Result<Option<u64>, String> {
    // Library projects are watched too: a terminal or agent started in one
    // writes its files directly, and the open editor has to hear about it.
    let location = crate::project_location::locate(project_id)?;
    let shared = crate::collab::registry::is_shared(project_id);
    let network = crate::linked_registry::cached_membership(project_id)
        .ok()
        .and_then(|membership| match membership {
            crate::linked_registry::Membership::Active(member) => Some(member.record.volume_kind),
            _ => None,
        })
        == Some(crate::fs_identity::VolumeKind::Network);
    let mode = mode_override.unwrap_or(if network {
        WatchMode::Poll(NETWORK_POLL_INTERVAL)
    } else {
        WatchMode::Native
    });
    let guard = shared.then(|| {
        Arc::new(MassChangeGuard::new(
            project_id,
            &location.root,
            Arc::clone(&host),
        ))
    });
    let change_guard = guard.clone();
    let pause_host = Arc::clone(&host);
    let outer_sink = Arc::clone(&sink);
    let sink: ChangeSink = Arc::new(move |change: FolderChange| {
        crate::linked_registry::note_changed(&change.project_id);
        if let Some(guard) = &change_guard {
            let verdict = guard.inspect(&change);
            crate::collab::live::outside_change(&change, verdict, pause_host.as_ref());
        }
        sink(change);
    });
    let probe_id = project_id.to_owned();
    let composed = Arc::clone(&sink);
    let announce = (fresh && guard.is_some()).then(|| Arc::clone(&host));
    let on_root_changed = Box::new(move || {
        if let Some(guard) = &guard {
            let _ = guard.root_changed();
        }
        if crate::project_location::locate(&probe_id).is_err() {
            stop(&probe_id, Some(request));
            if let Some(guard) = guard.as_ref().filter(|guard| guard.begin_waiting()) {
                let waiter = RootWaiter {
                    request,
                    project_id: probe_id.clone(),
                    guard: Arc::clone(guard),
                    composed: Arc::clone(&composed),
                    outer: Arc::clone(&outer_sink),
                    host: Arc::clone(&host),
                    mode_override,
                };
                if std::thread::Builder::new()
                    .name("oleafly-folder-return".into())
                    .spawn(move || waiter.run())
                    .is_err()
                {
                    guard.end_waiting();
                }
            }
        }
    });
    let installed = install(
        request,
        project_id,
        &location.root,
        mode,
        sink,
        on_root_changed,
    )?;
    if let (Some(_), Some(host)) = (installed, announce) {
        host.sync_resumed(&SyncResumed {
            project_id: project_id.to_owned(),
        });
    }
    Ok(installed)
}

struct RootWaiter {
    request: u64,
    project_id: String,
    guard: Arc<MassChangeGuard>,
    composed: ChangeSink,
    outer: ChangeSink,
    host: Arc<dyn SyncPauseHost>,
    mode_override: Option<WatchMode>,
}

impl RootWaiter {
    fn run(self) {
        loop {
            std::thread::sleep(ROOT_POLL);
            if !is_latest(self.request) || is_watching(&self.project_id) {
                self.guard.end_waiting();
                return;
            }
            if self.guard.root_changed().is_none() {
                break;
            }
        }
        self.guard.end_waiting();
        let watched = watch_project_as(
            self.request,
            &self.project_id,
            Arc::clone(&self.outer),
            Arc::clone(&self.host),
            self.mode_override,
            false,
        );
        if !matches!(watched, Ok(Some(_))) {
            return;
        }
        (self.composed)(FolderChange {
            project_id: self.project_id.clone(),
            paths: Vec::new(),
            rescan: true,
            structural: true,
            renamed: Vec::new(),
            deleted: Vec::new(),
        });
        crate::collab::live::root_returned(&self.project_id);
    }
}

#[tauri::command]
pub async fn watch_project_folder<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
) -> Result<Option<u64>, String> {
    let request = begin_request();
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Emitter as _;
        let host: Arc<dyn SyncPauseHost> = Arc::new(app.clone());
        let sink: ChangeSink = Arc::new(move |change| {
            let _ = app.emit(FOLDER_CHANGED_EVENT, change);
        });
        watch_project_as(request, &project_id, sink, host, None, true)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn unwatch_project_folder(project_id: String, token: Option<u64>) -> bool {
    stop(&project_id, token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, CreateKind, DataChange, MetadataKind, RemoveKind, RenameMode};
    use std::sync::mpsc;

    fn event(kind: EventKind, paths: &[&Path]) -> Event {
        let mut event = Event::new(kind);
        for path in paths {
            event = event.add_path(path.to_path_buf());
        }
        event
    }

    #[test]
    fn scratch_files_git_and_dependency_folders_are_not_changes() {
        let root = Path::new("/folders/thesis");
        for (path, expected) in [
            ("main.tex", Some("main.tex")),
            ("chapters/intro.tex", Some("chapters/intro.tex")),
            (".latexmkrc", Some(".latexmkrc")),
            (".main.tex.oleafly-42-7-00ff00ff00ff00ff.tmp", None),
            ("notes.tex~RFb412a.TMP", None),
            ("chapters/intro.tex~RF1c2d.tmp", None),
            ("draft~RFnotes.tmp", Some("draft~RFnotes.tmp")),
            ("~RFb412a.TMP", Some("~RFb412a.TMP")),
            (".oleafly-case-rename-42-0", None),
            (".oleafly-import-42-0/figure.png", None),
            (".git", None),
            (".git/index", None),
            ("node_modules/pkg/index.js", None),
            ("build/main.pdf", None),
            ("_minted-main/x.pyg", None),
            (".DS_Store", None),
        ] {
            assert_eq!(
                relevant_path(root, &root.join(path)).as_deref(),
                expected,
                "{path}"
            );
        }
        assert_eq!(relevant_path(root, Path::new("/elsewhere/main.tex")), None);
    }

    #[test]
    fn scratch_files_are_changes_only_once_they_are_shared() {
        let library = crate::collab::testing::TempLibrary::new();
        let root = library.project("scratch-shared", &[]);
        crate::collab::testing::track("scratch-shared", &["notes~", "drafts/#draft#"]);
        let mut batch = Batch::default();
        let paths = [
            "notes~",
            "drafts/#draft#",
            ".main.tex.swp",
            "chapters/main.tex~",
            "#main.tex#",
            ".~lock.notes.odt#",
            "~$report.docx",
            "4913",
            "main.tex",
        ]
        .map(|path| root.join(path));
        let touched: Vec<&Path> = paths.iter().map(PathBuf::as_path).collect();
        batch.absorb(
            &root,
            &event(
                EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                &touched,
            ),
            Instant::now(),
        );
        let change = batch
            .take("scratch-shared", &unwanted(&root, "scratch-shared"))
            .expect("a change");
        assert_eq!(change.paths, ["drafts/#draft#", "main.tex", "notes~"]);
    }

    #[test]
    fn writes_inside_the_vendored_typst_packages_are_not_changes() {
        let root = Path::new("/folders/thesis");
        for (path, expected) in [
            ("typst-packages", Some("typst-packages")),
            ("typst-packages/preview/cetz/0.5.2/lib.typ", None),
            (
                "typst-packages/preview/cetz/.0.5.2.vendoring-42/typst.toml",
                None,
            ),
            ("typst-packages/local/mine/0.1.0", None),
            (
                "chapters/typst-packages/notes.typ",
                Some("chapters/typst-packages/notes.typ"),
            ),
            ("typst-packages.typ", Some("typst-packages.typ")),
        ] {
            assert_eq!(
                relevant_path(root, &root.join(path)).as_deref(),
                expected,
                "{path}"
            );
        }
        let mut batch = Batch::default();
        let start = Instant::now();
        batch.absorb(
            root,
            &event(
                EventKind::Create(CreateKind::File),
                &[&root.join("typst-packages/preview/cetz/0.5.2/lib.typ")],
            ),
            start,
        );
        assert_eq!(batch.wait(start), None);
        assert_eq!(batch.take("linked-thesis", &|_| false), None);
    }

    #[test]
    fn a_batch_waits_for_quiet_and_never_longer_than_the_latency_cap() {
        let root = Path::new("/folders/thesis");
        let start = Instant::now();
        let mut batch = Batch::default();
        assert_eq!(batch.wait(start), None);

        batch.absorb(
            root,
            &event(
                EventKind::Modify(ModifyKind::Any),
                &[&root.join("main.tex")],
            ),
            start,
        );
        assert_eq!(batch.wait(start), Some(DEBOUNCE));
        batch.absorb(
            root,
            &event(
                EventKind::Access(AccessKind::Any),
                &[&root.join("refs.bib")],
            ),
            start + Duration::from_millis(100),
        );
        assert_eq!(
            batch.wait(start + Duration::from_millis(100)),
            Some(DEBOUNCE - Duration::from_millis(100))
        );

        let mut later = start;
        for step in 1..=6 {
            later = start + Duration::from_millis(250 * step);
            batch.absorb(
                root,
                &event(
                    EventKind::Create(CreateKind::File),
                    &[&root.join(format!("f{step}.tex"))],
                ),
                later,
            );
        }
        assert_eq!(batch.wait(later), Some(Duration::ZERO));

        let change = batch.take("linked-a", &|_| false).unwrap();
        assert_eq!(change.paths.len(), 7);
        assert!(change.paths.contains(&"main.tex".to_string()));
        assert!(!change.rescan);
        assert_eq!(batch.wait(later), None);
        assert!(batch.take("linked-a", &|_| false).is_none());
    }

    #[test]
    fn a_file_that_vanishes_mid_scan_is_not_a_rescan() {
        let root = Path::new("/folders/thesis");
        let now = Instant::now();
        let missing = || std::io::Error::from(std::io::ErrorKind::NotFound);
        let mut batch = Batch::default();
        batch.note_error(
            root,
            &notify::Error::io(missing()).add_path(root.join(".notes.tex.tmp")),
            now,
        );
        assert_eq!(batch.wait(now), None);
        assert!(batch.take("linked-a", &|_| false).is_none());

        for error in [
            notify::Error::io(missing()).add_path(root.to_path_buf()),
            notify::Error::io(missing()),
            notify::Error::io(missing()).add_path(PathBuf::from("/elsewhere/a.tex")),
            notify::Error::io(std::io::Error::from(std::io::ErrorKind::PermissionDenied))
                .add_path(root.join("notes.tex")),
            notify::Error::generic("walk failed"),
        ] {
            let mut batch = Batch::default();
            batch.note_error(root, &error, now);
            assert!(
                batch.take("linked-a", &|_| false).unwrap().rescan,
                "{error:?}"
            );
        }
    }

    #[test]
    fn a_flood_of_changes_becomes_one_rescan() {
        let root = Path::new("/folders/thesis");
        let now = Instant::now();
        let mut batch = Batch::default();
        for index in 0..(MAX_BATCH_PATHS + 5) {
            batch.absorb(
                root,
                &event(
                    EventKind::Create(CreateKind::File),
                    &[&root.join(format!("f{index}.tex"))],
                ),
                now,
            );
        }
        let change = batch.take("linked-a", &|_| true).unwrap();
        assert!(change.rescan);
        assert!(change.structural);
        assert!(change.paths.is_empty());
    }

    #[test]
    fn a_batch_says_whether_files_came_went_or_only_changed() {
        let root = Path::new("/folders/thesis");
        let now = Instant::now();
        let absorb = |batch: &mut Batch, kind: EventKind, path: &str| {
            batch.absorb(root, &event(kind, &[&root.join(path)]), now);
        };

        let mut edits = Batch::default();
        absorb(
            &mut edits,
            EventKind::Modify(ModifyKind::Data(DataChange::Content)),
            "main.tex",
        );
        absorb(
            &mut edits,
            EventKind::Modify(ModifyKind::Metadata(MetadataKind::WriteTime)),
            "refs.bib",
        );
        absorb(&mut edits, EventKind::Modify(ModifyKind::Any), "notes.md");
        let edits = edits.take("linked-a", &|_| false).unwrap();
        assert!(!edits.structural);

        for kind in [
            EventKind::Create(CreateKind::File),
            EventKind::Remove(RemoveKind::File),
            EventKind::Modify(ModifyKind::Name(RenameMode::Any)),
            EventKind::Any,
        ] {
            let mut batch = Batch::default();
            absorb(
                &mut batch,
                EventKind::Modify(ModifyKind::Data(DataChange::Any)),
                "main.tex",
            );
            absorb(&mut batch, kind, "main.tex");
            let change = batch.take("linked-a", &|_| false).unwrap();
            assert!(change.structural, "{kind:?}");
            assert_eq!(change.paths, ["main.tex"]);
        }
    }

    #[test]
    fn paths_oleafly_wrote_itself_leave_the_batch() {
        let root = Path::new("/folders/thesis");
        let now = Instant::now();
        let mut batch = Batch::default();
        for path in ["main.tex", "figures/new.png"] {
            batch.absorb(
                root,
                &event(
                    EventKind::Modify(ModifyKind::Name(RenameMode::Any)),
                    &[&root.join(path)],
                ),
                now,
            );
        }
        let change = batch.take("linked-a", &|path| path == "main.tex").unwrap();
        assert_eq!(change.paths, ["figures/new.png"]);

        let mut only_ours = Batch::default();
        only_ours.absorb(
            root,
            &event(
                EventKind::Modify(ModifyKind::Name(RenameMode::Any)),
                &[&root.join("main.tex")],
            ),
            now,
        );
        assert!(only_ours.take("linked-a", &|_| true).is_none());
    }

    #[test]
    fn a_recorded_write_matches_only_until_the_file_changes_again() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().canonicalize().unwrap().join("main.tex");
        std::fs::write(&path, "saved by Oleafly").unwrap();
        assert!(!is_own_write(&path));

        note_own_write(&path);
        assert!(is_own_write(&path));

        std::fs::write(&path, "edited in another editor, longer").unwrap();
        assert!(!is_own_write(&path));
    }

    #[test]
    fn the_native_watcher_does_not_follow_links_out_of_the_folder() {
        assert!(!native_config().follow_symlinks());
    }

    #[test]
    fn a_request_that_finishes_late_never_replaces_a_newer_watch() {
        let _guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let (sink, _receiver) = recorder();
        let poll = WatchMode::Poll(Duration::from_millis(50));

        let older = begin_request();
        let newer = begin_request();
        let installed = install(
            newer,
            "linked-race",
            &root,
            poll,
            sink.clone(),
            Box::new(|| {}),
        );
        let late = install(older, "linked-race", &root, poll, sink, Box::new(|| {}));
        let stale_stop = stop("linked-race", Some(older));
        let active = active_token("linked-race");
        stop("linked-race", Some(newer));

        assert_eq!(installed.unwrap(), Some(newer));
        assert_eq!(late.unwrap(), None);
        assert!(!stale_stop);
        assert_eq!(active, Some(newer));
        assert_eq!(active_token("linked-race"), None);
    }

    fn recorder() -> (ChangeSink, mpsc::Receiver<FolderChange>) {
        let (sender, receiver) = mpsc::channel();
        let sender = Mutex::new(sender);
        let sink: ChangeSink = Arc::new(move |change| {
            let _ = sender
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .send(change);
        });
        (sink, receiver)
    }

    fn next_change(receiver: &mpsc::Receiver<FolderChange>) -> Option<FolderChange> {
        receiver.recv_timeout(Duration::from_secs(10)).ok()
    }

    #[test]
    fn watching_reports_edits_once_skips_scratch_files_and_stops_when_asked() {
        let _guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        std::fs::write(root.join("main.tex"), "one").unwrap();
        std::fs::File::options()
            .write(true)
            .open(root.join("main.tex"))
            .unwrap()
            .set_modified(std::time::SystemTime::now() - Duration::from_secs(60))
            .unwrap();
        let (sink, receiver) = recorder();

        let token = start(
            "linked-watch-test",
            &root,
            WatchMode::Poll(Duration::from_millis(50)),
            sink,
            Box::new(|| {}),
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(200));
        std::fs::write(root.join(".main.tex.oleafly-1-2-00ff.tmp"), "scratch").unwrap();
        std::fs::write(root.join("main.tex"), "two, longer").unwrap();
        let change = next_change(&receiver);
        let quiet = receiver.recv_timeout(Duration::from_millis(600));
        let stopped = stop("linked-watch-test", Some(token + 1));
        let still_watching = active_token("linked-watch-test");
        let stopped_now = stop("linked-watch-test", Some(token));
        std::thread::sleep(Duration::from_millis(1_100));
        std::fs::write(root.join("main.tex"), "three, even longer").unwrap();
        let after_stop = receiver.recv_timeout(Duration::from_millis(500));

        let change = change.expect("an edit is reported");
        assert_eq!(change.project_id, "linked-watch-test");
        assert_eq!(change.paths, ["main.tex"]);
        assert!(!change.rescan);
        assert!(quiet.is_err());
        assert!(!stopped);
        assert_eq!(still_watching, Some(token));
        assert!(stopped_now);
        assert!(after_stop.is_err());
        assert_eq!(active_token("linked-watch-test"), None);
    }

    #[test]
    fn the_native_watcher_reports_a_new_file() {
        let _guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let (sink, receiver) = recorder();

        let token = start(
            "linked-native-test",
            &root,
            WatchMode::Native,
            sink,
            Box::new(|| {}),
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(500));
        std::fs::write(root.join("notes.md"), "notes").unwrap();
        let change = next_change(&receiver);
        stop("linked-native-test", Some(token));

        let change = change.expect("a new file is reported");
        assert!(
            change.rescan || change.paths.contains(&"notes.md".to_string()),
            "{change:?}"
        );
    }

    // A terminal or agent started in a library project writes its files
    // directly, so the editor has to hear about it like any opened folder.
    #[test]
    fn a_library_project_is_watched_its_own_save_is_silent_and_an_outside_edit_is_reported() {
        let library = crate::collab::testing::TempLibrary::new();
        let root = library.project("watch-library", &[("main.tex", "one")]);
        age(&root.join("main.tex"));
        let (sink, receiver) = recorder();

        let token = watch_project(
            "watch-library",
            sink,
            Some(WatchMode::Poll(Duration::from_millis(50))),
        )
        .unwrap()
        .expect("a library project is watched");
        std::thread::sleep(Duration::from_millis(200));
        crate::project::write_project_bytes(
            "watch-library",
            &root.join("main.tex"),
            "main.tex",
            b"saved by Oleafly",
        )
        .unwrap();
        let own = receiver.recv_timeout(Duration::from_millis(800));
        std::fs::write(root.join("main.tex"), "edited in a terminal").unwrap();
        // The poll watcher compares whole-second times, so the edit must not
        // land in the same second as the save before it.
        std::fs::File::options()
            .write(true)
            .open(root.join("main.tex"))
            .unwrap()
            .set_modified(SystemTime::now() + Duration::from_secs(2))
            .unwrap();
        let outside = next_change(&receiver);
        stop("watch-library", Some(token));

        assert!(own.is_err(), "{own:?}");
        let outside = outside.expect("an outside edit is reported");
        assert_eq!(outside.project_id, "watch-library");
        assert_eq!(outside.paths, ["main.tex"]);
        assert!(!outside.rescan);
    }

    #[test]
    fn a_change_seen_while_the_folder_is_open_is_recorded_as_its_last_update() {
        let _guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let folder = folders.path().join("thesis");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("main.tex"), "one").unwrap();
        std::fs::File::options()
            .write(true)
            .open(folder.join("main.tex"))
            .unwrap()
            .set_modified(SystemTime::now() - Duration::from_secs(60))
            .unwrap();
        let record = crate::linked_registry::register_folder_for_test(&folder);
        let (sink, receiver) = recorder();

        let token = watch_project(
            &record.id,
            sink,
            Some(WatchMode::Poll(Duration::from_millis(50))),
        )
        .unwrap()
        .unwrap();
        std::thread::sleep(Duration::from_millis(200));
        let started = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        std::fs::write(folder.join("main.tex"), "two, longer").unwrap();
        let change = next_change(&receiver);
        stop(&record.id, Some(token));
        let changed_at = crate::linked_registry::get(&record.id)
            .unwrap()
            .unwrap()
            .changed_at;
        std::env::remove_var("OLEAFLY_DATA_DIR");

        assert!(change.is_some());
        assert!(
            changed_at.is_some_and(|at| u128::from(at) >= started),
            "{changed_at:?}"
        );
    }

    #[test]
    fn a_linked_folder_that_disappears_stops_its_watch() {
        let _guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let folder = folders.path().join("thesis");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("main.tex"), "x").unwrap();
        let record = crate::linked_registry::register_folder_for_test(&folder);
        let (sink, _receiver) = recorder();

        let token = watch_project(
            &record.id,
            sink,
            Some(WatchMode::Poll(Duration::from_millis(50))),
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(200));
        std::fs::rename(&folder, folders.path().join("moved-away")).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while active_token(&record.id).is_some() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        let remaining = active_token(&record.id);
        std::env::remove_var("OLEAFLY_DATA_DIR");

        assert!(token.is_some());
        assert_eq!(remaining, None);
    }

    fn age(path: &Path) {
        std::fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(SystemTime::now() - Duration::from_secs(60))
            .unwrap();
    }

    #[test]
    fn a_shared_library_project_is_watched_like_an_opened_folder() {
        let library = crate::collab::testing::TempLibrary::new();
        let root = library.project("watch-shared", &[("main.tex", "one")]);
        age(&root.join("main.tex"));
        let _shared = crate::collab::testing::share("watch-shared");
        let (sink, receiver) = recorder();

        let token = watch_project(
            "watch-shared",
            sink,
            Some(WatchMode::Poll(Duration::from_millis(50))),
        )
        .unwrap()
        .expect("a shared library project is watched");
        std::thread::sleep(Duration::from_millis(200));
        std::fs::write(root.join("main.tex"), "two, longer").unwrap();
        let change = next_change(&receiver);
        stop("watch-shared", Some(token));

        let change = change.expect("an edit in a shared library project is reported");
        assert_eq!(change.project_id, "watch-shared");
        assert_eq!(change.paths, ["main.tex"]);
        assert!(!change.rescan);
    }

    #[test]
    fn a_shared_library_projects_own_save_is_silent_and_an_outside_edit_is_reported() {
        let library = crate::collab::testing::TempLibrary::new();
        let root = library.project("watch-own", &[("main.tex", "one")]);
        age(&root.join("main.tex"));
        let _shared = crate::collab::testing::share("watch-own");
        let (sink, receiver) = recorder();

        let token = watch_project(
            "watch-own",
            sink,
            Some(WatchMode::Poll(Duration::from_millis(50))),
        )
        .unwrap()
        .expect("a shared library project is watched");
        std::thread::sleep(Duration::from_millis(200));
        crate::project::write_project_bytes(
            "watch-own",
            &root.join("main.tex"),
            "main.tex",
            b"saved by Oleafly",
        )
        .unwrap();
        let own = receiver.recv_timeout(Duration::from_millis(800));
        std::fs::write(root.join("refs.bib"), "@book{a}").unwrap();
        let outside = next_change(&receiver);
        stop("watch-own", Some(token));

        assert!(own.is_err(), "{own:?}");
        assert_eq!(
            outside.expect("an outside edit is reported").paths,
            ["refs.bib"]
        );
    }

    #[test]
    fn a_shared_three_file_project_keeps_syncing_after_one_save_and_pauses_when_every_file_changes()
    {
        use crate::collab::guard::{PauseReason, SyncPaused};
        use crate::collab::testing::{share, track, RecordedPauses, TempLibrary};
        let library = TempLibrary::new();
        let files = ["main.tex", "refs.bib", "intro.tex"];
        let root = library.project(
            "watch-three",
            &[
                ("main.tex", "one"),
                ("refs.bib", "one"),
                ("intro.tex", "one"),
            ],
        );
        for file in files {
            age(&root.join(file));
        }
        let _shared = share("watch-three");
        track("watch-three", &files);
        let pauses = Arc::new(RecordedPauses::default());
        let (sink, receiver) = recorder();

        let token = watch_project_reporting(
            "watch-three",
            sink,
            pauses.clone(),
            Some(WatchMode::Poll(Duration::from_millis(50))),
        )
        .unwrap()
        .expect("a shared library project is watched");
        std::thread::sleep(Duration::from_millis(200));
        std::fs::write(root.join("main.tex"), "two, longer").unwrap();
        let one_save = next_change(&receiver);
        let after_one_save = pauses.taken();
        std::thread::sleep(Duration::from_millis(1100));
        for file in files {
            std::fs::write(root.join(file), "three, even longer").unwrap();
        }
        let every_file = next_change(&receiver);
        let after_every_file = pauses.taken();
        stop("watch-three", Some(token));

        assert_eq!(
            one_save.expect("one save reaches the editor").paths,
            ["main.tex"]
        );
        assert!(after_one_save.is_empty(), "{after_one_save:?}");
        assert_eq!(
            every_file
                .expect("a mass change still reaches the editor")
                .paths,
            ["intro.tex", "main.tex", "refs.bib"]
        );
        assert_eq!(
            after_every_file,
            [SyncPaused {
                project_id: "watch-three".into(),
                changed: 3,
                total: 3,
                reason: PauseReason::MassChange,
            }]
        );
    }

    #[test]
    fn a_shared_project_whose_folder_vanishes_is_unavailable_once_and_never_a_mass_delete() {
        use crate::collab::guard::{PauseReason, SyncPaused};
        use crate::collab::testing::{share, track, RecordedPauses, TempLibrary};
        let library = TempLibrary::new();
        let files = ["main.tex", "refs.bib", "intro.tex"];
        let root = library.project(
            "watch-vanish",
            &[
                ("main.tex", "one"),
                ("refs.bib", "one"),
                ("intro.tex", "one"),
            ],
        );
        let _shared = share("watch-vanish");
        track("watch-vanish", &files);
        let pauses = Arc::new(RecordedPauses::default());
        let (sink, _receiver) = recorder();

        let token = watch_project_reporting(
            "watch-vanish",
            sink,
            pauses.clone(),
            Some(WatchMode::Poll(Duration::from_millis(50))),
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(200));
        std::fs::rename(&root, root.with_file_name("watch-vanish-parked")).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while active_token("watch-vanish").is_some() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        let remaining = active_token("watch-vanish");
        let heard = pauses.taken();

        assert!(token.is_some());
        assert_eq!(remaining, None);
        assert_eq!(
            heard,
            [SyncPaused {
                project_id: "watch-vanish".into(),
                changed: 0,
                total: 3,
                reason: PauseReason::RootUnavailable,
            }]
        );
    }

    fn wait_for_token(project_id: &str, present: bool) -> Option<u64> {
        let deadline = Instant::now() + Duration::from_secs(10);
        while active_token(project_id).is_some() != present && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        active_token(project_id)
    }

    #[test]
    fn starting_to_watch_a_shared_project_says_its_folder_is_there() {
        use crate::collab::guard::SyncResumed;
        use crate::collab::testing::{share, RecordedPauses, TempLibrary};
        let library = TempLibrary::new();
        library.project("watch-there", &[("main.tex", "one")]);
        let _shared = share("watch-there");
        let pauses = Arc::new(RecordedPauses::default());
        let (sink, _receiver) = recorder();

        let token = watch_project_reporting(
            "watch-there",
            sink,
            pauses.clone(),
            Some(WatchMode::Poll(Duration::from_millis(50))),
        )
        .unwrap();
        let heard = pauses.resumed();
        stop("watch-there", token);

        assert!(token.is_some());
        assert_eq!(
            heard,
            [SyncResumed {
                project_id: "watch-there".into()
            }]
        );
    }

    #[test]
    fn a_shared_project_whose_folder_comes_back_is_watched_again_and_says_so() {
        use crate::collab::guard::SyncResumed;
        use crate::collab::testing::{share, track, RecordedPauses, TempLibrary};
        let library = TempLibrary::new();
        let files = ["main.tex", "refs.bib", "intro.tex"];
        let root = library.project(
            "watch-return",
            &[
                ("main.tex", "one"),
                ("refs.bib", "one"),
                ("intro.tex", "one"),
            ],
        );
        for file in files {
            age(&root.join(file));
        }
        let _shared = share("watch-return");
        track("watch-return", &files);
        let pauses = Arc::new(RecordedPauses::default());
        let (sink, receiver) = recorder();

        let token = watch_project_reporting(
            "watch-return",
            sink,
            pauses.clone(),
            Some(WatchMode::Poll(Duration::from_millis(50))),
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(200));
        let started = pauses.resumed();
        let parked = root.with_file_name("watch-return-parked");
        std::fs::rename(&root, &parked).unwrap();
        let gone = wait_for_token("watch-return", false);
        let quiet = pauses.resumed();
        std::fs::rename(&parked, &root).unwrap();
        let back = wait_for_token("watch-return", true);
        std::thread::sleep(Duration::from_millis(300));
        let resumed = pauses.resumed();
        while receiver.try_recv().is_ok() {}
        std::fs::write(root.join("main.tex"), "two, longer").unwrap();
        let edit = next_change(&receiver);
        stop("watch-return", back);

        assert!(token.is_some());
        assert_eq!(started.len(), 1, "{started:?}");
        assert_eq!(gone, None);
        assert!(quiet.is_empty(), "{quiet:?}");
        assert!(back.is_some());
        assert_eq!(
            resumed,
            [SyncResumed {
                project_id: "watch-return".into()
            }]
        );
        let edit = edit.expect("an edit after the folder came back is reported");
        assert!(
            edit.rescan || edit.paths.contains(&"main.tex".to_string()),
            "{edit:?}"
        );
    }
}
