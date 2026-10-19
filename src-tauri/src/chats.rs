//! AI chat history on disk, one file per chat under
//! `~/.oleafly/chats/<project id>/<chat id>.json`.
//!
//! Until 0.4.8 each project kept one `chats/<project id>.json` array, which
//! capped history at 50 chats and rewrote every chat on each save. The first
//! load migrates that file into per-chat files and keeps it as
//! `<project id>.json.migrated`. History before that lived in the webview's
//! localStorage; the frontend still migrates that payload on first load.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use serde::Deserialize;

use crate::paths;

static SAVE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// The start of a save error for a chat past the size limit; the webview
/// keeps such a chat in memory and offers an export.
pub(crate) const CHAT_TOO_LARGE: &str = "[chat_too_large]";
/// One chat on disk.
const MAX_CHAT_JSON_BYTES: usize = 8 * 1024 * 1024;
/// Full chat bodies one load returns, newest first; older chats come back
/// as stubs the webview loads when they are opened.
const LOAD_BUDGET_BYTES: usize = 32 * 1024 * 1024;
const MAX_CHAT_ID_LEN: usize = 128;
const MIGRATED_SUFFIX: &str = ".json.migrated";
/// Names Windows reserves for devices, in any case.
const RESERVED_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];
/// Fields a stub keeps so the history list can show the chat.
const STUB_FIELDS: [&str; 10] = [
    "id",
    "projectId",
    "title",
    "createdAt",
    "updatedAt",
    "headOid",
    "usage",
    "threadId",
    "effort",
    "web",
];

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatsLoad {
    pub json: String,
    pub skipped: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatHead {
    id: String,
    #[serde(default)]
    updated_at: Option<f64>,
}

fn save_lock() -> std::sync::MutexGuard<'static, ()> {
    SAVE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub(crate) fn validate_chat_id(chat_id: &str) -> Result<(), String> {
    let bytes = chat_id.as_bytes();
    let well_formed = !bytes.is_empty()
        && bytes.len() <= MAX_CHAT_ID_LEN
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'-');
    let reserved = RESERVED_NAMES
        .iter()
        .any(|name| name.eq_ignore_ascii_case(chat_id));
    if well_formed && !reserved {
        Ok(())
    } else {
        Err(format!("invalid chat id: {chat_id:?}"))
    }
}

fn chats_dir(root: &Path) -> PathBuf {
    root.join("chats")
}

fn project_dir(root: &Path, project_id: &str) -> Result<PathBuf, String> {
    paths::validate_project_id(project_id)?;
    Ok(chats_dir(root).join(project_id))
}

fn chat_path(root: &Path, project_id: &str, chat_id: &str) -> Result<PathBuf, String> {
    validate_chat_id(chat_id)?;
    Ok(project_dir(root, project_id)?.join(format!("{chat_id}.json")))
}

fn legacy_path(root: &Path, project_id: &str) -> Result<PathBuf, String> {
    paths::validate_project_id(project_id)?;
    Ok(chats_dir(root).join(format!("{project_id}.json")))
}

fn backup_path(root: &Path, project_id: &str) -> Result<PathBuf, String> {
    paths::validate_project_id(project_id)?;
    Ok(chats_dir(root).join(format!("{project_id}{MIGRATED_SUFFIX}")))
}

fn read_head(json: &str) -> Option<ChatHead> {
    serde_json::from_str(json).ok()
}

/// Moves a legacy per-project array into per-chat files, keeping whichever
/// copy of a chat is newer, then keeps the array as a backup. True when a
/// legacy file was migrated.
pub(crate) fn migrate_legacy_chats(root: &Path, project_id: &str) -> Result<bool, String> {
    let legacy = legacy_path(root, project_id)?;
    let Ok(data) = std::fs::read(&legacy) else {
        return Ok(false);
    };
    let parsed: serde_json::Value = serde_json::from_slice(&data)
        .map_err(|error| format!("legacy chats file is not valid JSON: {error}"))?;
    let dir = project_dir(root, project_id)?;
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("failed to create the chats folder: {error}"))?;
    for chat in parsed.as_array().map(Vec::as_slice).unwrap_or_default() {
        let Some(chat_id) = chat.get("id").and_then(serde_json::Value::as_str) else {
            continue;
        };
        if validate_chat_id(chat_id).is_err() {
            continue;
        }
        let path = dir.join(format!("{chat_id}.json"));
        let incoming = chat.get("updatedAt").and_then(serde_json::Value::as_f64);
        let existing = std::fs::read_to_string(&path)
            .ok()
            .and_then(|json| read_head(&json))
            .map(|head| head.updated_at);
        if let Some(existing) = existing {
            if existing.unwrap_or(f64::MIN) >= incoming.unwrap_or(f64::MIN) {
                continue;
            }
        }
        let json = chat.to_string();
        if json.len() > MAX_CHAT_JSON_BYTES {
            continue;
        }
        save_to_path(&path, &json)?;
    }
    let all = read_project_chats(root, project_id, usize::MAX)?;
    let _ = crate::library_db::index_project_chats(root, project_id, &all.json);
    let _guard = save_lock();
    replace_path(&legacy, &backup_path(root, project_id)?)?;
    Ok(true)
}

fn stub_of(value: &serde_json::Value) -> String {
    let mut stub = serde_json::Map::new();
    for field in STUB_FIELDS {
        if let Some(entry) = value.get(field) {
            stub.insert(field.to_string(), entry.clone());
        }
    }
    let count = value
        .get("messages")
        .and_then(serde_json::Value::as_array)
        .map_or(0, Vec::len);
    stub.insert("messages".into(), serde_json::Value::Array(Vec::new()));
    stub.insert("stub".into(), serde_json::Value::Bool(true));
    stub.insert("messageCount".into(), count.into());
    serde_json::Value::Object(stub).to_string()
}

/// A project's chats as one JSON array, newest first: full bodies while
/// they fit `budget`, stubs after that. Unreadable files are skipped and
/// counted; nothing is created when the project has no chats.
pub(crate) fn read_project_chats(
    root: &Path,
    project_id: &str,
    budget: usize,
) -> Result<ChatsLoad, String> {
    let dir = project_dir(root, project_id)?;
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ChatsLoad {
                json: "[]".into(),
                skipped: 0,
            })
        }
        Err(error) => return Err(format!("failed to read the chats folder: {error}")),
    };
    let mut skipped = 0u32;
    let mut chats: Vec<(f64, String)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(std::ffi::OsStr::to_str) else {
            continue;
        };
        if name.starts_with('.') || !name.ends_with(".json") {
            continue;
        }
        let stem = &name[..name.len() - ".json".len()];
        let too_large = entry
            .metadata()
            .map(|meta| meta.len() > MAX_CHAT_JSON_BYTES as u64)
            .unwrap_or(true);
        if too_large {
            skipped += 1;
            continue;
        }
        let Ok(json) = std::fs::read_to_string(&path) else {
            skipped += 1;
            continue;
        };
        match read_head(&json) {
            Some(head) if head.id == stem => {
                chats.push((head.updated_at.unwrap_or(0.0), json));
            }
            _ => skipped += 1,
        }
    }
    chats.sort_by(|left, right| right.0.total_cmp(&left.0));
    let mut used = 0usize;
    let mut items = Vec::with_capacity(chats.len());
    for (_, json) in chats {
        if used.saturating_add(json.len()) <= budget {
            used += json.len();
            items.push(json);
        } else {
            match serde_json::from_str::<serde_json::Value>(&json) {
                Ok(value) => items.push(stub_of(&value)),
                Err(_) => skipped += 1,
            }
        }
    }
    Ok(ChatsLoad {
        json: format!("[{}]", items.join(",")),
        skipped,
    })
}

pub(crate) fn read_chat(root: &Path, project_id: &str, chat_id: &str) -> Result<String, String> {
    let path = chat_path(root, project_id, chat_id)?;
    let meta =
        std::fs::metadata(&path).map_err(|error| format!("failed to read the chat: {error}"))?;
    if meta.len() > MAX_CHAT_JSON_BYTES as u64 {
        return Err(format!(
            "{CHAT_TOO_LARGE} This chat is larger than the 8 MB save limit."
        ));
    }
    std::fs::read_to_string(&path).map_err(|error| format!("failed to read the chat: {error}"))
}

pub(crate) fn write_chat(
    root: &Path,
    project_id: &str,
    chat_id: &str,
    json: &str,
    index: bool,
) -> Result<(), String> {
    let path = chat_path(root, project_id, chat_id)?;
    if json.len() > MAX_CHAT_JSON_BYTES {
        return Err(format!(
            "{CHAT_TOO_LARGE} This chat is larger than the 8 MB save limit."
        ));
    }
    let head = read_head(json).ok_or_else(|| "invalid chat JSON".to_string())?;
    if head.id != chat_id {
        return Err("the chat's id does not match its file".into());
    }
    let dir = project_dir(root, project_id)?;
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("failed to create the chats folder: {error}"))?;
    save_to_path(&path, json)?;
    if index {
        // Best effort: the file on disk stays canonical.
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(json) {
            let _ = crate::library_db::index_chat(root, project_id, &value);
        }
    }
    Ok(())
}

pub(crate) fn delete_chat(root: &Path, project_id: &str, chat_id: &str) -> Result<(), String> {
    let path = chat_path(root, project_id, chat_id)?;
    {
        let _guard = save_lock();
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("failed to delete the chat: {error}")),
        }
    }
    let _ = crate::library_db::drop_chat(root, project_id, chat_id);
    Ok(())
}

fn remove_if_present(path: &Path) -> Result<(), String> {
    let result = if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    };
    match result {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to delete chats: {error}")),
    }
}

fn remove_project_chats_in(root: &Path, project_id: &str) -> Result<(), String> {
    let folder = project_dir(root, project_id)?;
    let legacy = legacy_path(root, project_id)?;
    let backup = backup_path(root, project_id)?;
    let _guard = save_lock();
    remove_if_present(&folder)?;
    remove_if_present(&legacy)?;
    remove_if_present(&backup)
}

/// Removes every chat of a project: its folder, a legacy file and its backup.
pub(crate) fn remove_project_chats(project_id: &str) -> Result<(), String> {
    remove_project_chats_in(&paths::oleafly_root()?, project_id)
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce(PathBuf) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || work(paths::oleafly_root()?))
        .await
        .map_err(|error| format!("chats task failed: {error}"))?
}

/// A project's chats, migrating a legacy file first.
#[tauri::command]
pub async fn chats_load(project_id: String) -> Result<ChatsLoad, String> {
    blocking(move |root| {
        if let Err(error) = migrate_legacy_chats(&root, &project_id) {
            crate::logsafe::info(
                "chat migration",
                serde_json::json!({ "error": error }),
                serde_json::Value::Null,
            );
        }
        read_project_chats(&root, &project_id, LOAD_BUDGET_BYTES)
    })
    .await
}

#[tauri::command]
pub async fn chat_read(project_id: String, chat_id: String) -> Result<String, String> {
    blocking(move |root| read_chat(&root, &project_id, &chat_id)).await
}

/// Saves one chat. Saves while a reply streams pass `index: false`; the
/// save at the end of the run updates the search index.
#[tauri::command]
pub async fn chat_save(
    project_id: String,
    chat_id: String,
    json: String,
    index: Option<bool>,
) -> Result<(), String> {
    blocking(move |root| write_chat(&root, &project_id, &chat_id, &json, index.unwrap_or(true)))
        .await
}

#[tauri::command]
pub async fn chat_delete(project_id: String, chat_id: String) -> Result<(), String> {
    blocking(move |root| delete_chat(&root, &project_id, &chat_id)).await
}

/// Every chat of a project with its full body (never stubs), as one array.
/// Kept for the backend-port contract.
#[tauri::command]
pub async fn load_project_chats(project_id: String) -> Result<String, String> {
    blocking(move |root| {
        if let Err(error) = migrate_legacy_chats(&root, &project_id) {
            crate::logsafe::info(
                "chat migration",
                serde_json::json!({ "error": error }),
                serde_json::Value::Null,
            );
        }
        read_project_chats(&root, &project_id, usize::MAX).map(|load| load.json)
    })
    .await
}

/// Writes each chat of the array to its own file and deletes nothing. Kept
/// for the backend-port contract.
#[tauri::command]
pub async fn save_project_chats(project_id: String, json: String) -> Result<(), String> {
    blocking(move |root| {
        let parsed: serde_json::Value =
            serde_json::from_str(&json).map_err(|error| format!("invalid chat JSON: {error}"))?;
        let chats = parsed
            .as_array()
            .ok_or_else(|| "chat history must be a JSON array".to_string())?;
        for chat in chats {
            let Some(chat_id) = chat.get("id").and_then(serde_json::Value::as_str) else {
                continue;
            };
            write_chat(&root, &project_id, chat_id, &chat.to_string(), true)?;
        }
        Ok(())
    })
    .await
}

fn save_to_path(path: &Path, json: &str) -> Result<(), String> {
    let _guard = save_lock();
    let dir = path
        .parent()
        .ok_or_else(|| "chats path has no parent".to_string())?;
    let name = path
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .ok_or_else(|| "chats path has no file name".to_string())?;
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!(".{name}.{}.{}.tmp", std::process::id(), sequence));
    struct Cleanup(PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let cleanup = Cleanup(tmp.clone());
    {
        use std::io::Write;
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts
            .open(&tmp)
            .map_err(|e| format!("failed to open chats temp file: {e}"))?;
        f.write_all(json.as_bytes())
            .map_err(|e| format!("failed to write chats: {e}"))?;
        let _ = f.sync_all();
    }
    crate::fsperm::harden_file(&tmp);
    replace_path(&tmp, path)?;
    drop(cleanup);
    Ok(())
}

#[cfg(not(windows))]
fn replace_path(source: &Path, destination: &Path) -> Result<(), String> {
    std::fs::rename(source, destination).map_err(|e| format!("failed to replace chats file: {e}"))
}

#[cfg(windows)]
fn replace_path(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        return Err(format!(
            "failed to replace chats file: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
