/// The short name of a running process (`/proc/<pid>/comm` on Linux,
/// `proc_name` on macOS), or None when it has exited or cannot be read.
#[cfg(target_os = "linux")]
pub fn process_name(pid: i32) -> Option<String> {
    if pid <= 0 {
        return None;
    }
    let name = std::fs::read_to_string(format!("/proc/{pid}/comm")).ok()?;
    let name = name.trim_end_matches(['\n', '\r']);
    (!name.is_empty()).then(|| name.to_string())
}

/// The short name of a running process (`/proc/<pid>/comm` on Linux,
/// `proc_name` on macOS), or None when it has exited or cannot be read.
#[cfg(target_os = "macos")]
pub fn process_name(pid: i32) -> Option<String> {
    if pid <= 0 {
        return None;
    }
    let mut buffer = [0u8; 256];
    // SAFETY: proc_name writes at most `buffer.len()` bytes into `buffer`
    // and returns how many it wrote.
    let written = unsafe { libc::proc_name(pid, buffer.as_mut_ptr().cast(), buffer.len() as u32) };
    let written = usize::try_from(written).ok().filter(|count| *count > 0)?;
    let name = String::from_utf8_lossy(&buffer[..written.min(buffer.len())]).into_owned();
    (!name.is_empty()).then_some(name)
}

/// Other Unix systems have no cheap way to name a process.
#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
pub fn process_name(_pid: i32) -> Option<String> {
    None
}

#[cfg(windows)]
pub fn process_image_name(pid: u32) -> Option<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    // SAFETY: the handle is checked before use and closed on every path;
    // QueryFullProcessImageNameW writes at most `size` UTF-16 units and
    // updates `size` to the number it wrote.
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return None;
        }
        let mut buffer = vec![0u16; 32 * 1024];
        let mut size = buffer.len() as u32;
        let ok =
            QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, buffer.as_mut_ptr(), &mut size);
        CloseHandle(process);
        if ok == 0 {
            return None;
        }
        let written = (size as usize).min(buffer.len());
        let name = String::from_utf16_lossy(&buffer[..written]);
        (!name.is_empty()).then_some(name)
    }
}

#[cfg(windows)]
impl super::tree::ProcessTreeGuard {
    pub fn process_ids(&self) -> std::io::Result<Vec<u32>> {
        use windows_sys::Win32::System::JobObjects::{
            JobObjectBasicProcessIdList, QueryInformationJobObject,
        };

        if self.job.is_null() {
            return Ok(Vec::new());
        }
        let header_words = (2 * std::mem::size_of::<u32>()).div_ceil(std::mem::size_of::<usize>());
        let mut capacity = 64usize;
        loop {
            let mut buffer = vec![0usize; header_words + capacity];
            // SAFETY: the buffer is writable for its whole length, which is
            // the length passed to the call.
            let ok = unsafe {
                QueryInformationJobObject(
                    self.job,
                    JobObjectBasicProcessIdList,
                    buffer.as_mut_ptr().cast(),
                    (buffer.len() * std::mem::size_of::<usize>()) as u32,
                    std::ptr::null_mut(),
                )
            };
            let header = buffer.as_ptr().cast::<u32>();
            // SAFETY: the buffer holds at least the two u32 header counts.
            let (assigned, listed) =
                unsafe { (header.read() as usize, header.add(1).read() as usize) };
            if ok == 0 {
                if assigned > capacity && capacity < 4096 {
                    capacity = assigned.min(4096);
                    continue;
                }
                return Err(std::io::Error::last_os_error());
            }
            let listed = listed.min(capacity);
            return Ok(buffer[header_words..header_words + listed]
                .iter()
                .map(|id| *id as u32)
                .collect());
        }
    }
}

#[cfg(all(test, unix))]
mod unix_tests {
    use super::*;

    #[test]
    fn names_the_current_process() {
        let name = process_name(std::process::id() as i32);
        if cfg!(any(target_os = "linux", target_os = "macos")) {
            assert!(name.is_some_and(|name| !name.is_empty()));
        }
        assert_eq!(process_name(0), None);
        assert_eq!(process_name(-1), None);
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    #[test]
    fn job_lists_its_processes() {
        let mut command = std::process::Command::new("cmd.exe");
        command
            .args(["/D", "/S", "/C", "ping -n 30 127.0.0.1 >NUL"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        super::super::isolate_std_process_tree(&mut command);
        let mut child = command.spawn().expect("start cmd");
        let guard = super::super::contain_process_tree(child.id()).expect("contain cmd");

        let deadline = Instant::now() + Duration::from_secs(10);
        let mut ids = Vec::new();
        while Instant::now() < deadline {
            ids = guard.process_ids().expect("list the job's processes");
            if ids.contains(&child.id()) && ids.len() >= 2 {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let images: Vec<String> = ids
            .iter()
            .filter_map(|id| process_image_name(*id))
            .collect();
        drop(guard);
        let _ = child.wait();
        assert!(ids.contains(&child.id()), "{ids:?}");
        assert!(ids.len() >= 2, "ping never joined the job: {ids:?}");
        assert!(
            images
                .iter()
                .any(|image| image.to_ascii_lowercase().ends_with("ping.exe")),
            "{images:?}"
        );
    }

    #[test]
    fn an_exited_process_has_no_image_name() {
        assert_eq!(process_image_name(0), None);
    }
}
