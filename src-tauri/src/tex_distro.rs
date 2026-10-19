//! System TeX distribution discovery: the shared rules live in
//! `oleafly_core::tex_distro`; this module feeds them the app's home and
//! data folders (so `cfg(test)` data folders keep working) and keeps the
//! zero-argument calls the rest of the app uses.
//!
//! The results feed compile children (`biber_toolchain`), the latexmk
//! engine's tool lookup (`document_engine`), and the tagged-export engine
//! probe (`latex_engine`).

use std::path::{Path, PathBuf};

use oleafly_core::tex_distro::{self as core, TexSearch};

pub use oleafly_core::tex_distro::{exe, TexDistribution};

/// The app's view of the machine for TeX discovery.
pub fn search() -> TexSearch {
    TexSearch {
        home: crate::paths::home_dir().ok(),
        data_root: crate::paths::oleafly_root().ok(),
        ..TexSearch::from_env()
    }
}

pub(crate) fn find_tool_in_dir(dir: &Path, name: &str) -> Option<PathBuf> {
    core::find_tool_in_dir(dir, name)
}

/// TeX binary directories to probe, best-first (see `oleafly_core`).
pub fn tex_bin_dirs() -> Vec<PathBuf> {
    core::tex_bin_dirs(&search())
}

/// Locate a TeX tool (latexmk, lualatex, tlmgr, ...). Stat-only.
pub fn find_tex_tool(name: &str) -> Option<PathBuf> {
    core::find_tex_tool(&search(), name)
}

pub(crate) fn tex_tool_candidates(name: &str) -> Vec<PathBuf> {
    core::tex_tool_candidates(&search(), name)
}

pub fn distribution_kind_for_tool(tool: &Path) -> String {
    core::distribution_kind_for_tool(&search(), tool)
}

pub fn active_latexmk_distribution() -> Option<TexDistribution> {
    core::active_latexmk_distribution(&search())
}

/// Detected TeX distributions for the Settings panel and the engine-picker
/// modal. Stat-only (no process spawns), but still off the main thread since
/// it walks several directories.
#[tauri::command]
pub async fn tex_distributions() -> Vec<TexDistribution> {
    tauri::async_runtime::spawn_blocking(list_distributions)
        .await
        .unwrap_or_default()
}

pub fn list_distributions() -> Vec<TexDistribution> {
    core::list_distributions(&search())
}

pub(crate) fn texdir_bin_dirs(root: &Path) -> Vec<PathBuf> {
    core::texdir_bin_dirs(root)
}
