//! Agent program setup: the Test check, the program picker and the saved
//! program a user chose for an agent (issue #84).

use super::{
    catalog::{self, Plan, ProgramRole, VendorCli},
    protocol::{Connection, Incoming},
    AgentCheck, AgentDefinition, Capabilities,
};
use crate::app_error::AppError;
use crate::program_locator::{self as locator, Located, ProgramKind, RejectReason};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

/// How long `<cli> --version` may take (a first start of a large native CLI
/// can be slow while antivirus scans it).
const VERSION_LIMIT: Duration = Duration::from_secs(15);
/// How long an agent may take to answer `initialize`.
const INITIALIZE_LIMIT: Duration = Duration::from_secs(20);
/// Pi's CLI needs this Node.js when it runs as a script.
const PI_NODE: (u32, u32, u32) = (22, 19, 0);
const NAME_CHARS: usize = 80;

#[derive(Clone, Copy, Debug)]
pub(crate) struct CheckLimits {
    pub version: Duration,
    pub initialize: Duration,
}

impl Default for CheckLimits {
    fn default() -> Self {
        Self {
            version: VERSION_LIMIT,
            initialize: INITIALIZE_LIMIT,
        }
    }
}

static CHECKING: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// One Test per agent at a time (the key names the runtime and the agent).
pub(crate) struct CheckFlight(String);

impl CheckFlight {
    pub(crate) fn enter(id: &str) -> Result<Self, String> {
        let mut checking = CHECKING
            .lock()
            .map_err(|_| "The agent check is unavailable.".to_string())?;
        if !checking
            .get_or_insert_with(HashSet::new)
            .insert(id.to_string())
        {
            return Err(AppError::new("acp.program.check_running").into());
        }
        Ok(Self(id.to_string()))
    }
}

impl Drop for CheckFlight {
    fn drop(&mut self) {
        if let Ok(mut checking) = CHECKING.lock() {
            if let Some(checking) = checking.as_mut() {
                checking.remove(&self.0);
            }
        }
    }
}

/// Paths the native picker returned in this process, per agent. Any other
/// path needs a native confirmation before it is saved.
static PICKED: Mutex<Vec<(String, PathBuf)>> = Mutex::new(Vec::new());
const PICKED_LIMIT: usize = 64;

pub(crate) fn remember_pick(agent_id: &str, path: &Path) {
    if let Ok(mut picked) = PICKED.lock() {
        if picked.len() >= PICKED_LIMIT {
            picked.remove(0);
        }
        picked.push((agent_id.to_string(), path.to_path_buf()));
    }
}

pub(crate) fn was_picked(agent_id: &str, path: &Path) -> bool {
    PICKED.lock().is_ok_and(|picked| {
        picked
            .iter()
            .any(|(id, known)| id == agent_id && known == path)
    })
}

/// The `AppError` for a program that cannot be used.
pub(crate) fn program_error(code: &str) -> AppError {
    AppError::new(match code {
        "not_found" => "acp.program.not_found",
        "is_directory" => "acp.program.is_directory",
        "not_executable" => "acp.program.not_executable",
        "unsupported_script" => "acp.program.unsupported_script",
        "gui_program" => "acp.program.gui_program",
        "interpreter" => "acp.program.interpreter",
        "network_path" => "acp.program.network_path",
        "needs_exe" => "acp.program.needs_exe",
        "declined" => "acp.program.declined",
        "unknown_agent" => "acp.program.unknown_agent",
        _ => "acp.program.not_found",
    })
}

/// Setup commands change which program Oleafly runs, so only the main window
/// may call them (like folder trust).
pub(crate) fn require_main_window(label: &str) -> Result<(), String> {
    if label == "main" {
        Ok(())
    } else {
        Err(AppError::new("acp.program.main_window").into())
    }
}

/// A bridge that cannot start a Windows script (Claude Code's SDK) accepts a
/// `.cmd` only when it is a shim Oleafly can turn into its script.
pub(crate) fn handoff_refused(definition: &AgentDefinition, located: &Located) -> bool {
    let Some(vendor) = catalog::vendor_cli(definition) else {
        return false;
    };
    catalog::program_role(definition) == ProgramRole::Cli
        && !vendor.cli_env_accepts_script
        && located.kind == ProgramKind::Script
        && locator::npm_shim_target(&located.path).is_none()
}

/// Checks a program the user chose: the file rules (a `RejectReason` code),
/// then the hand-off rule (`needs_exe`). Blocking.
pub(crate) fn inspect_choice(
    definition: &AgentDefinition,
    path: &Path,
) -> Result<Located, &'static str> {
    let located = locator::inspect(path).map_err(RejectReason::code)?;
    if handoff_refused(definition, &located) {
        return Err("needs_exe");
    }
    Ok(located)
}

fn refused_script_detail(vendor: Option<&VendorCli>) -> Option<String> {
    vendor.map(|vendor| format!("Choose {}.exe.", vendor.command))
}

fn failed(code: &str, detail: Option<String>, program: Option<&Path>) -> AgentCheck {
    AgentCheck {
        ok: false,
        code: code.into(),
        detail,
        program: program.map(|path| path.to_string_lossy().into_owned()),
        version: None,
        agent_name: None,
    }
}

fn plain_text(value: &Value) -> Option<String> {
    let text: String = value
        .as_str()?
        .chars()
        .filter(|character| !character.is_control())
        .take(NAME_CHARS)
        .collect();
    let text = text.trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// A Node.js script the CLI runs through `node` (a `.cmd` launcher on
/// Windows, a `#!…node` file elsewhere).
fn runs_on_node(located: &Located) -> bool {
    if located.kind == ProgramKind::Script {
        return true;
    }
    use std::io::Read;
    let mut header = [0u8; 128];
    let count = std::fs::File::open(&located.path)
        .and_then(|mut file| file.read(&mut header))
        .unwrap_or(0);
    String::from_utf8_lossy(&header[..count])
        .lines()
        .next()
        .is_some_and(|line| line.starts_with("#!") && line.contains("node"))
}

fn node_text((major, minor, patch): catalog::NodeVersion) -> String {
    format!("{major}.{minor}.{patch}")
}

/// The Test check: never saves anything. Steps: the chosen file's rules;
/// `<cli> --version` for vendor CLIs (fatal when the bridge needs the CLI);
/// Node.js for Pi's script CLI and for Node.js bridges; then a real start in
/// an empty Oleafly-owned folder with the agent's environment, no tool
/// servers, and `initialize` answered within the limit.
pub(crate) async fn check_agent(
    root: &Path,
    definition: &AgentDefinition,
    candidate: Option<PathBuf>,
    saved: Option<String>,
) -> AgentCheck {
    check_agent_within(root, definition, candidate, saved, CheckLimits::default()).await
}

pub(crate) async fn check_agent_within(
    root: &Path,
    definition: &AgentDefinition,
    candidate: Option<PathBuf>,
    saved: Option<String>,
    limits: CheckLimits,
) -> AgentCheck {
    let vendor = catalog::vendor_cli(definition);
    let role = catalog::program_role(definition);
    let program = match candidate {
        Some(path) => {
            let checked = {
                let definition = definition.clone();
                let path = path.clone();
                catalog::blocking(move || inspect_choice(&definition, &path)).await
            };
            match checked {
                Ok(Ok(located)) => Some(located.path),
                Ok(Err("needs_exe")) => {
                    return failed(
                        "unsupported_script",
                        refused_script_detail(vendor.as_ref()),
                        Some(&path),
                    );
                }
                Ok(Err(code)) => return failed(code, None, Some(&path)),
                Err(error) => return failed("start_failed", Some(error), Some(&path)),
            }
        }
        None => saved.map(PathBuf::from),
    };
    let plan = {
        let root = root.to_path_buf();
        let definition = definition.clone();
        let program = program.clone();
        catalog::blocking(move || catalog::plan(&root, &definition, program.as_deref())).await
    };
    let plan = match plan {
        Ok(plan) => plan,
        Err(error) => return failed("start_failed", Some(error), program.as_deref()),
    };
    let shown = shown_program(role, program.as_deref(), &plan);
    let shown = shown.as_deref();
    let env = match &plan.launch {
        Ok(launch) => launch.env.clone(),
        Err(_) => catalog::launch_env(
            vendor.as_ref(),
            plan.node.as_deref(),
            plan.cli.as_ref(),
            &catalog::Launch::default(),
        ),
    };

    let mut version = None;
    if let Some(vendor) = &vendor {
        match &plan.cli {
            Some(cli) => {
                match catalog::program_version(root, &cli.located, &env, limits.version).await {
                    Ok(found) => version = Some(found),
                    Err(detail) if vendor.bridge_needs_cli => {
                        return failed("cli_missing", Some(detail), shown)
                    }
                    Err(_) => {}
                }
                if vendor.bridge_needs_cli && runs_on_node(&cli.located) {
                    let Some(node) = plan.node.as_deref() else {
                        return failed("node_missing", None, shown);
                    };
                    match catalog::node_version(root, node).await {
                        Some(found) if found >= PI_NODE => {}
                        Some(found) => {
                            return failed(
                                "node_too_old",
                                Some(format!(
                                    "{} needs Node.js {} or newer. This computer has {}.",
                                    vendor.display_name,
                                    node_text(PI_NODE),
                                    node_text(found)
                                )),
                                shown,
                            )
                        }
                        None => return failed("node_missing", None, shown),
                    }
                }
            }
            None if vendor.bridge_needs_cli => {
                let detail = plan
                    .cli_rejected
                    .iter()
                    .map(|entry| entry.path.to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join("\n");
                return failed("cli_missing", (!detail.is_empty()).then_some(detail), shown);
            }
            None => {}
        }
    }

    let launch = match plan.launch {
        Ok(launch) => launch,
        Err(error) => {
            let bridge = definition.distribution.npx.is_some()
                && !(program.is_some() && role == ProgramRole::Launch);
            let code = if bridge {
                "bridge_missing"
            } else {
                "not_found"
            };
            return failed(code, Some(error), shown);
        }
    };
    let chosen_launch = program.is_some() && role == ProgramRole::Launch;
    if let Some(required) = definition
        .distribution
        .npx
        .as_ref()
        .and_then(|package| package.node_major)
        .filter(|_| !chosen_launch && launch.entry.is_some())
    {
        match catalog::node_version(root, &launch.executable).await {
            Some(found) if found.0 >= required => {}
            Some(found) => {
                return failed(
                    "node_too_old",
                    Some(format!(
                        "This agent needs Node.js {required} or newer. This computer has {}.",
                        node_text(found)
                    )),
                    shown,
                )
            }
            None => return failed("node_missing", None, shown),
        }
    }
    start_and_initialize(root, &launch, shown, version, limits.initialize).await
}

/// The path the check reports: the program the user chose, else the CLI for
/// bridges that start one, else what Oleafly starts (a bridge's script
/// rather than `node`).
fn shown_program(role: ProgramRole, program: Option<&Path>, plan: &Plan) -> Option<PathBuf> {
    if let Some(program) = program {
        return Some(program.to_path_buf());
    }
    if role == ProgramRole::Cli {
        if let Some(cli) = &plan.cli {
            return Some(cli.located.path.clone());
        }
    }
    plan.launch.as_ref().ok().map(|launch| {
        launch
            .entry
            .clone()
            .unwrap_or_else(|| launch.executable.clone())
    })
}

fn initialize_request() -> Value {
    json!({
        "protocolVersion": 1,
        "clientInfo": {"name": "oleafly", "title": "Oleafly", "version": env!("CARGO_PKG_VERSION")},
        "clientCapabilities": {"fs": {"readTextFile": false, "writeTextFile": false}, "terminal": false}
    })
}

async fn start_and_initialize(
    root: &Path,
    launch: &catalog::Launch,
    shown: Option<&Path>,
    cli_version: Option<String>,
    limit: Duration,
) -> AgentCheck {
    let probe = match catalog::probe_folder(root) {
        Ok(probe) => probe,
        Err(error) => return failed("start_failed", Some(error), shown),
    };
    if launch.batch {
        if let Err(error) = locator::script_launch_check(&launch.executable, probe.path()) {
            return failed("start_failed", Some(error), shown);
        }
    }
    let mut command = tokio::process::Command::new(&launch.executable);
    command
        .args(&launch.args)
        .current_dir(probe.path())
        .envs(launch.env.iter().map(|(name, value)| (name, value)));
    let (connection, mut incoming) = match Connection::spawn(command).await {
        Ok(started) => started,
        Err(error) => return failed("start_failed", Some(error), shown),
    };
    // Responses wait until earlier messages were handled; nothing else is
    // expected before `initialize` answers.
    let drain = tokio::spawn(async move {
        while let Some(message) = incoming.recv().await {
            match message {
                Incoming::Barrier(done) => {
                    let _ = done.send(());
                }
                Incoming::Disconnected => break,
                Incoming::Message(_) => {}
            }
        }
    });
    let reply = tokio::time::timeout(
        limit,
        connection.request(
            "initialize",
            initialize_request(),
            limit + Duration::from_secs(5),
        ),
    )
    .await;
    let result = match reply {
        Err(_) => failed("timeout", None, shown),
        Ok(Err(error)) => {
            let exited = connection.is_closed()
                || error.message.starts_with("The agent disconnected")
                || error.message.starts_with("The agent is disconnected");
            failed(
                if exited { "exited" } else { "not_acp" },
                Some(error.message),
                shown,
            )
        }
        Ok(Ok(value)) => match Capabilities::from_initialize(&value) {
            Err(error) => failed("not_acp", Some(error), shown),
            Ok(_) => AgentCheck {
                ok: true,
                code: "ready".into(),
                detail: None,
                program: shown.map(|path| path.to_string_lossy().into_owned()),
                version: cli_version.or_else(|| plain_text(&value["agentInfo"]["version"])),
                agent_name: plain_text(&value["agentInfo"]["title"])
                    .or_else(|| plain_text(&value["agentInfo"]["name"])),
            },
        },
    };
    connection.shutdown().await;
    drain.abort();
    drop(probe);
    result
}

/// Opens the native file picker for an agent's program, starting in the
/// folder of the program Oleafly uses today.
pub(crate) async fn pick_program(
    app: &tauri::AppHandle,
    definition: &AgentDefinition,
    start: Option<PathBuf>,
) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file().set_title(crate::i18n::t_with(
        "dialog.agentProgram.pickTitle",
        &[("name", &definition.name)],
    ));
    if cfg!(windows) {
        dialog = dialog.add_filter(
            crate::i18n::t("dialog.agentProgram.filter"),
            &["exe", "cmd", "bat", "com"],
        );
    }
    if let Some(start) = start.filter(|folder| folder.is_dir()) {
        dialog = dialog.set_directory(start);
    }
    dialog.pick_file(move |selection| {
        let _ = sender.send(selection);
    });
    let Some(selection) = receiver
        .await
        .map_err(|_| crate::i18n::t("errors.approvalDialogClosed"))?
    else {
        return Ok(None);
    };
    let path = selection
        .into_path()
        .map_err(|_| String::from(program_error("not_found")))?;
    Ok(Some(locator::child_path(&path)))
}

/// Asks before saving a program the picker did not return in this process.
pub(crate) async fn confirm_program(
    app: &tauri::AppHandle,
    definition: &AgentDefinition,
    path: &Path,
) -> Result<bool, String> {
    crate::trust::native_confirm(
        app,
        "dialog.agentProgram.title",
        crate::i18n::t_with(
            "dialog.agentProgram.message",
            &[
                ("name", &definition.name),
                ("path", &path.to_string_lossy()),
            ],
        ),
        "dialog.agentProgram.confirm",
    )
    .await
}
