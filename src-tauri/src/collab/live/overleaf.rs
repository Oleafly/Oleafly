pub(crate) mod account;
mod binaries;
pub(crate) mod commands;
#[cfg(test)]
mod first_start_tests;
pub(crate) mod notices;
mod port;
#[cfg(test)]
pub(crate) mod rig;
#[cfg(test)]
mod tests;
mod tree;
mod tree_events;
#[cfg(test)]
mod tree_tests;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant};

use oleafly_collab::live::DiskWork;
use oleafly_collab::sync::LiveStatus;
use oleafly_collab::CollabError;
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_online::live::journal::{self, Journal};
use oleafly_online::live::session::{LiveError, OverleafSession, Seed, SessionConfig};
use oleafly_online::realtime::DocId;
use oleafly_ot::{DocOpened, DocSink, TextOperation};
use tokio::sync::{mpsc, oneshot};

pub(crate) use port::AppOverleafPort;
pub(crate) use tree_events::{TreeNotice, TreeNoticeKind, TREE_EVENT};

use super::bases::{merged_onto, WrittenTexts};
use super::downloads::FigureHost;
use super::host::LiveHost;
use super::live_disk::{writer_loop, LiveWriter, Mirrored};
use super::live_tree::LiveTree;
use super::payloads::{LiveInfo, OverleafMember, OverleafPerson, StatusPayload};
use super::session::{guard, io, LiveDisk, WriterSignal};
use super::write::WriteOutcome;
use crate::collab::disk::{lf_text, DiskState};
use crate::overleaf::OverleafLink;

const QUIT_SETTLE: Duration = Duration::from_millis(1_500);
const FLUSH_WAIT: Duration = Duration::from_secs(10);
const INDEX_FILE: &str = "materializer-index.json";
pub(crate) const IMPORT_BASES: &str = "import-bases.json";

/// Tests set this to store the started session late, the way a loaded machine does,
/// so work the session reports while it joins has to wait for it.
#[cfg(test)]
pub(crate) static STORE_SESSION_LATE_MS: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

pub(crate) struct Mirror {
    pub(super) disk: LiveDisk,
    work: Mutex<DiskWork>,
    role: Mutex<Option<(ProjectRole, bool)>>,
    flags: Mutex<(bool, bool)>,
    status: Mutex<(LiveStatus, u64)>,
    sinks: Mutex<BTreeMap<DocId, DocSink>>,
    kept: Mutex<Vec<super::kept::KeptFile>>,
    session: OnceLock<Weak<OverleafSession>>,
    blobs: Mutex<binaries::BlobMap>,
    deletes: Mutex<Deletes>,
    replaced: Mutex<BTreeSet<DocId>>,
    removing: Mutex<BTreeSet<String>>,
    restorable: Mutex<BTreeMap<String, String>>,
    adopted: Mutex<BTreeSet<String>>,
    stored_as_files: Mutex<Vec<String>>,
    /// Work for documents the mirror can't name yet, kept while the session starts
    /// (`None` once it has started). See `AppOverleafPort::with_path`.
    waiting: Mutex<Option<Vec<port::Waiting>>>,
}

#[derive(Default)]
struct Deletes {
    asked: BTreeSet<String>,
    mine: BTreeSet<String>,
    refused: BTreeSet<String>,
}

impl Mirror {
    pub(crate) fn new(
        disk: LiveDisk,
        blobs: binaries::BlobMap,
        adopted: BTreeSet<String>,
    ) -> Mirror {
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
            restorable: Mutex::new(BTreeMap::new()),
            adopted: Mutex::new(adopted),
            stored_as_files: Mutex::new(Vec::new()),
            waiting: Mutex::new(Some(Vec::new())),
        }
    }

    fn path_of(&self, doc: &DocId) -> Option<String> {
        let mirrored = guard(&self.disk.disk)
            .layout
            .get(&doc.0)
            .map(|placed| placed.path.clone());
        mirrored.or_else(|| {
            let session = self.session.get()?.upgrade()?;
            oleafly_collab::materialize::layout(&tree::file_nodes(&session.nodes()))
                .into_iter()
                .find(|(id, _)| *id == doc.0)
                .map(|(_, placed)| placed.path)
        })
    }

    fn kick(&self) {
        let _ = self.disk.writer.send(WriterSignal::Kick);
    }

    fn mark(&self, texts: impl IntoIterator<Item = String>, tree: bool) {
        {
            let mut work = guard(&self.work);
            work.texts.extend(texts);
            work.tree |= tree;
        }
        self.kick();
    }

    fn take_work(&self) -> DiskWork {
        std::mem::take(&mut *guard(&self.work))
    }

    fn hold_dir(&self) -> PathBuf {
        self.disk
            .disk_file
            .parent()
            .map_or_else(|| self.disk.root.clone(), Path::to_path_buf)
    }

    fn role(&self) -> Option<(ProjectRole, bool)> {
        *guard(&self.role)
    }

    fn set_status(&self, status: LiveStatus, pending: u64) {
        *guard(&self.status) = (status.clone(), pending);
        self.disk.host.status(StatusPayload {
            project_id: self.disk.project_id.clone(),
            status,
            pending,
        });
    }

    fn repeat_status(&self) {
        let (status, pending) = guard(&self.status).clone();
        self.set_status(status, pending);
    }

    fn adopt_file_text(&self, path: &str) -> Option<String> {
        let (text, hash) = read_text(&self.disk.root, path)?;
        guard(&self.disk.bases).record(path, &text);
        guard(&self.disk.disk).hashes.insert(path.to_owned(), hash);
        Some(text)
    }

    fn mirrored_text(&self, path: &str) -> Option<String> {
        if let Some(text) = guard(&self.disk.bases).latest(path) {
            return Some(text.clone());
        }
        let target = crate::collab::disk::safe_target(&self.disk.root, path)?;
        let bytes = std::fs::read(target).ok()?;
        String::from_utf8(bytes)
            .ok()
            .map(|text| lf_text(&text).into_owned())
    }

    async fn flush(&self) {
        let (done, wait) = oneshot::channel();
        let _ = self.disk.writer.send(WriterSignal::Flush(done));
        let _ = tokio::time::timeout(FLUSH_WAIT, wait).await;
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Edit {
    Live,
    NotLive,
}

pub struct OverleafLive {
    session: Arc<OverleafSession>,
    pub(crate) mirror: Arc<Mirror>,
    link: OverleafLink,
    me: String,
}

pub(crate) struct Parts {
    pub(crate) project_id: String,
    pub(crate) root: PathBuf,
    pub(crate) mirror_dir: PathBuf,
    pub(crate) host: Arc<dyn LiveHost>,
    pub(crate) link: OverleafLink,
    pub(crate) config: SessionConfig,
    pub(crate) journal: Journal,
    pub(crate) git_mirror: Option<PathBuf>,
}

struct FirstBases {
    imported: BTreeMap<String, String>,
    git: Option<PathBuf>,
}

impl FirstBases {
    fn load(mirror_dir: &Path, git: Option<PathBuf>) -> FirstBases {
        let imported = std::fs::read(mirror_dir.join(IMPORT_BASES))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        FirstBases { imported, git }
    }

    fn base_of(&self, path: &str) -> Option<String> {
        if let Some(text) = self.imported.get(path) {
            return Some(text.clone());
        }
        let repo = self.git.as_ref()?;
        let blob = format!("{}:{path}", oleafly_online::sync::BASE_REF);
        let output = crate::git::run_mirror_git(repo, &["cat-file", "blob", &blob]).ok()?;
        if !output.status.success() {
            return None;
        }
        crate::collab::disk::as_text(&output.stdout)
    }
}

pub(crate) fn record_import_bases(mirror_dir: &Path, root: &Path) -> std::io::Result<()> {
    let scan = crate::collab::disk::scan_folder(root).map_err(std::io::Error::other)?;
    let mut texts = BTreeMap::new();
    for (path, _) in scan.files {
        if let Some((text, _)) = read_text(root, &path) {
            texts.insert(path, text);
        }
    }
    std::fs::create_dir_all(mirror_dir)?;
    let bytes = serde_json::to_vec(&texts).map_err(std::io::Error::other)?;
    oleafly_core::atomic::write_atomic_private(&mirror_dir.join(IMPORT_BASES), &bytes)
}

pub(crate) fn mirror_dir(
    data: &Path,
    link: &OverleafLink,
    project_id: &str,
) -> Result<PathBuf, CollabError> {
    let origin =
        journal::origin_dir(&link.server).map_err(|error| CollabError::Io(error.to_string()))?;
    Ok(data
        .join("overleaf-mirror")
        .join(origin)
        .join(&link.project_id)
        .join(project_id))
}

fn read_text(root: &Path, path: &str) -> Option<(String, String)> {
    let target = crate::collab::disk::safe_target(root, path)?;
    let bytes = std::fs::read(&target).ok()?;
    let text = crate::collab::disk::as_text(&bytes)?;
    Some((text, crate::collab::disk::sha256_hex(&bytes)))
}

struct GoLive {
    bases: WrittenTexts,
    seeds: Vec<Seed>,
    adopted: BTreeSet<String>,
}

fn go_live_bases(root: &Path, disk: &mut DiskState, first: Option<&FirstBases>) -> GoLive {
    let mut found = GoLive {
        bases: WrittenTexts::default(),
        seeds: Vec::new(),
        adopted: BTreeSet::new(),
    };
    let Ok(scan) = crate::collab::disk::scan_folder(root) else {
        return found;
    };
    for (path, _) in scan.files {
        let Some((text, hash)) = read_text(root, &path) else {
            continue;
        };
        let known = disk.hashes.get(&path).cloned();
        if known.as_ref().is_some_and(|known| *known != hash) {
            continue;
        }
        if let Some(first) = first {
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

pub(crate) enum Backend {
    Server,
    Overleaf(OverleafLink),
    Both,
}

pub(crate) fn live_backend_for(
    paths: &oleafly_collab::CollabPaths,
    project_id: &str,
    card_on: bool,
) -> Result<Option<Backend>, CollabError> {
    let shared = oleafly_collab::load_binding(paths, project_id)?.is_some();
    let link = crate::overleaf::overleaf_link_of(project_id).map_err(CollabError::Io)?;
    let claimed = match link {
        Some(link) if card_on || unsent_journal(&link)? => Some(link),
        Some(_) | None => None,
    };
    Ok(match (shared, claimed) {
        (true, Some(_)) => Some(Backend::Both),
        (true, None) => Some(Backend::Server),
        (false, Some(link)) => Some(Backend::Overleaf(link)),
        (false, None) => None,
    })
}

fn unsent_journal(link: &OverleafLink) -> Result<bool, CollabError> {
    let data = crate::paths::oleafly_root().map_err(CollabError::Io)?;
    Ok(journal::unsent_on(&data, &link.server)
        .iter()
        .any(|(project, _)| *project == link.project_id))
}

pub(crate) fn overleaf_linked() -> CollabError {
    CollabError::Api {
        status: 409,
        code: "overleaf_linked".to_owned(),
        message: "this project is linked to Overleaf".to_owned(),
    }
}

pub(crate) fn collab_shared() -> CollabError {
    CollabError::Api {
        status: 409,
        code: "collab_shared".to_owned(),
        message: "this project is shared on an Oleafly Server".to_owned(),
    }
}

pub(crate) fn git_sync_waits(project_id: &str) -> Result<bool, CollabError> {
    if let Some(super::session::Live::Overleaf(_)) = super::session::live_for(project_id) {
        return Ok(true);
    }
    match crate::overleaf::overleaf_link_of(project_id).map_err(CollabError::Io)? {
        Some(link) => unsent_journal(&link),
        None => Ok(false),
    }
}

pub(crate) fn refuse_overleaf_linked(
    paths: &oleafly_collab::CollabPaths,
    project_id: &str,
    card_on: bool,
) -> Result<(), CollabError> {
    match live_backend_for(paths, project_id, card_on)? {
        Some(Backend::Overleaf(_) | Backend::Both) => Err(overleaf_linked()),
        Some(Backend::Server) | None => Ok(()),
    }
}

fn live_error(error: LiveError) -> CollabError {
    match error {
        LiveError::Ended | LiveError::UnknownDoc | LiveError::Stopped => super::session::not_live(),
        other => CollabError::Api {
            status: 409,
            code: "conflict".to_owned(),
            message: other.to_string(),
        },
    }
}

impl OverleafLive {
    pub(crate) async fn start_with(parts: Parts) -> Result<Arc<OverleafLive>, CollabError> {
        let Parts {
            project_id,
            root,
            mirror_dir,
            host,
            link,
            mut config,
            journal,
            git_mirror,
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
            let (disk_file, root) = (disk_file.clone(), root.clone());
            tauri::async_runtime::spawn_blocking(move || {
                std::fs::create_dir_all(&mirror_dir)?;
                let mut disk = DiskState::load(&disk_file);
                let first = disk
                    .hashes
                    .is_empty()
                    .then(|| FirstBases::load(&mirror_dir, git_mirror));
                let found = go_live_bases(&root, &mut disk, first.as_ref());
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
            },
            blobs,
            adopted,
        ));
        let me = config.session.user_id().to_owned();
        let port = Arc::new(AppOverleafPort::new(Arc::clone(&mirror)));
        config.seeds = seeds;
        let session = OverleafSession::start(config, Arc::clone(&port) as _, journal)
            .await
            .map_err(|error| port::online_error(&error))?;
        #[cfg(test)]
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
        tauri::async_runtime::spawn(writer_loop(Arc::downgrade(&live), signals));
        live.mirror.kick();
        Ok(live)
    }

    pub(crate) fn project_id(&self) -> &str {
        &self.mirror.disk.project_id
    }

    pub(crate) fn info(&self) -> LiveInfo {
        LiveInfo {
            role: self
                .mirror
                .role()
                .map_or(ProjectRole::Viewer, |(role, _)| role),
            account_id: self.me.clone(),
            device_id: self.me.clone(),
        }
    }

    pub(crate) fn upload_list(&self) -> Vec<super::uploads::UploadFile> {
        self.session
            .tree_queue()
            .iter()
            .filter_map(port::upload_row)
            .collect()
    }

    pub(crate) fn retry_uploads(&self) {
        self.session.retry_tree(None);
    }

    pub(crate) fn dismiss_upload(&self, path: &str) {
        self.session.dismiss_tree(path);
    }

    pub(crate) fn reconnect_now(&self) {
        self.session.reconnect_now();
    }

    pub(crate) fn presence(&self, path: Option<&str>, cursor: Option<u32>) {
        let doc = path.and_then(|path| self.session.doc_at(path));
        let at = doc.zip(cursor.and_then(|cursor| usize::try_from(cursor).ok()));
        self.session.presence(at);
    }

    pub(crate) fn members(&self) -> Vec<OverleafMember> {
        self.session
            .members()
            .into_iter()
            .map(|member| {
                let name = format!("{} {}", member.first_name, member.last_name);
                let name = name.trim();
                OverleafMember {
                    person: OverleafPerson {
                        display_name: if name.is_empty() {
                            member.email.clone()
                        } else {
                            name.to_owned()
                        },
                        account_id: member.id,
                        avatar_url: None,
                        email: Some(member.email).filter(|email| !email.is_empty()),
                        login: None,
                    },
                    role: port::project_role(member.role),
                    granted_at: 0,
                }
            })
            .collect()
    }

    pub(crate) fn repeat_status(&self) {
        self.mirror.repeat_status();
        if let Some((role, tracking)) = self.mirror.role() {
            port::announce_role(&self.mirror, role, tracking);
        }
    }

    pub(crate) fn hold_dir(&self) -> PathBuf {
        self.mirror.hold_dir()
    }

    pub(crate) fn kick(&self) {
        self.mirror.kick();
    }

    pub(crate) fn with_disk<T>(&self, work: impl FnOnce(&DiskState) -> T) -> T {
        work(&guard(&self.mirror.disk.disk))
    }

    pub(crate) fn doc_at(&self, path: &str) -> Option<DocId> {
        tree::doc_at(&self.session.nodes(), path)
    }

    pub(crate) fn text_at(&self, path: &str) -> Option<String> {
        self.session.text(&self.doc_at(path)?)
    }

    pub(crate) fn open(&self, path: &str, sink: DocSink) -> Option<DocOpened> {
        let opened = self.session.open(path, Arc::clone(&sink))?;
        guard(&self.mirror.sinks).insert(DocId(opened.file_id.clone()), sink);
        Some(opened)
    }

    pub(crate) fn change(
        &self,
        file_id: &str,
        rev: u64,
        op: TextOperation,
    ) -> Result<(), CollabError> {
        self.session
            .editor_change(&DocId(file_id.to_owned()), rev, op)
            .map_err(live_error)?;
        self.mirror.mark([file_id.to_owned()], false);
        Ok(())
    }

    pub(crate) fn close(&self, file_id: &str, session: u64) {
        let doc = DocId(file_id.to_owned());
        self.session.close(&doc, session);
        guard(&self.mirror.sinks).remove(&doc);
    }

    fn edit_toward(
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
            Err(error) => Err(live_error(error)),
        }
    }

    pub(crate) async fn write_text(
        &self,
        path: &str,
        base: Option<&str>,
        text: &str,
    ) -> Result<WriteOutcome, CollabError> {
        let Some(doc) = self.doc_at(path) else {
            return Ok(WriteOutcome {
                handled: false,
                reason: None,
            });
        };
        let text = lf_text(text);
        if self.edit_toward(&doc, path, base, &text)? == Edit::NotLive {
            return Ok(WriteOutcome {
                handled: false,
                reason: None,
            });
        }
        self.mirror.mark([doc.0], false);
        self.mirror.flush().await;
        Ok(WriteOutcome {
            handled: true,
            reason: None,
        })
    }

    pub(crate) async fn flush(&self) {
        self.mirror.flush().await;
    }

    pub(crate) async fn finish(&self) {
        self.mirror.flush().await;
        self.close_figures();
        self.session.stop().await;
        self.mirror.disk.announce_written();
        crate::folder_watch::release_live(self.project_id());
    }

    pub(crate) async fn quit(&self, within: Duration) {
        let started = Instant::now();
        self.session.settle(QUIT_SETTLE.min(within)).await;
        self.session.stop().await;
        let left = within.saturating_sub(started.elapsed());
        let _ = tokio::time::timeout(left, self.mirror.flush()).await;
        self.mirror.disk.announce_written();
        crate::folder_watch::release_live(self.project_id());
    }

    pub(crate) fn set_focused(&self, focused: bool) {
        self.session.set_focused(focused);
    }

    pub(crate) async fn import_paths(&self, only: Option<Vec<String>>) -> Result<(), CollabError> {
        self.session.touch();
        self.mirror.disk.import(self, &self.hold_dir(), only).await
    }

    async fn write_out(self: &Arc<Self>, urgent: bool) -> Result<Vec<String>, CollabError> {
        if !self.mirror.disk.root.is_dir() {
            return Ok(Vec::new());
        }
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
    async fn write_pass(self: Arc<Self>, urgent: bool) -> Result<Vec<String>, CollabError> {
        self.write_out(urgent).await
    }

    async fn import_pass(self: Arc<Self>, only: Vec<String>) -> Result<(), CollabError> {
        self.import_paths(Some(only)).await
    }
}
