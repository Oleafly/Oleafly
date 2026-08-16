use serde_json::Value;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
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

fn executable_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn compiler_fixture(directory: &TempDir) -> PathBuf {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/compiler.rs");
    let output = directory.path().join(executable_name("fixture-success"));
    let result = Command::new(std::env::var_os("RUSTC").unwrap_or_else(|| OsString::from("rustc")))
        .args(["--edition=2021", "-o"])
        .arg(&output)
        .arg(source)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    output.canonicalize().unwrap()
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
fn project_info_has_a_human_readable_contract() {
    let directory = TempDir::new().unwrap();
    assert!(run(&["init"], Some(directory.path())).status.success());
    let output = run(&["project", "info"], Some(directory.path()));
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("Main document: main.tex"));
    assert!(stdout.contains("Engine: tectonic"));
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
