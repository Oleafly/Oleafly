//! The launcher process: the app or CLI binary started with
//! `--oleafly-sandbox-launch`. It is the only place that calls
//! `CreateProcessW`, because std cannot pass the AppContainer attribute. The
//! child gets the launcher's working folder, environment and standard
//! handles, runs in a kill-on-close job, and its exit code is relayed.
use std::ffi::OsString;
use std::path::PathBuf;

use crate::SandboxError;

pub const LAUNCH_FLAG: &str = crate::selftest::LAUNCH_FLAG;

/// What the launcher starts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchArgs {
    /// The AppContainer profile name (ensured by the parent).
    pub container: String,
    /// Capability SIDs (SDDL) the child's token carries.
    pub capabilities: Vec<String>,
    pub application: PathBuf,
    pub command_line: OsString,
}

/// The launcher's arguments after the flag.
pub fn encode(args: &LaunchArgs) -> Vec<OsString> {
    let mut argv = vec![
        OsString::from("--container"),
        OsString::from(&args.container),
    ];
    for capability in &args.capabilities {
        argv.push(OsString::from("--capability"));
        argv.push(OsString::from(capability));
    }
    argv.push(OsString::from("--application"));
    argv.push(args.application.clone().into_os_string());
    argv.push(OsString::from("--command-line"));
    argv.push(args.command_line.clone());
    argv
}

/// The inverse of [`encode`].
pub fn decode(argv: &[OsString]) -> Result<LaunchArgs, SandboxError> {
    let mut container = None;
    let mut capabilities = Vec::new();
    let mut application = None;
    let mut command_line = None;
    let mut index = 0;
    while index < argv.len() {
        let flag = argv[index].to_str().unwrap_or_default();
        let value = argv
            .get(index + 1)
            .cloned()
            .ok_or_else(|| SandboxError::Invalid(format!("{flag} needs a value.")))?;
        match flag {
            "--container" => container = Some(value.to_string_lossy().into_owned()),
            "--capability" => capabilities.push(value.to_string_lossy().into_owned()),
            "--application" => application = Some(PathBuf::from(value)),
            "--command-line" => command_line = Some(value),
            other => {
                return Err(SandboxError::Invalid(format!(
                    "Unknown launcher argument {other}."
                )))
            }
        }
        index += 2;
    }
    Ok(LaunchArgs {
        container: container
            .ok_or_else(|| SandboxError::Invalid("The launcher needs --container.".into()))?,
        capabilities,
        application: application
            .ok_or_else(|| SandboxError::Invalid("The launcher needs --application.".into()))?,
        command_line: command_line
            .ok_or_else(|| SandboxError::Invalid("The launcher needs --command-line.".into()))?,
    })
}

#[cfg(windows)]
pub use self::platform::run;

#[cfg(windows)]
mod platform {
    use std::os::windows::ffi::OsStrExt;

    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, LocalFree, SetHandleInformation, GENERIC_READ, HANDLE,
        HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Security::Authorization::ConvertStringSidToSidW;
    use windows_sys::Win32::Security::Isolation::DeriveAppContainerSidFromAppContainerName;
    use windows_sys::Win32::Security::{FreeSid, PSID, SECURITY_CAPABILITIES, SID_AND_ATTRIBUTES};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::Console::{
        GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
    };
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::SystemServices::SE_GROUP_ENABLED;
    use windows_sys::Win32::System::Threading::{
        CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
        InitializeProcThreadAttributeList, ResumeThread, TerminateProcess,
        UpdateProcThreadAttribute, WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED,
        CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, INFINITE,
        LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
        PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, STARTF_USESTDHANDLES, STARTUPINFOEXW,
    };

    use super::LaunchArgs;

    fn wide(text: &std::ffi::OsStr) -> Vec<u16> {
        text.encode_wide().chain(std::iter::once(0)).collect()
    }

    fn hint(code: u32) -> &'static str {
        match code {
            2 => "The program or the task's sandbox profile was not found.",
            5 => "The sandbox cannot open the program. Its folder needs read access.",
            203 => "The sandbox environment is missing SystemRoot or LOCALAPPDATA.",
            1260 => "A Windows policy (AppLocker or WDAC) blocked the program.",
            _ => "See the Windows error code.",
        }
    }

    fn fail(step: &str, code: u32) -> i32 {
        eprintln!(
            "oleafly-sandbox: {step} failed (Windows error {code}): {}",
            hint(code)
        );
        125
    }

    /// Frees what the launch allocated, in reverse order.
    struct Cleanup {
        container: PSID,
        capabilities: Vec<PSID>,
        attributes: Vec<u8>,
        attributes_ready: bool,
        handles: Vec<HANDLE>,
    }

    impl Drop for Cleanup {
        fn drop(&mut self) {
            // SAFETY: each pointer was allocated by the matching Windows call
            // and is freed exactly once here.
            unsafe {
                if self.attributes_ready {
                    DeleteProcThreadAttributeList(
                        self.attributes.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST
                    );
                }
                for sid in &self.capabilities {
                    LocalFree(*sid);
                }
                if !self.container.is_null() {
                    FreeSid(self.container);
                }
                for handle in &self.handles {
                    CloseHandle(*handle);
                }
            }
        }
    }

    /// The environment block: the launcher's own variables, sorted without
    /// regard to case, UTF-16, ending in two NULs.
    fn environment_block() -> Vec<u16> {
        let mut vars: Vec<(std::ffi::OsString, std::ffi::OsString)> = std::env::vars_os().collect();
        vars.sort_by_key(|(name, _)| name.to_string_lossy().to_uppercase());
        let mut block = Vec::new();
        for (name, value) in vars {
            block.extend(name.encode_wide());
            block.push(b'=' as u16);
            block.extend(value.encode_wide());
            block.push(0);
        }
        if block.is_empty() {
            block.push(0);
        }
        block.push(0);
        block
    }

    /// Starts the child in the AppContainer and waits for it.
    pub fn run(args: &LaunchArgs) -> i32 {
        let mut cleanup = Cleanup {
            container: std::ptr::null_mut(),
            capabilities: Vec::new(),
            attributes: Vec::new(),
            attributes_ready: false,
            handles: Vec::new(),
        };
        // SAFETY: every call below follows the documented contract; buffers
        // outlive the calls that read them and are freed by `cleanup`.
        unsafe {
            let name = wide(std::ffi::OsStr::new(&args.container));
            let hr =
                DeriveAppContainerSidFromAppContainerName(name.as_ptr(), &mut cleanup.container);
            if hr < 0 {
                return fail("finding the task's sandbox profile", hr as u32);
            }
            let mut capability_entries = Vec::new();
            for sddl in &args.capabilities {
                let text = wide(std::ffi::OsStr::new(sddl));
                let mut sid: PSID = std::ptr::null_mut();
                if ConvertStringSidToSidW(text.as_ptr(), &mut sid) == 0 {
                    return fail("reading a capability", GetLastError());
                }
                cleanup.capabilities.push(sid);
                capability_entries.push(SID_AND_ATTRIBUTES {
                    Sid: sid,
                    Attributes: SE_GROUP_ENABLED as u32,
                });
            }
            let mut capabilities = SECURITY_CAPABILITIES {
                AppContainerSid: cleanup.container,
                Capabilities: if capability_entries.is_empty() {
                    std::ptr::null_mut()
                } else {
                    capability_entries.as_mut_ptr()
                },
                CapabilityCount: capability_entries.len() as u32,
                Reserved: 0,
            };

            // Standard handles; a missing stdin becomes NUL, opened here
            // because the container may not open it on Windows Server.
            let mut standard = [
                GetStdHandle(STD_INPUT_HANDLE),
                GetStdHandle(STD_OUTPUT_HANDLE),
                GetStdHandle(STD_ERROR_HANDLE),
            ];
            if standard[0].is_null() || standard[0] == INVALID_HANDLE_VALUE {
                let nul = wide(std::ffi::OsStr::new("NUL"));
                let handle = CreateFileW(
                    nul.as_ptr(),
                    GENERIC_READ,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    std::ptr::null(),
                    OPEN_EXISTING,
                    FILE_ATTRIBUTE_NORMAL,
                    std::ptr::null_mut(),
                );
                if handle == INVALID_HANDLE_VALUE {
                    return fail("opening NUL for input", GetLastError());
                }
                cleanup.handles.push(handle);
                standard[0] = handle;
            }
            let mut inherited: Vec<HANDLE> = Vec::new();
            for handle in standard {
                if handle.is_null() || handle == INVALID_HANDLE_VALUE || inherited.contains(&handle)
                {
                    continue;
                }
                if SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) != 0 {
                    inherited.push(handle);
                }
            }

            let mut size = 0usize;
            InitializeProcThreadAttributeList(std::ptr::null_mut(), 2, 0, &mut size);
            cleanup.attributes = vec![0u8; size];
            let list = cleanup.attributes.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;
            if InitializeProcThreadAttributeList(list, 2, 0, &mut size) == 0 {
                return fail("preparing the launch", GetLastError());
            }
            cleanup.attributes_ready = true;
            if UpdateProcThreadAttribute(
                list,
                0,
                PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
                &mut capabilities as *mut SECURITY_CAPABILITIES as *const core::ffi::c_void,
                std::mem::size_of::<SECURITY_CAPABILITIES>(),
                std::ptr::null_mut(),
                std::ptr::null(),
            ) == 0
            {
                return fail("setting the sandbox", GetLastError());
            }
            if !inherited.is_empty()
                && UpdateProcThreadAttribute(
                    list,
                    0,
                    PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                    inherited.as_ptr() as *const core::ffi::c_void,
                    inherited.len() * std::mem::size_of::<HANDLE>(),
                    std::ptr::null_mut(),
                    std::ptr::null(),
                ) == 0
            {
                return fail("passing the standard handles", GetLastError());
            }

            let mut startup: STARTUPINFOEXW = std::mem::zeroed();
            startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
            startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput = standard[0];
            startup.StartupInfo.hStdOutput = standard[1];
            startup.StartupInfo.hStdError = standard[2];
            startup.lpAttributeList = list;

            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return fail("creating the process group", GetLastError());
            }
            cleanup.handles.push(job);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) == 0
            {
                return fail("limiting the process group", GetLastError());
            }

            let application = wide(args.application.as_os_str());
            let mut command_line = wide(&args.command_line);
            let environment = environment_block();
            let mut process: PROCESS_INFORMATION = std::mem::zeroed();
            if CreateProcessW(
                application.as_ptr(),
                command_line.as_mut_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
                EXTENDED_STARTUPINFO_PRESENT
                    | CREATE_UNICODE_ENVIRONMENT
                    | CREATE_SUSPENDED
                    | CREATE_NO_WINDOW,
                environment.as_ptr() as *const core::ffi::c_void,
                std::ptr::null(),
                &startup.StartupInfo,
                &mut process,
            ) == 0
            {
                return fail("starting the program", GetLastError());
            }
            cleanup.handles.push(process.hThread);
            cleanup.handles.push(process.hProcess);
            if AssignProcessToJobObject(job, process.hProcess) == 0 {
                let code = GetLastError();
                TerminateProcess(process.hProcess, 1);
                return fail("joining the process group", code);
            }
            ResumeThread(process.hThread);
            WaitForSingleObject(process.hProcess, INFINITE);
            let mut code = 1u32;
            if GetExitCodeProcess(process.hProcess, &mut code) == 0 {
                return fail("reading the exit code", GetLastError());
            }
            code as i32
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_args_round_trip() {
        let args = LaunchArgs {
            container: "Oleafly.Task.0123456789abcdef0123456789abcdef".into(),
            capabilities: vec!["S-1-15-3-1".into(), "S-1-15-3-1024-1".into()],
            application: PathBuf::from(r"C:\Program Files\Prüfung\python.exe"),
            command_line: OsString::from(
                r#""C:\Program Files\Prüfung\python.exe" -c "print('é')""#,
            ),
        };
        assert_eq!(decode(&encode(&args)).unwrap(), args);
        assert!(decode(&[OsString::from("--container")]).is_err());
    }
}
