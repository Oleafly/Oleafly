use std::path::Path;

use super::quarto::reject_project_local;
use super::{
    CompileError, CompileOptions, CompileTarget, CompilerPrerequisite, ConversionExport,
    DocumentEngine, DocumentEngineId, EngineArtifacts, EngineCapabilities, EngineCompileSpec,
    EngineEnvironment, EngineExecutable, EngineFeature, EngineInput, FormattingProfile,
    SourcePreflightProfile, TemplateKind, TYPST_ENGINE,
};
use crate::app_error::AppError;
use crate::notebook_toolchain::NotebookTool;

pub(super) struct CalepinEngine;
pub(super) static CALEPIN_ENGINE: CalepinEngine = CalepinEngine;

pub(crate) const STORED_RESULTS_CODE: &str = "notebook.stored_results";
const RUNTIME_DIRECTORY: &str = ".calepin";
const RUNTIME_FILE: &str = "calepin.typ";
const MAX_ERRORS: usize = 200;

impl DocumentEngine for CalepinEngine {
    fn id(&self) -> DocumentEngineId {
        DocumentEngineId::Calepin
    }

    fn capabilities(&self) -> EngineCapabilities {
        EngineCapabilities {
            produces_pdf: true,
            supports_synctex: false,
            supports_offline: false,
            supports_isolated_compile: false,
            formatting_profile: FormattingProfile::Typst,
            source_preflight_profile: SourcePreflightProfile::None,
            features: &[EngineFeature::Citations, EngineFeature::DocumentIndex],
            conversion_exports: &[ConversionExport::Html],
            template_kinds: &[TemplateKind::Document],
            compiler_prerequisite: Some(CompilerPrerequisite::Calepin),
        }
    }

    fn accepts_metadata_name(&self, name: &str) -> bool {
        name.trim().eq_ignore_ascii_case("calepin")
    }

    fn source_extensions(&self) -> &'static [&'static str] {
        &["typ"]
    }

    fn accepts_main_document(&self, main_document: &str) -> bool {
        Path::new(main_document)
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("typ"))
    }

    fn artifacts(&self, out_dir: &Path, _target: CompileTarget<'_>) -> EngineArtifacts {
        EngineArtifacts {
            output_dir: out_dir.to_owned(),
            pdf: Some(out_dir.join(format!("{}.pdf", crate::paths::ENTRY_STEM))),
            log: None,
            synctex: None,
            html: None,
        }
    }

    fn compile_spec(
        &self,
        out_dir: &Path,
        project_dir: &Path,
        target: CompileTarget<'_>,
        options: CompileOptions,
    ) -> Result<EngineCompileSpec, String> {
        let CompileTarget::Main { main_document } = target else {
            return Err("Calepin does not support isolated compilation".into());
        };
        if !options.allow_shell_escape {
            if has_stored_results(project_dir, main_document) {
                return TYPST_ENGINE.compile_spec(
                    out_dir,
                    project_dir,
                    target,
                    CompileOptions {
                        typst: None,
                        typst_packages: None,
                        typst_settings: None,
                        ..options
                    },
                );
            }
            return Err(AppError::new("notebook.code_needed")
                .param("engine", NotebookTool::Calepin.label())
                .into());
        }
        let artifacts = self.artifacts(out_dir, target);
        let output = artifacts
            .pdf
            .clone()
            .ok_or_else(|| "Calepin PDF artifact was not declared".to_string())?;
        calepin_spec(
            project_dir,
            main_document,
            &output,
            "pdf",
            artifacts,
            options.source_date_epoch,
        )
    }

    fn parse_errors(&self, log: &str) -> Vec<CompileError> {
        parse_calepin_log(log)
    }

    fn compile_notes(
        &self,
        spec: &EngineCompileSpec,
        options: &CompileOptions,
    ) -> Vec<CompileError> {
        if options.allow_shell_escape
            || !matches!(spec.executable, EngineExecutable::BundledSidecar("typst"))
        {
            return Vec::new();
        }
        vec![CompileError {
            message: "Code is off for this project, so the document shows the results Calepin stored the last time it ran.".into(),
            kind: "warning".into(),
            code: Some(STORED_RESULTS_CODE.into()),
            ..CompileError::default()
        }]
    }
}

pub(super) fn calepin_spec(
    project_dir: &Path,
    main_document: &str,
    output: &Path,
    format: &str,
    artifacts: EngineArtifacts,
    source_date_epoch: Option<u64>,
) -> Result<EngineCompileSpec, String> {
    let calepin = crate::notebook_toolchain::find_tool(NotebookTool::Calepin)
        .ok_or_else(|| String::from(AppError::new(NotebookTool::Calepin.missing_code())))?;
    reject_project_local(&calepin, project_dir)?;
    let input = project_dir.join(main_document);
    let typst = super::resolve_bundled_sidecar("typst").ok();
    let rscript = crate::notebook_toolchain::rscript();
    let args = calepin_args(&input, output, format, typst.as_deref(), rscript.as_deref());
    let mut environment = EngineEnvironment::inherited(source_date_epoch)
        .with_variable("CALEPIN_PROGRESS", "plain".to_owned());
    for (name, value) in crate::notebook_toolchain::calepin_runtime_variables(project_dir) {
        environment = environment.with_variable(name, value);
    }
    Ok(EngineCompileSpec {
        executable: EngineExecutable::ExternalPath(calepin),
        args,
        input: EngineInput::Direct(input),
        artifacts,
        working_dir: project_dir.to_owned(),
        environment,
    })
}

pub(crate) fn has_stored_results(project_dir: &Path, main_document: &str) -> bool {
    let runtime = project_dir.join(RUNTIME_DIRECTORY);
    if runtime.join(RUNTIME_FILE).is_file() {
        return true;
    }
    let stem = Path::new(main_document).with_extension("");
    let notebook = stem
        .components()
        .fold(runtime, |path, component| path.join(component));
    notebook.join(RUNTIME_FILE).is_file()
}

fn setting(key: &str, path: &Path) -> String {
    let text = oleafly_core::plain_path(path)
        .to_string_lossy()
        .into_owned();
    if text.contains('\'') {
        format!("{key}={text}")
    } else {
        format!("{key}='{text}'")
    }
}

pub(crate) fn calepin_args(
    input: &Path,
    output: &Path,
    format: &str,
    typst: Option<&Path>,
    rscript: Option<&Path>,
) -> Vec<String> {
    let mut args = vec![
        "compile".to_owned(),
        oleafly_core::plain_path(input)
            .to_string_lossy()
            .into_owned(),
        oleafly_core::plain_path(output)
            .to_string_lossy()
            .into_owned(),
        "--format".to_owned(),
        format.to_owned(),
    ];
    for (key, path) in [
        ("executables.typst", typst),
        ("executables.rscript", rscript),
    ] {
        if let Some(path) = path {
            args.push("--set".to_owned());
            args.push(setting(key, path));
        }
    }
    args
}

fn strip_ansi(line: &str) -> String {
    let mut plain = String::with_capacity(line.len());
    let mut characters = line.chars().peekable();
    while let Some(character) = characters.next() {
        if character == '\u{1b}' {
            if characters.peek() == Some(&'[') {
                characters.next();
                for next in characters.by_ref() {
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        plain.push(character);
    }
    plain
}

fn calepin_explanation(message: &str) -> Option<&'static str> {
    let lower = message.to_ascii_lowercase();
    if lower.contains("requires typst") {
        return Some("Calepin needs Typst 0.15 or newer. Oleafly passes its own Typst to Calepin, so update Oleafly or install a newer Typst.");
    }
    if lower.contains("did not run") {
        return Some("The language for this chunk is not installed, or Calepin could not find it. Install R, Python or the Jupyter kernel the chunk names, then compile again.");
    }
    if lower.contains("jupyter_client") {
        return Some("Chunks in languages other than R and Python need Jupyter. Install it with python3 -m pip install jupyter_client.");
    }
    None
}

fn chunk_error(message: String, kind: &str) -> CompileError {
    CompileError {
        explanation: calepin_explanation(&message).map(str::to_owned),
        message,
        kind: kind.to_owned(),
        ..CompileError::default()
    }
}

pub(crate) fn parse_calepin_log(log: &str) -> Vec<CompileError> {
    let plain: String = log.lines().map(strip_ansi).collect::<Vec<_>>().join("\n");
    let mut errors = super::typst_diagnostics::parse_typst_errors(&plain);
    for line in plain.lines() {
        if errors.len() >= MAX_ERRORS {
            break;
        }
        let trimmed = line.trim();
        if let Some(message) = trimmed.strip_prefix("Error:") {
            let message = message.trim();
            if message.is_empty() || message.eq_ignore_ascii_case("typst compile failed:") {
                continue;
            }
            errors.push(chunk_error(message.to_owned(), "error"));
        } else if let Some(message) = trimmed.strip_prefix("Warning:") {
            let message = message.trim();
            if !message.is_empty() {
                errors.push(chunk_error(message.to_owned(), "warning"));
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    errors.retain(|error| seen.insert((error.kind.clone(), error.message.clone(), error.line)));
    errors.sort_by_key(|error| error.kind != "error");
    errors
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_compile_into_the_build_folder_with_oleaflys_typst() {
        let args = calepin_args(
            Path::new("/work/report.typ"),
            Path::new("/work/build/_oleafly_entry.pdf"),
            "pdf",
            Some(Path::new("/app/typst")),
            Some(Path::new("/usr/local/bin/Rscript")),
        );
        assert_eq!(
            args,
            [
                "compile",
                "/work/report.typ",
                "/work/build/_oleafly_entry.pdf",
                "--format",
                "pdf",
                "--set",
                "executables.typst='/app/typst'",
                "--set",
                "executables.rscript='/usr/local/bin/Rscript'",
            ]
        );
        let bare = calepin_args(
            Path::new("/work/report.typ"),
            Path::new("/work/out.html"),
            "html",
            None,
            None,
        );
        assert_eq!(bare.len(), 5);
        assert_eq!(
            setting("executables.typst", Path::new("/Users/o'neil/typst")),
            "executables.typst=/Users/o'neil/typst"
        );
    }

    #[test]
    fn stored_results_are_found_for_the_generic_and_the_notebook_facade() {
        let directory = tempfile::tempdir().unwrap();
        assert!(!has_stored_results(directory.path(), "report.typ"));
        let facade = directory.path().join(".calepin/chapters/intro");
        std::fs::create_dir_all(&facade).unwrap();
        std::fs::write(facade.join("calepin.typ"), "").unwrap();
        assert!(has_stored_results(directory.path(), "chapters/intro.typ"));
        assert!(!has_stored_results(directory.path(), "report.typ"));
        std::fs::write(directory.path().join(".calepin/calepin.typ"), "").unwrap();
        assert!(has_stored_results(directory.path(), "report.typ"));
    }

    #[test]
    fn calepin_errors_warnings_and_typst_diagnostics_are_parsed() {
        let log = "[render] report.typ -> build/_oleafly_entry.pdf\n\
                   \u{1b}[33mWarning:\u{1b}[0m chunk `chunk-2` using engine `julia` did not run: kernel not found\n\
                   Error: typst compile failed:\n\
                   error: unknown variable: totl\n  \
                   ┌─ report.typ:12:3\n   \
                   │\n\
                   12 │ #totl\n   \
                   │  ^^^^\n\
                   \n\
                   Error: chunk `summary` failed: NameError: name 'x' is not defined\n";
        let errors = parse_calepin_log(log);
        let messages: Vec<&str> = errors.iter().map(|error| error.message.as_str()).collect();
        assert!(messages.contains(&"unknown variable: totl"), "{messages:?}");
        assert!(messages.contains(&"chunk `summary` failed: NameError: name 'x' is not defined"));
        let skipped = errors
            .iter()
            .find(|error| error.message.contains("did not run"))
            .unwrap();
        assert_eq!(skipped.kind, "warning");
        assert!(skipped.explanation.is_some());
        let typst = errors
            .iter()
            .find(|error| error.message == "unknown variable: totl")
            .unwrap();
        assert_eq!(typst.line, Some(12));
        assert!(!messages.contains(&"typst compile failed:"));
        assert_eq!(errors.last().unwrap().kind, "warning");
    }
}
