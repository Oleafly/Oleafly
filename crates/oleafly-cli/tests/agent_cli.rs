mod support;

#[path = "support/mock_provider.rs"]
mod mock_provider;

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};

use mock_provider::{text, tool_call, MockProvider, Step};
use serde_json::{json, Value};
use tempfile::TempDir;

struct Fixture {
    project: TempDir,
    data: TempDir,
}

impl Fixture {
    fn new(mock: &MockProvider) -> Self {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("main.tex"),
            "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n",
        )
        .unwrap();
        let data = tempfile::tempdir().unwrap();
        let config = json!({
            "ai_custom_providers": [
                {"id": "mock", "name": "Mock", "baseURL": mock.base_url(), "key_optional": true},
                {"id": "mock-keyed", "name": "Mock keyed", "baseURL": mock.base_url(), "key_optional": false},
            ],
            "ai_provider_models": {
                "mock": [{"id": "mock-model", "name": "Mock", "enabled": true}],
                "mock-keyed": [{"id": "mock-model", "name": "Mock", "enabled": true}],
            },
        });
        std::fs::write(data.path().join("config.json"), config.to_string()).unwrap();
        Self { project, data }
    }

    fn command(&self, arguments: &[&str]) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_oleaflyc"));
        command
            .args(arguments)
            .current_dir(self.project.path())
            .env("OLEAFLY_DATA_DIR", self.data.path())
            .env("OLEAFLY_APP", self.data.path().join("no-app"))
            .env_remove("OLEAFLY_PROVIDER")
            .env_remove("OLEAFLY_MODEL")
            .env_remove("OLEAFLY_API_KEY")
            .env_remove("OPENAI_API_KEY")
            .env_remove("ANTHROPIC_API_KEY");
        command
    }

    fn run(&self, arguments: &[&str]) -> Output {
        self.command(arguments).output().unwrap()
    }
}

const MOCK: [&str; 4] = ["--provider", "mock", "--model", "mock-model"];

fn with_mock<'a>(arguments: &[&'a str]) -> Vec<&'a str> {
    let mut all = arguments.to_vec();
    all.extend(MOCK);
    all
}

fn json(output: &Output) -> Value {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let last = stdout
        .lines()
        .rfind(|line| !line.trim().is_empty())
        .unwrap_or_default();
    serde_json::from_str(last).unwrap_or_else(|_| {
        panic!(
            "not JSON: {stdout}\nstderr: {}",
            String::from_utf8_lossy(&output.stderr)
        )
    })
}

fn both_streams(output: &Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

#[test]
fn review_mode_writes_only_to_the_review_folder() {
    let mock = MockProvider::script(vec![
        tool_call("write_file", r#"{"path":"notes.md","content":"hi"}"#),
        text("Done"),
    ]);
    let fixture = Fixture::new(&mock);
    let output = fixture.run(&with_mock(&[
        "--json",
        "agent",
        "run",
        "add notes",
        "--allow",
        "write",
    ]));
    let value = json(&output);
    assert_eq!(
        (
            value["ok"].clone(),
            value["type"].clone(),
            value["run"]["stopReason"].clone()
        ),
        (json!(true), json!("result"), json!("end_turn")),
        "{value}"
    );
    assert!(!fixture.project.path().join("notes.md").exists());
    let review = PathBuf::from(value["run"]["reviewDir"].as_str().unwrap());
    assert!(review.join("changes/notes.md").exists());
    assert!(review.join("changes.json").exists());
    assert!(std::fs::read_to_string(review.join("changes.patch"))
        .unwrap()
        .contains("+hi"));
    assert!(!review.join("workspace").exists());
    assert_eq!(value["run"]["changes"][0]["path"], "notes.md");
    assert_eq!(value["run"]["toolCalls"], 1);
    assert_eq!(value["run"]["credentialSource"], "none");
}

#[test]
fn apply_mode_changes_the_project() {
    let mock = MockProvider::script(vec![
        tool_call(
            "edit_file",
            r#"{"path":"main.tex","old":"Hello","new":"Hello again"}"#,
        ),
        text("Edited"),
    ]);
    let fixture = Fixture::new(&mock);
    let output = fixture.run(&with_mock(&[
        "--json", "agent", "run", "edit", "--allow", "write", "--apply",
    ]));
    let value = json(&output);
    assert_eq!(value["ok"], true, "{value}");
    assert!(
        std::fs::read_to_string(fixture.project.path().join("main.tex"))
            .unwrap()
            .contains("Hello again")
    );
    assert_eq!(value["run"]["mode"], "apply");
    assert_eq!(value["run"]["changes"][0]["kind"], "modified");
    assert!(value["run"]["reviewDir"].is_null());
    let leftovers: Vec<_> = std::fs::read_dir(fixture.project.path())
        .unwrap()
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(".agent-write-")
        })
        .collect();
    assert!(leftovers.is_empty());
}

#[test]
fn events_stream_as_json_lines_and_end_with_the_result() {
    let mock = MockProvider::script(vec![
        tool_call("read_file", r#"{"path":"main.tex"}"#),
        text("Read it"),
    ]);
    let fixture = Fixture::new(&mock);
    let output = fixture.run(&with_mock(&["--events", "agent", "run", "read the paper"]));
    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    assert!(
        lines
            .iter()
            .all(|line| serde_json::from_str::<Value>(line).is_ok()),
        "{stdout}"
    );
    assert!(lines
        .iter()
        .any(|line| line.contains(r#""event":"tool_call""#)));
    assert!(lines
        .iter()
        .any(|line| line.contains(r#""event":"tool_result""#)));
    assert!(lines
        .iter()
        .any(|line| line.contains(r#""event":"started""#)));
    let last: Value = serde_json::from_str(lines.last().unwrap()).unwrap();
    assert_eq!(last["type"], "result");
    assert_eq!(last["run"]["mode"], "read");
}

#[test]
fn ask_offers_no_write_tools_and_changes_nothing() {
    let mock = MockProvider::script(vec![text("It is a short article.")]);
    let fixture = Fixture::new(&mock);
    let output = fixture.run(&with_mock(&["--json", "ask", "what is this?"]));
    let value = json(&output);
    assert_eq!(value["ok"], true, "{value}");
    assert_eq!(value["command"], "ask");
    assert_eq!(value["run"]["text"], "It is a short article.");
    let tools = mock.tool_names(0);
    assert!(tools.contains(&"read_file".to_string()));
    for refused in [
        "write_file",
        "edit_file",
        "delete_file",
        "run_command",
        "compile",
    ] {
        assert!(!tools.contains(&refused.to_string()), "{refused}");
    }
    assert!(!fixture.project.path().join(".oleafly").exists());
}

#[test]
fn a_missing_provider_exits_4_with_a_hint() {
    let mock = MockProvider::script(Vec::new());
    let fixture = Fixture::new(&mock);
    std::fs::write(fixture.data.path().join("config.json"), "{}").unwrap();
    let output = fixture.run(&["--json", "ask", "q"]);
    assert_eq!(output.status.code(), Some(4), "{}", both_streams(&output));
    let value = json(&output);
    assert_eq!(value["error"]["code"], "agent.no_provider");
    assert!(value["error"]["hint"]
        .as_str()
        .unwrap()
        .contains("--provider"));
}

#[test]
fn a_missing_key_exits_6_and_names_the_variables() {
    let mock = MockProvider::script(Vec::new());
    let fixture = Fixture::new(&mock);
    let output = fixture.run(&[
        "--json",
        "ask",
        "q",
        "--provider",
        "openai",
        "--model",
        "gpt-6.1-sol",
    ]);
    assert_eq!(output.status.code(), Some(6), "{}", both_streams(&output));
    let value = json(&output);
    assert_eq!(value["error"]["code"], "agent.missing_key");
    assert!(value["error"]["hint"]
        .as_str()
        .unwrap()
        .contains("OPENAI_API_KEY"));
}

#[test]
fn a_run_timeout_exits_10_with_what_was_done() {
    let mock = MockProvider::script(vec![
        tool_call("read_file", r#"{"path":"main.tex"}"#),
        Step::Stall,
    ]);
    let fixture = Fixture::new(&mock);
    let output = fixture.run(&with_mock(&[
        "--json",
        "agent",
        "run",
        "read",
        "--timeout",
        "10",
    ]));
    assert_eq!(output.status.code(), Some(10), "{}", both_streams(&output));
    let value = json(&output);
    assert_eq!(value["run"]["stopReason"], "timeout");
    assert_eq!(value["run"]["toolCalls"], 1);
    assert!(value["warnings"].to_string().contains("agent.timeout"));
    assert_eq!(
        (
            value["ok"].clone(),
            value["error"]["kind"].clone(),
            value["error"]["code"].clone()
        ),
        (json!(false), json!("limit"), json!("agent.timeout"))
    );
}

#[test]
fn a_rejected_key_exits_6_and_is_never_printed() {
    let mock = MockProvider::script(vec![Step::Status {
        code: 401,
        body: r#"{"error":{"message":"Incorrect API key provided: sk-live-ABCDEF"}}"#.into(),
    }]);
    let fixture = Fixture::new(&mock);
    oleafly_secrets::SecretStore::at(fixture.data.path())
        .write(
            oleafly_secrets::SecretFile::Ai,
            &HashMap::from([("mock-keyed".to_string(), "sk-live-ABCDEF".to_string())]),
        )
        .unwrap();
    let output = fixture.run(&[
        "--json",
        "ask",
        "q",
        "--provider",
        "mock-keyed",
        "--model",
        "mock-model",
    ]);
    assert_eq!(output.status.code(), Some(6), "{}", both_streams(&output));
    assert_eq!(
        json(&output)["error"]["code"],
        "agent.provider_rejected_key"
    );
    assert!(!both_streams(&output).contains("sk-live-ABCDEF"));
    let human = fixture.run(&[
        "ask",
        "q",
        "--provider",
        "mock-keyed",
        "--model",
        "mock-model",
    ]);
    assert!(!both_streams(&human).contains("sk-live-ABCDEF"));
}

#[test]
fn the_step_limit_exits_10_and_names_the_limit() {
    let mock = MockProvider::script(vec![
        tool_call("read_file", r#"{"path":"main.tex"}"#),
        tool_call("read_file", r#"{"path":"main.tex"}"#),
    ]);
    let fixture = Fixture::new(&mock);
    let output = fixture.run(&with_mock(&[
        "--json",
        "agent",
        "run",
        "loop",
        "--max-steps",
        "1",
    ]));
    assert_eq!(output.status.code(), Some(10), "{}", both_streams(&output));
    let value = json(&output);
    assert_eq!(value["run"]["stopReason"], "step_limit");
    assert!(value["warnings"].to_string().contains("agent.step_limit"));
    assert_eq!(value["error"]["code"], "agent.step_limit");
}

#[test]
fn a_provider_error_mid_run_names_the_saved_review() {
    let mock = MockProvider::script(vec![
        tool_call("write_file", r#"{"path":"notes.md","content":"hi"}"#),
        Step::Status {
            code: 400,
            body: r#"{"error":{"message":"Bad request"}}"#.into(),
        },
    ]);
    let fixture = Fixture::new(&mock);
    let output = fixture.run(&with_mock(&[
        "--json",
        "agent",
        "run",
        "add notes",
        "--allow",
        "write",
    ]));
    assert_eq!(output.status.code(), Some(1), "{}", both_streams(&output));
    let value = json(&output);
    assert_eq!(value["error"]["code"], "agent.provider_error", "{value}");
    let details = &value["error"]["details"];
    assert_eq!(details["mode"], "review");
    assert_eq!(details["changes"][0]["path"], "notes.md");
    let review = PathBuf::from(details["reviewDir"].as_str().unwrap());
    assert!(review.join("changes/notes.md").exists());
}

#[test]
fn apply_mode_lists_the_files_a_command_changed() {
    let mock = MockProvider::script(vec![
        tool_call("run_command", r#"{"command":"echo made > made.txt"}"#),
        text("Done"),
    ]);
    let fixture = Fixture::new(&mock);
    let output = fixture.run(&with_mock(&[
        "--json",
        "agent",
        "run",
        "make a file",
        "--apply",
        "--allow",
        "write,commands",
    ]));
    let value = json(&output);
    assert_eq!(value["ok"], true, "{value}");
    assert!(fixture.project.path().join("made.txt").is_file());
    let changes = value["run"]["changes"].as_array().unwrap();
    assert!(
        changes
            .iter()
            .any(|change| change["path"] == "made.txt" && change["kind"] == "added"),
        "{value}"
    );
}

#[cfg(unix)]
#[test]
fn ctrl_c_exits_130_and_keeps_changes_made_so_far() {
    use std::io::{BufRead, BufReader};
    let mock = MockProvider::script(vec![
        tool_call("write_file", r#"{"path":"draft.md","content":"partial"}"#),
        Step::Stall,
    ]);
    let fixture = Fixture::new(&mock);
    let mut child = fixture
        .command(&with_mock(&[
            "--events", "agent", "run", "write", "--allow", "write",
        ]))
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let stdout = child.stdout.take().unwrap();
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    loop {
        line.clear();
        assert!(
            reader.read_line(&mut line).unwrap() > 0,
            "the run ended before its first tool result"
        );
        if line.contains(r#""event":"tool_result""#) {
            break;
        }
    }
    unsafe {
        libc::kill(child.id() as i32, libc::SIGINT);
    }
    let mut rest = String::new();
    std::io::Read::read_to_string(&mut reader, &mut rest).unwrap();
    let status = child.wait().unwrap();
    assert_eq!(status.code(), Some(130));
    let last: Value =
        serde_json::from_str(rest.lines().rfind(|line| !line.trim().is_empty()).unwrap()).unwrap();
    assert_eq!(last["run"]["stopReason"], "interrupted");
    assert_eq!(last["run"]["changes"][0]["path"], "draft.md");
}

#[test]
fn a_prompt_can_come_from_stdin() {
    let mock = MockProvider::script(vec![text("From stdin")]);
    let fixture = Fixture::new(&mock);
    let mut child = fixture
        .command(&with_mock(&["--json", "ask", "-"]))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"what does the paper say?")
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert_eq!(json(&output)["run"]["text"], "From stdin");
    let sent = mock.requests()[0].to_string();
    assert!(sent.contains("what does the paper say?"));
}

#[test]
fn usage_lands_in_the_spool_once() {
    let mock = MockProvider::script(vec![text("Counted")]);
    let fixture = Fixture::new(&mock);
    let output = fixture.run(&with_mock(&["--json", "ask", "count me"]));
    assert_eq!(json(&output)["ok"], true);
    let spool =
        std::fs::read_to_string(fixture.data.path().join("daemon/usage-spool.jsonl")).unwrap();
    let events: Vec<Value> = spool
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["source"], "cli-agent");
    assert_eq!(events[0]["status"], "completed");
    assert!(events[0]["projectPath"].as_str().is_some());
    assert!(events[0]["id"].as_str().unwrap().starts_with("cli-agent-"));
}

#[test]
fn apply_and_review_dir_together_are_a_usage_error() {
    let mock = MockProvider::script(Vec::new());
    let fixture = Fixture::new(&mock);
    let output = fixture.run(&[
        "--json",
        "agent",
        "run",
        "x",
        "--apply",
        "--review-dir",
        "r",
    ]);
    assert_eq!(output.status.code(), Some(2));
    assert_eq!(json(&output)["error"]["code"], "usage.invalid");
}

#[test]
fn a_saved_review_applies_and_a_conflict_exits_8() {
    let mock = MockProvider::script(vec![
        tool_call("write_file", r#"{"path":"added.tex","content":"new"}"#),
        tool_call(
            "edit_file",
            r#"{"path":"main.tex","old":"Hello","new":"Hi"}"#,
        ),
        text("Done"),
    ]);
    let fixture = Fixture::new(&mock);
    let run = json(&fixture.run(&with_mock(&[
        "--json", "agent", "run", "x", "--allow", "write",
    ])));
    let review = run["run"]["reviewDir"].as_str().unwrap().to_string();
    let dry = json(&fixture.run(&["--json", "agent", "apply", &review, "--dry-run"]));
    assert_eq!(dry["apply"]["dryRun"], true);
    assert!(!fixture.project.path().join("added.tex").exists());
    let applied = json(&fixture.run(&["--json", "agent", "apply", &review]));
    assert_eq!(
        (
            applied["type"].clone(),
            applied["ok"].clone(),
            applied["command"].clone(),
            applied["apply"]["dryRun"].clone()
        ),
        (
            json!("result"),
            json!(true),
            json!("agent apply"),
            json!(false)
        )
    );
    assert_eq!(
        std::fs::read_to_string(fixture.project.path().join("added.tex")).unwrap(),
        "new"
    );

    let mock = MockProvider::script(vec![
        tool_call("edit_file", r#"{"path":"main.tex","old":"Hi","new":"Hey"}"#),
        text("Done"),
    ]);
    let second = Fixture {
        project: fixture.project,
        data: fixture.data,
    };
    let config = json!({
        "ai_custom_providers": [{"id": "mock", "baseURL": mock.base_url(), "key_optional": true}],
        "ai_provider_models": {"mock": [{"id": "mock-model", "enabled": true}]},
    });
    std::fs::write(second.data.path().join("config.json"), config.to_string()).unwrap();
    let run = json(&second.run(&with_mock(&[
        "--json", "agent", "run", "y", "--allow", "write",
    ])));
    let review = run["run"]["reviewDir"].as_str().unwrap().to_string();
    std::fs::write(second.project.path().join("main.tex"), "changed meanwhile").unwrap();
    let output = second.run(&["--json", "agent", "apply", &review]);
    assert_eq!(output.status.code(), Some(8));
    assert_eq!(json(&output)["error"]["code"], "agent.apply_conflict");
}

#[test]
fn compile_builds_the_staged_copy_and_leaves_the_project_alone() {
    let mock = MockProvider::script(vec![tool_call("compile", "{}"), text("Built")]);
    let fixture = Fixture::new(&mock);
    let compiler = support::compiler_fixture(fixture.data.path(), false);
    let output = fixture
        .command(&with_mock(&[
            "--json", "agent", "run", "build", "--allow", "write",
        ]))
        .env("OLEAFLY_TECTONIC", &compiler)
        .output()
        .unwrap();
    let value = json(&output);
    assert_eq!(value["ok"], true, "{value}");
    let compiled = mock.requests()[1].to_string();
    assert!(compiled.contains(r#"\"ok\":true"#), "{compiled}");
    assert!(!fixture
        .project
        .path()
        .join(".oleafly")
        .join("build")
        .exists());
}

#[test]
fn a_review_copy_of_a_linked_folder_builds_with_the_apps_settings() {
    let mock = MockProvider::script(vec![tool_call("compile", "{}"), text("Built")]);
    let fixture = Fixture::new(&mock);
    std::fs::create_dir_all(fixture.project.path().join("notes")).unwrap();
    std::fs::write(
        fixture.project.path().join("notes/draft.tex"),
        "\\documentclass{article}\n\\begin{document}\nDraft\n\\end{document}\n",
    )
    .unwrap();
    let id = format!("linked-{}", "0".repeat(32));
    let state = fixture.data.path().join("linked").join(&id);
    std::fs::create_dir_all(&state).unwrap();
    let canonical = fixture.project.path().canonicalize().unwrap();
    std::fs::write(
        state.join("link.json"),
        json!({"version": 1, "id": id, "canonical_path": canonical}).to_string(),
    )
    .unwrap();
    std::fs::write(
        state.join("project.json"),
        r#"{"name":"Draft","main_doc":"notes/draft.tex","engine":"xetex"}"#,
    )
    .unwrap();
    let compiler = support::compiler_fixture(fixture.data.path(), false);
    let output = fixture
        .command(&with_mock(&[
            "--json", "agent", "run", "build", "--allow", "write",
        ]))
        .env("OLEAFLY_TECTONIC", &compiler)
        .output()
        .unwrap();
    let value = json(&output);
    assert_eq!(value["ok"], true, "{value}");
    let request = &mock.requests()[1];
    let answer = request["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|message| message["role"] == "tool")
        .map(|message| message["content"].to_string())
        .collect::<String>();
    assert!(answer.contains("draft.tex"), "{answer}");
}

#[test]
fn agent_commands_are_documented_in_help() {
    let help = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
        .args(["agent", "--help"])
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&help.stdout);
    assert!(text.contains("run") && text.contains("apply"));
    let ask = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
        .args(["ask", "--help"])
        .output()
        .unwrap();
    assert!(String::from_utf8_lossy(&ask.stdout).contains("--allow"));
}
