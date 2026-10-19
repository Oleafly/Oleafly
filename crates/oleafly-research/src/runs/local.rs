//! Runs on this computer: a detached supervisor process owns each run.
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde_json::json;

use super::supervisor::{read_status, StatusFile};
use super::{
    log, LogQuery, RunError, RunExecutor, RunHandle, RunOutcomeKind, RunSpec, RunStatus,
    HANDLE_VERSION,
};
use crate::model::now_ms;
use oleafly_sandbox::process::identity::{self, ProcessIdentity, ProcessProbe};

/// The program (and leading arguments) that runs a supervisor; the run
/// folder is appended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupervisorCommand {
    pub program: PathBuf,
    pub args: Vec<OsString>,
}

#[derive(Clone)]
enum Launch {
    Process(SupervisorCommand),
    /// Tests supervise in a thread of the test process.
    #[cfg(test)]
    InProcess,
}

pub struct LocalExecutor {
    launch: Launch,
}

impl LocalExecutor {
    pub fn new(supervisor: SupervisorCommand) -> Self {
        Self {
            launch: Launch::Process(supervisor),
        }
    }

    #[cfg(test)]
    pub(crate) fn in_process() -> Self {
        Self {
            launch: Launch::InProcess,
        }
    }
}

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;

/// Windows creation flags for a supervisor: no console, its own group and,
/// when allowed, outside the app's kill-on-close job so it outlives the app.
pub fn supervisor_creation_flags(breakaway: bool) -> u32 {
    if cfg!(windows) {
        CREATE_NO_WINDOW
            | CREATE_NEW_PROCESS_GROUP
            | if breakaway {
                CREATE_BREAKAWAY_FROM_JOB
            } else {
                0
            }
    } else {
        0
    }
}

/// Variables an AppImage sets for itself that must not leak into a run.
const APPIMAGE_ENV: [&str; 5] = [
    "APPDIR",
    "APPIMAGE",
    "LD_LIBRARY_PATH",
    "GIO_MODULE_DIR",
    "GTK_PATH",
];

fn spawn_supervisor(
    supervisor: &SupervisorCommand,
    run_dir: &Path,
) -> std::io::Result<std::process::Child> {
    let build = |breakaway: bool| {
        let mut command = std::process::Command::new(&supervisor.program);
        command
            .args(&supervisor.args)
            .arg(run_dir)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        for name in APPIMAGE_ENV {
            command.env_remove(name);
        }
        #[cfg(unix)]
        unsafe {
            use std::os::unix::process::CommandExt;
            command.pre_exec(|| {
                // Its own session: closing the app or its terminal leaves it running.
                if libc::setsid() < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(supervisor_creation_flags(breakaway));
        }
        #[cfg(not(windows))]
        let _ = breakaway;
        command
    };
    match build(true).spawn() {
        // A job that forbids breakaway refuses with ERROR_ACCESS_DENIED.
        Err(error) if cfg!(windows) && error.raw_os_error() == Some(5) => build(false).spawn(),
        result => result,
    }
}

fn identity_of(pid: u32) -> ProcessIdentity {
    let started = match identity::probe(pid) {
        ProcessProbe::Running { started } => started,
        ProcessProbe::Gone => None,
    };
    ProcessIdentity { pid, started }
}

fn supervisor_alive(handle: &RunHandle) -> bool {
    let Some(pid) = handle.data["supervisorPid"]
        .as_u64()
        .and_then(|pid| u32::try_from(pid).ok())
    else {
        return false;
    };
    let recorded = handle.data["supervisorStarted"].as_u64();
    match identity::probe(pid) {
        ProcessProbe::Gone => false,
        ProcessProbe::Running { started } => match (recorded, started) {
            (Some(recorded), Some(observed)) => recorded == observed,
            _ => true,
        },
    }
}

fn status_from_file(status: StatusFile) -> Option<RunStatus> {
    match status.state.as_str() {
        "finished" => Some(RunStatus::Finished {
            exit_code: status.exit_code,
            finished_at: status.finished_at.unwrap_or_else(now_ms),
            outcome: status.outcome.unwrap_or(RunOutcomeKind::Failed),
            note: status.note,
        }),
        "running" => Some(RunStatus::Running {
            started_at: status.started_at,
            note: None,
        }),
        _ => None,
    }
}

/// Kills the run's process group (or tree) after its supervisor died.
fn kill_orphaned_run(child_pid: u32) {
    #[cfg(unix)]
    {
        if let Ok(group) = i32::try_from(child_pid) {
            oleafly_sandbox::process::signal_process_group(group, libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &child_pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

#[async_trait::async_trait]
impl RunExecutor for LocalExecutor {
    fn id(&self) -> &'static str {
        "local"
    }

    async fn start(&self, spec: &RunSpec) -> Result<RunHandle, RunError> {
        if spec.sandbox.is_none() {
            return Err(RunError::Config("Local runs need sandbox settings.".into()));
        }
        if let oleafly_sandbox::Availability::Unavailable(reason) = oleafly_sandbox::availability()
        {
            return Err(RunError::Unavailable(reason));
        }
        let run_dir = spec.run_dir.clone();
        let spec_json =
            serde_json::to_vec_pretty(spec).map_err(|error| RunError::Io(error.to_string()))?;
        write_private(&run_dir.join("spec.json"), &spec_json).map_err(RunError::Io)?;
        let data = match &self.launch {
            Launch::Process(supervisor) => {
                let mut child = spawn_supervisor(supervisor, &run_dir)
                    .map_err(|error| RunError::Io(format!("The run could not start: {error}")))?;
                let identity = identity_of(child.id());
                // Reap the supervisor when it exits while this process lives.
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
                json!({"supervisorPid": identity.pid, "supervisorStarted": identity.started})
            }
            #[cfg(test)]
            Launch::InProcess => {
                let dir = run_dir.clone();
                std::thread::spawn(move || super::supervisor::run_supervisor(&dir));
                let current = identity::current();
                json!({"supervisorPid": current.pid, "supervisorStarted": current.started})
            }
        };
        Ok(RunHandle {
            version: HANDLE_VERSION,
            executor: self.id().into(),
            task_id: spec.task_id.clone(),
            run_id: spec.run_id.clone(),
            run_dir,
            started_at: now_ms(),
            data,
        })
    }

    async fn poll(&self, handle: &RunHandle) -> Result<RunStatus, RunError> {
        match read_status(&handle.run_dir).and_then(status_from_file) {
            Some(finished @ RunStatus::Finished { .. }) => return Ok(finished),
            status if supervisor_alive(handle) => return Ok(status.unwrap_or(RunStatus::Starting)),
            _ => {}
        }
        // The supervisor may have just written its final status.
        if let Some(finished @ RunStatus::Finished { .. }) =
            read_status(&handle.run_dir).and_then(status_from_file)
        {
            return Ok(finished);
        }
        Ok(RunStatus::Lost {
            reason: "The run stopped without recording an exit code.".into(),
        })
    }

    async fn read_log(&self, handle: &RunHandle, query: LogQuery) -> Result<String, RunError> {
        log::answer(&handle.run_dir.join("stdout.log"), &query).map_err(RunError::Io)
    }

    async fn cancel(&self, handle: &RunHandle) -> Result<(), RunError> {
        std::fs::write(handle.run_dir.join("cancel"), b"")
            .map_err(|error| RunError::Io(format!("The run could not be stopped: {error}")))?;
        if !supervisor_alive(handle) {
            if let Some(pid) = read_status(&handle.run_dir).and_then(|status| status.child_pid) {
                kill_orphaned_run(pid);
            }
        }
        Ok(())
    }
}

/// Writes a file only the user can read (it holds environment values).
pub(crate) fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    let mut file = options
        .open(path)
        .map_err(|error| format!("The run settings could not be saved: {error}"))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("The run settings could not be saved: {error}"))
}
