use std::time::Instant;

pub(super) use oleafly_live::live::owed::*;

use super::session::{guard, Active};

#[cfg(test)]
pub(super) fn owe(active: &Active, from: &str, id: &str, due_in: std::time::Duration) {
    guard(&active.local.disk)
        .owed
        .insert(from.to_owned(), id.to_owned());
    guard(&active.local.upkeep.owed)
        .tries
        .insert(from.to_owned(), (1, Instant::now() + due_in));
}

impl Active {
    pub(super) fn settle_owed_moves(&self) -> Vec<String> {
        let now = Instant::now();
        let (moved, ids, next, alarm) = {
            let mut disk = guard(&self.local.disk);
            if disk.owed.is_empty() {
                return Vec::new();
            }
            let owed = disk.owed.clone();
            let mut tries = guard(&self.local.upkeep.owed);
            let mut bases = guard(&self.local.bases);
            let before = disk.owed.len();
            let (moved, next) =
                retry_owed(&self.local.root, &mut disk, &mut bases, &mut tries, now);
            if disk.owed.len() != before {
                self.local.save_index_if_changed(&disk);
            }
            let ids = moved
                .iter()
                .filter_map(|(from, _)| owed.get(from).cloned())
                .collect();
            (moved, ids, next, tries.alarm.clone())
        };
        self.announce_new_names(moved);
        if let Some(next) = next {
            alarm.ring_in(&self.local, next.saturating_duration_since(now));
        }
        ids
    }

    pub(super) fn written_at(&self, ids: &[String]) -> Vec<String> {
        let disk = guard(&self.local.disk);
        ids.iter()
            .filter_map(|id| disk.layout.get(id).map(|placed| placed.path.clone()))
            .collect()
    }
}
