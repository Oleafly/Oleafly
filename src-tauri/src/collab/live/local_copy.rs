use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize;
use oleafly_collab::{load_binding, write_atomic, CollabError, CollabPaths, ShareBinding};
use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};
use oleafly_collab_protocol::projects::{project_role_allows, ProjectAction};
use serde::{Deserialize, Serialize};

use super::super::commands::CollabCommandError;
use super::super::disk::{
    as_text, crlf_only, exists_exact, safe_target, scan_folder, sha256_hex, write_file, DiskState,
};
use super::super::state::CollabState;
use super::{
    active_for, by_path, checked, ensure_dir, guard, lock, name_of, not_live, parent_of, Active,
};

const LOCAL_COPY: &str = "collab.localCopy";
const NAME: &str = "{{name}}";
const ORIGIN_FILE: &str = "local-copy.json";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCopyOffer {
    pub copy_id: String,
    pub name: String,
    pub files: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BaseFile {
    id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    blob: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Origin {
    server_id: ServerId,
    shared_project_id: SharedProjectId,
    files: BTreeMap<String, BaseFile>,
}

impl Origin {
    fn of(binding: &ShareBinding, doc: &ProjectDoc) -> Result<Origin, CollabError> {
        let mut files = BTreeMap::new();
        for (id, placed) in materialize::layout(&doc.nodes()?) {
            let (text, blob) = match placed.kind {
                NodeKind::Dir => continue,
                NodeKind::Text => (Some(doc.text(&id)?), None),
                NodeKind::Blob => (None, placed.blob.clone()),
            };
            files.insert(placed.path, BaseFile { id, text, blob });
        }
        Ok(Origin {
            server_id: binding.server_id,
            shared_project_id: binding.shared_project_id,
            files,
        })
    }

    fn belongs_to(&self, binding: &ShareBinding) -> bool {
        self.server_id == binding.server_id && self.shared_project_id == binding.shared_project_id
    }
}

enum Mine {
    Text { text: String, crlf: bool },
    Blob { hash: String, bytes: Vec<u8> },
}

struct Changed {
    path: String,
    base: Option<BaseFile>,
    mine: Mine,
}

fn origin_file(paths: &CollabPaths, project_id: &str) -> Result<PathBuf, CollabError> {
    Ok(paths.project_dir(project_id)?.join(ORIGIN_FILE))
}

fn load_origin(paths: &CollabPaths, project_id: &str) -> Option<Origin> {
    let bytes = std::fs::read(origin_file(paths, project_id).ok()?).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[cfg(test)]
pub(crate) fn has_origin(paths: &CollabPaths, project_id: &str) -> bool {
    load_origin(paths, project_id).is_some()
}

fn forget_origin(paths: &CollabPaths, project_id: &str) -> Result<(), CollabError> {
    match std::fs::remove_file(origin_file(paths, project_id)?) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            Err(CollabError::Io(error.to_string()))
        }
        _ => Ok(()),
    }
}

pub(super) fn keep_origin(paths: &CollabPaths, project_id: &str, live: &LiveProject) {
    let kept = load_binding(paths, project_id).and_then(|binding| {
        let Some(binding) = binding else {
            return Ok(());
        };
        let confirmed = live.confirmed_doc().ok();
        let origin = Origin::of(&binding, confirmed.as_ref().unwrap_or(live.doc()))?;
        let json =
            serde_json::to_vec(&origin).map_err(|error| CollabError::Corrupt(error.to_string()))?;
        write_atomic(&origin_file(paths, project_id)?, &json)
    });
    if let Err(error) = kept {
        let _ = crate::project::append_app_log(format!(
            "Live collaboration could not keep what {project_id} looked like when it became a local copy: {error}"
        ));
    }
}

pub(crate) fn keep_stored_origin(paths: &CollabPaths, project_id: &str) {
    let (Ok(dir), Ok(Some(binding))) = (
        paths.document_dir(project_id),
        load_binding(paths, project_id),
    ) else {
        return;
    };
    if !LiveProject::exists(&dir) {
        return;
    }
    match LiveProject::load(&dir, binding.role) {
        Ok(live) => keep_origin(paths, project_id, &live),
        Err(error) => {
            let _ = crate::project::append_app_log(format!(
                "Live collaboration could not read {project_id} to keep it as a local copy: {error}"
            ));
        }
    }
}

pub(crate) fn forget_all_but_origin(paths: &CollabPaths, project_id: &str) {
    let Ok(dir) = paths.project_dir(project_id) else {
        return;
    };
    let origin = std::fs::read(dir.join(ORIGIN_FILE)).ok();
    let _ = std::fs::remove_dir_all(&dir);
    if let Some(origin) = origin {
        if let Err(error) = write_atomic(&dir.join(ORIGIN_FILE), &origin) {
            let _ = crate::project::append_app_log(format!(
                "Live collaboration could not keep what {project_id} looked like when it was deleted: {error}"
            ));
        }
    }
}

fn changed_files(root: &Path, origin: &Origin) -> Result<Vec<Changed>, CollabError> {
    let scan = scan_folder(root).map_err(CollabError::Io)?;
    let mut changed = Vec::new();
    for (path, _) in scan.files {
        let Some(bytes) = safe_target(root, &path).and_then(|target| std::fs::read(target).ok())
        else {
            continue;
        };
        let base = origin.files.get(&path);
        let figure = base.is_some_and(|base| base.blob.is_some());
        let mine = match as_text(&bytes).filter(|_| !figure) {
            Some(text) => {
                if base.and_then(|base| base.text.as_deref()) == Some(text.as_str()) {
                    continue;
                }
                Mine::Text {
                    crlf: crlf_only(&bytes) == Some(true),
                    text,
                }
            }
            None => {
                let hash = sha256_hex(&bytes);
                if base.and_then(|base| base.blob.as_deref()) == Some(hash.as_str()) {
                    continue;
                }
                Mine::Blob { hash, bytes }
            }
        };
        changed.push(Changed {
            path,
            base: base.cloned(),
            mine,
        });
    }
    Ok(changed)
}

fn copies_of(
    paths: &CollabPaths,
    project_id: &str,
    binding: &ShareBinding,
) -> Vec<(String, Origin, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(paths.root()) else {
        return Vec::new();
    };
    let mut copies: Vec<(String, Origin, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .filter(|id| id != project_id && crate::paths::validate_project_id(id).is_ok())
        .filter(|id| matches!(load_binding(paths, id), Ok(None)))
        .filter_map(|id| {
            let origin = load_origin(paths, &id).filter(|origin| origin.belongs_to(binding))?;
            let root = crate::paths::project_dir(&id)
                .ok()
                .filter(|root| root.is_dir())?;
            Some((id, origin, root))
        })
        .collect();
    copies.sort_by(|left, right| left.0.cmp(&right.0));
    copies
}

fn not_offered() -> CollabError {
    CollabError::Api {
        status: 404,
        code: "not_found".to_owned(),
        message: "this local copy has no changes to bring in".to_owned(),
    }
}

fn forbidden() -> CollabError {
    CollabError::Api {
        status: 403,
        code: "forbidden".to_owned(),
        message: "viewers cannot bring changes into a shared project".to_owned(),
    }
}

pub(crate) fn offer(
    paths: &CollabPaths,
    project_id: &str,
) -> Result<Option<LocalCopyOffer>, CollabError> {
    let Some(binding) = load_binding(paths, project_id)? else {
        return Ok(None);
    };
    if !project_role_allows(binding.role, ProjectAction::Edit) {
        return Ok(None);
    }
    for (copy_id, origin, root) in copies_of(paths, project_id, &binding) {
        let Ok(changed) = changed_files(&root, &origin) else {
            continue;
        };
        if changed.is_empty() {
            continue;
        }
        let name = crate::project::read_meta(&copy_id)
            .map(|meta| meta.name)
            .unwrap_or_else(|_| copy_id.clone());
        return Ok(Some(LocalCopyOffer {
            copy_id,
            name,
            files: changed.into_iter().map(|change| change.path).collect(),
        }));
    }
    Ok(None)
}

fn offered(
    paths: &CollabPaths,
    project_id: &str,
    copy_id: &str,
) -> Result<(Origin, PathBuf), CollabError> {
    let binding = load_binding(paths, project_id)?.ok_or_else(not_live)?;
    copies_of(paths, project_id, &binding)
        .into_iter()
        .find(|(id, _, _)| id == copy_id)
        .map(|(_, origin, root)| (origin, root))
        .ok_or_else(not_offered)
}

pub(crate) fn decline(
    paths: &CollabPaths,
    project_id: &str,
    copy_id: &str,
) -> Result<(), CollabError> {
    offered(paths, project_id, copy_id)?;
    forget_origin(paths, copy_id)
}

pub(crate) async fn bring_in(
    paths: &CollabPaths,
    project_id: &str,
    copy_id: &str,
) -> Result<(), CollabError> {
    let (origin, root) = offered(paths, project_id, copy_id)?;
    let active = active_for(project_id).ok_or_else(not_live)?;
    let changes = changed_files(&root, &origin)?;
    active.bring_in(changes).await?;
    forget_origin(paths, copy_id)
}

fn bring_text(
    live: &mut LiveProject,
    path: &str,
    base: Option<&BaseFile>,
    ours: &str,
    crlf: bool,
) -> Result<(), CollabError> {
    let nodes = live.doc().nodes()?;
    let layout = materialize::layout(&nodes);
    let known = base
        .and_then(|base| Some((base.id.as_str(), base.text.as_deref()?)))
        .filter(|(id, _)| {
            nodes
                .iter()
                .any(|node| node.id == *id && node.kind == NodeKind::Text)
        });
    if let Some((id, base)) = known {
        if !layout.contains_key(id) {
            live.doc_mut().restore(id)?;
        }
        let current = live.doc().text(id)?;
        if current == ours {
            return Ok(());
        }
        if let Some(operation) = oleafly_collab::merge::rebase(base, ours, &current) {
            live.local_operation(id, &operation)?;
            return Ok(());
        }
    }
    let mut placed = by_path(&layout);
    if let Some((id, NodeKind::Text, _)) = placed.get(path) {
        if live.doc().text(id)? == ours {
            return Ok(());
        }
    }
    let parent = ensure_dir(live, &mut placed, parent_of(path))?;
    let id =
        live.doc_mut()
            .add_node(parent.as_deref(), name_of(path), NodeKind::Text, None, ours)?;
    live.doc_mut().set_crlf(&id, crlf)?;
    Ok(())
}

fn figure_target(
    live: &LiveProject,
    disk: &DiskState,
    root: &Path,
    path: &str,
    base: Option<&BaseFile>,
    hash: &str,
) -> Result<Option<String>, CollabError> {
    let layout = materialize::layout(&live.doc().nodes()?);
    let shared = base.and_then(|base| {
        layout
            .get(&base.id)
            .filter(|placed| placed.kind == NodeKind::Blob)
            .map(|placed| (base, placed))
    });
    if let Some((base, placed)) = shared {
        if placed.blob.as_deref() == Some(hash) {
            return Ok(None);
        }
        if placed.blob == base.blob && checked(root, disk, &placed.path).is_some() {
            return Ok(Some(placed.path.clone()));
        }
    }
    let folded = path.to_lowercase();
    let taken = layout
        .values()
        .find(|placed| placed.path.to_lowercase() == folded);
    match taken {
        Some(placed) if placed.kind == NodeKind::Blob && placed.blob.as_deref() == Some(hash) => {
            return Ok(None);
        }
        None if !exists_exact(root, path) => return Ok(Some(path.to_owned())),
        _ => {}
    }
    let folder = parent_of(path);
    let mut siblings: BTreeSet<String> = layout
        .values()
        .filter(|placed| parent_of(&placed.path) == folder)
        .map(|placed| name_of(&placed.path).to_lowercase())
        .collect();
    let name = super::kept::copy_name(name_of(path), live.doc().author_name(), hash, &mut siblings);
    Ok(Some(match folder {
        Some(folder) => format!("{folder}/{name}"),
        None => name,
    }))
}

impl Active {
    async fn bring_in(&self, changes: Vec<Changed>) -> Result<(), CollabError> {
        let written = {
            let disk = guard(&self.disk);
            let mut figures = Vec::new();
            {
                let mut live = lock(&self.live);
                if !live.can_edit() {
                    return Err(forbidden());
                }
                for change in changes {
                    match change.mine {
                        Mine::Text { text, crlf } => {
                            bring_text(&mut live, &change.path, change.base.as_ref(), &text, crlf)?
                        }
                        Mine::Blob { hash, bytes } => {
                            let target = figure_target(
                                &live,
                                &disk,
                                &self.root,
                                &change.path,
                                change.base.as_ref(),
                                &hash,
                            )?;
                            if let Some(target) = target {
                                figures.push((target, bytes));
                            }
                        }
                    }
                }
            }
            let mut written = Vec::new();
            for (path, bytes) in figures {
                match write_file(&self.root, &path, &bytes) {
                    Ok(_) => written.push(path),
                    Err(error) => {
                        let _ = crate::project::append_app_log(format!(
                            "Live collaboration could not bring {path} into project {}: {error}",
                            self.project_id
                        ));
                    }
                }
            }
            written
        };
        self.handle.flush();
        self.kick();
        self.refresh_pending();
        if !written.is_empty() {
            self.import_paths(Some(written)).await?;
        }
        Ok(())
    }
}

fn paths_of(state: &CollabState) -> Result<CollabPaths, CollabCommandError> {
    state.paths().cloned().map_err(CollabCommandError::from)
}

fn joined<T>(
    outcome: Result<Result<T, CollabError>, tauri::Error>,
) -> Result<T, CollabCommandError> {
    outcome
        .map_err(|error| CollabError::Io(error.to_string()))
        .and_then(|inner| inner)
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_local_copy_offer(
    state: tauri::State<'_, CollabState>,
    project_id: String,
) -> Result<Option<LocalCopyOffer>, CollabCommandError> {
    let paths = paths_of(state.inner())?;
    joined(tauri::async_runtime::spawn_blocking(move || offer(&paths, &project_id)).await)
}

#[tauri::command]
pub async fn collab_local_copy_bring_in(
    state: tauri::State<'_, CollabState>,
    project_id: String,
    copy_id: String,
) -> Result<(), CollabCommandError> {
    let paths = paths_of(state.inner())?;
    bring_in(&paths, &project_id, &copy_id)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_local_copy_decline(
    state: tauri::State<'_, CollabState>,
    project_id: String,
    copy_id: String,
) -> Result<(), CollabCommandError> {
    let paths = paths_of(state.inner())?;
    joined(
        tauri::async_runtime::spawn_blocking(move || decline(&paths, &project_id, &copy_id)).await,
    )
}

pub(super) fn local_copy_name_in(locale: &str, name: &str) -> String {
    let template = crate::i18n::t_in(locale, LOCAL_COPY);
    if let Some((before, after)) = template.split_once(NAME) {
        let marked = name.len() > before.len() + after.len()
            && name.starts_with(before)
            && name.ends_with(after);
        if marked && !(before.is_empty() && after.is_empty()) {
            return name.to_owned();
        }
    }
    crate::i18n::t_with_in(locale, LOCAL_COPY, &[("name", name)])
}

pub(super) fn name_local_copy(project_id: &str) {
    if crate::project_location::locate(project_id).is_err() {
        return;
    }
    let Ok(meta) = crate::project::read_meta(project_id) else {
        return;
    };
    let renamed = local_copy_name_in(crate::i18n::current(), &meta.name);
    if renamed != meta.name {
        if let Err(error) = crate::project::rename_project_blocking(project_id.to_owned(), renamed)
        {
            let _ = crate::project::append_app_log(format!(
                "Live collaboration could not name {project_id} as a local copy: {error}"
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, Mutex};

    use oleafly_collab::doc::{NodeKind, ProjectDoc};
    use oleafly_collab::live::LiveProject;
    use oleafly_collab::materialize;
    use oleafly_collab::sync::{
        spawn_live, EndReason, LiveEvent, LiveLink, LiveStatus, SharedLive,
    };
    use oleafly_collab::{save_binding, ServerClient, ServerUrl};
    use oleafly_collab_protocol::ids::{AccountId, DeviceId, ServerId, SharedProjectId};
    use oleafly_collab_protocol::projects::ProjectRole;
    use tokio::sync::mpsc;

    use super::super::super::disk::{sha256_hex, DiskState};
    use super::super::{
        guard, initial_bases, lock, pump, Active, LiveHost, MergedPayload, NewDevicePayload,
        PresenceLeftPayload, PresencePayload, RolePayload, StatusPayload, WrittenTexts,
    };
    use super::*;
    use crate::collab::state::CollabState;
    use crate::collab::testing::TempLibrary;
    use crate::folder_watch::FolderChange;

    #[test]
    fn a_local_copy_name_follows_the_language_and_is_never_added_twice() {
        assert_eq!(
            local_copy_name_in("en", "R3 Paper"),
            "R3 Paper (local copy)"
        );
        assert_eq!(
            local_copy_name_in("en", "R3 Paper (local copy)"),
            "R3 Paper (local copy)"
        );
        assert_eq!(
            local_copy_name_in("de", "R3 Paper"),
            "R3 Paper (lokale Kopie)"
        );
        assert_eq!(local_copy_name_in("ja", "論文"), "論文（ローカルコピー）");
        assert_eq!(
            local_copy_name_in("ja", "論文（ローカルコピー）"),
            "論文（ローカルコピー）"
        );
    }

    struct Quiet;

    impl LiveHost for Quiet {
        fn status(&self, _: StatusPayload) {}
        fn role(&self, _: RolePayload) {}
        fn merged(&self, _: MergedPayload) {}
        fn presence(&self, _: PresencePayload) {}
        fn presence_left(&self, _: PresenceLeftPayload) {}
        fn folder_changed(&self, _: FolderChange) {}
        fn new_device(&self, _: NewDevicePayload) {}
    }

    fn renamed_after(reason: EndReason) -> String {
        let library = TempLibrary::new();
        let root = library.project("r3-paper", &[("main.tex", "x")]);
        let mut meta = crate::project::read_meta("r3-paper").unwrap();
        meta.name = "R3 Paper".to_owned();
        crate::project::write_meta("r3-paper", &meta).unwrap();
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let state = CollabState::new(
                oleafly_collab::CollabPaths::new(dir.path().join("collab")),
                Arc::new(oleafly_collab::secret_port::MemorySecrets::default()),
            );
            let keys = state.keys().await.unwrap();
            let server = ServerId::new_v7();
            let paths = state.paths().unwrap().clone();
            save_binding(
                &paths,
                "r3-paper",
                &oleafly_collab::ShareBinding {
                    server_url: "http://127.0.0.1:9".to_owned(),
                    server_id: server,
                    shared_project_id: SharedProjectId::new_v7(),
                    role: ProjectRole::Editor,
                    created_at: 1,
                },
            )
            .unwrap();
            let link = LiveLink {
                client: Arc::new(
                    ServerClient::new(ServerUrl::parse("http://127.0.0.1:9").unwrap()).unwrap(),
                ),
                server_id: server,
                project: SharedProjectId::new_v7(),
                device_id: DeviceId::new_v7(),
                key: Arc::clone(&keys.key),
                sessions: Arc::clone(&keys.sessions),
            };
            let live = LiveProject::new(ProjectDoc::create().unwrap(), 0, ProjectRole::Editor);
            let shared: SharedLive = Arc::new(Mutex::new(live));
            let (unused, _unused) = mpsc::unbounded_channel();
            let (writer, _writer) = mpsc::unbounded_channel();
            let handle = spawn_live(link.clone(), Arc::clone(&shared), unused);
            let active = Arc::new(Active {
                project_id: "r3-paper".to_owned(),
                root,
                document_dir: dir.path().join("document"),
                disk_file: dir.path().join("disk.json"),
                live: shared,
                handle,
                link,
                disk: Mutex::new(DiskState::default()),
                host: Arc::new(Quiet),
                writer,
                account_id: AccountId::new_v7(),
                quiet_merge: AtomicBool::new(false),
                waiting: AtomicBool::new(false),
                last_status: Mutex::new(LiveStatus::Connecting),
                bases: Mutex::new(WrittenTexts::default()),
                upkeep: Default::default(),
            });
            let (events, receiver) = mpsc::unbounded_channel();
            let pumping = tokio::spawn(pump(Arc::downgrade(&active), receiver, paths));
            events
                .send(LiveEvent::Status(LiveStatus::Ended { reason }))
                .unwrap();
            drop(events);
            pumping.await.unwrap();
            active.handle.stop();
        });
        crate::project::read_meta("r3-paper").unwrap().name
    }

    const ALICE: &str = "acct-alice";
    const BOB: &str = "acct-bob";
    const OLD_PLOT: [u8; 3] = [0x89, b'P', 0];
    const NEW_PLOT: [u8; 3] = [0x89, b'P', 1];

    fn signed(doc: &ProjectDoc, account: &str, name: &str) -> ProjectDoc {
        let mut copy = ProjectDoc::load(&doc.snapshot().unwrap()).unwrap();
        copy.set_author(account, name);
        copy
    }

    fn shared_paper(texts: &[(&str, &str)]) -> ProjectDoc {
        let mut doc = ProjectDoc::create().unwrap();
        doc.set_author(ALICE, "Alice Chen");
        for (path, text) in texts {
            doc.add_node(None, path, NodeKind::Text, None, text)
                .unwrap();
        }
        doc.add_node(
            None,
            "plot.png",
            NodeKind::Blob,
            Some(&sha256_hex(&OLD_PLOT)),
            "",
        )
        .unwrap();
        doc
    }

    fn placed_on(root: &Path, doc: &ProjectDoc) -> DiskState {
        let layout = materialize::layout(&doc.nodes().unwrap());
        let mut hashes = BTreeMap::new();
        for (id, placed) in &layout {
            let bytes = match placed.kind {
                NodeKind::Text => doc.text(id).unwrap().into_bytes(),
                NodeKind::Blob => OLD_PLOT.to_vec(),
                NodeKind::Dir => continue,
            };
            std::fs::write(root.join(&placed.path), &bytes).unwrap();
            hashes.insert(placed.path.clone(), sha256_hex(&bytes));
        }
        DiskState { layout, hashes }
    }

    async fn active_over(
        dir: &Path,
        project_id: &str,
        root: PathBuf,
        live: LiveProject,
        disk: DiskState,
        server: ServerId,
        project: SharedProjectId,
    ) -> Arc<Active> {
        let state = CollabState::new(
            oleafly_collab::CollabPaths::new(dir.join("keys")),
            Arc::new(oleafly_collab::secret_port::MemorySecrets::default()),
        );
        let keys = state.keys().await.unwrap();
        let link = LiveLink {
            client: Arc::new(
                ServerClient::new(ServerUrl::parse("http://127.0.0.1:9").unwrap()).unwrap(),
            ),
            server_id: server,
            project,
            device_id: DeviceId::new_v7(),
            key: Arc::clone(&keys.key),
            sessions: Arc::clone(&keys.sessions),
        };
        let bases = initial_bases(&root, &disk, &live);
        let shared: SharedLive = Arc::new(Mutex::new(live));
        let (unused, _unused) = mpsc::unbounded_channel();
        let (writer, _writer) = mpsc::unbounded_channel();
        let handle = spawn_live(link.clone(), Arc::clone(&shared), unused);
        let collab = dir.join(project_id);
        std::fs::create_dir_all(&collab).unwrap();
        Arc::new(Active {
            project_id: project_id.to_owned(),
            root,
            document_dir: collab.join("document"),
            disk_file: collab.join("materializer-index.json"),
            live: shared,
            handle,
            link,
            disk: Mutex::new(disk),
            host: Arc::new(Quiet),
            writer,
            account_id: AccountId::new_v7(),
            quiet_merge: AtomicBool::new(false),
            waiting: AtomicBool::new(false),
            last_status: Mutex::new(LiveStatus::Connecting),
            bases: Mutex::new(bases),
            upkeep: Default::default(),
        })
    }

    struct Removed {
        library: TempLibrary,
        runtime: tokio::runtime::Runtime,
        dir: tempfile::TempDir,
        paths: oleafly_collab::CollabPaths,
        server: ServerId,
        project: SharedProjectId,
        at_removal: ProjectDoc,
        copy: PathBuf,
    }

    impl Removed {
        fn rejoin(&self, project_id: &str, role: ProjectRole) {
            save_binding(
                &self.paths,
                project_id,
                &oleafly_collab::ShareBinding {
                    server_url: "http://127.0.0.1:9".to_owned(),
                    server_id: self.server,
                    shared_project_id: self.project,
                    role,
                    created_at: 2,
                },
            )
            .unwrap();
        }

        fn offer(&self, project_id: &str) -> Option<LocalCopyOffer> {
            offer(&self.paths, project_id).unwrap()
        }
    }

    fn bob_removed_from(texts: &[(&str, &str)]) -> Removed {
        let library = TempLibrary::new();
        let copy = library.project("r4-paper", &[]);
        let mut meta = crate::project::read_meta("r4-paper").unwrap();
        meta.name = "R4 Paper".to_owned();
        crate::project::write_meta("r4-paper", &meta).unwrap();
        let at_removal = shared_paper(texts);
        let disk = placed_on(&copy, &at_removal);
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let state = CollabState::new(
            oleafly_collab::CollabPaths::new(dir.path().join("collab")),
            Arc::new(oleafly_collab::secret_port::MemorySecrets::default()),
        );
        let paths = state.paths().unwrap().clone();
        let server = ServerId::new_v7();
        let project = SharedProjectId::new_v7();
        save_binding(
            &paths,
            "r4-paper",
            &oleafly_collab::ShareBinding {
                server_url: "http://127.0.0.1:9".to_owned(),
                server_id: server,
                shared_project_id: project,
                role: ProjectRole::Editor,
                created_at: 1,
            },
        )
        .unwrap();
        let live = LiveProject::new(
            signed(&at_removal, BOB, "Bob Smith"),
            0,
            ProjectRole::Editor,
        );
        runtime.block_on(async {
            let active = active_over(
                dir.path(),
                "r4-paper",
                copy.clone(),
                live,
                disk,
                server,
                project,
            )
            .await;
            let (events, receiver) = mpsc::unbounded_channel();
            let pumping = tokio::spawn(pump(Arc::downgrade(&active), receiver, paths.clone()));
            events
                .send(LiveEvent::Status(LiveStatus::Ended {
                    reason: EndReason::Removed,
                }))
                .unwrap();
            drop(events);
            pumping.await.unwrap();
            active.handle.stop();
        });
        Removed {
            library,
            runtime,
            dir,
            paths,
            server,
            project,
            at_removal,
            copy,
        }
    }

    #[test]
    fn someone_added_back_is_offered_the_changes_in_their_local_copy_until_they_keep_it_separate() {
        let removed = bob_removed_from(&[("main.tex", "Intro\nMethod\n"), ("notes.tex", "n\n")]);
        let name = crate::project::read_meta("r4-paper").unwrap().name;
        assert_eq!(name, local_copy_name_in(crate::i18n::current(), "R4 Paper"));
        removed.rejoin("r4-again", ProjectRole::Editor);
        assert_eq!(removed.offer("r4-again"), None);
        std::fs::write(
            removed.copy.join("main.tex"),
            "Intro\nMethod while removed\n",
        )
        .unwrap();
        std::fs::write(removed.copy.join("extra.tex"), "x\n").unwrap();
        std::fs::remove_file(removed.copy.join("notes.tex")).unwrap();
        let expected = LocalCopyOffer {
            copy_id: "r4-paper".to_owned(),
            name,
            files: vec!["extra.tex".to_owned(), "main.tex".to_owned()],
        };
        assert_eq!(removed.offer("r4-again"), Some(expected.clone()));
        let json = serde_json::to_value(&expected).unwrap();
        assert_eq!(json["copyId"], "r4-paper");
        removed.rejoin("r4-viewer", ProjectRole::Viewer);
        assert_eq!(removed.offer("r4-viewer"), None);
        assert_eq!(removed.offer("r4-paper"), None);
        decline(&removed.paths, "r4-again", "r4-paper").unwrap();
        assert_eq!(removed.offer("r4-again"), None);
        assert!(removed.copy.join("main.tex").exists());
    }

    #[test]
    fn bringing_the_changes_in_merges_them_with_the_shared_project_and_leaves_deletions_alone() {
        let removed = bob_removed_from(&[
            ("main.tex", "Intro\nMethod\nResults\n"),
            ("notes.tex", "n\n"),
            ("old.tex", "o\n"),
            ("chapter.tex", "c\n"),
        ]);
        let copy = &removed.copy;
        std::fs::write(copy.join("main.tex"), "Intro\nMethod by bob\nResults\n").unwrap();
        std::fs::write(copy.join("notes.tex"), "n\nbob note\n").unwrap();
        std::fs::write(copy.join("chapter.tex"), "c\nmore by bob\n").unwrap();
        std::fs::write(copy.join("new.tex"), "new\n").unwrap();
        std::fs::write(copy.join("plot.png"), NEW_PLOT).unwrap();
        std::fs::remove_file(copy.join("old.tex")).unwrap();

        let mut shared = signed(&removed.at_removal, ALICE, "Alice Chen");
        let ids: BTreeMap<String, String> = materialize::layout(&shared.nodes().unwrap())
            .into_iter()
            .map(|(id, placed)| (placed.path, id))
            .collect();
        shared
            .set_text(&ids["main.tex"], "Intro\nMethod\nResults\nOutro by alice\n")
            .unwrap();
        shared
            .rename(&ids["chapter.tex"], "chapter-one.tex")
            .unwrap();
        shared.trash(&ids["notes.tex"]).unwrap();

        let again = removed.library.project("r4-again", &[]);
        removed.rejoin("r4-again", ProjectRole::Editor);
        let disk = placed_on(&again, &shared);
        let live = LiveProject::new(signed(&shared, BOB, "Bob Smith"), 0, ProjectRole::Editor);
        let active = removed.runtime.block_on(active_over(
            removed.dir.path(),
            "r4-again",
            again.clone(),
            live,
            disk,
            removed.server,
            removed.project,
        ));
        let turn = super::super::write::rig::live_turn();
        *guard(&super::super::ACTIVE) = Some(Arc::clone(&active));
        let brought = removed
            .runtime
            .block_on(bring_in(&removed.paths, "r4-again", "r4-paper"));
        *guard(&super::super::ACTIVE) = None;
        drop(turn);
        brought.unwrap();
        removed.runtime.block_on(active.write_out()).unwrap();
        active.handle.stop();

        let texts: BTreeMap<String, String> = {
            let live = lock(&active.live);
            materialize::layout(&live.doc().nodes().unwrap())
                .into_iter()
                .filter(|(_, placed)| placed.kind == NodeKind::Text)
                .map(|(id, placed)| (placed.path, live.doc().text(&id).unwrap()))
                .collect()
        };
        let mut expected = BTreeMap::new();
        for (path, text) in [
            ("chapter-one.tex", "c\nmore by bob\n"),
            (
                "main.tex",
                "Intro\nMethod by bob\nResults\nOutro by alice\n",
            ),
            ("new.tex", "new\n"),
            ("notes.tex", "n\nbob note\n"),
            ("old.tex", "o\n"),
        ] {
            expected.insert(path.to_owned(), text.to_owned());
        }
        assert_eq!(texts, expected);
        for (path, text) in &expected {
            assert_eq!(
                &std::fs::read_to_string(again.join(path)).unwrap(),
                text,
                "{path}"
            );
        }
        assert_eq!(std::fs::read(again.join("plot.png")).unwrap(), NEW_PLOT);
        assert!(!again.join("chapter.tex").exists());
        assert_eq!(removed.offer("r4-again"), None);
        assert_eq!(
            std::fs::read_to_string(copy.join("main.tex")).unwrap(),
            "Intro\nMethod by bob\nResults\n"
        );
    }

    #[test]
    fn a_project_whose_access_was_removed_is_renamed_as_a_local_copy() {
        let expected = local_copy_name_in(crate::i18n::current(), "R3 Paper");
        assert_ne!(expected, "R3 Paper");
        assert_eq!(renamed_after(EndReason::AccessEnded), expected);
        assert_eq!(renamed_after(EndReason::Removed), expected);
        assert_eq!(renamed_after(EndReason::Stopped), "R3 Paper");
    }
}
