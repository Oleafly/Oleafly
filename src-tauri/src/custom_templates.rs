use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

use tauri::AppHandle;

use crate::app_error::AppError;
use crate::document_engine::LatexmkFlavor;
use crate::templates::{TemplateLicense, TemplateManifest, TemplateRequires, CUSTOM_CATEGORY};

const FILES_DIR: &str = "files";
const STAGING_PREFIX: &str = ".staging-import-";
pub(crate) const DOWNLOAD_PREFIX: &str = ".download-";
const STALE_AFTER: Duration = Duration::from_secs(24 * 60 * 60);
const NAME_LIMIT: usize = 120;
const DESCRIPTION_LIMIT: usize = 500;
const SLUG_LIMIT: usize = 40;
const PREVIEW_LIMIT: usize = 8 * 1024 * 1024;
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

static STAGING: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
pub(crate) struct TemplateDraft {
    pub name: String,
    pub description: String,
    pub main_doc: Option<String>,
    pub tex_flavor: Option<String>,
    pub license: Option<TemplateLicense>,
    pub preview_png: Option<Vec<u8>>,
}

pub(crate) enum TemplateSource<'a> {
    Archive(&'a Path),
    OnlineProject(&'a Path),
    Folder(&'a Path),
    Project(&'a Path),
}

pub(crate) fn publish_template(
    custom_root: &Path,
    reserved: &[String],
    source: TemplateSource<'_>,
    draft: TemplateDraft,
) -> Result<String, String> {
    let name = clean_name(&draft.name)?;
    std::fs::create_dir_all(custom_root).map_err(|error| error.to_string())?;
    sweep_stale_staging(custom_root);
    let staging = custom_root.join(format!(
        "{STAGING_PREFIX}{}-{}",
        std::process::id(),
        STAGING.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&staging);
    let result = stage_and_publish(custom_root, reserved, &staging, source, draft, name);
    if result.is_err() && staging.exists() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    result
}

fn stage_and_publish(
    custom_root: &Path,
    reserved: &[String],
    staging: &Path,
    source: TemplateSource<'_>,
    draft: TemplateDraft,
    name: String,
) -> Result<String, String> {
    let files = staging.join(FILES_DIR);
    std::fs::create_dir_all(&files).map_err(|error| error.to_string())?;
    match source {
        TemplateSource::Archive(archive) => {
            crate::project::extract_zip_for_import(archive, &files)?;
            crate::project::flatten_single_root_folder(&files)?;
        }
        TemplateSource::OnlineProject(archive) => {
            crate::project::extract_zip_for_import(archive, &files)?;
        }
        TemplateSource::Folder(folder) => {
            refuse_enclosing_folder(folder, custom_root)?;
            crate::project::copy_tree_for_import(folder, &files, 0, &mut 0, &mut 0)?;
            crate::project::flatten_single_root_folder(&files)?;
        }
        TemplateSource::Project(root) => {
            refuse_enclosing_folder(root, custom_root)?;
            crate::project::copy_tree_for_import(root, &files, 0, &mut 0, &mut 0)?;
            remove_project_settings(&files)?;
        }
    }
    make_writable(&files)?;
    let main_doc = choose_main(&files, draft.main_doc.as_deref())?;
    let engine = engine_name(&main_doc)?;
    let tex_flavor = draft
        .tex_flavor
        .as_deref()
        .and_then(LatexmkFlavor::parse)
        .filter(|_| engine == LATEX_ENGINE)
        .map(|flavor| flavor.as_str().to_string());
    let id = unique_id(custom_root, reserved, &name);
    let manifest = TemplateManifest {
        id: id.clone(),
        name,
        category: CUSTOM_CATEGORY.to_string(),
        description: clean_description(&draft.description),
        main_doc,
        engine: engine.to_string(),
        ats_profile: None,
        layout: None,
        pages: None,
        default_color: None,
        license: draft.license.filter(|license| {
            !(license.spdx.trim().is_empty()
                && license.author.trim().is_empty()
                && license.url.trim().is_empty())
        }),
        requires: TemplateRequires::default(),
        order: 0,
        kind: None,
        files_dir: Some(FILES_DIR.to_string()),
        tex_flavor,
    };
    crate::templates::validate_manifest_files(staging, &manifest)?;
    let json = serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?;
    std::fs::write(staging.join("template.json"), json).map_err(|error| error.to_string())?;
    if let Some(png) = draft.preview_png {
        std::fs::write(staging.join("preview.png"), png).map_err(|error| error.to_string())?;
    }
    std::fs::rename(staging, custom_root.join(&id)).map_err(|error| error.to_string())?;
    Ok(id)
}

const LATEX_ENGINE: &str = "xetex";

fn engine_name(main_doc: &str) -> Result<&'static str, String> {
    match oleafly_core::SourceFamily::of(main_doc) {
        Some(oleafly_core::SourceFamily::Latex) => Ok(LATEX_ENGINE),
        Some(oleafly_core::SourceFamily::Typst) => Ok("typst"),
        Some(oleafly_core::SourceFamily::Markdown) => Ok("markdown"),
        Some(oleafly_core::SourceFamily::Quarto) => Ok("quarto"),
        None => Err(AppError::new("project.import_no_main").into()),
    }
}

fn clean_name(name: &str) -> Result<String, String> {
    let name: String = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err(AppError::new("template.name_required").into());
    }
    Ok(name.chars().take(NAME_LIMIT).collect())
}

fn clean_description(description: &str) -> String {
    let text: String = description.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= DESCRIPTION_LIMIT {
        return text;
    }
    let mut short: String = text.chars().take(DESCRIPTION_LIMIT - 1).collect();
    short.push('…');
    short
}

fn clean_relative(path: &str) -> Option<String> {
    let text = path.trim().replace('\\', "/");
    let parts: Vec<&str> = text
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
        .collect();
    if parts.is_empty() || parts.contains(&"..") || parts[0].contains(':') {
        return None;
    }
    Some(parts.join("/"))
}

fn choose_main(files: &Path, preferred: Option<&str>) -> Result<String, String> {
    if let Some(main) = preferred.and_then(clean_relative) {
        let usable = oleafly_core::SourceFamily::of(&main).is_some()
            && std::fs::symlink_metadata(files.join(&main))
                .is_ok_and(|metadata| metadata.is_file());
        if usable {
            return Ok(main);
        }
    }
    crate::project::infer_main_document(files)
}

fn slug(name: &str) -> String {
    let mut out = String::new();
    for character in name.chars() {
        if out.len() >= SLUG_LIMIT {
            break;
        }
        if character.is_ascii_alphanumeric() {
            out.push(character.to_ascii_lowercase());
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    let out = out.trim_end_matches('-');
    if out.is_empty() {
        "template".to_string()
    } else {
        out.to_string()
    }
}

fn unique_id(custom_root: &Path, reserved: &[String], name: &str) -> String {
    let base = slug(name);
    loop {
        let candidate = format!("{base}-{:06x}", rand::random::<u32>() & 0x00ff_ffff);
        let taken = reserved
            .iter()
            .any(|id| id.eq_ignore_ascii_case(&candidate))
            || custom_root.join(&candidate).exists();
        if !taken {
            return candidate;
        }
    }
}

fn remove_project_settings(files: &Path) -> Result<(), String> {
    let settings = files.join("project.json");
    match std::fs::remove_file(&settings) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn refuse_enclosing_folder(folder: &Path, custom_root: &Path) -> Result<(), String> {
    let (Ok(folder), Ok(root)) = (folder.canonicalize(), custom_root.canonicalize()) else {
        return Ok(());
    };
    if root.starts_with(&folder) {
        return Err(AppError::new("template.folder_holds_templates").into());
    }
    Ok(())
}

/// Files copied on Windows keep their read-only flag, which would make the
/// template impossible to delete and every project made from it read-only.
#[cfg(windows)]
fn make_writable(dir: &Path) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_dir() {
            make_writable(&entry.path())?;
            continue;
        }
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        let mut permissions = metadata.permissions();
        if permissions.readonly() {
            // NOSONAR: a private copy in the template store, never the source.
            #[allow(clippy::permissions_set_readonly_false)]
            permissions.set_readonly(false); // NOSONAR
            std::fs::set_permissions(entry.path(), permissions)
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn make_writable(_dir: &Path) -> Result<(), String> {
    Ok(())
}

fn sweep_stale_staging(custom_root: &Path) {
    let Ok(entries) = std::fs::read_dir(custom_root) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with(STAGING_PREFIX) && !name.starts_with(DOWNLOAD_PREFIX) {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > STALE_AFTER);
        if !stale {
            continue;
        }
        let path = entry.path();
        let _ = if path.is_dir() {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
    }
}

pub(crate) fn download_path(custom_root: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(custom_root).map_err(|error| error.to_string())?;
    Ok(custom_root.join(format!(
        "{DOWNLOAD_PREFIX}{}-{}.zip",
        std::process::id(),
        STAGING.fetch_add(1, Ordering::SeqCst)
    )))
}

pub(crate) fn decode_preview(base64: Option<&str>) -> Option<Vec<u8>> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let text = base64?.trim();
    let text = text.strip_prefix("data:image/png;base64,").unwrap_or(text);
    if text.is_empty() || text.len() > PREVIEW_LIMIT * 4 / 3 + 4 {
        return None;
    }
    let bytes = STANDARD.decode(text).ok()?;
    (bytes.len() <= PREVIEW_LIMIT && bytes.starts_with(PNG_SIGNATURE)).then_some(bytes)
}

#[tauri::command]
pub async fn import_template_from_path(
    app: AppHandle,
    path: String,
    name: String,
) -> Result<String, String> {
    crate::path_grants::require_open(&path)?;
    let reserved = crate::templates::shipped_template_ids_off_thread(app).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let source = PathBuf::from(&path);
        let custom_root = crate::templates::custom_templates_root()?;
        let metadata =
            std::fs::metadata(&source).map_err(|_| format!("import source not found: {path}"))?;
        let source = if metadata.is_dir() {
            TemplateSource::Folder(&source)
        } else {
            TemplateSource::Archive(&source)
        };
        publish_template(
            &custom_root,
            &reserved,
            source,
            TemplateDraft {
                name,
                ..TemplateDraft::default()
            },
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn save_project_as_template(
    app: AppHandle,
    project_id: String,
    name: String,
    preview_png_base64: Option<String>,
) -> Result<String, String> {
    let reserved = crate::templates::shipped_template_ids_off_thread(app).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
        let meta = crate::project::read_meta(&project_id)?;
        let location = crate::project_location::locate(&project_id)?;
        let tex_flavor = (meta.engine == crate::config::LATEXMK_ENGINE)
            .then(|| meta.tex_flavor.clone())
            .flatten();
        let custom_root = crate::templates::custom_templates_root()?;
        publish_template(
            &custom_root,
            &reserved,
            TemplateSource::Project(&location.root),
            TemplateDraft {
                name,
                main_doc: Some(meta.main_doc),
                tex_flavor,
                preview_png: decode_preview(preview_png_base64.as_deref()),
                ..TemplateDraft::default()
            },
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests;
