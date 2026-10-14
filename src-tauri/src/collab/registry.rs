use oleafly_collab::{load_binding, CollabPaths};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex, MutexGuard, PoisonError};

static REGISTRY: LazyLock<ShareRegistry> = LazyLock::new(ShareRegistry::default);

pub fn is_shared(local_project_id: &str) -> bool {
    match crate::paths::collab_root() {
        Ok(root) => REGISTRY.is_shared_at(&CollabPaths::new(root), local_project_id),
        Err(_) => false,
    }
}

pub fn invalidate(local_project_id: &str) {
    REGISTRY.invalidate(local_project_id);
}

#[derive(Default)]
pub(crate) struct ShareRegistry {
    cache: Mutex<HashMap<(PathBuf, String), bool>>,
}

impl ShareRegistry {
    pub(crate) fn is_shared_at(&self, paths: &CollabPaths, local_project_id: &str) -> bool {
        let key = (paths.root().to_path_buf(), local_project_id.to_string());
        if let Some(known) = self.cache().get(&key) {
            return *known;
        }
        match load_binding(paths, local_project_id) {
            Ok(binding) => {
                let shared = binding.is_some();
                self.cache().insert(key, shared);
                shared
            }
            Err(_) => false,
        }
    }

    pub(crate) fn invalidate(&self, local_project_id: &str) {
        self.cache()
            .retain(|(_, cached), _| cached.as_str() != local_project_id);
    }

    fn cache(&self) -> MutexGuard<'_, HashMap<(PathBuf, String), bool>> {
        self.cache.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_collab::{remove_binding, save_binding, ShareBinding};
    use oleafly_collab_protocol::roles::ProjectRole;

    fn binding() -> ShareBinding {
        ShareBinding {
            server_url: "https://collab.test".to_string(),
            server_id: "01920000-0000-7000-8000-000000000001".parse().unwrap(),
            shared_project_id: "01920000-0000-7000-8000-000000000005".parse().unwrap(),
            role: ProjectRole::Editor,
            created_at: 1,
        }
    }

    fn fixture() -> (tempfile::TempDir, CollabPaths, ShareRegistry) {
        let directory = tempfile::tempdir().unwrap();
        let paths = CollabPaths::new(directory.path().join("collab"));
        (directory, paths, ShareRegistry::default())
    }

    #[test]
    fn a_project_is_shared_exactly_when_it_has_a_binding() {
        let (directory, paths, registry) = fixture();
        assert!(!registry.is_shared_at(&paths, "paper"));
        assert!(!directory.path().join("collab").exists());
        save_binding(&paths, "shared-paper", &binding()).unwrap();
        assert!(registry.is_shared_at(&paths, "shared-paper"));
        assert!(!registry.is_shared_at(&paths, "paper"));
    }

    #[test]
    fn answers_are_cached_until_invalidated() {
        let (_directory, paths, registry) = fixture();
        assert!(!registry.is_shared_at(&paths, "paper"));
        save_binding(&paths, "paper", &binding()).unwrap();
        assert!(!registry.is_shared_at(&paths, "paper"));
        registry.invalidate("paper");
        assert!(registry.is_shared_at(&paths, "paper"));
        remove_binding(&paths, "paper").unwrap();
        assert!(registry.is_shared_at(&paths, "paper"));
        registry.invalidate("paper");
        assert!(!registry.is_shared_at(&paths, "paper"));
    }

    #[test]
    fn invalidating_one_project_keeps_the_others_cached() {
        let (_directory, paths, registry) = fixture();
        assert!(!registry.is_shared_at(&paths, "a"));
        assert!(!registry.is_shared_at(&paths, "b"));
        save_binding(&paths, "a", &binding()).unwrap();
        save_binding(&paths, "b", &binding()).unwrap();
        registry.invalidate("a");
        assert!(registry.is_shared_at(&paths, "a"));
        assert!(!registry.is_shared_at(&paths, "b"));
    }

    #[test]
    fn each_collaboration_root_has_its_own_answers() {
        let (_first, shared_root, registry) = fixture();
        let (_second, other_root, _) = fixture();
        save_binding(&shared_root, "paper", &binding()).unwrap();
        assert!(registry.is_shared_at(&shared_root, "paper"));
        assert!(!registry.is_shared_at(&other_root, "paper"));
        save_binding(&other_root, "paper", &binding()).unwrap();
        registry.invalidate("paper");
        assert!(registry.is_shared_at(&other_root, "paper"));
    }

    #[test]
    fn unreadable_bindings_and_illegal_ids_read_as_not_shared_and_are_not_cached() {
        let (_directory, paths, registry) = fixture();
        let file = paths.binding_file("paper").unwrap();
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, b"{").unwrap();
        assert!(!registry.is_shared_at(&paths, "paper"));
        save_binding(&paths, "paper", &binding()).unwrap();
        assert!(registry.is_shared_at(&paths, "paper"));
        assert!(!registry.is_shared_at(&paths, "../paper"));
        assert!(!registry.is_shared_at(&paths, ""));
    }

    #[test]
    fn asking_through_the_data_root_leaves_it_unchanged() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let root = crate::paths::collab_root();
        let shared = is_shared("registry-untouched-paper");
        let illegal = is_shared("../registry-untouched-paper");
        invalidate("registry-untouched-paper");
        let entries = std::fs::read_dir(directory.path()).unwrap().count();
        std::env::remove_var("OLEAFLY_DATA_DIR");
        assert_eq!(root, Ok(directory.path().join("collab")));
        assert!(!shared);
        assert!(!illegal);
        assert_eq!(entries, 0);
    }
}
