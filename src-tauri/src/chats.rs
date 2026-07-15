//! Per-project AI chat history on disk under `~/.openleaf/chats/<id>.json`.
//!
//! History used to live only in the webview's localStorage (~5 MB/origin),
//! which was wiped by profile resets and shared a tight quota with other keys.
//! The frontend still migrates any legacy localStorage payload on first load.

use crate::paths;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

static SAVE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// Directory holding one JSON file per project.
fn chats_root() -> Result<std::path::PathBuf, String> {
    let dir = paths::openleaf_root()?.join("chats");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("failed to create chats dir {dir:?}: {e}"))?;
    }
    Ok(dir)
}

fn chats_path(project_id: &str) -> Result<std::path::PathBuf, String> {
    paths::validate_project_id(project_id)?;
    Ok(chats_root()?.join(format!("{project_id}.json")))
}

/// Hard cap so a runaway chat history cannot fill the disk via IPC.
const MAX_CHATS_JSON_BYTES: usize = 8 * 1024 * 1024; // 8 MiB

/// Load the JSON array of chats for a project. Returns `"[]"` when missing.
/// Async + spawn_blocking: sync commands run on the main thread, and the read
/// (plus dir creation) must never stall the webview.
#[tauri::command]
pub async fn load_project_chats(project_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || load_blocking(&project_id))
        .await
        .map_err(|e| format!("chats load task failed: {e}"))?
}

fn load_blocking(project_id: &str) -> Result<String, String> {
    let path = chats_path(project_id)?;
    if !path.exists() {
        return Ok("[]".into());
    }
    let data = std::fs::read(&path).map_err(|e| format!("failed to read chats: {e}"))?;
    if data.len() > MAX_CHATS_JSON_BYTES {
        return Err("chat history on disk is too large".into());
    }
    String::from_utf8(data).map_err(|e| format!("chats file is not valid UTF-8: {e}"))
}

/// Persist the JSON array of chats for a project (atomic replace).
/// Async + spawn_blocking: the write ends in `sync_all` (fsync), which can
/// take tens of milliseconds and would jank the UI on a sync command.
#[tauri::command]
pub async fn save_project_chats(project_id: String, json: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || save_blocking(&project_id, &json))
        .await
        .map_err(|e| format!("chats save task failed: {e}"))?
}

fn save_blocking(project_id: &str, json: &str) -> Result<(), String> {
    if json.len() > MAX_CHATS_JSON_BYTES {
        return Err("chat history exceeds the 8 MB save limit".into());
    }
    // Reject non-array JSON early so we never write garbage that breaks load.
    let parsed: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("invalid chat JSON: {e}"))?;
    if !parsed.is_array() {
        return Err("chat history must be a JSON array".into());
    }
    let path = chats_path(project_id)?;
    save_to_path(&path, json)
}

fn save_to_path(path: &std::path::Path, json: &str) -> Result<(), String> {
    let lock = SAVE_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "chat save lock is poisoned".to_string())?;
    let dir = path
        .parent()
        .ok_or_else(|| "chats path has no parent".to_string())?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "chats path has no file name".to_string())?;
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!(".{name}.{}.{}.tmp", std::process::id(), sequence));
    struct Cleanup(std::path::PathBuf);
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
fn replace_path(source: &std::path::Path, destination: &std::path::Path) -> Result<(), String> {
    std::fs::rename(source, destination).map_err(|e| format!("failed to replace chats file: {e}"))
}

#[cfg(windows)]
fn replace_path(source: &std::path::Path, destination: &std::path::Path) -> Result<(), String> {
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
mod tests {
    use super::*;

    #[test]
    fn rejects_illegal_project_ids() {
        assert!(chats_path("..").is_err());
        assert!(chats_path("a/b").is_err());
        assert!(chats_path("").is_err());
    }

    #[test]
    fn repeated_save_replaces_existing_file_and_removes_staging_files() {
        let root = std::env::temp_dir().join(format!(
            "openleaf-chat-save-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("project.json");
        save_to_path(&path, "[]").unwrap();
        save_to_path(&path, "[{\"id\":\"second\"}]").unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "[{\"id\":\"second\"}]"
        );
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_replace_preserves_existing_file() {
        let root = std::env::temp_dir().join(format!(
            "openleaf-chat-failure-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("project.json");
        std::fs::write(&path, "old").unwrap();
        assert!(replace_path(&root.join("missing.tmp"), &path).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");
        std::fs::remove_dir_all(root).unwrap();
    }
}
