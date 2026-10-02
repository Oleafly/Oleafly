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
        ("typst", &["OLEAFLY_TYPST"][..], &BUILD_FLAGS[..]),
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
