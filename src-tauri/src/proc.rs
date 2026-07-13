//! Cross-platform helper for spawning child processes without a console window.
//!
//! On Windows, launching a console program (git, lualatex, tlmgr, pandoc, ...)
//! from a GUI app pops a `cmd`-style console window for the child, which flashes
//! on screen and vanishes when the child exits. With commands that run often
//! (git status polling, auto-commit on every compile) this looks like several
//! shells flickering in front of the app the whole time it's open.
//!
//! The fix is the `CREATE_NO_WINDOW` process-creation flag. The Tauri shell
//! plugin already sets it for bundled sidecars (e.g. Tectonic), but raw
//! `std::process::Command` spawns do not get it, so we apply it ourselves.
//!
//! `no_console()` is a no-op on macOS and Linux, where a spawned child has no
//! console window to hide; those platforms compile the trivial branch.

use std::process::Command;

/// `CREATE_NO_WINDOW` (winbase.h): the child runs without allocating a console.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Extension trait so every raw-`Command` spawn site can chain `.no_console()`
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
