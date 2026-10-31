use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::roots::{broad_reason, note_refused};
use crate::{home_dir, SandboxError, SandboxSpec};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedSpec {
    pub workspace: PathBuf,
    pub home: PathBuf,
    pub read_only: Vec<PathBuf>,
    pub project_read_only: Vec<PathBuf>,
    pub read_write: Vec<PathBuf>,
    pub protected: Vec<PathBuf>,
    pub missing_protected: Vec<PathBuf>,
    pub hidden: Vec<PathBuf>,
    pub network: bool,
    pub gpu: bool,
    pub child_processes: bool,
    pub owner: String,
    pub project: Option<String>,
    pub path_prepend: Vec<PathBuf>,
    pub env: BTreeMap<String, String>,
}

/// `path` without the `\\?\` prefix `canonicalize` adds on Windows, when the
/// plain form is valid; unchanged elsewhere.
pub(crate) fn plain_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.as_os_str().to_string_lossy();
        let plain = if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{rest}")
        } else if let Some(rest) = text.strip_prefix(r"\\?\") {
            rest.to_string()
        } else {
            return path.to_path_buf();
        };
        if plain.encode_utf16().count() < 260 && !plain.is_empty() {
            return PathBuf::from(plain);
        }
        path.to_path_buf()
    }
    #[cfg(not(windows))]
    {
        path.to_path_buf()
    }
}

fn real_directory(path: &Path, what: &str) -> Result<PathBuf, SandboxError> {
    if !path.is_absolute() {
        return Err(SandboxError::Invalid(format!(
            "The {what} must be an absolute path."
        )));
    }
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|_| SandboxError::Invalid(format!("The {what} is unavailable.")))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(SandboxError::Invalid(format!(
            "The {what} must be a real folder."
        )));
    }
    path.canonicalize()
        .map(|path| plain_path(&path))
        .map_err(|error| SandboxError::Io(error.to_string()))
}

/// The workspace's own entries that stay read-only inside a write grant,
/// whether the caller listed them or not and whether they exist yet or not:
/// git runs hooks and `core.fsmonitor` from `.git` outside the sandbox later.
const WORKSPACE_PROTECTED: [&str; 2] = [".git", ".oleafly"];

fn protected_path(path: &Path) -> Result<Option<(PathBuf, bool)>, SandboxError> {
    let broken =
        || SandboxError::Invalid("A protected task path is a link that leads nowhere.".into());
    match std::fs::symlink_metadata(path) {
        Ok(_) => {
            return path
                .canonicalize()
                .map(|real| Some((plain_path(&real), false)))
                .map_err(|_| broken());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotADirectory => return Ok(None),
        Err(error) => return Err(SandboxError::Io(error.to_string())),
    }
    let mut tail = Vec::new();
    let mut current = path;
    loop {
        let (Some(name), Some(parent)) = (current.file_name(), current.parent()) else {
            return Ok(None);
        };
        tail.push(name.to_os_string());
        match std::fs::symlink_metadata(parent) {
            Ok(metadata) => {
                if !metadata.is_dir() && !metadata.file_type().is_symlink() {
                    return Ok(None);
                }
                let mut real = parent
                    .canonicalize()
                    .map(|real| plain_path(&real))
                    .map_err(|_| broken())?;
                if !real.is_dir() {
                    return Ok(None);
                }
                for name in tail.iter().rev() {
                    real.push(name);
                }
                return Ok(Some((real, true)));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => current = parent,
            Err(_) => return Ok(None),
        }
    }
}

#[cfg(any(target_os = "linux", windows, test))]
pub(crate) fn create_missing_protected(spec: &ResolvedSpec) -> Result<(), SandboxError> {
    for path in &spec.missing_protected {
        let base = spec
            .read_write
            .iter()
            .filter(|write| path.starts_with(write))
            .max_by_key(|write| write.components().count())
            .ok_or_else(|| {
                SandboxError::Invalid("A protected task path is outside the write grants.".into())
            })?;
        let relative = path
            .strip_prefix(base)
            .map_err(|error| SandboxError::Io(error.to_string()))?;
        match crate::safe_fs::create_folders_below(base, relative) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(SandboxError::Invalid(format!(
                "A protected task folder could not be created, so the command can't run: {error}"
            )))
            }
        }
    }
    Ok(())
}

fn sorted(mut paths: Vec<PathBuf>) -> Vec<PathBuf> {
    paths.sort();
    paths.dedup();
    paths
}

fn read_grants(paths: &[PathBuf]) -> Result<Vec<PathBuf>, SandboxError> {
    let home = home_dir().map(|home| {
        home.canonicalize()
            .map(|path| plain_path(&path))
            .unwrap_or(home)
    });
    let mut resolved = Vec::with_capacity(paths.len());
    for path in paths {
        let real = path
            .canonicalize()
            .map(|path| plain_path(&path))
            .map_err(|_| SandboxError::Invalid("A task runtime file is unavailable.".into()))?;
        if let Some(reason) = broad_reason(&real, home.as_deref()) {
            note_refused(&real, reason);
            return Err(SandboxError::Invalid(
                "Task runtimes require specific readable files or folders.".into(),
            ));
        }
        resolved.push(real);
    }
    Ok(sorted(resolved))
}

fn hidden_paths(spec: &SandboxSpec, reachable: &[&Path]) -> Vec<PathBuf> {
    sorted(
        spec.deny_read
            .iter()
            .filter_map(|path| path.canonicalize().ok().map(|path| plain_path(&path)))
            .filter(|path| reachable.iter().any(|root| path.starts_with(root)))
            .collect(),
    )
}

pub(crate) fn resolve(spec: &SandboxSpec) -> Result<ResolvedSpec, SandboxError> {
    let workspace = real_directory(&spec.workspace, "task folder")?;
    #[cfg(windows)]
    {
        if workspace
            .as_os_str()
            .to_string_lossy()
            .encode_utf16()
            .count()
            >= 248
        {
            return Err(SandboxError::Invalid(
                "The task folder path is too long for Windows. Move Oleafly's data folder to a shorter path."
                    .into(),
            ));
        }
    }
    let home = crate::prepare_home(&spec.home).map(|path| plain_path(&path))?;
    let mut read_write = Vec::with_capacity(spec.read_write.len());
    for path in &spec.read_write {
        let metadata = std::fs::symlink_metadata(path)
            .map_err(|_| SandboxError::Invalid("A writable task path is unavailable.".into()))?;
        if metadata.file_type().is_symlink() {
            return Err(SandboxError::Invalid(
                "A task command cannot use a writable symbolic link.".into(),
            ));
        }
        let real = path
            .canonicalize()
            .map(|path| plain_path(&path))
            .map_err(|error| SandboxError::Io(error.to_string()))?;
        if !real.starts_with(&workspace) && !real.starts_with(&home) {
            return Err(SandboxError::Invalid(
                "A writable path is outside the task folder and its home folder.".into(),
            ));
        }
        read_write.push(real);
    }
    let read_write = sorted(read_write);
    let mut protected = Vec::new();
    let mut missing_protected = Vec::new();
    let candidates = spec
        .protected
        .iter()
        .cloned()
        .chain(WORKSPACE_PROTECTED.iter().map(|name| workspace.join(name)));
    for path in candidates {
        let Some((real, missing)) = protected_path(&path)? else {
            continue;
        };
        if !read_write.iter().any(|write| real.starts_with(write)) {
            continue;
        }
        if missing {
            missing_protected.push(real.clone());
        }
        protected.push(real);
    }
    let protected = sorted(protected);
    let missing_protected = sorted(missing_protected);
    let read_only = read_grants(&spec.read_only)?;
    let project_read_only = read_grants(&spec.project_read_only)?;
    let hidden = {
        let reachable: Vec<&Path> = [workspace.as_path(), home.as_path()]
            .into_iter()
            .chain(read_only.iter().map(PathBuf::as_path))
            .chain(project_read_only.iter().map(PathBuf::as_path))
            .collect();
        hidden_paths(spec, &reachable)
    };
    Ok(ResolvedSpec {
        workspace,
        home,
        read_only,
        project_read_only,
        read_write,
        protected,
        missing_protected,
        hidden,
        network: spec.network,
        gpu: spec.gpu,
        child_processes: spec.child_processes,
        owner: spec.owner.clone(),
        project: spec.project.clone(),
        path_prepend: spec.path_prepend.clone(),
        env: spec.env.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        workspace: tempfile::TempDir,
        home: tempfile::TempDir,
    }

    impl Fixture {
        fn new() -> Self {
            Self {
                workspace: tempfile::tempdir().unwrap(),
                home: tempfile::tempdir().unwrap(),
            }
        }

        fn spec(&self) -> SandboxSpec {
            SandboxSpec::new(
                "task:test",
                self.workspace.path().to_path_buf(),
                self.home.path().to_path_buf(),
            )
        }
    }

    #[test]
    fn rejects_write_paths_outside_workspace_and_home() {
        let fixture = Fixture::new();
        let sibling = tempfile::tempdir().unwrap();
        let mut spec = fixture.spec();
        spec.read_write = vec![sibling.path().to_path_buf()];
        let error = resolve(&spec).unwrap_err().to_string();
        assert!(error.contains("outside"), "{error}");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_linked_write_paths() {
        let fixture = Fixture::new();
        let target = fixture.workspace.path().join("real");
        std::fs::create_dir(&target).unwrap();
        let link = fixture.workspace.path().join("link");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let mut spec = fixture.spec();
        spec.read_write = vec![link];
        assert!(resolve(&spec)
            .unwrap_err()
            .to_string()
            .contains("symbolic link"));
    }

    #[test]
    fn rejects_filesystem_root_and_home_as_reads() {
        let fixture = Fixture::new();
        let mut spec = fixture.spec();
        spec.read_only = vec![PathBuf::from(if cfg!(windows) { r"C:\" } else { "/" })];
        assert!(resolve(&spec)
            .unwrap_err()
            .to_string()
            .contains("specific readable files or folders"));
        if let Some(home) = home_dir() {
            let mut spec = fixture.spec();
            spec.read_only = vec![home];
            assert!(resolve(&spec).is_err());
        }
    }

    #[test]
    fn keeps_missing_protected_paths_inside_write_grants() {
        let fixture = Fixture::new();
        let chapters = fixture.workspace.path().join("chapters");
        std::fs::create_dir_all(chapters.join(".oleafly")).unwrap();
        let outside = fixture.workspace.path().join(".oleafly-root");
        std::fs::create_dir(&outside).unwrap();
        let mut spec = fixture.spec();
        spec.read_write = vec![chapters.clone()];
        spec.protected = vec![chapters.join(".git"), chapters.join(".oleafly"), outside];
        let resolved = resolve(&spec).unwrap();
        let real_chapters = plain_path(&chapters.canonicalize().unwrap());
        assert_eq!(
            resolved.protected,
            vec![real_chapters.join(".git"), real_chapters.join(".oleafly")]
        );
        assert_eq!(resolved.missing_protected, vec![real_chapters.join(".git")]);
    }

    #[test]
    fn the_workspace_git_and_oleafly_are_protected_inside_a_write_grant() {
        let fixture = Fixture::new();
        let mut spec = fixture.spec();
        spec.read_write = vec![fixture.workspace.path().to_path_buf()];
        let resolved = resolve(&spec).unwrap();
        let workspace = plain_path(&fixture.workspace.path().canonicalize().unwrap());
        let expected = vec![workspace.join(".git"), workspace.join(".oleafly")];
        assert_eq!(resolved.protected, expected);
        assert_eq!(resolved.missing_protected, expected);
        assert!(!workspace.join(".git").exists());
        let resolved = resolve(&fixture.spec()).unwrap();
        assert!(resolved.protected.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_protected_link_that_leads_nowhere() {
        let fixture = Fixture::new();
        std::os::unix::fs::symlink(
            fixture.workspace.path().join("gone"),
            fixture.workspace.path().join(".git"),
        )
        .unwrap();
        let mut spec = fixture.spec();
        spec.read_write = vec![fixture.workspace.path().to_path_buf()];
        assert!(resolve(&spec)
            .unwrap_err()
            .to_string()
            .contains("leads nowhere"));
    }

    #[test]
    fn missing_protected_paths_are_created_as_empty_folders() {
        let fixture = Fixture::new();
        let mut spec = fixture.spec();
        spec.read_write = vec![fixture.workspace.path().to_path_buf()];
        let resolved = resolve(&spec).unwrap();
        create_missing_protected(&resolved).unwrap();
        for path in &resolved.missing_protected {
            assert!(path.is_dir(), "{}", path.display());
            assert_eq!(std::fs::read_dir(path).unwrap().count(), 0);
        }
        create_missing_protected(&resolved).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_protected_folder_is_never_created_through_a_link() {
        let fixture = Fixture::new();
        let elsewhere = tempfile::tempdir().unwrap();
        let mut spec = fixture.spec();
        spec.read_write = vec![fixture.workspace.path().to_path_buf()];
        let resolved = resolve(&spec).unwrap();
        let git = &resolved.missing_protected[0];
        std::os::unix::fs::symlink(elsewhere.path(), git).unwrap();
        assert!(create_missing_protected(&resolved).is_err());
        assert_eq!(std::fs::read_dir(elsewhere.path()).unwrap().count(), 0);
    }

    #[test]
    fn dedupes_and_sorts_reads() {
        let fixture = Fixture::new();
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let mut spec = fixture.spec();
        spec.read_only = vec![
            b.path().to_path_buf(),
            a.path().to_path_buf(),
            b.path().to_path_buf(),
        ];
        let resolved = resolve(&spec).unwrap();
        let mut expected = vec![
            plain_path(&a.path().canonicalize().unwrap()),
            plain_path(&b.path().canonicalize().unwrap()),
        ];
        expected.sort();
        assert_eq!(resolved.read_only, expected);
    }

    #[cfg(windows)]
    #[test]
    fn plain_path_strips_verbatim_prefix() {
        assert_eq!(
            plain_path(Path::new(r"\\?\C:\Users\A B")),
            PathBuf::from(r"C:\Users\A B")
        );
        assert_eq!(
            plain_path(Path::new(r"\\?\UNC\srv\s\x")),
            PathBuf::from(r"\\srv\s\x")
        );
    }

    #[cfg(windows)]
    #[test]
    fn refuses_workspace_paths_of_248_chars_or_more() {
        let base = tempfile::tempdir().unwrap();
        let mut deep = base.path().to_path_buf();
        while deep.as_os_str().len() < 260 {
            deep.push("abcdefghij");
        }
        std::fs::create_dir_all(&deep).unwrap();
        let home = tempfile::tempdir().unwrap();
        let spec = SandboxSpec::new("task:test", deep, home.path().to_path_buf());
        assert!(resolve(&spec).unwrap_err().to_string().contains("too long"));
    }
}
