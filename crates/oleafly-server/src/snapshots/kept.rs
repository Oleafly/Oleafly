use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use oleafly_collab_protocol::ids::SharedProjectId;
use tokio::time::Instant;

use super::{Budgeted, Snapshots};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Keep {
    CommentChecks,
    MentionScans,
}

impl Keep {
    fn idle_after(self) -> Duration {
        match self {
            Keep::CommentChecks => Duration::from_secs(15 * 60),
            Keep::MentionScans => Duration::from_secs(5 * 60),
        }
    }
}

const KEPT_SHARE: u64 = 2;

struct Entry {
    replay: Budgeted,
    seq: u64,
    used: Instant,
}

type Entries = HashMap<(Keep, SharedProjectId), Entry>;

#[derive(Default)]
pub(super) struct KeptDocuments {
    entries: Mutex<Entries>,
}

impl KeptDocuments {
    fn lock(&self) -> MutexGuard<'_, Entries> {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(super) fn bytes(&self) -> u64 {
        self.lock()
            .values()
            .map(|entry| entry.replay.reserved_bytes())
            .sum()
    }

    pub(super) fn least_recent(&self) -> Option<Budgeted> {
        let mut entries = self.lock();
        let oldest = entries
            .iter()
            .min_by_key(|(_, entry)| entry.used)
            .map(|(key, _)| *key)?;
        entries.remove(&oldest).map(|entry| entry.replay)
    }
}

fn idle(entries: &mut Entries, now: Instant) -> Vec<Entry> {
    entries
        .extract_if(|(keep, _), entry| now.duration_since(entry.used) >= keep.idle_after())
        .map(|(_, entry)| entry)
        .collect()
}

impl Snapshots {
    fn free_entries(&self, entries: Vec<Entry>) -> usize {
        let count = entries.len();
        self.free(entries.into_iter().map(|entry| entry.replay));
        count
    }

    pub fn take_kept(&self, keep: Keep, project: SharedProjectId) -> Option<(Budgeted, u64)> {
        let (taken, idle) = {
            let mut entries = self.kept.lock();
            let idle = idle(&mut entries, Instant::now());
            (entries.remove(&(keep, project)), idle)
        };
        self.free_entries(idle);
        taken.map(|entry| (entry.replay, entry.seq))
    }

    pub fn keep(&self, keep: Keep, project: SharedProjectId, replay: Budgeted, seq: u64) {
        let cap = self.budget().memory_bytes / KEPT_SHARE;
        let now = Instant::now();
        let mut dropped = Vec::new();
        {
            let mut entries = self.kept.lock();
            dropped.extend(idle(&mut entries, now));
            let key = (keep, project);
            dropped.extend(entries.insert(
                key,
                Entry {
                    replay,
                    seq,
                    used: now,
                },
            ));
            let mut total: u64 = entries
                .values()
                .map(|entry| entry.replay.reserved_bytes())
                .sum();
            while total > cap {
                let oldest = entries
                    .iter()
                    .filter(|(other, _)| **other != key)
                    .min_by_key(|(_, entry)| entry.used)
                    .map(|(other, _)| *other);
                let Some(entry) = oldest.and_then(|oldest| entries.remove(&oldest)) else {
                    break;
                };
                total = total.saturating_sub(entry.replay.reserved_bytes());
                dropped.push(entry);
            }
        }
        self.free_entries(dropped);
    }

    pub fn forget_kept(&self, keep: Keep, project: SharedProjectId) {
        let forgotten = self.kept.lock().remove(&(keep, project));
        self.free_entries(forgotten.into_iter().collect());
    }

    pub fn clear_kept(&self, keep: Keep) {
        let cleared: Vec<Entry> = self
            .kept
            .lock()
            .extract_if(|(kept_for, _), _| *kept_for == keep)
            .map(|(_, entry)| entry)
            .collect();
        self.free_entries(cleared);
    }

    pub fn sweep_kept(&self) -> usize {
        let swept = idle(&mut self.kept.lock(), Instant::now());
        self.free_entries(swept)
    }

    pub fn kept_bytes(&self) -> u64 {
        self.kept.bytes()
    }
}
