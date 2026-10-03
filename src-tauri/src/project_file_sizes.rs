use std::collections::BTreeMap;
use std::path::Path;

pub(crate) const MAX_PROJECT_FILE_SIZE_PATHS: usize = 256;

pub(crate) fn file_sizes_within(
    root: &Path,
    paths: &[String],
) -> Result<BTreeMap<String, u64>, String> {
    if paths.len() > MAX_PROJECT_FILE_SIZE_PATHS {
        return Err(format!(
            "too many paths: at most {MAX_PROJECT_FILE_SIZE_PATHS} file sizes per request"
        ));
    }
    Ok(paths
        .iter()
        .filter_map(|rel| regular_file_size(root, rel).map(|size| (rel.clone(), size)))
        .collect())
}

fn regular_file_size(root: &Path, rel: &str) -> Option<u64> {
    let target = crate::sandbox::resolve_within(root, rel).ok()?;
    let metadata = std::fs::symlink_metadata(target).ok()?;
    if metadata.file_type().is_symlink()
        || crate::paths::is_reparse_point(&metadata)
        || !metadata.is_file()
    {
        return None;
    }
    Some(metadata.len())
}

#[tauri::command]
pub async fn project_file_sizes(
    project_id: String,
    paths: Vec<String>,
) -> Result<BTreeMap<String, u64>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
        let root = crate::paths::project_dir(&project_id)?;
        file_sizes_within(&root, &paths)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn reports_sizes_of_regular_project_files_only() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("figures")).unwrap();
        std::fs::write(root.join("figures/plot.png"), vec![0u8; 1234]).unwrap();
        std::fs::write(root.join("cover.jpg"), b"abc").unwrap();

        let sizes = file_sizes_within(
            root,
            &paths(&[
                "figures/plot.png",
                "cover.jpg",
                "missing.png",
                "figures",
                "",
            ]),
        )
        .unwrap();

        assert_eq!(
            sizes,
            BTreeMap::from([
                ("cover.jpg".to_string(), 3),
                ("figures/plot.png".to_string(), 1234),
            ])
        );
    }

    #[test]
    fn skips_paths_that_leave_the_project() {
        let outer = tempfile::tempdir().unwrap();
        let root = outer.path().join("project");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(outer.path().join("secret.png"), b"secret").unwrap();
        let absolute = outer
            .path()
            .join("secret.png")
            .to_string_lossy()
            .into_owned();

        let sizes = file_sizes_within(
            &root,
            &[
                "../secret.png".to_string(),
                absolute,
                "..\\secret.png".to_string(),
            ],
        )
        .unwrap();

        assert!(sizes.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn never_follows_symlinks() {
        let outer = tempfile::tempdir().unwrap();
        let root = outer.path().join("project");
        std::fs::create_dir_all(root.join("figures")).unwrap();
        std::fs::write(outer.path().join("secret.png"), b"secret").unwrap();
        std::fs::write(root.join("figures/real.png"), b"real").unwrap();
        std::os::unix::fs::symlink(outer.path().join("secret.png"), root.join("escape.png"))
            .unwrap();
        std::os::unix::fs::symlink(outer.path(), root.join("outside")).unwrap();
        std::os::unix::fs::symlink(root.join("figures/real.png"), root.join("alias.png")).unwrap();

        let sizes = file_sizes_within(
            &root,
            &paths(&[
                "escape.png",
                "outside/secret.png",
                "alias.png",
                "figures/real.png",
            ]),
        )
        .unwrap();

        assert_eq!(sizes, BTreeMap::from([("figures/real.png".to_string(), 4)]));
    }

    #[test]
    fn refuses_an_unbounded_request() {
        let dir = tempfile::tempdir().unwrap();
        let many: Vec<String> = (0..=MAX_PROJECT_FILE_SIZE_PATHS)
            .map(|index| format!("figure-{index}.png"))
            .collect();

        assert!(file_sizes_within(dir.path(), &many).is_err());
        assert!(file_sizes_within(dir.path(), &many[..MAX_PROJECT_FILE_SIZE_PATHS]).is_ok());
    }
}
