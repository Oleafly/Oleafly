use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use oleafly_collab::materialize::Layout;

use super::session::{guard, lock, Active, WriterSignal};
use super::unwritten::backoff;
use crate::collab::disk::{sha256_hex, DiskState};

const PACE: Duration = Duration::from_secs(1);

#[derive(Default)]
pub(super) struct Pace {
    saved: Option<Instant>,
    owed: bool,
    failures: u32,
    written: HashMap<String, Instant>,
    index: Option<String>,
    timer: Arc<AtomicBool>,
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

impl Active {
    fn paced<T>(&self, work: impl FnOnce(&mut Pace) -> T) -> T {
        work(&mut guard(&self.upkeep.pace))
    }

    pub(super) fn save_owed(&self) -> bool {
        self.paced(|pace| pace.owed)
    }

    pub(super) fn save_due(&self, urgent: bool) -> bool {
        let (due, gap) = self.paced(|pace| {
            let gap = if pace.failures == 0 {
                PACE
            } else {
                backoff(pace.failures)
            };
            let due = urgent || pace.saved.is_none_or(|at| at.elapsed() >= gap);
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
            (due, gap)
        });
        if !due {
            self.come_back_in(gap);
        }
        due
    }

    pub(super) async fn save_document(&self) {
        let saved = self.persist().await;
        let failures = self.paced(|pace| {
            if saved.is_ok() {
                pace.failures = 0;
            } else {
                pace.failures = pace.failures.saturating_add(1);
                pace.owed = true;
            }
            pace.failures
        });
        let Err(error) = saved else {
            return;
        };
        if failures == 1 {
            let _ = crate::project::append_app_log(format!(
                "Live collaboration could not save the shared document of project {}: {error}; it tries again",
                self.project_id
            ));
        }
        self.come_back_in(backoff(failures));
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
            self.come_back_in(PACE);
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

    fn come_back_in(&self, delay: Duration) {
        let timer = self.paced(|pace| Arc::clone(&pace.timer));
        if timer.swap(true, Ordering::SeqCst) {
            return;
        }
        let writer = self.writer.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(delay).await;
            timer.store(false, Ordering::SeqCst);
            let _ = writer.send(WriterSignal::Kick);
        });
    }

    #[cfg(test)]
    pub(super) fn counted(&self) -> Counted {
        self.paced(|pace| pace.counted)
    }
}
