use std::collections::HashMap;
use std::time::{Duration, Instant};

use oleafly_collab::materialize::Layout;
use oleafly_collab::CollabError;

use super::live_tree::LiveTree;
use super::session::{guard, Alarm, LiveDisk};
use crate::disk::{sha256_hex, DiskState};

pub const PACE: Duration = Duration::from_secs(1);

#[derive(Default)]
pub struct Pace {
    pub saved: Option<Instant>,
    pub owed: bool,
    pub failures: u32,
    pub written: HashMap<String, Instant>,
    pub index: Option<String>,
    pub timer: Alarm,
    #[cfg(any(test, feature = "test-support"))]
    pub counted: Counted,
}

impl LiveDisk {
    pub fn hold_back_typing(
        &self,
        tree: &dyn LiveTree,
        next: &Layout,
        texts: &mut Vec<(String, String)>,
    ) {
        let lately = self.paced(|pace| {
            pace.written.retain(|_, at| at.elapsed() < PACE);
            pace.written.clone()
        });
        if lately.is_empty() {
            return;
        }
        let id_at = |path: &str| {
            next.iter()
                .find(|(_, placed)| placed.path == path)
                .map(|(id, _)| id.clone())
        };
        let candidates: Vec<String> = texts
            .iter()
            .filter(|(path, _)| lately.contains_key(path))
            .filter_map(|(path, _)| id_at(path))
            .collect();
        let open = tree.open(&candidates);
        let mut held = Vec::new();
        texts.retain(|(path, _)| {
            if !lately.contains_key(path) {
                return true;
            }
            match id_at(path).filter(|id| open.contains(id)) {
                Some(id) => {
                    held.push(id);
                    false
                }
                None => true,
            }
        });
        if held.is_empty() {
            return;
        }
        tree.mark_dirty(&held);
        self.come_back_in(PACE);
    }

    pub fn paced<T>(&self, work: impl FnOnce(&mut Pace) -> T) -> T {
        work(&mut guard(&self.upkeep.pace))
    }

    pub fn write_index(&self, json: &[u8], fingerprint: String) -> Result<(), CollabError> {
        oleafly_collab::write_atomic(&self.disk_file, json)?;
        self.paced(|pace| {
            pace.index = Some(fingerprint);
            #[cfg(any(test, feature = "test-support"))]
            {
                pace.counted.indexes += 1;
            }
        });
        Ok(())
    }

    pub fn save_index(&self, disk: &DiskState) -> Result<(), CollabError> {
        let json =
            serde_json::to_vec(disk).map_err(|error| CollabError::Corrupt(error.to_string()))?;
        let fingerprint = sha256_hex(&json);
        self.write_index(&json, fingerprint)
    }

    pub fn index_change(&self, disk: &DiskState) -> Option<(Vec<u8>, String)> {
        let json = serde_json::to_vec(disk).ok()?;
        let fingerprint = sha256_hex(&json);
        let same = self.paced(|pace| pace.index.as_deref() == Some(fingerprint.as_str()));
        (!same).then_some((json, fingerprint))
    }

    pub fn save_index_if_changed(&self, disk: &DiskState) {
        if let Some((json, fingerprint)) = self.index_change(disk) {
            let _ = self.write_index(&json, fingerprint);
        }
    }

    pub fn come_back_in(&self, delay: Duration) {
        self.paced(|pace| pace.timer.clone()).ring_in(self, delay);
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn counted(&self) -> Counted {
        self.paced(|pace| pace.counted)
    }

    pub fn note_written<'a>(&self, paths: impl IntoIterator<Item = &'a String>) {
        self.paced(|pace| {
            let now = Instant::now();
            for path in paths {
                pace.written.insert(path.clone(), now);
                #[cfg(any(test, feature = "test-support"))]
                {
                    pace.counted.writes += 1;
                }
            }
        });
    }
}

#[cfg(any(test, feature = "test-support"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counted {
    pub saves: usize,
    pub indexes: usize,
    pub writes: usize,
}
