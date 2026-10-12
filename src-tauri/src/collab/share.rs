use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::Arc;

use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize::{self, safe_name};
use oleafly_collab::{
    load_binding, save_binding, CollabError, CollabPaths, ServerRegistry, ServerUrl, ShareBinding,
};
use oleafly_collab_protocol::ids::{AccountId, ServerId, SharedProjectId};
use oleafly_collab_protocol::projects::{
    PersonSummary, ProjectMember, ProjectPatch, ProjectRole, ProjectSummary,
};
use serde::Serialize;
use tauri::Emitter;

use super::commands::{
    authed, client_for, known, now_ms, parse_id, AppHost, CollabCommandError, CollabHost,
};
use super::disk::{as_text, scan_folder, sha256_hex, DiskState};
use super::state::CollabState;

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
    blobs: BTreeMap<String, Vec<u8>>,
    hashes: BTreeMap<String, String>,
}

fn build_document(root: &Path, main_doc: &str, engine: &str) -> Result<Built, CollabError> {
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
    for (path, _) in &scan.files {
        let bytes = std::fs::read(root.join(path)).map_err(io)?;
        let hash = sha256_hex(&bytes);
        let parent = parent_id(&dirs, path);
        match as_text(&bytes) {
            Some(text) => {
                doc.add_node(
                    parent.as_deref(),
                    &name_of(path),
                    NodeKind::Text,
                    None,
                    &text,
                )?;
            }
            None => {
                doc.add_node(
                    parent.as_deref(),
                    &name_of(path),
                    NodeKind::Blob,
                    Some(&hash),
                    "",
                )?;
                blobs.insert(hash.clone(), bytes);
            }
        }
        hashes.insert(path.clone(), hash);
    }
    doc.set_meta("main_doc", main_doc)?;
    doc.set_meta("engine", engine)?;
    Ok(Built { doc, blobs, hashes })
}

pub async fn share_project(
    state: &CollabState,
    host: &dyn CollabHost,
    app: Option<&tauri::AppHandle>,
    project_id: &str,
    server: ServerId,
) -> Result<ShareInfo, CollabError> {
    if let Some(info) = share_info(state, project_id)? {
        return Ok(info);
    }
    if crate::project_location::kind_of(project_id)
        .map_err(|error| CollabError::Io(error.to_string()))?
        != crate::project_location::ProjectKind::Library
    {
        return Err(api(409, "conflict", "only library projects can be shared"));
    }
    let check = share_check(state, project_id, server).await?;
    if !check.too_large.is_empty() {
        return Err(api(413, "too_large", &check.too_large.join(", ")));
    }
    if check.cloud_synced {
        return Err(api(
            409,
            "conflict",
            "the library is inside a cloud-synced folder",
        ));
    }
    let meta = crate::project::read_meta(project_id).map_err(CollabError::Io)?;
    let title = if meta.name.trim().is_empty() {
        project_id.to_owned()
    } else {
        meta.name.trim().chars().take(200).collect()
    };
    let root = crate::paths::project_dir(project_id).map_err(CollabError::Io)?;
    let (main_doc, engine) = (meta.main_doc.clone(), meta.engine.clone());
    let built =
        tauri::async_runtime::spawn_blocking(move || build_document(&root, &main_doc, &engine))
            .await
            .map_err(io)??;
    let entry = known(state, server)?;
    let created = authed(state, host, server, |client, access| {
        let title = title.clone();
        Box::pin(async move { client.create_project(access, &title).await })
    })
    .await?;
    let shared = created.project_id;
    let client = client_for(&entry)?;
    let keys = state.keys().await?;
    let access = keys.sessions.access_token(server, &client).await?;
    let total = built.blobs.len();
    let progress = |done: usize| {
        if let Some(app) = app {
            let _ = app.emit(
                SHARE_PROGRESS_EVENT,
                ShareProgress {
                    project_id: project_id.to_owned(),
                    done,
                    total,
                },
            );
        }
    };
    progress(0);
    for (index, (hash, bytes)) in built.blobs.iter().enumerate() {
        client
            .put_blob(&access, shared, hash, bytes.clone())
            .await?;
        progress(index + 1);
    }
    client
        .put_snapshot(&access, shared, 0, built.doc.snapshot()?)
        .await?;
    client.commit_project(&access, shared).await?;
    let paths = state.paths()?;
    let layout = materialize::layout(&built.doc.nodes()?);
    let live = LiveProject::new(built.doc, 0, ProjectRole::Owner);
    live.save(&paths.document_dir(project_id)?)?;
    DiskState {
        layout,
        hashes: built.hashes,
    }
    .save(&paths.materializer_index_file(project_id)?)?;
    let binding = ShareBinding {
        server_url: entry.url.clone(),
        server_id: server,
        shared_project_id: shared,
        role: ProjectRole::Owner,
        created_at: now_ms(),
    };
    save_binding(paths, project_id, &binding)?;
    super::registry::invalidate(project_id);
    if meta.allow_shell_escape {
        let mut off = meta;
        off.allow_shell_escape = false;
        let _ = crate::project::write_meta(project_id, &off);
    }
    let _ = crate::project::revoke_shell_escape_trust(project_id);
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

pub async fn join_project(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    shared: SharedProjectId,
) -> Result<String, CollabError> {
    let paths = state.paths()?.clone();
    if let Some(local) = local_bindings(&paths).get(&shared) {
        return Ok(local.clone());
    }
    let entry = known(state, server)?;
    let summary = authed(state, host, server, |client, access| {
        Box::pin(async move { client.project(access, shared).await })
    })
    .await?;
    let client = client_for(&entry)?;
    let keys = state.keys().await?;
    let access = keys.sessions.access_token(server, &client).await?;
    let (seq, snapshot) = client.get_snapshot(&access, shared).await?;
    let doc = ProjectDoc::load(&snapshot)?;
    let layout = materialize::layout(&doc.nodes()?);
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    let mut dirs: Vec<String> = Vec::new();
    let mut fetched: HashMap<String, Vec<u8>> = HashMap::new();
    for (id, placed) in &layout {
        match placed.kind {
            NodeKind::Dir => dirs.push(placed.path.clone()),
            NodeKind::Text => files.push((placed.path.clone(), doc.text(id)?.into_bytes())),
            NodeKind::Blob => {
                let Some(hash) = &placed.blob else { continue };
                if !fetched.contains_key(hash) {
                    let bytes = client.get_blob(&access, shared, hash).await?;
                    if sha256_hex(&bytes) != *hash {
                        return Err(CollabError::Corrupt(format!(
                            "{} arrived damaged",
                            placed.path
                        )));
                    }
                    fetched.insert(hash.clone(), bytes);
                }
                files.push((placed.path.clone(), fetched[hash].clone()));
            }
        }
    }
    let hashes: BTreeMap<String, String> = files
        .iter()
        .map(|(path, bytes)| (path.clone(), sha256_hex(bytes)))
        .collect();
    let mut meta: crate::project::ProjectMeta =
        serde_json::from_str("{}").map_err(|error| CollabError::Corrupt(error.to_string()))?;
    meta.name = summary.title.clone();
    if let Some(main_doc) = doc.meta("main_doc").filter(|main| !main.is_empty()) {
        meta.main_doc = main_doc;
    }
    if let Some(engine) = doc.meta("engine").filter(|engine| !engine.is_empty()) {
        meta.engine = engine;
    }
    let local_id = tauri::async_runtime::spawn_blocking(move || {
        crate::project::create_library_project_with(|_, staging| {
            for dir in &dirs {
                if let Some(target) = super::disk::safe_target(staging, dir) {
                    std::fs::create_dir_all(target).map_err(|error| error.to_string())?;
                }
            }
            for (path, bytes) in &files {
                let target = super::disk::safe_target(staging, path)
                    .ok_or_else(|| format!("refused to write {path}"))?;
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                std::fs::write(target, bytes).map_err(|error| error.to_string())?;
            }
            crate::project::write_meta_at(
                &staging.join(crate::project_location::MANIFEST_FILE),
                &meta,
            )
        })
    })
    .await
    .map_err(io)?
    .map_err(CollabError::Io)?;
    crate::trust::mark_library_restricted(&local_id)
        .map_err(|error| CollabError::Io(format!("{error:?}")))?;
    crate::project::initialize_git_for_new_project(&local_id);
    let live = LiveProject::new(doc, seq, summary.role);
    live.save(&paths.document_dir(&local_id)?)?;
    DiskState { layout, hashes }.save(&paths.materializer_index_file(&local_id)?)?;
    save_binding(
        &paths,
        &local_id,
        &ShareBinding {
            server_url: entry.url.clone(),
            server_id: server,
            shared_project_id: shared,
            role: summary.role,
            created_at: now_ms(),
        },
    )?;
    super::registry::invalidate(&local_id);
    super::live::note_fresh_join(&local_id);
    Ok(local_id)
}

fn parse_link(link: &str) -> Result<(String, SharedProjectId), CollabError> {
    let invalid = || api(400, "not_found", "this is not a shared project link");
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
    link: &str,
) -> Result<String, CollabError> {
    let (server_url, shared) = parse_link(link)?;
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
    join_project(state, host, server, shared).await
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
    share_project(state.inner(), &host, Some(&app), &project_id, server)
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

#[tauri::command]
pub async fn collab_leave_project(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
) -> Result<(), CollabCommandError> {
    let host = AppHost::new(app);
    let account = share_info(state.inner(), &project_id)
        .map_err(CollabCommandError::from)?
        .and_then(|info| info.account_id)
        .ok_or_else(|| {
            CollabCommandError::from(api(404, "not_found", "this project is not shared"))
        })?;
    let removed = with_binding(
        state.inner(),
        &host,
        &project_id,
        |client, access, shared| {
            Box::pin(async move { client.remove_member(access, shared, account).await })
        },
    )
    .await;
    match removed {
        Ok(()) | Err(CollabError::Api { status: 404, .. }) => {}
        Err(error) => return Err(CollabCommandError::from(error)),
    }
    forget_local(&project_id).await;
    Ok(())
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
    let host = AppHost::new(app);
    join_project(state.inner(), &host, server, shared)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_open_link(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    link: String,
) -> Result<String, CollabCommandError> {
    let host: Arc<dyn CollabHost> = Arc::new(AppHost::new(app));
    open_link(state.inner(), host.as_ref(), &link)
        .await
        .map_err(CollabCommandError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(parse_link("https://uni.edu/p/not-an-id").is_err());
        assert!(parse_link("hello").is_err());
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
        let built = build_document(root, "main.tex", "tectonic").unwrap();
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
        assert_eq!(built.hashes.len(), 2);
    }
}
