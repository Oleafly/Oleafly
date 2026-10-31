use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub(crate) use oleafly_core::templates::{
    instantiate_from, is_valid_id, read_manifest, validate_manifest_files, CUSTOM_CATEGORY,
};
use oleafly_core::templates::{list_templates_in_roots, preview_file, sort_templates};
pub use oleafly_core::templates::{TemplateLicense, TemplateManifest, TemplateRequires};

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
    pub source: String,
    pub tex_flavor: Option<String>,
}

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

fn repo_templates_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("templates")
}

pub fn template_roots(app: &AppHandle) -> Vec<(PathBuf, &'static str)> {
    let mut roots: Vec<(PathBuf, &'static str)> = Vec::new();
    if let Ok(bundled) = templates_root(app) {
        roots.push((bundled, "bundled"));
    }
    if let Ok(data) = crate::paths::templates_data_root() {
        let packs = data.join("packs");
        if let Ok(entries) = std::fs::read_dir(&packs) {
            let mut dirs: Vec<PathBuf> = entries
                .flatten()
                .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                .map(|e| e.path())
                .collect();
            dirs.sort();
            for d in dirs {
                roots.push((d, "pack"));
            }
        }
        roots.push((data.join("custom"), "custom"));
    }
    roots
}

pub fn template_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !is_valid_id(id) {
        return Err(format!("illegal template id: {id}"));
    }
    for (root, _) in template_roots(app) {
        let dir = root.join(id);
        if dir.is_dir() {
            return Ok(dir);
        }
    }
    Err(format!("unknown template: {id}"))
}

fn manifest_ready(app: &AppHandle, m: &TemplateManifest) -> bool {
    crate::assets::fonts_ready(app, &m.requires.fonts)
}

fn to_info(app: &AppHandle, m: TemplateManifest, has_preview: bool, source: &str) -> TemplateInfo {
    let ready = manifest_ready(app, &m);
    let document_engine = match m.engine.to_ascii_lowercase().as_str() {
        "typst" | "typ" => "typst",
        "markdown" | "md" | "pandoc" => "markdown",
        "quarto" | "qmd" => "quarto",
        "calepin" => "calepin",
        "xetex" | "latex" | "tectonic" | "luatex" | "latexmk" => "latex",
        _ => "unknown",
    }
    .to_owned();
    let tex_flavor = m
        .tex_flavor
        .filter(|_| document_engine == "latex")
        .filter(|flavor| crate::document_engine::LatexmkFlavor::parse(flavor).is_some());
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
        source: source.to_string(),
        tex_flavor,
    }
}

#[tauri::command]
pub async fn list_templates(app: AppHandle) -> Result<Vec<TemplateInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || list_templates_blocking(&app))
        .await
        .map_err(|error| format!("failed to list templates: {error}"))
}

fn list_templates_blocking(app: &AppHandle) -> Vec<TemplateInfo> {
    let roots = template_roots(app);
    let mut items = list_templates_in_roots(&roots);
    sort_templates(&mut items);
    items
        .into_iter()
        .map(|(m, dir, source)| {
            let has_preview = preview_file(&dir).is_some();
            to_info(app, m, has_preview, source)
        })
        .collect()
}

#[derive(serde::Deserialize)]
pub struct CustomFile {
    pub name: String,
    pub content: String,
    #[serde(default)]
    pub content_base64: Option<String>,
}

fn is_safe_custom_file(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('/')
        && !name.contains('\\')
        && !name
            .split('/')
            .any(|seg| seg.is_empty() || seg == "." || seg == "..")
}

fn save_custom_template_at(
    custom_root: &Path,
    slug: &str,
    manifest_json: &str,
    files: &[CustomFile],
    reserved: &[String],
) -> Result<(), String> {
    if !is_valid_id(slug) {
        return Err(format!("illegal template id: {slug}"));
    }
    if reserved.iter().any(|r| r == slug) {
        return Err(format!("template id {slug} is already taken"));
    }
    let manifest: TemplateManifest =
        serde_json::from_str(manifest_json).map_err(|e| format!("invalid manifest: {e}"))?;
    if manifest.id != slug {
        return Err("manifest id must match the template slug".into());
    }
    if !files.iter().any(|f| f.name == manifest.main_doc) {
        return Err(format!("missing main document {}", manifest.main_doc));
    }
    if let Some(bad) = files.iter().find(|f| !is_safe_custom_file(&f.name)) {
        return Err(format!("illegal file name: {}", bad.name));
    }
    let dest = custom_root.join(slug);
    if dest.exists() {
        return Err(format!("custom template {slug} already exists"));
    }
    let staging = custom_root.join(format!(".staging-{slug}"));
    let _ = std::fs::remove_dir_all(&staging);
    let write_all = || -> Result<(), String> {
        std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
        std::fs::write(staging.join("template.json"), manifest_json).map_err(|e| e.to_string())?;
        for f in files {
            let p = staging.join(&f.name);
            if let Some(parent) = p.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            if let Some(b64) = &f.content_base64 {
                use base64::{engine::general_purpose::STANDARD, Engine};
                let bytes = STANDARD.decode(b64).map_err(|e| e.to_string())?;
                std::fs::write(&p, bytes).map_err(|e| e.to_string())?;
            } else {
                std::fs::write(&p, &f.content).map_err(|e| e.to_string())?;
            }
        }
        std::fs::rename(&staging, &dest).map_err(|e| e.to_string())
    };
    if let Err(e) = write_all() {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e);
    }
    Ok(())
}

#[tauri::command]
pub fn delete_custom_template(slug: String) -> Result<(), String> {
    if !is_valid_id(&slug) {
        return Err(format!("illegal template id: {slug}"));
    }
    let custom_root = crate::paths::templates_data_root()?.join("custom");
    let dir = custom_root.join(&slug);
    if !dir.is_dir() {
        return Ok(());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_custom_template(
    app: AppHandle,
    slug: String,
    manifest_json: String,
    files: Vec<CustomFile>,
) -> Result<(), String> {
    let custom_root = custom_templates_root()?;
    std::fs::create_dir_all(&custom_root).map_err(|e| e.to_string())?;
    let reserved = shipped_template_ids(&app);
    save_custom_template_at(&custom_root, &slug, &manifest_json, &files, &reserved)
}

pub(crate) fn custom_templates_root() -> Result<PathBuf, String> {
    Ok(crate::paths::templates_data_root()?.join("custom"))
}

pub(crate) async fn shipped_template_ids_off_thread(app: AppHandle) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || shipped_template_ids(&app))
        .await
        .map_err(|error| format!("failed to list templates: {error}"))
}

pub(crate) fn shipped_template_ids(app: &AppHandle) -> Vec<String> {
    list_templates_in_roots(&template_roots(app))
        .into_iter()
        .filter(|(_, _, source)| *source != "custom")
        .map(|(m, _, _)| m.id)
        .collect()
}

#[tauri::command]
pub async fn template_preview(
    app: AppHandle,
    template_id: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || template_preview_blocking(&app, &template_id))
        .await
        .map_err(|error| format!("failed to load template preview: {error}"))?
}

fn template_preview_blocking(app: &AppHandle, template_id: &str) -> Result<Option<String>, String> {
    preview_data_uri(&template_dir(app, template_id)?)
}

fn preview_data_uri(dir: &Path) -> Result<Option<String>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let Some((path, mime)) = preview_file(dir) else {
        return Ok(None);
    };
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Some(format!(
        "data:{mime};base64,{}",
        STANDARD.encode(&bytes)
    )))
}

pub fn instantiate(app: &AppHandle, id: &str, dest: &Path) -> Result<TemplateManifest, String> {
    instantiate_from(&template_dir(app, id)?, dest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_core::templates::validate_manifest_dir;

    #[test]
    fn bundled_ctex_templates_use_the_portable_fandol_fonts() {
        fn tex_sources(directory: &Path, found: &mut Vec<PathBuf>) {
            for entry in std::fs::read_dir(directory).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    tex_sources(&path, found);
                } else if path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| matches!(extension, "tex" | "cls" | "sty"))
                {
                    found.push(path);
                }
            }
        }
        let mut sources = Vec::new();
        tex_sources(&repo_templates_dir(), &mut sources);
        assert!(!sources.is_empty());
        for path in sources {
            let text = std::fs::read_to_string(&path).unwrap();
            let loads_ctex = text.lines().any(|line| {
                let code = line.split('%').next().unwrap_or_default();
                [
                    "{ctex}",
                    "{ctexart}",
                    "{ctexrep}",
                    "{ctexbook}",
                    "{ctexbeamer}",
                ]
                .iter()
                .any(|class| code.contains(class))
            });
            assert!(
                !loads_ctex || text.contains("fontset=fandol"),
                "{} loads ctex without fontset=fandol",
                path.display()
            );
        }
    }

    #[test]
    fn custom_template_save_validates_and_is_transactional() {
        let root = std::env::temp_dir().join(format!("oleafly-custom-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let manifest = r#"{"id":"my-note","name":"My Note"}"#;
        let files = vec![super::CustomFile {
            name: "main.tex".into(),
            content: "\\documentclass{article}".into(),
            content_base64: None,
        }];
        assert!(super::save_custom_template_at(&root, "../x", manifest, &files, &[]).is_err());
        assert!(super::save_custom_template_at(
            &root,
            "my-note",
            manifest,
            &files,
            &["my-note".into()]
        )
        .is_err());
        assert!(super::save_custom_template_at(&root, "other", manifest, &files, &[]).is_err());
        assert!(super::save_custom_template_at(&root, "my-note", manifest, &[], &[]).is_err());
        super::save_custom_template_at(&root, "my-note", manifest, &files, &[]).unwrap();
        assert!(root.join("my-note/template.json").is_file());
        assert!(root.join("my-note/main.tex").is_file());
        assert!(super::save_custom_template_at(&root, "my-note", manifest, &files, &[]).is_err());
        assert!(!root.join(".staging-my-note").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    fn bundled_typst() -> Option<PathBuf> {
        let triple = crate::biber_toolchain::host_triple_guess()?;
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("typst-{triple}{}", std::env::consts::EXE_SUFFIX));
        path.is_file().then_some(path)
    }

    #[test]
    fn typst_figure_template_is_an_image_kind_typst_template() {
        let dir = repo_templates_dir().join("typst-figure");
        let manifest = read_manifest(&dir).unwrap();
        assert_eq!(manifest.engine, "typst");
        assert_eq!(manifest.main_doc, "main.typ");
        assert_eq!(manifest.kind.as_deref(), Some("image"));
        assert_eq!(manifest.category, "Diagrams & Figures");
        validate_manifest_dir(&dir, &manifest).expect("image-kind Typst template validates");
    }

    #[test]
    fn bundled_typst_templates_compile_without_errors_or_warnings() {
        let Some(typst) = bundled_typst() else {
            eprintln!("Typst sidecar is not staged; skipping the template compile check");
            return;
        };
        let out = tempfile::tempdir().unwrap();
        let mut dirs: Vec<PathBuf> = std::fs::read_dir(repo_templates_dir())
            .unwrap()
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect();
        dirs.sort();
        let mut compiled = Vec::new();
        for dir in dirs {
            let manifest = read_manifest(&dir).unwrap();
            if !matches!(
                manifest.engine.to_ascii_lowercase().as_str(),
                "typst" | "typ"
            ) {
                continue;
            }
            let pdf = out.path().join(format!("{}.pdf", manifest.id));
            let mut command = std::process::Command::new(&typst);
            command
                .arg("--color=never")
                .arg("compile")
                .arg(dir.join(&manifest.main_doc))
                .arg(&pdf)
                .arg("--root")
                .arg(&dir)
                .args(["--diagnostic-format", "short", "--ignore-system-fonts"])
                .current_dir(&dir);
            let output = crate::proc::output_contained_with_timeout(
                command,
                std::time::Duration::from_secs(120),
            )
            .unwrap_or_else(|error| panic!("{} did not finish: {error}", manifest.id));
            let log = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stderr),
                String::from_utf8_lossy(&output.stdout)
            );
            assert!(
                output.status.success(),
                "{} failed to compile:\n{log}",
                manifest.id
            );
            assert!(
                !log.contains("warning:"),
                "{} compiled with warnings:\n{log}",
                manifest.id
            );
            assert!(pdf.is_file(), "{} wrote no PDF", manifest.id);
            compiled.push(manifest.id);
        }
        for id in [
            "blank-typst",
            "typst-conference-style-article",
            "typst-figure",
            "typst-letter",
            "typst-report",
            "typst-resume",
            "typst-technical-report",
            "typst-thesis",
        ] {
            assert!(
                compiled.iter().any(|compiled| compiled == id),
                "{id} was not compiled: {compiled:?}"
            );
        }
    }

    #[test]
    fn preview_serves_png_first_then_webp_with_the_right_mime() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(preview_data_uri(dir.path()).unwrap(), None);
        std::fs::write(dir.path().join("preview.webp"), b"RIFF").unwrap();
        let webp = preview_data_uri(dir.path()).unwrap().unwrap();
        assert!(webp.starts_with("data:image/webp;base64,"), "{webp}");
        std::fs::write(dir.path().join("preview.png"), b"PNG").unwrap();
        let png = preview_data_uri(dir.path()).unwrap().unwrap();
        assert!(png.starts_with("data:image/png;base64,"), "{png}");
    }
}
