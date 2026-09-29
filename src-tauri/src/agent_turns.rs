//! Before-turn copies of a project so the changes an agent or the assistant
//! made in one turn can be reviewed and undone file by file.
//!
//! Contract stub: the types and command signatures are final, the bodies
//! arrive with the implementation.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnUnavailable {
    TooLarge,
    TooManyFiles,
    Timeout,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnSkipReason {
    TooLarge,
    Symlink,
    Unreadable,
    CloudPlaceholder,
    StoreFull,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSkipped {
    pub path: String,
    pub reason: TurnSkipReason,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnChangeKind {
    Added,
    Modified,
    Deleted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnChange {
    pub index: u32,
    pub path: String,
    pub change: TurnChangeKind,
    pub before_size: Option<u64>,
    pub after_size: Option<u64>,
    /// Lines added, when both sides are UTF-8 text of at most 2 MiB.
    pub added: Option<u32>,
    /// Lines removed, when both sides are UTF-8 text of at most 2 MiB.
    pub removed: Option<u32>,
    /// Oleafly's own write path also saved this file during the turn.
    pub also_edited_here: bool,
    /// A build output file (see `build_hygiene::is_build_artifact`).
    pub build: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnChanges {
    pub snapshot_id: Option<String>,
    pub files: Vec<TurnChange>,
    pub more_files: u32,
    pub skipped: Vec<TurnSkipped>,
    /// Another turn in the same project was open during this one.
    pub overlapped: bool,
    pub unavailable: Option<TurnUnavailable>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnBegin {
    pub snapshot_id: Option<String>,
    pub unavailable: Option<TurnUnavailable>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnFileState {
    Applied,
    Undone,
    Edited,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnFileStatus {
    pub index: u32,
    pub state: TurnFileState,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStatus {
    pub expired: bool,
    pub files: Vec<TurnFileStatus>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnFilePreview {
    pub index: u32,
    pub path: String,
    pub change: TurnChangeKind,
    pub before: Option<String>,
    pub after: Option<String>,
    pub binary: bool,
    pub too_large: bool,
    pub state: TurnFileState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnRevertSkipReason {
    Edited,
    Expired,
    WriteFailed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnRevertSkipped {
    pub index: u32,
    pub reason: TurnRevertSkipReason,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnRevertResult {
    pub reverted: Vec<u32>,
    pub skipped: Vec<TurnRevertSkipped>,
    pub project_state: crate::project::ProjectStateChanged,
}

const NOT_IMPLEMENTED: &str = "Not implemented.";

/// Takes the before-turn copy. Never fails the caller's turn: problems come
/// back as `unavailable`.
pub(crate) fn begin(_project_id: &str, _label: &str) -> TurnBegin {
    TurnBegin {
        snapshot_id: None,
        unavailable: Some(TurnUnavailable::Error),
    }
}

/// Compares the project with the before-turn copy.
pub(crate) fn finish(
    _project_id: &str,
    _snapshot_id: &str,
    _tool_paths: Option<&[String]>,
) -> TurnChanges {
    TurnChanges {
        unavailable: Some(TurnUnavailable::Error),
        ..TurnChanges::default()
    }
}

/// Records that Oleafly's own write path saved `relative_path` so open turns
/// can flag it as also edited by the user.
pub(crate) fn note_app_write(_project_id: &str, _relative_path: &str) {}

/// Deletes every before-turn copy kept for a project.
pub(crate) fn remove_project(_project_id: &str) {}

#[tauri::command]
pub async fn agent_turn_begin(project_id: String, label: String) -> Result<TurnBegin, String> {
    Ok(begin(&project_id, &label))
}

#[tauri::command]
pub async fn agent_turn_finish(
    project_id: String,
    snapshot_id: String,
    tool_paths: Option<Vec<String>>,
) -> Result<TurnChanges, String> {
    Ok(finish(&project_id, &snapshot_id, tool_paths.as_deref()))
}

#[tauri::command]
pub async fn agent_turn_status(
    project_id: String,
    snapshot_id: String,
) -> Result<TurnStatus, String> {
    let _ = (project_id, snapshot_id);
    Err(NOT_IMPLEMENTED.into())
}

#[tauri::command]
pub async fn agent_turn_preview(
    project_id: String,
    snapshot_id: String,
    index: u32,
) -> Result<TurnFilePreview, String> {
    let _ = (project_id, snapshot_id, index);
    Err(NOT_IMPLEMENTED.into())
}

#[tauri::command]
pub async fn agent_turn_revert(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    snapshot_id: String,
    indices: Option<Vec<u32>>,
    expected_generation: u64,
) -> Result<TurnRevertResult, String> {
    let _ = (
        app,
        state,
        project_id,
        snapshot_id,
        indices,
        expected_generation,
    );
    Err(NOT_IMPLEMENTED.into())
}

#[tauri::command]
pub async fn agent_turn_redo(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    snapshot_id: String,
    indices: Option<Vec<u32>>,
    expected_generation: u64,
) -> Result<TurnRevertResult, String> {
    let _ = (
        app,
        state,
        project_id,
        snapshot_id,
        indices,
        expected_generation,
    );
    Err(NOT_IMPLEMENTED.into())
}
