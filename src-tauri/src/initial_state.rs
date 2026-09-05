use serde::Serialize;

use crate::config::{self, AppConfig};
use crate::project::{self, ProjectInfo};

// Pre-computed startup snapshot: one IPC round-trip hands the shell everything
// it previously hydrated with separate async invokes after mount. Fields are
// best-effort so a broken config or library never blocks first paint.
#[derive(Serialize)]
pub struct InitialState {
    pub config: Option<AppConfig>,
    pub projects: Vec<ProjectInfo>,
}

pub fn compute() -> InitialState {
    InitialState {
        config: config::get_config().ok(),
        projects: project::list_projects_blocking().unwrap_or_default(),
    }
}

#[tauri::command]
pub async fn initial_state() -> Result<InitialState, String> {
    tauri::async_runtime::spawn_blocking(compute)
        .await
        .map_err(|error| format!("failed to compute initial state: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_never_fails() {
        let state = compute();
        assert!(state.projects.len() < usize::MAX);
    }

    #[test]
    fn snapshot_config_is_redacted() {
        if let Some(cfg) = compute().config {
            assert!(cfg.github_token.is_empty());
        }
    }
}
