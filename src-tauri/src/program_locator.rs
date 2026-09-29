//! Finds the command line programs Oleafly starts on the user's behalf (agent
//! CLIs, Node.js, uv, Git) and prepares the paths and search path handed to
//! those child processes.
//!
//! Contract stub: the signatures are final, the bodies arrive with the
//! implementation.
#![allow(dead_code)]

use std::ffi::OsString;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProgramKind {
    /// A native executable.
    Native,
    /// A Windows `.cmd` or `.bat` script.
    Script,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Located {
    /// Plain (never `\\?\`) path as found; symlinks are not resolved.
    pub path: PathBuf,
    pub kind: ProgramKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RejectReason {
    NotFound,
    Directory,
    NotExecutable,
    PowerShellScript,
    GuiProgram,
    Interpreter,
    NetworkPath,
}

impl RejectReason {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::NotFound => "not_found",
            Self::Directory => "is_directory",
            Self::NotExecutable => "not_executable",
            Self::PowerShellScript => "unsupported_script",
            Self::GuiProgram => "gui_program",
            Self::Interpreter => "interpreter",
            Self::NetworkPath => "network_path",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Rejected {
    pub path: PathBuf,
    pub reason: RejectReason,
}

/// The JavaScript entry point behind a recognised Windows package-manager shim.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ShimTarget {
    pub script: PathBuf,
    /// The Node.js executable the shim itself would use, when it names one.
    pub node: Option<PathBuf>,
}

/// An empty directory owned by Oleafly, used as the working directory for
/// probes, checks and installs. Removed when dropped.
pub(crate) struct ProbeDir {
    path: PathBuf,
}

impl ProbeDir {
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for ProbeDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Directories searched for programs, in order. Never waits for the login-shell
/// probe.
pub(crate) fn search_dirs() -> Vec<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .filter(|path| path.is_absolute())
        .collect()
}

/// Starts the one-time login-shell PATH probe on a background thread (unix).
pub(crate) fn start_background_probe() {}

/// Drops cached search results and re-runs the login-shell probe.
pub(crate) fn refresh() {}

/// Finds an agent command line program. Windows `.cmd`/`.bat` files are allowed.
pub(crate) fn locate(_name: &str) -> (Option<Located>, Vec<Rejected>) {
    (None, Vec::new())
}

/// Finds a native executable such as `node`, `uv` or `git`.
pub(crate) fn locate_native(_name: &str) -> Option<Located> {
    None
}

/// Checks a program the user chose.
pub(crate) fn inspect(_path: &Path) -> Result<Located, RejectReason> {
    Err(RejectReason::NotFound)
}

/// The path to hand to a child process: never the `\\?\` verbatim form.
pub(crate) fn child_path(path: &Path) -> PathBuf {
    oleafly_core::plain_path(path)
}

/// `PATH` for an agent-related child process.
pub(crate) fn child_search_path(prepend: &[PathBuf], append: &[PathBuf]) -> OsString {
    let dirs: Vec<PathBuf> = prepend
        .iter()
        .cloned()
        .chain(search_dirs())
        .chain(append.iter().cloned())
        .collect();
    std::env::join_paths(dirs).unwrap_or_default()
}

/// Resolves a recognised Windows package-manager shim to its JavaScript entry.
pub(crate) fn npm_shim_target(_cmd: &Path) -> Option<ShimTarget> {
    None
}

/// Creates an empty working directory for a probe, check or install.
pub(crate) fn probe_dir() -> std::io::Result<ProbeDir> {
    let path = crate::paths::oleafly_root()
        .map_err(std::io::Error::other)?
        .join("acp")
        .join("probe")
        .join(crate::acp::new_id());
    std::fs::create_dir_all(&path)?;
    Ok(ProbeDir { path })
}
