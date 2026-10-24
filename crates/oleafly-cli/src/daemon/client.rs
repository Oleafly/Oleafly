//! Talking to the background helper from outside: is it running, which
//! tasks does it have, please stop, start one. `oleafly daemon status|stop`
//! and the app use these.
use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use oleafly_research::model::ResearchTaskStatus;
use oleafly_research::store::TaskStore;
use oleafly_sandbox::process::identity::{probe, ProcessProbe};
use serde::Serialize;

use super::control::write_stop_request;
use super::lock::HelperLock;
use super::paths::helper_paths;
use super::state::{read_state, Phase, ServeMode};
use crate::app_paths::Platform;

/// The flag the app binary starts the helper with.
pub const DAEMON_FLAG: &str = "--oleafly-daemon";
const POLL: Duration = Duration::from_millis(100);
const READY_POLL: Duration = Duration::from_millis(50);

/// Windows: no console, a new process group, out of the app's job.
pub const DETACHED_PROCESS: u32 = 0x0000_0008;
pub const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
pub const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;

/// What an AppImage's runtime sets for its own mount; a relaunch of the
/// image must not inherit them.
pub const APPIMAGE_ENV: &[&str] = &[
    "APPDIR",
    "APPIMAGE",
    "ARGV0",
    "OWD",
    "LD_LIBRARY_PATH",
    "GDK_PIXBUF_MODULE_FILE",
    "GDK_PIXBUF_MODULEDIR",
    "GIO_MODULE_DIR",
    "GIO_EXTRA_MODULES",
    "GSETTINGS_SCHEMA_DIR",
    "GTK_PATH",
    "GTK_EXE_PREFIX",
    "GTK_DATA_PREFIX",
    "GTK_IM_MODULE_FILE",
];

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperTask {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub status: String,
    pub pending_approvals: u32,
    pub reclaim_requested: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub app_version: Option<String>,
    pub phase: Option<Phase>,
    pub mode: Option<ServeMode>,
    pub started_at: Option<i64>,
    pub heartbeat_at: Option<i64>,
    pub log_path: PathBuf,
    pub tasks: Vec<HelperTask>,
}

fn status_label(status: &ResearchTaskStatus) -> String {
    serde_json::to_value(status)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
}

/// The helper's tasks (queued or running for it), read from the task store.
pub fn helper_tasks(data_root: &Path) -> Vec<HelperTask> {
    let root = data_root.join("research-tasks");
    if !root.is_dir() {
        return Vec::new();
    }
    let Ok(store) = TaskStore::new(root) else {
        return Vec::new();
    };
    store
        .daemon_tasks()
        .unwrap_or_default()
        .into_iter()
        .map(|task| HelperTask {
            status: status_label(&task.status),
            id: task.id,
            project_id: task.project_id,
            title: task.title,
            pending_approvals: task.pending_approvals,
            reclaim_requested: task.reclaim_requested,
        })
        .collect()
}

/// Whether a helper runs (it holds the lock), and what it reported.
pub fn status(data_root: &Path) -> io::Result<HelperStatus> {
    let paths = helper_paths(data_root);
    let running = HelperLock::is_held_elsewhere(&paths.lock)?;
    let state = if running {
        read_state(&paths.state)
    } else {
        None
    };
    Ok(HelperStatus {
        running,
        pid: state.as_ref().map(|state| state.pid),
        app_version: state.as_ref().map(|state| state.app_version.clone()),
        phase: state.as_ref().map(|state| state.phase),
        mode: state.as_ref().map(|state| state.mode),
        started_at: state.as_ref().map(|state| state.started_at),
        heartbeat_at: state.as_ref().map(|state| state.heartbeat_at),
        log_path: paths.log,
        tasks: helper_tasks(data_root),
    })
}

/// Asks the helper to hand its tasks back and exit.
pub fn request_stop(data_root: &Path, by: &str) -> io::Result<()> {
    write_stop_request(&helper_paths(data_root).stop_request, by)
}

/// Waits up to `timeout` for the helper to let go of its lock.
pub fn wait_stopped(data_root: &Path, timeout: Duration) -> io::Result<bool> {
    let lock = helper_paths(data_root).lock;
    let deadline = Instant::now() + timeout;
    loop {
        if !HelperLock::is_held_elsewhere(&lock)? {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        std::thread::sleep(POLL);
    }
}

/// The recorded helper process is the one running now (same pid, same
/// start time).
fn recorded_process_is_live(state: &super::state::HelperState) -> bool {
    match probe(state.pid) {
        ProcessProbe::Gone => false,
        ProcessProbe::Running { started } => match (state.started, started) {
            (Some(recorded), Some(observed)) => recorded == observed,
            _ => false,
        },
    }
}

/// A helper holds the lock but its heartbeat did not move across
/// `observe` (it beats every 5 seconds).
pub fn is_hung(data_root: &Path, observe: Duration) -> io::Result<bool> {
    let paths = helper_paths(data_root);
    if !HelperLock::is_held_elsewhere(&paths.lock)? {
        return Ok(false);
    }
    let Some(before) = read_state(&paths.state) else {
        return Ok(false);
    };
    std::thread::sleep(observe);
    let Some(after) = read_state(&paths.state) else {
        return Ok(false);
    };
    Ok(before.pid == after.pid
        && before.heartbeat_at == after.heartbeat_at
        && recorded_process_is_live(&after))
}

#[cfg(unix)]
fn kill(pid: u32) -> bool {
    let Ok(pid) = i32::try_from(pid) else {
        return false;
    };
    pid > 1 && unsafe { libc::kill(pid, libc::SIGKILL) } == 0
}

#[cfg(windows)]
fn kill(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
    unsafe {
        let process = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if process.is_null() {
            return false;
        }
        let ended = TerminateProcess(process, 1) != 0;
        CloseHandle(process);
        ended
    }
}

/// Ends the helper, but only the process `state.json` names (same start
/// time). Its tasks resume after a crash recovery.
pub fn terminate(data_root: &Path) -> io::Result<bool> {
    let paths = helper_paths(data_root);
    let Some(state) = read_state(&paths.state) else {
        return Ok(false);
    };
    if state.pid == std::process::id() || !recorded_process_is_live(&state) {
        return Ok(false);
    }
    let ended = kill(state.pid);
    if ended {
        remove_state_of(&paths.state, state.pid);
    }
    Ok(ended)
}

/// Removes `state.json` when it still names the process that was just
/// ended: a killed helper never gets to, and the file would read as a
/// running helper to anything that only looks for it.
fn remove_state_of(path: &Path, pid: u32) {
    if read_state(path).is_some_and(|state| state.pid == pid) {
        let _ = std::fs::remove_file(path);
    }
}

/// How the app starts the helper.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpawnSpec {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    /// The data folder, so the helper never keeps another folder in use.
    pub cwd: PathBuf,
    pub env_remove: Vec<&'static str>,
    /// Windows creation flags.
    pub windows_flags: u32,
}

/// The helper is the app's own executable with `--oleafly-daemon` (an
/// AppImage relaunches itself, without the old mount's variables).
pub fn spawn_spec(
    platform: Platform,
    exe: &Path,
    appimage: Option<&Path>,
    data_root: &Path,
) -> SpawnSpec {
    let (program, env_remove) = match appimage {
        Some(image) if platform == Platform::Linux => (image.to_path_buf(), APPIMAGE_ENV.to_vec()),
        _ => (exe.to_path_buf(), Vec::new()),
    };
    SpawnSpec {
        program,
        args: vec![OsString::from(DAEMON_FLAG)],
        cwd: data_root.to_path_buf(),
        env_remove,
        windows_flags: if platform == Platform::Windows {
            DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB
        } else {
            0
        },
    }
}

fn command(spec: &SpawnSpec, _windows_flags: u32) -> std::process::Command {
    let mut command = std::process::Command::new(&spec.program);
    command
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    for name in &spec.env_remove {
        command.env_remove(name);
    }
    #[cfg(unix)]
    crate::process::detach(&mut command);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(_windows_flags);
    }
    command
}

/// Starts the helper and returns its pid. On Windows a job that forbids
/// breaking away gets a second try without that flag.
pub fn spawn(spec: &SpawnSpec) -> io::Result<u32> {
    std::fs::create_dir_all(&spec.cwd)?;
    let child = match command(spec, spec.windows_flags).spawn() {
        Ok(child) => child,
        Err(error)
            if cfg!(windows)
                && error.raw_os_error() == Some(5)
                && spec.windows_flags & CREATE_BREAKAWAY_FROM_JOB != 0 =>
        {
            command(spec, spec.windows_flags & !CREATE_BREAKAWAY_FROM_JOB).spawn()?
        }
        Err(error) => return Err(error),
    };
    let pid = child.id();
    // Reaps the helper if it exits while this process still runs.
    let _ = std::thread::Builder::new()
        .name("oleafly-helper-reaper".into())
        .spawn(move || {
            let mut child = child;
            let _ = child.wait();
        });
    Ok(pid)
}

/// Waits until the helper with `pid` says it is ready.
pub fn wait_ready(data_root: &Path, pid: u32, timeout: Duration) -> bool {
    let state = helper_paths(data_root).state;
    let deadline = Instant::now() + timeout;
    loop {
        if read_state(&state).is_some_and(|state| state.pid == pid && state.phase == Phase::Ready) {
            return true;
        }
        if Instant::now() >= deadline || probe(pid) == ProcessProbe::Gone {
            return false;
        }
        std::thread::sleep(READY_POLL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::state::{write_state, HelperState, STATE_VERSION};

    #[test]
    fn windows_spawn_detaches_breaks_away_and_runs_from_the_data_folder() {
        let spec = spawn_spec(
            Platform::Windows,
            Path::new(r"C:\Users\Zoë Müller\AppData\Local\Oleafly\Oleafly.exe"),
            None,
            Path::new(r"C:\Users\Zoë Müller\.oleafly"),
        );
        assert_eq!(spec.windows_flags, 0x0000_0008 | 0x0000_0200 | 0x0100_0000);
        assert_eq!(spec.args, [OsString::from("--oleafly-daemon")]);
        assert_eq!(spec.cwd, Path::new(r"C:\Users\Zoë Müller\.oleafly"));
        assert_eq!(
            spec.program,
            Path::new(r"C:\Users\Zoë Müller\AppData\Local\Oleafly\Oleafly.exe")
        );
    }

    #[test]
    fn an_appimage_relaunches_itself_without_the_old_mount_variables() {
        let spec = spawn_spec(
            Platform::Linux,
            Path::new("/tmp/.mount_Olea/usr/bin/oleafly-desktop"),
            Some(Path::new("/home/me/Oleafly.AppImage")),
            Path::new("/home/me/.oleafly"),
        );
        assert_eq!(spec.program, Path::new("/home/me/Oleafly.AppImage"));
        assert!(
            spec.env_remove.contains(&"LD_LIBRARY_PATH") && spec.env_remove.contains(&"APPIMAGE")
        );
        assert_eq!(spec.windows_flags, 0);
        let mac = spawn_spec(
            Platform::MacOs,
            Path::new("/Applications/Oleafly.app/Contents/MacOS/Oleafly"),
            None,
            Path::new("/Users/me/.oleafly"),
        );
        assert!(mac.env_remove.is_empty());
    }

    #[test]
    fn status_without_a_holder_reports_not_running() {
        let data = tempfile::tempdir().unwrap();
        let status = status(data.path()).unwrap();
        assert!(!status.running && status.pid.is_none() && status.tasks.is_empty());
        assert_eq!(
            status.log_path,
            data.path().join("daemon").join("helper.log")
        );
        assert!(wait_stopped(data.path(), Duration::ZERO).unwrap());
        assert!(!is_hung(data.path(), Duration::ZERO).unwrap());
    }

    #[test]
    fn terminate_refuses_a_pid_whose_start_time_differs() {
        let data = tempfile::tempdir().unwrap();
        let paths = helper_paths(data.path());
        std::fs::create_dir_all(&paths.dir).unwrap();
        let mut sleeper = std::process::Command::new(if cfg!(windows) { "cmd" } else { "sleep" })
            .args(if cfg!(windows) {
                vec!["/c", "ping -n 30 127.0.0.1 >NUL"]
            } else {
                vec!["30"]
            })
            .spawn()
            .unwrap();
        let pid = sleeper.id();
        let started = match probe(pid) {
            ProcessProbe::Running { started } => started,
            ProcessProbe::Gone => None,
        };
        let state = |started: Option<u64>| HelperState {
            version: STATE_VERSION,
            pid,
            started,
            app_version: "0.4.8".into(),
            mode: ServeMode::App,
            phase: Phase::Ready,
            started_at: 0,
            heartbeat_at: 0,
        };
        write_state(&paths.state, &state(started.map(|value| value + 1))).unwrap();
        assert!(!terminate(data.path()).unwrap());
        assert!(sleeper.try_wait().unwrap().is_none());
        write_state(&paths.state, &state(started)).unwrap();
        assert_eq!(terminate(data.path()).unwrap(), started.is_some());
        // The file that named the process it ended goes with it.
        assert_eq!(paths.state.exists(), started.is_none());
        let _ = sleeper.kill();
        let _ = sleeper.wait();
    }

    #[test]
    fn a_state_file_naming_another_process_is_left_alone() {
        let data = tempfile::tempdir().unwrap();
        let paths = helper_paths(data.path());
        std::fs::create_dir_all(&paths.dir).unwrap();
        let state = HelperState {
            version: STATE_VERSION,
            pid: 4242,
            started: None,
            app_version: "0.4.8".into(),
            mode: ServeMode::App,
            phase: Phase::Ready,
            started_at: 0,
            heartbeat_at: 0,
        };
        write_state(&paths.state, &state).unwrap();
        remove_state_of(&paths.state, 4343);
        assert!(paths.state.exists());
        remove_state_of(&paths.state, 4242);
        assert!(!paths.state.exists());
    }

    #[test]
    fn readiness_needs_the_same_pid_in_the_ready_phase() {
        let data = tempfile::tempdir().unwrap();
        let paths = helper_paths(data.path());
        std::fs::create_dir_all(&paths.dir).unwrap();
        let me = std::process::id();
        let mut state = HelperState {
            version: STATE_VERSION,
            pid: me,
            started: None,
            app_version: "0.4.8".into(),
            mode: ServeMode::App,
            phase: Phase::Starting,
            started_at: 0,
            heartbeat_at: 0,
        };
        write_state(&paths.state, &state).unwrap();
        assert!(!wait_ready(data.path(), me, Duration::from_millis(120)));
        state.phase = Phase::Ready;
        write_state(&paths.state, &state).unwrap();
        assert!(wait_ready(data.path(), me, Duration::from_millis(120)));
        assert!(!wait_ready(data.path(), me + 1, Duration::ZERO));
    }
}
