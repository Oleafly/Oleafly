//! Fakes for remote run tests: an `ssh` that runs the remote command in a
//! local "remote home", Slurm commands that run jobs in the background, and
//! a Cua host whose Space is a local folder.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

use super::settings::{self, ComputeTarget};
use super::{ComputeHost, McpStdioServer};
use crate::runs::{RunExecutor, RunHandle, RunSpec, RunStatus};

/// Writes an executable script through a child `sh`, so no thread of the
/// test process holds a write descriptor a later `exec` would trip over.
#[cfg(unix)]
pub(crate) fn write_script(path: &Path, body: &str) {
    use std::io::Write;
    let mut child = std::process::Command::new("/bin/sh")
        .arg("-c")
        .arg("cat > \"$1\" && chmod 755 \"$1\"")
        .arg("sh")
        .arg(path)
        .stdin(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(body.as_bytes())
        .unwrap();
    assert!(child.wait().unwrap().success());
}

pub(crate) struct FakeCompute {
    pub data_root: PathBuf,
    pub programs: BTreeMap<String, PathBuf>,
    pub spaces: Option<Arc<FakeSpaces>>,
}

#[async_trait::async_trait]
impl ComputeHost for FakeCompute {
    fn data_root(&self) -> PathBuf {
        self.data_root.clone()
    }

    fn locate_program(&self, name: &str) -> Option<PathBuf> {
        self.programs.get(name).cloned()
    }

    async fn mcp_call(
        &self,
        server: &McpStdioServer,
        tool: &str,
        arguments: Value,
        _timeout: Duration,
    ) -> Result<Value, String> {
        match &self.spaces {
            Some(spaces) => spaces.call(server, tool, arguments).await,
            None => Err("no MCP".into()),
        }
    }
}

pub(crate) struct World {
    _dir: tempfile::TempDir,
    root: PathBuf,
    pub host: Arc<dyn ComputeHost>,
    pub target_id: String,
}

impl World {
    pub fn workspace(&self) -> PathBuf {
        self.root.join("workspace")
    }

    pub fn remote_home(&self) -> PathBuf {
        self.root.join("remote home")
    }

    pub fn run_dir(&self, run_id: &str) -> PathBuf {
        self.root.join("data/research-tasks/runs/t1").join(run_id)
    }

    pub fn spec(&self, run_id: &str, command: &str) -> RunSpec {
        RunSpec {
            task_id: "t1".into(),
            run_id: run_id.into(),
            command: command.into(),
            cwd_rel: String::new(),
            env: BTreeMap::from([("GREETING".to_string(), "hello".to_string())]),
            timeout: Duration::from_secs(600),
            profile: crate::RunProfile::Analysis,
            workspace: self.workspace(),
            resources: None,
            target: Some(self.target_id.clone()),
            run_dir: self.run_dir(run_id),
            network: false,
            sandbox: None,
        }
    }

    /// How many times the fake ssh ran.
    pub fn calls(&self) -> usize {
        std::fs::read_to_string(self.root.join("calls.log"))
            .map(|text| text.lines().count())
            .unwrap_or(0)
    }

    /// Every later ssh call fails the way OpenSSH would.
    pub fn fail_ssh_with(&self, code: i32, stderr: &str) {
        std::fs::write(self.root.join("fail.stderr"), format!("{stderr}\n")).unwrap();
        std::fs::write(self.root.join("fail"), code.to_string()).unwrap();
    }

    pub fn heal_ssh(&self) {
        let _ = std::fs::remove_file(self.root.join("fail"));
    }

    /// Uploads wait 5 s before unpacking.
    pub fn slow_tar(&self) {
        std::fs::write(self.root.join("slow"), "").unwrap();
    }

    /// Files a test reads or writes on the "remote" side.
    pub fn remote(&self, relative: &str) -> PathBuf {
        self.remote_home().join(relative)
    }
}

#[cfg(unix)]
fn fake_ssh(root: &Path) -> PathBuf {
    let program = root.join("bin-local").join("ssh");
    std::fs::create_dir_all(program.parent().unwrap()).unwrap();
    let body = format!(
        r#"#!/bin/sh
ROOT='{root}'
echo call >> "$ROOT/calls.log"
if [ -f "$ROOT/fail" ]; then cat "$ROOT/fail.stderr" >&2; exit "$(cat "$ROOT/fail")"; fi
while [ $# -gt 0 ] && [ "$1" != "--" ]; do shift; done
shift
shift
if [ -f "$ROOT/slow" ]; then case "$1" in *tar*) sleep 5;; esac; fi
cd "$ROOT/remote home" || exit 1
HOME="$ROOT/remote home"
PATH="$ROOT/bin-remote:$PATH"
export HOME PATH
exec /bin/sh -c "$1"
"#,
        root = root.display()
    );
    write_script(&program, &body);
    program
}

/// A world with one SSH (or Slurm) target reached through the fake ssh.
#[cfg(unix)]
pub(crate) fn world_with(target: impl FnOnce(String) -> ComputeTarget, rsync: bool) -> World {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_path_buf();
    for folder in ["workspace", "remote home", "data", "bin-remote"] {
        std::fs::create_dir_all(root.join(folder)).unwrap();
    }
    std::fs::write(root.join("workspace/train.py"), "print('hi')\n").unwrap();
    let ssh = fake_ssh(&root);
    let mut programs = BTreeMap::from([("ssh".to_string(), ssh)]);
    if rsync {
        if let Some(found) = super::path_search("rsync") {
            programs.insert("rsync".into(), found);
        }
    }
    let target_id = "t-test".to_string();
    let saved = target(target_id.clone());
    settings::update(&root.join("data"), |settings| {
        settings.targets.push(saved);
        Ok(())
    })
    .unwrap();
    World {
        host: Arc::new(FakeCompute {
            data_root: root.join("data"),
            programs,
            spaces: None,
        }),
        root,
        _dir: dir,
        target_id,
    }
}

#[cfg(unix)]
pub(crate) fn ssh_world(rsync: bool) -> World {
    world_with(
        |id| ComputeTarget::Ssh {
            id,
            label: "Lab".into(),
            host: "fakehost".into(),
            user: None,
            port: None,
            remote_root: None,
            prelude: String::new(),
        },
        rsync,
    )
}

/// Polls until the run ends (20 s at most).
pub(crate) async fn wait_for_end(executor: &dyn RunExecutor, handle: &RunHandle) -> RunStatus {
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    loop {
        let status = executor.poll(handle).await.unwrap();
        if matches!(status, RunStatus::Finished { .. } | RunStatus::Lost { .. })
            || std::time::Instant::now() > deadline
        {
            return status;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// Cua Spaces as local folders: `space_bash` runs `sh -c` in the Space's
/// home, `send_file` copies into its `Downloads`, `download` copies out.
pub(crate) struct FakeSpaces {
    pub root: PathBuf,
    pub spaces: Mutex<Vec<(String, String, String)>>,
    pub calls: Mutex<Vec<(String, Value)>>,
}

impl FakeSpaces {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            spaces: Mutex::new(Vec::new()),
            calls: Mutex::new(Vec::new()),
        }
    }

    pub fn add(&self, id: &str, name: &str, os: &str) {
        std::fs::create_dir_all(self.home(name).join("Downloads")).unwrap();
        self.spaces
            .lock()
            .unwrap()
            .push((id.into(), name.into(), os.into()));
    }

    pub fn home(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }

    pub fn calls_to(&self, tool: &str) -> Vec<Value> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|(name, _)| name == tool)
            .map(|(_, arguments)| arguments.clone())
            .collect()
    }

    fn text(text: String) -> Value {
        json!({"content": [{"type": "text", "text": text}]})
    }

    async fn call(
        &self,
        _server: &McpStdioServer,
        tool: &str,
        arguments: Value,
    ) -> Result<Value, String> {
        self.calls
            .lock()
            .unwrap()
            .push((tool.to_string(), arguments.clone()));
        let space = arguments["space"].as_str().unwrap_or_default().to_string();
        match tool {
            "list_spaces" => {
                let spaces: Vec<Value> = self
                    .spaces
                    .lock()
                    .unwrap()
                    .iter()
                    .map(|(id, name, os)| json!({"id": id, "name": name, "os": os, "status": "running"}))
                    .collect();
                Ok(
                    json!({"content": [{"type": "text", "text": "spaces"}], "structuredContent": {"spaces": spaces}}),
                )
            }
            "create_space" => {
                let name = arguments["name"].as_str().unwrap_or_default().to_string();
                self.add(&format!("local:{name}"), &name, "linux");
                Ok(
                    json!({"content": [{"type": "text", "text": "created"}], "structuredContent": {"space": {"id": format!("local:{name}"), "name": name, "os": "linux", "status": "running"}}}),
                )
            }
            "start_space" => Ok(Self::text("started".into())),
            "delete_space" => {
                self.spaces
                    .lock()
                    .unwrap()
                    .retain(|(id, name, _)| id != &space && name != &space);
                Ok(Self::text("deleted".into()))
            }
            "space_bash" => {
                let name = self
                    .spaces
                    .lock()
                    .unwrap()
                    .iter()
                    .find(|(id, name, _)| id == &space || name == &space)
                    .map(|(_, name, _)| name.clone())
                    .ok_or("no such space")?;
                let home = self.home(&name);
                let command = arguments["command"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string();
                let output = tokio::process::Command::new("/bin/sh")
                    .arg("-c")
                    .arg(&command)
                    .current_dir(&home)
                    .env("HOME", &home)
                    .stdin(std::process::Stdio::null())
                    .output()
                    .await
                    .map_err(|error| error.to_string())?;
                let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
                let stderr = String::from_utf8_lossy(&output.stderr);
                if !stderr.is_empty() {
                    if !text.is_empty() && !text.ends_with('\n') {
                        text.push('\n');
                    }
                    text.push_str("[stderr]\n");
                    text.push_str(&stderr);
                }
                if let Some(code) = output.status.code().filter(|code| *code != 0) {
                    if !text.is_empty() && !text.ends_with('\n') {
                        text.push('\n');
                    }
                    text.push_str(&format!("[exit {code}]"));
                }
                Ok(Self::text(text))
            }
            "send_file" => {
                let path = PathBuf::from(arguments["path"].as_str().unwrap_or_default());
                let name = self
                    .spaces
                    .lock()
                    .unwrap()
                    .iter()
                    .find(|(id, name, _)| id == &space || name == &space)
                    .map(|(_, name, _)| name.clone())
                    .ok_or("no such space")?;
                let dest = self
                    .home(&name)
                    .join("Downloads")
                    .join(path.file_name().unwrap());
                std::fs::copy(&path, dest).map_err(|error| error.to_string())?;
                Ok(Self::text("sent".into()))
            }
            "download" => {
                let name = self
                    .spaces
                    .lock()
                    .unwrap()
                    .iter()
                    .find(|(id, name, _)| id == &space || name == &space)
                    .map(|(_, name, _)| name.clone())
                    .ok_or("no such space")?;
                let remote = arguments["path"].as_str().unwrap_or_default();
                let source = if Path::new(remote).is_absolute() {
                    PathBuf::from(remote)
                } else {
                    self.home(&name).join(remote)
                };
                let dest = PathBuf::from(arguments["dest"].as_str().unwrap_or_default());
                std::fs::create_dir_all(&dest).map_err(|error| error.to_string())?;
                std::fs::copy(&source, dest.join(source.file_name().unwrap()))
                    .map_err(|error| error.to_string())?;
                Ok(Self::text("downloaded".into()))
            }
            other => Err(format!("unknown tool {other}")),
        }
    }
}
