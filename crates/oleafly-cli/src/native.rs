//! Builds on this computer with the same compilers, arguments, environment
//! and diagnostics the desktop app uses (`oleafly_core::engine_spec`,
//! `tex_errors`, `build_output`): one build per project at a time, outputs
//! staged and moved into place when the build ends, the last good PDF kept
//! when a build fails.
use crate::app_paths::InstalledApp;
use crate::contract::{CliError, ErrorKind as CliErrorKind};
use crate::process;
use crate::typst::PinnedTypst;
use crate::typst_settings::TypstSettings;
use oleafly_core::biber_env::{
    compile_path_env, prepare_unpack_dir, tectonic_biber_in, UNPACK_ENV,
};
use oleafly_core::build_output::{
    locks_unsupported, sweep_stale_staging, ArtifactSnapshot, BuildLock, DirLock, OutputStaging,
};
use oleafly_core::engine_spec::{
    self, compiler_crash_note, is_bundle_fetch_failure, latex_entry_source, tex_bundle_url,
    EngineFlags, MarkdownPdfArgs, BUNDLE_FALLBACK_NOTE, ENTRY_STEM, ENTRY_TEX,
    MERMAID_FIGURES_FILTER, MERMAID_FIGURES_FILTER_NAME,
};
use oleafly_core::pandoc::{
    pandoc_candidates, pandoc_version_supported, parse_pandoc_version, PandocSearch,
    MIN_PANDOC_VERSION,
};
use oleafly_core::process_probe::{probe_output, PROBE_TIMEOUT};
use oleafly_core::tex_distro::TexSearch;
use oleafly_core::tex_errors::{
    parse_pandoc_diagnostics, parse_tex_log_errors, rebase_log_files, resolve_extensionless_inputs,
    CompileError, ENGINE_OUTPUT_MARKER,
};
use oleafly_core::typst_log::{parse_typst_diagnostics, typst_path_relative_to};
use oleafly_core::typst_toolchain::{
    bundled_typst_version, capabilities_for, system_typst_candidates, typst_compile_args,
    ToolchainVersion, TypstCapabilities, TypstDiagnosticFormat,
};
use oleafly_core::{
    bibtex_search_entry, bibtex_search_environment, image_failure_evidence, image_failure_notes,
    parse_latex_log, place_image_findings, plain_path, slash_path, source_tex_flavor, Engine,
    EngineScratch, EngineScratchBases, Error, ErrorKind, ImageFinding, LogCategory, LogDiagnostic,
    LogSeverity, PreparedBuild, Result, TexFlavor, Utf8StreamDecoder, Workspace, ENGINE_TEMP_DIR,
    TEMP_DIRECTORY_VARIABLES,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;

const MAX_LOG_BYTES: usize = 1024 * 1024;
const LOG_TRUNCATION_MARKER: &str = "\n[Oleafly: compiler output truncated]\n";
const ENGINE_OUTPUT_TAIL_BYTES: usize = 8 * 1024;
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(300);
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

/// The engine flags a build takes (`--offline`, `--fast`, `--halt-on-error`).
#[cfg(test)]
pub type BuildOptions = EngineFlags;

/// The flags `engine` has no use for.
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
    /// A plain-English explanation for common TeX errors.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explanation: Option<String>,
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
        }
    }
}

/// What a build did. `log` holds the engine's log (and on failure its
/// output), bounded to 1 MiB; commands decide how much of it to print.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct BuildResult {
    pub ok: bool,
    pub engine: Engine,
    pub main_document: String,
    pub build_directory: PathBuf,
    /// The PDF this build wrote.
    pub output: Option<PathBuf>,
    /// The PDF an earlier build left, when this one wrote none.
    pub previous_output: Option<PathBuf>,
    pub output_id: Option<String>,
    pub fresh: bool,
    /// Where `-o` copied the PDF.
    pub copied_to: Option<PathBuf>,
    pub log: String,
    /// The whole log, kept beside the build record.
    pub log_path: Option<PathBuf>,
    pub errors: Vec<BuildError>,
    pub diagnostics: Vec<LogDiagnostic>,
    pub compile_time_ms: u64,
    /// How long the build waited for another build of the project.
    pub waited_ms: u64,
    /// Things the build noticed and carried on past (printed by commands).
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

/// Where tools are looked for. Built once per command from the
/// environment; tests build their own.
#[derive(Clone, Debug, Default)]
pub struct Discovery {
    pub workspace_root: PathBuf,
    /// The CLI's own folder (links resolved).
    pub cli_dir: Option<PathBuf>,
    pub app: Option<InstalledApp>,
    pub data_root: Option<PathBuf>,
    pub tex: TexSearch,
    pub pandoc: PandocSearch,
    pub path: Option<OsString>,
    /// `OLEAFLY_TECTONIC`, `OLEAFLY_LATEXMK`, `OLEAFLY_TYPST`, `OLEAFLY_PANDOC`.
    pub overrides: BTreeMap<&'static str, PathBuf>,
    /// Debug builds also try the app's development sidecars.
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
            ..TexSearch::from_env()
        };
        let pandoc = PandocSearch {
            bundled_dirs: cli_dir
                .iter()
                .chain(app.as_ref().map(|app| &app.bin_dir))
                .cloned()
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

    /// Bundled copies of `name`: beside the CLI, then in the app, then the
    /// development sidecars.
    pub(crate) fn bundled_candidates(&self, name: &str) -> Vec<PathBuf> {
        let mut candidates: Vec<PathBuf> = Vec::new();
        for folder in self
            .cli_dir
            .iter()
            .chain(self.app.as_ref().map(|app| &app.bin_dir))
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
    /// The Biber that ships with Tectonic, when it sits beside it.
    pub tectonic_biber: Option<PathBuf>,
    /// TeX distribution folders compile children get on their PATH.
    pub tex_dirs: Vec<PathBuf>,
    pub pandoc_version: Option<String>,
    /// Pandocs passed over for being older than 2.19.
    pub pandoc_too_old: Vec<(PathBuf, String)>,
    pub data_root: Option<PathBuf>,
    pub tex: TexSearch,
    /// Where each tool came from (`override`, `bundled`, `app`, `path`, `tex`).
    pub sources: BTreeMap<&'static str, &'static str>,
    pandoc_probed: bool,
    rejected_overrides: BTreeMap<&'static str, ToolRejection>,
    typst_capabilities: Option<TypstCapabilities>,
    typst_version: Option<ToolchainVersion>,
    typst_pin_error: Option<String>,
}

impl BuildTools {
    /// Finds tectonic, latexmk and typst (Pandoc waits for
    /// [`BuildTools::resolve_pandoc`], which runs it).
    pub fn discover_with(discovery: &Discovery) -> Self {
        let root = &discovery.workspace_root;
        let mut tools = BuildTools {
            data_root: discovery.data_root.clone(),
            tex: discovery.tex.clone(),
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
        let typst = discover_from_candidates("OLEAFLY_TYPST", discovery, typst_candidates, root);
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
            .and_then(tectonic_biber_in);
        tools.tectonic = tectonic.executable;
        tools.latexmk = latexmk.executable;
        tools.typst = typst.executable;
        tools
    }

    /// Finds a Pandoc of 2.19 or later (each candidate runs `--version`, at
    /// most 5 seconds).
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
                        // A Pandoc that won't say its version is taken at its word.
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

    /// Why Pandoc is missing, when an older one was found.
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
    source: Option<&'static str>,
    rejected_override: Option<ToolRejection>,
}

/// Makes the file names in Typst's errors relative to the project.
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

/// Publishes the outputs a build staged. A failed build keeps the last good
/// PDF (and its SyncTeX) in place.
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

    /// Runs once when another build of the project holds the lock.
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

    /// The project's build lock and how long it took. Where the file system
    /// can't lock files at all (NFS without a lock service, some cluster
    /// file systems) builds take turns through a lock folder instead. Any
    /// other lock error (a linked lock file, no permission, a full disk)
    /// stops the build: two builds in one folder overwrite each other's
    /// files.
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
                DirLock::try_acquire(build_dir, self.timeout + DIR_LOCK_SLACK)
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
        // With the lock held, a staging folder left behind is no running
        // build's: its own mtime only moves when files come and go in it.
        sweep_stale_staging(&build_dir, STALE_STAGING);
        let unlocked = lock.is_folder();
        let started = Instant::now();
        let pdf = build_dir.join(format!("{ENTRY_STEM}.pdf"));
        let engine_log = build_dir.join(format!("{ENTRY_STEM}.log"));

        let mut command = self.command(build, flags, true)?;
        // Only latexmk writes in place; the other engines write into the
        // staging folder `command` made.
        let mut in_place = match command.staging {
            None => Some(InPlaceOutputs::prepare(&build_dir)?),
            Some(_) => None,
        };
        let (mut output, mut status) =
            run_command(&command.launch(), self.timeout, &self.log).await?;
        if let Some(note) = compiler_crash_note(&status) {
            self.log.emit(&note);
            append_bounded(&mut output, note.as_bytes());
        }
        if !status.success() && command.bundle_pinned && is_bundle_fetch_failure(&output) {
            (status, command) = self
                .retry_without_pinned_bundle(build, flags, &mut output)
                .await?;
        }

        let tex_engine = matches!(build.engine(), Engine::Tectonic | Engine::Latexmk);
        let produced_pdf = command.produced_output.is_file();
        // The engine's own log: in the staging folder, or in place for latexmk.
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
        let mut log = match &file_log {
            Some(file_log) => {
                with_engine_output_on_failure(file_log.clone(), &output, status.success())
            }
            None => output,
        };
        let mut errors = parse_errors(build.engine(), &log);
        if build.engine() == Engine::Typst {
            relativize_typst_errors(&mut errors, &command.working_directory).await;
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
        let diagnostics = diagnostics_for(build, file_log.as_deref(), &mut errors);
        let output_path = (fresh && pdf.is_file()).then(|| pdf.clone());
        let previous_output = (!fresh && pdf.is_file()).then(|| pdf.clone());
        let output_id = output_path.as_deref().map(fingerprint_file).transpose()?;
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
            warnings: if unlocked {
                vec![crate::contract::Warning::new(
                    "build.unlocked",
                    "This folder doesn't support file locks, so builds took turns through a lock folder instead. Older Oleafly versions don't use it, so don't run them on this project at the same time.",
                )]
            } else {
                Vec::new()
            },
        })
    }

    /// Builds again against the installed TeX bundle after the pinned one
    /// could not be fetched. `output` becomes the log of both runs; the
    /// retry's status and command come back.
    async fn retry_without_pinned_bundle(
        &self,
        build: &PreparedBuild,
        flags: EngineFlags,
        output: &mut String,
    ) -> std::result::Result<(ExitStatus, BuildCommand), CliError> {
        let first = std::mem::take(output);
        let note = format!("\n{BUNDLE_FALLBACK_NOTE}\n");
        self.log.emit(&note);
        let retry = self.command(build, flags, false)?;
        let (retry_output, retry_status) =
            run_command(&retry.launch(), self.timeout, &self.log).await?;
        if build.engine() == Engine::Markdown {
            append_bounded(output, first.as_bytes());
        }
        append_bounded(output, note.as_bytes());
        append_bounded(output, retry_output.as_bytes());
        if let Some(crash) = compiler_crash_note(&retry_status) {
            append_bounded(output, crash.as_bytes());
        }
        Ok((retry_status, retry))
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
                oleafly_core::atomic::write_atomic(
                    &entry,
                    latex_entry_source(build.main_document())?.as_bytes(),
                )?;
                let staged = OutputStaging::create(build_dir)?;
                seed_staging(build_dir, staged.path());
                let mut search: Vec<&Path> = Vec::new();
                if build.compile_directory() != build.project_root() {
                    search.push(build.compile_directory());
                }
                search.push(build.project_root());
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
                (arguments, produced, build.project_root().to_path_buf())
            }
            Engine::Latexmk => {
                let (arguments, texmf_output) =
                    self.latexmk_arguments(build, flags, &executable)?;
                environment.extend(latexmk_environment(build));
                environment.extend(self.tex_environment(&executable, build.project_root()));
                if let Some(output) = texmf_output {
                    environment.push(("TEXMFOUTPUT", output.into()));
                }
                if arguments.iter().any(|argument| argument == "-lualatex") {
                    unset.push("openin_any");
                }
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
                let resources = created.pandoc_resource_path(&project)?;
                oleafly_core::atomic::write_atomic(
                    &created.path().join(MERMAID_FIGURES_FILTER_NAME),
                    MERMAID_FIGURES_FILTER.as_bytes(),
                )?;
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

    /// PATH (the tool's folder, Tectonic's Biber, the TeX folders, then the
    /// inherited PATH without the project) and Biber's unpack folder.
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
            if let Some(unpack) = prepare_unpack_dir(data_root, biber) {
                environment.push((UNPACK_ENV, unpack.into_os_string()));
            }
        }
        environment
    }

    /// latexmk's arguments, and `TEXMFOUTPUT` when the build folder is
    /// outside the project (a linked folder's build folder).
    fn latexmk_arguments(
        &self,
        build: &PreparedBuild,
        flags: EngineFlags,
        latexmk: &Path,
    ) -> Result<(Vec<OsString>, Option<String>)> {
        engine_spec::validate_latex_main_document(build.main_document())?;
        let flavor = build.tex_flavor().map_or_else(
            || detect_latexmk_flavor(build.source_path()),
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
            oleafly_core::tex_distro::distribution_kind_for_tool(&self.tools.tex, latexmk);
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

/// Runs Pandoc and Typst for the shared document tools (300 s each).
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

/// A lock folder older than the build timeout plus this is a stopped
/// build's, and is taken over.
const DIR_LOCK_SLACK: Duration = Duration::from_secs(60);

/// What keeps other builds of the project out while this one runs: the
/// build lock, or a lock folder where the file system can't lock files.
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

/// The error a build gets when another build of the project holds the lock
/// for the whole timeout.
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

/// Line-level diagnostics, file names made project-relative.
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
/// The outputs a failed latexmk build puts back.
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
    /// Copies of the outputs as they were; `None` when no folder could be made.
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
                    // A half copy would put a truncated PDF back.
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

    /// The file exists and this build wrote it.
    fn is_fresh(&self, path: &Path) -> bool {
        self.before.is_fresh(path)
    }

    /// The build ended. A failed one gets its last good outputs back.
    fn finish(&mut self, ok: bool) {
        if !ok {
            self.keep_last_good();
        }
        self.finished = true;
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
                // Nothing to put back: a failed build's best-effort output
                // would pass for a good one, as no staged engine leaves it.
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

/// Removes every symbolic link and non-regular file (a FIFO, a socket, a
/// device) under `directory`, without following any link. Real folders are
/// searched to [`MAX_LINK_SWEEP_DEPTH`]; another build's staging folder is
/// left alone.
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

/// Copies the last build's intermediate files (`.aux`, `.toc`, ...) into a
/// fresh staging folder.
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

/// The TeX log, plus the end of what the engine printed when it failed.
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

/// One compiler run.
pub(crate) struct Launch<'a> {
    pub executable: &'a Path,
    pub arguments: &'a [OsString],
    pub working_directory: &'a Path,
    pub environment: &'a [(&'static str, OsString)],
    /// Variables the run must not inherit (LuaTeX can't take `openin_any=p`).
    pub unset: &'a [&'static str],
    /// More variables, by owned name (set last).
    pub variables: &'a [(String, String)],
}

struct BuildCommand {
    executable: PathBuf,
    arguments: Vec<OsString>,
    /// Where the PDF appears (the staging folder, or the build folder).
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
        match resolve_executable(candidate, workspace_root) {
            CandidateResolution::Safe(path) => Some((path, source)),
            CandidateResolution::Missing | CandidateResolution::ProjectLocal(_) => None,
        }
    });
    ToolResolution {
        source: found.as_ref().map(|(_, source)| *source),
        executable: found.map(|(path, _)| path),
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

fn latexmk_environment(build: &PreparedBuild) -> Vec<(&'static str, OsString)> {
    bibtex_search_entry(build.compile_directory(), build.build_directory())
        .map(|entry| {
            bibtex_search_environment(&entry)
                .into_iter()
                .map(|(name, value)| (name, value.into()))
                .collect()
        })
        .unwrap_or_default()
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

fn detect_latexmk_flavor(source: &Path) -> Result<TexFlavor> {
    use std::io::Read;
    let mut file = std::fs::File::open(source)?;
    let mut bytes = Vec::new();
    file.by_ref().take(512 * 1024).read_to_end(&mut bytes)?;
    let source = String::from_utf8_lossy(&bytes);
    for line in source.lines().take(100) {
        let lower = line.trim().to_ascii_lowercase();
        if lower.contains("!tex program") || lower.contains("!tex engine") {
            let named = [
                TexFlavor::Xelatex,
                TexFlavor::Lualatex,
                TexFlavor::Uplatex,
                TexFlavor::Platex,
                TexFlavor::Pdflatex,
            ]
            .into_iter()
            .find(|flavor| lower.contains(flavor.as_str()));
            if let Some(flavor) = named {
                return Ok(flavor);
            }
        }
    }
    Ok(source_tex_flavor(&source).unwrap_or(TexFlavor::Pdflatex))
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

/// Runs one compiler with its process tree contained; returns its output
/// (bounded) and how it exited.
pub(crate) async fn run_command(
    launch: &Launch<'_>,
    timeout: Duration,
    sink: &CompilerLog,
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
        .stdin(Stdio::null())
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
    Ok((log, status))
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
        Engine::Tectonic | Engine::Latexmk => parse_tex_log_errors(log)
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
            }
        })
        .collect()
}

#[cfg(test)]
#[path = "native_tests.rs"]
mod tests;
