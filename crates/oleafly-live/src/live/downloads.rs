use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, MutexGuard, TryLockError, Weak};
use std::time::{Duration, Instant};

use futures_util::future::BoxFuture;
use tokio::sync::Notify;
use tokio::task::{AbortHandle, Id, JoinSet};

use super::disk_pass::{figure_state, holds, FigureState};
use super::host::DiskHost;
use super::live_tree::LiveTree;
use super::payloads::{DownloadProgress, FolderChange};
use super::session::{guard, off_runtime, LiveDisk};
use super::unwritten::{backoff, held_now, reason_of, Settled, UnwrittenReason};
use crate::disk::{remove_path, safe_target, sha256_hex, write_file_over, WriteOutcome};

const AT_ONCE: usize = 3;
const KEPT_BYTES: usize = 64 * 1024 * 1024;
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

#[cfg(test)]
static FIGURE_LATE: super::disk_pass::Pause = Mutex::new(BTreeMap::new());

pub type Bytes = Arc<Vec<u8>>;

#[derive(Default)]
pub struct Figures {
    wanted: BTreeMap<String, String>,
    failing: BTreeMap<String, Failure>,
    fetched: Vec<(String, Bytes)>,
    in_flight: BTreeMap<String, String>,
    running: bool,
    wake: Arc<Notify>,
    landed: Arc<Notify>,
}

struct Failure {
    hash: String,
    attempts: u32,
    next: Instant,
}

pub enum Placed {
    Written { added: bool },
    Already,
    Conflict,
    Failed(UnwrittenReason),
    Dropped,
}

type Picked = Vec<(String, String, Option<Bytes>)>;

impl Figures {
    fn backing_off(&self, path: &str, now: Instant) -> bool {
        self.failing
            .get(path)
            .is_some_and(|failure| failure.next > now)
    }

    fn due(&mut self, now: Instant, room: usize) -> (Picked, Option<Duration>) {
        let wanted = &self.wanted;
        self.failing
            .retain(|path, failure| wanted.get(path) == Some(&failure.hash));
        self.fetched
            .retain(|(hash, _)| wanted.values().any(|wanted| wanted == hash));
        let picked: Picked = self
            .wanted
            .iter()
            .filter(|(path, _)| !self.in_flight.contains_key(*path) && !self.backing_off(path, now))
            .take(room)
            .map(|(path, hash)| (path.clone(), hash.clone(), self.kept(hash)))
            .collect();
        let wait = self
            .failing
            .iter()
            .filter(|(path, failure)| !self.in_flight.contains_key(*path) && failure.next > now)
            .map(|(_, failure)| failure.next - now)
            .min();
        (picked, wait)
    }

    fn busy(&self, now: Instant) -> bool {
        !self.in_flight.is_empty() || self.wanted.keys().any(|path| !self.backing_off(path, now))
    }

    fn kept(&self, hash: &str) -> Option<Bytes> {
        self.fetched
            .iter()
            .find(|(kept, _)| kept == hash)
            .map(|(_, bytes)| Arc::clone(bytes))
    }

    fn keep(&mut self, hash: &str, bytes: &Bytes, cap: usize) {
        self.fetched.retain(|(kept, _)| kept != hash);
        self.fetched.push((hash.to_owned(), Arc::clone(bytes)));
        let mut held: usize = self.fetched.iter().map(|(_, bytes)| bytes.len()).sum();
        while held > cap {
            let (_, dropped) = self.fetched.remove(0);
            held -= dropped.len();
        }
    }

    fn failed(&mut self, path: &str, hash: &str) {
        let attempts = self
            .failing
            .get(path)
            .filter(|failure| failure.hash == hash)
            .map_or(0, |failure| failure.attempts)
            .saturating_add(1);
        self.failing.insert(
            path.to_owned(),
            Failure {
                hash: hash.to_owned(),
                attempts,
                next: Instant::now() + backoff(attempts),
            },
        );
    }

    fn settled(&mut self, path: &str) {
        self.wanted.remove(path);
        self.failing.remove(path);
    }
}

pub trait FigureHost: LiveTree + Sized + 'static {
    fn local(&self) -> &LiveDisk;
    fn figure_hold_dir(&self) -> PathBuf;
    fn fetch_figure(&self, path: &str, hash: &str) -> BoxFuture<'static, Option<Vec<u8>>>;
    fn figure_conflict(
        self: Arc<Self>,
        path: String,
        bytes: Bytes,
    ) -> BoxFuture<'static, Option<UnwrittenReason>>;
    fn figure_placed(&self, _path: &str, _hash: &str, _content: &str) {}

    fn want_figures(self: &Arc<Self>, wanted: Vec<(String, String)>) {
        let start = {
            let mut figures = guard(&self.local().upkeep.figures);
            if self.figures_closed() {
                return;
            }
            figures.wanted = wanted.into_iter().collect();
            figures.wake.notify_one();
            !figures.wanted.is_empty() && !std::mem::replace(&mut figures.running, true)
        };
        if start {
            self.local().spawn(fetch_figures(Arc::downgrade(self)));
        }
    }

    fn figures_closed(&self) -> bool {
        self.local().figures_closed()
    }

    fn close_figures(&self) {
        self.local()
            .upkeep
            .figures_closed
            .store(true, Ordering::SeqCst);
        let mut figures = guard(&self.local().upkeep.figures);
        figures.wanted.clear();
        figures.fetched.clear();
        figures.wake.notify_one();
    }

    fn wait_for_figures(&self, limit: Duration) -> impl Future<Output = ()> + Send {
        async move {
            let deadline = Instant::now() + limit;
            let Some(landed) = self
                .figures_by(deadline)
                .await
                .map(|figures| Arc::clone(&figures.landed))
            else {
                return;
            };
            loop {
                let notified = landed.notified();
                tokio::pin!(notified);
                notified.as_mut().enable();
                let busy = self
                    .figures_by(deadline)
                    .await
                    .is_some_and(|figures| figures.busy(Instant::now()));
                let now = Instant::now();
                if !busy || now >= deadline {
                    return;
                }
                let _ = tokio::time::timeout(deadline - now, notified).await;
            }
        }
    }

    fn figures_now(&self) -> Option<MutexGuard<'_, Figures>> {
        match self.local().upkeep.figures.try_lock() {
            Ok(figures) => Some(figures),
            Err(TryLockError::Poisoned(poisoned)) => Some(poisoned.into_inner()),
            Err(TryLockError::WouldBlock) => None,
        }
    }

    fn figures_by(
        &self,
        deadline: Instant,
    ) -> impl Future<Output = Option<MutexGuard<'_, Figures>>> + Send {
        async move {
            loop {
                if let Some(figures) = self.figures_now() {
                    return Some(figures);
                }
                if Instant::now() >= deadline {
                    return None;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        }
    }

    #[cfg(any(test, feature = "test-support"))]
    fn figures_running(&self) -> bool {
        guard(&self.local().upkeep.figures).running
    }

    fn figure_held_now(&self, path: &str) -> Option<UnwrittenReason> {
        safe_target(&self.local().root, path).and_then(|target| held_now(&target))
    }
}

impl LiveDisk {
    pub fn figures_closed(&self) -> bool {
        self.upkeep.figures_closed.load(Ordering::SeqCst)
    }

    fn write_figure(
        &self,
        hold_dir: &Path,
        path: &str,
        hash: &str,
        bytes: &[u8],
        content: &str,
    ) -> Placed {
        if !self.root.is_dir() || super::sync_hold::keeps_back(hold_dir, path) {
            return Placed::Dropped;
        }
        let known = {
            let disk = guard(&self.disk);
            if self.figures_closed()
                || disk.blob_at(path, hash).is_none()
                || disk.hashes.get(path).map(String::as_str) == Some(hash)
            {
                return Placed::Dropped;
            }
            disk.clone()
        };
        let absent = || {
            safe_target(&self.root, path)
                .is_some_and(|target| std::fs::symlink_metadata(target).is_err())
        };
        let added = absent();
        let placed = match figure_state(&self.root, &known, path, content) {
            FigureState::OnDisk => Placed::Already,
            FigureState::Conflict => return Placed::Conflict,
            FigureState::Missing(stamp) => {
                match write_file_over(&self.root, path, bytes, stamp.as_ref()) {
                    Ok(WriteOutcome::ChangedOutside) => return Placed::Conflict,
                    Ok(_) => Placed::Written { added },
                    Err(error) => return Placed::Failed(reason_of(&self.root, path, &error)),
                }
            }
        };
        #[cfg(test)]
        super::disk_pass::late(&FIGURE_LATE, &self.root);
        let take_back = {
            let mut disk = guard(&self.disk);
            let untouched = disk.hashes.get(path) == known.hashes.get(path);
            if disk.blob_at(path, hash).is_some() {
                if untouched {
                    disk.hashes.insert(path.to_owned(), content.to_owned());
                }
                return placed;
            }
            let take_back = untouched && matches!(placed, Placed::Written { .. });
            if take_back {
                disk.hashes.remove(path);
            }
            take_back
        };
        if take_back && holds(&self.root, path, content) {
            remove_path(&self.root, path);
            if !absent() {
                self.log_once("figure moved", || {
                    format!(
                        "could not remove {path}. The server moved or deleted it while Oleafly was saving it"
                    )
                });
            }
        }
        Placed::Dropped
    }
}

async fn place_figure<H: FigureHost>(
    host: &Arc<H>,
    path: &str,
    hash: &str,
    fetched: Option<Bytes>,
    last: bool,
) {
    let local = host.local();
    let wanted = {
        let mut figures = guard(&local.upkeep.figures);
        figures.in_flight.remove(path);
        !host.figures_closed() && figures.wanted.get(path).map(String::as_str) == Some(hash)
    };
    let content = fetched.as_ref().map(|bytes| sha256_hex(bytes));
    let mut placed = match (wanted, &fetched, &content) {
        (false, _, _) => Placed::Dropped,
        (true, Some(bytes), Some(content)) => {
            let (writer, bytes) = (Arc::clone(host), Arc::clone(bytes));
            let (wanted, hash, content) = (path.to_owned(), hash.to_owned(), content.clone());
            tokio::task::spawn_blocking(move || match writer.figure_held_now(&wanted) {
                Some(reason) => Placed::Failed(reason),
                None => writer.local().write_figure(
                    &writer.figure_hold_dir(),
                    &wanted,
                    &hash,
                    &bytes,
                    &content,
                ),
            })
            .await
            .unwrap_or(Placed::Failed(UnwrittenReason::Other))
        }
        (true, _, _) => Placed::Failed(UnwrittenReason::NotDownloaded),
    };
    if matches!(placed, Placed::Conflict) {
        let conflict =
            Arc::clone(host).figure_conflict(path.to_owned(), fetched.clone().unwrap_or_default());
        if let Some(reason) = conflict.await {
            placed = Placed::Failed(reason);
        }
    }
    if wanted {
        let mut figures = guard(&local.upkeep.figures);
        if figures.wanted.get(path).map(String::as_str) == Some(hash) {
            if matches!(placed, Placed::Failed(_)) {
                if let Some(bytes) = &fetched {
                    figures.keep(hash, bytes, KEPT_BYTES);
                }
                figures.failed(path, hash);
            } else {
                figures.settled(path);
            }
        }
    }
    if last {
        let saved = guard(&local.disk).clone();
        let saver = Arc::clone(host);
        let saving = off_runtime(move || saver.save_index(saver.local(), &saved));
        if let Err(error) = saving.await {
            local.log_once("figure index", || {
                format!("could not save its file state after a figure arrived: {error}")
            });
        }
    }
    let landed = Arc::clone(&guard(&local.upkeep.figures).landed);
    landed.notify_waiters();
    let settled = match placed {
        Placed::Written { .. } | Placed::Already => Settled {
            done: BTreeSet::from([path.to_owned()]),
            ..Settled::default()
        },
        Placed::Failed(reason) => Settled {
            failed: vec![(path.to_owned(), reason)],
            ..Settled::default()
        },
        Placed::Conflict | Placed::Dropped => return,
    };
    if let Some(content) = &content {
        host.figure_placed(path, hash, content);
    }
    let layout = guard(&local.disk).layout.clone();
    local.settle_unwritten(&**host, &layout, settled);
    if let Placed::Written { added } = placed {
        local.host.folder_changed(FolderChange {
            project_id: local.project_id.clone(),
            paths: vec![path.to_owned()],
            rescan: false,
            structural: added,
            renamed: Vec::new(),
            deleted: Vec::new(),
        });
    }
}

async fn waited(wait: Option<Duration>) {
    match wait {
        Some(wait) => tokio::time::sleep(wait).await,
        None => std::future::pending().await,
    }
}

async fn fetch_figures<H: FigureHost>(session: Weak<H>) {
    let mut downloads: JoinSet<(String, String, Option<Bytes>)> = JoinSet::new();
    let mut running: BTreeMap<String, (String, AbortHandle)> = BTreeMap::new();
    let mut paths_of: BTreeMap<Id, String> = BTreeMap::new();
    loop {
        let (picked, wait, wake) = {
            let Some(active) = session.upgrade() else {
                return;
            };
            let closed = active.figures_closed();
            let mut figures = guard(&active.local().upkeep.figures);
            running.retain(|path, (hash, abort)| {
                let keep = !closed && figures.wanted.get(path) == Some(hash);
                if !keep {
                    abort.abort();
                    figures.in_flight.remove(path);
                }
                keep
            });
            let room = AT_ONCE.saturating_sub(running.len());
            let (picked, wait) = if closed {
                (Vec::new(), None)
            } else {
                figures.due(Instant::now(), room)
            };
            if picked.is_empty() && running.is_empty() && wait.is_none() {
                figures.running = false;
                figures.in_flight.clear();
                figures.landed.notify_waiters();
                return;
            }
            for (path, hash, _) in &picked {
                figures.in_flight.insert(path.clone(), hash.clone());
            }
            let picked: Vec<_> = picked
                .into_iter()
                .map(|(path, hash, kept)| {
                    let fetching = active.fetch_figure(&path, &hash);
                    (path, hash, kept, fetching)
                })
                .collect();
            (picked, wait, Arc::clone(&figures.wake))
        };
        for (path, hash, kept, fetching) in picked {
            let wanted = hash.clone();
            let task_path = path.clone();
            let abort = downloads.spawn(async move {
                let bytes = match kept {
                    Some(bytes) => Some(bytes),
                    None => fetching.await.map(Arc::new),
                };
                (task_path, wanted, bytes)
            });
            paths_of.insert(abort.id(), path.clone());
            running.insert(path, (hash, abort));
        }
        tokio::select! {
            Some(done) = downloads.join_next_with_id(), if !downloads.is_empty() => {
                let (id, finished) = match done {
                    Ok((id, outcome)) => (id, Some(outcome)),
                    Err(error) => (error.id(), None),
                };
                let Some(path) = paths_of.remove(&id) else {
                    continue;
                };
                if running.get(&path).is_none_or(|(_, abort)| abort.id() != id) {
                    continue;
                }
                running.remove(&path);
                let Some(active) = session.upgrade() else {
                    return;
                };
                match finished {
                    Some((_, hash, bytes)) => {
                        place_figure(&active, &path, &hash, bytes, running.is_empty()).await;
                    }
                    None => {
                        guard(&active.local().upkeep.figures).in_flight.remove(&path);
                    }
                }
            }
            () = wake.notified() => {}
            () = waited(wait) => {}
        }
    }
}

pub type DownloadReport = Arc<dyn Fn(u64, Option<u64>) + Send + Sync>;

#[derive(Default)]
pub struct Pacer(Mutex<Option<Instant>>);

impl Pacer {
    pub fn due(&self, finished: bool) -> bool {
        let now = Instant::now();
        let mut told = guard(&self.0);
        if !finished && told.is_some_and(|at| now.duration_since(at) < PROGRESS_EVERY) {
            return false;
        }
        *told = Some(now);
        true
    }
}

pub fn download_progress_for(
    host: Arc<dyn DiskHost>,
    project_id: &str,
    path: &str,
) -> DownloadReport {
    let (project_id, path) = (project_id.to_owned(), path.to_owned());
    let pacer = Pacer::default();
    Arc::new(move |done, total| {
        if pacer.due(total.is_some_and(|total| done >= total)) {
            host.download_progress(DownloadProgress {
                project_id: project_id.clone(),
                path: path.clone(),
                done,
                total,
            });
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    use oleafly_collab::doc::NodeKind;

    use super::super::disk_pass::{pause_at, writer_paused};
    use crate::disk::DiskState;

    const FIGURE: &str = "figure.png";

    struct Quiet;

    impl DiskHost for Quiet {}

    fn figure_disk(dir: &Path, old: Option<&[u8]>) -> Arc<LiveDisk> {
        let root = dir.join("project");
        std::fs::create_dir_all(&root).unwrap();
        let mut state = DiskState::default();
        state.layout.insert(
            "figure".to_owned(),
            oleafly_collab::materialize::Placed {
                path: FIGURE.to_owned(),
                kind: NodeKind::Blob,
                blob: Some("blob".to_owned()),
            },
        );
        if let Some(old) = old {
            std::fs::write(root.join(FIGURE), old).unwrap();
            state.hashes.insert(FIGURE.to_owned(), sha256_hex(old));
        }
        let (writer, _signals) = tokio::sync::mpsc::unbounded_channel();
        Arc::new(LiveDisk::assembled(
            "figures",
            root,
            dir.join("materializer-index.json"),
            state,
            Default::default(),
            Arc::new(Quiet),
            writer,
        ))
    }

    fn write_meanwhile(disk: &Arc<LiveDisk>, meanwhile: impl FnOnce(&mut DiskState)) -> Placed {
        let root = disk.root.clone();
        pause_at(&FIGURE_LATE, &root, Some(Duration::from_secs(10)));
        let placing = {
            let disk = Arc::clone(disk);
            std::thread::spawn(move || {
                let hold = disk.root.join("hold");
                disk.write_figure(&hold, FIGURE, "blob", b"figure", &sha256_hex(b"figure"))
            })
        };
        let started = Instant::now();
        while !writer_paused(&root) {
            assert!(
                started.elapsed() < Duration::from_secs(10),
                "the figure write never finished writing"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
        let mut state = disk
            .disk
            .try_lock()
            .expect("the file state stayed locked while the figure was written");
        meanwhile(&mut state);
        drop(state);
        pause_at(&FIGURE_LATE, &root, None);
        placing.join().unwrap()
    }

    #[cfg(unix)]
    #[test]
    fn a_figure_write_leaves_the_file_state_free_while_it_reads_the_file() {
        use std::os::unix::fs::OpenOptionsExt;

        let dir = tempfile::tempdir().unwrap();
        let disk = figure_disk(dir.path(), None);
        let figure = disk.root.join(FIGURE);
        assert!(std::process::Command::new("mkfifo")
            .arg(&figure)
            .status()
            .unwrap()
            .success());
        let hold = dir.path().join("hold");
        let placing = {
            let disk = Arc::clone(&disk);
            std::thread::spawn(move || {
                disk.write_figure(&hold, FIGURE, "blob", b"figure", "content")
            })
        };
        let feed = || {
            std::fs::OpenOptions::new()
                .write(true)
                .custom_flags(libc::O_NONBLOCK)
                .open(&figure)
        };
        let started = Instant::now();
        let reading = loop {
            if let Ok(reading) = feed() {
                break reading;
            }
            assert!(started.elapsed() < Duration::from_secs(10));
            std::thread::sleep(Duration::from_millis(5));
        };
        assert!(
            disk.disk.try_lock().is_ok(),
            "the file state stayed locked while the figure was read"
        );
        drop(reading);
        while !placing.is_finished() {
            assert!(started.elapsed() < Duration::from_secs(10));
            drop(feed());
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(matches!(placing.join().unwrap(), Placed::Conflict));
    }

    #[test]
    fn a_new_figure_the_server_removed_while_it_was_written_is_taken_back() {
        let dir = tempfile::tempdir().unwrap();
        let disk = figure_disk(dir.path(), None);
        let placed = write_meanwhile(&disk, |state| state.layout.clear());
        assert!(matches!(placed, Placed::Dropped));
        assert!(!disk.root.join(FIGURE).exists());
        assert!(guard(&disk.disk).hashes.is_empty());
    }

    #[test]
    fn a_figure_the_server_replaced_again_while_it_was_written_leaves_room_for_the_newer_one() {
        let dir = tempfile::tempdir().unwrap();
        let disk = figure_disk(dir.path(), Some(b"old"));
        let placed = write_meanwhile(&disk, |state| {
            state.layout.get_mut("figure").unwrap().blob = Some("newer".to_owned());
        });
        assert!(matches!(placed, Placed::Dropped));
        assert!(!disk.root.join(FIGURE).exists());
        assert!(guard(&disk.disk).hashes.is_empty());
        let hold = dir.path().join("hold");
        let newer = disk.write_figure(&hold, FIGURE, "newer", b"newer", &sha256_hex(b"newer"));
        assert!(matches!(newer, Placed::Written { added: true }));
        assert_eq!(std::fs::read(disk.root.join(FIGURE)).unwrap(), b"newer");
    }

    #[test]
    fn a_figure_write_keeps_the_hash_another_writer_recorded_meanwhile() {
        let dir = tempfile::tempdir().unwrap();
        let disk = figure_disk(dir.path(), None);
        let placed = write_meanwhile(&disk, |state| {
            state.hashes.insert(FIGURE.to_owned(), "newer".to_owned());
        });
        assert!(matches!(placed, Placed::Written { added: true }));
        assert_eq!(std::fs::read(disk.root.join(FIGURE)).unwrap(), b"figure");
        assert_eq!(
            guard(&disk.disk).hashes.get(FIGURE).map(String::as_str),
            Some("newer")
        );
    }

    #[test]
    fn kept_figures_stay_under_their_cap_by_letting_the_oldest_go() {
        let mut figures = Figures::default();
        for (path, hash) in [("a.png", "a"), ("b.png", "b"), ("c.png", "c")] {
            figures.wanted.insert(path.to_owned(), hash.to_owned());
        }
        let bytes = |size: usize| Arc::new(vec![0u8; size]);
        figures.keep("a", &bytes(40), 100);
        figures.keep("b", &bytes(40), 100);
        assert!(figures.kept("a").is_some() && figures.kept("b").is_some());
        figures.keep("c", &bytes(40), 100);
        assert!(
            figures.kept("a").is_none(),
            "the oldest was kept past the cap"
        );
        assert!(figures.kept("b").is_some() && figures.kept("c").is_some());
        figures.keep("b", &bytes(40), 100);
        figures.keep("a", &bytes(40), 100);
        assert!(
            figures.kept("c").is_none(),
            "keeping a figure again makes it the newest"
        );
        let (picked, _) = figures.due(Instant::now(), 3);
        let fetched: Vec<bool> = picked.iter().map(|(_, _, kept)| kept.is_some()).collect();
        assert_eq!(fetched, vec![true, true, false]);
        figures.keep("c", &bytes(150), 100);
        assert!(
            ["a", "b", "c"]
                .iter()
                .all(|hash| figures.kept(hash).is_none()),
            "a figure larger than the cap is not kept, and pushes the others out"
        );
    }
}
