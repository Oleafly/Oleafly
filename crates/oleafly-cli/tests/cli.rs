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

const BUILD_FLAGS: [&str; 3] = ["--offline", "--fast", "--halt-on-error"];
const TYPST_IGNORED_FLAGS: [&str; 2] = ["--fast", "--halt-on-error"];

fn build_with_tools(
    project: &std::path::Path,
    data: &std::path::Path,
    tools: &[(&str, &std::path::Path)],
    arguments: &[&str],
) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_oleaflyc"));
    command
        .args(arguments)
        .current_dir(project)
        .env("PATH", "")
        .env("OLEAFLY_DATA_DIR", data);
    for (variable, path) in tools {
        command.env(variable, path);
    }
    command.output().unwrap()
}

#[test]
fn build_notes_each_flag_the_engine_ignores_and_keeps_the_exit_code() {
    let tools = TempDir::new().unwrap();
    let compiler = compiler_fixture(&tools);
    let data = TempDir::new().unwrap();
    for (engine, variables, ignored) in [
        ("tectonic", &["OLEAFLY_TECTONIC"][..], &[][..]),
        ("latexmk", &["OLEAFLY_LATEXMK"][..], &["--fast"][..]),
        ("typst", &["OLEAFLY_TYPST"][..], &TYPST_IGNORED_FLAGS[..]),
        (
            "markdown",
            &["OLEAFLY_PANDOC", "OLEAFLY_TECTONIC"][..],
            &BUILD_FLAGS[..],
        ),
    ] {
        let project = TempDir::new().unwrap();
        assert!(run(&["init", "--engine", engine], Some(project.path()))
            .status
            .success());
        let environment: Vec<_> = variables
            .iter()
            .map(|variable| (*variable, compiler.as_path()))
            .collect();
        let plain = build_with_tools(project.path(), data.path(), &environment, &["build"]);
        let mut flagged_arguments = vec!["build"];
        flagged_arguments.extend(BUILD_FLAGS);
        let flagged = build_with_tools(
            project.path(),
            data.path(),
            &environment,
            &flagged_arguments,
        );
        assert_eq!(flagged.status.code(), plain.status.code(), "{engine}");
        let plain_stderr = String::from_utf8_lossy(&plain.stderr);
        assert!(
            !plain_stderr.contains("is ignored for"),
            "{engine}: {plain_stderr}"
        );
        let stderr = String::from_utf8_lossy(&flagged.stderr);
        for flag in BUILD_FLAGS {
            let note = format!("note: {flag} is ignored for {engine} projects");
            assert_eq!(
                stderr.matches(&note).count(),
                usize::from(ignored.contains(&flag)),
                "{engine} {flag}: {stderr}"
            );
        }
    }
}

#[test]
fn json_builds_keep_stderr_empty_when_a_flag_is_ignored() {
    let tools = TempDir::new().unwrap();
    let compiler = compiler_fixture(&tools);
    let data = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    assert!(run(&["init", "--engine", "latexmk"], Some(project.path()))
        .status
        .success());
    let output = build_with_tools(
        project.path(),
        data.path(),
        &[("OLEAFLY_LATEXMK", compiler.as_path())],
        &["--json", "build", "--fast"],
    );
    assert!(output.status.success());
    assert!(
        output.stderr.is_empty(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(json(&output)["build"]["engine"], "latexmk");
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
        .env("OLEAFLY_WATCH_POLL", "1")
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

#[test]
fn completions_and_the_manual_are_generated_from_the_parser() {
    for shell in ["bash", "zsh", "fish", "powershell", "elvish"] {
        let output = run(&["completions", shell], None);
        assert!(
            output.status.success(),
            "completions {shell} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let script = String::from_utf8(output.stdout).unwrap();
        assert!(
            script.contains("oleafly"),
            "the {shell} completion script must name the command: {script:.120}"
        );
        for command in ["init", "build", "watch", "clean", "doctor", "project"] {
            assert!(
                script.contains(command),
                "the {shell} completion script is missing `{command}`"
            );
        }
    }

    let output = run(&["man"], None);
    assert!(output.status.success());
    let page = String::from_utf8(output.stdout).unwrap();
    assert!(page.starts_with(".ie"), "expected roff output: {page:.60}");
    assert!(page.contains(".SH NAME"), "the manual needs a NAME section");
    assert!(page.contains("oleafly"), "the manual must name the command");
}

#[test]
fn help_states_that_the_interface_is_unstable_before_1_0() {
    let output = run(&["--help"], None);
    assert!(output.status.success());
    let help = String::from_utf8(output.stdout).unwrap();
    assert!(
        help.contains("0.x") && help.contains("1.0.0"),
        "--help must say the interface is unstable before 1.0: {help}"
    );
}

#[test]
fn the_public_name_is_oleafly_everywhere_a_user_can_see_it() {
    for arguments in [vec!["--help"], vec!["build", "--help"], vec!["--version"]] {
        let output = run(&arguments, None);
        let text = String::from_utf8(output.stdout).unwrap();
        assert!(
            text.contains("oleafly") && !text.contains("oleaflyc"),
            "`{}` shows the build name instead of the public one:\n{text}",
            arguments.join(" ")
        );
    }

    let manual = String::from_utf8(run(&["man"], None).stdout).unwrap();
    assert!(
        manual.contains(".TH oleafly"),
        "the manual names the wrong command"
    );
    assert!(
        !manual.contains("oleaflyc"),
        "the manual leaks the build name"
    );

    for shell in ["bash", "zsh", "fish"] {
        let script = String::from_utf8(run(&["completions", shell], None).stdout).unwrap();
        assert!(
            !script.contains("oleaflyc"),
            "the {shell} completion script leaks the build name"
        );
    }
}

fn write_tree(root: &std::path::Path, files: &[(&str, &str)]) {
    for (path, content) in files {
        let file = root.join(path);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, content).unwrap();
    }
}

const ARTICLE: &str = "\\documentclass{article}\n\\begin{document}\nText.\n\\end{document}\n";

fn mentions(log: &str, path: &str) -> bool {
    log.contains(path) || log.contains(&path.replace('/', "\\"))
}

#[test]
fn build_without_a_project_json_uses_the_detected_main_document() {
    let tools = TempDir::new().unwrap();
    let compiler = compiler_fixture(&tools);
    let data = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    write_tree(
        project.path(),
        &[
            ("README.md", "# Repository\n"),
            (
                "paper/main.tex",
                "\\documentclass{article}\n\\begin{document}\n\\input{sections/intro}\n\\end{document}\n",
            ),
            ("paper/sections/intro.tex", "Intro.\n"),
        ],
    );
    let machine = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
        .args(["--json", "build"])
        .current_dir(project.path())
        .env("OLEAFLY_TECTONIC", &compiler)
        .env("OLEAFLY_DATA_DIR", data.path())
        .output()
        .unwrap();
    assert!(
        machine.status.success(),
        "{}",
        String::from_utf8_lossy(&machine.stderr)
    );
    assert!(machine.stderr.is_empty());
    let value = json(&machine);
    assert!(value["build"]["log"]
        .as_str()
        .is_some_and(|log| mentions(log, "paper/main.tex")));
    assert!(!project.path().join("project.json").exists());

    let human = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
        .arg("build")
        .current_dir(project.path())
        .env("OLEAFLY_TECTONIC", &compiler)
        .env("OLEAFLY_DATA_DIR", data.path())
        .output()
        .unwrap();
    assert!(human.status.success());
    assert!(String::from_utf8_lossy(&human.stderr)
        .contains("No Oleafly project.json here, so building paper/main.tex"));

    let ambiguous = TempDir::new().unwrap();
    write_tree(
        ambiguous.path(),
        &[("paper.tex", ARTICLE), ("response.tex", ARTICLE)],
    );
    let output = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
        .args(["--json", "build"])
        .current_dir(ambiguous.path())
        .env("OLEAFLY_TECTONIC", &compiler)
        .env("OLEAFLY_DATA_DIR", data.path())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(3));
    let value = json(&output);
    assert_eq!(value["error"]["kind"], "invalid_input");
    assert!(value["error"]["message"]
        .as_str()
        .is_some_and(|message| message.contains("paper.tex, response.tex")));
    assert!(!ambiguous.path().join("project.json").exists());
    assert!(!ambiguous.path().join(".oleafly").exists());
}

#[test]
fn build_follows_the_main_document_the_desktop_app_chose() {
    let tools = TempDir::new().unwrap();
    let compiler = compiler_fixture(&tools);
    let data = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    write_tree(
        project.path(),
        &[("paper.tex", ARTICLE), ("notes/draft.tex", ARTICLE)],
    );
    let id = format!("linked-{}", "0".repeat(32));
    let canonical = project.path().canonicalize().unwrap();
    write_tree(
        &data.path().join("linked").join(&id),
        &[
            (
                "link.json",
                &serde_json::json!({
                    "version": 1,
                    "id": id,
                    "canonical_path": canonical,
                })
                .to_string(),
            ),
            (
                "project.json",
                r#"{"name":"Draft","main_doc":"notes/draft.tex","engine":"xetex"}"#,
            ),
        ],
    );
    let output = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
        .args(["--json", "build"])
        .current_dir(project.path())
        .env("OLEAFLY_TECTONIC", &compiler)
        .env("OLEAFLY_DATA_DIR", data.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(json(&output)["build"]["log"]
        .as_str()
        .is_some_and(|log| mentions(log, "notes/draft.tex")));
}

#[test]
fn a_foreign_project_json_is_left_alone_and_the_paper_still_builds() {
    let tools = TempDir::new().unwrap();
    let compiler = compiler_fixture(&tools);
    let data = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    let foreign = r#"{"name":"site","targets":{"build":{"executor":"nx:run-commands"}}}"#;
    write_tree(
        project.path(),
        &[("project.json", foreign), ("docs/paper/main.tex", ARTICLE)],
    );
    let output = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
        .args(["--json", "build"])
        .current_dir(project.path())
        .env("OLEAFLY_TECTONIC", &compiler)
        .env("OLEAFLY_DATA_DIR", data.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        std::fs::read_to_string(project.path().join("project.json")).unwrap(),
        foreign
    );
    let info = run(&["--json", "project", "info"], Some(project.path()));
    assert_eq!(info.status.code(), Some(3));
    assert_eq!(json(&info)["error"]["kind"], "not_initialized");
}

#[test]
fn latexmk_builds_a_nested_main_from_its_own_folder() {
    let tools = TempDir::new().unwrap();
    let compiler = compiler_fixture(&tools);
    let project = TempDir::new().unwrap();
    write_tree(
        project.path(),
        &[
            (
                "paper/main.tex",
                "\\documentclass{article}\n\\begin{document}\n\\input{sections/intro}\n\\end{document}\n",
            ),
            ("paper/sections/intro.tex", "Intro.\n"),
        ],
    );
    let init = run(
        &["--json", "init", "--engine", "latexmk"],
        Some(project.path()),
    );
    assert!(init.status.success());
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(project.path().join("project.json")).unwrap())
            .unwrap();
    assert_eq!(manifest["main_doc"], "paper/main.tex");
    assert_eq!(manifest["compile_dir"], "paper");
    let output = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
        .args(["--json", "build"])
        .current_dir(project.path())
        .env("PATH", "")
        .env("OLEAFLY_LATEXMK", &compiler)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value = json(&output);
    assert!(value["build"]["log"]
        .as_str()
        .is_some_and(|log| log.contains("fixture-ok:./main.tex")));
    assert!(project
        .path()
        .join(".oleafly/build/_oleafly_entry.pdf")
        .is_file());
    assert!(!project.path().join("paper/.oleafly").exists());

    let mut moved = manifest.clone();
    moved["main_doc"] = "main.tex".into();
    std::fs::write(project.path().join("project.json"), moved.to_string()).unwrap();
    std::fs::write(project.path().join("main.tex"), ARTICLE).unwrap();
    let stale = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
        .args(["--json", "build"])
        .current_dir(project.path())
        .env("PATH", "")
        .env("OLEAFLY_LATEXMK", &compiler)
        .output()
        .unwrap();
    assert_eq!(stale.status.code(), Some(3));
    let value = json(&stale);
    assert_eq!(value["error"]["kind"], "invalid_manifest");
    assert!(value["error"]["message"]
        .as_str()
        .is_some_and(|message| message.contains("compile_dir `paper`")));
}

#[test]
fn clean_and_doctor_accept_a_folder_that_build_detected() {
    let tools = TempDir::new().unwrap();
    let compiler = compiler_fixture(&tools);
    let data = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    write_tree(
        project.path(),
        &[("README.md", "# Repository\n"), ("paper.tex", ARTICLE)],
    );
    let oleaflyc = |arguments: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
            .args(arguments)
            .current_dir(project.path())
            .env("OLEAFLY_TECTONIC", &compiler)
            .env("OLEAFLY_DATA_DIR", data.path())
            .output()
            .unwrap()
    };
    let build = oleaflyc(&["--json", "build"]);
    assert!(
        build.status.success(),
        "{}",
        String::from_utf8_lossy(&build.stderr)
    );
    let output = project.path().join(".oleafly/build");
    assert!(output.is_dir());

    let doctor = oleaflyc(&["--json", "doctor"]);
    assert!(
        doctor.status.success(),
        "{}",
        String::from_utf8_lossy(&doctor.stdout)
    );
    let report = json(&doctor);
    let check = |name: &str| {
        report["report"]["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|check| check["name"] == name)
            .unwrap_or_else(|| panic!("no {name} check in {report}"))
            .clone()
    };
    assert_eq!(check("manifest")["status"], "warning");
    assert!(check("manifest")["message"]
        .as_str()
        .is_some_and(|message| message.contains("paper.tex")));
    assert_eq!(check("main_document")["status"], "pass");

    let clean = oleaflyc(&["--json", "clean"]);
    assert!(
        clean.status.success(),
        "{}",
        String::from_utf8_lossy(&clean.stdout)
    );
    let value = json(&clean);
    assert_eq!(value["removed"], true);
    assert!(value["build_directory"]
        .as_str()
        .is_some_and(|path| mentions(path, ".oleafly/build")));
    assert!(!output.exists());
    assert!(!project.path().join("project.json").exists());

    let again = oleaflyc(&["clean"]);
    assert!(again.status.success());
    assert!(String::from_utf8_lossy(&again.stdout).contains("already clean"));
}

#[cfg(unix)]
fn recording_app(directory: &std::path::Path) -> (PathBuf, PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let app = directory.join("recording app");
    let record = directory.join("launched.txt");
    std::fs::write(
        &app,
        format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}.partial'\nmv '{}.partial' '{}'\n",
            record.display(),
            record.display(),
            record.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&app, std::fs::Permissions::from_mode(0o755)).unwrap();
    (app, record)
}

#[cfg(unix)]
fn launched(record: &std::path::Path) -> Vec<String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !record.exists() {
        assert!(Instant::now() < deadline, "the app was never launched");
        std::thread::sleep(Duration::from_millis(20));
    }
    std::fs::read_to_string(record)
        .unwrap()
        .lines()
        .map(str::to_string)
        .collect()
}

#[cfg(unix)]
#[test]
fn a_bare_dot_hands_the_current_folder_to_the_app() {
    let tools = TempDir::new().unwrap();
    let (app, record) = recording_app(tools.path());
    let root = TempDir::new().unwrap();
    let thesis = root.path().join("my thesis").join("論文");
    std::fs::create_dir_all(&thesis).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
        .arg(".")
        .current_dir(&thesis)
        .env("OLEAFLY_APP", &app)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stdout.is_empty(), "a successful open prints nothing");
    let canonical = thesis.canonicalize().unwrap();
    assert_eq!(
        launched(&record),
        vec!["--open-folder".to_string(), canonical.display().to_string()]
    );
}

#[cfg(unix)]
#[test]
fn open_without_a_path_opens_the_current_folder_and_reports_json() {
    let tools = TempDir::new().unwrap();
    let (app, record) = recording_app(tools.path());
    let root = TempDir::new().unwrap();
    std::fs::create_dir(root.path().join("build")).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
        .args(["--json", "open"])
        .current_dir(root.path().join("build"))
        .env("OLEAFLY_APP", &app)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let canonical = root.path().join("build").canonicalize().unwrap();
    let value = json(&output);
    assert_eq!(value["ok"], true);
    assert_eq!(value["command"], "open");
    assert_eq!(value["folder"], canonical.display().to_string());
    assert_eq!(launched(&record)[1], canonical.display().to_string());
}

#[cfg(unix)]
#[test]
fn a_folder_named_like_a_command_opens_through_open_or_a_path() {
    let tools = TempDir::new().unwrap();
    let (app, record) = recording_app(tools.path());
    let root = TempDir::new().unwrap();
    std::fs::create_dir(root.path().join("build")).unwrap();
    let canonical = root.path().join("build").canonicalize().unwrap();
    for arguments in [vec!["open", "build"], vec!["./build"]] {
        let _ = std::fs::remove_file(&record);
        let output = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
            .args(&arguments)
            .current_dir(root.path())
            .env("OLEAFLY_APP", &app)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{arguments:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(launched(&record)[1], canonical.display().to_string());
    }
}

#[test]
fn a_bare_folder_name_is_still_a_command_error_with_a_tip() {
    let root = TempDir::new().unwrap();
    std::fs::create_dir(root.path().join("thesis")).unwrap();
    let output = run(&["thesis"], Some(root.path()));
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("unrecognized subcommand"), "{stderr}");
    assert!(stderr.contains("oleafly ./thesis"), "{stderr}");

    let output = run(&["nothing-here"], Some(root.path()));
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(!stderr.contains("oleafly ./"), "{stderr}");
}

#[test]
fn open_refuses_missing_folders_files_and_a_missing_app() {
    let root = TempDir::new().unwrap();
    std::fs::write(root.path().join("paper.tex"), ARTICLE).unwrap();

    let missing = run(&["open", "nowhere"], Some(root.path()));
    assert_eq!(missing.status.code(), Some(3));
    assert!(String::from_utf8_lossy(&missing.stderr).contains("nowhere"));

    let file = run(&["--json", "open", "paper.tex"], Some(root.path()));
    assert_eq!(file.status.code(), Some(3));
    let value = json(&file);
    assert_eq!(value["ok"], false);
    assert_eq!(value["command"], "open");
    assert_eq!(value["error"]["kind"], "invalid_input");

    let app = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
        .arg(".")
        .current_dir(root.path())
        .env("OLEAFLY_APP", root.path().join("Missing.app"))
        .output()
        .unwrap();
    assert_eq!(app.status.code(), Some(4));
    assert!(String::from_utf8_lossy(&app.stderr).contains("OLEAFLY_APP"));

    let itself = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
        .arg(".")
        .current_dir(root.path())
        .env("OLEAFLY_APP", env!("CARGO_BIN_EXE_oleaflyc"))
        .output()
        .unwrap();
    assert_eq!(itself.status.code(), Some(4));
    let stderr = String::from_utf8_lossy(&itself.stderr);
    assert!(stderr.contains("that's this command"), "{stderr}");
}

fn typst_fixture(directory: &std::path::Path, version: &str) -> PathBuf {
    std::fs::create_dir_all(directory).unwrap();
    let binary = support::rust_fixture(directory, "typst.rs", "typst", None);
    std::fs::write(directory.join("fixture-typst-version"), version).unwrap();
    binary
}

fn place_typst(fixture: &std::path::Path, directory: &std::path::Path, version: &str) -> PathBuf {
    std::fs::create_dir_all(directory).unwrap();
    let binary = directory.join(oleafly_cli::executable_name("typst"));
    std::fs::copy(fixture, &binary).unwrap();
    std::fs::write(directory.join("fixture-typst-version"), version).unwrap();
    binary.canonicalize().unwrap()
}

fn install_typst(
    fixture: &std::path::Path,
    data: &std::path::Path,
    version: &str,
) -> Option<PathBuf> {
    use oleafly_core::typst_toolchain::{
        host_target, typst_install_dir, ToolchainVersion, TypstToolchainCatalog,
        INSTALLED_CACHE_FILE,
    };
    let target = host_target()?;
    let directory = typst_install_dir(data, &ToolchainVersion::parse(version).unwrap());
    let binary = place_typst(fixture, &directory, version);
    let artifact = TypstToolchainCatalog::embedded()
        .typst_artifact(version, target)
        .unwrap();
    let metadata = std::fs::metadata(&binary).unwrap();
    let modified = metadata
        .modified()
        .unwrap()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    std::fs::write(
        directory.join(INSTALLED_CACHE_FILE),
        serde_json::json!({
            "binary": binary.file_name().unwrap().to_str().unwrap(),
            "binarySha256": artifact.binary_sha256,
            "size": metadata.len(),
            "modifiedSecs": modified.as_secs(),
            "modifiedNanos": modified.subsec_nanos()
        })
        .to_string(),
    )
    .unwrap();
    Some(binary)
}

fn typst_project(pin: Option<&str>) -> TempDir {
    let project = TempDir::new().unwrap();
    assert!(run(&["init", "--engine", "typst"], Some(project.path()))
        .status
        .success());
    if let Some(pin) = pin {
        let path = project.path().join("project.json");
        let mut manifest: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        manifest["typst"] = serde_json::json!({ "version": pin });
        std::fs::write(&path, manifest.to_string()).unwrap();
    }
    project
}

fn oleafly_typst(
    project: &std::path::Path,
    data: &std::path::Path,
    path_directories: &[&std::path::Path],
    typst_override: Option<&std::path::Path>,
    arguments: &[&str],
) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_oleaflyc"));
    command
        .args(arguments)
        .current_dir(project)
        .env("OLEAFLY_DATA_DIR", data)
        .env("PATH", std::env::join_paths(path_directories).unwrap())
        .env_remove("OLEAFLY_TYPST");
    for variable in INHERITED_VARIABLES {
        command.env_remove(variable);
    }
    if let Some(path) = typst_override {
        command.env("OLEAFLY_TYPST", path);
    }
    command.output().unwrap()
}

const INHERITED_VARIABLES: [&str; 13] = [
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "ALL_PROXY",
    "all_proxy",
    "NO_PROXY",
    "no_proxy",
    "SOURCE_DATE_EPOCH",
    "TYPST_PACKAGE_PATH",
    "TYPST_PACKAGE_CACHE_PATH",
    "GIT_DIR",
    "GIT_WORK_TREE",
];

fn build_log(output: &Output) -> String {
    json(output)["build"]["log"]
        .as_str()
        .unwrap_or_default()
        .to_string()
}

fn fixture_calls(binary: &std::path::Path) -> Vec<String> {
    std::fs::read_to_string(binary.with_file_name("fixture-typst-calls"))
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .collect()
}

#[test]
fn a_pinned_typst_project_builds_with_the_installed_version() {
    let tools = TempDir::new().unwrap();
    let fixture = typst_fixture(tools.path(), "0.15.1");
    let data = TempDir::new().unwrap();
    let Some(installed) = install_typst(&fixture, data.path(), "0.13.1") else {
        return;
    };
    let decoy = place_typst(&fixture, &tools.path().join("decoy"), "0.14.2");
    let project = typst_project(Some("0.13.1"));
    let output = oleafly_typst(
        project.path(),
        data.path(),
        &[decoy.parent().unwrap()],
        None,
        &["--json", "build"],
    );
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let log = build_log(&output);
    assert!(log.contains("typst-fixture-ok:0.13.1:"), "{log}");
    assert!(log.contains("--color=never compile "), "{log}");
    assert!(log.contains(" --diagnostic-format human"), "{log}");
    assert_eq!(fixture_calls(&installed).len(), 1);
    assert!(project
        .path()
        .join(".oleafly/build/_oleafly_entry.pdf")
        .is_file());
}

#[test]
fn a_missing_typst_pin_stops_the_build_with_an_install_hint() {
    let tools = TempDir::new().unwrap();
    let fixture = typst_fixture(tools.path(), "0.14.2");
    let data = TempDir::new().unwrap();
    let project = typst_project(Some("0.12.0"));

    let machine = oleafly_typst(
        project.path(),
        data.path(),
        &[tools.path()],
        None,
        &["--json", "build"],
    );
    assert_eq!(machine.status.code(), Some(4));
    let value = json(&machine);
    assert_eq!(value["ok"], false);
    assert_eq!(value["error"]["kind"], "missing_tool");
    let message = value["error"]["message"].as_str().unwrap();
    assert!(message.contains("Typst 0.12.0"), "{message}");
    assert!(message.contains("Settings > Engines > Typst"), "{message}");

    let human = oleafly_typst(
        project.path(),
        data.path(),
        &[tools.path()],
        None,
        &["build"],
    );
    assert_eq!(human.status.code(), Some(4));
    let stderr = String::from_utf8_lossy(&human.stderr);
    assert!(stderr.starts_with("error: "), "{stderr}");
    assert!(stderr.contains("Typst 0.12.0"), "{stderr}");
    assert!(stderr.contains("Settings > Engines > Typst"), "{stderr}");

    assert!(fixture_calls(&fixture)
        .iter()
        .all(|call| call == "--version"));
    assert!(!project
        .path()
        .join(".oleafly/build/_oleafly_entry.pdf")
        .exists());

    let unknown = typst_project(Some("0.99.0"));
    let output = oleafly_typst(
        unknown.path(),
        data.path(),
        &[tools.path()],
        None,
        &["--json", "build"],
    );
    assert_eq!(output.status.code(), Some(4));
    let message = json(&output)["error"]["message"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(message.contains("Typst 0.99.0"), "{message}");
    assert!(!message.contains("Settings > Engines > Typst"), "{message}");
}

#[test]
fn a_typst_on_path_with_the_pinned_version_satisfies_the_pin() {
    let tools = TempDir::new().unwrap();
    let fixture = typst_fixture(&tools.path().join("compiled"), "0.15.0");
    let older = place_typst(&fixture, &tools.path().join("older"), "0.13.1");
    let pinned = place_typst(&fixture, &tools.path().join("pinned"), "0.14.2");
    let data = TempDir::new().unwrap();
    let project = typst_project(Some("0.14.2"));
    let output = oleafly_typst(
        project.path(),
        data.path(),
        &[older.parent().unwrap(), pinned.parent().unwrap()],
        None,
        &["--json", "build"],
    );
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(build_log(&output).contains("typst-fixture-ok:0.14.2:"));
    assert_eq!(fixture_calls(&older), ["--version"]);
    assert_eq!(fixture_calls(&pinned).len(), 2);
}

#[test]
fn the_typst_override_must_match_a_pin_but_not_an_unpinned_project() {
    let tools = TempDir::new().unwrap();
    let fixture = typst_fixture(&tools.path().join("compiled"), "0.15.0");
    let other = place_typst(&fixture, &tools.path().join("other"), "0.15.0");
    let matching = place_typst(&fixture, &tools.path().join("matching"), "0.14.2");
    let data = TempDir::new().unwrap();

    let pinned = typst_project(Some("0.14.2"));
    let refused = oleafly_typst(
        pinned.path(),
        data.path(),
        &[matching.parent().unwrap()],
        Some(&other),
        &["--json", "build"],
    );
    assert_eq!(refused.status.code(), Some(4));
    let message = json(&refused)["error"]["message"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(message.contains("OLEAFLY_TYPST"), "{message}");
    assert!(message.contains("0.15.0"), "{message}");
    assert!(message.contains("0.14.2"), "{message}");

    let accepted = oleafly_typst(
        pinned.path(),
        data.path(),
        &[],
        Some(&matching),
        &["--json", "build"],
    );
    assert!(accepted.status.success());
    assert!(build_log(&accepted).contains("typst-fixture-ok:0.14.2:"));

    let unpinned = typst_project(None);
    let before = fixture_calls(&other).len();
    let output = oleafly_typst(
        unpinned.path(),
        data.path(),
        &[],
        Some(&other),
        &["--json", "build"],
    );
    assert!(output.status.success());
    let log = build_log(&output);
    assert!(log.contains("typst-fixture-ok:0.15.0:"), "{log}");
    let calls = fixture_calls(&other);
    assert_eq!(calls.len(), before + 2, "{calls:?}");
    assert_eq!(calls[before], "--version");
    let call = calls.last().unwrap();
    assert!(call.starts_with("--color=never compile "), "{call}");
    assert!(call.contains(" --root "), "{call}");
    assert!(call.contains(" --diagnostic-format human"), "{call}");
    let shared = data.path().join("typst");
    assert!(
        call.contains(&format!(
            " --package-path {} --package-cache-path {}",
            shared.join("packages").display(),
            shared.join("packages-cache").display()
        )),
        "{call}"
    );
}

fn doctor_check(report: &Value, name: &str) -> Value {
    report["report"]["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|check| check["name"] == name)
        .unwrap_or_else(|| panic!("no {name} check in {report}"))
        .clone()
}

#[test]
fn doctor_reports_the_pin_and_every_typst_it_can_see() {
    let tools = TempDir::new().unwrap();
    let fixture = typst_fixture(&tools.path().join("compiled"), "0.15.0");
    let on_path = place_typst(&fixture, &tools.path().join("path"), "0.14.2");
    let data = TempDir::new().unwrap();
    let Some(installed) = install_typst(&fixture, data.path(), "0.13.1") else {
        return;
    };
    let project = typst_project(Some("0.13.1"));

    let machine = oleafly_typst(
        project.path(),
        data.path(),
        &[on_path.parent().unwrap()],
        None,
        &["--json", "doctor"],
    );
    assert!(
        machine.status.success(),
        "{}",
        String::from_utf8_lossy(&machine.stdout)
    );
    let report = json(&machine);
    assert_eq!(report["typst"]["pinned"], "0.13.1");
    let found = report["typst"]["found"].as_array().unwrap();
    let entry = |source: &str, version: &str| {
        found
            .iter()
            .find(|entry| entry["source"] == source && entry["version"] == version)
            .unwrap_or_else(|| panic!("no {source} {version} in {found:?}"))
            .clone()
    };
    assert_eq!(
        entry("downloaded", "0.13.1")["path"],
        installed.to_str().unwrap()
    );
    assert_eq!(entry("system", "0.14.2")["path"], on_path.to_str().unwrap());
    let compiler = doctor_check(&report, "compiler_typst");
    assert_eq!(compiler["status"], "pass");
    let message = compiler["message"].as_str().unwrap();
    assert!(message.contains(installed.to_str().unwrap()), "{message}");
    assert!(message.contains("0.13.1"), "{message}");
    assert!(message.contains("downloaded"), "{message}");
    let pin = doctor_check(&report, "typst_version");
    assert_eq!(pin["status"], "pass");
    assert!(pin["message"].as_str().unwrap().contains("0.13.1"));

    let human = oleafly_typst(
        project.path(),
        data.path(),
        &[on_path.parent().unwrap()],
        None,
        &["doctor"],
    );
    assert!(human.status.success());
    let stdout = String::from_utf8_lossy(&human.stdout);
    assert!(stdout.contains("PASS typst_version: "), "{stdout}");
    assert!(stdout.contains("Typst found:"), "{stdout}");
    let line = |version: &str, source: &str, path: &PathBuf| {
        stdout.lines().any(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            fields.len() >= 3
                && fields[0] == version
                && fields[1] == source
                && line.contains(path.to_str().unwrap())
        })
    };
    assert!(line("0.13.1", "downloaded", &installed), "{stdout}");
    assert!(line("0.14.2", "PATH", &on_path), "{stdout}");

    let missing = typst_project(Some("0.12.0"));
    let output = oleafly_typst(
        missing.path(),
        data.path(),
        &[on_path.parent().unwrap()],
        None,
        &["--json", "doctor"],
    );
    assert_eq!(output.status.code(), Some(4));
    let report = json(&output);
    assert_eq!(report["ok"], false);
    assert_eq!(report["typst"]["pinned"], "0.12.0");
    let compiler = doctor_check(&report, "compiler_typst");
    assert_eq!(compiler["status"], "fail");
    assert!(compiler["message"]
        .as_str()
        .unwrap()
        .contains("Settings > Engines > Typst"));
    assert_eq!(doctor_check(&report, "typst_version")["status"], "fail");

    let unpinned = typst_project(None);
    let output = oleafly_typst(
        unpinned.path(),
        data.path(),
        &[on_path.parent().unwrap()],
        None,
        &["--json", "doctor"],
    );
    let report = json(&output);
    assert_eq!(report["typst"]["pinned"], Value::Null);
    assert_eq!(doctor_check(&report, "typst_version")["status"], "pass");
}

#[test]
fn doctor_leaves_typst_out_of_other_engines() {
    let data = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    assert!(run(&["init"], Some(project.path())).status.success());
    let output = oleafly_typst(
        project.path(),
        data.path(),
        &[],
        None,
        &["--json", "doctor"],
    );
    let report = json(&output);
    assert!(report.get("typst").is_none());
    assert!(report["report"]["checks"]
        .as_array()
        .unwrap()
        .iter()
        .all(|check| check["name"] != "typst_version"));
}

fn set_typst(project: &std::path::Path, typst: Value) {
    let path = project.join("project.json");
    let mut manifest: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    manifest["typst"] = typst;
    std::fs::write(&path, manifest.to_string()).unwrap();
}

fn fixture_environment(binary: &std::path::Path) -> std::collections::BTreeMap<String, String> {
    std::fs::read_to_string(binary.with_file_name("fixture-typst-env"))
        .unwrap_or_default()
        .lines()
        .filter_map(|line| line.split_once('='))
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect()
}

fn last_compile(binary: &std::path::Path) -> String {
    fixture_calls(binary)
        .into_iter()
        .rev()
        .find(|call| call.contains(" compile "))
        .unwrap_or_default()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

fn typst_project_with_settings(typst: Value) -> (TempDir, PathBuf) {
    let project = typst_project(None);
    for folder in ["fonts", "assets/type"] {
        std::fs::create_dir_all(project.path().join(folder)).unwrap();
    }
    set_typst(project.path(), typst);
    let root = project.path().canonicalize().unwrap();
    (project, root)
}

#[test]
fn typst_builds_pass_package_folders_fonts_inputs_and_the_chosen_variant() {
    let tools = TempDir::new().unwrap();
    let typst = typst_fixture(tools.path(), "0.15.1");
    let data = TempDir::new().unwrap();
    let (project, root) = typst_project_with_settings(serde_json::json!({
        "vendor_packages": true,
        "font_paths": ["assets/type"],
        "inputs": {"draft": "true", "anonymous": "false"},
        "variants": {"review": {"inputs": {"anonymous": "true"}}, "final": {}}
    }));
    let output = oleafly_typst(
        project.path(),
        data.path(),
        &[],
        Some(&typst),
        &["--json", "build", "--variant", "review"],
    );
    assert!(
        output.status.success(),
        "{}{}",
        build_log(&output),
        stderr(&output)
    );
    let call = last_compile(&typst);
    for expected in [
        format!("--package-path {}", root.join("typst-packages").display()),
        format!(
            "--package-cache-path {}",
            data.path().join("typst").join("packages-cache").display()
        ),
        format!("--font-path {}", root.join("fonts").display()),
        format!("--font-path {}", root.join("assets").join("type").display()),
        "--input anonymous=true".to_string(),
        "--input draft=true".to_string(),
    ] {
        assert!(call.contains(&expected), "{expected}: {call}");
    }
    assert!(!call.contains("--ignore-system-fonts"), "{call}");
    assert!(!call.contains("--creation-timestamp"), "{call}");
    let environment = fixture_environment(&typst);
    assert_eq!(
        PathBuf::from(&environment["TYPST_PACKAGE_PATH"]),
        root.join("typst-packages")
    );
    assert_eq!(
        PathBuf::from(&environment["TYPST_PACKAGE_CACHE_PATH"]),
        data.path().join("typst").join("packages-cache")
    );
    assert!(!environment.contains_key("HTTPS_PROXY"), "{environment:?}");
    assert!(!environment.contains_key("SOURCE_DATE_EPOCH"));

    let base = oleafly_typst(project.path(), data.path(), &[], Some(&typst), &["build"]);
    assert!(base.status.success(), "{}", stderr(&base));
    assert!(last_compile(&typst).contains("--input anonymous=false"));
}

#[test]
fn an_unknown_typst_variant_stops_before_typst_runs_and_names_the_others() {
    let tools = TempDir::new().unwrap();
    let typst = typst_fixture(tools.path(), "0.15.1");
    let data = TempDir::new().unwrap();
    let (project, _root) = typst_project_with_settings(serde_json::json!({
        "variants": {"review": {"inputs": {"anonymous": "true"}}, "camera-ready": {}}
    }));
    for command in ["build", "watch"] {
        let machine = oleafly_typst(
            project.path(),
            data.path(),
            &[],
            Some(&typst),
            &["--json", command, "--variant", "final"],
        );
        assert_eq!(machine.status.code(), Some(3), "{command}");
        let value = json(&machine);
        assert_eq!(value["error"]["kind"], "invalid_input");
        assert_eq!(
            value["error"]["message"],
            "this project has no Typst variant named `final`. Available variants: camera-ready, review"
        );
    }
    let human = oleafly_typst(
        project.path(),
        data.path(),
        &[],
        Some(&typst),
        &["build", "--variant", "final"],
    );
    assert_eq!(human.status.code(), Some(3));
    assert!(
        stderr(&human).starts_with("error: this project has no Typst variant named `final`"),
        "{}",
        stderr(&human)
    );
    assert!(fixture_calls(&typst).is_empty());
}

#[test]
fn a_variant_for_another_engine_is_noted_and_ignored() {
    let tools = TempDir::new().unwrap();
    let compiler = compiler_fixture(&tools);
    let data = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    assert!(run(&["init"], Some(project.path())).status.success());
    let output = build_with_tools(
        project.path(),
        data.path(),
        &[("OLEAFLY_TECTONIC", compiler.as_path())],
        &["build", "--variant", "review"],
    );
    assert!(output.status.success(), "{}", stderr(&output));
    assert!(stderr(&output).contains("note: --variant is ignored for tectonic projects"));
}

#[test]
fn typst_offline_builds_point_downloads_at_an_address_that_never_answers() {
    let tools = TempDir::new().unwrap();
    let typst = typst_fixture(tools.path(), "0.15.1");
    let data = TempDir::new().unwrap();
    let project = typst_project(None);
    let output = oleafly_typst(
        project.path(),
        data.path(),
        &[],
        Some(&typst),
        &["build", "--offline"],
    );
    assert!(output.status.success(), "{}", stderr(&output));
    assert!(
        !stderr(&output).contains("is ignored"),
        "{}",
        stderr(&output)
    );
    let environment = fixture_environment(&typst);
    assert_eq!(environment["HTTPS_PROXY"], "http://127.0.0.1:9");
    assert_eq!(environment["NO_PROXY"], "");
    assert!(environment.contains_key("TYPST_PACKAGE_CACHE_PATH"));
    assert!(!environment.contains_key("GIT_DIR"));
}

#[test]
fn an_older_typst_gets_only_the_flags_it_knows_and_one_note_per_setting() {
    let tools = TempDir::new().unwrap();
    let fixture = typst_fixture(tools.path(), "0.15.1");
    let data = TempDir::new().unwrap();
    let (Some(old), Some(new)) = (
        install_typst(&fixture, data.path(), "0.11.1"),
        install_typst(&fixture, data.path(), "0.15.1"),
    ) else {
        return;
    };
    let settings = |version: &str| {
        serde_json::json!({
            "version": version,
            "vendor_packages": true,
            "system_fonts": false,
            "reproducible": true,
            "inputs": {"draft": "true"}
        })
    };
    let (project, root) = typst_project_with_settings(settings("0.11.1"));
    let human = oleafly_typst(project.path(), data.path(), &[], None, &["build"]);
    assert!(human.status.success(), "{}", stderr(&human));
    let notes: Vec<String> = stderr(&human)
        .lines()
        .filter(|line| line.starts_with("note: "))
        .map(str::to_string)
        .collect();
    assert_eq!(
        notes,
        [
            "note: Typst 0.11.1 does not support --ignore-system-fonts, so typst.system_fonts is not applied",
            "note: Typst 0.11.1 does not support --ignore-system-fonts or --creation-timestamp, so typst.reproducible is not applied",
            "note: Typst 0.11.1 does not support --package-path, so typst.vendor_packages is not applied",
        ]
    );
    let call = last_compile(&old);
    for absent in [
        "--ignore-system-fonts",
        "--creation-timestamp",
        "--package-path",
        "--package-cache-path",
    ] {
        assert!(!call.contains(absent), "{absent}: {call}");
    }
    assert!(call.contains("--input draft=true"), "{call}");
    assert!(
        call.contains(&format!("--font-path {}", root.join("fonts").display())),
        "{call}"
    );
    let environment = fixture_environment(&old);
    assert_eq!(environment["SOURCE_DATE_EPOCH"], "0");
    assert_eq!(
        PathBuf::from(&environment["TYPST_PACKAGE_PATH"]),
        root.join("typst-packages")
    );

    let machine = oleafly_typst(project.path(), data.path(), &[], None, &["--json", "build"]);
    assert!(machine.status.success());
    assert!(machine.stderr.is_empty(), "{}", stderr(&machine));

    let doctor = oleafly_typst(
        project.path(),
        data.path(),
        &[],
        None,
        &["--json", "doctor"],
    );
    let report = json(&doctor);
    let check = doctor_check(&report, "typst_settings");
    assert_eq!(check["status"], "warning");
    assert!(check["message"]
        .as_str()
        .unwrap()
        .contains("typst.reproducible is not applied"));

    set_typst(project.path(), settings("0.15.1"));
    let current = oleafly_typst(project.path(), data.path(), &[], None, &["build"]);
    assert!(current.status.success(), "{}", stderr(&current));
    assert!(!stderr(&current).contains("note: "), "{}", stderr(&current));
    let call = last_compile(&new);
    for expected in [
        "--ignore-system-fonts".to_string(),
        "--creation-timestamp 0".to_string(),
        format!("--package-path {}", root.join("typst-packages").display()),
    ] {
        assert!(call.contains(&expected), "{expected}: {call}");
    }
    let report = json(&oleafly_typst(
        project.path(),
        data.path(),
        &[],
        None,
        &["--json", "doctor"],
    ));
    assert!(report["report"]["checks"]
        .as_array()
        .unwrap()
        .iter()
        .all(|check| check["name"] != "typst_settings"));
}

fn git_directory() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find(|directory| {
        directory
            .join(oleafly_cli::executable_name("git"))
            .is_file()
    })
}

#[test]
fn reproducible_typst_builds_use_the_last_commit_time() {
    let Some(git) = git_directory() else {
        return;
    };
    let tools = TempDir::new().unwrap();
    let typst = typst_fixture(tools.path(), "0.15.1");
    let data = TempDir::new().unwrap();
    let (project, _root) = typst_project_with_settings(serde_json::json!({"reproducible": true}));
    let commit = Command::new(git.join(oleafly_cli::executable_name("git")))
        .args([
            "-c",
            "commit.gpgsign=false",
            "-c",
            "core.hooksPath=/dev/null",
        ])
        .args(["init", "-q"])
        .current_dir(project.path())
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .output()
        .unwrap();
    assert!(commit.status.success(), "{}", stderr(&commit));
    let commit = Command::new(git.join(oleafly_cli::executable_name("git")))
        .args([
            "-c",
            "commit.gpgsign=false",
            "-c",
            "core.hooksPath=/dev/null",
        ])
        .args(["commit", "-q", "--allow-empty", "-m", "Draft"])
        .current_dir(project.path())
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .env("GIT_AUTHOR_NAME", "Ada")
        .env("GIT_AUTHOR_EMAIL", "ada@example.com")
        .env("GIT_COMMITTER_NAME", "Ada")
        .env("GIT_COMMITTER_EMAIL", "ada@example.com")
        .env("GIT_AUTHOR_DATE", "@1700000000 +0000")
        .env("GIT_COMMITTER_DATE", "@1700000000 +0000")
        .output()
        .unwrap();
    assert!(commit.status.success(), "{}", stderr(&commit));
    let output = oleafly_typst(
        project.path(),
        data.path(),
        &[&git],
        Some(&typst),
        &["build"],
    );
    assert!(output.status.success(), "{}", stderr(&output));
    let call = last_compile(&typst);
    assert!(call.contains("--creation-timestamp 1700000000"), "{call}");
    assert!(call.contains("--ignore-system-fonts"), "{call}");
    assert_eq!(
        fixture_environment(&typst)["SOURCE_DATE_EPOCH"],
        "1700000000"
    );
}

#[test]
fn typst_errors_keep_their_columns_and_hints_in_json_and_text() {
    let tools = TempDir::new().unwrap();
    let typst = typst_fixture(tools.path(), "0.15.1");
    let data = TempDir::new().unwrap();
    let project = typst_project(None);
    std::fs::write(project.path().join("main.typ"), "// fixture-human-error\n").unwrap();
    let machine = oleafly_typst(
        project.path(),
        data.path(),
        &[],
        Some(&typst),
        &["--json", "build"],
    );
    assert_eq!(machine.status.code(), Some(5));
    let value = json(&machine);
    assert_eq!(value["ok"], false);
    let errors = value["build"]["errors"].as_array().unwrap();
    assert_eq!(errors.len(), 2, "{errors:?}");
    assert_eq!(errors[0]["kind"], "error");
    assert_eq!(errors[0]["file"], "main.typ");
    assert_eq!(errors[0]["line"], 3);
    assert_eq!(errors[0]["column"], 2);
    assert_eq!(errors[0]["message"], "unknown variable: foo");
    assert_eq!(errors[0]["hints"].as_array().unwrap().len(), 2);
    assert!(errors[0]["hints"][0]
        .as_str()
        .unwrap()
        .starts_with("if you meant to display multiple letters"));
    assert_eq!(errors[1]["kind"], "warning");
    assert_eq!(errors[1]["file"], "chapters/intro.typ");
    assert_eq!(errors[1]["column"], 17);
    assert_eq!(errors[1]["hints"], serde_json::json!([]));

    let human = oleafly_typst(project.path(), data.path(), &[], Some(&typst), &["build"]);
    assert_eq!(human.status.code(), Some(5));
    let text = stderr(&human);
    assert!(text.contains("main.typ:3:1"), "{text}");
    assert!(text.contains("= hint: if you meant"), "{text}");
    assert!(text.contains("Build failed in "), "{text}");
}

#[test]
fn doctor_shows_the_effective_typst_settings() {
    let tools = TempDir::new().unwrap();
    let typst = typst_fixture(tools.path(), "0.15.1");
    let data = TempDir::new().unwrap();
    let (project, root) = typst_project_with_settings(serde_json::json!({
        "vendor_packages": true,
        "font_paths": ["assets/type"],
        "system_fonts": false,
        "inputs": {"draft": "true"},
        "variants": {"review": {"inputs": {"anonymous": "true"}}}
    }));
    let machine = oleafly_typst(
        project.path(),
        data.path(),
        &[],
        Some(&typst),
        &["--json", "doctor"],
    );
    assert!(
        machine.status.success(),
        "{}",
        String::from_utf8_lossy(&machine.stdout)
    );
    let settings = json(&machine)["typst"]["settings"].clone();
    assert_eq!(settings["vendor_packages"], true);
    assert_eq!(
        PathBuf::from(settings["package_path"].as_str().unwrap()),
        root.join("typst-packages")
    );
    assert_eq!(
        PathBuf::from(settings["package_cache_path"].as_str().unwrap()),
        data.path().join("typst").join("packages-cache")
    );
    assert_eq!(
        settings["font_dirs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|directory| PathBuf::from(directory.as_str().unwrap()))
            .collect::<Vec<_>>(),
        [root.join("fonts"), root.join("assets").join("type")]
    );
    assert_eq!(settings["system_fonts"], false);
    assert_eq!(settings["reproducible"], false);
    assert_eq!(settings["inputs"], serde_json::json!({"draft": "true"}));
    assert_eq!(
        settings["variants"],
        serde_json::json!({"review": {"anonymous": "true"}})
    );

    let human = oleafly_typst(project.path(), data.path(), &[], Some(&typst), &["doctor"]);
    assert!(human.status.success());
    let stdout = String::from_utf8_lossy(&human.stdout);
    for expected in [
        "Typst settings:",
        "Version pin",
        "Vendored packages  on",
        "System fonts       ignored",
        "Reproducible       off",
        "Inputs             draft=true",
        "Variants           review (anonymous=true)",
    ] {
        assert!(stdout.contains(expected), "{expected}: {stdout}");
    }
}
