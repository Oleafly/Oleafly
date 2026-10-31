use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize::{self, safe_name};
use oleafly_collab::{
    load_binding, save_binding, write_atomic, CollabError, CollabPaths, ServerRegistry, ServerUrl,
    ShareBinding,
};
use oleafly_collab_protocol::ids::{AccountId, ServerId, SharedProjectId};
use oleafly_collab_protocol::projects::{
    PersonSummary, ProjectMember, ProjectPatch, ProjectRole, ProjectStatus, ProjectSummary,
};
use oleafly_collab_protocol::snapshots::ProjectPeer;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use super::commands::{
    authed, client_for, known, now_ms, parse_id, with_access, AppHost, CollabCommandError,
    CollabHost,
};
use super::disk::{as_text, crlf_only, scan_folder, sha256_hex, with_line_endings, DiskState};
use super::joining::{Downloads, JoinProgress, JoinReport};
use super::state::{CollabState, JoinTicket};

pub const SHARE_PROGRESS_EVENT: &str = "collab-share-progress";
const MEBIBYTE: u64 = 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
pub struct ShareInfo {
    pub project_id: String,
    pub server_id: ServerId,
    pub server_name: String,
    pub server_url: String,
    pub shared_project_id: SharedProjectId,
    pub role: ProjectRole,
    pub link: String,
    pub account_id: Option<AccountId>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct ShareCheck {
    pub server_name: String,
    pub file_count: usize,
    pub total_bytes: u64,
    pub excluded: Vec<String>,
    pub too_large: Vec<String>,
    pub renamed: Vec<String>,
    pub max_file_mb: u64,
    pub cloud_synced: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct SharedWithMe {
    pub server_id: ServerId,
    pub server_name: String,
    pub project: ProjectSummary,
    pub local_project_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ProjectSharing {
    pub server_name: String,
    pub role: ProjectRole,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShareProgress {
    project_id: String,
    done: usize,
    total: usize,
}

fn api(status: u16, code: &str, message: &str) -> CollabError {
    CollabError::Api {
        status,
        code: code.to_owned(),
        message: message.to_owned(),
    }
}

fn io(error: impl std::fmt::Display) -> CollabError {
    CollabError::Io(error.to_string())
}

pub fn landing_link(server_url: &str, project: SharedProjectId) -> String {
    format!("{}/p/{project}", server_url.trim_end_matches('/'))
}

fn binding_of(paths: &CollabPaths, project_id: &str) -> Result<ShareBinding, CollabError> {
    load_binding(paths, project_id)?
        .ok_or_else(|| api(404, "not_found", "this project is not shared"))
}

fn info_from(registry: &ServerRegistry, project_id: &str, binding: &ShareBinding) -> ShareInfo {
    let entry = registry.get(binding.server_id);
    ShareInfo {
        project_id: project_id.to_owned(),
        server_id: binding.server_id,
        server_name: entry.map(|entry| entry.name.clone()).unwrap_or_default(),
        server_url: binding.server_url.clone(),
        shared_project_id: binding.shared_project_id,
        role: binding.role,
        link: landing_link(&binding.server_url, binding.shared_project_id),
        account_id: entry
            .and_then(|entry| entry.account.as_ref())
            .map(|account| account.account_id),
    }
}

pub fn share_info(state: &CollabState, project_id: &str) -> Result<Option<ShareInfo>, CollabError> {
    let paths = state.paths()?;
    let Some(binding) = load_binding(paths, project_id)? else {
        return Ok(None);
    };
    Ok(Some(info_from(&state.registry()?, project_id, &binding)))
}

pub fn sharing_of(project_id: &str) -> Option<ProjectSharing> {
    if !super::registry::is_shared(project_id) {
        return None;
    }
    let paths = CollabPaths::new(crate::paths::collab_root().ok()?);
    let binding = load_binding(&paths, project_id).ok()??;
    let server_name = ServerRegistry::load(&paths)
        .ok()
        .and_then(|registry| {
            registry
                .get(binding.server_id)
                .map(|entry| entry.name.clone())
        })
        .unwrap_or_default();
    Some(ProjectSharing {
        server_name,
        role: binding.role,
    })
}

fn local_bindings(paths: &CollabPaths) -> HashMap<SharedProjectId, String> {
    let Ok(entries) = std::fs::read_dir(paths.root()) else {
        return HashMap::new();
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .filter(|id| crate::paths::validate_project_id(id).is_ok())
        .filter(|id| matches!(crate::paths::library_project_root(id), Ok(Some(_))))
        .filter_map(|id| {
            load_binding(paths, &id)
                .ok()
                .flatten()
                .map(|binding| (binding.shared_project_id, id))
        })
        .collect()
}

fn renamed_paths(paths: impl Iterator<Item = String>) -> Vec<String> {
    paths
        .filter(|path| {
            path.split('/')
                .any(|segment| safe_name(segment, "0123456789") != segment)
        })
        .collect()
}

pub async fn share_check(
    state: &CollabState,
    project_id: &str,
    server: ServerId,
) -> Result<ShareCheck, CollabError> {
    let entry = known(state, server)?;
    let manifest = client_for(&entry)?.capabilities().await?;
    let root = crate::paths::project_dir(project_id).map_err(CollabError::Io)?;
    let scan = tauri::async_runtime::spawn_blocking(move || scan_folder(&root))
        .await
        .map_err(io)?
        .map_err(CollabError::Io)?;
    let limit = manifest.limits.max_file_mb.saturating_mul(MEBIBYTE);
    Ok(ShareCheck {
        server_name: manifest.name,
        file_count: scan.files.len(),
        total_bytes: scan.files.iter().map(|(_, size)| size).sum(),
        too_large: scan
            .files
            .iter()
            .filter(|(_, size)| *size > limit)
            .map(|(path, _)| path.clone())
            .collect(),
        renamed: renamed_paths(
            scan.files
                .iter()
                .map(|(path, _)| path.clone())
                .chain(scan.dirs.iter().cloned()),
        ),
        excluded: scan.excluded,
        max_file_mb: manifest.limits.max_file_mb,
        cloud_synced: crate::folder_status::library_sync_service().is_some(),
    })
}

struct Built {
    doc: ProjectDoc,
    blobs: BTreeMap<String, String>,
    hashes: BTreeMap<String, String>,
}

const PENDING_SHARE: &str = "share-pending.json";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct PendingShare {
    server_id: ServerId,
    shared_project_id: SharedProjectId,
    #[serde(default)]
    sent: BTreeSet<String>,
    #[serde(default)]
    snapshot_sent: bool,
}

fn pending_file(paths: &CollabPaths, project_id: &str) -> Result<PathBuf, CollabError> {
    Ok(paths.project_dir(project_id)?.join(PENDING_SHARE))
}

fn load_pending(paths: &CollabPaths, project_id: &str) -> Option<PendingShare> {
    let bytes = std::fs::read(pending_file(paths, project_id).ok()?).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn save_pending(
    paths: &CollabPaths,
    project_id: &str,
    pending: &PendingShare,
) -> Result<(), CollabError> {
    let json =
        serde_json::to_vec(pending).map_err(|error| CollabError::Corrupt(error.to_string()))?;
    write_atomic(&pending_file(paths, project_id)?, &json)
}

fn forget_pending(paths: &CollabPaths, project_id: &str) {
    if let Ok(file) = pending_file(paths, project_id) {
        let _ = std::fs::remove_file(file);
    }
}

fn share_in_progress() -> CollabError {
    api(
        409,
        "share_in_progress",
        "this project is being shared already",
    )
}

pub(crate) fn cloud_synced() -> CollabError {
    api(
        409,
        "cloud_synced",
        "the library is inside a cloud-synced folder",
    )
}

pub(crate) async fn sendable_blob(file: &Path, hash: &str) -> Result<Vec<u8>, CollabError> {
    let bytes = tokio::fs::read(file).await.map_err(io)?;
    if sha256_hex(&bytes) != hash {
        return Err(CollabError::Io(format!(
            "{} changed while it was being shared",
            file.display()
        )));
    }
    Ok(bytes)
}

fn build_document(root: &Path, meta: &crate::project::ProjectMeta) -> Result<Built, CollabError> {
    let scan = scan_folder(root).map_err(CollabError::Io)?;
    let mut doc = ProjectDoc::create()?;
    let mut dirs: HashMap<String, String> = HashMap::new();
    let parent_id = |dirs: &HashMap<String, String>, path: &str| {
        path.rsplit_once('/')
            .and_then(|(parent, _)| dirs.get(parent).cloned())
    };
    let name_of = |path: &str| {
        path.rsplit_once('/')
            .map_or(path, |(_, name)| name)
            .to_owned()
    };
    for dir in &scan.dirs {
        let parent = parent_id(&dirs, dir);
        let id = doc.add_node(parent.as_deref(), &name_of(dir), NodeKind::Dir, None, "")?;
        dirs.insert(dir.clone(), id);
    }
    let mut blobs = BTreeMap::new();
    let mut hashes = BTreeMap::new();
    let mut files: HashMap<&str, String> = HashMap::new();
    for (path, _) in &scan.files {
        let bytes = std::fs::read(root.join(path)).map_err(io)?;
        let hash = sha256_hex(&bytes);
        let parent = parent_id(&dirs, path);
        let id = match as_text(&bytes) {
            Some(text) => {
                let id = doc.add_node(
                    parent.as_deref(),
                    &name_of(path),
                    NodeKind::Text,
                    None,
                    &text,
                )?;
                doc.set_crlf(&id, crlf_only(&bytes) == Some(true))?;
                id
            }
            None => {
                blobs.entry(hash.clone()).or_insert_with(|| path.clone());
                doc.add_node(
                    parent.as_deref(),
                    &name_of(path),
                    NodeKind::Blob,
                    Some(&hash),
                    "",
                )?
            }
        };
        files.insert(path, id);
        hashes.insert(path.clone(), hash);
    }
    let layout = materialize::layout(&doc.nodes()?);
    let mut seeded = meta.clone();
    if let Some(placed) = files
        .get(meta.main_doc.as_str())
        .and_then(|id| layout.get(id))
    {
        seeded.main_doc = placed.path.clone();
    }
    super::settings::seed(&mut doc, &seeded)?;
    Ok(Built { doc, blobs, hashes })
}

async fn pending_share(
    state: &CollabState,
    host: &dyn CollabHost,
    project_id: &str,
    server: ServerId,
    title: &str,
) -> Result<PendingShare, CollabError> {
    let paths = state.paths()?;
    if let Some(pending) = load_pending(paths, project_id)
        .filter(|pending| pending.server_id == server && !pending.snapshot_sent)
    {
        let shared = pending.shared_project_id;
        let still = authed(state, host, server, |client, access| {
            Box::pin(async move { client.project(access, shared).await })
        })
        .await;
        match still {
            Ok(summary) if summary.status == ProjectStatus::Pending => return Ok(pending),
            Ok(_) | Err(CollabError::Api { status: 404, .. }) => {}
            Err(error) => return Err(error),
        }
    }
    let title = title.to_owned();
    let created = authed(state, host, server, |client, access| {
        let title = title.clone();
        Box::pin(async move { client.create_project(access, &title).await })
    })
    .await?;
    let pending = PendingShare {
        server_id: server,
        shared_project_id: created.project_id,
        sent: BTreeSet::new(),
        snapshot_sent: false,
    };
    save_pending(paths, project_id, &pending)?;
    Ok(pending)
}

pub(crate) type Progress<'a> = &'a (dyn Fn(usize, usize) + Send + Sync);

pub async fn share_project(
    state: &CollabState,
    host: &dyn CollabHost,
    progress: Progress<'_>,
    project_id: &str,
    server: ServerId,
) -> Result<ShareInfo, CollabError> {
    let Some(_turn) = state.begin_share(project_id) else {
        return Err(share_in_progress());
    };
    if let Some(info) = share_info(state, project_id)? {
        return Ok(info);
    }
    if crate::project_location::kind_of(project_id)
        .map_err(|error| CollabError::Io(error.to_string()))?
        != crate::project_location::ProjectKind::Library
    {
        return Err(api(409, "conflict", "only library projects can be shared"));
    }
    refuse_synced_library(crate::folder_status::library_sync_service())?;
    let check = share_check(state, project_id, server).await?;
    if !check.too_large.is_empty() {
        return Err(api(413, "too_large", &check.too_large.join(", ")));
    }
    crate::trust::mark_library_restricted(project_id)
        .map_err(|error| CollabError::Io(format!("{error:?}")))?;
    let meta = crate::project::read_meta(project_id).map_err(CollabError::Io)?;
    let title: String = if meta.name.trim().is_empty() {
        project_id.to_owned()
    } else {
        meta.name.trim().chars().take(200).collect()
    };
    let root = crate::paths::project_dir(project_id).map_err(CollabError::Io)?;
    let seeded = meta.clone();
    let scanned = root.clone();
    let built = tauri::async_runtime::spawn_blocking(move || build_document(&scanned, &seeded))
        .await
        .map_err(io)??;
    let entry = known(state, server)?;
    let paths = state.paths()?;
    let mut pending = pending_share(state, host, project_id, server, &title).await?;
    let shared = pending.shared_project_id;
    let client = client_for(&entry)?;
    let keys = state.keys().await?;
    let sessions = keys.sessions.as_ref();
    let total = built.blobs.len();
    progress(0, total);
    for (index, (hash, path)) in built.blobs.iter().enumerate() {
        if !pending.sent.contains(hash) {
            let file = root.join(path);
            with_access(sessions, server, &client, |client, access| {
                let (file, hash) = (file.clone(), hash.clone());
                Box::pin(async move {
                    let bytes = sendable_blob(&file, &hash).await?;
                    client.put_blob(access, shared, &hash, bytes).await
                })
            })
            .await?;
            pending.sent.insert(hash.clone());
            save_pending(paths, project_id, &pending)?;
        }
        progress(index + 1, total);
    }
    let snapshot = built.doc.snapshot()?;
    let key = keys.sessions.device_key(server)?;
    pending.snapshot_sent = true;
    save_pending(paths, project_id, &pending)?;
    with_access(sessions, server, &client, |client, access| {
        let (snapshot, key) = (snapshot.clone(), Arc::clone(&key));
        Box::pin(async move {
            client
                .put_first_snapshot(access, shared, snapshot, &key)
                .await
        })
    })
    .await?;
    with_access(sessions, server, &client, |client, access| {
        Box::pin(async move { client.commit_project(access, shared).await })
    })
    .await?;
    let nodes = built.doc.nodes()?;
    let layout = materialize::layout(&nodes);
    let mut hashes = built.hashes;
    let nothing_before = materialize::Layout::new();
    let mut found = super::disk::FoundPaths::new(&nodes, &nothing_before);
    let node_at: HashMap<&str, &str> = layout
        .iter()
        .map(|(id, placed)| (placed.path.as_str(), id.as_str()))
        .collect();
    let wanted = layout
        .iter()
        .filter_map(|(id, placed)| Some((found.path(id)?, placed.path.clone())))
        .collect();
    let followed = super::disk::follow_layout(&root, wanted);
    for (from, to) in &followed.moved {
        super::disk::rekey_moved(&mut hashes, from, to);
    }
    let owed: BTreeMap<String, String> = followed
        .failed
        .into_iter()
        .filter_map(|(from, to)| Some((from, (*node_at.get(to.as_str())?).to_owned())))
        .collect();
    let shared_settings = built.doc.settings();
    let mut live = LiveProject::new(built.doc, 0, ProjectRole::Owner);
    live.save(&paths.document_dir(project_id)?)?;
    DiskState {
        layout,
        hashes,
        owed,
    }
    .save(&paths.materializer_index_file(project_id)?)?;
    let binding = ShareBinding {
        server_url: entry.url.clone(),
        server_id: server,
        shared_project_id: shared,
        role: ProjectRole::Owner,
        created_at: now_ms(),
    };
    super::settings::remember(
        &super::settings::base_file(paths, project_id)?,
        &super::settings::Base {
            local: shared_settings.clone(),
            shared: shared_settings,
        },
    )?;
    save_binding(paths, project_id, &binding)?;
    super::registry::invalidate(project_id);
    forget_pending(paths, project_id);
    if meta.allow_shell_escape {
        let mut off = meta;
        off.allow_shell_escape = false;
        let _ = crate::project::write_meta(project_id, &off);
    }
    let _ = crate::project::revoke_shell_escape_trust(project_id);
    if !followed.moved.is_empty() {
        host.renamed_on_disk(project_id, &followed.moved);
        if let Some(applied) = super::settings::follow_renamed_main(project_id, &followed.moved) {
            host.settings_changed(applied);
        }
    }
    Ok(info_from(&state.registry()?, project_id, &binding))
}

pub async fn shared_with_me(
    state: &CollabState,
    host: &dyn CollabHost,
) -> Result<Vec<SharedWithMe>, CollabError> {
    let local = local_bindings(state.paths()?);
    let mut listed = Vec::new();
    for entry in state.registry()?.list() {
        if !state.has_session(entry.server_id)? {
            continue;
        }
        let Ok(projects) = authed(state, host, entry.server_id, |client, access| {
            Box::pin(async move { client.projects(access).await })
        })
        .await
        else {
            continue;
        };
        for project in projects {
            let local_project_id = local.get(&project.project_id).cloned();
            if project.role == ProjectRole::Owner && local_project_id.is_some() {
                continue;
            }
            listed.push(SharedWithMe {
                server_id: entry.server_id,
                server_name: entry.name.clone(),
                project,
                local_project_id,
            });
        }
    }
    Ok(listed)
}

fn refuse_synced_library(
    synced: Option<crate::folder_status::SyncService>,
) -> Result<(), CollabError> {
    match synced {
        Some(_) => Err(cloud_synced()),
        None => Ok(()),
    }
}

enum Joined {
    Text(Vec<u8>),
    Blob(String),
}

struct Staged {
    dirs: Vec<String>,
    files: Vec<(String, Joined)>,
    uses: HashMap<String, usize>,
    meta: crate::project::ProjectMeta,
}

fn stage_joined(
    staging: &Path,
    local_id: &str,
    staged: Staged,
    downloads: &Path,
) -> Result<(), String> {
    crate::trust::mark_library_restricted(local_id).map_err(|error| format!("{error:?}"))?;
    for dir in &staged.dirs {
        if let Some(target) = super::disk::safe_target(staging, dir) {
            std::fs::create_dir_all(target).map_err(|error| error.to_string())?;
        }
    }
    let mut left = staged.uses;
    for (path, content) in &staged.files {
        let target = super::disk::safe_target(staging, path)
            .ok_or_else(|| format!("refused to write {path}"))?;
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        match content {
            Joined::Text(bytes) => {
                std::fs::write(target, bytes).map_err(|error| error.to_string())?
            }
            Joined::Blob(hash) => {
                let remaining = left.get_mut(hash).map_or(0, |count| {
                    *count = count.saturating_sub(1);
                    *count
                });
                super::joining::place_blob(downloads, hash, &target, remaining == 0)?;
            }
        }
    }
    crate::project::write_meta_at(
        &staging.join(crate::project_location::MANIFEST_FILE),
        &staged.meta,
    )
}

fn discard_joined(paths: &CollabPaths, local_id: &str) {
    if let Ok(Some(root)) = crate::paths::library_project_root(local_id) {
        let _ = std::fs::remove_dir_all(root);
    }
    if let Ok(dir) = paths.project_dir(local_id) {
        let _ = std::fs::remove_dir_all(dir);
    }
    super::registry::invalidate(local_id);
}

pub async fn join_project(
    state: &CollabState,
    host: &dyn CollabHost,
    progress: JoinReport<'_>,
    server: ServerId,
    shared: SharedProjectId,
) -> Result<String, CollabError> {
    let paths = state.paths()?.clone();
    let ticket = state.begin_join(server, shared);
    let _turn = ticket.turn().await;
    if let Some(local) = local_bindings(&paths).get(&shared) {
        return Ok(local.clone());
    }
    let download = super::joining::download_dir(&paths, shared);
    let joined = join_into(state, host, progress, &ticket, server, shared, &download).await;
    if joined.is_ok() || ticket.is_cancelled() {
        super::joining::forget_download(&download);
    }
    joined
}

async fn join_into(
    state: &CollabState,
    host: &dyn CollabHost,
    progress: JoinReport<'_>,
    ticket: &JoinTicket<'_>,
    server: ServerId,
    shared: SharedProjectId,
    download: &Path,
) -> Result<String, CollabError> {
    refuse_synced_library(crate::folder_status::library_sync_service())?;
    let paths = state.paths()?;
    let entry = known(state, server)?;
    let summary = super::joining::cancellable(
        ticket,
        authed(state, host, server, |client, access| {
            Box::pin(async move { client.project(access, shared).await })
        }),
    )
    .await?;
    let client = client_for(&entry)?;
    let keys = state.keys().await?;
    let sessions = keys.sessions.as_ref();
    let downloads = Downloads {
        ticket,
        sessions,
        server,
        client: &client,
        shared,
        dir: download,
    };
    let verified = downloads
        .guarded(with_access(sessions, server, &client, |client, access| {
            Box::pin(async move {
                oleafly_collab::snapshots::fetch_verified(
                    client,
                    access,
                    shared,
                    &oleafly_collab::devices::DeviceRegistry::default(),
                )
                .await
            })
        }))
        .await?;
    let seq = verified.seq;
    let doc = ProjectDoc::load_contained(&verified.bytes)?;
    let layout = materialize::layout(&doc.nodes()?);
    let mut staged = Staged {
        dirs: Vec::new(),
        files: Vec::new(),
        uses: HashMap::new(),
        meta: serde_json::from_str("{}")
            .map_err(|error| CollabError::Corrupt(error.to_string()))?,
    };
    let mut blobs: BTreeMap<String, String> = BTreeMap::new();
    let mut hashes: BTreeMap<String, String> = BTreeMap::new();
    for (id, placed) in &layout {
        match placed.kind {
            NodeKind::Dir => staged.dirs.push(placed.path.clone()),
            NodeKind::Text => {
                let bytes = with_line_endings(&doc.text(id)?, doc.crlf(id));
                hashes.insert(placed.path.clone(), sha256_hex(&bytes));
                staged
                    .files
                    .push((placed.path.clone(), Joined::Text(bytes)));
            }
            NodeKind::Blob => {
                let Some(hash) = &placed.blob else { continue };
                blobs
                    .entry(hash.clone())
                    .or_insert_with(|| placed.path.clone());
                *staged.uses.entry(hash.clone()).or_default() += 1;
                hashes.insert(placed.path.clone(), hash.clone());
                staged
                    .files
                    .push((placed.path.clone(), Joined::Blob(hash.clone())));
            }
        }
    }
    let report = |done: usize, total: usize| {
        progress(JoinProgress {
            server_id: server,
            shared_project_id: shared,
            done,
            total,
        });
    };
    downloads.fetch(&blobs, &report).await?;
    staged.meta.name = summary.title.clone();
    let settings_base = super::settings::joined(&doc, &mut staged.meta)?;
    downloads.check()?;
    let source = download.to_path_buf();
    let local_id = tauri::async_runtime::spawn_blocking(move || {
        crate::project::create_library_project_with(|local_id, staging| {
            stage_joined(staging, local_id, staged, &source)
        })
    })
    .await
    .map_err(io)?
    .map_err(CollabError::Io)?;
    let finished = async {
        crate::project::initialize_git_for_new_project(&local_id);
        let mut live = LiveProject::new(doc, seq, summary.role);
        if let Some(listed) = verified.listed {
            live.pin_devices(listed);
        }
        let peers = downloads
            .guarded(with_access(sessions, server, &client, |client, access| {
                Box::pin(async move { client.project_peers(access, shared).await })
            }))
            .await;
        downloads.check()?;
        admit_writers(&mut live, peers);
        live.save(&paths.document_dir(&local_id)?)?;
        DiskState {
            layout,
            hashes,
            owed: Default::default(),
        }
        .save(&paths.materializer_index_file(&local_id)?)?;
        super::settings::remember(
            &super::settings::base_file(paths, &local_id)?,
            &settings_base,
        )?;
        downloads.check()?;
        save_binding(
            paths,
            &local_id,
            &ShareBinding {
                server_url: entry.url.clone(),
                server_id: server,
                shared_project_id: shared,
                role: summary.role,
                created_at: now_ms(),
            },
        )
    }
    .await;
    if let Err(error) = finished {
        discard_joined(paths, &local_id);
        return Err(error);
    }
    super::registry::invalidate(&local_id);
    super::live::note_fresh_join(&local_id);
    Ok(local_id)
}

fn admit_writers(live: &mut LiveProject, listed: Result<Vec<ProjectPeer>, CollabError>) {
    match listed {
        Ok(peers) => live.pin_peers(peers),
        Err(_) => live.await_writers(),
    }
}

fn parse_link(link: &str) -> Result<(String, SharedProjectId), CollabError> {
    let invalid = || api(400, "not_a_link", "this is not a shared project link");
    let url = tauri::Url::parse(link.trim()).map_err(|_| invalid())?;
    if url.scheme() == "oleafly" {
        let pairs: HashMap<String, String> = url.query_pairs().into_owned().collect();
        let server = pairs.get("server").cloned().ok_or_else(invalid)?;
        let project = pairs
            .get("project")
            .and_then(|id| id.parse().ok())
            .ok_or_else(invalid)?;
        return Ok((server, project));
    }
    let text = url.as_str().trim_end_matches('/');
    let (server, id) = text.rsplit_once("/p/").ok_or_else(invalid)?;
    let project = id
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .parse()
        .map_err(|_| invalid())?;
    Ok((server.to_owned(), project))
}

pub async fn open_link(
    state: &CollabState,
    host: &dyn CollabHost,
    progress: JoinReport<'_>,
    link: &str,
) -> Result<String, CollabError> {
    let (server_url, shared) = parse_link(link)?;
    refuse_synced_library(crate::folder_status::library_sync_service())?;
    let wanted = ServerUrl::parse(&server_url)?;
    let entry = state
        .registry()?
        .list()
        .iter()
        .find(|entry| {
            ServerUrl::parse(&entry.url).is_ok_and(|known| known.as_str() == wanted.as_str())
        })
        .cloned()
        .ok_or_else(|| api(404, "server_unknown", wanted.as_str()))?;
    let server = entry.server_id;
    let visible = authed(state, host, server, |client, access| {
        Box::pin(async move { client.project(access, shared).await })
    })
    .await;
    if matches!(visible, Err(CollabError::Api { status: 404, .. })) {
        authed(state, host, server, |client, access| {
            Box::pin(async move { client.join_project(access, shared).await })
        })
        .await?;
    } else {
        visible?;
    }
    join_project(state, host, progress, server, shared).await
}

async fn with_binding<T, F>(
    state: &CollabState,
    host: &dyn CollabHost,
    project_id: &str,
    call: F,
) -> Result<T, CollabError>
where
    F: for<'a> Fn(
        &'a oleafly_collab::ServerClient,
        &'a str,
        SharedProjectId,
    ) -> super::commands::ApiCall<'a, T>,
{
    let binding = binding_of(state.paths()?, project_id)?;
    let shared = binding.shared_project_id;
    authed(state, host, binding.server_id, |client, access| {
        call(client, access, shared)
    })
    .await
}

pub async fn forget_local(project_id: &str) {
    if let Ok(root) = crate::paths::collab_root() {
        super::live::forget(project_id, &CollabPaths::new(root)).await;
    }
}

pub(crate) async fn let_go_keeping_origin(project_id: &str, paths: &CollabPaths) {
    super::live::stop(project_id).await;
    let paths = paths.clone();
    let id = project_id.to_owned();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        super::live::local_copy::keep_stored_origin(&paths, &id);
        super::live::local_copy::forget_all_but_origin(&paths, &id);
    })
    .await;
    super::registry::invalidate(project_id);
}

pub async fn forget_local_keeping_origin(project_id: &str) {
    if let Ok(root) = crate::paths::collab_root() {
        let_go_keeping_origin(project_id, &CollabPaths::new(root)).await;
    }
}

#[tauri::command]
pub async fn collab_share_info(
    state: tauri::State<'_, CollabState>,
    project_id: String,
) -> Result<Option<ShareInfo>, CollabCommandError> {
    share_info(state.inner(), &project_id).map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_share_check(
    state: tauri::State<'_, CollabState>,
    project_id: String,
    server_id: String,
) -> Result<ShareCheck, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    share_check(state.inner(), &project_id, server)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_share_project(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    server_id: String,
) -> Result<ShareInfo, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    let host = AppHost::new(app.clone());
    let progress = |done: usize, total: usize| {
        let _ = app.emit(
            SHARE_PROGRESS_EVENT,
            ShareProgress {
                project_id: project_id.clone(),
                done,
                total,
            },
        );
    };
    share_project(state.inner(), &host, &progress, &project_id, server)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_project_summary(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
) -> Result<ProjectSummary, CollabCommandError> {
    let host = AppHost::new(app);
    with_binding(
        state.inner(),
        &host,
        &project_id,
        |client, access, shared| Box::pin(async move { client.project(access, shared).await }),
    )
    .await
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_members_list(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
) -> Result<Vec<ProjectMember>, CollabCommandError> {
    let host = AppHost::new(app);
    with_binding(
        state.inner(),
        &host,
        &project_id,
        |client, access, shared| Box::pin(async move { client.members(access, shared).await }),
    )
    .await
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_member_set(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    account_id: String,
    role: ProjectRole,
) -> Result<ProjectMember, CollabCommandError> {
    let account: AccountId = parse_id(&account_id, "account")?;
    let host = AppHost::new(app);
    with_binding(
        state.inner(),
        &host,
        &project_id,
        |client, access, shared| {
            Box::pin(async move { client.grant_member(access, shared, account, role).await })
        },
    )
    .await
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_member_remove(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    account_id: String,
) -> Result<(), CollabCommandError> {
    let account: AccountId = parse_id(&account_id, "account")?;
    let host = AppHost::new(app);
    with_binding(
        state.inner(),
        &host,
        &project_id,
        |client, access, shared| {
            Box::pin(async move { client.remove_member(access, shared, account).await })
        },
    )
    .await
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_people_search(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    query: String,
) -> Result<Vec<PersonSummary>, CollabCommandError> {
    let host = AppHost::new(app);
    with_binding(state.inner(), &host, &project_id, |client, access, _| {
        let query = query.clone();
        Box::pin(async move { client.directory(access, &query).await })
    })
    .await
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_link_sharing_set(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    enabled: bool,
    role: ProjectRole,
) -> Result<ProjectSummary, CollabCommandError> {
    let host = AppHost::new(app);
    let patch = ProjectPatch {
        title: None,
        link_sharing: Some(enabled),
        link_role: Some(role),
        comments_enabled: None,
        access_log: None,
    };
    with_binding(
        state.inner(),
        &host,
        &project_id,
        |client, access, shared| {
            let patch = patch.clone();
            Box::pin(async move { client.patch_project(access, shared, &patch).await })
        },
    )
    .await
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_stop_sharing(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
) -> Result<(), CollabCommandError> {
    let host = AppHost::new(app);
    with_binding(
        state.inner(),
        &host,
        &project_id,
        |client, access, shared| {
            Box::pin(async move { client.archive_project(access, shared).await })
        },
    )
    .await
    .map_err(CollabCommandError::from)?;
    forget_local(&project_id).await;
    Ok(())
}

pub async fn leave_project(
    state: &CollabState,
    host: &dyn CollabHost,
    project_id: &str,
) -> Result<(), CollabError> {
    let paths = state.paths()?.clone();
    let binding = binding_of(&paths, project_id)?;
    let Some(entry) = state.registry()?.get(binding.server_id).cloned() else {
        super::live::forget(project_id, &paths).await;
        return Ok(());
    };
    let account = entry
        .account
        .map(|account| account.account_id)
        .filter(|_| state.has_session(binding.server_id).unwrap_or(false))
        .ok_or_else(super::commands::signed_out)?;
    let removed = with_binding(state, host, project_id, |client, access, shared| {
        Box::pin(async move { client.remove_member(access, shared, account).await })
    })
    .await;
    match removed {
        Ok(()) | Err(CollabError::Api { status: 404, .. }) => {}
        Err(error) => return Err(error),
    }
    super::live::forget(project_id, &paths).await;
    Ok(())
}

#[tauri::command]
pub async fn collab_leave_project(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
) -> Result<(), CollabCommandError> {
    let host = AppHost::new(app);
    leave_project(state.inner(), &host, &project_id)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_shared_with_me(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
) -> Result<Vec<SharedWithMe>, CollabCommandError> {
    let host = AppHost::new(app);
    shared_with_me(state.inner(), &host)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_join_project(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    shared_project_id: String,
) -> Result<String, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    let shared = parse_id(&shared_project_id, "project")?;
    let host = AppHost::new(app.clone());
    let progress = |progress: JoinProgress| super::joining::emit(&app, progress);
    join_project(state.inner(), &host, &progress, server, shared)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_open_link(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    link: String,
) -> Result<String, CollabCommandError> {
    let host: Arc<dyn CollabHost> = Arc::new(AppHost::new(app.clone()));
    let progress = |progress: JoinProgress| super::joining::emit(&app, progress);
    open_link(state.inner(), host.as_ref(), &progress, &link)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_link_preview(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    shared_project_id: String,
) -> Result<ProjectSummary, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    let shared = parse_id(&shared_project_id, "project")?;
    let host = AppHost::new(app);
    authed(state.inner(), &host, server, |client, access| {
        Box::pin(async move { client.join_preview(access, shared).await })
    })
    .await
    .map_err(CollabCommandError::from)
}

#[cfg(test)]
mod transfer_tests {
    use std::sync::atomic::{AtomicBool, Ordering};

    use super::*;
    use crate::collab::testing::{Browser, Lab, Relay, TempLibrary};

    const PLOTS: [(&str, [u8; 4]); 3] = [
        ("figs/a.png", [0x89, b'P', 0, 1]),
        ("figs/b.png", [0x89, b'P', 0, 2]),
        ("figs/c.png", [0x89, b'P', 0, 3]),
    ];

    fn state_in(dir: &tempfile::TempDir, name: &str) -> CollabState {
        CollabState::new(
            CollabPaths::new(dir.path().join(name)),
            Arc::new(oleafly_collab::MemorySecrets::default()),
        )
    }

    fn paper(library: &TempLibrary, project_id: &str) {
        let root = library.project(project_id, &[("main.tex", "hello\n")]);
        std::fs::create_dir_all(root.join("figs")).unwrap();
        for (path, bytes) in PLOTS {
            std::fs::write(root.join(path), bytes).unwrap();
        }
    }

    async fn projects(state: &CollabState, server: ServerId) -> Vec<ProjectSummary> {
        authed(state, &Browser, server, |client, access| {
            Box::pin(async move { client.projects(access).await })
        })
        .await
        .unwrap()
    }

    fn code(result: &Result<impl Sized, CollabError>) -> Option<&'static str> {
        result
            .as_ref()
            .err()
            .map(|error| CollabCommandError::from(error.clone()).code)
    }

    fn library_projects() -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(crate::paths::projects_root().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| !name.starts_with('.'))
            .collect();
        names.sort();
        names
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn sharing_one_project_twice_at_once_creates_one_server_project() {
        let library = TempLibrary::new();
        paper(&library, "twice");
        let lab = Lab::start().await;
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(&dir, "collab");
        let server = lab.sign_in(&state, &lab.server.url(), true).await;
        let quiet = |_: usize, _: usize| {};
        let (first, second) = tokio::join!(
            share_project(&state, &Browser, &quiet, "twice", server),
            share_project(&state, &Browser, &quiet, "twice", server),
        );
        assert!(first.is_ok(), "{first:?}");
        assert_eq!(code(&second), Some("share_in_progress"));
        assert_eq!(projects(&state, server).await.len(), 1);
        let again = share_project(&state, &Browser, &quiet, "twice", server)
            .await
            .unwrap();
        assert_eq!(again.shared_project_id, first.unwrap().shared_project_id);
        assert!(load_pending(state.paths().unwrap(), "twice").is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_shared_project_needs_this_computer_to_trust_it_again_before_tools_run() {
        let library = TempLibrary::new();
        paper(&library, "trusted-once");
        assert!(crate::trust::is_trusted("trusted-once"));
        let lab = Lab::start().await;
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(&dir, "collab");
        let server = lab.sign_in(&state, &lab.server.url(), true).await;
        share_project(&state, &Browser, &|_, _| {}, "trusted-once", server)
            .await
            .unwrap();
        assert_eq!(
            crate::trust::project_trust("trusted-once").unwrap(),
            crate::trust::TrustState::Restricted
        );
        for capability in [
            crate::trust::Capability::RunCommand,
            crate::trust::Capability::FullAccess,
            crate::trust::Capability::ExternalAgents,
            crate::trust::Capability::TerminalAutostart,
        ] {
            assert!(crate::trust::require_trusted("trusted-once", capability).is_err());
        }
    }

    #[cfg(not(windows))]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_name_the_layout_changes_is_renamed_on_disk_when_the_project_is_shared() {
        let library = TempLibrary::new();
        let root = library.project(
            "odd-names",
            &[("main.tex", "hello\n"), ("aux.tex", "aux\n")],
        );
        let lab = Lab::start().await;
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(&dir, "collab");
        let server = lab.sign_in(&state, &lab.server.url(), true).await;
        share_project(&state, &Browser, &|_, _| {}, "odd-names", server)
            .await
            .unwrap();
        let disk = DiskState::load(
            &state
                .paths()
                .unwrap()
                .materializer_index_file("odd-names")
                .unwrap(),
        );
        let laid = disk
            .layout
            .values()
            .find(|placed| placed.path.starts_with("unnamed-"))
            .expect("aux.tex is laid out under a safe name")
            .path
            .clone();
        assert!(!root.join("aux.tex").exists());
        assert_eq!(std::fs::read_to_string(root.join(&laid)).unwrap(), "aux\n");
        assert!(disk.hashes.contains_key(&laid));
        assert!(!disk.hashes.contains_key("aux.tex"));
        assert_eq!(
            std::fs::read_to_string(root.join("main.tex")).unwrap(),
            "hello\n"
        );
    }

    #[derive(Default)]
    struct Heard {
        renamed: std::sync::Mutex<Vec<(String, String)>>,
        notices: std::sync::Mutex<Vec<super::super::settings::SettingsChangedPayload>>,
    }

    impl CollabHost for Heard {
        fn open_browser(&self, url: &str) -> Result<(), CollabError> {
            Browser.open_browser(url)
        }
        fn server_changed(&self, _: ServerId) {}
        fn signed_in(&self) {}
        fn device_name(&self) -> String {
            Browser.device_name()
        }
        fn platform(&self) -> String {
            Browser.platform()
        }
        fn renamed_on_disk(&self, _: &str, renamed: &[(String, String)]) {
            self.renamed.lock().unwrap().extend(renamed.iter().cloned());
        }
        fn settings_changed(&self, applied: super::super::settings::Applied) {
            self.notices.lock().unwrap().extend(applied.notices);
        }
    }

    #[cfg(not(windows))]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn sharing_tells_the_window_what_it_renamed_and_follows_a_renamed_main_file() {
        let library = TempLibrary::new();
        let root = library.project(
            "odd-main",
            &[("aux.tex", "\\documentclass{article}\n"), ("con.bib", "@a")],
        );
        let mut meta = crate::project::read_meta("odd-main").unwrap();
        meta.main_doc = "aux.tex".to_owned();
        crate::project::write_meta("odd-main", &meta).unwrap();
        let lab = Lab::start().await;
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(&dir, "collab");
        let server = lab.sign_in(&state, &lab.server.url(), true).await;
        let heard = Heard::default();
        share_project(&state, &heard, &|_, _| {}, "odd-main", server)
            .await
            .unwrap();
        let main = shared_main(&state, "odd-main");
        assert!(main.starts_with("unnamed-"), "{main}");
        assert!(root.join(&main).is_file() && !root.join("aux.tex").exists());
        let mut renamed = heard.renamed.lock().unwrap().clone();
        renamed.sort();
        let bib = renamed
            .iter()
            .find(|(from, _)| from == "con.bib")
            .map(|(_, to)| to.clone())
            .expect("the bibliography was renamed too");
        let mut expected = vec![
            ("aux.tex".to_owned(), main.clone()),
            ("con.bib".to_owned(), bib),
        ];
        expected.sort();
        assert_eq!(renamed, expected);
        assert_eq!(
            crate::project::read_meta("odd-main").unwrap().main_doc,
            main
        );
        let notices = heard.notices.lock().unwrap();
        assert_eq!(notices.len(), 1);
        assert_eq!(
            notices[0].changes,
            vec![super::super::settings::SettingNotice::MainDocument { path: main }]
        );
    }

    fn shared_main(state: &CollabState, project_id: &str) -> String {
        let paths = state.paths().unwrap();
        let disk = DiskState::load(&paths.materializer_index_file(project_id).unwrap());
        let doc = LiveProject::load(&paths.document_dir(project_id).unwrap(), ProjectRole::Owner)
            .unwrap();
        let id = doc
            .doc()
            .settings()
            .main_doc()
            .expect("the main file is shared");
        disk.layout[&id.to_string()].path.clone()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_main_file_beside_a_second_spelling_stays_the_main_document_after_sharing() {
        let library = TempLibrary::new();
        let root = library.project("two-mains", &[("Main.tex", "upper\n")]);
        std::fs::write(root.join("main.tex"), "lower\n").unwrap();
        if std::fs::read_to_string(root.join("Main.tex")).unwrap() != "upper\n" {
            return;
        }
        let lab = Lab::start().await;
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(&dir, "collab");
        let server = lab.sign_in(&state, &lab.server.url(), true).await;
        let heard = Heard::default();
        share_project(&state, &heard, &|_, _| {}, "two-mains", server)
            .await
            .unwrap();
        let main = shared_main(&state, "two-mains");
        assert_eq!(
            std::fs::read_to_string(root.join(&main)).unwrap(),
            "lower\n"
        );
        assert_eq!(
            crate::project::read_meta("two-mains").unwrap().main_doc,
            main
        );
        let told = heard.notices.lock().unwrap().len();
        assert_eq!(told, usize::from(main != "main.tex"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_share_finishes_although_its_access_token_expires_halfway() {
        let library = TempLibrary::new();
        paper(&library, "slow-share");
        let lab = Lab::start().await;
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(&dir, "collab");
        let server = lab.sign_in(&state, &lab.server.url(), true).await;
        let clock = lab.server.clock();
        let expired = AtomicBool::new(false);
        let progress = |done: usize, _: usize| {
            if done == 1 && !expired.swap(true, Ordering::SeqCst) {
                clock.advance(11 * 60 * 1000);
            }
        };
        let shared = share_project(&state, &Browser, &progress, "slow-share", server)
            .await
            .unwrap();
        assert!(expired.load(Ordering::SeqCst));
        let listed = projects(&state, server).await;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].project_id, shared.shared_project_id);
        assert_eq!(listed[0].status, ProjectStatus::Active);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_share_cut_off_halfway_resumes_without_sending_its_files_again() {
        let library = TempLibrary::new();
        paper(&library, "cut-share");
        let relay = Relay::bind().await;
        let lab = Lab::behind(&relay).await;
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(&dir, "collab");
        let server = lab.sign_in(&state, &relay.url, true).await;
        let cut = |done: usize, _: usize| {
            if done == 1 {
                relay.set_down(true);
            }
        };
        let first = share_project(&state, &Browser, &cut, "cut-share", server).await;
        assert_eq!(code(&first), Some("unreachable"));
        let pending = load_pending(state.paths().unwrap(), "cut-share").expect("kept for a retry");
        assert_eq!(pending.sent.len(), 1);
        assert!(!pending.snapshot_sent);
        relay.set_down(false);
        relay.forget_seen();
        let quiet = |_: usize, _: usize| {};
        let shared = share_project(&state, &Browser, &quiet, "cut-share", server)
            .await
            .unwrap();
        assert_eq!(shared.shared_project_id, pending.shared_project_id);
        let put = format!("PUT /api/v1/projects/{}/blobs/", shared.shared_project_id);
        assert_eq!(relay.requests(&put), PLOTS.len() - 1);
        assert_eq!(relay.requests("POST /api/v1/projects HTTP"), 0);
        assert_eq!(projects(&state, server).await.len(), 1);
        assert!(load_pending(state.paths().unwrap(), "cut-share").is_none());
    }

    struct Joiner {
        _library: TempLibrary,
        lab: Lab,
        relay: Relay,
        _dir: tempfile::TempDir,
        owner: CollabState,
        member: CollabState,
        server: ServerId,
        shared: SharedProjectId,
    }

    impl Joiner {
        async fn start() -> Joiner {
            let library = TempLibrary::new();
            paper(&library, "to-join");
            let relay = Relay::bind().await;
            let lab = Lab::behind(&relay).await;
            let dir = tempfile::tempdir().unwrap();
            let owner = state_in(&dir, "owner");
            let server = lab.sign_in(&owner, &relay.url, true).await;
            let shared = share_project(&owner, &Browser, &|_, _| {}, "to-join", server)
                .await
                .unwrap()
                .shared_project_id;
            let member = state_in(&dir, "member");
            assert_eq!(lab.sign_in(&member, &relay.url, false).await, server);
            Joiner {
                _library: library,
                lab,
                relay,
                _dir: dir,
                owner,
                member,
                server,
                shared,
            }
        }

        async fn join(&self, progress: JoinReport<'_>) -> Result<String, CollabError> {
            join_project(&self.member, &Browser, progress, self.server, self.shared).await
        }

        fn download(&self) -> PathBuf {
            super::super::joining::download_dir(self.member.paths().unwrap(), self.shared)
        }
    }

    fn quiet(_: JoinProgress) {}

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn joining_reports_progress_and_finishes_although_its_token_expires_halfway() {
        let joiner = Joiner::start().await;
        let clock = joiner.lab.server.clock();
        let heard = std::sync::Mutex::new(Vec::new());
        let progress = |progress: JoinProgress| {
            if progress.done == 1 {
                clock.advance(11 * 60 * 1000);
            }
            heard.lock().unwrap().push((progress.done, progress.total));
        };
        let local_id = joiner.join(&progress).await.unwrap();
        assert_eq!(*heard.lock().unwrap(), [(0, 3), (1, 3), (2, 3), (3, 3)]);
        let root = crate::paths::project_dir(&local_id).unwrap();
        for (path, bytes) in PLOTS {
            assert_eq!(std::fs::read(root.join(path)).unwrap(), bytes, "{path}");
        }
        assert_eq!(
            std::fs::read_to_string(root.join("main.tex")).unwrap(),
            "hello\n"
        );
        assert_eq!(
            crate::trust::project_trust(&local_id).unwrap(),
            crate::trust::TrustState::Restricted
        );
        assert!(load_binding(joiner.member.paths().unwrap(), &local_id)
            .unwrap()
            .is_some());
        assert!(!joiner.download().exists());
        assert!(joiner.owner.paths().is_ok());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_join_cut_off_halfway_resumes_without_downloading_its_files_again() {
        let joiner = Joiner::start().await;
        let cut = |progress: JoinProgress| {
            if progress.done == 1 {
                joiner.relay.set_down(true);
            }
        };
        let before = library_projects();
        let first = joiner.join(&cut).await;
        assert_eq!(code(&first), Some("unreachable"));
        assert_eq!(library_projects(), before);
        let kept: Vec<_> = std::fs::read_dir(joiner.download()).unwrap().collect();
        assert_eq!(kept.len(), 1);
        joiner.relay.set_down(false);
        joiner.relay.forget_seen();
        let local_id = joiner.join(&quiet).await.unwrap();
        let get = format!("GET /api/v1/projects/{}/blobs/", joiner.shared);
        assert_eq!(joiner.relay.requests(&get), PLOTS.len() - 1);
        let root = crate::paths::project_dir(&local_id).unwrap();
        for (path, bytes) in PLOTS {
            assert_eq!(std::fs::read(root.join(path)).unwrap(), bytes, "{path}");
        }
        assert!(!joiner.download().exists());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancelling_a_join_stops_it_and_leaves_nothing_behind() {
        let joiner = Joiner::start().await;
        let cancel = |progress: JoinProgress| {
            if progress.done == 1 {
                super::super::joining::cancel_join(&joiner.member, joiner.server, joiner.shared);
            }
        };
        let before = library_projects();
        let joined = joiner.join(&cancel).await;
        assert_eq!(code(&joined), Some("cancelled"));
        assert!(!joiner.download().exists());
        assert_eq!(library_projects(), before);
        assert!(local_bindings(joiner.member.paths().unwrap()).is_empty());
        let local_id = joiner.join(&quiet).await.unwrap();
        assert!(crate::paths::project_dir(&local_id).unwrap().is_dir());
    }

    async fn cancelled_once_stalled(joiner: &Joiner, needle: &str) -> Result<String, CollabError> {
        joiner.relay.stall(Some(needle));
        let cancel = async {
            while joiner.relay.stalls() == 0 {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
            super::super::joining::cancel_join(&joiner.member, joiner.server, joiner.shared);
        };
        let both = async { tokio::join!(joiner.join(&quiet), cancel) };
        tokio::time::timeout(std::time::Duration::from_secs(15), both)
            .await
            .expect("the join stopped once it was cancelled")
            .0
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_join_cancelled_while_the_server_is_slow_to_answer_stops_at_once() {
        let joiner = Joiner::start().await;
        let before = library_projects();
        let first = format!("GET /api/v1/projects/{} HTTP", joiner.shared);
        let joined = cancelled_once_stalled(&joiner, &first).await;
        assert_eq!(code(&joined), Some("cancelled"));
        assert_eq!(library_projects(), before);
        assert!(local_bindings(joiner.member.paths().unwrap()).is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_join_cancelled_after_its_downloads_takes_the_new_project_back() {
        let joiner = Joiner::start().await;
        let before = library_projects();
        let peers = format!("/api/v1/projects/{}/peers HTTP", joiner.shared);
        let joined = cancelled_once_stalled(&joiner, &peers).await;
        assert_eq!(code(&joined), Some("cancelled"));
        assert_eq!(library_projects(), before);
        assert!(local_bindings(joiner.member.paths().unwrap()).is_empty());
        assert!(!joiner.download().exists());
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_join_that_fails_after_publishing_takes_the_new_project_back() {
        use std::os::unix::fs::PermissionsExt;
        let joiner = Joiner::start().await;
        let collab = joiner.member.paths().unwrap().root().to_path_buf();
        std::fs::set_permissions(&collab, std::fs::Permissions::from_mode(0o555)).unwrap();
        let unguarded = std::fs::create_dir(collab.join("probe")).is_ok();
        std::fs::set_permissions(&collab, std::fs::Permissions::from_mode(0o755)).unwrap();
        if unguarded {
            return;
        }
        let locked = AtomicBool::new(false);
        let lock = |progress: JoinProgress| {
            if progress.done == progress.total && !locked.swap(true, Ordering::SeqCst) {
                std::fs::set_permissions(&collab, std::fs::Permissions::from_mode(0o555)).unwrap();
            }
        };
        let before = library_projects();
        let joined = joiner.join(&lock).await;
        std::fs::set_permissions(&collab, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(locked.load(Ordering::SeqCst));
        assert_eq!(code(&joined), Some("internal"));
        assert_eq!(library_projects(), before);
        assert!(local_bindings(joiner.member.paths().unwrap()).is_empty());
    }

    #[test]
    fn joining_into_a_cloud_synced_library_is_refused_with_its_own_code() {
        let refused = refuse_synced_library(Some(crate::folder_status::SyncService::Dropbox));
        assert_eq!(code(&refused), Some("cloud_synced"));
        assert!(refuse_synced_library(None).is_ok());
    }

    #[test]
    fn a_pending_share_round_trips_and_is_forgotten() {
        let dir = tempfile::tempdir().unwrap();
        let paths = CollabPaths::new(dir.path().join("collab"));
        assert!(load_pending(&paths, "paper").is_none());
        let pending = PendingShare {
            server_id: ServerId::new_v7(),
            shared_project_id: SharedProjectId::new_v7(),
            sent: [sha256_hex(b"plot")].into_iter().collect(),
            snapshot_sent: false,
        };
        std::fs::create_dir_all(paths.project_dir("paper").unwrap()).unwrap();
        save_pending(&paths, "paper", &pending).unwrap();
        assert_eq!(load_pending(&paths, "paper"), Some(pending));
        forget_pending(&paths, "paper");
        assert!(load_pending(&paths, "paper").is_none());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_collab::settings::Engine;

    #[test]
    fn links_from_the_landing_page_and_the_app_scheme_parse() {
        let id: SharedProjectId = "01920000-0000-7000-8000-000000000005".parse().unwrap();
        assert_eq!(
            parse_link(&format!("https://uni.edu/oleafly/p/{id}")).unwrap(),
            ("https://uni.edu/oleafly".to_owned(), id)
        );
        assert_eq!(
            parse_link(&format!(
                "oleafly://open?server=https%3A%2F%2Funi.edu&project={id}"
            ))
            .unwrap(),
            ("https://uni.edu".to_owned(), id)
        );
        for typo in [
            "https://uni.edu/p/not-an-id",
            "hello",
            "https://uni.edu/oleafly/p/",
            "oleafly://open?server=https%3A%2F%2Funi.edu",
        ] {
            let refused = CollabCommandError::from(parse_link(typo).expect_err(typo));
            assert_eq!(refused.code, "not_a_link", "{typo}");
        }
    }

    struct NoBrowser;

    impl CollabHost for NoBrowser {
        fn open_browser(&self, _: &str) -> Result<(), CollabError> {
            Ok(())
        }
        fn server_changed(&self, _: ServerId) {}
        fn signed_in(&self) {}
        fn device_name(&self) -> String {
            "Test Mac".to_owned()
        }
        fn platform(&self) -> String {
            "macos".to_owned()
        }
    }

    fn bound_state(dir: &tempfile::TempDir, server: ServerId, listed: bool) -> CollabState {
        let state = CollabState::new(
            CollabPaths::new(dir.path().join("collab")),
            Arc::new(oleafly_collab::MemorySecrets::default()),
        );
        save_binding(
            state.paths().unwrap(),
            "left-paper",
            &ShareBinding {
                server_url: "http://127.0.0.1:9".to_owned(),
                server_id: server,
                shared_project_id: SharedProjectId::new_v7(),
                role: ProjectRole::Editor,
                created_at: 1,
            },
        )
        .unwrap();
        if listed {
            state
                .update_registry(|registry| {
                    registry.upsert(oleafly_collab::ServerEntry {
                        server_id: server,
                        url: "http://127.0.0.1:9".to_owned(),
                        name: "Smith Lab".to_owned(),
                        icon_url: None,
                        account: None,
                        added_at: 1,
                    })
                })
                .unwrap();
        }
        state
    }

    #[test]
    fn leaving_a_project_whose_server_was_removed_lets_go_of_it_here() {
        let dir = tempfile::tempdir().unwrap();
        let state = bound_state(&dir, ServerId::new_v7(), false);
        tauri::async_runtime::block_on(leave_project(&state, &NoBrowser, "left-paper")).unwrap();
        assert!(load_binding(state.paths().unwrap(), "left-paper")
            .unwrap()
            .is_none());
    }

    #[test]
    fn leaving_while_signed_out_asks_to_sign_in_and_keeps_the_project_shared() {
        let dir = tempfile::tempdir().unwrap();
        let state = bound_state(&dir, ServerId::new_v7(), true);
        let refused =
            tauri::async_runtime::block_on(leave_project(&state, &NoBrowser, "left-paper"))
                .expect_err("nobody is signed in");
        assert_eq!(CollabCommandError::from(refused).code, "signed_out");
        assert!(load_binding(state.paths().unwrap(), "left-paper")
            .unwrap()
            .is_some());
    }

    #[test]
    fn a_copy_joined_without_the_writer_list_shows_no_comment_author_as_verified() {
        let mut written = ProjectDoc::create().unwrap();
        let main = written
            .add_node(None, "main.tex", NodeKind::Text, None, "Hello there\n")
            .unwrap();
        let forged = written
            .create_comment_thread(&main, 0, 5, AccountId::new_v7(), 1, "Not mine", &[])
            .unwrap();
        let snapshot = written.snapshot().unwrap();
        for failure in [
            api(404, "not_found", "Not found."),
            CollabError::Network("offline".to_owned()),
        ] {
            let mut joined =
                LiveProject::new(ProjectDoc::load(&snapshot).unwrap(), 1, ProjectRole::Editor);
            admit_writers(&mut joined, Err(failure));
            let seen = joined
                .doc()
                .comment_thread(&main, forged.id)
                .unwrap()
                .unwrap();
            assert!(!seen.verified);
            assert!(!seen.messages[0].verified);
            assert!(!joined.peers_vouched());
        }
    }

    #[test]
    fn names_that_change_on_disk_are_reported() {
        let renamed = renamed_paths(
            ["main.tex", "figs/a:b.png", "CON.tex"]
                .into_iter()
                .map(str::to_owned),
        );
        assert_eq!(
            renamed,
            vec!["figs/a:b.png".to_owned(), "CON.tex".to_owned()]
        );
    }

    #[test]
    fn a_document_built_from_a_folder_holds_text_blobs_and_settings() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("figs")).unwrap();
        std::fs::write(root.join("main.tex"), "Hello\r\n").unwrap();
        std::fs::write(root.join("figs/plot.png"), [0x89, b'P', 0, 1]).unwrap();
        std::fs::write(root.join("project.json"), "{}").unwrap();
        let built = build_document(
            root,
            &crate::project::ProjectMeta {
                main_doc: "main.tex".into(),
                engine: "tectonic".into(),
                ..crate::project::ProjectMeta::default()
            },
        )
        .unwrap();
        let layout = materialize::layout(&built.doc.nodes().unwrap());
        let paths: Vec<&str> = layout.values().map(|placed| placed.path.as_str()).collect();
        assert!(paths.contains(&"figs/plot.png"));
        assert!(paths.contains(&"main.tex"));
        assert!(!paths.contains(&"project.json"));
        let main = layout
            .iter()
            .find(|(_, placed)| placed.path == "main.tex")
            .unwrap()
            .0;
        assert_eq!(built.doc.text(main).unwrap(), "Hello\n");
        assert_eq!(built.blobs.len(), 1);
        assert_eq!(built.doc.meta("engine").as_deref(), Some("tectonic"));
        let shared = built.doc.settings();
        assert_eq!(shared.engine().map(Engine::as_str), Some("tectonic"));
        assert_eq!(
            shared.main_doc().map(|id| id.to_string()).as_ref(),
            Some(main)
        );
        assert_eq!(built.hashes.len(), 2);
    }

    #[test]
    fn a_shared_crlf_file_is_lf_in_the_document_and_remembered_as_crlf() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("windows.tex"), "one\r\ntwo\r\n").unwrap();
        std::fs::write(root.join("unix.tex"), "one\ntwo\n").unwrap();
        let built = build_document(
            root,
            &crate::project::ProjectMeta {
                main_doc: "windows.tex".into(),
                engine: "tectonic".into(),
                ..crate::project::ProjectMeta::default()
            },
        )
        .unwrap();
        let layout = materialize::layout(&built.doc.nodes().unwrap());
        let id_of = |path: &str| {
            layout
                .iter()
                .find(|(_, placed)| placed.path == path)
                .unwrap()
                .0
                .clone()
        };
        let (windows, unix) = (id_of("windows.tex"), id_of("unix.tex"));
        assert_eq!(built.doc.text(&windows).unwrap(), "one\ntwo\n");
        assert!(built.doc.crlf(&windows));
        assert!(!built.doc.crlf(&unix));
    }
}
