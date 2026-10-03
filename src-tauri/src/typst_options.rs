use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use oleafly_core::typst_toolchain::{TypstCapabilities, TypstCompileFlag, TypstFontFamily};
use oleafly_core::{TypstSpec, TypstVariant};
use serde::{Deserialize, Serialize};

use crate::app_error::AppError;
use crate::document_engine::{DocumentEngineId, EngineDescriptor};
use crate::proc::NoConsole;
use crate::project::ProjectMeta;

const FONT_LIST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_VARIANT_NAME_CHARS: usize = 64;
const MAX_INPUT_CHARS: usize = 4096;
const EMBEDDED_FONT: &str = "(Embedded)";

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TypstCompileSettings {
    pub font_dirs: Vec<PathBuf>,
    pub ignore_system_fonts: bool,
    pub inputs: Vec<(String, String)>,
    pub creation_timestamp: Option<u64>,
}

impl TypstCompileSettings {
    pub(crate) fn resolve(
        spec: Option<&TypstSpec>,
        project_root: &Path,
        variant: Option<&str>,
        commit_time: impl FnOnce(&Path) -> Option<u64>,
    ) -> Self {
        let reproducible = spec.is_some_and(|spec| spec.reproducible);
        Self {
            font_dirs: oleafly_core::typst_toolchain::typst_project_font_dirs(spec, project_root),
            ignore_system_fonts: spec.is_some_and(TypstSpec::ignores_system_fonts),
            inputs: spec
                .map(|spec| spec.inputs_for(variant))
                .unwrap_or_default(),
            creation_timestamp: reproducible.then(|| commit_time(project_root).unwrap_or(0)),
        }
    }

    pub(crate) fn compile_flags(&self, capabilities: &TypstCapabilities) -> Vec<TypstCompileFlag> {
        let mut flags: Vec<TypstCompileFlag> = self
            .font_dirs
            .iter()
            .cloned()
            .map(TypstCompileFlag::FontPath)
            .collect();
        if self.ignore_system_fonts {
            flags.push(TypstCompileFlag::IgnoreSystemFonts);
        }
        flags.extend(
            self.inputs
                .iter()
                .map(|(key, value)| TypstCompileFlag::Input {
                    key: key.clone(),
                    value: value.clone(),
                }),
        );
        if let Some(timestamp) = self.creation_timestamp {
            flags.push(TypstCompileFlag::CreationTimestamp(timestamp));
        }
        flags
            .into_iter()
            .filter(|flag| capabilities.supports_flag(flag.name()))
            .collect()
    }

    pub(crate) fn source_date_epoch(&self, fallback: Option<u64>) -> Option<u64> {
        self.creation_timestamp.or(fallback)
    }
}

pub(crate) fn for_compile(
    meta: &ProjectMeta,
    project_root: &Path,
    variant: Option<&str>,
) -> Option<TypstCompileSettings> {
    crate::typst_toolchain::is_typst_project(meta).then(|| {
        TypstCompileSettings::resolve(
            meta.typst.as_ref(),
            project_root,
            variant.map(str::trim).filter(|name| !name.is_empty()),
            crate::git::head_commit_time,
        )
    })
}

pub(crate) fn dependency_file(out_dir: &Path) -> PathBuf {
    out_dir.join(format!("{}.deps.json", crate::paths::ENTRY_STEM))
}

pub(crate) fn recorded_dependencies(
    build_dir: &Path,
    root: &Path,
) -> std::collections::BTreeSet<String> {
    let Ok(json) = std::fs::read_to_string(dependency_file(build_dir)) else {
        return std::collections::BTreeSet::new();
    };
    let Some(inputs) = oleafly_core::typst_toolchain::parse_typst_deps(&json) else {
        return std::collections::BTreeSet::new();
    };
    let mut recorder = format!("PWD {}\n", root.display());
    for input in inputs {
        recorder.push_str("INPUT ");
        recorder.push_str(&input);
        recorder.push('\n');
    }
    crate::checkpoint_capture::recorded_inputs(&recorder, root)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TypstOptionsDescriptor {
    pub system_fonts: bool,
    pub reproducible: bool,
    pub variants: Vec<String>,
    pub font_dirs: Vec<String>,
    pub flags: Vec<String>,
    pub output_formats: Vec<String>,
    pub pdf_standards: Vec<String>,
}

fn options_descriptor(
    spec: Option<&TypstSpec>,
    root: Option<&Path>,
    capabilities: &TypstCapabilities,
) -> TypstOptionsDescriptor {
    let font_dirs = root
        .map(|root| oleafly_core::typst_toolchain::typst_project_font_dirs(spec, root))
        .unwrap_or_default();
    TypstOptionsDescriptor {
        system_fonts: spec.is_none_or(|spec| spec.system_fonts),
        reproducible: spec.is_some_and(|spec| spec.reproducible),
        variants: spec
            .map(|spec| spec.variants.keys().cloned().collect())
            .unwrap_or_default(),
        font_dirs: font_dirs
            .iter()
            .map(|directory| {
                crate::project_availability::without_verbatim_prefix(directory)
                    .to_string_lossy()
                    .into_owned()
            })
            .collect(),
        flags: capabilities.flags.clone(),
        output_formats: capabilities.output_formats.clone(),
        pdf_standards: capabilities.pdf_standards.clone(),
    }
}

fn described_version(descriptor: &EngineDescriptor) -> String {
    descriptor
        .typst_resolved
        .as_ref()
        .map(|resolved| resolved.version.clone())
        .or_else(|| descriptor.typst_version.clone())
        .unwrap_or_else(crate::typst_toolchain::default_version)
}

pub(crate) fn describe(descriptor: &mut EngineDescriptor, project_id: &str, meta: &ProjectMeta) {
    if descriptor.id != DocumentEngineId::Typst.as_str() {
        return;
    }
    let root = crate::project_location::locate(project_id)
        .ok()
        .map(|location| location.root);
    let capabilities =
        oleafly_core::typst_toolchain::capabilities_for(&described_version(descriptor));
    descriptor.typst_options = Some(options_descriptor(
        meta.typst.as_ref(),
        root.as_deref(),
        capabilities,
    ));
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstProjectOptions {
    pub font_paths: Vec<String>,
    pub system_fonts: bool,
    pub reproducible: bool,
    pub inputs: BTreeMap<String, String>,
    pub variants: BTreeMap<String, BTreeMap<String, String>>,
}

impl TypstProjectOptions {
    fn of(spec: Option<&TypstSpec>) -> Self {
        let spec = spec.cloned().unwrap_or_default();
        Self {
            font_paths: spec.font_paths,
            system_fonts: spec.system_fonts,
            reproducible: spec.reproducible,
            inputs: spec.inputs,
            variants: spec
                .variants
                .into_iter()
                .map(|(name, variant)| (name, variant.inputs))
                .collect(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstOptionsUpdate {
    #[serde(default)]
    pub system_fonts: Option<bool>,
    #[serde(default)]
    pub reproducible: Option<bool>,
    #[serde(default)]
    pub font_paths: Option<Vec<String>>,
    #[serde(default)]
    pub inputs: Option<BTreeMap<String, String>>,
    #[serde(default)]
    pub variants: Option<BTreeMap<String, BTreeMap<String, String>>>,
}

fn invalid(code: &'static str, value: &str) -> String {
    AppError::new(code).param("value", value).into()
}

fn checked_inputs(inputs: BTreeMap<String, String>) -> Result<BTreeMap<String, String>, String> {
    inputs
        .into_iter()
        .map(|(key, value)| {
            let key = key.trim().to_owned();
            if !oleafly_core::valid_typst_input_key(&key)
                || key.chars().count() > MAX_INPUT_CHARS
                || value.chars().count() > MAX_INPUT_CHARS
            {
                return Err(invalid("typst_options.invalid_input_key", &key));
            }
            Ok((key, value))
        })
        .collect()
}

fn checked_variant_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > MAX_VARIANT_NAME_CHARS
        || trimmed.chars().any(char::is_control)
    {
        return Err(invalid("typst_options.invalid_variant_name", trimmed));
    }
    Ok(trimmed.to_owned())
}

fn checked_font_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    let relative = Path::new(trimmed);
    let inside = !trimmed.is_empty()
        && !relative.has_root()
        && relative.components().all(|component| {
            matches!(
                component,
                std::path::Component::Normal(_) | std::path::Component::CurDir
            )
        });
    if !inside {
        return Err(invalid("typst_options.invalid_font_path", trimmed));
    }
    Ok(trimmed.replace('\\', "/"))
}

impl TypstOptionsUpdate {
    pub(crate) fn apply(self, spec: &mut TypstSpec) -> Result<(), String> {
        if let Some(system_fonts) = self.system_fonts {
            spec.system_fonts = system_fonts;
        }
        if let Some(reproducible) = self.reproducible {
            spec.reproducible = reproducible;
        }
        if let Some(paths) = self.font_paths {
            let mut checked: Vec<String> = Vec::new();
            for path in paths {
                let path = checked_font_path(&path)?;
                if !checked.contains(&path) {
                    checked.push(path);
                }
            }
            spec.font_paths = checked;
        }
        if let Some(inputs) = self.inputs {
            spec.inputs = checked_inputs(inputs)?;
        }
        if let Some(variants) = self.variants {
            let mut next: BTreeMap<String, TypstVariant> = BTreeMap::new();
            for (name, inputs) in variants {
                let name = checked_variant_name(&name)?;
                if next.contains_key(&name) {
                    return Err(invalid("typst_options.invalid_variant_name", &name));
                }
                let extra = spec
                    .variants
                    .get(&name)
                    .map(|variant| variant.extra.clone())
                    .unwrap_or_default();
                next.insert(
                    name,
                    TypstVariant {
                        inputs: checked_inputs(inputs)?,
                        extra,
                    },
                );
            }
            spec.variants = next;
        }
        Ok(())
    }
}

fn typst_project_meta(project_id: &str) -> Result<ProjectMeta, String> {
    let meta =
        crate::trust::restrict_compile_meta(project_id, crate::project::read_meta(project_id)?)?;
    if !crate::typst_toolchain::is_typst_project(&meta) {
        return Err(AppError::new("typst_toolchain.not_typst_project").into());
    }
    Ok(meta)
}

#[tauri::command]
pub async fn typst_project_options(project_id: String) -> Result<TypstProjectOptions, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(TypstProjectOptions::of(
            typst_project_meta(&project_id)?.typst.as_ref(),
        ))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn set_typst_project_options(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    update: TypstOptionsUpdate,
) -> Result<ProjectMeta, String> {
    let _guard = state.compile_lock.lock().await;
    let owned = project_id.clone();
    let meta = tauri::async_runtime::spawn_blocking(move || {
        crate::project::update_project_typst_spec_unlocked(&owned, |spec| update.apply(spec))
    })
    .await
    .map_err(|error| error.to_string())??;
    let _ = crate::project::publish_project_state_changed(
        &app,
        &state,
        &project_id,
        meta.clone(),
        "engine-changed",
        false,
        crate::project::project_mutation_generation(project_id.clone()).ok(),
    );
    Ok(meta)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstFontSource {
    pub kind: &'static str,
    pub path: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstFontEntry {
    pub name: String,
    pub sources: Vec<TypstFontSource>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstFontList {
    pub version: String,
    pub sources_listed: bool,
    pub system_fonts: bool,
    pub families: Vec<TypstFontEntry>,
}

fn comparable(path: &Path) -> PathBuf {
    crate::project_availability::without_verbatim_prefix(path)
}

fn classify_source(source: &str, root: &Path, font_dirs: &[PathBuf]) -> TypstFontSource {
    if source == EMBEDDED_FONT {
        return TypstFontSource {
            kind: "embedded",
            path: None,
        };
    }
    let path = Path::new(source);
    let canonical = path
        .canonicalize()
        .map_or_else(|_| comparable(path), |path| comparable(&path));
    let root = comparable(root);
    if font_dirs
        .iter()
        .any(|directory| canonical.starts_with(comparable(directory)))
    {
        let relative = canonical
            .strip_prefix(&root)
            .map(|relative| relative.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| source.to_owned());
        return TypstFontSource {
            kind: "project",
            path: Some(relative),
        };
    }
    TypstFontSource {
        kind: "system",
        path: Some(source.to_owned()),
    }
}

pub(crate) fn font_entries(
    families: Vec<TypstFontFamily>,
    root: &Path,
    font_dirs: &[PathBuf],
) -> Vec<TypstFontEntry> {
    families
        .into_iter()
        .map(|family| TypstFontEntry {
            sources: family
                .sources
                .iter()
                .map(|source| classify_source(source, root, font_dirs))
                .collect(),
            name: family.name,
        })
        .collect()
}

fn first_line(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default()
        .to_owned()
}

fn font_list_settings(meta: &ProjectMeta, root: &Path) -> TypstCompileSettings {
    let spec = crate::typst_toolchain::is_typst_project(meta)
        .then_some(meta.typst.as_ref())
        .flatten();
    TypstCompileSettings::resolve(spec, root, None, |_| None)
}

fn list_fonts_blocking(project_id: &str) -> Result<TypstFontList, String> {
    let meta =
        crate::trust::restrict_compile_meta(project_id, crate::project::read_meta(project_id)?)?;
    let root = crate::project_location::locate(project_id)?.root;
    let typst = match crate::typst_toolchain::resolve_for_compile(&meta)? {
        Some(typst) => typst,
        None => std::sync::Arc::new(crate::typst_toolchain::snippet_typst(None)?),
    };
    let settings = font_list_settings(&meta, &root);
    let arguments = oleafly_core::typst_toolchain::typst_fonts_args(
        &typst.capabilities,
        &typst.version,
        &settings.font_dirs,
        settings.ignore_system_fonts,
    );
    let mut command = std::process::Command::new(&typst.path);
    command.no_console().args(arguments).current_dir(&root);
    let output = crate::proc::output_contained_with_timeout(command, FONT_LIST_TIMEOUT).map_err(
        |error| {
            if error.kind() == std::io::ErrorKind::TimedOut {
                String::from(AppError::new("typst_options.fonts_timeout"))
            } else {
                AppError::new("typst_options.fonts_failed")
                    .detail(error)
                    .into()
            }
        },
    )?;
    if !output.status.success() {
        return Err(AppError::new("typst_options.fonts_failed")
            .detail(first_line(&output.stderr))
            .into());
    }
    let families =
        oleafly_core::typst_toolchain::parse_typst_fonts(&String::from_utf8_lossy(&output.stdout));
    let version = &typst.version;
    Ok(TypstFontList {
        sources_listed: (version.major, version.minor)
            >= oleafly_core::typst_toolchain::TYPST_FONT_SOURCES_SINCE,
        version: version.to_string(),
        system_fonts: !settings.ignore_system_fonts
            || !typst.capabilities.supports_flag("--ignore-system-fonts"),
        families: font_entries(families, &root, &settings.font_dirs),
    })
}

#[tauri::command]
pub async fn typst_project_fonts(project_id: String) -> Result<TypstFontList, String> {
    tauri::async_runtime::spawn_blocking(move || list_fonts_blocking(&project_id))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests;
