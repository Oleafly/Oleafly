use super::*;
use oleafly_core::typst_toolchain::capabilities_for;
use tempfile::TempDir;

fn request(format: TypstExportFormat) -> TypstExportRequest {
    TypstExportRequest {
        format,
        ppi: None,
        pages: None,
        pdf_standard: None,
        variant: None,
    }
}

#[test]
fn each_format_asks_typst_for_the_right_output() {
    assert_eq!(
        export_flags(&request(TypstExportFormat::Png)).unwrap(),
        [
            TypstCompileFlag::Format("png".into()),
            TypstCompileFlag::Ppi(144)
        ]
    );
    assert_eq!(
        export_flags(&TypstExportRequest {
            ppi: Some(300),
            pages: Some("2-3".into()),
            ..request(TypstExportFormat::Png)
        })
        .unwrap(),
        [
            TypstCompileFlag::Format("png".into()),
            TypstCompileFlag::Ppi(300),
            TypstCompileFlag::Pages("2-3".into()),
        ]
    );
    for ppi in [0, 5000] {
        let error = export_flags(&TypstExportRequest {
            ppi: Some(ppi),
            ..request(TypstExportFormat::Png)
        })
        .unwrap_err();
        assert!(error.contains("typst_export.invalid_ppi"), "{error}");
    }
    assert_eq!(
        export_flags(&request(TypstExportFormat::Svg)).unwrap(),
        [TypstCompileFlag::Format("svg".into())]
    );
    assert_eq!(
        export_flags(&TypstExportRequest {
            pages: Some("1".into()),
            ..request(TypstExportFormat::Html)
        })
        .unwrap(),
        [
            TypstCompileFlag::Features("html".into()),
            TypstCompileFlag::Format("html".into())
        ]
    );
    assert_eq!(
        export_flags(&TypstExportRequest {
            pdf_standard: Some(" a-2b ".into()),
            pages: Some(" ".into()),
            ..request(TypstExportFormat::Pdf)
        })
        .unwrap(),
        [TypstCompileFlag::PdfStandard("a-2b".into())]
    );
    assert!(export_flags(&request(TypstExportFormat::Pdf))
        .unwrap()
        .is_empty());
}

#[test]
fn requests_read_camel_case() {
    let parsed: TypstExportRequest = serde_json::from_value(serde_json::json!({
        "format": "pdf",
        "pdfStandard": "ua-1",
        "variant": "final"
    }))
    .unwrap();
    assert_eq!(parsed.format, TypstExportFormat::Pdf);
    assert_eq!(parsed.pdf_standard.as_deref(), Some("ua-1"));
    assert_eq!(parsed.variant.as_deref(), Some("final"));
}

#[test]
fn several_pages_are_numbered_next_to_the_chosen_file() {
    let dest = Path::new("/out/figure.png");
    assert_eq!(
        final_destinations(dest, &[PathBuf::from("/s/page-1.png")]),
        [PathBuf::from("/out/figure.png")]
    );
    assert_eq!(
        final_destinations(
            dest,
            &[
                PathBuf::from("/s/page-01.png"),
                PathBuf::from("/s/page-12.png")
            ]
        ),
        [
            PathBuf::from("/out/figure-01.png"),
            PathBuf::from("/out/figure-12.png")
        ]
    );
}

#[test]
fn failures_report_the_first_error_with_its_hints() {
    let log = "warning: unknown font family: x\n  ┌─ main.typ:1:16\n  │\n1 │ #set text(font: \"x\")\n  │                 ^^^\n\nerror: unknown variable: foo\n  ┌─ main.typ:3:2\n  │\n3 │ $foo$\n  │  ^^^\n  │\n  = hint: if you meant to display multiple letters as is, try adding spaces between each letter: `f o o`\n\n";
    let detail = failure_detail(log);
    assert!(detail.starts_with("main.typ:3:"), "{detail}");
    assert!(detail.contains("unknown variable: foo"), "{detail}");
    assert!(detail.contains("\nHint: if you meant"), "{detail}");
    assert_eq!(failure_detail("\n  boom\n"), "boom");
}

#[test]
fn versions_without_a_format_refuse_before_running_typst() {
    let directory = TempDir::new().unwrap();
    let settings = TypstCompileSettings::default();
    let run = TypstRun {
        typst: Path::new("/definitely/missing/typst"),
        capabilities: capabilities_for("0.11.1"),
        root: directory.path(),
        main_doc: "main.typ",
        settings: &settings,
        environment: Vec::new(),
    };
    let error = tauri::async_runtime::block_on(render_export(
        &run,
        &request(TypstExportFormat::Html),
        directory.path(),
    ))
    .unwrap_err();
    assert!(error.contains("typst_export.unsupported"), "{error}");
    let standard = tauri::async_runtime::block_on(render_export(
        &run,
        &TypstExportRequest {
            pdf_standard: Some("a-2b".into()),
            ..request(TypstExportFormat::Pdf)
        },
        directory.path(),
    ))
    .unwrap_err();
    assert!(standard.contains("--pdf-standard"), "{standard}");
}

#[test]
fn pandoc_reads_typst_html_without_wrapper_divs() {
    let args = pandoc_html_args(
        "docx",
        Path::new("/tmp/x/document.html"),
        Path::new("/project"),
        "/out/paper.docx",
    )
    .unwrap();
    assert_eq!(args[0], "--from=html-native_divs-native_spans");
    assert!(args.contains(&"--to=docx".to_string()));
    assert_eq!(
        args.last().map(String::as_str),
        Some("/tmp/x/document.html")
    );
    assert!(!args.iter().any(|argument| argument.contains("citeproc")));
    assert!(pandoc_html_args("nope", Path::new("a.html"), Path::new("/p"), "o").is_none());
}

fn sidecar(name: &str) -> Option<PathBuf> {
    let triple = crate::biber_toolchain::host_triple_guess()?;
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("{name}-{triple}{}", std::env::consts::EXE_SUFFIX));
    path.is_file().then_some(path)
}

const DOCUMENT: &str = "#set page(width: 200pt, height: 120pt)\n#set document(title: [Export test])\n= First\n\nPage #context counter(page).get().first() of the draft #sys.inputs.at(\"draft\", default: \"unset\").\n\n#pagebreak()\n= Second\n\nMore text $x^2$.\n";

fn project() -> (TempDir, PathBuf) {
    let directory = TempDir::new().unwrap();
    let root = directory.path().join("paper");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("main.typ"), DOCUMENT).unwrap();
    let root = root.canonicalize().unwrap();
    (directory, root)
}

fn bundled_run<'a>(
    typst: &'a Path,
    root: &'a Path,
    settings: &'a TypstCompileSettings,
) -> TypstRun<'a> {
    let version = oleafly_core::typst_toolchain::bundled_typst_version().to_string();
    TypstRun {
        typst,
        capabilities: capabilities_for(&version),
        root,
        main_doc: "main.typ",
        settings,
        environment: Vec::new(),
    }
}

#[test]
fn the_bundled_typst_exports_png_svg_html_and_pdf_a() {
    let Some(typst) = sidecar("typst") else {
        return;
    };
    let (_directory, root) = project();
    let settings = TypstCompileSettings {
        inputs: vec![("draft".into(), "two".into())],
        ..TypstCompileSettings::default()
    };
    let run = bundled_run(&typst, &root, &settings);
    let render = |request: TypstExportRequest| {
        let staging = TempDir::new().unwrap();
        let produced =
            tauri::async_runtime::block_on(render_export(&run, &request, staging.path())).unwrap();
        let bytes: Vec<Vec<u8>> = produced
            .iter()
            .map(|path| std::fs::read(path).unwrap())
            .collect();
        (produced, bytes, staging)
    };

    let (pngs, bytes, _png_dir) = render(TypstExportRequest {
        ppi: Some(72),
        ..request(TypstExportFormat::Png)
    });
    assert_eq!(pngs.len(), 2);
    for png in &bytes {
        assert!(png.starts_with(&[0x89, b'P', b'N', b'G']));
        assert_eq!(u32::from_be_bytes(png[16..20].try_into().unwrap()), 200);
    }
    let (one, _, _one_dir) = render(TypstExportRequest {
        ppi: Some(72),
        pages: Some("2".into()),
        ..request(TypstExportFormat::Png)
    });
    assert_eq!(one.len(), 1);

    let (svgs, bytes, _svg_dir) = render(request(TypstExportFormat::Svg));
    assert_eq!(svgs.len(), 2);
    assert!(bytes
        .iter()
        .all(|svg| String::from_utf8_lossy(svg).contains("<svg")));

    let (html, bytes, _html_dir) = render(request(TypstExportFormat::Html));
    assert_eq!(html.len(), 1);
    let text = String::from_utf8_lossy(&bytes[0]);
    assert!(text.contains("<html"), "{text}");
    assert!(text.contains("draft two"), "{text}");

    let (pdf, bytes, _pdf_dir) = render(TypstExportRequest {
        pdf_standard: Some("a-2b".into()),
        ..request(TypstExportFormat::Pdf)
    });
    assert_eq!(pdf.len(), 1);
    assert!(bytes[0].starts_with(b"%PDF-"));
    let pdf_text = String::from_utf8_lossy(&bytes[0]);
    assert!(
        pdf_text.contains("pdfaid:part"),
        "PDF/A metadata is missing"
    );

    let broken = TypstCompileSettings::default();
    std::fs::write(root.join("main.typ"), "#unknown-thing()\n").unwrap();
    let staging = TempDir::new().unwrap();
    let error = tauri::async_runtime::block_on(render_export(
        &bundled_run(&typst, &root, &broken),
        &request(TypstExportFormat::Svg),
        staging.path(),
    ))
    .unwrap_err();
    assert!(error.contains("typst_export.failed"), "{error}");
    assert!(error.contains("unknown variable: unknown-thing"), "{error}");
}

#[test]
fn typst_html_converts_with_pandoc_where_the_typst_reader_cannot() {
    let (Some(typst), Some(pandoc)) = (sidecar("typst"), sidecar("pandoc")) else {
        return;
    };
    let (_directory, root) = project();
    let settings = TypstCompileSettings::default();
    let run = bundled_run(&typst, &root, &settings);
    let staging = TempDir::new().unwrap();
    let html = tauri::async_runtime::block_on(render_html(&run, staging.path())).unwrap();
    let out = TempDir::new().unwrap();
    for (format, name) in [
        ("md", "paper.md"),
        ("docx", "paper.docx"),
        ("epub", "paper.epub"),
    ] {
        let output = out.path().join(name).to_string_lossy().into_owned();
        tauri::async_runtime::block_on(pandoc_from_html(&pandoc, &html, &root, format, &output))
            .unwrap_or_else(|error| panic!("{format}: {error}"));
        assert!(std::fs::metadata(&output).unwrap().len() > 0, "{format}");
    }
    let markdown = std::fs::read_to_string(out.path().join("paper.md")).unwrap();
    assert!(markdown.contains("Page 1 of the draft unset"), "{markdown}");
    assert!(!markdown.contains(":::"), "{markdown}");
}
