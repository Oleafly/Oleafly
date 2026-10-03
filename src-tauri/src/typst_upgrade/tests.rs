use super::*;

use std::path::PathBuf;
use std::sync::Mutex;

use crate::document_engine::CompileTarget;

fn error(kind: &str, file: &str, line: u32, message: &str) -> CompileError {
    CompileError {
        kind: kind.into(),
        file: Some(file.into()),
        line: Some(line),
        message: message.into(),
        ..CompileError::default()
    }
}

#[test]
fn page_counts_come_from_the_root_page_tree() {
    let compact = b"%PDF-1.7\n3 0 obj\n<</Type/Pages/Count 4/Kids[5 0 R 6 0 R 7 0 R 8 0 R]>>\nendobj\n5 0 obj\n<</Type/Page/Parent 3 0 R>>\nendobj\n%%EOF\n";
    assert_eq!(pdf_page_count(compact), Some(4));
    let spaced = b"%PDF-1.4\n1 0 obj\n<< /Type /Pages\n /Kids [2 0 R 9 0 R]\n /Count 12 >>\nendobj\n2 0 obj\n<< /Type /Pages /Parent 1 0 R /Kids [3 0 R] /Count 5 >>\nendobj\n%%EOF";
    assert_eq!(pdf_page_count(spaced), Some(12));
    let pages_only = b"%PDF-1.7\n<< /Type /Page /Count 3 >>\n<< /Type /Outlines /Count 9 >>\n%%EOF";
    assert_eq!(pdf_page_count(pages_only), None);
    assert_eq!(pdf_page_count(b"not a pdf"), None);
}

#[test]
fn findings_are_matched_by_kind_file_line_and_message() {
    let current = vec![
        error("error", "main.typ", 4, "unknown variable: old"),
        error("warning", "chapters/intro.typ", 2, "unknown font family: a"),
        error("warning", "chapters/intro.typ", 2, "unknown font family: a"),
        error(
            "warning",
            "main.typ",
            9,
            "label `<x>` occurs multiple times",
        ),
    ];
    let candidate = vec![
        error(
            "warning",
            "chapters\\intro.typ",
            2,
            "unknown font family: a",
        ),
        error(
            "warning",
            "main.typ",
            9,
            "label `<x>` occurs multiple times",
        ),
        error(
            "warning",
            "main.typ",
            10,
            "label `<x>` occurs multiple times",
        ),
        error("error", "main.typ", 4, "unknown variable: new"),
    ];
    let diff = diff_findings(&current, &candidate);
    let messages = |findings: &[UpgradeFinding]| {
        findings
            .iter()
            .map(|finding| (finding.kind.clone(), finding.line, finding.message.clone()))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        messages(&diff.added),
        vec![
            (
                "error".to_string(),
                Some(4),
                "unknown variable: new".to_string()
            ),
            (
                "warning".to_string(),
                Some(10),
                "label `<x>` occurs multiple times".to_string()
            ),
        ]
    );
    assert_eq!(
        messages(&diff.removed),
        vec![
            (
                "error".to_string(),
                Some(4),
                "unknown variable: old".to_string()
            ),
            (
                "warning".to_string(),
                Some(2),
                "unknown font family: a".to_string()
            ),
        ]
    );
    assert_eq!(diff.unchanged, 2);
}

struct FakeCompiler {
    outputs: Mutex<HashMap<String, UpgradeOutput>>,
    calls: Mutex<Vec<String>>,
}

impl UpgradeCompiler for FakeCompiler {
    fn compile(&self, typst: Arc<ResolvedTypst>) -> BoxFuture<Result<UpgradeOutput, String>> {
        let version = typst.version.to_string();
        self.calls.lock().unwrap().push(version.clone());
        let output = self
            .outputs
            .lock()
            .unwrap()
            .remove(&version)
            .ok_or_else(|| format!("no fake output for {version}"));
        Box::pin(async move { output })
    }
}

fn resolved(version: &str) -> Arc<ResolvedTypst> {
    Arc::new(ResolvedTypst {
        path: PathBuf::from(format!("/toolchains/typst/{version}/typst")),
        version: ToolchainVersion::parse(version).unwrap(),
        source: oleafly_core::typst_toolchain::TypstSource::Downloaded,
        capabilities: oleafly_core::typst_toolchain::capabilities_for(version).clone(),
    })
}

fn output(ok: bool, pages: Option<u32>, errors: Vec<CompileError>) -> UpgradeOutput {
    UpgradeOutput {
        ok,
        pages,
        errors,
        compile_time_ms: 12,
        log: String::new(),
    }
}

#[tokio::test]
async fn the_report_compares_both_runs_and_compiles_the_pinned_version_first() {
    let compiler = FakeCompiler {
        outputs: Mutex::new(HashMap::from([
            (
                "0.13.1".to_string(),
                output(
                    true,
                    Some(10),
                    vec![error("warning", "main.typ", 3, "deprecated: use x")],
                ),
            ),
            (
                "0.15.1".to_string(),
                output(
                    false,
                    Some(11),
                    vec![
                        error("error", "main.typ", 7, "unknown function: oldfn"),
                        error("warning", "main.typ", 8, "new warning"),
                    ],
                ),
            ),
        ])),
        calls: Mutex::new(Vec::new()),
    };
    let report = compare(&compiler, resolved("0.13.1"), resolved("0.15.1"))
        .await
        .unwrap();
    assert_eq!(*compiler.calls.lock().unwrap(), vec!["0.13.1", "0.15.1"]);
    assert_eq!(report.current.version, "0.13.1");
    assert_eq!(report.current.pages, Some(10));
    assert_eq!((report.current.errors, report.current.warnings), (0, 1));
    assert!(report.current.ok);
    assert_eq!(report.candidate.version, "0.15.1");
    assert_eq!(report.candidate.pages, Some(11));
    assert_eq!((report.candidate.errors, report.candidate.warnings), (1, 1));
    assert!(!report.candidate.ok);
    assert_eq!(report.added.len(), 2);
    assert_eq!(report.added[0].kind, "error");
    assert_eq!(report.removed.len(), 1);
    assert_eq!(report.removed[0].message, "deprecated: use x");
    assert_eq!(report.unchanged, 0);
    let json = serde_json::to_value(&report).unwrap();
    assert_eq!(json["candidate"]["compileTimeMs"], 12);
    assert_eq!(json["added"][0]["file"], "main.typ");
}

#[tokio::test]
async fn only_a_newer_version_can_be_checked() {
    let compiler = FakeCompiler {
        outputs: Mutex::new(HashMap::new()),
        calls: Mutex::new(Vec::new()),
    };
    let same = compare(&compiler, resolved("0.15.1"), resolved("0.15.1")).await;
    assert!(same.is_err());
    let older = compare(&compiler, resolved("0.15.1"), resolved("0.13.1")).await;
    assert!(older.is_err());
    assert!(compiler.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_run_that_fails_without_diagnostics_keeps_the_end_of_its_log() {
    let mut broken = output(false, None, Vec::new());
    broken.log = format!("{}\nfailed to load font file\n", "x".repeat(5000));
    let compiler = FakeCompiler {
        outputs: Mutex::new(HashMap::from([
            ("0.13.1".to_string(), output(true, Some(2), Vec::new())),
            ("0.15.1".to_string(), broken),
        ])),
        calls: Mutex::new(Vec::new()),
    };
    let report = compare(&compiler, resolved("0.13.1"), resolved("0.15.1"))
        .await
        .unwrap();
    assert_eq!(report.current.failure, None);
    let failure = report.candidate.failure.unwrap();
    assert!(failure.ends_with("failed to load font file"));
    assert!(failure.len() <= 2000);
}

fn bundled_typst() -> Option<PathBuf> {
    let target = oleafly_core::typst_toolchain::host_target()?;
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("typst-{target}{suffix}"));
    path.is_file().then_some(path)
}

struct SpecCompiler {
    project: PathBuf,
}

impl UpgradeCompiler for SpecCompiler {
    fn compile(&self, typst: Arc<ResolvedTypst>) -> BoxFuture<Result<UpgradeOutput, String>> {
        let project = self.project.clone();
        Box::pin(async move {
            let output = tempfile::tempdir().map_err(|error| error.to_string())?;
            let engine = crate::document_engine::engine_for("typst", "main.typ")?;
            let spec = engine.compile_spec(
                output.path(),
                &project,
                CompileTarget::Main {
                    main_document: "main.typ",
                },
                CompileOptions {
                    typst: Some(typst),
                    ..CompileOptions::default()
                },
            )?;
            run_spec(spec, "main.typ", &project).await
        })
    }
}

#[tokio::test]
#[ignore = "runs the bundled Typst binary twice"]
async fn real_typst_runs_report_pages_and_matching_diagnostics() {
    let Some(binary) = bundled_typst() else {
        panic!("the bundled Typst sidecar is missing");
    };
    let project = tempfile::tempdir().unwrap();
    std::fs::write(
        project.path().join("main.typ"),
        "#set text(font: \"NoSuchFontForOleafly\")\n= One\n#lorem(30)\n#pagebreak()\n= Two\n#pagebreak()\n= Three\n",
    )
    .unwrap();
    let version = oleafly_core::typst_toolchain::bundled_typst_version().to_string();
    let typst = |label: &str| {
        Arc::new(ResolvedTypst {
            path: binary.clone(),
            version: ToolchainVersion::parse(label).unwrap(),
            source: oleafly_core::typst_toolchain::TypstSource::Downloaded,
            capabilities: oleafly_core::typst_toolchain::capabilities_for(&version).clone(),
        })
    };
    let compiler = SpecCompiler {
        project: project.path().to_owned(),
    };
    let report = compare(&compiler, typst("0.0.1"), typst(&version))
        .await
        .unwrap();
    assert!(report.current.ok && report.candidate.ok);
    assert_eq!(report.current.pages, Some(3));
    assert_eq!(report.candidate.pages, Some(3));
    assert_eq!(report.current.warnings, 1);
    assert!(report.added.is_empty() && report.removed.is_empty());
    assert_eq!(report.unchanged, 1);
    let names: Vec<_> = std::fs::read_dir(project.path())
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name())
        .collect();
    assert_eq!(names, vec![std::ffi::OsString::from("main.typ")]);
}
