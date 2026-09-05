use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::skills::{
    has_first_party_marker, install_tree, is_reparse_point, legacy_default_skills,
    managed_skills_root, read_managed_manifest, regular_file_matches, staging_path, tree_sha256,
    validate_skill_id, ManagedManifest, SkillSource, SkillTier, FIRST_PARTY_MARKER_FILE,
    MANAGED_MANIFEST_SCHEMA_VERSION, STALE_STAGING_PREFIX,
};

pub const PACK_MANIFEST_FILE: &str = "pack.json";
pub const PACK_SCHEMA_VERSION: u8 = 1;
const MAX_PACK_MANIFEST_BYTES: u64 = 4 * 1024 * 1024;

pub type PackOrigin = crate::skills::SkillOrigin;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackManifest {
    pub schema_version: u8,
    pub pack: String,
    pub version: String,
    #[serde(default)]
    pub skills: Vec<PackSkill>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackSkill {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tier: Option<String>,
    #[serde(default)]
    pub phase: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub tree_sha256: String,
    #[serde(default)]
    pub files: Option<u64>,
    #[serde(default)]
    pub bytes: Option<u64>,
    #[serde(default)]
    pub origin: Option<PackOrigin>,
}

impl PackManifest {
    pub fn find(&self, id: &str) -> Option<&PackSkill> {
        self.skills.iter().find(|skill| skill.id == id)
    }
}

static CACHED_PACK_ROOT: OnceLock<PathBuf> = OnceLock::new();

fn remember(path: PathBuf) -> PathBuf {
    let _ = CACHED_PACK_ROOT.set(path.clone());
    path
}

fn dev_pack_root() -> Option<PathBuf> {
    let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("skills");
    candidate.is_dir().then_some(candidate)
}

pub fn pack_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager as _;
    if let Ok(path) = app
        .path()
        .resolve("resources/skills", tauri::path::BaseDirectory::Resource)
    {
        if path.is_dir() {
            return Some(remember(path));
        }
    }
    dev_pack_root().map(remember)
}

pub fn cached_pack_root() -> Option<PathBuf> {
    if let Some(path) = CACHED_PACK_ROOT.get() {
        return Some(path.clone());
    }
    dev_pack_root()
}

pub fn read_pack_manifest(pack_root: &Path) -> Result<Option<PackManifest>, String> {
    let path = pack_root.join(PACK_MANIFEST_FILE);
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not inspect the skill pack: {error}")),
    };
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || is_reparse_point(&metadata)
        || metadata.len() > MAX_PACK_MANIFEST_BYTES
    {
        return Err("The skill pack manifest is not a readable regular file.".into());
    }
    let bytes = std::fs::read(&path)
        .map_err(|error| format!("Could not read the skill pack manifest: {error}"))?;
    let manifest: PackManifest = serde_json::from_slice(&bytes)
        .map_err(|error| format!("The skill pack manifest is invalid: {error}"))?;
    if manifest.schema_version != PACK_SCHEMA_VERSION {
        return Err(format!(
            "The skill pack manifest uses unsupported version {}.",
            manifest.schema_version
        ));
    }
    Ok(Some(manifest))
}

fn pack_skill_dir(pack_root: &Path, id: &str) -> Result<PathBuf, String> {
    validate_skill_id(id)?;
    let resolved_pack = pack_root
        .canonicalize()
        .map_err(|error| format!("Could not resolve the skill pack: {error}"))?;
    let directory = resolved_pack.join(id);
    let metadata = std::fs::symlink_metadata(&directory)
        .map_err(|_| format!("The skill pack does not contain \"{id}\"."))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(format!("The skill pack entry \"{id}\" is not a folder."));
    }
    let resolved = directory
        .canonicalize()
        .map_err(|error| format!("Could not resolve the skill pack entry \"{id}\": {error}"))?;
    if resolved.parent() != Some(resolved_pack.as_path()) {
        return Err(format!("The skill pack entry \"{id}\" escapes the pack."));
    }
    Ok(resolved)
}

fn install_pack_skill(
    skills: &Path,
    pack_root: &Path,
    manifest: &PackManifest,
    entry: &PackSkill,
) -> Result<(), String> {
    let source = pack_skill_dir(pack_root, &entry.id)?;
    let managed = ManagedManifest {
        schema_version: MANAGED_MANIFEST_SCHEMA_VERSION,
        id: entry.id.clone(),
        source: SkillSource::Bundled,
        pack: Some(manifest.pack.clone()),
        pack_version: Some(manifest.version.clone()),
        tree_sha256: String::new(),
        license: entry.license.clone(),
        tier: entry.tier.as_deref().and_then(SkillTier::parse),
        phase: entry.phase.clone(),
        origin: entry.origin.clone(),
    };
    install_tree(skills, &entry.id, &source, &managed, true)
}

fn discard_directory(skills: &Path, directory: &Path, id: &str) {
    let tombstone = staging_path(skills, STALE_STAGING_PREFIX);
    let tombstone = tombstone.with_file_name(format!(
        "{}-{id}",
        tombstone.file_name().unwrap_or_default().to_string_lossy()
    ));
    if std::fs::rename(directory, &tombstone).is_ok() {
        let _ = std::fs::remove_dir_all(&tombstone);
        return;
    }
    let _ = std::fs::remove_dir_all(directory);
}

fn migrate_legacy_defaults(skills: &Path) {
    for (id, manifest_json, skill_md) in legacy_default_skills() {
        let directory = skills.join(id);
        let Ok(metadata) = std::fs::symlink_metadata(&directory) else {
            continue;
        };
        if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            continue;
        }
        if !has_first_party_marker(&directory) || read_managed_manifest(&directory).is_some() {
            continue;
        }
        if regular_file_matches(&directory.join("SKILL.md"), skill_md.as_bytes()) {
            discard_directory(skills, &directory, id);
            continue;
        }
        let _ = std::fs::remove_file(directory.join(FIRST_PARTY_MARKER_FILE));
        if regular_file_matches(&directory.join("manifest.json"), manifest_json.as_bytes()) {
            let _ = std::fs::remove_file(directory.join("manifest.json"));
        }
    }
}

pub(crate) fn seed_from_pack_in(
    skills: &Path,
    pack_root: &Path,
    manifest: &PackManifest,
) -> Result<(), String> {
    migrate_legacy_defaults(skills);
    for entry in &manifest.skills {
        if validate_skill_id(&entry.id).is_err() {
            continue;
        }
        let destination = skills.join(&entry.id);
        let existing = match std::fs::symlink_metadata(&destination) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => continue,
            Ok(metadata) => Some(metadata),
        };
        let Some(metadata) = existing else {
            let _ = install_pack_skill(skills, pack_root, manifest, entry);
            continue;
        };
        if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            continue;
        }
        let Some(recorded) = read_managed_manifest(&destination) else {
            continue;
        };
        if recorded.source != SkillSource::Bundled || !has_first_party_marker(&destination) {
            continue;
        }
        if recorded.pack_version.as_deref() == Some(manifest.version.as_str()) {
            continue;
        }
        let Ok(current) = tree_sha256(&destination) else {
            continue;
        };
        if current != recorded.tree_sha256 {
            continue;
        }
        let _ = install_pack_skill(skills, pack_root, manifest, entry);
    }
    Ok(())
}

#[allow(dead_code)]
pub fn seed_from_pack(root: &Path, pack_root: &Path) -> Result<(), String> {
    let skills = managed_skills_root(root)?;
    let Some(manifest) = read_pack_manifest(pack_root)? else {
        return Ok(());
    };
    seed_from_pack_in(&skills, pack_root, &manifest)
}

pub(crate) fn force_update_from_pack(
    skills: &Path,
    pack_root: &Path,
    id: &str,
) -> Result<(), String> {
    validate_skill_id(id)?;
    let manifest = read_pack_manifest(pack_root)?
        .ok_or_else(|| "The built-in skill pack is not available.".to_string())?;
    let entry = manifest
        .find(id)
        .ok_or_else(|| format!("\"{id}\" is not part of the built-in skill pack."))?;
    install_pack_skill(skills, pack_root, &manifest, entry)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_pack(dir: &Path, body: &str) {
        std::fs::write(dir.join(PACK_MANIFEST_FILE), body).unwrap();
    }

    #[test]
    fn a_missing_pack_manifest_is_not_an_error() {
        let dir = tempfile::tempdir().unwrap();

        assert!(read_pack_manifest(dir.path()).unwrap().is_none());
    }

    #[test]
    fn an_unsupported_pack_schema_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        write_pack(
            dir.path(),
            r#"{ "schemaVersion": 2, "pack": "research-core", "version": "1", "skills": [] }"#,
        );

        assert!(read_pack_manifest(dir.path()).is_err());
    }

    #[test]
    fn unknown_pack_fields_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        write_pack(
            dir.path(),
            r#"{ "schemaVersion": 1, "pack": "research-core", "version": "2026.09.04", "generatedAt": "2026-09-04",
                 "skills": [ { "id": "paper-lookup", "name": "paper-lookup", "description": "Find papers.",
                               "tier": "vendored", "phase": "research", "license": "MIT",
                               "treeSha256": "ab", "files": 3, "bytes": 12, "extra": true,
                               "origin": { "repo": "https://example.invalid/x", "commit": "abc" } } ] }"#,
        );

        let manifest = read_pack_manifest(dir.path()).unwrap().unwrap();

        assert_eq!(manifest.pack, "research-core");
        assert_eq!(manifest.version, "2026.09.04");
        let entry = manifest.find("paper-lookup").unwrap();
        assert_eq!(entry.tier.as_deref(), Some("vendored"));
        assert_eq!(entry.files, Some(3));
        assert_eq!(
            entry
                .origin
                .as_ref()
                .and_then(|origin| origin.commit.clone()),
            Some("abc".to_string())
        );
    }

    #[test]
    fn a_pack_entry_cannot_escape_the_pack_folder() {
        let dir = tempfile::tempdir().unwrap();

        assert!(pack_skill_dir(dir.path(), "../outside").is_err());
        assert!(pack_skill_dir(dir.path(), "missing").is_err());
    }
}
