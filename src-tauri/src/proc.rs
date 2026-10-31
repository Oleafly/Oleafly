//! Cross-platform helper for spawning child processes without a console window.
//!
//! On Windows, launching a console program (git, lualatex, tlmgr, pandoc, ...)
//! from a GUI app pops a `cmd`-style console window for the child, which flashes
//! on screen and vanishes when the child exits. With commands that run often
//! (Git status polling and compiler/toolchain invocations) this looks like several
//! shells flickering in front of the app the whole time it's open.
//!
//! The fix is the `CREATE_NO_WINDOW` process-creation flag. The Tauri shell
//!
//! `no_console()` is a no-op on macOS and Linux, where a spawned child has no
//! console window to hide; those platforms compile the trivial branch.

use std::process::Command;

mod appimage;
mod output;
#[cfg(test)]
pub(crate) use appimage::simulated::SimulatedAppImage;
pub(crate) use appimage::{appimage_env_changes, clear_appimage_env};
pub use output::{output_contained_with_bounds, output_contained_with_timeout, OutputBounds};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
#[cfg(windows)]
const CREATE_SUSPENDED: u32 = 0x0000_0004;

pub trait NoConsole {
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

pub fn spawn_contained(command: &mut Command) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_SUSPENDED);
        let mut child = command.spawn()?;
        let pid = child.id();
        let containment = match contain_process_tree(pid) {
            Ok(containment) => containment,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        std::thread::Builder::new()
            .name("oleafly-child-reaper".into())
            .spawn(move || {
                let _containment = containment;
                let _ = child.wait();
            })?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        spawn_reaped(command).map(|_| ())
    }
}

#[cfg(not(windows))]
fn spawn_reaped(command: &mut Command) -> std::io::Result<u32> {
    let mut child = command.spawn()?;
    let pid = child.id();
    std::thread::Builder::new()
        .name("oleafly-child-reaper".into())
        .spawn(move || {
            let _ = child.wait();
        })?;
    Ok(pid)
}

#[cfg(windows)]
pub use oleafly_sandbox::process::process_image_name;
pub use oleafly_sandbox::process::{contain_process_tree, isolate_process_tree, ProcessTreeGuard};
#[cfg(unix)]
pub use oleafly_sandbox::process::{process_name, signal_process_group};

pub async fn terminate_process_tree(pid: u32) {
    #[cfg(unix)]
    unsafe {
        let _ = libc::kill(-(pid as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    {
        let mut command = tokio::process::Command::new("taskkill");
        command
            .no_console()
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        let _ = tokio::time::timeout(std::time::Duration::from_secs(2), command.status()).await;
    }
}

#[cfg(all(test, unix))]
mod unix_tests {
    use super::*;

    #[test]
    fn a_contained_helper_is_reaped_when_it_exits() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "exit 0"]);
        let pid = spawn_reaped(&mut command).unwrap() as libc::pid_t;
        std::thread::sleep(std::time::Duration::from_millis(500));
        let mut status = 0;
        let found = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
        let error = std::io::Error::last_os_error();
        assert_eq!(found, -1, "the helper was left as a zombie");
        assert_eq!(error.raw_os_error(), Some(libc::ECHILD));
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;

    #[test]
    fn synchronous_commands_run_inside_a_job_object() {
        let mut command = Command::new("cmd.exe");
        command.args([
            "/D",
            "/S",
            "/C",
            "echo contained-out & echo contained-err 1>&2",
        ]);
        let output = output_contained_with_timeout(command, std::time::Duration::from_secs(30))
            .expect("run contained synchronous child");

        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("contained-out"));
        assert!(String::from_utf8_lossy(&output.stderr).contains("contained-err"));
    }
}
