use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

use oleafly_collab::doc::NodeKind;
use oleafly_collab::sync::LiveLink;
use tokio::sync::Notify;
use tokio::task::{AbortHandle, Id, JoinSet};

use super::disk_pass::{figure_state, FigureState};
use super::session::{guard, Active};
use super::unwritten::{backoff, reason_of, Settled, UnwrittenReason};
use crate::collab::commands::with_access;
use crate::collab::disk::{safe_target, sha256_hex, write_file_over, WriteOutcome};
use crate::folder_watch::FolderChange;

// A few figures download at once, so one stalled transfer never holds up
// the others.
const AT_ONCE: usize = 3;

type Bytes = Arc<Vec<u8>>;

#[derive(Default)]
pub(super) struct Figures {
    wanted: BTreeMap<String, String>,
    failing: BTreeMap<String, Failure>,
    // Figures that downloaded fine but could not be written yet, so the
    // next try writes them without fetching them again.
    fetched: BTreeMap<String, Bytes>,
    in_flight: BTreeMap<String, String>,
    running: bool,
    closed: bool,
    wake: Arc<Notify>,
    landed: Arc<Notify>,
}

struct Failure {
    hash: String,
    attempts: u32,
    next: Instant,
}

enum Placed {
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

    // The figures to start now, at most `room` of them, each with its bytes
    // when an earlier try downloaded them already, and the wait until the
    // next figure that is backing off may be tried.
    fn due(&mut self, now: Instant, room: usize) -> (Picked, Option<Duration>) {
        let wanted = &self.wanted;
        self.failing
            .retain(|path, failure| wanted.get(path) == Some(&failure.hash));
        self.fetched
            .retain(|hash, _| wanted.values().any(|wanted| wanted == hash));
        let picked: Picked = self
            .wanted
            .iter()
            .filter(|(path, _)| !self.in_flight.contains_key(*path) && !self.backing_off(path, now))
            .take(room)
            .map(|(path, hash)| (path.clone(), hash.clone(), self.fetched.get(hash).cloned()))
            .collect();
        let wait = self
            .failing
            .iter()
            .filter(|(path, failure)| !self.in_flight.contains_key(*path) && failure.next > now)
            .map(|(_, failure)| failure.next - now)
            .min();
        (picked, wait)
    }

    // Downloads in progress, or about to start because nothing holds them
    // back. A figure that is backing off after a failure doesn't count.
    fn busy(&self, now: Instant) -> bool {
        !self.in_flight.is_empty() || self.wanted.keys().any(|path| !self.backing_off(path, now))
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

impl Active {
    pub(super) fn want_figures(self: &Arc<Self>, wanted: Vec<(String, String)>) {
        let start = {
            let mut figures = guard(&self.upkeep.figures);
            if figures.closed {
                return;
            }
            figures.wanted = wanted.into_iter().collect();
            figures.wake.notify_one();
            !figures.wanted.is_empty() && !std::mem::replace(&mut figures.running, true)
        };
        if start {
            tauri::async_runtime::spawn(fetch_figures(Arc::downgrade(self)));
        }
    }

    pub(super) fn close_figures(&self) {
        let mut figures = guard(&self.upkeep.figures);
        figures.closed = true;
        figures.wanted.clear();
        figures.fetched.clear();
        figures.wake.notify_one();
    }

    // A flush waits up to `limit` for figures that are downloading or about
    // to, so a compile right after a figure arrives finds it on disk.
    pub(super) async fn wait_for_figures(&self, limit: Duration) {
        let deadline = Instant::now() + limit;
        loop {
            let landed = Arc::clone(&guard(&self.upkeep.figures).landed);
            let notified = landed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let now = Instant::now();
            if !guard(&self.upkeep.figures).busy(now) || now >= deadline {
                return;
            }
            let _ = tokio::time::timeout(deadline - now, notified).await;
        }
    }

    #[cfg(test)]
    pub(super) fn figures_running(&self) -> bool {
        guard(&self.upkeep.figures).running
    }

    async fn place_figure(&self, path: &str, hash: &str, fetched: Option<Bytes>, last: bool) {
        let placed = {
            let mut figures = guard(&self.upkeep.figures);
            figures.in_flight.remove(path);
            if figures.closed || figures.wanted.get(path).map(String::as_str) != Some(hash) {
                Placed::Dropped
            } else {
                let placed = match &fetched {
                    None => Placed::Failed(UnwrittenReason::NotDownloaded),
                    Some(bytes) => self.write_figure(path, hash, bytes),
                };
                if matches!(placed, Placed::Failed(_)) {
                    if let Some(bytes) = &fetched {
                        figures.fetched.insert(hash.to_owned(), Arc::clone(bytes));
                    }
                    figures.failed(path, hash);
                } else {
                    figures.settled(path);
                }
                placed
            }
        };
        if last {
            let disk = guard(&self.disk);
            self.save_index_if_changed(&disk);
        }
        let landed = Arc::clone(&guard(&self.upkeep.figures).landed);
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
            Placed::Conflict => {
                let _ = self.import_paths(Some(vec![path.to_owned()])).await;
                return;
            }
            Placed::Dropped => return,
        };
        let layout = guard(&self.disk).layout.clone();
        self.settle_unwritten(&layout, settled);
        if let Placed::Written { added } = placed {
            self.host.folder_changed(FolderChange {
                project_id: self.project_id.clone(),
                paths: vec![path.to_owned()],
                rescan: false,
                structural: added,
                renamed: Vec::new(),
                deleted: Vec::new(),
            });
        }
    }

    fn write_figure(&self, path: &str, hash: &str, bytes: &[u8]) -> Placed {
        if !self.root.is_dir() || super::sync_hold::keeps_back(&self.hold_dir(), path) {
            return Placed::Dropped;
        }
        let mut disk = guard(&self.disk);
        let still_placed = disk.layout.values().any(|placed| {
            placed.kind == NodeKind::Blob
                && placed.path == path
                && placed.blob.as_deref() == Some(hash)
        });
        if !still_placed || disk.hashes.get(path).map(String::as_str) == Some(hash) {
            return Placed::Dropped;
        }
        let added = safe_target(&self.root, path)
            .is_some_and(|target| std::fs::symlink_metadata(target).is_err());
        let placed = match figure_state(&self.root, &disk, path, hash) {
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
        disk.hashes.insert(path.to_owned(), hash.to_owned());
        placed
    }
}

async fn waited(wait: Option<Duration>) {
    match wait {
        Some(wait) => tokio::time::sleep(wait).await,
        None => std::future::pending().await,
    }
}

// Downloads the figures the writer asked for, a few at a time. A download
// whose figure is no longer wanted, or whose session closed, stops at once
// instead of running out its transfer timeout.
async fn fetch_figures(session: Weak<Active>) {
    let mut downloads: JoinSet<(String, String, Option<Bytes>)> = JoinSet::new();
    let mut running: BTreeMap<String, (String, AbortHandle)> = BTreeMap::new();
    let mut paths_of: BTreeMap<Id, String> = BTreeMap::new();
    loop {
        let (picked, wait, wake, link) = {
            let Some(active) = session.upgrade() else {
                return;
            };
            let mut figures = guard(&active.upkeep.figures);
            running.retain(|path, (hash, abort)| {
                let keep = !figures.closed && figures.wanted.get(path) == Some(hash);
                if !keep {
                    abort.abort();
                    figures.in_flight.remove(path);
                }
                keep
            });
            let room = AT_ONCE.saturating_sub(running.len());
            let (picked, wait) = if figures.closed {
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
            (picked, wait, Arc::clone(&figures.wake), active.link.clone())
        };
        for (path, hash, kept) in picked {
            let (link, wanted) = (link.clone(), hash.clone());
            let task_path = path.clone();
            let abort = downloads.spawn(async move {
                let bytes = match kept {
                    Some(bytes) => Some(bytes),
                    None => fetch(&link, &wanted).await.map(Arc::new),
                };
                (task_path, wanted, bytes)
            });
            paths_of.insert(abort.id(), path.clone());
            running.insert(path, (hash, abort));
        }
        tokio::select! {
            Some(done) = downloads.join_next_with_id(), if !downloads.is_empty() => {
                let finished = match done {
                    Ok((id, outcome)) => {
                        paths_of.remove(&id);
                        Some(outcome)
                    }
                    Err(error) => {
                        if let Some(path) = paths_of.remove(&error.id()) {
                            running.remove(&path);
                            if let Some(active) = session.upgrade() {
                                guard(&active.upkeep.figures).in_flight.remove(&path);
                            }
                        }
                        None
                    }
                };
                let Some((path, hash, bytes)) = finished else {
                    continue;
                };
                running.remove(&path);
                let Some(active) = session.upgrade() else {
                    return;
                };
                active.place_figure(&path, &hash, bytes, running.is_empty()).await;
            }
            () = wake.notified() => {}
            () = waited(wait) => {}
        }
    }
}

async fn fetch(link: &LiveLink, hash: &str) -> Option<Vec<u8>> {
    let project = link.project;
    with_access(
        &link.sessions,
        link.server_id,
        &link.client,
        |client, access| {
            let hash = hash.to_owned();
            Box::pin(async move { client.get_blob(access, project, &hash).await })
        },
    )
    .await
    .ok()
    .filter(|bytes| sha256_hex(bytes) == hash)
}
