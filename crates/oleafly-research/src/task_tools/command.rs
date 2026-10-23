//! Confined shell commands for research tasks.
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;

use oleafly_agent::CancellationToken;
use serde_json::{json, Value};
use tokio::io::{AsyncRead, AsyncReadExt};

use super::{lock, TaskFiles, COMMAND_TIMEOUT, MAX_OUTPUT_BYTES};

#[cfg(any(test, feature = "test-support"))]
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
    let spec = task_sandbox_spec(
        execution_root,
        allowed_paths,
        writable_temp,
        network,
        read_paths,
    )?;
    let args: Vec<std::ffi::OsString> = args.iter().map(Into::into).collect();
    oleafly_sandbox::command(&spec, program, &args)
        .map(tokio::process::Command::from)
        .map_err(String::from)
}

/// What a task's command may touch: its workspace, write grants for the
/// allowed paths (created when missing), the extra read grants and a private
/// home. CLI-agent tasks add their environment and helper rule to it.
pub fn task_sandbox_spec(
    execution_root: &Path,
    allowed_paths: &[String],
    writable_temp: &Path,
    network: bool,
    read_paths: &[PathBuf],
) -> Result<oleafly_sandbox::SandboxSpec, String> {
    task_sandbox_spec_for(
        "",
        None,
        execution_root,
        allowed_paths,
        writable_temp,
        network,
        read_paths,
    )
}

/// [`task_sandbox_spec`] for a named owner (`task:<id>`) and project; the
/// Windows sandbox names the task's profile after the owner.
pub fn task_sandbox_spec_for(
    owner: &str,
    project: Option<&str>,
    execution_root: &Path,
    allowed_paths: &[String],
    writable_temp: &Path,
    network: bool,
    read_paths: &[PathBuf],
) -> Result<oleafly_sandbox::SandboxSpec, String> {
    // Check the temporary folder before any write grant is created, so a bad
    // folder fails without touching the workspace.
    oleafly_sandbox::prepare_home(writable_temp)?;
    let writable = task_writable_paths(execution_root, allowed_paths)?;
    let root = TaskFiles::open(execution_root, allowed_paths)?.root;
    let mut spec =
        oleafly_sandbox::SandboxSpec::new(owner, root.clone(), writable_temp.to_path_buf());
    spec.project = project.map(str::to_owned);
    spec.read_only = read_paths.to_vec();
    spec.read_write = writable;
    spec.network = network;
    spec.protected = vec![root.join(".git"), root.join(".oleafly")];
    Ok(spec)
}

/// The allowed paths that no other allowed path contains. A grant on a folder
/// covers everything below it, so a file or folder under another allowed
/// folder needs none of its own: a project of thousands of files then
/// grants its folders, not every file (a grant per file overflows the
/// command line of the sandbox and slows every command down).
fn outermost(allowed: &[PathBuf]) -> Vec<&Path> {
    let mut sorted: Vec<&Path> = allowed.iter().map(PathBuf::as_path).collect();
    sorted.sort_unstable();
    let mut kept: Vec<&Path> = Vec::new();
    for path in sorted {
        // Sorted by components, a folder comes right before what is inside it.
        if kept.last().is_some_and(|folder| path.starts_with(folder)) {
            continue;
        }
        kept.push(path);
    }
    kept
}

/// The task's write grants: its allowed paths inside the workspace, created
/// when missing, never through a link. Paths below another allowed path are
/// left out (see [`outermost`]).
pub fn task_writable_paths(
    execution_root: &Path,
    allowed_paths: &[String],
) -> Result<Vec<PathBuf>, String> {
    let files = TaskFiles::open(execution_root, allowed_paths)?;
    let mut writable = Vec::new();
    for relative in outermost(&files.allowed) {
        let path = files.root.join(relative);
        let (directory, name) = files.parent(relative, true)?;
        match directory.symlink_metadata(&name) {
            Ok(metadata) if metadata.is_symlink() => {
                return Err("A task command cannot use a writable symbolic link.".into());
            }
            Ok(metadata) if metadata.is_dir() || metadata.is_file() => {}
            Ok(_) => return Err("A task command can only use regular files and folders.".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                // A folder the task is meant to write in comes back when it is
                // gone. A file the task deleted or moved does not: creating it
                // as a folder would break the next command that opens it.
                if !is_known_folder(relative, &files.allowed) {
                    continue;
                }
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
    Ok(writable)
}

/// Whether a missing allowed path is a folder: one of the output folders, or
/// one that holds other allowed paths (the parent of a tracked file).
fn is_known_folder(relative: &Path, allowed: &[PathBuf]) -> bool {
    crate::isolation::is_output_directory(relative)
        || allowed
            .iter()
            .any(|other| other != relative && other.starts_with(relative))
}

pub(crate) struct CommandTemp(pub(crate) PathBuf);

impl CommandTemp {
    pub(crate) fn new() -> Result<Self, String> {
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

/// What a task command may touch, resolved once per run.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CommandContext {
    pub execution_root: String,
    pub allowed_paths: Vec<String>,
    /// Extra read-only grants (the selected skills' folders).
    pub read_paths: Vec<PathBuf>,
    pub network: bool,
    /// `task:<id>`; names the task's sandbox profile on Windows.
    pub owner: String,
    pub project: Option<String>,
    /// The task's home, kept across its commands and runs. Without one each
    /// command gets a throwaway temporary folder.
    pub home: Option<PathBuf>,
    /// The project's linked data folders (read-only).
    pub linked: Vec<oleafly_sandbox::profile::LinkedFolder>,
    /// Where interpreters are looked for.
    pub search_dirs: Vec<PathBuf>,
    /// The real project folder (its virtual environments stay out of the
    /// task's copy).
    pub project_root: Option<PathBuf>,
    /// Oleafly's data folder; its compute settings hold the Windows
    /// sandbox switch.
    pub data_root: Option<PathBuf>,
}

/// The run-profile sandbox for a command of a task with a home folder.
pub fn command_spec(
    context: &CommandContext,
    home: &Path,
) -> Result<oleafly_sandbox::SandboxSpec, String> {
    use oleafly_sandbox::profile::{
        detect_runtimes_cached, spec_for_run, DetectInputs, RunInputs, RunProfile,
    };
    oleafly_sandbox::profile::prepare_home(home).map_err(|error| error.to_string())?;
    let root = Path::new(&context.execution_root);
    let writable = task_writable_paths(root, &context.allowed_paths)?;
    let user_home = oleafly_sandbox::home_dir();
    let env = |name: &str| std::env::var_os(name);
    let runtimes = detect_runtimes_cached(&DetectInputs {
        search_dirs: &context.search_dirs,
        project_root: context.project_root.as_deref(),
        home: user_home.as_deref(),
        env: &env,
    });
    let host_env = |name: &str| std::env::var(name).ok();
    spec_for_run(&RunInputs {
        profile: RunProfile::Analysis,
        owner: &context.owner,
        project: context.project.as_deref(),
        workspace: root,
        writable: &writable,
        protected: &[root.join(".git"), root.join(".oleafly")],
        home,
        network: context.network,
        linked: &context.linked,
        extra_read: &context.read_paths,
        runtimes: &runtimes,
        host_env: &host_env,
    })
    .map_err(String::from)
}

/// Commands started by one run; [`CommandJobs::finish`] waits for them all.
#[derive(Default)]
pub struct CommandJobs {
    pub(crate) tasks: Mutex<Vec<tokio::task::JoinHandle<()>>>,
}

impl CommandJobs {
    pub async fn finish(&self) {
        let tasks = std::mem::take(&mut *lock(&self.tasks));
        for task in tasks {
            let _ = task.await;
        }
    }

    pub async fn run(
        &self,
        context: CommandContext,
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

pub(crate) async fn read_output<R: AsyncRead + Unpin>(mut stream: R) -> Vec<u8> {
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

pub async fn execute_command(
    context: &CommandContext,
    text: &str,
    token: CancellationToken,
) -> Result<Value, String> {
    if token.is_cancelled() {
        return Err("The task was cancelled.".into());
    }
    if text.trim().is_empty() || text.len() > 16 * 1024 {
        return Err("Use a command between 1 and 16384 bytes.".into());
    }
    if let Some(root) = &context.data_root {
        if let Some(reason) = crate::runs::remote::settings::local_commands_unavailable_reason(root)
        {
            return Err(reason);
        }
    }
    let temp = match &context.home {
        Some(_) => None,
        None => Some(CommandTemp::new()?),
    };
    let mut command = match (&context.home, &temp) {
        (Some(home), _) => {
            let context = context.clone();
            let home = home.clone();
            let text = text.to_owned();
            // Spec building detects runtimes and, on Windows, may grant
            // folder access, so it stays off the async threads.
            let std_command = tokio::task::spawn_blocking(move || {
                let spec = command_spec(&context, &home)?;
                oleafly_sandbox::shell_command(&spec, &text).map_err(String::from)
            })
            .await
            .map_err(|_| "The task command could not be prepared.".to_string())??;
            tokio::process::Command::from(std_command)
        }
        (None, Some(temp)) => sandbox_task_command_with_reads(
            Path::new("/bin/sh"),
            &["-c".into(), text.into()],
            Path::new(&context.execution_root),
            &context.allowed_paths,
            &temp.0,
            context.network,
            &context.read_paths,
        )?,
        (None, None) => return Err("The task command has no temporary folder.".into()),
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    oleafly_sandbox::process::isolate_process_tree(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("The task command could not start: {error}"))?;
    let pid = child.id().ok_or("The task command has no process ID.")?;
    let containment = match oleafly_sandbox::process::contain_process_tree(pid) {
        Ok(value) => value,
        Err(error) => {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
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
    let reaped = tokio::time::timeout(Duration::from_secs(2), child.wait())
        .await
        .ok()
        .and_then(Result::ok);
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
