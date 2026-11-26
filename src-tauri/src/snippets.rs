use oleafly_core::portable::{fold, is_windows_reserved_component};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_NAME_CHARS: usize = 69;
const STATE_FILE: &str = "_state.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnippetFileEntry {
    pub name: String,
    pub text: Option<String>,
    pub error: Option<String>,
    pub modified_ms: u64,
}

fn snippets_root() -> Result<PathBuf, String> {
    Ok(crate::paths::oleafly_root()?.join("snippets"))
}

fn ensure_root(root: &Path) -> Result<(), String> {
    std::fs::create_dir_all(root)
        .map_err(|error| format!("failed to create the snippets folder {root:?}: {error}"))
}

fn valid_name(name: &str) -> Result<(), String> {
    if name == STATE_FILE {
        return Ok(());
    }
    let Some(stem) = name.strip_suffix(".json") else {
        return Err(format!("{name} is not a .json file name"));
    };
    let mut characters = stem.chars();
    let first_ok = characters.next().is_some_and(|c| c.is_ascii_alphanumeric());
    let rest_ok =
        characters.all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '.' | '_' | '-'));
    if !first_ok
        || !rest_ok
        || name.chars().count() > MAX_NAME_CHARS
        || stem.ends_with('.')
        || stem.ends_with(' ')
    {
        return Err(format!("{name} is not a valid snippet file name"));
    }
    if is_windows_reserved_component(name) {
        return Err(format!("{name} is a name Windows reserves"));
    }
    Ok(())
}

fn modified_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        })
}

fn read_entry(path: &Path, name: String) -> SnippetFileEntry {
    let modified_ms = modified_ms(path);
    let size = std::fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if size > MAX_FILE_BYTES {
        return SnippetFileEntry {
            name,
            text: None,
            error: Some(format!(
                "larger than {} MiB, not loaded",
                MAX_FILE_BYTES / (1024 * 1024)
            )),
            modified_ms,
        };
    }
    match std::fs::read_to_string(path) {
        Ok(text) => SnippetFileEntry {
            name,
            text: Some(text),
            error: None,
            modified_ms,
        },
        Err(error) => SnippetFileEntry {
            name,
            text: None,
            error: Some(error.to_string()),
            modified_ms,
        },
    }
}

pub(crate) fn list_in(root: &Path) -> Result<Vec<SnippetFileEntry>, String> {
    ensure_root(root)?;
    let entries = std::fs::read_dir(root)
        .map_err(|error| format!("failed to read the snippets folder {root:?}: {error}"))?;
    let mut files: Vec<SnippetFileEntry> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            valid_name(&name)
                .ok()
                .map(|()| read_entry(&entry.path(), name))
        })
        .collect();
    files.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(files)
}

pub(crate) fn write_in(root: &Path, name: &str, text: &str) -> Result<(), String> {
    valid_name(name)?;
    if text.len() as u64 > MAX_FILE_BYTES {
        return Err(format!(
            "{name} is larger than {} MiB",
            MAX_FILE_BYTES / (1024 * 1024)
        ));
    }
    ensure_root(root)?;
    let target = root.join(name);
    let wanted = fold(name);
    let clash = std::fs::read_dir(root)
        .map_err(|error| format!("failed to read the snippets folder {root:?}: {error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .any(|existing| existing != name && fold(&existing) == wanted);
    if clash {
        return Err(format!("a snippet file named like {name} already exists"));
    }
    crate::sandbox::atomic_write(&target, text.as_bytes())
}

pub(crate) fn delete_in(root: &Path, name: &str) -> Result<(), String> {
    valid_name(name)?;
    let target = root.join(name);
    match std::fs::remove_file(&target) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to delete {name}: {error}")),
    }
}

#[tauri::command]
pub fn snippets_list() -> Result<Vec<SnippetFileEntry>, String> {
    list_in(&snippets_root()?)
}

#[tauri::command]
pub fn snippets_write(name: String, text: String) -> Result<(), String> {
    write_in(&snippets_root()?, &name, &text)
}

#[tauri::command]
pub fn snippets_delete(name: String) -> Result<(), String> {
    delete_in(&snippets_root()?, &name)
}

#[tauri::command]
pub fn snippets_folder() -> Result<String, String> {
    let root = snippets_root()?;
    ensure_root(&root)?;
    Ok(root.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("snippets");
        (dir, root)
    }

    #[test]
    fn listing_a_missing_folder_creates_it() {
        let (_dir, root) = root();
        assert!(list_in(&root).unwrap().is_empty());
        assert!(root.is_dir());
    }

    #[test]
    fn written_files_are_listed_in_name_order() {
        let (_dir, root) = root();
        write_in(&root, "zeta.json", "{}").unwrap();
        write_in(&root, "My snippets.json", "{\"a\":{}}").unwrap();
        let files = list_in(&root).unwrap();
        let names: Vec<&str> = files.iter().map(|file| file.name.as_str()).collect();
        assert_eq!(names, ["My snippets.json", "zeta.json"]);
        assert_eq!(files[0].text.as_deref(), Some("{\"a\":{}}"));
        assert!(files[0].modified_ms > 0);
    }

    #[test]
    fn writes_replace_existing_files_without_leaving_staging_files() {
        let (_dir, root) = root();
        write_in(&root, "a.json", "one").unwrap();
        write_in(&root, "a.json", "two").unwrap();
        let names: Vec<String> = std::fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["a.json"]);
        assert_eq!(std::fs::read_to_string(root.join("a.json")).unwrap(), "two");
    }

    #[test]
    fn unsafe_names_are_rejected() {
        let (_dir, root) = root();
        for name in [
            "../x.json",
            "a/b.json",
            "a\\b.json",
            "x.txt",
            ".json",
            "-x.json",
            "CON.json",
            "nul.json",
            "com1.json",
            "LPT\u{b9}.json",
            "trailing .json",
        ] {
            assert!(
                write_in(&root, name, "{}").is_err(),
                "{name} should be rejected"
            );
        }
        assert!(delete_in(&root, "../config.json").is_err());
    }

    #[test]
    fn the_state_file_is_the_one_name_allowed_to_start_with_an_underscore() {
        let (_dir, root) = root();
        write_in(&root, STATE_FILE, "{}").unwrap();
        assert!(write_in(&root, "_other.json", "{}").is_err());
        assert!(write_in(&root, "_STATE.json", "{}").is_err());
        let names: Vec<String> = list_in(&root)
            .unwrap()
            .into_iter()
            .map(|file| file.name)
            .collect();
        assert_eq!(names, [STATE_FILE]);
        delete_in(&root, STATE_FILE).unwrap();
        assert!(list_in(&root).unwrap().is_empty());
    }

    #[test]
    fn a_name_differing_only_in_case_is_rejected_for_new_files() {
        let (_dir, root) = root();
        write_in(&root, "Math.json", "{}").unwrap();
        assert!(write_in(&root, "math.json", "{}").is_err());
        write_in(&root, "Math.json", "{\"b\":{}}").unwrap();
    }

    #[test]
    fn oversized_files_are_reported_without_their_text() {
        let (_dir, root) = root();
        ensure_root(&root).unwrap();
        std::fs::write(
            root.join("big.json"),
            vec![b' '; (MAX_FILE_BYTES + 1) as usize],
        )
        .unwrap();
        let files = list_in(&root).unwrap();
        assert_eq!(files.len(), 1);
        assert!(files[0].text.is_none());
        assert!(files[0]
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("MiB"));
        assert!(write_in(
            &root,
            "big2.json",
            &" ".repeat((MAX_FILE_BYTES + 1) as usize)
        )
        .is_err());
    }

    #[test]
    fn foreign_and_invalid_names_in_the_folder_are_ignored() {
        let (_dir, root) = root();
        ensure_root(&root).unwrap();
        std::fs::write(root.join("notes.txt"), "x").unwrap();
        std::fs::create_dir(root.join("folder.json")).unwrap();
        write_in(&root, "ok.json", "{}").unwrap();
        let names: Vec<String> = list_in(&root)
            .unwrap()
            .into_iter()
            .map(|file| file.name)
            .collect();
        assert_eq!(names, ["ok.json"]);
    }

    #[test]
    fn delete_removes_only_that_file_and_ignores_missing_ones() {
        let (_dir, root) = root();
        write_in(&root, "a.json", "{}").unwrap();
        write_in(&root, "b.json", "{}").unwrap();
        delete_in(&root, "a.json").unwrap();
        delete_in(&root, "a.json").unwrap();
        let names: Vec<String> = list_in(&root)
            .unwrap()
            .into_iter()
            .map(|file| file.name)
            .collect();
        assert_eq!(names, ["b.json"]);
    }
}
