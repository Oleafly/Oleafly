use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use oleafly_core::process_probe::PROBE_TIMEOUT;
use oleafly_core::typst_toolchain::{parse_program_version_output, ToolchainVersion};

use super::LanguageServiceKind;
use crate::proc::NoConsole;

const TYPST_VERSION_LABEL: &str = "Typst Version:";
const TIMED_OUT_RETRY: Duration = Duration::from_secs(60);

type FileStamp = (u64, Option<SystemTime>);
type ProbeKey = (&'static str, PathBuf);

static PROBED: Mutex<BTreeMap<ProbeKey, Probe>> = Mutex::new(BTreeMap::new());

#[derive(Debug, Clone)]
struct Probe {
    stamp: FileStamp,
    outcome: Result<Probed, String>,
    retry_at: Option<Instant>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Probed {
    version: ToolchainVersion,
    typst: Option<ToolchainVersion>,
}

struct ProbeFailure {
    message: String,
    timed_out: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExternalServer {
    pub(crate) executable: PathBuf,
    pub(crate) version: ToolchainVersion,
    typst: Option<ToolchainVersion>,
}

impl ExternalServer {
    pub(crate) fn check_typst(&self, project: &ToolchainVersion) -> Result<(), String> {
        let Some(built) = &self.typst else {
            return Ok(());
        };
        let (built, wanted) = (built.minor_line(), project.minor_line());
        if built == wanted {
            return Ok(());
        }
        let variable = variable(LanguageServiceKind::Tinymist);
        Err(format!(
            "The Tinymist in {variable} is built for Typst {built}, and this project uses Typst {project}. \
             Pick a Typst {built} version for the project, or point {variable} to a Tinymist built for Typst {wanted}."
        ))
    }
}

const fn variable(kind: LanguageServiceKind) -> &'static str {
    match kind {
        LanguageServiceKind::TexLab => "OLEAFLY_TEXLAB",
        LanguageServiceKind::Tinymist => "OLEAFLY_TINYMIST",
    }
}

const fn display_name(kind: LanguageServiceKind) -> &'static str {
    match kind {
        LanguageServiceKind::TexLab => "TexLab",
        LanguageServiceKind::Tinymist => "Tinymist",
    }
}

const fn program_name(kind: LanguageServiceKind) -> &'static str {
    match kind {
        LanguageServiceKind::TexLab => "texlab",
        LanguageServiceKind::Tinymist => "tinymist",
    }
}

pub(crate) fn is_configured(kind: LanguageServiceKind) -> bool {
    configured_value(kind).is_some()
}

pub(crate) fn configured(kind: LanguageServiceKind) -> Option<Result<ExternalServer, String>> {
    configured_value(kind).map(|value| resolve(kind, &value, PROBE_TIMEOUT))
}

pub(crate) fn tinymist_for(typst: &ToolchainVersion) -> Option<Result<ToolchainVersion, String>> {
    let server = configured(LanguageServiceKind::Tinymist)?;
    Some(server.and_then(|server| server.check_typst(typst).map(|()| server.version)))
}

#[cfg(not(test))]
fn configured_value(kind: LanguageServiceKind) -> Option<OsString> {
    std::env::var_os(variable(kind))
}

#[cfg(test)]
fn configured_value(kind: LanguageServiceKind) -> Option<OsString> {
    simulated::value(kind)
}

fn resolve(
    kind: LanguageServiceKind,
    value: &OsStr,
    timeout: Duration,
) -> Result<ExternalServer, String> {
    let (name, variable) = (display_name(kind), variable(kind));
    if value.is_empty() {
        return Err(format!(
            "{variable} is set but empty. Set it to the full path of the {name} program, \
             or remove it to use the {name} that Oleafly installs."
        ));
    }
    let executable = PathBuf::from(value);
    if !executable.is_absolute() {
        return Err(format!(
            "{variable} has to be the full path of the {name} program."
        ));
    }
    let unreadable = || format!("{variable} points to a file that Oleafly can't read.");
    let canonical = executable.canonicalize().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            format!("{variable} points to a file that doesn't exist.")
        } else {
            unreadable()
        }
    })?;
    let metadata = std::fs::metadata(&canonical).map_err(|_| unreadable())?;
    if !metadata.is_file() {
        return Err(format!(
            "{variable} points to a folder, not to the {name} program."
        ));
    }
    if !crate::cloud::engine::executable(&metadata, true) {
        return Err(format!(
            "{variable} points to a file that isn't executable."
        ));
    }
    let stamp = (metadata.len(), metadata.modified().ok());
    let key = (program_name(kind), canonical);
    let outcome = match cached(&key, stamp) {
        Some(outcome) => outcome,
        None => {
            let (outcome, retry_at) = match probe(kind, &executable, timeout) {
                Ok(probed) => (Ok(probed), None),
                Err(failure) => (
                    Err(failure.message),
                    failure.timed_out.then(|| Instant::now() + TIMED_OUT_RETRY),
                ),
            };
            lock().insert(
                key,
                Probe {
                    stamp,
                    outcome: outcome.clone(),
                    retry_at,
                },
            );
            outcome
        }
    };
    let probed = outcome?;
    Ok(ExternalServer {
        executable,
        version: probed.version,
        typst: probed.typst,
    })
}

fn lock() -> std::sync::MutexGuard<'static, BTreeMap<ProbeKey, Probe>> {
    PROBED
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn cached(key: &ProbeKey, stamp: FileStamp) -> Option<Result<Probed, String>> {
    lock()
        .get(key)
        .filter(|probe| {
            probe.stamp == stamp
                && probe
                    .retry_at
                    .is_none_or(|retry_at| Instant::now() < retry_at)
        })
        .map(|probe| probe.outcome.clone())
}

fn probe(
    kind: LanguageServiceKind,
    executable: &Path,
    timeout: Duration,
) -> Result<Probed, ProbeFailure> {
    let (name, variable, program) = (display_name(kind), variable(kind), program_name(kind));
    let unrecognized = |message: String| ProbeFailure {
        message,
        timed_out: false,
    };
    let version_flag = match kind {
        LanguageServiceKind::TexLab => "--version",
        LanguageServiceKind::Tinymist => "-V",
    };
    let output = run(kind, executable, version_flag, timeout)?;
    let version = parse_program_version_output(&output, &[program]).ok_or_else(|| {
        unrecognized(format!(
            "The program in {variable} didn't report a {name} version, so it may not be {name}."
        ))
    })?;
    let typst = match kind {
        LanguageServiceKind::TexLab => None,
        LanguageServiceKind::Tinymist => Some(
            typst_version(&run(kind, executable, "--version", timeout)?).ok_or_else(|| {
                unrecognized(format!(
                    "The Tinymist in {variable} doesn't say which Typst version it was built with."
                ))
            })?,
        ),
    };
    Ok(Probed { version, typst })
}

fn run(
    kind: LanguageServiceKind,
    executable: &Path,
    flag: &str,
    timeout: Duration,
) -> Result<String, ProbeFailure> {
    let (variable, program) = (variable(kind), program_name(kind));
    let mut command = std::process::Command::new(executable);
    command.arg(flag).no_console();
    crate::proc::clear_appimage_env(&mut command);
    let failed = || ProbeFailure {
        message: format!("`{program} {flag}` failed for the program in {variable}."),
        timed_out: false,
    };
    let output = crate::proc::output_contained_with_timeout(command, timeout).map_err(|error| {
        if error.kind() == std::io::ErrorKind::TimedOut {
            ProbeFailure {
                message: format!(
                    "`{program} {flag}` didn't finish within {} seconds for the program in {variable}.",
                    timeout.as_secs_f32()
                ),
                timed_out: true,
            }
        } else {
            failed()
        }
    })?;
    if !output.status.success() {
        return Err(failed());
    }
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push('\n');
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    Ok(text)
}

fn typst_version(output: &str) -> Option<ToolchainVersion> {
    output.lines().find_map(|line| {
        let value = line
            .trim()
            .strip_prefix(TYPST_VERSION_LABEL)?
            .split_whitespace()
            .next()?;
        ToolchainVersion::parse(value.strip_prefix('v').unwrap_or(value))
    })
}

#[cfg(test)]
pub(crate) mod simulated {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    thread_local! {
        static CONFIGURED: RefCell<HashMap<LanguageServiceKind, OsString>> =
            RefCell::new(HashMap::new());
    }

    pub(crate) struct Configured(LanguageServiceKind);

    impl Drop for Configured {
        fn drop(&mut self) {
            CONFIGURED.with(|configured| configured.borrow_mut().remove(&self.0));
        }
    }

    pub(crate) fn configure(kind: LanguageServiceKind, value: impl Into<OsString>) -> Configured {
        CONFIGURED.with(|configured| configured.borrow_mut().insert(kind, value.into()));
        Configured(kind)
    }

    pub(super) fn value(kind: LanguageServiceKind) -> Option<OsString> {
        CONFIGURED.with(|configured| configured.borrow().get(&kind).cloned())
    }

    #[cfg(windows)]
    const PRINT_ARGUMENTS: &str = "echo args:%*";
    #[cfg(not(windows))]
    const PRINT_ARGUMENTS: &str = "printf 'args:%s\\n' \"$*\"";

    pub(crate) struct FakeServer {
        _directory: tempfile::TempDir,
        pub(crate) path: PathBuf,
    }

    pub(crate) fn texlab(version: &str) -> FakeServer {
        fake_server(
            "texlab",
            &format!("echo \"texlab {version}\""),
            &format!("echo texlab {version}"),
            PRINT_ARGUMENTS,
        )
    }

    pub(crate) fn tinymist(version: &str, typst: &str) -> FakeServer {
        fake_server(
            "tinymist",
            &format!(
                "[ \"$1\" = -V ] && echo \"tinymist {version}\" && exit 0\n\
                 [ \"$1\" = --version ] && printf 'tinymist \\nBuild Git Describe:  None\\nTypst Version:       {typst}\\n' && exit 0"
            ),
            &format!(
                "if \"%~1\"==\"-V\" (echo tinymist {version}& exit /b 0)\r\n\
                 if \"%~1\"==\"--version\" (echo tinymist & echo Typst Version:       {typst}& exit /b 0)"
            ),
            PRINT_ARGUMENTS,
        )
    }

    pub(crate) fn fake_server(
        stem: &str,
        unix_version: &str,
        windows_version: &str,
        serve: &str,
    ) -> FakeServer {
        let directory = tempfile::tempdir().unwrap();
        let name = if cfg!(windows) {
            format!("{stem}.cmd")
        } else {
            stem.to_owned()
        };
        let path = directory.path().join(name);
        write_fake_server(&path, unix_version, windows_version, serve);
        FakeServer {
            _directory: directory,
            path,
        }
    }

    #[cfg(windows)]
    pub(crate) fn write_fake_server(
        path: &Path,
        _unix_version: &str,
        windows_version: &str,
        serve: &str,
    ) {
        let serve = if serve.is_empty() { "exit /b 0" } else { serve };
        std::fs::write(
            path,
            format!(
                "@echo off\r\nif \"%~1\"==\"--version\" goto version\r\nif \"%~1\"==\"-V\" goto version\r\n{serve}\r\nexit /b 0\r\n:version\r\n{windows_version}\r\nexit /b 0\r\n"
            ),
        )
        .unwrap();
    }

    #[cfg(not(windows))]
    pub(crate) fn write_fake_server(
        path: &Path,
        unix_version: &str,
        _windows_version: &str,
        serve: &str,
    ) {
        crate::test_wait::write_executable(
            path,
            &format!(
                "#!/bin/sh\n[ \"$1\" = --warm-up ] && exit 0\ncase \"$1\" in\n  --version|-V)\n{unix_version}\n    exit 0 ;;\nesac\n{serve}\n"
            ),
        );
        let warmed = std::process::Command::new(path)
            .arg("--warm-up")
            .status()
            .unwrap();
        assert!(warmed.success());
    }
}

#[cfg(test)]
mod tests;
