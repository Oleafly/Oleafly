//! On-disk template gallery.
//!
//! Templates ship as bundled resource folders under `resources/templates/<id>/`,
//! each with a `template.json` manifest, the source files, an optional
//! `preview.png`, and an optional `LICENSE`. This replaces the old inline
//! `&'static str` templates so the gallery can grow without touching Rust.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn default_main_doc() -> String {
    "main.tex".to_string()
}
fn default_engine() -> String {
    "xetex".to_string()
}
fn default_engine_kind() -> String {
    "tectonic".to_string()
}

/// Files that live in a template folder for the gallery's benefit and must NOT
/// be copied into a freshly-created project.
const META_FILES: &[&str] = &["template.json", "preview.png", "LICENSE"];

/// Cap recursion on template copies (templates are shallow; this is a backstop).
const MAX_COPY_DEPTH: usize = 16;

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct TemplateLicense {
    #[serde(default)]
    pub spdx: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub url: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct TemplateRequires {
    #[serde(default)]
    pub packages: Vec<String>,
    #[serde(default)]
    pub fonts: Vec<String>,
    #[serde(default = "default_engine_kind")]
    pub engine: String,
}

impl Default for TemplateRequires {
    fn default() -> Self {
        TemplateRequires {
            packages: Vec::new(),
            fonts: Vec::new(),
            engine: default_engine_kind(),
        }
    }
}

/// The parsed `template.json` manifest.
#[derive(Deserialize, Clone)]
pub struct TemplateManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_main_doc")]
    pub main_doc: String,
    #[serde(default = "default_engine")]
    pub engine: String,
    #[serde(default)]
    pub ats_profile: Option<String>,
    #[serde(default)]
    pub layout: Option<String>,
    #[serde(default)]
    pub pages: Option<String>,
    #[serde(default)]
    pub default_color: Option<String>,
    #[serde(default)]
    pub license: Option<TemplateLicense>,
    #[serde(default)]
    pub requires: TemplateRequires,
    #[serde(default)]
    pub order: i64,
}

/// The gallery-facing view, sent to the UI by `list_templates`.
#[derive(Serialize)]
pub struct TemplateInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub engine: String,
    pub ats_profile: Option<String>,
    pub layout: Option<String>,
    pub pages: Option<String>,
    pub default_color: Option<String>,
    pub license: Option<TemplateLicense>,
    pub requires: TemplateRequires,
    pub has_preview: bool,
    /// Whether the template's prerequisites are already satisfied so it can be
    /// created without a download. Refined by the asset manager; here it is a
    /// conservative heuristic (default Tectonic engine, no extra fonts).
    pub ready: bool,
    pub order: i64,
}

fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The templates root. Prefers the bundled resource dir, falling back to the
/// in-repo path for `tauri dev` and tests.
pub fn templates_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(p) = app
        .path()
        .resolve("resources/templates", tauri::path::BaseDirectory::Resource)
    {
        if p.is_dir() {
            return Ok(p);
        }
    }
    let dev = repo_templates_dir();
    if dev.is_dir() {
        return Ok(dev);
    }
    Err("templates directory not found".to_string())
}

/// The in-repo templates dir (compile-time path). Used as a dev/test fallback.
fn repo_templates_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("templates")
}

/// A single template's directory, guarding the id so it can't escape the root.
pub fn template_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !is_valid_id(id) {
        return Err(format!("illegal template id: {id}"));
    }
    let dir = templates_root(app)?.join(id);
    if !dir.is_dir() {
        return Err(format!("unknown template: {id}"));
    }
    Ok(dir)
}

pub fn read_manifest(dir: &Path) -> Result<TemplateManifest, String> {
    let p = dir.join("template.json");
    let s =
        std::fs::read_to_string(&p).map_err(|e| format!("failed to read {}: {e}", p.display()))?;
    serde_json::from_str(&s).map_err(|e| format!("invalid template.json in {}: {e}", dir.display()))
}

/// A template is ready to create without a download when it uses the default
/// Tectonic engine and every font pack it needs is already cached.
fn manifest_ready(app: &AppHandle, m: &TemplateManifest) -> bool {
    m.requires.engine == "tectonic" && crate::assets::fonts_ready(app, &m.requires.fonts)
}

fn to_info(app: &AppHandle, m: TemplateManifest, has_preview: bool) -> TemplateInfo {
    let ready = manifest_ready(app, &m);
    TemplateInfo {
        id: m.id,
        name: m.name,
        description: m.description,
        category: m.category,
        engine: m.engine,
        ats_profile: m.ats_profile,
        layout: m.layout,
        pages: m.pages,
        default_color: m.default_color,
        license: m.license,
        requires: m.requires,
        has_preview,
        ready,
        order: m.order,
    }
}

#[tauri::command]
pub fn list_templates(app: AppHandle) -> Result<Vec<TemplateInfo>, String> {
    let root = templates_root(&app)?;
    let mut items: Vec<(TemplateManifest, bool)> = Vec::new();
    for entry in std::fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let dir = entry.path();
        // Skip folders without a valid manifest rather than failing the whole list.
        let manifest = match read_manifest(&dir) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let has_preview = dir.join("preview.png").is_file();
        items.push((manifest, has_preview));
    }
    items.sort_by(|a, b| {
        a.0.order
            .cmp(&b.0.order)
            .then_with(|| a.0.name.cmp(&b.0.name))
    });
    Ok(items
        .into_iter()
        .map(|(m, p)| to_info(&app, m, p))
        .collect())
}

/// The pre-rendered page-1 preview as a `data:` URI, or `None` if absent. Called
/// lazily per card so the gallery list stays light.
#[tauri::command]
pub fn template_preview(app: AppHandle, template_id: String) -> Result<Option<String>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let dir = template_dir(&app, &template_id)?;
    let png = dir.join("preview.png");
    if !png.is_file() {
        return Ok(None);
    }
    let bytes = std::fs::read(&png).map_err(|e| e.to_string())?;
    Ok(Some(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(&bytes)
    )))
}

/// Copy a template's source files into `dest` (a fresh, existing project dir),
/// skipping gallery metadata. Returns the manifest so the caller can seed
/// project.json.
pub fn instantiate(app: &AppHandle, id: &str, dest: &Path) -> Result<TemplateManifest, String> {
    let src = template_dir(app, id)?;
    let manifest = read_manifest(&src)?;
    copy_tree(&src, dest, 0)?;
    Ok(manifest)
}

fn copy_tree(src: &Path, dest: &Path, depth: usize) -> Result<(), String> {
    if depth >= MAX_COPY_DEPTH {
        return Ok(());
    }
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        // At the top level, skip gallery-only metadata files.
        if depth == 0 && META_FILES.contains(&name_str.as_ref()) {
            continue;
        }
        let from = entry.path();
        let to = dest.join(&name);
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        if ft.is_dir() {
            std::fs::create_dir_all(&to).map_err(|e| e.to_string())?;
            copy_tree(&from, &to, depth + 1)?;
        } else {
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifests_parse_and_are_ready() {
        let root = repo_templates_dir();
        assert!(root.is_dir(), "repo templates dir must exist for tests");
        let mut count = 0;
        for entry in std::fs::read_dir(&root).unwrap() {
            let dir = entry.unwrap().path();
            if !dir.is_dir() {
                continue;
            }
            let m = read_manifest(&dir).expect("manifest parses");
            assert!(is_valid_id(&m.id), "id is a safe slug: {}", m.id);
            assert_eq!(
                dir.file_name().unwrap().to_string_lossy(),
                m.id,
                "folder name matches manifest id"
            );
            count += 1;
        }
        assert!(count >= 4, "expected the migrated first-set templates");
    }

    #[test]
    fn copy_tree_skips_metadata() {
        let src = repo_templates_dir().join("ieee");
        let tmp = std::env::temp_dir().join(format!("openleaf-tpl-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        copy_tree(&src, &tmp, 0).unwrap();
        assert!(tmp.join("main.tex").is_file());
        assert!(tmp.join("refs.bib").is_file());
        assert!(!tmp.join("template.json").exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
