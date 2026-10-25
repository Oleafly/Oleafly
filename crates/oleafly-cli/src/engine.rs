//! The CLI's build engine as a library: open a project the way the app
//! sees it (its own `project.json`, a folder the app opened in place, or a
//! detected main document) and build it with the app's compilers. The
//! headless agent (`oleafly agent`) builds through this too.
use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use oleafly_core::engine_spec::EngineFlags;
use oleafly_core::typst_toolchain::{
    bundled_typst_version, typst_version_of, TYPST_VERSION_TIMEOUT,
};
use oleafly_core::{
    compile_dir_for, BuildLocation, Engine, ErrorKind as CoreKind, ProjectManifest, TexFlavor,
    Workspace,
};

use crate::contract::{CliError, ErrorKind, Warning};
use crate::desktop_link::{self, LinkInfo};
use crate::native::{BuildTools, Discovery, NativeCompiler};
use crate::typst::{resolve_pinned, TypstInventory};
use crate::typst_settings::{chosen_variant, unsupported_settings, SettingsRequest, TypstSettings};

pub use crate::native::{BuildError, BuildResult, CompilerLog};

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(300);

/// One build's options.
#[derive(Clone, Default)]
pub struct BuildRequest {
    pub flags: EngineFlags,
    /// Zero means the default (300 seconds).
    pub timeout: Duration,
    /// A Typst variant from `project.json`.
    pub variant: Option<String>,
    /// Build this document instead of the project's main document.
    pub main: Option<String>,
    /// The LaTeX compiler latexmk runs.
    pub compiler: Option<TexFlavor>,
    /// Copy the PDF here after a good build.
    pub output: Option<PathBuf>,
    pub log: CompilerLog,
    /// Runs once when another build of the project holds it.
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
    /// The folder's own `project.json`.
    Manifest,
    /// No `project.json`; the main document was detected.
    Detected,
    /// A folder the app opened in place (its build folder is the app's).
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

/// `<data>/linked/<id>/build`: the app's build folder for a linked folder.
/// The state folder must be a real folder directly inside `<data>/linked`,
/// named by its id; `build` is created when missing.
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

/// The manifest the app would use for a linked folder without a
/// `project.json`: its saved choices where they still make sense.
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

/// `workspace` with the build folder builds use: the app's, when the app
/// opened the folder in place.
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

/// The project at `path` as saved; without a project.json, `main` (from
/// `--main`) is the main document instead of the one detection picks.
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
            // Only a guess is worth a warning.
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

/// Opens the project at `path`, applying `--main` and `--compiler`.
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

fn open_project_unchecked(
    path: &Path,
    main: Option<&str>,
    compiler: Option<TexFlavor>,
) -> Result<OpenedProject, CliError> {
    // `.\chapters\a.tex`, as a Windows shell completes it.
    let main = main.map(crate::contract::project_path_arg);
    let main = main.as_deref();
    // A path that leaves the project is refused before the folder is read.
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
    if main.is_none() && compiler.is_none() {
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

/// The Typst version to use and whether the project pinned it (else it is
/// the app's default).
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

/// The tools a build of `workspace` needs, with the Typst its pin (or the
/// app's default) asks for and, for Markdown, a Pandoc new enough.
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

/// The warning code for a Typst setting the chosen Typst can't apply.
pub(crate) const TYPST_SETTING_UNSUPPORTED: &str = "typst.setting_unsupported";

/// Typst settings a version can't apply (each a sentence).
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

/// Checks `--variant` against the project.
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
    }))
}

/// Where `-o` puts the PDF: `<folder>/<main stem>.pdf` for a folder, else
/// a `.pdf` path whose folder exists.
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

/// Builds the project at `path`.
pub async fn build_project(path: &Path, request: &BuildRequest) -> Result<BuildResult, CliError> {
    let opened = open_project(path, request.main.as_deref(), request.compiler)?;
    build_opened(&opened, request).await
}

/// Builds a project [`open_project`] opened; leaves the build record and
/// copies the PDF for `-o`.
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
    let compiler = NativeCompiler::new(tools)
        .with_typst_settings(settings)
        .with_log(request.log.clone())
        .with_timeout(request.timeout())
        .with_lock_wait(request.on_lock_wait.clone());
    let mut result = compiler.build(workspace, request.flags).await?;
    result.warnings.splice(
        0..0,
        unapplied
            .into_iter()
            .map(|message| Warning::new(TYPST_SETTING_UNSUPPORTED, message)),
    );
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
        // `project info` and `init` report the folder builds use.
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
        // Without the folder it came from, the copy is opened as itself.
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
        // The main document was chosen, not guessed.
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
        // Some file systems (APFS) don't take such a name at all.
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
