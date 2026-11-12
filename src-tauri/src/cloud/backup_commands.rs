use super::backup::{
    self, BackupEntry, BackupItem, BackupOutcome, BackupSettings, BackupSummary, ItemKind, Library,
    Run, Source,
};
use super::commands::{backup_failed, backup_target, BackupTarget};
use super::engine::{now_ms, RoundError};
use super::store::CloudStore;
use crate::app_error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

static RUNNING: AtomicBool = AtomicBool::new(false);

fn gate() -> &'static tokio::sync::Mutex<()> {
    static GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    &GATE
}

fn local_lock() -> &'static std::sync::Mutex<()> {
    static LOCAL: std::sync::Mutex<()> = std::sync::Mutex::new(());
    &LOCAL
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct LastBackup {
    pub(crate) notes: usize,
    pub(crate) projects: usize,
    pub(crate) bytes: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct BackupLocal {
    pub(crate) settings: BackupSettings,
    pub(crate) last_run_ms: Option<u64>,
    pub(crate) last_ok_ms: Option<u64>,
    pub(crate) last_error: Option<String>,
    pub(crate) last: Option<LastBackup>,
    #[serde(skip_serializing_if = "BTreeSet::is_empty")]
    pub(crate) leftovers: BTreeSet<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupStateView {
    #[serde(flatten)]
    pub(crate) local: BackupLocal,
    pub(crate) running: bool,
    pub(crate) due: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupRunView {
    pub(crate) ran: bool,
    pub(crate) outcome: Option<BackupOutcome>,
    pub(crate) error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoredView {
    pub(crate) from: String,
    pub(crate) to: String,
    pub(crate) name: String,
    pub(crate) copy: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreFailure {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) error: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreView {
    pub(crate) restored: Vec<RestoredView>,
    pub(crate) here: Vec<String>,
    pub(crate) failed: Vec<RestoreFailure>,
}

fn cloud_dir() -> Result<PathBuf, String> {
    Ok(crate::paths::oleafly_root()?.join("cloud"))
}

fn local_path() -> Result<PathBuf, String> {
    Ok(cloud_dir()?.join("backups.json"))
}

fn read_local() -> BackupLocal {
    local_path()
        .ok()
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice::<BackupLocal>(&bytes).ok())
        .map(|local| BackupLocal {
            settings: local.settings.clone().normalized(),
            ..local
        })
        .unwrap_or_default()
}

fn write_local(local: &BackupLocal) -> Result<(), String> {
    let path = local_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(local).map_err(|error| error.to_string())?;
    crate::sandbox::atomic_write(&path, &bytes).map_err(|error| error.to_string())
}

fn update_local(change: impl FnOnce(&mut BackupLocal)) -> Result<BackupLocal, String> {
    let _lock = local_lock()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut local = read_local();
    change(&mut local);
    write_local(&local)?;
    Ok(local)
}

fn record_run(started: u64, result: &Result<BackupOutcome, String>) -> Result<(), String> {
    update_local(|local| {
        local.last_run_ms = Some(started);
        match result {
            Ok(outcome) => {
                local.last_ok_ms = Some(started);
                local.last_error = None;
                local.leftovers = outcome.leftovers.clone();
                local.last = Some(LastBackup {
                    notes: outcome.notes,
                    projects: outcome.projects,
                    bytes: outcome.bytes,
                });
            }
            Err(text) => local.last_error = Some(text.clone()),
        }
    })
    .map(|_| ())
}

fn view(local: BackupLocal) -> BackupStateView {
    let due = local.settings.due(local.last_ok_ms, now_ms());
    BackupStateView {
        local,
        running: RUNNING.load(Ordering::Acquire),
        due,
    }
}

struct Shelf {
    projects: Vec<crate::project::ProjectInfo>,
    bindings: BTreeMap<String, crate::project_ids::ProjectBinding>,
    links: BTreeMap<String, String>,
}

fn shelf() -> Result<Shelf, String> {
    let projects = crate::project::list_projects_blocking()?;
    let links = crate::note_links::note_links_blocking()?
        .into_iter()
        .filter_map(|note| Some((note.project_id, note.note_id?)))
        .collect();
    Ok(Shelf {
        projects,
        bindings: crate::project_ids::all_bindings().unwrap_or_default(),
        links,
    })
}

fn library(shelf: &Shelf) -> Library {
    let mut library = Library {
        links: shelf.links.values().cloned().collect(),
        ..Library::default()
    };
    for project in &shelf.projects {
        if let Some(binding) = shelf.bindings.get(&project.id) {
            library.projects.insert(binding.project.to_string());
            library
                .projects
                .extend(binding.cloud.values().map(ToString::to_string));
            if project.kind != crate::project::NOTE_KIND {
                library
                    .projects
                    .extend(binding.duplicated_from.map(|from| from.to_string()));
            }
        }
        library.folders.insert(project.id.clone());
    }
    library
}

fn sources(shelf: &Shelf, include_projects: bool) -> Result<Vec<Source>, String> {
    let root = crate::paths::projects_root()?;
    Ok(shelf
        .projects
        .iter()
        .filter(|project| {
            !project.recovery_pending
                && project.shared.is_none()
                && matches!(
                    project.location,
                    crate::project_availability::ProjectLocationInfo::Library
                )
        })
        .filter_map(|project| {
            let kind = if project.kind == crate::project::NOTE_KIND {
                ItemKind::Note
            } else if include_projects {
                ItemKind::Project
            } else {
                return None;
            };
            Some(Source {
                root: root.join(&project.id),
                id: project.id.clone(),
                kind,
                name: project.name.clone(),
                link: shelf.links.get(&project.id).cloned(),
                project: shelf
                    .bindings
                    .get(&project.id)
                    .map(|binding| binding.project.to_string()),
            })
        })
        .collect())
}

struct Dirs {
    staging: PathBuf,
    cache: PathBuf,
}

fn dirs() -> Result<Dirs, String> {
    let cloud = cloud_dir()?;
    let staging = cloud.join("backup-staging");
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    Ok(Dirs {
        staging,
        cache: cloud.join("backup-sets"),
    })
}

fn failed(target: &BackupTarget, error: &RoundError) -> String {
    backup_failed(error, &target.account_id);
    error.to_app_error()
}

#[tauri::command]
pub async fn cloud_backup_state() -> Result<BackupStateView, String> {
    blocking(|| view(read_local())).await
}

#[tauri::command]
pub async fn cloud_backup_set_settings(
    settings: BackupSettings,
) -> Result<BackupStateView, String> {
    blocking(move || update_local(|local| local.settings = settings.normalized()).map(view)).await?
}

const NOT_RUN: BackupRunView = BackupRunView {
    ran: false,
    outcome: None,
    error: None,
};

#[tauri::command]
pub async fn cloud_backup_run(scheduled: bool) -> Result<BackupRunView, String> {
    let _gate = gate().lock().await;
    let local = blocking(read_local).await?;
    if scheduled && !local.settings.due(local.last_ok_ms, now_ms()) {
        return Ok(NOT_RUN);
    }
    let target = backup_target().await?;
    let include_projects = local.settings.include_projects;
    let (found, dirs) =
        blocking(move || Ok::<_, String>((sources(&shelf()?, include_projects)?, dirs()?)))
            .await??;
    if found.is_empty() {
        let _ = tokio::fs::remove_dir_all(&dirs.staging).await;
        return Ok(NOT_RUN);
    }
    RUNNING.store(true, Ordering::Release);
    let started = now_ms();
    let run = Run {
        device: &target.device,
        device_name: &target.device_name,
        staging: &dirs.staging,
        cache: &dirs.cache,
        keep: local.settings.keep,
        scheduled,
        now_ms: started,
        leftovers: &local.leftovers,
    };
    let result = backup::back_up(&target.store, &run, &found)
        .await
        .map_err(|error| failed(&target, &error));
    RUNNING.store(false, Ordering::Release);
    let staging = dirs.staging;
    let (result, recorded) = blocking(move || {
        let _ = std::fs::remove_dir_all(&staging);
        let recorded = record_run(started, &result);
        (result, recorded)
    })
    .await?;
    recorded?;
    Ok(match result {
        Ok(outcome) => BackupRunView {
            ran: true,
            outcome: Some(outcome),
            error: None,
        },
        Err(text) => BackupRunView {
            ran: true,
            outcome: None,
            error: Some(text),
        },
    })
}

#[tauri::command]
pub async fn cloud_backup_list() -> Result<Vec<BackupSummary>, String> {
    let target = backup_target().await?;
    let cache = cloud_dir()?.join("backup-sets");
    backup::list_backups(&target.store, &cache, &target.device)
        .await
        .map_err(|error| failed(&target, &error))
}

async fn open_set(
    target: &BackupTarget,
    device: &str,
    id: &str,
) -> Result<backup::BackupSet, String> {
    let cache = cloud_dir()?.join("backup-sets");
    backup::read_set(&target.store, &cache, device, id)
        .await
        .map_err(|error| failed(target, &error))?
        .ok_or_else(|| AppError::new("cloud.backup_missing").into())
}

#[tauri::command]
pub async fn cloud_backup_entries(device: String, id: String) -> Result<Vec<BackupEntry>, String> {
    let target = backup_target().await?;
    let set = open_set(&target, &device, &id).await?;
    blocking(move || Ok::<_, String>(backup::entries(&set, &library(&shelf()?)))).await?
}

fn remember_origin(local_id: &str, item: &BackupItem) {
    let Some(project) = item
        .project
        .as_deref()
        .and_then(|project| oleafly_core::ids::ProjectId::parse(project).ok())
    else {
        return;
    };
    if let Err(error) = crate::project_ids::set_duplicated_from(local_id, project) {
        let _ = crate::project::append_app_log(format!(
            "could not record that {local_id} was restored from a backup: {error}"
        ));
    }
}

async fn restore_item<S: CloudStore>(
    store: &S,
    device: &str,
    item: &BackupItem,
    copy: bool,
    label: &str,
    staging: &Path,
) -> Result<RestoredView, String> {
    let reservation = blocking(|| {
        crate::project::reserve_unique_project_directory(&crate::paths::projects_root()?, true)
    })
    .await??;
    let temp = staging.join(format!("restore-{}", reservation.project_id()));
    let fetched = backup::fetch_item(store, device, item, reservation.path(), &temp).await;
    let _ = tokio::fs::remove_dir_all(&temp).await;
    let name = if copy {
        format!("{} {label}", item.name)
    } else {
        item.name.clone()
    };
    let (restored, title) = (item.clone(), name.clone());
    let to = blocking(move || -> Result<String, String> {
        fetched.map_err(|error| error.to_app_error())?;
        if copy {
            backup::rename_copy(
                reservation.path(),
                &restored,
                &title,
                &oleafly_core::ids::random_uuid(),
            )
            .map_err(|error| error.to_app_error())?;
        }
        crate::trust::mark_library_restricted(reservation.project_id())?;
        let to = reservation.commit()?;
        if !copy {
            remember_origin(&to, &restored);
        }
        Ok(to)
    })
    .await??;
    Ok(RestoredView {
        from: item.id.clone(),
        to,
        name,
        copy,
    })
}

#[tauri::command]
pub async fn cloud_backup_restore(
    device: String,
    id: String,
    items: Option<Vec<String>>,
    copy_label: String,
) -> Result<RestoreView, String> {
    let label = backup::copy_label(&copy_label)
        .ok_or_else(|| String::from(AppError::new("cloud.backup_label")))?;
    let _gate = gate().lock().await;
    let target = backup_target().await?;
    let set = open_set(&target, &device, &id).await?;
    let (library, dirs) = blocking(|| Ok::<_, String>((library(&shelf()?), dirs()?))).await??;
    let mut done = RestoreView::default();
    for item in &set.items {
        let here = library.has(item);
        let wanted = match &items {
            Some(ids) => ids.contains(&item.id),
            None => {
                if here {
                    done.here.push(item.name.clone());
                }
                !here
            }
        };
        if !wanted {
            continue;
        }
        match restore_item(&target.store, &device, item, here, &label, &dirs.staging).await {
            Ok(restored) => done.restored.push(restored),
            Err(error) => done.failed.push(RestoreFailure {
                id: item.id.clone(),
                name: item.name.clone(),
                error,
            }),
        }
    }
    let _ = tokio::fs::remove_dir_all(&dirs.staging).await;
    Ok(done)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::tests::memory::MemoryStore;

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future)
    }

    fn note_text(local_id: &str) -> String {
        std::fs::read_to_string(
            crate::paths::projects_root()
                .unwrap()
                .join(local_id)
                .join(crate::project::NOTE_FILE),
        )
        .unwrap()
    }

    fn link_of(text: &str) -> Option<String> {
        oleafly_core::front_matter::split(text).and_then(|front| front.scalar("id"))
    }

    fn backed_up(store: &MemoryStore, staging: &Path, source: Source) -> BackupItem {
        let cache = staging.join("cache");
        let leftovers = BTreeSet::new();
        let run = Run {
            device: "dev-b",
            device_name: "Desk",
            staging,
            cache: &cache,
            keep: 30,
            scheduled: false,
            now_ms: 1_000,
            leftovers: &leftovers,
        };
        let outcome = block_on(backup::back_up(store, &run, &[source])).unwrap();
        block_on(backup::read_set(store, &cache, "dev-b", &outcome.id))
            .unwrap()
            .unwrap()
            .items
            .remove(0)
    }

    #[test]
    fn restore_finds_a_note_by_its_link_id_on_any_computer_and_after_it_was_restored() {
        let _env = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let staging = data.path().join("backup-staging");
        std::fs::create_dir_all(&staging).unwrap();
        let store = MemoryStore::default();

        let local_id = crate::project::create_note_project_from(
            "Ideas".into(),
            "---\nkind: note\nid: n-1\n---\nBody\n".into(),
            None,
        )
        .unwrap();
        let found = sources(&shelf().unwrap(), false).unwrap();
        let source = found
            .iter()
            .find(|source| source.id == local_id)
            .unwrap()
            .clone();
        assert_eq!(source.link.as_deref(), Some("n-1"));
        assert_eq!(
            source.project,
            crate::project_ids::binding(&local_id)
                .unwrap()
                .map(|binding| binding.project.to_string())
        );

        let synced = backed_up(
            &store,
            &staging,
            Source {
                id: "far-away-fox".into(),
                project: None,
                ..source.clone()
            },
        );
        assert!(library(&shelf().unwrap()).has(&synced));
        let copy = block_on(restore_item(
            &store,
            "dev-b",
            &synced,
            true,
            "(restored)",
            &staging,
        ))
        .unwrap();
        assert!(copy.copy);
        assert_ne!(link_of(&note_text(&copy.to)).as_deref(), Some("n-1"));

        std::fs::write(
            source.root.join(crate::project::NOTE_FILE),
            "---\nkind: note\nid: n-9\n---\nGone\n",
        )
        .unwrap();
        let lost = backed_up(
            &store,
            &staging,
            Source {
                id: "lost-grey-owl".into(),
                link: Some("n-9".into()),
                project: None,
                ..source.clone()
            },
        );
        std::fs::write(
            source.root.join(crate::project::NOTE_FILE),
            "---\nkind: note\nid: n-1\n---\nBody\n",
        )
        .unwrap();
        assert!(!library(&shelf().unwrap()).has(&lost));
        let back = block_on(restore_item(
            &store,
            "dev-b",
            &lost,
            false,
            "(restored)",
            &staging,
        ))
        .unwrap();
        assert!(!back.copy);
        assert_eq!(link_of(&note_text(&back.to)).as_deref(), Some("n-9"));
        assert!(library(&shelf().unwrap()).has(&lost));
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn a_restored_project_is_still_here_when_the_backup_is_opened_again() {
        let _env = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let staging = data.path().join("backup-staging");
        std::fs::create_dir_all(&staging).unwrap();
        let store = MemoryStore::default();
        let elsewhere = data.path().join("elsewhere");
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::fs::write(
            elsewhere.join("project.json"),
            r#"{"name":"Thesis","main_doc":"main.tex"}"#,
        )
        .unwrap();
        std::fs::write(elsewhere.join("main.tex"), "\\documentclass{article}").unwrap();
        let item = backed_up(
            &store,
            &staging,
            Source {
                id: "quiet-red-heron".into(),
                kind: ItemKind::Project,
                name: "Thesis".into(),
                link: None,
                project: Some("0192a0b0-0000-7000-8000-0000000000aa".into()),
                root: elsewhere,
            },
        );
        assert!(!library(&shelf().unwrap()).has(&item));
        let restored = block_on(restore_item(
            &store,
            "dev-b",
            &item,
            false,
            "(restored)",
            &staging,
        ))
        .unwrap();
        assert!(!restored.copy);
        assert!(library(&shelf().unwrap()).has(&item));
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn a_settings_change_made_during_a_run_survives_the_end_of_the_run() {
        let _env = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let started = read_local();
        assert!(started.settings.auto);
        update_local(|local| {
            local.settings = BackupSettings {
                auto: false,
                every_hours: 168,
                ..local.settings.clone()
            }
        })
        .unwrap();
        let outcome = BackupOutcome {
            notes: 2,
            bytes: 10,
            leftovers: BTreeSet::from(["stray".to_string()]),
            ..BackupOutcome::default()
        };
        record_run(5_000, &Ok(outcome)).unwrap();
        let after = read_local();
        assert_eq!(
            (after.settings.auto, after.settings.every_hours),
            (false, 168)
        );
        assert_eq!(
            (after.last_run_ms, after.last_ok_ms),
            (Some(5_000), Some(5_000))
        );
        assert_eq!(after.last.map(|last| last.notes), Some(2));
        assert_eq!(after.leftovers, BTreeSet::from(["stray".to_string()]));
        record_run(6_000, &Err("offline".into())).unwrap();
        let failed = read_local();
        assert_eq!(failed.last_error.as_deref(), Some("offline"));
        assert_eq!(failed.last_ok_ms, Some(5_000));
        assert!(!failed.settings.auto);
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}
