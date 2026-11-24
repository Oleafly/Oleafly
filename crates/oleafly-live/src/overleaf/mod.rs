pub mod binaries;
pub mod hooks;
pub mod notices;
pub mod opening;
pub mod people;
pub mod port;
#[cfg(test)]
mod tests;
pub mod tree;
pub mod tree_events;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant};

use oleafly_collab::live::DiskWork;
use oleafly_collab::sync::LiveStatus;
use oleafly_collab::CollabError;
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_core::app_log::AppLog;
use oleafly_online::git::MirrorGit;
use oleafly_online::live::journal::{self, Journal};
use oleafly_online::live::session::{LiveError, OverleafSession, Seed, SessionConfig};
use oleafly_online::projects::OverleafLink;
use oleafly_online::realtime::events::plain_id;
use oleafly_online::realtime::DocId;
use oleafly_ot::{DocMessage, DocSink};
use tokio::runtime::Handle;
use tokio::sync::{mpsc, oneshot};

pub use hooks::MirrorHooks;
pub use port::MirrorPort;
pub use tree_events::{TreeNotice, TreeNoticeKind, TREE_EVENT};

use crate::disk::{read_text, DiskState};
use crate::live::bases::{merged_onto, WrittenTexts};
use crate::live::downloads::FigureHost;
use crate::live::host::DiskHost;
use crate::live::live_disk::{writer_loop, LiveWriter, Mirrored};
use crate::live::live_tree::LiveTree;
use crate::live::payloads::{KeptFile, StatusPayload};
use crate::live::session::{guard, io, off_runtime, LiveDisk, WriterSignal};

const QUIT_SETTLE: Duration = Duration::from_millis(1_500);
const FLUSH_WAIT: Duration = Duration::from_secs(10);
const STOP_WAIT: Duration = Duration::from_secs(8);
const CHORES_WAIT: Duration = Duration::from_secs(10);
const INDEX_FILE: &str = "materializer-index.json";
pub const IMPORT_BASES: &str = "import-bases.json";

#[cfg(any(test, feature = "test-support"))]
pub static STORE_SESSION_LATE_MS: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

pub struct Mirror {
    pub disk: LiveDisk,
    pub work: Mutex<DiskWork>,
    pub role: Mutex<Option<(ProjectRole, bool)>>,
    pub flags: Mutex<(bool, bool)>,
    pub status: Mutex<(LiveStatus, u64)>,
    pub sinks: Mutex<BTreeMap<DocId, (u64, DocSink)>>,
    pub kept: Mutex<Vec<KeptFile>>,
    pub session: OnceLock<Weak<OverleafSession>>,
    pub blobs: Mutex<binaries::BlobMap>,
    pub deletes: Mutex<Deletes>,
    pub replaced: Mutex<BTreeSet<DocId>>,
    pub removing: Mutex<BTreeSet<String>>,
    pub told: Mutex<BTreeMap<String, crate::live::moves::RemovedFile>>,
    pub adopted: Mutex<BTreeSet<String>>,
    pub stored_as_files: Mutex<Vec<String>>,
    pub linked: Mutex<tree::LinkedMemory>,
    pub waiting: Mutex<Option<Vec<port::Waiting>>>,
    pub names: Mutex<tree::Names>,
    pub too_large: Mutex<BTreeSet<String>>,
    pub chores: port::Chores,
    pub opening: opening::Opening,
    pub hooks: OnceLock<Weak<dyn MirrorHooks>>,
    pub live: OnceLock<Weak<OverleafLive>>,
}

#[derive(Default)]
pub struct Deletes {
    pub asked: BTreeSet<String>,
    pub mine: BTreeSet<String>,
    pub refused: BTreeSet<String>,
}

impl Mirror {
    pub fn new(disk: LiveDisk, blobs: binaries::BlobMap, adopted: BTreeSet<String>) -> Mirror {
        let chores = port::Chores::new(disk.runtime.clone(), disk.log.clone());
        Mirror {
            disk,
            work: Mutex::new(DiskWork {
                texts: Default::default(),
                tree: true,
            }),
            role: Mutex::new(None),
            flags: Mutex::new((false, false)),
            status: Mutex::new((LiveStatus::Connecting, 0)),
            sinks: Mutex::new(BTreeMap::new()),
            kept: Mutex::new(Vec::new()),
            session: OnceLock::new(),
            blobs: Mutex::new(blobs),
            deletes: Mutex::new(Deletes::default()),
            replaced: Mutex::new(BTreeSet::new()),
            removing: Mutex::new(BTreeSet::new()),
            told: Mutex::new(BTreeMap::new()),
            adopted: Mutex::new(adopted),
            stored_as_files: Mutex::new(Vec::new()),
            linked: Mutex::new(tree::LinkedMemory::default()),
            waiting: Mutex::new(Some(Vec::new())),
            names: Mutex::new(tree::Names::default()),
            too_large: Mutex::new(BTreeSet::new()),
            chores,
            opening: opening::Opening::default(),
            hooks: OnceLock::new(),
            live: OnceLock::new(),
        }
    }

    pub fn hooks(&self) -> Option<Arc<dyn MirrorHooks>> {
        self.hooks.get().and_then(Weak::upgrade)
    }

    pub fn post(&self, work: impl FnOnce() + Send + 'static) {
        self.chores.post(Box::new(work));
    }

    pub fn path_of(&self, doc: &DocId) -> Option<String> {
        let mirrored = guard(&self.disk.disk)
            .layout
            .get(&doc.0)
            .map(|placed| placed.path.clone());
        mirrored.or_else(|| {
            let session = self.session.get()?.upgrade()?;
            self.files(&session.nodes());
            self.laid_path(&doc.0)
        })
    }

    pub fn kick(&self) {
        let _ = self.disk.writer.send(WriterSignal::Kick);
    }

    pub fn mark(&self, texts: impl IntoIterator<Item = String>, tree: bool) {
        {
            let mut work = guard(&self.work);
            work.texts.extend(texts);
            work.tree |= tree;
        }
        self.kick();
    }

    pub fn take_work(&self) -> DiskWork {
        std::mem::take(&mut *guard(&self.work))
    }

    pub fn hold_dir(&self) -> PathBuf {
        self.disk
            .disk_file
            .parent()
            .map_or_else(|| self.disk.root.clone(), Path::to_path_buf)
    }

    pub fn role(&self) -> Option<(ProjectRole, bool)> {
        *guard(&self.role)
    }

    pub fn set_status(&self, status: LiveStatus, pending: u64) {
        *guard(&self.status) = (status.clone(), pending);
        self.disk.host.status(StatusPayload {
            project_id: self.disk.project_id.clone(),
            status,
            pending,
        });
    }

    pub fn repeat_status(&self) {
        let (status, pending) = guard(&self.status).clone();
        self.set_status(status, pending);
    }

    pub fn adopt_file_text(&self, path: &str) -> Option<String> {
        let (text, hash) = self.read_exact(path)?;
        guard(&self.disk.bases).record(path, &text);
        guard(&self.disk.disk).hashes.insert(path.to_owned(), hash);
        Some(text)
    }

    pub fn mirrored_text(&self, path: &str) -> Option<String> {
        let recorded = guard(&self.disk.bases).latest_settled(path).cloned();
        recorded.or_else(|| self.read_exact(path).map(|(text, _)| text))
    }

    pub async fn flush(&self) {
        let (done, wait) = oneshot::channel();
        let _ = self.disk.writer.send(WriterSignal::Flush(done));
        let _ = tokio::time::timeout(FLUSH_WAIT, wait).await;
    }

    pub fn detach_sinks(&self) {
        let sinks = std::mem::take(&mut *guard(&self.sinks));
        for (_, sink) in sinks.into_values() {
            sink(DocMessage::Detached {
                reason: "stopped".to_owned(),
            });
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Edit {
    Live,
    NotLive,
    ReadOnly,
}

pub struct OverleafLive {
    pub session: Arc<OverleafSession>,
    pub mirror: Arc<Mirror>,
    pub link: OverleafLink,
    pub me: String,
}

pub struct GitBase {
    pub repo: PathBuf,
    pub git: Arc<dyn MirrorGit>,
}

pub struct Parts {
    pub project_id: String,
    pub root: PathBuf,
    pub mirror_dir: PathBuf,
    pub host: Arc<dyn DiskHost>,
    pub link: OverleafLink,
    pub config: SessionConfig,
    pub journal: Journal,
    pub git: Option<GitBase>,
    pub runtime: Handle,
    pub log: AppLog,
}

pub struct FirstBases {
    imported: BTreeMap<String, String>,
    git: BTreeMap<String, String>,
}

impl FirstBases {
    pub fn load(
        mirror_dir: &Path,
        git: Option<&GitBase>,
        wanted: &[String],
        log: &AppLog,
    ) -> FirstBases {
        let imported: BTreeMap<String, String> = std::fs::read(mirror_dir.join(IMPORT_BASES))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let missing: Vec<&str> = wanted
            .iter()
            .filter(|path| !imported.contains_key(*path))
            .map(String::as_str)
            .collect();
        let git = git.map_or_else(BTreeMap::new, |git| git_bases(git, &missing, log));
        FirstBases { imported, git }
    }

    pub fn base_of(&self, path: &str) -> Option<String> {
        self.imported
            .get(path)
            .or_else(|| self.git.get(path))
            .cloned()
    }
}

const GIT_ARGS_BUDGET: usize = 16 * 1024;

fn git_bases(git: &GitBase, wanted: &[&str], log: &AppLog) -> BTreeMap<String, String> {
    let mut bases = BTreeMap::new();
    if wanted.is_empty() {
        return bases;
    }
    let base_ref = oleafly_online::sync::BASE_REF;
    let listed = match git
        .git
        .run(&git.repo, &["ls-tree", "-r", "-z", "--name-only", base_ref])
    {
        Ok(listed) if listed.status.success() => listed.stdout,
        _ => return bases,
    };
    let present: BTreeSet<&str> = listed
        .split(|byte| *byte == 0)
        .filter_map(|path| std::str::from_utf8(path).ok())
        .collect();
    let mut batch: Vec<&str> = Vec::new();
    let mut length = 0;
    let wanted: Vec<&str> = wanted
        .iter()
        .copied()
        .filter(|path| present.contains(path))
        .collect();
    for (index, path) in wanted.iter().enumerate() {
        batch.push(path);
        length += path.len() + 1;
        if length >= GIT_ARGS_BUDGET || index + 1 == wanted.len() {
            read_git_texts(git, base_ref, &std::mem::take(&mut batch), &mut bases, log);
            length = 0;
        }
    }
    bases
}

fn read_git_texts(
    git: &GitBase,
    base_ref: &str,
    paths: &[&str],
    into: &mut BTreeMap<String, String>,
    log: &AppLog,
) {
    let mut args = vec!["archive", "--format=tar", base_ref, "--"];
    args.extend_from_slice(paths);
    let archive = match git.git.run(&git.repo, &args) {
        Ok(output) if output.status.success() => output.stdout,
        Ok(output) => {
            let _ = log.write(&format!(
                "Live editing could not read the last synced text from {}: {}",
                git.repo.display(),
                git.git.failure_text(&output)
            ));
            return;
        }
        Err(error) => {
            let _ = log.write(&format!(
                "Live editing could not read the last synced text from {}: {error}",
                git.repo.display()
            ));
            return;
        }
    };
    let mut tar = tar::Archive::new(archive.as_slice());
    let Ok(entries) = tar.entries() else {
        return;
    };
    for mut entry in entries.flatten() {
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let Some(path) = entry
            .path()
            .ok()
            .and_then(|path| path.to_str().map(|path| path.replace('\\', "/")))
        else {
            continue;
        };
        let mut bytes = Vec::new();
        if std::io::Read::read_to_end(&mut entry, &mut bytes).is_ok() {
            if let Some(text) = crate::disk::as_text(&bytes) {
                into.insert(path, text);
            }
        }
    }
}

fn text_files(scan: crate::disk::Scan) -> Vec<String> {
    scan.files
        .into_iter()
        .filter(|(_, size)| *size <= crate::disk::MAX_TEXT_BYTES as u64)
        .map(|(path, _)| path)
        .collect()
}

pub fn record_import_bases(mirror_dir: &Path, root: &Path) -> std::io::Result<()> {
    let scan = crate::disk::scan_folder(root).map_err(std::io::Error::other)?;
    let texts: BTreeMap<String, String> = text_files(scan)
        .into_iter()
        .filter_map(|path| Some((path.clone(), read_text(root, &path)?.0)))
        .collect();
    write_import_bases(mirror_dir, &texts)
}

pub fn write_import_bases(
    mirror_dir: &Path,
    texts: &BTreeMap<String, String>,
) -> std::io::Result<()> {
    std::fs::create_dir_all(mirror_dir)?;
    let bytes = serde_json::to_vec(texts).map_err(std::io::Error::other)?;
    oleafly_core::atomic::write_atomic_private(&mirror_dir.join(IMPORT_BASES), &bytes)
}

pub fn folder_key(root: &Path) -> std::io::Result<String> {
    let canonical = std::fs::canonicalize(root)?;
    let hash = crate::disk::sha256_hex(canonical.to_string_lossy().as_bytes());
    Ok(format!("folder-{}", &hash[..16]))
}

pub fn mirror_dir(
    data: &Path,
    link: &OverleafLink,
    project_id: &str,
) -> Result<PathBuf, CollabError> {
    let invalid = |id: &str| CollabError::Io(format!("invalid project id {id}"));
    if !plain_id(&link.project_id) {
        return Err(invalid(&link.project_id));
    }
    if !matches!(
        Path::new(project_id)
            .components()
            .collect::<Vec<_>>()
            .as_slice(),
        [std::path::Component::Normal(_)]
    ) {
        return Err(invalid(project_id));
    }
    let origin =
        journal::origin_dir(&link.server).map_err(|error| CollabError::Io(error.to_string()))?;
    Ok(data
        .join("overleaf-mirror")
        .join(origin)
        .join(&link.project_id)
        .join(project_id))
}

struct GoLive {
    bases: WrittenTexts,
    seeds: Vec<Seed>,
    adopted: BTreeSet<String>,
}

fn go_live_bases(
    root: &Path,
    disk: &mut DiskState,
    first: Option<(&Path, Option<&GitBase>)>,
    log: &AppLog,
) -> GoLive {
    let mut found = GoLive {
        bases: WrittenTexts::default(),
        seeds: Vec::new(),
        adopted: BTreeSet::new(),
    };
    let Ok(scan) = crate::disk::scan_folder(root) else {
        return found;
    };
    let files = text_files(scan);
    let first = first.map(|(mirror_dir, git)| FirstBases::load(mirror_dir, git, &files, log));
    for path in files {
        let Some((text, hash)) = read_text(root, &path) else {
            continue;
        };
        let known = disk.hashes.get(&path).cloned();
        if known.as_ref().is_some_and(|known| *known != hash) {
            continue;
        }
        if let Some(first) = &first {
            let base = first.base_of(&path);
            if base.as_deref() != Some(text.as_str()) {
                found.seeds.push(Seed {
                    path: path.clone(),
                    base,
                    local: text.clone(),
                });
            }
            found.adopted.insert(path.clone());
        }
        found.bases.record(&path, &text);
        disk.hashes.insert(path, hash);
    }
    found
}

pub fn live_error(error: LiveError) -> CollabError {
    match error {
        LiveError::Ended | LiveError::UnknownDoc | LiveError::Stopped => {
            crate::live::session::not_live()
        }
        other => CollabError::Api {
            status: 409,
            code: "conflict".to_owned(),
            message: other.to_string(),
        },
    }
}

impl OverleafLive {
    pub async fn start_with<H: MirrorHooks>(
        parts: Parts,
        attach: impl FnOnce(&Arc<Mirror>) -> Arc<H> + Send,
    ) -> Result<(Arc<OverleafLive>, Arc<H>), CollabError> {
        let Parts {
            project_id,
            root,
            mirror_dir,
            host,
            link,
            mut config,
            journal,
            git,
            runtime,
            log,
        } = parts;
        let disk_file = mirror_dir.join(INDEX_FILE);
        let (
            disk,
            GoLive {
                bases,
                seeds,
                adopted,
            },
            blobs,
        ) = {
            let (disk_file, root, log) = (disk_file.clone(), root.clone(), log.clone());
            off_runtime(move || {
                std::fs::create_dir_all(&mirror_dir)?;
                let mut disk = DiskState::load(&disk_file);
                let first = disk
                    .hashes
                    .is_empty()
                    .then_some((mirror_dir.as_path(), git.as_ref()));
                let found = go_live_bases(&root, &mut disk, first, &log);
                let blobs = binaries::BlobMap::load(&mirror_dir);
                Ok::<_, std::io::Error>((disk, found, blobs))
            })
            .await
            .map_err(io)?
            .map_err(io)?
        };
        let (writer, signals) = mpsc::unbounded_channel();
        let mirror = Arc::new(Mirror::new(
            LiveDisk {
                project_id,
                root,
                disk_file,
                disk: Mutex::new(disk),
                bases: Mutex::new(bases),
                host,
                writer,
                upkeep: Default::default(),
                runtime,
                log,
            },
            blobs,
            adopted,
        ));
        let hooks = attach(&mirror);
        let _ = mirror
            .hooks
            .set(Arc::downgrade(&hooks) as Weak<dyn MirrorHooks>);
        let me = config.session.user_id().to_owned();
        let port = Arc::new(MirrorPort::new(Arc::clone(&mirror)));
        config.seeds = seeds;
        let session = OverleafSession::start(config, Arc::clone(&port) as _, journal)
            .await
            .map_err(|error| port::online_error(&error))?;
        #[cfg(any(test, feature = "test-support"))]
        {
            let late = STORE_SESSION_LATE_MS.load(std::sync::atomic::Ordering::Relaxed);
            if late > 0 {
                tokio::time::sleep(Duration::from_millis(late)).await;
            }
        }
        let _ = mirror.session.set(Arc::downgrade(&session));
        port.started();
        let live = Arc::new(OverleafLive {
            session,
            mirror,
            link,
            me,
        });
        let _ = live.mirror.live.set(Arc::downgrade(&live));
        live.mirror
            .disk
            .spawn(writer_loop(Arc::downgrade(&live), signals));
        live.mirror.kick();
        Ok((live, hooks))
    }

    pub fn project_id(&self) -> &str {
        &self.mirror.disk.project_id
    }

    pub fn ended(&self) -> bool {
        matches!(guard(&self.mirror.status).0, LiveStatus::Ended { .. })
    }

    pub fn hold_dir(&self) -> PathBuf {
        self.mirror.hold_dir()
    }

    pub fn doc_at(&self, path: &str) -> Option<DocId> {
        self.mirror.doc_at(path)
    }

    pub fn text_at(&self, path: &str) -> Option<String> {
        self.session.text(&self.doc_at(path)?)
    }

    pub fn edit_toward(
        &self,
        doc: &DocId,
        path: &str,
        base: Option<&str>,
        text: &str,
    ) -> Result<Edit, CollabError> {
        if self.session.text(doc).is_none() && guard(&self.mirror.disk.bases).latest(path).is_none()
        {
            return Ok(Edit::NotLive);
        }
        let edited = self.session.local_edit_with(doc, |current| {
            if current == text {
                return None;
            }
            let op = base
                .and_then(|base| merged_onto(base, text, current))
                .unwrap_or_else(|| oleafly_ot::diff(current, text));
            (!op.is_noop()).then_some(op)
        });
        match edited {
            Ok(_) => Ok(Edit::Live),
            Err(LiveError::Stopped) => Ok(Edit::NotLive),
            Err(LiveError::NotWritable) => Ok(Edit::ReadOnly),
            Err(error) => Err(live_error(error)),
        }
    }

    pub async fn flush(&self) {
        self.mirror.flush().await;
    }

    pub async fn finish(&self) {
        self.mirror.opening.close();
        self.mirror.flush().await;
        self.close_figures();
        self.stop_session(STOP_WAIT).await;
        self.mirror.chores.close(CHORES_WAIT).await;
        self.mirror.detach_sinks();
        self.save_last_state(FLUSH_WAIT).await;
        self.mirror.disk.forget_memory();
    }

    async fn save_last_state(&self, within: Duration) {
        let mirror = Arc::clone(&self.mirror);
        let settled = tokio::time::timeout(
            within,
            off_runtime(move || {
                mirror.save_blobs();
                mirror.disk.announce_written();
            }),
        )
        .await;
        if !matches!(settled, Ok(Ok(()))) {
            self.mirror.disk.log_once("finish", || {
                "could not save its last file state when it stopped".to_owned()
            });
        }
    }

    async fn stop_session(&self, within: Duration) {
        if tokio::time::timeout(within, self.session.stop())
            .await
            .is_err()
        {
            self.mirror.disk.log_once("stop", || {
                format!(
                    "the Overleaf session did not stop within {} s",
                    within.as_secs()
                )
            });
        }
    }

    pub async fn quit(&self, within: Duration) {
        let started = Instant::now();
        let left = || within.saturating_sub(started.elapsed());
        self.mirror.opening.close();
        self.session.settle(QUIT_SETTLE.min(within)).await;
        let _ = tokio::time::timeout(left(), self.mirror.flush()).await;
        self.close_figures();
        self.stop_session(left()).await;
        self.mirror.chores.close(left()).await;
        self.save_last_state(left()).await;
        self.mirror.disk.forget_memory();
    }

    pub fn set_focused(&self, focused: bool) {
        self.session.set_focused(focused);
    }

    pub async fn import_paths(&self, only: Option<Vec<String>>) -> Result<(), CollabError> {
        self.session.touch();
        self.mirror.disk.import(self, &self.hold_dir(), only).await
    }

    fn write_out(self: &Arc<Self>, urgent: bool) -> Result<Vec<String>, CollabError> {
        if !self.mirror.disk.root.is_dir() {
            return Ok(Vec::new());
        }
        self.mirror.save_blobs();
        let (mut previous, hashes, owed) = self.mirror.disk.snapshot();
        let Some(mirror) = self.read_out(&mut previous, &hashes)? else {
            return Ok(Vec::new());
        };
        let Mirrored {
            mut conflicts,
            mut blobs,
        } = self
            .mirror
            .disk
            .mirror(&**self, &self.hold_dir(), &previous, &owed, mirror, urgent)?;
        let clashing: Vec<(String, String)> = {
            let disk = guard(&self.mirror.disk.disk);
            disk.layout
                .values()
                .filter(|placed| placed.kind == oleafly_collab::doc::NodeKind::Blob)
                .filter(|placed| conflicts.contains(&placed.path))
                .filter_map(|placed| Some((placed.path.clone(), placed.blob.clone()?)))
                .collect()
        };
        conflicts.retain(|path| !clashing.iter().any(|(clashed, _)| clashed == path));
        blobs.extend(clashing);
        self.want_figures(blobs);
        Ok(conflicts)
    }
}

impl LiveWriter for OverleafLive {
    fn disk(&self) -> &LiveDisk {
        &self.mirror.disk
    }

    async fn write_pass(self: Arc<Self>, urgent: bool) -> Result<Vec<String>, CollabError> {
        off_runtime(move || self.write_out(urgent))
            .await
            .map_err(io)?
    }

    async fn import_pass(self: Arc<Self>, only: Vec<String>) -> Result<(), CollabError> {
        self.import_paths(Some(only)).await
    }
}
