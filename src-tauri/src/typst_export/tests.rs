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
        offline: false,
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
            tauri::async_runtime::block_on(render_export(&run, &request, staging.path()))
                .unwrap()
                .files;
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
    let html = tauri::async_runtime::block_on(render_html(&run, staging.path()))
        .unwrap()
        .path;
    let out = TempDir::new().unwrap();
    for (format, name) in [
        ("md", "paper.md"),
        ("docx", "paper.docx"),
        ("epub", "paper.epub"),
    ] {
        let output = out.path().join(name).to_string_lossy().into_owned();
        tauri::async_runtime::block_on(pandoc_from_html(
            &pandoc, &html, &root, format, &output, None,
        ))
        .unwrap_or_else(|error| panic!("{format}: {error}"));
        assert!(std::fs::metadata(&output).unwrap().len() > 0, "{format}");
    }
    let markdown = std::fs::read_to_string(out.path().join("paper.md")).unwrap();
    assert!(markdown.contains("Page 1 of the draft unset"), "{markdown}");
    assert!(!markdown.contains(":::"), "{markdown}");
}

const LAYOUT_DOCUMENT: &str = "#set page(width: 300pt)\n= Heading\nBody tokenbody#footnote[tokennote].\n\n#align(center)[tokenalign]\n#grid(columns: 2, [tokengrida], [tokengridb], grid.cell(colspan: 2)[tokengridspan], grid.hline())\n#rect[tokenrect]\n#place(top + right)[tokenplace]\n#rotate(10deg)[tokenrotate]\n#columns(2)[tokencolumn]\n#stack(dir: ltr, [tokenstack *bold*], [tokenstacktwo])\n#pad(left: 2pt)[tokenpad]\n#scale(50%)[tokenscale]\n#move(dx: 2pt)[tokenmove]\n#hide[tokenhidden]\n";

const LAYOUT_TOKENS: [&str; 12] = [
    "tokenbody",
    "tokennote",
    "tokenalign",
    "tokengrida",
    "tokengridb",
    "tokengridspan",
    "tokenrect",
    "tokenplace",
    "tokenrotate",
    "tokencolumn",
    "tokenstack",
    "tokenpad",
];

fn zip_entry(file: &Path, entry: &str) -> String {
    use std::io::Read;
    let mut archive = zip::ZipArchive::new(std::fs::File::open(file).unwrap()).unwrap();
    let mut text = String::new();
    archive
        .by_name(entry)
        .unwrap()
        .read_to_string(&mut text)
        .unwrap();
    text
}

#[test]
fn layout_elements_keep_their_text_in_conversion_exports() {
    let (Some(typst), Some(pandoc)) = (sidecar("typst"), sidecar("pandoc")) else {
        return;
    };
    let (_directory, root) = project();
    std::fs::write(root.join("main.typ"), LAYOUT_DOCUMENT).unwrap();
    let settings = TypstCompileSettings::default();
    let run = bundled_run(&typst, &root, &settings);
    let staging = TempDir::new().unwrap();
    let rendered = tauri::async_runtime::block_on(render_html(&run, staging.path())).unwrap();
    assert!(
        oleafly_core::typst_html::skipped_html_elements(&rendered.log).is_empty(),
        "{}",
        rendered.log
    );
    let out = TempDir::new().unwrap();
    let markdown_path = out.path().join("paper.md");
    let docx_path = out.path().join("paper.docx");
    for (format, path) in [("md", &markdown_path), ("docx", &docx_path)] {
        let output = path.to_string_lossy().into_owned();
        tauri::async_runtime::block_on(pandoc_from_html(
            &pandoc,
            &rendered.path,
            &root,
            format,
            &output,
            None,
        ))
        .unwrap_or_else(|error| panic!("{format}: {error}"));
    }
    let markdown = std::fs::read_to_string(&markdown_path).unwrap();
    for token in LAYOUT_TOKENS {
        assert!(markdown.contains(token), "{token}: {markdown}");
    }
    assert!(!markdown.contains("tokenhidden"), "{markdown}");
    let body = zip_entry(&docx_path, "word/document.xml");
    let notes = zip_entry(&docx_path, "word/footnotes.xml");
    assert!(notes.contains("tokennote"), "{notes}");
    for token in LAYOUT_TOKENS.iter().filter(|token| **token != "tokennote") {
        assert!(body.contains(token), "{token}: {body}");
    }
}

fn assert_html_entry_reaches(typst: &Path, folder: &str) {
    let (_directory, root) = project();
    let chapters = root.join(folder);
    std::fs::create_dir_all(&chapters).unwrap();
    std::fs::write(chapters.join("note.txt"), "tokenfile").unwrap();
    std::fs::write(
        chapters.join("main.typ"),
        "#align(center)[tokenaligned]\n#read(\"note.txt\")\n",
    )
    .unwrap();
    let settings = TypstCompileSettings::default();
    let main_doc = format!("{folder}/main.typ");
    let run = TypstRun {
        main_doc: &main_doc,
        ..bundled_run(typst, &root, &settings)
    };
    let staging = TempDir::new().unwrap();
    let rendered = tauri::async_runtime::block_on(render_html(&run, staging.path())).unwrap();
    let html = std::fs::read_to_string(&rendered.path).unwrap();
    assert!(html.contains("tokenaligned"), "{html}");
    assert!(html.contains("tokenfile"), "{html}");
}

#[test]
fn html_entry_reaches_a_main_document_in_a_folder() {
    let Some(typst) = sidecar("typst") else {
        return;
    };
    assert_html_entry_reaches(&typst, "my chapters 논문");
}

#[cfg(unix)]
#[test]
fn html_entry_reaches_a_folder_with_quotes_in_its_name() {
    let Some(typst) = sidecar("typst") else {
        return;
    };
    assert_html_entry_reaches(&typst, "my \"chapters\"");
}

#[test]
fn drawings_in_html_frames_keep_their_shapes_and_colours() {
    let Some(typst) = sidecar("typst") else {
        return;
    };
    let (_directory, root) = project();
    std::fs::write(
        root.join("main.typ"),
        "#html.frame(box(width: 4cm, height: 3cm, {\n  place(rect(width: 1cm, height: 1cm, fill: red))\n  place(dx: 1cm, circle(radius: 3mm, fill: blue))\n  place(dy: 1cm, rotate(10deg, square(size: 5mm, fill: green)))\n}))\n#align(center)[tokenaligned]\n",
    )
    .unwrap();
    let settings = TypstCompileSettings::default();
    let run = bundled_run(&typst, &root, &settings);
    let staging = TempDir::new().unwrap();
    let rendered = tauri::async_runtime::block_on(render_html(&run, staging.path())).unwrap();
    let html = std::fs::read_to_string(&rendered.path).unwrap();
    for colour in ["#ff4136", "#0074d9", "#2ecc40"] {
        assert!(html.contains(colour), "{colour}: {html}");
    }
    assert!(html.contains("tokenaligned"), "{html}");
}

#[test]
fn a_document_the_wrapper_breaks_still_exports_directly() {
    let Some(typst) = sidecar("typst") else {
        return;
    };
    let (_directory, root) = project();
    std::fs::write(
        root.join("main.typ"),
        "#show parbreak: it => panic(\"no paragraph breaks here\")\ntokenbody\n#grid(columns: 2, [tokena], [tokenb])\n",
    )
    .unwrap();
    let settings = TypstCompileSettings::default();
    let run = bundled_run(&typst, &root, &settings);
    let staging = TempDir::new().unwrap();
    let rendered = tauri::async_runtime::block_on(render_html(&run, staging.path())).unwrap();
    assert!(std::fs::read_to_string(&rendered.path)
        .unwrap()
        .contains("tokenbody"));
    assert_eq!(
        oleafly_core::typst_html::skipped_html_elements(&rendered.log),
        ["grid"],
        "{}",
        rendered.log
    );
}

#[test]
fn a_broken_document_reports_where_it_failed() {
    let Some(typst) = sidecar("typst") else {
        return;
    };
    let (_directory, root) = project();
    std::fs::write(root.join("main.typ"), "#unknown-thing()\n").unwrap();
    let settings = TypstCompileSettings::default();
    let run = bundled_run(&typst, &root, &settings);
    let staging = TempDir::new().unwrap();
    let error = tauri::async_runtime::block_on(render_html(&run, staging.path())).unwrap_err();
    assert!(error.contains("typst_export.failed"), "{error}");
    assert!(error.contains("main.typ:1:"), "{error}");
}

fn tiny_png() -> Vec<u8> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
        .unwrap()
}

#[test]
fn latex_exports_keep_images_in_a_folder_beside_the_file() {
    let (Some(typst), Some(pandoc)) = (sidecar("typst"), sidecar("pandoc")) else {
        return;
    };
    let (_directory, root) = project();
    std::fs::write(root.join("dot.png"), tiny_png()).unwrap();
    std::fs::write(
        root.join("shape.svg"),
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"50\"><rect width=\"100\" height=\"50\" fill=\"blue\"/></svg>",
    )
    .unwrap();
    std::fs::write(
        root.join("main.typ"),
        "#figure(image(\"dot.png\", width: 80%), caption: [Dot])\n#image(\"shape.svg\", width: 5cm)\n#image(\"dot.png\")\n",
    )
    .unwrap();
    let settings = TypstCompileSettings::default();
    let run = bundled_run(&typst, &root, &settings);
    let staging = TempDir::new().unwrap();
    let rendered = tauri::async_runtime::block_on(render_html(&run, staging.path())).unwrap();
    stage_images_filter(staging.path()).unwrap();

    let out = TempDir::new().unwrap();
    let destination = out.path().join("50% draft.tex");
    let staged_tex = out.path().join("staged-output.tex");
    let folder = media_folder_name(&destination);
    assert_eq!(folder, "50__draft-media");
    tauri::async_runtime::block_on(pandoc_from_html(
        &pandoc,
        &rendered.path,
        &root,
        "tex",
        &staged_tex.to_string_lossy(),
        Some(&folder),
    ))
    .unwrap();
    let capabilities =
        capabilities_for(&oleafly_core::typst_toolchain::bundled_typst_version().to_string());
    let media = LatexMedia {
        typst: &typst,
        capabilities,
        staging: staging.path(),
        folder: &folder,
        tex: &staged_tex,
    };
    tauri::async_runtime::block_on(finish_latex_media(&crate::project::AppToolRunner, &media))
        .unwrap();
    tauri::async_runtime::block_on(publish_media(
        &staging.path().join(&folder),
        &destination,
        &root,
    ))
    .unwrap();

    let tex = std::fs::read_to_string(&staged_tex).unwrap();
    assert!(tex.contains("\\includegraphics"), "{tex}");
    assert!(tex.contains("width=0.8\\linewidth"), "{tex}");
    assert!(tex.contains("width=141.7323pt"), "{tex}");
    assert!(tex.contains(&format!("{{{folder}/")), "{tex}");
    assert!(!tex.contains("\\includesvg"), "{tex}");
    assert!(!tex.contains("\\usepackage{svg}"), "{tex}");
    assert!(!tex.contains("12.5in"), "{tex}");

    let names: Vec<String> = std::fs::read_dir(out.path().join(&folder))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(names.iter().any(|name| name.ends_with(".png")), "{names:?}");
    assert!(names.iter().any(|name| name.ends_with(".pdf")), "{names:?}");
    assert!(
        !names.iter().any(|name| name.ends_with(".svg")),
        "{names:?}"
    );
    for name in &names {
        assert!(tex.contains(&format!("{folder}/{name}}}")), "{name}: {tex}");
    }
}

#[test]
fn latex_exports_ignore_images_that_did_not_come_from_typst() {
    let (Some(typst), Some(pandoc)) = (sidecar("typst"), sidecar("pandoc")) else {
        return;
    };
    let (directory, root) = project();
    let secret = directory.path().join("secret.txt");
    std::fs::write(&secret, "not for export").unwrap();
    let path = secret.to_string_lossy().replace('\\', "/");
    std::fs::write(
        root.join("main.typ"),
        format!("#html.elem(\"img\", attrs: (src: \"{path}\"))\ntokenbody\n"),
    )
    .unwrap();
    let settings = TypstCompileSettings::default();
    let run = bundled_run(&typst, &root, &settings);
    let staging = TempDir::new().unwrap();
    let rendered = tauri::async_runtime::block_on(render_html(&run, staging.path())).unwrap();
    stage_images_filter(staging.path()).unwrap();
    let staged_tex = staging.path().join("export.tex");
    tauri::async_runtime::block_on(pandoc_from_html(
        &pandoc,
        &rendered.path,
        &root,
        "tex",
        &staged_tex.to_string_lossy(),
        Some("paper-media"),
    ))
    .unwrap();
    assert!(!staging.path().join("paper-media").exists());
    let tex = std::fs::read_to_string(&staged_tex).unwrap();
    assert!(tex.contains("tokenbody"), "{tex}");
    assert!(!tex.contains("secret"), "{tex}");
}

#[test]
fn latex_from_the_source_reader_copies_only_project_images() {
    let Some(pandoc) = sidecar("pandoc") else {
        return;
    };
    let (directory, root) = project();
    let outside = directory.path().join("outside.png");
    std::fs::write(&outside, "not for export").unwrap();
    std::fs::create_dir_all(root.join("figs")).unwrap();
    std::fs::write(root.join("figs/dot.png"), tiny_png()).unwrap();
    let mut second = tiny_png();
    second.push(0);
    std::fs::write(root.join("figs/second.png"), second).unwrap();
    let outside_path = outside.to_string_lossy().replace('\\', "/");
    std::fs::write(
        root.join("main.typ"),
        format!(
            "Equation $x^2$.\n#image(\"figs/dot.png\")\n#image(\"/figs/second.png\")\n#image(\"../outside.png\")\n#image(\"{outside_path}\")\n"
        ),
    )
    .unwrap();

    let out = TempDir::new().unwrap();
    let destination = out.path().join("paper.tex");
    let staged_tex = out.path().join("staged-output.tex");
    let output = staged_tex.to_string_lossy().into_owned();
    let media = ReaderMedia {
        staging: TempDir::new().unwrap(),
        folder: media_folder_name(&destination),
        typst: None,
    };
    tauri::async_runtime::block_on(oleafly_doctools::export::run_export_with_media(
        &crate::project::AppToolRunner,
        &pandoc,
        oleafly_doctools::export::ExportJob {
            root: &root,
            build_dir: None,
            main_doc: "main.typ",
            format: "tex",
            output: &output,
            staging_dir: None,
            temp_dir: None,
            typst: None,
        },
        Some(media.source_media()),
    ))
    .unwrap();
    let job = HtmlExport {
        project_id: "unused",
        root: &root,
        main_doc: "main.typ",
        format: "tex",
        pandoc: &pandoc,
        output: &output,
        destination: &destination,
        variant: None,
        offline: false,
    };
    tauri::async_runtime::block_on(media.publish(&job)).unwrap();

    let tex = std::fs::read_to_string(&staged_tex).unwrap();
    assert!(tex.contains("x^{2}"), "{tex}");
    assert_eq!(tex.matches("{paper-media/").count(), 2, "{tex}");
    assert!(!tex.contains("outside"), "{tex}");
    let copied = media_files(&out.path().join("paper-media"));
    assert_eq!(copied.len(), 2, "{copied:?}");
    for image in copied {
        assert_ne!(std::fs::read(image).unwrap(), b"not for export");
    }
}

#[test]
fn only_a_lossy_route_reports_the_source_read() {
    let version = oleafly_core::typst_toolchain::ToolchainVersion::parse("0.14.2").unwrap();
    let route = Ok(HtmlRoute::Lossy(StagedHtml {
        staging: TempDir::new().unwrap(),
        html: PathBuf::from("document.html"),
        typst: std::sync::Arc::new(ResolvedTypst {
            path: PathBuf::from("typst"),
            version,
            source: oleafly_core::typst_toolchain::TypstSource::Bundled,
            capabilities: capabilities_for("0.14.2").clone(),
        }),
        notes: TypstHtmlNotes::default(),
    }));
    assert_eq!(
        notes_after_reader(&route).read_from_source.as_deref(),
        Some("0.14.2")
    );
    assert_eq!(
        notes_after_reader(&Ok(HtmlRoute::Unused)),
        TypstHtmlNotes::default()
    );
    assert_eq!(
        notes_after_reader(&Err("no Typst".to_owned())),
        TypstHtmlNotes::default()
    );
}

#[test]
fn a_latex_export_without_images_writes_no_folder() {
    let out = TempDir::new().unwrap();
    let staging = TempDir::new().unwrap();
    let destination = out.path().join("paper.tex");
    tauri::async_runtime::block_on(publish_media(
        &staging.path().join("paper-media"),
        &destination,
        Path::new("/not/this/project"),
    ))
    .unwrap();
    assert!(!out.path().join("paper-media").exists());
}

#[test]
fn offline_exports_cannot_reach_the_package_registry() {
    let packages = vec![("TYPST_PACKAGE_PATH".to_owned(), "/data".to_owned())];
    assert_eq!(offline_aware(packages.clone(), false), packages);
    let offline = offline_aware(packages.clone(), true);
    assert_eq!(offline[0], packages[0]);
    for (name, value) in crate::typst_packages::offline_environment() {
        assert!(
            offline
                .iter()
                .any(|(known, set)| known == name && set == value),
            "{name}"
        );
    }
}

#[test]
fn offline_requests_read_from_the_frontend() {
    let parsed: TypstExportRequest =
        serde_json::from_value(serde_json::json!({"format": "svg", "offline": true})).unwrap();
    assert!(parsed.offline);
    let online: TypstExportRequest =
        serde_json::from_value(serde_json::json!({"format": "svg"})).unwrap();
    assert!(!online.offline);
}

#[test]
fn export_results_carry_their_notes_next_to_the_files() {
    let result = TypstExportResult {
        files: vec!["/out/a.html".into()],
        notes: TypstHtmlNotes {
            skipped: vec!["layout".into()],
            ..TypstHtmlNotes::default()
        },
    };
    assert_eq!(
        serde_json::to_value(result).unwrap(),
        serde_json::json!({
            "files": ["/out/a.html"],
            "skipped": ["layout"],
            "outdatedTypst": null,
            "readFromSource": null,
        })
    );
}

fn pinned_typst(version: &str) -> Option<PathBuf> {
    let path =
        PathBuf::from(std::env::var_os("OLEAFLY_TEST_TYPST_DIR")?).join(format!("typst-{version}"));
    path.is_file().then_some(path)
}

#[test]
fn older_typst_html_is_flagged_only_when_it_lost_content() {
    for version in ["0.13.1", "0.14.2"] {
        let Some(typst) = pinned_typst(version) else {
            continue;
        };
        let (_directory, root) = project();
        let settings = TypstCompileSettings::default();
        let run = TypstRun {
            capabilities: capabilities_for(version),
            ..bundled_run(&typst, &root, &settings)
        };
        let parsed = oleafly_core::typst_toolchain::ToolchainVersion::parse(version).unwrap();
        let notes_for = |source: &str| {
            std::fs::write(root.join("main.typ"), source).unwrap();
            let staging = TempDir::new().unwrap();
            let rendered =
                tauri::async_runtime::block_on(render_html(&run, staging.path())).unwrap();
            html_export_notes(&parsed, &rendered.log)
        };
        assert_eq!(
            notes_for("= Title\nPlain text.\n"),
            TypstHtmlNotes::default(),
            "{version}"
        );
        assert_eq!(
            notes_for("= Title\n$ x^2 $\n").outdated_typst.as_deref(),
            Some(version)
        );
        let layout = notes_for("#layout(size => [text])\n");
        assert!(html_lost_content(&parsed, &layout), "{version}");
        if version == "0.14.2" {
            assert_eq!(layout.skipped, ["layout"]);
            assert_eq!(layout.outdated_typst, None);
        }
    }
    if let Some(typst) = pinned_typst("0.13.1") {
        let (_directory, root) = project();
        std::fs::write(root.join("main.typ"), "Text#footnote[tokennote].\n").unwrap();
        let settings = TypstCompileSettings::default();
        let run = TypstRun {
            capabilities: capabilities_for("0.13.1"),
            ..bundled_run(&typst, &root, &settings)
        };
        let parsed = oleafly_core::typst_toolchain::ToolchainVersion::parse("0.13.1").unwrap();
        let staging = TempDir::new().unwrap();
        let rendered = tauri::async_runtime::block_on(render_html(&run, staging.path())).unwrap();
        let notes = html_export_notes(&parsed, &rendered.log);
        assert_eq!(notes.outdated_typst.as_deref(), Some("0.13.1"));
        assert!(html_lost_content(&parsed, &notes));
    }
}

#[test]
fn typst_0_11_writes_numbered_pages_with_its_own_template() {
    let Some(typst) = pinned_typst("0.11.1") else {
        return;
    };
    let (_directory, root) = project();
    std::fs::write(
        root.join("main.typ"),
        "#set page(width: 100pt, height: 100pt)\nOne\n#pagebreak()\nTwo\n",
    )
    .unwrap();
    let settings = TypstCompileSettings::default();
    let run = TypstRun {
        capabilities: capabilities_for("0.11.1"),
        ..bundled_run(&typst, &root, &settings)
    };
    let staging = TempDir::new().unwrap();
    let rendered = tauri::async_runtime::block_on(render_export(
        &run,
        &TypstExportRequest {
            ppi: Some(72),
            ..request(TypstExportFormat::Png)
        },
        staging.path(),
    ))
    .unwrap();
    assert_eq!(rendered.files.len(), 2);

    std::fs::write(root.join("main.typ"), "#set page(width: 100pt)\nOne\n").unwrap();
    let staging = TempDir::new().unwrap();
    let rendered = tauri::async_runtime::block_on(render_export(
        &run,
        &request(TypstExportFormat::Svg),
        staging.path(),
    ))
    .unwrap();
    assert_eq!(rendered.files.len(), 1);
}
