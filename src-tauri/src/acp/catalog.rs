use super::{
    new_id, AgentDefinition, AgentStatus, CliStatus, CommandDistribution, Distribution,
    PackageDistribution, RejectedCandidate,
};
use crate::program_locator::{self as locator, Located, ProgramKind, Rejected};
use futures_util::StreamExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    io::Read,
    path::{Component, Path, PathBuf},
    process::Stdio,
    time::Duration,
};

const REGISTRY: &str = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const DOWNLOAD_LIMIT: usize = 100 * 1024 * 1024;
const EXPANDED_LIMIT: u64 = 512 * 1024 * 1024;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub definition: Option<AgentDefinition>,
    pub reason: Option<String>,
    /// The built-in agent this registry entry corresponds to, when known.
    #[serde(default)]
    pub builtin_id: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
struct InstallReceipt {
    version: String,
    executable: PathBuf,
    node: bool,
}

#[derive(Clone, Debug, Default)]
pub struct Launch {
    /// Plain path of the program to start.
    pub executable: PathBuf,
    /// Plain paths only: a Node.js bridge's script comes first.
    pub args: Vec<String>,
    pub version: Option<String>,
    pub managed: bool,
    /// The program is a Windows `.cmd`/`.bat` file started through cmd.exe.
    pub batch: bool,
    /// The JavaScript entry point when Node.js runs the agent.
    pub entry: Option<PathBuf>,
    /// cmd.exe runs somewhere in the agent's process tree (the agent itself,
    /// or the CLI its bridge starts), so its working folder must not be a
    /// network path.
    pub needs_local_folder: bool,
    /// Environment for a non-sandboxed launch: the search path, Windows
    /// hardening and the hand-off of the CLI Oleafly found to the bridge.
    pub env: Vec<(String, OsString)>,
}

impl Launch {
    /// The same launch with symlinks resolved, for sandbox read rules
    /// (macOS and Linux tasks only).
    pub fn resolved_for_sandbox(&self) -> Launch {
        let resolve = |path: &Path| path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        let mut launch = self.clone();
        launch.executable = resolve(&self.executable);
        if let Some(entry) = &self.entry {
            let resolved = resolve(entry);
            if launch.args.first().map(PathBuf::from).as_ref() == Some(entry) {
                launch.args[0] = resolved.to_string_lossy().into_owned();
            }
            launch.entry = Some(resolved);
        }
        launch
    }
}

struct Builtin {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    version: &'static str,
    dist: BuiltinDist,
}

enum BuiltinDist {
    Native {
        cmd: &'static str,
        args: &'static [&'static str],
    },
    Bridge {
        package: &'static str,
        cmd: &'static str,
        args: &'static [&'static str],
        node: u32,
    },
}

const BUILTINS: &[Builtin] = &[
    Builtin {
        id: "claude",
        name: "Claude Code",
        description: "Uses the agent's own CLI account and permissions.",
        version: "0.74.0",
        dist: BuiltinDist::Bridge {
            package: "@agentclientprotocol/claude-agent-acp@0.74.0",
            cmd: "claude-agent-acp",
            args: &[],
            node: 22,
        },
    },
    Builtin {
        id: "codex",
        name: "Codex CLI",
        description: "Uses the agent's own CLI account and permissions.",
        version: "1.10.0",
        dist: BuiltinDist::Bridge {
            package: "@agentclientprotocol/codex-acp@1.10.0",
            cmd: "codex-acp",
            args: &[],
            node: 20,
        },
    },
    Builtin {
        id: "gemini",
        name: "Gemini CLI",
        description: "Uses the agent's own CLI account and permissions.",
        version: "0.57.0",
        dist: BuiltinDist::Bridge {
            package: "@google/gemini-cli@0.57.0",
            cmd: "gemini",
            args: &["--experimental-acp"],
            node: 20,
        },
    },
    Builtin {
        id: "pi",
        name: "Pi",
        description: "Uses the agent's own CLI account and permissions.",
        version: "0.0.34",
        dist: BuiltinDist::Bridge {
            package: "pi-acp@0.0.34",
            cmd: "pi-acp",
            args: &[],
            node: 22,
        },
    },
    Builtin {
        id: "opencode",
        name: "OpenCode",
        description: "Serves ACP from the installed CLI.",
        version: "1.18.29",
        dist: BuiltinDist::Native {
            cmd: "opencode",
            args: &["acp"],
        },
    },
    Builtin {
        id: "openclaw",
        name: "OpenClaw",
        description: "Serves ACP from the installed CLI.",
        version: "2026.9.2",
        dist: BuiltinDist::Native {
            cmd: "openclaw",
            args: &["acp"],
        },
    },
    Builtin {
        id: "cline",
        name: "Cline",
        description: "Serves ACP from the installed CLI.",
        version: "3.0.61",
        dist: BuiltinDist::Native {
            cmd: "cline",
            args: &["--acp"],
        },
    },
    Builtin {
        id: "hermes",
        name: "Hermes Agent",
        description: "Serves ACP from the installed CLI.",
        version: "0.21.0",
        dist: BuiltinDist::Native {
            cmd: "hermes",
            args: &["acp"],
        },
    },
    Builtin {
        id: "codebuddy",
        name: "CodeBuddy",
        description: "Serves ACP from the installed CLI.",
        version: "2.146.0",
        dist: BuiltinDist::Native {
            cmd: "codebuddy",
            args: &["--acp"],
        },
    },
    Builtin {
        id: "kimi",
        name: "Kimi Code",
        description: "Serves ACP from the installed CLI.",
        version: "0.41.0",
        dist: BuiltinDist::Native {
            cmd: "kimi",
            args: &["acp"],
        },
    },
    Builtin {
        id: "grok",
        name: "Grok Build",
        description: "Serves ACP from the installed CLI.",
        version: "1.0.13",
        dist: BuiltinDist::Native {
            cmd: "grok",
            args: &["agent", "stdio"],
        },
    },
    Builtin {
        id: "cursor",
        name: "Cursor",
        description: "Serves ACP from the installed CLI.",
        version: "2026.09.02",
        dist: BuiltinDist::Native {
            cmd: "agent",
            args: &["acp"],
        },
    },
    Builtin {
        id: "deepseek",
        name: "DeepSeek Harness",
        description: "Serves ACP from the installed CLI.",
        version: "0.1.2-rc.1",
        dist: BuiltinDist::Native {
            cmd: "dsh",
            args: &["--profile", "acp"],
        },
    },
    Builtin {
        id: "qoder",
        name: "Qoder",
        description: "Serves ACP from the installed CLI.",
        version: "1.1.45",
        dist: BuiltinDist::Native {
            cmd: "qodercli",
            args: &["--acp"],
        },
    },
];

pub fn builtins() -> Vec<AgentDefinition> {
    BUILTINS
        .iter()
        .map(|entry| AgentDefinition {
            id: entry.id.into(),
            name: entry.name.into(),
            version: entry.version.into(),
            description: entry.description.into(),
            builtin: true,
            distribution: match &entry.dist {
                BuiltinDist::Native { cmd, args } => Distribution {
                    command: Some(CommandDistribution {
                        executable: (*cmd).into(),
                        args: args.iter().map(|value| (*value).to_string()).collect(),
                    }),
                    ..Distribution::default()
                },
                BuiltinDist::Bridge {
                    package,
                    cmd,
                    args,
                    node,
                } => Distribution {
                    npx: Some(PackageDistribution {
                        package: (*package).into(),
                        cmd: Some((*cmd).into()),
                        args: args.iter().map(|value| (*value).to_string()).collect(),
                        node_major: Some(*node),
                        env: BTreeMap::new(),
                    }),
                    ..Distribution::default()
                },
            },
        })
        .collect()
}

pub fn platform() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    format!("{}-{}", os, std::env::consts::ARCH)
}

fn exact_version(value: &str) -> bool {
    exact_npm_version(value) || exact_python_version(value)
}

fn exact_npm_version(value: &str) -> bool {
    if value.is_empty() || value.len() > 80 || !value.is_ascii() {
        return false;
    }
    let (release, build) = value
        .split_once('+')
        .map_or((value, None), |(a, b)| (a, Some(b)));
    let (release, pre) = release
        .split_once('-')
        .map_or((release, None), |(a, b)| (a, Some(b)));
    let numeric = |part: &str| {
        !part.is_empty()
            && part.bytes().all(|byte| byte.is_ascii_digit())
            && (part == "0" || !part.starts_with('0'))
    };
    let identifiers = |value: &str, prerelease: bool| {
        value.split('.').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                && (!prerelease || !part.bytes().all(|byte| byte.is_ascii_digit()) || numeric(part))
        })
    };
    release.split('.').count() == 3
        && release.split('.').all(numeric)
        && pre.is_none_or(|part| identifiers(part, true))
        && build.is_none_or(|part| identifiers(part, false))
}

fn exact_python_version(value: &str) -> bool {
    if value.is_empty() || value.len() > 80 || !value.is_ascii() {
        return false;
    }
    let normalized = value.to_ascii_lowercase();
    let (public, local) = normalized
        .split_once('+')
        .map_or((normalized.as_str(), None), |(a, b)| (a, Some(b)));
    if local.is_some_and(|part| {
        !part
            .split(['.', '-', '_'])
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_alphanumeric()))
    }) {
        return false;
    }
    let public = public.strip_prefix('v').unwrap_or(public);
    let release = if let Some((epoch, release)) = public.split_once('!') {
        if epoch.is_empty() || !epoch.bytes().all(|byte| byte.is_ascii_digit()) {
            return false;
        }
        release
    } else {
        public
    };
    if !release.starts_with(|ch: char| ch.is_ascii_digit()) {
        return false;
    }
    let mut rest = release.trim_start_matches(|ch: char| ch.is_ascii_digit());
    while rest
        .strip_prefix('.')
        .is_some_and(|part| part.starts_with(|ch: char| ch.is_ascii_digit()))
    {
        rest = rest[1..].trim_start_matches(|ch: char| ch.is_ascii_digit());
    }
    rest = python_version_suffix(
        rest,
        &["preview", "alpha", "beta", "pre", "rc", "a", "b", "c"],
    );
    rest = if let Some(post) = rest
        .strip_prefix('-')
        .filter(|part| part.starts_with(|ch: char| ch.is_ascii_digit()))
    {
        post.trim_start_matches(|ch: char| ch.is_ascii_digit())
    } else {
        python_version_suffix(rest, &["post", "rev", "r"])
    };
    python_version_suffix(rest, &["dev"]).is_empty()
}

fn python_version_suffix<'a>(value: &'a str, labels: &[&str]) -> &'a str {
    let candidate = value.strip_prefix(['.', '-', '_']).unwrap_or(value);
    labels
        .iter()
        .find_map(|label| candidate.strip_prefix(label))
        .map_or(value, |rest| {
            rest.strip_prefix(['.', '-', '_'])
                .unwrap_or(rest)
                .trim_start_matches(|ch: char| ch.is_ascii_digit())
        })
}

pub fn package_parts(spec: &str, npm: bool) -> Result<(&str, &str), String> {
    let (name, version) = if npm {
        spec.rsplit_once('@')
    } else {
        spec.split_once("==")
    }
    .ok_or("Use a package with an exact version.")?;
    let valid = !name.is_empty()
        && name.len() <= 160
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"@/._-".contains(&b));
    let scoped =
        name.starts_with('@') && name.matches('/').count() == 1 && !name[1..].contains('@');
    let unscoped = !name.contains('/') && !name.contains('@');
    let pinned = if npm {
        exact_npm_version(version)
    } else {
        exact_python_version(version)
    };
    if !valid || (!scoped && !unscoped) || name.contains("..") || !pinned {
        return Err(
            "Use a package name with an exact version, without a URL or version range.".into(),
        );
    }
    Ok((name, version))
}

#[cfg(test)]
#[path = "tests/catalog.rs"]
mod catalog_tests;

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn validate_args(args: &[String]) -> Result<(), String> {
    if args.len() > 64
        || args
            .iter()
            .any(|v| v.len() > 4096 || v.contains('\0') || v.contains('\n') || v.contains('\r'))
    {
        return Err("The agent arguments are too long or contain control characters.".into());
    }
    if args.iter().any(|v| {
        let value = v.to_ascii_lowercase();
        [
            "--yolo",
            "--skip-trust",
            "--dangerously-skip-permissions",
            "--dangerously-bypass-approvals-and-sandbox",
            "--api-key",
            "--password",
            "--access-token",
            "--token",
        ]
        .iter()
        .any(|flag| value == *flag || value.starts_with(&format!("{flag}=")))
    }) {
        return Err("Keep credentials and permission-bypass flags out of agent definitions. Sign in through the CLI.".into());
    }
    Ok(())
}

pub fn safe_relative(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && !path.is_absolute()
        && path
            .components()
            .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
        && !path.to_string_lossy().contains('\\')
        && !path.to_string_lossy().contains(':')
}

pub fn validate(definition: &AgentDefinition) -> Result<(), String> {
    if !valid_id(&definition.id)
        || definition.name.trim().is_empty()
        || definition.name.len() > 120
        || definition.description.len() > 4000
        || !exact_version(&definition.version)
    {
        return Err("Give the agent a lowercase ID, a name and an exact version.".into());
    }
    let dist = &definition.distribution;
    if dist.npx.is_none() && dist.uvx.is_none() && dist.binary.is_empty() && dist.command.is_none()
    {
        return Err("Add an npm, uv, binary or installed-command distribution.".into());
    }
    validate_packages(dist)?;
    validate_binaries(dist)?;
    validate_installed_command(dist)
}

fn validate_packages(dist: &Distribution) -> Result<(), String> {
    for (package, npm) in [(dist.npx.as_ref(), true), (dist.uvx.as_ref(), false)] {
        let Some(package) = package else {
            continue;
        };
        package_parts(&package.package, npm)?;
        validate_args(&package.args)?;
        if !package.env.is_empty() {
            return Err("Environment values cannot be stored in agent definitions. Configure authentication in the CLI.".into());
        }
        if package
            .cmd
            .as_ref()
            .is_some_and(|cmd| !valid_command_name(cmd))
        {
            return Err("The package command must be a simple executable name.".into());
        }
    }
    Ok(())
}

fn validate_binaries(dist: &Distribution) -> Result<(), String> {
    if dist.binary.len() > 12 {
        return Err("An agent definition has too many platforms.".into());
    }
    for binary in dist.binary.values() {
        validate_args(&binary.args)?;
        if !safe_relative(Path::new(&binary.cmd)) || !binary.env.is_empty() {
            return Err("Binary commands must stay inside their archive and cannot store environment values.".into());
        }
        let url = reqwest::Url::parse(&binary.archive).map_err(|_| "The binary URL is invalid.")?;
        if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
            return Err("Binary downloads require an HTTPS URL without credentials.".into());
        }
        let invalid_hash = binary
            .sha256
            .as_ref()
            .is_some_and(|hash| hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()));
        if invalid_hash {
            return Err("The binary SHA-256 must contain 64 hexadecimal characters.".into());
        }
    }
    Ok(())
}

/// Windows files an agent definition may not name: scripts that need an
/// interpreter Oleafly would have to guess. `.cmd` and `.bat` are allowed.
fn windows_command_script(executable: &str) -> bool {
    cfg!(windows)
        && Path::new(executable)
            .extension()
            .and_then(std::ffi::OsStr::to_str)
            .is_some_and(|extension| {
                matches!(extension.to_ascii_lowercase().as_str(), "ps1" | "js" | "py")
            })
}

const PACKAGE_LAUNCHERS: &[&str] = &["npx", "npm", "pnpm", "yarn", "uvx", "uv", "bunx"];

fn validate_installed_command(dist: &Distribution) -> Result<(), String> {
    let Some(command) = &dist.command else {
        return Ok(());
    };
    validate_args(&command.args)?;
    if command.executable.is_empty()
        || command.executable.len() > 4096
        || command.executable.contains(['\0', '\n', '\r'])
    {
        return Err("The executable path is invalid.".into());
    }
    if !Path::new(&command.executable).is_absolute() && !valid_command_name(&command.executable) {
        return Err("Use an absolute program path or a program name.".into());
    }
    if windows_command_script(&command.executable) {
        return Err(
            "Use a program (.exe, .cmd or .bat) or a pinned package instead of a script.".into(),
        );
    }
    let stem = Path::new(&command.executable)
        .file_stem()
        .and_then(std::ffi::OsStr::to_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if PACKAGE_LAUNCHERS.contains(&stem.as_str()) {
        return Err("Use a pinned package distribution instead of a package launcher.".into());
    }
    Ok(())
}

fn valid_command_name(value: &str) -> bool {
    locator::valid_program_name(value)
}

/// Test helper: finds a program the way agent launches do.
#[cfg(test)]
pub(crate) fn discover(name: &str) -> Option<PathBuf> {
    if Path::new(name).is_absolute() {
        return locator::locate_path(Path::new(name))
            .ok()
            .map(|located| located.path);
    }
    locator::locate_native(name).map(|located| located.path)
}

fn receipt_dir(root: &Path, definition: &AgentDefinition) -> PathBuf {
    root.join("agents")
        .join(&definition.id)
        .join(&definition.version)
}

/// A verified install receipt. The executable is checked against the
/// canonical install folder and returned as a plain path.
fn read_receipt(root: &Path, definition: &AgentDefinition) -> Option<InstallReceipt> {
    let directory = receipt_dir(root, definition).canonicalize().ok()?;
    let receipt: InstallReceipt =
        serde_json::from_slice(&std::fs::read(directory.join("receipt.json")).ok()?).ok()?;
    let executable = receipt.executable.canonicalize().ok()?;
    if !executable.starts_with(&directory)
        || !executable.is_file()
        || receipt.version != definition.version
    {
        return None;
    }
    Some(InstallReceipt {
        executable: locator::child_path(&executable),
        ..receipt
    })
}

/// Whether the program a user chooses for this agent is its CLI (handed to
/// the bridge) or the program Oleafly starts itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProgramRole {
    Cli,
    Launch,
}

pub(crate) fn program_role(definition: &AgentDefinition) -> ProgramRole {
    if vendor_cli(definition).is_some_and(|vendor| vendor.cli_env.is_some()) {
        ProgramRole::Cli
    } else {
        ProgramRole::Launch
    }
}

/// The vendor CLI Oleafly found or the user chose.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CliProgram {
    pub located: Located,
    pub overridden: bool,
}

/// Everything Oleafly resolves about an agent before starting anything.
/// Built by blocking file system searches; call it off the async runtime.
pub(crate) struct Plan {
    pub launch: Result<Launch, String>,
    pub cli: Option<CliProgram>,
    pub cli_rejected: Vec<Rejected>,
    pub node: Option<PathBuf>,
}

const CHOSEN_PROGRAM_MISSING: &str =
    "The program chosen for this agent is missing. Choose it again in Settings.";

pub(crate) fn plan(root: &Path, definition: &AgentDefinition, program: Option<&Path>) -> Plan {
    let vendor = vendor_cli(definition);
    let role = program_role(definition);
    let node = locator::locate_native("node").map(|located| located.path);
    let launch_program = program.filter(|_| role == ProgramRole::Launch);
    let cli_program = program.filter(|_| role == ProgramRole::Cli);
    let (cli, cli_rejected) = match &vendor {
        Some(vendor) => resolve_cli(vendor, cli_program, launch_program),
        None => (None, Vec::new()),
    };
    let launch =
        resolve_launch(root, definition, launch_program, node.as_deref()).map(|mut launch| {
            // A bridge handed a `.cmd` CLI starts it through cmd.exe.
            let script_handoff = vendor
                .as_ref()
                .and_then(|vendor| cli_handoff(vendor, cli.as_ref()))
                .is_some_and(|(_, value)| {
                    Path::new(&value).extension().is_some_and(|extension| {
                        extension.eq_ignore_ascii_case("cmd")
                            || extension.eq_ignore_ascii_case("bat")
                    })
                });
            launch.needs_local_folder = launch.batch || script_handoff;
            launch.env = launch_env(vendor.as_ref(), node.as_deref(), cli.as_ref(), &launch);
            launch
        });
    Plan {
        launch,
        cli,
        cli_rejected,
        node,
    }
}

fn resolve_cli(
    vendor: &VendorCli,
    cli_program: Option<&Path>,
    launch_program: Option<&Path>,
) -> (Option<CliProgram>, Vec<Rejected>) {
    // A chosen CLI, or a chosen program that is the agent's own CLI.
    let chosen = cli_program.or(launch_program.filter(|_| vendor.shares_bridge));
    if let Some(program) = chosen {
        return match locator::locate_path(program) {
            Ok(located) => (
                Some(CliProgram {
                    located,
                    overridden: true,
                }),
                Vec::new(),
            ),
            Err(reason) => (
                None,
                vec![Rejected {
                    path: program.to_path_buf(),
                    reason,
                }],
            ),
        };
    }
    let (found, rejected) = locator::locate(vendor.command);
    (
        found.map(|located| CliProgram {
            located,
            overridden: false,
        }),
        rejected,
    )
}

fn definition_args(definition: &AgentDefinition) -> Vec<String> {
    definition
        .distribution
        .command
        .as_ref()
        .map(|v| &v.args)
        .or_else(|| definition.distribution.npx.as_ref().map(|v| &v.args))
        .or_else(|| definition.distribution.uvx.as_ref().map(|v| &v.args))
        .or_else(|| {
            definition
                .distribution
                .binary
                .get(&platform())
                .map(|v| &v.args)
        })
        .cloned()
        .unwrap_or_default()
}

fn definition_program_name(definition: &AgentDefinition) -> Option<String> {
    definition
        .distribution
        .command
        .as_ref()
        .map(|v| v.executable.clone())
        .or_else(|| {
            definition
                .distribution
                .npx
                .as_ref()
                .and_then(|v| v.cmd.clone())
        })
        .or_else(|| {
            definition
                .distribution
                .uvx
                .as_ref()
                .and_then(|v| v.cmd.clone())
        })
        .or_else(|| {
            definition
                .distribution
                .binary
                .get(&platform())
                .and_then(|v| {
                    Path::new(&v.cmd)
                        .file_name()
                        .map(|v| v.to_string_lossy().into_owned())
                })
        })
}

/// A launch for a program found on disk. A recognised Windows package
/// manager shim runs as `node <script>` (no cmd.exe); any other `.cmd` or
/// `.bat` runs through cmd.exe, which Rust quotes safely.
fn launch_program(located: Located, args: Vec<String>, node: Option<&Path>) -> Launch {
    if located.kind == ProgramKind::Script {
        if let Some(target) = locator::npm_shim_target(&located.path) {
            if let Some(node) = target.node.clone().or_else(|| node.map(Path::to_path_buf)) {
                let mut argv = vec![target.script.to_string_lossy().into_owned()];
                argv.extend(args);
                return Launch {
                    executable: node,
                    args: argv,
                    entry: Some(target.script),
                    ..Launch::default()
                };
            }
        }
        return Launch {
            executable: located.path,
            args,
            batch: true,
            ..Launch::default()
        };
    }
    Launch {
        executable: located.path,
        args,
        ..Launch::default()
    }
}

/// The launch Oleafly would use with no program chosen. Blocking.
#[cfg(test)]
pub fn resolve(root: &Path, definition: &AgentDefinition) -> Result<Launch, String> {
    plan(root, definition, None).launch
}

fn resolve_launch(
    root: &Path,
    definition: &AgentDefinition,
    program: Option<&Path>,
    node: Option<&Path>,
) -> Result<Launch, String> {
    validate(definition)?;
    let args = definition_args(definition);
    if let Some(program) = program {
        let located =
            locator::locate_path(program).map_err(|_| CHOSEN_PROGRAM_MISSING.to_string())?;
        return Ok(launch_program(located, args, node));
    }
    if let Some(receipt) = read_receipt(root, definition) {
        if receipt.node {
            let mut argv = vec![receipt.executable.to_string_lossy().into_owned()];
            argv.extend(args);
            return Ok(Launch {
                executable: node
                    .map(Path::to_path_buf)
                    .ok_or("Install Node.js to run this agent.")?,
                args: argv,
                version: Some(receipt.version),
                managed: true,
                entry: Some(receipt.executable),
                ..Launch::default()
            });
        }
        return Ok(Launch {
            executable: receipt.executable,
            args,
            version: Some(receipt.version),
            managed: true,
            ..Launch::default()
        });
    }
    let found = definition_program_name(definition).and_then(|name| {
        if Path::new(&name).is_absolute() {
            locator::locate_path(Path::new(&name)).ok()
        } else {
            locator::locate(&name).0
        }
    });
    if let Some(located) = found {
        return Ok(launch_program(located, args, node));
    }
    if let Some(launch) = existing_npm_launch(definition, &args, node) {
        return Ok(launch);
    }
    Err("The agent is not installed. Install the pinned version, or choose its program in Settings.".into())
}

/// Environment for a non-sandboxed agent: Node.js first on the search path;
/// the vendor CLI's folder before the rest when the bridge must find it,
/// after it otherwise (so a CLI folder shipping its own tools cannot shadow
/// system ones); and the CLI hand-off variable the bridge reads.
pub(crate) fn launch_env(
    vendor: Option<&VendorCli>,
    node: Option<&Path>,
    cli: Option<&CliProgram>,
    launch: &Launch,
) -> Vec<(String, OsString)> {
    let (prepend, append) = search_path_folders(vendor, node, cli, launch);
    let mut env = locator::child_env(&prepend, &append);
    if let Some(handoff) = vendor.and_then(|vendor| cli_handoff(vendor, cli)) {
        env.push(handoff);
    }
    env
}

pub(crate) fn search_path_folders(
    vendor: Option<&VendorCli>,
    node: Option<&Path>,
    cli: Option<&CliProgram>,
    launch: &Launch,
) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let needs_cli = vendor.is_some_and(|vendor| vendor.bridge_needs_cli);
    let mut prepend = Vec::new();
    if launch.entry.is_some() {
        prepend.extend(launch.executable.parent().map(Path::to_path_buf));
    }
    prepend.extend(node.and_then(Path::parent).map(Path::to_path_buf));
    let cli_folder = cli.and_then(|cli| cli.located.path.parent().map(Path::to_path_buf));
    let mut append = Vec::new();
    if needs_cli {
        prepend.extend(cli_folder);
    } else {
        append.extend(cli_folder);
    }
    (prepend, append)
}

/// The variable that tells a bridge where the vendor CLI is: Pi always when
/// the CLI was found; Claude Code and Codex only when the user chose one
/// (otherwise their bridges use the CLI they bundle). Claude's SDK cannot
/// start a `.cmd`, so it gets a shim's script or nothing.
pub(crate) fn cli_handoff(
    vendor: &VendorCli,
    cli: Option<&CliProgram>,
) -> Option<(String, OsString)> {
    let variable = vendor.cli_env?;
    let cli = cli?;
    if vendor.cli_env_needs_override && !cli.overridden {
        return None;
    }
    let path = match cli.located.kind {
        ProgramKind::Native => cli.located.path.clone(),
        ProgramKind::Script if vendor.cli_env_accepts_script => cli.located.path.clone(),
        ProgramKind::Script => locator::npm_shim_target(&cli.located.path)?.script,
    };
    Some((variable.into(), locator::child_path(&path).into_os_string()))
}

pub(super) fn npm_roots_from(
    directories: impl IntoIterator<Item = PathBuf>,
    node: Option<PathBuf>,
    home: Option<PathBuf>,
    appdata: Option<PathBuf>,
) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let add_bin = |candidates: &mut Vec<PathBuf>, directory: &Path| {
        candidates.push(directory.join("node_modules"));
        if let Some(prefix) = directory.parent() {
            candidates.push(prefix.join("lib").join("node_modules"));
        }
    };
    for directory in directories {
        add_bin(&mut candidates, &directory);
    }
    if let Some(directory) = node.as_deref().and_then(Path::parent) {
        add_bin(&mut candidates, directory);
    }
    if let Some(home) = home {
        candidates.push(home.join(".npm-global").join("lib").join("node_modules"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/lib/node_modules"));
    candidates.push(PathBuf::from("/usr/local/lib/node_modules"));
    if let Some(appdata) = appdata {
        candidates.push(appdata.join("npm").join("node_modules"));
    }
    let mut roots: Vec<PathBuf> = Vec::new();
    for candidate in candidates {
        if !roots.contains(&candidate) {
            roots.push(candidate);
        }
    }
    roots
}

fn npm_global_roots(node: Option<&Path>) -> Vec<PathBuf> {
    npm_roots_from(
        locator::search_dirs(),
        node.map(Path::to_path_buf),
        crate::paths::home_dir().ok(),
        std::env::var_os("APPDATA").map(PathBuf::from),
    )
}

fn existing_npm_launch(
    definition: &AgentDefinition,
    args: &[String],
    node: Option<&Path>,
) -> Option<Launch> {
    let package = definition.distribution.npx.as_ref()?;
    let (name, _) = package_parts(&package.package, true).ok()?;
    for root in npm_global_roots(node) {
        let package_root = root.join(name);
        let manifest_path = package_root.join("package.json");
        if manifest_path
            .metadata()
            .ok()
            .is_none_or(|meta| meta.len() > 512 * 1024)
        {
            continue;
        }
        let Some(manifest) = std::fs::read(&manifest_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        else {
            continue;
        };
        let bin = manifest["bin"]
            .as_str()
            .or_else(|| {
                package
                    .cmd
                    .as_ref()
                    .and_then(|cmd| manifest["bin"][cmd].as_str())
            })
            .or_else(|| {
                manifest["bin"]
                    .as_object()
                    .filter(|map| map.len() == 1)
                    .and_then(|map| map.values().next())
                    .and_then(Value::as_str)
            });
        let Some(bin) = bin.filter(|bin| safe_relative(Path::new(bin))) else {
            continue;
        };
        let Some(executable) = package_root.join(bin).canonicalize().ok() else {
            continue;
        };
        let Some(root) = package_root.canonicalize().ok() else {
            continue;
        };
        if !executable.starts_with(root) || !executable.is_file() {
            continue;
        }
        let mut header = [0u8; 128];
        let Some(count) = std::fs::File::open(&executable)
            .and_then(|mut file| file.read(&mut header))
            .ok()
        else {
            continue;
        };
        let node_script = String::from_utf8_lossy(&header[..count])
            .lines()
            .next()
            .is_some_and(|line| line.starts_with("#!") && line.contains("node"))
            || executable.extension().is_some_and(|extension| {
                extension == "js" || extension == "mjs" || extension == "cjs"
            });
        let version = manifest["version"].as_str().map(str::to_owned);
        let executable = locator::child_path(&executable);
        if node_script {
            let mut arguments = vec![executable.to_string_lossy().into_owned()];
            arguments.extend_from_slice(args);
            return Some(Launch {
                executable: node?.to_path_buf(),
                args: arguments,
                version,
                entry: Some(executable),
                ..Launch::default()
            });
        }
        if let Ok(located) = locator::locate_path(&executable) {
            if located.kind == ProgramKind::Native {
                return Some(Launch {
                    executable: located.path,
                    args: args.to_vec(),
                    version,
                    ..Launch::default()
                });
            }
        }
    }
    None
}

/// Why this agent cannot be installed here, if it cannot. Searches the file
/// system; call it off the async runtime.
pub fn install_reason(definition: &AgentDefinition) -> Option<String> {
    if definition.distribution.npx.is_some() {
        return if locator::locate_native("node").is_none() || npm_cli().is_none() {
            Some("Install Node.js and npm to install this agent.".into())
        } else {
            None
        };
    }
    if let Some(package) = &definition.distribution.uvx {
        if cfg!(windows) {
            return Some("Managed uv installations are not supported on Windows. Use an installed executable.".into());
        }
        if package.cmd.is_none() {
            return Some("Set the Python package executable name in cmd before installing.".into());
        }
        return if locator::locate_native("uv").is_none() {
            Some("Install uv to install this Python agent.".into())
        } else {
            None
        };
    }
    if definition.distribution.command.is_some() {
        return Some("This definition uses an existing executable. Install it using the agent's instructions.".into());
    }
    match definition.distribution.binary.get(&platform()) {
        None => Some(format!("No binary is published for {}.", platform())),
        Some(binary) if binary.sha256.is_none() => Some("This binary has no SHA-256 checksum. Use a verified distribution or an installed executable.".into()),
        Some(binary) if !binary.archive.ends_with(".tar.gz") && !binary.archive.ends_with(".zip") => Some("Only ZIP and tar.gz binary distributions are supported.".into()),
        Some(_) => None,
    }
}

pub fn task_unavailable_reason(definition: &AgentDefinition) -> Option<String> {
    task_unavailable_reason_for(definition, std::env::consts::OS)
}

pub(super) fn task_unavailable_reason_for(
    definition: &AgentDefinition,
    os: &str,
) -> Option<String> {
    if os == "windows" {
        return Some("Isolated CLI agent tasks are not available on Windows yet. Use the agent in the assistant instead.".into());
    }
    let codex = definition.id == "codex"
        || definition.distribution.npx.as_ref().is_some_and(|package| {
            package_parts(&package.package, true)
                .is_ok_and(|(name, _)| name == "@agentclientprotocol/codex-acp")
        })
        || definition
            .distribution
            .command
            .as_ref()
            .is_some_and(|command| {
                Path::new(&command.executable)
                    .file_stem()
                    .is_some_and(|stem| stem == "codex-acp")
            });
    if os == "macos" && codex {
        return Some("Codex cannot start its child processes under macOS task isolation. Use Codex in the assistant or choose Oleafly Assistant for this task.".into());
    }
    None
}

#[derive(Clone, Debug)]
pub(crate) struct VendorCli {
    pub(crate) command: &'static str,
    pub(crate) display_name: &'static str,
    pub(crate) sign_in_command: &'static str,
    pub(crate) shares_bridge: bool,
    /// The variable the bridge reads to find the vendor CLI.
    pub(crate) cli_env: Option<&'static str>,
    /// Set the variable only for a CLI the user chose; otherwise the bridge
    /// uses the CLI it bundles.
    pub(crate) cli_env_needs_override: bool,
    /// The bridge can start a Windows `.cmd`/`.bat` CLI.
    pub(crate) cli_env_accepts_script: bool,
    /// The bridge cannot work without the vendor CLI.
    pub(crate) bridge_needs_cli: bool,
}

impl VendorCli {
    const fn shared(
        command: &'static str,
        display_name: &'static str,
        sign_in_command: &'static str,
    ) -> Self {
        Self {
            command,
            display_name,
            sign_in_command,
            shares_bridge: true,
            cli_env: None,
            cli_env_needs_override: false,
            cli_env_accepts_script: false,
            bridge_needs_cli: false,
        }
    }
}

const VENDOR_CLIS: &[(&str, VendorCli)] = &[
    (
        "claude",
        VendorCli {
            command: "claude",
            display_name: "Claude Code",
            sign_in_command: "claude auth login",
            shares_bridge: false,
            cli_env: Some("CLAUDE_CODE_EXECUTABLE"),
            cli_env_needs_override: true,
            cli_env_accepts_script: false,
            bridge_needs_cli: false,
        },
    ),
    (
        "codex",
        VendorCli {
            command: "codex",
            display_name: "Codex",
            sign_in_command: "codex login",
            shares_bridge: false,
            cli_env: Some("CODEX_PATH"),
            cli_env_needs_override: true,
            cli_env_accepts_script: true,
            bridge_needs_cli: false,
        },
    ),
    (
        "gemini",
        VendorCli::shared("gemini", "Gemini CLI", "gemini"),
    ),
    (
        "pi",
        VendorCli {
            command: "pi",
            display_name: "Pi",
            sign_in_command: "pi",
            shares_bridge: false,
            cli_env: Some("PI_ACP_PI_COMMAND"),
            cli_env_needs_override: false,
            cli_env_accepts_script: true,
            bridge_needs_cli: true,
        },
    ),
    (
        "opencode",
        VendorCli::shared("opencode", "OpenCode", "opencode auth login"),
    ),
    (
        "openclaw",
        VendorCli::shared("openclaw", "OpenClaw", "openclaw models auth login"),
    ),
    ("cline", VendorCli::shared("cline", "Cline", "cline auth")),
    (
        "hermes",
        VendorCli::shared("hermes", "Hermes Agent", "hermes setup"),
    ),
    (
        "codebuddy",
        VendorCli::shared("codebuddy", "CodeBuddy Code", "codebuddy"),
    ),
    ("kimi", VendorCli::shared("kimi", "Kimi Code", "kimi login")),
    (
        "grok",
        VendorCli::shared("grok", "Grok Build", "grok login"),
    ),
    (
        "cursor",
        VendorCli::shared("agent", "Cursor CLI", "agent login"),
    ),
    (
        "deepseek",
        VendorCli::shared("dsh", "DeepSeek Harness", "dsh web"),
    ),
    (
        "qoder",
        VendorCli::shared("qodercli", "Qoder CLI", "qodercli login"),
    ),
];

pub(crate) fn vendor_cli(definition: &AgentDefinition) -> Option<VendorCli> {
    VENDOR_CLIS
        .iter()
        .find(|(id, _)| *id == definition.id)
        .map(|(_, cli)| cli.clone())
}

pub(crate) fn parse_cli_version(output: &str) -> Option<String> {
    let version = output
        .split_whitespace()
        .map(|token| token.trim_start_matches('v'))
        .find(|token| {
            token.contains('.')
                && token.split('.').next().is_some_and(|part| {
                    !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit())
                })
        })
        .map(|token| {
            token
                .trim_end_matches(|c: char| !c.is_ascii_alphanumeric())
                .to_string()
        })?;
    (!version.is_empty() && version.len() <= 40).then_some(version)
}

/// Runs blocking file system work (program searches) off the async runtime.
pub(crate) async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|_| "Oleafly stopped looking for the agent's programs unexpectedly.".to_string())
}

/// An empty working folder for a probe, below the ACP data folder.
pub(crate) fn probe_folder(root: &Path) -> Result<locator::ProbeDir, String> {
    locator::probe_dir_in(&root.join("probe"))
        .map_err(|_| "Oleafly couldn't create a working folder for the check.".to_string())
}

/// Runs `<program> --version` the way a bridge would start it: `.cmd` and
/// `.bat` through Rust's cmd.exe launch, in an empty Oleafly-owned folder,
/// with the agent's environment.
pub(crate) async fn program_version(
    root: &Path,
    program: &Located,
    env: &[(String, OsString)],
    limit: Duration,
) -> Result<String, String> {
    let probe = probe_folder(root)?;
    if program.kind == ProgramKind::Script {
        locator::script_launch_check(&program.path, probe.path())?;
    }
    let mut command = tokio::process::Command::new(&program.path);
    command
        .arg("--version")
        .current_dir(probe.path())
        .envs(env.iter().map(|(name, value)| (name, value)));
    let output = bounded_command(command, limit).await?;
    parse_cli_version(&output).ok_or_else(|| "It didn't report a version.".to_string())
}

const STATUS_VERSION_LIMIT: Duration = Duration::from_secs(5);

/// The sign-in command as the user would type it: the bare command when a
/// terminal finds it by name, otherwise with the CLI's quoted full path.
pub(crate) fn sign_in_command_text(sign_in: &str, path: Option<&Path>, reachable: bool) -> String {
    match path {
        Some(path) if !reachable => {
            let rest = sign_in
                .split_once(' ')
                .map(|(_, rest)| format!(" {rest}"))
                .unwrap_or_default();
            format!("\"{}\"{rest}", path.display())
        }
        _ => sign_in.to_string(),
    }
}

fn rejected_candidates(rejected: &[Rejected]) -> Vec<RejectedCandidate> {
    rejected
        .iter()
        .map(|entry| RejectedCandidate {
            path: locator::child_path(&entry.path)
                .to_string_lossy()
                .into_owned(),
            reason: entry.reason.code().into(),
        })
        .collect()
}

fn cli_status(
    vendor: &VendorCli,
    plan: &Plan,
    reachable: bool,
    version: Option<String>,
) -> CliStatus {
    let path = plan.cli.as_ref().map(|cli| cli.located.path.clone());
    CliStatus {
        command: vendor.command.into(),
        display_name: vendor.display_name.into(),
        path: path
            .as_ref()
            .map(|value| value.to_string_lossy().into_owned()),
        version,
        sign_in_command: sign_in_command_text(vendor.sign_in_command, path.as_deref(), reachable),
        source: plan
            .cli
            .as_ref()
            .map(|cli| if cli.overridden { "override" } else { "auto" }.into()),
        rejected: rejected_candidates(&plan.cli_rejected),
    }
}

fn sign_in_hint(definition: &AgentDefinition, cli: Option<&CliStatus>) -> String {
    let vendor = vendor_cli(definition);
    let command = cli.map(|cli| cli.sign_in_command.clone()).or_else(|| {
        vendor
            .as_ref()
            .map(|vendor| vendor.sign_in_command.to_string())
    });
    if definition.id == "gemini" {
        return format!(
            "Run {} in your terminal and finish sign-in and workspace trust, then reconnect.",
            command.as_deref().unwrap_or("gemini")
        );
    }
    if definition.id == "deepseek" {
        return "Set DEEPSEEK_API_KEY in your environment, or run dsh web and add the key under Settings, then reconnect."
            .into();
    }
    if definition.id == "pi" {
        return format!(
            "Run {} in your terminal and sign in with /login, then reconnect.",
            command.as_deref().unwrap_or("pi")
        );
    }
    let (Some(vendor), Some(command)) = (vendor, command) else {
        return "Use the agent's CLI sign-in, or choose a sign-in method after connecting.".into();
    };
    match cli.and_then(|value| value.path.as_deref()) {
        Some(_) => format!("Run {command} in your terminal, then reconnect."),
        None => format!(
            "Install {}, run {command} in your terminal, then reconnect.",
            vendor.display_name
        ),
    }
}

/// A Node.js version as (major, minor, patch).
pub(crate) type NodeVersion = (u32, u32, u32);

pub(crate) fn parse_node_version(output: &str) -> Option<NodeVersion> {
    let mut parts = output.trim().trim_start_matches('v').split('.');
    let mut number = || -> Option<u32> {
        let part = parts.next()?;
        let digits: String = part.chars().take_while(char::is_ascii_digit).collect();
        digits.parse().ok()
    };
    Some((number()?, number().unwrap_or(0), number().unwrap_or(0)))
}

static NODE_VERSION: std::sync::Mutex<Option<(PathBuf, std::time::Instant, Option<NodeVersion>)>> =
    std::sync::Mutex::new(None);

/// `node --version` for this Node.js, cached for a minute.
pub(crate) async fn node_version(root: &Path, node: &Path) -> Option<NodeVersion> {
    if let Ok(cache) = NODE_VERSION.lock() {
        if let Some((path, probed, version)) = cache.as_ref() {
            if path == node && probed.elapsed() < Duration::from_secs(60) {
                return *version;
            }
        }
    }
    let version = match probe_folder(root) {
        Ok(probe) => {
            let mut command = tokio::process::Command::new(node);
            command.arg("--version").current_dir(probe.path());
            bounded_command(command, STATUS_VERSION_LIMIT)
                .await
                .ok()
                .and_then(|output| parse_node_version(&output))
        }
        Err(_) => None,
    };
    if let Ok(mut cache) = NODE_VERSION.lock() {
        *cache = Some((node.to_path_buf(), std::time::Instant::now(), version));
    }
    version
}

fn node_requirement(definition: &AgentDefinition) -> Option<u32> {
    definition
        .distribution
        .npx
        .as_ref()
        .and_then(|package| package.node_major)
}

async fn node_major_reason(
    root: &Path,
    definition: &AgentDefinition,
    node: Option<&Path>,
) -> Option<String> {
    let required = node_requirement(definition)?;
    let detected = match node {
        Some(node) => node_version(root, node).await,
        None => None,
    };
    match detected {
        Some((major, _, _)) if major >= required => None,
        Some((major, _, _)) => Some(format!(
            "This agent needs Node.js {required} or newer. The detected version is {major}."
        )),
        None => Some(format!(
            "Install Node.js {required} or newer to run this agent."
        )),
    }
}

/// What a status needs from the file system, gathered in one blocking pass.
struct StatusFacts {
    plan: Plan,
    install_reason: Option<String>,
    reachable: bool,
}

impl StatusFacts {
    fn gather(root: &Path, definition: &AgentDefinition, program: Option<&Path>) -> Self {
        let plan = plan(root, definition, program);
        let reachable = plan
            .cli
            .as_ref()
            .and_then(|cli| cli.located.path.parent())
            .is_none_or(locator::reachable_by_name);
        Self {
            install_reason: install_reason(definition),
            reachable,
            plan,
        }
    }
}

#[cfg(test)]
pub async fn status(root: &Path, definition: AgentDefinition, probe: bool) -> AgentStatus {
    status_with(root, definition, probe, None).await
}

/// An agent's status with the program the user chose for it, if any.
pub async fn status_with(
    root: &Path,
    definition: AgentDefinition,
    probe: bool,
    program: Option<String>,
) -> AgentStatus {
    let facts = {
        let root = root.to_path_buf();
        let definition = definition.clone();
        let program = program.clone();
        blocking(move || StatusFacts::gather(&root, &definition, program.as_deref().map(Path::new)))
            .await
    };
    let facts = match facts {
        Ok(facts) => facts,
        Err(error) => StatusFacts {
            plan: Plan {
                launch: Err(error),
                cli: None,
                cli_rejected: Vec::new(),
                node: None,
            },
            install_reason: None,
            reachable: true,
        },
    };
    let vendor = vendor_cli(&definition);
    let mut reason = facts.install_reason.clone();
    let chosen = program.is_some() && program_role(&definition) == ProgramRole::Launch;
    if definition.distribution.command.is_some() || chosen {
        if let Err(error) = &facts.plan.launch {
            reason = Some(error.clone());
        }
    }
    let node_reason = node_major_reason(root, &definition, facts.plan.node.as_deref()).await;
    // A program the user chose runs without the bridge's Node.js.
    if node_reason.is_some() && !(chosen && facts.plan.launch.is_ok()) {
        reason = node_reason.clone();
    }
    let version = match (&facts.plan.cli, probe, &facts.plan.launch) {
        (Some(cli), true, launch) => {
            let env = launch
                .as_ref()
                .map(|launch| launch.env.clone())
                .unwrap_or_else(|_| locator::child_env(&[], &[]));
            program_version(root, &cli.located, &env, STATUS_VERSION_LIMIT)
                .await
                .ok()
        }
        _ => None,
    };
    let cli = vendor
        .as_ref()
        .map(|vendor| cli_status(vendor, &facts.plan, facts.reachable, version));
    let resolved = facts.plan.launch.ok();
    AgentStatus {
        platform: platform(),
        installed: resolved.is_some(),
        executable: resolved.as_ref().map(|launch| {
            launch
                .entry
                .as_ref()
                .unwrap_or(&launch.executable)
                .to_string_lossy()
                .into_owned()
        }),
        installed_version: resolved.as_ref().and_then(|v| v.version.clone()),
        managed: resolved.as_ref().is_some_and(|v| v.managed),
        can_install: facts.install_reason.is_none() && node_reason.is_none(),
        reason,
        sign_in_hint: Some(sign_in_hint(&definition, cli.as_ref())),
        task_unavailable_reason: task_unavailable_reason(&definition),
        cli,
        bridge_shared_with_cli: vendor.as_ref().is_some_and(|vendor| vendor.shares_bridge),
        program_override: program,
        cli_required: vendor
            .as_ref()
            .is_some_and(|vendor| vendor.bridge_needs_cli),
        definition,
    }
}

/// Fails unless Node.js `required` or newer is installed.
pub async fn check_node(root: &Path, required: u32) -> Result<(), String> {
    let node = blocking(|| locator::locate_native("node"))
        .await?
        .ok_or_else(|| format!("Install Node.js {required} or newer to run this agent."))?;
    let major = node_version(root, &node.path)
        .await
        .map_or(0, |(major, _, _)| major);
    if major < required {
        return Err(format!(
            "This agent needs Node.js {required} or newer. The detected version is {major}."
        ));
    }
    Ok(())
}

static NODE_EXEC_PATH: std::sync::Mutex<Option<(PathBuf, std::time::Instant, Option<PathBuf>)>> =
    std::sync::Mutex::new(None);

/// The real `node` behind a shim (Volta, Scoop): `node -p process.execPath`,
/// bounded and cached like the version probe. Blocking.
fn node_exec_path(node: &Path) -> Option<PathBuf> {
    if let Ok(cache) = NODE_EXEC_PATH.lock() {
        if let Some((path, probed, real)) = cache.as_ref() {
            if path == node && probed.elapsed() < Duration::from_secs(60) {
                return real.clone();
            }
        }
    }
    let real = locator::probe_dir().ok().and_then(|probe| {
        let mut command = std::process::Command::new(node);
        command
            .args(["-p", "process.execPath"])
            .current_dir(probe.path())
            .stdin(Stdio::null());
        let output =
            crate::proc::output_contained_with_timeout(command, Duration::from_secs(5)).ok()?;
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        (output.status.success() && !text.is_empty())
            .then(|| locator::child_path(Path::new(&text)))
            .filter(|path| path.is_absolute() && path.is_file())
    });
    if let Ok(mut cache) = NODE_EXEC_PATH.lock() {
        *cache = Some((node.to_path_buf(), std::time::Instant::now(), real.clone()));
    }
    real
}

fn npm_cli_near(node: &Path) -> Option<PathBuf> {
    let directory = node.parent()?;
    [
        directory.join("node_modules/npm/bin/npm-cli.js"),
        directory.join("../lib/node_modules/npm/bin/npm-cli.js"),
    ]
    .into_iter()
    .find(|v| v.is_file())
    .map(|path| locator::child_path(&path))
}

/// npm's JavaScript entry point. Never parses `npm.cmd`: next to `npm.cmd`,
/// through the `npm` symlink (unix), next to Node.js, then next to the real
/// Node.js behind a version-manager shim. Blocking.
fn npm_cli() -> Option<PathBuf> {
    if let (Some(npm), _) = locator::locate("npm") {
        if npm.kind == ProgramKind::Script {
            let beside = npm
                .path
                .parent()
                .map(|folder| folder.join("node_modules/npm/bin/npm-cli.js"))
                .filter(|path| path.is_file());
            if beside.is_some() {
                return beside.map(|path| locator::child_path(&path));
            }
        } else if let Ok(target) = npm.path.canonicalize() {
            if target.extension().is_some_and(|v| v == "js") {
                return Some(locator::child_path(&target));
            }
        }
    }
    let node = locator::locate_native("node")?.path;
    npm_cli_near(&node).or_else(|| npm_cli_near(&node_exec_path(&node)?))
}

const INSTALL_FAILED: &str =
    "The installation failed. Check the package, network connection and runtime requirements.";
const REPORTED_FAILURE_LINES: usize = 8;
const REPORTED_LINE_CHARS: usize = 200;

const PIPE_HEAD_BYTES: usize = 64 * 1024;
const PENDING_LINE_BYTES: usize = 8 * 1024;

#[derive(Default)]
struct PipeCapture {
    head: String,
    tail: Vec<String>,
    /// The first line that names the error (`Error: …`, `npm error …`).
    salient: Option<String>,
    /// The first `code …` line, such as Node's `code: 'EISDIR',`.
    code: Option<String>,
}

#[derive(Default)]
struct TrailingLines {
    lines: std::collections::VecDeque<String>,
    pending: Vec<u8>,
    salient: Option<String>,
    code: Option<String>,
}

/// `^(\w*Error\b|npm error|npm ERR!|Error:)`: the line that says what failed.
fn salient_line(line: &str) -> bool {
    if line.starts_with("npm error") || line.starts_with("npm ERR!") || line.starts_with("Error:") {
        return true;
    }
    let word: String = line
        .chars()
        .take_while(|character| character.is_ascii_alphanumeric() || *character == '_')
        .collect();
    word.ends_with("Error")
}

fn code_line(line: &str) -> bool {
    line.starts_with("code:") || line.starts_with("code ")
}

impl TrailingLines {
    fn push(&mut self, chunk: &[u8]) {
        for &byte in chunk {
            if byte == b'\n' {
                self.end_line();
            } else if self.pending.len() < PENDING_LINE_BYTES {
                self.pending.push(byte);
            }
        }
    }

    fn end_line(&mut self) {
        let line: String = String::from_utf8_lossy(&self.pending)
            .trim()
            .chars()
            .take(REPORTED_LINE_CHARS)
            .collect();
        self.pending.clear();
        if line.is_empty() {
            return;
        }
        if self.salient.is_none() && salient_line(&line) {
            self.salient = Some(line.clone());
        }
        if self.code.is_none() && code_line(&line) {
            self.code = Some(line.clone());
        }
        if self.lines.len() == REPORTED_FAILURE_LINES {
            self.lines.pop_front();
        }
        self.lines.push_back(line);
    }

    fn finish(mut self) -> PipeCapture {
        self.end_line();
        PipeCapture {
            head: String::new(),
            tail: self.lines.into(),
            salient: self.salient,
            code: self.code,
        }
    }
}

#[cfg(test)]
fn trailing_lines(text: &str) -> PipeCapture {
    let mut buffer = TrailingLines::default();
    buffer.push(text.as_bytes());
    buffer.finish()
}

/// At most eight lines: the line naming the error and the `code` line when
/// the tail no longer shows them, then the last lines of output.
fn command_failure_message(stdout: &PipeCapture, stderr: &PipeCapture) -> String {
    let tail: Vec<&String> = stdout.tail.iter().chain(stderr.tail.iter()).collect();
    let mut candidates: Vec<&String> = Vec::new();
    for line in [&stderr.salient, &stdout.salient, &stderr.code, &stdout.code]
        .into_iter()
        .flatten()
    {
        if !candidates.contains(&line) {
            candidates.push(line);
        }
    }
    let mut lead: Vec<&String> = Vec::new();
    while lead.len() < 2 {
        let room = REPORTED_FAILURE_LINES - lead.len();
        let visible = &tail[tail.len().saturating_sub(room)..];
        let Some(missing) = candidates
            .iter()
            .find(|line| !visible.contains(line) && !lead.contains(line))
        else {
            break;
        };
        lead.push(missing);
    }
    let room = REPORTED_FAILURE_LINES - lead.len();
    let lines: Vec<&str> = lead
        .into_iter()
        .chain(tail[tail.len().saturating_sub(room)..].iter().copied())
        .map(String::as_str)
        .collect();
    if lines.is_empty() {
        return INSTALL_FAILED.into();
    }
    lines.join("\n")
}

fn read_bounded_pipe<R>(mut pipe: R) -> tokio::task::JoinHandle<Result<PipeCapture, String>>
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut bytes = Vec::new();
        let mut trailing = TrailingLines::default();
        let mut buffer = [0u8; 8192];
        loop {
            let count = pipe
                .read(&mut buffer)
                .await
                .map_err(|_| "The installer output could not be read.")?;
            if count == 0 {
                break;
            }
            let chunk = &buffer[..count];
            let remaining = PIPE_HEAD_BYTES.saturating_sub(bytes.len());
            bytes.extend_from_slice(&chunk[..count.min(remaining)]);
            trailing.push(chunk);
        }
        Ok::<_, String>(PipeCapture {
            head: String::from_utf8_lossy(&bytes).into_owned(),
            ..trailing.finish()
        })
    })
}

async fn bounded_command(
    mut command: tokio::process::Command,
    duration: Duration,
) -> Result<String, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::proc::isolate_process_tree(&mut command);
    let program = command.as_std().get_program().to_owned();
    let mut child = command.spawn().map_err(|error| {
        format!(
            "The installation command could not be started ({:?}: {}).",
            error.kind(),
            Path::new(&program).display()
        )
    })?;
    let guard =
        crate::proc::contain_process_tree(child.id().ok_or("The installer has no process ID.")?)
            .map_err(|_| "The installer process could not be contained.")?;
    let read = read_bounded_pipe(
        child
            .stdout
            .take()
            .ok_or("The installer has no output stream.")?,
    );
    let read_errors = read_bounded_pipe(
        child
            .stderr
            .take()
            .ok_or("The installer has no error stream.")?,
    );
    let exit = tokio::time::timeout(duration, child.wait()).await;
    drop(guard);
    let success = match exit {
        Ok(Ok(exit)) => exit.success(),
        _ => {
            let _ = child.kill().await;
            read.abort();
            read_errors.abort();
            return Err("The installation timed out and was stopped.".into());
        }
    };
    let output = read
        .await
        .map_err(|_| "The installer stopped unexpectedly.")??;
    let errors = read_errors
        .await
        .unwrap_or_else(|_| Ok(PipeCapture::default()))?;
    if !success {
        return Err(command_failure_message(&output, &errors));
    }
    Ok(output.head)
}

async fn download(url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .https_only(true)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|_| "The download client could not start.")?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "The download failed. Check your connection.")?
        .error_for_status()
        .map_err(|_| "The server refused the download.")?;
    if response.content_length().is_some_and(|v| v > limit as u64) {
        return Err("The download exceeds the size limit.".into());
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "The download was interrupted.")?;
        if bytes.len() + chunk.len() > limit {
            return Err("The download exceeds the size limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub fn extract(bytes: &[u8], zip_format: bool, destination: &Path) -> Result<(), String> {
    let mut total = 0u64;
    let mut files = 0u32;
    let mut write_entry =
        |path: &Path, size: u64, reader: &mut dyn Read, directory: bool| -> Result<(), String> {
            files += 1;
            total = total.checked_add(size).ok_or("The archive is too large.")?;
            if files > 20_000 || total > EXPANDED_LIMIT || !safe_relative(path) {
                return Err(
                    "The archive contains an unsafe path or exceeds the extraction limits.".into(),
                );
            }
            let target = destination.join(path);
            if directory {
                std::fs::create_dir_all(&target)
                    .map_err(|_| "An archive directory could not be created.")?;
                return Ok(());
            }
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|_| "An archive directory could not be created.")?;
            }
            let mut file = std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&target)
                .map_err(|_| "The archive contains a duplicate or unreadable file.")?;
            let written = std::io::copy(&mut reader.take(size + 1), &mut file)
                .map_err(|_| "An archive file could not be extracted.")?;
            if written != size {
                return Err("An archive file has an invalid size.".into());
            }
            Ok(())
        };
    if zip_format {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
            .map_err(|_| "The ZIP archive is invalid.")?;
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|_| "The ZIP entry is invalid.")?;
            if entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err("Archive symbolic links are not supported.".into());
            }
            let path = PathBuf::from(entry.name());
            let size = entry.size();
            let directory = entry.is_dir();
            write_entry(&path, size, &mut entry, directory)?;
        }
    } else {
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
        for entry in archive
            .entries()
            .map_err(|_| "The tar archive is invalid.")?
        {
            let mut entry = entry.map_err(|_| "The tar entry is invalid.")?;
            let kind = entry.header().entry_type();
            if !kind.is_file() && !kind.is_dir() {
                return Err("Archive links and special files are not supported.".into());
            }
            let path = entry
                .path()
                .map_err(|_| "The archive path is invalid.")?
                .into_owned();
            let size = entry.size();
            write_entry(&path, size, &mut entry, kind.is_dir())?;
        }
    }
    Ok(())
}

/// The programs an install runs, found off the async runtime.
struct InstallTools {
    reason: Option<String>,
    node: Option<PathBuf>,
    npm_cli: Option<PathBuf>,
    uv: Option<PathBuf>,
}

impl InstallTools {
    fn find(definition: &AgentDefinition) -> Self {
        Self {
            reason: install_reason(definition),
            node: locator::locate_native("node").map(|located| located.path),
            npm_cli: definition.distribution.npx.as_ref().and_then(|_| npm_cli()),
            uv: locator::locate_native("uv").map(|located| located.path),
        }
    }
}

pub async fn install(root: &Path, definition: &AgentDefinition) -> Result<(), String> {
    validate(definition)?;
    let tools = {
        let definition = definition.clone();
        blocking(move || InstallTools::find(&definition)).await?
    };
    if let Some(reason) = tools.reason {
        return Err(reason);
    }
    if read_receipt(root, definition).is_some() {
        return Ok(());
    }
    let parent = root.join("agents").join(&definition.id);
    tokio::fs::create_dir_all(&parent)
        .await
        .map_err(|_| "The agent installation directory could not be created.")?;
    let destination = receipt_dir(root, definition);
    if destination.exists() {
        return Err("An incomplete installation already exists for this version. Remove it before retrying.".into());
    }
    let temporary = parent.join(format!("install-{}", new_id()));
    tokio::fs::create_dir(&temporary)
        .await
        .map_err(|_| "The agent installation directory could not be created.")?;
    struct Cleanup(Option<PathBuf>);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            if let Some(path) = &self.0 {
                let _ = std::fs::remove_dir_all(path);
            }
        }
    }
    let _cleanup = Cleanup(Some(temporary.clone()));
    let (relative, node) = if let Some(package) = &definition.distribution.npx {
        check_node(root, package.node_major.unwrap_or(20)).await?;
        tokio::fs::write(temporary.join("package.json"), b"{\"private\":true}")
            .await
            .map_err(|_| "The package manifest could not be written.")?;
        let node = tools.node.ok_or("Node.js was not found.")?;
        let mut command = tokio::process::Command::new(&node);
        command
            .arg(tools.npm_cli.ok_or("npm was not found.")?)
            .args([
                "install",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
                "--save-exact",
                "--registry=https://registry.npmjs.org",
                "--prefix",
            ])
            .arg(locator::child_path(&temporary))
            .arg(&package.package)
            .current_dir(locator::child_path(&temporary))
            .envs(locator::child_env(
                &node
                    .parent()
                    .map(Path::to_path_buf)
                    .into_iter()
                    .collect::<Vec<_>>(),
                &[],
            ));
        command.env(
            "npm_config_userconfig",
            locator::child_path(&temporary.join("empty-npmrc")),
        );
        bounded_command(command, Duration::from_secs(300)).await?;
        let (name, _) = package_parts(&package.package, true)?;
        let package_root = temporary.join("node_modules").join(name);
        let manifest_bytes = tokio::fs::read(package_root.join("package.json"))
            .await
            .map_err(|_| "The installed package has no manifest.")?;
        let manifest: Value = serde_json::from_slice(&manifest_bytes)
            .map_err(|_| "The installed package manifest is invalid.")?;
        let bin = if let Some(bin) = manifest["bin"].as_str() {
            Some(bin)
        } else if let Some(cmd) = &package.cmd {
            manifest["bin"][cmd].as_str()
        } else {
            manifest["bin"]
                .as_object()
                .filter(|v| v.len() == 1)
                .and_then(|v| v.values().next())
                .and_then(Value::as_str)
        }
        .ok_or("The package has several executables. Add its command name to the definition.")?;
        if !safe_relative(Path::new(bin)) {
            return Err("The package executable escapes its directory.".into());
        }
        let executable = package_root
            .join(bin)
            .canonicalize()
            .map_err(|_| "The package executable was not installed.")?;
        let canonical = temporary
            .canonicalize()
            .map_err(|_| "The installation path could not be resolved.")?;
        let relative = executable
            .strip_prefix(&canonical)
            .map_err(|_| "The package executable escapes its installation.")?
            .to_path_buf();
        let mut header = [0u8; 128];
        let mut handle = tokio::fs::File::open(&executable)
            .await
            .map_err(|_| "The package executable could not be read.")?;
        let n = tokio::io::AsyncReadExt::read(&mut handle, &mut header)
            .await
            .map_err(|_| "The package executable could not be read.")?;
        let node = String::from_utf8_lossy(&header[..n])
            .lines()
            .next()
            .is_some_and(|v| v.starts_with("#!") && v.contains("node"))
            || executable
                .extension()
                .is_some_and(|v| v == "js" || v == "mjs" || v == "cjs");
        (relative, node)
    } else if let Some(package) = &definition.distribution.uvx {
        tokio::fs::create_dir(&destination)
            .await
            .map_err(|_| "The Python agent directory could not be created.")?;
        let mut cleanup = Cleanup(Some(destination.clone()));
        let mut command = tokio::process::Command::new(tools.uv.ok_or("uv was not found.")?);
        command
            .args([
                "tool",
                "install",
                "--no-config",
                "--python-preference",
                "only-system",
                &package.package,
            ])
            .envs(locator::child_env(&[], &[]))
            .env(
                "UV_TOOL_DIR",
                locator::child_path(&destination.join("tools")),
            )
            .env(
                "UV_TOOL_BIN_DIR",
                locator::child_path(&destination.join("bin")),
            )
            .current_dir(locator::child_path(&destination));
        bounded_command(command, Duration::from_secs(300)).await?;
        let cmd = package
            .cmd
            .as_ref()
            .ok_or("Set the Python package's executable name in cmd.")?;
        let filename = if cfg!(windows) {
            format!("{cmd}.exe")
        } else {
            cmd.clone()
        };
        let installed = destination
            .join("bin")
            .join(&filename)
            .canonicalize()
            .map_err(|_| "The Python package executable was not installed.")?;
        let canonical = destination
            .canonicalize()
            .map_err(|_| "The installation path could not be resolved.")?;
        let relative = installed
            .strip_prefix(&canonical)
            .map_err(|_| "The Python executable escapes its installation.")?
            .to_path_buf();
        write_receipt(&destination, &definition.version, relative, false)?;
        cleanup.0 = None;
        return Ok(());
    } else {
        let binary = definition
            .distribution
            .binary
            .get(&platform())
            .ok_or("This platform has no binary distribution.")?;
        let bytes = download(&binary.archive, DOWNLOAD_LIMIT).await?;
        let digest = format!("{:x}", Sha256::digest(&bytes));
        if binary
            .sha256
            .as_ref()
            .is_none_or(|expected| !expected.eq_ignore_ascii_case(&digest))
        {
            return Err("The binary checksum does not match. The download was discarded.".into());
        }
        extract(&bytes, binary.archive.ends_with(".zip"), &temporary)?;
        let relative = PathBuf::from(&binary.cmd);
        if !temporary.join(&relative).is_file() {
            return Err("The archive does not contain the declared executable.".into());
        }
        (relative, false)
    };
    #[cfg(unix)]
    if !node {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(
            temporary.join(&relative),
            std::fs::Permissions::from_mode(0o700),
        )
        .await
        .map_err(|_| "The agent executable permissions could not be set.")?;
    }
    tokio::fs::rename(&temporary, &destination)
        .await
        .map_err(|_| "The agent installation could not be finalized.")?;
    write_receipt(&destination, &definition.version, relative, node)
}

fn write_receipt(
    destination: &Path,
    version: &str,
    relative: PathBuf,
    node: bool,
) -> Result<(), String> {
    let receipt = InstallReceipt {
        version: version.into(),
        executable: destination.join(relative),
        node,
    };
    let bytes =
        serde_json::to_vec(&receipt).map_err(|_| "The install receipt could not be encoded.")?;
    std::fs::write(destination.join("receipt.json"), bytes)
        .map_err(|_| "The install receipt could not be saved.".into())
}

pub async fn registry_search(query: &str) -> Result<Vec<RegistryEntry>, String> {
    if query.len() > 200 {
        return Err("The registry search is too long.".into());
    }
    let bytes = download(REGISTRY, 4 * 1024 * 1024).await?;
    let query = query.to_string();
    blocking(move || registry_entries(&bytes, &query)).await?
}

/// Registry ids of agents Oleafly already ships as built-ins.
const REGISTRY_BUILTINS: &[(&str, &str)] = &[
    ("pi-acp", "pi"),
    ("claude-acp", "claude"),
    ("codex-acp", "codex"),
    ("gemini", "gemini"),
    ("opencode", "opencode"),
    ("cline", "cline"),
    ("kimi", "kimi"),
    ("qoder", "qoder"),
    ("cursor", "cursor"),
    ("codebuddy-code", "codebuddy"),
    ("grok-build", "grok"),
];

pub(crate) fn registry_builtin_id(id: &str) -> Option<String> {
    REGISTRY_BUILTINS
        .iter()
        .find(|(registry, _)| *registry == id)
        .map(|(_, builtin)| (*builtin).to_string())
}

fn registry_entries(bytes: &[u8], query: &str) -> Result<Vec<RegistryEntry>, String> {
    let payload: Value =
        serde_json::from_slice(bytes).map_err(|_| "The ACP registry returned invalid JSON.")?;
    let agents = payload["agents"]
        .as_array()
        .ok_or("The ACP registry has no agent list.")?;
    let query = query.to_lowercase();
    Ok(agents.iter().filter(|agent| format!("{} {} {}", agent["id"], agent["name"], agent["description"]).to_lowercase().contains(&query)).take(1000).map(|agent| {
        let id = agent["id"].as_str().unwrap_or_default().to_owned();
        let name = agent["name"].as_str().unwrap_or_default().to_owned();
        let description = agent["description"].as_str().unwrap_or_default().chars().take(4000).collect::<String>();
        let version = agent["version"].as_str().unwrap_or_default().to_owned();
        let definition: Result<AgentDefinition, String> = serde_json::from_value(json!({"id":id,"name":name,"description":description,"version":version,"distribution":agent["distribution"]})).map_err(|_| "This registry distribution uses fields Oleafly does not support.".into()).and_then(|definition| { validate(&definition)?; Ok(definition) });
        match definition {
            Ok(definition) => { let reason = install_reason(&definition); let builtin_id = registry_builtin_id(&id); RegistryEntry { id, name, description, version, definition: Some(definition), reason, builtin_id } },
            Err(reason) => { let builtin_id = registry_builtin_id(&id); RegistryEntry { id, name, description, version, definition: None, reason: Some(reason), builtin_id } },
        }
    }).collect())
}
