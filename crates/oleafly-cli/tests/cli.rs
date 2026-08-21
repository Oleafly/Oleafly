mod support;

use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Output, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};
use tempfile::TempDir;

fn run(arguments: &[&str], current_directory: Option<&std::path::Path>) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_oleaflyc"));
    command.args(arguments);
    if let Some(directory) = current_directory {
        command.current_dir(directory);
    }
    command.output().unwrap()
}

fn json(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).unwrap()
}

fn compiler_fixture(directory: &TempDir) -> PathBuf {
    support::compiler_fixture(directory.path(), false)
}

struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn wait_for_json(
    receiver: &Receiver<String>,
    timeout: Duration,
    predicate: impl Fn(&Value) -> bool,
) -> Value {
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let line = receiver
            .recv_timeout(remaining)
            .expect("watch output ended before the expected event");
        let value: Value = serde_json::from_str(&line).unwrap();
        if predicate(&value) {
            return value;
        }
    }
}

#[test]
fn initializes_the_current_directory_and_reports_json() {
    let directory = TempDir::new().unwrap();
    let output = run(
        &["--json", "init", "--name", "Research"],
        Some(directory.path()),
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value = json(&output);
    assert_eq!(value["ok"], true);
    assert_eq!(value["project"]["name"], "Research");
    assert!(directory.path().join("project.json").is_file());
    assert!(directory.path().join("main.tex").is_file());
}

#[test]
fn init_uses_the_selected_engine_document_type() {
    for (engine, document) in [
        ("tectonic", "main.tex"),
        ("latexmk", "main.tex"),
        ("typst", "main.typ"),
        ("markdown", "main.md"),
    ] {
        let directory = TempDir::new().unwrap();
        let output = run(
            &["--json", "init", "--engine", engine],
            Some(directory.path()),
        );
        assert!(
            output.status.success(),
            "{engine}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(json(&output)["project"]["main_document"], document);
        assert!(directory.path().join(document).is_file());
    }
}

#[test]
fn manages_an_arbitrary_project_directory() {
    let directory = TempDir::new().unwrap();
    let path = directory.path().to_str().unwrap();
    let initialized = run(
        &[
            "--project",
            path,
            "--json",
            "init",
            "--main",
            "paper.typ",
            "--engine",
            "typst",
        ],
        None,
    );
    assert!(initialized.status.success());
    let info = run(&["-C", path, "--json", "project", "info"], None);
    assert!(info.status.success());
    let value = json(&info);
    assert_eq!(value["project"]["main_document"], "paper.typ");
    assert_eq!(value["project"]["engine"], "typst");
}

#[test]
fn init_never_overwrites_an_existing_project() {
    let directory = TempDir::new().unwrap();
    let first = run(&["init"], Some(directory.path()));
    assert!(first.status.success());
    std::fs::write(directory.path().join("main.tex"), "preserve").unwrap();
    let second = run(&["--json", "init"], Some(directory.path()));
    assert_eq!(second.status.code(), Some(3));
    assert_eq!(json(&second)["error"]["kind"], "invalid_input");
    assert_eq!(
        std::fs::read_to_string(directory.path().join("main.tex")).unwrap(),
        "preserve"
    );
}

#[test]
fn clean_removes_only_generated_build_output() {
    let directory = TempDir::new().unwrap();
    assert!(run(&["init"], Some(directory.path())).status.success());
    let build = directory.path().join(".oleafly/build");
    std::fs::create_dir_all(&build).unwrap();
    std::fs::write(build.join("output.pdf"), "pdf").unwrap();
    std::fs::write(directory.path().join("notes.txt"), "keep").unwrap();
    let output = run(&["--json", "clean"], Some(directory.path()));
    assert!(output.status.success());
    assert_eq!(json(&output)["removed"], true);
    assert!(!build.exists());
    assert!(directory.path().join("notes.txt").is_file());
}

#[test]
fn uninitialized_directories_fail_with_a_structured_error() {
    let directory = TempDir::new().unwrap();
    let output = run(&["--json", "project", "info"], Some(directory.path()));
    assert_eq!(output.status.code(), Some(3));
    let value = json(&output);
    assert_eq!(value["ok"], false);
    assert_eq!(value["error"]["kind"], "not_initialized");
}

#[test]
fn doctor_and_build_report_a_missing_compiler_consistently() {
    let directory = TempDir::new().unwrap();
    assert!(
        run(&["init", "--engine", "latexmk"], Some(directory.path()))
            .status
            .success()
    );

    for command_name in ["doctor", "build"] {
        let mut command = Command::new(env!("CARGO_BIN_EXE_oleaflyc"));
        let output = command
            .args(["--json", command_name])
            .current_dir(directory.path())
            .env("PATH", "")
            .env("OLEAFLY_LATEXMK", directory.path().join("missing"))
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(4));
        let value = json(&output);
        assert_eq!(value["ok"], false);
        assert_eq!(value["command"], command_name);
    }
}

#[test]
fn doctor_explains_when_a_project_local_tool_override_is_refused() {
    let directory = TempDir::new().unwrap();
    assert!(
        run(&["init", "--engine", "latexmk"], Some(directory.path()))
            .status
            .success()
    );
    let compiler = compiler_fixture(&directory);
    let output = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
        .args(["--json", "doctor"])
        .current_dir(directory.path())
        .env("PATH", "")
        .env("OLEAFLY_LATEXMK", &compiler)
        .output()
        .unwrap();

    assert_eq!(output.status.code(), Some(4));
    let value = json(&output);
    let check = value["report"]["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|check| check["name"] == "compiler_latexmk")
        .unwrap();
    assert_eq!(check["status"], "fail");
    let message = check["message"].as_str().unwrap();
    assert!(message.contains("OLEAFLY_LATEXMK"));
    assert!(message.contains("refused"));
    assert!(message.contains(&compiler.display().to_string()));
}

#[test]
fn project_info_has_a_human_readable_contract() {
    let directory = TempDir::new().unwrap();
    assert!(run(&["init"], Some(directory.path())).status.success());
    let output = run(&["project", "info"], Some(directory.path()));
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("Main document: main.tex"));
    assert!(stdout.contains("Engine: tectonic (project.json: xetex)"));
}

#[test]
fn successful_builds_preserve_human_and_json_output_contracts() {
    let tools = TempDir::new().unwrap();
    let compiler = compiler_fixture(&tools);

    let human_project = TempDir::new().unwrap();
    assert!(run(&["init"], Some(human_project.path())).status.success());
    let human = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
        .arg("build")
        .current_dir(human_project.path())
        .env("OLEAFLY_TECTONIC", &compiler)
        .output()
        .unwrap();
    assert!(human.status.success());
    assert!(String::from_utf8_lossy(&human.stdout).contains("Built "));
    assert!(String::from_utf8_lossy(&human.stderr).contains("fixture-ok"));

    let json_project = TempDir::new().unwrap();
    assert!(run(&["init"], Some(json_project.path())).status.success());
    let machine = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
        .args(["--json", "build"])
        .current_dir(json_project.path())
        .env("OLEAFLY_TECTONIC", &compiler)
        .output()
        .unwrap();
    assert!(machine.status.success());
    assert!(machine.stderr.is_empty());
    let value = json(&machine);
    assert_eq!(value["ok"], true);
    assert_eq!(value["command"], "build");
    assert_eq!(value["build"]["engine"], "tectonic");
    assert!(value["build"]["log"]
        .as_str()
        .is_some_and(|log| log.contains("fixture-ok")));
    assert!(value["build"]["output_id"]
        .as_str()
        .is_some_and(|id| id.starts_with("pdf-sha256:")));
}

#[test]
fn watch_recovers_from_environment_errors_and_reloads_the_manifest() {
    let project = TempDir::new().unwrap();
    let tools = TempDir::new().unwrap();
    assert!(run(&["init", "--engine", "latexmk"], Some(project.path()))
        .status
        .success());
    let compiler = tools
        .path()
        .join(oleafly_cli::executable_name("fixture-success"));
    let child = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
        .args(["--json", "watch"])
        .current_dir(project.path())
        .env("PATH", "")
        .env("OLEAFLY_LATEXMK", &compiler)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut child = ChildGuard(child);
    let stdout = child.0.stdout.take().unwrap();
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if sender.send(line).is_err() {
                break;
            }
        }
    });

    wait_for_json(&receiver, Duration::from_secs(10), |value| {
        value["event"] == "build_error"
    });
    assert!(child.0.try_wait().unwrap().is_none());

    let built_compiler = compiler_fixture(&tools);
    assert_eq!(built_compiler, compiler.canonicalize().unwrap());
    std::fs::write(project.path().join("paper.tex"), "\\documentclass{article}").unwrap();
    let manifest_path = project.path().join("project.json");
    let mut manifest: Value =
        serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
    manifest["main_doc"] = "paper.tex".into();
    std::fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();

    let finished = wait_for_json(&receiver, Duration::from_secs(20), |value| {
        value["event"] == "build_finished"
            && value["ok"] == true
            && value["build"]["log"]
                .as_str()
                .is_some_and(|log| log.contains("paper.tex"))
    });
    assert_eq!(finished["build"]["engine"], "latexmk");
}
