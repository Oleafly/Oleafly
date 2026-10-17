use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const LINKS_SCHEMA: u32 = 1;
const MAX_LINKS: usize = 20_000;

static LINKS_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLink {
    pub library: String,
    pub item_key: String,
    #[serde(default)]
    pub date_modified: String,
    #[serde(default)]
    pub version: u64,
    #[serde(default)]
    pub hash: String,
    #[serde(default)]
    pub bib: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct LinksFile {
    schema: u32,
    #[serde(default)]
    links: BTreeMap<String, ProjectLink>,
}

pub fn links_path(root: &Path, project_id: &str) -> PathBuf {
    let digest = Sha256::digest(project_id.as_bytes());
    let name: String = digest
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    root.join("zotero")
        .join("projects")
        .join(format!("{name}.json"))
}

pub fn read_links(path: &Path) -> BTreeMap<String, ProjectLink> {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<LinksFile>(&bytes).ok())
        .filter(|file| file.schema == LINKS_SCHEMA)
        .map(|file| file.links)
        .unwrap_or_default()
}

pub fn update_links(
    path: &Path,
    changes: BTreeMap<String, Option<ProjectLink>>,
) -> Result<BTreeMap<String, ProjectLink>, String> {
    let _guard = LINKS_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    let mut links = read_links(path);
    for (key, link) in changes {
        if key.is_empty() || key.len() > 512 {
            continue;
        }
        match link {
            Some(link) => {
                links.insert(key, link);
            }
            None => {
                links.remove(&key);
            }
        }
    }
    if links.len() > MAX_LINKS {
        return Err("too many Zotero links for one project".to_string());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec(&LinksFile {
        schema: LINKS_SCHEMA,
        links: links.clone(),
    })
    .map_err(|error| error.to_string())?;
    atomicwrites::AtomicFile::new(path, atomicwrites::OverwriteBehavior::AllowOverwrite)
        .write(|file| std::io::Write::write_all(file, &bytes))
        .map_err(|error| error.to_string())?;
    Ok(links)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(item: &str) -> ProjectLink {
        ProjectLink {
            library: "user".into(),
            item_key: item.into(),
            date_modified: "2024-01-01T00:00:00Z".into(),
            version: 3,
            hash: "abc".into(),
            bib: "refs.bib".into(),
        }
    }

    #[test]
    fn stores_links_per_project_outside_the_project() {
        let directory = tempfile::tempdir().unwrap();
        let first = links_path(directory.path(), "project-a");
        let second = links_path(directory.path(), "../../etc/passwd");
        assert_ne!(first, second);
        assert!(second.starts_with(directory.path().join("zotero/projects")));
        assert!(read_links(&first).is_empty());
        let saved = update_links(
            &first,
            BTreeMap::from([
                ("smith2020".to_string(), Some(link("SMITH234"))),
                (String::new(), Some(link("X"))),
            ]),
        )
        .unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(read_links(&first)["smith2020"].item_key, "SMITH234");
        update_links(&first, BTreeMap::from([("smith2020".to_string(), None)])).unwrap();
        assert!(read_links(&first).is_empty());
        std::fs::write(&first, b"not json").unwrap();
        assert!(read_links(&first).is_empty());
    }
}
