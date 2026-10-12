use crate::collab::guard::{SyncPauseHost, SyncPaused, SyncResumed};
use oleafly_collab::binding::{save_binding, ShareBinding};
use oleafly_collab::file_ids::FileIdMap;
use oleafly_collab::paths::CollabPaths;
use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};
use oleafly_collab_protocol::roles::ProjectRole;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};

pub(crate) struct TempLibrary {
    _data: tempfile::TempDir,
    _env: MutexGuard<'static, ()>,
}

impl TempLibrary {
    pub(crate) fn new() -> Self {
        let env = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        Self {
            _data: data,
            _env: env,
        }
    }

    pub(crate) fn project(&self, project_id: &str, files: &[(&str, &str)]) -> PathBuf {
        let root = crate::paths::create_project_dir(project_id).unwrap();
        for (relative, text) in files {
            let path = root.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, text).unwrap();
        }
        root
    }
}

impl Drop for TempLibrary {
    fn drop(&mut self) {
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}

pub(crate) struct SharedProject(String);

impl Drop for SharedProject {
    fn drop(&mut self) {
        crate::collab::registry::invalidate(&self.0);
    }
}

pub(crate) fn share(project_id: &str) -> SharedProject {
    let paths = CollabPaths::new(crate::paths::collab_root().unwrap());
    std::fs::create_dir_all(paths.project_dir(project_id).unwrap()).unwrap();
    let binding = ShareBinding {
        server_url: "https://collab.test".to_owned(),
        server_id: ServerId::new_v7(),
        shared_project_id: SharedProjectId::new_v7(),
        role: ProjectRole::Owner,
        created_at: 0,
    };
    save_binding(&paths, project_id, &binding).unwrap();
    crate::collab::registry::invalidate(project_id);
    SharedProject(project_id.to_owned())
}

#[derive(Default)]
pub(crate) struct RecordedPauses(Mutex<Vec<SyncPaused>>, Mutex<Vec<SyncResumed>>);

impl RecordedPauses {
    pub(crate) fn taken(&self) -> Vec<SyncPaused> {
        std::mem::take(&mut *self.0.lock().unwrap_or_else(PoisonError::into_inner))
    }

    pub(crate) fn resumed(&self) -> Vec<SyncResumed> {
        std::mem::take(&mut *self.1.lock().unwrap_or_else(PoisonError::into_inner))
    }
}

impl SyncPauseHost for RecordedPauses {
    fn sync_paused(&self, paused: &SyncPaused) {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(paused.clone());
    }

    fn sync_resumed(&self, resumed: &SyncResumed) {
        self.1
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(resumed.clone());
    }
}

pub(crate) fn track(project_id: &str, files: &[&str]) {
    let file = CollabPaths::new(crate::paths::collab_root().unwrap())
        .file_ids_file(project_id)
        .unwrap();
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    let mut map = FileIdMap::load(&file).unwrap();
    for relative in files {
        map.ensure(relative).unwrap();
    }
    map.save(&file).unwrap();
}
