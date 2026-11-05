use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use oleafly_core::engine_spec::EngineFlags;
use oleafly_core::tex_distro::{find_tool_in_dir, latexmk_needs_perl, TexSearch};
use oleafly_core::tex_outputs::source_head;
use oleafly_core::typst_toolchain::{
    bundled_typst_version, typst_version_of, TYPST_VERSION_TIMEOUT,
};
use oleafly_core::{
    compile_dir_for, source_tex_flavor, tex_program_flavor, BuildLocation, Engine,
    ErrorKind as CoreKind, ProjectManifest, TexFlavor, Workspace,
};

use crate::commands::common::{appimage_engines_note, engine_install_hint, tectonic_fallback};
use crate::contract::{CliError, ErrorKind, Warning};
use crate::desktop_link::{self, LinkInfo};
use crate::native::{BuildTools, Discovery, NativeCompiler};
use crate::typst::{resolve_pinned, TypstInventory};
use crate::typst_settings::{chosen_variant, unsupported_settings, SettingsRequest, TypstSettings};

pub use crate::native::{BuildError, BuildResult, CompilerLog};

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Clone, Default)]
pub struct BuildRequest {
    pub flags: EngineFlags,
    pub timeout: Duration,
    pub variant: Option<String>,
    pub main: Option<String>,
    pub compiler: Option<TexFlavor>,
    pub output: Option<PathBuf>,
    pub log: CompilerLog,
    pub on_lock_wait: Option<Arc<dyn Fn() + Send + Sync>>,
}

impl BuildRequest {
    fn timeout(&self) -> Duration {
        if self.timeout.is_zero() {
            DEFAULT_TIMEOUT
        } else {
            self.timeout
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProjectOrigin {
    Manifest,
    Detected,
    Linked { id: String },
}

impl ProjectOrigin {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Manifest => "manifest",
            Self::Detected => "detected",
            Self::Linked { .. } => "linked",
        }
    }
}

#[derive(Clone, Debug)]
pub struct OpenedProject {
    pub workspace: Workspace,
    pub origin: ProjectOrigin,
    pub warnings: Vec<Warning>,
}

fn invalid(message: impl Into<String>) -> CliError {
    CliError::new(ErrorKind::InvalidInput, "project.invalid_input", message)
}

fn unsafe_folder(message: impl Into<String>) -> CliError {
    CliError::new(ErrorKind::UnsafePath, "project.unsafe_path", message)
}

pub(crate) fn linked_build_dir(link: &LinkInfo) -> Result<PathBuf, CliError> {
    let metadata = std::fs::symlink_metadata(&link.state_dir).map_err(CliError::from)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(unsafe_folder(
            "The app's folder for this project isn't a real folder.",
        ));
    }
    let state = link.state_dir.canonicalize().map_err(CliError::from)?;
    let linked = link
        .state_dir
        .parent()
        .ok_or_else(|| unsafe_folder("The app's folder for this project has no parent."))?
        .canonicalize()
        .map_err(CliError::from)?;
    if state.parent() != Some(linked.as_path())
        || state.file_name().and_then(|name| name.to_str()) != Some(link.id.as_str())
    {
        return Err(unsafe_folder(
            "The app's folder for this project is in the wrong place.",
        ));
    }
    let build = state.join("build");
    match std::fs::symlink_metadata(&build) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => {
            return Err(unsafe_folder(
                "The app's build folder for this project isn't a real folder.",
            ))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(&build).map_err(CliError::from)?;
        }
        Err(error) => return Err(CliError::from(error)),
    }
    Ok(build)
}

fn folder_name(root: &Path) -> String {
    root.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn manifest_from_sidecar(
    root: &Path,
    saved: &desktop_link::SavedProject,
    link: &LinkInfo,
) -> Result<ProjectManifest, CliError> {
    let saved_main = saved.main_doc.clone().filter(|main| {
        oleafly_core::resolve_project_path(root, main).is_ok_and(|path| path.is_file())
    });
    let main = match saved_main {
        Some(main) => main,
        None => Workspace::detected(root, None)?.manifest().main_doc.clone(),
    };
    let engine = saved
        .engine
        .as_deref()
        .and_then(|engine| Engine::from_manifest(engine, &main).ok())
        .map_or_else(|| Engine::infer(&main), Ok)?;
    let tex_flavor = (engine == Engine::Latexmk)
        .then(|| {
            saved
                .tex_flavor
                .clone()
                .filter(|flavor| TexFlavor::parse(flavor).is_some())
        })
        .flatten();
    let compile_dir = link
        .compile_dir
        .clone()
        .filter(|directory| Path::new(&main).starts_with(directory))
        .or_else(|| compile_dir_for(root, &main));
    Ok(ProjectManifest {
        name: link
            .display_name
            .clone()
            .or_else(|| saved.name.clone())
            .unwrap_or_else(|| folder_name(root)),
        main_doc: main,
        engine: engine.manifest_name().to_string(),
        tex_flavor,
        typst: saved.typst.clone(),
        compile_dir,
        ..ProjectManifest::default()
    })
}

pub(crate) fn with_linked_build(workspace: Workspace) -> Result<Workspace, CliError> {
    let Some(link) = desktop_link::link_for(workspace.root()) else {
        return Ok(workspace);
    };
    Ok(Workspace::from_manifest_with_build(
        workspace.root(),
        workspace.manifest().clone(),
        BuildLocation::External(linked_build_dir(&link)?),
    )?)
}

fn opened_without_overrides(path: &Path, main: Option<&str>) -> Result<OpenedProject, CliError> {
    match Workspace::open(path) {
        Ok(workspace) => match desktop_link::link_for(workspace.root()) {
            Some(link) => {
                let build = linked_build_dir(&link)?;
                let workspace = Workspace::from_manifest_with_build(
                    workspace.root(),
                    workspace.manifest().clone(),
                    BuildLocation::External(build),
                )?;
                Ok(OpenedProject {
                    workspace,
                    origin: ProjectOrigin::Linked { id: link.id },
                    warnings: Vec::new(),
                })
            }
            None => Ok(OpenedProject {
                workspace,
                origin: ProjectOrigin::Manifest,
                warnings: Vec::new(),
            }),
        },
        Err(error) if error.kind() == CoreKind::NotInitialized => {
            let saved = desktop_link::saved_project(path);
            if let Some(link) = saved.link.clone() {
                let root = path.canonicalize().map_err(CliError::from)?;
                let manifest = manifest_from_sidecar(&root, &saved, &link)?;
                let build = linked_build_dir(&link)?;
                let workspace = Workspace::from_manifest_with_build(
                    &root,
                    manifest,
                    BuildLocation::External(build),
                )?;
                return Ok(OpenedProject {
                    workspace,
                    origin: ProjectOrigin::Linked { id: link.id },
                    warnings: Vec::new(),
                });
            }
            let workspace = Workspace::detected(path, main)?;
            let warnings = if main.is_some() {
                Vec::new()
            } else {
                vec![Warning::new(
                    "build.detected_main",
                    format!(
                        "No Oleafly project.json here, so Oleafly picked {}.",
                        workspace.manifest().main_doc
                    ),
                )]
            };
            Ok(OpenedProject {
                workspace,
                origin: ProjectOrigin::Detected,
                warnings,
            })
        }
        Err(error) => Err(error.into()),
    }
}

fn extensions_for(engine: Engine) -> &'static str {
    match engine {
        Engine::Tectonic | Engine::Latexmk => ".tex",
        Engine::Typst => ".typ",
        Engine::Markdown => ".md",
        Engine::Quarto => ".qmd",
        Engine::Calepin => ".typ",
    }
}

pub fn open_project(
    path: &Path,
    main: Option<&str>,
    compiler: Option<TexFlavor>,
) -> Result<OpenedProject, CliError> {
    let opened = open_project_unchecked(path, main, compiler)?;
    // Results carry these paths as JSON text, which has no way to hold bytes
    // that aren't UTF-8; a command would panic with its work done.
    for folder in [opened.workspace.root(), &opened.workspace.build_dir_path()] {
        if folder.to_str().is_none() {
            return Err(invalid(format!(
                "The folder {} has a name that isn't valid UTF-8, so Oleafly can't report on it. Rename it, or open the project from another path.",
                folder.display()
            )));
        }
    }
    Ok(opened)
}

fn tex_engine_choice(
    source: &str,
    compiler: Option<TexFlavor>,
    default_is_latexmk: bool,
    latexmk_can_run: impl FnOnce(TexFlavor) -> bool,
) -> (Engine, Option<Warning>) {
    if compiler.is_some() || default_is_latexmk {
        return (Engine::Latexmk, None);
    }
    let source = source.strip_prefix('\u{feff}').unwrap_or(source);
    let wanted = tex_program_flavor(source)
        .or_else(|| source_tex_flavor(source).filter(|flavor| flavor.goes_through_dvi()));
    match wanted {
        None | Some(TexFlavor::Xelatex) => (Engine::Tectonic, None),
        Some(flavor) if flavor.goes_through_dvi() || latexmk_can_run(flavor) => {
            (Engine::Latexmk, None)
        }
        Some(flavor) => (
            Engine::Tectonic,
            Some(Warning::new(
                "build.detected_engine",
                format!(
                    "This document asks for {}, which latexmk can't run on this machine, so Oleafly builds it with the built-in engine.",
                    flavor.as_str()
                ),
            )),
        ),
    }
}

fn latexmk_runs_flavor(tools: &BuildTools, search: &TexSearch, flavor: TexFlavor) -> bool {
    tools.latexmk.as_deref().is_some_and(|latexmk| {
        !latexmk_needs_perl(search, latexmk)
            && latexmk
                .parent()
                .into_iter()
                .chain(tools.tex_dirs.iter().map(PathBuf::as_path))
                .any(|dir| find_tool_in_dir(dir, flavor.as_str()).is_some())
    })
}

fn bare_folder_engine(
    root: &Path,
    main: &str,
    compiler: Option<TexFlavor>,
) -> (Engine, Option<Warning>) {
    let default_is_latexmk = crate::app_paths::data_root()
        .as_deref()
        .and_then(crate::app_config::latex_default_engine)
        .is_some();
    let source = source_head(&root.join(main)).unwrap_or_default();
    tex_engine_choice(&source, compiler, default_is_latexmk, |flavor| {
        let discovery = Discovery::from_env(root);
        latexmk_runs_flavor(
            &BuildTools::discover_with(&discovery),
            &discovery.tex,
            flavor,
        )
    })
}

fn open_project_unchecked(
    path: &Path,
    main: Option<&str>,
    compiler: Option<TexFlavor>,
) -> Result<OpenedProject, CliError> {
    // `.\chapters\a.tex`, as a Windows shell completes it.
    let main = main.map(crate::contract::project_path_arg);
    let main = main.as_deref();
    if let Some(main) = main {
        let relative = Path::new(main);
        if main.chars().any(char::is_control)
            || main.contains('\\')
            || relative.is_absolute()
            || relative
                .components()
                .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
        {
            return Err(unsafe_folder(format!(
                "{main} isn't a path inside the project."
            )));
        }
    }
    let mut opened = opened_without_overrides(path, main)?;
    let bare_folder = opened.origin == ProjectOrigin::Detected;
    if main.is_none() && compiler.is_none() && !bare_folder {
        return Ok(opened);
    }
    let workspace = &opened.workspace;
    let root = workspace.root().to_path_buf();
    let mut manifest = workspace.manifest().clone();
    if let Some(main) = main {
        let file = oleafly_core::resolve_project_path(&root, main)
            .map_err(|_| unsafe_folder(format!("{main} isn't a path inside the project.")))?;
        if !file.is_file() {
            return Err(invalid(format!("{main} doesn't exist in this project.")));
        }
        let main = main.trim_start_matches("./").to_string();
        let engine = workspace.manifest().engine()?;
        let engine = match opened.origin {
            ProjectOrigin::Detected => Engine::infer(&main)?,
            _ if engine.accepts(&main) => engine,
            _ => {
                return Err(invalid(format!(
                    "This project's engine ({}) can't build {main}. Pick a {} file.",
                    engine.canonical_name(),
                    extensions_for(engine)
                )))
            }
        };
        manifest.engine = engine.manifest_name().to_string();
        manifest.compile_dir = compile_dir_for(&root, &main);
        manifest.main_doc = main;
        if engine != Engine::Latexmk {
            manifest.tex_flavor = None;
        }
    }
    if bare_folder && manifest.engine().ok() == Some(Engine::Tectonic) {
        let (engine, warning) = bare_folder_engine(&root, &manifest.main_doc, compiler);
        manifest.engine = engine.manifest_name().to_string();
        opened.warnings.extend(warning);
    }
    if let Some(flavor) = compiler {
        if manifest.engine().ok() == Some(Engine::Latexmk) {
            manifest.tex_flavor = Some(flavor.as_str().to_string());
        } else {
            opened.warnings.push(Warning::new(
                "build.flag_ignored",
                format!(
                    "--compiler {} is ignored: only latexmk projects pick a LaTeX compiler.",
                    flavor.as_str()
                ),
            ));
        }
    }
    let location = workspace.build_location().clone();
    opened.workspace = Workspace::from_manifest_with_build(&root, manifest, location)?;
    Ok(opened)
}

pub(crate) fn is_typst_workspace(workspace: &Workspace) -> bool {
    matches!(workspace.manifest().engine(), Ok(Engine::Typst))
}

pub(crate) fn typst_project_pin(workspace: &Workspace) -> Option<&str> {
    match workspace.manifest().engine() {
        Ok(Engine::Typst) => workspace.manifest().typst_version_pin(),
        _ => None,
    }
}

fn wanted_typst(workspace: &Workspace, discovery: &Discovery) -> Option<(String, bool)> {
    if let Some(pin) = typst_project_pin(workspace) {
        return Some((pin.to_string(), true));
    }
    if !is_typst_workspace(workspace) || discovery.overrides.contains_key("OLEAFLY_TYPST") {
        return None;
    }
    let default = crate::app_config::typst_default_choice(discovery.data_root.as_deref()?)?;
    (default != bundled_typst_version().to_string()).then_some((default, false))
}

pub(crate) fn build_tools(
    workspace: &Workspace,
    discovery: &Discovery,
    inventory: Option<&TypstInventory>,
) -> BuildTools {
    let mut tools = BuildTools::discover_with(discovery);
    if matches!(workspace.manifest().engine(), Ok(Engine::Markdown)) {
        tools.resolve_pandoc(discovery);
    }
    if !is_typst_workspace(workspace) {
        return tools;
    }
    let discovered;
    let inventory = match inventory {
        Some(inventory) => Some(inventory),
        None if wanted_typst(workspace, discovery).is_some() => {
            discovered = TypstInventory::discover_with(discovery);
            Some(&discovered)
        }
        None => None,
    };
    match wanted_typst(workspace, discovery) {
        Some((version, true)) => {
            tools.use_pinned_typst(resolve_pinned(&version, inventory.expect("inventory")))
        }
        Some((version, false)) => {
            let resolved = resolve_pinned(&version, inventory.expect("inventory")).map_err(|_| {
                format!(
                    "Oleafly's default Typst version is {version}, but it isn't installed. Run `oleafly typst install {version}`, or `oleafly typst default --unset`."
                )
            });
            tools.use_pinned_typst(resolved);
        }
        None => {
            if let Some(path) = tools.typst.clone() {
                let version = match inventory {
                    Some(inventory) => inventory.version_of(&path),
                    None => typst_version_of(&path, TYPST_VERSION_TIMEOUT),
                };
                tools.use_typst_version(version);
            }
        }
    }
    tools
}

pub(crate) const TYPST_SETTING_UNSUPPORTED: &str = "typst.setting_unsupported";

pub(crate) fn unapplied_settings(workspace: &Workspace, tools: &BuildTools) -> Vec<String> {
    if !is_typst_workspace(workspace) || tools.typst.is_none() {
        return Vec::new();
    }
    unsupported_settings(
        workspace.manifest().typst.as_ref(),
        tools.typst_capabilities(),
        &tools.typst_version_label(),
    )
}

pub(crate) fn typst_variant(
    workspace: &Workspace,
    variant: Option<&str>,
) -> Result<Option<String>, CliError> {
    if !is_typst_workspace(workspace) {
        return Ok(None);
    }
    Ok(chosen_variant(
        workspace.manifest().typst.as_ref(),
        variant,
    )?)
}

pub(crate) async fn typst_settings(
    workspace: &Workspace,
    variant: Option<&str>,
    offline: bool,
    data_root: Option<&Path>,
) -> Result<TypstSettings, CliError> {
    if !is_typst_workspace(workspace) {
        return Ok(TypstSettings::default());
    }
    let spec = workspace.manifest().typst.as_ref();
    let variant = chosen_variant(spec, variant)?;
    let commit_time = if spec.is_some_and(|spec| spec.reproducible) {
        crate::typst_settings::head_commit_time(workspace.root()).await
    } else {
        None
    };
    Ok(TypstSettings::resolve(&SettingsRequest {
        spec,
        project_root: workspace.root(),
        data_root,
        variant: variant.as_deref(),
        offline,
        commit_time,
    })
    .with_system_font_mirror(data_root))
}

pub(crate) fn output_destination(
    requested: &Path,
    main_document: &str,
) -> Result<PathBuf, CliError> {
    if requested.is_dir() {
        let stem = Path::new(main_document)
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_else(|| "output".into());
        return Ok(requested.join(format!("{stem}.pdf")));
    }
    let is_pdf = requested
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"));
    if !is_pdf {
        return Err(CliError::usage(format!(
            "-o needs a folder or a .pdf file, not {}.",
            requested.display()
        )));
    }
    let parent = requested
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(CliError::usage(format!(
            "The folder {} doesn't exist.",
            parent.display()
        )));
    }
    Ok(requested.to_path_buf())
}

fn missing_tool_hint(
    opened: &OpenedProject,
    tools: &BuildTools,
    compiler_flag: bool,
    appimage: Option<&Path>,
) -> Option<String> {
    let engine = opened.workspace.manifest().engine().ok()?;
    let (name, _) = tools
        .required_for_engine(engine)
        .into_iter()
        .find(|(_, path)| path.is_none())?;
    let explained = tools.rejected_override(name).is_some()
        || (name == "typst" && tools.typst_pin_error().is_some())
        || (name == "pandoc" && tools.pandoc_too_old_message().is_some());
    if explained {
        return None;
    }
    let fallback = tectonic_fallback(&opened.origin, compiler_flag);
    let hint = engine_install_hint(name, tools, Some(fallback))?;
    Some(match appimage.filter(|_| name != "latexmk") {
        Some(appimage) => format!("{} {hint}", appimage_engines_note(appimage)),
        None => hint,
    })
}

pub async fn build_project(path: &Path, request: &BuildRequest) -> Result<BuildResult, CliError> {
    let opened = open_project(path, request.main.as_deref(), request.compiler)?;
    build_opened(&opened, request).await
}

pub async fn build_opened(
    opened: &OpenedProject,
    request: &BuildRequest,
) -> Result<BuildResult, CliError> {
    let workspace = &opened.workspace;
    typst_variant(workspace, request.variant.as_deref())?;
    let destination = match &request.output {
        Some(output) => Some(output_destination(output, &workspace.manifest().main_doc)?),
        None => None,
    };
    let discovery = Discovery::from_env(workspace.root());
    let tools = build_tools(workspace, &discovery, None);
    let unapplied = unapplied_settings(workspace, &tools);
    let settings = typst_settings(
        workspace,
        request.variant.as_deref(),
        request.flags.offline,
        discovery.data_root.as_deref(),
    )
    .await?;
    let missing_hint = missing_tool_hint(
        opened,
        &tools,
        request.compiler.is_some(),
        crate::app_paths::recorded_appimage().as_deref(),
    );
    let compiler = NativeCompiler::new(tools)
        .with_typst_settings(settings)
        .with_log(request.log.clone())
        .with_timeout(request.timeout())
        .with_lock_wait(request.on_lock_wait.clone());
    let mut result = compiler
        .build(workspace, request.flags)
        .await
        .map_err(|error| match missing_hint {
            Some(hint) if error.kind == ErrorKind::MissingTool => error.hint(hint),
            _ => error,
        })?;
    result.warnings.splice(
        0..0,
        unapplied
            .into_iter()
            .map(|message| Warning::new(TYPST_SETTING_UNSUPPORTED, message)),
    );
    let tex_warnings: Vec<Warning> = result
        .errors
        .iter()
        .filter_map(crate::native::BuildError::tex_warning)
        .collect();
    result.warnings.extend(tex_warnings);
    let record = crate::record::BuildRecord {
        schema_version: crate::record::RECORD_SCHEMA,
        version: crate::version::APP_VERSION.to_string(),
        engine: result.engine,
        main_document: result.main_document.clone(),
        ok: result.ok,
        finished_at_ms: crate::record::now_ms(),
        compile_time_ms: result.compile_time_ms,
        output_id: result.output_id.clone(),
        errors: result.errors.clone(),
        diagnostics: result.diagnostics.clone(),
    };
    match crate::record::write_record(&result.build_directory, &record, &result.log) {
        Ok(()) => result.log_path = Some(result.build_directory.join(crate::record::LOG_FILE)),
        Err(error) => result.warnings.push(Warning::new(
            "build.record_failed",
            format!("Oleafly couldn't save this build's record for `oleafly log`: {error}"),
        )),
    }
    if let (Some(destination), Some(pdf)) = (destination, result.output.clone()) {
        if result.ok {
            oleafly_core::atomic::copy_atomic(&pdf, &destination)
                .map_err(crate::native::output_locked_or)?;
            result.copied_to = Some(destination);
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(data: &Path, id: &str, folder: &Path, compile_dir: Option<&str>) -> PathBuf {
        let state = data.join("linked").join(id);
        std::fs::create_dir_all(&state).unwrap();
        let mut record = serde_json::json!({"version": 1, "id": id, "canonical_path": folder.canonicalize().unwrap()});
        if let Some(compile_dir) = compile_dir {
            record["compile_dir"] = compile_dir.into();
        }
        std::fs::write(state.join("link.json"), record.to_string()).unwrap();
        state
    }

    struct DataDir {
        _guard: std::sync::MutexGuard<'static, ()>,
        previous: Option<std::ffi::OsString>,
    }

    impl Drop for DataDir {
        fn drop(&mut self) {
            match self.previous.take() {
                Some(value) => std::env::set_var("OLEAFLY_DATA_DIR", value),
                None => std::env::remove_var("OLEAFLY_DATA_DIR"),
            }
        }
    }

    fn data_dir(path: &Path) -> DataDir {
        static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let guard = LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let previous = std::env::var_os("OLEAFLY_DATA_DIR");
        std::env::set_var("OLEAFLY_DATA_DIR", path);
        DataDir {
            _guard: guard,
            previous,
        }
    }

    fn config(data: &Path, text: &str) {
        std::fs::write(crate::app_config::config_path(data), text).unwrap();
    }

    fn opened_engine(folder: &Path, compiler: Option<TexFlavor>) -> OpenedProject {
        open_project(folder, None, compiler).unwrap()
    }

    fn flagged(opened: &OpenedProject) -> bool {
        opened
            .warnings
            .iter()
            .any(|warning| warning.code == "build.flag_ignored")
    }

    #[test]
    fn a_compiler_flag_turns_a_bare_folder_into_a_latexmk_build() {
        let data = tempfile::tempdir().unwrap();
        let _env = data_dir(data.path());
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("main.tex"), "\\documentclass{article}").unwrap();
        let opened = opened_engine(folder.path(), Some(TexFlavor::Pdflatex));
        let manifest = opened.workspace.manifest();
        assert_eq!(manifest.engine().unwrap(), Engine::Latexmk);
        assert_eq!(manifest.tex_flavor.as_deref(), Some("pdflatex"));
        assert_eq!(opened.origin, ProjectOrigin::Detected);
        assert!(!flagged(&opened), "{:?}", opened.warnings);

        let plain = opened_engine(folder.path(), None);
        assert_eq!(
            plain.workspace.manifest().engine().unwrap(),
            Engine::Tectonic
        );
        assert!(plain
            .warnings
            .iter()
            .any(|warning| warning.code == "build.detected_main"));
    }

    #[test]
    fn a_compiler_flag_still_warns_where_it_cannot_apply() {
        let data = tempfile::tempdir().unwrap();
        let _env = data_dir(data.path());
        let typst = tempfile::tempdir().unwrap();
        std::fs::write(typst.path().join("main.typ"), "= Paper\n").unwrap();
        let opened = opened_engine(typst.path(), Some(TexFlavor::Xelatex));
        assert_eq!(opened.workspace.manifest().engine().unwrap(), Engine::Typst);
        assert!(flagged(&opened), "{:?}", opened.warnings);

        let tectonic = tempfile::tempdir().unwrap();
        std::fs::write(tectonic.path().join("main.tex"), "\\documentclass{article}").unwrap();
        Workspace::init(
            tectonic.path(),
            oleafly_core::InitOptions {
                main_document: Some("main.tex".into()),
                engine: Some(Engine::Tectonic),
                ..Default::default()
            },
        )
        .unwrap();
        let opened = opened_engine(tectonic.path(), Some(TexFlavor::Pdflatex));
        assert_eq!(
            opened.workspace.manifest().engine().unwrap(),
            Engine::Tectonic
        );
        assert!(flagged(&opened), "{:?}", opened.warnings);
    }

    #[test]
    fn a_bare_folder_follows_the_default_latex_engine() {
        let data = tempfile::tempdir().unwrap();
        let _env = data_dir(data.path());
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("main.tex"), "\\documentclass{article}").unwrap();
        config(data.path(), r#"{"latex_default_engine":"latexmk"}"#);
        assert_eq!(
            opened_engine(folder.path(), None)
                .workspace
                .manifest()
                .engine()
                .unwrap(),
            Engine::Latexmk
        );
        config(data.path(), r#"{"latex_default_engine":"tectonic"}"#);
        assert_eq!(
            opened_engine(folder.path(), None)
                .workspace
                .manifest()
                .engine()
                .unwrap(),
            Engine::Tectonic
        );
    }

    #[test]
    fn a_bare_folder_follows_a_program_comment() {
        let data = tempfile::tempdir().unwrap();
        let _env = data_dir(data.path());
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(
            folder.path().join("main.tex"),
            "\u{feff}% !TEX program = uplatex\n\\documentclass{ujarticle}\n",
        )
        .unwrap();
        assert_eq!(
            opened_engine(folder.path(), None)
                .workspace
                .manifest()
                .engine()
                .unwrap(),
            Engine::Latexmk
        );
    }

    #[test]
    fn tex_engine_choices_for_bare_folders() {
        let never = |_: TexFlavor| -> bool { panic!("latexmk should not be looked up here") };
        let plain = "\\documentclass{article}\n\\begin{document}x\\end{document}\n";
        let choose = |source, found| tex_engine_choice(source, None, false, |_| found);

        assert_eq!(
            tex_engine_choice(plain, None, false, never).0,
            Engine::Tectonic
        );
        assert_eq!(
            tex_engine_choice(plain, Some(TexFlavor::Lualatex), false, never).0,
            Engine::Latexmk
        );
        assert_eq!(
            tex_engine_choice(plain, None, true, never).0,
            Engine::Latexmk
        );
        assert_eq!(
            tex_engine_choice("% !TEX program = xelatex\n", None, false, never).0,
            Engine::Tectonic
        );
        assert_eq!(
            tex_engine_choice("% !TEX program = platex\n", None, false, never).0,
            Engine::Latexmk
        );
        assert_eq!(
            tex_engine_choice("\\documentclass{ujarticle}\n", None, false, never).0,
            Engine::Latexmk
        );

        let (engine, warning) = choose("% !TEX program = lualatex\n", true);
        assert_eq!(engine, Engine::Latexmk);
        assert!(warning.is_none());
        let (engine, warning) = choose("% !TEX program = pdflatex\n", false);
        assert_eq!(engine, Engine::Tectonic);
        let warning = warning.expect("a document whose compiler can't be honoured says so");
        assert_eq!(warning.code, "build.detected_engine");
        assert!(warning.message.contains("pdflatex"), "{}", warning.message);
    }

    #[test]
    fn the_compiler_a_comment_names_decides_the_engine() {
        let asked = std::cell::Cell::new(None);
        let (engine, warning) =
            tex_engine_choice("% !TEX program = lualatex\n", None, false, |flavor| {
                asked.set(Some(flavor));
                false
            });
        assert_eq!(asked.get(), Some(TexFlavor::Lualatex));
        assert_eq!(engine, Engine::Tectonic);
        assert!(warning.is_some());
    }

    fn tex_bin(folder: &Path, name: &str, tools: &[&str]) -> PathBuf {
        let bin = folder.join(name);
        std::fs::create_dir_all(&bin).unwrap();
        for tool in tools {
            let tool = bin.join(crate::native::executable_name(tool));
            std::fs::write(&tool, "").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
        }
        bin
    }

    #[test]
    fn latexmk_counts_only_when_it_can_reach_the_compiler() {
        let folder = tempfile::tempdir().unwrap();
        let bin = tex_bin(folder.path(), "bin", &["latexmk", "pdflatex"]);
        let latexmk = bin.join(crate::native::executable_name("latexmk"));
        let search = TexSearch::default();
        let tools = |latexmk: Option<&Path>, tex_dirs: Vec<PathBuf>| {
            let mut tools = BuildTools::default();
            tools.latexmk = latexmk.map(Path::to_path_buf);
            tools.tex_dirs = tex_dirs;
            tools
        };

        let beside = tools(Some(&latexmk), Vec::new());
        assert!(latexmk_runs_flavor(&beside, &search, TexFlavor::Pdflatex));
        assert!(!latexmk_runs_flavor(&beside, &search, TexFlavor::Lualatex));
        assert!(!latexmk_runs_flavor(
            &tools(None, vec![bin.clone()]),
            &search,
            TexFlavor::Pdflatex
        ));

        let elsewhere = tex_bin(folder.path(), "other", &["lualatex"]);
        assert!(latexmk_runs_flavor(
            &tools(Some(&latexmk), vec![elsewhere]),
            &search,
            TexFlavor::Lualatex
        ));
    }

    #[test]
    fn a_miktex_latexmk_with_no_perl_does_not_count() {
        let folder = tempfile::tempdir().unwrap();
        let bin = tex_bin(folder.path(), "miktex/bin", &["latexmk", "pdflatex"]);
        let latexmk = bin.join(crate::native::executable_name("latexmk"));
        let mut tools = BuildTools::default();
        tools.latexmk = Some(latexmk);
        let no_perl = TexSearch::default();
        assert!(!latexmk_runs_flavor(&tools, &no_perl, TexFlavor::Pdflatex));

        let perl_dir = tex_bin(folder.path(), "perl", &["perl"]);
        let with_perl = TexSearch {
            path: Some(perl_dir.into_os_string()),
            ..TexSearch::default()
        };
        assert!(latexmk_runs_flavor(&tools, &with_perl, TexFlavor::Pdflatex));
    }

    fn hint_for(opened: &OpenedProject, tools: &BuildTools) -> Option<String> {
        missing_tool_hint(opened, tools, false, None)
    }

    fn latexmk_project(folder: &Path) -> OpenedProject {
        std::fs::write(folder.join("main.tex"), "\\documentclass{article}").unwrap();
        Workspace::init(
            folder,
            oleafly_core::InitOptions {
                main_document: Some("main.tex".into()),
                engine: Some(Engine::Latexmk),
                ..Default::default()
            },
        )
        .unwrap();
        open_project(folder, None, None).unwrap()
    }

    #[test]
    fn a_missing_latexmk_gets_a_hint_that_fits_the_machine() {
        let data = tempfile::tempdir().unwrap();
        let _env = data_dir(data.path());
        let folder = tempfile::tempdir().unwrap();
        let opened = latexmk_project(folder.path());

        let discovery = Discovery {
            app: Some(crate::app_paths::InstalledApp {
                executable: folder.path().join("oleafly"),
                bin_dir: folder.path().to_path_buf(),
                resources_dir: None,
            }),
            ..Discovery::default()
        };
        let mut tools = BuildTools::discover_with(&discovery);
        let hint = hint_for(&opened, &tools).unwrap();
        assert!(hint.contains("Manage TeX distributions"), "{hint}");
        assert!(!hint.contains("config set engine"), "{hint}");

        tools.tectonic = Some(folder.path().join("tectonic"));
        let hint = hint_for(&opened, &tools).unwrap();
        assert!(
            hint.ends_with("`oleafly config set engine tectonic`."),
            "{hint}"
        );

        let standalone = BuildTools::discover_with(&Discovery::default());
        let hint = hint_for(&opened, &standalone).unwrap();
        assert!(!hint.contains("Manage TeX distributions"), "{hint}");
    }

    #[test]
    fn no_install_hint_when_the_tool_has_its_own_explanation_or_is_found() {
        let data = tempfile::tempdir().unwrap();
        let _env = data_dir(data.path());
        let folder = tempfile::tempdir().unwrap();
        let opened = latexmk_project(folder.path());
        let mut found = BuildTools::default();
        found.latexmk = Some(folder.path().join("latexmk"));
        assert_eq!(hint_for(&opened, &found), None);

        let typst = tempfile::tempdir().unwrap();
        std::fs::write(typst.path().join("main.typ"), "= Paper\n").unwrap();
        let opened = open_project(typst.path(), None, None).unwrap();
        let mut tools = BuildTools::default();
        tools.use_pinned_typst(Err("this project pins Typst 0.1".to_string()));
        assert_eq!(hint_for(&opened, &tools), None);
    }

    #[test]
    fn a_missing_typst_hint_names_the_oleafly_install() {
        let data = tempfile::tempdir().unwrap();
        let _env = data_dir(data.path());
        let typst = tempfile::tempdir().unwrap();
        std::fs::write(typst.path().join("main.typ"), "= Paper\n").unwrap();
        let opened = open_project(typst.path(), None, None).unwrap();
        let hint = hint_for(&opened, &BuildTools::default()).unwrap();
        assert!(hint.starts_with("Run `oleafly typst install"), "{hint}");
    }

    #[test]
    fn an_appimage_hint_comes_first_for_engines_inside_the_image() {
        let data = tempfile::tempdir().unwrap();
        let _env = data_dir(data.path());
        let typst = tempfile::tempdir().unwrap();
        std::fs::write(typst.path().join("main.typ"), "= Paper\n").unwrap();
        let opened = open_project(typst.path(), None, None).unwrap();
        let appimage = Path::new("/home/me/Oleafly.AppImage");
        let hint =
            missing_tool_hint(&opened, &BuildTools::default(), false, Some(appimage)).unwrap();
        assert!(
            hint.starts_with("Your Oleafly AppImage (/home/me/Oleafly.AppImage)"),
            "{hint}"
        );
        assert!(hint.contains("`oleafly typst install"), "{hint}");

        let folder = tempfile::tempdir().unwrap();
        let opened = latexmk_project(folder.path());
        let hint =
            missing_tool_hint(&opened, &BuildTools::default(), false, Some(appimage)).unwrap();
        assert!(!hint.contains("AppImage"), "{hint}");
    }

    #[test]
    fn open_project_uses_the_folders_manifest_but_the_apps_build_folder() {
        let data = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        let _env = data_dir(data.path());
        Workspace::init(folder.path(), Default::default()).unwrap();
        let state = link(data.path(), "linked-abc", folder.path(), None);
        let opened = open_project(folder.path(), None, None).unwrap();
        assert_eq!(
            opened.origin,
            ProjectOrigin::Linked {
                id: "linked-abc".into()
            }
        );
        assert_eq!(
            opened.workspace.build_dir_path(),
            state.canonicalize().unwrap().join("build")
        );
        let info = with_linked_build(Workspace::open(folder.path()).unwrap())
            .unwrap()
            .info()
            .unwrap();
        assert_eq!(info.build_directory, opened.workspace.build_dir_path());
    }

    #[test]
    fn a_linked_folder_without_a_manifest_takes_the_apps_choices() {
        let data = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        let _env = data_dir(data.path());
        std::fs::create_dir(folder.path().join("paper")).unwrap();
        std::fs::write(
            folder.path().join("paper/main.tex"),
            "\\documentclass{article}",
        )
        .unwrap();
        let state = link(data.path(), "linked-xyz", folder.path(), Some("paper"));
        std::fs::write(
            state.join("project.json"),
            r#"{"name":"Thesis","main_doc":"paper/main.tex","engine":"latexmk","tex_flavor":"lualatex","color":7}"#,
        )
        .unwrap();
        let opened = open_project(folder.path(), None, None).unwrap();
        let manifest = opened.workspace.manifest();
        assert_eq!(
            (manifest.engine.as_str(), manifest.tex_flavor.as_deref()),
            ("latexmk", Some("lualatex"))
        );
        assert_eq!(manifest.compile_dir.as_deref(), Some("paper"));
        assert!(!folder.path().join(".oleafly").exists());
    }

    #[test]
    fn a_task_copy_of_a_linked_folder_builds_with_the_folders_settings() {
        use crate::agent::tools::build::opened_for_task_copy;
        let data = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        let copy = tempfile::tempdir().unwrap();
        let _env = data_dir(data.path());
        for root in [folder.path(), copy.path()] {
            std::fs::create_dir(root.join("thesis")).unwrap();
            std::fs::write(root.join("thesis/main.tex"), "\\documentclass{article}").unwrap();
        }
        let state = link(data.path(), "linked-task", folder.path(), None);
        std::fs::write(
            state.join("project.json"),
            r#"{"name":"Thesis","main_doc":"thesis/main.tex","engine":"latexmk","tex_flavor":"lualatex"}"#,
        )
        .unwrap();
        let settings = |opened: &OpenedProject| {
            let manifest = opened.workspace.manifest();
            (
                manifest.engine.clone(),
                manifest.tex_flavor.clone(),
                opened.workspace.root().to_path_buf(),
            )
        };
        let copy_root = copy.path().canonicalize().unwrap();
        let opened = opened_for_task_copy(copy.path(), Some(folder.path())).unwrap();
        assert_eq!(
            settings(&opened),
            ("latexmk".into(), Some("lualatex".into()), copy_root)
        );
        assert!(!copy.path().join("project.json").exists());
        let opened = opened_for_task_copy(copy.path(), None).unwrap();
        assert_eq!(opened.origin, ProjectOrigin::Detected);
    }

    #[test]
    fn a_linked_folders_saved_typst_settings_reach_its_manifest_whole() {
        let data = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        let _env = data_dir(data.path());
        std::fs::write(folder.path().join("main.typ"), "= Paper\n").unwrap();
        let state = link(data.path(), "linked-typ", folder.path(), None);
        let saved = serde_json::json!({
            "version": "0.13.1",
            "vendor_packages": true,
            "font_paths": ["fonts"],
            "future": {"enabled": true}
        });
        std::fs::write(
            state.join("project.json"),
            serde_json::json!({"name": "Paper", "main_doc": "main.typ", "engine": "typst", "typst": saved})
                .to_string(),
        )
        .unwrap();
        let opened = open_project(folder.path(), None, None).unwrap();
        let manifest = opened.workspace.manifest();
        assert_eq!(manifest.typst_version_pin(), Some("0.13.1"));
        assert!(manifest.typst_vendor_packages());
        assert_eq!(serde_json::to_value(&manifest.typst).unwrap(), saved);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_link_state_folder_is_refused() {
        let data = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        let _env = data_dir(data.path());
        Workspace::init(folder.path(), Default::default()).unwrap();
        std::fs::create_dir_all(data.path().join("linked")).unwrap();
        std::os::unix::fs::symlink(elsewhere.path(), data.path().join("linked/linked-evil"))
            .unwrap();
        let info = LinkInfo {
            id: "linked-evil".into(),
            state_dir: data.path().join("linked/linked-evil"),
            ..LinkInfo::default()
        };
        assert_eq!(
            linked_build_dir(&info).unwrap_err().code,
            "project.unsafe_path"
        );
    }

    #[test]
    fn main_overrides_must_stay_inside_and_match_the_engine() {
        let data = tempfile::tempdir().unwrap();
        let _env = data_dir(data.path());
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("main.tex"), "\\documentclass{article}").unwrap();
        std::fs::write(folder.path().join("notes.md"), "# x").unwrap();
        assert_eq!(
            open_project(folder.path(), Some("../x.tex"), None)
                .unwrap_err()
                .code,
            "project.unsafe_path"
        );
        let detected = open_project(folder.path(), Some("notes.md"), None).unwrap();
        assert_eq!(
            detected.workspace.manifest().engine().unwrap(),
            Engine::Markdown
        );
        assert!(detected.warnings.is_empty());
        Workspace::init(
            folder.path(),
            oleafly_core::InitOptions {
                main_document: Some("main.tex".into()),
                engine: Some(Engine::Latexmk),
                ..Default::default()
            },
        )
        .unwrap();
        let error = open_project(folder.path(), Some("notes.md"), None).unwrap_err();
        assert_eq!(error.code, "project.invalid_input");
        let flavored = open_project(folder.path(), None, Some(TexFlavor::Xelatex)).unwrap();
        assert_eq!(
            flavored.workspace.manifest().tex_flavor.as_deref(),
            Some("xelatex")
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_project_whose_path_is_not_utf8_is_refused_up_front() {
        use std::os::unix::ffi::OsStrExt;
        let data = tempfile::tempdir().unwrap();
        let _env = data_dir(data.path());
        let parent = tempfile::tempdir().unwrap();
        let folder = parent.path().join(std::ffi::OsStr::from_bytes(b"th\xe9se"));
        if std::fs::create_dir(&folder).is_err() {
            return;
        }
        std::fs::write(folder.join("main.tex"), "\\documentclass{article}").unwrap();
        let error = open_project(&folder, None, None).unwrap_err();
        assert_eq!(error.code, "project.invalid_input");
        assert!(error.message.contains("UTF-8"), "{}", error.message);
    }

    #[test]
    fn output_destinations_name_a_pdf_or_a_folder() {
        let folder = tempfile::tempdir().unwrap();
        assert_eq!(
            output_destination(folder.path(), "chapters/main.tex").unwrap(),
            folder.path().join("main.pdf")
        );
        assert_eq!(
            output_destination(&folder.path().join("paper.pdf"), "main.tex").unwrap(),
            folder.path().join("paper.pdf")
        );
        assert_eq!(
            output_destination(&folder.path().join("paper.tex"), "main.tex")
                .unwrap_err()
                .code,
            "usage.invalid"
        );
        assert!(output_destination(&folder.path().join("missing/paper.pdf"), "main.tex").is_err());
    }
}
