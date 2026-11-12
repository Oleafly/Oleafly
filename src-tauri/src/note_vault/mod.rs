use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::Instant;

use oleafly_core::encoding::{decode_text, percent_decode};
use oleafly_core::front_matter::{key_of, scalar_value, value_of};
use oleafly_core::markdown_scan::{
    has_scheme, link_tail, matching_brackets, run_at, CodeSpans, FenceLine, Fences,
};
use oleafly_core::portable::fold;
use serde::{Deserialize, Serialize};

use crate::app_error::AppError;
use crate::note_links::{is_linkable_id, parse_note_link, scan_note, LinkKind};
use crate::project::{NOTE_ASSETS, NOTE_KIND};

mod commands;
mod export;
mod front_matter_write;
mod history;
mod import;
mod markdown;
#[cfg(test)]
mod tests;

use commands::*;
use export::*;
use front_matter_write::*;
use history::*;
use import::*;
use markdown::*;

const MAX_NOTE_BYTES: u64 = crate::note_index::MAX_NOTE_BYTES;
const MAX_ATTACHMENT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_IMPORT_ATTACHMENT_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const KEEP_FREE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_ORIGIN_BYTES: u64 = 64 * 1024;
const MAX_ENTRIES: usize = 200_000;
const MAX_DEPTH: usize = 64;
const FILE_IMPORT_DEPTH: usize = 1;
const MAX_TITLE_CHARS: usize = 200;
const MAX_STEM_BYTES: usize = 200;
const MAX_NAME_ATTEMPTS: usize = 999;
const MAX_RUN_ID_CHARS: usize = 64;
const MAX_PENDING: usize = 16;
const HISTORY_FILE: &str = "note-imports.json";
const HISTORY_LIMIT: usize = 200;
const NOTE_SCHEME: &str = "oleafly://note/";
const NOTEBOOK_INFO: &str = "notebook";
const ATTACHMENTS: &str = "attachments";
const UNTITLED: &str = "Untitled";
const IMAGE_EXTENSIONS: &[&str] = &[
    "apng", "avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp",
];
const MAX_LISTED: usize = 100;
const CONFIRM_NOTES: usize = 1_000;
const PROGRESS_EVERY: std::time::Duration = std::time::Duration::from_millis(100);
const JOURNAL_DIR: &str = "note-import-runs";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportPhase {
    Read,
    Write,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub phase: ImportPhase,
    pub done: usize,
    pub total: usize,
    pub file: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub notes: usize,
    pub attachments: usize,
    pub unresolved: usize,
    pub skipped: usize,
    pub cancelled: bool,
    pub not_copied: Vec<String>,
    pub skipped_notes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ImportOutcome {
    Dismissed,
    Seen { imported_at: i64, notes: usize },
    Large { notes: usize },
    Done(ImportSummary),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub folder: String,
    pub notes: usize,
    pub attachments: usize,
    pub skipped: usize,
    pub paper_links: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesImportRequest {
    pub run_id: String,
    #[serde(default)]
    pub folder_tags: bool,
    #[serde(default)]
    pub again: bool,
    #[serde(default)]
    pub files: bool,
    #[serde(default)]
    pub confirm_large: bool,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesExportRequest {
    #[serde(default)]
    pub note_id: Option<String>,
    pub folder_name: String,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct ImportOptions {
    pub folder_tags: bool,
    pub confirm_above: Option<usize>,
}

#[derive(Debug, Default)]
pub(crate) struct ImportReport {
    pub summary: ImportSummary,
    pub created: Vec<String>,
    pub error: Option<String>,
    pub confirm: Option<usize>,
}

fn add_listed(list: &mut Vec<String>, item: String) {
    if list.len() < MAX_LISTED && !list.contains(&item) {
        list.push(item);
    }
}

fn new_note_id() -> String {
    oleafly_core::ids::random_uuid()
}

fn normalize_text(text: &str) -> String {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn extension_of(name: &str) -> Option<String> {
    match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() && !extension.is_empty() => {
            Some(extension.to_ascii_lowercase())
        }
        _ => None,
    }
}

fn is_markdown(name: &str) -> bool {
    extension_of(name).as_deref() == Some("md")
}

fn is_image(name: &str) -> bool {
    extension_of(name).is_some_and(|extension| IMAGE_EXTENSIONS.contains(&extension.as_str()))
}

fn is_notebook(name: &str) -> bool {
    extension_of(name).as_deref() == Some("ipynb")
}

fn base_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn file_stem(name: &str) -> &str {
    match name.rsplit_once('.') {
        Some((stem, _)) if !stem.is_empty() => stem,
        _ => name,
    }
}

fn truncate_chars(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

fn relative_destination(destination: &str) -> bool {
    !destination.is_empty()
        && !destination.starts_with('#')
        && !destination.starts_with('/')
        && !destination.starts_with('\\')
        && !has_scheme(destination)
}

fn normalize_path(path: &str) -> Option<String> {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            part => parts.push(part),
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

#[tauri::command]
pub async fn notes_import_folder(
    webview: tauri::Webview,
    request: NotesImportRequest,
    on_progress: tauri::ipc::Channel<ImportProgress>,
) -> Result<ImportOutcome, String> {
    if !valid_run_id(&request.run_id) {
        return Err(AppError::new("notes.import_invalid_run").into());
    }
    if request.files {
        return import_picked_files(&webview, request, on_progress).await;
    }
    let held = take_pending(&request.run_id).filter(|_| request.again);
    let picked = match held {
        Some(root) => Some(root),
        None => pick_folder(&webview, dialog_title(request.title)).await?,
    };
    let Some(picked) = picked else {
        return Ok(ImportOutcome::Dismissed);
    };
    let again = request.again;
    let (root, previous) = off_thread(move || {
        let root = chosen_folder(&picked, FolderUse::Import)?;
        let previous = if again { None } else { previous_import(&root) };
        Ok((root, previous))
    })
    .await?;
    if let Some(previous) = previous {
        hold_pending(&request.run_id, root);
        return Ok(ImportOutcome::Seen {
            imported_at: previous.imported_at,
            notes: previous.notes,
        });
    }
    let options = ImportOptions {
        folder_tags: request.folder_tags,
        confirm_above: request.confirm_large.then_some(CONFIRM_NOTES),
    };
    let task_root = root.clone();
    let mut progress = channel_progress(on_progress);
    let outcome = run_import(
        &request.run_id,
        Some(root.clone()),
        move |cancel, journal| {
            import_vault_with(
                &task_root,
                options,
                cancel,
                &mut progress,
                &disk_room,
                journal,
            )
        },
    )
    .await?;
    if matches!(outcome, ImportOutcome::Large { .. }) {
        hold_pending(&request.run_id, root);
    }
    Ok(outcome)
}

#[tauri::command]
pub fn notes_import_cancel(run_id: String) -> bool {
    let held = take_pending(&run_id).is_some();
    let stopped = running()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(&run_id)
        .map(|cancel| cancel.store(true, Ordering::SeqCst))
        .is_some();
    held || stopped
}

#[tauri::command]
pub async fn notes_export_folder(
    webview: tauri::Webview,
    state: tauri::State<'_, crate::state::AppState>,
    request: NotesExportRequest,
) -> Result<Option<ExportSummary>, String> {
    if let Some(note_id) = &request.note_id {
        crate::paths::validate_project_id(note_id)?;
    }
    let Some(parent) = pick_folder(&webview, dialog_title(request.title)).await? else {
        return Ok(None);
    };
    let NotesExportRequest {
        note_id,
        folder_name,
        ..
    } = request;
    let summary = tauri::async_runtime::spawn_blocking(move || {
        let (selected, outside) = collect_export(note_id.as_deref())?;
        let folder = create_export_folder(&parent, &folder_name)?;
        let exported = export_notes(&selected, &outside, &folder);
        if exported.is_err() {
            let _ = std::fs::remove_dir(&folder);
        }
        exported
    })
    .await
    .map_err(|error| String::from(AppError::new("notes.export_stopped").detail(error)))??;
    crate::commands::allow_reveal_export(&summary.folder, &state).await;
    Ok(Some(summary))
}
