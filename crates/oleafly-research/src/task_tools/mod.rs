//! The tools a research task uses on its isolated workspace: bounded file
//! reads and writes, listing, search, and confined shell commands.
use std::collections::BTreeSet;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::{Dir, OpenOptions};
use oleafly_agent::ToolSchema;
use serde_json::{json, Value};

pub mod command;
pub mod extra;

pub use command::{
    command_spec, execute_command, sandbox_task_command_with_reads, task_sandbox_spec,
    task_sandbox_spec_for, task_writable_paths, CommandContext, CommandJobs,
};

pub const MAX_FILE_BYTES: usize = 1024 * 1024;
pub const MAX_OUTPUT_BYTES: usize = 48 * 1024;
const MAX_FILES: usize = 5_000;
const MAX_SCAN_ENTRIES: usize = 20_000;
pub const COMMAND_TIMEOUT: Duration = Duration::from_secs(120);

pub(crate) fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(windows)]
fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &std::fs::Metadata) -> bool {
    false
}

pub fn relative_path(value: &str, allow_root: bool) -> Result<PathBuf, String> {
    if value.contains(['\\', '\0', ':']) {
        return Err("Use a relative path inside the task workspace.".into());
    }
    let path = Path::new(value);
    if (value.is_empty() || value == ".") && allow_root {
        return Ok(PathBuf::new());
    }
    if value.is_empty()
        || path.components().any(|component| {
            !matches!(component, Component::Normal(_))
                || component.as_os_str().to_str().is_some_and(|name| {
                    [".git", ".oleafly", ".private"]
                        .iter()
                        .any(|sensitive| name.eq_ignore_ascii_case(sensitive))
                })
        })
    {
        return Err("Use a relative path inside the task workspace.".into());
    }
    Ok(path.to_path_buf())
}

/// A task workspace opened once, with the paths the task may write.
pub struct TaskFiles {
    pub root: PathBuf,
    directory: Dir,
    pub allowed: Vec<PathBuf>,
}

impl TaskFiles {
    pub fn open(root: &Path, allowed_paths: &[String]) -> Result<Self, String> {
        let metadata = std::fs::symlink_metadata(root)
            .map_err(|_| "The task workspace is unavailable.".to_string())?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err("The task workspace must be a real directory.".into());
        }
        let root = root.canonicalize().map_err(|error| error.to_string())?;
        let directory = Dir::open_ambient_dir(&root, cap_std::ambient_authority())
            .map_err(|_| "The task workspace could not be opened.".to_string())?;
        let allowed = allowed_paths
            .iter()
            .map(|path| relative_path(path, false))
            .collect::<Result<Vec<_>, _>>()?;
        if allowed.is_empty() {
            return Err("The task has no allowed project paths.".into());
        }
        Ok(Self {
            root,
            directory,
            allowed,
        })
    }

    pub fn allows(&self, path: &Path) -> bool {
        self.allowed
            .iter()
            .any(|allowed| path == allowed || path.starts_with(allowed))
    }

    fn traversable(&self, path: &Path) -> bool {
        self.allows(path) || self.allowed.iter().any(|allowed| allowed.starts_with(path))
    }

    fn checked(&self, value: &str) -> Result<PathBuf, String> {
        let path = relative_path(value, false)?;
        if !self.allows(&path) {
            return Err("That path is outside this task's allowed project files.".into());
        }
        Ok(path)
    }

    pub fn parent(&self, path: &Path, create: bool) -> Result<(Dir, PathBuf), String> {
        let mut directory = self
            .directory
            .try_clone()
            .map_err(|error| error.to_string())?;
        let components = path.components().collect::<Vec<_>>();
        let (name, parents) = components.split_last().ok_or("Choose a file path.")?;
        for component in parents {
            let name = Path::new(component.as_os_str());
            if create {
                match directory.create_dir(name) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(error) => {
                        return Err(format!("The task folder could not be created: {error}"))
                    }
                }
            }
            directory = directory.open_dir_nofollow(name).map_err(|_| {
                "The task path contains a link or an unavailable folder.".to_string()
            })?;
        }
        Ok((directory, PathBuf::from(name.as_os_str())))
    }

    /// Whether a file or folder exists at `value`, without following links.
    /// A link or an unavailable folder on the way is an error.
    pub fn exists(&self, value: &str) -> Result<bool, String> {
        let path = self.checked(value)?;
        let (directory, name) = match self.parent(&path, false) {
            Ok(found) => found,
            Err(_) if !self.root.join(&path).parent().is_some_and(Path::exists) => {
                return Ok(false)
            }
            Err(error) => return Err(error),
        };
        match directory.symlink_metadata(&name) {
            Ok(metadata) if metadata.is_symlink() => {
                Err("The task path contains a link or an unavailable folder.".into())
            }
            Ok(_) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(format!("The task file could not be checked: {error}")),
        }
    }

    /// A workspace file's bytes (a PDF), up to `max_bytes`, without following links.
    pub fn read_bytes(&self, value: &str, max_bytes: u64) -> Result<Vec<u8>, String> {
        let path = self.checked(value)?;
        let (directory, name) = self.parent(&path, false)?;
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No).nonblock(true);
        let file = directory
            .open_with(name, &options)
            .map_err(|_| "The task file could not be opened safely.".to_string())?;
        let metadata = file.metadata().map_err(|error| error.to_string())?;
        if !metadata.is_file() {
            return Err("Read a regular file.".into());
        }
        if metadata.len() > max_bytes {
            return Err("The file is too large to read.".into());
        }
        let mut bytes = Vec::new();
        file.take(max_bytes + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "The task file could not be read.".to_string())?;
        if bytes.len() as u64 > max_bytes {
            return Err("The file is too large to read.".into());
        }
        Ok(bytes)
    }

    pub fn read(&self, value: &str) -> Result<String, String> {
        let path = self.checked(value)?;
        let (directory, name) = self.parent(&path, false)?;
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No).nonblock(true);
        let file = directory
            .open_with(name, &options)
            .map_err(|_| "The task file could not be opened safely.".to_string())?;
        let metadata = file.metadata().map_err(|error| error.to_string())?;
        if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES as u64 {
            return Err("Read a regular text file no larger than 1 MiB.".into());
        }
        let mut bytes = Vec::new();
        file.take((MAX_FILE_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "The task file could not be read.".to_string())?;
        if bytes.len() > MAX_FILE_BYTES {
            return Err("The task file exceeds the 1 MiB read limit.".into());
        }
        String::from_utf8(bytes).map_err(|_| "This file is not UTF-8 text.".into())
    }

    pub fn read_window(&self, value: &str, offset: usize, limit: usize) -> Result<Value, String> {
        let content = self.read(value)?;
        if !content.is_char_boundary(offset) {
            return Err("Use an offset from a previous file read.".into());
        }
        let mut end = offset
            .saturating_add(limit.clamp(4, MAX_OUTPUT_BYTES))
            .min(content.len());
        while !content.is_char_boundary(end) {
            end -= 1;
        }
        Ok(json!({
            "content": &content[offset..end],
            "offset": offset,
            "nextOffset": (end < content.len()).then_some(end),
            "totalBytes": content.len(),
            "truncated": end < content.len(),
        }))
    }

    pub fn write(&self, value: &str, content: &str) -> Result<Value, String> {
        if content.len() > MAX_FILE_BYTES {
            return Err("Write no more than 1 MiB in one file operation.".into());
        }
        self.write_bytes(value, content.as_bytes(), MAX_FILE_BYTES)
    }

    /// Writes bytes (a downloaded PDF) with the same link and path checks as
    /// [`Self::write`], up to `max_bytes`.
    pub fn write_bytes(
        &self,
        value: &str,
        content: &[u8],
        max_bytes: usize,
    ) -> Result<Value, String> {
        if content.len() > max_bytes {
            return Err("The file is too large to save in the task workspace.".into());
        }
        let path = self.checked(value)?;
        let (directory, name) = self.parent(&path, true)?;
        match directory.symlink_metadata(&name) {
            Ok(metadata) if !metadata.is_file() || metadata.is_symlink() => {
                return Err("The destination must be a regular file, not a link.".into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("The destination could not be checked: {error}")),
        }
        let staging = format!(".task-write-{:032x}", rand::random::<u128>());
        let mut options = OpenOptions::new();
        options
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        let result = (|| {
            let mut file = directory
                .open_with(&staging, &options)
                .map_err(|error| format!("The task file could not be created: {error}"))?;
            file.write_all(content).map_err(|error| error.to_string())?;
            file.sync_all().map_err(|error| error.to_string())?;
            drop(file);
            directory
                .rename(&staging, &directory, &name)
                .map_err(|error| format!("The task file could not be saved: {error}"))?;
            Ok(json!({"path":value,"bytes":content.len()}))
        })();
        if result.is_err() {
            let _ = directory.remove_file(staging);
        }
        result
    }

    pub fn list(&self, value: &str) -> Result<(Vec<String>, bool), String> {
        let prefix = relative_path(value, true)?;
        if !self.traversable(&prefix) {
            return Err("That folder is outside this task's allowed project files.".into());
        }
        let mut queue = vec![PathBuf::new()];
        let mut files = BTreeSet::new();
        let mut scanned = 0;
        let mut output_bytes = 0;
        while let Some(path) = queue.pop() {
            if path.components().count() > 64 {
                continue;
            }
            let mut directory = self
                .directory
                .try_clone()
                .map_err(|error| error.to_string())?;
            for component in path.components() {
                directory = directory
                    .open_dir_nofollow(Path::new(component.as_os_str()))
                    .map_err(|_| "The task folder changed while it was being read.".to_string())?;
            }
            for entry in directory.entries().map_err(|error| error.to_string())? {
                scanned += 1;
                if scanned > MAX_SCAN_ENTRIES || files.len() >= MAX_FILES {
                    return Ok((files.into_iter().collect(), true));
                }
                let entry = entry.map_err(|error| error.to_string())?;
                let child = path.join(entry.file_name());
                let name = child
                    .to_string_lossy()
                    .replace(std::path::MAIN_SEPARATOR, "/");
                if relative_path(&name, false).is_err()
                    || !self.traversable(&child)
                    || !(child.starts_with(&prefix) || prefix.starts_with(&child))
                {
                    continue;
                }
                let kind = entry.file_type().map_err(|error| error.to_string())?;
                if kind.is_dir() {
                    queue.push(child);
                } else if kind.is_file() && self.allows(&child) && child.starts_with(&prefix) {
                    output_bytes += name.len() + 4;
                    if output_bytes > MAX_OUTPUT_BYTES / 2 {
                        return Ok((files.into_iter().collect(), true));
                    }
                    files.insert(name);
                }
            }
        }
        Ok((files.into_iter().collect(), false))
    }

    pub fn search(&self, query: &str) -> Result<Value, String> {
        if query.is_empty() || query.len() > 1024 {
            return Err("Use a search query between 1 and 1024 bytes.".into());
        }
        let (files, mut truncated) = self.list("")?;
        let mut matches = Vec::new();
        let mut scanned_bytes = 0;
        for path in files {
            let Ok(content) = self.read(&path) else {
                continue;
            };
            scanned_bytes += content.len();
            if scanned_bytes > 16 * MAX_FILE_BYTES {
                truncated = true;
                break;
            }
            for (index, line) in content.lines().enumerate() {
                if line.contains(query) {
                    matches.push(json!({"path":path,"line":index + 1,"text":bounded(line,1024)}));
                    if matches.len() >= 32 {
                        return Ok(json!({"matches":matches,"truncated":true}));
                    }
                }
            }
        }
        Ok(json!({"matches":matches,"truncated":truncated}))
    }
}

pub fn bounded(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.into();
    }
    let mut end = max_bytes;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n[output truncated]", &text[..end])
}

/// The workspace tools every research task gets.
/// The workspace tools. `network` is the task's network permission for
/// commands, which the `run_command` description states.
pub fn file_tool_schemas(network: bool) -> Vec<ToolSchema> {
    let command = if network {
        "Run a shell command in the isolated task workspace for up to two minutes. Writes are restricted to allowed paths. Network access is allowed. For anything longer, use start_run."
    } else {
        "Run a shell command in the isolated task workspace for up to two minutes. Writes are restricted to allowed paths. Network access is disabled. For anything longer, use start_run."
    };
    [
        ("read_file", "Read UTF-8 text from this task's isolated workspace. Continue a partial read using nextOffset.", json!({"path":{"type":"string"},"offset":{"type":"integer","minimum":0,"default":0},"limit":{"type":"integer","minimum":4,"maximum":MAX_OUTPUT_BYTES,"default":MAX_OUTPUT_BYTES}}), vec!["path"]),
        ("write_file", "Save a UTF-8 file in this task's allowed workspace paths. Changes require review before they reach the project.", json!({"path":{"type":"string"},"content":{"type":"string"}}), vec!["path","content"]),
        ("list_files", "List allowed files in this task's isolated workspace.", json!({"path":{"type":"string","default":""}}), vec![]),
        ("search_project", "Search for literal text in the task's allowed UTF-8 files.", json!({"query":{"type":"string"}}), vec!["query"]),
        ("run_command", command, json!({"command":{"type":"string"}}), vec!["command"]),
    ].into_iter().map(|(name, description, properties, required)| ToolSchema {
        name:name.into(), description:description.into(), input_schema:json!({"type":"object","properties":properties,"required":required,"additionalProperties":false}),
    }).collect()
}

pub fn text_argument<'a>(args: &'a Value, name: &str) -> Result<&'a str, String> {
    args.get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Provide a text value for {name}."))
}

#[cfg(test)]
mod tests;
