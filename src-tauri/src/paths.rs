use crate::project_location::{ProjectKind, ProjectLocation};
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
    crate::project_location::locate(project_id)
        .map(|location| location.root)
        .map_err(String::from)
}

pub(crate) fn library_project_root(project_id: &str) -> Result<Option<PathBuf>, String> {
    validate_project_id(project_id)?;
    let root = projects_root()?
        .canonicalize()
        .map_err(|e| format!("failed to resolve projects root: {e}"))?;
    let dir = root.join(project_id);
    let metadata = match std::fs::symlink_metadata(&dir) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "failed to inspect project directory {dir:?}: {error}"
            ))
        }
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(format!("project path is not a real directory: {dir:?}"));
    }
    verify_project_directory(root, dir).map(Some)
}

#[cfg(test)]
pub fn linked_root() -> Result<PathBuf, String> {
    let data = oleafly_root()?;
    std::fs::create_dir_all(&data)
        .map_err(|e| format!("failed to create Oleafly data directory {data:?}: {e}"))?;
    let data = data
        .canonicalize()
        .map_err(|e| format!("failed to resolve Oleafly data directory: {e}"))?;
    let linked = data.join("linked");
    ensure_real_directory(&linked, "linked folders")?;
    let linked = linked
        .canonicalize()
        .map_err(|e| format!("failed to resolve linked folders directory: {e}"))?;
    if linked.parent() != Some(data.as_path()) {
        return Err("linked folders directory escapes the Oleafly data root".into());
    }
    Ok(linked)
}

pub fn existing_linked_root() -> Result<Option<PathBuf>, String> {
    let data = match oleafly_root()?.canonicalize() {
        Ok(data) => data,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("failed to resolve Oleafly data directory: {error}")),
    };
    let Some(linked) = existing_real_directory(&data.join("linked"), "linked folders")? else {
        return Ok(None);
    };
    if linked.parent() != Some(data.as_path()) {
        return Err("linked folders directory escapes the Oleafly data root".into());
    }
    Ok(Some(linked))
}

pub(crate) fn app_data_roots() -> Result<Vec<PathBuf>, String> {
    let data = oleafly_root()?
        .canonicalize()
        .map_err(|e| format!("failed to resolve Oleafly data directory: {e}"))?;
    let mut roots = vec![data.clone()];
    for name in ["projects", "checkpoints", "recycle-bin"] {
        let path = data.join(name);
        match std::fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() || is_reparse_point(&metadata) => {}
            Ok(_) => continue,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(format!(
                    "failed to inspect Oleafly {name} directory: {error}"
                ))
            }
        }
        match path.canonicalize() {
            Ok(target) => roots.push(target),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "failed to resolve Oleafly {name} directory: {error}"
                ))
            }
        }
    }
    Ok(roots)
}

pub(crate) fn overlaps_app_data(folder: &Path) -> Result<bool, String> {
    Ok(app_data_roots()?
        .iter()
        .any(|root| folder.starts_with(root) || root.starts_with(folder)))
}

pub(crate) fn linked_state_directory(
    state_dir: &Path,
    relative: &Path,
    create: bool,
) -> Result<Option<PathBuf>, String> {
    let linked =
        existing_linked_root()?.ok_or_else(|| "linked project data is missing".to_string())?;
    let Some(mut current) = existing_real_directory(state_dir, "linked project data")? else {
        return Err("linked project data is missing".to_string());
    };
    if current.parent() != Some(linked.as_path()) {
        return Err("linked project data escapes the folder registry".to_string());
    }
    for component in relative.components() {
        let std::path::Component::Normal(name) = component else {
            return Err("linked project data path is invalid".to_string());
        };
        let next = current.join(name);
        if create {
            ensure_real_directory(&next, "linked project data")?;
        }
        let Some(resolved) = existing_real_directory(&next, "linked project data")? else {
            return Ok(None);
        };
        if resolved.parent() != Some(current.as_path()) {
            return Err("linked project data escapes the folder registry".to_string());
        }
        current = resolved;
    }
    Ok(Some(current))
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

pub fn existing_build_dir(project_id: &str) -> Result<Option<PathBuf>, String> {
    existing_build_subdirectory(project_id, "build")
}

pub fn existing_figure_build_dir(project_id: &str) -> Result<Option<PathBuf>, String> {
    existing_build_subdirectory(project_id, "figbuild")
}

fn existing_build_subdirectory(project_id: &str, name: &str) -> Result<Option<PathBuf>, String> {
    if let Some(state_dir) = crate::project_location::linked_state_dir(project_id)? {
        return linked_state_directory(&state_dir, Path::new(name), false);
    }
    let project = project_dir(project_id)?;
    existing_build_subdirectory_in(&project, name)
}

fn existing_build_subdirectory_in(project: &Path, name: &str) -> Result<Option<PathBuf>, String> {
    let project = project
        .canonicalize()
        .map_err(|e| format!("failed to resolve project directory: {e}"))?;
    let Some(internal) = existing_real_directory(&project.join(".oleafly"), "project data")? else {
        return Ok(None);
    };
    if internal.parent() != Some(project.as_path()) {
        return Err("project data directory escapes the project root".to_string());
    }
    let Some(output) = existing_real_directory(&internal.join(name), "build")? else {
        return Ok(None);
    };
    if output.parent() != Some(internal.as_path()) || !output.starts_with(&project) {
        return Err("build directory escapes the project root".to_string());
    }
    Ok(Some(output))
}

fn existing_real_directory(path: &Path, label: &str) -> Result<Option<PathBuf>, String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => validate_real_directory_metadata(path, label, &metadata)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("failed to inspect {label} path {path:?}: {error}")),
    }
    path.canonicalize()
        .map(Some)
        .map_err(|e| format!("failed to resolve {label} directory: {e}"))
}

fn secure_build_subdirectory(project_id: &str, name: &str) -> Result<PathBuf, String> {
    let location = crate::project_location::locate(project_id)?;
    state_subdirectory(&location, name)
}

pub(crate) fn state_subdirectory(
    location: &ProjectLocation,
    name: &str,
) -> Result<PathBuf, String> {
    match location.kind {
        ProjectKind::Library => secure_build_subdirectory_in(&location.root, name),
        ProjectKind::Linked => linked_state_directory(&location.state_dir, Path::new(name), true)?
            .ok_or_else(|| "linked project data is missing".to_string()),
    }
}

pub(crate) fn existing_state_subdirectory(
    location: &ProjectLocation,
    name: &str,
) -> Result<Option<PathBuf>, String> {
    match location.kind {
        ProjectKind::Library => existing_build_subdirectory_in(&location.root, name),
        ProjectKind::Linked => linked_state_directory(&location.state_dir, Path::new(name), false),
    }
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
pub(crate) fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
pub(crate) fn is_reparse_point(_metadata: &std::fs::Metadata) -> bool {
    false
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReparseClass {
    None,
    Cloud,
    NameSurrogate,
    Other,
}

#[cfg(test)]
impl ReparseClass {
    pub(crate) fn opens_as_folder(self) -> bool {
        !matches!(self, Self::NameSurrogate)
    }
}

#[cfg(test)]
pub(crate) fn classify_reparse_tag(attributes: u32, tag: u32) -> ReparseClass {
    const REPARSE_POINT_ATTRIBUTE: u32 = 0x0000_0400;
    const NAME_SURROGATE_TAG_BIT: u32 = 0x2000_0000;
    const CLOUD_TAG: u32 = 0x9000_001A;
    const CLOUD_TAG_VARIANT_BITS: u32 = 0x0000_F000;
    const LEGACY_ONEDRIVE_TAG: u32 = 0x8000_0021;
    if attributes & REPARSE_POINT_ATTRIBUTE == 0 {
        return ReparseClass::None;
    }
    if tag & NAME_SURROGATE_TAG_BIT != 0 {
        return ReparseClass::NameSurrogate;
    }
    if tag & !CLOUD_TAG_VARIANT_BITS == CLOUD_TAG || tag == LEGACY_ONEDRIVE_TAG {
        return ReparseClass::Cloud;
    }
    ReparseClass::Other
}

#[cfg(all(test, windows))]
pub(crate) fn reparse_class(path: &Path) -> std::io::Result<ReparseClass> {
    use std::os::windows::fs::OpenOptionsExt as _;
    use std::os::windows::io::AsRawHandle as _;
    use windows_sys::Win32::Storage::FileSystem::{
        FileAttributeTagInfo, GetFileInformationByHandleEx, FILE_ATTRIBUTE_TAG_INFO,
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    };
    let handle = std::fs::OpenOptions::new()
        .access_mode(0)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    let mut information = FILE_ATTRIBUTE_TAG_INFO::default();
    let succeeded = unsafe {
        GetFileInformationByHandleEx(
            handle.as_raw_handle(),
            FileAttributeTagInfo,
            std::ptr::addr_of_mut!(information).cast(),
            std::mem::size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
        )
    };
    if succeeded == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(classify_reparse_tag(
        information.FileAttributes,
        information.ReparseTag,
    ))
}

#[cfg(all(test, not(windows)))]
pub(crate) fn reparse_class(_path: &Path) -> std::io::Result<ReparseClass> {
    Ok(ReparseClass::None)
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
pub(crate) fn symlink_creation_is_permitted() -> bool {
    let Ok(probe) = tempfile::tempdir() else {
        return false;
    };
    let target = probe.path().join("target");
    if std::fs::write(&target, b"probe").is_err() {
        return false;
    }
    let link = probe.path().join("link");
    #[cfg(unix)]
    let created = std::os::unix::fs::symlink(&target, &link).is_ok();
    #[cfg(windows)]
    let created = std::os::windows::fs::symlink_file(&target, &link).is_ok();
    if !created {
        eprintln!(
            "skipping: this session may not create symbolic links (enable Developer Mode on Windows)"
        );
    }
    created
}

#[cfg(test)]
pub(crate) fn relative_tree_for_test(root: &Path) -> Vec<String> {
    fn visit(root: &Path, directory: &Path, out: &mut Vec<String>) {
        for entry in std::fs::read_dir(directory).unwrap().flatten() {
            let path = entry.path();
            out.push(
                path.strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
            if entry.file_type().unwrap().is_dir() {
                visit(root, &path, out);
            }
        }
    }
    let mut out = Vec::new();
    visit(root, root, &mut out);
    out.sort();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn library_state_paths_and_data_footprint_are_pinned() {
        let _env_guard = data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let data = directory.path().canonicalize().unwrap();
        let project = create_project_dir("paper").unwrap();
        let internal = data.join("projects").join("paper").join(".oleafly");

        assert_eq!(project, data.join("projects").join("paper"));
        assert_eq!(project_dir("paper").unwrap(), project);
        assert_eq!(existing_build_dir("paper").unwrap(), None);
        assert_eq!(build_dir("paper").unwrap(), internal.join("build"));
        assert_eq!(
            figure_build_dir("paper").unwrap(),
            internal.join("figbuild")
        );
        assert_eq!(
            builds_metadata_dir("paper").unwrap(),
            internal.join("builds")
        );
        assert_eq!(
            existing_build_dir("paper").unwrap(),
            Some(internal.join("build"))
        );
        assert_eq!(
            existing_figure_build_dir("paper").unwrap(),
            Some(internal.join("figbuild"))
        );
        assert_eq!(
            relative_tree_for_test(&data),
            [
                "projects",
                "projects/paper",
                "projects/paper/.oleafly",
                "projects/paper/.oleafly/build",
                "projects/paper/.oleafly/builds",
                "projects/paper/.oleafly/figbuild",
            ]
        );
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn library_resolution_errors_keep_their_wording() {
        let _env_guard = data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let projects = projects_root().unwrap().canonicalize().unwrap();
        std::fs::write(projects.join("plain-file"), b"x").unwrap();

        assert_eq!(
            project_dir("missing").unwrap_err(),
            "project does not exist: missing"
        );
        assert_eq!(project_dir("a.b").unwrap_err(), "illegal project id: a.b");
        assert_eq!(project_dir("").unwrap_err(), "empty project id");
        assert_eq!(
            project_dir("plain-file").unwrap_err(),
            format!(
                "project path is not a real directory: {:?}",
                projects.join("plain-file")
            )
        );
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[cfg(unix)]
    #[test]
    fn app_data_overlap_follows_redirected_library_folders() {
        let _env_guard = data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        let volume = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let data = directory.path().canonicalize().unwrap();
        let volume = volume.path().canonicalize().unwrap();
        for name in ["projects", "checkpoints", "recycle-bin"] {
            std::fs::create_dir(volume.join(name)).unwrap();
            std::os::unix::fs::symlink(volume.join(name), data.join(name)).unwrap();
        }
        std::fs::create_dir(volume.join("thesis")).unwrap();

        for overlapping in [
            data.clone(),
            data.join("inside"),
            data.parent().unwrap().to_path_buf(),
            volume.clone(),
            volume.join("projects").join("paper"),
            volume.join("checkpoints"),
            volume.join("recycle-bin").join("paper"),
        ] {
            assert!(overlaps_app_data(&overlapping).unwrap(), "{overlapping:?}");
        }
        assert!(!overlaps_app_data(&volume.join("thesis")).unwrap());
        std::fs::remove_dir(volume.join("checkpoints")).unwrap();
        assert!(!overlaps_app_data(&volume.join("checkpoints")).unwrap());
        std::fs::remove_file(data.join("projects")).unwrap();
        std::fs::create_dir(data.join("projects")).unwrap();
        assert!(!overlaps_app_data(&volume.join("projects").join("paper")).unwrap());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn linked_root_lookups_create_nothing_until_asked() {
        let _env_guard = data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        assert_eq!(existing_linked_root().unwrap(), None);
        assert!(!directory.path().join("linked").exists());
        let created = linked_root().unwrap();
        assert_eq!(
            created,
            directory.path().canonicalize().unwrap().join("linked")
        );
        assert_eq!(existing_linked_root().unwrap(), Some(created));
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn library_project_root_reports_absence_without_an_error() {
        let _env_guard = data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        assert_eq!(library_project_root("gone").unwrap(), None);
        let created = create_project_dir("here").unwrap();
        assert_eq!(library_project_root("here").unwrap(), Some(created));
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[cfg(unix)]
    #[test]
    fn linked_state_directories_stay_inside_their_registry_entry() {
        use std::os::unix::fs::symlink;
        let _env_guard = data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let state = linked_root()
            .unwrap()
            .join("linked-00000000000000000000000000000001");
        std::fs::create_dir(&state).unwrap();

        assert_eq!(
            linked_state_directory(&state, Path::new("build"), false).unwrap(),
            None
        );
        assert!(!state.join("build").exists());
        assert_eq!(
            linked_state_directory(&state, Path::new("state/move-backups"), true).unwrap(),
            Some(state.join("state").join("move-backups"))
        );
        symlink(outside.path(), state.join("figbuild")).unwrap();
        assert!(linked_state_directory(&state, Path::new("figbuild"), false).is_err());
        assert!(linked_state_directory(&state, Path::new("figbuild"), true).is_err());
        assert!(linked_state_directory(&state, Path::new("../escape"), true).is_err());
        assert!(linked_state_directory(outside.path(), Path::new("build"), true).is_err());
        assert!(!outside.path().join("build").exists());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[cfg(unix)]
    #[test]
    fn linked_root_accepts_a_symlinked_data_directory() {
        let _env_guard = data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        let real = directory.path().join("real");
        std::fs::create_dir(&real).unwrap();
        let alias = directory.path().join("alias");
        std::os::unix::fs::symlink(&real, &alias).unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", &alias);
        assert_eq!(existing_linked_root().unwrap(), None);
        let created = linked_root().unwrap();
        assert_eq!(created, real.canonicalize().unwrap().join("linked"));
        assert_eq!(existing_linked_root().unwrap(), Some(created));
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

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

    #[test]
    fn existing_build_lookups_never_create_directories() {
        let _env_guard = data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = create_project_dir("fresh").unwrap();

        assert_eq!(existing_build_dir("fresh").unwrap(), None);
        assert_eq!(existing_figure_build_dir("fresh").unwrap(), None);
        assert!(!project.join(".oleafly").exists());

        let created = build_dir("fresh").unwrap();
        assert_eq!(existing_build_dir("fresh").unwrap(), Some(created));
        assert_eq!(existing_figure_build_dir("fresh").unwrap(), None);
        assert!(!project.join(".oleafly").join("figbuild").exists());

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[cfg(unix)]
    #[test]
    fn existing_build_lookups_reject_symlink_components() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let temp = directory.path();
        let project = temp.join("project");
        let outside = temp.join("outside");
        std::fs::create_dir(&project).unwrap();
        std::fs::create_dir_all(outside.join("build")).unwrap();
        symlink(&outside, project.join(".oleafly")).unwrap();
        assert!(existing_build_subdirectory_in(&project, "build").is_err());

        std::fs::remove_file(project.join(".oleafly")).unwrap();
        std::fs::create_dir(project.join(".oleafly")).unwrap();
        symlink(outside.join("build"), project.join(".oleafly/build")).unwrap();
        assert!(existing_build_subdirectory_in(&project, "build").is_err());
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

    #[test]
    fn reparse_tags_are_classified_by_the_name_surrogate_bit() {
        const REPARSE: u32 = 0x0000_0400;
        const DIRECTORY: u32 = 0x0000_0010;
        const MOUNT_POINT: u32 = 0xA000_0003;
        const SYMLINK: u32 = 0xA000_000C;
        const LX_SYMLINK: u32 = 0xA000_001D;
        const WCI_LINK: u32 = 0xA000_0027;
        const CLOUD: u32 = 0x9000_001A;
        const CLOUD_3: u32 = 0x9000_301A;
        const CLOUD_F: u32 = 0x9000_F01A;
        const ONEDRIVE: u32 = 0x8000_0021;
        const PROJFS: u32 = 0x9000_001C;
        const APPEXECLINK: u32 = 0x8000_001B;
        assert_eq!(classify_reparse_tag(DIRECTORY, SYMLINK), ReparseClass::None);
        for tag in [MOUNT_POINT, SYMLINK, LX_SYMLINK, WCI_LINK] {
            assert_eq!(
                classify_reparse_tag(REPARSE | DIRECTORY, tag),
                ReparseClass::NameSurrogate,
                "{tag:#x}"
            );
        }
        for tag in [CLOUD, CLOUD_3, CLOUD_F, ONEDRIVE] {
            assert_eq!(
                classify_reparse_tag(REPARSE | DIRECTORY, tag),
                ReparseClass::Cloud,
                "{tag:#x}"
            );
        }
        for tag in [PROJFS, APPEXECLINK] {
            assert_eq!(
                classify_reparse_tag(REPARSE | DIRECTORY, tag),
                ReparseClass::Other,
                "{tag:#x}"
            );
        }
        assert!(ReparseClass::None.opens_as_folder());
        assert!(ReparseClass::Cloud.opens_as_folder());
        assert!(ReparseClass::Other.opens_as_folder());
        assert!(!ReparseClass::NameSurrogate.opens_as_folder());
    }

    #[test]
    fn a_plain_directory_has_no_reparse_class() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(reparse_class(directory.path()).unwrap(), ReparseClass::None);
    }

    #[cfg(windows)]
    #[test]
    fn a_junction_is_a_name_surrogate() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("target");
        let link = directory.path().join("link");
        std::fs::create_dir(&target).unwrap();
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&target)
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(reparse_class(&link).unwrap(), ReparseClass::NameSurrogate);
        assert!(is_reparse_point(&std::fs::symlink_metadata(&link).unwrap()));
    }
}
