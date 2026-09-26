use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock, PoisonError};

const RECENTS_FILE: &str = "recent-projects.json";
const RECENTS_VERSION: u32 = 1;
const MAX_RECENTS: usize = 512;
const MAX_RECENTS_BYTES: u64 = 256 * 1024;

#[derive(Debug, Default, Serialize, Deserialize)]
struct RecentsFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    opened: BTreeMap<String, u64>,
}

fn write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn recents_path() -> Result<PathBuf, String> {
    Ok(crate::paths::oleafly_root()?.join(RECENTS_FILE))
}

fn read_recents() -> RecentsFile {
    let Ok(path) = recents_path() else {
        return RecentsFile::default();
    };
    let Ok(metadata) = std::fs::symlink_metadata(&path) else {
        return RecentsFile::default();
    };
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_RECENTS_BYTES
    {
        return RecentsFile::default();
    }
    std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<RecentsFile>(&bytes).ok())
        .filter(|file| file.version == RECENTS_VERSION)
        .unwrap_or_default()
}

pub(crate) fn library_opened_at() -> BTreeMap<String, u64> {
    read_recents().opened
}

fn record_library_opened(project_id: &str, opened_at_ms: u64) -> Result<(), String> {
    let _guard = write_lock().lock().unwrap_or_else(PoisonError::into_inner);
    let mut file = read_recents();
    file.version = RECENTS_VERSION;
    file.opened.insert(project_id.to_string(), opened_at_ms);
    if file.opened.len() > MAX_RECENTS {
        let mut by_age: Vec<(String, u64)> = file
            .opened
            .iter()
            .map(|(id, at)| (id.clone(), *at))
            .collect();
        by_age.sort_by_key(|(_, at)| *at);
        for (id, _) in by_age.into_iter().take(file.opened.len() - MAX_RECENTS) {
            file.opened.remove(&id);
        }
    }
    let bytes = serde_json::to_vec(&file)
        .map_err(|error| format!("could not encode recent projects: {error}"))?;
    let path = recents_path()?;
    crate::sandbox::atomic_write(&path, &bytes)?;
    crate::fsperm::harden_file(&path);
    Ok(())
}

pub(crate) fn record_project_opened(project_id: &str, opened_at_ms: u64) -> Result<(), String> {
    crate::paths::validate_project_id(project_id)?;
    if crate::project_location::kind_of(project_id)? == crate::project_location::ProjectKind::Linked
    {
        return crate::linked_registry::update(project_id, |record| {
            record.last_opened_at = record.last_opened_at.max(opened_at_ms);
            Ok(())
        })
        .map(|_| ());
    }
    record_library_opened(project_id, opened_at_ms)
}

pub(crate) fn record_project_opened_now(project_id: &str) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0);
    if let Err(error) = record_project_opened(project_id, now) {
        let _ = crate::project::append_app_log(format!(
            "Could not record when {project_id:?} was opened: {error}"
        ));
    }
}
