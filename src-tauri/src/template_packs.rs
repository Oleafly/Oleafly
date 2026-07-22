use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::paths;

pub(crate) const DEFAULT_BASE_URL: &str =
    "https://raw.githubusercontent.com/Oleafly/template-packs/main";

pub(crate) fn packs_base_url() -> String {
    match std::env::var("OLEAFLY_PACKS_BASE_URL") {
        Ok(v) if !v.trim().is_empty() => v.trim().trim_end_matches('/').to_string(),
        _ => DEFAULT_BASE_URL.to_string(),
    }
}

#[derive(Deserialize, Serialize, Clone)]
pub struct PackFile {
    /// `<template-id>/<filename>`, validated by `is_safe_rel_file`.
    pub name: String,
    pub url: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct TemplatePack {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub approx_bytes: u64,
    #[serde(default)]
    pub count: u32,
    #[serde(default)]
    pub license_summary: String,
    pub files: Vec<PackFile>,
}

#[derive(Serialize)]
pub struct PackInfo {
    pub id: String,
    pub label: String,
    pub description: String,
    pub category: String,
    pub approx_bytes: u64,
    pub count: u32,
    pub license_summary: String,
    pub installed: bool,
}

pub(crate) fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Pack file names are `<template-dir>/<file>` with no traversal or absolutes.
pub(crate) fn is_safe_rel_file(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('/')
        && !name.contains('\\')
        && !name
            .split('/')
            .any(|seg| seg.is_empty() || seg == "." || seg == "..")
}

fn validate_catalog(packs: &[TemplatePack]) -> Result<(), String> {
    for pack in packs {
        if !is_valid_id(&pack.id) {
            return Err(format!("illegal pack id: {}", pack.id));
        }
        for f in &pack.files {
            if !is_safe_rel_file(&f.name) {
                return Err(format!("illegal pack file name: {}", f.name));
            }
        }
    }
    Ok(())
}

fn cache_path() -> Result<PathBuf, String> {
    Ok(paths::templates_data_root()?.join("catalog-cache.json"))
}

/// Bundled fallback catalog (refreshed at release time).
fn bundled_catalog_path(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(p) = app.path().resolve(
        "resources/template-packs.json",
        tauri::path::BaseDirectory::Resource,
    ) {
        if p.is_file() {
            return Some(p);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("template-packs.json");
    if dev.is_file() {
        Some(dev)
    } else {
        None
    }
}

fn parse_catalog(s: &str) -> Result<Vec<TemplatePack>, String> {
    let packs: Vec<TemplatePack> =
        serde_json::from_str(s).map_err(|e| format!("invalid pack catalog: {e}"))?;
    validate_catalog(&packs)?;
    Ok(packs)
}

pub(crate) fn catalog(app: &AppHandle) -> Result<Vec<TemplatePack>, String> {
    if let Ok(cache) = cache_path() {
        if let Ok(s) = std::fs::read_to_string(&cache) {
            if let Ok(packs) = parse_catalog(&s) {
                return Ok(packs);
            }
        }
    }
    let Some(bundled) = bundled_catalog_path(app) else {
        return Ok(Vec::new());
    };
    let s = std::fs::read_to_string(&bundled).map_err(|e| e.to_string())?;
    parse_catalog(&s)
}

/// `~/.oleafly/templates/packs/<pack-id>` (guarded).
pub(crate) fn pack_install_dir(id: &str) -> Result<PathBuf, String> {
    if !is_valid_id(id) {
        return Err(format!("illegal pack id: {id}"));
    }
    Ok(paths::templates_data_root()?.join("packs").join(id))
}

pub(crate) fn pack_installed_at(dir: &Path, pack: &TemplatePack) -> bool {
    !pack.files.is_empty() && pack.files.iter().all(|f| dir.join(&f.name).is_file())
}

pub(crate) fn pack_installed(pack: &TemplatePack) -> bool {
    match pack_install_dir(&pack.id) {
        Ok(dir) => pack_installed_at(&dir, pack),
        Err(_) => false,
    }
}

#[tauri::command]
pub fn list_template_packs(app: AppHandle) -> Result<Vec<PackInfo>, String> {
    Ok(catalog(&app)?
        .into_iter()
        .map(|p| PackInfo {
            installed: pack_installed(&p),
            id: p.id,
            label: p.label,
            description: p.description,
            category: p.category,
            approx_bytes: p.approx_bytes,
            count: p.count,
            license_summary: p.license_summary,
        })
        .collect())
}

/// Fetch the remote catalog and cache it atomically. Offline failures leave
/// the existing cache/bundled fallback untouched.
#[tauri::command]
pub async fn refresh_pack_catalog() -> Result<(), String> {
    let url = format!("{}/catalog.json", packs_base_url());
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("catalog fetch failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("catalog fetch failed: {e}"))?;
    let body = resp
        .text()
        .await
        .map_err(|e| format!("catalog fetch failed: {e}"))?;
    parse_catalog(&body)?;
    let cache = cache_path()?;
    let tmp = cache.with_extension("json.part");
    std::fs::write(&tmp, &body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &cache).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn catalog_parses_and_ids_are_safe() {
        let json = r#"[{"id":"venue-classes","label":"Venue classes","count":2,
            "files":[{"name":"a/template.json","url":"https://x/y"}]}]"#;
        let packs = super::parse_catalog(json).unwrap();
        assert_eq!(packs[0].id, "venue-classes");
        assert!(super::is_valid_id(&packs[0].id));
        assert!(super::is_safe_rel_file(&packs[0].files[0].name));
    }

    #[test]
    fn catalog_rejects_bad_ids_and_names() {
        let bad_id = r#"[{"id":"../x","label":"","files":[]}]"#;
        assert!(super::parse_catalog(bad_id).is_err());
        let bad_file = r#"[{"id":"ok","label":"","files":[{"name":"../evil","url":""}]}]"#;
        assert!(super::parse_catalog(bad_file).is_err());
    }

    #[test]
    fn rejects_traversal_in_pack_file_names() {
        assert!(!super::is_safe_rel_file("../evil.tex"));
        assert!(!super::is_safe_rel_file("/abs.tex"));
        assert!(!super::is_safe_rel_file("a\\b.tex"));
        assert!(!super::is_safe_rel_file("a//b.tex"));
        assert!(super::is_safe_rel_file("sn-jnl-article/main.tex"));
    }

    #[test]
    fn base_url_env_override_wins() {
        std::env::set_var("OLEAFLY_PACKS_BASE_URL", "http://127.0.0.1:9999/");
        assert_eq!(super::packs_base_url(), "http://127.0.0.1:9999");
        std::env::remove_var("OLEAFLY_PACKS_BASE_URL");
        assert!(super::packs_base_url()
            .starts_with("https://raw.githubusercontent.com/Oleafly/template-packs/"));
    }

    #[test]
    fn pack_installed_requires_every_file() {
        let dir = std::env::temp_dir().join(format!("oleafly-packtest-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("t1")).unwrap();
        std::fs::write(dir.join("t1/template.json"), "{}").unwrap();
        let pack = super::TemplatePack {
            id: "p".into(),
            label: String::new(),
            description: String::new(),
            category: String::new(),
            approx_bytes: 0,
            count: 1,
            license_summary: String::new(),
            files: vec![
                super::PackFile {
                    name: "t1/template.json".into(),
                    url: String::new(),
                },
                super::PackFile {
                    name: "t1/main.tex".into(),
                    url: String::new(),
                },
            ],
        };
        assert!(!super::pack_installed_at(&dir, &pack));
        std::fs::write(dir.join("t1/main.tex"), "x").unwrap();
        assert!(super::pack_installed_at(&dir, &pack));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pack_install_dir_guards_ids() {
        assert!(super::pack_install_dir("../evil").is_err());
        std::env::set_var(
            "OLEAFLY_DATA_DIR",
            std::env::temp_dir().join("oleafly-pid-test"),
        );
        assert!(super::pack_install_dir("venue-classes").is_ok());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}
