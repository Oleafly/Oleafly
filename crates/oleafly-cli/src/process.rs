use std::io;
use std::path::Path;
use std::time::{Duration, Instant};

#[cfg(windows)]
const NULL_DEVICE: &str = "NUL";
#[cfg(not(windows))]
const NULL_DEVICE: &str = "/dev/null";
const GIT_POLL: Duration = Duration::from_millis(25);

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
#[cfg(windows)]
const CREATE_SUSPENDED: u32 = 0x0000_0004;
#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x0000_0008;

/// Drops the Git variables a calling Git exports (a hook sets `GIT_DIR` and
/// `GIT_INDEX_FILE`, for example), so `git` acts on the folder it runs in
/// and not on the caller's repository.
pub(crate) fn clear_inherited_git_env(command: &mut std::process::Command) {
    for name in oleafly_research::host::GIT_REPOSITORY_ENV {
        command.env_remove(name);
    }
}

/// Runs `git -C <root> <args>` to read a folder's state and returns up to
/// `max_bytes` of its output when it succeeds (`None` when it can't start,
/// fails or outlives `timeout`).
///
/// The folder's own `.git/config` comes with the folder, and `git status`
/// runs the command it names as `core.fsmonitor`, so that and hooks are
/// turned off. It also re-hashes changed files through the repository's
/// `filter.<driver>.clean`/`process` commands, so every driver the
/// repository's own config names is blanked (as the app's
/// `restricted_git_env` does), and submodules are not entered. Optional
/// locks are skipped (the index refresh would make a user's concurrent
/// `git commit` fail), and the variables a calling Git exports
/// (`GIT_DIR`...) are dropped, so Git reads the folder asked about.
pub(crate) fn read_git(
    git: &Path,
    root: &Path,
    args: &[&str],
    timeout: Duration,
    max_bytes: u64,
) -> Option<Vec<u8>> {
    let deadline = Instant::now() + timeout;
    let drivers = repository_filter_drivers(git, root, deadline)?;
    let (status, output) = run_git(
        git,
        root,
        args,
        &blanked_filter_env(&drivers),
        deadline,
        max_bytes,
    )?;
    status.success().then_some(output)
}

/// The filter drivers the repository's own config (with its includes and a
/// linked worktree's config) defines, read by Git itself so includes and
/// `gitdir:` files resolve as Git resolves them. Reading config runs no
/// repository program. `None` when Git can't say (not a repository, a
/// timeout), so the caller runs nothing.
fn repository_filter_drivers(
    git: &Path,
    root: &Path,
    deadline: Instant,
) -> Option<std::collections::BTreeSet<String>> {
    let mut drivers = std::collections::BTreeSet::new();
    for scope in ["--local", "--worktree"] {
        let (status, output) = run_git(
            git,
            root,
            &[
                "config",
                scope,
                "--includes",
                "--name-only",
                "--get-regexp",
                r"^filter\.",
            ],
            &[],
            deadline,
            1024 * 1024,
        )?;
        match status.code() {
            Some(0) => drivers.extend(filter_driver_names(&String::from_utf8_lossy(&output))),
            Some(1) => {}
            _ if scope == "--worktree" => {}
            _ => return None,
        }
    }
    Some(drivers)
}

fn filter_driver_names(listing: &str) -> impl Iterator<Item = String> + '_ {
    listing.lines().filter_map(|line| {
        let rest = line.trim_end_matches('\r').strip_prefix("filter.")?;
        let (driver, _key) = rest.rsplit_once('.')?;
        (!driver.is_empty()).then(|| driver.to_string())
    })
}

fn blanked_filter_env(
    drivers: &std::collections::BTreeSet<String>,
) -> Vec<(String, std::ffi::OsString)> {
    let mut settings: Vec<(String, &str)> = vec![("diff.ignoreSubmodules".into(), "all")];
    for driver in drivers {
        for key in ["clean", "smudge", "process"] {
            settings.push((format!("filter.{driver}.{key}"), ""));
        }
    }
    let mut env = Vec::with_capacity(settings.len() * 2 + 1);
    for (index, (key, value)) in settings.iter().enumerate() {
        env.push((format!("GIT_CONFIG_KEY_{index}"), key.into()));
        env.push((format!("GIT_CONFIG_VALUE_{index}"), (*value).into()));
    }
    env.push(("GIT_CONFIG_COUNT".into(), settings.len().to_string().into()));
    env
}

fn run_git(
    git: &Path,
    root: &Path,
    args: &[&str],
    env: &[(String, std::ffi::OsString)],
    deadline: Instant,
    max_bytes: u64,
) -> Option<(std::process::ExitStatus, Vec<u8>)> {
    use std::io::Read;
    use std::process::Stdio;
    let mut command = std::process::Command::new(git);
    clear_inherited_git_env(&mut command);
    command
        .args(["-c", "core.fsmonitor=false", "-c"])
        .arg(format!("core.hooksPath={NULL_DEVICE}"))
        .arg("-C")
        .arg(root)
        .args(args)
        .envs(env.iter().map(|(key, value)| (key, value)))
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().ok()?;
    let (sender, receiver) = std::sync::mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            let mut output = Vec::new();
            let _ = stdout.take(max_bytes).read_to_end(&mut output);
            let _ = sender.send(output);
        });
    }
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(GIT_POLL),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    let output = receiver
        .recv_timeout(
            deadline
                .saturating_duration_since(Instant::now())
                .max(GIT_POLL),
        )
        .unwrap_or_default();
    Some((status, output))
}

pub(crate) fn detach(command: &mut std::process::Command) {
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                Err(io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
}

pub(crate) fn isolate(command: &mut tokio::process::Command) {
    isolate_std(command.as_std_mut());
}

pub(crate) fn isolate_std(command: &mut std::process::Command) {
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        command.pre_exec(|| {
            if libc::setpgid(0, 0) == 0 {
                Ok(())
            } else {
                Err(io::Error::last_os_error())
            }
        });
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_SUSPENDED);
    }
}

#[cfg(unix)]
pub(crate) struct ProcessTree {
    process_group: i32,
}

#[cfg(unix)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        if self.process_group > 0 {
            unsafe {
                libc::kill(-self.process_group, libc::SIGKILL);
            }
            self.process_group = 0;
        }
    }
}

#[cfg(windows)]
pub(crate) struct ProcessTree {
    job: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
unsafe impl Send for ProcessTree {}

#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        if !self.job.is_null() {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(self.job);
            }
            self.job = std::ptr::null_mut();
        }
    }
}

#[cfg(unix)]
pub(crate) fn contain(pid: u32) -> io::Result<ProcessTree> {
    let process_group = i32::try_from(pid).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "child process id cannot identify a process group",
        )
    })?;
    Ok(ProcessTree { process_group })
}

#[cfg(windows)]
pub(crate) fn contain(pid: u32) -> io::Result<ProcessTree> {
    let tree = ProcessTree {
        job: assign_process_to_new_job(pid)?,
    };
    if let Err(error) = resume_suspended_process(pid) {
        drop(tree);
        return Err(error);
    }
    Ok(tree)
}

#[cfg(windows)]
fn assign_process_to_new_job(pid: u32) -> io::Result<*mut std::ffi::c_void> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err(io::Error::last_os_error());
        }
        if let Err(error) = configure_kill_on_close(job) {
            CloseHandle(job);
            return Err(error);
        }
        let process = OpenProcess(
            PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            pid,
        );
        if process.is_null() {
            let error = io::Error::last_os_error();
            CloseHandle(job);
            return Err(error);
        }
        let assigned = AssignProcessToJobObject(job, process);
        let error = (assigned == 0).then(io::Error::last_os_error);
        CloseHandle(process);
        if let Some(error) = error {
            CloseHandle(job);
            return Err(error);
        }
        Ok(job)
    }
}

#[cfg(windows)]
fn configure_kill_on_close(job: *mut std::ffi::c_void) -> io::Result<()> {
    use windows_sys::Win32::System::JobObjects::{
        JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    unsafe {
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let result = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if result == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
}

#[cfg(windows)]
fn resume_suspended_process(pid: u32) -> io::Result<()> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        let mut entry = THREADENTRY32 {
            dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
            ..Default::default()
        };
        let mut has_entry = Thread32First(snapshot, &mut entry) != 0;
        let mut resumed = 0usize;
        while has_entry {
            if entry.th32OwnerProcessID == pid {
                if let Err(error) = resume_thread(entry.th32ThreadID) {
                    CloseHandle(snapshot);
                    return Err(error);
                }
                resumed += 1;
            }
            has_entry = Thread32Next(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
        if resumed == 0 {
            Err(io::Error::new(
                io::ErrorKind::NotFound,
                "the suspended child process had no resumable thread",
            ))
        } else {
            Ok(())
        }
    }
}

#[cfg(windows)]
fn resume_thread(thread_id: u32) -> io::Result<()> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenThread, ResumeThread, THREAD_QUERY_LIMITED_INFORMATION, THREAD_SUSPEND_RESUME,
    };

    unsafe {
        let thread = OpenThread(
            THREAD_SUSPEND_RESUME | THREAD_QUERY_LIMITED_INFORMATION,
            0,
            thread_id,
        );
        if thread.is_null() {
            return Err(io::Error::last_os_error());
        }
        let previous_suspend_count = ResumeThread(thread);
        let error = (previous_suspend_count == u32::MAX).then(io::Error::last_os_error);
        CloseHandle(thread);
        error.map_or(Ok(()), Err)
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;

    #[test]
    fn filter_driver_names_keep_dotted_driver_names() {
        let names: Vec<String> = super::filter_driver_names(
            "filter.lfs.clean\nfilter.a.b.process\r\nfilter.\nother.x.y\n",
        )
        .collect();
        assert_eq!(names, ["lfs", "a.b"]);
    }

    #[cfg(unix)]
    #[test]
    fn git_status_never_runs_the_repositorys_filter_commands() {
        let Some(git) = oleafly_research::host::default_git_env()
            .map(|env| std::path::PathBuf::from(env.program))
        else {
            return;
        };
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        std::fs::create_dir(&repo).unwrap();
        let marker = temp.path().join("ran");
        let git_in = |args: &[&str]| {
            let mut command = std::process::Command::new(&git);
            super::clear_inherited_git_env(&mut command);
            let status = command
                .arg("-C")
                .arg(&repo)
                .args(args)
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .unwrap();
            assert!(status.success(), "git {args:?} failed");
        };
        git_in(&["init", "-q"]);
        std::fs::write(repo.join("main.tex"), "hello\n").unwrap();
        git_in(&["add", "main.tex"]);
        git_in(&[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@example.com",
            "commit",
            "-qm",
            "init",
        ]);
        let command = format!("sh -c 'touch {}; cat'", marker.display());
        git_in(&["config", "filter.evil.clean", &command]);
        git_in(&["config", "filter.evil.process", &command]);
        std::fs::write(repo.join(".git/info/attributes"), "* filter=evil\n").unwrap();
        // A new mtime makes `git status` re-hash the file through its filter.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        std::fs::write(repo.join("main.tex"), "hello again\n").unwrap();

        let output = super::read_git(
            &git,
            &repo,
            &["status", "--porcelain=v2", "--branch"],
            std::time::Duration::from_secs(20),
            1024 * 1024,
        )
        .expect("git status runs");
        assert!(String::from_utf8_lossy(&output).contains("main.tex"));
        assert!(!marker.exists(), "the repository's filter command ran");
    }

    #[test]
    fn git_runs_without_the_callers_repository_variables() {
        let mut command = std::process::Command::new("git");
        super::clear_inherited_git_env(&mut command);
        let removed: Vec<&OsStr> = command
            .get_envs()
            .filter(|(_, value)| value.is_none())
            .map(|(name, _)| name)
            .collect();
        for name in [
            "GIT_DIR",
            "GIT_WORK_TREE",
            "GIT_INDEX_FILE",
            "GIT_COMMON_DIR",
            "GIT_PREFIX",
        ] {
            assert!(
                removed.contains(&OsStr::new(name)),
                "{name} is still passed on"
            );
        }
    }
}
