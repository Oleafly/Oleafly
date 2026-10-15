use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use oleafly_collab_protocol::ids::SharedProjectId;
use tokio::time::Instant;

use super::{Budgeted, Snapshots};

// What a document is kept for. Each use keeps its own copy of a project, so
// the copies of one use can go without the other's.
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

// Kept documents may hold this share of the snapshot memory budget between
// them. The document kept last stays whatever its size, so the project
// being checked is never read again for every change.
const KEPT_SHARE: u64 = 2;

struct Entry {
    replay: Budgeted,
    seq: u64,
    used: Instant,
}

type Entries = HashMap<(Keep, SharedProjectId), Entry>;

// Documents kept between comment checks and mention scans, so the next one
// for a project starts from them instead of reading the project again. Each
// keeps its share of the snapshot memory budget, but only while nothing else
// needs that memory: a reservation that doesn't fit takes it from kept
// documents first, least recently used first, so a document that is only
// being kept never makes a check, a scan or a build wait.
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

    // Takes the least recently used document out, for the caller to drop
    // once no lock is held, since dropping it returns its reservation.
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
    pub fn take_kept(&self, keep: Keep, project: SharedProjectId) -> Option<(Budgeted, u64)> {
        let (taken, _idle) = {
            let mut entries = self.kept.lock();
            let idle = idle(&mut entries, Instant::now());
            (entries.remove(&(keep, project)), idle)
        };
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
        drop(dropped);
    }

    pub fn forget_kept(&self, keep: Keep, project: SharedProjectId) {
        let forgotten = self.kept.lock().remove(&(keep, project));
        drop(forgotten);
    }

    pub fn clear_kept(&self, keep: Keep) {
        let cleared: Vec<Entry> = self
            .kept
            .lock()
            .extract_if(|(kept_for, _), _| *kept_for == keep)
            .map(|(_, entry)| entry)
            .collect();
        drop(cleared);
    }

    // Drops documents nobody has used for a while. Returns how many went.
    pub fn sweep_kept(&self) -> usize {
        let swept = idle(&mut self.kept.lock(), Instant::now());
        swept.len()
    }

    pub fn kept_bytes(&self) -> u64 {
        self.kept.bytes()
    }
}
