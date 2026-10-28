//! Document templates on disk, shared by the app's gallery and
//! `oleafly new`/`oleafly templates`.
//!
//! A template is a folder named by its id with a `template.json` manifest,
//! the source files (or a `files_dir` sub-folder holding them), an optional
//! `preview.png`/`preview.webp` and an optional `LICENSE`. Errors are plain
//! sentences; the app passes them through as they are.
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Engine, SourceFamily, TexFlavor};

fn default_main_doc() -> String {
    "main.tex".to_string()
}

fn default_engine() -> String {
    "xetex".to_string()
}

fn default_engine_kind() -> String {
    "tectonic".to_string()
}

/// Files in a template folder that are for the gallery and must not be
/// copied into a new project.
pub const META_FILES: &[&str] = &[
    "template.json",
    "preview.png",
    "preview.webp",
    "SOURCE.json",
    "LICENSE",
];
/// Gallery previews, in the order they are looked for, with their types.
pub const PREVIEW_FILES: &[(&str, &str)] =
    &[("preview.png", "image/png"), ("preview.webp", "image/webp")];
/// Cap on template folder nesting (templates are shallow; this is a backstop).
pub const MAX_COPY_DEPTH: usize = 16;
/// The gallery category for templates people import or save themselves.
pub const CUSTOM_CATEGORY: &str = "Custom";
/// The engine name `latexmk` projects record.
const LATEXMK: &str = "latexmk";

#[derive(Debug, Deserialize, Serialize, Clone, Default, PartialEq, Eq)]
pub struct TemplateLicense {
    #[serde(default)]
    pub spdx: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub url: String,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
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

/// The parsed `template.json`.
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ats_profile: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pages: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<TemplateLicense>,
    #[serde(default)]
    pub requires: TemplateRequires,
    #[serde(default)]
    pub order: i64,
    /// Project kind: "" / "document" for normal projects, "image" for a
    /// single-figure project that previews the compiled image (standalone).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// A sub-folder holding the template's source tree. When set, every file
    /// in it is copied into new projects as is, and `main_doc` is relative to
    /// it. Imported templates use it so their own LICENSE or preview.png can
    /// never be mistaken for gallery metadata.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub files_dir: Option<String>,
    /// A LaTeX compiler the template was made for (pdflatex, xelatex, ...).
    /// New projects use latexmk with it; without it they use the default
    /// LaTeX engine.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tex_flavor: Option<String>,
}

/// Template ids (and `files_dir` names) are plain ASCII slugs.
pub fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn read_manifest(dir: &Path) -> Result<TemplateManifest, String> {
    let path = dir.join("template.json");
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    serde_json::from_str(&text)
        .map_err(|e| format!("invalid template.json in {}: {e}", dir.display()))
}

/// Where a template's source files live: its folder, or its `files_dir`.
pub fn source_root(dir: &Path, manifest: &TemplateManifest) -> Result<PathBuf, String> {
    match manifest.files_dir.as_deref() {
        None => Ok(dir.to_path_buf()),
        Some(name) if is_valid_id(name) => {
            let root = dir.join(name);
            let metadata = std::fs::symlink_metadata(&root)
                .map_err(|_| format!("template files folder is missing: {name}"))?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("template files folder must be a real folder".into());
            }
            Ok(root)
        }
        Some(_) => Err("template files_dir must be a plain folder name".into()),
    }
}

pub fn validate_manifest_dir(dir: &Path, manifest: &TemplateManifest) -> Result<(), String> {
    if dir.file_name().and_then(std::ffi::OsStr::to_str) != Some(manifest.id.as_str()) {
        return Err("template directory name does not match manifest id".into());
    }
    validate_manifest_files(dir, manifest)
}

/// Whether an engine makes image-only (standalone figure) projects.
fn supports_image_templates(engine: Engine) -> bool {
    !matches!(engine, Engine::Markdown)
}

/// The checks that don't depend on the folder's name, so a template can be
/// validated while it is still staged under a temporary name.
pub fn validate_manifest_files(dir: &Path, manifest: &TemplateManifest) -> Result<(), String> {
    if let Some(flavor) = manifest.tex_flavor.as_deref() {
        if TexFlavor::parse(flavor).is_none() {
            return Err(format!("unknown template compiler: {flavor}"));
        }
    }
    let root = source_root(dir, manifest)?;
    let main = Path::new(&manifest.main_doc);
    if main.is_absolute()
        || main
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("template main_doc must be a safe relative path".into());
    }
    let main = root.join(main);
    let metadata = std::fs::symlink_metadata(&main)
        .map_err(|_| format!("template main document is missing: {}", manifest.main_doc))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("template main document must be a regular non-symlink file".into());
    }
    let engine = Engine::named(&manifest.engine).ok_or_else(|| {
        format!(
            "unsupported document engine `{}` for {}",
            manifest.engine, manifest.main_doc
        )
    })?;
    if !engine.accepts(&manifest.main_doc) {
        return Err(format!(
            "engine `{}` cannot compile main document `{}`",
            engine.manifest_name(),
            manifest.main_doc
        ));
    }
    let image = match manifest.kind.as_deref() {
        Some("image") => true,
        None | Some("") | Some("document") => false,
        Some(_) => return Err("unsupported template kind".into()),
    };
    if image && !supports_image_templates(engine) {
        return Err("template kind is unsupported by its document engine".into());
    }
    Ok(())
}

/// The first preview a template folder has, with its media type.
pub fn preview_file(dir: &Path) -> Option<(PathBuf, &'static str)> {
    PREVIEW_FILES
        .iter()
        .map(|(name, mime)| (dir.join(name), *mime))
        .find(|(path, _)| path.is_file())
}

/// Every valid template under `roots` (each `(folder, source)`), the first
/// root winning when two share an id.
pub fn list_templates_in_roots(
    roots: &[(PathBuf, &'static str)],
) -> Vec<(TemplateManifest, PathBuf, &'static str)> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut items: Vec<(TemplateManifest, PathBuf, &'static str)> = Vec::new();
    for (root, source) in roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() || !file_type.is_dir() {
                continue;
            }
            let dir = entry.path();
            // Folders without a valid manifest are skipped, not fatal.
            let Ok(manifest) = read_manifest(&dir) else {
                continue;
            };
            if validate_manifest_dir(&dir, &manifest).is_err() {
                continue;
            }
            if !seen.insert(manifest.id.clone()) {
                continue;
            }
            items.push((manifest, dir, source));
        }
    }
    items
}

/// The gallery order: `order`, then name.
pub fn sort_templates(items: &mut [(TemplateManifest, PathBuf, &'static str)]) {
    items.sort_by(|a, b| {
        a.0.order
            .cmp(&b.0.order)
            .then_with(|| a.0.name.cmp(&b.0.name))
    });
}

/// Copies the template in `src` into `dest` (an existing, fresh folder) and
/// returns its manifest.
pub fn instantiate_from(src: &Path, dest: &Path) -> Result<TemplateManifest, String> {
    let manifest = read_manifest(src)?;
    validate_manifest_dir(src, &manifest)?;
    // A template with its own files folder copies every file in it; the
    // older layout keeps the gallery metadata beside the source and skips it.
    let root = source_root(src, &manifest)?;
    copy_tree_with(&root, dest, 0, manifest.files_dir.is_none())?;
    Ok(manifest)
}

/// Copies a folder, refusing links and nesting deeper than
/// [`MAX_COPY_DEPTH`]; `skip_meta` leaves the gallery files at the top out.
pub fn copy_tree_with(
    src: &Path,
    dest: &Path,
    depth: usize,
    skip_meta: bool,
) -> Result<(), String> {
    if depth >= MAX_COPY_DEPTH {
        return Err(format!(
            "template nesting exceeds maximum depth {MAX_COPY_DEPTH}"
        ));
    }
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if skip_meta && depth == 0 && META_FILES.contains(&name_str.as_ref()) {
            continue;
        }
        let from = entry.path();
        let to = dest.join(&name);
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_symlink() {
            return Err(format!("template contains a symlink: {}", from.display()));
        }
        if file_type.is_dir() {
            std::fs::create_dir_all(&to).map_err(|e| e.to_string())?;
            copy_tree_with(&from, &to, depth + 1, skip_meta)?;
        } else {
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// The font packs a template needs that `available` says are missing.
pub fn missing_font_packs(
    manifest: &TemplateManifest,
    available: impl Fn(&str) -> bool,
) -> Vec<String> {
    manifest
        .requires
        .fonts
        .iter()
        .filter(|pack| !available(pack))
        .cloned()
        .collect()
}

/// The engine a main document gets in a new project: Typst and Markdown by
/// extension, LaTeX otherwise (`xetex`, or `latexmk` when that is the
/// default LaTeX engine).
pub fn new_project_engine(
    main_doc: &str,
    latex_default_engine: Option<&str>,
) -> Result<String, String> {
    let lower = main_doc.to_ascii_lowercase();
    let selected = if lower.ends_with(".typ") {
        "typst"
    } else if lower.ends_with(".md") || lower.ends_with(".markdown") {
        "markdown"
    } else if lower.ends_with(".qmd") || lower.ends_with(".rmd") {
        "quarto"
    } else if latex_default_engine == Some(LATEXMK) {
        LATEXMK
    } else {
        "xetex"
    };
    Engine::from_manifest(selected, main_doc).map_err(|error| error.to_string())?;
    Ok(selected.to_string())
}

/// The engine and LaTeX compiler for a project made from a template: a
/// template made for one LaTeX compiler gets latexmk with it; any other
/// follows [`new_project_engine`].
pub fn template_engine(
    main_doc: &str,
    tex_flavor: Option<&str>,
    latex_default_engine: Option<&str>,
) -> Result<(String, Option<String>), String> {
    let engine = new_project_engine(main_doc, latex_default_engine)?;
    let pinned = tex_flavor
        .and_then(TexFlavor::parse)
        .filter(|_| SourceFamily::of(main_doc) == Some(SourceFamily::Latex))
        .filter(|_| Engine::from_manifest(LATEXMK, main_doc).is_ok());
    Ok(match pinned {
        Some(flavor) => (LATEXMK.to_string(), Some(flavor.as_str().to_string())),
        None => (engine, None),
    })
}

pub fn declared_template_engine(
    declared: &str,
    main_doc: &str,
    tex_flavor: Option<&str>,
    latex_default_engine: Option<&str>,
) -> Result<(String, Option<String>), String> {
    match Engine::named(declared)
        .filter(|engine| matches!(engine, Engine::Quarto | Engine::Calepin))
        .filter(|engine| engine.accepts(main_doc))
    {
        Some(engine) => Ok((engine.manifest_name().to_string(), None)),
        None => template_engine(main_doc, tex_flavor, latex_default_engine),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo_templates_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src-tauri/resources/templates")
    }

    fn copy_tree(src: &Path, dest: &Path, depth: usize) -> Result<(), String> {
        copy_tree_with(src, dest, depth, true)
    }

    #[test]
    fn the_bundled_manifests_parse_and_validate() {
        let root = repo_templates_dir();
        let mut count = 0;
        for entry in std::fs::read_dir(&root).unwrap() {
            let dir = entry.unwrap().path();
            if !dir.is_dir() {
                continue;
            }
            let manifest = read_manifest(&dir).expect("manifest parses");
            assert!(is_valid_id(&manifest.id), "{}", manifest.id);
            assert_eq!(
                dir.file_name().unwrap().to_string_lossy(),
                manifest.id,
                "folder name matches manifest id"
            );
            validate_manifest_dir(&dir, &manifest)
                .unwrap_or_else(|error| panic!("{}: {error}", manifest.id));
            count += 1;
        }
        assert!(count >= 4);
        let typst = read_manifest(&root.join("blank-typst")).unwrap();
        assert_eq!(
            (typst.engine.as_str(), typst.main_doc.as_str()),
            ("typst", "main.typ")
        );
        let markdown = read_manifest(&root.join("blank-markdown")).unwrap();
        assert_eq!(
            (markdown.engine.as_str(), markdown.main_doc.as_str()),
            ("markdown", "main.md")
        );
        assert!(validate_manifest_dir(&root.join("blank"), &markdown).is_err());
        let mut missing = markdown.clone();
        missing.main_doc = "missing.md".into();
        assert!(validate_manifest_dir(&root.join("blank-markdown"), &missing).is_err());
        let figure = read_manifest(&root.join("typst-figure")).unwrap();
        assert_eq!(figure.kind.as_deref(), Some("image"));
    }

    #[test]
    fn a_files_folder_must_be_a_plain_present_folder_and_compilers_must_be_known() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("mine");
        std::fs::create_dir_all(dir.join("files")).unwrap();
        std::fs::write(dir.join("files/main.tex"), "x").unwrap();
        let manifest = |files_dir: &str, flavor: Option<&str>| -> TemplateManifest {
            serde_json::from_value(serde_json::json!({
                "id": "mine",
                "name": "Mine",
                "main_doc": "main.tex",
                "files_dir": files_dir,
                "tex_flavor": flavor,
            }))
            .unwrap()
        };
        validate_manifest_dir(&dir, &manifest("files", Some("pdflatex"))).unwrap();
        for bad in ["../files", "missing", "files/sub", ""] {
            assert!(
                validate_manifest_dir(&dir, &manifest(bad, None)).is_err(),
                "{bad}"
            );
        }
        assert!(validate_manifest_dir(&dir, &manifest("files", Some("bogus"))).is_err());
        std::fs::write(
            dir.join("template.json"),
            serde_json::to_string(&manifest("files", Some("pdflatex"))).unwrap(),
        )
        .unwrap();
        let dest = base.path().join("project");
        std::fs::create_dir_all(&dest).unwrap();
        let copied = instantiate_from(&dir, &dest).unwrap();
        assert_eq!(copied.tex_flavor.as_deref(), Some("pdflatex"));
        assert!(dest.join("main.tex").is_file());
        assert!(!dest.join("files").exists());
    }

    #[test]
    fn markdown_templates_cannot_be_image_projects() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("notes");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("main.md"), "# x").unwrap();
        let mut manifest: TemplateManifest =
            serde_json::from_value(serde_json::json!({"id": "notes", "name": "Notes", "main_doc": "main.md", "engine": "markdown"})).unwrap();
        validate_manifest_dir(&dir, &manifest).unwrap();
        manifest.kind = Some("image".into());
        assert!(validate_manifest_dir(&dir, &manifest).is_err());
        manifest.kind = Some("poster".into());
        assert!(validate_manifest_dir(&dir, &manifest).is_err());
    }

    #[test]
    fn copy_tree_skips_metadata_and_keeps_nested_previews() {
        let base = tempfile::tempdir().unwrap();
        let src = base.path().join("src");
        let dest = base.path().join("dest");
        std::fs::create_dir_all(src.join("assets")).unwrap();
        std::fs::create_dir_all(&dest).unwrap();
        for name in [
            "template.json",
            "preview.png",
            "preview.webp",
            "SOURCE.json",
            "LICENSE",
            "main.tex",
        ] {
            std::fs::write(src.join(name), "x").unwrap();
        }
        std::fs::write(src.join("assets").join("preview.webp"), "x").unwrap();
        copy_tree(&src, &dest, 0).unwrap();
        assert!(dest.join("main.tex").is_file());
        assert!(dest.join("assets").join("preview.webp").is_file());
        for name in [
            "template.json",
            "preview.png",
            "preview.webp",
            "SOURCE.json",
            "LICENSE",
        ] {
            assert!(!dest.join(name).exists(), "{name} was copied");
        }
    }

    #[cfg(unix)]
    #[test]
    fn copy_tree_rejects_symlinks() {
        let base = tempfile::tempdir().unwrap();
        let src = base.path().join("src");
        let dest = base.path().join("dest");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(base.path().join("outside"), "secret").unwrap();
        std::os::unix::fs::symlink(base.path().join("outside"), src.join("linked")).unwrap();
        assert!(copy_tree(&src, &dest, 0).is_err());
        assert!(!dest.join("linked").exists());
    }

    #[test]
    fn copy_tree_rejects_excessive_depth_instead_of_truncating() {
        let base = tempfile::tempdir().unwrap();
        let mut nested = base.path().join("src");
        for _ in 0..=MAX_COPY_DEPTH {
            nested = nested.join("nested");
        }
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("main.tex"), "x").unwrap();
        let dest = base.path().join("dest");
        std::fs::create_dir_all(&dest).unwrap();
        assert!(copy_tree(&base.path().join("src"), &dest, 0).is_err());
    }

    #[test]
    fn first_root_wins_on_id_collision_and_webp_previews_count() {
        let base = tempfile::tempdir().unwrap();
        for (root, name) in [("a", "ieee"), ("b", "ieee"), ("b", "extra")] {
            let dir = base.path().join(root).join(name);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(
                dir.join("template.json"),
                format!(r#"{{"id":"{name}","name":"{name} from {root}"}}"#),
            )
            .unwrap();
            std::fs::write(dir.join("main.tex"), "\\documentclass{article}").unwrap();
        }
        std::fs::write(base.path().join("b/extra/preview.webp"), "RIFF").unwrap();
        let listed = list_templates_in_roots(&[
            (base.path().join("a"), "bundled"),
            (base.path().join("b"), "pack"),
        ]);
        let ieee = listed
            .iter()
            .find(|(manifest, _, _)| manifest.id == "ieee")
            .unwrap();
        assert!(ieee.0.name.contains("from a"));
        assert_eq!(ieee.2, "bundled");
        let extra = listed
            .iter()
            .find(|(manifest, _, _)| manifest.id == "extra")
            .unwrap();
        assert_eq!(extra.2, "pack");
        assert_eq!(
            preview_file(&extra.1).map(|(_, mime)| mime),
            Some("image/webp")
        );
    }

    #[test]
    fn template_engine_follows_the_app_rules() {
        assert_eq!(
            template_engine("main.typ", None, None).unwrap(),
            ("typst".into(), None)
        );
        assert_eq!(
            template_engine("notes.md", Some("pdflatex"), None).unwrap(),
            ("markdown".into(), None)
        );
        assert_eq!(
            template_engine("main.tex", None, None).unwrap(),
            ("xetex".into(), None)
        );
        assert_eq!(
            template_engine("main.tex", None, Some("latexmk")).unwrap(),
            ("latexmk".into(), None)
        );
        assert_eq!(
            template_engine("main.tex", Some("pdflatex"), None).unwrap(),
            ("latexmk".into(), Some("pdflatex".into()))
        );
        assert_eq!(
            template_engine("main.tex", Some("bogus"), None).unwrap(),
            ("xetex".into(), None)
        );
        assert!(template_engine("main.txt", None, None).is_err());
        assert_eq!(
            template_engine("paper.qmd", None, None).unwrap(),
            ("quarto".into(), None)
        );
        assert_eq!(
            template_engine("analysis.Rmd", None, None).unwrap(),
            ("quarto".into(), None)
        );
    }

    #[test]
    fn a_declared_quarto_or_calepin_engine_is_kept() {
        assert_eq!(
            declared_template_engine("calepin", "report.typ", None, None).unwrap(),
            ("calepin".into(), None)
        );
        assert_eq!(
            declared_template_engine("Quarto", "slides.qmd", None, None).unwrap(),
            ("quarto".into(), None)
        );
        assert_eq!(
            declared_template_engine("calepin", "report.tex", Some("pdflatex"), None).unwrap(),
            ("latexmk".into(), Some("pdflatex".into()))
        );
        assert_eq!(
            declared_template_engine("typst", "main.typ", None, None).unwrap(),
            ("typst".into(), None)
        );
    }

    #[test]
    fn missing_font_packs_are_the_ones_not_available() {
        let manifest: TemplateManifest = serde_json::from_value(serde_json::json!({
            "id": "cv", "name": "CV", "requires": {"fonts": ["lato", "inter"]}
        }))
        .unwrap();
        assert_eq!(
            missing_font_packs(&manifest, |pack| pack == "inter"),
            ["lato"]
        );
    }
}
