//! On-demand downloadable assets (font packs).
//!
//! To keep the installer small, richer templates declare the font packs they need
//! in their manifest (`requires.fonts`), and those packs are downloaded on demand
//! into a shared cache under `~/.openleaf/assets/fonts/<packId>/`. When a project
//! is created from such a template, the cached fonts are copied into the project's
//! `fonts/` folder, so the document is self-contained, portable, and compiles
//! offline with the bundled Tectonic (via `\setmainfont{...}[Path=fonts/]`).
//!
//! The catalog is data, not code: `resources/font-packs.json` (bundled) is the
//! single source of truth, read here and by the preview-render script.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::paths;
use crate::templates::TemplateManifest;

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct AssetLicense {
    #[serde(default)]
    pub spdx: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub url: String,
}

#[derive(Deserialize, Clone)]
pub struct AssetFile {
    pub name: String,
    pub url: String,
}

#[derive(Deserialize, Clone)]
pub struct FontPack {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub approx_bytes: u64,
    #[serde(default)]
    pub license: Option<AssetLicense>,
    pub files: Vec<AssetFile>,
}

/// Gallery-facing view of a downloadable component.
#[derive(Serialize)]
pub struct ComponentInfo {
    pub id: String,
    pub label: String,
    pub description: String,
    pub approx_bytes: u64,
    pub license: Option<AssetLicense>,
    pub installed: bool,
    pub kind: String,
}

/// What a template needs before it can be created without a download.
#[derive(Serialize)]
pub struct Prerequisite {
    pub id: String,
    pub label: String,
    pub approx_bytes: u64,
    pub installed: bool,
}

/// Streamed to the webview as each file downloads.
#[derive(Serialize, Clone)]
struct AssetProgress {
    component: String,
    label: String,
    file: String,
    index: usize,
    total: usize,
    received: u64,
    file_total: Option<u64>,
}

fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn is_simple_filename(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
        && Path::new(name)
            .file_name()
            .map(|f| f == name)
            .unwrap_or(false)
}

fn catalog_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(p) = app.path().resolve(
        "resources/font-packs.json",
        tauri::path::BaseDirectory::Resource,
    ) {
        if p.is_file() {
            return Ok(p);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("font-packs.json");
    if dev.is_file() {
        return Ok(dev);
    }
    Err("font-packs.json not found".to_string())
}

pub fn catalog(app: &AppHandle) -> Result<Vec<FontPack>, String> {
    let s = std::fs::read_to_string(catalog_path(app)?)
        .map_err(|e| format!("failed to read font catalog: {e}"))?;
    serde_json::from_str(&s).map_err(|e| format!("invalid font-packs.json: {e}"))
}

fn find_pack(app: &AppHandle, id: &str) -> Result<FontPack, String> {
    catalog(app)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("unknown font pack: {id}"))
}

fn fonts_cache() -> Result<PathBuf, String> {
    Ok(paths::assets_root()?.join("fonts"))
}

fn pack_dir(id: &str) -> Result<PathBuf, String> {
    if !is_valid_id(id) {
        return Err(format!("illegal font pack id: {id}"));
    }
    Ok(fonts_cache()?.join(id))
}

fn pack_installed(pack: &FontPack) -> bool {
    let dir = match pack_dir(&pack.id) {
        Ok(d) => d,
        Err(_) => return false,
    };
    !pack.files.is_empty() && pack.files.iter().all(|f| dir.join(&f.name).is_file())
}

/// Whether every listed font pack is present in the cache. Empty list = ready.
pub fn fonts_ready(app: &AppHandle, font_ids: &[String]) -> bool {
    if font_ids.is_empty() {
        return true;
    }
    let cat = match catalog(app) {
        Ok(c) => c,
        Err(_) => return false,
    };
    font_ids.iter().all(|id| {
        cat.iter()
            .find(|p| &p.id == id)
            .map(pack_installed)
            .unwrap_or(false)
    })
}

async fn download_pack(app: &AppHandle, pack: &FontPack) -> Result<(), String> {
    use futures_util::StreamExt;
    use std::io::Write as _;
    use tauri::Emitter;

    let dir = pack_dir(&pack.id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let total = pack.files.len();
    for (i, f) in pack.files.iter().enumerate() {
        if !is_simple_filename(&f.name) {
            return Err(format!("illegal asset filename: {}", f.name));
        }
        let dest = dir.join(&f.name);
        if dest.is_file() {
            continue;
        }
        let tmp = dir.join(format!("{}.part", f.name));
        let resp = reqwest::get(&f.url)
            .await
            .map_err(|e| format!("download failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("download failed: {e}"))?;
        let file_total = resp.content_length();
        let mut out = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut stream = resp.bytes_stream();
        let mut received: u64 = 0;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("download interrupted: {e}"))?;
            received += chunk.len() as u64;
            out.write_all(&chunk).map_err(|e| e.to_string())?;
            let _ = app.emit(
                "asset-progress",
                AssetProgress {
                    component: pack.id.clone(),
                    label: pack.label.clone(),
                    file: f.name.clone(),
                    index: i + 1,
                    total,
                    received,
                    file_total,
                },
            );
        }
        out.flush().map_err(|e| e.to_string())?;
        drop(out);
        std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_font_components(app: AppHandle) -> Result<Vec<ComponentInfo>, String> {
    Ok(catalog(&app)?
        .into_iter()
        .map(|p| {
            let installed = pack_installed(&p);
            ComponentInfo {
                id: p.id,
                label: p.label,
                description: p.description,
                approx_bytes: p.approx_bytes,
                license: p.license,
                installed,
                kind: "font".to_string(),
            }
        })
        .collect())
}

#[tauri::command]
pub async fn install_font_component(app: AppHandle, id: String) -> Result<(), String> {
    let pack = find_pack(&app, &id)?;
    download_pack(&app, &pack).await
}

#[tauri::command]
pub fn remove_font_component(id: String) -> Result<(), String> {
    let dir = pack_dir(&id)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn download_all_fonts(app: AppHandle) -> Result<(), String> {
    for pack in catalog(&app)? {
        if !pack_installed(&pack) {
            download_pack(&app, &pack).await?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn template_prerequisites(
    app: AppHandle,
    template_id: String,
) -> Result<Vec<Prerequisite>, String> {
    let dir = crate::templates::template_dir(&app, &template_id)?;
    let manifest = crate::templates::read_manifest(&dir)?;
    let cat = catalog(&app)?;
    let mut out = Vec::new();
    for id in &manifest.requires.fonts {
        if let Some(p) = cat.iter().find(|p| &p.id == id) {
            out.push(Prerequisite {
                id: p.id.clone(),
                label: p.label.clone(),
                approx_bytes: p.approx_bytes,
                installed: pack_installed(p),
            });
        }
    }
    Ok(out)
}

/// Download whatever a template needs that isn't already cached. Safe to call
/// unconditionally (a no-op when everything is present).
#[tauri::command]
pub async fn ensure_template_assets(app: AppHandle, template_id: String) -> Result<(), String> {
    let dir = crate::templates::template_dir(&app, &template_id)?;
    let manifest = crate::templates::read_manifest(&dir)?;
    for id in &manifest.requires.fonts {
        let pack = find_pack(&app, id)?;
        if !pack_installed(&pack) {
            download_pack(&app, &pack).await?;
        }
    }
    Ok(())
}

/// Copy a template's required font files from the cache into `<project>/fonts/`.
/// Called during project creation so the document carries its own fonts.
pub fn stage_template_fonts(
    app: &AppHandle,
    manifest: &TemplateManifest,
    project_dir: &Path,
) -> Result<(), String> {
    if manifest.requires.fonts.is_empty() {
        return Ok(());
    }
    let fonts_dir = project_dir.join("fonts");
    for id in &manifest.requires.fonts {
        let pack = find_pack(app, id)?;
        if !pack_installed(&pack) {
            return Err(format!(
                "font pack '{id}' is not installed; download it first"
            ));
        }
        let src = pack_dir(&pack.id)?;
        std::fs::create_dir_all(&fonts_dir).map_err(|e| e.to_string())?;
        for f in &pack.files {
            std::fs::copy(src.join(&f.name), fonts_dir.join(&f.name))
                .map_err(|e| format!("failed to stage font {}: {e}", f.name))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo_catalog() -> Vec<FontPack> {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("font-packs.json");
        serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
    }

    #[test]
    fn catalog_parses_and_ids_are_safe() {
        let packs = repo_catalog();
        assert!(!packs.is_empty());
        for p in &packs {
            assert!(is_valid_id(&p.id), "pack id is a safe slug: {}", p.id);
            assert!(!p.files.is_empty());
            for f in &p.files {
                assert!(is_simple_filename(&f.name), "safe filename: {}", f.name);
                assert!(f.url.starts_with("https://"), "https url: {}", f.url);
            }
        }
    }

    #[test]
    fn filename_guard_rejects_traversal() {
        assert!(!is_simple_filename("../evil.ttf"));
        assert!(!is_simple_filename("sub/dir.ttf"));
        assert!(!is_simple_filename(""));
        assert!(is_simple_filename("Lato-Regular.ttf"));
    }
}
