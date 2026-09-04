use std::path::{Path, PathBuf};

/// Compile entry wrapper (neutralizes pdfLaTeX-only commands under XeTeX).
pub const ENTRY_TEX: &str = "_oleafly_entry.tex";
pub const ENTRY_STEM: &str = "_oleafly_entry";

/// The user's home directory.
pub fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "could not determine user home directory".to_string())
}

/// The Oleafly library root: `~/.oleafly/`, or `$OLEAFLY_DATA_DIR` when
/// set and non-empty (e2e tests point this at a throwaway directory so runs
/// are hermetic and never touch the user's real projects).
pub fn oleafly_root() -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("OLEAFLY_DATA_DIR") {
        if !dir.is_empty() {
            return Ok(PathBuf::from(dir));
        }
    }
    Ok(home_dir()?.join(".oleafly"))
}

/// The downloadable-assets cache: `~/.oleafly/assets/` (created if missing).
/// Holds on-demand font packs (and future package/engine caches) so the shipped
/// installer stays small.
pub fn assets_root() -> Result<PathBuf, String> {
    let root = oleafly_root()?.join("assets");
    if !root.exists() {
        std::fs::create_dir_all(&root)
            .map_err(|e| format!("failed to create assets root {root:?}: {e}"))?;
    }
    Ok(root)
}

/// `~/.oleafly/templates/` — downloaded template packs and user-made templates.
pub fn templates_data_root() -> Result<PathBuf, String> {
    let dir = oleafly_root()?.join("templates");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create templates root {dir:?}: {e}"))?;
    Ok(dir)
}

pub fn figures_cache_root() -> Result<PathBuf, String> {
    let dir = oleafly_root()?.join("figures");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create figures cache root {dir:?}: {e}"))?;
    Ok(dir)
}

pub fn catalogs_root() -> Result<PathBuf, String> {
    Ok(oleafly_root()?.join("catalogs"))
}

/// The projects directory: `~/.oleafly/projects/` (created if missing).
pub fn projects_root() -> Result<PathBuf, String> {
    let root = oleafly_root()?.join("projects");
    if !root.exists() {
        std::fs::create_dir_all(&root)
            .map_err(|e| format!("failed to create projects root {root:?}: {e}"))?;
    }
    Ok(root)
}

/// Recoverable project deletions live beside the active projects directory so
/// moving a project into or out of the recycle bin stays on the same volume.
pub fn recycle_bin_root() -> Result<PathBuf, String> {
    let data = oleafly_root()?;
    ensure_data_directory(&data)?;
    let data = data
        .canonicalize()
        .map_err(|e| format!("failed to resolve Oleafly data directory: {e}"))?;
    let recycle_bin = data.join("recycle-bin");
    ensure_real_directory(&recycle_bin, "recycle bin")?;
    let recycle_bin = recycle_bin
        .canonicalize()
        .map_err(|e| format!("failed to resolve recycle bin directory: {e}"))?;
    if recycle_bin.parent() != Some(data.as_path()) {
        return Err("recycle bin directory escapes the Oleafly data root".into());
    }
    Ok(recycle_bin)
}

/// A stable lock file for one project worktree. The lock lives outside the
/// project so a transactional restore can replace every portable project file
/// without replacing the inode that coordinates readers and writers.
pub fn project_worktree_lock_file(project_id: &str) -> Result<PathBuf, String> {
    validate_project_id(project_id)?;
    let data = oleafly_root()?;
    ensure_data_directory(&data)?;
    let data = data
        .canonicalize()
        .map_err(|e| format!("failed to resolve Oleafly data directory: {e}"))?;
    let locks = data.join("project-worktree-locks");
    ensure_real_directory(&locks, "project worktree locks")?;
    let locks = locks
        .canonicalize()
        .map_err(|e| format!("failed to resolve project worktree locks directory: {e}"))?;
    if locks.parent() != Some(data.as_path()) {
        return Err("project worktree locks directory escapes the Oleafly data root".into());
    }
    Ok(locks.join(format!("{project_id}.lock")))
}

/// Resolves the external Checkpoints store path for one project without
/// creating the final directory. Store::open owns creation under its
/// cross-process namespace lock.
pub fn checkpoint_store_dir(project_id: &str) -> Result<PathBuf, String> {
    validate_project_id(project_id)?;
    let data = oleafly_root()?;
    ensure_data_directory(&data)?;
    let data = data
        .canonicalize()
        .map_err(|e| format!("failed to resolve Oleafly data directory: {e}"))?;
    let checkpoints = data.join("checkpoints");
    ensure_real_directory(&checkpoints, "Checkpoints")?;
    let checkpoints = checkpoints
        .canonicalize()
        .map_err(|e| format!("failed to resolve Checkpoints directory: {e}"))?;
    if checkpoints.parent() != Some(data.as_path()) {
        return Err("Checkpoints directory escapes the Oleafly data root".into());
    }

    let store = checkpoints.join(project_id);
    match std::fs::symlink_metadata(&store) {
        Ok(metadata)
            if metadata.is_dir()
                && !metadata.file_type().is_symlink()
                && !is_reparse_point(&metadata) =>
        {
            let resolved = store
                .canonicalize()
                .map_err(|e| format!("failed to resolve project Checkpoints directory: {e}"))?;
            if resolved.parent() != Some(checkpoints.as_path()) {
                return Err("project Checkpoints directory escapes the Checkpoints root".into());
            }
            Ok(resolved)
        }
        Ok(_) => Err("project Checkpoints path is not a real directory".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(store),
        Err(error) => Err(format!(
            "failed to inspect project Checkpoints directory: {error}"
        )),
    }
}

/// Resolves an existing external Checkpoints store without creating any app
/// data path. Listing a project with no history must remain side-effect free.
pub fn existing_checkpoint_store_dir(project_id: &str) -> Result<Option<PathBuf>, String> {
    validate_project_id(project_id)?;
    let data = oleafly_root()?;
    let data_metadata = match std::fs::symlink_metadata(&data) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!("failed to inspect Oleafly data directory: {error}"));
        }
    };
    if !data_metadata.is_dir()
        || data_metadata.file_type().is_symlink()
        || is_reparse_point(&data_metadata)
    {
        return Err("Oleafly data path is not a real directory".into());
    }
    let data = data
        .canonicalize()
        .map_err(|e| format!("failed to resolve Oleafly data directory: {e}"))?;

    let checkpoints = data.join("checkpoints");
    let checkpoints_metadata = match std::fs::symlink_metadata(&checkpoints) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("failed to inspect Checkpoints directory: {error}")),
    };
    if !checkpoints_metadata.is_dir()
        || checkpoints_metadata.file_type().is_symlink()
        || is_reparse_point(&checkpoints_metadata)
    {
        return Err("Checkpoints path is not a real directory".into());
    }
    let checkpoints = checkpoints
        .canonicalize()
        .map_err(|e| format!("failed to resolve Checkpoints directory: {e}"))?;
    if checkpoints.parent() != Some(data.as_path()) {
        return Err("Checkpoints directory escapes the Oleafly data root".into());
    }

    let store = checkpoints.join(project_id);
    let store_metadata = match std::fs::symlink_metadata(&store) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "failed to inspect project Checkpoints directory: {error}"
            ));
        }
    };
    if !store_metadata.is_dir()
        || store_metadata.file_type().is_symlink()
        || is_reparse_point(&store_metadata)
    {
        return Err("project Checkpoints path is not a real directory".into());
    }
    let store = store
        .canonicalize()
        .map_err(|e| format!("failed to resolve project Checkpoints directory: {e}"))?;
    if store.parent() != Some(checkpoints.as_path()) {
        return Err("project Checkpoints directory escapes the Checkpoints root".into());
    }
    Ok(Some(store))
}

pub fn device_trust_root() -> Result<PathBuf, String> {
    let data = oleafly_root()?;
    ensure_data_directory(&data)?;
    let data = data
        .canonicalize()
        .map_err(|e| format!("failed to resolve Oleafly data directory: {e}"))?;
    let trust = data.join("device-trust");
    ensure_real_directory(&trust, "device trust")?;
    let trust = trust
        .canonicalize()
        .map_err(|e| format!("failed to resolve device trust directory: {e}"))?;
    if trust.parent() != Some(data.as_path()) {
        return Err("device trust directory escapes the Oleafly data root".into());
    }
    Ok(trust)
}

fn ensure_data_directory(data: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(data) {
        Ok(_) => ensure_real_directory(data, "Oleafly data")?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir_all(data)
                .map_err(|e| format!("failed to create Oleafly data directory {data:?}: {e}"))?;
            ensure_real_directory(data, "Oleafly data")?;
        }
        Err(error) => {
            return Err(format!(
                "failed to inspect Oleafly data directory {data:?}: {error}"
            ));
        }
    }
    Ok(())
}

pub fn shell_escape_trust_root() -> Result<PathBuf, String> {
    let trust = device_trust_root()?;
    let shell = trust.join("latex-shell-escape");
    ensure_real_directory(&shell, "LaTeX shell trust")?;
    let shell = shell
        .canonicalize()
        .map_err(|e| format!("failed to resolve LaTeX shell trust directory: {e}"))?;
    if shell.parent() != Some(trust.as_path()) {
        return Err("LaTeX shell trust directory escapes the device trust root".into());
    }
    Ok(shell)
}

/// Validate a project id. Ids are a single path segment of safe characters, so
/// a crafted id (`..`, `/etc/x`, `a/b`, an absolute path, or a Windows drive
/// prefix) can never escape the projects root when joined. Every path-taking
pub fn validate_project_id(project_id: &str) -> Result<(), String> {
    if project_id.is_empty() {
        return Err("empty project id".to_string());
    }
    if !project_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("illegal project id: {project_id}"));
    }
    Ok(())
}

pub fn project_dir(project_id: &str) -> Result<PathBuf, String> {
    validate_project_id(project_id)?;
    let root = projects_root()?
        .canonicalize()
        .map_err(|e| format!("failed to resolve projects root: {e}"))?;
    let dir = root.join(project_id);
    let metadata = std::fs::symlink_metadata(&dir).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            format!("project does not exist: {project_id}")
        } else {
            format!("failed to inspect project directory {dir:?}: {error}")
        }
    })?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(format!("project path is not a real directory: {dir:?}"));
    }
    verify_project_directory(root, dir)
}

pub(crate) fn create_project_dir(project_id: &str) -> Result<PathBuf, String> {
    validate_project_id(project_id)?;
    let root = projects_root()?
        .canonicalize()
        .map_err(|e| format!("failed to resolve projects root: {e}"))?;
    let dir = root.join(project_id);
    ensure_real_directory(&dir, "project")?;
    verify_project_directory(root, dir)
}

fn verify_project_directory(root: PathBuf, dir: PathBuf) -> Result<PathBuf, String> {
    let resolved = dir
        .canonicalize()
        .map_err(|e| format!("failed to resolve project dir {dir:?}: {e}"))?;
    if resolved.parent() != Some(root.as_path()) {
        return Err("project directory escapes the projects root".to_string());
    }
    Ok(resolved)
}

/// The per-project build directory: `<project>/.oleafly/build/`.
pub fn build_dir(project_id: &str) -> Result<PathBuf, String> {
    secure_build_subdirectory(project_id, "build")
}

/// The per-project isolated figure build directory: `<project>/.oleafly/figbuild/`.
/// Separate from `build_dir` so figure iteration never clobbers the main preview PDF.
pub fn figure_build_dir(project_id: &str) -> Result<PathBuf, String> {
    secure_build_subdirectory(project_id, "figbuild")
}

/// Build metadata records: `<project>/.oleafly/builds/`. One small JSON per
/// successful compile (engine + distribution + lockfile hash) so "my
/// coauthor's PDF looks different" is diagnosable.
pub fn builds_metadata_dir(project_id: &str) -> Result<PathBuf, String> {
    secure_build_subdirectory(project_id, "builds")
}

fn secure_build_subdirectory(project_id: &str, name: &str) -> Result<PathBuf, String> {
    let project = project_dir(project_id)?;
    secure_build_subdirectory_in(&project, name)
}

fn secure_build_subdirectory_in(project: &std::path::Path, name: &str) -> Result<PathBuf, String> {
    let project = project
        .canonicalize()
        .map_err(|e| format!("failed to resolve project directory: {e}"))?;
    let internal = project.join(".oleafly");
    ensure_real_directory(&internal, "project data")?;
    let internal = internal
        .canonicalize()
        .map_err(|e| format!("failed to resolve project data directory: {e}"))?;
    if internal.parent() != Some(project.as_path()) {
        return Err("project data directory escapes the project root".to_string());
    }
    let output = internal.join(name);
    ensure_real_directory(&output, "build")?;
    let output = output
        .canonicalize()
        .map_err(|e| format!("failed to resolve build directory: {e}"))?;
    if output.parent() != Some(internal.as_path()) || !output.starts_with(&project) {
        return Err("build directory escapes the project root".to_string());
    }
    Ok(output)
}

fn ensure_real_directory(path: &std::path::Path, label: &str) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => validate_real_directory_metadata(path, label, &metadata)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            create_or_join_real_directory(path, label)?;
        }
        Err(error) => return Err(format!("failed to inspect {label} path {path:?}: {error}")),
    }
    Ok(())
}

fn create_or_join_real_directory(path: &std::path::Path, label: &str) -> Result<(), String> {
    match std::fs::create_dir(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => {
            return Err(format!(
                "failed to create {label} directory {path:?}: {error}"
            ));
        }
    }
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("failed to inspect {label} directory {path:?}: {error}"))?;
    validate_real_directory_metadata(path, label, &metadata)
}

fn validate_real_directory_metadata(
    path: &std::path::Path,
    label: &str,
    metadata: &std::fs::Metadata,
) -> Result<(), String> {
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(metadata) {
        return Err(format!("{label} path is not a real directory: {path:?}"));
    }
    Ok(())
}

#[cfg(windows)]
fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &std::fs::Metadata) -> bool {
    false
}

/// Serializes every process environment mutation a test performs, because a
/// change to any variable can make a concurrent read of another one miss.
#[cfg(test)]
pub(crate) fn data_dir_env_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_rejects_traversal_and_separators() {
        assert!(validate_project_id("").is_err());
        assert!(validate_project_id("..").is_err());
        assert!(validate_project_id("../evil").is_err());
        assert!(validate_project_id("/etc/passwd").is_err());
        assert!(validate_project_id("a/b").is_err());
        assert!(validate_project_id("a\\b").is_err());
        assert!(validate_project_id("C:\\Windows").is_err());
        assert!(validate_project_id("dot.dot").is_err());
    }

    #[test]
    fn validate_allows_slugs() {
        assert!(validate_project_id("default").is_ok());
        assert!(validate_project_id("flying-pink-pikachu").is_ok());
        assert!(validate_project_id("proj_01").is_ok());
    }

    #[test]
    fn missing_directory_creation_accepts_a_concurrent_real_directory_winner() {
        let directory = tempfile::tempdir().unwrap();
        let raced = directory.path().join("raced");
        std::fs::create_dir(&raced).unwrap();

        create_or_join_real_directory(&raced, "test").unwrap();

        let substituted = directory.path().join("substituted");
        std::fs::write(&substituted, b"not a directory").unwrap();
        assert!(create_or_join_real_directory(&substituted, "test").is_err());
    }

    #[test]
    fn resolving_a_missing_project_never_creates_it() {
        let _env_guard = data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        std::env::set_var("OLEAFLY_DATA_DIR", root);
        let missing = root.join("projects").join("gone");

        assert!(project_dir("gone").unwrap_err().contains("does not exist"));
        assert!(!missing.exists());
        let created = create_project_dir("gone").unwrap();
        assert_eq!(created, missing.canonicalize().unwrap());

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[cfg(unix)]
    #[test]
    fn build_paths_reject_symlink_components() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let temp = directory.path();
        let project = temp.join("project");
        let outside = temp.join("outside");
        std::fs::create_dir(&project).unwrap();
        std::fs::create_dir(&outside).unwrap();
        symlink(&outside, project.join(".oleafly")).unwrap();
        assert!(secure_build_subdirectory_in(&project, "build").is_err());

        std::fs::remove_file(project.join(".oleafly")).unwrap();
        std::fs::create_dir(project.join(".oleafly")).unwrap();
        symlink(&outside, project.join(".oleafly/build")).unwrap();
        assert!(secure_build_subdirectory_in(&project, "build").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn checkpoint_paths_reject_symlink_substitution() {
        use std::os::unix::fs::symlink;

        let _env_guard = data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");
        let outside = directory.path().join("outside");
        std::fs::create_dir(&data).unwrap();
        std::fs::create_dir(&outside).unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", &data);
        symlink(&outside, data.join("checkpoints")).unwrap();

        assert!(checkpoint_store_dir("paper").is_err());
        assert!(existing_checkpoint_store_dir("paper").is_err());

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}
