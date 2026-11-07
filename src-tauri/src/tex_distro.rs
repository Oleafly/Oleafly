use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use oleafly_core::tex_distro::{self as core, TexSearch};
use oleafly_core::TexFlavor;

pub use oleafly_core::tex_distro::{exe, TexBlocker, TexDistribution};

pub fn search() -> TexSearch {
    let env = TexSearch::from_env();
    TexSearch {
        home: crate::paths::home_dir().ok(),
        data_root: crate::paths::oleafly_root().ok(),
        path: search_path(env.path.as_deref()),
        preferred_bin_dir: crate::config::tex_distribution_choice().map(PathBuf::from),
        ..env
    }
    .refusing_foreign_parent(crate::fsperm::owned_by_current_user)
}

pub(crate) fn managed_tex_search(data_root: Option<PathBuf>) -> TexSearch {
    TexSearch {
        data_root,
        ..TexSearch::from_env()
    }
    .refusing_foreign_parent(crate::fsperm::owned_by_current_user)
}

pub(crate) fn search_path(inherited: Option<&OsStr>) -> Option<OsString> {
    merged_path(inherited, crate::program_locator::search_dirs())
}

fn merged_path(inherited: Option<&OsStr>, located: Vec<PathBuf>) -> Option<OsString> {
    let mut dirs: Vec<PathBuf> = inherited
        .map(|path| std::env::split_paths(path).collect())
        .unwrap_or_default();
    for dir in located {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    std::env::join_paths(dirs)
        .ok()
        .or_else(|| inherited.map(OsStr::to_os_string))
}

pub(crate) fn resolve_latexmk() -> Result<PathBuf, TexBlocker> {
    core::resolve_latexmk(&search())
}

pub(crate) fn latexmk_blocker() -> Option<TexBlocker> {
    resolve_latexmk().err()
}

pub(crate) fn compiler_blocker(latexmk: &Path, flavor: TexFlavor, label: &str) -> TexBlocker {
    core::compiler_blocker(&search(), latexmk, flavor, label)
}

pub(crate) fn japanese_compiler_blocker(latexmk: &Path, label: &str) -> TexBlocker {
    core::japanese_compiler_blocker(&search(), latexmk, label)
}

pub(crate) fn tool_blocker(latexmk: &Path, tool: &str) -> TexBlocker {
    core::tool_blocker(&search(), latexmk, tool)
}

pub(crate) fn blocker_error(blocker: TexBlocker) -> crate::app_error::AppError {
    blocker.params.into_iter().fold(
        crate::app_error::AppError::new(blocker.code),
        |error, (name, value)| error.param(&name, value),
    )
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

pub fn active_latexmk_distribution() -> Option<TexDistribution> {
    core::active_latexmk_distribution(&search())
}

pub fn distribution_for_tool(tool: &Path) -> Option<TexDistribution> {
    core::distribution_for_tool(&search(), tool)
}

pub fn distribution_kind_for_tool(tool: &Path) -> String {
    core::distribution_kind_for_tool(&search(), tool)
}

#[tauri::command]
pub async fn tex_distributions() -> Vec<TexDistribution> {
    tauri::async_runtime::spawn_blocking(|| {
        crate::program_locator::refresh();
        crate::program_locator::wait_for_login_probe();
        list_distributions()
    })
    .await
    .unwrap_or_default()
}

fn choose_distribution(
    bin_dir: Option<String>,
    listed: &[TexDistribution],
) -> Result<Option<String>, String> {
    match bin_dir {
        Some(dir) if !listed.iter().any(|row| row.bin_dir == dir) => {
            Err(crate::app_error::AppError::new("tex.distribution_unknown")
                .param("path", dir)
                .into())
        }
        choice => Ok(choice),
    }
}

#[tauri::command]
pub async fn set_tex_distribution(bin_dir: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::config::set_tex_distribution_choice(choose_distribution(
            bin_dir,
            &list_distributions(),
        )?)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn custom_folder_choice(folder: &str) -> Result<String, String> {
    core::custom_tex_bin_dir(Path::new(folder))
        .map(|dir| dir.to_string_lossy().into_owned())
        .ok_or_else(|| {
            crate::app_error::AppError::new("tex.custom_folder_without_latexmk")
                .param("path", folder)
                .into()
        })
}

/// Use a TeX install the automatic search can't see, such as TeX Live in a
/// folder of the user's own. The choice is saved like a listed one, and the
/// TeX search puts it first from then on, so it shows in the list too.
#[tauri::command]
pub async fn set_custom_tex_folder(folder: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bin_dir = custom_folder_choice(&folder)?;
        crate::config::set_tex_distribution_choice(Some(bin_dir.clone()))?;
        Ok(bin_dir)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub fn list_distributions() -> Vec<TexDistribution> {
    core::list_distributions(&search())
}

pub(crate) fn texdir_bin_dirs(root: &Path) -> Vec<PathBuf> {
    core::texdir_bin_dirs(root)
}

pub(crate) fn managed_tex_bin_dirs() -> Vec<PathBuf> {
    managed_tex_search(crate::paths::oleafly_root().ok())
        .managed_tinytex_roots()
        .iter()
        .flat_map(|root| texdir_bin_dirs(root))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_inherited_path_stays_first_and_located_folders_follow() {
        let first = std::env::temp_dir().join("oleafly-first");
        let second = std::env::temp_dir().join("oleafly-second");
        let located = std::env::temp_dir().join("oleafly-located");
        let inherited = std::env::join_paths([&first, &second]).unwrap();

        let merged = merged_path(
            Some(&inherited),
            vec![second.clone(), located.clone(), first.clone()],
        )
        .unwrap();

        assert_eq!(
            std::env::split_paths(&merged).collect::<Vec<_>>(),
            vec![first, second, located]
        );
    }

    #[test]
    fn located_folders_are_enough_without_an_inherited_path() {
        let located = std::env::temp_dir().join("oleafly-located");
        let merged = merged_path(None, vec![located.clone()]).unwrap();
        assert_eq!(
            std::env::split_paths(&merged).collect::<Vec<_>>(),
            vec![located]
        );
    }

    #[test]
    fn only_a_listed_distribution_can_be_chosen() {
        let listed = vec![TexDistribution {
            kind: "texlive".into(),
            label: "TeX Live 2026".into(),
            bin_dir: "/opt/tex/bin".into(),
            latexmk: None,
            tlmgr: None,
            system_package_manager: None,
            complete: true,
            needs_perl: false,
            active: true,
            preferred: false,
        }];
        assert_eq!(choose_distribution(None, &listed), Ok(None));
        assert_eq!(
            choose_distribution(Some("/opt/tex/bin".into()), &listed),
            Ok(Some("/opt/tex/bin".into()))
        );
        let refused = choose_distribution(Some("/tmp/other".into()), &listed).unwrap_err();
        assert_eq!(
            crate::app_error::code(&refused).as_deref(),
            Some("tex.distribution_unknown")
        );
    }

    #[test]
    fn a_custom_folder_without_latexmk_is_refused_with_its_path() {
        let directory = tempfile::tempdir().unwrap();
        let folder = directory.path().to_string_lossy().into_owned();
        let refused = custom_folder_choice(&folder).unwrap_err();
        assert_eq!(
            crate::app_error::code(&refused).as_deref(),
            Some("tex.custom_folder_without_latexmk")
        );
        let envelope: serde_json::Value =
            serde_json::from_str(refused.strip_prefix(crate::app_error::PREFIX).unwrap()).unwrap();
        assert_eq!(envelope["params"]["path"], folder.as_str());

        std::fs::write(directory.path().join(exe("latexmk")), b"tool").unwrap();
        assert_eq!(custom_folder_choice(&folder), Ok(folder));
    }

    #[test]
    fn a_blocker_becomes_a_coded_error_with_its_params() {
        let blocker = TexBlocker {
            code: "tex.latexmk_not_in_distribution",
            params: std::collections::BTreeMap::from([(
                "binDir".to_string(),
                "/usr/bin".to_string(),
            )]),
        };
        let text = String::from(blocker_error(blocker));
        assert_eq!(
            crate::app_error::code(&text).as_deref(),
            Some("tex.latexmk_not_in_distribution")
        );
        assert!(text.contains("/usr/bin"));
    }
}
