//! AI chat history on disk, one file per chat under
//! `~/.oleafly/chats/<project id>/<chat id>.json`.
//!
//! Until 0.4.8 each project kept one `chats/<project id>.json` array, which
//! capped history at 50 chats and rewrote every chat on each save. The first
//! load merges that file into per-chat files and leaves it where it is, so a
//! downgrade to 0.4.7 still finds its history; a marker beside the per-chat
//! files records which version of the file was merged, so a chat deleted
//! since is not brought back, and a file 0.4.7 wrote later is merged again.
//! History before that lived in the webview's localStorage; the frontend
//! still migrates that payload on first load.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

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
/// A backup an earlier 0.4.8 build made by renaming the legacy file.
const MIGRATED_SUFFIX: &str = ".json.migrated";
/// Records, inside a project's chat folder, which legacy file was merged.
const LEGACY_MARKER: &str = ".legacy-merged";
/// What a load learned about the older chats, so it need not read them again.
const STUB_INDEX: &str = ".stubs.json";
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

/// The legacy file a merge saw, and how many of its chats could not be
/// merged, kept beside the per-chat files.
#[derive(Serialize, Deserialize)]
struct LegacyMarker {
    stamp: String,
    skipped: u32,
}

/// What a legacy merge did.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Migration {
    /// The legacy file was merged by this call.
    pub merged: bool,
    /// Chats in the legacy file that cannot be per-chat files (an id that is
    /// not a file name, a body over the limit): they stay in that file only.
    pub skipped: u32,
}

/// One chat as the last load left it: enough to list it without reading it.
#[derive(Serialize, Deserialize)]
struct StubEntry {
    len: u64,
    modified: u128,
    updated_at: f64,
    stub: serde_json::Value,
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

/// The length and modification time of a file as one string: what tells a
/// file that changed from the one a merge saw.
fn file_stamp(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    Some(format!("{}:{}", meta.len(), modified_nanos(&meta)?))
}

fn modified_nanos(meta: &std::fs::Metadata) -> Option<u128> {
    Some(
        meta.modified()
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_nanos(),
    )
}

/// Merges a legacy per-project array into per-chat files, keeping whichever
/// copy of a chat is newer. The array itself stays, so 0.4.7 still reads it;
/// a marker records the version that was merged, and the array is merged
/// again only when it has changed since (0.4.7 saved to it).
pub(crate) fn migrate_legacy(root: &Path, project_id: &str) -> Result<Migration, String> {
    let legacy = legacy_path(root, project_id)?;
    // Stamped before it is read: a write in between only causes a re-merge.
    let Some(stamp) = file_stamp(&legacy) else {
        return Ok(Migration::default());
    };
    let dir = project_dir(root, project_id)?;
    let marker_path = dir.join(LEGACY_MARKER);
    let marker = std::fs::read(&marker_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<LegacyMarker>(&bytes).ok());
    if let Some(marker) = marker.filter(|marker| marker.stamp == stamp) {
        return Ok(Migration {
            merged: false,
            skipped: marker.skipped,
        });
    }
    let Ok(data) = std::fs::read(&legacy) else {
        return Ok(Migration::default());
    };
    let parsed: serde_json::Value = serde_json::from_slice(&data)
        .map_err(|error| format!("legacy chats file is not valid JSON: {error}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("failed to create the chats folder: {error}"))?;
    let mut skipped = 0u32;
    for chat in parsed.as_array().map(Vec::as_slice).unwrap_or_default() {
        let Some(chat_id) = chat.get("id").and_then(serde_json::Value::as_str) else {
            skipped += 1;
            continue;
        };
        if validate_chat_id(chat_id).is_err() {
            skipped += 1;
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
            skipped += 1;
            continue;
        }
        save_to_path(&path, &json)?;
        // Best effort, a chat at a time: the whole history is never held
        // as one string to index it.
        let _ = crate::library_db::index_chat(root, project_id, chat);
    }
    let marker = serde_json::to_string(&LegacyMarker { stamp, skipped })
        .map_err(|error| format!("failed to record the chat migration: {error}"))?;
    save_to_path(&marker_path, &marker)?;
    Ok(Migration {
        merged: true,
        skipped,
    })
}

/// [`migrate_legacy`] for callers that only ask whether a merge ran.
pub(crate) fn migrate_legacy_chats(root: &Path, project_id: &str) -> Result<bool, String> {
    migrate_legacy(root, project_id).map(|migration| migration.merged)
}

fn stub_of(value: &serde_json::Value) -> serde_json::Value {
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
    serde_json::Value::Object(stub)
}

/// A chat file found in a project's folder, as its directory entry shows it.
struct ChatFile {
    stem: String,
    path: PathBuf,
    len: u64,
    modified: u128,
}

fn read_stub_index(dir: &Path) -> std::collections::HashMap<String, StubEntry> {
    std::fs::read(dir.join(STUB_INDEX))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// A project's chats as one JSON array, newest first: full bodies while
/// they fit `budget`, stubs after that. Unreadable files are skipped and
/// counted; nothing is created when the project has no chats.
///
/// A chat's body is read only when it goes into the answer in full. The
/// stub of every other chat comes from an index kept beside the files
/// (`.stubs.json`, keyed by each file's length and modification time), so a
/// project with hundreds of long chats opens by reading the newest few. A
/// file the index does not know, or that changed, is read once and added.
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
    let mut files: Vec<ChatFile> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(std::ffi::OsStr::to_str) else {
            continue;
        };
        if name.starts_with('.') || !name.ends_with(".json") {
            continue;
        }
        let stem = name[..name.len() - ".json".len()].to_string();
        let Ok(meta) = entry.metadata() else {
            skipped += 1;
            continue;
        };
        if meta.len() > MAX_CHAT_JSON_BYTES as u64 {
            skipped += 1;
            continue;
        }
        let Some(modified) = modified_nanos(&meta) else {
            skipped += 1;
            continue;
        };
        files.push(ChatFile {
            stem,
            path,
            len: meta.len(),
            modified,
        });
    }

    let mut known = read_stub_index(&dir);
    let mut index: std::collections::HashMap<String, StubEntry> =
        std::collections::HashMap::with_capacity(files.len());
    let mut changed = false;
    let mut listed: Vec<(ChatFile, f64)> = Vec::with_capacity(files.len());
    for file in files {
        let entry = match known
            .remove(&file.stem)
            .filter(|entry| entry.len == file.len && entry.modified == file.modified)
        {
            Some(entry) => entry,
            None => {
                changed = true;
                let Ok(json) = std::fs::read_to_string(&file.path) else {
                    skipped += 1;
                    continue;
                };
                let head = read_head(&json).filter(|head| head.id == file.stem);
                let value = serde_json::from_str::<serde_json::Value>(&json).ok();
                let (Some(head), Some(value)) = (head, value) else {
                    skipped += 1;
                    continue;
                };
                StubEntry {
                    len: file.len,
                    modified: file.modified,
                    updated_at: head.updated_at.unwrap_or(0.0),
                    stub: stub_of(&value),
                }
            }
        };
        let stem = file.stem.clone();
        listed.push((file, entry.updated_at));
        index.insert(stem, entry);
    }
    // Files that are gone leave the index too.
    changed |= !known.is_empty();
    listed.sort_by(|left, right| right.1.total_cmp(&left.1));

    let mut used = 0usize;
    let mut json = String::from("[");
    for (file, _) in &listed {
        let full = used.saturating_add(file.len as usize) <= budget;
        let item = if full {
            // Read again to include it, and checked again: it may have
            // changed since the listing.
            match std::fs::read_to_string(&file.path) {
                Ok(body) if read_head(&body).is_some_and(|head| head.id == file.stem) => {
                    used += body.len();
                    body
                }
                _ => {
                    skipped += 1;
                    continue;
                }
            }
        } else {
            match index.get(&file.stem) {
                Some(entry) => entry.stub.to_string(),
                None => continue,
            }
        };
        if json.len() > 1 {
            json.push(',');
        }
        json.push_str(&item);
    }
    json.push(']');
    if changed {
        // Best effort: without it the next load reads those files again.
        if let Ok(text) = serde_json::to_string(&index) {
            let _ = save_to_path(&dir.join(STUB_INDEX), &text);
        }
    }
    Ok(ChatsLoad { json, skipped })
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
        let migration = migrate_logged(&root, &project_id);
        let mut load = read_project_chats(&root, &project_id, LOAD_BUDGET_BYTES)?;
        // Chats the legacy file holds that cannot be per-chat files are
        // counted with the files that could not be read.
        load.skipped = load.skipped.saturating_add(migration.skipped);
        Ok(load)
    })
    .await
}

/// Merges a legacy file, logging a failure instead of returning it: the
/// per-chat files load either way.
fn migrate_logged(root: &Path, project_id: &str) -> Migration {
    migrate_legacy(root, project_id).unwrap_or_else(|error| {
        crate::logsafe::info(
            "chat migration",
            serde_json::json!({ "error": error }),
            serde_json::Value::Null,
        );
        Migration::default()
    })
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
        migrate_logged(&root, &project_id);
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
