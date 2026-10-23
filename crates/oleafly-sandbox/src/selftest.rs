//! Live checks of the sandbox on a real machine, and a sandboxed run from the
//! command line. Both run inside the app or CLI binary:
//!
//! - `--oleafly-sandbox-selftest [--network] [--python <path>] [--json]`
//! - `--oleafly-sandbox-run --profile analysis|training [--network] --workspace <dir> -- <program> [args...]`
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;

use crate::profile::{detect_runtimes, spec_for_run, DetectInputs, RunInputs, RunProfile};
use crate::{availability, config, release, shell_command, Availability, SandboxSpec};

pub const LAUNCH_FLAG: &str = "--oleafly-sandbox-launch";
pub const SELFTEST_FLAG: &str = "--oleafly-sandbox-selftest";
pub const RUN_FLAG: &str = "--oleafly-sandbox-run";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SelfTestOptions {
    pub network: bool,
    pub python: Option<PathBuf>,
    pub json: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfTestReport {
    pub platform: String,
    pub available: bool,
    pub reason: Option<String>,
    pub checks: Vec<SelfTestCheck>,
    /// `whoami /priv` from inside the sandbox (Windows).
    pub privileges: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfTestCheck {
    pub id: String,
    pub ok: bool,
    pub expected: String,
    pub detail: String,
}

/// A sandboxed run from the command line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunRequest {
    pub profile: RunProfile,
    pub network: bool,
    pub workspace: PathBuf,
    pub program: OsString,
    pub args: Vec<OsString>,
}

const USAGE: &str = "usage: --oleafly-sandbox-run --profile analysis|training [--network] --workspace <dir> -- <program> [args...]";

/// Parses the arguments after [`RUN_FLAG`].
pub fn parse_run(argv: &[OsString]) -> Result<RunRequest, String> {
    let separator = argv
        .iter()
        .position(|arg| arg == "--")
        .ok_or_else(|| USAGE.to_string())?;
    let (options, rest) = argv.split_at(separator);
    let rest = &rest[1..];
    let (program, args) = rest.split_first().ok_or_else(|| USAGE.to_string())?;
    let mut profile = RunProfile::Analysis;
    let mut network = false;
    let mut workspace = None;
    let mut index = 0;
    while index < options.len() {
        match options[index].to_str().unwrap_or_default() {
            "--profile" => {
                profile = match options.get(index + 1).and_then(|value| value.to_str()) {
                    Some("analysis") => RunProfile::Analysis,
                    Some("training") => RunProfile::Training,
                    _ => return Err(USAGE.into()),
                };
                index += 2;
            }
            "--network" => {
                network = true;
                index += 1;
            }
            "--workspace" => {
                workspace = Some(PathBuf::from(
                    options.get(index + 1).ok_or_else(|| USAGE.to_string())?,
                ));
                index += 2;
            }
            _ => return Err(USAGE.into()),
        }
    }
    Ok(RunRequest {
        profile,
        network,
        workspace: workspace.ok_or_else(|| USAGE.to_string())?,
        program: program.clone(),
        args: args.to_vec(),
    })
}

fn parse_selftest(argv: &[OsString]) -> Result<SelfTestOptions, String> {
    let mut options = SelfTestOptions::default();
    let mut index = 0;
    while index < argv.len() {
        match argv[index].to_str().unwrap_or_default() {
            "--network" => options.network = true,
            "--json" => options.json = true,
            "--python" => {
                options.python = Some(PathBuf::from(argv.get(index + 1).ok_or(
                    "usage: --oleafly-sandbox-selftest [--network] [--python <path>] [--json]",
                )?));
                index += 1;
            }
            other => return Err(format!("unknown argument {other}")),
        }
        index += 1;
    }
    Ok(options)
}

/// Dispatches the self-test and run entries.
pub fn main(flag: &str, argv: &[OsString]) -> i32 {
    match flag {
        SELFTEST_FLAG => match parse_selftest(argv) {
            Ok(options) => {
                let report = run_selftest(&options);
                if options.json {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&report).unwrap_or_default()
                    );
                } else {
                    for check in &report.checks {
                        println!(
                            "{} {:<24} {}",
                            if check.ok { "ok  " } else { "FAIL" },
                            check.id,
                            check.detail
                        );
                    }
                }
                if report.available && report.checks.iter().all(|check| check.ok) {
                    0
                } else {
                    1
                }
            }
            Err(error) => {
                eprintln!("{error}");
                2
            }
        },
        RUN_FLAG => match parse_run(argv) {
            Ok(request) => run_sandboxed(&request),
            Err(error) => {
                eprintln!("{error}");
                2
            }
        },
        _ => 2,
    }
}

fn state_dir() -> PathBuf {
    config()
        .map(|config| config.state_dir.clone())
        .unwrap_or_else(|| std::env::temp_dir().join("oleafly-sandbox"))
}

fn owner() -> String {
    format!("selftest:{}", std::process::id())
}

fn path_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default()
}

/// Runs `program args` in the sandbox with the given profile and returns
/// its exit code.
pub fn run_sandboxed(request: &RunRequest) -> i32 {
    let home = state_dir()
        .join("selftest-homes")
        .join(std::process::id().to_string());
    if let Err(error) = crate::profile::prepare_home(&home) {
        eprintln!("oleafly-sandbox: the home folder could not be created: {error}");
        return 125;
    }
    let search = path_dirs();
    let user_home = crate::home_dir();
    let env = |name: &str| std::env::var_os(name);
    let runtimes = detect_runtimes(&DetectInputs {
        search_dirs: &search,
        project_root: Some(&request.workspace),
        home: user_home.as_deref(),
        env: &env,
    });
    let host_env = |name: &str| std::env::var(name).ok();
    let owner = owner();
    let writable = [request.workspace.clone()];
    // A run starts helper programs (`uv`, `pixi`, `cargo`), which macOS only
    // allows with `child_processes`.
    let spec = spec_for_run(&RunInputs {
        profile: request.profile,
        owner: &owner,
        project: None,
        workspace: &request.workspace,
        writable: &writable,
        protected: &[],
        home: &home,
        network: request.network,
        linked: &[],
        extra_read: &[],
        runtimes: &runtimes,
        host_env: &host_env,
    })
    .map(|mut spec| {
        spec.child_processes = true;
        spec
    });
    let program =
        which(&request.program, &search).unwrap_or_else(|| PathBuf::from(&request.program));
    let code = match spec.and_then(|spec| crate::command(&spec, &program, &request.args)) {
        Ok(mut command) => match command.status() {
            Ok(status) => status.code().unwrap_or(1),
            Err(error) => {
                eprintln!("oleafly-sandbox: the program could not start: {error}");
                125
            }
        },
        Err(error) => {
            eprintln!("oleafly-sandbox: {error}");
            125
        }
    };
    let _ = release(&owner);
    // The run's caches (pip, Hugging Face) are not worth keeping: every run
    // gets a new home named after its process.
    let _ = std::fs::remove_dir_all(&home);
    code
}

fn which(program: &OsString, search: &[PathBuf]) -> Option<PathBuf> {
    let program = Path::new(program);
    if program.is_absolute() {
        return Some(program.to_path_buf());
    }
    let names: Vec<OsString> = if cfg!(windows) && program.extension().is_none() {
        vec![
            program.with_extension("exe").into_os_string(),
            program.as_os_str().to_os_string(),
        ]
    } else {
        vec![program.as_os_str().to_os_string()]
    };
    search
        .iter()
        .flat_map(|folder| names.iter().map(move |name| folder.join(name)))
        .find(|candidate| candidate.is_file())
}

struct Fixture {
    root: PathBuf,
    workspace: PathBuf,
    writable: PathBuf,
    home: PathBuf,
    readable: PathBuf,
    secret: PathBuf,
}

impl Fixture {
    fn new() -> std::io::Result<Self> {
        let root = state_dir().join(format!("selftest-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let workspace = root.join("Prüfung workspace");
        let writable = workspace.join("out");
        let home = root.join("home");
        let readable = root.join("granted");
        let secret = crate::home_dir()
            .map(|home| home.join(format!(".oleafly-selftest-{}", std::process::id())))
            .unwrap_or_else(|| root.join("secret"));
        for folder in [&writable, &readable, &secret] {
            std::fs::create_dir_all(folder)?;
        }
        crate::profile::prepare_home(&home)?;
        std::fs::write(readable.join("granted.txt"), "granted")?;
        std::fs::write(secret.join("secret.txt"), "secret")?;
        Ok(Self {
            root,
            workspace,
            writable,
            home,
            readable,
            secret,
        })
    }

    fn spec(&self, network: bool) -> SandboxSpec {
        let mut spec = SandboxSpec::new(owner(), self.workspace.clone(), self.home.clone());
        spec.read_write = vec![self.writable.clone()];
        spec.read_only = vec![self.readable.clone()];
        spec.network = network;
        spec
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
        let _ = std::fs::remove_dir_all(&self.secret);
    }
}

fn run_shell(spec: &SandboxSpec, text: &str) -> Result<(i32, String), String> {
    let mut command = shell_command(spec, text).map_err(String::from)?;
    let output = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| error.to_string())?;
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    Ok((output.status.code().unwrap_or(-1), text.trim().to_owned()))
}

fn check(id: &str, expected: &str, result: Result<bool, String>, detail: String) -> SelfTestCheck {
    match result {
        Ok(ok) => SelfTestCheck {
            id: id.into(),
            ok,
            expected: expected.into(),
            detail,
        },
        Err(error) => SelfTestCheck {
            id: id.into(),
            ok: false,
            expected: expected.into(),
            detail: error,
        },
    }
}

/// Runs the live checks and reports each one.
pub fn run_selftest(options: &SelfTestOptions) -> SelfTestReport {
    let platform = std::env::consts::OS.to_string();
    let (available, reason) = match availability() {
        Availability::Available => (true, None),
        Availability::Unavailable(reason) => (false, Some(reason)),
    };
    let mut report = SelfTestReport {
        platform,
        available,
        reason,
        checks: Vec::new(),
        privileges: None,
    };
    if !available {
        return report;
    }
    let fixture = match Fixture::new() {
        Ok(fixture) => fixture,
        Err(error) => {
            report.checks.push(check(
                "profile_create",
                "folders can be prepared",
                Err(error.to_string()),
                String::new(),
            ));
            return report;
        }
    };
    let spec = fixture.spec(false);
    let windows = cfg!(windows);
    let quoted = |path: &Path| format!("\"{}\"", path.display());

    let launched = run_shell(&spec, "echo ok");
    report.checks.push(check(
        "launch",
        "echo prints ok",
        launched
            .as_ref()
            .map(|(code, text)| *code == 0 && text.contains("ok"))
            .map_err(Clone::clone),
        launched
            .as_ref()
            .map(|(_, text)| text.clone())
            .unwrap_or_default(),
    ));
    let exit = run_shell(&spec, if windows { "exit /b 7" } else { "exit 7" });
    report.checks.push(check(
        "exit_code",
        "exit code 7 is relayed",
        exit.as_ref()
            .map(|(code, _)| *code == 7)
            .map_err(Clone::clone),
        exit.map(|(code, _)| code.to_string()).unwrap_or_default(),
    ));
    let target = fixture.writable.join("made.txt");
    let write = run_shell(&spec, &format!("echo x> {}", quoted(&target)));
    report.checks.push(check(
        "write_workspace",
        "a granted folder is writable",
        write.map(|(code, _)| code == 0 && target.exists()),
        target.display().to_string(),
    ));
    let outside = fixture.secret.join("written.txt");
    let denied = run_shell(&spec, &format!("echo x> {}", quoted(&outside)));
    report.checks.push(check(
        "deny_outside_write",
        "an ungranted folder is not writable",
        denied.map(|_| !outside.exists()),
        outside.display().to_string(),
    ));
    let secret = fixture.secret.join("secret.txt");
    let read_secret = run_shell(
        &spec,
        &format!(
            "{} {}",
            if windows { "type" } else { "cat" },
            quoted(&secret)
        ),
    );
    report.checks.push(check(
        "deny_profile_read",
        "files outside the grants are not readable",
        read_secret.map(|(code, text)| code != 0 && !text.contains("secret")),
        secret.display().to_string(),
    ));
    let granted = fixture.readable.join("granted.txt");
    let read_granted = run_shell(
        &spec,
        &format!(
            "{} {}",
            if windows { "type" } else { "cat" },
            quoted(&granted)
        ),
    );
    report.checks.push(check(
        "read_granted",
        "a read grant is readable",
        read_granted.map(|(code, text)| code == 0 && text.contains("granted")),
        granted.display().to_string(),
    ));
    let curl = if windows { "curl.exe" } else { "curl" };
    let offline = run_shell(&spec, &format!("{curl} -s -m 5 https://example.com"));
    report.checks.push(check(
        "network_off",
        "no network without the permission",
        offline.map(|(code, _)| code != 0),
        String::new(),
    ));
    if options.network {
        let online = run_shell(
            &fixture.spec(true),
            &format!(
                "{curl} -s -m 10 -o {} https://example.com",
                if windows { "NUL" } else { "/dev/null" }
            ),
        );
        report.checks.push(check(
            "network_on",
            "network with the permission",
            online.map(|(code, _)| code == 0),
            String::new(),
        ));
    }
    if let Some(python) = &options.python {
        let script = "import tempfile, os; d = tempfile.mkdtemp(); open(os.path.join(d, 'x'), 'w').write('ok'); print('ok')";
        let temp = run_shell(&spec, &format!("{} -c \"{script}\"", quoted(python)));
        report.checks.push(check(
            "python_tempfile",
            "Python temporary folders work",
            temp.as_ref()
                .map(|(code, text)| *code == 0 && text.contains("ok"))
                .map_err(Clone::clone),
            temp.map(|(_, text)| text).unwrap_or_default(),
        ));
    }
    if windows {
        report.privileges = run_shell(&spec, "whoami /priv").ok().map(|(_, text)| text);
    }
    let cleaned = release(&owner());
    report.checks.push(check(
        "cleanup",
        "the profile is removed",
        cleaned.map(|()| true).map_err(String::from),
        String::new(),
    ));
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(text: &str) -> Vec<OsString> {
        text.split(' ').map(OsString::from).collect()
    }

    #[test]
    fn parses_run_arguments() {
        let request = parse_run(&args(
            "--profile training --network --workspace C:/w -- python -c x",
        ))
        .unwrap();
        assert_eq!(request.profile, RunProfile::Training);
        assert!(request.network);
        assert_eq!(request.program, OsString::from("python"));
        assert_eq!(request.args.len(), 2);
    }

    #[test]
    fn rejects_run_without_separator() {
        assert!(parse_run(&args("--profile analysis --workspace /w python")).is_err());
        assert_eq!(main(RUN_FLAG, &args("--profile analysis")), 2);
    }

    #[cfg(unix)]
    #[test]
    fn unix_selftest_reports_echo_and_write_denial() {
        if availability() != Availability::Available {
            return;
        }
        let report = run_selftest(&SelfTestOptions::default());
        let ok = |id: &str| {
            report
                .checks
                .iter()
                .find(|check| check.id == id)
                .is_some_and(|check| check.ok)
        };
        assert!(ok("launch"), "{:?}", report.checks);
        assert!(ok("deny_outside_write"), "{:?}", report.checks);
    }
}
