use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryEntry {
    pub(super) key: String,
    pub(super) imported_at: i64,
    pub(super) notes: usize,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub(super) struct History {
    #[serde(default)]
    pub(super) folders: Vec<HistoryEntry>,
}

pub(super) fn history_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(Default::default)
}

pub(super) fn history_path() -> Result<PathBuf, String> {
    Ok(crate::paths::oleafly_root()?.join(HISTORY_FILE))
}

pub(super) fn folder_key(root: &Path) -> String {
    crate::collab::disk::sha256_hex(root.to_string_lossy().as_bytes())
}

pub(super) fn read_history() -> History {
    history_path()
        .ok()
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub(super) fn journal_dir() -> Result<PathBuf, String> {
    Ok(crate::paths::oleafly_root()?.join(JOURNAL_DIR))
}

pub(super) fn remember(history: &mut History, key: String, notes: usize) {
    history.folders.retain(|entry| entry.key != key);
    history.folders.push(HistoryEntry {
        key,
        imported_at: crate::collab::commands::now_ms(),
        notes,
    });
    let excess = history.folders.len().saturating_sub(HISTORY_LIMIT);
    history.folders.drain(..excess);
}

pub(super) fn write_history(history: &History) -> Result<(), String> {
    let path = history_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_vec_pretty(history).map_err(|error| error.to_string())?;
    crate::sandbox::atomic_write(&path, &json)
}

pub(super) fn recover_interrupted(history: &mut History) -> bool {
    let Ok(read) =
        journal_dir().and_then(|dir| std::fs::read_dir(dir).map_err(|error| error.to_string()))
    else {
        return false;
    };
    let active: HashSet<String> = running()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .keys()
        .cloned()
        .collect();
    let mut changed = false;
    for entry in read.flatten() {
        if active.contains(entry.file_name().to_string_lossy().as_ref()) {
            continue;
        }
        let text = std::fs::read_to_string(entry.path()).unwrap_or_default();
        let mut lines = text.lines();
        if let Some(key) = lines.next() {
            let kept = lines
                .filter(|id| crate::paths::project_dir(id).is_ok_and(|dir| dir.is_dir()))
                .count();
            if kept > 0 {
                let earlier = history
                    .folders
                    .iter()
                    .find(|known| known.key == key)
                    .map_or(0, |known| known.notes);
                remember(history, key.to_string(), earlier + kept);
                changed = true;
            }
        }
        let _ = std::fs::remove_file(entry.path());
    }
    changed
}

pub(crate) fn previous_import(root: &Path) -> Option<HistoryEntry> {
    let _guard = history_lock()
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let key = folder_key(root);
    let mut history = read_history();
    if recover_interrupted(&mut history) {
        let _ = write_history(&history);
    }
    history.folders.into_iter().find(|entry| entry.key == key)
}

pub(crate) fn record_import(root: &Path, notes: usize) -> Result<(), String> {
    let _guard = history_lock()
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let mut history = read_history();
    remember(&mut history, folder_key(root), notes);
    write_history(&history)
}
