use std::path::PathBuf;

/// Compile entry wrapper (neutralizes pdfLaTeX-only commands under XeTeX).
pub const ENTRY_TEX: &str = "_openleaf_entry.tex";
pub const ENTRY_STEM: &str = "_openleaf_entry";

/// The user's home directory.
pub fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "could not determine user home directory".to_string())
}

/// One-time migration from the legacy `~/.localleaf` layout to `~/.openleaf`.
/// Runs once at startup (see `run_migrations`), not on every path lookup.
fn migrate_legacy() {
    if let Ok(home) = home_dir() {
        let new_root = home.join(".openleaf");
        let old_root = home.join(".localleaf");
        if !new_root.exists() && old_root.exists() {
            let _ = std::fs::rename(&old_root, &new_root);
        }
        // Rename each project's legacy build cache `.localleaf` -> `.openleaf`.
        if let Ok(projects) = std::fs::read_dir(new_root.join("projects")) {
            for entry in projects.flatten() {
                if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                let old = entry.path().join(".localleaf");
                let new = entry.path().join(".openleaf");
                if old.is_dir() && !new.exists() {
                    let _ = std::fs::rename(&old, &new);
                }
            }
        }
    }
}

/// Run startup migrations. Called once from `lib::run()`.
pub fn run_migrations() {
    migrate_legacy();
}

/// The OpenLeaf library root: `~/.openleaf/`.
pub fn openleaf_root() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".openleaf"))
}

/// The projects directory: `~/.openleaf/projects/` (created if missing).
pub fn projects_root() -> Result<PathBuf, String> {
    let root = openleaf_root()?.join("projects");
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

/// A single project directory: `~/.openleaf/projects/<id>/` (created if missing).
pub fn project_dir(project_id: &str) -> Result<PathBuf, String> {
    validate_project_id(project_id)?;
    let dir = projects_root()?.join(project_id);
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("failed to create project dir {dir:?}: {e}"))?;
    }
    Ok(dir)
}

/// The per-project build directory: `<project>/.openleaf/build/`.
pub fn build_dir(project_id: &str) -> Result<PathBuf, String> {
    let dir = project_dir(project_id)?.join(".openleaf").join("build");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("failed to create build dir {dir:?}: {e}"))?;
    }
    Ok(dir)
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
}
