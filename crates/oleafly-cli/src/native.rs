use crate::app_paths::InstalledApp;
use crate::contract::{CliError, ErrorKind as CliErrorKind};
use crate::process;
use crate::typst::PinnedTypst;
use crate::typst_settings::TypstSettings;
use oleafly_core::biber_env::{
    biber_message_excerpt, compile_path_env, first_biber_on, path_with_first, prepare_unpack_dir,
    runnable_biber_dir, tectonic_biber_in, UNPACK_ENV,
};
use oleafly_core::build_output::{
    clear_biber_source_copies, locks_unsupported, sweep_stale_staging, ArtifactSnapshot, BuildLock,
    DirLock, OutputStaging,
};
use oleafly_core::compile_limit::{extended_limit, CompileClock};
use oleafly_core::engine_spec::{
    self, bundle_fetch_excerpt, bundle_retry_needed, bundle_retry_replaces_first_run,
    compiler_crash_note, latex_entry_source_with, tex_bundle_url, write_markdown_filters,
    EngineFlags, MarkdownPdfArgs, BUNDLE_FALLBACK_NOTE, ENTRY_STEM, ENTRY_TEX,
    MARKDOWN_TYPST_VARIABLE, TECTONIC_CACHE_DIR_ARGS,
};
use oleafly_core::pandoc::{
    pandoc_candidates, pandoc_version_supported, parse_pandoc_version, PandocSearch,
    MIN_PANDOC_VERSION,
};
use oleafly_core::process_probe::{probe_output, PROBE_TIMEOUT};
use oleafly_core::tex_distro::{distribution_for_tool, find_tool_in_dir, TexSearch};
use oleafly_core::tex_errors::{
    latexmk_tool_error, parse_pandoc_diagnostics, parse_tectonic_log_errors, parse_tex_log_errors,
    rebase_log_files, resolve_extensionless_inputs, CompileError, ENGINE_OUTPUT_MARKER,
};
use oleafly_core::tex_failure::{blocked_shell_escape, tex_failure_reason, DeniedShellEscape};
use oleafly_core::tex_outputs::{
    bibliography_above_main_error, jobname_bibliography_warning, latexmk_biber_mismatch_error,
    nested_input_error, seed_shipped_bibliography, shipped_bibliography, shipped_bibliography_note,
    source_head, unbuilt_index_warnings, unicode_engine_error,
};
use oleafly_core::typst_log::{parse_typst_diagnostics, typst_path_relative_to};
use oleafly_core::typst_toolchain::{
    bundled_typst_version, capabilities_for, host_target, installed_typst_versions,
    system_typst_candidates, typst_compile_args, ToolchainVersion, TypstCapabilities,
    TypstDiagnosticFormat,
};
use oleafly_core::{
    bibtex_search_entry, bibtex_search_environment, image_failure_evidence, image_failure_notes,
    parse_latex_log, place_image_findings, plain_path, project_search_environment,
    project_tex_flavor, slash_path, Engine, EngineScratch, EngineScratchBases, Error, ErrorKind,
    ImageFinding, LogCategory, LogDiagnostic, LogSeverity, PreparedBuild, Result, TexFlavor,
    Utf8StreamDecoder, Workspace, ENGINE_TEMP_DIR, TEMP_DIRECTORY_VARIABLES,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;

const MAX_LOG_BYTES: usize = 1024 * 1024;
const LOG_TRUNCATION_MARKER: &str = "\n[Oleafly: compiler output truncated]\n";
const LOST_TEXT_CODE: &str = "tex.missing_characters";
const ENGINE_OUTPUT_TAIL_BYTES: usize = 8 * 1024;
const DEFAULT_TIMEOUT: Duration = oleafly_core::compile_limit::COMPILE_TIME_LIMIT;
const TECTONIC_CACHE_PROBE_TIMEOUT: Duration = Duration::from_secs(10);
const STALE_STAGING: Duration = Duration::from_secs(60 * 60);
const LOCK_POLL: Duration = Duration::from_millis(100);
/// Intermediate files a staged Tectonic build starts from, so reference
/// numbering and the table of contents settle in one run.
const SEEDED_EXTENSIONS: [&str; 14] = [
    "aux", "toc", "lof", "lot", "out", "bbl", "bcf", "nav", "snm", "vrb", "idx", "ind", "glo",
    "gls",
];
const MAX_SEEDED_BYTES: u64 = 16 * 1024 * 1024;
type LogCallback = dyn Fn(&str) + Send + Sync;
static ALIAS_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static TECTONIC_PREFETCH_SEEDED: AtomicBool = AtomicBool::new(false);

#[cfg(test)]
pub type BuildOptions = EngineFlags;

pub fn ignored_flags(flags: EngineFlags, engine: Engine) -> Vec<&'static str> {
    let (offline, fast, halt_on_error) = match engine {
        Engine::Tectonic => (false, false, false),
        Engine::Latexmk => (false, true, false),
        Engine::Typst => (false, true, true),
        Engine::Markdown | Engine::Quarto | Engine::Calepin => (true, true, true),
    };
    [
        (offline && flags.offline, "--offline"),
        (fast && flags.fast, "--fast"),
        (halt_on_error && flags.halt_on_error, "--halt-on-error"),
    ]
    .into_iter()
    .filter_map(|(ignored, flag)| ignored.then_some(flag))
    .collect()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BuildError {
    pub line: Option<u32>,
    pub file: Option<String>,
    pub message: String,
    pub kind: String,
    pub column: Option<u32>,
    pub hints: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explanation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

impl From<CompileError> for BuildError {
    fn from(error: CompileError) -> Self {
        Self {
            line: error.line,
            file: error.file,
            message: error.message,
            kind: error.kind,
            column: error.column,
            hints: error.hints,
            explanation: error.explanation,
            code: error.code,
        }
    }
}

impl BuildError {
    fn to_compile_error(&self) -> CompileError {
        CompileError {
            line: self.line,
            file: self.file.clone(),
            message: self.message.clone(),
            kind: self.kind.clone(),
            explanation: self.explanation.clone(),
            column: self.column,
            hints: self.hints.clone(),
            code: self.code.clone(),
            ..CompileError::default()
        }
    }

    fn plain(message: String) -> Self {
        Self {
            line: None,
            file: None,
            message,
            kind: "error".to_string(),
            column: None,
            hints: Vec::new(),
            explanation: None,
            code: None,
        }
    }

    pub fn tex_warning(&self) -> Option<crate::contract::Warning> {
        let code = self.code.as_deref()?;
        if self.kind != "warning"
            || !code.starts_with("tex.")
            || code.starts_with("tex.explain.")
            || code.starts_with(LOST_TEXT_CODE)
        {
            return None;
        }
        let mut message = self
            .explanation
            .clone()
            .unwrap_or_else(|| self.message.clone());
        for hint in &self.hints {
            message.push('\n');
            message.push_str(hint);
        }
        Some(crate::contract::Warning::new(code.to_owned(), message))
    }
}

// The engine's own lines scroll past during a build that still succeeds, so a
// document that lost its text says so again at the end, with the fix.
fn lost_text_warning(errors: &[BuildError]) -> Option<crate::contract::Warning> {
    let lost = errors.iter().find(|error| {
        error
            .code
            .as_deref()
            .is_some_and(|code| code.starts_with(LOST_TEXT_CODE))
    })?;
    let mut message = lost.message.clone();
    if let Some(explanation) = &lost.explanation {
        message = format!("{message}. {explanation}");
    }
    for hint in &lost.hints {
        message = format!("{message}\n\n{hint}");
    }
    Some(crate::contract::Warning::new(
        "build.missing_characters",
        message,
    ))
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct BuildResult {
    pub ok: bool,
    pub engine: Engine,
    pub main_document: String,
    pub build_directory: PathBuf,
    pub output: Option<PathBuf>,
    pub previous_output: Option<PathBuf>,
    pub output_id: Option<String>,
    pub fresh: bool,
    pub copied_to: Option<PathBuf>,
    pub log: String,
    pub log_path: Option<PathBuf>,
    pub errors: Vec<BuildError>,
    pub diagnostics: Vec<LogDiagnostic>,
    pub compile_time_ms: u64,
    pub waited_ms: u64,
    #[serde(skip)]
    pub warnings: Vec<crate::contract::Warning>,
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

impl std::fmt::Debug for CompilerLog {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(if self.0.is_some() {
            "CompilerLog(streaming)"
        } else {
            "CompilerLog(quiet)"
        })
    }
}

#[derive(Clone, Debug, Default)]
pub struct Discovery {
    pub workspace_root: PathBuf,
    pub cli_dir: Option<PathBuf>,
    pub app: Option<InstalledApp>,
    pub data_root: Option<PathBuf>,
    pub tex: TexSearch,
    pub pandoc: PandocSearch,
    pub path: Option<OsString>,
    pub overrides: BTreeMap<&'static str, PathBuf>,
    pub development: bool,
}

pub const TOOL_OVERRIDES: [&str; 4] = [
    "OLEAFLY_TECTONIC",
    "OLEAFLY_LATEXMK",
    "OLEAFLY_TYPST",
    "OLEAFLY_PANDOC",
];

impl Discovery {
    pub fn from_env(workspace_root: &Path) -> Discovery {
        let var = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty());
        let data_root = crate::app_paths::data_root();
        let cli_dir = oleafly_core::sidecar::executable_dir();
        let app = crate::app_paths::installed_app();
        let home = crate::app_paths::home_dir();
        let path = var("PATH");
        let tex = TexSearch {
            data_root: data_root.clone(),
            preferred_bin_dir: data_root
                .as_deref()
                .and_then(crate::app_config::tex_distribution)
                .map(PathBuf::from),
            ..TexSearch::from_env()
        }
        .refusing_foreign_parent(oleafly_secrets::fsperm::owned_by_current_user);
        let pandoc = PandocSearch {
            bundled_dirs: cli_dir
                .iter()
                .chain(app.as_ref().map(|app| &app.bin_dir))
                .flat_map(|dir| oleafly_core::sidecar::bundled_tool_dirs(dir))
                .collect(),
            data_root: data_root.clone(),
            home,
            path: path.clone(),
        };
        let overrides = TOOL_OVERRIDES
            .into_iter()
            .filter_map(|name| var(name).map(|value| (name, PathBuf::from(value))))
            .collect();
        Discovery {
            workspace_root: workspace_root.to_path_buf(),
            cli_dir,
            app,
            data_root,
            tex,
            pandoc,
            path,
            overrides,
            development: cfg!(debug_assertions),
        }
    }

    pub(crate) fn bundled_candidates(&self, name: &str) -> Vec<PathBuf> {
        let mut candidates: Vec<PathBuf> = Vec::new();
        for folder in self
            .cli_dir
            .iter()
            .chain(self.app.as_ref().map(|app| &app.bin_dir))
            .flat_map(|dir| oleafly_core::sidecar::bundled_tool_dirs(dir))
        {
            candidates.push(folder.join(executable_name(name)));
        }
        if self.development {
            candidates.extend(development_sidecars(name));
        }
        candidates
    }

    pub(crate) fn path_candidates(&self, name: &str) -> Vec<PathBuf> {
        self.path
            .as_ref()
            .map(|path| {
                std::env::split_paths(path)
                    .filter(|directory| directory.is_absolute())
                    .map(|directory| directory.join(executable_name(name)))
                    .collect()
            })
            .unwrap_or_default()
    }
}

#[derive(Clone, Debug, Default)]
pub struct BuildTools {
    pub tectonic: Option<PathBuf>,
    pub latexmk: Option<PathBuf>,
    pub typst: Option<PathBuf>,
    pub pandoc: Option<PathBuf>,
    pub tectonic_biber: Option<PathBuf>,
    pub tex_dirs: Vec<PathBuf>,
    pub pandoc_version: Option<String>,
    pub pandoc_too_old: Vec<(PathBuf, String)>,
    pub data_root: Option<PathBuf>,
    pub sources: BTreeMap<&'static str, &'static str>,
    app_found: bool,
    pandoc_probed: bool,
    rejected_overrides: BTreeMap<&'static str, ToolRejection>,
    typst_capabilities: Option<TypstCapabilities>,
    typst_version: Option<ToolchainVersion>,
    typst_pin_error: Option<String>,
}

impl BuildTools {
    pub fn discover_with(discovery: &Discovery) -> Self {
        let root = &discovery.workspace_root;
        let mut tools = BuildTools {
            data_root: discovery.data_root.clone(),
            tex_dirs: oleafly_core::tex_distro::tex_bin_dirs(&discovery.tex),
            ..BuildTools::default()
        };
        let mut tectonic_candidates = labelled(discovery.bundled_candidates("tectonic"), "bundled");
        tectonic_candidates.extend(labelled(discovery.path_candidates("tectonic"), "path"));
        let tectonic =
            discover_from_candidates("OLEAFLY_TECTONIC", discovery, tectonic_candidates, root);
        let latexmk_candidates = labelled(
            oleafly_core::tex_distro::tex_tool_candidates(&discovery.tex, "latexmk"),
            "tex",
        );
        let latexmk =
            discover_from_candidates("OLEAFLY_LATEXMK", discovery, latexmk_candidates, root);
        let mut typst_candidates = labelled(discovery.bundled_candidates("typst"), "bundled");
        typst_candidates.extend(labelled(system_typst_candidates(), "system"));
        typst_candidates.extend(labelled(discovery.path_candidates("typst"), "path"));
        let mut typst =
            discover_from_candidates("OLEAFLY_TYPST", discovery, typst_candidates, root);
        if typst.executable.is_none() {
            let downloaded = labelled(downloaded_typst_candidates(discovery), "downloaded");
            typst = discover_from_candidates("OLEAFLY_TYPST", discovery, downloaded, root);
        }
        tools.app_found = discovery.app.is_some();
        for (name, resolution) in [
            ("tectonic", &tectonic),
            ("latexmk", &latexmk),
            ("typst", &typst),
        ] {
            if let Some(rejection) = &resolution.rejected_override {
                tools.rejected_overrides.insert(name, rejection.clone());
            }
            if let Some(source) = resolution.source {
                tools.sources.insert(name, source);
            }
        }
        tools.tectonic_biber = tectonic
            .executable
            .as_deref()
            .and_then(Path::parent)
            .and_then(tectonic_biber_in)
            .or_else(|| {
                discovery
                    .bundled_candidates("tectonic-biber")
                    .into_iter()
                    .find(|candidate| candidate.is_file())
            });
        tools.tectonic = tectonic.executable;
        tools.latexmk = latexmk.discovered;
        tools.typst = typst.executable;
        tools
    }

    pub fn resolve_pandoc(&mut self, discovery: &Discovery) {
        if self.pandoc_probed {
            return;
        }
        self.pandoc_probed = true;
        let root = &discovery.workspace_root;
        if let Some(value) = discovery.overrides.get("OLEAFLY_PANDOC") {
            match resolve_executable(value.clone(), root) {
                CandidateResolution::Safe(path) => {
                    match probe_pandoc(&path) {
                        Some((version, true)) => {
                            self.pandoc = Some(path);
                            self.pandoc_version = version;
                            self.sources.insert("pandoc", "override");
                        }
                        Some((Some(version), false)) => self.pandoc_too_old.push((path, version)),
                        _ => {
                            self.pandoc = Some(path);
                            self.sources.insert("pandoc", "override");
                        }
                    }
                    return;
                }
                CandidateResolution::ProjectLocal(path) => {
                    self.rejected_overrides.insert(
                        "pandoc",
                        ToolRejection {
                            variable: "OLEAFLY_PANDOC",
                            path,
                        },
                    );
                }
                CandidateResolution::Missing => {}
            }
        }
        let mut probed: Vec<PathBuf> = Vec::new();
        let bundled: Vec<PathBuf> = discovery.pandoc.bundled_dirs.clone();
        for candidate in pandoc_candidates(&discovery.pandoc) {
            let from_bundle = bundled.iter().any(|folder| candidate.starts_with(folder));
            let CandidateResolution::Safe(path) = resolve_executable(candidate, root) else {
                continue;
            };
            if probed.contains(&path) {
                continue;
            }
            probed.push(path.clone());
            match probe_pandoc(&path) {
                Some((version, true)) => {
                    self.pandoc = Some(path);
                    self.pandoc_version = version;
                    self.sources
                        .insert("pandoc", if from_bundle { "bundled" } else { "path" });
                    return;
                }
                Some((Some(version), false)) => self.pandoc_too_old.push((path, version)),
                _ => {}
            }
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

    pub(crate) fn typst_version(&self) -> Option<&ToolchainVersion> {
        self.typst_version.as_ref()
    }

    pub(crate) fn typst_pin_error(&self) -> Option<&str> {
        self.typst_pin_error.as_deref()
    }

    pub(crate) fn app_found(&self) -> bool {
        self.app_found
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
            Engine::Quarto | Engine::Calepin => None,
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
            Engine::Quarto | Engine::Calepin => Vec::new(),
        }
    }

    pub fn rejected_override(&self, name: &str) -> Option<(&str, &Path)> {
        self.rejected_overrides
            .get(name)
            .map(|rejection| (rejection.variable, rejection.path.as_path()))
    }

    pub fn pandoc_too_old_message(&self) -> Option<String> {
        let (path, version) = self.pandoc_too_old.first()?;
        Some(format!(
            "pandoc {version} at {} is too old. Oleafly needs pandoc {}.{} or newer.",
            path.display(),
            MIN_PANDOC_VERSION.0,
            MIN_PANDOC_VERSION.1
        ))
    }

    fn missing_for_engine(&self, engine: Engine) -> Error {
        if matches!(engine, Engine::Quarto | Engine::Calepin) {
            return not_in_command_line(engine);
        }
        let name = engine.tool_name();
        if let (Engine::Typst, Some(message)) = (engine, self.typst_pin_error()) {
            return Error::new(ErrorKind::MissingTool, message);
        }
        if let (Engine::Markdown, Some(message)) = (engine, self.pandoc_too_old_message()) {
            if self.rejected_override(name).is_none() {
                return Error::new(ErrorKind::MissingTool, message);
            }
        }
        match self.rejected_override(name) {
            Some((variable, path)) => rejected_tool(variable, path),
            None => missing_tool(engine),
        }
    }
}

fn downloaded_typst_candidates(discovery: &Discovery) -> Vec<PathBuf> {
    let (Some(data_root), Some(target)) = (discovery.data_root.as_deref(), host_target()) else {
        return Vec::new();
    };
    let mut installed = installed_typst_versions(data_root, target);
    installed.sort_by_key(|typst| typst.version != *bundled_typst_version());
    installed.into_iter().map(|typst| typst.path).collect()
}

fn probe_pandoc(path: &Path) -> Option<(Option<String>, bool)> {
    let output = probe_output(path, &["--version"], PROBE_TIMEOUT, 64 * 1024)?;
    if !output.success {
        return None;
    }
    Some((
        parse_pandoc_version(&output.stdout),
        pandoc_version_supported(&output.stdout),
    ))
}

fn labelled(candidates: Vec<PathBuf>, source: &'static str) -> Vec<(PathBuf, &'static str)> {
    candidates
        .into_iter()
        .map(|candidate| (candidate, source))
        .collect()
}

#[derive(Clone, Debug)]
struct ToolRejection {
    variable: &'static str,
    path: PathBuf,
}

struct ToolResolution {
    executable: Option<PathBuf>,
    discovered: Option<PathBuf>,
    source: Option<&'static str>,
    rejected_override: Option<ToolRejection>,
}

async fn relativize_typst_errors(errors: &mut [BuildError], working_directory: &Path) {
    let canonical = tokio::fs::canonicalize(working_directory)
        .await
        .unwrap_or_else(|_| working_directory.to_path_buf());
    for error in errors {
        error.file = error.file.take().map(|file| {
            let file = typst_path_relative_to(&file, &canonical);
            typst_path_relative_to(&file, working_directory)
        });
    }
}

async fn promote_staging(staging: OutputStaging, ok: bool) -> std::result::Result<(), CliError> {
    if !ok {
        for name in [
            format!("{ENTRY_STEM}.pdf"),
            format!("{ENTRY_STEM}.synctex.gz"),
        ] {
            let _ = tokio::fs::remove_file(staging.path().join(name)).await;
        }
    }
    staging.promote_all().map(|_| ()).map_err(output_locked_or)
}

#[derive(Clone)]
pub struct NativeCompiler {
    tools: BuildTools,
    log: CompilerLog,
    timeout: Duration,
    typst: TypstSettings,
    on_lock_wait: Option<Arc<dyn Fn() + Send + Sync>>,
}

impl NativeCompiler {
    pub fn new(tools: BuildTools) -> Self {
        Self {
            tools,
            log: CompilerLog::default(),
            timeout: DEFAULT_TIMEOUT,
            typst: TypstSettings::default(),
            on_lock_wait: None,
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

    pub fn with_lock_wait(mut self, on_wait: Option<Arc<dyn Fn() + Send + Sync>>) -> Self {
        self.on_lock_wait = on_wait;
        self
    }

    pub async fn build(
        &self,
        workspace: &Workspace,
        flags: EngineFlags,
    ) -> std::result::Result<BuildResult, CliError> {
        let prepared = workspace.prepare_build()?;
        self.build_prepared(&prepared, flags).await
    }

    async fn lock_build(
        &self,
        build_dir: &Path,
    ) -> std::result::Result<(BuildHold, u64), CliError> {
        let started = Instant::now();
        let mut told = false;
        let mut file_locks = true;
        loop {
            let held = if file_locks {
                match BuildLock::try_acquire(build_dir) {
                    Ok(lock) => lock.map(BuildHold::file),
                    Err(error) if locks_unsupported(&error) => {
                        file_locks = false;
                        continue;
                    }
                    Err(error) => return Err(lock_failed(build_dir, &error)),
                }
            } else {
                DirLock::try_acquire(build_dir, extended_limit(self.timeout) + DIR_LOCK_SLACK)
                    .map_err(|error| lock_failed(build_dir, &error))?
                    .map(BuildHold::folder)
            };
            if let Some(held) = held {
                return Ok((held, started.elapsed().as_millis() as u64));
            }
            if !told {
                told = true;
                if let Some(on_wait) = &self.on_lock_wait {
                    on_wait();
                }
            }
            if started.elapsed() >= self.timeout {
                return Err(build_running());
            }
            tokio::time::sleep(LOCK_POLL).await;
        }
    }

    async fn build_prepared(
        &self,
        build: &PreparedBuild,
        flags: EngineFlags,
    ) -> std::result::Result<BuildResult, CliError> {
        let build_dir = build.build_directory().to_path_buf();
        let (lock, waited_ms) = self.lock_build(&build_dir).await?;
        sweep_stale_staging(&build_dir, STALE_STAGING);
        let unlocked = lock.is_folder();
        let started = Instant::now();
        let pdf = build_dir.join(format!("{ENTRY_STEM}.pdf"));
        let engine_log = build_dir.join(format!("{ENTRY_STEM}.log"));

        let mut command = self.command(build, flags, true)?;
        let mut in_place = match command.staging {
            None => Some(InPlaceOutputs::prepare(&build_dir)?),
            Some(_) => None,
        };
        if command.bundle_pinned && !flags.offline {
            self.seed_tectonic_prefetch(&build_dir).await;
        }
        let (mut output, mut status) =
            run_command(&command.launch(), self.timeout, &self.log).await?;
        if let Some(note) = compiler_crash_note(&status) {
            self.log.emit(&note);
            append_bounded(&mut output, note.as_bytes());
        }
        if command.bundle_pinned && bundle_retry_needed(status.success(), &output) {
            let retried = self
                .retry_without_pinned_bundle(build, flags, status.success(), &mut output)
                .await?;
            if let Some(retried) = retried {
                (status, command) = retried;
            }
        }

        let tex_engine = matches!(build.engine(), Engine::Tectonic | Engine::Latexmk);
        let produced_pdf = command.produced_output.is_file();
        let file_log_path = match &command.staging {
            Some(staging) => staging.path().join(format!("{ENTRY_STEM}.log")),
            None => engine_log.clone(),
        };
        let file_log_fresh = match &in_place {
            None => file_log_path.is_file(),
            Some(outputs) => outputs.is_fresh(&engine_log),
        };
        let file_log = (tex_engine && file_log_fresh)
            .then(|| read_log_bounded(&file_log_path).ok())
            .flatten();
        let missing_tool = (build.engine() == Engine::Latexmk && !status.success())
            .then(|| command.environment.iter().find(|(name, _)| *name == "PATH"))
            .flatten()
            .and_then(|(_, path)| latexmk_tool_error(&output, path));
        let mut log = match &file_log {
            Some(file_log) => {
                let log =
                    with_engine_output_on_failure(file_log.clone(), &output, status.success());
                with_bundle_fetch_notes(log, &output, status.success())
            }
            None => output,
        };
        if build.engine() == Engine::Latexmk && !status.success() {
            append_bounded(
                &mut log,
                biber_log_notes(&file_log_path.with_extension("blg")).as_bytes(),
            );
        }
        let mut errors = parse_errors(build.engine(), &log);
        errors.extend(missing_tool.map(BuildError::from));
        if build.engine() == Engine::Typst {
            relativize_typst_errors(&mut errors, &command.working_directory).await;
        }
        if tex_engine {
            let out_dir = command
                .staging
                .as_ref()
                .map_or(build_dir.as_path(), OutputStaging::path);
            apply_tex_output_notes(build, out_dir, status.success(), &mut log, &mut errors);
        }
        let wrote_pdf = match &in_place {
            None => produced_pdf,
            Some(outputs) => pdf.is_file() && (outputs.is_fresh(&pdf) || status.success()),
        };
        let ok = status.success() && wrote_pdf && !errors.iter().any(|error| error.kind == "error");

        if let Some(staging) = command.staging.take() {
            promote_staging(staging, ok).await?;
        }
        if let Some(mut outputs) = in_place.take() {
            outputs.finish(ok);
        }
        if build.engine() == Engine::Latexmk && status.success() {
            if let Some(latexmk) = self.tools.latexmk.as_deref() {
                engine_spec::record_latexmk_binary(&build_dir, latexmk);
            }
        }
        let fresh = match build.engine() {
            Engine::Latexmk => ok && wrote_pdf,
            _ => ok && produced_pdf,
        };
        if image_check_applies(ok, build.engine()) {
            self.explain_image_failures(build, &mut log, &mut errors)
                .await;
        }
        if !ok && build.engine() == Engine::Latexmk {
            self.explain_blocked_shell_escape(build, &mut log, &mut errors);
            self.add_tlmgr_hints(&mut errors);
        }
        if !ok && tex_engine && !errors.iter().any(|error| error.kind == "error") {
            errors.extend(tex_failure_reason(&log).map(BuildError::from));
        }
        let diagnostics = diagnostics_for(build, file_log.as_deref(), &mut errors);
        let output_path = (fresh && pdf.is_file()).then(|| pdf.clone());
        let previous_output = (!fresh && pdf.is_file()).then(|| pdf.clone());
        let output_id = output_path.as_deref().map(fingerprint_file).transpose()?;
        let mut warnings = Vec::new();
        if unlocked {
            warnings.push(crate::contract::Warning::new(
                "build.unlocked",
                "This folder doesn't support file locks, so builds took turns through a lock folder instead. Older Oleafly versions don't use it, so don't run them on this project at the same time.",
            ));
        }
        warnings.extend(lost_text_warning(&errors));
        Ok(BuildResult {
            ok,
            engine: build.engine(),
            main_document: build.main_document().to_string(),
            build_directory: build_dir,
            output: output_path,
            previous_output,
            output_id,
            fresh,
            copied_to: None,
            log,
            log_path: None,
            errors,
            diagnostics,
            compile_time_ms: started.elapsed().as_millis() as u64,
            waited_ms,
            warnings,
        })
    }

    async fn seed_tectonic_prefetch(&self, working_directory: &Path) {
        let Some(tectonic) = self.tools.tectonic.as_deref() else {
            return;
        };
        if TECTONIC_PREFETCH_SEEDED.swap(true, Ordering::Relaxed) {
            return;
        }
        let arguments: Vec<OsString> = TECTONIC_CACHE_DIR_ARGS.iter().map(OsString::from).collect();
        let launch = Launch {
            executable: tectonic,
            arguments: &arguments,
            working_directory,
            environment: &[],
            unset: &[],
            variables: &[],
        };
        if let Ok((output, status)) = run_command(
            &launch,
            TECTONIC_CACHE_PROBE_TIMEOUT,
            &CompilerLog::default(),
        )
        .await
        {
            if status.success() {
                engine_spec::seed_tectonic_prefetch(&output);
            }
        }
    }

    async fn retry_without_pinned_bundle(
        &self,
        build: &PreparedBuild,
        flags: EngineFlags,
        first_succeeded: bool,
        output: &mut String,
    ) -> std::result::Result<Option<(ExitStatus, BuildCommand)>, CliError> {
        let note = format!("\n{BUNDLE_FALLBACK_NOTE}\n");
        self.log.emit(&note);
        let attempt = self.run_without_pinned_bundle(build, flags).await;
        let (retry, retry_output, retry_status) = match attempt {
            Ok(attempt)
                if bundle_retry_replaces_first_run(first_succeeded, attempt.2.success()) =>
            {
                attempt
            }
            Err(error) if !first_succeeded => return Err(error),
            _ => return Ok(None),
        };
        let first = std::mem::take(output);
        if build.engine() == Engine::Markdown {
            append_bounded(output, first.as_bytes());
        }
        append_bounded(output, note.as_bytes());
        append_bounded(output, retry_output.as_bytes());
        if let Some(crash) = compiler_crash_note(&retry_status) {
            append_bounded(output, crash.as_bytes());
        }
        Ok(Some((retry_status, retry)))
    }

    async fn run_without_pinned_bundle(
        &self,
        build: &PreparedBuild,
        flags: EngineFlags,
    ) -> std::result::Result<(BuildCommand, String, ExitStatus), CliError> {
        let retry = self.command(build, flags, false)?;
        let (output, status) = run_command(&retry.launch(), self.timeout, &self.log).await?;
        Ok((retry, output, status))
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

    fn explain_blocked_shell_escape(
        &self,
        build: &PreparedBuild,
        log: &mut String,
        errors: &mut Vec<BuildError>,
    ) {
        let source = source_head(build.source_path()).unwrap_or_default();
        let Some(denied) = blocked_shell_escape(&source, log) else {
            return;
        };
        let message = shell_escape_message(denied);
        let note = format!("\n[Oleafly] {message}\n");
        self.log.emit(&note);
        append_bounded(log, note.as_bytes());
        let mut error = BuildError::plain(message);
        error.code = Some(denied.code().to_string());
        let first = errors.iter().find(|error| error.kind == "error");
        if first.is_none_or(follows_from_blocked_command) {
            errors.insert(0, error);
        } else {
            errors.push(error);
        }
    }

    fn tex_search(&self) -> TexSearch {
        TexSearch {
            data_root: self.tools.data_root.clone(),
            ..TexSearch::from_env()
        }
        .refusing_foreign_parent(oleafly_secrets::fsperm::owned_by_current_user)
    }

    fn add_tlmgr_hints(&self, errors: &mut [BuildError]) {
        let Some(latexmk) = self.tools.latexmk.as_deref() else {
            return;
        };
        if !errors
            .iter()
            .any(|error| missing_package_file(error).is_some())
        {
            return;
        }
        let search = self.tex_search();
        let Some(distribution) = distribution_for_tool(&search, latexmk) else {
            return;
        };
        if distribution.system_package_manager.is_some() {
            return;
        }
        let Some(tlmgr) = distribution.tlmgr.as_deref() else {
            return;
        };
        let program = tlmgr_program(tlmgr, search.path.as_deref());
        for error in errors {
            if let Some(file) = missing_package_file(error).map(str::to_owned) {
                error
                    .hints
                    .push(tlmgr_hint(&program, &distribution.kind, &file));
            }
        }
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
            BuildError::plain,
        );
    }

    fn command(
        &self,
        build: &PreparedBuild,
        flags: EngineFlags,
        bundle: bool,
    ) -> Result<BuildCommand> {
        let owned = self
            .tools
            .data_root
            .clone()
            .or_else(crate::app_paths::data_root)
            .map(|root| root.join(ENGINE_TEMP_DIR));
        let scratch_bases = EngineScratchBases::new(owned, build.build_directory());
        self.command_with(build, flags, &scratch_bases, bundle)
    }

    fn command_with(
        &self,
        build: &PreparedBuild,
        flags: EngineFlags,
        scratch_bases: &EngineScratchBases,
        bundle: bool,
    ) -> Result<BuildCommand> {
        let executable = self
            .tools
            .for_engine(build.engine())
            .ok_or_else(|| self.tools.missing_for_engine(build.engine()))?
            .to_path_buf();
        if executable.is_absolute() {
            reject_project_local_tool(&executable, build.project_root())?;
        }
        let build_dir = build.build_directory();
        let bundle_url = bundle.then(tex_bundle_url);
        let mut compiler_alias = None;
        let mut scratch = None;
        let mut staging = None;
        let mut environment: Vec<(&'static str, OsString)> = Vec::new();
        let mut unset: Vec<&'static str> = Vec::new();
        let (arguments, produced_output, working_directory) = match build.engine() {
            Engine::Tectonic => {
                let entry = build_dir.join(ENTRY_TEX);
                let shipped = shipped_bibliography(build.project_root(), build.main_document());
                oleafly_core::atomic::write_atomic(
                    &entry,
                    latex_entry_source_with(
                        build.main_document(),
                        shipped.as_deref(),
                        !flags.offline,
                    )?
                    .as_bytes(),
                )?;
                clear_biber_source_copies(build_dir, ENTRY_STEM);
                let staged = OutputStaging::create(build_dir)?;
                seed_staging(build_dir, staged.path());
                let mut search: Vec<&Path> = Vec::new();
                if build.compile_directory() != build.project_root() {
                    search.push(build.compile_directory());
                }
                search.push(build.project_root());
                let tex_defaults = build_dir.join(engine_spec::TEX_DEFAULTS_DIR);
                if !flags.offline {
                    engine_spec::write_tex_defaults(&tex_defaults)?;
                    search.push(&tex_defaults);
                }
                let arguments = engine_spec::tectonic_args(
                    staged.path(),
                    &search,
                    &entry,
                    bundle_url.as_deref(),
                    flags,
                );
                let produced = staged.path().join(format!("{ENTRY_STEM}.pdf"));
                environment.extend(self.tex_environment(&executable, build.project_root()));
                staging = Some(staged);
                // Tectonic looks for ./tectonic-biber in its working directory
                // before PATH, so it must not start in the project it builds.
                let created = EngineScratch::create(scratch_bases)?;
                let working = created.path().to_path_buf();
                scratch = Some(created);
                (arguments, produced, working)
            }
            Engine::Latexmk => {
                let (arguments, texmf_output) =
                    self.latexmk_arguments(build, flags, &executable)?;
                if let Some(bbl) = shipped_bibliography(build.project_root(), build.main_document())
                {
                    seed_shipped_bibliography(build.project_root(), &bbl, build_dir)?;
                }
                environment.extend(latexmk_environment(build));
                environment.extend(self.latexmk_tex_environment(&executable, build.project_root()));
                if let Some(output) = texmf_output {
                    environment.push(("TEXMFOUTPUT", output.into()));
                }
                unset.push("openin_any");
                (
                    arguments,
                    build_dir.join(format!("{ENTRY_STEM}.pdf")),
                    build.compile_directory().to_path_buf(),
                )
            }
            Engine::Typst => {
                let staged = OutputStaging::create(build_dir)?;
                let produced = staged.path().join(format!("{ENTRY_STEM}.pdf"));
                let arguments = typst_arguments(
                    build,
                    &produced,
                    self.tools.typst_capabilities(),
                    &self.typst,
                )?;
                environment.extend(self.typst.environment());
                staging = Some(staged);
                (arguments, produced, build.project_root().to_path_buf())
            }
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
                let project = plain_path(build.project_root());
                let search_folders = oleafly_core::document_search_folders(
                    &project,
                    Path::new(build.main_document()),
                );
                let resources = created.pandoc_search_path(&project, &search_folders)?;
                write_markdown_filters(created.path())?;
                let staged = OutputStaging::create(build_dir)?;
                let produced = staged.path().join(format!("{ENTRY_STEM}.pdf"));
                let bibliographies: Vec<PathBuf> =
                    engine_spec::discover_bibliographies(build.project_root())?
                        .into_iter()
                        .map(PathBuf::from)
                        .collect();
                let output = plain_path(&produced);
                let main = plain_path(build.source_path());
                let arguments = engine_spec::markdown_pdf_args(&MarkdownPdfArgs {
                    resource_argument: &resources.argument,
                    tectonic: &engine_path,
                    project: &project,
                    search_folders: &search_folders,
                    output: &output,
                    main: &main,
                    bibliographies: &bibliographies,
                    bundle_url: bundle_url.as_deref(),
                });
                environment.extend(
                    TEMP_DIRECTORY_VARIABLES
                        .iter()
                        .map(|name| (*name, created.path().as_os_str().to_owned())),
                );
                environment.extend(resources.variable);
                environment.extend(
                    self.tools
                        .typst
                        .as_deref()
                        .filter(|typst| {
                            reject_project_local_tool(typst, build.project_root()).is_ok()
                        })
                        .map(|typst| (MARKDOWN_TYPST_VARIABLE, typst.as_os_str().to_owned())),
                );
                environment.extend(self.tex_environment(tectonic, build.project_root()));
                let working = created.path().to_path_buf();
                scratch = Some(created);
                staging = Some(staged);
                (arguments, produced, working)
            }
            Engine::Quarto | Engine::Calepin => return Err(not_in_command_line(build.engine())),
        };
        Ok(BuildCommand {
            executable,
            arguments,
            produced_output,
            working_directory,
            environment,
            unset,
            bundle_pinned: bundle_url.is_some()
                && matches!(build.engine(), Engine::Tectonic | Engine::Markdown),
            staging,
            _scratch: scratch,
            _compiler_alias: compiler_alias,
        })
    }

    fn tex_environment(&self, tool: &Path, project_root: &Path) -> Vec<(&'static str, OsString)> {
        let mut extra: Vec<PathBuf> = Vec::new();
        if let Some(folder) = self.tools.tectonic_biber.as_deref().and_then(Path::parent) {
            extra.push(folder.to_path_buf());
        }
        extra.extend(self.tools.tex_dirs.iter().cloned());
        let inherited = std::env::var_os("PATH");
        let path = compile_path_env(
            tool.parent(),
            &extra,
            inherited.as_deref(),
            Some(project_root),
        );
        let mut environment = vec![("PATH", path)];
        if let (Some(data_root), Some(biber)) = (&self.tools.data_root, &self.tools.tectonic_biber)
        {
            if let Some(unpack) = biber_unpack_dir(data_root, biber) {
                environment.push((UNPACK_ENV, unpack.into_os_string()));
            }
        }
        environment
    }

    fn latexmk_tex_environment(
        &self,
        latexmk: &Path,
        project_root: &Path,
    ) -> Vec<(&'static str, OsString)> {
        let mut environment = self.tex_environment(latexmk, project_root);
        let path = environment
            .iter()
            .find(|(name, _)| *name == "PATH")
            .map(|(_, value)| value.clone());
        let (Some(data_root), Some(path)) = (&self.tools.data_root, path) else {
            return environment;
        };
        let Some(biber) = first_biber_on(&path) else {
            return environment;
        };
        environment.retain(|(name, _)| *name != UNPACK_ENV);
        if let Some(unpack) = biber_unpack_dir(data_root, &biber) {
            environment.push((UNPACK_ENV, unpack.into_os_string()));
        }
        let thin = runnable_biber_dir(data_root, &biber).unwrap_or_else(|error| {
            eprintln!(
                "Could not copy the {} part out of the universal Biber at {}: {error}",
                std::env::consts::ARCH,
                biber.display()
            );
            None
        });
        if let Some(thin) = thin {
            environment.retain(|(name, _)| *name != "PATH");
            environment.push(("PATH", path_with_first(&thin, &path)));
        }
        environment
    }

    fn latexmk_arguments(
        &self,
        build: &PreparedBuild,
        flags: EngineFlags,
        latexmk: &Path,
    ) -> Result<(Vec<OsString>, Option<String>)> {
        engine_spec::validate_latex_main_document(build.main_document())?;
        let flavor = build.tex_flavor().map_or_else(
            || {
                Ok(project_tex_flavor(
                    build.project_root(),
                    build.source_path(),
                ))
            },
            |value| {
                TexFlavor::parse(value).ok_or_else(|| {
                    Error::new(
                        ErrorKind::InvalidManifest,
                        format!("unsupported tex_flavor `{value}`"),
                    )
                })
            },
        )?;
        if let Some(label) = engine_spec::dvi_toolchain_missing(flavor, latexmk) {
            return Err(Error::new(
                ErrorKind::MissingTool,
                format!("{label} isn't installed beside latexmk. Install it with your TeX distribution, or pick another compiler."),
            ));
        }
        let input = build
            .source_path()
            .strip_prefix(build.compile_directory())
            .map_err(|_| Error::new(ErrorKind::UnsafePath, "main document escaped the project"))?;
        let entry = format!("./{}", slash_path(input));
        engine_spec::validate_latexmk_path_characters(&entry)?;
        let build_dir = build.build_directory();
        let (out_dir, texmf_output) = if build_dir.starts_with(build.project_root()) {
            let relative = relative_to(build.compile_directory(), build_dir).ok_or_else(|| {
                Error::new(ErrorKind::UnsafePath, "build directory escaped the project")
            })?;
            let out_dir = dotted(&relative);
            engine_spec::validate_latexmk_path_characters(&out_dir)?;
            (out_dir, None)
        } else {
            let absolute = engine_spec::latexmk_absolute_path_text(build_dir, cfg!(windows)).ok_or_else(|| {
                Error::new(
                    ErrorKind::InvalidInput,
                    "latexmk can't write to this project's build folder because its path has characters a shell would read. Move Oleafly's data folder (OLEAFLY_DATA_DIR) to a plainer path.",
                )
            })?;
            (absolute.clone(), Some(absolute))
        };
        let distribution =
            oleafly_core::tex_distro::distribution_kind_for_tool(&self.tex_search(), latexmk);
        let mut arguments: Vec<OsString> = engine_spec::latexmk_args(
            &out_dir,
            &entry,
            ENTRY_STEM,
            flavor,
            flags,
            false,
            &distribution,
        )
        .into_iter()
        .map(OsString::from)
        .collect();
        if engine_spec::latexmk_binary_changed(build_dir, latexmk) {
            arguments.insert(0, "-gg".into());
        }
        Ok((arguments, texmf_output))
    }
}

pub(crate) struct CliToolRunner;

impl oleafly_doctools::ToolRunner for CliToolRunner {
    fn run<'a>(
        &'a self,
        program: &'a Path,
        args: &'a [String],
        working_dir: &'a Path,
        variables: &'a [(String, String)],
    ) -> oleafly_doctools::RunFuture<'a> {
        Box::pin(async move {
            let arguments: Vec<OsString> = args.iter().map(OsString::from).collect();
            let launch = Launch {
                executable: program,
                arguments: &arguments,
                working_directory: working_dir,
                environment: &[],
                unset: &[],
                variables,
            };
            run_command(&launch, DEFAULT_TIMEOUT, &CompilerLog::default())
                .await
                .map(|(output, status)| (output, status.code()))
                .map_err(|error| error.to_string())
        })
    }
}

const DIR_LOCK_SLACK: Duration = Duration::from_secs(60);

pub(crate) struct BuildHold {
    _file: Option<BuildLock>,
    folder: Option<DirLock>,
}

impl BuildHold {
    fn file(lock: BuildLock) -> Self {
        Self {
            _file: Some(lock),
            folder: None,
        }
    }

    fn folder(lock: DirLock) -> Self {
        Self {
            _file: None,
            folder: Some(lock),
        }
    }

    fn is_folder(&self) -> bool {
        self.folder.is_some()
    }
}

fn lock_failed(build_dir: &Path, error: &std::io::Error) -> CliError {
    CliError::new(
        CliErrorKind::Io,
        "build.lock_failed",
        format!(
            "Oleafly couldn't lock the build folder {}: {error}",
            build_dir.display()
        ),
    )
}

pub(crate) fn build_running() -> CliError {
    CliError::new(
        CliErrorKind::Conflict,
        "conflict.build_running",
        "Another build of this project is still running.",
    )
    .hint("Wait for it to finish, then build again.")
    .retryable()
}

/// A PDF another program holds open can't be replaced.
pub(crate) fn output_locked_or(error: std::io::Error) -> CliError {
    if error.kind() == std::io::ErrorKind::PermissionDenied
        || matches!(error.raw_os_error(), Some(5 | 32))
    {
        CliError::new(
            CliErrorKind::Io,
            "build.output_locked",
            "Oleafly couldn't replace the PDF because another program has it open.",
        )
        .hint("Close the program that has the PDF open, then build again.")
        .retryable()
    } else {
        CliError::from(error)
    }
}

fn diagnostics_for(
    build: &PreparedBuild,
    file_log: Option<&str>,
    errors: &mut [BuildError],
) -> Vec<LogDiagnostic> {
    match build.engine() {
        Engine::Tectonic | Engine::Latexmk => {
            let mut diagnostics = file_log
                .map(|log| parse_latex_log(log, Some(build.main_document())))
                .unwrap_or_default();
            let mut compile_errors: Vec<CompileError> =
                errors.iter().map(BuildError::to_compile_error).collect();
            rebase_log_files(
                build.project_root(),
                build.compile_directory(),
                Some(build.main_document()),
                &mut compile_errors,
                &mut diagnostics,
            );
            resolve_extensionless_inputs(
                build.project_root(),
                &mut compile_errors,
                &mut diagnostics,
            );
            for (error, rebased) in errors.iter_mut().zip(compile_errors) {
                error.file = rebased.file;
            }
            diagnostics
        }
        Engine::Typst | Engine::Markdown | Engine::Quarto | Engine::Calepin => {
            errors.iter().map(diagnostic_of).collect()
        }
    }
}

fn diagnostic_of(error: &BuildError) -> LogDiagnostic {
    let (severity, category) = match error.kind.as_str() {
        "error" => (LogSeverity::Error, LogCategory::Error),
        "warning" => (LogSeverity::Warning, LogCategory::Info),
        _ => (LogSeverity::Info, LogCategory::Info),
    };
    LogDiagnostic {
        severity,
        message: error.message.clone(),
        file: error.file.clone(),
        line: error.line,
        category,
        error_context: None,
    }
}

/// How deep [`remove_links`] looks into the build folder (latexmk writes
/// `\include`d files' auxiliary files into matching subfolders).
const MAX_LINK_SWEEP_DEPTH: usize = 8;
const KEPT_OUTPUTS: [&str; 2] = ["pdf", "synctex.gz"];

/// What a latexmk build writes in place in the build folder (the other
/// engines write into a staging folder and keep the last good PDF by not
/// promoting it).
///
/// Before the run, every symbolic link and special file in the folder goes:
/// a cloned or unzipped project can ship `.oleafly/build/_oleafly_entry.log`
/// as a link to a file elsewhere, and the compiler would write through it
/// (`remove_file` unlinks a link without following it). The last good PDF and
/// SyncTeX file are copied aside, and put back when the build fails, because
/// latexmk's `-f` leaves a best-effort PDF over them. Dropping this before
/// [`InPlaceOutputs::finish`] (the build timed out or was cancelled) puts
/// them back too.
struct InPlaceOutputs {
    build_dir: PathBuf,
    aside: Option<OutputStaging>,
    before: ArtifactSnapshot,
    finished: bool,
}

impl InPlaceOutputs {
    fn prepare(build_dir: &Path) -> Result<Self> {
        remove_links(build_dir, 0)?;
        let aside = OutputStaging::create(build_dir).ok();
        if let Some(aside) = &aside {
            for name in Self::kept_names() {
                let source = build_dir.join(&name);
                let copy = aside.path().join(&name);
                if source.is_file() && std::fs::copy(&source, &copy).is_err() {
                    let _ = std::fs::remove_file(&copy);
                }
            }
        }
        let outputs: Vec<PathBuf> = ["pdf", "log", "synctex.gz"]
            .iter()
            .map(|extension| build_dir.join(format!("{ENTRY_STEM}.{extension}")))
            .collect();
        Ok(Self {
            build_dir: build_dir.to_path_buf(),
            aside,
            before: ArtifactSnapshot::capture(&outputs),
            finished: false,
        })
    }

    fn kept_names() -> impl Iterator<Item = String> {
        KEPT_OUTPUTS
            .iter()
            .map(|extension| format!("{ENTRY_STEM}.{extension}"))
    }

    fn is_fresh(&self, path: &Path) -> bool {
        self.before.is_fresh(path)
    }

    fn finish(&mut self, ok: bool) {
        if !ok {
            self.keep_last_good();
            self.forget_run();
        }
        self.finished = true;
    }

    fn forget_run(&self) {
        let log = self.build_dir.join(format!("{ENTRY_STEM}.log"));
        engine_spec::forget_latexmk_run(&log);
        let _ = std::fs::remove_file(log);
    }

    fn keep_last_good(&self) {
        for name in Self::kept_names() {
            let path = self.build_dir.join(&name);
            let copy = self.aside.as_ref().map(|aside| aside.path().join(&name));
            let touched = self.before.is_fresh(&path);
            match copy.filter(|copy| copy.is_file()) {
                Some(copy) if touched || !path.exists() => {
                    let _ =
                        oleafly_core::atomic::persist_with_retry(|| std::fs::rename(&copy, &path));
                }
                Some(_) => {}
                None if touched => {
                    let _ = std::fs::remove_file(&path);
                }
                None => {}
            }
        }
    }
}

impl Drop for InPlaceOutputs {
    fn drop(&mut self) {
        if !self.finished {
            self.keep_last_good();
        }
    }
}

fn remove_links(directory: &Path, depth: usize) -> Result<()> {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return Ok(());
    };
    for entry in entries.filter_map(std::result::Result::ok) {
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with(oleafly_core::build_output::STAGING_PREFIX)
        {
            continue;
        }
        // `DirEntry::file_type` reports a link as a link, never its target.
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if kind.is_dir() {
            if depth < MAX_LINK_SWEEP_DEPTH {
                remove_links(&path, depth + 1)?;
            }
        } else if !kind.is_file() {
            // A folder link on Windows only goes with `remove_dir`.
            let removed = std::fs::remove_file(&path).or_else(|_| std::fs::remove_dir(&path));
            match removed {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(Error::new(
                        ErrorKind::UnsafePath,
                        format!(
                            "{} in the build folder is a link or a special file, and Oleafly couldn't remove it: {error}",
                            path.display()
                        ),
                    ));
                }
            }
        }
    }
    Ok(())
}

fn seed_staging(build_dir: &Path, staging: &Path) {
    let Ok(entries) = std::fs::read_dir(build_dir) else {
        return;
    };
    for entry in entries.filter_map(std::result::Result::ok).take(1_000) {
        let path = entry.path();
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        let seeded = path
            .extension()
            .and_then(OsStr::to_str)
            .is_some_and(|extension| SEEDED_EXTENSIONS.contains(&extension));
        if metadata.is_file() && seeded && metadata.len() <= MAX_SEEDED_BYTES {
            let _ = std::fs::copy(&path, staging.join(entry.file_name()));
        }
    }
}

fn read_log_bounded(path: &Path) -> std::io::Result<String> {
    use std::io::Read;
    let mut file = crate::record::open_regular_file(path)?;
    let mut bytes = Vec::with_capacity(MAX_LOG_BYTES.min(64 * 1024));
    file.by_ref()
        .take((MAX_LOG_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    let mut output = String::new();
    append_bounded(&mut output, &oleafly_core::rejoin_split_utf8_lines(&bytes));
    Ok(output)
}

fn with_engine_output_on_failure(mut log: String, output: &str, success: bool) -> String {
    if success || output.trim().is_empty() {
        return log;
    }
    let start = output.len().saturating_sub(ENGINE_OUTPUT_TAIL_BYTES);
    let start = output
        .char_indices()
        .map(|(index, _)| index)
        .find(|index| *index >= start)
        .unwrap_or(output.len());
    append_bounded(&mut log, format!("\n{ENGINE_OUTPUT_MARKER}\n").as_bytes());
    append_bounded(&mut log, &output.as_bytes()[start..]);
    log
}

fn biber_log_notes(blg: &Path) -> String {
    let Ok(log) = read_log_bounded(blg) else {
        return String::new();
    };
    let excerpt = biber_message_excerpt(&log);
    if excerpt.is_empty() {
        return String::new();
    }
    format!("\n[Oleafly] Biber messages ({ENTRY_STEM}.blg):\n{excerpt}")
}

fn with_bundle_fetch_notes(mut log: String, output: &str, success: bool) -> String {
    if !success {
        return log;
    }
    if output.contains(BUNDLE_FALLBACK_NOTE) {
        append_bounded(&mut log, format!("\n{BUNDLE_FALLBACK_NOTE}").as_bytes());
    }
    if let Some(excerpt) = bundle_fetch_excerpt(output) {
        append_bounded(
            &mut log,
            format!("\n{ENGINE_OUTPUT_MARKER}\n{excerpt}").as_bytes(),
        );
    }
    log
}

pub(crate) struct Launch<'a> {
    pub executable: &'a Path,
    pub arguments: &'a [OsString],
    pub working_directory: &'a Path,
    pub environment: &'a [(&'static str, OsString)],
    /// Variables the run must not inherit (LuaTeX can't take `openin_any=p`).
    pub unset: &'a [&'static str],
    pub variables: &'a [(String, String)],
}

struct BuildCommand {
    executable: PathBuf,
    arguments: Vec<OsString>,
    produced_output: PathBuf,
    working_directory: PathBuf,
    environment: Vec<(&'static str, OsString)>,
    unset: Vec<&'static str>,
    bundle_pinned: bool,
    staging: Option<OutputStaging>,
    _scratch: Option<EngineScratch>,
    _compiler_alias: Option<CompilerAlias>,
}

impl BuildCommand {
    fn launch(&self) -> Launch<'_> {
        Launch {
            executable: &self.executable,
            arguments: &self.arguments,
            working_directory: &self.working_directory,
            environment: &self.environment,
            unset: &self.unset,
            variables: &[],
        }
    }
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

fn not_in_command_line(engine: Engine) -> Error {
    let (name, command) = match engine {
        Engine::Calepin => ("Calepin", "calepin compile"),
        _ => ("Quarto", "quarto render"),
    };
    Error::new(
        ErrorKind::Build,
        format!(
            "{name} projects can't be built from the command line yet. Open the project in Oleafly, or run `{command}` yourself."
        ),
    )
}

fn missing_tool(engine: Engine) -> Error {
    let name = engine.tool_name();
    let variable = tool_env(name);
    Error::new(
        ErrorKind::MissingTool,
        match engine {
            Engine::Latexmk => format!(
                "{name} was not found. The latexmk engine needs a TeX distribution. Install one or set {variable}"
            ),
            _ => format!("{name} was not found. Install it or set {variable}"),
        },
    )
}

fn missing_package_file(error: &BuildError) -> Option<&str> {
    if error.kind != "error" {
        return None;
    }
    let (_, rest) = error.message.split_once("File `")?;
    let (file, _) = rest.split_once("' not found")?;
    let plain = file
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'+'));
    (plain && (file.ends_with(".sty") || file.ends_with(".cls"))).then_some(file)
}

fn tlmgr_program(tlmgr: &str, path: Option<&OsStr>) -> String {
    let first_on_path = path.and_then(|path| {
        std::env::split_paths(path)
            .filter(|folder| folder.is_absolute())
            .find_map(|folder| find_tool_in_dir(&folder, "tlmgr"))
    });
    if first_on_path.as_deref() == Some(Path::new(tlmgr)) {
        return "tlmgr".to_string();
    }
    let plain = tlmgr
        .chars()
        .all(|character| character.is_alphanumeric() || "/\\:._-+".contains(character));
    if plain {
        tlmgr.to_string()
    } else {
        format!("\"{tlmgr}\"")
    }
}

fn tlmgr_hint(program: &str, distribution: &str, file: &str) -> String {
    let sudo = if distribution == "mactex" {
        "sudo "
    } else {
        ""
    };
    format!(
        "Find the package that has it with `{program} search --global --file /{file}`, then run `{sudo}{program} install <package>`."
    )
}

fn follows_from_blocked_command(error: &BuildError) -> bool {
    let message = error.message.to_ascii_lowercase();
    error.code.as_deref() == Some("tex.explain.file_not_found")
        || ["shell", "can't find file", "minted", "pythontex"]
            .iter()
            .any(|text| message.contains(text))
}

fn shell_escape_message(denied: DeniedShellEscape) -> String {
    let need = match denied {
        DeniedShellEscape::Minted => "minted needs to run another program to highlight code",
        DeniedShellEscape::PythonTex => "PythonTeX needs to run Python",
        DeniedShellEscape::Command => "This document runs a shell command",
    };
    format!(
        "{need}, and `oleafly build` always blocks that. Open the project in Oleafly and click \"Allow external commands\", or run latexmk yourself with -shell-escape. Only do this if you trust every file in the project."
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

fn discover_from_candidates(
    variable: &'static str,
    discovery: &Discovery,
    candidates: Vec<(PathBuf, &'static str)>,
    workspace_root: &Path,
) -> ToolResolution {
    let mut rejected_override = None;
    if let Some(value) = discovery.overrides.get(variable) {
        match resolve_executable(value.clone(), workspace_root) {
            CandidateResolution::Safe(path) => {
                return ToolResolution {
                    discovered: Some(discovered_spelling(value, &path, workspace_root)),
                    executable: Some(path),
                    source: Some("override"),
                    rejected_override: None,
                };
            }
            CandidateResolution::ProjectLocal(path) => {
                rejected_override = Some(ToolRejection { variable, path });
            }
            CandidateResolution::Missing => {}
        }
    }
    let found = candidates.into_iter().find_map(|(candidate, source)| {
        match resolve_executable(candidate.clone(), workspace_root) {
            CandidateResolution::Safe(path) => {
                let discovered = discovered_spelling(&candidate, &path, workspace_root);
                Some((path, discovered, source))
            }
            CandidateResolution::Missing | CandidateResolution::ProjectLocal(_) => None,
        }
    });
    ToolResolution {
        source: found.as_ref().map(|(_, _, source)| *source),
        discovered: found.as_ref().map(|(_, discovered, _)| discovered.clone()),
        executable: found.map(|(path, _, _)| path),
        rejected_override,
    }
}

fn discovered_spelling(candidate: &Path, resolved: &Path, workspace_root: &Path) -> PathBuf {
    if candidate.is_absolute() && !candidate.starts_with(workspace_root) {
        candidate.to_path_buf()
    } else {
        resolved.to_path_buf()
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

fn latexmk_environment(build: &PreparedBuild) -> Vec<(&'static str, OsString)> {
    let nested = build.compile_directory() != build.project_root();
    let mut environment: Vec<(&'static str, String)> = if nested {
        project_search_environment(build.project_root())
    } else {
        Vec::new()
    };
    if let Some(entry) = bibtex_search_entry(build.compile_directory(), build.build_directory()) {
        environment.extend(bibtex_search_environment(&entry));
    }
    environment
        .into_iter()
        .map(|(name, value)| (name, value.into()))
        .collect()
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

#[cfg(test)]
fn detect_latexmk_flavor(source: &Path) -> Result<TexFlavor> {
    Ok(project_tex_flavor(
        source.parent().unwrap_or(source),
        source,
    ))
}

fn biber_unpack_dir(data_root: &Path, biber: &Path) -> Option<PathBuf> {
    let base = oleafly_core::biber_env::unpack_base(data_root);
    let base_ready =
        base == *data_root || oleafly_secrets::fsperm::create_private_dir(&base).is_ok();
    base_ready
        .then(|| prepare_unpack_dir(data_root, biber))
        .flatten()
}

fn apply_tex_output_notes(
    build: &PreparedBuild,
    out_dir: &Path,
    succeeded: bool,
    log: &mut String,
    errors: &mut Vec<BuildError>,
) {
    if let Some(bbl) = shipped_bibliography(build.project_root(), build.main_document()) {
        append_bounded(log, shipped_bibliography_note(&bbl).as_bytes());
    }
    let source = source_head(build.source_path()).unwrap_or_default();
    errors.extend(jobname_bibliography_warning(&source).map(BuildError::from));
    let bundled = build.engine() == Engine::Tectonic;
    errors.extend(
        unbuilt_index_warnings(log, out_dir, ENTRY_STEM, bundled)
            .into_iter()
            .map(BuildError::from),
    );
    if succeeded {
        return;
    }
    let mut causes: Vec<BuildError> = Vec::new();
    if !bundled {
        causes.extend(latexmk_biber_mismatch_error(log).map(BuildError::from));
        causes.extend(bibliography_above_main_error(out_dir, ENTRY_STEM).map(BuildError::from));
    }
    if !bundled && build.tex_flavor().is_none() {
        causes.extend(unicode_engine_error(log).map(|error| {
            let compiler = error.params.get("compiler").cloned().unwrap_or_default();
            let mut error = BuildError::from(error);
            error
                .hints
                .push(format!("oleafly build --compiler {compiler}"));
            error
        }));
    }
    causes.extend(
        nested_input_error(build.project_root(), build.main_document(), log).map(BuildError::from),
    );
    errors.splice(0..0, causes);
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

pub(crate) async fn run_command(
    launch: &Launch<'_>,
    timeout: Duration,
    sink: &CompilerLog,
) -> Result<(String, ExitStatus)> {
    run_command_with_stdin(launch, timeout, sink, None).await
}

pub(crate) async fn run_command_with_stdin(
    launch: &Launch<'_>,
    timeout: Duration,
    sink: &CompilerLog,
    stdin: Option<&str>,
) -> Result<(String, ExitStatus)> {
    let executable = launch.executable;
    let mut command = tokio::process::Command::new(executable);
    command
        .args(launch.arguments)
        .current_dir(launch.working_directory)
        .env("NoDefaultCurrentDirectoryInExePath", "1")
        .env("openout_any", "p")
        .env("openin_any", "p")
        .env("shell_escape", "f")
        .env(
            engine_spec::MIKTEX_SHELL_COMMANDS_VARIABLE,
            engine_spec::restricted_miktex_shell_commands(),
        )
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(path) = compiler_path(executable)? {
        command.env("PATH", path);
    }
    for (name, value) in launch.environment {
        command.env(name, value);
    }
    for name in launch.unset {
        command.env_remove(name);
    }
    for (name, value) in launch.variables {
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
    if let (Some(text), Some(mut pipe)) = (stdin.map(str::to_owned), child.stdin.take()) {
        tokio::spawn(async move {
            use tokio::io::AsyncWriteExt;
            let _ = pipe.write_all(text.as_bytes()).await;
        });
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| Error::new(ErrorKind::Build, "compiler stdout was not captured"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| Error::new(ErrorKind::Build, "compiler stderr was not captured"))?;
    let clock = Arc::new(CompileClock::start(timeout));
    let tracked = {
        let clock = clock.clone();
        let sink = sink.clone();
        CompilerLog::new(move |text| {
            clock.observe(text);
            sink.emit(text);
        })
    };
    let mut containment = Some(containment);
    let result = {
        let run = async {
            let wait = async {
                let status = child.wait().await?;
                drop(containment.take());
                Ok::<_, std::io::Error>(status)
            };
            tokio::try_join!(
                wait,
                read_stream(stdout, tracked.clone()),
                read_stream(stderr, tracked.clone())
            )
        };
        tokio::pin!(run);
        loop {
            let deadline = tokio::time::Instant::from_std(clock.deadline());
            match tokio::time::timeout_at(deadline, run.as_mut()).await {
                Ok(output) => break Ok(output),
                Err(elapsed) if clock.expired(Instant::now()) => break Err(elapsed),
                Err(_) => {}
            }
        }
    };
    drop(containment);
    let (status, mut log, stderr) = match result {
        Ok(Ok(output)) => output,
        error => {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
            let message = match error {
                Ok(Err(error)) => error.to_string(),
                Err(_) => timed_out_message(timeout, &clock),
                Ok(Ok(_)) => unreachable!(),
            };
            return Err(Error::new(ErrorKind::Build, message));
        }
    };
    append_bounded(&mut log, stderr.as_bytes());
    Ok((log, status))
}

fn timed_out_message(timeout: Duration, clock: &CompileClock) -> String {
    let message = format!("compiler timed out after {} seconds", timeout.as_secs());
    if clock.was_downloading(Instant::now()) {
        format!("{message}, while TeX packages were downloading. Build again, and the download picks up where it stopped")
    } else {
        message
    }
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

pub(crate) fn fingerprint_file(path: &Path) -> Result<String> {
    use std::io::Read;
    let mut file = crate::record::open_regular_file(path)?;
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
        Engine::Typst | Engine::Calepin => parse_typst_errors(log),
        Engine::Markdown | Engine::Quarto => parse_pandoc_diagnostics(log)
            .into_iter()
            .map(BuildError::from)
            .collect(),
        Engine::Tectonic => parse_tectonic_log_errors(log)
            .into_iter()
            .map(BuildError::from)
            .collect(),
        Engine::Latexmk => parse_tex_log_errors(log)
            .into_iter()
            .map(BuildError::from)
            .collect(),
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
                explanation: None,
                code: None,
            }
        })
        .collect()
}

#[cfg(test)]
#[path = "native_tests.rs"]
mod tests;
