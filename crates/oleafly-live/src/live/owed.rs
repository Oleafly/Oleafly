use std::collections::BTreeMap;
use std::path::Path;
use std::time::Instant;

use oleafly_collab::materialize::Layout;

use super::bases::WrittenTexts;
use super::live_tree::LiveTree;
use super::session::{Alarm, LiveDisk};
use super::unwritten::backoff;
use crate::disk::{exists_exact, inside, move_path, rekey_moved, DiskState};

#[derive(Default)]
pub struct OwedTries {
    pub tries: BTreeMap<String, (u32, Instant)>,
    pub alarm: Alarm,
}

pub fn retry_owed(
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

impl LiveDisk {
    pub fn hold_back_owed(
        &self,
        tree: &dyn LiveTree,
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
        let ids: Vec<String> = next
            .iter()
            .filter(|(_, placed)| held.contains(&placed.path))
            .map(|(id, _)| id.clone())
            .collect();
        tree.mark_dirty(&ids);
    }
}
