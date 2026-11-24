use std::collections::BTreeSet;
use std::future::Future;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use oleafly_collab::live::LiveProject;
use oleafly_collab::sync::SharedLive;
use oleafly_collab::CollabError;
use oleafly_core::app_log::AppLog;
use tokio::runtime::Handle;
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use super::bases::WrittenTexts;
use super::host::DiskHost;
use crate::disk::DiskState;

pub enum WriterSignal {
    Kick,
    Flush(oneshot::Sender<()>),
}

pub struct LiveDisk {
    pub project_id: String,
    pub root: PathBuf,
    pub disk_file: PathBuf,
    pub disk: Mutex<DiskState>,
    pub bases: Mutex<WrittenTexts>,
    pub host: Arc<dyn DiskHost>,
    pub writer: UnboundedSender<WriterSignal>,
    pub upkeep: Upkeep,
    pub runtime: Handle,
    pub log: AppLog,
}

#[derive(Clone, Default)]
pub struct Alarm(Arc<Mutex<Option<Instant>>>);

impl Alarm {
    pub fn ring_in(&self, disk: &LiveDisk, delay: Duration) {
        let at = Instant::now() + delay;
        {
            let mut pending = guard(&self.0);
            if pending.is_some_and(|due| due <= at) {
                return;
            }
            *pending = Some(at);
        }
        let (alarm, writer) = (Arc::clone(&self.0), disk.writer.clone());
        disk.spawn(async move {
            tokio::time::sleep(delay).await;
            {
                let mut pending = guard(&alarm);
                if *pending == Some(at) {
                    *pending = None;
                }
            }
            let _ = writer.send(WriterSignal::Kick);
        });
    }
}

#[derive(Default)]
pub struct Upkeep {
    pub pace: Mutex<super::pacing::Pace>,
    pub failing: Mutex<super::unwritten::Failing>,
    pub figures: Mutex<super::downloads::Figures>,
    pub figures_closed: AtomicBool,
    pub owed: Mutex<super::owed::OwedTries>,
    pub unannounced: Mutex<BTreeSet<String>>,
    pub logged: Mutex<BTreeSet<&'static str>>,
}

pub async fn off_runtime<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())
}

pub fn guard<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn lock(live: &SharedLive) -> MutexGuard<'_, LiveProject> {
    live.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn not_live() -> CollabError {
    CollabError::Api {
        status: 404,
        code: "not_found".to_owned(),
        message: "this project is not live".to_owned(),
    }
}

pub fn io(error: impl std::fmt::Display) -> CollabError {
    CollabError::Io(error.to_string())
}

#[cfg(any(test, feature = "test-support"))]
fn test_runtime() -> Handle {
    static RUNTIME: std::sync::OnceLock<tokio::runtime::Runtime> = std::sync::OnceLock::new();
    RUNTIME
        .get_or_init(|| {
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .expect("a test runtime")
        })
        .handle()
        .clone()
}

impl LiveDisk {
    pub fn spawn<F>(&self, work: F) -> JoinHandle<F::Output>
    where
        F: Future + Send + 'static,
        F::Output: Send + 'static,
    {
        self.runtime.spawn(work)
    }

    pub fn log(&self, line: impl Into<String>) {
        let _ = self.log.write(&line.into());
    }

    pub fn log_once(&self, kind: &'static str, message: impl FnOnce() -> String) {
        if !guard(&self.upkeep.logged).insert(kind) {
            return;
        }
        self.log(format!(
            "Live editing in project {}: {}",
            self.project_id,
            message()
        ));
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn assembled(
        project_id: &str,
        root: PathBuf,
        disk_file: PathBuf,
        disk: DiskState,
        bases: WrittenTexts,
        host: Arc<dyn DiskHost>,
        writer: UnboundedSender<WriterSignal>,
    ) -> LiveDisk {
        let log = AppLog::at(disk_file.parent().unwrap_or(&root));
        LiveDisk {
            project_id: project_id.to_owned(),
            root,
            disk_file,
            disk: Mutex::new(disk),
            bases: Mutex::new(bases),
            host,
            writer,
            upkeep: Upkeep::default(),
            runtime: test_runtime(),
            log,
        }
    }

    pub fn note_unannounced(
        &self,
        typed_here: &BTreeSet<String>,
        told: &BTreeSet<String>,
        moved: &[(String, String)],
        removed: &[String],
    ) {
        let mut unannounced = guard(&self.upkeep.unannounced);
        if unannounced.is_empty() && typed_here.is_empty() {
            return;
        }
        let kept = std::mem::take(&mut *unannounced);
        *unannounced = kept
            .into_iter()
            .filter(|path| {
                !told.contains(path) && !removed.iter().any(|gone| crate::disk::inside(path, gone))
            })
            .map(|path| {
                moved
                    .iter()
                    .find_map(|(from, to)| crate::disk::moved_key(&path, from, to))
                    .unwrap_or(path)
            })
            .collect();
        unannounced.extend(typed_here.iter().cloned());
    }

    pub fn forget_memory(&self) {
        super::moves::forget_announced(&self.root);
    }

    pub fn announce_written(&self) {
        let paths = std::mem::take(&mut *guard(&self.upkeep.unannounced));
        if paths.is_empty() {
            return;
        }
        let known: Vec<(String, String)> = {
            let disk = guard(&self.disk);
            paths
                .into_iter()
                .filter_map(|path| {
                    let hash = disk.hashes.get(&path)?.clone();
                    Some((path, hash))
                })
                .collect()
        };
        let files: Vec<super::payloads::WrittenFile> = known
            .into_iter()
            .filter_map(|(path, hash)| {
                let target = crate::disk::safe_target(&self.root, &path)?;
                let bytes = std::fs::read(target).ok()?;
                if crate::disk::sha256_hex(&bytes) != hash {
                    return None;
                }
                let text = std::str::from_utf8(&bytes).ok()?;
                Some(super::payloads::WrittenFile {
                    hash: super::payloads::window_hash(&bytes),
                    crlf: crate::disk::crlf_only(&bytes) == Some(true),
                    length: text.encode_utf16().count(),
                    path,
                })
            })
            .collect();
        if !files.is_empty() {
            self.host.written(super::payloads::WrittenPayload {
                project_id: self.project_id.clone(),
                files,
            });
        }
    }
}
