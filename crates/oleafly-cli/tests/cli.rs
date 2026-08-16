use serde_json::Value;
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
