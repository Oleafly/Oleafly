use std::io::{self, PipeReader, PipeWriter};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const EXIT_PATIENCE: Duration = Duration::from_secs(5);
const EXIT_POLL: Duration = Duration::from_millis(100);

pub(super) struct Running(Option<Child>);

impl Running {
    pub(super) fn exited(&mut self) -> bool {
        self.0
            .as_mut()
            .is_none_or(|child| !matches!(child.try_wait(), Ok(None)))
    }

    pub(super) async fn finish(&mut self) {
        let started = Instant::now();
        while !self.exited() && started.elapsed() < EXIT_PATIENCE {
            tokio::time::sleep(EXIT_POLL).await;
        }
        self.stop();
    }

    fn stop(&mut self) {
        if let Some(mut child) = self.0.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        self.stop();
    }
}

pub(super) struct Piped {
    pub(super) running: Running,
    pub(super) from_browser: PipeReader,
    pub(super) to_browser: PipeWriter,
}

fn quiet(command: &mut Command) {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
}

#[cfg(unix)]
fn place_pipe(fds: [std::os::fd::RawFd; 2]) -> io::Result<()> {
    let mut high = [0; 2];
    for (slot, fd) in high.iter_mut().zip(fds) {
        // SAFETY: fcntl only duplicates a descriptor this process owns, and it
        // is async-signal-safe, so it may run between fork and exec.
        let copy = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 10) };
        if copy < 0 {
            return Err(io::Error::last_os_error());
        }
        *slot = copy;
    }
    for (target, fd) in [3, 4].into_iter().zip(high) {
        // SAFETY: dup2 is async-signal-safe and the source descriptor was
        // just duplicated above, so it is open.
        if unsafe { libc::dup2(fd, target) } < 0 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

#[cfg(unix)]
pub(super) fn spawn_with_pipe(mut command: Command) -> io::Result<Piped> {
    use std::os::fd::AsRawFd as _;
    use std::os::unix::process::CommandExt as _;
    let (from_browser, browser_writes) = io::pipe()?;
    let (browser_reads, to_browser) = io::pipe()?;
    let fds = [browser_reads.as_raw_fd(), browser_writes.as_raw_fd()];
    quiet(&mut command);
    // SAFETY: the hook only calls fcntl and dup2, which are
    // async-signal-safe, and allocates nothing.
    unsafe {
        command.pre_exec(move || place_pipe(fds));
    }
    let child = command.spawn()?;
    drop(browser_reads);
    drop(browser_writes);
    Ok(Piped {
        running: Running(Some(child)),
        from_browser,
        to_browser,
    })
}

#[cfg(windows)]
pub(super) fn spawn_with_pipe(mut command: Command) -> io::Result<Piped> {
    use std::os::windows::io::AsRawHandle as _;
    use windows_sys::Win32::Foundation::{SetHandleInformation, HANDLE_FLAG_INHERIT};
    let (from_browser, browser_writes) = io::pipe()?;
    let (browser_reads, to_browser) = io::pipe()?;
    let handles = [
        browser_reads.as_raw_handle(),
        browser_writes.as_raw_handle(),
    ];
    for handle in handles {
        // SAFETY: the handle belongs to a pipe end this function owns and
        // keeps open until the child has been started.
        if unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) } == 0 {
            return Err(io::Error::last_os_error());
        }
    }
    command.arg(format!(
        "--remote-debugging-io-pipes={},{}",
        handles[0] as usize, handles[1] as usize
    ));
    quiet(&mut command);
    let child = command.spawn()?;
    drop(browser_reads);
    drop(browser_writes);
    Ok(Piped {
        running: Running(Some(child)),
        from_browser,
        to_browser,
    })
}

#[cfg(not(any(unix, windows)))]
pub(super) fn spawn_with_pipe(_command: Command) -> io::Result<Piped> {
    Err(io::Error::from(io::ErrorKind::Unsupported))
}

pub(super) fn spawn_with_stderr(
    mut command: Command,
) -> io::Result<(Running, std::process::ChildStderr)> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = command.spawn()?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| io::Error::other("the browser's error output was not captured"))?;
    Ok((Running(Some(child)), stderr))
}
