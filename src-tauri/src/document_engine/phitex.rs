use std::path::{Path, PathBuf};

use super::quarto::reject_project_local;
use super::{
    CompileOptions, EngineArtifacts, EngineCompileSpec, EngineEnvironment, EngineExecutable,
    EngineInput, LatexmkFlavor,
};

const CONFIG_FILE: &str = "phitex.toml";
const OFFLINE_SHELF: &str = "http://127.0.0.1:9/tl2026/";
const RESTRICTED_SHELL_ESCAPE: &str = "p";

pub(crate) fn program() -> Option<PathBuf> {
    if !crate::config::phitex_enabled() {
        return None;
    }
    crate::program_locator::locate_native("phitex").map(|located| located.path)
}

pub(super) fn builds(flavor: LatexmkFlavor) -> bool {
    matches!(flavor, LatexmkFlavor::Pdflatex | LatexmkFlavor::Xelatex)
}

pub(super) struct PhitexJob<'a> {
    pub phitex: PathBuf,
    pub out_dir: &'a Path,
    pub project_dir: &'a Path,
    pub input_path: PathBuf,
    pub flavor: LatexmkFlavor,
    pub artifacts: EngineArtifacts,
}

pub(super) fn compile_spec(
    job: PhitexJob<'_>,
    options: &CompileOptions,
) -> Result<EngineCompileSpec, String> {
    reject_project_local(&job.phitex, job.project_dir)?;
    let scratch = oleafly_core::EngineScratch::create(&super::engine_scratch_bases(job.out_dir))
        .map_err(|error| {
            format!("Oleafly could not create a temporary folder for PhiTeX: {error}")
        })?;
    let config = scratch.path().join(CONFIG_FILE);
    std::fs::write(&config, b"")
        .map_err(|error| format!("Oleafly could not prepare PhiTeX's settings: {error}"))?;
    let shelf = user_config_file()
        .and_then(|file| std::fs::read_to_string(file).ok())
        .is_some_and(|text| reads_from_shelf(&text));
    let produced = job
        .input_path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut environment = EngineEnvironment::inherited(options.source_date_epoch)
        .with_variable("PHITEX_CONFIG", config.to_string_lossy().into_owned())
        .with_variable("PHITEX_GRAPH", "sync".into())
        .with_variable("PHITEX_NO_UPDATE_CHECK", "1".into())
        .in_scratch(scratch, job.project_dir)
        .with_produced_stem(produced);
    if !options.allow_shell_escape {
        environment = environment.with_variable("shell_escape", RESTRICTED_SHELL_ESCAPE.into());
    }
    if shelf && options.offline {
        environment = environment.with_variable("PHITEX_SHELF_URL", OFFLINE_SHELF.into());
    }
    Ok(EngineCompileSpec {
        executable: EngineExecutable::ExternalPath(job.phitex),
        args: build_args(
            job.out_dir,
            &job.input_path,
            job.flavor,
            options.allow_shell_escape,
            shelf,
        ),
        input: EngineInput::Direct(job.input_path),
        artifacts: job.artifacts,
        working_dir: job.project_dir.to_owned(),
        environment,
    })
}

fn build_args(
    out_dir: &Path,
    input: &Path,
    flavor: LatexmkFlavor,
    shell_escape: bool,
    shelf: bool,
) -> Vec<String> {
    let mut args = vec![
        "build".to_owned(),
        "--engine".to_owned(),
        flavor.as_str().to_owned(),
        "--synctex".to_owned(),
        "--no-copy-pdf".to_owned(),
        "--output-dir".to_owned(),
        oleafly_core::plain_path(out_dir)
            .to_string_lossy()
            .into_owned(),
    ];
    if shell_escape {
        args.push("--shell-escape".to_owned());
    }
    if shelf {
        args.push("--shelf".to_owned());
    }
    args.push(
        oleafly_core::plain_path(input)
            .to_string_lossy()
            .into_owned(),
    );
    args
}

fn user_config_file() -> Option<PathBuf> {
    let set = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty());
    if let Some(file) = set("PHITEX_CONFIG") {
        return Some(PathBuf::from(file));
    }
    let base = match set("XDG_CONFIG_HOME") {
        Some(dir) => PathBuf::from(dir),
        None if cfg!(windows) => PathBuf::from(set("APPDATA")?),
        None => crate::paths::home_dir().ok()?.join(".config"),
    };
    Some(base.join("phitex").join(CONFIG_FILE))
}

fn reads_from_shelf(config: &str) -> bool {
    config
        .parse::<toml::Table>()
        .ok()
        .and_then(|table| table.get("files")?.as_str().map(|files| files == "shelf"))
        .unwrap_or(false)
}

pub(super) fn adopt_outputs(spec: &EngineCompileSpec) {
    let Some(stem) = spec.environment.produced_stem() else {
        return;
    };
    let artifacts = &spec.artifacts;
    for (extension, adopted) in [
        ("pdf", &artifacts.pdf),
        ("log", &artifacts.log),
        ("synctex.gz", &artifacts.synctex),
    ] {
        let Some(adopted) = adopted else {
            continue;
        };
        let produced = artifacts.output_dir.join(format!("{stem}.{extension}"));
        if produced == *adopted || !produced.is_file() {
            continue;
        }
        if let Err(error) =
            oleafly_core::atomic::persist_with_retry(|| std::fs::rename(&produced, adopted))
        {
            let _ = crate::project::append_app_log(format!(
                "PhiTeX built {}, but Oleafly could not move it to {}: {error}",
                produced.display(),
                adopted.display()
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn artifacts(out_dir: &Path) -> EngineArtifacts {
        EngineArtifacts {
            output_dir: out_dir.to_owned(),
            pdf: Some(out_dir.join("_oleafly_entry.pdf")),
            log: Some(out_dir.join("_oleafly_entry.log")),
            synctex: Some(out_dir.join("_oleafly_entry.synctex.gz")),
            html: None,
        }
    }

    fn options(allow_shell_escape: bool, offline: bool) -> CompileOptions {
        CompileOptions {
            offline,
            allow_shell_escape,
            ..CompileOptions::default()
        }
    }

    fn variable<'a>(spec: &'a EngineCompileSpec, name: &str) -> Option<&'a str> {
        spec.environment
            .variables()
            .iter()
            .rev()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    fn spec_for(
        project: &Path,
        phitex: &Path,
        options: &CompileOptions,
    ) -> Result<EngineCompileSpec, String> {
        let out_dir = project.join(".oleafly/build");
        compile_spec(
            PhitexJob {
                phitex: phitex.to_owned(),
                out_dir: &out_dir,
                project_dir: project,
                input_path: project.join("paper.tex"),
                flavor: LatexmkFlavor::Xelatex,
                artifacts: artifacts(&out_dir),
            },
            options,
        )
    }

    #[test]
    fn only_pdflatex_and_xelatex_go_to_phitex() {
        assert!(builds(LatexmkFlavor::Pdflatex));
        assert!(builds(LatexmkFlavor::Xelatex));
        assert!(!builds(LatexmkFlavor::Lualatex));
        assert!(!builds(LatexmkFlavor::Platex));
        assert!(!builds(LatexmkFlavor::Uplatex));
    }

    #[test]
    fn a_build_names_the_engine_output_folder_and_main_file() {
        let args = build_args(
            Path::new("/p/.oleafly/build"),
            Path::new("/p/paper.tex"),
            LatexmkFlavor::Pdflatex,
            false,
            false,
        );
        assert_eq!(
            args,
            [
                "build",
                "--engine",
                "pdflatex",
                "--synctex",
                "--no-copy-pdf",
                "--output-dir",
                "/p/.oleafly/build",
                "/p/paper.tex",
            ]
        );
    }

    #[test]
    fn shell_escape_and_shelf_are_passed_only_when_asked_for() {
        let args = build_args(
            Path::new("/out"),
            Path::new("/p/main.tex"),
            LatexmkFlavor::Xelatex,
            true,
            true,
        );
        assert!(args.contains(&"--shell-escape".to_owned()));
        assert!(args.contains(&"--shelf".to_owned()));
        assert_eq!(args.last().map(String::as_str), Some("/p/main.tex"));
    }

    #[test]
    fn shelf_is_read_from_the_files_setting_alone() {
        assert!(reads_from_shelf("files = \"shelf\"\n"));
        assert!(!reads_from_shelf("files = \"texlive\"\n"));
        assert!(!reads_from_shelf("shell-escape = true\n"));
        assert!(!reads_from_shelf("files = ["));
        assert!(!reads_from_shelf(""));
    }

    #[test]
    fn the_spec_runs_phitex_with_its_own_empty_settings() {
        let project = tempfile::tempdir().unwrap();
        let tools = tempfile::tempdir().unwrap();
        let phitex = tools.path().join("phitex");
        let spec = spec_for(project.path(), &phitex, &options(false, false)).unwrap();

        assert_eq!(spec.executable, EngineExecutable::ExternalPath(phitex));
        assert_eq!(spec.working_dir, project.path());
        assert_eq!(variable(&spec, "PHITEX_GRAPH"), Some("sync"));
        assert_eq!(variable(&spec, "PHITEX_NO_UPDATE_CHECK"), Some("1"));
        let config = PathBuf::from(variable(&spec, "PHITEX_CONFIG").unwrap());
        assert_eq!(std::fs::read(&config).unwrap(), b"");
        assert_eq!(spec.environment.produced_stem(), Some("paper"));
        assert!(!spec.args.contains(&"--shell-escape".to_owned()));
        assert_eq!(variable(&spec, "shell_escape"), Some("p"));
    }

    #[test]
    fn shell_escape_follows_the_project_setting() {
        let project = tempfile::tempdir().unwrap();
        let tools = tempfile::tempdir().unwrap();
        let spec = spec_for(
            project.path(),
            &tools.path().join("phitex"),
            &options(true, false),
        )
        .unwrap();
        assert!(spec.args.contains(&"--shell-escape".to_owned()));
        assert_eq!(variable(&spec, "shell_escape"), None);
    }

    #[test]
    fn a_phitex_inside_the_project_is_refused() {
        let project = tempfile::tempdir().unwrap();
        let phitex = project.path().join("bin/phitex");
        std::fs::create_dir_all(phitex.parent().unwrap()).unwrap();
        std::fs::write(&phitex, b"").unwrap();
        let refused = spec_for(project.path(), &phitex, &options(false, false)).unwrap_err();
        assert_eq!(
            crate::app_error::code(&refused).as_deref(),
            Some("notebook.program_in_project")
        );
    }

    #[test]
    fn built_outputs_take_the_names_the_preview_reads() {
        let out = tempfile::tempdir().unwrap();
        for name in ["paper.pdf", "paper.log", "paper.synctex.gz", "paper.aux"] {
            std::fs::write(out.path().join(name), name).unwrap();
        }
        std::fs::write(out.path().join("_oleafly_entry.pdf"), "old").unwrap();
        let spec = EngineCompileSpec {
            executable: EngineExecutable::ExternalPath(PathBuf::from("/bin/phitex")),
            args: Vec::new(),
            input: EngineInput::Direct(PathBuf::from("/p/paper.tex")),
            artifacts: artifacts(out.path()),
            working_dir: PathBuf::from("/p"),
            environment: EngineEnvironment::default().with_produced_stem("paper".into()),
        };

        adopt_outputs(&spec);

        for (name, from) in [
            ("_oleafly_entry.pdf", "paper.pdf"),
            ("_oleafly_entry.log", "paper.log"),
            ("_oleafly_entry.synctex.gz", "paper.synctex.gz"),
        ] {
            assert_eq!(
                std::fs::read_to_string(out.path().join(name)).unwrap(),
                from
            );
            assert!(!out.path().join(from).exists());
        }
        assert!(out.path().join("paper.aux").is_file());
    }

    #[test]
    fn outputs_phitex_did_not_write_leave_the_old_ones_alone() {
        let out = tempfile::tempdir().unwrap();
        std::fs::write(out.path().join("_oleafly_entry.log"), "old").unwrap();
        let spec = EngineCompileSpec {
            executable: EngineExecutable::ExternalPath(PathBuf::from("/bin/phitex")),
            args: Vec::new(),
            input: EngineInput::Direct(PathBuf::from("/p/paper.tex")),
            artifacts: artifacts(out.path()),
            working_dir: PathBuf::from("/p"),
            environment: EngineEnvironment::default().with_produced_stem("paper".into()),
        };

        adopt_outputs(&spec);

        assert_eq!(
            std::fs::read_to_string(out.path().join("_oleafly_entry.log")).unwrap(),
            "old"
        );
        assert!(!out.path().join("_oleafly_entry.pdf").exists());
    }

    #[cfg(unix)]
    const FAKE_PHITEX: &str = r#"#!/bin/sh
out=
for arg in "$@"; do
  case $prev in --output-dir) out=$arg ;; esac
  prev=$arg
done
printf '%s\n' "$@" > '{record}.args'
printf 'graph=%s\nupdate=%s\nshell=%s\n' "$PHITEX_GRAPH" "$PHITEX_NO_UPDATE_CHECK" "$shell_escape" > '{record}.env'
wc -c < "$PHITEX_CONFIG" | tr -d ' ' > '{record}.config'
printf '%s\n' '%PDF-1.4' '%%EOF' > "$out/paper.pdf"
printf 'This is PhiTeX\n' > "$out/paper.log"
printf 'synctex' > "$out/paper.synctex.gz"
"#;

    #[cfg(unix)]
    #[tokio::test]
    async fn a_build_runs_phitex_and_leaves_the_outputs_where_oleafly_reads_them() {
        use std::os::unix::fs::PermissionsExt;
        let project = tempfile::tempdir().unwrap();
        let project = project.path().canonicalize().unwrap();
        let tools = tempfile::tempdir().unwrap();
        let record = tools.path().join("run");
        let phitex = tools.path().join("phitex");
        std::fs::write(
            &phitex,
            FAKE_PHITEX.replace("{record}", &record.to_string_lossy()),
        )
        .unwrap();
        std::fs::set_permissions(&phitex, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(project.join("paper.tex"), "\\documentclass{article}").unwrap();
        let out_dir = project.join(".oleafly/build");
        std::fs::create_dir_all(&out_dir).unwrap();
        let spec = spec_for(&project, &phitex, &options(false, false)).unwrap();

        let (log, code) = super::super::run_supervised_process_with_environment(
            &phitex,
            &spec.args,
            &spec.working_dir,
            None,
            super::super::COMPILE_TIMEOUT,
            None,
            &spec.environment,
        )
        .await
        .unwrap();
        adopt_outputs(&spec);

        assert_eq!(code, Some(0), "{log}");
        let read = |suffix: &str| {
            std::fs::read_to_string(format!("{}.{suffix}", record.display())).unwrap()
        };
        assert_eq!(read("env"), "graph=sync\nupdate=1\nshell=p\n");
        assert_eq!(read("config").trim(), "0");
        let args = read("args");
        assert!(args.starts_with("build\n--engine\nxelatex\n"), "{args}");
        assert!(
            args.ends_with(&format!("{}\n", project.join("paper.tex").display())),
            "{args}"
        );
        assert!(super::super::complete_pdf_file(
            &out_dir.join("_oleafly_entry.pdf")
        ));
        assert_eq!(
            std::fs::read_to_string(out_dir.join("_oleafly_entry.log")).unwrap(),
            "This is PhiTeX\n"
        );
        assert!(out_dir.join("_oleafly_entry.synctex.gz").is_file());
        assert!(!out_dir.join("paper.pdf").exists());
    }
}
