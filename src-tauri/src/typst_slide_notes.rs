use std::time::Duration;

use oleafly_core::typst_toolchain::ToolchainVersion;
use serde::Serialize;
use serde_json::Value;

use crate::typst_query::{TypstQueryContext, TypstQueryMethod, TypstQueryTarget};

const NOTES_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_NOTES_JSON_BYTES: usize = 8 * 1024 * 1024;
const MAX_ERROR_CHARS: usize = 400;
const NOTES_LABEL: &str = "<pdfpc>";
const NOTES_FILE_LABEL: &str = "<pdfpc-file>";
const LOCATED_NOTES_EXPRESSION: &str = r#"(notes: query(<pdfpc>).map(m => (page: m.location().page(), value: m.at("value", default: none))), files: query(<pdfpc-file>).map(m => m.at("value", default: none)))"#;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TypstSlideNotes {
    located: bool,
    notes: Value,
    files: Value,
}

pub(crate) fn supports_located_notes(version: &ToolchainVersion) -> bool {
    crate::typst_query::query_method(version) == TypstQueryMethod::Eval
}

const LOCATED_NOTES: TypstQueryTarget<'static> = TypstQueryTarget::Eval(LOCATED_NOTES_EXPRESSION);
const NOTES_QUERY: TypstQueryTarget<'static> = TypstQueryTarget::Query {
    selector: NOTES_LABEL,
    field: None,
};
const NOTES_FILE_QUERY: TypstQueryTarget<'static> = TypstQueryTarget::Query {
    selector: NOTES_FILE_LABEL,
    field: Some("value"),
};

fn as_array(value: Option<&Value>) -> Value {
    match value {
        Some(Value::Array(items)) => Value::Array(items.clone()),
        _ => Value::Array(Vec::new()),
    }
}

pub(crate) fn notes_from_eval(output: &Value) -> TypstSlideNotes {
    TypstSlideNotes {
        located: true,
        notes: as_array(output.get("notes")),
        files: as_array(output.get("files")),
    }
}

pub(crate) fn notes_from_query(notes: &Value, files: &Value) -> TypstSlideNotes {
    let values = match notes {
        Value::Array(items) => items
            .iter()
            .map(|item| item.get("value").cloned().unwrap_or(Value::Null))
            .collect(),
        _ => Vec::new(),
    };
    TypstSlideNotes {
        located: false,
        notes: Value::Array(values),
        files: as_array(Some(files)),
    }
}

fn is_error_line(line: &str) -> bool {
    line.starts_with("error:") || line.contains(": error: ")
}

pub(crate) fn failure_message(stderr: &str) -> String {
    let detail = stderr
        .lines()
        .map(str::trim)
        .find(|line| is_error_line(line))
        .or_else(|| stderr.lines().map(str::trim).find(|line| !line.is_empty()))
        .unwrap_or("Typst could not read the speaker notes.");
    detail.chars().take(MAX_ERROR_CHARS).collect()
}

fn run_json(
    context: &TypstQueryContext<'_>,
    target: &TypstQueryTarget<'_>,
    timeout: Duration,
) -> Result<Value, String> {
    let output = crate::typst_query::run_query(context, target, timeout).map_err(|error| {
        if error.kind() == std::io::ErrorKind::TimedOut {
            "Typst took too long to read the speaker notes.".to_string()
        } else {
            format!("failed to run Typst: {error}")
        }
    })?;
    if !output.status.success() {
        return Err(failure_message(&String::from_utf8_lossy(&output.stderr)));
    }
    if output.stdout.len() > MAX_NOTES_JSON_BYTES {
        return Err("The speaker notes are too large to show.".into());
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|_| "Typst returned speaker notes that could not be read.".to_string())
}

pub(crate) fn collect_notes(
    context: &TypstQueryContext<'_>,
    timeout: Duration,
) -> Result<TypstSlideNotes, String> {
    if supports_located_notes(&context.typst.version) {
        let output = run_json(context, &LOCATED_NOTES, timeout)?;
        return Ok(notes_from_eval(&output));
    }
    let notes = run_json(context, &NOTES_QUERY, timeout)?;
    let files = run_json(context, &NOTES_FILE_QUERY, timeout)?;
    Ok(notes_from_query(&notes, &files))
}

pub(crate) fn notes_for_project(
    project: &crate::typst_query::ProjectTypst,
    offline: bool,
) -> Result<Option<TypstSlideNotes>, String> {
    if !project.root.join(&project.main_doc).is_file() {
        return Ok(None);
    }
    collect_notes(&project.context(offline), NOTES_TIMEOUT).map(Some)
}

fn slide_notes_blocking(
    project_id: &str,
    offline: bool,
    variant: Option<&str>,
) -> Result<Option<TypstSlideNotes>, String> {
    let Some(project) = crate::typst_query::project_typst(project_id, variant)? else {
        return Ok(None);
    };
    notes_for_project(&project, offline)
}

#[tauri::command]
pub async fn typst_slide_notes(
    project_id: String,
    offline: Option<bool>,
    typst_variant: Option<String>,
) -> Result<Option<TypstSlideNotes>, String> {
    let offline = offline.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        slide_notes_blocking(&project_id, offline, typst_variant.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_core::typst_toolchain::{
        capabilities_for, ResolvedTypst, TypstCompileFlag, TypstSource,
    };
    use serde_json::json;
    use std::ffi::OsString;
    use std::path::{Path, PathBuf};

    fn strings(args: &[OsString]) -> Vec<String> {
        args.iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    fn packages() -> Vec<TypstCompileFlag> {
        vec![
            TypstCompileFlag::PackagePath(PathBuf::from("/data/packages")),
            TypstCompileFlag::PackageCachePath(PathBuf::from("/data/cache")),
        ]
    }

    #[test]
    fn located_notes_need_typst_0_15() {
        assert!(!supports_located_notes(
            &ToolchainVersion::parse("0.14.2").unwrap()
        ));
        assert!(supports_located_notes(
            &ToolchainVersion::parse("0.15.0").unwrap()
        ));
        assert!(supports_located_notes(
            &ToolchainVersion::parse("1.0.0").unwrap()
        ));
    }

    #[test]
    fn located_notes_use_eval_in_the_main_document() {
        let args = crate::typst_query::query_args(
            &LOCATED_NOTES,
            capabilities_for("0.15.1"),
            Path::new("/project"),
            "main.typ",
            &packages(),
        );
        assert_eq!(
            strings(&args),
            vec![
                "--color=never",
                "eval",
                "--in",
                "main.typ",
                "--root",
                "/project",
                "--format",
                "json",
                "--diagnostic-format",
                "short",
                "--package-path",
                "/data/packages",
                "--package-cache-path",
                "/data/cache",
                "--",
                LOCATED_NOTES_EXPRESSION,
            ]
        );
    }

    #[test]
    fn older_typst_queries_labels_without_flags_it_lacks() {
        let args = crate::typst_query::query_args(
            &NOTES_FILE_QUERY,
            capabilities_for("0.11.1"),
            Path::new("/project"),
            "main.typ",
            &packages(),
        );
        assert_eq!(
            strings(&args),
            vec![
                "query",
                "main.typ",
                "<pdfpc-file>",
                "--field",
                "value",
                "--root",
                "/project",
                "--format",
                "json",
                "--diagnostic-format",
                "short",
            ]
        );
    }

    #[test]
    fn eval_output_keeps_pages_and_pdfpc_files() {
        let output = json!({
            "notes": [{"page": 2, "value": {"notes": "Hello"}}],
            "files": [{"pdfpcFormat": 2, "pages": []}],
        });
        let notes = notes_from_eval(&output);
        assert!(notes.located);
        assert_eq!(
            notes.notes,
            json!([{"page": 2, "value": {"notes": "Hello"}}])
        );
        assert_eq!(notes.files, json!([{"pdfpcFormat": 2, "pages": []}]));
        assert_eq!(
            notes_from_eval(&json!({})),
            TypstSlideNotes {
                located: true,
                notes: json!([]),
                files: json!([]),
            }
        );
    }

    #[test]
    fn query_output_keeps_values_in_document_order() {
        let notes = notes_from_query(
            &json!([
                {"func": "metadata", "value": {"t": "Idx", "v": 0}, "label": "<pdfpc>"},
                {"func": "metadata", "value": {"t": "Note", "v": "First"}, "label": "<pdfpc>"},
                {"func": "text", "text": "stray", "label": "<pdfpc>"},
            ]),
            &json!(null),
        );
        assert!(!notes.located);
        assert_eq!(
            notes.notes,
            json!([{"t": "Idx", "v": 0}, {"t": "Note", "v": "First"}, null])
        );
        assert_eq!(notes.files, json!([]));
    }

    #[test]
    fn failures_report_the_first_typst_error() {
        assert_eq!(
            failure_message("warning: x\nerror: file not found\n  hint"),
            "error: file not found"
        );
        assert_eq!(
            failure_message(
                "main.typ:1:2: warning: unused\nmain.typ:4:1: error: unknown variable: x\n"
            ),
            "main.typ:4:1: error: unknown variable: x"
        );
        assert_eq!(failure_message("\n  boom  \n"), "boom");
        assert_eq!(
            failure_message(""),
            "Typst could not read the speaker notes."
        );
        assert_eq!(failure_message(&"e".repeat(900)).chars().count(), 400);
    }

    #[cfg(unix)]
    fn recording_typst(directory: &Path) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let script = directory.join("typst");
        std::fs::write(
            &script,
            "#!/bin/sh\nhere=$(dirname \"$0\")\nprintf '%s\\n' \"$@\" > \"$here/args\"\nprintf '%s' \"$HTTPS_PROXY\" > \"$here/proxy\"\nprintf '{\"notes\":[{\"page\":1,\"value\":\"Hi\"}],\"files\":[]}'\n",
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        script
    }

    #[cfg(unix)]
    #[test]
    fn notes_follow_the_chosen_variant_and_offline_mode() {
        use crate::typst_options::TypstCompileSettings;
        let tools = tempfile::tempdir().unwrap();
        let typst = recording_typst(tools.path());
        let project = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("main.typ"), "= Slides\n").unwrap();
        let spec: oleafly_core::TypstSpec = serde_json::from_value(json!({
            "inputs": {"anonymous": "false"},
            "variants": {"review": {"inputs": {"anonymous": "true"}}}
        }))
        .unwrap();
        let resolved = std::sync::Arc::new(ResolvedTypst {
            path: typst,
            capabilities: capabilities_for("0.15.1").clone(),
            version: ToolchainVersion::parse("0.15.1").unwrap(),
            source: TypstSource::System,
        });
        let project_typst = |variant: Option<&str>| crate::typst_query::ProjectTypst {
            typst: resolved.clone(),
            root: project.path().to_path_buf(),
            main_doc: "main.typ".into(),
            packages: None,
            settings: Some(TypstCompileSettings::resolve(
                Some(&spec),
                project.path(),
                variant,
                |_| None,
            )),
        };
        let recorded = |name: &str| std::fs::read_to_string(tools.path().join(name)).unwrap();

        let notes = notes_for_project(&project_typst(Some("review")), true)
            .unwrap()
            .unwrap();
        assert_eq!(notes.notes, json!([{"page": 1, "value": "Hi"}]));
        let args = recorded("args");
        assert!(args.contains("--input\nanonymous=true\n"), "{args}");
        assert_eq!(recorded("proxy"), "http://127.0.0.1:9");

        notes_for_project(&project_typst(None), false)
            .unwrap()
            .unwrap();
        let args = recorded("args");
        assert!(args.contains("--input\nanonymous=false\n"), "{args}");
        assert_ne!(recorded("proxy"), "http://127.0.0.1:9");

        std::fs::remove_file(project.path().join("main.typ")).unwrap();
        assert_eq!(notes_for_project(&project_typst(None), false), Ok(None));
    }

    fn local_typst() -> Option<PathBuf> {
        let triple = crate::biber_toolchain::host_triple_guess()?;
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("typst-{triple}{}", std::env::consts::EXE_SUFFIX));
        path.is_file().then_some(path)
    }

    #[test]
    #[ignore = "runs the staged Typst sidecar"]
    fn real_typst_reads_notes_with_their_pages() {
        let Some(path) = local_typst() else {
            eprintln!("Typst sidecar is not staged; skipping");
            return;
        };
        let version = oleafly_core::typst_toolchain::bundled_typst_version().clone();
        let typst = ResolvedTypst {
            path,
            capabilities: capabilities_for(&version.to_string()).clone(),
            version,
            source: TypstSource::Bundled,
        };
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(
            directory.path().join("main.typ"),
            "#set page(width: 100pt, height: 60pt)\nOne\n#metadata((notes: \"Open with the question\")) <pdfpc>\n#pagebreak()\nTwo\n#metadata((t: \"Note\", v: \"Show the chart\")) <pdfpc>\n",
        )
        .unwrap();
        let context = TypstQueryContext {
            typst: &typst,
            root: directory.path(),
            main_doc: "main.typ",
            packages: None,
            settings: None,
            offline: true,
        };
        let notes = collect_notes(&context, NOTES_TIMEOUT).unwrap();
        assert!(notes.located);
        assert_eq!(
            notes.notes,
            json!([
                {"page": 1, "value": {"notes": "Open with the question"}},
                {"page": 2, "value": {"t": "Note", "v": "Show the chart"}},
            ])
        );
        assert_eq!(notes.files, json!([]));

        let mut older = typst.clone();
        older.version = ToolchainVersion::parse("0.14.2").unwrap();
        let queried = collect_notes(
            &TypstQueryContext {
                typst: &older,
                ..context
            },
            NOTES_TIMEOUT,
        )
        .unwrap();
        assert!(!queried.located);
        assert_eq!(
            queried.notes,
            json!([
                {"notes": "Open with the question"},
                {"t": "Note", "v": "Show the chart"},
            ])
        );
        assert_eq!(queried.files, json!([]));
    }
}
