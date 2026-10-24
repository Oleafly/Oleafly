//! BibTeX library cleaning for the app: the cleaning lives in
//! `oleafly_doctools::bib_clean`; this module serves the command, picks
//! where backups go and publishes the project change.
use oleafly_doctools::bib_clean::{apply_plan_to, plan_project, BackupLocation, CleanOutcome};

/// The outcome the webview gets: the crate's, plus the project state.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCleanOutcome {
    #[serde(flatten)]
    pub outcome: CleanOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_state: Option<crate::project::ProjectStateChanged>,
}

fn backup_location(project_id: &str) -> Result<BackupLocation, String> {
    let location = crate::project_location::locate(project_id)?;
    Ok(match location.kind {
        crate::project_location::ProjectKind::Library => BackupLocation::InProject,
        crate::project_location::ProjectKind::Linked => {
            BackupLocation::External(crate::paths::state_subdirectory(&location, "backups")?)
        }
    })
}

/// Preview is read-only. Apply must carry the reviewed snapshot token and uses
/// the same project mutation barrier as saves, restores and task application.
#[tauri::command]
pub async fn clean_bibtex_library(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    bib_path: String,
    apply: bool,
    preview_token: Option<String>,
    expected_generation: Option<u64>,
) -> Result<AppCleanOutcome, String> {
    if !apply {
        return tauri::async_runtime::spawn_blocking(move || {
            let _lock = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
            let root = crate::paths::project_dir(&project_id)?;
            let plan = plan_project(&root, &bib_path).map_err(|error| error.message)?;
            Ok(AppCleanOutcome {
                outcome: plan.into_outcome(),
                project_state: None,
            })
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    let token = preview_token.ok_or("Preview the changes before applying them.")?;
    let backup_project_id = project_id.clone();
    let mutation = crate::project::mutate_project_worktree(
        &state,
        project_id.clone(),
        expected_generation,
        move |root| {
            let backups = backup_location(&backup_project_id)?;
            let plan = plan_project(root, &bib_path).map_err(|error| error.message)?;
            let changed = plan.changes_files();
            Ok((
                apply_plan_to(plan, &token, &backups).map_err(|error| error.message)?,
                changed,
            ))
        },
    )
    .await?;
    let event = crate::project::publish_project_state_changed(
        &app,
        &state,
        &project_id,
        mutation.project,
        "clean-reference-library",
        true,
        Some(mutation.generation),
    )?;
    let outcome = mutation.value?;
    Ok(AppCleanOutcome {
        outcome,
        project_state: Some(event),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linked_reference_backups_go_to_central_state() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let folder = folders.path().join("thesis");
        std::fs::create_dir(&folder).unwrap();
        let record = crate::linked_registry::register_folder_for_test(&folder);
        let project = crate::paths::create_project_dir("paper").unwrap();

        let linked = backup_location(&record.id).unwrap();
        let state = crate::paths::existing_linked_root()
            .unwrap()
            .unwrap()
            .join(&record.id);
        assert_eq!(linked, BackupLocation::External(state.join("backups")));
        assert!(state.join("backups").is_dir());
        assert_eq!(backup_location("paper").unwrap(), BackupLocation::InProject);
        assert!(!folder.join(".oleafly").exists());
        assert!(!project.join(".oleafly").exists());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}
