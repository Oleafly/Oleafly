use serde::Serialize;

use crate::config::{self, AppConfig};
use crate::open_request::{OpenIntake, PendingOpen};
use crate::project::{self, ProjectInfo};

// Pre-computed startup snapshot: one IPC round-trip hands the shell everything
// it previously hydrated with separate async invokes after mount. Fields are
// best-effort so a broken config or library never blocks first paint.
#[derive(Serialize)]
pub struct InitialState {
    pub config: Option<AppConfig>,
    pub projects: Vec<ProjectInfo>,
    pub(crate) pending_open: Vec<PendingOpen>,
}

pub(crate) fn compute(pending_open: Vec<PendingOpen>) -> InitialState {
    InitialState {
        config: config::get_config_blocking().ok(),
        projects: project::list_projects_blocking().unwrap_or_default(),
        pending_open,
    }
}

#[tauri::command]
pub async fn initial_state(intake: tauri::State<'_, OpenIntake>) -> Result<InitialState, String> {
    let pending_open = intake.pending();
    tauri::async_runtime::spawn_blocking(move || compute(pending_open))
        .await
        .map_err(|error| format!("failed to compute initial state: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn isolated_snapshot() -> InitialState {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        let previous = std::env::var_os("OLEAFLY_DATA_DIR");
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let state = compute(Vec::new());
        match previous {
            Some(previous) => std::env::set_var("OLEAFLY_DATA_DIR", previous),
            None => std::env::remove_var("OLEAFLY_DATA_DIR"),
        }
        state
    }

    #[test]
    fn snapshot_never_fails() {
        let state = isolated_snapshot();
        assert!(state.projects.is_empty());
    }

    #[test]
    fn snapshot_carries_the_folders_waiting_to_open() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        let previous = std::env::var_os("OLEAFLY_DATA_DIR");
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let intake = crate::open_request::OpenIntake::default();
        let waiting = intake.enqueue(
            vec![crate::open_request::LaunchTarget::Folder(
                "/srv/thesis".into(),
            )],
            crate::open_request::OpenSource::Launch,
        );
        let state = compute(intake.pending());
        match previous {
            Some(previous) => std::env::set_var("OLEAFLY_DATA_DIR", previous),
            None => std::env::remove_var("OLEAFLY_DATA_DIR"),
        }
        assert_eq!(state.pending_open, waiting);
        let json = serde_json::to_value(&state).unwrap();
        assert_eq!(json["pending_open"][0]["display_name"], "thesis");
        assert_eq!(json["pending_open"][0]["source"], "launch");
    }

    #[test]
    fn snapshot_config_is_redacted() {
        if let Some(cfg) = isolated_snapshot().config {
            assert!(cfg.github_token.is_empty());
        }
    }
}
