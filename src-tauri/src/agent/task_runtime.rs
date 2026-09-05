use std::collections::{BTreeSet, HashMap};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::{Dir, OpenOptions};
use oleafly_agent::{
    AgentEvent, CancellationToken, CompletionRequest, RunConfig, ToolOutput, ToolPipeline,
    ToolRunner, ToolSchema,
};
use serde_json::{json, Value};
use tauri::Manager;
use tokio::io::{AsyncRead, AsyncReadExt};

use crate::research_tasks::{
    ResearchTaskState, TaskEventSink, TaskRunContext, TaskRuntimeAdapter, TaskRuntimeEvent,
    TaskRuntimeFuture, TaskRuntimeOutcome,
};

const MAX_FILE_BYTES: usize = 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 48 * 1024;
const MAX_FILES: usize = 5_000;
const MAX_SCAN_ENTRIES: usize = 20_000;
const MAX_SKILL_BYTES: usize = 192 * 1024;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(120);

fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value.lock().unwrap_or_else(|error| error.into_inner())
}

fn relative_path(value: &str, allow_root: bool) -> Result<PathBuf, String> {
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

struct TaskFiles {
    root: PathBuf,
    directory: Dir,
    allowed: Vec<PathBuf>,
}

impl TaskFiles {
    fn open(root: &Path, allowed_paths: &[String]) -> Result<Self, String> {
        let metadata = std::fs::symlink_metadata(root)
            .map_err(|_| "The task workspace is unavailable.".to_string())?;
        if !metadata.is_dir()
            || metadata.file_type().is_symlink()
            || crate::skills::is_reparse_point(&metadata)
        {
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

    fn allows(&self, path: &Path) -> bool {
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

    fn parent(&self, path: &Path, create: bool) -> Result<(Dir, PathBuf), String> {
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

    fn read(&self, value: &str) -> Result<String, String> {
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

    fn read_window(&self, value: &str, offset: usize, limit: usize) -> Result<Value, String> {
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

    fn write(&self, value: &str, content: &str) -> Result<Value, String> {
        if content.len() > MAX_FILE_BYTES {
            return Err("Write no more than 1 MiB in one file operation.".into());
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
            file.write_all(content.as_bytes())
                .map_err(|error| error.to_string())?;
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

    fn list(&self, value: &str) -> Result<(Vec<String>, bool), String> {
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

    fn search(&self, query: &str) -> Result<Value, String> {
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

fn bounded(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.into();
    }
    let mut end = max_bytes;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n[output truncated]", &text[..end])
}

pub fn sandbox_task_command(
    program: &Path,
    args: &[String],
    execution_root: &Path,
    allowed_paths: &[String],
    writable_temp: &Path,
    network: bool,
) -> Result<tokio::process::Command, String> {
    sandbox_task_command_with_reads(
        program,
        args,
        execution_root,
        allowed_paths,
        writable_temp,
        network,
        &[],
    )
}

pub fn sandbox_task_command_with_reads(
    program: &Path,
    args: &[String],
    execution_root: &Path,
    allowed_paths: &[String],
    writable_temp: &Path,
    network: bool,
    read_paths: &[PathBuf],
) -> Result<tokio::process::Command, String> {
    let files = TaskFiles::open(execution_root, allowed_paths)?;
    let temp_metadata = std::fs::symlink_metadata(writable_temp)
        .map_err(|_| "The task command's temporary folder is unavailable.".to_string())?;
    if !temp_metadata.is_dir() || temp_metadata.file_type().is_symlink() {
        return Err("The task command needs a real temporary folder.".into());
    }
    let temp = writable_temp
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let mut writable = Vec::new();
    for relative in &files.allowed {
        let path = files.root.join(relative);
        let (directory, name) = files.parent(relative, true)?;
        match directory.symlink_metadata(&name) {
            Ok(metadata) if metadata.is_symlink() => {
                return Err("A task command cannot use a writable symbolic link.".into());
            }
            Ok(metadata) if metadata.is_dir() || metadata.is_file() => {}
            Ok(_) => return Err("A task command can only use regular files and folders.".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                directory
                    .create_dir(&name)
                    .map_err(|error| error.to_string())?;
            }
            Err(error) => return Err(error.to_string()),
        }
        let real = path.canonicalize().map_err(|error| error.to_string())?;
        if !real.starts_with(&files.root) {
            return Err("A task command path left its workspace.".into());
        }
        writable.push(real);
    }
    let program = program
        .canonicalize()
        .map_err(|_| "The task executable is unavailable.".to_string())?;
    let mut readable = system_read_paths();
    readable.push(program.clone());
    for path in read_paths {
        let path = path
            .canonicalize()
            .map_err(|_| "A task runtime file is unavailable.".to_string())?;
        if path.parent().is_none() || crate::paths::home_dir().is_ok_and(|home| path == home) {
            return Err("Task runtimes require specific readable files or folders.".into());
        }
        readable.push(path);
    }
    readable.sort();
    readable.dedup();
    let mut command = sandbox_platform_command(
        &program,
        args,
        &files.root,
        &writable,
        &temp,
        network,
        &readable,
    )?;
    command.env_clear();
    command
        .current_dir(&files.root)
        .env(
            "PATH",
            "/opt/homebrew/bin:/opt/local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        )
        .env("LANG", "en_US.UTF-8")
        .env("HOME", &temp)
        .env("XDG_CONFIG_HOME", temp.join("config"))
        .env("XDG_CACHE_HOME", temp.join("cache"))
        .env("XDG_STATE_HOME", temp.join("state"))
        .env("TMPDIR", &temp)
        .env("TMP", &temp)
        .env("TEMP", &temp);
    Ok(command)
}

fn system_read_paths() -> Vec<PathBuf> {
    [
        "/System",
        "/usr",
        "/bin",
        "/sbin",
        "/lib",
        "/lib64",
        "/etc",
        "/private/etc",
        "/Library/Apple",
        "/Library/Developer",
        "/Library/Frameworks",
        "/private/var/db/dyld",
        "/private/var/db/timezone",
        "/opt/homebrew",
        "/opt/local",
    ]
    .into_iter()
    .map(PathBuf::from)
    .filter(|path| path.exists())
    .collect()
}

#[cfg(target_os = "macos")]
fn sandbox_platform_command(
    program: &Path,
    args: &[String],
    root: &Path,
    writable: &[PathBuf],
    temp: &Path,
    network: bool,
    readable: &[PathBuf],
) -> Result<tokio::process::Command, String> {
    if !Path::new("/usr/bin/sandbox-exec").is_file() {
        return Err(
            "This Mac cannot confine task commands because sandbox-exec is unavailable.".into(),
        );
    }
    let mut profile = String::from("(version 1) (deny default) (allow process*) (allow syscall-unix) (allow file-read-metadata) (allow sysctl-read) (allow signal (target same-sandbox)) (deny syscall-unix (syscall-number SYS_setsid SYS_setpgid) (with errno 1)) (deny syscall-unix (syscall-number SYS_posix_spawn) (with errno 78))");
    profile.push_str(" (allow mach-lookup (global-name \"com.apple.system.logger\") (global-name \"com.apple.system.notification_center\") (global-name \"com.apple.notifyd\") (global-name \"com.apple.cfprefsd.daemon\") (global-name \"com.apple.cfprefsd.agent\"))");
    if network {
        profile.push_str(" (allow network*)");
        profile.push_str(" (allow mach-lookup (global-name \"com.apple.SecurityServer\") (global-name \"com.apple.trustd\") (global-name \"com.apple.trustd.agent\") (global-name \"com.apple.mDNSResponder\") (global-name \"com.apple.networkd\") (global-name \"com.apple.SystemConfiguration.configd\"))");
    }
    for path in readable
        .iter()
        .chain(writable)
        .map(PathBuf::as_path)
        .chain(std::iter::once(temp))
    {
        let quoted =
            serde_json::to_string(&path.to_string_lossy()).map_err(|error| error.to_string())?;
        let filter = if path.is_dir() { "subpath" } else { "literal" };
        profile.push_str(&format!(" (allow file-read* ({filter} {quoted}))"));
    }
    let root = serde_json::to_string(&root.to_string_lossy()).map_err(|error| error.to_string())?;
    profile.push_str(&format!(
        " (allow file-read* (literal \"/\") (literal {root}) (subpath \"/dev\"))"
    ));
    for path in writable
        .iter()
        .map(PathBuf::as_path)
        .chain(std::iter::once(temp))
    {
        let quoted =
            serde_json::to_string(&path.to_string_lossy()).map_err(|error| error.to_string())?;
        let filter = if path.is_dir() { "subpath" } else { "literal" };
        profile.push_str(&format!(" (allow file-write* ({filter} {quoted}))"));
    }
    profile.push_str(" (allow file-write-data (literal \"/dev/null\") (literal \"/dev/zero\") (literal \"/dev/random\") (literal \"/dev/urandom\"))");
    let mut command = tokio::process::Command::new("/usr/bin/sandbox-exec");
    command.arg("-p").arg(profile).arg(program).args(args);
    Ok(command)
}

#[cfg(target_os = "linux")]
fn sandbox_platform_command(
    program: &Path,
    args: &[String],
    root: &Path,
    writable: &[PathBuf],
    temp: &Path,
    network: bool,
    readable: &[PathBuf],
) -> Result<tokio::process::Command, String> {
    let executable = ["/usr/bin/bwrap", "/bin/bwrap"]
        .into_iter()
        .find(|path| Path::new(path).is_file())
        .ok_or("Task commands need bubblewrap to keep writes inside their workspace.")?;
    let mut command = tokio::process::Command::new(executable);
    command.args([
        "--die-with-parent",
        "--new-session",
        "--unshare-all",
        "--unshare-pid",
    ]);
    if network {
        command.arg("--share-net");
    }
    command.args(["--proc", "/proc", "--dev", "/dev"]);
    for path in readable {
        command.arg("--ro-bind").arg(path).arg(path);
    }
    command.arg("--dir").arg(root);
    for path in writable
        .iter()
        .map(PathBuf::as_path)
        .chain(std::iter::once(temp))
    {
        command.arg("--bind").arg(path).arg(path);
    }
    command.arg("--").arg(program).args(args);
    Ok(command)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn sandbox_platform_command(
    _program: &Path,
    _args: &[String],
    _root: &Path,
    _writable: &[PathBuf],
    _temp: &Path,
    _network: bool,
    _readable: &[PathBuf],
) -> Result<tokio::process::Command, String> {
    Err("Isolated task commands are not supported on this operating system yet.".into())
}

struct CommandTemp(PathBuf);

impl CommandTemp {
    fn new() -> Result<Self, String> {
        let path =
            std::env::temp_dir().join(format!("oleafly-task-{:032x}", rand::random::<u128>()));
        std::fs::create_dir(&path).map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
                .map_err(|error| error.to_string())?;
        }
        Ok(Self(path))
    }
}

impl Drop for CommandTemp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[derive(Default)]
struct CommandJobs {
    tasks: Mutex<Vec<tokio::task::JoinHandle<()>>>,
}

impl CommandJobs {
    async fn finish(&self) {
        let tasks = std::mem::take(&mut *lock(&self.tasks));
        for task in tasks {
            let _ = task.await;
        }
    }

    async fn run(
        &self,
        context: TaskRunContext,
        command: String,
        token: CancellationToken,
    ) -> Result<Value, String> {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let handle = tokio::spawn(async move {
            let result = execute_command(&context, &command, token).await;
            let _ = sender.send(result);
        });
        lock(&self.tasks).push(handle);
        receiver
            .await
            .map_err(|_| "The task command stopped before returning a result.".to_string())?
    }
}

async fn read_output<R: AsyncRead + Unpin>(mut stream: R) -> Vec<u8> {
    let mut result = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        match stream.read(&mut buffer).await {
            Ok(0) | Err(_) => return result,
            Ok(count) => {
                let remaining = (MAX_OUTPUT_BYTES + 1).saturating_sub(result.len());
                result.extend_from_slice(&buffer[..count.min(remaining)]);
            }
        }
    }
}

async fn execute_command(
    context: &TaskRunContext,
    text: &str,
    token: CancellationToken,
) -> Result<Value, String> {
    if token.is_cancelled() {
        return Err("The task was cancelled.".into());
    }
    if text.trim().is_empty() || text.len() > 16 * 1024 {
        return Err("Use a command between 1 and 16384 bytes.".into());
    }
    let temp = CommandTemp::new()?;
    let mut command = sandbox_task_command(
        Path::new("/bin/sh"),
        &["-c".into(), text.into()],
        Path::new(&context.execution_root),
        &context.allowed_paths,
        &temp.0,
        false,
    )?;
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::proc::isolate_process_tree(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("The task command could not start: {error}"))?;
    let pid = child.id().ok_or("The task command has no process ID.")?;
    let containment = match crate::proc::contain_process_tree(pid) {
        Ok(value) => value,
        Err(error) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(format!("The task command could not be contained: {error}"));
        }
    };
    let mut stdout = tokio::spawn(read_output(
        child
            .stdout
            .take()
            .ok_or("Command output is unavailable.")?,
    ));
    let mut stderr = tokio::spawn(read_output(
        child
            .stderr
            .take()
            .ok_or("Command errors are unavailable.")?,
    ));
    let (status, timed_out, cancelled) = tokio::select! {
        status = child.wait() => (status.ok(), false, false),
        _ = token.cancelled() => (None, false, true),
        _ = tokio::time::sleep(COMMAND_TIMEOUT) => (None, true, false),
    };
    drop(containment);
    let _ = child.start_kill();
    let reaped = child.wait().await.ok();
    let read = async { tokio::join!(&mut stdout, &mut stderr) };
    let (mut output, errors) = match tokio::time::timeout(Duration::from_secs(2), read).await {
        Ok((stdout, stderr)) => (stdout.unwrap_or_default(), stderr.unwrap_or_default()),
        Err(_) => {
            stdout.abort();
            stderr.abort();
            let _ = tokio::join!(stdout, stderr);
            (Vec::new(), Vec::new())
        }
    };
    output.extend(errors);
    let truncated = output.len() > MAX_OUTPUT_BYTES;
    output.truncate(MAX_OUTPUT_BYTES);
    Ok(json!({
        "output":String::from_utf8_lossy(&output), "exitCode":status.or(reaped).and_then(|value| value.code()),
        "truncated":truncated, "timedOut":timed_out, "cancelled":cancelled,
    }))
}

fn file_tools() -> Vec<ToolSchema> {
    [
        ("read_file", "Read UTF-8 text from this task's isolated workspace. Continue a partial read using nextOffset.", json!({"path":{"type":"string"},"offset":{"type":"integer","minimum":0,"default":0},"limit":{"type":"integer","minimum":4,"maximum":MAX_OUTPUT_BYTES,"default":MAX_OUTPUT_BYTES}}), vec!["path"]),
        ("write_file", "Save a UTF-8 file in this task's allowed workspace paths. Changes require review before they reach the project.", json!({"path":{"type":"string"},"content":{"type":"string"}}), vec!["path","content"]),
        ("list_files", "List allowed files in this task's isolated workspace.", json!({"path":{"type":"string","default":""}}), vec![]),
        ("search_project", "Search for literal text in the task's allowed UTF-8 files.", json!({"query":{"type":"string"}}), vec!["query"]),
        ("run_command", "Run a shell command in the isolated task workspace for up to two minutes. Writes are restricted to allowed paths. Network access is disabled.", json!({"command":{"type":"string"}}), vec!["command"]),
    ].into_iter().map(|(name, description, properties, required)| ToolSchema {
        name:name.into(), description:description.into(), input_schema:json!({"type":"object","properties":properties,"required":required,"additionalProperties":false}),
    }).collect()
}

fn text_argument<'a>(args: &'a Value, name: &str) -> Result<&'a str, String> {
    args.get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Provide a text value for {name}."))
}

fn skill_prompt(app: &tauri::AppHandle, context: &TaskRunContext) -> Result<String, String> {
    if context.skill_ids.is_empty() {
        return Ok(String::new());
    }
    let root = crate::paths::oleafly_root()?;
    let pack = crate::skills_pack::pack_root(app);
    let records = crate::skills::list_with(&root, pack.as_deref(), Some(&context.project_id))?;
    let mut prompt = String::new();
    for id in &context.skill_ids {
        let skill = records
            .iter()
            .find(|skill| skill.id == *id && skill.enabled && skill.project_enabled)
            .ok_or_else(|| {
                format!("The selected skill {id} is unavailable or disabled for this project.")
            })?;
        prompt.push_str(&format!(
            "\n\nSelected skill: {}\n{}",
            skill.name, skill.instructions
        ));
        if prompt.len() > MAX_SKILL_BYTES {
            return Err(
                "The selected skills exceed this task's context limit. Select fewer skills.".into(),
            );
        }
    }
    Ok(prompt)
}

fn task_prompt(context: &TaskRunContext, skills: &str) -> String {
    format!("Complete this research task in the isolated workspace. Work only on the requested deliverable. Use relative file paths. Allowed paths: {}. Linked research roots are read-only. Summarize the result and remaining limitations when finished. Changes will be reviewed before applying them to the project.{}\n\nTask: {}\n{}",
        context.allowed_paths.join(", "), skills, context.title, context.prompt)
}

#[derive(Clone)]
struct BuiltinTaskAdapter {
    app: tauri::AppHandle,
    tokens: Arc<Mutex<HashMap<String, ActiveTaskRun>>>,
}

#[derive(Clone)]
struct ActiveTaskRun {
    token: CancellationToken,
    done: tokio::sync::watch::Receiver<bool>,
}

struct ActiveToken {
    sessions: Arc<Mutex<HashMap<String, ActiveTaskRun>>>,
    session_id: String,
    token: CancellationToken,
    done: tokio::sync::watch::Sender<bool>,
}

impl Drop for ActiveToken {
    fn drop(&mut self) {
        self.token.cancel();
        lock(&self.sessions).remove(&self.session_id);
        let _ = self.done.send(true);
    }
}

impl TaskRuntimeAdapter for BuiltinTaskAdapter {
    fn supports(&self, agent_id: &str) -> bool {
        !agent_id.trim().is_empty()
    }

    fn run(
        &self,
        context: TaskRunContext,
        cancel: CancellationToken,
        events: TaskEventSink,
    ) -> TaskRuntimeFuture<TaskRuntimeOutcome> {
        let adapter = self.clone();
        Box::pin(async move {
            let cancel = cancel.child();
            let (done, receiver) = tokio::sync::watch::channel(false);
            lock(&adapter.tokens).insert(
                context.session_id.clone(),
                ActiveTaskRun {
                    token: cancel.clone(),
                    done: receiver,
                },
            );
            let _active = ActiveToken {
                sessions: adapter.tokens.clone(),
                session_id: context.session_id.clone(),
                token: cancel.clone(),
                done,
            };
            if cancel.is_cancelled() {
                return Err("The task was cancelled.".into());
            }
            let files = Arc::new(TaskFiles::open(
                Path::new(&context.execution_root),
                &context.allowed_paths,
            )?);
            let skills = skill_prompt(&adapter.app, &context)?;
            let resolved = super::resolve_for_run_off_thread(
                Some(super::ProviderOverride {
                    provider_id: context.agent_id.clone(),
                    model_id: context.model_id.clone(),
                }),
                true,
            )
            .await?;
            let client = adapter.app.state::<super::AgentState>().client()?;
            let usage = super::usage::NativeUsageGuard::new(
                crate::paths::oleafly_root()?,
                super::usage::UsageScope {
                    session_id: context.session_id.clone(),
                    turn_id: format!("{}:{}", context.task_id, context.execution_generation),
                    project_id: Some(context.project_id.clone()),
                    task_id: Some(context.task_id.clone()),
                    parent_session_id: None,
                },
                &resolved,
            );
            let bridge = Arc::new(
                crate::research_mcp::start_restricted(
                    adapter.app.clone(),
                    context.project_id.clone(),
                    PathBuf::from(&context.execution_root),
                    context.allowed_paths.clone(),
                )
                .await?,
            );
            let jobs = Arc::new(CommandJobs::default());
            let mut request =
                CompletionRequest::prompt(task_prompt(&context, &skills), context.prompt.clone());
            request.tools = file_tools();
            let reserved = request
                .tools
                .iter()
                .map(|tool| tool.name.clone())
                .collect::<BTreeSet<_>>();
            request.tools.extend(
                crate::research_mcp::tool_definitions()
                    .into_iter()
                    .filter(|tool| !reserved.contains(&tool.name))
                    .map(|tool| ToolSchema {
                        name: tool.name,
                        description: tool.description,
                        input_schema: tool.input_schema,
                    }),
            );
            let names = request
                .tools
                .iter()
                .map(|tool| tool.name.clone())
                .collect::<BTreeSet<_>>();
            let tool_context = context.clone();
            let tool_token = cancel.clone();
            let tool_bridge = bridge.clone();
            let tool_jobs = jobs.clone();
            let runner: ToolRunner = Arc::new(move |call| {
                let files = files.clone();
                let bridge = tool_bridge.clone();
                let jobs = tool_jobs.clone();
                let context = tool_context.clone();
                let token = tool_token.clone();
                let allowed = names.contains(&call.name);
                Box::pin(async move {
                    let result = async {
                        if token.is_cancelled() {
                            return Err("The task was cancelled.".to_string());
                        }
                        if !allowed {
                            return Err("This tool is unavailable in research tasks.".into());
                        }
                        let args: Value = serde_json::from_str(&call.arguments)
                            .map_err(|_| "Tool arguments must be valid JSON.".to_string())?;
                        match call.name.as_str() {
                            "read_file" => files.read_window(
                                text_argument(&args, "path")?,
                                args["offset"].as_u64().unwrap_or(0) as usize,
                                args["limit"].as_u64().unwrap_or(MAX_OUTPUT_BYTES as u64) as usize,
                            ),
                            "write_file" => files.write(
                                text_argument(&args, "path")?,
                                text_argument(&args, "content")?,
                            ),
                            "list_files" => files.list(args["path"].as_str().unwrap_or("")).map(
                                |(files, truncated)| json!({"files":files,"truncated":truncated}),
                            ),
                            "search_project" => files.search(text_argument(&args, "query")?),
                            "run_command" => {
                                jobs.run(context, text_argument(&args, "command")?.into(), token)
                                    .await
                            }
                            name => bridge.call_tool(name, &args).await,
                        }
                    }
                    .await;
                    ToolOutput::text(match result {
                        Ok(value) => value.to_string(),
                        Err(error) => json!({"error":error}).to_string(),
                    })
                })
            });
            events(TaskRuntimeEvent::SessionBound {
                native_session_id: context.session_id.clone(),
            });
            let observed_usage = Mutex::new(None);
            let outcome = oleafly_agent::run_agent_with_pipeline(
                &client,
                &resolved,
                request,
                &RunConfig::default(),
                ToolPipeline {
                    token: cancel.clone(),
                    ..ToolPipeline::default()
                },
                None,
                runner,
                |event| {
                    if let AgentEvent::Usage { usage } = &event {
                        *lock(&observed_usage) = Some((
                            usage.reported_input().map(u64::from),
                            usage.reported_output().map(u64::from),
                        ));
                    }
                    usage.observe(&event);
                    if let Some(event) = builtin_event(event) {
                        events(event);
                    }
                },
            )
            .await;
            let was_cancelled = cancel.is_cancelled();
            cancel.cancel();
            jobs.finish().await;
            bridge.shutdown().await;
            let outcome = match outcome {
                Ok(outcome)
                    if !was_cancelled && outcome.error.is_none() && !outcome.stopped_at_cap =>
                {
                    outcome
                }
                Ok(outcome) => {
                    usage.finish(if was_cancelled { "cancelled" } else { "failed" });
                    return Err(outcome.error.unwrap_or_else(|| {
                        if was_cancelled {
                            "The task was cancelled.".into()
                        } else {
                            "The task reached its step limit before finishing.".into()
                        }
                    }));
                }
                Err(error) => {
                    usage.finish(if was_cancelled { "cancelled" } else { "failed" });
                    return Err(error.to_string());
                }
            };
            usage.finish("completed");
            let observed_usage = *lock(&observed_usage);
            Ok(TaskRuntimeOutcome {
                summary: outcome.text,
                artifacts: Vec::new(),
                native_session_id: Some(context.session_id),
                input_tokens: observed_usage.and_then(|usage| usage.0),
                output_tokens: observed_usage.and_then(|usage| usage.1),
            })
        })
    }

    fn cancel(&self, session_id: String) -> TaskRuntimeFuture<()> {
        let tokens = self.tokens.clone();
        Box::pin(async move {
            let active = lock(&tokens).get(&session_id).cloned();
            if let Some(mut active) = active {
                active.token.cancel();
                while !*active.done.borrow_and_update() {
                    if active.done.changed().await.is_err() {
                        break;
                    }
                }
            }
            Ok(())
        })
    }
}

fn builtin_event(event: AgentEvent) -> Option<TaskRuntimeEvent> {
    match event {
        AgentEvent::TextDelta { text } => Some(TaskRuntimeEvent::Text { text }),
        AgentEvent::ReasoningDelta { text } => Some(TaskRuntimeEvent::Reasoning { text }),
        AgentEvent::ToolRequest {
            name, arguments, ..
        } => Some(TaskRuntimeEvent::Tool {
            name,
            detail: arguments,
        }),
        AgentEvent::ToolOutcome { id, output } => Some(TaskRuntimeEvent::Tool {
            name: id,
            detail: bounded(&output, MAX_OUTPUT_BYTES),
        }),
        AgentEvent::Usage { usage } => Some(TaskRuntimeEvent::Usage {
            input_tokens: usage.reported_input().map(u64::from),
            output_tokens: usage.reported_output().map(u64::from),
        }),
        AgentEvent::Error { message, .. } => Some(TaskRuntimeEvent::Status { message }),
        AgentEvent::StepStart { step } => Some(TaskRuntimeEvent::Status {
            message: format!("Working on step {step}."),
        }),
        _ => None,
    }
}

pub fn register_task_runtimes(app: &tauri::AppHandle) -> Result<(), String> {
    let tasks = app
        .try_state::<ResearchTaskState>()
        .ok_or("Research task storage is unavailable.")?;
    tasks.register_runtime(
        "builtin",
        Arc::new(BuiltinTaskAdapter {
            app: app.clone(),
            tokens: Arc::new(Mutex::new(HashMap::new())),
        }),
    )?;
    let runtime = app
        .try_state::<Arc<crate::acp::AcpRuntime>>()
        .ok_or("The ACP runtime is unavailable.")?
        .inner()
        .clone();
    tasks.register_runtime(
        "acp",
        Arc::new(AcpTaskAdapter {
            app: app.clone(),
            runtime,
            tokens: Arc::new(Mutex::new(HashMap::new())),
        }),
    )?;
    Ok(())
}

#[derive(Clone)]
struct AcpTaskAdapter {
    app: tauri::AppHandle,
    runtime: Arc<crate::acp::AcpRuntime>,
    tokens: Arc<Mutex<HashMap<String, ActiveTaskRun>>>,
}

impl TaskRuntimeAdapter for AcpTaskAdapter {
    fn supports(&self, agent_id: &str) -> bool {
        !agent_id.trim().is_empty()
    }

    fn run(
        &self,
        context: TaskRunContext,
        cancel: CancellationToken,
        events: TaskEventSink,
    ) -> TaskRuntimeFuture<TaskRuntimeOutcome> {
        let adapter = self.clone();
        Box::pin(async move {
            let cancel = cancel.child();
            let (done, receiver) = tokio::sync::watch::channel(false);
            lock(&adapter.tokens).insert(
                context.session_id.clone(),
                ActiveTaskRun {
                    token: cancel.clone(),
                    done: receiver,
                },
            );
            let _active = ActiveToken {
                sessions: adapter.tokens.clone(),
                session_id: context.session_id.clone(),
                token: cancel.clone(),
                done,
            };
            adapter.run_task(context, cancel, events).await
        })
    }

    fn cancel(&self, session_id: String) -> TaskRuntimeFuture<()> {
        let runtime = self.runtime.clone();
        let tokens = self.tokens.clone();
        Box::pin(async move {
            let active = lock(&tokens).get(&session_id).cloned();
            if let Some(active) = &active {
                active.token.cancel();
            }
            runtime
                .close_owner(&format!("research-task:{session_id}"))
                .await;
            if let Some(mut active) = active {
                while !*active.done.borrow_and_update() {
                    if active.done.changed().await.is_err() {
                        break;
                    }
                }
            }
            Ok(())
        })
    }
}

fn acp_task_start(
    runtime: &crate::acp::AcpRuntime,
    context: &TaskRunContext,
    execution_root: PathBuf,
) -> (crate::acp::StartSession, u64) {
    let owner = format!("research-task:{}", context.session_id);
    let generation = runtime.owner_generation(&owner);
    (
        crate::acp::StartSession {
            project_id: context.project_id.clone(),
            project_path: execution_root,
            agent_id: context.agent_id.clone(),
            parent_session_id: None,
            task_id: Some(context.task_id.clone()),
            owner: Some(owner),
            allowed_paths: Some(context.allowed_paths.clone()),
        },
        generation,
    )
}

impl AcpTaskAdapter {
    async fn run_task(
        &self,
        context: TaskRunContext,
        cancel: CancellationToken,
        events: TaskEventSink,
    ) -> Result<TaskRuntimeOutcome, String> {
        if cancel.is_cancelled() {
            return Err("The task was cancelled.".into());
        }
        let files = TaskFiles::open(Path::new(&context.execution_root), &context.allowed_paths)?;
        let skills = skill_prompt(&self.app, &context)?;
        let (options, generation) = acp_task_start(&self.runtime, &context, files.root.clone());
        let bridge = crate::research_mcp::start_restricted(
            self.app.clone(),
            context.project_id.clone(),
            files.root.clone(),
            context.allowed_paths.clone(),
        )
        .await?;
        if cancel.is_cancelled() {
            bridge.shutdown().await;
            return Err("The task was cancelled.".into());
        }
        let started = self
            .runtime
            .start_with_mcp_at_generation(options, vec![bridge.mcp_server()], Some(generation))
            .await;
        let session = match started {
            Ok(value) => value.session,
            Err(error) => {
                self.runtime
                    .close_owner(&format!("research-task:{}", context.session_id))
                    .await;
                bridge.shutdown().await;
                return Err(error);
            }
        };
        let id = session.id.clone();
        events(TaskRuntimeEvent::SessionBound {
            native_session_id: id.clone(),
        });
        let outcome = self
            .prompt_task(&context, &id, &skills, &cancel, &events)
            .await;
        let cleanup = if outcome.is_ok() {
            self.runtime.close(&id).await
        } else {
            self.runtime.cancel(&id).await
        };
        bridge.shutdown().await;
        cleanup?;
        outcome
    }

    async fn prompt_task(
        &self,
        context: &TaskRunContext,
        id: &str,
        skills: &str,
        cancel: &CancellationToken,
        events: &TaskEventSink,
    ) -> Result<TaskRuntimeOutcome, String> {
        if cancel.is_cancelled() {
            return Err("The task was cancelled.".into());
        }
        self.runtime.set_model(id, &context.model_id).await?;
        let mut receiver = self.runtime.subscribe();
        let mut sequence = 0;
        let mut stop_reason = None;
        let mut result = TaskRuntimeOutcome {
            summary: String::new(),
            artifacts: Vec::new(),
            native_session_id: Some(id.into()),
            input_tokens: None,
            output_tokens: None,
        };
        let prompt = self
            .runtime
            .prompt(id, task_prompt(context, skills), Vec::new());
        tokio::pin!(prompt);
        let snapshot = loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => {
                    self.runtime.cancel(id).await?;
                    return Err("The task was cancelled.".into());
                }
                completed = &mut prompt => break completed?,
                event = receiver.recv() => match event {
                    Ok(event) if event.session_id == id => { self.catch_up(id,&mut sequence,&mut result,&mut stop_reason,events)?; }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => { self.catch_up(id,&mut sequence,&mut result,&mut stop_reason,events)?; }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return Err("The ACP event stream closed before the task finished.".into()),
                    _ => {}
                }
            }
        };
        self.catch_up(id, &mut sequence, &mut result, &mut stop_reason, events)?;
        if snapshot.session.status != crate::acp::SessionStatus::Ready {
            return Err(snapshot
                .session
                .error
                .unwrap_or_else(|| "The agent stopped before finishing the task.".into()));
        }
        if stop_reason.as_deref() != Some("end_turn") {
            return Err(format!(
                "The agent did not finish the task: {}.",
                stop_reason.as_deref().unwrap_or("no completion event")
            ));
        }
        if result.summary.trim().is_empty() {
            result.summary =
                "The agent finished. Review its workspace changes and transcript.".into();
        }
        Ok(result)
    }

    fn catch_up(
        &self,
        id: &str,
        sequence: &mut u64,
        result: &mut TaskRuntimeOutcome,
        stop_reason: &mut Option<String>,
        events: &TaskEventSink,
    ) -> Result<(), String> {
        loop {
            let page = self.runtime.events(id, *sequence, 256)?;
            for event in page.events {
                *sequence = event.sequence;
                if event.kind == "turn_complete" {
                    *stop_reason = event.data["stopReason"].as_str().map(str::to_string);
                }
                if let Some(event) = acp_event(&event, result) {
                    events(event);
                }
            }
            if !page.has_more {
                return Ok(());
            }
        }
    }
}

fn acp_event(
    event: &crate::acp::AcpEvent,
    outcome: &mut TaskRuntimeOutcome,
) -> Option<TaskRuntimeEvent> {
    match event.kind.as_str() {
        "agent_message_chunk" => {
            let text = event.data["content"]["text"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            if outcome.summary.len() < MAX_FILE_BYTES {
                outcome
                    .summary
                    .push_str(&bounded(&text, MAX_FILE_BYTES - outcome.summary.len()));
            }
            Some(TaskRuntimeEvent::Text { text })
        }
        "agent_thought_chunk" => Some(TaskRuntimeEvent::Reasoning {
            text: event.data["content"]["text"]
                .as_str()
                .unwrap_or_default()
                .into(),
        }),
        "tool_call" | "tool_call_update" => Some(TaskRuntimeEvent::Tool {
            name: event.data["title"].as_str().unwrap_or("Agent tool").into(),
            detail: bounded(&event.data.to_string(), MAX_OUTPUT_BYTES),
        }),
        "usage" if event.data["source"] != "acp_context" => {
            outcome.input_tokens = event.data["inputTokens"].as_u64().or(outcome.input_tokens);
            outcome.output_tokens = event.data["outputTokens"]
                .as_u64()
                .or(outcome.output_tokens);
            Some(TaskRuntimeEvent::Usage {
                input_tokens: outcome.input_tokens,
                output_tokens: outcome.output_tokens,
            })
        }
        "permission" => Some(TaskRuntimeEvent::Status {
            message: "The agent is waiting for a permission decision in its session.".into(),
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files(root: &Path) -> TaskFiles {
        TaskFiles::open(root, &["main.tex".into(), "analysis".into()]).unwrap()
    }

    #[test]
    fn file_tools_write_only_the_isolated_allowed_paths() {
        let source = tempfile::tempdir().unwrap();
        let isolated = tempfile::tempdir().unwrap();
        std::fs::write(source.path().join("main.tex"), "original").unwrap();
        std::fs::write(isolated.path().join("main.tex"), "snapshot").unwrap();
        let files = files(isolated.path());
        files.write("main.tex", "changed").unwrap();
        files.write("analysis/results/note.md", "result").unwrap();
        assert_eq!(
            std::fs::read_to_string(source.path().join("main.tex")).unwrap(),
            "original"
        );
        assert_eq!(files.read("main.tex").unwrap(), "changed");
        assert!(files.write("private.txt", "denied").is_err());
        assert!(files.write("../escape", "denied").is_err());
        assert!(files.read("/etc/passwd").is_err());
        assert!(files.write("analysis/.git/config", "denied").is_err());
        assert!(files.write("analysis/.PRIVATE/note", "denied").is_err());
        assert!(files.read("analysis/.private/note").is_err());
        assert!(TaskFiles::open(isolated.path(), &[".private".into()]).is_err());
        assert!(files.read("C:\\private").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn file_tools_reject_links_and_replace_hardlinks_without_mutating_the_source() {
        use std::os::unix::fs::symlink;
        let source = tempfile::tempdir().unwrap();
        let isolated = tempfile::tempdir().unwrap();
        std::fs::write(source.path().join("original"), "original").unwrap();
        symlink(source.path(), isolated.path().join("analysis")).unwrap();
        let files = files(isolated.path());
        assert!(files.read("analysis/original").is_err());
        assert!(files.write("analysis/original", "changed").is_err());
        assert!(files.list("").unwrap().0.is_empty());
        std::fs::hard_link(
            source.path().join("original"),
            isolated.path().join("main.tex"),
        )
        .unwrap();
        files.write("main.tex", "changed").unwrap();
        assert_eq!(
            std::fs::read_to_string(source.path().join("original")).unwrap(),
            "original"
        );
    }

    #[test]
    fn file_reads_and_searches_are_bounded_and_skip_binary_files() {
        let isolated = tempfile::tempdir().unwrap();
        let files = files(isolated.path());
        files.write("main.tex", "one\nneedle two\n").unwrap();
        files.write("analysis/results.txt", "needle three").unwrap();
        std::fs::write(isolated.path().join("analysis/binary"), [0xff, 0xfe]).unwrap();
        assert_eq!(
            files.search("needle").unwrap()["matches"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert!(files
            .write("main.tex", &"x".repeat(MAX_FILE_BYTES + 1))
            .is_err());
        std::fs::write(
            isolated.path().join("main.tex"),
            vec![b'x'; MAX_FILE_BYTES + 1],
        )
        .unwrap();
        assert!(files.read("main.tex").is_err());
    }

    #[test]
    fn partial_file_reads_can_continue_without_splitting_unicode() {
        let isolated = tempfile::tempdir().unwrap();
        let files = files(isolated.path());
        files.write("main.tex", "a🍃remaining text").unwrap();
        let first = files.read_window("main.tex", 0, 4).unwrap();
        assert_eq!(first["content"], "a");
        assert_eq!(first["nextOffset"], 1);
        let next = files.read_window("main.tex", 1, 4).unwrap();
        assert_eq!(next["content"], "🍃");
        assert_eq!(next["nextOffset"], 5);
        let last = files.read_window("main.tex", 5, MAX_OUTPUT_BYTES).unwrap();
        assert_eq!(last["content"], "remaining text");
        assert!(last["nextOffset"].is_null());
        assert!(files.read_window("main.tex", 2, 4).is_err());
        assert!(files.read_window("main.tex", usize::MAX, 4).is_err());
    }

    #[test]
    fn context_usage_does_not_become_input_tokens() {
        let event = crate::acp::AcpEvent {
            session_id: "session".into(),
            project_id: "project".into(),
            agent_id: "agent".into(),
            model_id: None,
            task_id: Some("task".into()),
            turn_id: Some("turn".into()),
            sequence: 1,
            timestamp: 0,
            kind: "usage".into(),
            data: json!({"contextUsed":1234,"source":"acp_context"}),
        };
        let mut outcome = TaskRuntimeOutcome {
            summary: String::new(),
            artifacts: Vec::new(),
            native_session_id: None,
            input_tokens: None,
            output_tokens: None,
        };
        assert!(acp_event(&event, &mut outcome).is_none());
        assert_eq!(outcome.input_tokens, None);
    }

    #[test]
    fn synthetic_default_usage_is_unknown_but_reported_zero_is_retained() {
        assert!(matches!(
            builtin_event(AgentEvent::Usage {
                usage: oleafly_agent::Usage::default(),
            }),
            Some(TaskRuntimeEvent::Usage {
                input_tokens: None,
                output_tokens: None
            })
        ));
        assert!(matches!(
            builtin_event(AgentEvent::Usage {
                usage: oleafly_agent::Usage {
                    input_semantics: oleafly_agent::InputTokenSemantics::Inclusive,
                    ..Default::default()
                },
            }),
            Some(TaskRuntimeEvent::Usage {
                input_tokens: Some(0),
                output_tokens: Some(0)
            })
        ));
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn context(root: &Path) -> TaskRunContext {
        TaskRunContext {
            task_id: "task".into(),
            execution_generation: 1,
            session_id: "session".into(),
            project_id: "project".into(),
            execution_root: root.to_string_lossy().into_owned(),
            title: "Task".into(),
            prompt: "Task prompt".into(),
            runtime_id: "builtin".into(),
            agent_id: "openai".into(),
            model_id: "test".into(),
            skill_ids: Vec::new(),
            source_revision: "snapshot".into(),
            allowed_paths: vec!["analysis".into()],
        }
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn closing_a_task_during_bridge_preparation_invalidates_its_acp_start() {
        let temporary = tempfile::tempdir().unwrap();
        let workspace = temporary.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let runtime = crate::acp::AcpRuntime::new(temporary.path().join("acp")).unwrap();
        let mut context = context(&workspace);
        context.agent_id = "gemini".into();
        context.runtime_id = "acp".into();
        let owner = format!("research-task:{}", context.session_id);
        let project_id = context.project_id.clone();
        let pending = runtime.clone();
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let (resume_tx, resume_rx) = tokio::sync::oneshot::channel();
        let start = tokio::spawn(async move {
            let (options, generation) = acp_task_start(&pending, &context, workspace);
            ready_tx.send(()).unwrap();
            resume_rx.await.unwrap();
            pending
                .start_with_mcp_at_generation(options, Vec::new(), Some(generation))
                .await
        });
        ready_rx.await.unwrap();
        runtime.close_owner(&owner).await;
        resume_tx.send(()).unwrap();
        let result = tokio::time::timeout(Duration::from_secs(2), start)
            .await
            .unwrap()
            .unwrap();
        let error = result.unwrap_err();
        assert!(
            error.contains("closed while the agent was starting"),
            "{error}"
        );
        assert!(runtime.list(&project_id).unwrap().is_empty());
        assert!(!temporary.path().join("acp/task-temp").exists());
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[tokio::test]
    async fn commands_cannot_write_original_files_or_follow_writable_links_outside_the_workspace() {
        let source = tempfile::tempdir().unwrap();
        let isolated = tempfile::tempdir().unwrap();
        let original = source.path().join("main.tex");
        std::fs::write(&original, "original").unwrap();
        let quoted = original.to_string_lossy().replace('\'', "'\\''");
        let command = format!("printf allowed > analysis/result.txt; printf denied > '{quoted}'; ln -s '{quoted}' analysis/linked; printf denied > analysis/linked; ln '{quoted}' analysis/hardlinked; printf denied > analysis/hardlinked; printf denied > unapproved.txt; printf done");
        let result = execute_command(
            &context(isolated.path()),
            &command,
            CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(result["exitCode"], 0, "{result}");
        assert_eq!(std::fs::read_to_string(&original).unwrap(), "original");
        assert_eq!(
            std::fs::read_to_string(isolated.path().join("analysis/result.txt")).unwrap(),
            "allowed"
        );
        assert!(!isolated.path().join("unapproved.txt").exists());
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn cancelling_a_command_waits_for_its_process_group_and_output_readers() {
        let isolated = tempfile::tempdir().unwrap();
        let context = context(isolated.path());
        let token = CancellationToken::new();
        let child_token = token.clone();
        let task = tokio::spawn(async move {
            execute_command(
                &context,
                "sleep 60 & printf '%s' \"$!\" > analysis/child.pid; wait",
                child_token,
            )
            .await
        });
        let pid_path = isolated.path().join("analysis/child.pid");
        tokio::time::timeout(Duration::from_secs(5), async {
            while !pid_path.is_file() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let pid = std::fs::read_to_string(&pid_path)
            .unwrap()
            .parse::<i32>()
            .unwrap();
        token.cancel();
        let result = tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(result["cancelled"], true);
        tokio::time::timeout(Duration::from_secs(2), async {
            while unsafe { libc::kill(pid, 0) } == 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("the command's descendant must be stopped before cleanup finishes");
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[tokio::test]
    async fn commands_drain_both_streams_without_retaining_unbounded_output() {
        let isolated = tempfile::tempdir().unwrap();
        let result = execute_command(
            &context(isolated.path()),
            "dd if=/dev/zero bs=1024 count=128; dd if=/dev/zero bs=1024 count=128 >&2",
            CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(result["exitCode"], 0, "{result}");
        assert_eq!(result["truncated"], true);
        assert!(result["output"].as_str().unwrap().len() <= MAX_OUTPUT_BYTES);
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn command_descendants_cannot_detach_and_write_after_completion() {
        let isolated = tempfile::tempdir().unwrap();
        let analysis = isolated.path().join("analysis");
        std::fs::create_dir(&analysis).unwrap();
        let source = analysis.join("escape.c");
        let binary = analysis.join("escape");
        std::fs::write(
            &source,
            r#"
#include <errno.h>
#include <fcntl.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <unistd.h>
extern char **environ;
int main(void) {
    pid_t child = fork();
    if (child > 0) { waitpid(child, NULL, 0); return 0; }
    if (child < 0) return 2;
    errno = 0; int sid = setsid(); int sid_error = errno;
    errno = 0; int group = setpgid(0, 0); int group_error = errno;
    posix_spawnattr_t attributes;
    posix_spawnattr_init(&attributes);
    posix_spawnattr_setflags(&attributes, POSIX_SPAWN_SETPGROUP);
    posix_spawnattr_setpgroup(&attributes, 0);
    char *arguments[] = { "/bin/true", NULL };
    pid_t spawned;
    int spawn_error = posix_spawn(&spawned, arguments[0], NULL, &attributes, arguments, environ);
    if (!spawn_error) waitpid(spawned, NULL, 0);
    FILE *report = fopen("analysis/report", "w");
    fprintf(report, "%d %d %d %d %d", sid, sid_error, group, group_error, spawn_error);
    fclose(report);
    pid_t grandchild = fork();
    if (grandchild == 0) {
        close(0); close(1); close(2);
        usleep(300000);
        int marker = open("analysis/survived", O_WRONLY | O_CREAT, 0600);
        if (marker >= 0) { write(marker, "survived", 8); close(marker); }
        _exit(0);
    }
    FILE *pidfile = fopen("analysis/grandchild.pid", "w");
    fprintf(pidfile, "%d", grandchild);
    fclose(pidfile);
    _exit(0);
}
"#,
        )
        .unwrap();
        let compile = std::process::Command::new("/usr/bin/cc")
            .arg(&source)
            .arg("-o")
            .arg(&binary)
            .output()
            .unwrap();
        assert!(
            compile.status.success(),
            "{}",
            String::from_utf8_lossy(&compile.stderr)
        );
        let result = execute_command(
            &context(isolated.path()),
            "analysis/escape",
            CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(result["exitCode"], 0, "{result}");
        let report = std::fs::read_to_string(analysis.join("report")).unwrap();
        let pid = std::fs::read_to_string(analysis.join("grandchild.pid"))
            .unwrap()
            .parse::<i32>()
            .unwrap();
        tokio::time::sleep(Duration::from_millis(450)).await;
        let survived = analysis.join("survived").exists();
        unsafe {
            libc::kill(pid, libc::SIGKILL);
        }
        assert_eq!(report, "-1 1 -1 1 78");
        assert!(
            !survived,
            "a detached grandchild wrote after the command was reported finished"
        );
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[tokio::test]
    async fn task_commands_cannot_read_unlinked_files() {
        let unrelated = tempfile::tempdir().unwrap();
        let isolated = tempfile::tempdir().unwrap();
        let secret = unrelated.path().join("private.txt");
        std::fs::write(&secret, "private data").unwrap();
        let quoted = secret.to_string_lossy().replace('\'', "'\\''");
        let result = execute_command(
            &context(isolated.path()),
            &format!("cat '{quoted}' > analysis/leaked"),
            CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_ne!(result["exitCode"], 0);
        assert_eq!(
            std::fs::read(isolated.path().join("analysis/leaked")).unwrap(),
            Vec::<u8>::new()
        );
    }

    #[test]
    fn acp_text_uses_the_protocol_content_block() {
        let event = crate::acp::AcpEvent {
            session_id: "session".into(),
            project_id: "project".into(),
            agent_id: "agent".into(),
            model_id: None,
            task_id: None,
            turn_id: None,
            sequence: 1,
            timestamp: 0,
            kind: "agent_message_chunk".into(),
            data: json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"A result"}}),
        };
        let mut outcome = TaskRuntimeOutcome {
            summary: String::new(),
            artifacts: Vec::new(),
            native_session_id: None,
            input_tokens: None,
            output_tokens: None,
        };
        assert!(
            matches!(acp_event(&event,&mut outcome),Some(TaskRuntimeEvent::Text { text }) if text == "A result")
        );
        assert_eq!(outcome.summary, "A result");
    }
}

#[cfg(test)]
#[path = "task_runtime/tests.rs"]
mod behavior_tests;
