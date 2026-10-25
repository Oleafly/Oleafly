//! `remote diff --latexdiff`: the main document marked up with what
//! changed since the online version, as LaTeX or (with `--pdf`) compiled.
use std::ffi::OsStr;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use oleafly_online::sync::{checkout_remote, restore_base, SyncPaths};
use serde_json::json;

use super::scope::RemoteScope;
use super::sync::locate_tool_in;
use super::{DiffArgs, RemoteDeps};
use crate::auth::shared::{from_online, Report};
use crate::contract::{CliError, ErrorKind};

const LATEXDIFF_TIMEOUT: Duration = Duration::from_secs(120);
/// The most latexdiff output kept.
const MAX_OUTPUT: u64 = 64 << 20;

fn missing() -> CliError {
    CliError::new(
        ErrorKind::MissingTool,
        "remote.latexdiff_missing",
        "latexdiff isn't installed.",
    )
    .hint("Install it with your TeX distribution, then try again.")
}

fn failed(detail: impl Into<String>) -> CliError {
    CliError::new(
        ErrorKind::Internal,
        "remote.latexdiff_failed",
        "latexdiff couldn't compare the two versions.",
    )
    .details(json!({"cause": detail.into()}))
}

/// latexdiff from `PATH` or the TeX distribution, never from the project.
pub(crate) fn locate_latexdiff(project_root: &Path) -> Result<PathBuf, CliError> {
    let mut extra = Vec::new();
    if cfg!(target_os = "macos") {
        extra.push(PathBuf::from("/Library/TeX/texbin/latexdiff"));
    } else if cfg!(target_os = "linux") {
        extra.push(PathBuf::from("/usr/bin/latexdiff"));
    }
    let path = std::env::var_os("PATH");
    locate_tool_in("latexdiff", project_root, path.as_deref(), &extra).ok_or_else(missing)
}

/// `latexdiff --flatten OLD NEW`, run directly (no shell).
pub(crate) fn latexdiff_command(program: &Path, old_main: &Path, new_main: &Path) -> Command {
    let mut command = Command::new(program);
    command
        .arg("--flatten")
        .arg(old_main)
        .arg(new_main)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(folder) = new_main.parent() {
        command.current_dir(folder);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        command.creation_flags(0x0800_0000);
    }
    command
}

/// Runs latexdiff with a time limit and returns what it printed.
pub(crate) fn run_latexdiff(
    program: &Path,
    old_main: &Path,
    new_main: &Path,
    timeout: Duration,
) -> Result<Vec<u8>, CliError> {
    // TeX distributions start latexdiff through a wrapper that runs perl as
    // a child of its own, so the whole tree is contained (as compiler runs
    // are) and a timeout ends perl too.
    let mut command = latexdiff_command(program, old_main, new_main);
    crate::process::isolate_std(&mut command);
    let mut child = command.spawn().map_err(|error| failed(error.to_string()))?;
    let tree = match crate::process::contain(child.id()) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(failed(error.to_string()));
        }
    };
    let mut stdout = child.stdout.take().ok_or_else(|| failed("no output"))?;
    let mut stderr = child.stderr.take().ok_or_else(|| failed("no output"))?;
    let out = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = (&mut stdout).take(MAX_OUTPUT).read_to_end(&mut bytes);
        bytes
    });
    let err = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = (&mut stderr).take(64 * 1024).read_to_end(&mut bytes);
        bytes
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child
            .try_wait()
            .map_err(|error| failed(error.to_string()))?
        {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                drop(tree);
                let _ = child.kill();
                let _ = child.wait();
                return Err(failed(format!(
                    "latexdiff took longer than {} seconds",
                    timeout.as_secs()
                )));
            }
            None => std::thread::sleep(Duration::from_millis(50)),
        }
    };
    // Whatever the wrapper left running goes with it.
    drop(tree);
    let output = out.join().unwrap_or_default();
    let errors = err.join().unwrap_or_default();
    if !status.success() || output.is_empty() {
        return Err(failed(String::from_utf8_lossy(&errors).trim().to_string()));
    }
    Ok(output)
}

/// Compiles the marked-up document with this command's own `build`.
pub(crate) fn compile_diff_pdf(
    project_root: &Path,
    diff_tex: &str,
    output_pdf: &Path,
) -> Result<(), CliError> {
    let program = std::env::current_exe().map_err(|error| failed(error.to_string()))?;
    let mut command = Command::new(program);
    command
        .arg("-C")
        .arg(project_root)
        .args(["--quiet", "--no-input", "build", "--main", diff_tex, "-o"])
        .arg(output_pdf)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        command.creation_flags(0x0800_0000);
    }
    let output = command
        .output()
        .map_err(|error| failed(error.to_string()))?;
    if !output.status.success() {
        return Err(CliError::new(ErrorKind::Build, "remote.latexdiff_build_failed", "The marked-up document didn't compile.")
            .hint("Run oleafly remote diff --latexdiff -o diff.tex and build it to see the errors.")
            .details(json!({"log": String::from_utf8_lossy(&output.stderr).chars().take(4000).collect::<String>()})));
    }
    Ok(())
}

/// The project's main document, which must be LaTeX.
fn main_document(root: &Path) -> Result<String, CliError> {
    let opened = crate::engine::open_project(root, None, None)?;
    let main = opened.workspace.manifest().main_doc.clone();
    if !main.to_ascii_lowercase().ends_with(".tex") {
        return Err(CliError::new(
            ErrorKind::Usage,
            "remote.latexdiff_not_latex",
            "latexdiff works on LaTeX projects only.",
        ));
    }
    Ok(main)
}

/// Runs latexdiff between the online version (checked out in the mirror)
/// and this folder, then puts the mirror back.
pub(crate) fn latexdiff_report(
    deps: &RemoteDeps,
    scope: &RemoteScope,
    paths: &SyncPaths,
    args: &DiffArgs,
) -> Result<Report, CliError> {
    let root = scope.root();
    main_document(root)?;
    let program = locate_latexdiff(root)?;
    latexdiff_report_with(&program, deps, scope, paths, args)
}

fn latexdiff_report_with(
    program: &Path,
    deps: &RemoteDeps,
    scope: &RemoteScope,
    paths: &SyncPaths,
    args: &DiffArgs,
) -> Result<Report, CliError> {
    let root = scope.root();
    let main = main_document(root)?;
    let mirror = checkout_remote(deps.git.as_ref(), paths).map_err(|error| from_online(&error))?;
    let marked = run_latexdiff(
        program,
        &mirror.join(&main),
        &root.join(&main),
        LATEXDIFF_TIMEOUT,
    );
    restore_base(deps.git.as_ref(), paths).map_err(|error| from_online(&error))?;
    let marked = marked?;
    if !args.pdf {
        return match &args.output {
            Some(output) => {
                oleafly_core::atomic::write_atomic(output, &marked).map_err(CliError::from)?;
                Ok(
                    Report::new(json!({"tex": output, "pdf": null})).line(format!(
                        "Wrote the marked-up document to {}.",
                        output.display()
                    )),
                )
            }
            // The document is the answer, so it is in the data as well as on
            // screen (`--json` prints no lines).
            None => {
                let text = String::from_utf8_lossy(&marked).trim_end().to_string();
                Ok(Report::new(json!({"tex": null, "pdf": null, "text": text})).line(text))
            }
        };
    }
    let main_path = Path::new(&main);
    let stem = main_path
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or("main");
    let diff_name = format!(".oleafly-diff-{stem}.tex");
    let diff_relative = match main_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        Some(parent) => format!(
            "{}/{diff_name}",
            parent.to_string_lossy().replace('\\', "/")
        ),
        None => diff_name,
    };
    let diff_tex = root.join(&diff_relative);
    std::fs::write(&diff_tex, &marked).map_err(CliError::from)?;
    let output = args.output.clone().unwrap_or_else(|| {
        root.join(".oleafly")
            .join("diff")
            .join(format!("{stem}-diff.pdf"))
    });
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(CliError::from)?;
    }
    let compiled = compile_diff_pdf(root, &diff_relative, &output);
    let _ = std::fs::remove_file(&diff_tex);
    compiled?;
    Ok(Report::new(json!({"tex": null, "pdf": output}))
        .line(format!("Wrote the marked-up PDF to {}.", output.display())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latexdiff_arguments_keep_windows_paths_with_spaces_whole() {
        let command = latexdiff_command(
            Path::new(r"C:\texlive\bin\windows\latexdiff.exe"),
            Path::new(r"C:\Users\Ana Lopez\.oleafly\online\repo\main.tex"),
            Path::new(r"C:\Users\Ana Lopez\paper\main.tex"),
        );
        let args: Vec<_> = command.get_args().collect();
        assert_eq!(args.len(), 3);
        assert_eq!(args[0], "--flatten");
        assert_eq!(args[2], r"C:\Users\Ana Lopez\paper\main.tex");
    }

    #[cfg(unix)]
    #[test]
    fn a_latexdiff_that_runs_too_long_ends_with_the_programs_it_started() {
        use std::io::Write as _;
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("latexdiff");
        let pid_file = dir.path().join("child.pid");
        // As a TeX distribution's wrapper starts perl: a child of its own.
        let script = format!(
            "#!/bin/sh\nsleep 30 &\necho $! > '{}'\nwait\n",
            pid_file.display()
        );
        let mut writer = Command::new("sh")
            .args(["-c", "cat > \"$1\" && chmod 700 \"$1\"", "sh"])
            .arg(&fake)
            .stdin(Stdio::piped())
            .spawn()
            .unwrap();
        writer
            .stdin
            .take()
            .unwrap()
            .write_all(script.as_bytes())
            .unwrap();
        assert!(writer.wait().unwrap().success());
        let main = dir.path().join("main.tex");
        std::fs::write(&main, "x").unwrap();
        let recorded = (0..3).find_map(|_| {
            let error = run_latexdiff(&fake, &main, &main, Duration::from_secs(5)).unwrap_err();
            let cause = error.details.as_ref().unwrap()["cause"].to_string();
            assert!(cause.contains("longer than"), "{cause}");
            std::fs::read_to_string(&pid_file).ok()
        });
        let pid: i32 = recorded
            .expect("the wrapper never started its child")
            .trim()
            .parse()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        // SAFETY: probes a process id this test's script started.
        while unsafe { libc::kill(pid, 0) } == 0 {
            assert!(
                Instant::now() < deadline,
                "the wrapper's child kept running"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_marked_up_document_without_an_output_file_is_in_the_json_data() {
        use std::io::Write as _;
        let world = super::super::sync::tests::World::linked();
        std::fs::write(
            world.project.join("project.json"),
            r#"{"name":"t","main_doc":"main.tex","engine":"xetex"}"#,
        )
        .unwrap();
        let tools = world.dir.path().join("tools");
        std::fs::create_dir_all(&tools).unwrap();
        let fake = tools.join("latexdiff");
        // A child shell writes the script, so a test running at the same time
        // can't fork while this process holds the file open for writing
        // (which makes the exec fail with ETXTBSY).
        let mut writer = Command::new("sh")
            .args(["-c", "cat > \"$1\" && chmod 700 \"$1\"", "sh"])
            .arg(&fake)
            .stdin(Stdio::piped())
            .spawn()
            .unwrap();
        writer
            .stdin
            .take()
            .unwrap()
            .write_all(b"#!/bin/sh\nprintf '%s\\n' '\\documentclass{article} MARKED'\n")
            .unwrap();
        assert!(writer.wait().unwrap().success());
        let env = &world.env;
        let scope = super::super::scope::resolve_scope(&world.project, &env.data_root).unwrap();
        let paths = scope.sync_paths(&env.data_root).unwrap();
        let report = latexdiff_report_with(
            &fake,
            &super::super::sync::tests::deps(),
            &scope,
            &paths,
            &DiffArgs {
                latexdiff: true,
                ..DiffArgs::default()
            },
        )
        .unwrap();
        assert_eq!(report.data["text"], "\\documentclass{article} MARKED");
        assert_eq!(report.data["tex"], serde_json::Value::Null);
        assert_eq!(
            report.lines,
            vec!["\\documentclass{article} MARKED".to_string()]
        );
    }

    #[test]
    fn a_latexdiff_inside_the_project_is_never_run() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("paper");
        std::fs::create_dir_all(&project).unwrap();
        let fake = project.join(crate::native::executable_name("latexdiff"));
        std::fs::write(&fake, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let path = std::env::join_paths([&project]).unwrap();
        assert_eq!(
            locate_tool_in("latexdiff", &project, Some(&path), &[]),
            None
        );
    }

    #[test]
    fn latexdiff_refuses_non_latex_projects() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("main.typ"), "= Hello").unwrap();
        std::fs::write(
            dir.path().join("project.json"),
            r#"{"name":"t","main_doc":"main.typ","engine":"typst"}"#,
        )
        .unwrap();
        let error = main_document(dir.path()).unwrap_err();
        assert_eq!(
            (error.code.as_ref(), error.exit() as u8),
            ("remote.latexdiff_not_latex", 2)
        );
    }
}
