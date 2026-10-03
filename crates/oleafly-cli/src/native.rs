use crate::process;
use crate::typst::PinnedTypst;
use crate::typst_settings::TypstSettings;
use oleafly_core::typst_log::{parse_typst_diagnostics, typst_path_relative_to};
use oleafly_core::typst_toolchain::{
    bundled_typst_version, capabilities_for, typst_compile_args, ToolchainVersion,
    TypstCapabilities, TypstDiagnosticFormat,
};
use oleafly_core::{
    image_failure_evidence, image_failure_notes, place_image_findings, plain_path, slash_path,
    walk_source_tree, Engine, EngineScratch, EngineScratchBases, Error, ErrorKind, ImageFinding,
    PreparedBuild, Result, Utf8StreamDecoder, Workspace, ENGINE_TEMP_DIR, TEMP_DIRECTORY_VARIABLES,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;

const OUTPUT_STEM: &str = "_oleafly_entry";
const MAX_LOG_BYTES: usize = 1024 * 1024;
const LOG_TRUNCATION_MARKER: &str = "\n[Oleafly: compiler output truncated]\n";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(300);
type LogCallback = dyn Fn(&str) + Send + Sync;
static ALIAS_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BuildOptions {
    pub offline: bool,
    pub fast: bool,
    pub halt_on_error: bool,
}

impl BuildOptions {
    pub fn ignored_by(self, engine: Engine) -> Vec<&'static str> {
        let (offline, fast, halt_on_error) = match engine {
            Engine::Tectonic => (false, false, false),
            Engine::Latexmk => (false, true, false),
            Engine::Typst => (false, true, true),
            Engine::Markdown => (true, true, true),
        };
        [
            (offline && self.offline, "--offline"),
            (fast && self.fast, "--fast"),
            (halt_on_error && self.halt_on_error, "--halt-on-error"),
        ]
        .into_iter()
        .filter_map(|(ignored, flag)| ignored.then_some(flag))
        .collect()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct BuildError {
    pub line: Option<u32>,
    pub file: Option<String>,
    pub message: String,
    pub kind: String,
    pub column: Option<u32>,
    pub hints: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct BuildResult {
    pub ok: bool,
    pub engine: Engine,
    pub output: Option<PathBuf>,
    pub output_id: Option<String>,
    pub log: String,
    pub errors: Vec<BuildError>,
    pub compile_time_ms: u64,
}

#[derive(Clone, Default)]
pub struct CompilerLog(Option<Arc<LogCallback>>);

impl CompilerLog {
    pub fn new(callback: impl Fn(&str) + Send + Sync + 'static) -> Self {
        Self(Some(Arc::new(callback)))
    }

    fn emit(&self, value: &str) {
        if let Some(callback) = &self.0 {
            callback(value);
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct BuildTools {
    pub tectonic: Option<PathBuf>,
    pub latexmk: Option<PathBuf>,
    pub typst: Option<PathBuf>,
    pub pandoc: Option<PathBuf>,
    rejected_overrides: BTreeMap<&'static str, ToolRejection>,
    typst_capabilities: Option<TypstCapabilities>,
    typst_version: Option<ToolchainVersion>,
    typst_pin_error: Option<String>,
}

impl BuildTools {
    pub fn discover(workspace_root: &Path) -> Self {
        let tectonic = discover_tool("tectonic", "OLEAFLY_TECTONIC", workspace_root);
        let latexmk = discover_tool("latexmk", "OLEAFLY_LATEXMK", workspace_root);
        let typst = discover_tool("typst", "OLEAFLY_TYPST", workspace_root);
        let pandoc = discover_pandoc(workspace_root);
        let mut rejected_overrides = BTreeMap::new();
        for (name, resolution) in [
            ("tectonic", &tectonic),
            ("latexmk", &latexmk),
            ("typst", &typst),
            ("pandoc", &pandoc),
        ] {
            if let Some(rejection) = &resolution.rejected_override {
                rejected_overrides.insert(name, rejection.clone());
            }
        }
        Self {
            tectonic: tectonic.executable,
            latexmk: latexmk.executable,
            typst: typst.executable,
            pandoc: pandoc.executable,
            rejected_overrides,
            typst_capabilities: None,
            typst_version: None,
            typst_pin_error: None,
        }
    }

    pub(crate) fn use_pinned_typst(
        &mut self,
        resolution: std::result::Result<PinnedTypst, String>,
    ) {
        match resolution {
            Ok(pinned) => {
                self.typst = Some(pinned.path);
                self.typst_capabilities = Some(pinned.capabilities);
                self.typst_version = Some(pinned.version);
                self.typst_pin_error = None;
            }
            Err(message) => {
                self.typst = None;
                self.typst_capabilities = None;
                self.typst_version = None;
                self.typst_pin_error = Some(message);
            }
        }
    }

    pub(crate) fn use_typst_version(&mut self, version: Option<ToolchainVersion>) {
        self.typst_capabilities = version
            .as_ref()
            .map(|version| capabilities_for(&version.to_string()).clone());
        self.typst_version = version;
    }

    pub(crate) fn typst_version_label(&self) -> String {
        self.typst_version
            .as_ref()
            .unwrap_or_else(|| bundled_typst_version())
            .to_string()
    }

    pub(crate) fn typst_pin_error(&self) -> Option<&str> {
        self.typst_pin_error.as_deref()
    }

    pub(crate) fn typst_capabilities(&self) -> &TypstCapabilities {
        self.typst_capabilities
            .as_ref()
            .unwrap_or_else(|| capabilities_for(&bundled_typst_version().to_string()))
    }

    pub fn for_engine(&self, engine: Engine) -> Option<&Path> {
        match engine {
            Engine::Tectonic => self.tectonic.as_deref(),
            Engine::Latexmk => self.latexmk.as_deref(),
            Engine::Typst => self.typst.as_deref(),
            Engine::Markdown => self.pandoc.as_deref(),
        }
    }

    pub fn required_for_engine(&self, engine: Engine) -> Vec<(&'static str, Option<&Path>)> {
        match engine {
            Engine::Tectonic => vec![("tectonic", self.tectonic.as_deref())],
            Engine::Latexmk => vec![("latexmk", self.latexmk.as_deref())],
            Engine::Typst => vec![("typst", self.typst.as_deref())],
            Engine::Markdown => vec![
                ("pandoc", self.pandoc.as_deref()),
                ("tectonic", self.tectonic.as_deref()),
            ],
        }
    }

    pub fn rejected_override(&self, name: &str) -> Option<(&str, &Path)> {
        self.rejected_overrides
            .get(name)
            .map(|rejection| (rejection.variable, rejection.path.as_path()))
    }

    fn missing_for_engine(&self, engine: Engine) -> Error {
        let name = engine.tool_name();
        if let (Engine::Typst, Some(message)) = (engine, self.typst_pin_error()) {
            return Error::new(ErrorKind::MissingTool, message);
        }
        match self.rejected_override(name) {
            Some((variable, path)) => rejected_tool(variable, path),
            None => missing_tool(engine),
        }
    }
}

#[derive(Clone, Debug)]
struct ToolRejection {
    variable: &'static str,
    path: PathBuf,
}

struct ToolResolution {
    executable: Option<PathBuf>,
    rejected_override: Option<ToolRejection>,
}

#[derive(Clone)]
pub struct NativeCompiler {
    tools: BuildTools,
    log: CompilerLog,
    timeout: Duration,
    typst: TypstSettings,
}

impl NativeCompiler {
    pub fn new(tools: BuildTools) -> Self {
        Self {
            tools,
            log: CompilerLog::default(),
            timeout: DEFAULT_TIMEOUT,
            typst: TypstSettings::default(),
        }
    }

    pub(crate) fn with_typst_settings(mut self, settings: TypstSettings) -> Self {
        self.typst = settings;
        self
    }

    pub fn with_log(mut self, log: CompilerLog) -> Self {
        self.log = log;
        self
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    pub async fn build(&self, workspace: &Workspace, options: BuildOptions) -> Result<BuildResult> {
        let prepared = workspace.prepare_build()?;
        self.build_prepared(&prepared, options).await
    }

    async fn build_prepared(
        &self,
        build: &PreparedBuild,
        options: BuildOptions,
    ) -> Result<BuildResult> {
        let started = Instant::now();
        clear_outputs(build.build_directory())?;
        let command = self.command(build, options)?;
        if command.produced_output != build.build_directory().join(format!("{OUTPUT_STEM}.pdf")) {
            remove_if_exists(&command.produced_output)?;
        }
        let (mut log, exit_code) = run_command(
            &command.executable,
            &command.arguments,
            &command.working_directory,
            &command.environment,
            self.timeout,
            &self.log,
        )
        .await?;
        let output = build.build_directory().join(format!("{OUTPUT_STEM}.pdf"));
        if command.produced_output.is_file() && command.produced_output != output {
            tokio::fs::rename(&command.produced_output, &output).await?;
        }
        let output = output.is_file().then_some(output);
        let mut errors = parse_errors(build.engine(), &log);
        if build.engine() == Engine::Typst {
            for error in &mut errors {
                error.file = error
                    .file
                    .take()
                    .map(|file| typst_path_relative_to(&file, &command.working_directory));
            }
        }
        let ok = exit_code == Some(0)
            && output.is_some()
            && !errors.iter().any(|error| error.kind == "error");
        if image_check_applies(ok, build.engine()) {
            self.explain_image_failures(build, &mut log, &mut errors)
                .await;
        }
        let output_id = output.as_deref().map(fingerprint_file).transpose()?;
        Ok(BuildResult {
            ok,
            engine: build.engine(),
            output,
            output_id,
            log,
            errors,
            compile_time_ms: started.elapsed().as_millis() as u64,
        })
    }

    async fn explain_image_failures(
        &self,
        build: &PreparedBuild,
        log: &mut String,
        errors: &mut Vec<BuildError>,
    ) {
        let Some(evidence) = image_failure_evidence(log) else {
            return;
        };
        let project_root = build.project_root().to_path_buf();
        let main_document = build.main_document().to_string();
        let Ok(findings) = tokio::task::spawn_blocking(move || {
            evidence.diagnose(&project_root, Some(&main_document))
        })
        .await
        else {
            return;
        };
        self.apply_image_findings(&findings, log, errors);
    }

    fn apply_image_findings(
        &self,
        findings: &[ImageFinding],
        log: &mut String,
        errors: &mut Vec<BuildError>,
    ) {
        if findings.is_empty() {
            return;
        }
        let notes = image_failure_notes(findings);
        self.log.emit(&notes);
        append_bounded(log, notes.as_bytes());
        place_image_findings(
            errors,
            findings,
            |error| error.kind == "error",
            |message| BuildError {
                line: None,
                file: None,
                message,
                kind: "error".to_string(),
                column: None,
                hints: Vec::new(),
            },
        );
    }

    fn command(&self, build: &PreparedBuild, options: BuildOptions) -> Result<BuildCommand> {
        let owned = crate::desktop_link::data_root().map(|root| root.join(ENGINE_TEMP_DIR));
        let scratch_bases = EngineScratchBases::new(owned, build.build_directory());
        self.command_with(build, options, &scratch_bases)
    }

    fn command_with(
        &self,
        build: &PreparedBuild,
        options: BuildOptions,
        scratch_bases: &EngineScratchBases,
    ) -> Result<BuildCommand> {
        let executable = self
            .tools
            .for_engine(build.engine())
            .ok_or_else(|| self.tools.missing_for_engine(build.engine()))?
            .to_path_buf();
        if executable.is_absolute() {
            reject_project_local_tool(&executable, build.project_root())?;
        }
        let output = build.build_directory().join(format!("{OUTPUT_STEM}.pdf"));
        let mut compiler_alias = None;
        let mut scratch = None;
        let mut resource_variable = None;
        let (arguments, produced_output) = match build.engine() {
            Engine::Tectonic => {
                let stem = build
                    .source_path()
                    .file_stem()
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| {
                        Error::new(ErrorKind::InvalidManifest, "main document has no file stem")
                    })?;
                (
                    tectonic_arguments(build, options),
                    build.build_directory().join(stem).with_extension("pdf"),
                )
            }
            Engine::Latexmk => (latexmk_arguments(build, options)?, output.clone()),
            Engine::Typst => (
                typst_arguments(build, &output, self.tools.typst_capabilities(), &self.typst)?,
                output.clone(),
            ),
            Engine::Markdown => {
                let tectonic = self.tools.tectonic.as_deref().ok_or_else(|| {
                    Error::new(
                        ErrorKind::MissingTool,
                        "Markdown PDF builds require both pandoc and tectonic",
                    )
                })?;
                reject_project_local_tool(tectonic, build.project_root())?;
                let (engine_path, alias) = pandoc_engine_path(tectonic)?;
                compiler_alias = alias;
                let created = EngineScratch::create(scratch_bases)?;
                let resources = created.pandoc_resource_path(&plain_path(build.project_root()))?;
                resource_variable = resources.variable;
                scratch = Some(created);
                (
                    markdown_arguments(build, &output, &engine_path, resources.argument)?,
                    output.clone(),
                )
            }
        };
        let working_directory = match (&scratch, build.engine()) {
            (Some(scratch), _) => scratch.path(),
            (None, Engine::Latexmk) => build.compile_directory(),
            (None, _) => build.project_root(),
        }
        .to_path_buf();
        let environment = match (&scratch, build.engine()) {
            (Some(scratch), _) => TEMP_DIRECTORY_VARIABLES
                .iter()
                .map(|name| (*name, scratch.path().as_os_str().to_owned()))
                .chain(resource_variable)
                .collect(),
            (None, Engine::Typst) => self.typst.environment(),
            (None, _) => Vec::new(),
        };
        Ok(BuildCommand {
            executable,
            arguments,
            produced_output,
            working_directory,
            environment,
            _scratch: scratch,
            _compiler_alias: compiler_alias,
        })
    }
}

struct BuildCommand {
    executable: PathBuf,
    arguments: Vec<OsString>,
    produced_output: PathBuf,
    working_directory: PathBuf,
    environment: Vec<(&'static str, OsString)>,
    _scratch: Option<EngineScratch>,
    _compiler_alias: Option<CompilerAlias>,
}

struct CompilerAlias {
    directory: PathBuf,
    executable: PathBuf,
}

impl CompilerAlias {
    fn create(source: &Path, name: &str) -> Result<Self> {
        let temporary_root = std::env::temp_dir();
        for _ in 0..100 {
            let sequence = ALIAS_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let directory = temporary_root.join(format!(
                "oleafly-compiler-{}-{sequence}",
                std::process::id()
            ));
            match std::fs::create_dir(&directory) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error.into()),
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Err(error) =
                    std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
                {
                    let _ = std::fs::remove_dir(&directory);
                    return Err(error.into());
                }
            }
            let executable = directory.join(executable_name(name));
            if std::fs::hard_link(source, &executable).is_err() {
                if let Err(error) = std::fs::copy(source, &executable) {
                    let _ = std::fs::remove_dir(&directory);
                    return Err(error.into());
                }
            }
            return Ok(Self {
                directory,
                executable,
            });
        }
        Err(Error::new(
            ErrorKind::Io,
            "failed to allocate a private compiler alias",
        ))
    }
}

impl Drop for CompilerAlias {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.executable);
        let _ = std::fs::remove_dir(&self.directory);
    }
}

fn pandoc_engine_path(tectonic: &Path) -> Result<(PathBuf, Option<CompilerAlias>)> {
    if tectonic
        .file_stem()
        .is_some_and(|value| value.eq_ignore_ascii_case("tectonic"))
    {
        return Ok((tectonic.to_path_buf(), None));
    }
    let alias = CompilerAlias::create(tectonic, "tectonic")?;
    Ok((alias.executable.clone(), Some(alias)))
}

fn missing_tool(engine: Engine) -> Error {
    Error::new(
        ErrorKind::MissingTool,
        format!(
            "{} was not found. Install it or set {}",
            engine.tool_name(),
            tool_env(engine.tool_name())
        ),
    )
}

pub fn rejected_override_message(variable: &str, path: &Path) -> String {
    format!(
        "{variable}={} was refused because project-local compiler paths are not allowed",
        path.display()
    )
}

fn rejected_tool(variable: &str, path: &Path) -> Error {
    Error::new(
        ErrorKind::MissingTool,
        rejected_override_message(variable, path),
    )
}

fn tool_env(name: &str) -> String {
    format!("OLEAFLY_{}", name.to_ascii_uppercase())
}

pub fn executable_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn discover_tool(name: &str, variable: &'static str, workspace_root: &Path) -> ToolResolution {
    let mut candidates = bundled_tool_candidates(name);
    candidates.extend(path_tool_candidates(name));
    discover_from_candidates(variable, candidates, workspace_root)
}

pub(crate) fn bundled_tool_candidates(name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            candidates.push(parent.join(executable_name(name)));
        }
    }
    candidates.extend(development_sidecars(name));
    candidates
}

pub(crate) fn path_tool_candidates(name: &str) -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|path| {
            std::env::split_paths(&path)
                .map(|directory| directory.join(executable_name(name)))
                .collect()
        })
        .unwrap_or_default()
}

fn discover_pandoc(workspace_root: &Path) -> ToolResolution {
    let mut candidates = Vec::new();
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            candidates.push(parent.join(executable_name("pandoc")));
        }
    }
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    if let Some(home) = home {
        let home = PathBuf::from(home);
        candidates.extend([
            home.join(".oleafly/bin").join(executable_name("pandoc")),
            home.join(".local/bin").join(executable_name("pandoc")),
            home.join("bin").join(executable_name("pandoc")),
        ]);
    }
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/pandoc"),
        PathBuf::from("/usr/local/bin/pandoc"),
        PathBuf::from("/usr/bin/pandoc"),
    ]);
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(
            std::env::split_paths(&path).map(|directory| directory.join(executable_name("pandoc"))),
        );
    }
    discover_from_candidates("OLEAFLY_PANDOC", candidates, workspace_root)
}

fn discover_from_candidates(
    variable: &'static str,
    candidates: impl IntoIterator<Item = PathBuf>,
    workspace_root: &Path,
) -> ToolResolution {
    let mut rejected_override = None;
    if let Some(value) = std::env::var_os(variable).filter(|value| !value.is_empty()) {
        match resolve_executable(PathBuf::from(value), workspace_root) {
            CandidateResolution::Safe(path) => {
                return ToolResolution {
                    executable: Some(path),
                    rejected_override: None,
                };
            }
            CandidateResolution::ProjectLocal(path) => {
                rejected_override = Some(ToolRejection { variable, path });
            }
            CandidateResolution::Missing => {}
        }
    }
    ToolResolution {
        executable: candidates.into_iter().find_map(|candidate| {
            match resolve_executable(candidate, workspace_root) {
                CandidateResolution::Safe(path) => Some(path),
                CandidateResolution::Missing | CandidateResolution::ProjectLocal(_) => None,
            }
        }),
        rejected_override,
    }
}

pub(crate) enum CandidateResolution {
    Missing,
    Safe(PathBuf),
    ProjectLocal(PathBuf),
}

pub(crate) fn resolve_executable(candidate: PathBuf, workspace_root: &Path) -> CandidateResolution {
    if !is_executable_file(&candidate) {
        return CandidateResolution::Missing;
    }
    let Ok(candidate) = candidate.canonicalize() else {
        return CandidateResolution::Missing;
    };
    if candidate.starts_with(workspace_root) {
        CandidateResolution::ProjectLocal(candidate)
    } else {
        CandidateResolution::Safe(candidate)
    }
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(windows)]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

#[cfg(debug_assertions)]
fn development_sidecars(name: &str) -> Vec<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src-tauri/binaries");
    let mut candidates = Vec::new();
    if let Some(target) = option_env!("OLEAFLY_BUILD_TARGET") {
        candidates.push(root.join(format!(
            "{name}-{target}{}",
            if cfg!(windows) { ".exe" } else { "" }
        )));
    }
    candidates.push(root.join(executable_name(name)));
    candidates
}

#[cfg(not(debug_assertions))]
fn development_sidecars(_name: &str) -> Vec<PathBuf> {
    Vec::new()
}

fn is_within(path: &Path, root: &Path) -> bool {
    match (path.canonicalize(), root.canonicalize()) {
        (Ok(path), Ok(root)) => path.starts_with(root),
        _ => false,
    }
}

fn reject_project_local_tool(tool: &Path, root: &Path) -> Result<()> {
    if is_within(tool, root) {
        return Err(Error::new(
            ErrorKind::UnsafePath,
            format!(
                "refusing to execute a project-local compiler: {}",
                tool.display()
            ),
        ));
    }
    Ok(())
}

fn tectonic_arguments(build: &PreparedBuild, options: BuildOptions) -> Vec<OsString> {
    let mut arguments: Vec<OsString> = vec!["-X".into(), "compile".into()];
    if options.offline {
        arguments.push("--only-cached".into());
    }
    arguments.extend([
        "--synctex".into(),
        "--keep-logs".into(),
        "--keep-intermediates".into(),
        "--print".into(),
        "--outdir".into(),
        build.build_directory().as_os_str().to_owned(),
    ]);
    if options.fast {
        arguments.extend(["--reruns".into(), "0".into()]);
    }
    if !options.halt_on_error {
        arguments.extend(["-Z".into(), "continue-on-errors".into()]);
    }
    arguments.extend([
        "-Z".into(),
        format!("search-path={}", build.project_root().display()).into(),
        build.source_path().as_os_str().to_owned(),
    ]);
    arguments
}

fn latexmk_arguments(build: &PreparedBuild, options: BuildOptions) -> Result<Vec<OsString>> {
    let flavor = build.tex_flavor().map_or_else(
        || detect_latexmk_flavor(build.source_path()),
        |value| match value {
            "pdflatex" => Ok("-pdf"),
            "xelatex" => Ok("-xelatex"),
            "lualatex" => Ok("-lualatex"),
            _ => Err(Error::new(
                ErrorKind::InvalidManifest,
                format!("unsupported tex_flavor `{value}`"),
            )),
        },
    )?;
    let output = relative_to(build.compile_directory(), build.build_directory())
        .ok_or_else(|| Error::new(ErrorKind::UnsafePath, "build directory escaped the project"))?;
    let input = build
        .source_path()
        .strip_prefix(build.compile_directory())
        .map_err(|_| Error::new(ErrorKind::UnsafePath, "main document escaped the project"))?;
    let mut arguments: Vec<OsString> = vec![
        "-norc".into(),
        "-no-shell-escape".into(),
        flavor.into(),
        "-interaction=nonstopmode".into(),
        "-synctex=1".into(),
        format!("-outdir={}", dotted(&output)).into(),
        format!("-jobname={OUTPUT_STEM}").into(),
    ];
    if options.halt_on_error {
        arguments.push("-halt-on-error".into());
    } else {
        arguments.push("-f".into());
    }
    if flavor == "-lualatex" {
        arguments.push("-latexoption=--nosocket".into());
    }
    arguments.push(format!("./{}", slash_path(input)).into());
    Ok(arguments)
}

fn relative_to(base: &Path, target: &Path) -> Option<PathBuf> {
    let base: Vec<_> = base.components().collect();
    let target: Vec<_> = target.components().collect();
    let shared = base
        .iter()
        .zip(&target)
        .take_while(|(left, right)| left == right)
        .count();
    if shared == 0 {
        return None;
    }
    let mut relative = PathBuf::new();
    for _ in shared..base.len() {
        relative.push("..");
    }
    for component in &target[shared..] {
        relative.push(component);
    }
    Some(relative)
}

fn dotted(path: &Path) -> String {
    let path = slash_path(path);
    if path.starts_with("..") {
        path
    } else {
        format!("./{path}")
    }
}

fn detect_latexmk_flavor(source: &Path) -> Result<&'static str> {
    use std::io::Read;
    let mut file = std::fs::File::open(source)?;
    let mut bytes = Vec::new();
    file.by_ref().take(512 * 1024).read_to_end(&mut bytes)?;
    let source = String::from_utf8_lossy(&bytes);
    for line in source.lines().take(100) {
        let lower = line.trim().to_ascii_lowercase();
        if lower.contains("!tex program") || lower.contains("!tex engine") {
            if lower.contains("xelatex") {
                return Ok("-xelatex");
            }
            if lower.contains("lualatex") {
                return Ok("-lualatex");
            }
            if lower.contains("pdflatex") {
                return Ok("-pdf");
            }
        }
    }
    if ["fontspec", "polyglossia", "unicode-math", "\\setmainfont"]
        .iter()
        .any(|needle| source.contains(needle))
    {
        Ok("-xelatex")
    } else {
        Ok("-pdf")
    }
}

fn typst_arguments(
    build: &PreparedBuild,
    output: &Path,
    capabilities: &TypstCapabilities,
    settings: &TypstSettings,
) -> Result<Vec<OsString>> {
    typst_compile_args(
        capabilities,
        build.source_path(),
        output,
        build.project_root(),
        TypstDiagnosticFormat::Human,
        &settings.compile_flags(capabilities),
    )
    .map_err(|error| Error::new(ErrorKind::Build, error.to_string()))
}

fn markdown_arguments(
    build: &PreparedBuild,
    output: &Path,
    tectonic: &Path,
    resource_path: OsString,
) -> Result<Vec<OsString>> {
    let project = plain_path(build.project_root());
    let mut arguments: Vec<OsString> = vec![
        resource_path,
        "--from=markdown".into(),
        "--standalone".into(),
        format!("--pdf-engine={}", tectonic.display()).into(),
        format!("--pdf-engine-opt=-Zsearch-path={}", project.display()).into(),
        format!("--output={}", plain_path(output).display()).into(),
    ];
    let bibliographies = discover_bibliographies(build.project_root())?;
    if !bibliographies.is_empty() {
        arguments.push("--citeproc".into());
    }
    for bibliography in bibliographies {
        arguments.push(format!("--bibliography={}", project.join(bibliography).display()).into());
    }
    arguments.extend([
        "--".into(),
        plain_path(build.source_path()).into_os_string(),
    ]);
    Ok(arguments)
}

fn discover_bibliographies(root: &Path) -> Result<Vec<PathBuf>> {
    let mut output = Vec::new();
    walk_source_tree(root, "bibliography search", &mut |relative, absolute| {
        if absolute
            .extension()
            .is_some_and(|value| value.eq_ignore_ascii_case("bib"))
        {
            output.push(relative.to_path_buf());
        }
        Ok(())
    })?;
    output.sort();
    Ok(output)
}

pub(crate) async fn run_command(
    executable: &Path,
    arguments: &[OsString],
    working_directory: &Path,
    environment: &[(&str, OsString)],
    timeout: Duration,
    sink: &CompilerLog,
) -> Result<(String, Option<i32>)> {
    let mut command = tokio::process::Command::new(executable);
    command
        .args(arguments)
        .current_dir(working_directory)
        .env("NoDefaultCurrentDirectoryInExePath", "1")
        .env("openout_any", "p")
        .env("openin_any", "p")
        .env("shell_escape", "f")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(path) = compiler_path(executable)? {
        command.env("PATH", path);
    }
    for (name, value) in environment {
        command.env(name, value);
    }
    process::isolate(&mut command);
    let mut child = command.spawn().map_err(|error| {
        Error::new(
            ErrorKind::Build,
            format!("failed to start {}: {error}", executable.display()),
        )
    })?;
    let pid = child
        .id()
        .ok_or_else(|| Error::new(ErrorKind::Build, "compiler process has no identifier"))?;
    let containment = match process::contain(pid) {
        Ok(containment) => containment,
        Err(error) => {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
            return Err(Error::new(
                ErrorKind::Build,
                format!("failed to contain compiler process: {error}"),
            ));
        }
    };
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| Error::new(ErrorKind::Build, "compiler stdout was not captured"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| Error::new(ErrorKind::Build, "compiler stderr was not captured"))?;
    let mut containment = Some(containment);
    // Readers belong to this future, so cancellation closes them rather than
    // leaving detached log tasks and pipe handles behind.
    let result = tokio::time::timeout(timeout, async {
        let wait = async {
            let status = child.wait().await?;
            drop(containment.take());
            Ok::<_, std::io::Error>(status)
        };
        tokio::try_join!(
            wait,
            read_stream(stdout, sink.clone()),
            read_stream(stderr, sink.clone())
        )
    })
    .await;
    drop(containment);
    let (status, mut log, stderr) = match result {
        Ok(Ok(output)) => output,
        error => {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
            let message = match error {
                Ok(Err(error)) => error.to_string(),
                Err(_) => format!("compiler timed out after {} seconds", timeout.as_secs()),
                Ok(Ok(_)) => unreachable!(),
            };
            return Err(Error::new(ErrorKind::Build, message));
        }
    };
    append_bounded(&mut log, stderr.as_bytes());
    Ok((log, status.code()))
}

fn compiler_path(executable: &Path) -> Result<Option<OsString>> {
    let Some(parent) = executable
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    else {
        return Ok(None);
    };
    let inherited = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    let paths = std::iter::once(parent.to_path_buf()).chain(inherited);
    std::env::join_paths(paths).map(Some).map_err(|error| {
        Error::new(
            ErrorKind::Build,
            format!("failed to construct compiler PATH: {error}"),
        )
    })
}

async fn read_stream<R>(mut stream: R, sink: CompilerLog) -> std::io::Result<String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut output = String::new();
    let mut buffer = [0_u8; 8192];
    let mut decoder = Utf8StreamDecoder::default();
    loop {
        let read = stream.read(&mut buffer).await?;
        let text = decoder.push(&buffer[..read], read == 0);
        if !text.is_empty() {
            sink.emit(&text);
            append_bounded(&mut output, text.as_bytes());
        }
        if read == 0 {
            break;
        }
    }
    Ok(output)
}

fn append_bounded(output: &mut String, bytes: &[u8]) {
    if bytes.is_empty() {
        return;
    }
    let content_limit = MAX_LOG_BYTES.saturating_sub(LOG_TRUNCATION_MARKER.len());
    if output.len() >= MAX_LOG_BYTES {
        if !output.ends_with(LOG_TRUNCATION_MARKER) {
            output.truncate(floor_char_boundary(output, content_limit));
            output.push_str(LOG_TRUNCATION_MARKER);
        }
        return;
    }
    let text = String::from_utf8_lossy(bytes);
    if text.len() <= MAX_LOG_BYTES - output.len() {
        output.push_str(&text);
        return;
    }
    if output.len() > content_limit {
        output.truncate(floor_char_boundary(output, content_limit));
    }
    let boundary = floor_char_boundary(&text, content_limit - output.len());
    output.push_str(&text[..boundary]);
    output.push_str(LOG_TRUNCATION_MARKER);
}

fn floor_char_boundary(text: &str, limit: usize) -> usize {
    (0..=limit.min(text.len()))
        .rev()
        .find(|index| text.is_char_boundary(*index))
        .unwrap_or(0)
}

fn clear_outputs(build_directory: &Path) -> Result<()> {
    for extension in ["pdf", "log", "synctex.gz"] {
        let path = build_directory.join(format!("{OUTPUT_STEM}.{extension}"));
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn remove_if_exists(path: &Path) -> Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn fingerprint_file(path: &Path) -> Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut length = 0_u64;
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        length += read as u64;
        hasher.update(&buffer[..read]);
    }
    Ok(format!("pdf-sha256:{length}:{:x}", hasher.finalize()))
}

fn image_check_applies(ok: bool, engine: Engine) -> bool {
    !ok && matches!(engine, Engine::Tectonic | Engine::Latexmk)
}

fn parse_errors(engine: Engine, log: &str) -> Vec<BuildError> {
    match engine {
        Engine::Typst => parse_typst_errors(log),
        Engine::Markdown => parse_pandoc_errors(log),
        Engine::Tectonic | Engine::Latexmk => parse_tex_errors(log),
    }
}

fn parse_typst_errors(log: &str) -> Vec<BuildError> {
    parse_typst_diagnostics(log)
        .into_iter()
        .map(|diagnostic| {
            let span = diagnostic.user_span().cloned();
            BuildError {
                line: span.as_ref().map(|span| span.line),
                column: span.as_ref().map(|span| span.column + 1),
                file: span.map(|span| span.file),
                kind: diagnostic.severity.as_str().to_string(),
                message: diagnostic.message,
                hints: diagnostic.hints,
            }
        })
        .collect()
}

fn parse_pandoc_errors(log: &str) -> Vec<BuildError> {
    log.lines()
        .filter_map(|line| {
            let value = line.trim();
            let lower = value.to_ascii_lowercase();
            let kind = if lower.contains("warning") {
                "warning"
            } else if lower.contains("error") || lower.starts_with("pandoc:") {
                "error"
            } else {
                return None;
            };
            Some(BuildError {
                line: None,
                file: None,
                message: value.to_string(),
                kind: kind.to_string(),
                column: None,
                hints: Vec::new(),
            })
        })
        .collect()
}

fn parse_tex_errors(log: &str) -> Vec<BuildError> {
    let lines: Vec<_> = log.lines().collect();
    lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| {
            let message = line.strip_prefix("! ")?;
            let line_number = lines.iter().skip(index + 1).take(20).find_map(|line| {
                let value = line.strip_prefix("l.")?;
                value
                    .chars()
                    .take_while(char::is_ascii_digit)
                    .collect::<String>()
                    .parse::<u32>()
                    .ok()
            });
            Some(BuildError {
                line: line_number,
                file: None,
                message: message.to_string(),
                kind: "error".to_string(),
                column: None,
                hints: Vec::new(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_core::{InitOptions, ProjectManifest};
    use std::sync::Mutex;
    use tempfile::TempDir;

    fn workspace_for_engine(
        directory: &TempDir,
        engine: Engine,
        tex_flavor: Option<&str>,
    ) -> Workspace {
        let main_document = engine.default_main_document();
        std::fs::write(directory.path().join(main_document), "document").unwrap();
        Workspace::from_manifest(
            directory.path(),
            ProjectManifest {
                name: "Compiler contract".into(),
                main_doc: main_document.into(),
                engine: engine.manifest_name().into(),
                tex_flavor: tex_flavor.map(str::to_string),
                ..ProjectManifest::default()
            },
        )
        .unwrap()
    }

    fn arguments(command: &BuildCommand) -> Vec<String> {
        command
            .arguments
            .iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect()
    }

    fn compiler_fixture(directory: &TempDir, failure: bool) -> PathBuf {
        crate::support::compiler_fixture(directory.path(), failure)
    }

    #[tokio::test]
    async fn compiler_output_keeps_characters_split_between_reads() {
        let text = "kapitoly/úvod.typ:1:9: error: x";
        let bytes = text.as_bytes();
        let cut = text.find('ú').unwrap() + 1;
        let emitted = Arc::new(Mutex::new(String::new()));
        let sink_emitted = emitted.clone();
        let sink = CompilerLog::new(move |chunk| sink_emitted.lock().unwrap().push_str(chunk));
        let output = read_stream((&bytes[..cut]).chain(&bytes[cut..]), sink)
            .await
            .unwrap();
        assert_eq!(output, text);
        assert_eq!(*emitted.lock().unwrap(), text);
    }

    #[test]
    fn build_options_name_the_flags_each_engine_ignores() {
        let none = BuildOptions::default();
        let all = BuildOptions {
            offline: true,
            fast: true,
            halt_on_error: true,
        };
        let every_flag = vec!["--offline", "--fast", "--halt-on-error"];
        for engine in [
            Engine::Tectonic,
            Engine::Latexmk,
            Engine::Typst,
            Engine::Markdown,
        ] {
            assert!(none.ignored_by(engine).is_empty());
        }
        assert!(all.ignored_by(Engine::Tectonic).is_empty());
        assert_eq!(all.ignored_by(Engine::Latexmk), vec!["--fast"]);
        assert_eq!(
            all.ignored_by(Engine::Typst),
            vec!["--fast", "--halt-on-error"]
        );
        assert_eq!(all.ignored_by(Engine::Markdown), every_flag);
        let offline_only = BuildOptions {
            offline: true,
            ..BuildOptions::default()
        };
        assert!(offline_only.ignored_by(Engine::Typst).is_empty());
        assert_eq!(offline_only.ignored_by(Engine::Markdown), vec!["--offline"]);
        assert!(offline_only.ignored_by(Engine::Latexmk).is_empty());
    }

    #[test]
    fn debug_build_records_the_compilation_target() {
        assert!(option_env!("OLEAFLY_BUILD_TARGET").is_some_and(|target| !target.is_empty()));
    }

    #[cfg(unix)]
    #[test]
    fn bibliography_discovery_does_not_follow_links() {
        use std::os::unix::fs::symlink;

        let directory = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        std::fs::write(outside.path().join("outside.bib"), "@book{outside}").unwrap();
        symlink(outside.path(), directory.path().join("linked")).unwrap();
        std::fs::write(directory.path().join("inside.bib"), "@book{inside}").unwrap();
        let found = discover_bibliographies(directory.path()).unwrap();
        assert_eq!(found, vec![PathBuf::from("inside.bib")]);
    }

    #[test]
    fn output_cleanup_is_narrow() {
        let directory = TempDir::new().unwrap();
        for extension in ["pdf", "log", "synctex.gz"] {
            std::fs::write(
                directory.path().join(format!("{OUTPUT_STEM}.{extension}")),
                "generated",
            )
            .unwrap();
        }
        std::fs::write(directory.path().join("keep.pdf"), "keep").unwrap();
        clear_outputs(directory.path()).unwrap();
        assert!(directory.path().join("keep.pdf").is_file());
        assert!(!directory.path().join(format!("{OUTPUT_STEM}.pdf")).exists());
    }

    #[test]
    fn output_fingerprint_includes_length_and_contents() {
        let directory = TempDir::new().unwrap();
        let first = directory.path().join("first.pdf");
        let second = directory.path().join("second.pdf");
        std::fs::write(&first, "one").unwrap();
        std::fs::write(&second, "two").unwrap();
        let first_id = fingerprint_file(&first).unwrap();
        let second_id = fingerprint_file(&second).unwrap();
        assert!(first_id.starts_with("pdf-sha256:3:"));
        assert_ne!(first_id, second_id);
    }

    #[test]
    fn pandoc_engine_alias_uses_a_recognized_executable_name() {
        let directory = TempDir::new().unwrap();
        let source = directory.path().join(executable_name("tectonic-target"));
        std::fs::write(&source, "compiler").unwrap();
        let (path, alias) = pandoc_engine_path(&source).unwrap();
        assert_eq!(
            path.file_name().and_then(|value| value.to_str()),
            Some(executable_name("tectonic").as_str())
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"compiler");
        let alias_directory = path.parent().unwrap().to_path_buf();
        drop(alias);
        assert!(!alias_directory.exists());
    }

    #[test]
    fn latexmk_flavor_detects_unicode_documents() {
        let directory = TempDir::new().unwrap();
        let source = directory.path().join("main.tex");
        std::fs::write(&source, "\\usepackage{fontspec}").unwrap();
        assert_eq!(detect_latexmk_flavor(&source).unwrap(), "-xelatex");
    }

    #[test]
    fn latexmk_flavor_honors_magic_comments_and_safe_default() {
        let directory = TempDir::new().unwrap();
        let source = directory.path().join("main.tex");
        for (content, expected) in [
            ("% !TeX program = xelatex", "-xelatex"),
            ("% !TeX engine = lualatex", "-lualatex"),
            ("% !TeX program = pdflatex", "-pdf"),
            ("\\documentclass{article}", "-pdf"),
        ] {
            std::fs::write(&source, content).unwrap();
            assert_eq!(detect_latexmk_flavor(&source).unwrap(), expected);
        }
    }

    #[test]
    fn compiler_commands_preserve_every_engine_contract() {
        let tools_directory = TempDir::new().unwrap();
        let tectonic = tools_directory.path().join(executable_name("tectonic"));
        let latexmk = tools_directory.path().join(executable_name("latexmk"));
        let typst = tools_directory.path().join(executable_name("typst"));
        let pandoc = tools_directory.path().join(executable_name("pandoc"));
        for tool in [&tectonic, &latexmk, &typst, &pandoc] {
            std::fs::write(tool, "tool").unwrap();
        }
        let tools = BuildTools {
            tectonic: Some(tectonic.clone()),
            latexmk: Some(latexmk.clone()),
            typst: Some(typst.clone()),
            pandoc: Some(pandoc.clone()),
            ..BuildTools::default()
        };
        let compiler = NativeCompiler::new(tools.clone());
        let options = BuildOptions {
            offline: true,
            fast: true,
            halt_on_error: true,
        };

        let tectonic_directory = TempDir::new().unwrap();
        let tectonic_workspace = workspace_for_engine(&tectonic_directory, Engine::Tectonic, None);
        let tectonic_build = tectonic_workspace.prepare_build().unwrap();
        let tectonic_command = compiler.command(&tectonic_build, options).unwrap();
        let tectonic_arguments = arguments(&tectonic_command);
        assert_eq!(tectonic_command.executable, tectonic);
        assert!(tectonic_arguments
            .windows(2)
            .any(|pair| pair == ["-X", "compile"]));
        assert!(tectonic_arguments
            .iter()
            .any(|value| value == "--only-cached"));
        assert!(tectonic_arguments
            .windows(2)
            .any(|pair| pair == ["--reruns", "0"]));
        assert!(!tectonic_arguments
            .iter()
            .any(|value| value == "continue-on-errors"));
        assert!(tectonic_command.produced_output.ends_with("main.pdf"));

        let latexmk_directory = TempDir::new().unwrap();
        let latexmk_workspace =
            workspace_for_engine(&latexmk_directory, Engine::Latexmk, Some("lualatex"));
        let latexmk_build = latexmk_workspace.prepare_build().unwrap();
        let latexmk_command = compiler.command(&latexmk_build, options).unwrap();
        let latexmk_arguments = arguments(&latexmk_command);
        assert_eq!(latexmk_command.executable, latexmk);
        assert!(latexmk_arguments
            .iter()
            .any(|value| value == "-no-shell-escape"));
        assert!(latexmk_arguments.iter().any(|value| value == "-lualatex"));
        assert!(latexmk_arguments
            .iter()
            .any(|value| value == "-halt-on-error"));
        assert!(latexmk_arguments
            .iter()
            .any(|value| value == "-latexoption=--nosocket"));
        assert!(latexmk_arguments
            .iter()
            .any(|value| value == "-jobname=_oleafly_entry"));

        let typst_directory = TempDir::new().unwrap();
        let typst_workspace = workspace_for_engine(&typst_directory, Engine::Typst, None);
        let typst_build = typst_workspace.prepare_build().unwrap();
        let typst_command = compiler.command(&typst_build, options).unwrap();
        let typst_arguments = arguments(&typst_command);
        assert_eq!(typst_command.executable, typst);
        assert_eq!(&typst_arguments[..2], ["--color=never", "compile"]);
        assert!(typst_arguments
            .windows(2)
            .any(|pair| pair == ["--diagnostic-format", "human"]));
        assert!(typst_command
            .produced_output
            .ends_with("_oleafly_entry.pdf"));

        let markdown_directory = TempDir::new().unwrap();
        let markdown_workspace = workspace_for_engine(&markdown_directory, Engine::Markdown, None);
        std::fs::create_dir(markdown_directory.path().join("references")).unwrap();
        std::fs::write(
            markdown_directory.path().join("references/library.bib"),
            "@book{source}",
        )
        .unwrap();
        std::fs::create_dir(markdown_directory.path().join("node_modules")).unwrap();
        std::fs::write(
            markdown_directory.path().join("node_modules/ignored.bib"),
            "@book{ignored}",
        )
        .unwrap();
        let markdown_build = markdown_workspace.prepare_build().unwrap();
        let markdown_command = compiler
            .command_with(
                &markdown_build,
                options,
                &injected_scratch_bases(
                    markdown_directory.path(),
                    markdown_build.build_directory(),
                ),
            )
            .unwrap();
        let markdown_arguments = arguments(&markdown_command);
        assert_eq!(markdown_command.executable, pandoc);
        assert!(markdown_arguments.iter().any(|value| value == "--citeproc"));
        let bibliography = plain_path(markdown_build.project_root())
            .join("references")
            .join("library.bib");
        assert!(markdown_arguments
            .iter()
            .any(|value| value == &format!("--bibliography={}", bibliography.display())));
        assert!(!markdown_arguments
            .iter()
            .any(|value| value.contains("ignored.bib")));
        assert!(markdown_arguments
            .iter()
            .any(|value| value == &format!("--pdf-engine={}", tectonic.display())));

        for engine in [
            Engine::Tectonic,
            Engine::Latexmk,
            Engine::Typst,
            Engine::Markdown,
        ] {
            assert_eq!(
                tools.for_engine(engine),
                match engine {
                    Engine::Tectonic => Some(tectonic.as_path()),
                    Engine::Latexmk => Some(latexmk.as_path()),
                    Engine::Typst => Some(typst.as_path()),
                    Engine::Markdown => Some(pandoc.as_path()),
                }
            );
        }
        assert_eq!(tools.required_for_engine(Engine::Tectonic).len(), 1);
        assert_eq!(tools.required_for_engine(Engine::Latexmk).len(), 1);
        assert_eq!(tools.required_for_engine(Engine::Typst).len(), 1);
        assert_eq!(tools.required_for_engine(Engine::Markdown).len(), 2);
    }

    fn snapshot(root: &Path) -> Vec<(PathBuf, u64, Option<std::time::SystemTime>)> {
        fn visit(
            root: &Path,
            path: &Path,
            out: &mut Vec<(PathBuf, u64, Option<std::time::SystemTime>)>,
        ) {
            let metadata = std::fs::symlink_metadata(path).unwrap();
            out.push((
                path.strip_prefix(root).unwrap().to_path_buf(),
                metadata.len(),
                metadata.modified().ok(),
            ));
            if metadata.is_dir() {
                for entry in std::fs::read_dir(path).unwrap() {
                    visit(root, &entry.unwrap().path(), out);
                }
            }
        }
        let mut out = Vec::new();
        visit(root, root, &mut out);
        out.sort();
        out
    }

    fn outside_the_build_directory(
        entries: Vec<(PathBuf, u64, Option<std::time::SystemTime>)>,
    ) -> Vec<(PathBuf, u64, Option<std::time::SystemTime>)> {
        entries
            .into_iter()
            .filter(|(path, _, _)| !path.starts_with(".oleafly"))
            .collect()
    }

    fn record(executable: &Path) -> BTreeMap<String, String> {
        std::fs::read_to_string(executable.with_extension("record"))
            .unwrap()
            .lines()
            .filter_map(|line| line.split_once('='))
            .map(|(name, value)| (name.to_string(), value.to_string()))
            .collect()
    }

    fn assert_everything_resolved(recorded: &BTreeMap<String, String>) {
        for (name, expected) in [
            ("images", "3"),
            ("images_in_scratch", "2"),
            ("images_from_search_path", "1"),
            ("inputs", "2"),
            ("inputs_from_search_path", "2"),
            ("citation", "true"),
            ("csl", "true"),
            ("cwd_is_tmp", "true"),
        ] {
            assert_eq!(recorded[name], expected, "{name}: {recorded:?}");
        }
    }

    fn project_file(project: &Path, relative: &str, content: &[u8]) {
        let path = project.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    fn markdown_project(root: &Path, name: &str) -> PathBuf {
        const ONE_PIXEL_PNG: [u8; 70] = [
            137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
            8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207,
            192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66,
            96, 130,
        ];
        const MARKER_CSL: &str = concat!(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n",
            "<style xmlns=\"http://purl.org/net/xbiblio/csl\" class=\"in-text\" version=\"1.0\">\n",
            "<info><title>Marker</title><id>marker</id>",
            "<updated>2026-01-01T00:00:00+00:00</updated></info>\n",
            "<citation><layout prefix=\"[CSLMARK \" suffix=\"]\">",
            "<text variable=\"citation-number\"/></layout></citation>\n",
            "<bibliography><layout><text variable=\"title\"/></layout></bibliography>\n",
            "</style>\n",
        );
        let project = root.join(name);
        project_file(
            &project,
            "main.md",
            concat!(
                "---\n",
                "title: Notes\n",
                "csl: styles/marker.csl\n",
                "header-includes:\n",
                "  - \\input{macros}\n",
                "  - \\input{tex/extra}\n",
                "---\n\n",
                "\\MACROTEXT{} and \\EXTRATEXT{}.\n\n",
                "As @knuth shows.\n\n",
                "![Root](root.png)\n\n",
                "![A plot](figs/plot.png)\n\n",
                "\\includegraphics{figs/raw.png}\n",
            )
            .as_bytes(),
        );
        for image in ["root.png", "figs/plot.png", "figs/raw.png"] {
            project_file(&project, image, &ONE_PIXEL_PNG);
        }
        project_file(&project, "macros.tex", b"\\newcommand{\\MACROTEXT}{M}\n");
        project_file(&project, "tex/extra.tex", b"\\newcommand{\\EXTRATEXT}{E}\n");
        project_file(
            &project,
            "sources/refs.bib",
            b"@book{knuth, author={Donald Knuth}, title={KnuthTitle}, year={1984}}\n",
        );
        project_file(&project, "styles/marker.csl", MARKER_CSL.as_bytes());
        project
    }

    fn external_build(root: &Path, name: &str) -> PathBuf {
        let directory = root.join(name);
        std::fs::create_dir_all(&directory).unwrap();
        directory
    }

    fn markdown_manifest() -> ProjectManifest {
        ProjectManifest {
            name: "Pandoc temp".into(),
            main_doc: "main.md".into(),
            engine: Engine::Markdown.manifest_name().into(),
            ..ProjectManifest::default()
        }
    }

    fn real_pandoc() -> Option<PathBuf> {
        let pandoc = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../src-tauri/binaries")
            .join(format!(
                "pandoc-{}{}",
                option_env!("OLEAFLY_BUILD_TARGET")?,
                std::env::consts::EXE_SUFFIX
            ));
        pandoc.is_file().then(|| pandoc.canonicalize().unwrap())
    }

    fn injected_scratch_bases(root: &Path, build: &Path) -> EngineScratchBases {
        let system = root.join("system tmp");
        std::fs::create_dir_all(&system).unwrap();
        EngineScratchBases {
            system,
            owned: Some(root.join("data").join(ENGINE_TEMP_DIR)),
            build: build.to_path_buf(),
        }
    }

    fn hostile_scratch_bases(root: &Path) -> (PathBuf, EngineScratchBases) {
        let system = root.join("tmp #1");
        std::fs::create_dir_all(&system).unwrap();
        let bases = EngineScratchBases {
            system: system.clone(),
            owned: Some(root.join("data {x}").join(ENGINE_TEMP_DIR)),
            build: root.join("build 50%"),
        };
        (system, bases)
    }

    fn fake_markdown_compiler(directory: &Path) -> NativeCompiler {
        let tectonic = directory.join(executable_name("tectonic"));
        let pandoc = directory.join(executable_name("pandoc"));
        let typst = directory.join(executable_name("typst"));
        for tool in [&tectonic, &pandoc, &typst] {
            std::fs::write(tool, "tool").unwrap();
        }
        NativeCompiler::new(BuildTools {
            tectonic: Some(tectonic),
            pandoc: Some(pandoc),
            typst: Some(typst),
            ..BuildTools::default()
        })
    }

    #[test]
    fn markdown_commands_run_pandoc_from_a_fresh_scratch_folder_with_project_paths() {
        let tools_directory = TempDir::new().unwrap();
        let compiler = fake_markdown_compiler(tools_directory.path());
        let root = TempDir::new().unwrap();
        let project = markdown_project(root.path(), "Paper #2 {50% & more}");
        let workspace = Workspace::from_manifest_with_build(
            &project,
            markdown_manifest(),
            oleafly_core::BuildLocation::External(external_build(root.path(), "build")),
        )
        .unwrap();
        let before = snapshot(&project);
        let build = workspace.prepare_build().unwrap();
        let injected = plain_path(&root.path().canonicalize().unwrap());
        let safe_bases = injected_scratch_bases(root.path(), build.build_directory());
        let expected_parent = oleafly_core::tex_safe_path(&injected)
            .then(|| plain_path(&safe_bases.system.canonicalize().unwrap()));
        let first = compiler
            .command_with(&build, BuildOptions::default(), &safe_bases)
            .unwrap();
        let second = compiler
            .command_with(&build, BuildOptions::default(), &safe_bases)
            .unwrap();
        let scratch = |command: &BuildCommand| PathBuf::from(&command.environment[0].1);
        assert_ne!(scratch(&first), scratch(&second));
        assert_eq!(
            first.environment,
            TEMP_DIRECTORY_VARIABLES.map(|name| (name, scratch(&first).into_os_string()))
        );
        assert_eq!(first.working_directory, scratch(&first));
        let project_root = plain_path(build.project_root());
        let first_arguments = arguments(&first);
        assert_eq!(
            first_arguments[0],
            format!("--resource-path={}", project_root.display())
        );
        for expected in [
            format!("--pdf-engine-opt=-Zsearch-path={}", project_root.display()),
            format!(
                "--bibliography={}",
                project_root.join("sources").join("refs.bib").display()
            ),
            project_root.join("main.md").display().to_string(),
        ] {
            assert!(
                first_arguments.contains(&expected),
                "{expected} {first_arguments:?}"
            );
        }
        let first_scratch = scratch(&first);
        assert!(first_scratch.is_dir());
        assert!(first_scratch.starts_with(&injected));
        match &expected_parent {
            Some(parent) => {
                assert_eq!(first_scratch.parent(), Some(parent.as_path()));
                assert!(oleafly_core::tex_safe_path(&first_scratch));
            }
            None => assert!(first_scratch.to_string_lossy().ends_with('~')),
        }
        assert!(!first_scratch.starts_with(&project));
        assert!(!first_scratch.starts_with(project.canonicalize().unwrap()));
        drop(first);
        assert!(!first_scratch.exists());

        let (system, bases) = hostile_scratch_bases(root.path());
        let fallback = compiler
            .command_with(&build, BuildOptions::default(), &bases)
            .unwrap();
        let fallback_scratch = scratch(&fallback);
        assert!(fallback_scratch.to_string_lossy().ends_with('~'));
        assert_eq!(fallback.working_directory, fallback_scratch);
        assert_eq!(arguments(&fallback), first_arguments);
        assert!(std::fs::read_dir(&system).unwrap().next().is_none());
        drop(fallback);
        assert!(!fallback_scratch.exists());
        assert_eq!(snapshot(&project), before);

        let typst_directory = TempDir::new().unwrap();
        let typst_build = workspace_for_engine(&typst_directory, Engine::Typst, None)
            .prepare_build()
            .unwrap();
        let typst_command = compiler
            .command(&typst_build, BuildOptions::default())
            .unwrap();
        assert!(typst_command.environment.is_empty());
        assert_eq!(typst_command.working_directory, typst_build.project_root());
    }

    #[test]
    fn a_pinned_typst_runs_the_resolved_binary_and_a_missing_pin_blocks_the_build() {
        let tools_directory = TempDir::new().unwrap();
        let unpinned = tools_directory.path().join(executable_name("typst"));
        let pinned = tools_directory.path().join("pinned-typst");
        for tool in [&unpinned, &pinned] {
            std::fs::write(tool, "tool").unwrap();
        }
        let typst_directory = TempDir::new().unwrap();
        let build = workspace_for_engine(&typst_directory, Engine::Typst, None)
            .prepare_build()
            .unwrap();
        let mut tools = BuildTools {
            typst: Some(unpinned.clone()),
            ..BuildTools::default()
        };
        let unpinned_arguments = arguments(
            &NativeCompiler::new(tools.clone())
                .command(&build, BuildOptions::default())
                .unwrap(),
        );

        tools.use_pinned_typst(Ok(PinnedTypst {
            path: pinned.clone(),
            capabilities: capabilities_for("0.11.1").clone(),
            version: ToolchainVersion::parse("0.11.1").unwrap(),
        }));
        let command = NativeCompiler::new(tools.clone())
            .command(&build, BuildOptions::default())
            .unwrap();
        assert_eq!(command.executable, pinned);
        assert_eq!(arguments(&command), unpinned_arguments);
        assert_eq!(tools.typst_pin_error(), None);
        assert_eq!(tools.typst_version_label(), "0.11.1");

        tools.use_pinned_typst(Err("this project pins Typst 0.12.0".into()));
        assert_eq!(tools.typst, None);
        let error = NativeCompiler::new(tools.clone())
            .command(&build, BuildOptions::default())
            .err()
            .unwrap();
        assert_eq!(error.kind(), ErrorKind::MissingTool);
        assert_eq!(error.message(), "this project pins Typst 0.12.0");
        assert_eq!(
            tools.typst_pin_error(),
            Some("this project pins Typst 0.12.0")
        );
    }

    #[cfg(windows)]
    #[test]
    fn markdown_commands_hand_pandoc_project_paths_without_the_verbatim_prefix() {
        let tools_directory = TempDir::new().unwrap();
        let compiler = fake_markdown_compiler(tools_directory.path());
        let root = TempDir::new().unwrap();
        let project = markdown_project(root.path(), "Paper");
        let workspace = Workspace::from_manifest(&project, markdown_manifest()).unwrap();
        let build = workspace.prepare_build().unwrap();
        assert!(build.project_root().to_string_lossy().starts_with(r"\\?\"));
        let command = compiler
            .command_with(
                &build,
                BuildOptions::default(),
                &injected_scratch_bases(root.path(), build.build_directory()),
            )
            .unwrap();
        let plain = plain_path(build.project_root());
        assert!(plain
            .to_string_lossy()
            .starts_with(|letter: char| letter.is_ascii_alphabetic()));
        let arguments = arguments(&command);
        for expected in [
            format!("--resource-path={}", plain.display()),
            format!("--pdf-engine-opt=-Zsearch-path={}", plain.display()),
            format!(
                "--bibliography={}",
                plain.join("sources").join("refs.bib").display()
            ),
            format!(
                "--output={}",
                plain
                    .join(".oleafly")
                    .join("build")
                    .join(format!("{OUTPUT_STEM}.pdf"))
                    .display()
            ),
            plain.join("main.md").display().to_string(),
        ] {
            assert!(arguments.contains(&expected), "{expected} {arguments:?}");
        }
        assert!(
            arguments.iter().all(|argument| !argument.contains(r"\\?\")),
            "{arguments:?}"
        );
    }

    #[tokio::test]
    async fn markdown_builds_hand_pandoc_a_scratch_temp_folder_and_remove_it_afterwards() {
        let tools = TempDir::new().unwrap();
        let pandoc =
            crate::support::rust_fixture(tools.path(), "pandoc_recorder.rs", "pandoc", None);
        let tectonic = tools.path().join(executable_name("tectonic"));
        std::fs::write(&tectonic, "tool").unwrap();
        let compiler = NativeCompiler::new(BuildTools {
            pandoc: Some(pandoc.clone()),
            tectonic: Some(tectonic),
            ..BuildTools::default()
        });
        let root = TempDir::new().unwrap();
        let project = markdown_project(
            root.path(),
            if cfg!(windows) {
                "Bob's notes; ${HOME}"
            } else {
                "Bob's notes: ${HOME}"
            },
        );
        let workspace = Workspace::from_manifest_with_build(
            &project,
            markdown_manifest(),
            oleafly_core::BuildLocation::External(external_build(root.path(), "build")),
        )
        .unwrap();
        let before = snapshot(&project);
        let result = compiler
            .build(&workspace, BuildOptions::default())
            .await
            .unwrap();
        assert!(result.ok, "{}", result.log);
        let recorded = record(&pandoc);
        let scratch = PathBuf::from(&recorded["TMP"]);
        for name in TEMP_DIRECTORY_VARIABLES {
            assert_eq!(recorded[name], recorded["TMP"], "{name}");
            assert_eq!(recorded[&format!("{name}_EXISTS")], "true", "{name}");
        }
        assert_eq!(recorded["cwd_is_tmp"], "true");
        assert_eq!(
            recorded["defaults"],
            r#"{"resource-path":["${OLEAFLY_PANDOC_RESOURCE_PATH}"]}"#
        );
        assert_eq!(
            PathBuf::from(&recorded["resource_path"]),
            plain_path(&project.canonicalize().unwrap())
        );
        assert!(scratch
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("oleafly-engine-"));
        assert!(!scratch.exists());
        assert!(!scratch.starts_with(project.canonicalize().unwrap()));
        assert_eq!(snapshot(&project), before);
    }

    #[tokio::test]
    async fn real_pandoc_builds_markdown_in_a_folder_whose_name_tex_cannot_read() {
        let Some(pandoc) = real_pandoc() else {
            return;
        };
        let tools = TempDir::new().unwrap();
        let tectonic =
            crate::support::rust_fixture(tools.path(), "tex_checker.rs", "tectonic", None);
        let compiler = NativeCompiler::new(BuildTools {
            pandoc: Some(pandoc),
            tectonic: Some(tectonic.clone()),
            ..BuildTools::default()
        });
        let root = TempDir::new().unwrap();
        let project = markdown_project(root.path(), "Paper #2 {50% & more}");
        let in_tree = Workspace::from_manifest(&project, markdown_manifest()).unwrap();
        in_tree.prepare_build().unwrap();
        let before = snapshot(&project);
        let external = Workspace::from_manifest_with_build(
            &project,
            markdown_manifest(),
            oleafly_core::BuildLocation::External(external_build(root.path(), "build")),
        )
        .unwrap();
        for workspace in [&external, &in_tree] {
            let result = compiler
                .build(workspace, BuildOptions::default())
                .await
                .unwrap();
            assert!(result.ok, "{}", result.log);
            assert!(result.output.is_some_and(|output| output.is_file()));
            let recorded = record(&tectonic);
            assert_everything_resolved(&recorded);
            assert_eq!(recorded["outdir_relative"], "false");
            let scratch = PathBuf::from(&recorded["TMP"]);
            assert!(scratch
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("oleafly-engine-"));
            assert!(Path::new(&recorded["outdir"]).starts_with(&scratch));
            assert!(!scratch.exists());
        }
        assert_eq!(
            outside_the_build_directory(snapshot(&project)),
            outside_the_build_directory(before)
        );
    }

    async fn run_markdown_command(
        command: &BuildCommand,
        extra: Option<(&'static str, OsString)>,
    ) -> (String, Option<i32>) {
        let mut environment = command.environment.clone();
        environment.extend(extra);
        run_command(
            &command.executable,
            &command.arguments,
            &command.working_directory,
            &environment,
            Duration::from_secs(60),
            &CompilerLog::default(),
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn real_pandoc_uses_relative_media_paths_when_no_temp_folder_is_safe_for_tex() {
        let Some(pandoc) = real_pandoc() else {
            return;
        };
        let tools = TempDir::new().unwrap();
        let tectonic =
            crate::support::rust_fixture(tools.path(), "tex_checker.rs", "tectonic", None);
        let compiler = NativeCompiler::new(BuildTools {
            pandoc: Some(pandoc),
            tectonic: Some(tectonic.clone()),
            ..BuildTools::default()
        });
        let root = TempDir::new().unwrap();
        let project = markdown_project(root.path(), "Paper #2 {50% & more}");
        let workspace = Workspace::from_manifest_with_build(
            &project,
            markdown_manifest(),
            oleafly_core::BuildLocation::External(external_build(root.path(), "linked 50%")),
        )
        .unwrap();
        let before = snapshot(&project);
        let build = workspace.prepare_build().unwrap();
        let (system, bases) = hostile_scratch_bases(root.path());
        let command = compiler
            .command_with(&build, BuildOptions::default(), &bases)
            .unwrap();
        let scratch = command.working_directory.clone();
        assert!(scratch.to_string_lossy().ends_with('~'));
        let (log, code) = run_markdown_command(&command, None).await;
        assert_eq!(code, Some(0), "{log}");
        let recorded = record(&tectonic);
        assert_everything_resolved(&recorded);
        assert_eq!(recorded["outdir_relative"], "true");
        assert!(Path::new(&recorded["outdir"])
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("media-"));
        assert!(build
            .build_directory()
            .join(format!("{OUTPUT_STEM}.pdf"))
            .is_file());
        assert!(std::fs::read_dir(&system).unwrap().next().is_none());
        assert_eq!(snapshot(&project), before);
        drop(command);
        assert!(!scratch.exists());
    }

    #[tokio::test]
    async fn real_pandoc_with_a_cygwin_uname_on_the_path_writes_nothing_into_the_project() {
        let Some(pandoc) = real_pandoc() else {
            return;
        };
        let tools = TempDir::new().unwrap();
        let tectonic =
            crate::support::rust_fixture(tools.path(), "tex_checker.rs", "tectonic", None);
        let cygwin = TempDir::new().unwrap();
        crate::support::rust_fixture(cygwin.path(), "cygwin_uname.rs", "uname", None);
        let compiler = NativeCompiler::new(BuildTools {
            pandoc: Some(pandoc),
            tectonic: Some(tectonic.clone()),
            ..BuildTools::default()
        });
        let root = TempDir::new().unwrap();
        let project = markdown_project(root.path(), "Cygwin notes");
        let workspace = Workspace::from_manifest_with_build(
            &project,
            markdown_manifest(),
            oleafly_core::BuildLocation::External(external_build(root.path(), "build")),
        )
        .unwrap();
        let before = snapshot(&project);
        let build = workspace.prepare_build().unwrap();
        let command = compiler
            .command_with(
                &build,
                BuildOptions::default(),
                &injected_scratch_bases(root.path(), build.build_directory()),
            )
            .unwrap();
        let scratch = command.working_directory.clone();
        let inherited = std::env::var_os("PATH").unwrap_or_default();
        let path = std::env::join_paths(
            std::iter::once(cygwin.path().to_path_buf()).chain(std::env::split_paths(&inherited)),
        )
        .unwrap();
        let (log, code) = run_markdown_command(&command, Some(("PATH", path))).await;
        assert_eq!(code, Some(0), "{log}");
        let recorded = record(&tectonic);
        assert_everything_resolved(&recorded);
        assert_eq!(recorded["outdir_relative"], "true");
        assert_eq!(snapshot(&project), before);
        drop(command);
        assert!(!scratch.exists());
    }

    async fn assert_real_pandoc_finds_project_files_in(names: &[&str]) {
        let Some(pandoc) = real_pandoc() else {
            return;
        };
        let tools = TempDir::new().unwrap();
        let tectonic =
            crate::support::rust_fixture(tools.path(), "tex_checker.rs", "tectonic", None);
        let compiler = NativeCompiler::new(BuildTools {
            pandoc: Some(pandoc),
            tectonic: Some(tectonic.clone()),
            ..BuildTools::default()
        });
        let root = TempDir::new().unwrap();
        for name in names {
            let project = markdown_project(root.path(), name);
            let workspace = Workspace::from_manifest(&project, markdown_manifest()).unwrap();
            let build = workspace.prepare_build().unwrap();
            let before = snapshot(&project);
            let command = compiler
                .command_with(
                    &build,
                    BuildOptions::default(),
                    &injected_scratch_bases(root.path(), build.build_directory()),
                )
                .unwrap();
            let scratch = command.working_directory.clone();
            let (log, code) = run_markdown_command(&command, None).await;
            assert_eq!(code, Some(0), "{name}: {log}");
            assert!(!log.contains("Could not fetch resource"), "{name}: {log}");
            assert_everything_resolved(&record(&tectonic));
            assert!(
                build
                    .build_directory()
                    .join(format!("{OUTPUT_STEM}.pdf"))
                    .is_file(),
                "{name}"
            );
            drop(command);
            assert!(!scratch.exists(), "{name}");
            assert_eq!(
                outside_the_build_directory(snapshot(&project)),
                outside_the_build_directory(before),
                "{name}"
            );
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_finds_project_files_when_the_folder_name_has_a_colon_or_a_variable() {
        assert_real_pandoc_finds_project_files_in(&[
            "Thesis 2024:25",
            "Notes ${HOME} x",
            "Draft 1:2 ${HOME} $x ${.} ${USERDATA} ${OLEAFLY_UNDEFINED}",
        ])
        .await;
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn real_pandoc_finds_project_files_when_the_folder_name_has_a_semicolon_or_a_variable() {
        assert_real_pandoc_finds_project_files_in(&[
            "Smith; Jones",
            "Notes ${USERPROFILE} x",
            "Draft 1;2 ${HOME} $x ${.} ${USERDATA} ${OLEAFLY_UNDEFINED}",
        ])
        .await;
    }

    #[test]
    fn compiler_commands_reject_unsafe_or_incomplete_toolchains() {
        let project = TempDir::new().unwrap();
        let workspace = workspace_for_engine(&project, Engine::Tectonic, None);
        let prepared = workspace.prepare_build().unwrap();
        let local_tool = project.path().join(executable_name("tectonic"));
        std::fs::write(&local_tool, "tool").unwrap();
        let error = match NativeCompiler::new(BuildTools {
            tectonic: Some(local_tool),
            ..BuildTools::default()
        })
        .command(&prepared, BuildOptions::default())
        {
            Ok(_) => panic!("project-local compiler was accepted"),
            Err(error) => error,
        };
        assert_eq!(error.kind(), ErrorKind::UnsafePath);

        let tools_directory = TempDir::new().unwrap();
        let pandoc = tools_directory.path().join(executable_name("pandoc"));
        std::fs::write(&pandoc, "tool").unwrap();
        let markdown_project = TempDir::new().unwrap();
        let markdown = workspace_for_engine(&markdown_project, Engine::Markdown, None);
        let error = match NativeCompiler::new(BuildTools {
            pandoc: Some(pandoc),
            ..BuildTools::default()
        })
        .command(&markdown.prepare_build().unwrap(), BuildOptions::default())
        {
            Ok(_) => panic!("incomplete Markdown toolchain was accepted"),
            Err(error) => error,
        };
        assert_eq!(error.kind(), ErrorKind::MissingTool);
        assert!(error.to_string().contains("both pandoc and tectonic"));
    }

    #[test]
    fn tex_errors_include_line_numbers() {
        let errors = parse_tex_errors("! Undefined control sequence.\nl.42 \\badcommand");
        assert_eq!(errors[0].line, Some(42));
        assert_eq!(errors[0].kind, "error");
    }

    #[test]
    fn diagnostics_preserve_each_engines_user_visible_shape() {
        let typst = parse_errors(
            Engine::Typst,
            "paper.typ:7:2: error: broken\nC:\\paper.typ:8:3: warning: careful\nnoise",
        );
        assert_eq!(typst.len(), 2);
        assert_eq!(typst[0].file.as_deref(), Some("paper.typ"));
        assert_eq!(typst[0].line, Some(7));
        assert_eq!(typst[0].column, Some(3));
        assert_eq!(typst[1].kind, "warning");
        assert_eq!(typst[1].file.as_deref(), Some("C:\\paper.typ"));
        assert_eq!((typst[1].line, typst[1].column), (Some(8), Some(4)));

        let markdown = parse_errors(
            Engine::Markdown,
            "warning: missing title\npandoc: failed to render\nordinary output",
        );
        assert_eq!(markdown.len(), 2);
        assert_eq!(markdown[0].kind, "warning");
        assert_eq!(markdown[1].kind, "error");

        let tectonic = parse_errors(
            Engine::Tectonic,
            "! First error\nl.12 \\first\n! Second error\nwithout a line",
        );
        assert_eq!(tectonic[0].line, Some(12));
        assert_eq!(tectonic[1].line, None);
        assert_eq!(parse_errors(Engine::Latexmk, "normal output"), Vec::new());
    }

    const TYPST_LOGS: [(&str, &str); 6] = [
        (
            "0.11.1",
            include_str!("../../oleafly-core/tests/fixtures/typst-log/0.11.1.log"),
        ),
        (
            "0.12.0",
            include_str!("../../oleafly-core/tests/fixtures/typst-log/0.12.0.log"),
        ),
        (
            "0.13.1",
            include_str!("../../oleafly-core/tests/fixtures/typst-log/0.13.1.log"),
        ),
        (
            "0.14.2",
            include_str!("../../oleafly-core/tests/fixtures/typst-log/0.14.2.log"),
        ),
        (
            "0.15.0",
            include_str!("../../oleafly-core/tests/fixtures/typst-log/0.15.0.log"),
        ),
        (
            "0.15.1",
            include_str!("../../oleafly-core/tests/fixtures/typst-log/0.15.1.log"),
        ),
    ];

    fn typst_log_case(log: &str, name: &str) -> String {
        let marker = format!("=== {name}\n");
        let start = log.find(&marker).expect("fixture case") + marker.len();
        let rest = &log[start..];
        rest[..rest.find("=== ").unwrap_or(rest.len())].to_owned()
    }

    #[test]
    fn typst_human_diagnostics_keep_hints_columns_and_the_calling_line() {
        let errors = parse_errors(
            Engine::Typst,
            "error: unknown variable: foo\n  \u{250c}\u{2500} main.typ:3:1\n  \u{2502}\n3 \u{2502} $foo$ and text.\n  \u{2502}  ^^^\n  \u{2502}\n  = hint: try adding spaces: `f o o`\n  = hint: or quote it: `\"foo\"`\n\nwarning: unknown font family: x\n  \u{250c}\u{2500} C:\\Users\\ada\\paper\\chapters\\intro.typ:1:16\n  \u{2502}\n1 \u{2502} #set text(font: \"X\")\n  \u{2502}                 ^^^\n\n",
        );
        assert_eq!(
            errors,
            [
                BuildError {
                    line: Some(3),
                    file: Some("main.typ".into()),
                    message: "unknown variable: foo".into(),
                    kind: "error".into(),
                    column: Some(2),
                    hints: vec![
                        "try adding spaces: `f o o`".into(),
                        "or quote it: `\"foo\"`".into(),
                    ],
                },
                BuildError {
                    line: Some(1),
                    file: Some("C:\\Users\\ada\\paper\\chapters\\intro.typ".into()),
                    message: "unknown font family: x".into(),
                    kind: "warning".into(),
                    column: Some(17),
                    hints: Vec::new(),
                },
            ]
        );
        for (version, log) in TYPST_LOGS {
            let traced = parse_errors(Engine::Typst, &typst_log_case(log, "package_trace"));
            assert_eq!(traced.len(), 1, "{version}");
            assert_eq!(traced[0].file.as_deref(), Some("main.typ"), "{version}");
            assert_eq!((traced[0].line, traced[0].column), (Some(4), Some(2)));
            let case = typst_log_case(log, "math_hints");
            let hinted = parse_errors(Engine::Typst, &case);
            assert_eq!(hinted[0].message, "unknown variable: foo", "{version}");
            assert_eq!(hinted[0].column, Some(2), "{version}");
            assert_eq!(
                hinted[0].hints.len(),
                case.matches("= hint:").count(),
                "{version}"
            );
        }
    }

    #[test]
    fn an_unpinned_typst_uses_the_capabilities_of_the_version_it_reports() {
        let mut tools = BuildTools::default();
        assert_eq!(
            tools.typst_capabilities(),
            capabilities_for(&bundled_typst_version().to_string())
        );
        assert_eq!(
            tools.typst_version_label(),
            bundled_typst_version().to_string()
        );
        tools.use_typst_version(ToolchainVersion::parse("0.11.1"));
        assert_eq!(tools.typst_capabilities(), capabilities_for("0.11.1"));
        assert_eq!(tools.typst_version_label(), "0.11.1");
        tools.use_typst_version(None);
        assert_eq!(
            tools.typst_capabilities(),
            capabilities_for(&bundled_typst_version().to_string())
        );
    }

    #[test]
    fn typst_commands_carry_the_project_settings_the_version_supports() {
        let tools_directory = TempDir::new().unwrap();
        let typst = tools_directory.path().join(executable_name("typst"));
        std::fs::write(&typst, "tool").unwrap();
        let project = TempDir::new().unwrap();
        let build = workspace_for_engine(&project, Engine::Typst, None)
            .prepare_build()
            .unwrap();
        let settings = TypstSettings {
            packages: Some(crate::typst_settings::PackageDirs {
                package_path: PathBuf::from("/data/typst/packages"),
                cache_path: PathBuf::from("/data/typst/packages-cache"),
            }),
            font_dirs: vec![PathBuf::from("/project/fonts")],
            ignore_system_fonts: true,
            inputs: vec![("draft".into(), "true".into())],
            creation_timestamp: Some(7),
            offline: true,
        };
        let mut tools = BuildTools {
            typst: Some(typst),
            ..BuildTools::default()
        };
        let command = |tools: &BuildTools| {
            NativeCompiler::new(tools.clone())
                .with_typst_settings(settings.clone())
                .command(&build, BuildOptions::default())
                .unwrap()
        };
        let current = command(&tools);
        let current_arguments = arguments(&current);
        for pair in [
            ["--package-path", "/data/typst/packages"],
            ["--package-cache-path", "/data/typst/packages-cache"],
            ["--font-path", "/project/fonts"],
            ["--input", "draft=true"],
            ["--creation-timestamp", "7"],
        ] {
            assert!(
                current_arguments.windows(2).any(|window| window == pair),
                "{pair:?} {current_arguments:?}"
            );
        }
        assert!(current_arguments.contains(&"--ignore-system-fonts".to_string()));
        let environment: BTreeMap<&str, String> = current
            .environment
            .iter()
            .map(|(name, value)| (*name, value.to_string_lossy().into_owned()))
            .collect();
        assert_eq!(environment["TYPST_PACKAGE_PATH"], "/data/typst/packages");
        assert_eq!(environment["SOURCE_DATE_EPOCH"], "7");
        assert_eq!(environment["HTTPS_PROXY"], "http://127.0.0.1:9");

        tools.use_typst_version(ToolchainVersion::parse("0.11.1"));
        let old_arguments = arguments(&command(&tools));
        for absent in [
            "--package-path",
            "--package-cache-path",
            "--ignore-system-fonts",
            "--creation-timestamp",
        ] {
            assert!(!old_arguments.iter().any(|argument| argument == absent));
        }
        assert!(old_arguments
            .windows(2)
            .any(|window| window == ["--input", "draft=true"]));
    }

    fn real_typst() -> Option<PathBuf> {
        let typst = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../src-tauri/binaries")
            .join(format!(
                "typst-{}{}",
                option_env!("OLEAFLY_BUILD_TARGET")?,
                std::env::consts::EXE_SUFFIX
            ));
        typst.is_file().then(|| typst.canonicalize().unwrap())
    }

    #[tokio::test]
    async fn real_typst_builds_with_vendored_packages_and_variant_inputs_offline() {
        let Some(typst) = real_typst() else {
            return;
        };
        let project = TempDir::new().unwrap();
        let data = TempDir::new().unwrap();
        let package = "typst-packages/local/greet/0.1.0";
        project_file(
            project.path(),
            &format!("{package}/typst.toml"),
            b"[package]\nname = \"greet\"\nversion = \"0.1.0\"\nentrypoint = \"lib.typ\"\n",
        );
        project_file(
            project.path(),
            &format!("{package}/lib.typ"),
            b"#let hello(name) = [Hello #name]\n",
        );
        project_file(
            project.path(),
            "main.typ",
            b"#import \"@local/greet:0.1.0\": hello\n#assert.eq(sys.inputs.at(\"who\"), \"reviewer\")\n#hello(sys.inputs.at(\"who\"))\n",
        );
        let spec: oleafly_core::TypstSpec = serde_json::from_value(serde_json::json!({
            "vendor_packages": true,
            "inputs": {"who": "everyone"},
            "variants": {"review": {"inputs": {"who": "reviewer"}}}
        }))
        .unwrap();
        let workspace = Workspace::from_manifest(
            project.path(),
            ProjectManifest {
                main_doc: "main.typ".into(),
                engine: "typst".into(),
                typst: Some(spec.clone()),
                ..ProjectManifest::default()
            },
        )
        .unwrap();
        let settings = |variant: Option<&str>| {
            TypstSettings::resolve(&crate::typst_settings::SettingsRequest {
                spec: Some(&spec),
                project_root: workspace.root(),
                data_root: Some(data.path()),
                variant,
                offline: true,
                commit_time: None,
            })
        };
        let compiler = |variant: Option<&str>| {
            NativeCompiler::new(BuildTools {
                typst: Some(typst.clone()),
                ..BuildTools::default()
            })
            .with_typst_settings(settings(variant))
        };
        let result = compiler(Some("review"))
            .build(&workspace, BuildOptions::default())
            .await
            .unwrap();
        assert!(result.ok, "{}", result.log);
        assert!(result.output.is_some_and(|output| output.is_file()));

        let base = compiler(None)
            .build(&workspace, BuildOptions::default())
            .await
            .unwrap();
        assert!(!base.ok);
        assert!(
            base.errors[0].message.contains("assertion"),
            "{:?}",
            base.errors
        );

        std::fs::write(
            project.path().join("main.typ"),
            "= Draft\n\n$foo$ and text.\n",
        )
        .unwrap();
        let failed = compiler(None)
            .build(&workspace, BuildOptions::default())
            .await
            .unwrap();
        assert!(!failed.ok);
        let error = &failed.errors[0];
        assert_eq!(error.message, "unknown variable: foo", "{}", failed.log);
        assert_eq!(error.file.as_deref(), Some("main.typ"));
        assert_eq!((error.line, error.column), (Some(3), Some(2)));
        assert!(!error.hints.is_empty(), "{}", failed.log);
    }

    #[test]
    fn compiler_output_is_utf8_safe_and_bounded() {
        let mut output = "x".repeat(MAX_LOG_BYTES - 1);
        append_bounded(&mut output, "éclair".as_bytes());
        assert_eq!(output.len(), MAX_LOG_BYTES);
        assert!(output.ends_with(LOG_TRUNCATION_MARKER));
        assert!(!output.contains('é'));
        let length = output.len();
        append_bounded(&mut output, b"ignored");
        assert_eq!(output.len(), length);

        let mut exact = "x".repeat(MAX_LOG_BYTES);
        append_bounded(&mut exact, b"");
        assert!(!exact.ends_with(LOG_TRUNCATION_MARKER));
        append_bounded(&mut exact, b"overflow");
        assert_eq!(exact.len(), MAX_LOG_BYTES);
        assert!(exact.ends_with(LOG_TRUNCATION_MARKER));
    }

    #[test]
    fn output_cleanup_is_idempotent() {
        let directory = TempDir::new().unwrap();
        let missing = directory.path().join("missing.pdf");
        remove_if_exists(&missing).unwrap();
        std::fs::write(&missing, "generated").unwrap();
        remove_if_exists(&missing).unwrap();
        assert!(!missing.exists());
    }

    #[tokio::test]
    async fn native_build_publishes_success_and_clears_failed_output() {
        let tools_directory = TempDir::new().unwrap();
        let project = TempDir::new().unwrap();
        let workspace = workspace_for_engine(&project, Engine::Tectonic, None);
        let success_compiler = NativeCompiler::new(BuildTools {
            tectonic: Some(compiler_fixture(&tools_directory, false)),
            ..BuildTools::default()
        });

        let result = success_compiler
            .build(&workspace, BuildOptions::default())
            .await
            .unwrap();
        assert!(result.ok);
        assert!(result.log.contains("fixture-ok"));
        assert!(result.errors.is_empty());
        assert!(result
            .output
            .as_ref()
            .is_some_and(|path| path.ends_with("_oleafly_entry.pdf") && path.is_file()));
        assert!(result
            .output_id
            .as_deref()
            .is_some_and(|value| value.starts_with("pdf-sha256:")));

        let failed_compiler = NativeCompiler::new(BuildTools {
            tectonic: Some(compiler_fixture(&tools_directory, true)),
            ..BuildTools::default()
        });
        let result = failed_compiler
            .build(&workspace, BuildOptions::default())
            .await
            .unwrap();
        assert!(!result.ok);
        assert_eq!(result.output, None);
        assert_eq!(result.output_id, None);
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].message, "Fixture failure");
        assert!(!workspace
            .build_dir_path()
            .join("_oleafly_entry.pdf")
            .exists());
    }

    fn image_project(engine: Engine, main: &str) -> (TempDir, Workspace) {
        let project = TempDir::new().unwrap();
        let workspace = workspace_for_engine(&project, engine, None);
        std::fs::write(project.path().join(engine.default_main_document()), main).unwrap();
        std::fs::create_dir_all(project.path().join("figures")).unwrap();
        std::fs::write(project.path().join("figures/plot.png"), b"").unwrap();
        std::fs::write(project.path().join("figures/unused.png"), b"").unwrap();
        (project, workspace)
    }

    const EMPTY_PLOT: &str =
        "The image figures/plot.png is empty. Export the image again or replace the file.";

    #[tokio::test]
    async fn failed_tex_builds_name_a_broken_image_in_the_log_errors_and_stream() {
        let (_project, workspace) = image_project(Engine::Tectonic, "document");
        let streamed = Arc::new(Mutex::new(String::new()));
        let sink = streamed.clone();
        let compiler =
            NativeCompiler::new(BuildTools::default()).with_log(CompilerLog::new(move |text| {
                sink.lock().unwrap().push_str(text)
            }));
        let build = workspace.prepare_build().unwrap();
        let mut log = "! Unable to load picture or PDF file 'figures/plot.png'.\nl.6 \\includegraphics{figures/plot.png}\n".to_string();
        let mut errors = parse_errors(Engine::Tectonic, &log);
        let original = errors.clone();
        compiler
            .explain_image_failures(&build, &mut log, &mut errors)
            .await;
        let note = format!("\n[Oleafly] {EMPTY_PLOT}\n");
        assert_eq!(
            errors[0],
            BuildError {
                line: None,
                file: None,
                message: EMPTY_PLOT.into(),
                kind: "error".into(),
                column: None,
                hints: Vec::new(),
            }
        );
        assert_eq!(errors[1..], original[..]);
        assert!(log.ends_with(&note));
        assert_eq!(*streamed.lock().unwrap(), note);
    }

    #[tokio::test]
    async fn failures_without_image_evidence_keep_their_log_and_errors() {
        let (_project, workspace) =
            image_project(Engine::Tectonic, "\\includegraphics{figures/plot.png}");
        let compiler = NativeCompiler::new(BuildTools::default());
        let build = workspace.prepare_build().unwrap();
        for original in [
            "! Fixture failure",
            "! Undefined control sequence.\nl.4 \\foo\nlibpng warning: iCCP: known incorrect sRGB profile\n",
        ] {
            let mut log = original.to_string();
            let mut errors = parse_errors(Engine::Tectonic, &log);
            let before = errors.clone();
            compiler
                .explain_image_failures(&build, &mut log, &mut errors)
                .await;
            assert_eq!(log, original);
            assert_eq!(errors, before);
        }
    }

    #[test]
    fn image_check_runs_only_for_failed_tex_builds() {
        assert!(image_check_applies(false, Engine::Tectonic));
        assert!(image_check_applies(false, Engine::Latexmk));
        assert!(!image_check_applies(true, Engine::Tectonic));
        assert!(!image_check_applies(true, Engine::Latexmk));
        assert!(!image_check_applies(false, Engine::Typst));
        assert!(!image_check_applies(false, Engine::Markdown));
    }

    #[tokio::test]
    async fn native_builds_explain_broken_images_only_when_a_tex_build_fails() {
        let tools = TempDir::new().unwrap();
        let success = NativeCompiler::new(BuildTools {
            tectonic: Some(compiler_fixture(&tools, false)),
            ..BuildTools::default()
        });
        let failure = NativeCompiler::new(BuildTools {
            tectonic: Some(compiler_fixture(&tools, true)),
            ..BuildTools::default()
        });
        let with_evidence = "\\includegraphics{figures/plot.png}\n% fixture-libpng-error\n";
        let (_project, workspace) = image_project(Engine::Tectonic, with_evidence);

        let result = success
            .build(&workspace, BuildOptions::default())
            .await
            .unwrap();
        assert!(result.ok);
        assert!(result.log.contains("libpng error: IHDR: CRC error"));
        assert!(!result.log.contains("[Oleafly]"));
        assert!(result.errors.is_empty());

        let result = failure
            .build(&workspace, BuildOptions::default())
            .await
            .unwrap();
        assert!(!result.ok);
        assert_eq!(
            result
                .errors
                .iter()
                .map(|error| error.message.as_str())
                .collect::<Vec<_>>(),
            [EMPTY_PLOT]
        );
        assert!(result.log.ends_with(&format!("\n[Oleafly] {EMPTY_PLOT}\n")));

        let (_project, workspace) =
            image_project(Engine::Tectonic, "\\includegraphics{figures/plot.png}\n");
        let result = failure
            .build(&workspace, BuildOptions::default())
            .await
            .unwrap();
        assert!(!result.ok);
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].message, "Fixture failure");
        assert!(!result.log.contains("[Oleafly]"));
    }

    #[tokio::test]
    async fn native_compiler_rejects_missing_tools() {
        let directory = TempDir::new().unwrap();
        let workspace = Workspace::init(directory.path(), InitOptions::default()).unwrap();
        let compiler = NativeCompiler::new(BuildTools::default());
        let error = compiler
            .build(&workspace, BuildOptions::default())
            .await
            .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::MissingTool);
    }

    #[tokio::test]
    async fn contained_command_captures_output() {
        let executable = std::env::current_exe().unwrap();
        let arguments = [
            OsString::from("--exact"),
            OsString::from("native::tests::contained_command_child"),
            OsString::from("--nocapture"),
        ];
        let working_directory = TempDir::new().unwrap();
        let captured = Arc::new(Mutex::new(String::new()));
        let captured_output = Arc::clone(&captured);
        let sink = CompilerLog::new(move |value| {
            captured_output.lock().unwrap().push_str(value);
        });
        let (output, status) = run_command(
            &executable,
            &arguments,
            working_directory.path(),
            &[],
            Duration::from_secs(60),
            &sink,
        )
        .await
        .unwrap();
        assert_eq!(status, Some(0));
        assert!(output.contains("core-ok"));
        assert!(captured.lock().unwrap().contains("core-ok"));
    }

    #[test]
    fn contained_command_child() {
        print!("core-ok");
    }

    #[tokio::test]
    async fn compiler_deadline_covers_a_process_with_closed_output_on_windows_too() {
        let directory = TempDir::new().unwrap();
        let started = Instant::now();
        let arguments = [
            OsString::from("-e"),
            OsString::from(
                "require('fs').closeSync(1);require('fs').closeSync(2);setInterval(()=>{},1000)",
            ),
        ];
        let error = run_command(
            Path::new("node"),
            &arguments,
            directory.path(),
            &[],
            Duration::from_millis(250),
            &CompilerLog::default(),
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[tokio::test]
    async fn compiler_completion_stops_descendants_holding_log_pipes() {
        let directory = TempDir::new().unwrap();
        let arguments = [OsString::from("-e"), OsString::from(
            "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',1,2]});process.stdout.write('compiled');process.exit(0)")];
        let (output, status) = run_command(
            Path::new("node"),
            &arguments,
            directory.path(),
            &[],
            Duration::from_secs(60),
            &CompilerLog::default(),
        )
        .await
        .unwrap();
        assert_eq!(status, Some(0));
        assert_eq!(output, "compiled");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn contained_command_times_out() {
        let shell = PathBuf::from("/bin/sh").canonicalize().unwrap();
        let arguments = [OsString::from("-c"), OsString::from("sleep 30")];
        let error = run_command(
            &shell,
            &arguments,
            Path::new("/"),
            &[],
            Duration::from_millis(50),
            &CompilerLog::default(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::Build);
        assert!(error.to_string().contains("timed out"));
    }

    #[test]
    fn latexmk_runs_in_the_compile_directory_and_writes_to_the_build_directory() {
        let tools_directory = TempDir::new().unwrap();
        let latexmk = tools_directory.path().join(executable_name("latexmk"));
        std::fs::write(&latexmk, "tool").unwrap();
        let compiler = NativeCompiler::new(BuildTools {
            latexmk: Some(latexmk),
            ..BuildTools::default()
        });
        let directory = TempDir::new().unwrap();
        std::fs::create_dir(directory.path().join("paper")).unwrap();
        std::fs::write(directory.path().join("paper/main.tex"), "document").unwrap();
        let manifest = ProjectManifest {
            main_doc: "paper/main.tex".into(),
            engine: "latexmk".into(),
            tex_flavor: Some("pdflatex".into()),
            ..ProjectManifest::default()
        };
        let root = Workspace::from_manifest(directory.path(), manifest.clone()).unwrap();
        let root_command = compiler
            .command(&root.prepare_build().unwrap(), BuildOptions::default())
            .unwrap();
        let root_arguments = arguments(&root_command);
        assert!(root_arguments.contains(&"-outdir=./.oleafly/build".to_string()));
        assert_eq!(root_arguments.last().unwrap(), "./paper/main.tex");
        assert_eq!(root_command.working_directory, root.root());

        let nested = Workspace::from_manifest(
            directory.path(),
            ProjectManifest {
                compile_dir: Some("paper".into()),
                ..manifest
            },
        )
        .unwrap();
        let nested_command = compiler
            .command(&nested.prepare_build().unwrap(), BuildOptions::default())
            .unwrap();
        let nested_arguments = arguments(&nested_command);
        assert!(nested_arguments.contains(&"-outdir=../.oleafly/build".to_string()));
        assert_eq!(nested_arguments.last().unwrap(), "./main.tex");
        assert_eq!(
            nested_command.working_directory,
            nested.root().join("paper")
        );
    }

    #[test]
    fn relative_paths_climb_out_of_the_compile_directory() {
        assert_eq!(
            relative_to(Path::new("/p/paper/sub"), Path::new("/p/.oleafly/build")),
            Some(PathBuf::from("../../.oleafly/build"))
        );
        assert_eq!(
            relative_to(Path::new("/p"), Path::new("/p/.oleafly/build")),
            Some(PathBuf::from(".oleafly/build"))
        );
        assert_eq!(dotted(Path::new(".oleafly/build")), "./.oleafly/build");
        assert_eq!(dotted(Path::new("../.oleafly/build")), "../.oleafly/build");
    }
}
