use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use oleafly_collab::materialize::Layout;

use super::session::{guard, lock, Active, WriterSignal};
use crate::collab::disk::{sha256_hex, DiskState};

const PACE: Duration = Duration::from_secs(1);

#[derive(Default)]
struct Pace {
    saved: Option<Instant>,
    owed: bool,
    written: HashMap<String, Instant>,
    index: Option<String>,
    timer: bool,
    #[cfg(test)]
    counted: Counted,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct Counted {
    pub(super) saves: usize,
    pub(super) indexes: usize,
    pub(super) writes: usize,
}

static PACES: LazyLock<Mutex<HashMap<String, Pace>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

impl Active {
    fn paced<T>(&self, work: impl FnOnce(&mut Pace) -> T) -> T {
        work(guard(&PACES).entry(self.project_id.clone()).or_default())
    }

    pub(super) fn save_owed(&self) -> bool {
        self.paced(|pace| pace.owed)
    }

    pub(super) fn save_due(&self, urgent: bool) -> bool {
        let due = self.paced(|pace| {
            let due = urgent || pace.saved.is_none_or(|at| at.elapsed() >= PACE);
            if due {
                pace.saved = Some(Instant::now());
                pace.owed = false;
                #[cfg(test)]
                {
                    pace.counted.saves += 1;
                }
            } else {
                pace.owed = true;
            }
            due
        });
        if !due {
            self.come_back_later();
        }
        due
    }

    pub(super) fn hold_back_typing(&self, next: &Layout, texts: &mut Vec<(String, String)>) {
        let lately = self.paced(|pace| {
            pace.written.retain(|_, at| at.elapsed() < PACE);
            pace.written.clone()
        });
        if lately.is_empty() {
            return;
        }
        let mut held = Vec::new();
        {
            let mut live = lock(&self.live);
            texts.retain(|(path, _)| {
                if !lately.contains_key(path) {
                    return true;
                }
                let open = next
                    .iter()
                    .find(|(_, placed)| placed.path == *path)
                    .filter(|(id, _)| live.is_open(id))
                    .map(|(id, _)| id.clone());
                match open {
                    Some(id) => {
                        held.push(id);
                        false
                    }
                    None => true,
                }
            });
            for id in &held {
                live.mark_dirty(id);
            }
        }
        if !held.is_empty() {
            self.come_back_later();
        }
    }

    pub(super) fn note_written<'a>(&self, paths: impl IntoIterator<Item = &'a String>) {
        self.paced(|pace| {
            let now = Instant::now();
            for path in paths {
                pace.written.insert(path.clone(), now);
                #[cfg(test)]
                {
                    pace.counted.writes += 1;
                }
            }
        });
    }

    pub(super) fn save_index_if_changed(&self, disk: &DiskState) {
        let Ok(json) = serde_json::to_vec(disk) else {
            return;
        };
        let fingerprint = sha256_hex(&json);
        if self.paced(|pace| pace.index.as_deref() == Some(fingerprint.as_str())) {
            return;
        }
        if oleafly_collab::write_atomic(&self.disk_file, &json).is_ok() {
            self.paced(|pace| {
                pace.index = Some(fingerprint);
                #[cfg(test)]
                {
                    pace.counted.indexes += 1;
                }
            });
        }
    }

    fn come_back_later(&self) {
        if self.paced(|pace| std::mem::replace(&mut pace.timer, true)) {
            return;
        }
        let writer = self.writer.clone();
        let project_id = self.project_id.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(PACE).await;
            if let Some(pace) = guard(&PACES).get_mut(&project_id) {
                pace.timer = false;
            }
            let _ = writer.send(WriterSignal::Kick);
        });
    }

    #[cfg(test)]
    pub(super) fn counted(&self) -> Counted {
        self.paced(|pace| pace.counted)
    }
}
