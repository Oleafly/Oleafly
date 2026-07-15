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
    /// Project kind: "" / "document" for normal projects, "image" for a
    /// single-figure project that previews the compiled image (standalone).
    #[serde(default)]
    pub kind: Option<String>,
}

/// The gallery-facing view, sent to the UI by `list_templates`.
#[derive(Serialize)]
pub struct TemplateInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub engine: String,
    pub document_engine: String,
    pub ats_profile: Option<String>,
    pub layout: Option<String>,
    pub pages: Option<String>,
    pub default_color: Option<String>,
    pub license: Option<TemplateLicense>,
    pub requires: TemplateRequires,
    pub has_preview: bool,
    pub assets_ready: bool,
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

fn validate_manifest_dir(dir: &Path, manifest: &TemplateManifest) -> Result<(), String> {
    if dir.file_name().and_then(|name| name.to_str()) != Some(manifest.id.as_str()) {
        return Err("template directory name does not match manifest id".into());
    }
    let main = Path::new(&manifest.main_doc);
    if main.is_absolute()
        || main
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err("template main_doc must be a safe relative path".into());
    }
    let main = dir.join(main);
    let metadata = std::fs::symlink_metadata(&main)
        .map_err(|_| format!("template main document is missing: {}", manifest.main_doc))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("template main document must be a regular non-symlink file".into());
    }
    let descriptor = crate::document_engine::descriptor_for(&manifest.engine, &manifest.main_doc)?;
    let kind = if manifest.kind.as_deref() == Some("image") {
        crate::document_engine::TemplateKind::Image
    } else if manifest
        .kind
        .as_deref()
        .map(|kind| kind.is_empty() || kind == "document")
        .unwrap_or(true)
    {
        crate::document_engine::TemplateKind::Document
    } else {
        return Err("unsupported template kind".into());
    };
    if !descriptor.capabilities.template_kinds.contains(&kind) {
        return Err("template kind is unsupported by its document engine".into());
    }
    Ok(())
}

fn manifest_ready(app: &AppHandle, m: &TemplateManifest) -> bool {
    crate::assets::fonts_ready(app, &m.requires.fonts)
}

fn to_info(app: &AppHandle, m: TemplateManifest, has_preview: bool) -> TemplateInfo {
    let ready = manifest_ready(app, &m);
    let document_engine = match m.engine.to_ascii_lowercase().as_str() {
        "typst" | "typ" => "typst",
        "markdown" | "md" | "pandoc" => "markdown",
        "xetex" | "latex" | "tectonic" | "luatex" => "latex",
        _ => "unknown",
    }
    .to_owned();
    TemplateInfo {
        id: m.id,
        name: m.name,
        description: m.description,
        category: m.category,
        engine: m.engine,
        document_engine,
        ats_profile: m.ats_profile,
        layout: m.layout,
        pages: m.pages,
        default_color: m.default_color,
        license: m.license,
        requires: m.requires,
        has_preview,
        assets_ready: ready,
        order: m.order,
    }
}

#[tauri::command]
pub fn list_templates(app: AppHandle) -> Result<Vec<TemplateInfo>, String> {
    let root = templates_root(&app)?;
    let mut items: Vec<(TemplateManifest, bool)> = Vec::new();
    for entry in std::fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_symlink() || !file_type.is_dir() {
            continue;
        }
        let dir = entry.path();
        // Skip folders without a valid manifest rather than failing the whole list.
        let manifest = match read_manifest(&dir) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if validate_manifest_dir(&dir, &manifest).is_err() {
            continue;
        }
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
    validate_manifest_dir(&src, &manifest)?;
    copy_tree(&src, dest, 0)?;
    Ok(manifest)
}

fn copy_tree(src: &Path, dest: &Path, depth: usize) -> Result<(), String> {
    if depth >= MAX_COPY_DEPTH {
        return Err(format!(
            "template nesting exceeds maximum depth {MAX_COPY_DEPTH}"
        ));
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
        if ft.is_symlink() {
            return Err(format!("template contains a symlink: {}", from.display()));
        }
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
            validate_manifest_dir(&dir, &m).expect("manifest runtime invariants");
            count += 1;
        }
        assert!(count >= 4, "expected the migrated first-set templates");
        let typst = read_manifest(&root.join("blank-typst")).unwrap();
        assert_eq!(typst.engine, "typst");
        assert_eq!(typst.main_doc, "main.typ");
        let markdown = read_manifest(&root.join("blank-markdown")).unwrap();
        assert_eq!(markdown.engine, "markdown");
        assert_eq!(markdown.main_doc, "main.md");
        assert!(validate_manifest_dir(&root.join("blank"), &markdown).is_err());
        let mut missing = markdown.clone();
        missing.id = "blank-markdown".into();
        missing.main_doc = "missing.md".into();
        assert!(validate_manifest_dir(&root.join("blank-markdown"), &missing).is_err());
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

    #[cfg(unix)]
    #[test]
    fn copy_tree_rejects_symlinks() {
        use std::os::unix::fs::symlink;
        let base =
            std::env::temp_dir().join(format!("openleaf-template-link-{}", std::process::id()));
        let src = base.join("src");
        let dest = base.join("dest");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(base.join("outside"), "secret").unwrap();
        symlink(base.join("outside"), src.join("linked")).unwrap();
        assert!(copy_tree(&src, &dest, 0).is_err());
        assert!(!dest.join("linked").exists());
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn copy_tree_rejects_excessive_depth_instead_of_truncating() {
        let base =
            std::env::temp_dir().join(format!("openleaf-template-depth-{}", std::process::id()));
        let src = base.join("src");
        let dest = base.join("dest");
        let _ = std::fs::remove_dir_all(&base);
        let mut nested = src.clone();
        for _ in 0..=MAX_COPY_DEPTH {
            nested = nested.join("nested");
        }
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("main.tex"), "x").unwrap();
        std::fs::create_dir_all(&dest).unwrap();
        assert!(copy_tree(&src, &dest, 0).is_err());
        let _ = std::fs::remove_dir_all(base);
    }
}
