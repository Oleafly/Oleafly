use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::app_error::AppError;
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
    #[serde(default)]
    pub sha256: Option<String>,
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
    #[serde(default)]
    pub typst: bool,
    #[serde(default)]
    pub families: Vec<String>,
}

#[derive(Serialize)]
pub struct ComponentInfo {
    pub id: String,
    pub label: String,
    pub description: String,
    pub approx_bytes: u64,
    pub license: Option<AssetLicense>,
    pub installed: bool,
    pub kind: String,
    pub families: Vec<String>,
}

#[derive(Serialize)]
pub struct Prerequisite {
    pub id: String,
    pub label: String,
    pub approx_bytes: u64,
    pub installed: bool,
}

#[derive(Serialize, Clone)]
pub(crate) struct AssetProgress {
    pub(crate) component: String,
    pub(crate) label: String,
    pub(crate) file: String,
    pub(crate) index: usize,
    pub(crate) total: usize,
    pub(crate) received: u64,
    pub(crate) file_total: Option<u64>,
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

fn typst_fonts_cache() -> Result<PathBuf, String> {
    Ok(paths::assets_root()?.join(oleafly_core::typst_toolchain::TYPST_FONT_PACKS_DIR))
}

fn pack_dir(pack: &FontPack) -> Result<PathBuf, String> {
    if !is_valid_id(&pack.id) {
        return Err(format!("illegal font pack id: {}", pack.id));
    }
    let cache = if pack.typst {
        typst_fonts_cache()?
    } else {
        fonts_cache()?
    };
    Ok(cache.join(&pack.id))
}

fn pack_installed(pack: &FontPack) -> bool {
    let dir = match pack_dir(pack) {
        Ok(d) => d,
        Err(_) => return false,
    };
    !pack.files.is_empty() && pack.files.iter().all(|f| holds_bytes(&dir.join(&f.name)))
}

fn holds_bytes(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|meta| meta.is_file() && meta.len() > 0)
}

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

const FONT_PACK_STAGING_DIR: &str = ".font-pack-staging";
const FONT_FALLBACKS: &str = include_str!("../resources/font-pack-fallbacks.json");
const FONT_CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const FONT_STALL_TIMEOUT: Duration = Duration::from_secs(30);
const FONT_SOURCE_ROUNDS: u32 = 2;
const FONT_RETRY_DELAY: Duration = Duration::from_secs(1);

static PACK_DOWNLOADS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

type FontFallbacks = HashMap<String, HashMap<String, String>>;

enum FontFetchFailure {
    Source(String),
    Local(String),
}

fn font_fallbacks() -> &'static FontFallbacks {
    static FALLBACKS: OnceLock<FontFallbacks> = OnceLock::new();
    FALLBACKS.get_or_init(|| serde_json::from_str(FONT_FALLBACKS).unwrap_or_default())
}

fn file_sources<'a>(pack_id: &str, file: &'a AssetFile) -> Vec<&'a str> {
    let mut sources = vec![file.url.as_str()];
    if let Some(fallback) = font_fallbacks()
        .get(pack_id)
        .and_then(|files| files.get(&file.name))
    {
        sources.push(fallback.as_str());
    }
    sources
}

fn font_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .connect_timeout(FONT_CONNECT_TIMEOUT)
        .read_timeout(FONT_STALL_TIMEOUT)
        .user_agent("Oleafly-fonts")
        .build()
}

fn verified_file(path: &Path, expected: Option<&str>) -> bool {
    if !holds_bytes(path) {
        return false;
    }
    let Some(expected) = expected else {
        return true;
    };
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut digest = Sha256::new();
    std::io::copy(&mut file, &mut digest).is_ok()
        && checksum_matches(Some(expected), &digest.finalize())
}

async fn file_is_complete(path: PathBuf, expected: Option<String>) -> bool {
    tokio::task::spawn_blocking(move || verified_file(&path, expected.as_deref()))
        .await
        .unwrap_or(false)
}

async fn pack_is_whole(pack: &FontPack, dir: &Path) -> bool {
    for file in &pack.files {
        if !file_is_complete(dir.join(&file.name), file.sha256.clone()).await {
            return false;
        }
    }
    !pack.files.is_empty()
}

fn prepare_staging(staging: &Path, names: &[String]) -> std::io::Result<()> {
    std::fs::create_dir_all(staging)?;
    for entry in std::fs::read_dir(staging)? {
        let entry = entry?;
        let listed = entry
            .file_name()
            .to_str()
            .is_some_and(|name| names.iter().any(|listed| listed == name));
        if !listed {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    Ok(())
}

async fn reuse_installed_file(installed: PathBuf, staged: PathBuf, file: &AssetFile) -> bool {
    if !file_is_complete(installed.clone(), file.sha256.clone()).await {
        return false;
    }
    tokio::task::spawn_blocking(move || {
        let _ = std::fs::remove_file(&staged);
        std::fs::hard_link(&installed, &staged).is_ok()
            || std::fs::copy(&installed, &staged).is_ok()
    })
    .await
    .unwrap_or(false)
}

async fn fetch_source(
    client: &reqwest::Client,
    url: &str,
    expected: Option<&str>,
    part: &Path,
    progress: &mut impl FnMut(u64, Option<u64>),
) -> Result<(), FontFetchFailure> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt as _;

    let source = |error: reqwest::Error| FontFetchFailure::Source(error.to_string());
    let local = |error: std::io::Error| FontFetchFailure::Local(error.to_string());
    let response = client
        .get(url)
        .send()
        .await
        .map_err(source)?
        .error_for_status()
        .map_err(source)?;
    let file_total = response.content_length();
    let mut out = tokio::fs::File::create(part).await.map_err(local)?;
    let mut stream = response.bytes_stream();
    let mut received: u64 = 0;
    let mut digest = Sha256::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(source)?;
        received += chunk.len() as u64;
        digest.update(&chunk);
        out.write_all(&chunk).await.map_err(local)?;
        progress(received, file_total);
    }
    out.flush().await.map_err(local)?;
    if let Some(total) = file_total.filter(|total| *total != received) {
        return Err(FontFetchFailure::Source(format!(
            "received {received} of {total} bytes"
        )));
    }
    if !checksum_matches(expected, &digest.finalize()) {
        return Err(FontFetchFailure::Source(
            "the file did not match its checksum".to_owned(),
        ));
    }
    Ok(())
}

fn font_save_error(name: &str, detail: impl ToString) -> String {
    AppError::new("font_pack.save_failed")
        .param("file", name)
        .detail(detail)
        .into()
}

async fn fetch_pack_file(
    client: &reqwest::Client,
    name: &str,
    expected: Option<&str>,
    sources: &[&str],
    dest: &Path,
    progress: &mut impl FnMut(u64, Option<u64>),
) -> Result<(), String> {
    let part = dest.with_file_name(format!("{name}.part"));
    let mut last_failure = String::new();
    for round in 0..FONT_SOURCE_ROUNDS {
        if round > 0 {
            tokio::time::sleep(FONT_RETRY_DELAY).await;
        }
        for source in sources {
            match fetch_source(client, source, expected, &part, progress).await {
                Ok(()) => {
                    let (from, to) = (part, dest.to_owned());
                    return tokio::task::spawn_blocking(move || {
                        oleafly_core::atomic::persist_with_retry(|| std::fs::rename(&from, &to))
                    })
                    .await
                    .map_err(|error| font_save_error(name, error))?
                    .map_err(|error| font_save_error(name, error));
                }
                Err(failure) => {
                    let _ = tokio::fs::remove_file(&part).await;
                    match failure {
                        FontFetchFailure::Local(detail) => {
                            return Err(font_save_error(name, detail));
                        }
                        FontFetchFailure::Source(detail) => last_failure = detail,
                    }
                }
            }
        }
    }
    Err(AppError::new("font_pack.download_failed")
        .param("file", name)
        .detail(last_failure)
        .into())
}

fn publish_pack(staging: &Path, dir: &Path) -> std::io::Result<()> {
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent)?;
    }
    oleafly_core::atomic::retry_tree_operation(|| match std::fs::remove_dir_all(dir) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    })?;
    oleafly_core::atomic::rename_tree_with_retry(staging, dir)
}

async fn install_pack_files(
    client: &reqwest::Client,
    pack: &FontPack,
    dir: &Path,
    staging: &Path,
    mut report: impl FnMut(AssetProgress),
) -> Result<(), String> {
    if pack_is_whole(pack, dir).await {
        return Ok(());
    }
    let names: Vec<String> = pack.files.iter().map(|file| file.name.clone()).collect();
    let prepared = staging.to_owned();
    tokio::task::spawn_blocking(move || prepare_staging(&prepared, &names))
        .await
        .map_err(|error| font_save_error(&pack.label, error))?
        .map_err(|error| font_save_error(&pack.label, error))?;
    let total = pack.files.len();
    for (position, file) in pack.files.iter().enumerate() {
        let staged = staging.join(&file.name);
        if file_is_complete(staged.clone(), file.sha256.clone()).await
            || reuse_installed_file(dir.join(&file.name), staged.clone(), file).await
        {
            continue;
        }
        let mut progress = |received, file_total| {
            report(AssetProgress {
                component: pack.id.clone(),
                label: pack.label.clone(),
                file: file.name.clone(),
                index: position + 1,
                total,
                received,
                file_total,
            });
        };
        fetch_pack_file(
            client,
            &file.name,
            file.sha256.as_deref(),
            &file_sources(&pack.id, file),
            &staged,
            &mut progress,
        )
        .await?;
    }
    let (from, to) = (staging.to_owned(), dir.to_owned());
    tokio::task::spawn_blocking(move || publish_pack(&from, &to))
        .await
        .map_err(|error| font_save_error(&pack.label, error))?
        .map_err(|error| font_save_error(&pack.label, error))
}

async fn download_pack(app: &AppHandle, pack: &FontPack) -> Result<(), String> {
    use tauri::Emitter;

    if let Some(file) = pack.files.iter().find(|f| !is_simple_filename(&f.name)) {
        return Err(format!("illegal asset filename: {}", file.name));
    }
    let _one_pack_at_a_time = PACK_DOWNLOADS.lock().await;
    let dir = pack_dir(pack)?;
    let staging = paths::assets_root()?
        .join(FONT_PACK_STAGING_DIR)
        .join(&pack.id);
    let client = font_client().map_err(|error| {
        String::from(
            AppError::new("font_pack.download_failed")
                .param("file", &pack.label)
                .detail(error),
        )
    })?;
    install_pack_files(&client, pack, &dir, &staging, |progress| {
        let _ = app.emit("asset-progress", progress);
    })
    .await
}

pub(crate) use oleafly_downloads::template_packs::checksum_matches;

#[tauri::command]
pub fn list_font_components(app: AppHandle) -> Result<Vec<ComponentInfo>, String> {
    Ok(catalog(&app)?
        .into_iter()
        .map(|p| {
            let installed = pack_installed(&p);
            ComponentInfo {
                kind: if p.typst { "typst-font" } else { "font" }.to_string(),
                id: p.id,
                label: p.label,
                description: p.description,
                approx_bytes: p.approx_bytes,
                license: p.license,
                installed,
                families: p.families,
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
pub fn remove_font_component(app: AppHandle, id: String) -> Result<(), String> {
    let dir = pack_dir(&find_pack(&app, &id)?)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn download_all_fonts(app: AppHandle) -> Result<(), String> {
    for pack in catalog(&app)?.into_iter().filter(|pack| !pack.typst) {
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
                "Font pack '{id}' is not installed. Download it first."
            ));
        }
        let src = pack_dir(&pack)?;
        std::fs::create_dir_all(&fonts_dir).map_err(|e| e.to_string())?;
        for f in &pack.files {
            std::fs::copy(src.join(&f.name), fonts_dir.join(&f.name))
                .map_err(|e| format!("failed to stage font {}: {e}", f.name))?;
        }
    }
    Ok(())
}

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct AddedFontPack {
    pub family: String,
    pub copied: Vec<String>,
    pub fontspec: Option<String>,
}

const FONTSPEC_STYLES: [(&str, &str); 4] = [
    ("UprightFont", "-Regular"),
    ("BoldFont", "-Bold"),
    ("ItalicFont", "-Italic"),
    ("BoldItalicFont", "-BoldItalic"),
];

fn is_font_file(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .is_some_and(|extension| {
            ["ttf", "otf", "ttc"]
                .iter()
                .any(|font| extension.eq_ignore_ascii_case(font))
        })
}

// fontspec inputs `<family without spaces>.fontspec` when it exists, so this file
// lets `\setmainfont{PT Serif}` find the copies in fonts/ with no options.
fn fontspec_shim(family: &str, files: &[&str]) -> Option<String> {
    let mut extension = None;
    let mut styles = Vec::new();
    for (key, suffix) in FONTSPEC_STYLES {
        let (stem, found) = files.iter().find_map(|name| {
            let path = Path::new(name);
            let stem = path.file_stem()?.to_str()?;
            let found = path.extension()?.to_str()?;
            stem.ends_with(suffix).then_some((stem, found))
        })?;
        if extension.is_some_and(|known| known != found) {
            return None;
        }
        extension = Some(found);
        styles.push(format!("  {key}={stem}"));
    }
    Some(format!(
        "% Added by Oleafly so \\setmainfont{{{family}}} finds the font files in fonts/.\n\
         \\defaultfontfeatures[{family}]{{\n  Path=./fonts/,\n  Extension=.{},\n{}\n}}\n",
        extension?,
        styles.join(",\n")
    ))
}

struct PackFiles {
    family: String,
    files: Vec<(String, Vec<u8>)>,
}

// The project files one pack becomes: its fonts under fonts/, its licence renamed
// so packs don't clash, and for LaTeX the .fontspec file at the root.
fn pack_project_files(pack: &FontPack, source: &Path, latex: bool) -> Result<PackFiles, String> {
    let [family] = pack.families.as_slice() else {
        return Err(format!("font pack '{}' does not name one family", pack.id));
    };
    if family
        .chars()
        .any(|c| matches!(c, '{' | '}' | '\\' | '%') || c.is_control())
    {
        return Err(format!("illegal font family name: {family}"));
    }
    let stem: String = family.chars().filter(|c| !c.is_whitespace()).collect();
    let mut files = Vec::new();
    let mut font_files = Vec::new();
    for file in &pack.files {
        if !is_simple_filename(&file.name) {
            return Err(format!("illegal font file name: {}", file.name));
        }
        let name = if is_font_file(&file.name) {
            font_files.push(file.name.as_str());
            file.name.clone()
        } else {
            format!("{stem}-{}", file.name)
        };
        let bytes = std::fs::read(source.join(&file.name))
            .map_err(|e| format!("failed to read {}: {e}", file.name))?;
        files.push((format!("fonts/{name}"), bytes));
    }
    let shim_name = format!("{stem}.fontspec");
    if latex && is_simple_filename(&shim_name) {
        if let Some(text) = fontspec_shim(family, &font_files) {
            files.push((shim_name, text.into_bytes()));
        }
    }
    Ok(PackFiles {
        family: family.clone(),
        files,
    })
}

// On a case-insensitive disk an existing Fonts/ would take the files while the
// .fontspec file names fonts/, which breaks the project on Linux.
fn fonts_folder_case_variant(root: &Path) -> Option<String> {
    std::fs::read_dir(root)
        .ok()?
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .find(|name| name != "fonts" && name.eq_ignore_ascii_case("fonts"))
}

fn is_latex_project(project_id: &str) -> Result<bool, String> {
    use crate::document_engine::DocumentEngineId;
    let meta = crate::project::read_meta(project_id)?;
    Ok(
        crate::document_engine::engine_for(&meta.engine, &meta.main_doc).is_ok_and(|engine| {
            matches!(
                engine.id(),
                DocumentEngineId::Latex | DocumentEngineId::Latexmk
            )
        }),
    )
}

#[tauri::command]
pub async fn add_font_pack_to_project(
    app: AppHandle,
    project_id: String,
    id: String,
) -> Result<AddedFontPack, String> {
    crate::collab::settings::refuse_viewer(&project_id)?;
    let pack = find_pack(&app, &id)?;
    if pack.typst {
        return Err(format!("font pack '{id}' is for Typst"));
    }
    if !pack_installed(&pack) {
        return Err(format!(
            "Font pack '{id}' is not installed. Download it first."
        ));
    }
    let source = pack_dir(&pack)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::project_location::locate(&project_id)?.root;
        if let Some(name) = fonts_folder_case_variant(&root) {
            return Err(format!(
                "This project has a folder named {name}. Rename it to fonts, then try again."
            ));
        }
        let planned = pack_project_files(&pack, &source, is_latex_project(&project_id)?)?;
        let written = crate::project::add_missing_project_files(&project_id, &planned.files)?;
        let (fontspec, copied): (Vec<String>, Vec<String>) = written
            .into_iter()
            .partition(|path| path.ends_with(".fontspec"));
        Ok(AddedFontPack {
            family: planned.family,
            copied,
            fontspec: fontspec.into_iter().next(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
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
    fn typst_packs_name_the_families_they_provide() {
        let packs = repo_catalog();
        assert!(packs.iter().any(|p| p.typst));
        for p in packs.iter().filter(|p| p.typst) {
            assert!(!p.families.is_empty(), "families listed: {}", p.id);
            assert!(p.id.starts_with("typst-"), "typst pack id: {}", p.id);
        }
    }

    #[test]
    fn template_packs_name_one_family_with_all_four_styles() {
        for p in repo_catalog().iter().filter(|p| !p.typst) {
            assert_eq!(p.families.len(), 1, "one family: {}", p.id);
            let files: Vec<&str> = p
                .files
                .iter()
                .map(|f| f.name.as_str())
                .filter(|name| is_font_file(name))
                .collect();
            assert!(
                fontspec_shim(&p.families[0], &files).is_some(),
                "fontspec file for {}",
                p.id
            );
        }
    }

    fn template_pack() -> FontPack {
        let file = |name: &str| AssetFile {
            name: name.into(),
            url: format!("https://example.invalid/{name}"),
            sha256: None,
        };
        FontPack {
            id: "ptserif".into(),
            label: "PT Serif".into(),
            description: String::new(),
            approx_bytes: 0,
            license: None,
            files: vec![
                file("PTSerif-Regular.ttf"),
                file("PTSerif-Bold.ttf"),
                file("PTSerif-Italic.ttf"),
                file("PTSerif-BoldItalic.ttf"),
                file("OFL.txt"),
            ],
            typst: false,
            families: vec!["PT Serif".into()],
        }
    }

    fn installed(pack: &FontPack) -> tempfile::TempDir {
        let source = tempfile::tempdir().unwrap();
        for f in &pack.files {
            std::fs::write(source.path().join(&f.name), f.name.as_bytes()).unwrap();
        }
        source
    }

    fn planned_paths(planned: &PackFiles) -> Vec<&str> {
        planned
            .files
            .iter()
            .map(|(path, _)| path.as_str())
            .collect()
    }

    #[test]
    fn a_pack_becomes_its_fonts_a_renamed_licence_and_a_fontspec_file() {
        let pack = template_pack();
        let source = installed(&pack);
        let planned = pack_project_files(&pack, source.path(), true).unwrap();
        assert_eq!(planned.family, "PT Serif");
        assert_eq!(
            planned_paths(&planned),
            [
                "fonts/PTSerif-Regular.ttf",
                "fonts/PTSerif-Bold.ttf",
                "fonts/PTSerif-Italic.ttf",
                "fonts/PTSerif-BoldItalic.ttf",
                "fonts/PTSerif-OFL.txt",
                "PTSerif.fontspec",
            ]
        );
        assert_eq!(planned.files[4].1, b"OFL.txt");
        let shim = String::from_utf8(planned.files[5].1.clone()).unwrap();
        assert!(shim.contains("\\defaultfontfeatures[PT Serif]{"));
        for line in [
            "Path=./fonts/,",
            "Extension=.ttf,",
            "UprightFont=PTSerif-Regular,",
            "BoldFont=PTSerif-Bold,",
            "ItalicFont=PTSerif-Italic,",
            "BoldItalicFont=PTSerif-BoldItalic\n}",
        ] {
            assert!(shim.contains(line), "{line} in {shim}");
        }
    }

    #[test]
    fn a_typst_project_gets_the_fonts_without_a_fontspec_file() {
        let pack = template_pack();
        let source = installed(&pack);
        let planned = pack_project_files(&pack, source.path(), false).unwrap();
        assert!(planned_paths(&planned)
            .iter()
            .all(|path| path.starts_with("fonts/")));
    }

    #[test]
    fn a_pack_without_all_four_styles_gets_no_fontspec_file() {
        let mut pack = template_pack();
        pack.files.retain(|f| f.name != "PTSerif-BoldItalic.ttf");
        let source = installed(&pack);
        let planned = pack_project_files(&pack, source.path(), true).unwrap();
        assert!(planned_paths(&planned).contains(&"fonts/PTSerif-Regular.ttf"));
        assert!(!planned_paths(&planned).contains(&"PTSerif.fontspec"));
    }

    #[test]
    fn family_names_that_would_break_the_fontspec_file_are_refused() {
        let mut pack = template_pack();
        pack.families = vec!["PT} Serif".into()];
        let source = installed(&pack);
        assert!(pack_project_files(&pack, source.path(), true).is_err());
    }

    #[test]
    fn a_missing_pack_file_fails_before_anything_is_written() {
        let pack = template_pack();
        let source = installed(&pack);
        std::fs::remove_file(source.path().join("PTSerif-Bold.ttf")).unwrap();
        assert!(pack_project_files(&pack, source.path(), true).is_err());
    }

    #[test]
    fn a_fonts_folder_in_another_case_is_reported() {
        let project = tempfile::tempdir().unwrap();
        assert_eq!(fonts_folder_case_variant(project.path()), None);
        std::fs::create_dir(project.path().join("fonts")).unwrap();
        assert_eq!(fonts_folder_case_variant(project.path()), None);
        let other = tempfile::tempdir().unwrap();
        std::fs::create_dir(other.path().join("Fonts")).unwrap();
        assert_eq!(
            fonts_folder_case_variant(other.path()).as_deref(),
            Some("Fonts")
        );
    }

    #[test]
    fn typst_packs_live_where_typst_compiles_look() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let pack = |typst| FontPack {
            id: "typst-text".into(),
            label: "Text".into(),
            description: String::new(),
            approx_bytes: 0,
            license: None,
            files: vec![],
            typst,
            families: vec![],
        };
        let typst_dir = pack_dir(&pack(true)).unwrap();
        assert_eq!(
            typst_dir,
            crate::paths::assets_root()
                .unwrap()
                .join(oleafly_core::typst_toolchain::TYPST_FONT_PACKS_DIR)
                .join("typst-text")
        );
        assert!(pack_dir(&pack(false))
            .unwrap()
            .ends_with("fonts/typst-text"));
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn typst_pack_files_carry_checksums() {
        for p in repo_catalog().iter().filter(|p| p.typst) {
            for f in &p.files {
                let sum = f.sha256.as_deref().unwrap_or_default();
                assert!(
                    sum.len() == 64 && sum.chars().all(|c| c.is_ascii_hexdigit()),
                    "sha256 for {}",
                    f.name
                );
            }
        }
    }

    #[test]
    fn every_pack_file_carries_a_checksum() {
        for p in &repo_catalog() {
            for f in &p.files {
                let sum = f.sha256.as_deref().unwrap_or_default();
                assert!(
                    sum.len() == 64 && sum.chars().all(|c| c.is_ascii_hexdigit()),
                    "sha256 for {}/{}",
                    p.id,
                    f.name
                );
            }
        }
    }

    #[test]
    fn fallbacks_name_real_pack_files_on_a_second_host() {
        let packs = repo_catalog();
        let fallbacks = font_fallbacks();
        assert!(!fallbacks.is_empty());
        for (pack_id, files) in fallbacks {
            let pack = packs.iter().find(|p| &p.id == pack_id).unwrap();
            for (name, url) in files {
                let file = pack.files.iter().find(|f| &f.name == name).unwrap();
                assert!(url.starts_with("https://"), "https fallback: {url}");
                assert!(!url.contains("mirrors.oleafly.com"), "second host: {url}");
                assert_eq!(file_sources(pack_id, file), vec![file.url.as_str(), url]);
            }
        }
        for p in packs.iter().filter(|p| !p.typst) {
            for f in &p.files {
                assert_eq!(file_sources(&p.id, f).len(), 2, "fallback for {}", f.name);
            }
        }
    }

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder().no_proxy().build().unwrap()
    }

    async fn serve(files: HashMap<String, Vec<u8>>) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let mut request = [0_u8; 1024];
                let read = socket.read(&mut request).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&request[..read]);
                let path = request.split_whitespace().nth(1).unwrap_or("/").to_owned();
                let response = match files.get(&path) {
                    Some(body) => {
                        let mut response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        )
                        .into_bytes();
                        response.extend_from_slice(body);
                        response
                    }
                    None => {
                        b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                            .to_vec()
                    }
                };
                let _ = socket.write_all(&response).await;
                let _ = socket.shutdown().await;
            }
        });
        base
    }

    fn sha(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    fn pack_of(id: &str, base: &str, files: &[(&str, &[u8])]) -> FontPack {
        FontPack {
            id: id.into(),
            label: id.into(),
            description: String::new(),
            approx_bytes: 0,
            license: None,
            files: files
                .iter()
                .map(|(name, bytes)| AssetFile {
                    name: (*name).into(),
                    url: format!("{base}/{name}"),
                    sha256: Some(sha(bytes)),
                })
                .collect(),
            typst: true,
            families: vec![],
        }
    }

    fn tree_names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[tokio::test]
    async fn a_finished_pack_appears_in_one_step_and_leaves_nothing_behind() {
        let root = tempfile::tempdir().unwrap();
        let (dir, staging) = (root.path().join("typst-text"), root.path().join("staging"));
        let base = serve(HashMap::from([
            ("/a.otf".to_owned(), b"first font".to_vec()),
            ("/b.otf".to_owned(), b"second font".to_vec()),
        ]))
        .await;
        let pack = pack_of(
            "fixture",
            &base,
            &[("a.otf", b"first font"), ("b.otf", b"second font")],
        );
        let mut seen = Vec::new();
        install_pack_files(&test_client(), &pack, &dir, &staging, |progress| {
            seen.push((progress.index, progress.total, progress.received));
        })
        .await
        .unwrap();
        assert_eq!(tree_names(&dir), ["a.otf", "b.otf"]);
        assert!(!staging.exists());
        assert_eq!(seen.first(), Some(&(1, 2, 10)));
        assert_eq!(seen.last(), Some(&(2, 2, 11)));
    }

    #[tokio::test]
    async fn a_stopped_download_never_touches_the_pack_folder() {
        let root = tempfile::tempdir().unwrap();
        let (dir, staging) = (root.path().join("typst-text"), root.path().join("staging"));
        let base = serve(HashMap::from([(
            "/a.otf".to_owned(),
            b"first font".to_vec(),
        )]))
        .await;
        let pack = pack_of(
            "fixture",
            &base,
            &[("a.otf", b"first font"), ("b.otf", b"second font")],
        );
        let failure = install_pack_files(&test_client(), &pack, &dir, &staging, |_| {})
            .await
            .unwrap_err();
        assert!(failure.contains("font_pack.download_failed"), "{failure}");
        assert!(failure.contains("b.otf"), "{failure}");
        assert!(
            !dir.exists(),
            "a half pack must stay out of the font folder"
        );
        assert_eq!(tree_names(&staging), ["a.otf"]);
    }

    #[tokio::test]
    async fn a_retry_keeps_finished_files_and_clears_stale_parts() {
        let root = tempfile::tempdir().unwrap();
        let (dir, staging) = (root.path().join("typst-text"), root.path().join("staging"));
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(staging.join("a.otf"), b"first font").unwrap();
        std::fs::write(staging.join("b.otf.part"), b"half").unwrap();
        let base = serve(HashMap::from([(
            "/b.otf".to_owned(),
            b"second font".to_vec(),
        )]))
        .await;
        let pack = pack_of(
            "fixture",
            &base,
            &[("a.otf", b"first font"), ("b.otf", b"second font")],
        );
        install_pack_files(&test_client(), &pack, &dir, &staging, |_| {})
            .await
            .unwrap();
        assert_eq!(tree_names(&dir), ["a.otf", "b.otf"]);
    }

    #[tokio::test]
    async fn a_truncated_file_is_fetched_again_instead_of_being_skipped() {
        let root = tempfile::tempdir().unwrap();
        let (dir, staging) = (root.path().join("typst-text"), root.path().join("staging"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.otf"), b"first font").unwrap();
        std::fs::write(dir.join("b.otf"), b"sec").unwrap();
        std::fs::write(dir.join("b.otf.part"), b"leftover").unwrap();
        let base = serve(HashMap::from([(
            "/b.otf".to_owned(),
            b"second font".to_vec(),
        )]))
        .await;
        let pack = pack_of(
            "fixture",
            &base,
            &[("a.otf", b"first font"), ("b.otf", b"second font")],
        );
        install_pack_files(&test_client(), &pack, &dir, &staging, |_| {})
            .await
            .unwrap();
        assert_eq!(tree_names(&dir), ["a.otf", "b.otf"]);
        assert_eq!(std::fs::read(dir.join("b.otf")).unwrap(), b"second font");
        assert_eq!(std::fs::read(dir.join("a.otf")).unwrap(), b"first font");
    }

    #[tokio::test]
    async fn a_whole_pack_makes_no_requests() {
        let root = tempfile::tempdir().unwrap();
        let (dir, staging) = (root.path().join("typst-text"), root.path().join("staging"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.otf"), b"first font").unwrap();
        let pack = pack_of("fixture", "http://127.0.0.1:9", &[("a.otf", b"first font")]);
        install_pack_files(&test_client(), &pack, &dir, &staging, |_| {})
            .await
            .unwrap();
        assert!(!staging.exists());
    }

    #[tokio::test]
    async fn a_refused_or_corrupt_mirror_falls_back_to_the_next_source() {
        let root = tempfile::tempdir().unwrap();
        let dest = root.path().join("a.otf");
        let base = serve(HashMap::from([
            ("/corrupt".to_owned(), b"tampered".to_vec()),
            ("/good".to_owned(), b"first font".to_vec()),
        ]))
        .await;
        let expected = sha(b"first font");
        for mirror in ["missing", "corrupt"] {
            let sources = [format!("{base}/{mirror}"), format!("{base}/good")];
            let sources: Vec<&str> = sources.iter().map(String::as_str).collect();
            fetch_pack_file(
                &test_client(),
                "a.otf",
                Some(&expected),
                &sources,
                &dest,
                &mut |_, _| {},
            )
            .await
            .unwrap();
            assert_eq!(std::fs::read(&dest).unwrap(), b"first font");
            assert!(!root.path().join("a.otf.part").exists());
            std::fs::remove_file(&dest).unwrap();
        }
    }

    #[tokio::test]
    async fn a_silent_server_fails_at_the_stall_limit_and_clears_its_part_file() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let root = tempfile::tempdir().unwrap();
        let dest = root.path().join("a.otf");
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/a.otf", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let mut held = Vec::new();
            while let Ok((mut socket, _)) = listener.accept().await {
                let mut request = [0_u8; 1024];
                let _ = socket.read(&mut request).await;
                let head = "HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial";
                let _ = socket.write_all(head.as_bytes()).await;
                held.push(socket);
            }
        });
        let client = reqwest::Client::builder()
            .no_proxy()
            .read_timeout(Duration::from_millis(200))
            .build()
            .unwrap();
        let failure = fetch_pack_file(
            &client,
            "a.otf",
            None,
            &[url.as_str()],
            &dest,
            &mut |_, _| {},
        )
        .await
        .unwrap_err();
        server.abort();
        assert!(failure.contains("font_pack.download_failed"), "{failure}");
        assert!(tree_names(root.path()).is_empty());
    }

    #[test]
    fn an_empty_file_does_not_count_as_installed() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("a.otf");
        std::fs::write(&path, b"").unwrap();
        assert!(!holds_bytes(&path));
        assert!(!verified_file(&path, None));
        std::fs::write(&path, b"first font").unwrap();
        assert!(verified_file(&path, Some(&sha(b"first font"))));
        assert!(!verified_file(&path, Some(&sha(b"other"))));
    }

    #[test]
    fn checksum_check_accepts_a_match_and_rejects_anything_else() {
        let digest = Sha256::digest(b"font bytes");
        let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        assert!(checksum_matches(Some(&hex), &digest));
        assert!(checksum_matches(Some(&hex.to_uppercase()), &digest));
        assert!(checksum_matches(None, &digest));
        assert!(!checksum_matches(Some(&"0".repeat(64)), &digest));
    }

    #[test]
    fn filename_guard_rejects_traversal() {
        assert!(!is_simple_filename("../evil.ttf"));
        assert!(!is_simple_filename("sub/dir.ttf"));
        assert!(!is_simple_filename(""));
        assert!(is_simple_filename("Lato-Regular.ttf"));
    }
}
