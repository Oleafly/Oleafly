use crate::process;
use oleafly_core::{Engine, Error, ErrorKind, PreparedBuild, Result, Workspace};
use serde::Serialize;
use sha2::{Digest, Sha256};
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct BuildError {
    pub line: Option<u32>,
    pub file: Option<String>,
    pub message: String,
    pub kind: String,
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
}

impl BuildTools {
    pub fn discover(workspace_root: &Path) -> Self {
        Self {
            tectonic: discover_tool("tectonic", "OLEAFLY_TECTONIC", workspace_root),
            latexmk: discover_tool("latexmk", "OLEAFLY_LATEXMK", workspace_root),
            typst: discover_tool("typst", "OLEAFLY_TYPST", workspace_root),
            pandoc: discover_pandoc(workspace_root),
        }
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
}

#[derive(Clone)]
pub struct NativeCompiler {
    tools: BuildTools,
    log: CompilerLog,
    timeout: Duration,
}

impl NativeCompiler {
    pub fn new(tools: BuildTools) -> Self {
        Self {
            tools,
            log: CompilerLog::default(),
            timeout: DEFAULT_TIMEOUT,
        }
    }

    pub fn with_log(mut self, log: CompilerLog) -> Self {
        self.log = log;
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
        let (log, exit_code) = run_command(
            &command.executable,
            &command.arguments,
            build.project_root(),
            self.timeout,
            &self.log,
        )
        .await?;
        let output = build.build_directory().join(format!("{OUTPUT_STEM}.pdf"));
        if command.produced_output.is_file() && command.produced_output != output {
            std::fs::rename(&command.produced_output, &output)?;
        }
        let output = output.is_file().then_some(output);
        let errors = parse_errors(build.engine(), &log);
        let ok = exit_code == Some(0)
            && output.is_some()
            && !errors.iter().any(|error| error.kind == "error");
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

    fn command(&self, build: &PreparedBuild, options: BuildOptions) -> Result<BuildCommand> {
        let executable = self
            .tools
            .for_engine(build.engine())
            .ok_or_else(|| missing_tool(build.engine()))?
            .to_path_buf();
        if executable.is_absolute() {
            reject_project_local_tool(&executable, build.project_root())?;
        }
        let output = build.build_directory().join(format!("{OUTPUT_STEM}.pdf"));
        let mut compiler_alias = None;
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
            Engine::Typst => (typst_arguments(build, &output), output.clone()),
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
                (
                    markdown_arguments(build, &output, &engine_path)?,
                    output.clone(),
                )
            }
        };
        Ok(BuildCommand {
            executable,
            arguments,
            produced_output,
            _compiler_alias: compiler_alias,
        })
    }
}

struct BuildCommand {
    executable: PathBuf,
    arguments: Vec<OsString>,
    produced_output: PathBuf,
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

fn tool_env(name: &str) -> String {
    format!("OLEAFLY_{}", name.to_ascii_uppercase())
}

fn executable_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn discover_tool(name: &str, variable: &str, workspace_root: &Path) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(value) = std::env::var_os(variable).filter(|value| !value.is_empty()) {
        candidates.push(PathBuf::from(value));
    }
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            candidates.push(parent.join(executable_name(name)));
        }
    }
    candidates.extend(development_sidecars(name));
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(
            std::env::split_paths(&path).map(|directory| directory.join(executable_name(name))),
        );
    }
    candidates
        .into_iter()
        .find_map(|candidate| resolve_executable(candidate, workspace_root))
}

fn discover_pandoc(workspace_root: &Path) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(value) = std::env::var_os("OLEAFLY_PANDOC").filter(|value| !value.is_empty()) {
        candidates.push(PathBuf::from(value));
    }
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
    candidates
        .into_iter()
        .find_map(|candidate| resolve_executable(candidate, workspace_root))
}

fn resolve_executable(candidate: PathBuf, workspace_root: &Path) -> Option<PathBuf> {
    if !is_executable_file(&candidate) {
        return None;
    }
    let candidate = candidate.canonicalize().ok()?;
    (!candidate.starts_with(workspace_root)).then_some(candidate)
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
    let output = build
        .build_directory()
        .strip_prefix(build.project_root())
        .map_err(|_| Error::new(ErrorKind::UnsafePath, "build directory escaped the project"))?;
    let input = build
        .source_path()
        .strip_prefix(build.project_root())
        .map_err(|_| Error::new(ErrorKind::UnsafePath, "main document escaped the project"))?;
    let mut arguments: Vec<OsString> = vec![
        "-norc".into(),
        "-no-shell-escape".into(),
        flavor.into(),
        "-interaction=nonstopmode".into(),
        "-synctex=1".into(),
        format!("-outdir=./{}", slash_path(output)).into(),
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

fn typst_arguments(build: &PreparedBuild, output: &Path) -> Vec<OsString> {
    vec![
        "--color".into(),
        "never".into(),
        "compile".into(),
        build.source_path().as_os_str().to_owned(),
        output.as_os_str().to_owned(),
        "--root".into(),
        build.project_root().as_os_str().to_owned(),
        "--diagnostic-format".into(),
        "short".into(),
    ]
}

fn markdown_arguments(
    build: &PreparedBuild,
    output: &Path,
    tectonic: &Path,
) -> Result<Vec<OsString>> {
    let mut arguments: Vec<OsString> = vec![
        "--from=markdown".into(),
        "--standalone".into(),
        format!("--resource-path={}", build.project_root().display()).into(),
        format!("--pdf-engine={}", tectonic.display()).into(),
        format!("--output={}", output.display()).into(),
    ];
    let bibliographies = discover_bibliographies(build.project_root())?;
    if !bibliographies.is_empty() {
        arguments.push("--citeproc".into());
    }
    for bibliography in bibliographies {
        arguments.push(format!("--bibliography={}", bibliography.display()).into());
    }
    arguments.extend(["--".into(), build.source_path().as_os_str().to_owned()]);
    Ok(arguments)
}

fn discover_bibliographies(root: &Path) -> Result<Vec<PathBuf>> {
    fn walk(root: &Path, directory: &Path, depth: usize, output: &mut Vec<PathBuf>) -> Result<()> {
        if depth > 64 {
            return Err(Error::new(
                ErrorKind::InvalidInput,
                "bibliography search exceeded the maximum directory depth",
            ));
        }
        for entry in std::fs::read_dir(directory)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                if !matches!(
                    entry.file_name().to_str(),
                    Some(".git" | ".oleafly" | "node_modules" | "target")
                ) {
                    walk(root, &path, depth + 1, output)?;
                }
            } else if file_type.is_file()
                && path
                    .extension()
                    .is_some_and(|value| value.eq_ignore_ascii_case("bib"))
            {
                output.push(path.strip_prefix(root).unwrap_or(&path).to_path_buf());
            }
        }
        Ok(())
    }
    let mut output = Vec::new();
    walk(root, root, 0, &mut output)?;
    output.sort();
    Ok(output)
}

fn slash_path(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

async fn run_command(
    executable: &Path,
    arguments: &[OsString],
    working_directory: &Path,
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
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(path) = compiler_path(executable)? {
        command.env("PATH", path);
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
            let _ = child.wait().await;
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
    let out_sink = sink.clone();
    let err_sink = sink.clone();
    let stdout_task = tokio::spawn(read_stream(stdout, out_sink));
    let stderr_task = tokio::spawn(read_stream(stderr, err_sink));
    let status = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(result) => result.map_err(|error| Error::new(ErrorKind::Build, error.to_string()))?,
        Err(_) => {
            drop(containment);
            let _ = child.wait().await;
            let _ = stdout_task.await;
            let _ = stderr_task.await;
            return Err(Error::new(
                ErrorKind::Build,
                format!("compiler timed out after {} seconds", timeout.as_secs()),
            ));
        }
    };
    drop(containment);
    let mut log = stdout_task
        .await
        .map_err(|error| Error::new(ErrorKind::Build, error.to_string()))?
        .map_err(|error| Error::new(ErrorKind::Build, error.to_string()))?;
    let stderr = stderr_task
        .await
        .map_err(|error| Error::new(ErrorKind::Build, error.to_string()))?
        .map_err(|error| Error::new(ErrorKind::Build, error.to_string()))?;
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
    loop {
        let read = stream.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        let text = String::from_utf8_lossy(&buffer[..read]);
        sink.emit(&text);
        append_bounded(&mut output, text.as_bytes());
    }
    Ok(output)
}

fn append_bounded(output: &mut String, bytes: &[u8]) {
    if bytes.is_empty() {
        return;
    }
    if output.len() >= MAX_LOG_BYTES {
        if !output.ends_with(LOG_TRUNCATION_MARKER) {
            let content_limit = MAX_LOG_BYTES.saturating_sub(LOG_TRUNCATION_MARKER.len());
            let boundary = (0..=content_limit)
                .rev()
                .find(|index| output.is_char_boundary(*index))
                .unwrap_or(0);
            output.truncate(boundary);
            output.push_str(LOG_TRUNCATION_MARKER);
        }
        return;
    }
    let text = String::from_utf8_lossy(bytes);
    let remaining = MAX_LOG_BYTES - output.len();
    if text.len() <= remaining {
        output.push_str(&text);
        return;
    }
    let content_limit = MAX_LOG_BYTES.saturating_sub(LOG_TRUNCATION_MARKER.len());
    if output.len() > content_limit {
        let boundary = (0..=content_limit)
            .rev()
            .find(|index| output.is_char_boundary(*index))
            .unwrap_or(0);
        output.truncate(boundary);
    }
    let remaining = content_limit - output.len();
    let boundary = (0..=remaining.min(text.len()))
        .rev()
        .find(|index| text.is_char_boundary(*index))
        .unwrap_or(0);
    output.push_str(&text[..boundary]);
    output.push_str(LOG_TRUNCATION_MARKER);
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

fn parse_errors(engine: Engine, log: &str) -> Vec<BuildError> {
    match engine {
        Engine::Typst => parse_typst_errors(log),
        Engine::Markdown => parse_pandoc_errors(log),
        Engine::Tectonic | Engine::Latexmk => parse_tex_errors(log),
    }
}

fn parse_typst_errors(log: &str) -> Vec<BuildError> {
    log.lines()
        .filter_map(|line| {
            ["error", "warning"].into_iter().find_map(|kind| {
                let marker = format!(": {kind}: ");
                let (location, message) = line.rsplit_once(&marker)?;
                let mut parts = location.rsplitn(3, ':');
                let _column = parts.next()?.parse::<u32>().ok()?;
                let line = parts.next()?.parse::<u32>().ok()?;
                let file = parts.next()?.to_string();
                Some(BuildError {
                    line: Some(line),
                    file: Some(file),
                    message: message.to_string(),
                    kind: kind.to_string(),
                })
            })
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
                engine: engine.as_str().into(),
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
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/compiler.rs");
        let output = directory.path().join(executable_name(if failure {
            "fixture-failure"
        } else {
            "fixture-success"
        }));
        let mut command = std::process::Command::new(
            std::env::var_os("RUSTC").unwrap_or_else(|| OsString::from("rustc")),
        );
        command
            .args(["--edition=2021", "-o"])
            .arg(&output)
            .arg(source);
        if failure {
            command.args(["--cfg", "fixture_failure"]);
        }
        let result = command.output().unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        output.canonicalize().unwrap()
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
        assert_eq!(&typst_arguments[..3], ["--color", "never", "compile"]);
        assert!(typst_arguments
            .windows(2)
            .any(|pair| pair == ["--diagnostic-format", "short"]));
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
        let markdown_command = compiler.command(&markdown_build, options).unwrap();
        let markdown_arguments = arguments(&markdown_command);
        assert_eq!(markdown_command.executable, pandoc);
        assert!(markdown_arguments.iter().any(|value| value == "--citeproc"));
        let bibliography = PathBuf::from("references").join("library.bib");
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
        assert_eq!(typst[1].kind, "warning");

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
            Duration::from_secs(5),
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

    #[cfg(unix)]
    #[tokio::test]
    async fn contained_command_times_out() {
        let shell = PathBuf::from("/bin/sh").canonicalize().unwrap();
        let arguments = [OsString::from("-c"), OsString::from("sleep 30")];
        let error = run_command(
            &shell,
            &arguments,
            Path::new("/"),
            Duration::from_millis(50),
            &CompilerLog::default(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::Build);
        assert!(error.to_string().contains("timed out"));
    }
}
