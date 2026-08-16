use std::io;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
#[cfg(windows)]
const CREATE_SUSPENDED: u32 = 0x0000_0004;

pub(crate) fn isolate(command: &mut tokio::process::Command) {
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().pre_exec(|| {
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
        command
            .as_std_mut()
            .creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_SUSPENDED);
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
