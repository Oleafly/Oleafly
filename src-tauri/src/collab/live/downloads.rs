use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

use oleafly_collab::doc::NodeKind;
use oleafly_collab::sync::LiveLink;
use tokio::sync::Notify;

use super::disk_pass::{figure_state, FigureState};
use super::session::{guard, Active};
use super::unwritten::{backoff, reason_of, Settled, UnwrittenReason};
use crate::collab::commands::with_access;
use crate::collab::disk::{safe_target, sha256_hex, write_file_over, WriteOutcome};
use crate::folder_watch::FolderChange;

#[derive(Default)]
pub(super) struct Figures {
    wanted: BTreeMap<String, String>,
    failing: BTreeMap<String, Failure>,
    running: bool,
    closed: bool,
    wake: Arc<Notify>,
    #[cfg(test)]
    asked: usize,
}

struct Failure {
    hash: String,
    attempts: u32,
    next: Instant,
}

enum Next {
    Fetch(String, String),
    Wait(Duration),
    Idle,
}

enum Placed {
    Written { added: bool },
    Already,
    Conflict,
    Failed(UnwrittenReason),
    Dropped,
}

impl Figures {
    fn next(&mut self, now: Instant) -> Next {
        if self.closed {
            return Next::Idle;
        }
        let wanted = &self.wanted;
        self.failing
            .retain(|path, failure| wanted.get(path) == Some(&failure.hash));
        let failing = &self.failing;
        let due = self
            .wanted
            .iter()
            .find(|(path, _)| failing.get(*path).is_none_or(|failure| failure.next <= now));
        if let Some((path, hash)) = due {
            return Next::Fetch(path.clone(), hash.clone());
        }
        match self.failing.values().map(|failure| failure.next).min() {
            Some(next) => Next::Wait(next.saturating_duration_since(now)),
            None => Next::Idle,
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
        figures.wake.notify_one();
    }

    #[cfg(test)]
    pub(super) fn figures_asked(&self) -> usize {
        guard(&self.upkeep.figures).asked
    }

    async fn place_figure(&self, path: &str, hash: &str, fetched: Option<Vec<u8>>) {
        let placed = {
            let mut figures = guard(&self.upkeep.figures);
            if figures.closed || figures.wanted.get(path).map(String::as_str) != Some(hash) {
                return;
            }
            let placed = match &fetched {
                None => Placed::Failed(UnwrittenReason::NotDownloaded),
                Some(bytes) => self.write_figure(path, hash, bytes),
            };
            if matches!(placed, Placed::Failed(_)) {
                figures.failed(path, hash);
            } else {
                figures.settled(path);
            }
            placed
        };
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
        self.save_index_if_changed(&disk);
        placed
    }
}

async fn fetch_figures(session: Weak<Active>) {
    loop {
        let (next, wake, link) = {
            let Some(active) = session.upgrade() else {
                return;
            };
            let mut figures = guard(&active.upkeep.figures);
            let next = figures.next(Instant::now());
            if matches!(next, Next::Idle) {
                figures.running = false;
            }
            #[cfg(test)]
            if matches!(next, Next::Fetch(..)) {
                figures.asked += 1;
            }
            (next, Arc::clone(&figures.wake), active.link.clone())
        };
        match next {
            Next::Idle => return,
            Next::Wait(wait) => {
                tokio::select! {
                    () = tokio::time::sleep(wait) => {}
                    () = wake.notified() => {}
                }
            }
            Next::Fetch(path, hash) => {
                let fetched = fetch(&link, &hash).await;
                let Some(active) = session.upgrade() else {
                    return;
                };
                active.place_figure(&path, &hash, fetched).await;
            }
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
