use std::path::{Path, PathBuf};

use oleafly_core::tex_distro::{self as core, TexSearch};

pub use oleafly_core::tex_distro::{exe, TexDistribution};

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

pub fn tex_bin_dirs() -> Vec<PathBuf> {
    core::tex_bin_dirs(&search())
}

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
