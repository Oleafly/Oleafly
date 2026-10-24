//! The machine contract every command follows: one JSON result per command
//! on stdout (`--json`), progress events as JSON lines before it
//! (`--events`), stable exit codes and error kinds, and no prompts without a
//! terminal.
use std::borrow::Cow;
use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use clap::{Args, ValueEnum};
use serde::Serialize;
use serde_json::{json, Map, Value};

/// Bumped only for breaking changes to the JSON shapes.
pub const SCHEMA_VERSION: u32 = 1;

/// Process exit codes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[repr(u8)]
pub enum Exit {
    Ok = 0,
    Internal = 1,
    Usage = 2,
    Project = 3,
    Environment = 4,
    BuildFailed = 5,
    Auth = 6,
    Network = 7,
    Conflict = 8,
    Findings = 9,
    /// An agent run stopped at its step or time limit.
    Limit = 10,
    Interrupted = 130,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    InvalidInput,
    NotInitialized,
    InvalidManifest,
    UnsafePath,
    MissingTool,
    Io,
    /// A file outside the project (a client's settings, say) couldn't be
    /// read or written.
    System,
    Build,
    Usage,
    Internal,
    Auth,
    Network,
    Conflict,
    Findings,
    Limit,
    Interrupted,
}

impl ErrorKind {
    pub fn exit(self) -> Exit {
        match self {
            Self::InvalidInput
            | Self::NotInitialized
            | Self::InvalidManifest
            | Self::UnsafePath
            | Self::Io => Exit::Project,
            Self::MissingTool | Self::System => Exit::Environment,
            Self::Build => Exit::BuildFailed,
            Self::Usage => Exit::Usage,
            Self::Internal => Exit::Internal,
            Self::Auth => Exit::Auth,
            Self::Network => Exit::Network,
            Self::Conflict => Exit::Conflict,
            Self::Findings => Exit::Findings,
            Self::Limit => Exit::Limit,
            Self::Interrupted => Exit::Interrupted,
        }
    }
}

/// The error a failed result without one of its own carries, so `ok: false`
/// always comes with `error` (its kind matches the exit code).
fn exit_error(exit: Exit) -> CliError {
    let (kind, code, message) = match exit {
        Exit::Ok | Exit::Internal => (ErrorKind::Internal, "internal", "The command failed."),
        Exit::Usage => (
            ErrorKind::Usage,
            "usage.invalid",
            "The command was used wrongly.",
        ),
        Exit::Project => (
            ErrorKind::InvalidInput,
            "project.invalid_input",
            "The project is missing or invalid.",
        ),
        Exit::Environment => (
            ErrorKind::MissingTool,
            "environment.missing_tool",
            "A tool the command needs isn't ready.",
        ),
        Exit::BuildFailed => (ErrorKind::Build, "build.failed", "The build failed."),
        Exit::Auth => (ErrorKind::Auth, "auth.required", "You need to sign in."),
        Exit::Network => (ErrorKind::Network, "network.failed", "The network failed."),
        Exit::Conflict => (
            ErrorKind::Conflict,
            "conflict",
            "Something else holds the project.",
        ),
        Exit::Findings => (ErrorKind::Findings, "findings", "Problems were found."),
        Exit::Limit => (ErrorKind::Limit, "limit", "The run stopped at its limit."),
        Exit::Interrupted => (ErrorKind::Interrupted, "interrupted", "Stopped."),
    };
    CliError::new(kind, code, message)
}

/// An error as commands report it: a kind (which decides the exit code), a
/// stable dotted code, a sentence, and optionally a hint and details.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CliError {
    pub kind: ErrorKind,
    pub code: Cow<'static, str>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub retryable: bool,
    /// Boxed so a `Result<_, CliError>` stays small.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Box<Value>>,
}

impl CliError {
    pub fn new(
        kind: ErrorKind,
        code: impl Into<Cow<'static, str>>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            kind,
            code: code.into(),
            message: message.into(),
            hint: None,
            retryable: false,
            details: None,
        }
    }

    pub fn hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    pub fn retryable(mut self) -> Self {
        self.retryable = true;
        self
    }

    pub fn details(mut self, details: Value) -> Self {
        self.details = Some(Box::new(details));
        self
    }

    pub fn exit(&self) -> Exit {
        self.kind.exit()
    }

    pub fn usage(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Usage, "usage.invalid", message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Internal, "internal", message)
    }
}

impl std::fmt::Display for CliError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CliError {}

impl From<oleafly_core::Error> for CliError {
    fn from(error: oleafly_core::Error) -> Self {
        use oleafly_core::ErrorKind as Core;
        let (kind, code) = match error.kind() {
            Core::InvalidInput => (ErrorKind::InvalidInput, "project.invalid_input"),
            Core::NotInitialized => (ErrorKind::NotInitialized, "project.not_initialized"),
            Core::InvalidManifest => (ErrorKind::InvalidManifest, "project.invalid_manifest"),
            Core::UnsafePath => (ErrorKind::UnsafePath, "project.unsafe_path"),
            Core::MissingTool => (ErrorKind::MissingTool, "environment.missing_tool"),
            Core::Io => (ErrorKind::Io, "io.failed"),
            Core::Build => (ErrorKind::Build, "build.failed"),
        };
        let mut cli = CliError::new(kind, code, error.message());
        if kind == ErrorKind::NotInitialized {
            cli = cli.hint("Run `oleafly init` to create a project.json.");
        }
        cli
    }
}

impl From<std::io::Error> for CliError {
    fn from(error: std::io::Error) -> Self {
        CliError::new(ErrorKind::Io, "io.failed", error.to_string())
    }
}

/// Something a command noticed but carried on past.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Warning {
    pub code: Cow<'static, str>,
    pub message: String,
}

impl Warning {
    pub fn new(code: impl Into<Cow<'static, str>>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

/// What a command finished with.
#[derive(Clone, Debug, PartialEq)]
pub struct Outcome {
    pub ok: bool,
    pub exit: Exit,
    pub fields: Map<String, Value>,
    /// False when the command already wrote its own output (completions,
    /// man pages, help, the MCP server).
    pub print_envelope: bool,
}

fn fields_of(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(fields) => fields,
        Value::Null => Map::new(),
        other => {
            let mut fields = Map::new();
            fields.insert("value".into(), other);
            fields
        }
    }
}

impl Outcome {
    pub fn success(value: Value) -> Self {
        Self {
            ok: true,
            exit: Exit::Ok,
            fields: fields_of(value),
            print_envelope: true,
        }
    }

    pub fn failure(exit: Exit, value: Value) -> Self {
        Self {
            ok: false,
            exit,
            fields: fields_of(value),
            print_envelope: true,
        }
    }

    /// A failure with its own `error` object; the exit code follows its kind.
    pub fn failure_with(error: &CliError, value: Value) -> Self {
        let mut outcome = Self::failure(error.exit(), value);
        outcome.fields.insert(
            "error".into(),
            serde_json::to_value(error).unwrap_or(Value::Null),
        );
        outcome
    }

    pub fn printed() -> Self {
        Self {
            ok: true,
            exit: Exit::Ok,
            fields: Map::new(),
            print_envelope: false,
        }
    }
}

/// `{schema_version, type: "result", ok, command, ...fields, warnings}`.
pub fn envelope(command: &str, outcome: &Outcome, warnings: &[Warning]) -> Value {
    let mut value = Map::new();
    value.insert("schema_version".into(), json!(SCHEMA_VERSION));
    value.insert("type".into(), json!("result"));
    value.insert("ok".into(), json!(outcome.ok));
    value.insert("command".into(), json!(command));
    for (key, field) in &outcome.fields {
        value.insert(key.clone(), field.clone());
    }
    if !outcome.ok && !value.contains_key("error") {
        value.insert("error".into(), json!(exit_error(outcome.exit)));
    }
    value.insert("warnings".into(), json!(warnings));
    Value::Object(value)
}

/// The result object of a command that failed (`command` is null for
/// arguments that didn't parse).
pub fn error_envelope(command: Option<&str>, error: &CliError, warnings: &[Warning]) -> Value {
    json!({
        "schema_version": SCHEMA_VERSION,
        "type": "result",
        "ok": false,
        "command": command,
        "error": error,
        "warnings": warnings,
    })
}

/// A project path as someone typed it, with forward slashes. Windows shells
/// complete `.\chapters\a.tex`, and project paths are written `./chapters/a.tex`
/// everywhere else (on other systems a backslash is no separator and the path
/// is refused).
pub fn project_path_arg(value: &str) -> Cow<'_, str> {
    slashed(value, cfg!(windows))
}

fn slashed(value: &str, windows: bool) -> Cow<'_, str> {
    if windows && value.contains('\\') {
        Cow::Owned(value.replace('\\', "/"))
    } else {
        Cow::Borrowed(value)
    }
}

/// Path arguments refuse control characters.
pub fn path_arg(value: &str) -> Result<PathBuf, String> {
    if value.chars().any(char::is_control) {
        return Err("paths can't contain control characters".into());
    }
    Ok(PathBuf::from(value))
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, ValueEnum)]
pub enum LogMode {
    /// No compiler log.
    None,
    /// The last part of the log.
    #[default]
    Tail,
    /// The whole (bounded) log.
    Full,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, ValueEnum)]
pub enum ColorMode {
    #[default]
    Auto,
    Always,
    Never,
}

/// Options every command takes.
#[derive(Clone, Debug, Args)]
pub struct GlobalArgs {
    #[arg(short = 'C', long, global = true, default_value = ".", value_name = "PATH", value_parser = path_arg, help = "Run against this project directory")]
    pub project: PathBuf,
    #[arg(long, global = true, help = "Write one JSON result to stdout")]
    pub json: bool,
    #[arg(
        long,
        global = true,
        help = "Stream progress events as JSON lines before the result; implies --json"
    )]
    pub events: bool,
    #[arg(short = 'q', long, global = true, help = "Print only the result")]
    pub quiet: bool,
    #[arg(
        long,
        global = true,
        value_enum,
        value_name = "MODE",
        help = "How much compiler log to show: none, tail or full (default: tail with --json, full otherwise)"
    )]
    pub log: Option<LogMode>,
    #[arg(long, global = true, value_enum, default_value_t = ColorMode::Auto, value_name = "WHEN", help = "Use color: auto, always or never")]
    pub color: ColorMode,
    #[arg(
        long,
        global = true,
        help = "Never ask a question; fail instead when one is needed"
    )]
    pub no_input: bool,
}

/// Whether a command may ask questions.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InputPolicy {
    pub interactive: bool,
}

impl InputPolicy {
    /// `CI` counts when set to anything but empty, `0` or `false`.
    pub fn resolve(no_input: bool, ci: Option<&str>, terminals: bool) -> Self {
        let ci = ci.is_some_and(|value| {
            let value = value.trim();
            !value.is_empty() && value != "0" && !value.eq_ignore_ascii_case("false")
        });
        Self {
            interactive: !no_input && !ci && terminals,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct ContextOptions {
    pub project: PathBuf,
    pub project_explicit: bool,
    pub json: bool,
    pub events: bool,
    pub quiet: bool,
    pub log: Option<LogMode>,
    pub interactive: bool,
    pub data_root: Option<PathBuf>,
    pub command: &'static str,
}

/// What a running command knows about how it was called.
#[derive(Debug)]
pub struct Context {
    project: PathBuf,
    project_explicit: bool,
    json: bool,
    events: bool,
    quiet: bool,
    log: LogMode,
    interactive: bool,
    data_root: Option<PathBuf>,
    command: &'static str,
    warnings: Mutex<Vec<Warning>>,
    out: Mutex<()>,
}

impl Context {
    pub fn new(options: ContextOptions) -> Self {
        let json = options.json || options.events;
        Self {
            project: options.project,
            project_explicit: options.project_explicit,
            json,
            events: options.events,
            quiet: options.quiet,
            log: options
                .log
                .unwrap_or(if json { LogMode::Tail } else { LogMode::Full }),
            interactive: options.interactive,
            data_root: options.data_root,
            command: options.command,
            warnings: Mutex::new(Vec::new()),
            out: Mutex::new(()),
        }
    }

    /// From the parsed global options and this process's environment.
    pub fn from_global(global: &GlobalArgs, project_explicit: bool, command: &'static str) -> Self {
        let terminals = std::io::stdin().is_terminal() && std::io::stderr().is_terminal();
        let ci = std::env::var("CI").ok();
        Self::new(ContextOptions {
            project: global.project.clone(),
            project_explicit,
            json: global.json,
            events: global.events,
            quiet: global.quiet,
            log: global.log,
            interactive: InputPolicy::resolve(global.no_input, ci.as_deref(), terminals)
                .interactive,
            data_root: crate::app_paths::data_root(),
            command,
        })
    }

    #[cfg(test)]
    pub fn for_test(options: ContextOptions) -> Self {
        Self::new(ContextOptions {
            project: if options.project.as_os_str().is_empty() {
                PathBuf::from(".")
            } else {
                options.project.clone()
            },
            ..options
        })
    }

    pub fn project(&self) -> &Path {
        &self.project
    }

    pub fn project_explicit(&self) -> bool {
        self.project_explicit
    }

    pub fn json(&self) -> bool {
        self.json
    }

    pub fn events(&self) -> bool {
        self.events
    }

    pub fn quiet(&self) -> bool {
        self.quiet
    }

    pub fn log_mode(&self) -> LogMode {
        self.log
    }

    pub fn interactive(&self) -> bool {
        self.interactive
    }

    pub fn data_root(&self) -> Option<&Path> {
        self.data_root.as_deref()
    }

    pub fn command(&self) -> &'static str {
        self.command
    }

    /// Records a warning (JSON) and prints it (people) unless quiet.
    pub fn warn(&self, code: impl Into<Cow<'static, str>>, message: impl Into<String>) {
        let warning = Warning::new(code, message);
        if !self.json && !self.quiet {
            crate::human::warning(&warning.message);
        }
        self.warnings
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(warning);
    }

    pub fn warnings(&self) -> Vec<Warning> {
        self.warnings
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    /// A note for people on stderr (nothing with `--json` or `--quiet`).
    pub fn note(&self, message: impl AsRef<str>) {
        if !self.json && !self.quiet {
            crate::human::note(message.as_ref());
        }
    }

    /// A line for people on stdout (nothing with `--json`).
    pub fn say(&self, message: impl AsRef<str>) {
        if !self.json {
            let _guard = self
                .out
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let mut stdout = std::io::stdout().lock();
            let _ = writeln!(stdout, "{}", crate::human::plain(message.as_ref()));
        }
    }

    /// One NDJSON event line, only with `--events`.
    pub fn event(&self, name: &str, fields: Value) -> Result<(), CliError> {
        if !self.events {
            return Ok(());
        }
        self.write_event(name, fields)
    }

    /// An event line whenever JSON is on: for commands whose JSON output is
    /// a stream of events (`watch`).
    pub fn stream_event(&self, name: &str, fields: Value) -> Result<(), CliError> {
        if !self.json {
            return Ok(());
        }
        self.write_event(name, fields)
    }

    fn write_event(&self, name: &str, fields: Value) -> Result<(), CliError> {
        let mut value = Map::new();
        value.insert("schema_version".into(), json!(SCHEMA_VERSION));
        value.insert("type".into(), json!("event"));
        value.insert("command".into(), json!(self.command));
        value.insert("event".into(), json!(name));
        for (key, field) in fields_of(fields) {
            value.insert(key, field);
        }
        let _guard = self
            .out
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut stdout = std::io::stdout().lock();
        serde_json::to_writer(&mut stdout, &Value::Object(value)).map_err(|error| {
            CliError::internal(format!("Oleafly couldn't write the event: {error}"))
        })?;
        writeln!(stdout)?;
        stdout.flush().map_err(CliError::from)
    }

    /// Asks a yes/no question on stderr; `--yes` answers it, and without a
    /// terminal it is a usage error naming `--yes`.
    pub fn confirm(&self, question: &str, assume_yes: bool) -> Result<bool, CliError> {
        if assume_yes {
            return Ok(true);
        }
        if !self.interactive {
            return Err(CliError::new(
                ErrorKind::Usage,
                "usage.confirmation_required",
                "This needs your confirmation. Run it again with --yes.",
            ));
        }
        let mut stderr = std::io::stderr().lock();
        let _ = write!(stderr, "{question} [y/N] ");
        let _ = stderr.flush();
        let mut answer = String::new();
        std::io::stdin().read_line(&mut answer)?;
        let answer = answer.trim().to_ascii_lowercase();
        Ok(answer == "y" || answer == "yes")
    }

    /// A project-relative file path, checked to stay inside the project.
    pub fn resolve_project_file(
        &self,
        workspace: &oleafly_core::Workspace,
        relative: &str,
    ) -> Result<PathBuf, CliError> {
        let unsafe_path = || {
            CliError::new(
                ErrorKind::UnsafePath,
                "project.unsafe_path",
                format!("{relative} isn't a path inside the project."),
            )
            .hint("Use a path inside the project, written with forward slashes.")
        };
        let slashed = project_path_arg(relative);
        if slashed.chars().any(char::is_control) || slashed.contains('\\') {
            return Err(unsafe_path());
        }
        oleafly_core::resolve_project_path(workspace.root(), &slashed).map_err(|_| unsafe_path())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_codes_are_stable_for_every_error_kind() {
        use ErrorKind::*;
        for (kind, exit) in [
            (InvalidInput, 3),
            (NotInitialized, 3),
            (InvalidManifest, 3),
            (UnsafePath, 3),
            (Io, 3),
            (MissingTool, 4),
            (Build, 5),
            (Usage, 2),
            (Internal, 1),
            (Auth, 6),
            (Network, 7),
            (Conflict, 8),
            (Findings, 9),
            (Limit, 10),
            (System, 4),
            (Interrupted, 130),
        ] {
            assert_eq!(kind.exit() as u8, exit, "{kind:?}");
        }
    }

    #[test]
    fn a_failed_result_always_carries_an_error_matching_its_exit() {
        let failed = envelope(
            "build",
            &Outcome::failure(Exit::BuildFailed, json!({"build": {"ok": false}})),
            &[],
        );
        assert_eq!(
            (
                failed["error"]["kind"].clone(),
                failed["error"]["code"].clone()
            ),
            (json!("build"), json!("build.failed"))
        );
        let limited = envelope(
            "agent run",
            &Outcome::failure_with(
                &CliError::new(
                    ErrorKind::Limit,
                    "agent.step_limit",
                    "Stopped after 3 steps.",
                ),
                json!({"run": {}}),
            ),
            &[],
        );
        assert_eq!(limited["error"]["code"], "agent.step_limit");
        assert_eq!(
            Outcome::failure_with(&CliError::new(ErrorKind::Limit, "x", "y"), json!({})).exit,
            Exit::Limit
        );
        let ok = envelope("build", &Outcome::success(json!({})), &[]);
        assert!(ok.get("error").is_none());
    }

    #[test]
    fn core_errors_keep_their_kind_and_gain_a_code() {
        let error: CliError = oleafly_core::Error::new(
            oleafly_core::ErrorKind::MissingTool,
            "tectonic was not found",
        )
        .into();
        assert_eq!(
            (
                serde_json::to_value(error.kind).unwrap(),
                error.code.as_ref(),
                error.exit() as u8
            ),
            (json!("missing_tool"), "environment.missing_tool", 4)
        );
        let error: CliError =
            oleafly_core::Error::new(oleafly_core::ErrorKind::NotInitialized, "x").into();
        assert_eq!(error.code, "project.not_initialized");
        assert!(error.hint.unwrap().contains("oleafly init"));
    }

    #[test]
    fn envelopes_carry_schema_version_type_and_warnings() {
        let ok = envelope(
            "build",
            &Outcome::success(json!({"build": {"ok": true}})),
            &[Warning::new("build.flag_ignored", "--fast is ignored")],
        );
        assert_eq!(
            (
                ok["schema_version"].clone(),
                ok["type"].clone(),
                ok["ok"].clone(),
                ok["command"].clone()
            ),
            (json!(1), json!("result"), json!(true), json!("build"))
        );
        assert_eq!(ok["warnings"][0]["code"], "build.flag_ignored");
        let error = error_envelope(
            Some("build"),
            &CliError::new(
                ErrorKind::Conflict,
                "conflict.build_running",
                "Another build is running",
            )
            .retryable(),
            &[],
        );
        assert_eq!(
            (
                error["ok"].clone(),
                error["error"]["kind"].clone(),
                error["error"]["retryable"].clone()
            ),
            (json!(false), json!("conflict"), json!(true))
        );
        assert!(error["error"].get("hint").is_none() && error["error"].get("details").is_none());
        let conflict = CliError::new(ErrorKind::Conflict, "agent.apply_conflict", "x")
            .details(json!({"paths": ["a.tex"]}));
        assert_eq!(
            error_envelope(Some("agent apply"), &conflict, &[])["error"]["details"]["paths"][0],
            "a.tex"
        );
    }

    #[test]
    fn ci_and_no_input_disable_prompts() {
        assert!(!InputPolicy::resolve(false, Some("true"), true).interactive);
        assert!(!InputPolicy::resolve(true, None, true).interactive);
        assert!(!InputPolicy::resolve(false, None, false).interactive);
        for off in ["0", "false", "FALSE", ""] {
            assert!(
                InputPolicy::resolve(false, Some(off), true).interactive,
                "{off}"
            );
        }
    }

    #[test]
    fn confirm_without_a_tty_is_a_usage_error_naming_yes() {
        let ctx = Context::for_test(ContextOptions {
            interactive: false,
            ..Default::default()
        });
        let error = ctx.confirm("Write ~/.cursor/mcp.json?", false).unwrap_err();
        assert_eq!(
            (error.kind, error.code.as_ref()),
            (ErrorKind::Usage, "usage.confirmation_required")
        );
        assert!(error.message.contains("--yes"));
        assert!(ctx.confirm("x", true).unwrap());
    }

    #[test]
    fn project_files_must_stay_inside_the_project() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(dir.path().join("main.tex"), "\\documentclass{article}").unwrap();
        let workspace = oleafly_core::Workspace::detected(dir.path(), None).unwrap();
        let ctx = Context::for_test(ContextOptions::default());
        for bad in [
            "../x.tex",
            "/etc/passwd",
            "C:\\x.tex",
            "..\\x.tex",
            "ok/\u{7}.tex",
        ] {
            assert_eq!(
                ctx.resolve_project_file(&workspace, bad).unwrap_err().code,
                "project.unsafe_path",
                "{bad}"
            );
        }
        // A backslash is no separator except on Windows, where it is one.
        let backslashed = ctx.resolve_project_file(&workspace, "a\\b.tex");
        assert_eq!(backslashed.is_err(), cfg!(not(windows)));
        assert!(ctx.resolve_project_file(&workspace, "main.tex").is_ok());
    }

    #[test]
    fn windows_paths_are_read_with_forward_slashes_only_on_windows() {
        assert_eq!(slashed(".\\chapters\\a.tex", true), "./chapters/a.tex");
        assert_eq!(slashed(".\\chapters\\a.tex", false), ".\\chapters\\a.tex");
        assert!(matches!(slashed("chapters/a.tex", true), Cow::Borrowed(_)));
    }
}
