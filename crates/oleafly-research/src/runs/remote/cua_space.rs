//! Runs in a Cua Space (a Linux or macOS sandbox VM), driven through the
//! `cua daemon mcp` server with a fixed, minimal permission list. Runs
//! start detached; logs come back in base64 chunks that fit `space_bash`'s
//! output cut, and the full log and outputs come back by download.
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::archive::{pack_workspace, unpack_into, PackLimits, UnpackLimits};
use super::mirror::{RemoteMirror, MIRROR_CAP};
use super::scripts::{self, Detach, RemoteRun, RemoteState};
use super::settings::ComputeTarget;
use super::ssh::{
    finished, load_target, outcome_for, running, save_handle, summary_note, unreachable,
    SYNC_EVERY_MS,
};
use super::{handle_data, outputs_folder, ComputeHost, McpStdioServer};
use crate::model::now_ms;
use crate::runs::{
    LogQuery, RunError, RunExecutor, RunHandle, RunOutcomeKind, RunSpec, RunStatus, HANDLE_VERSION,
};

pub const CUA_PERMISSIONS: &str =
    "spaces:readonly,spaces:create_space,spaces:start_space,spaces:space_bash,spaces:send_file";
/// Base64 of this many bytes stays under `space_bash`'s 16,000-character cut.
pub const CUA_LOG_CHUNK: u64 = 11_000;
const MAX_CHUNKS_PER_POLL: usize = 4;
/// The largest outputs archive downloaded: a little over the 512 MiB the
/// unpacking keeps.
#[cfg(not(test))]
const MAX_OUTPUTS_DOWNLOAD: u64 = 640 * 1024 * 1024;
#[cfg(test)]
const MAX_OUTPUTS_DOWNLOAD: u64 = 2 * 1024;
const CALL_SLACK: Duration = Duration::from_secs(30);
const BASH_TIMEOUT: u64 = 60;
const LONG_BASH_TIMEOUT: u64 = 300;
const CREATE_TIMEOUT: u64 = 600;
const INSTALL_HINT: &str =
    "Cua is not installed. Install it from cua.ai, then test the target in Settings › Research › Compute.";

/// The `cua` MCP server with only the permissions runs need.
pub fn cua_server(program: PathBuf, per_task: bool) -> McpStdioServer {
    let mut permissions = CUA_PERMISSIONS.to_string();
    if per_task {
        permissions.push_str(",spaces:delete_space");
    }
    McpStdioServer {
        program,
        args: vec![
            "daemon".into(),
            "mcp".into(),
            "--permissions".into(),
            permissions,
        ],
        env: [(
            "CUA_SPACES_AGENT_CREDENTIALS_HOME".to_string(),
            "none".to_string(),
        )]
        .into_iter()
        .collect(),
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpaceInfo {
    pub id: String,
    pub name: String,
    pub os: String,
    pub ready: bool,
    /// A Relay Space is the user's own computer, not an isolated machine.
    pub relay: bool,
}

fn result_text(result: &Value) -> String {
    result["content"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

fn tool_error(result: &Value) -> Option<String> {
    if result["isError"].as_bool() != Some(true) {
        return None;
    }
    let message = result["structuredContent"]["error"]["message"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| result_text(result));
    Some(
        message
            .chars()
            .filter(|character| !character.is_control() || *character == '\n')
            .take(500)
            .collect(),
    )
}

pub fn parse_spaces(result: &Value) -> Result<Vec<SpaceInfo>, RunError> {
    if let Some(message) = tool_error(result) {
        return Err(RunError::Remote(format!(
            "Cua could not list the Spaces: {message}"
        )));
    }
    let structured = &result["structuredContent"];
    let list = if structured["spaces"].is_array() {
        structured["spaces"].clone()
    } else {
        serde_json::from_str::<Value>(&result_text(result))
            .ok()
            .map(|value| {
                if value["spaces"].is_array() {
                    value["spaces"].clone()
                } else {
                    value
                }
            })
            .unwrap_or(Value::Null)
    };
    let items = list
        .as_array()
        .ok_or_else(|| RunError::Remote("Cua sent a list of Spaces Oleafly can't read.".into()))?;
    Ok(items
        .iter()
        .filter_map(|item| {
            let id = item["id"].as_str()?.to_string();
            let status = item["status"].as_str().unwrap_or("").to_ascii_lowercase();
            Some(SpaceInfo {
                name: item["name"].as_str().unwrap_or(&id).to_string(),
                os: item["os"].as_str().unwrap_or("").to_ascii_lowercase(),
                ready: matches!(status.as_str(), "running" | "ready" | "online" | ""),
                relay: id.starts_with("relay:"),
                id,
            })
        })
        .collect())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BashResult {
    pub stdout: String,
    pub stderr: String,
    pub exit: Option<i32>,
    pub timed_out: bool,
    pub error: Option<String>,
}

/// Splits `space_bash` text: standard output, then `[stderr]` and its
/// text, then markers such as `[exit 3]`, `[timed out]` or `[signal TERM]`.
pub fn parse_bash(result: &Value) -> Result<BashResult, RunError> {
    if let Some(message) = tool_error(result) {
        return Err(RunError::Remote(message));
    }
    let text = result_text(result);
    let mut body = text.as_str();
    let mut exit = None;
    let mut timed_out = false;
    loop {
        let trimmed = body.trim_end_matches('\n');
        let (rest, last) = match trimmed.rfind('\n') {
            Some(index) => (&trimmed[..=index], &trimmed[index + 1..]),
            None => ("", trimmed),
        };
        if let Some(code) = last
            .strip_prefix("[exit ")
            .and_then(|tail| tail.strip_suffix(']'))
        {
            exit = code.trim().parse().ok();
        } else if last == "[timed out]" {
            timed_out = true;
        } else if !(last.starts_with("[signal ") && last.ends_with(']')) {
            break;
        }
        body = rest;
    }
    let (stdout, stderr) = match body.find("[stderr]\n") {
        Some(index) if index == 0 || body[..index].ends_with('\n') => {
            (&body[..index], &body[index + "[stderr]\n".len()..])
        }
        _ => (body, ""),
    };
    Ok(BashResult {
        stdout: stdout.to_string(),
        stderr: stderr.to_string(),
        exit: if timed_out { exit } else { exit.or(Some(0)) },
        timed_out,
        error: None,
    })
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CuaHandleData {
    pub target_id: String,
    pub space: String,
    pub space_id: String,
    pub remote_dir: String,
    pub remote_home: String,
    pub per_task: bool,
    pub detach: Detach,
    pub workspace: PathBuf,
    pub timeout_secs: u64,
}

pub struct CuaSpaceExecutor {
    host: Arc<dyn ComputeHost>,
}

/// One Space as a run reaches it.
struct Space<'a> {
    host: &'a dyn ComputeHost,
    server: McpStdioServer,
    id: String,
}

fn per_task_name(task_id: &str) -> String {
    let short: String = task_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(8)
        .collect();
    format!("oleafly-{}", short.to_ascii_lowercase())
}

/// Starts the Cua daemon (detached) when a call says it is not running.
async fn start_daemon(program: &Path) {
    let mut command = tokio::process::Command::new(program);
    command
        .args(["daemon", "start"])
        .env("CUA_SPACES_AGENT_CREDENTIALS_HOME", "none")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    super::transport::no_window(&mut command);
    if let Ok(mut child) = command.spawn() {
        let _ = tokio::time::timeout(Duration::from_secs(30), child.wait()).await;
    }
}

async fn call(
    host: &dyn ComputeHost,
    server: &McpStdioServer,
    tool: &str,
    arguments: Value,
    seconds: u64,
) -> Result<Value, RunError> {
    let timeout = Duration::from_secs(seconds) + CALL_SLACK;
    match host
        .mcp_call(server, tool, arguments.clone(), timeout)
        .await
    {
        Ok(result) => Ok(result),
        Err(message) if message.to_ascii_lowercase().contains("daemon") => {
            start_daemon(&server.program).await;
            host.mcp_call(server, tool, arguments, timeout)
                .await
                .map_err(|message| RunError::Network(format!("Cua's {tool} failed: {message}")))
        }
        Err(message) => Err(RunError::Network(format!("Cua's {tool} failed: {message}"))),
    }
}

impl Space<'_> {
    async fn bash(&self, command: &str, seconds: u64) -> Result<BashResult, RunError> {
        let result = call(
            self.host,
            &self.server,
            "space_bash",
            json!({"space": self.id, "command": command, "timeout": seconds}),
            seconds,
        )
        .await?;
        parse_bash(&result)
    }

    /// Runs a script and returns its standard output when it exits 0.
    async fn script(&self, script: &str, seconds: u64) -> Result<String, RunError> {
        let result = self.bash(script, seconds).await?;
        if result.timed_out {
            return Err(RunError::Network(
                "The Space did not finish the command in time.".into(),
            ));
        }
        match result.exit {
            Some(0) => Ok(result.stdout),
            code => {
                let detail: String = result
                    .stderr
                    .lines()
                    .last()
                    .unwrap_or("")
                    .chars()
                    .take(300)
                    .collect();
                Err(RunError::Remote(format!(
                    "The command in the Space failed with exit code {}{}{detail}",
                    code.map_or("unknown".to_string(), |code| code.to_string()),
                    if detail.is_empty() { "." } else { ": " }
                )))
            }
        }
    }

    async fn download(&self, remote: &str, dest: &Path) -> Result<PathBuf, RunError> {
        tokio::fs::create_dir_all(dest)
            .await
            .map_err(|error| RunError::Io(error.to_string()))?;
        let result = call(
            self.host,
            &self.server,
            "download",
            json!({"space": self.id, "path": remote, "dest": dest.to_string_lossy()}),
            LONG_BASH_TIMEOUT,
        )
        .await?;
        if let Some(message) = tool_error(&result) {
            return Err(RunError::Remote(format!(
                "Cua could not download a file: {message}"
            )));
        }
        let name = Path::new(remote)
            .file_name()
            .map(|name| name.to_os_string())
            .unwrap_or_default();
        Ok(dest.join(name))
    }
}

impl CuaSpaceExecutor {
    pub fn new(host: Arc<dyn ComputeHost>) -> Self {
        Self { host }
    }

    fn program(&self) -> Result<PathBuf, RunError> {
        self.host
            .locate_program("cua")
            .ok_or_else(|| RunError::Unavailable(INSTALL_HINT.into()))
    }

    fn space<'a>(&'a self, data: &CuaHandleData) -> Result<Space<'a>, RunError> {
        Ok(Space {
            host: &*self.host,
            server: cua_server(self.program()?, data.per_task),
            id: data.space_id.clone(),
        })
    }

    /// The Space by name, created when missing and started when offline.
    async fn find_or_create(
        &self,
        server: &McpStdioServer,
        name: &str,
        image: Option<&str>,
    ) -> Result<SpaceInfo, RunError> {
        let host = &*self.host;
        let listed =
            parse_spaces(&call(host, server, "list_spaces", json!({}), BASH_TIMEOUT).await?)?;
        let found = match listed.into_iter().find(|space| space.name == name) {
            Some(space) => space,
            None => {
                let mut arguments =
                    json!({"name": name, "on": "local", "wait": true, "timeout": CREATE_TIMEOUT});
                if let Some(image) = image {
                    arguments["image"] = json!(image);
                }
                let created = call(host, server, "create_space", arguments, CREATE_TIMEOUT).await?;
                if let Some(message) = tool_error(&created) {
                    return Err(RunError::Remote(format!(
                        "Cua could not create the Space: {message}"
                    )));
                }
                parse_spaces(&call(host, server, "list_spaces", json!({}), BASH_TIMEOUT).await?)?
                    .into_iter()
                    .find(|space| space.name == name)
                    .ok_or_else(|| {
                        RunError::Remote("Cua created the Space but does not list it.".into())
                    })?
            }
        };
        if found.os.contains("windows") {
            return Err(RunError::Config(
                "Runs need a Linux or macOS Space; this Space runs Windows.".into(),
            ));
        }
        if !found.ready {
            let started = call(
                host,
                server,
                "start_space",
                json!({"space": found.id}),
                CREATE_TIMEOUT,
            )
            .await?;
            if let Some(message) = tool_error(&started) {
                return Err(RunError::Remote(format!(
                    "Cua could not start the Space: {message}"
                )));
            }
        }
        Ok(found)
    }
}

fn absolute(home: &str, dir: &str) -> String {
    if dir.starts_with('/') {
        dir.to_string()
    } else {
        format!("{}/{dir}", home.trim_end_matches('/'))
    }
}

#[async_trait::async_trait]
impl RunExecutor for CuaSpaceExecutor {
    fn id(&self) -> &'static str {
        "cua-space"
    }

    fn poll_every(&self) -> Duration {
        super::REMOTE_POLL_EVERY
    }

    async fn start(&self, spec: &RunSpec) -> Result<RunHandle, RunError> {
        let ComputeTarget::CuaSpace {
            id,
            space,
            per_task,
            image,
            ..
        } = load_target(&*self.host, spec.target.as_deref())?
        else {
            return Err(RunError::Config(
                "The task's compute target is not a Cua Space.".into(),
            ));
        };
        let server = cua_server(self.program()?, per_task);
        let name = if per_task {
            per_task_name(&spec.task_id)
        } else {
            space
        };
        let info = self
            .find_or_create(&server, &name, image.as_deref())
            .await?;
        let handle_space = Space {
            host: &*self.host,
            server: server.clone(),
            id: info.id.clone(),
        };
        let probe = scripts::parse_probe(
            &handle_space
                .script(scripts::probe_script(), BASH_TIMEOUT)
                .await?,
        )?;
        let remote_dir = scripts::run_dir(None, &spec.task_id, &spec.run_id)?;
        let data = CuaHandleData {
            target_id: id,
            space: name,
            space_id: info.id,
            remote_dir,
            remote_home: probe.home.clone(),
            per_task,
            detach: probe.detach,
            workspace: spec.workspace.clone(),
            timeout_secs: spec.timeout.as_secs(),
        };
        let handle = RunHandle {
            version: HANDLE_VERSION,
            executor: self.id().into(),
            task_id: spec.task_id.clone(),
            run_id: spec.run_id.clone(),
            run_dir: spec.run_dir.clone(),
            started_at: now_ms(),
            data: serde_json::to_value(&data).map_err(|error| RunError::Io(error.to_string()))?,
        };
        save_handle(&handle)?;
        let upload = spec.run_dir.join(".upload");
        tokio::fs::create_dir_all(&upload)
            .await
            .map_err(|error| RunError::Io(error.to_string()))?;
        let short: String = spec.task_id.chars().take(8).collect();
        let file_name = format!("oleafly-{short}-{}.tgz", spec.run_id);
        let archive = upload.join(&file_name);
        let workspace = spec.workspace.clone();
        let target = archive.clone();
        tokio::task::spawn_blocking(move || {
            let file =
                std::fs::File::create(&target).map_err(|error| RunError::Io(error.to_string()))?;
            pack_workspace(
                &workspace,
                std::io::BufWriter::new(file),
                &PackLimits::default(),
            )
        })
        .await
        .map_err(|error| RunError::Io(error.to_string()))??;
        let sent = call(
            &*self.host,
            &server,
            "send_file",
            json!({"space": data.space_id, "path": archive.to_string_lossy()}),
            LONG_BASH_TIMEOUT,
        )
        .await;
        let _ = tokio::fs::remove_dir_all(&upload).await;
        let sent = sent?;
        if let Some(message) = tool_error(&sent) {
            return Err(RunError::Remote(format!(
                "Cua could not send the workspace: {message}"
            )));
        }
        let run = RemoteRun {
            dir: &data.remote_dir,
            command: &spec.command,
            cwd_rel: &spec.cwd_rel,
            env: &spec.env,
            timeout_secs: spec.timeout.as_secs(),
            prelude: "",
        };
        let printed = handle_space
            .script(
                &scripts::unpack_and_start_script(
                    &run,
                    &format!("Downloads/{file_name}"),
                    data.detach,
                )?,
                LONG_BASH_TIMEOUT,
            )
            .await?;
        if !printed.contains("OLEAFLY_STARTED") && !printed.contains("OLEAFLY_ALREADY") {
            return Err(RunError::Remote(
                "The run did not start in the Space.".into(),
            ));
        }
        Ok(handle)
    }

    async fn poll(&self, handle: &RunHandle) -> Result<RunStatus, RunError> {
        let data: CuaHandleData = handle_data(handle)?;
        let mirror = RemoteMirror::open(&handle.run_dir)?;
        if let Some(done) = mirror.finished() {
            return Ok(done);
        }
        let Some(_lock) = mirror.try_poll_lock() else {
            return Ok(running(handle, None));
        };
        if let Some(done) = mirror.finished() {
            return Ok(done);
        }
        let label = format!("the Space {}", data.space);
        let space = match self.space(&data) {
            Ok(space) => space,
            Err(error) => return unreachable(handle, data.timeout_secs, &mirror, &label, &error),
        };
        let mut report = None;
        for _ in 0..MAX_CHUNKS_PER_POLL {
            let script =
                scripts::poll_script(&data.remote_dir, mirror.remote_offset(), CUA_LOG_CHUNK);
            let printed = match space.script(&script, BASH_TIMEOUT).await {
                Ok(printed) => printed,
                Err(error) => {
                    return unreachable(handle, data.timeout_secs, &mirror, &label, &error)
                }
            };
            let polled = scripts::parse_poll(&printed)?;
            mirror.append_log(&polled.chunk, &data.remote_dir)?;
            let full = polled.chunk.len() as u64 >= CUA_LOG_CHUNK;
            report = Some(polled);
            if !full {
                break;
            }
        }
        let Some(report) = report else {
            return Ok(running(handle, None));
        };
        let end = match report.state {
            RemoteState::Running => return Ok(running(handle, None)),
            RemoteState::Missing => {
                let lost = RunStatus::Lost {
                    reason: format!("The run's folder in {label} is gone."),
                };
                mirror.finalize(&lost, None)?;
                return Ok(lost);
            }
            RemoteState::Exited(code) => finished(Some(code), outcome_for(code)),
            RemoteState::TimedOut => finished(None, RunOutcomeKind::TimedOut),
            RemoteState::Cancelled => finished(None, RunOutcomeKind::Cancelled),
            RemoteState::Lost => RunStatus::Lost {
                reason: format!("The run in {label} stopped without recording an exit code."),
            },
        };
        let folder = absolute(&data.remote_home, &data.remote_dir);
        let downloads = handle.run_dir.join(".download");
        // The whole log, when it fits the local copy.
        if report.log_size <= MIRROR_CAP {
            match space
                .download(&format!("{folder}/stdout.log"), &downloads)
                .await
            {
                Ok(log) => mirror.replace_log(&log)?,
                Err(error @ RunError::Network(_)) => {
                    return unreachable(handle, data.timeout_secs, &mirror, &label, &error);
                }
                Err(_) => {}
            }
        }
        let note;
        let outputs = match space
            .script(
                &scripts::outputs_script(&data.remote_dir, true),
                LONG_BASH_TIMEOUT,
            )
            .await
        {
            // The archive is downloaded whole before any cap applies to what
            // is in it, so a huge one stays in the Space.
            Ok(printed) => match scripts::outputs_bytes(&printed) {
                Some(bytes) if bytes > MAX_OUTPUTS_DOWNLOAD => Err(RunError::Invalid(format!(
                    "the archive is over {} MiB, so it stayed in the Space.",
                    MAX_OUTPUTS_DOWNLOAD / (1024 * 1024)
                ))),
                _ => {
                    space
                        .download(&format!("{folder}/outputs.tgz"), &downloads)
                        .await
                }
            },
            Err(error) => Err(error),
        };
        match outputs {
            Ok(archive) => {
                let workspace = data.workspace.clone();
                let run_id = handle.run_id.clone();
                let summary = tokio::task::spawn_blocking(move || {
                    let file = std::fs::File::open(&archive)
                        .map_err(|error| RunError::Io(error.to_string()))?;
                    let root = cap_std::fs::Dir::open_ambient_dir(
                        &workspace,
                        cap_std::ambient_authority(),
                    )
                    .map_err(|error| RunError::Io(error.to_string()))?;
                    let relative = outputs_folder(&run_id);
                    let _ = root.remove_dir_all(&relative);
                    root.create_dir_all(&relative)
                        .map_err(|error| RunError::Io(error.to_string()))?;
                    let dest = root
                        .open_dir(&relative)
                        .map_err(|error| RunError::Io(error.to_string()))?;
                    unpack_into(
                        std::io::BufReader::new(file),
                        &dest,
                        &UnpackLimits::default(),
                    )
                })
                .await
                .map_err(|error| RunError::Io(error.to_string()))?;
                note = match summary {
                    Ok(summary) => summary_note(&summary, &handle.run_id),
                    Err(error) => Some(format!("The run's outputs could not be copied: {error}")),
                };
            }
            Err(error @ RunError::Network(_)) => {
                return unreachable(handle, data.timeout_secs, &mirror, &label, &error)
            }
            Err(error) => note = Some(format!("The run's outputs could not be copied: {error}")),
        }
        let _ = tokio::fs::remove_dir_all(&downloads).await;
        let end = match (end, note) {
            (
                RunStatus::Finished {
                    exit_code,
                    finished_at,
                    outcome,
                    ..
                },
                Some(note),
            ) => RunStatus::Finished {
                exit_code,
                finished_at,
                outcome,
                note: Some(note),
            },
            (end, _) => end,
        };
        let code = match &end {
            RunStatus::Finished { exit_code, .. } => *exit_code,
            _ => None,
        };
        mirror.finalize(&end, code)?;
        Ok(end)
    }

    async fn read_log(&self, handle: &RunHandle, query: LogQuery) -> Result<String, RunError> {
        let data: CuaHandleData = handle_data(handle)?;
        let mirror = RemoteMirror::open(&handle.run_dir)?;
        if mirror.finished().is_none() && mirror.synced_ago() > SYNC_EVERY_MS {
            if let (Some(_lock), Ok(space)) = (mirror.try_poll_lock(), self.space(&data)) {
                let script =
                    scripts::poll_script(&data.remote_dir, mirror.remote_offset(), CUA_LOG_CHUNK);
                if let Ok(printed) = space.script(&script, BASH_TIMEOUT).await {
                    if let Ok(report) = scripts::parse_poll(&printed) {
                        let _ = mirror.append_log(&report.chunk, &data.remote_dir);
                    }
                }
            }
        }
        mirror.answer(&query).await
    }

    async fn cancel(&self, handle: &RunHandle) -> Result<(), RunError> {
        let data: CuaHandleData = handle_data(handle)?;
        self.space(&data)?
            .script(&scripts::cancel_script(&data.remote_dir, 10), BASH_TIMEOUT)
            .await
            .map(|_| ())
    }

    async fn cleanup(&self, handle: &RunHandle) -> Result<(), RunError> {
        let data: CuaHandleData = handle_data(handle)?;
        let space = self.space(&data)?;
        if data.per_task {
            let result = call(
                &*self.host,
                &space.server,
                "delete_space",
                json!({"space": data.space_id}),
                BASH_TIMEOUT,
            )
            .await?;
            if let Some(message) = tool_error(&result) {
                return Err(RunError::Remote(message));
            }
            return Ok(());
        }
        space
            .script(&scripts::cleanup_script(&data.remote_dir)?, BASH_TIMEOUT)
            .await
            .map(|_| ())
    }

    /// Removes the run's own folder; a per-task Space stays, since the task's
    /// other runs may be using it.
    async fn discard(&self, handle: &RunHandle) -> Result<(), RunError> {
        let data: CuaHandleData = handle_data(handle)?;
        self.space(&data)?
            .script(&scripts::cleanup_script(&data.remote_dir)?, BASH_TIMEOUT)
            .await
            .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runs::remote::settings;
    use crate::runs::remote::testing::{FakeCompute, FakeSpaces};
    use std::collections::BTreeMap;

    #[test]
    fn cua_launch_env_disables_credential_copy() {
        let server = cua_server(PathBuf::from("cua"), false);
        assert_eq!(
            server
                .env
                .get("CUA_SPACES_AGENT_CREDENTIALS_HOME")
                .map(String::as_str),
            Some("none")
        );
        let flag = server
            .args
            .iter()
            .position(|arg| arg == "--permissions")
            .unwrap();
        assert!(!server.args[flag + 1].is_empty());
        assert!(!server.args[flag + 1].contains("delete_space"));
        assert!(
            cua_server(PathBuf::from("cua"), true).args[flag + 1].contains("spaces:delete_space")
        );
    }

    fn text(value: &str) -> Value {
        json!({"content": [{"type": "text", "text": value}]})
    }

    #[test]
    fn parse_bash_splits_streams_and_exit() {
        let result = parse_bash(&text("hello\n[stderr]\nwarn\n[exit 3]")).unwrap();
        assert_eq!(
            (result.stdout.as_str(), result.stderr.as_str(), result.exit),
            ("hello\n", "warn\n", Some(3))
        );
        let result = parse_bash(&text("[timed out]\n[signal TERM]")).unwrap();
        assert!(result.timed_out);
        let error = parse_bash(
            &json!({"isError": true, "structuredContent": {"error": {"message": "no such space"}}}),
        )
        .unwrap_err();
        assert!(matches!(error, RunError::Remote(ref message) if message == "no such space"));
        assert_eq!(parse_bash(&text("ok\n")).unwrap().exit, Some(0));
    }

    #[test]
    fn relay_spaces_are_flagged() {
        let spaces = parse_spaces(&json!({"structuredContent": {"spaces": [
            {"id": "relay:abc", "name": "My Mac", "os": "macos", "status": "online"},
            {"id": "local:x", "name": "x", "os": "linux", "status": "stopped"}
        ]}}))
        .unwrap();
        assert!(spaces[0].relay && spaces[0].ready);
        assert!(!spaces[1].relay && !spaces[1].ready);
    }

    struct Setup {
        _dir: tempfile::TempDir,
        root: PathBuf,
        spaces: Arc<FakeSpaces>,
        host: Arc<dyn ComputeHost>,
    }

    fn setup(space: &str, per_task: bool, with_cua: bool) -> Setup {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        std::fs::create_dir_all(root.join("workspace")).unwrap();
        std::fs::write(root.join("workspace/train.py"), "print('hi')\n").unwrap();
        let spaces = Arc::new(FakeSpaces::new(root.join("spaces")));
        let target = ComputeTarget::CuaSpace {
            id: "t-cua".into(),
            label: "Space".into(),
            space: space.into(),
            per_task,
            image: None,
        };
        settings::update(&root.join("data"), |settings| {
            settings.targets.push(target);
            Ok(())
        })
        .unwrap();
        let mut programs = BTreeMap::new();
        if with_cua {
            programs.insert("cua".to_string(), PathBuf::from("/usr/local/bin/cua"));
        }
        let host: Arc<dyn ComputeHost> = Arc::new(FakeCompute {
            data_root: root.join("data"),
            programs,
            spaces: Some(spaces.clone()),
        });
        Setup {
            _dir: dir,
            root,
            spaces,
            host,
        }
    }

    fn spec(setup: &Setup, command: &str) -> RunSpec {
        RunSpec {
            task_id: "t1abcdef99".into(),
            run_id: "r001".into(),
            command: command.into(),
            cwd_rel: String::new(),
            env: BTreeMap::new(),
            timeout: Duration::from_secs(600),
            profile: crate::RunProfile::Analysis,
            workspace: setup.root.join("workspace"),
            resources: None,
            target: Some("t-cua".into()),
            run_dir: setup.root.join("runs/r001"),
            network: false,
            sandbox: None,
        }
    }

    #[tokio::test]
    async fn windows_spaces_are_refused() {
        let setup = setup("win", false, true);
        setup.spaces.add("local:win", "win", "windows");
        let error = CuaSpaceExecutor::new(setup.host.clone())
            .start(&spec(&setup, "true"))
            .await
            .unwrap_err();
        assert!(
            matches!(error, RunError::Config(ref message) if message.contains("Linux or macOS")),
            "{error:?}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn named_space_is_matched_by_name_without_reuse() {
        let setup = setup("lab", false, true);
        setup.spaces.add("local:other", "other", "linux");
        setup.spaces.add("local:lab", "lab", "linux");
        let executor = CuaSpaceExecutor::new(setup.host.clone());
        let handle = executor.start(&spec(&setup, "true")).await.unwrap();
        let data: CuaHandleData = handle_data(&handle).unwrap();
        assert_eq!(data.space_id, "local:lab");
        assert!(setup.spaces.calls_to("create_space").is_empty());
        let _ = executor.cancel(&handle).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn missing_named_space_is_created_once() {
        let setup = setup("fresh", false, true);
        let executor = CuaSpaceExecutor::new(setup.host.clone());
        let handle = executor.start(&spec(&setup, "true")).await.unwrap();
        let created = setup.spaces.calls_to("create_space");
        assert_eq!(created.len(), 1);
        assert_eq!(created[0]["name"], "fresh");
        assert_eq!(created[0]["wait"], true);
        assert_eq!(created[0]["on"], "local");
        assert!(created[0].get("image").is_none());
        assert!(created[0].get("reuse").is_none());
        let _ = executor.cancel(&handle).await;
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn end_to_end_with_fake_space() {
        let setup = setup("lab", false, true);
        setup.spaces.add("local:lab", "lab", "linux");
        let executor = CuaSpaceExecutor::new(setup.host.clone());
        let handle = executor
            .start(&spec(
                &setup,
                "echo 'loss: 0.5'; mkdir -p results; echo ok > results/a.txt",
            ))
            .await
            .unwrap();
        let status = crate::runs::remote::testing::wait_for_end(&executor, &handle).await;
        assert!(
            matches!(
                status,
                RunStatus::Finished {
                    exit_code: Some(0),
                    ..
                }
            ),
            "{status:?}"
        );
        assert!(std::fs::read_to_string(handle.run_dir.join("stdout.log"))
            .unwrap()
            .contains("loss: 0.5"));
        assert_eq!(
            std::fs::read_to_string(setup.root.join("workspace/runs/r001/outputs/results/a.txt"))
                .unwrap(),
            "ok\n"
        );
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_huge_outputs_archive_is_left_in_the_space() {
        let setup = setup("lab", false, true);
        setup.spaces.add("local:lab", "lab", "linux");
        let executor = CuaSpaceExecutor::new(setup.host.clone());
        let handle = executor
            .start(&spec(
                &setup,
                "mkdir -p results; head -c 16384 /dev/urandom > results/big.bin",
            ))
            .await
            .unwrap();
        let status = crate::runs::remote::testing::wait_for_end(&executor, &handle).await;
        match status {
            RunStatus::Finished {
                exit_code: Some(0),
                note: Some(note),
                ..
            } => assert!(note.contains("stayed in the Space"), "{note}"),
            other => panic!("{other:?}"),
        }
        // The archive was never downloaded, so none of it reached the workspace.
        let downloaded: Vec<String> = setup
            .spaces
            .calls_to("download")
            .iter()
            .filter_map(|call| call["path"].as_str().map(str::to_owned))
            .collect();
        assert!(
            downloaded.iter().all(|path| !path.ends_with("outputs.tgz")),
            "{downloaded:?}"
        );
        assert!(!setup
            .root
            .join("workspace/runs/r001/outputs/results/big.bin")
            .exists());
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn per_task_space_is_deleted_on_cleanup() {
        let setup = setup("", true, true);
        let executor = CuaSpaceExecutor::new(setup.host.clone());
        let handle = executor.start(&spec(&setup, "true")).await.unwrap();
        crate::runs::remote::testing::wait_for_end(&executor, &handle).await;
        executor.cleanup(&handle).await.unwrap();
        let deleted = setup.spaces.calls_to("delete_space");
        assert_eq!(deleted.len(), 1);
        assert!(setup.spaces.spaces.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn missing_cua_is_reported_as_unavailable() {
        let setup = setup("lab", false, false);
        let error = CuaSpaceExecutor::new(setup.host.clone())
            .start(&spec(&setup, "true"))
            .await
            .unwrap_err();
        assert!(
            matches!(error, RunError::Unavailable(ref message) if message.contains("Cua is not installed"))
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn send_file_gets_a_plain_windows_path() {
        let setup = setup("lab", false, true);
        setup.spaces.add("local:lab", "lab", "linux");
        let _ = CuaSpaceExecutor::new(setup.host.clone())
            .start(&spec(&setup, "true"))
            .await;
        let sent = setup.spaces.calls_to("send_file");
        let path = sent[0]["path"].as_str().unwrap();
        assert!(
            Path::new(path).is_absolute() && !path.starts_with(r"\\?\"),
            "{path}"
        );
        assert!(path.ends_with("oleafly-t1abcdef-r001.tgz"), "{path}");
    }
}
