//! Keep a child and everything it starts in one killable unit: a process
//! group on Unix, a kill-on-close job object on Windows.

/// `CREATE_NO_WINDOW` (winbase.h): the child runs without allocating a console.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
#[cfg(windows)]
const CREATE_SUSPENDED: u32 = 0x0000_0004;

/// Start the child in its own process group (Unix) or suspended in a new
/// process group (Windows). Pair with [`contain_process_tree`] right after
/// the spawn; on Windows the child only runs once it is in the job.
pub fn isolate_process_tree(command: &mut tokio::process::Command) {
    isolate_std_process_tree(command.as_std_mut());
}

/// [`isolate_process_tree`] for a `std::process::Command`.
pub fn isolate_std_process_tree(command: &mut std::process::Command) {
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        command.pre_exec(move || {
            if libc::setpgid(0, 0) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_SUSPENDED);
    }
}

#[cfg(not(windows))]
pub struct ProcessTreeGuard {
    pub(super) process_group: i32,
}

#[cfg(not(windows))]
impl ProcessTreeGuard {
    pub fn disarm(mut self) {
        self.process_group = 0;
    }
}

#[cfg(not(windows))]
impl Drop for ProcessTreeGuard {
    fn drop(&mut self) {
        if self.process_group > 0 {
            unsafe {
                let _ = libc::kill(-self.process_group, libc::SIGKILL);
            }
            self.process_group = 0;
        }
    }
}

#[cfg(windows)]
pub struct ProcessTreeGuard {
    pub(super) job: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
unsafe impl Send for ProcessTreeGuard {}

#[cfg(windows)]
impl ProcessTreeGuard {
    pub fn disarm(mut self) {
        if !self.job.is_null() {
            unsafe {
                let _ = configure_job_kill_on_close(self.job, false);
                windows_sys::Win32::Foundation::CloseHandle(self.job);
            }
            self.job = std::ptr::null_mut();
        }
    }
}

#[cfg(windows)]
impl Drop for ProcessTreeGuard {
    fn drop(&mut self) {
        if !self.job.is_null() {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(self.job);
            }
            self.job = std::ptr::null_mut();
        }
    }
}

impl ProcessTreeGuard {
    /// The guard for a child that had already exited before it could be
    /// contained. Nothing is left to kill, so it owns no process group or
    /// job, lists no processes, and dropping it does nothing.
    pub fn for_exited_child() -> Self {
        #[cfg(not(windows))]
        {
            ProcessTreeGuard { process_group: 0 }
        }
        #[cfg(windows)]
        {
            ProcessTreeGuard {
                job: std::ptr::null_mut(),
            }
        }
    }
}

#[cfg(not(windows))]
pub fn contain_process_tree(pid: u32) -> std::io::Result<ProcessTreeGuard> {
    let process_group = i32::try_from(pid).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "child process id cannot identify a process group",
        )
    })?;
    Ok(ProcessTreeGuard { process_group })
}

#[cfg(windows)]
pub fn contain_process_tree(pid: u32) -> std::io::Result<ProcessTreeGuard> {
    let guard = ProcessTreeGuard {
        job: assign_process_to_new_job(pid)?,
    };
    if let Err(error) = resume_suspended_process(pid) {
        // Closing a kill-on-close Job Object also terminates the child that is
        // still suspended. Be explicit here so this error path cannot regress
        // into leaking either the HANDLE or the child process.
        drop(guard);
        return Err(error);
    }
    Ok(guard)
}

#[cfg(windows)]
fn assign_process_to_new_job(pid: u32) -> std::io::Result<*mut std::ffi::c_void> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        if let Err(error) = configure_job_kill_on_close(job, true) {
            CloseHandle(job);
            return Err(error);
        }
        let process = OpenProcess(
            PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            pid,
        );
        if process.is_null() {
            let error = std::io::Error::last_os_error();
            CloseHandle(job);
            return Err(error);
        }
        let assigned = AssignProcessToJobObject(job, process);
        let error = if assigned == 0 {
            Some(std::io::Error::last_os_error())
        } else {
            None
        };
        CloseHandle(process);
        if let Some(error) = error {
            CloseHandle(job);
            return Err(error);
        }
        Ok(job)
    }
}

#[cfg(windows)]
fn configure_job_kill_on_close(job: *mut std::ffi::c_void, enabled: bool) -> std::io::Result<()> {
    use windows_sys::Win32::System::JobObjects::{
        JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    unsafe {
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = if enabled {
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        } else {
            0
        };
        let result = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if result == 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
}

#[cfg(windows)]
fn resume_suspended_process(pid: u32) -> std::io::Result<()> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error());
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
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "the suspended child process had no resumable thread",
            ));
        }
        Ok(())
    }
}

#[cfg(windows)]
fn resume_thread(thread_id: u32) -> std::io::Result<()> {
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
            return Err(std::io::Error::last_os_error());
        }
        let previous_suspend_count = ResumeThread(thread);
        let error = (previous_suspend_count == u32::MAX).then(std::io::Error::last_os_error);
        CloseHandle(thread);
        error.map_or(Ok(()), Err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_guard_for_an_exited_child_owns_nothing() {
        let guard = ProcessTreeGuard::for_exited_child();
        #[cfg(unix)]
        assert_eq!(guard.process_group(), 0);
        #[cfg(windows)]
        assert!(guard.process_ids().expect("list the job").is_empty());
        drop(guard);
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;
    use std::process::Stdio;
    use std::time::Duration;

    #[tokio::test]
    async fn suspended_child_runs_only_after_job_assignment() {
        let mut command = tokio::process::Command::new("cmd.exe");
        command
            .args(["/D", "/S", "/C", "exit 0"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        isolate_process_tree(&mut command);
        let mut child = command.spawn().expect("spawn suspended child");
        let pid = child.id().expect("child process id");
        let _guard = contain_process_tree(pid).expect("assign and resume child");
        let status = tokio::time::timeout(Duration::from_secs(10), child.wait())
            .await
            .expect("child timed out")
            .expect("wait for child");
        assert!(status.success());
    }

    #[tokio::test]
    async fn dropping_the_job_terminates_the_running_child() {
        let mut command = tokio::process::Command::new("cmd.exe");
        command
            .args(["/D", "/S", "/C", "ping -n 30 127.0.0.1 >NUL"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        isolate_process_tree(&mut command);
        let mut child = command.spawn().expect("spawn suspended child");
        let pid = child.id().expect("child process id");
        let guard = contain_process_tree(pid).expect("assign and resume child");
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert!(
            child.try_wait().expect("probe running child").is_none(),
            "the child must still be running before the job handle closes"
        );
        drop(guard);
        tokio::time::timeout(Duration::from_secs(10), child.wait())
            .await
            .expect("Job Object did not terminate the child")
            .expect("wait for terminated child");
    }

    #[test]
    fn a_std_command_runs_after_job_assignment() {
        let mut command = std::process::Command::new("cmd.exe");
        command
            .args(["/D", "/S", "/C", "exit 0"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        isolate_std_process_tree(&mut command);
        let mut child = command.spawn().expect("spawn suspended child");
        let _guard = contain_process_tree(child.id()).expect("assign and resume child");
        assert!(child.wait().expect("wait for child").success());
    }
}
