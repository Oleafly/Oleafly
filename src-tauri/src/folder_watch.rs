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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderChange {
    pub project_id: String,
    pub paths: Vec<String>,
    pub rescan: bool,
    pub structural: bool,
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
    fingerprint: Fingerprint,
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

fn is_own_write(path: &Path) -> bool {
    let now = Instant::now();
    let mut writes = own_writes();
    writes.retain(|write| now.duration_since(write.at) < OWN_WRITE_WINDOW);
    writes
        .iter()
        .find(|write| write.path == path)
        .is_some_and(|write| fingerprint(path) == Some(write.fingerprint))
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
    {
        return None;
    }
    if last.eq_ignore_ascii_case(".git")
        || last.eq_ignore_ascii_case(".DS_Store")
        || crate::checkpoint_capture::is_oleafly_owned(last)
    {
        return None;
    }
    Some(names.join("/"))
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

    pub(crate) fn note_error(&mut self, now: Instant) {
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

fn deliver(
    batch: &mut Batch,
    root: &Path,
    project_id: &str,
    token: u64,
    sink: &ChangeSink,
    on_root_changed: &dyn Fn(),
) {
    let root_changed = batch.root_changed;
    if let Some(change) = batch.take(project_id, &|relative| is_own_write(&root.join(relative))) {
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
            Ok(Err(_)) => batch.note_error(Instant::now()),
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
pub(crate) fn watch_linked_project(
    project_id: &str,
    sink: ChangeSink,
    mode_override: Option<WatchMode>,
) -> Result<Option<u64>, String> {
    watch_linked_project_as(begin_request(), project_id, sink, mode_override)
}

fn watch_linked_project_as(
    request: u64,
    project_id: &str,
    sink: ChangeSink,
    mode_override: Option<WatchMode>,
) -> Result<Option<u64>, String> {
    let location = crate::project_location::locate(project_id)?;
    if location.kind != crate::project_location::ProjectKind::Linked {
        return Ok(None);
    }
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
    let sink: ChangeSink = Arc::new(move |change: FolderChange| {
        crate::linked_registry::note_changed(&change.project_id);
        sink(change);
    });
    let probe_id = project_id.to_owned();
    let on_root_changed = Box::new(move || {
        if crate::project_location::locate(&probe_id).is_err() {
            stop(&probe_id, Some(request));
        }
    });
    install(
        request,
        project_id,
        &location.root,
        mode,
        sink,
        on_root_changed,
    )
}

#[tauri::command]
pub async fn watch_project_folder<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
) -> Result<Option<u64>, String> {
    let request = begin_request();
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Emitter as _;
        let sink: ChangeSink = Arc::new(move |change| {
            let _ = app.emit(FOLDER_CHANGED_EVENT, change);
        });
        watch_linked_project_as(request, &project_id, sink, None)
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

    #[test]
    fn a_library_project_is_never_watched() {
        let _guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        crate::paths::create_project_dir("watch-library").unwrap();
        let (sink, _receiver) = recorder();

        let watched = watch_linked_project("watch-library", sink, None);
        std::env::remove_var("OLEAFLY_DATA_DIR");

        assert_eq!(watched.unwrap(), None);
        assert_eq!(active_token("watch-library"), None);
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

        let token = watch_linked_project(
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

        let token = watch_linked_project(
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
}
