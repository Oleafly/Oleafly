use crate::project_location::{ProjectKind, ProjectLocation};
use oleafly_history::{
    CaptureInput, CheckpointFile, ContentHash, HistoryError, DETACHED_MANIFEST_PATH,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::{Component, Path, PathBuf};

const EXCLUDED_EXACT: [&str; 3] = [".git", ".oleafly", "node_modules"];
const EXCLUDED_PREFIX: [&str; 2] = ["_minted-", "pythontex-files-"];

#[derive(Clone, Debug)]
pub struct CapturedFile {
    pub relative_path: String,
    pub content_hash: ContentHash,
}

#[derive(Clone, Debug, Default)]
pub struct ProjectWalk {
    pub captured: Vec<CapturedFile>,
}

impl ProjectWalk {
    pub fn capture_inputs(&self) -> Result<Vec<CaptureInput>, String> {
        self.captured
            .iter()
            .map(|file| {
                CaptureInput::explicit(file.relative_path.clone())
                    .map_err(|error| error.to_string())
            })
            .collect()
    }

    pub fn matches_checkpoint(&self, files: &[CheckpointFile]) -> bool {
        let recorded = files
            .iter()
            .map(|file| (file.relative_path.as_str(), file.content_hash))
            .collect::<BTreeMap<_, _>>();
        if recorded.len() != self.captured.len() {
            return false;
        }
        self.captured
            .iter()
            .all(|file| recorded.get(file.relative_path.as_str()) == Some(&file.content_hash))
    }
}

pub fn is_excluded_component(component: &str) -> bool {
    if EXCLUDED_EXACT
        .iter()
        .any(|name| component.eq_ignore_ascii_case(name))
    {
        return true;
    }
    EXCLUDED_PREFIX.iter().any(|prefix| {
        let component = component.as_bytes();
        let prefix = prefix.as_bytes();
        component.len() > prefix.len() && component[..prefix.len()].eq_ignore_ascii_case(prefix)
    })
}

fn portable_relative(relative: &Path) -> Option<String> {
    let mut portable = String::new();
    for component in relative.components() {
        let Component::Normal(part) = component else {
            return None;
        };
        let part = part.to_str()?;
        if !portable.is_empty() {
            portable.push('/');
        }
        portable.push_str(part);
    }
    (!portable.is_empty()).then_some(portable)
}

pub fn walk_project(project_root: &Path) -> Result<ProjectWalk, String> {
    walk_project_with(project_root, |_| {}).map_err(|error| error.to_string())
}

fn walk_project_with(
    project_root: &Path,
    mut before_read: impl FnMut(&Path),
) -> std::io::Result<ProjectWalk> {
    match walk_project_once(project_root, &mut before_read) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            walk_project_once(project_root, &mut before_read)
        }
        result => result,
    }
}

fn walk_project_once(
    project_root: &Path,
    before_read: &mut impl FnMut(&Path),
) -> std::io::Result<ProjectWalk> {
    let mut walk = ProjectWalk::default();
    let mut pending = vec![project_root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        before_read(&directory);
        let entries = std::fs::read_dir(&directory).map_err(|error| {
            std::io::Error::new(
                error.kind(),
                format!("Could not read {}: {error}", directory.display()),
            )
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| {
                std::io::Error::new(
                    error.kind(),
                    format!("Could not read a directory entry: {error}"),
                )
            })?;
            let path = entry.path();
            let relative = path
                .strip_prefix(project_root)
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error))?;
            let name = entry.file_name();
            if name.to_str().is_some_and(is_excluded_component) {
                continue;
            }
            let portable = portable_relative(relative).ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!("Unsupported checkpoint path: {}", relative.display()),
                )
            })?;
            CaptureInput::explicit(portable.clone()).map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, format!("The name {portable} cannot be stored in a checkpoint. Use a name that works on macOS, Windows and Linux.")))?;
            before_read(&path);
            let metadata = entry.metadata().map_err(|error| {
                std::io::Error::new(
                    error.kind(),
                    format!("Could not inspect {portable}: {error}"),
                )
            })?;
            if metadata.is_dir() {
                pending.push(path);
                continue;
            }
            if !metadata.is_file() {
                return Err(std::io::Error::new(std::io::ErrorKind::Unsupported, format!("{portable} is not a regular file. Checkpoints cannot capture symbolic links or special files.")));
            }
            let content_hash = capture_hash(&path, &portable)?;
            walk.captured.push(CapturedFile {
                relative_path: portable,
                content_hash,
            });
        }
    }
    walk.captured
        .sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(walk)
}

fn capture_hash(path: &Path, relative: &str) -> std::io::Result<ContentHash> {
    ContentHash::digest_file(path).map_err(|error| {
        let kind = match &error {
            oleafly_history::HistoryError::Io(error) => error.kind(),
            _ => std::io::ErrorKind::Other,
        };
        std::io::Error::new(kind, format!("Could not read {relative}: {error}"))
    })
}

pub(crate) const LINKED_FILE_LIMIT: u64 = 5_000;
pub(crate) const LINKED_BYTE_LIMIT: u64 = 512 * 1024 * 1024;
pub(crate) const LINKED_LARGE_FILE_BYTES: u64 = 25 * 1024 * 1024;
pub(crate) const CAPTURE_NOTICE_FILE: &str = "checkpoint-capture.json";
const MAX_RECORDER_BYTES: u64 = 8 * 1024 * 1024;
const MAX_NOTICE_BYTES: u64 = 64 * 1024;
const LINKED_SKIPPED_DIRECTORIES: [&str; 5] =
    ["node_modules", "target", "build", "out", "__MACOSX"];
const LINKED_SKIPPED_DIRECTORY_PREFIXES: [&str; 2] = ["_minted", "pythontex-files-"];
const OS_METADATA_FILES: [&str; 5] = [
    ".DS_Store",
    "Thumbs.db",
    "ehthumbs.db",
    "desktop.ini",
    "Icon\r",
];
#[cfg(any(target_os = "macos", test))]
const MACOS_DATALESS_FLAG: u32 = 0x4000_0000;
#[cfg(any(windows, test))]
const WINDOWS_PLACEHOLDER_ATTRIBUTES: u32 = 0x0000_1000 | 0x0004_0000 | 0x0040_0000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EntryProbe {
    Local,
    Placeholder,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct SkippedFiles {
    pub(crate) links: u64,
    pub(crate) unsupported_names: u64,
    pub(crate) large: u64,
    pub(crate) cloud: u64,
    pub(crate) other: u64,
}

#[derive(Clone, Copy)]
enum SkipKind {
    Link,
    UnsupportedName,
    Large,
    Cloud,
    Other,
}

impl SkippedFiles {
    pub(crate) fn count(&self) -> u64 {
        self.links
            .saturating_add(self.unsupported_names)
            .saturating_add(self.large)
            .saturating_add(self.cloud)
            .saturating_add(self.other)
    }

    fn record(&mut self, kind: SkipKind) {
        let counter = match kind {
            SkipKind::Link => &mut self.links,
            SkipKind::UnsupportedName => &mut self.unsupported_names,
            SkipKind::Large => &mut self.large,
            SkipKind::Cloud => &mut self.cloud,
            SkipKind::Other => &mut self.other,
        };
        *counter = counter.saturating_add(1);
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CapturePause {
    pub(crate) files: u64,
    pub(crate) bytes: u64,
    pub(crate) file_limit: u64,
    pub(crate) byte_limit: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CaptureNotice {
    pub(crate) paused: Option<CapturePause>,
    pub(crate) skipped: SkippedFiles,
}

impl CaptureNotice {
    pub(crate) fn is_quiet(&self) -> bool {
        self.paused.is_none() && self.skipped.count() == 0
    }
}

#[derive(Clone, Debug)]
pub(crate) struct LinkedCapturePolicy {
    pub(crate) forced: BTreeSet<String>,
    pub(crate) file_limit: u64,
    pub(crate) byte_limit: u64,
    pub(crate) large_file_bytes: u64,
}

impl LinkedCapturePolicy {
    pub(crate) fn new(forced: BTreeSet<String>) -> Self {
        Self {
            forced,
            file_limit: LINKED_FILE_LIMIT,
            byte_limit: LINKED_BYTE_LIMIT,
            large_file_bytes: LINKED_LARGE_FILE_BYTES,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct LinkedCapture {
    pub(crate) walk: ProjectWalk,
    pub(crate) detached_manifest: Option<PathBuf>,
    pub(crate) notice: CaptureNotice,
}

impl LinkedCapture {
    pub(crate) fn capture_inputs(&self) -> Result<Vec<CaptureInput>, String> {
        let mut inputs = self
            .walk
            .captured
            .iter()
            .filter(|file| file.relative_path != DETACHED_MANIFEST_PATH)
            .map(|file| {
                CaptureInput::explicit(file.relative_path.clone())
                    .map_err(|error| error.to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        if let Some(source) = &self.detached_manifest {
            inputs.push(CaptureInput::detached_manifest(source.clone()));
        }
        Ok(inputs)
    }
}

struct LinkedEntry {
    relative: String,
    path: PathBuf,
    bytes: u64,
}

enum EntryDecision {
    Ignore,
    Skip(SkipKind),
    Descend(PathBuf),
    Capture(LinkedEntry),
}

fn starts_with_ignoring_case(name: &str, prefix: &str) -> bool {
    name.as_bytes()
        .get(..prefix.len())
        .is_some_and(|head| head.eq_ignore_ascii_case(prefix.as_bytes()))
}

fn is_oleafly_owned(name: &str) -> bool {
    starts_with_ignoring_case(name, ".oleafly")
        || (name.starts_with('.') && name.ends_with(".tmp") && name.contains(".oleafly-"))
}

fn is_os_metadata(name: &str) -> bool {
    name.starts_with("._")
        || OS_METADATA_FILES
            .iter()
            .any(|junk| name.eq_ignore_ascii_case(junk))
}

fn is_left_out_quietly(name: &str) -> bool {
    is_oleafly_owned(name) || is_os_metadata(name) || name.eq_ignore_ascii_case(".git")
}

fn is_skipped_directory(name: &str) -> bool {
    name.starts_with('.')
        || LINKED_SKIPPED_DIRECTORIES
            .iter()
            .any(|skipped| name.eq_ignore_ascii_case(skipped))
        || LINKED_SKIPPED_DIRECTORY_PREFIXES
            .iter()
            .any(|prefix| starts_with_ignoring_case(name, prefix))
}

#[cfg(any(target_os = "macos", test))]
fn dataless_flag(flags: u32) -> bool {
    flags & MACOS_DATALESS_FLAG != 0
}

#[cfg(any(windows, test))]
fn windows_placeholder_attributes(attributes: u32) -> bool {
    attributes & WINDOWS_PLACEHOLDER_ATTRIBUTES != 0
}

#[cfg(target_os = "macos")]
fn is_cloud_placeholder(metadata: &std::fs::Metadata) -> bool {
    use std::os::macos::fs::MetadataExt as _;
    dataless_flag(metadata.st_flags())
}

#[cfg(windows)]
fn is_cloud_placeholder(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;
    windows_placeholder_attributes(metadata.file_attributes())
}

#[cfg(not(any(target_os = "macos", windows)))]
fn is_cloud_placeholder(_metadata: &std::fs::Metadata) -> bool {
    false
}

fn probe_entry(_path: &Path, metadata: &std::fs::Metadata) -> EntryProbe {
    if is_cloud_placeholder(metadata) {
        EntryProbe::Placeholder
    } else {
        EntryProbe::Local
    }
}

pub(crate) fn walk_linked_folder(
    root: &Path,
    sidecar: Option<&Path>,
    policy: &LinkedCapturePolicy,
) -> Result<LinkedCapture, String> {
    walk_linked_folder_with(root, sidecar, policy, probe_entry, |_| {})
}

fn decide_entry(
    root: &Path,
    entry: std::io::Result<std::fs::DirEntry>,
    policy: &LinkedCapturePolicy,
    forced: &HashSet<String>,
    probe: &mut impl FnMut(&Path, &std::fs::Metadata) -> EntryProbe,
    seen: &mut HashSet<String>,
) -> EntryDecision {
    let Ok(entry) = entry else {
        return EntryDecision::Skip(SkipKind::Other);
    };
    let path = entry.path();
    let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
        return EntryDecision::Skip(SkipKind::UnsupportedName);
    };
    if is_left_out_quietly(&name) {
        return EntryDecision::Ignore;
    }
    let metadata = match entry.metadata() {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return EntryDecision::Ignore,
        Err(_) => return EntryDecision::Skip(SkipKind::Other),
    };
    let relative = path.strip_prefix(root).ok().and_then(portable_relative);
    if let Some(relative) = &relative {
        seen.insert(oleafly_history::portable_fold(relative));
    }
    if metadata.file_type().is_symlink() {
        return EntryDecision::Skip(SkipKind::Link);
    }
    if crate::paths::is_reparse_point(&metadata)
        || probe(&path, &metadata) == EntryProbe::Placeholder
    {
        return EntryDecision::Skip(SkipKind::Cloud);
    }
    if metadata.is_dir() {
        return if is_skipped_directory(&name) {
            EntryDecision::Ignore
        } else {
            EntryDecision::Descend(path)
        };
    }
    if !metadata.is_file() {
        return EntryDecision::Skip(SkipKind::Other);
    }
    let Some(relative) =
        relative.filter(|relative| CaptureInput::explicit(relative.clone()).is_ok())
    else {
        return EntryDecision::Skip(SkipKind::UnsupportedName);
    };
    if metadata.len() > policy.large_file_bytes
        && !forced.contains(&oleafly_history::portable_fold(&relative))
    {
        return EntryDecision::Skip(SkipKind::Large);
    }
    EntryDecision::Capture(LinkedEntry {
        relative,
        path,
        bytes: metadata.len(),
    })
}

fn forced_entry(
    root: &Path,
    relative: &str,
    probe: &mut impl FnMut(&Path, &std::fs::Metadata) -> EntryProbe,
) -> Option<LinkedEntry> {
    CaptureInput::explicit(relative.to_owned()).ok()?;
    let parts = relative.split('/').collect::<Vec<_>>();
    if parts.iter().any(|part| is_left_out_quietly(part)) {
        return None;
    }
    let mut current = root.to_path_buf();
    for (index, part) in parts.iter().enumerate() {
        current.push(part);
        let metadata = std::fs::symlink_metadata(&current).ok()?;
        if metadata.file_type().is_symlink()
            || crate::paths::is_reparse_point(&metadata)
            || probe(&current, &metadata) == EntryProbe::Placeholder
        {
            return None;
        }
        if index + 1 == parts.len() {
            return metadata.is_file().then(|| LinkedEntry {
                relative: relative.to_owned(),
                path: current.clone(),
                bytes: metadata.len(),
            });
        }
        if !metadata.is_dir() {
            return None;
        }
    }
    None
}

fn drop_conflicting_names(entries: &mut Vec<LinkedEntry>, notice: &mut CaptureNotice) {
    let dropped = oleafly_history::conflicting_portable_paths(
        entries.iter().map(|entry| entry.relative.as_str()),
    );
    if dropped.is_empty() {
        return;
    }
    notice.skipped.unsupported_names = notice
        .skipped
        .unsupported_names
        .saturating_add(dropped.len() as u64);
    entries.retain(|entry| !dropped.contains(&entry.relative));
}

fn over_budget(entries: &[LinkedEntry], policy: &LinkedCapturePolicy) -> Option<CapturePause> {
    let files = entries.len() as u64;
    let bytes = entries
        .iter()
        .fold(0_u64, |total, entry| total.saturating_add(entry.bytes));
    (files > policy.file_limit || bytes > policy.byte_limit).then_some(CapturePause {
        files,
        bytes,
        file_limit: policy.file_limit,
        byte_limit: policy.byte_limit,
    })
}

fn seal_sidecar(sidecar: Option<&Path>, walk: &mut ProjectWalk) -> Result<Option<PathBuf>, String> {
    let Some(sidecar) = sidecar else {
        return Ok(None);
    };
    let metadata = match std::fs::symlink_metadata(sidecar) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("could not inspect the folder settings: {error}")),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("the folder settings file is not a regular file".into());
    }
    let content_hash = ContentHash::digest_file(sidecar)
        .map_err(|error| format!("could not read the folder settings: {error}"))?;
    walk.captured.push(CapturedFile {
        relative_path: DETACHED_MANIFEST_PATH.to_owned(),
        content_hash,
    });
    Ok(Some(sidecar.to_path_buf()))
}

fn walk_linked_entries(
    root: &Path,
    policy: &LinkedCapturePolicy,
    probe: &mut impl FnMut(&Path, &std::fs::Metadata) -> EntryProbe,
    notice: &mut CaptureNotice,
) -> Result<(Vec<LinkedEntry>, HashSet<String>), String> {
    let forced = policy
        .forced
        .iter()
        .map(|relative| oleafly_history::portable_fold(relative))
        .collect::<HashSet<_>>();
    let mut seen = HashSet::new();
    let mut entries = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let listing = match std::fs::read_dir(&directory) {
            Ok(listing) => listing,
            Err(error) if directory.as_path() == root => {
                return Err(format!("Could not read {}: {error}", root.display()))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                notice.skipped.record(SkipKind::Other);
                continue;
            }
        };
        for entry in listing {
            match decide_entry(root, entry, policy, &forced, probe, &mut seen) {
                EntryDecision::Ignore => {}
                EntryDecision::Skip(kind) => notice.skipped.record(kind),
                EntryDecision::Descend(path) => pending.push(path),
                EntryDecision::Capture(entry) => entries.push(entry),
            }
            if entries.len() as u64 > policy.file_limit {
                return Ok((entries, seen));
            }
        }
    }
    Ok((entries, seen))
}

fn walk_linked_folder_with(
    root: &Path,
    sidecar: Option<&Path>,
    policy: &LinkedCapturePolicy,
    mut probe: impl FnMut(&Path, &std::fs::Metadata) -> EntryProbe,
    mut before_read: impl FnMut(&Path),
) -> Result<LinkedCapture, String> {
    let mut notice = CaptureNotice::default();
    let (mut entries, seen) = walk_linked_entries(root, policy, &mut probe, &mut notice)?;
    let forced = policy
        .forced
        .iter()
        .filter(|relative| !seen.contains(&oleafly_history::portable_fold(relative)))
        .filter_map(|relative| forced_entry(root, relative, &mut probe))
        .collect::<Vec<_>>();
    entries.extend(forced);
    if let Some(pause) = over_budget(&entries, policy) {
        notice.paused = Some(pause);
        return Ok(LinkedCapture {
            notice,
            ..LinkedCapture::default()
        });
    }
    drop_conflicting_names(&mut entries, &mut notice);
    let mut walk = ProjectWalk::default();
    for entry in entries {
        before_read(&entry.path);
        match ContentHash::digest_file(&entry.path) {
            Ok(content_hash) => walk.captured.push(CapturedFile {
                relative_path: entry.relative,
                content_hash,
            }),
            Err(HistoryError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => notice.skipped.record(SkipKind::Other),
        }
    }
    let detached_manifest = seal_sidecar(sidecar, &mut walk)?;
    walk.captured
        .sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(LinkedCapture {
        walk,
        detached_manifest,
        notice,
    })
}

pub(crate) fn recorded_inputs_in(recorder: &Path, root: &Path) -> BTreeSet<String> {
    let Ok(metadata) = std::fs::symlink_metadata(recorder) else {
        return BTreeSet::new();
    };
    if !metadata.is_file() || metadata.len() > MAX_RECORDER_BYTES {
        return BTreeSet::new();
    }
    std::fs::read(recorder)
        .map(|bytes| recorded_inputs(&String::from_utf8_lossy(&bytes), root))
        .unwrap_or_default()
}

pub(crate) fn recorded_inputs(recorder: &str, root: &Path) -> BTreeSet<String> {
    let root = comparable(root);
    let mut working_directory: Option<PathBuf> = None;
    let mut inputs = BTreeSet::new();
    for line in recorder.lines() {
        if let Some(directory) = line.strip_prefix("PWD ") {
            working_directory = Some(comparable(Path::new(directory)));
            continue;
        }
        let Some(input) = line.strip_prefix("INPUT ") else {
            continue;
        };
        let input = comparable(Path::new(input));
        let absolute = if input.is_absolute() {
            input
        } else if let Some(directory) = &working_directory {
            directory.join(input)
        } else {
            continue;
        };
        if let Some(relative) = lexically_normalized(&absolute)
            .and_then(|path| relative_inside(&path, &root))
            .and_then(|relative| portable_relative(&relative))
        {
            inputs.insert(relative);
        }
    }
    inputs
}

fn lexically_normalized(path: &Path) -> Option<PathBuf> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return None;
                }
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    Some(normalized)
}

fn relative_inside(path: &Path, root: &Path) -> Option<PathBuf> {
    let mut remaining = path.components();
    for expected in root.components() {
        let actual = remaining.next()?;
        if !same_component(actual.as_os_str(), expected.as_os_str()) {
            return None;
        }
    }
    let relative = remaining.as_path().to_path_buf();
    (!relative.as_os_str().is_empty()).then_some(relative)
}

#[cfg(windows)]
fn same_component(left: &std::ffi::OsStr, right: &std::ffi::OsStr) -> bool {
    left.to_string_lossy().to_lowercase() == right.to_string_lossy().to_lowercase()
}

#[cfg(not(windows))]
fn same_component(left: &std::ffi::OsStr, right: &std::ffi::OsStr) -> bool {
    left == right
}

#[cfg(windows)]
fn comparable(path: &Path) -> PathBuf {
    let text = path.to_string_lossy().replace('/', "\\");
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text))
}

#[cfg(not(windows))]
fn comparable(path: &Path) -> PathBuf {
    path.to_path_buf()
}

pub(crate) fn record_capture_notice(location: &ProjectLocation, notice: &CaptureNotice) {
    if let Err(error) = write_capture_notice(location, notice) {
        let _ = crate::project::append_app_log(format!(
            "Could not record the history notice for project {}: {error}",
            location.id
        ));
    }
}

fn write_capture_notice(location: &ProjectLocation, notice: &CaptureNotice) -> Result<(), String> {
    if location.kind != ProjectKind::Linked {
        return Ok(());
    }
    let path = location.private_state_dir().join(CAPTURE_NOTICE_FILE);
    if notice.is_quiet() {
        return match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        };
    }
    let bytes = serde_json::to_vec(notice).map_err(|error| error.to_string())?;
    if std::fs::read(&path).is_ok_and(|current| current == bytes) {
        return Ok(());
    }
    let directory = location.ensure_linked_state(&location.private_state_dir())?;
    crate::sandbox::atomic_write(&directory.join(CAPTURE_NOTICE_FILE), &bytes)
}

pub(crate) fn read_capture_notice(project_id: &str) -> Option<CaptureNotice> {
    let state_dir = crate::project_location::linked_state_dir(project_id).ok()??;
    let path = crate::project_location::private_state_dir(ProjectKind::Linked, &state_dir)
        .join(CAPTURE_NOTICE_FILE);
    let metadata = std::fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_NOTICE_BYTES {
        return None;
    }
    serde_json::from_slice(&std::fs::read(&path).ok()?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    fn write(root: &Path, relative: &str, bytes: &[u8]) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, bytes).unwrap();
    }

    fn captured_paths(walk: &ProjectWalk) -> Vec<&str> {
        walk.captured
            .iter()
            .map(|file| file.relative_path.as_str())
            .collect()
    }

    fn linked_walk(root: &Path, sidecar: Option<&Path>) -> LinkedCapture {
        walk_linked_folder(root, sidecar, &LinkedCapturePolicy::new(BTreeSet::new())).unwrap()
    }

    #[test]
    fn linked_capture_skips_denylisted_folders_os_files_and_oleaflys_own_files() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        for relative in [
            "main.tex",
            ".latexmkrc",
            "build.tex",
            "sections/intro.tex",
            ".git/config",
            ".venv/lib/x.py",
            ".oleafly/build/main.pdf",
            "node_modules/pkg/index.js",
            "target/debug/app",
            "build/main.pdf",
            "Out/main.log",
            "_minted-main/a.pygtex",
            "_mintedcache/b",
            "pythontex-files-main/c",
            "__MACOSX/d",
            ".DS_Store",
            "._main.tex",
            "Thumbs.db",
            ".main.tex.oleafly-12-3-00ff.tmp",
            ".oleafly-manifest.json",
        ] {
            write(root, relative, b"x");
        }
        let capture = linked_walk(root, None);
        assert_eq!(
            captured_paths(&capture.walk),
            vec![".latexmkrc", "build.tex", "main.tex", "sections/intro.tex"]
        );
        assert!(capture.notice.is_quiet(), "{:?}", capture.notice);
        assert_eq!(capture.detached_manifest, None);
    }

    #[cfg(unix)]
    #[test]
    fn linked_capture_counts_links_unportable_names_and_large_files_instead_of_failing() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("folder");
        let outside = directory.path().join("outside");
        write(&outside, "refs.bib", b"@book{a}");
        write(&root, "main.tex", b"source");
        write(&root, "CON.tex", b"windows reserves this name");
        write(&root, "aux/notes.tex", b"and this folder name");
        std::os::unix::fs::symlink(outside.join("refs.bib"), root.join("refs.bib")).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("shared")).unwrap();
        std::fs::File::create(root.join("data.bin"))
            .unwrap()
            .set_len(LINKED_LARGE_FILE_BYTES + 1)
            .unwrap();
        let capture = linked_walk(&root, None);
        assert_eq!(captured_paths(&capture.walk), vec!["main.tex"]);
        assert_eq!(
            capture.notice.skipped,
            SkippedFiles {
                links: 2,
                unsupported_names: 2,
                large: 1,
                cloud: 0,
                other: 0
            }
        );
        assert_eq!(capture.notice.paused, None);
    }

    #[test]
    fn linked_capture_keeps_one_of_two_names_that_differ_only_in_case() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "Figure.png", b"upper");
        write(root, "figure.png", b"lower");
        if std::fs::read_dir(root).unwrap().count() < 2 {
            return;
        }
        let capture = linked_walk(root, None);
        assert_eq!(captured_paths(&capture.walk), vec!["Figure.png"]);
        assert_eq!(capture.notice.skipped.unsupported_names, 1);
    }

    #[test]
    fn a_walk_stopped_at_the_file_limit_pauses_even_when_a_name_clash_is_dropped() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "Figure.png", b"upper");
        write(root, "figure.png", b"lower");
        if std::fs::read_dir(root).unwrap().count() < 2 {
            return;
        }
        write(root, "main.tex", b"source");
        write(root, "sections/intro.tex", b"never reached");
        let mut policy = LinkedCapturePolicy::new(BTreeSet::new());
        policy.file_limit = 2;
        let mut reads = 0;
        let capture =
            walk_linked_folder_with(root, None, &policy, probe_entry, |_| reads += 1).unwrap();
        assert_eq!(reads, 0);
        assert!(capture.walk.captured.is_empty());
        assert_eq!(capture.notice.paused.map(|pause| pause.file_limit), Some(2));
    }

    #[test]
    fn a_git_file_is_left_out_quietly_at_any_depth() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        write(root, ".git", b"gitdir: ../.git/worktrees/paper\n");
        write(
            root,
            "vendor/style/.GIT",
            b"gitdir: ../../.git/modules/style\n",
        );
        write(root, "vendor/style/style.sty", b"\\def\\x{}");
        let capture = linked_walk(root, None);
        assert!(capture.notice.is_quiet(), "{:?}", capture.notice);
        assert_eq!(
            captured_paths(&capture.walk),
            vec!["main.tex", "vendor/style/style.sty"]
        );
    }

    #[cfg(unix)]
    #[test]
    fn folder_icon_files_and_a_linked_git_are_left_out_quietly() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("folder");
        write(&root, "main.tex", b"source");
        write(&root, "Icon\r", b"");
        write(&root, "figures/Icon\r", b"");
        write(&root, "figures/plot.pdf", b"%PDF");
        std::os::unix::fs::symlink(directory.path().join("repository"), root.join(".git")).unwrap();
        let capture = linked_walk(&root, None);
        assert_eq!(
            captured_paths(&capture.walk),
            vec!["figures/plot.pdf", "main.tex"]
        );
        assert!(capture.notice.is_quiet(), "{:?}", capture.notice);
    }

    #[test]
    fn a_recorded_input_spelled_in_another_case_still_passes_the_size_cap() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        std::fs::create_dir_all(root.join("figures")).unwrap();
        std::fs::File::create(root.join("figures").join("atlas.pdf"))
            .unwrap()
            .set_len(LINKED_LARGE_FILE_BYTES + 1)
            .unwrap();
        let forced = BTreeSet::from(["Figures/Atlas.pdf".to_string()]);
        let capture = walk_linked_folder(root, None, &LinkedCapturePolicy::new(forced)).unwrap();
        assert_eq!(
            captured_paths(&capture.walk),
            vec!["figures/atlas.pdf", "main.tex"]
        );
        assert!(capture.notice.is_quiet(), "{:?}", capture.notice);
    }

    #[test]
    fn recorded_inputs_are_captured_inside_skipped_folders_and_past_the_size_cap() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        write(root, "build/figure.pdf", b"%PDF");
        write(root, ".tex/macros.sty", b"\\def\\x{}");
        write(root, ".oleafly/build/out.aux", b"aux");
        std::fs::File::create(root.join("atlas.pdf"))
            .unwrap()
            .set_len(LINKED_LARGE_FILE_BYTES + 1)
            .unwrap();
        let forced = BTreeSet::from(
            [
                "build/figure.pdf",
                ".tex/macros.sty",
                "atlas.pdf",
                "missing.tex",
                ".oleafly/build/out.aux",
            ]
            .map(String::from),
        );
        let capture = walk_linked_folder(root, None, &LinkedCapturePolicy::new(forced)).unwrap();
        assert_eq!(
            captured_paths(&capture.walk),
            vec![
                ".tex/macros.sty",
                "atlas.pdf",
                "build/figure.pdf",
                "main.tex"
            ]
        );
        assert!(capture.notice.is_quiet());
    }

    #[test]
    fn a_folder_past_the_budget_pauses_before_any_file_is_read() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        for index in 0..4 {
            write(root, &format!("chapter-{index}.tex"), b"text");
        }
        let mut policy = LinkedCapturePolicy::new(BTreeSet::new());
        policy.file_limit = 3;
        let mut reads = 0;
        let capture =
            walk_linked_folder_with(root, None, &policy, probe_entry, |_| reads += 1).unwrap();
        assert_eq!(reads, 0);
        assert!(capture.walk.captured.is_empty());
        assert_eq!(
            capture.notice.paused,
            Some(CapturePause {
                files: 4,
                bytes: 16,
                file_limit: 3,
                byte_limit: LINKED_BYTE_LIMIT
            })
        );
        policy.file_limit = LINKED_FILE_LIMIT;
        policy.byte_limit = 15;
        assert_eq!(
            walk_linked_folder(root, None, &policy)
                .unwrap()
                .notice
                .paused
                .map(|pause| pause.bytes),
            Some(16)
        );
    }

    #[test]
    fn cloud_placeholders_are_counted_and_never_read() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        write(root, "cloud.pdf", b"remote");
        write(root, "archive/old.tex", b"remote");
        let mut reads = Vec::new();
        let capture = walk_linked_folder_with(
            root,
            None,
            &LinkedCapturePolicy::new(BTreeSet::from(["cloud.pdf".to_string()])),
            |path, _| {
                if path.ends_with("cloud.pdf") || path.ends_with("archive") {
                    EntryProbe::Placeholder
                } else {
                    EntryProbe::Local
                }
            },
            |path| reads.push(path.to_path_buf()),
        )
        .unwrap();
        assert_eq!(captured_paths(&capture.walk), vec!["main.tex"]);
        assert_eq!(capture.notice.skipped.cloud, 2);
        assert_eq!(reads, vec![root.join("main.tex")]);
    }

    #[test]
    fn placeholder_flags_match_the_platform_constants() {
        assert!(dataless_flag(0x4000_0000));
        assert!(!dataless_flag(0x0000_0020));
        assert!(windows_placeholder_attributes(0x0040_0000));
        assert!(windows_placeholder_attributes(0x0004_0000));
        assert!(windows_placeholder_attributes(0x0000_1000));
        assert!(!windows_placeholder_attributes(0x0000_0020 | 0x0000_0400));
    }

    #[cfg(windows)]
    #[test]
    fn windows_placeholder_bits_match_windows_sys() {
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_ATTRIBUTE_OFFLINE, FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS,
            FILE_ATTRIBUTE_RECALL_ON_OPEN,
        };
        assert_eq!(
            WINDOWS_PLACEHOLDER_ATTRIBUTES,
            FILE_ATTRIBUTE_OFFLINE
                | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS
                | FILE_ATTRIBUTE_RECALL_ON_OPEN
        );
    }

    #[test]
    fn the_sidecar_is_captured_under_the_detached_path_and_project_json_as_content() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("folder");
        write(&root, "main.tex", b"source");
        write(&root, "project.json", br#"{"name":"nx"}"#);
        write(
            directory.path(),
            "state/project.json",
            br#"{"main_doc":"main.tex"}"#,
        );
        let sidecar = directory.path().join("state").join("project.json");
        let capture = linked_walk(&root, Some(&sidecar));
        assert_eq!(
            captured_paths(&capture.walk),
            vec![
                oleafly_history::DETACHED_MANIFEST_PATH,
                "main.tex",
                "project.json"
            ]
        );
        assert_eq!(
            capture.detached_manifest.as_deref(),
            Some(sidecar.as_path())
        );
        assert_eq!(
            capture
                .capture_inputs()
                .unwrap()
                .iter()
                .map(CaptureInput::relative_path)
                .collect::<Vec<_>>(),
            vec![
                "main.tex",
                "project.json",
                oleafly_history::DETACHED_MANIFEST_PATH
            ]
        );
        assert_eq!(
            linked_walk(&root, Some(&directory.path().join("absent.json"))).detached_manifest,
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn recorded_inputs_keep_only_files_inside_the_folder() {
        let root = Path::new("/work/it's a folder");
        let recorder = "PWD /work/it's a folder/paper\nINPUT /usr/local/texlive/2026/texmf-dist/tex/latex/base/article.cls\nINPUT main.tex\nINPUT ./sections/intro.tex\nINPUT sections/intro.tex\nINPUT ../shared/macros.sty\nINPUT /work/it's a folder/figures/plot.pdf\nINPUT /home/me/.oleafly/linked/x/build/_oleafly_entry.aux\nINPUT ../../outside.tex\nOUTPUT /home/me/.oleafly/linked/x/build/_oleafly_entry.pdf\n";
        assert_eq!(
            recorded_inputs(recorder, root),
            BTreeSet::from(
                [
                    "figures/plot.pdf",
                    "paper/main.tex",
                    "paper/sections/intro.tex",
                    "shared/macros.sty"
                ]
                .map(String::from)
            )
        );
        assert!(recorded_inputs("INPUT main.tex\n", root).is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn recorded_inputs_match_a_verbatim_root_case_insensitively() {
        let root = Path::new(r"\\?\C:\Users\Me\Thesis");
        let recorder =
            "PWD C:/Users/me/thesis\nINPUT main.tex\nINPUT C:\\Users\\Me\\Thesis\\Figures\\plot.pdf\n";
        assert_eq!(
            recorded_inputs(recorder, root),
            BTreeSet::from(["Figures/plot.pdf", "main.tex"].map(String::from))
        );
    }

    #[test]
    fn a_recorder_file_is_read_only_when_it_is_a_small_regular_file() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("folder");
        std::fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let recorder = directory.path().join("entry.fls");
        std::fs::write(
            &recorder,
            format!("PWD {}\nINPUT main.tex\n", root.display()),
        )
        .unwrap();
        assert_eq!(
            recorded_inputs_in(&recorder, &root),
            BTreeSet::from(["main.tex".to_string()])
        );
        assert!(recorded_inputs_in(&directory.path().join("absent.fls"), &root).is_empty());
    }

    #[test]
    fn retries_disappearing_entries_without_omitting_remaining_files() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"keep");
        write(root, "transient.tex", b"delete");
        let mut removed = false;
        let walk = walk_project_with(root, |path| {
            if path.ends_with("transient.tex") && !removed {
                std::fs::remove_file(path).unwrap();
                removed = true;
            }
        })
        .unwrap();
        assert!(removed);
        assert_eq!(captured_paths(&walk), vec!["main.tex"]);
    }

    #[test]
    fn retries_a_directory_removed_after_it_was_queued() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"keep");
        write(root, "transient/file.tex", b"delete");
        let mut visits = 0;
        let walk = walk_project_with(root, |path| {
            if path.ends_with("transient") {
                visits += 1;
                if visits == 2 {
                    std::fs::remove_dir_all(path).unwrap();
                }
            }
        })
        .unwrap();
        assert_eq!(visits, 2);
        assert_eq!(captured_paths(&walk), vec!["main.tex"]);
    }

    #[test]
    fn stops_after_one_rewalk_when_the_directory_remains_missing() {
        let directory = tempfile::tempdir().unwrap();
        let missing = directory.path().join("missing");
        let mut attempts = 0;
        let result = walk_project_with(&missing, |_| attempts += 1);
        assert_eq!(attempts, 2);
        assert_eq!(result.unwrap_err().kind(), std::io::ErrorKind::NotFound);
    }

    #[test]
    fn captures_every_source_file_including_ones_the_compiler_never_reads() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"\\documentclass{article}");
        write(root, "refs.bib", b"@book{a,title={A}}");
        write(root, "README.md", b"notes nobody compiles");
        write(root, "figures/plot.pdf", b"%PDF-1.4");

        let walk = walk_project(root).unwrap();

        assert_eq!(
            captured_paths(&walk),
            vec!["README.md", "figures/plot.pdf", "main.tex", "refs.bib"]
        );
    }

    #[test]
    fn skips_build_output_git_and_helper_caches() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        write(root, ".oleafly/build/main.pdf", b"%PDF");
        write(root, ".oleafly/build/main.aux", b"aux");
        write(root, ".git/config", b"[core]");
        write(root, "node_modules/pkg/index.js", b"module");
        write(root, "_minted-main/abc.pygtex", b"highlight");
        write(root, "pythontex-files-main/py.out", b"generated");

        let walk = walk_project(root).unwrap();

        assert_eq!(captured_paths(&walk), vec!["main.tex"]);
    }

    #[test]
    fn unchanged_tree_matches_the_recorded_checkpoint() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        write(root, "notes.md", b"notes");
        let walk = walk_project(root).unwrap();
        let files = walk
            .captured
            .iter()
            .map(|file| CheckpointFile {
                relative_path: file.relative_path.clone(),
                logical_bytes: 0,
                content_hash: file.content_hash,
                stored: true,
                chunk_count: 1,
            })
            .collect::<Vec<_>>();

        assert!(walk.matches_checkpoint(&files));

        write(root, "notes.md", b"notes, revised");
        let changed = walk_project(root).unwrap();
        assert!(!changed.matches_checkpoint(&files));
    }

    #[test]
    fn a_new_file_alone_counts_as_a_change() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        let before = walk_project(root).unwrap();
        let files = before
            .captured
            .iter()
            .map(|file| CheckpointFile {
                relative_path: file.relative_path.clone(),
                logical_bytes: 0,
                content_hash: file.content_hash,
                stored: true,
                chunk_count: 1,
            })
            .collect::<Vec<_>>();

        write(root, "README.md", b"added later");
        let after = walk_project(root).unwrap();

        assert!(!after.matches_checkpoint(&files));
    }

    #[test]
    fn every_captured_file_becomes_a_storable_input() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        write(root, "chapters/one.tex", b"chapter");

        let inputs = walk_project(root).unwrap().capture_inputs().unwrap();

        assert_eq!(
            inputs
                .iter()
                .map(CaptureInput::relative_path)
                .collect::<Vec<_>>(),
            vec!["chapters/one.tex", "main.tex"]
        );
    }

    #[test]
    fn a_helper_cache_prefix_is_matched_without_splitting_a_character() {
        assert!(is_excluded_component("_minted-main"));
        assert!(is_excluded_component("_MINTED-Main"));
        assert!(is_excluded_component("pythontex-files-main"));
        assert!(!is_excluded_component("_minted-"));
        assert!(!is_excluded_component("_minted"));
        assert!(!is_excluded_component("_minted\u{e9}"));
        assert!(!is_excluded_component("pythontex-files\u{e9}"));
        assert!(!is_excluded_component("_mint\u{e9}"));
        assert!(!is_excluded_component("_mint\u{e9}d-main"));
        assert!(!is_excluded_component("\u{e9}"));
        assert!(!is_excluded_component("figures"));
    }

    #[test]
    fn a_non_ascii_directory_name_is_walked_like_any_other() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        write(root, "_minted\u{e9}/one.tex", b"not a helper cache");
        write(root, "pythontex-files\u{e9}/two.tex", b"nor is this one");
        write(root, "fig\u{fc}res/plot.pdf", b"%PDF-1.4");
        write(root, "_minted-main/abc.pygtex", b"highlight");

        let walk = walk_project(root).unwrap();

        assert_eq!(
            captured_paths(&walk),
            vec![
                "_minted\u{e9}/one.tex",
                "fig\u{fc}res/plot.pdf",
                "main.tex",
                "pythontex-files\u{e9}/two.tex"
            ]
        );
    }

    #[test]
    fn decomposed_unicode_paths_are_captured_without_renaming() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        write(root, "cafe\u{301}.tex", b"a name that is not Unicode NFC");
        write(root, "chapters/one.tex", b"chapter");

        let walk = walk_project(root).unwrap();

        assert_eq!(
            captured_paths(&walk),
            vec!["cafe\u{301}.tex", "chapters/one.tex", "main.tex"]
        );
        assert_eq!(walk.capture_inputs().unwrap().len(), 3);
    }
    #[test]
    fn an_unreadable_root_cannot_look_like_an_empty_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let missing = directory.path().join("missing");
        assert!(walk_project(&missing).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn unsupported_paths_and_symlinks_cannot_produce_partial_snapshots() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write(root, "main.tex", b"source");
        write(root, "CON.tex", b"cannot restore on Windows");
        assert!(walk_project(root).unwrap_err().contains("CON.tex"));
        std::fs::remove_file(root.join("CON.tex")).unwrap();
        std::os::unix::fs::symlink("main.tex", root.join("linked.tex")).unwrap();
        assert!(walk_project(root).unwrap_err().contains("linked.tex"));
    }
}
