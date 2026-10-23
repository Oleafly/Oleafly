//! Files attached to AI chats, stored once by content hash under
//! `<data>/attachments/<project id | global>/`. The renderer sends a
//! reference (`attachment` part); the run resolves it into an image, a
//! document or text for the model it talks to (see `resolve`).
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::app_error::AppError;

pub(crate) mod resolve;

pub(crate) const MAX_ATTACHMENT_BYTES: usize = 32 * 1024 * 1024;
pub(crate) const MAX_ATTACHMENT_TEXT_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const STORE_CAP_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub(crate) const GLOBAL_SCOPE: &str = "global";
pub(crate) const MAX_UPLOAD_HEADER_BYTES: usize = 8 * 1024;
/// The most an upload may be when the webview delivers it as a JSON array of
/// numbers (the `postMessage` fallback). Tauri has already turned every byte
/// into a 32-byte JSON value by then, so this keeps that near half a gigabyte.
pub(crate) const MAX_JSON_UPLOAD_BYTES: usize = 16 * 1024 * 1024;
const _: () = assert!(MAX_JSON_UPLOAD_BYTES <= MAX_ATTACHMENT_BYTES);
const STORE_DIR: &str = "attachments";
const MAX_NAME_CHARS: usize = 255;
const MAX_MIME_LEN: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentMeta {
    pub sha256: String,
    pub name: String,
    pub mime: String,
    pub size: u64,
    #[serde(default)]
    pub pages: Option<u32>,
    #[serde(default)]
    pub has_text: bool,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UploadHeader {
    #[serde(default)]
    pub project_id: Option<String>,
    pub name: String,
    pub mime: String,
}

fn invalid() -> String {
    AppError::new("attachments.invalid_request").into()
}

fn not_found() -> String {
    AppError::new("attachments.not_found").into()
}

fn storage_failed(detail: impl ToString) -> String {
    AppError::new("attachments.storage_failed")
        .detail(detail)
        .into()
}

fn too_large(limit: usize) -> String {
    AppError::new("attachments.too_large")
        .param("max", limit / (1024 * 1024))
        .into()
}

/// Splits an upload into its JSON header and the file bytes: a 4-byte
/// little-endian header length, the header, then the file.
pub(crate) fn decode_upload(body: &[u8]) -> Result<(UploadHeader, &[u8]), String> {
    let length = body
        .get(..4)
        .map(|prefix| u32::from_le_bytes([prefix[0], prefix[1], prefix[2], prefix[3]]) as usize)
        .ok_or_else(invalid)?;
    if length > MAX_UPLOAD_HEADER_BYTES || length + 4 > body.len() {
        return Err(invalid());
    }
    let header: UploadHeader =
        serde_json::from_slice(&body[4..4 + length]).map_err(|_| invalid())?;
    Ok((header, &body[4 + length..]))
}

/// The raw request body. Linux builds that fall back to `postMessage` IPC
/// deliver it as a JSON array of numbers.
pub(crate) fn upload_bytes(body: &tauri::ipc::InvokeBody) -> Result<Vec<u8>, String> {
    upload_bytes_within(body, MAX_JSON_UPLOAD_BYTES)
}

/// [`upload_bytes`] with `json_limit` as the most a JSON array may carry.
/// The length is checked before any byte is converted.
pub(crate) fn upload_bytes_within(
    body: &tauri::ipc::InvokeBody,
    json_limit: usize,
) -> Result<Vec<u8>, String> {
    match body {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        tauri::ipc::InvokeBody::Json(serde_json::Value::Array(values)) => {
            if values.len() > json_limit {
                return Err(too_large(json_limit));
            }
            values
                .iter()
                .map(|value| {
                    value
                        .as_u64()
                        .and_then(|number| u8::try_from(number).ok())
                        .ok_or_else(invalid)
                })
                .collect()
        }
        tauri::ipc::InvokeBody::Json(_) => Err(invalid()),
    }
}

/// The folder a project's attachments live in, or the global one.
pub(crate) fn scope_name(project_id: Option<&str>) -> Result<String, String> {
    match project_id.map(str::trim).filter(|id| !id.is_empty()) {
        None if project_id.is_none() => Ok(GLOBAL_SCOPE.to_string()),
        None => Err(invalid()),
        Some(id) => {
            crate::paths::validate_project_id(id).map_err(|_| invalid())?;
            Ok(id.to_string())
        }
    }
}

fn valid_hash(sha256: &str) -> Result<String, String> {
    let hash = sha256.trim().to_ascii_lowercase();
    if hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(hash)
    } else {
        Err(invalid())
    }
}

fn clean_name(name: &str) -> String {
    let replaced: String = name
        .chars()
        .filter(|character| !character.is_control())
        .map(|character| match character {
            '/' | '\\' | ':' => '_',
            other => other,
        })
        .collect();
    let trimmed: String = replaced.trim().chars().take(MAX_NAME_CHARS).collect();
    let trimmed = trimmed.trim().to_string();
    if trimmed.is_empty() {
        "attachment".to_string()
    } else {
        trimmed
    }
}

fn clean_mime(mime: &str) -> Result<String, String> {
    let mime = mime.trim().to_ascii_lowercase();
    let part_ok = |part: &str| {
        !part.is_empty()
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'+' | b'-'))
    };
    match mime.split_once('/') {
        Some((kind, subtype))
            if mime.len() <= MAX_MIME_LEN && part_ok(kind) && part_ok(subtype) =>
        {
            Ok(mime)
        }
        _ => Err(invalid()),
    }
}

fn scope_dir(root: &Path, scope: &str) -> PathBuf {
    root.join(STORE_DIR).join(scope)
}

fn blob_path(root: &Path, scope: &str, hash: &str) -> PathBuf {
    scope_dir(root, scope).join(hash)
}

fn meta_path(root: &Path, scope: &str, hash: &str) -> PathBuf {
    scope_dir(root, scope).join(format!("{hash}.json"))
}

fn text_path(root: &Path, scope: &str, hash: &str) -> PathBuf {
    scope_dir(root, scope).join(format!("{hash}.txt"))
}

fn write_meta(root: &Path, scope: &str, meta: &AttachmentMeta) -> Result<(), String> {
    let bytes = serde_json::to_vec(meta).map_err(storage_failed)?;
    crate::sandbox::atomic_write(&meta_path(root, scope, &meta.sha256), &bytes)
        .map_err(storage_failed)
}

fn same_size(path: &Path, size: u64) -> bool {
    std::fs::metadata(path).is_ok_and(|metadata| metadata.is_file() && metadata.len() == size)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Stores `bytes` by hash. A blob already stored with the same size is not
/// rewritten, so a reader holding it open (Windows) never fails the put.
pub(crate) fn store_bytes(
    root: &Path,
    scope: &str,
    name: &str,
    mime: &str,
    bytes: &[u8],
    limit: usize,
) -> Result<AttachmentMeta, String> {
    if bytes.len() > limit {
        return Err(too_large(limit));
    }
    let mime = clean_mime(mime)?;
    let name = clean_name(name);
    let hash = hex(&Sha256::digest(bytes));
    let dir = scope_dir(root, scope);
    std::fs::create_dir_all(&dir).map_err(storage_failed)?;
    let blob = blob_path(root, scope, &hash);
    let size = bytes.len() as u64;
    if !same_size(&blob, size) {
        let mut staged = tempfile::NamedTempFile::new_in(&dir).map_err(storage_failed)?;
        std::io::Write::write_all(&mut staged, bytes).map_err(storage_failed)?;
        if let Err(error) = staged.persist(&blob) {
            // Another put of the same bytes may have won the race.
            if !same_size(&blob, size) {
                return Err(storage_failed(error.error));
            }
        }
    }
    let previous = read_meta(root, scope, &hash).ok().flatten();
    let meta = AttachmentMeta {
        sha256: hash,
        name,
        mime,
        size,
        pages: previous.as_ref().and_then(|meta| meta.pages),
        has_text: previous.as_ref().is_some_and(|meta| meta.has_text),
    };
    write_meta(root, scope, &meta)?;
    Ok(meta)
}

/// Stores text extracted from an attachment (a PDF's text layer, which the
/// renderer reads) with its page count.
pub(crate) fn store_text(
    root: &Path,
    scope: &str,
    sha256: &str,
    text: &str,
    pages: Option<u32>,
) -> Result<AttachmentMeta, String> {
    let hash = valid_hash(sha256)?;
    if text.len() > MAX_ATTACHMENT_TEXT_BYTES {
        return Err(invalid());
    }
    let mut meta = read_meta(root, scope, &hash)?.ok_or_else(not_found)?;
    crate::sandbox::atomic_write(&text_path(root, scope, &hash), text.as_bytes())
        .map_err(storage_failed)?;
    meta.has_text = true;
    if pages.is_some() {
        meta.pages = pages;
    }
    write_meta(root, scope, &meta)?;
    Ok(meta)
}

fn touch(path: &Path) {
    if let Ok(file) = std::fs::File::options().write(true).open(path) {
        let _ = file.set_modified(SystemTime::now());
    }
}

/// The stored bytes; reading counts as use for the store's eviction order.
pub(crate) fn read_bytes(root: &Path, scope: &str, sha256: &str) -> Result<Vec<u8>, String> {
    let hash = valid_hash(sha256)?;
    let path = blob_path(root, scope, &hash);
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Err(not_found()),
        Err(error) => return Err(storage_failed(error)),
    };
    touch(&path);
    Ok(bytes)
}

pub(crate) fn read_text(root: &Path, scope: &str, sha256: &str) -> Result<Option<String>, String> {
    let hash = valid_hash(sha256)?;
    match std::fs::read_to_string(text_path(root, scope, &hash)) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(storage_failed(error)),
    }
}

pub(crate) fn read_meta(
    root: &Path,
    scope: &str,
    sha256: &str,
) -> Result<Option<AttachmentMeta>, String> {
    let hash = valid_hash(sha256)?;
    let raw = match std::fs::read(meta_path(root, scope, &hash)) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(storage_failed(error)),
    };
    let meta: Option<AttachmentMeta> = serde_json::from_slice(&raw).ok();
    Ok(meta.filter(|meta| blob_path(root, scope, &hash).is_file() && meta.sha256 == hash))
}

/// Where a hash is stored: the project's own folder first, then global.
pub(crate) fn locate(root: &Path, project_id: Option<&str>, sha256: &str) -> Option<String> {
    let hash = valid_hash(sha256).ok()?;
    let mut scopes = Vec::new();
    if let Ok(scope) = scope_name(project_id) {
        scopes.push(scope);
    }
    if !scopes.iter().any(|scope| scope == GLOBAL_SCOPE) {
        scopes.push(GLOBAL_SCOPE.to_string());
    }
    scopes
        .into_iter()
        .find(|scope| blob_path(root, scope, &hash).is_file())
}

fn remove_blob(root: &Path, scope: &str, hash: &str) -> u64 {
    let blob = blob_path(root, scope, hash);
    let size = std::fs::metadata(&blob)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let removed = std::fs::remove_file(&blob).is_ok();
    let _ = std::fs::remove_file(meta_path(root, scope, hash));
    let _ = std::fs::remove_file(text_path(root, scope, hash));
    if removed {
        size
    } else {
        0
    }
}

fn blob_hashes(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .filter(|name| name.len() == 64 && name.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .collect()
}

/// Removes every blob in `scope` not listed in `keep`. Returns the bytes
/// freed.
pub(crate) fn gc_scope(root: &Path, scope: &str, keep: &[String]) -> Result<u64, String> {
    let keep: Vec<String> = keep
        .iter()
        .filter_map(|hash| valid_hash(hash).ok())
        .collect();
    let mut freed = 0u64;
    for hash in blob_hashes(&scope_dir(root, scope)) {
        if !keep.contains(&hash) {
            freed = freed.saturating_add(remove_blob(root, scope, &hash));
        }
    }
    Ok(freed)
}

/// Keeps the whole store under `cap` by removing the least recently used
/// blobs (never `protect`). Returns the bytes freed.
pub(crate) fn enforce_store_cap(
    root: &Path,
    cap: u64,
    protect: (&str, &str),
) -> Result<u64, String> {
    let store = root.join(STORE_DIR);
    let Ok(scopes) = std::fs::read_dir(&store) else {
        return Ok(0);
    };
    let mut blobs: Vec<(SystemTime, String, String, u64)> = Vec::new();
    let mut total = 0u64;
    for scope in scopes.flatten() {
        let Some(scope_name) = scope.file_name().to_str().map(str::to_string) else {
            continue;
        };
        for hash in blob_hashes(&scope.path()) {
            let Ok(metadata) = std::fs::metadata(scope.path().join(&hash)) else {
                continue;
            };
            total = total.saturating_add(metadata.len());
            let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            blobs.push((modified, scope_name.clone(), hash, metadata.len()));
        }
    }
    if total <= cap {
        return Ok(0);
    }
    blobs.sort();
    let mut freed = 0u64;
    for (_, scope, hash, _) in blobs {
        if total <= cap {
            break;
        }
        if (scope.as_str(), hash.as_str()) == protect {
            continue;
        }
        let size = remove_blob(root, &scope, &hash);
        total = total.saturating_sub(size);
        freed = freed.saturating_add(size);
    }
    Ok(freed)
}

/// Deletes a project's attachments (the project was purged).
pub(crate) fn remove_project(project_id: &str) -> Result<(), String> {
    crate::paths::validate_project_id(project_id)?;
    let dir = scope_dir(&crate::paths::oleafly_root()?, project_id);
    match std::fs::remove_dir_all(dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "could not remove the project's attachments: {error}"
        )),
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(storage_failed)?
}

fn store_root() -> Result<PathBuf, String> {
    crate::paths::oleafly_root()
}

/// Stores one attached file: `encodeAttachmentUpload(meta, bytes)` from
/// `@oleafly/ai-core` as the raw request body.
#[tauri::command]
pub async fn attachment_put(request: tauri::ipc::Request<'_>) -> Result<AttachmentMeta, String> {
    let body = upload_bytes(request.body())?;
    blocking(move || {
        let (header, bytes) = decode_upload(&body)?;
        let scope = scope_name(header.project_id.as_deref())?;
        let root = store_root()?;
        let meta = store_bytes(
            &root,
            &scope,
            &header.name,
            &header.mime,
            bytes,
            MAX_ATTACHMENT_BYTES,
        )?;
        let _ = enforce_store_cap(&root, STORE_CAP_BYTES, (&scope, &meta.sha256));
        Ok(meta)
    })
    .await
}

#[tauri::command]
pub async fn attachment_put_text(
    project_id: Option<String>,
    sha256: String,
    text: String,
    pages: Option<u32>,
) -> Result<AttachmentMeta, String> {
    blocking(move || {
        let root = store_root()?;
        let scope = locate(&root, project_id.as_deref(), &sha256).ok_or_else(not_found)?;
        store_text(&root, &scope, &sha256, &text, pages)
    })
    .await
}

#[tauri::command]
pub async fn attachment_read(
    project_id: Option<String>,
    sha256: String,
) -> Result<tauri::ipc::Response, String> {
    let bytes = blocking(move || {
        let root = store_root()?;
        let scope = locate(&root, project_id.as_deref(), &sha256).ok_or_else(not_found)?;
        read_bytes(&root, &scope, &sha256)
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn attachment_meta(
    project_id: Option<String>,
    sha256: String,
) -> Result<Option<AttachmentMeta>, String> {
    blocking(move || {
        let root = store_root()?;
        match locate(&root, project_id.as_deref(), &sha256) {
            Some(scope) => read_meta(&root, &scope, &sha256),
            None => {
                valid_hash(&sha256)?;
                Ok(None)
            }
        }
    })
    .await
}

/// Removes a project's attachments that no chat references any more.
#[tauri::command]
pub async fn attachment_gc(project_id: String, keep: Vec<String>) -> Result<u64, String> {
    blocking(move || {
        let scope = scope_name(Some(&project_id))?;
        gc_scope(&store_root()?, &scope, &keep)
    })
    .await
}

#[cfg(test)]
mod tests;
