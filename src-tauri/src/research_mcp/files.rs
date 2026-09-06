use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::{Dir, OpenOptions};
use serde_json::{json, Value};

pub(super) const MAX_READ_BYTES: usize = 128 * 1024;
const MAX_ENTRIES: usize = 500;
const MAX_VISITED: usize = 4_000;
const MAX_SEARCH_BYTES: usize = 8 * 1024 * 1024;

pub(super) struct FileScope {
    dir: Dir,
    allowed: Option<Vec<PathBuf>>,
}

pub(super) fn relative_path(value: &str, allow_empty: bool) -> Result<PathBuf, String> {
    if value.len() > 4_096 || value.contains(['\\', '\0']) {
        return Err("Use a relative path with forward slashes.".into());
    }
    if value.is_empty() {
        return if allow_empty {
            Ok(PathBuf::new())
        } else {
            Err("A file path is required.".into())
        };
    }
    let path = Path::new(value);
    for part in value.split('/') {
        if part.is_empty() || matches!(part, "." | ".." | ".git" | ".oleafly" | ".private") {
            return Err("This path is outside the session's file access.".into());
        }
    }
    if path
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("Use a relative path inside the session folder.".into());
    }
    Ok(path.to_path_buf())
}

fn open_root(path: &Path) -> Result<Dir, String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|_| "The session folder is unavailable.".to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("The session folder must be a real directory.".into());
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "The session folder is unavailable.".to_string())?;
    let anchor = canonical
        .ancestors()
        .last()
        .ok_or_else(|| "The session folder has no filesystem root.".to_string())?;
    let mut dir = Dir::open_ambient_dir(anchor, cap_std::ambient_authority())
        .map_err(|_| "The session folder could not be opened.".to_string())?;
    for part in canonical
        .strip_prefix(anchor)
        .map_err(|_| "The session folder could not be resolved.".to_string())?
        .components()
    {
        dir = dir
            .open_dir_nofollow(Path::new(part.as_os_str()))
            .map_err(|_| "The session folder could not be opened safely.".to_string())?;
    }
    Ok(dir)
}

impl FileScope {
    pub(super) fn open(path: &Path, allowed: Option<Vec<String>>) -> Result<Self, String> {
        let allowed = allowed
            .map(|paths| {
                if paths.len() > MAX_ENTRIES {
                    return Err("Too many paths were granted to this session.".to_string());
                }
                paths
                    .into_iter()
                    .map(|path| relative_path(&path, false))
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()?;
        Ok(Self {
            dir: open_root(path)?,
            allowed,
        })
    }

    fn can_read(&self, path: &Path) -> bool {
        self.allowed.as_ref().map_or(true, |paths| {
            paths.iter().any(|allowed| path.starts_with(allowed))
        })
    }

    fn can_traverse(&self, path: &Path) -> bool {
        self.can_read(path)
            || self
                .allowed
                .as_ref()
                .is_some_and(|paths| paths.iter().any(|allowed| allowed.starts_with(path)))
    }

    fn directory(&self, path: &Path) -> Result<Dir, String> {
        let mut dir = self
            .dir
            .try_clone()
            .map_err(|_| "The session folder could not be opened.".to_string())?;
        for component in path.components() {
            dir = dir
                .open_dir_nofollow(Path::new(component.as_os_str()))
                .map_err(|_| {
                    "The folder is unavailable or contains a symbolic link.".to_string()
                })?;
        }
        Ok(dir)
    }

    pub(super) fn read(&self, path: &str, max_bytes: usize) -> Result<Value, String> {
        let path = relative_path(path, false)?;
        if !self.can_read(&path) {
            return Err("This file is outside the session's allowed paths.".into());
        }
        let parent = self.directory(path.parent().unwrap_or(Path::new("")))?;
        let name = path
            .file_name()
            .ok_or_else(|| "A file name is required.".to_string())?;
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No).nonblock(true);
        let file = parent
            .open_with(Path::new(name), &options)
            .map_err(|_| "The file is unavailable or contains a symbolic link.".to_string())?;
        let metadata = file
            .metadata()
            .map_err(|_| "The file could not be inspected.".to_string())?;
        if !metadata.is_file() {
            return Err("Choose a regular text file.".into());
        }
        let limit = max_bytes.clamp(1, MAX_READ_BYTES);
        let mut bytes = Vec::with_capacity(limit.min(16 * 1024));
        file.take((limit + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "The file could not be read.".to_string())?;
        let truncated = bytes.len() > limit;
        bytes.truncate(limit);
        if bytes.contains(&0) {
            return Err("This file contains binary data. Choose a text file.".into());
        }
        Ok(json!({
            "path": path.to_string_lossy().replace('\\', "/"),
            "content": String::from_utf8_lossy(&bytes),
            "bytes_read": bytes.len(),
            "truncated": truncated,
        }))
    }

    pub(super) fn list(
        &self,
        path: &str,
        max_depth: usize,
        closed: &AtomicBool,
    ) -> Result<Value, String> {
        let path = relative_path(path, true)?;
        if !self.can_traverse(&path) {
            return Err("This folder is outside the session's allowed paths.".into());
        }
        let mut pending = vec![(self.directory(&path)?, path.clone(), 0)];
        let mut entries = Vec::new();
        let mut visited = 0;
        let mut truncated = false;
        'folders: while let Some((dir, relative, depth)) = pending.pop() {
            let children = dir
                .entries()
                .map_err(|_| "The folder could not be listed.".to_string())?;
            for child in children {
                if closed.load(Ordering::Acquire) {
                    return Err("This research session has closed.".into());
                }
                visited += 1;
                if entries.len() >= MAX_ENTRIES || visited > MAX_VISITED {
                    truncated = true;
                    break 'folders;
                }
                let child = child.map_err(|_| "A folder entry could not be read.".to_string())?;
                let name = child.file_name();
                let Some(name_text) = name.to_str() else {
                    continue;
                };
                if relative_path(name_text, false).is_err() {
                    continue;
                }
                let child_path = relative.join(&name);
                let metadata = dir
                    .symlink_metadata(Path::new(&name))
                    .map_err(|_| "A folder entry could not be inspected.".to_string())?;
                if metadata.is_symlink() || (!metadata.is_dir() && !metadata.is_file()) {
                    continue;
                }
                let visible = if metadata.is_dir() {
                    self.can_traverse(&child_path)
                } else {
                    self.can_read(&child_path)
                };
                if !visible {
                    continue;
                }
                entries.push(json!({
                    "path": child_path.to_string_lossy().replace('\\', "/"),
                    "is_directory": metadata.is_dir(),
                    "bytes": metadata.len(),
                }));
                if metadata.is_dir() {
                    if let Ok(child_dir) = dir.open_dir_nofollow(Path::new(&name)) {
                        if depth < max_depth.min(5) {
                            pending.push((child_dir, child_path, depth + 1));
                        } else {
                            truncated |= child_dir
                                .entries()
                                .map(|mut children| children.next().is_some())
                                .unwrap_or(true);
                        }
                    }
                }
            }
        }
        entries.sort_by(|left, right| left["path"].as_str().cmp(&right["path"].as_str()));
        Ok(json!({"path": path.to_string_lossy(), "entries": entries, "truncated": truncated}))
    }

    pub(super) fn search(&self, query: &str, closed: &AtomicBool) -> Result<Value, String> {
        let listing = self.list("", 5, closed)?;
        let mut matches = Vec::new();
        let mut searched_bytes = 0;
        let mut truncated = listing["truncated"].as_bool().unwrap_or(false);
        for entry in listing["entries"].as_array().into_iter().flatten() {
            if closed.load(Ordering::Acquire) {
                return Err("This research session has closed.".into());
            }
            if entry["is_directory"].as_bool() != Some(false) {
                continue;
            }
            let Some(path) = entry["path"].as_str() else {
                continue;
            };
            let Ok(file) = self.read(path, MAX_READ_BYTES) else {
                continue;
            };
            searched_bytes += file["bytes_read"].as_u64().unwrap_or(0) as usize;
            truncated |= file["truncated"].as_bool().unwrap_or(false);
            for (index, line) in file["content"].as_str().unwrap_or("").lines().enumerate() {
                if line.contains(query) {
                    matches.push(json!({"path": path, "line": index + 1, "text": line.chars().take(1_000).collect::<String>()}));
                    if matches.len() == 50 {
                        truncated = true;
                        break;
                    }
                }
            }
            if matches.len() == 50 || searched_bytes >= MAX_SEARCH_BYTES {
                truncated = true;
                break;
            }
        }
        Ok(json!({"matches": matches, "truncated": truncated, "searched_bytes": searched_bytes}))
    }
}
