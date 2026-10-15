use std::collections::BTreeMap;
use std::path::Path;
use std::time::Instant;

use oleafly_collab::materialize::Layout;

use super::bases::WrittenTexts;
use super::session::{guard, lock, Active, Alarm};
use super::unwritten::backoff;
use crate::collab::disk::{exists_exact, inside, move_path, rekey_moved, DiskState};

// When each owed move may be tried again, with the same growing wait as a
// file that can't be written.
#[derive(Default)]
pub(super) struct OwedTries {
    tries: BTreeMap<String, (u32, Instant)>,
    alarm: Alarm,
}

// Tries the owed moves that are due. A move that works carries the files'
// hashes and bases along and is returned. A source that is gone hands its
// paths to its node, so the next scan reads it as deleted. Returns the
// moves made and when the next one is due.
pub(super) fn retry_owed(
    root: &Path,
    disk: &mut DiskState,
    bases: &mut WrittenTexts,
    tries: &mut OwedTries,
    now: Instant,
) -> (Vec<(String, String)>, Option<Instant>) {
    tries.tries.retain(|from, _| disk.owed.contains_key(from));
    let due: Vec<(String, String)> = disk
        .owed
        .iter()
        .filter(|(from, _)| tries.tries.get(*from).is_none_or(|(_, at)| *at <= now))
        .map(|(from, id)| (from.clone(), id.clone()))
        .collect();
    let mut moved = Vec::new();
    for (from, id) in due {
        let Some(to) = disk.layout.get(&id).map(|placed| placed.path.clone()) else {
            disk.owed.remove(&from);
            tries.tries.remove(&from);
            continue;
        };
        let gone = !exists_exact(root, &from);
        if gone || move_path(root, &from, &to) {
            for (old, new) in rekey_moved(&mut disk.hashes, &from, &to) {
                bases.rename(&old, &new);
            }
            disk.owed.remove(&from);
            tries.tries.remove(&from);
            if !gone {
                moved.push((from, to));
            }
        } else {
            let count = tries.tries.get(&from).map_or(0, |(count, _)| *count) + 1;
            tries.tries.insert(from, (count, now + backoff(count)));
        }
    }
    let next = tries.tries.values().map(|(_, at)| *at).min();
    (moved, next)
}

#[cfg(test)]
pub(super) fn owe(active: &Active, from: &str, id: &str, due_in: std::time::Duration) {
    guard(&active.disk)
        .owed
        .insert(from.to_owned(), id.to_owned());
    guard(&active.upkeep.owed)
        .tries
        .insert(from.to_owned(), (1, Instant::now() + due_in));
}

impl Active {
    pub(super) fn settle_owed_moves(&self) {
        let now = Instant::now();
        let (moved, next, alarm) = {
            let mut disk = guard(&self.disk);
            if disk.owed.is_empty() {
                return;
            }
            let mut tries = guard(&self.upkeep.owed);
            let mut bases = guard(&self.bases);
            let before = disk.owed.len();
            let (moved, next) = retry_owed(&self.root, &mut disk, &mut bases, &mut tries, now);
            if disk.owed.len() != before {
                self.save_index_if_changed(&disk);
            }
            (moved, next, tries.alarm.clone())
        };
        self.announce_new_names(moved);
        if let Some(next) = next {
            alarm.ring_in(&self.writer, next.saturating_duration_since(now));
        }
    }

    // Texts whose node sits where an owed move goes wait until the move is
    // done, so the writer never starts the folder under its new name while
    // its files are still under the old one.
    pub(super) fn hold_back_owed(
        &self,
        next: &Layout,
        texts: &mut Vec<(String, String)>,
        owed: &[String],
    ) {
        let mut held = Vec::new();
        texts.retain(|(path, _)| {
            let waits = owed.iter().any(|folder| inside(path, folder));
            if waits {
                held.push(path.clone());
            }
            !waits
        });
        if held.is_empty() {
            return;
        }
        let mut live = lock(&self.live);
        for (id, placed) in next {
            if held.contains(&placed.path) {
                live.mark_dirty(id);
            }
        }
    }
}
