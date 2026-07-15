//! Cross-platform helper for spawning child processes without a console window.
//!
//! On Windows, launching a console program (git, lualatex, tlmgr, pandoc, ...)
//! from a GUI app pops a `cmd`-style console window for the child, which flashes
//! on screen and vanishes when the child exits. With commands that run often
//! (git status polling, auto-commit on every compile) this looks like several
//! shells flickering in front of the app the whole time it's open.
//!
//! The fix is the `CREATE_NO_WINDOW` process-creation flag. The Tauri shell
//!
//! `no_console()` is a no-op on macOS and Linux, where a spawned child has no
//! console window to hide; those platforms compile the trivial branch.

use std::process::Command;

/// `CREATE_NO_WINDOW` (winbase.h): the child runs without allocating a console.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

/// exactly where it would set any other builder option.
pub trait NoConsole {
    /// Suppress the child's console window on Windows; no-op elsewhere.
    fn no_console(&mut self) -> &mut Self;
}

impl NoConsole for Command {
    #[cfg(windows)]
    fn no_console(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        self.creation_flags(CREATE_NO_WINDOW)
    }

    #[cfg(not(windows))]
    fn no_console(&mut self) -> &mut Self {
        self
    }
}

impl NoConsole for tokio::process::Command {
    #[cfg(windows)]
    fn no_console(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        self.as_std_mut().creation_flags(CREATE_NO_WINDOW);
        self
    }

    #[cfg(not(windows))]
    fn no_console(&mut self) -> &mut Self {
        self
    }
}

pub fn isolate_process_tree(command: &mut tokio::process::Command) {
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().pre_exec(|| {
            if libc::setpgid(0, 0) == 0 {
                Ok(())
            } else {
                Err(std::io::Error::last_os_error())
            }
        });
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command
            .as_std_mut()
            .creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
}

pub async fn terminate_process_tree(pid: u32) {
    #[cfg(unix)]
    unsafe {
        let _ = libc::kill(-(pid as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    {
        let _ = tokio::process::Command::new("taskkill")
            .no_console()
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .await;
    }
}
