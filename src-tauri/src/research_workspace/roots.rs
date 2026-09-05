use super::model::{
    AddResearchRootRequest, LinkedResearchRoot, ResearchRootAccess, ResearchRootCapability,
    ResearchRootConsumer, ResearchRootFileContent, ResearchRootFileEntry, ResearchRootListing,
    ResearchRootOperation, ResearchWorkspace, UpdateResearchRootRequest,
};
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const WORKSPACE_VERSION: u8 = 1;
const MAX_ROOTS: usize = 32;
const MAX_LABEL_BYTES: usize = 120;
const MAX_LIST_ENTRIES: usize = 2_000;
const MAX_LIST_DEPTH: usize = 8;
const MAX_READ_BYTES: usize = 4 * 1024 * 1024;
const MAX_WRITE_BYTES: usize = 8 * 1024 * 1024;

fn mutation_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or_default()
}

fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt as _;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        false
    }
}

fn ensure_real_directory(path: &Path, label: &str) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("could not inspect {label}: {error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(format!("{label} must be a real directory"));
    }
    Ok(())
}

#[cfg(unix)]
fn directory_identity(path: &Path) -> Result<String, String> {
    use std::os::unix::fs::MetadataExt as _;
    let metadata = std::fs::metadata(path)
        .map_err(|error| format!("could not read linked-folder identity: {error}"))?;
    Ok(format!("unix:{}:{}", metadata.dev(), metadata.ino()))
}

#[cfg(windows)]
fn directory_identity(path: &Path) -> Result<String, String> {
    use std::os::windows::fs::OpenOptionsExt as _;
    use std::os::windows::io::AsRawHandle as _;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS,
    };
    let directory = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
        .map_err(|error| format!("could not open linked-folder identity: {error}"))?;
    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    let succeeded = unsafe {
        GetFileInformationByHandle(
            directory.as_raw_handle(),
            std::ptr::addr_of_mut!(information),
        )
    };
    if succeeded == 0 {
        return Err(format!(
            "could not read linked-folder identity: {}",
            std::io::Error::last_os_error()
        ));
    }
    let index =
        (u64::from(information.nFileIndexHigh) << 32) | u64::from(information.nFileIndexLow);
    Ok(format!(
        "windows:{}:{index}",
        information.dwVolumeSerialNumber
    ))
}

#[cfg(not(any(unix, windows)))]
fn directory_identity(path: &Path) -> Result<String, String> {
    Ok(format!("path:{}", path.to_string_lossy()))
}

fn workspace_store_root() -> Result<PathBuf, String> {
    let data = crate::paths::oleafly_root()?;
    if !data.exists() {
        std::fs::create_dir_all(&data)
            .map_err(|error| format!("could not create Oleafly data directory: {error}"))?;
    }
    ensure_real_directory(&data, "Oleafly data directory")?;
    let data = data
        .canonicalize()
        .map_err(|error| format!("could not resolve Oleafly data directory: {error}"))?;
    let root = data.join("research-workspaces");
    match std::fs::symlink_metadata(&root) {
        Ok(_) => ensure_real_directory(&root, "research workspace directory")?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(&root).map_err(|error| {
                format!("could not create research workspace directory: {error}")
            })?;
            ensure_real_directory(&root, "research workspace directory")?;
        }
        Err(error) => {
            return Err(format!(
                "could not inspect research workspace directory: {error}"
            ));
        }
    }
    let root = root
        .canonicalize()
        .map_err(|error| format!("could not resolve research workspace directory: {error}"))?;
    if root.parent() != Some(data.as_path()) {
        return Err("research workspace directory escapes the Oleafly data directory".into());
    }
    Ok(root)
}

fn workspace_path(project_id: &str) -> Result<PathBuf, String> {
    crate::paths::validate_project_id(project_id)?;
    let _ = crate::paths::project_dir(project_id)?;
    Ok(workspace_store_root()?.join(format!("{project_id}.json")))
}

fn empty_workspace(project_id: &str) -> ResearchWorkspace {
    ResearchWorkspace {
        version: WORKSPACE_VERSION,
        primary_project_id: project_id.to_string(),
        roots: Vec::new(),
        updated_at_ms: now_ms(),
    }
}

fn read_workspace_from(path: &Path, project_id: &str) -> Result<ResearchWorkspace, String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(empty_workspace(project_id));
        }
        Err(error) => return Err(format!("could not inspect research workspace: {error}")),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("research workspace metadata must be a regular file".into());
    }
    let limit = 256 * 1024;
    let mut bytes = Vec::with_capacity(limit);
    File::open(path)
        .map_err(|error| format!("could not open research workspace: {error}"))?
        .take(limit.saturating_add(1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("could not read research workspace: {error}"))?;
    if bytes.len() > limit {
        return Err("research workspace metadata is too large".into());
    }
    let workspace: ResearchWorkspace = serde_json::from_slice(&bytes)
        .map_err(|error| format!("research workspace metadata is invalid: {error}"))?;
    if workspace.version != WORKSPACE_VERSION || workspace.primary_project_id != project_id {
        return Err("research workspace metadata does not match this project".into());
    }
    if workspace.roots.len() > MAX_ROOTS {
        return Err("research workspace has too many linked folders".into());
    }
    Ok(workspace)
}

fn write_workspace_to(path: &Path, workspace: &ResearchWorkspace) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(workspace)
        .map_err(|error| format!("could not encode research workspace: {error}"))?;
    crate::sandbox::atomic_write(path, &bytes)?;
    crate::fsperm::harden_file(path);
    Ok(())
}

fn validate_label(label: &str) -> Result<String, String> {
    let label = label.trim();
    if label.is_empty() {
        return Err("Folder label cannot be empty.".into());
    }
    if label.len() > MAX_LABEL_BYTES || label.chars().any(char::is_control) {
        return Err("Folder label must be 120 characters or fewer.".into());
    }
    Ok(label.to_string())
}

fn canonical_root(path: &str) -> Result<PathBuf, String> {
    let requested = Path::new(path);
    if !requested.is_absolute() {
        return Err("Choose an absolute folder path.".into());
    }
    ensure_real_directory(requested, "linked folder")?;
    let canonical = requested
        .canonicalize()
        .map_err(|error| format!("could not resolve linked folder: {error}"))?;
    ensure_real_directory(&canonical, "linked folder")?;
    Ok(canonical)
}

fn portable_path(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| "The linked folder path is not valid Unicode.".to_string())
}

fn validate_root_separation(project_id: &str, candidate: &Path) -> Result<(), String> {
    let project = crate::paths::project_dir(project_id)?
        .canonicalize()
        .map_err(|error| format!("could not resolve manuscript project: {error}"))?;
    if candidate == project || candidate.starts_with(&project) || project.starts_with(candidate) {
        return Err("Choose a folder outside the manuscript project.".into());
    }
    let data = crate::paths::oleafly_root()?;
    if data.exists() {
        let data = data
            .canonicalize()
            .map_err(|error| format!("could not resolve Oleafly data directory: {error}"))?;
        if candidate == data || candidate.starts_with(&data) || data.starts_with(candidate) {
            return Err("Choose a folder outside Oleafly's app data.".into());
        }
    }
    Ok(())
}

fn new_root_id() -> String {
    format!("root-{:032x}", rand::random::<u128>())
}

pub fn get_workspace(project_id: &str) -> Result<ResearchWorkspace, String> {
    let path = workspace_path(project_id)?;
    read_workspace_from(&path, project_id)
}

pub fn add_root(request: AddResearchRootRequest) -> Result<ResearchWorkspace, String> {
    let _guard = mutation_lock()
        .lock()
        .map_err(|_| "research workspace lock is unavailable".to_string())?;
    let path = workspace_path(&request.project_id)?;
    let mut workspace = read_workspace_from(&path, &request.project_id)?;
    if workspace.roots.len() >= MAX_ROOTS {
        return Err(format!("A workspace can link up to {MAX_ROOTS} folders."));
    }
    let label = validate_label(&request.label)?;
    let canonical = canonical_root(&request.path)?;
    validate_root_separation(&request.project_id, &canonical)?;
    if workspace.roots.iter().any(|root| {
        Path::new(&root.canonical_path) == canonical
            || root.label.eq_ignore_ascii_case(label.as_str())
    }) {
        return Err("This folder or label is already linked.".into());
    }
    workspace.roots.push(LinkedResearchRoot {
        id: new_root_id(),
        canonical_path: portable_path(&canonical)?,
        identity: directory_identity(&canonical)?,
        label,
        role: request.role,
        access: request.access,
        created_at_ms: now_ms(),
    });
    workspace.updated_at_ms = now_ms();
    write_workspace_to(&path, &workspace)?;
    Ok(workspace)
}

pub fn update_root(request: UpdateResearchRootRequest) -> Result<ResearchWorkspace, String> {
    let _guard = mutation_lock()
        .lock()
        .map_err(|_| "research workspace lock is unavailable".to_string())?;
    let path = workspace_path(&request.project_id)?;
    let mut workspace = read_workspace_from(&path, &request.project_id)?;
    let label = validate_label(&request.label)?;
    if workspace
        .roots
        .iter()
        .any(|root| root.id != request.root_id && root.label.eq_ignore_ascii_case(&label))
    {
        return Err("This folder label is already in use.".into());
    }
    let root = workspace
        .roots
        .iter_mut()
        .find(|root| root.id == request.root_id)
        .ok_or_else(|| "Linked folder was not found.".to_string())?;
    let canonical = canonical_root(&root.canonical_path)?;
    if directory_identity(&canonical)? != root.identity {
        return Err("The linked folder was replaced. Unlink it, then add the new folder.".into());
    }
    root.label = label;
    root.role = request.role;
    root.access = request.access;
    workspace.updated_at_ms = now_ms();
    write_workspace_to(&path, &workspace)?;
    Ok(workspace)
}

pub fn remove_root(project_id: &str, root_id: &str) -> Result<ResearchWorkspace, String> {
    let _guard = mutation_lock()
        .lock()
        .map_err(|_| "research workspace lock is unavailable".to_string())?;
    let path = workspace_path(project_id)?;
    remove_root_from(&path, project_id, root_id)
}

fn remove_root_from(
    path: &Path,
    project_id: &str,
    root_id: &str,
) -> Result<ResearchWorkspace, String> {
    let mut workspace = read_workspace_from(path, project_id)?;
    let before = workspace.roots.len();
    workspace.roots.retain(|root| root.id != root_id);
    if workspace.roots.len() == before {
        return Err("Linked folder was not found.".into());
    }
    workspace.updated_at_ms = now_ms();
    write_workspace_to(path, &workspace)?;
    Ok(workspace)
}

fn validate_relative_path(relative_path: &str, allow_empty: bool) -> Result<PathBuf, String> {
    if relative_path.contains('\\') {
        return Err("Folder paths must use forward slashes.".into());
    }
    let path = Path::new(relative_path);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        if allow_empty && relative_path.is_empty() {
            return Ok(PathBuf::new());
        }
        return Err("The linked-folder path is not valid.".into());
    }
    if relative_path.is_empty() && !allow_empty {
        return Err("Choose a file inside the linked folder.".into());
    }
    Ok(path.to_path_buf())
}

fn find_root(project_id: &str, root_id: &str) -> Result<LinkedResearchRoot, String> {
    get_workspace(project_id)?
        .roots
        .into_iter()
        .find(|root| root.id == root_id)
        .ok_or_else(|| "Linked folder was not found.".to_string())
}

fn effective_access(
    root: &LinkedResearchRoot,
    consumer: ResearchRootConsumer,
) -> ResearchRootAccess {
    match consumer {
        ResearchRootConsumer::Task => ResearchRootAccess::ReadOnly,
        ResearchRootConsumer::Native | ResearchRootConsumer::Acp => root.access,
    }
}

pub(crate) fn resolve_root_path(
    project_id: &str,
    root_id: &str,
    relative_path: &str,
    operation: ResearchRootOperation,
    consumer: ResearchRootConsumer,
    allow_missing_leaf: bool,
) -> Result<PathBuf, String> {
    let root = find_root(project_id, root_id)?;
    if operation == ResearchRootOperation::Write
        && effective_access(&root, consumer) != ResearchRootAccess::ReadWrite
    {
        return Err("This linked folder is read-only.".into());
    }
    let canonical = canonical_root(&root.canonical_path)?;
    if canonical.to_string_lossy() != root.canonical_path {
        return Err("The linked folder no longer matches its saved location.".into());
    }
    if directory_identity(&canonical)? != root.identity {
        return Err("The linked folder was replaced. Unlink it, then add the new folder.".into());
    }
    validate_root_separation(project_id, &canonical)?;
    let relative = validate_relative_path(relative_path, true)?;
    let mut current = canonical.clone();
    let components: Vec<_> = relative.components().collect();
    for (index, component) in components.iter().enumerate() {
        let Component::Normal(segment) = component else {
            return Err("The linked-folder path is not valid.".into());
        };
        current.push(segment);
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
                    return Err("Symbolic links are blocked inside linked folders.".into());
                }
                if index + 1 < components.len() && !metadata.is_dir() {
                    return Err("A linked-folder path component is not a folder.".into());
                }
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::NotFound
                    && allow_missing_leaf
                    && index + 1 == components.len() => {}
            Err(error) => return Err(format!("could not inspect linked-folder path: {error}")),
        }
    }
    if let Ok(resolved) = current.canonicalize() {
        if !resolved.starts_with(&canonical) {
            return Err("The linked-folder path escapes its allowed root.".into());
        }
    }
    Ok(current)
}

pub fn capabilities(
    project_id: &str,
    consumer: ResearchRootConsumer,
) -> Result<Vec<ResearchRootCapability>, String> {
    let workspace = get_workspace(project_id)?;
    workspace
        .roots
        .iter()
        .map(|root| {
            let canonical = canonical_root(&root.canonical_path)?;
            validate_root_separation(project_id, &canonical)?;
            if directory_identity(&canonical)? != root.identity {
                return Err(
                    "The linked folder was replaced. Unlink it, then add the new folder.".into(),
                );
            }
            let effective = effective_access(root, consumer);
            let exposure = match consumer {
                ResearchRootConsumer::Native => "native_capability",
                ResearchRootConsumer::Task => "native_read_context",
                ResearchRootConsumer::Acp if effective == ResearchRootAccess::ReadOnly => {
                    "context_only"
                }
                ResearchRootConsumer::Acp => "native_capability",
            };
            let canonical_path = match consumer {
                ResearchRootConsumer::Task => None,
                ResearchRootConsumer::Acp if effective == ResearchRootAccess::ReadOnly => None,
                ResearchRootConsumer::Native | ResearchRootConsumer::Acp => {
                    Some(portable_path(&canonical)?)
                }
            };
            Ok(ResearchRootCapability {
                root_id: root.id.clone(),
                label: root.label.clone(),
                role: root.role,
                configured_access: root.access,
                effective_access: effective,
                canonical_path,
                exposure: exposure.to_string(),
            })
        })
        .collect()
}

fn walk_listing(
    root: &Path,
    current: &Path,
    depth: usize,
    max_depth: usize,
    entries: &mut Vec<ResearchRootFileEntry>,
    truncated: &mut bool,
) -> Result<(), String> {
    if entries.len() >= MAX_LIST_ENTRIES {
        *truncated = true;
        return Ok(());
    }
    let remaining = MAX_LIST_ENTRIES.saturating_sub(entries.len());
    let mut children = Vec::with_capacity(remaining.min(256));
    let mut directory = std::fs::read_dir(current)
        .map_err(|error| format!("could not list linked folder: {error}"))?;
    for _ in 0..remaining.saturating_add(1) {
        match directory.next() {
            Some(Ok(entry)) => children.push(entry),
            Some(Err(error)) => {
                return Err(format!("could not list linked folder: {error}"));
            }
            None => break,
        }
    }
    if children.len() > remaining {
        children.truncate(remaining);
        *truncated = true;
    }
    children.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());
    for child in children {
        if entries.len() >= MAX_LIST_ENTRIES {
            *truncated = true;
            break;
        }
        let path = child.path();
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| format!("could not inspect linked-folder entry: {error}"))?;
        let is_symlink = metadata.file_type().is_symlink() || is_reparse_point(&metadata);
        let relative = path
            .strip_prefix(root)
            .map_err(|_| "linked-folder entry escaped its root".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        entries.push(ResearchRootFileEntry {
            relative_path: relative,
            name: child.file_name().to_string_lossy().into_owned(),
            is_directory: metadata.is_dir() && !is_symlink,
            is_symlink,
            size: if metadata.is_file() {
                metadata.len()
            } else {
                0
            },
        });
        if metadata.is_dir() && !is_symlink {
            if depth < max_depth {
                walk_listing(root, &path, depth + 1, max_depth, entries, truncated)?;
            } else if std::fs::read_dir(&path)
                .map(|mut values| values.next().is_some())
                .unwrap_or(false)
            {
                *truncated = true;
            }
        }
    }
    Ok(())
}

pub fn list_root_files(
    project_id: &str,
    root_id: &str,
    relative_path: &str,
    max_depth: usize,
) -> Result<ResearchRootListing, String> {
    let root_path = resolve_root_path(
        project_id,
        root_id,
        "",
        ResearchRootOperation::Read,
        ResearchRootConsumer::Native,
        false,
    )?;
    let start = resolve_root_path(
        project_id,
        root_id,
        relative_path,
        ResearchRootOperation::Read,
        ResearchRootConsumer::Native,
        false,
    )?;
    ensure_real_directory(&start, "linked folder selection")?;
    let mut entries = Vec::new();
    let mut truncated = false;
    walk_listing(
        &root_path,
        &start,
        0,
        max_depth.min(MAX_LIST_DEPTH),
        &mut entries,
        &mut truncated,
    )?;
    Ok(ResearchRootListing {
        root_id: root_id.to_string(),
        path: relative_path.to_string(),
        entries,
        truncated,
    })
}

pub fn read_root_file(
    project_id: &str,
    root_id: &str,
    relative_path: &str,
    max_bytes: usize,
) -> Result<ResearchRootFileContent, String> {
    let path = resolve_root_path(
        project_id,
        root_id,
        relative_path,
        ResearchRootOperation::Read,
        ResearchRootConsumer::Native,
        false,
    )?;
    let metadata = std::fs::symlink_metadata(&path)
        .map_err(|error| format!("could not inspect linked file: {error}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("Choose a regular file inside the linked folder.".into());
    }
    let limit = max_bytes.clamp(1, MAX_READ_BYTES);
    let mut bytes = Vec::with_capacity(limit.min(64 * 1024));
    File::open(&path)
        .map_err(|error| format!("could not open linked file: {error}"))?
        .take(limit.saturating_add(1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("could not read linked file: {error}"))?;
    let truncated = bytes.len() > limit;
    bytes.truncate(limit);
    let is_binary = bytes.contains(&0);
    let content = if is_binary {
        String::new()
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    };
    Ok(ResearchRootFileContent {
        root_id: root_id.to_string(),
        relative_path: relative_path.to_string(),
        content,
        bytes_read: bytes.len(),
        truncated,
        is_binary,
    })
}

pub(crate) fn write_root_file(
    project_id: &str,
    root_id: &str,
    relative_path: &str,
    bytes: &[u8],
    consumer: ResearchRootConsumer,
) -> Result<(), String> {
    if bytes.len() > MAX_WRITE_BYTES {
        return Err("Linked-folder writes are limited to 8 MiB.".into());
    }
    let path = resolve_root_path(
        project_id,
        root_id,
        relative_path,
        ResearchRootOperation::Write,
        consumer,
        true,
    )?;
    let parent = path
        .parent()
        .ok_or_else(|| "Linked file has no parent folder.".to_string())?;
    ensure_real_directory(parent, "linked file parent")?;
    crate::sandbox::atomic_write(&path, bytes)
}

#[cfg(test)]
pub(super) fn workspace_path_for_test(root: &Path, project_id: &str) -> PathBuf {
    root.join(format!("{project_id}.json"))
}

#[cfg(test)]
pub(super) fn read_workspace_for_test(
    path: &Path,
    project_id: &str,
) -> Result<ResearchWorkspace, String> {
    read_workspace_from(path, project_id)
}

#[cfg(test)]
pub(super) fn write_workspace_for_test(
    path: &Path,
    workspace: &ResearchWorkspace,
) -> Result<(), String> {
    write_workspace_to(path, workspace)
}

#[cfg(test)]
pub(super) fn remove_root_for_test(
    path: &Path,
    project_id: &str,
    root_id: &str,
) -> Result<ResearchWorkspace, String> {
    remove_root_from(path, project_id, root_id)
}
