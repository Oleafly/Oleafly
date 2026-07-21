use std::path::PathBuf;

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

/// The projects directory: `~/.oleafly/projects/` (created if missing).
pub fn projects_root() -> Result<PathBuf, String> {
    let root = oleafly_root()?.join("projects");
    if !root.exists() {
        std::fs::create_dir_all(&root)
            .map_err(|e| format!("failed to create projects root {root:?}: {e}"))?;
    }
    Ok(root)
}

/// Validate a project id. Ids are a single path segment of safe characters, so
/// a crafted id (`..`, `/etc/x`, `a/b`, an absolute path, or a Windows drive
/// prefix) can never escape the projects root when joined. Every path-taking
/// command resolves through `project_dir`, so validating here covers them all.
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

/// A single project directory: `~/.oleafly/projects/<id>/` (created if missing).
pub fn project_dir(project_id: &str) -> Result<PathBuf, String> {
    validate_project_id(project_id)?;
    let root = projects_root()?
        .canonicalize()
        .map_err(|e| format!("failed to resolve projects root: {e}"))?;
    let dir = root.join(project_id);
    ensure_real_directory(&dir, "project")?;
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
        Ok(metadata) => {
            if !metadata.is_dir()
                || metadata.file_type().is_symlink()
                || is_reparse_point(&metadata)
            {
                return Err(format!("{label} path is not a real directory: {path:?}"));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(path)
                .map_err(|e| format!("failed to create {label} directory {path:?}: {e}"))?;
            let metadata = std::fs::symlink_metadata(path)
                .map_err(|e| format!("failed to inspect {label} directory {path:?}: {e}"))?;
            if !metadata.is_dir()
                || metadata.file_type().is_symlink()
                || is_reparse_point(&metadata)
            {
                return Err(format!("{label} path is not a real directory: {path:?}"));
            }
        }
        Err(error) => return Err(format!("failed to inspect {label} path {path:?}: {error}")),
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

    #[cfg(unix)]
    #[test]
    fn build_paths_reject_symlink_components() {
        use std::os::unix::fs::symlink;

        let temp = std::env::temp_dir().join(format!(
            "oleafly-path-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let project = temp.join("project");
        let outside = temp.join("outside");
        std::fs::create_dir(&temp).unwrap();
        std::fs::create_dir(&project).unwrap();
        std::fs::create_dir(&outside).unwrap();
        symlink(&outside, project.join(".oleafly")).unwrap();
        assert!(secure_build_subdirectory_in(&project, "build").is_err());

        std::fs::remove_file(project.join(".oleafly")).unwrap();
        std::fs::create_dir(project.join(".oleafly")).unwrap();
        symlink(&outside, project.join(".oleafly/build")).unwrap();
        assert!(secure_build_subdirectory_in(&project, "build").is_err());
        std::fs::remove_dir_all(temp).unwrap();
    }
}
