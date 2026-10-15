use crate::error::CollabError;
use crate::paths::{write_atomic, CollabPaths};
use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};
use oleafly_collab_protocol::roles::ProjectRole;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShareBinding {
    pub server_url: String,
    pub server_id: ServerId,
    pub shared_project_id: SharedProjectId,
    pub role: ProjectRole,
    pub created_at: i64,
}

pub fn load_binding(
    paths: &CollabPaths,
    local_id: &str,
) -> Result<Option<ShareBinding>, CollabError> {
    let path = paths.binding_file(local_id)?;
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(CollabError::Io(format!(
                "failed to read {}: {error}",
                path.display()
            )))
        }
    };
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| CollabError::Corrupt(format!("{}: {error}", path.display())))
}

pub fn save_binding(
    paths: &CollabPaths,
    local_id: &str,
    binding: &ShareBinding,
) -> Result<(), CollabError> {
    let path = paths.binding_file(local_id)?;
    let bytes = serde_json::to_vec_pretty(binding)
        .map_err(|error| CollabError::Corrupt(error.to_string()))?;
    write_atomic(&path, &bytes)
}

pub fn remove_binding(paths: &CollabPaths, local_id: &str) -> Result<(), CollabError> {
    let path = paths.binding_file(local_id)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(CollabError::Io(format!(
            "failed to remove {}: {error}",
            path.display()
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding() -> ShareBinding {
        ShareBinding {
            server_url: "https://uni.edu/oleafly".to_string(),
            server_id: "01920000-0000-7000-8000-000000000001".parse().unwrap(),
            shared_project_id: "01920000-0000-7000-8000-000000000005".parse().unwrap(),
            role: ProjectRole::Owner,
            created_at: 1_760_000_000_000,
        }
    }

    fn fixture() -> (tempfile::TempDir, CollabPaths) {
        let directory = tempfile::tempdir().unwrap();
        let paths = CollabPaths::new(directory.path().join("collab"));
        (directory, paths)
    }

    #[test]
    fn a_project_without_a_binding_loads_as_none_and_creates_nothing() {
        let (directory, paths) = fixture();
        assert_eq!(load_binding(&paths, "paper"), Ok(None));
        assert!(!directory.path().join("collab").exists());
    }

    #[test]
    fn a_saved_binding_loads_back_and_is_plain_json() {
        let (_directory, paths) = fixture();
        save_binding(&paths, "paper", &binding()).unwrap();
        assert_eq!(load_binding(&paths, "paper"), Ok(Some(binding())));
        let stored: serde_json::Value =
            serde_json::from_slice(&std::fs::read(paths.binding_file("paper").unwrap()).unwrap())
                .unwrap();
        assert_eq!(
            stored,
            serde_json::json!({
                "server_url": "https://uni.edu/oleafly",
                "server_id": "01920000-0000-7000-8000-000000000001",
                "shared_project_id": "01920000-0000-7000-8000-000000000005",
                "role": "owner",
                "created_at": 1_760_000_000_000_i64
            })
        );
    }

    #[test]
    fn saving_again_replaces_the_binding() {
        let (_directory, paths) = fixture();
        save_binding(&paths, "paper", &binding()).unwrap();
        let viewer = ShareBinding {
            role: ProjectRole::Viewer,
            ..binding()
        };
        save_binding(&paths, "paper", &viewer).unwrap();
        assert_eq!(load_binding(&paths, "paper"), Ok(Some(viewer)));
    }

    #[test]
    fn removing_a_binding_is_idempotent() {
        let (_directory, paths) = fixture();
        save_binding(&paths, "paper", &binding()).unwrap();
        assert_eq!(remove_binding(&paths, "paper"), Ok(()));
        assert_eq!(load_binding(&paths, "paper"), Ok(None));
        assert_eq!(remove_binding(&paths, "paper"), Ok(()));
    }

    #[test]
    fn a_damaged_binding_is_reported_as_corrupt() {
        let (_directory, paths) = fixture();
        let file = paths.binding_file("paper").unwrap();
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, b"{\"server_url\":").unwrap();
        assert!(matches!(
            load_binding(&paths, "paper"),
            Err(CollabError::Corrupt(_))
        ));
    }

    #[test]
    fn unsafe_project_ids_never_touch_the_disk() {
        let (directory, paths) = fixture();
        for id in ["..", "../escape", "a/b", ""] {
            assert!(matches!(
                load_binding(&paths, id),
                Err(CollabError::InvalidPath(_))
            ));
            assert!(matches!(
                save_binding(&paths, id, &binding()),
                Err(CollabError::InvalidPath(_))
            ));
            assert!(matches!(
                remove_binding(&paths, id),
                Err(CollabError::InvalidPath(_))
            ));
        }
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    }
}
