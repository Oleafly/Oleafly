use std::collections::BTreeMap;
use std::sync::{Arc, LazyLock, Mutex};

use oleafly_collab::live::save_shared;

use super::{guard, Active};
use crate::collab::settings::{base_file_in, follow_project};

static QUEUED: LazyLock<Mutex<BTreeMap<String, bool>>> = LazyLock::new(Mutex::default);

impl Active {
    pub(crate) fn follow_settings(&self) {
        let followed = follow_project(
            &self.project_id,
            &self.live,
            &self.root,
            &base_file_in(&self.hold_dir()),
            Some(self.account_id),
        );
        match followed {
            Ok(applied) => {
                if applied.pushed {
                    let _ = save_shared(&self.live, &self.document_dir);
                    self.handle.flush();
                    self.refresh_pending();
                }
                if applied.meta.is_some() || !applied.notices.is_empty() {
                    self.host.settings_changed(applied);
                }
            }
            Err(error) => {
                let _ = crate::project::append_app_log(format!(
                    "Live collaboration could not follow the shared compile settings of {}: {error}",
                    self.project_id
                ));
            }
        }
    }
}

async fn follow_between_compiles(active: Arc<Active>) {
    use tauri::Manager;
    let app = active.host.app();
    let state = app
        .as_ref()
        .and_then(|app| app.try_state::<crate::state::AppState>());
    let _compiles = match &state {
        Some(state) => Some(state.compile_lock.lock().await),
        None => None,
    };
    let _ = tauri::async_runtime::spawn_blocking(move || active.follow_settings()).await;
}

pub(super) fn schedule(active: &Arc<Active>) {
    {
        let mut queued = guard(&QUEUED);
        if let Some(again) = queued.get_mut(&active.project_id) {
            *again = true;
            return;
        }
        queued.insert(active.project_id.clone(), false);
    }
    let project_id = active.project_id.clone();
    let weak = Arc::downgrade(active);
    tauri::async_runtime::spawn(async move {
        loop {
            let Some(active) = weak.upgrade() else {
                guard(&QUEUED).remove(&project_id);
                return;
            };
            follow_between_compiles(active).await;
            let mut queued = guard(&QUEUED);
            if queued.get(&project_id) == Some(&true) {
                queued.insert(project_id.clone(), false);
                continue;
            }
            queued.remove(&project_id);
            return;
        }
    });
}
