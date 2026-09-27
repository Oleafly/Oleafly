use oleafly_core::MAX_MANIFEST_BYTES;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use std::path::{Path, PathBuf};

const LINK_FILE: &str = "link.json";
#[cfg(any(not(any(target_os = "macos", windows)), test))]
const SHELL_COMMAND_FILE: &str = "shell-command.json";
#[cfg(any(not(any(target_os = "macos", windows)), test))]
const MAX_SHELL_COMMAND_BYTES: u64 = 16 * 1024;
const SIDECAR_FILE: &str = "project.json";
const MAX_LINKS: usize = 4_096;
const MAX_LINK_BYTES: u64 = 64 * 1024;

#[derive(Deserialize)]
struct Link {
    id: String,
    canonical_path: String,
    #[serde(default)]
    removed_at: Option<u64>,
    #[serde(default)]
    displaced: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct Sidecar {
    main_doc: Option<String>,
}

#[cfg(any(not(any(target_os = "macos", windows)), test))]
#[derive(Deserialize)]
struct ShellCommand {
    app: Option<PathBuf>,
}

#[cfg(not(any(target_os = "macos", windows)))]
pub(crate) fn recorded_app() -> Option<PathBuf> {
    recorded_app_in(&data_root()?)
}

#[cfg(any(not(any(target_os = "macos", windows)), test))]
fn recorded_app_in(root: &Path) -> Option<PathBuf> {
    read_json::<ShellCommand>(&root.join(SHELL_COMMAND_FILE), MAX_SHELL_COMMAND_BYTES)?
        .app
        .filter(|app| app.is_absolute())
}

pub(crate) fn saved_main_document(folder: &Path) -> Option<String> {
    let folder = folder.canonicalize().ok()?;
    saved_main_in(&data_root()?.join("linked"), &folder)
}

fn saved_main_in(linked: &Path, folder: &Path) -> Option<String> {
    let mut entries: Vec<std::fs::DirEntry> = std::fs::read_dir(linked)
        .ok()?
        .filter_map(Result::ok)
        .collect();
    entries.sort_by_key(std::fs::DirEntry::file_name);
    entries.into_iter().take(MAX_LINKS).find_map(|entry| {
        let directory = entry.path();
        let link: Link = read_json(&directory.join(LINK_FILE), MAX_LINK_BYTES)?;
        let current = link.removed_at.is_none()
            && link.displaced.is_none()
            && entry.file_name().to_str() == Some(link.id.as_str())
            && Path::new(&link.canonical_path) == folder;
        if !current {
            return None;
        }
        read_json::<Sidecar>(&directory.join(SIDECAR_FILE), MAX_MANIFEST_BYTES)?.main_doc
    })
}

fn read_json<T: DeserializeOwned>(path: &Path, limit: u64) -> Option<T> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > limit {
        return None;
    }
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

pub(crate) fn data_root() -> Option<PathBuf> {
    if let Some(directory) = std::env::var_os("OLEAFLY_DATA_DIR").filter(|value| !value.is_empty())
    {
        return Some(PathBuf::from(directory));
    }
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|home| PathBuf::from(home).join(".oleafly"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn link(linked: &Path, id: &str, folder: &Path, extra: &str, main: Option<&str>) {
        let directory = linked.join(id);
        std::fs::create_dir_all(&directory).unwrap();
        let path = serde_json::to_string(folder.to_str().unwrap()).unwrap();
        std::fs::write(
            directory.join(LINK_FILE),
            format!(r#"{{"version":1,"id":"{id}","canonical_path":{path}{extra}}}"#),
        )
        .unwrap();
        if let Some(main) = main {
            std::fs::write(
                directory.join(SIDECAR_FILE),
                format!(r#"{{"name":"Thesis","main_doc":"{main}","engine":"xetex"}}"#),
            )
            .unwrap();
        }
    }

    #[test]
    fn the_appimage_the_desktop_app_recorded_is_where_the_command_finds_it() {
        let data = TempDir::new().unwrap();
        assert_eq!(recorded_app_in(data.path()), None);
        std::fs::write(
            data.path().join(SHELL_COMMAND_FILE),
            r#"{"version":1,"path":"/home/me/.local/bin/oleafly","method":"copy","app":"/home/me/Apps/Oleafly.AppImage"}"#,
        )
        .unwrap();
        assert_eq!(
            recorded_app_in(data.path()),
            Some(PathBuf::from("/home/me/Apps/Oleafly.AppImage"))
        );
        std::fs::write(
            data.path().join(SHELL_COMMAND_FILE),
            r#"{"version":1,"path":"/home/me/.local/bin/oleafly","method":"link","app":"Oleafly.AppImage"}"#,
        )
        .unwrap();
        assert_eq!(recorded_app_in(data.path()), None);
    }

    #[test]
    fn the_desktop_choice_for_this_folder_is_reused() {
        let data = TempDir::new().unwrap();
        let folders = TempDir::new().unwrap();
        let thesis = folders.path().join("thesis");
        let other = folders.path().join("other");
        std::fs::create_dir_all(&thesis).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        let thesis = thesis.canonicalize().unwrap();
        let other = other.canonicalize().unwrap();
        let linked = data.path().join("linked");
        let a = format!("linked-{}", "a".repeat(32));
        let b = format!("linked-{}", "b".repeat(32));
        let c = format!("linked-{}", "c".repeat(32));
        let d = format!("linked-{}", "d".repeat(32));
        link(&linked, &a, &thesis, r#","removed_at":5"#, Some("old.tex"));
        link(
            &linked,
            &b,
            &thesis,
            r#","displaced":{"by":"x","at_ms":1}"#,
            Some("stale.tex"),
        );
        link(&linked, &c, &other, "", Some("other.tex"));
        assert_eq!(saved_main_in(&linked, &thesis), None);
        link(&linked, &d, &thesis, "", Some("chapters/main.tex"));
        assert_eq!(
            saved_main_in(&linked, &thesis).as_deref(),
            Some("chapters/main.tex")
        );
        assert_eq!(saved_main_in(&linked, &other).as_deref(), Some("other.tex"));
        assert_eq!(saved_main_in(&data.path().join("missing"), &thesis), None);

        let large = folders.path().join("large");
        std::fs::create_dir_all(&large).unwrap();
        let large = large.canonicalize().unwrap();
        let e = format!("linked-{}", "e".repeat(32));
        link(&linked, &e, &large, "", None);
        let packages: serde_json::Map<String, serde_json::Value> = (0..4_000)
            .map(|index| (format!("package-{index:05}"), "2026/01/01 v1.0".into()))
            .collect();
        let sidecar = serde_json::json!({
            "name": "Large",
            "main_doc": "notes/draft.tex",
            "engine": "xetex",
            "tex": {"distribution": "mactex", "packages": packages},
        })
        .to_string();
        assert!(sidecar.len() > 128 * 1024);
        std::fs::write(linked.join(&e).join(SIDECAR_FILE), sidecar).unwrap();
        assert_eq!(
            saved_main_in(&linked, &large).as_deref(),
            Some("notes/draft.tex")
        );
    }
}
