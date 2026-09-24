use oleafly_core::{
    diagnose_image_failures, image_failure_evidence, image_failure_notes, parse_latex_log,
    ImageFinding, ImageFormat, LogCategory, LogSeverity,
};
use std::path::Path;
use tempfile::TempDir;

const CORRUPT_PNG: [u8; 132] = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0xf0, 0x00, 0x00, 0x00, 0x40, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1b, 0x15, 0xe3,
    0xd3, 0x00, 0x00, 0x00, 0x4e, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0xed, 0xd0, 0x31, 0x0d, 0x00,
    0x30, 0x08, 0x04, 0x41, 0x70, 0x9f, 0xed, 0xff, 0x17, 0x01, 0x11, 0x79, 0x2f, 0x60, 0xb5, 0x2c,
    0x5b, 0xb6, 0x6c, 0xd9, 0xb2, 0xa5, 0xad, 0xdf, 0x65, 0xcb, 0x96, 0x2d, 0x5b, 0xb6, 0x6c, 0x65,
    0x91, 0x6c, 0xd9, 0xb2, 0xa5, 0xad, 0x5d, 0x9b, 0xb6, 0x6d, 0xdb, 0xda, 0xb5, 0x65, 0xdb, 0xb6,
    0x6d, 0x6b, 0xd7, 0x96, 0x6d, 0xdb, 0xb6, 0x76, 0x6d, 0xd9, 0xb6, 0x6d, 0xeb, 0x02, 0x9e, 0x0d,
    0x00, 0xe4, 0x5f, 0x5b, 0xba, 0x6b, 0xda, 0x6e, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82,
];

const VALID_PNG: [u8; 153] = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x20, 0x08, 0x00, 0x00, 0x00, 0x00, 0x87, 0xf6, 0x21,
    0x58, 0x00, 0x00, 0x00, 0x60, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x60, 0xe1, 0xe0,
    0x11, 0x10, 0x91, 0x90, 0x51, 0x50, 0xd1, 0xd0, 0x31, 0x30, 0xb1, 0xb0, 0x71, 0x70, 0xf1, 0xf0,
    0x09, 0x08, 0x89, 0x88, 0x49, 0x48, 0xc9, 0xc8, 0x29, 0x28, 0xa9, 0xa8, 0x69, 0x68, 0xe9, 0xe8,
    0x99, 0x30, 0x65, 0xc6, 0x9c, 0x05, 0x4b, 0x56, 0xac, 0xd9, 0xb0, 0x65, 0xc7, 0x9e, 0x03, 0x47,
    0x4e, 0x9c, 0xb9, 0x70, 0xe5, 0xc6, 0x9d, 0x07, 0x4f, 0x5e, 0xbc, 0xf9, 0xf0, 0xe5, 0xc7, 0x1f,
    0x86, 0x51, 0x03, 0x46, 0x0d, 0x18, 0x35, 0x60, 0xd4, 0x80, 0x51, 0x03, 0x46, 0x0d, 0x18, 0x35,
    0x60, 0xb8, 0x19, 0x00, 0x00, 0x4d, 0x9b, 0xf0, 0x2e, 0x5b, 0xf4, 0x57, 0xef, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

const VALID_PNG_IDAT_CRC: usize = 137;

const PNG_HEADER_ONLY: [u8; 33] = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x20, 0x08, 0x00, 0x00, 0x00, 0x00, 0x87, 0xf6, 0x21,
    0x58,
];

const JPEG_HEADER_CUT: [u8; 12] = [
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
];

const WEB_PAGE: &[u8] = b"<!DOCTYPE html>\n<html><body>Not found</body></html>\n";

const PDF_17: &[u8] = b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n107\n%%EOF\n";

fn fixture(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("image-failures")
        .join(format!("{name}.log"));
    std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()))
}

fn crc(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffff_u32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                0xedb8_8320 ^ (crc >> 1)
            } else {
                crc >> 1
            };
        }
    }
    crc ^ 0xffff_ffff
}

fn png_with_bad_filter() -> Vec<u8> {
    let mut rows = vec![0_u8; 32 * 65];
    rows[0] = 9;
    let length = rows.len() as u16;
    let mut data = vec![0x78, 0x01, 0x01];
    data.extend(length.to_le_bytes());
    data.extend((!length).to_le_bytes());
    data.extend(&rows);
    let (mut a, mut b) = (1_u32, 0_u32);
    for byte in &rows {
        a = (a + u32::from(*byte)) % 65_521;
        b = (b + a) % 65_521;
    }
    data.extend(((b << 16) | a).to_be_bytes());
    let mut out = VALID_PNG[..33].to_vec();
    out.extend((data.len() as u32).to_be_bytes());
    let mut body = b"IDAT".to_vec();
    body.extend(data);
    out.extend(&body);
    out.extend(crc(&body).to_be_bytes());
    out.extend(&VALID_PNG[VALID_PNG.len() - 12..]);
    out
}

fn png_with_bad_ancillary_crc() -> Vec<u8> {
    let mut out = VALID_PNG[..33].to_vec();
    out.extend(10_u32.to_be_bytes());
    out.extend(b"tEXtComment\0hi");
    out.extend([0, 0, 0, 0]);
    out.extend(&VALID_PNG[33..]);
    out
}

fn project_with(main: &str, files: &[(&str, &[u8])]) -> TempDir {
    let directory = TempDir::new().unwrap();
    let mut all = vec![
        ("main.tex", main.as_bytes()),
        ("figures/unrelated.png", &VALID_PNG[..]),
        ("figures/unused-empty.png", &b""[..]),
    ];
    all.extend_from_slice(files);
    for (name, bytes) in all {
        let path = directory.path().join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }
    directory
}

fn document_using(images: &[&str]) -> String {
    let mut main =
        String::from("\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n");
    for image in images {
        main.push_str(&format!(
            "\\includegraphics[width=0.5\\linewidth]{{{image}}}\n"
        ));
    }
    main.push_str("\\end{document}\n");
    main
}

fn messages(log: &str, files: &[(&str, &[u8])]) -> Vec<String> {
    let used: Vec<&str> = files.iter().map(|(name, _)| *name).collect();
    let directory = project_with(&document_using(&used), files);
    diagnose_image_failures(directory.path(), Some("main.tex"), log)
        .iter()
        .map(ImageFinding::message)
        .collect()
}

#[test]
fn tectonic_abort_on_a_corrupt_png_is_traced_to_the_file_the_document_uses() {
    let log = fixture("tectonic-png-abort");
    assert!(!log.contains("plot.png"));
    assert_eq!(
        messages(&log, &[("figures/plot.png", &CORRUPT_PNG)]),
        ["The image figures/plot.png is damaged and cannot be read. Export the image again or replace the file."]
    );
}

#[test]
fn tectonic_png_read_error_is_traced_to_the_file_the_run_opened() {
    let log = fixture("tectonic-png-truncated");
    assert!(!log
        .lines()
        .any(|line| line.contains("plot.png") && line.to_ascii_lowercase().contains("error")));
    let directory = project_with(
        "\\documentclass{article}",
        &[("figures/plot.png", &PNG_HEADER_ONLY[..20])],
    );
    let findings = diagnose_image_failures(directory.path(), Some("main.tex"), &log);
    assert_eq!(
        findings.iter().map(ImageFinding::message).collect::<Vec<_>>(),
        ["The image figures/plot.png is incomplete. Part of the file is missing, which can happen when a download or copy stops early. Export the image again or replace the file."]
    );
}

#[test]
fn tectonic_named_failures_explain_the_named_file() {
    assert_eq!(
        messages(&fixture("tectonic-jpeg-truncated"), &[("figures/photo.jpg", &JPEG_HEADER_CUT)]),
        ["The image figures/photo.jpg is incomplete. Part of the file is missing, which can happen when a download or copy stops early. Export the image again or replace the file."]
    );
    assert_eq!(
        messages(
            &fixture("tectonic-empty-image"),
            &[("figures/empty.png", b"")]
        ),
        ["The image figures/empty.png is empty. Export the image again or replace the file."]
    );
    assert_eq!(
        messages(&fixture("tectonic-pdf-not-pdf"), &[("figures/diagram.pdf", WEB_PAGE)]),
        ["The image figures/diagram.pdf contains a web page instead of a PDF. This usually happens when a download returns an error page. Download or export the image again."]
    );
}

#[test]
fn tex_live_engines_are_traced_to_the_file() {
    assert_eq!(
        messages(&fixture("pdflatex-jpeg-truncated"), &[("figures/photo.jpg", &JPEG_HEADER_CUT)]),
        ["The image figures/photo.jpg is incomplete. Part of the file is missing, which can happen when a download or copy stops early. Export the image again or replace the file."]
    );
    assert_eq!(
        messages(&fixture("lualatex-png-truncated"), &[("figures/plot.png", &PNG_HEADER_ONLY[..20])]),
        ["The image figures/plot.png is incomplete. Part of the file is missing, which can happen when a download or copy stops early. Export the image again or replace the file."]
    );
}

#[test]
fn a_named_image_that_checks_out_produces_no_note() {
    let log = fixture("tectonic-jpeg-truncated");
    assert!(messages(&log, &[]).is_empty());
}

#[test]
fn a_lualatex_pdf_version_warning_is_not_an_image_failure() {
    let log = fixture("lualatex-pdf-version-warning");
    assert!(log.contains("warning  (file figures/fig.pdf) (pdf inclusion)"));
    assert_eq!(
        log.lines()
            .filter(|line| line.starts_with("! "))
            .collect::<Vec<_>>(),
        [
            "! Undefined control sequence.",
            "! Undefined control sequence."
        ]
    );
    assert_eq!(image_failure_evidence(&log), None);
    let main = "\\pdfvariable minorversion=4\n\\pdfvariable inclusionerrorlevel=0\n\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\nHello.\n\n\\includegraphics{figures/fig.pdf}\n\\foo\n\\end{document}\n";
    let directory = project_with(
        main,
        &[
            ("figures/fig.pdf", PDF_17),
            ("figures/old-notes.pdf", WEB_PAGE),
        ],
    );
    assert!(diagnose_image_failures(directory.path(), Some("main.tex"), &log).is_empty());
}

#[test]
fn a_culprit_that_passes_every_check_never_blames_an_unrelated_image() {
    let log = fixture("tectonic-png-bad-filter");
    assert_eq!(
        log.lines().last(),
        Some("libpng error: bad adaptive filter value")
    );
    let directory = project_with(
        &document_using(&["figures/plot.png", "figures/notes.png"]),
        &[
            ("figures/plot.png", &png_with_bad_filter()),
            ("figures/notes.png", &png_with_bad_ancillary_crc()),
        ],
    );
    let findings = diagnose_image_failures(directory.path(), Some("main.tex"), &log);
    assert_eq!(
        findings,
        [ImageFinding::Unidentified(Some(ImageFormat::Png))]
    );
    assert_eq!(
        findings[0].message(),
        "One of the PNG images in this document is damaged and stopped the compile. Oleafly could not tell which one. Export the document's PNG images again, or replace the damaged one."
    );
}

#[test]
fn a_libpng_data_error_is_traced_to_the_png_with_damaged_data() {
    let log = fixture("tectonic-png-idat-crc");
    assert_eq!(log.lines().last(), Some("libpng error: IDAT: CRC error"));
    let mut damaged = VALID_PNG;
    damaged[VALID_PNG_IDAT_CRC] ^= 0xff;
    assert_eq!(
        messages(&log, &[("figures/plot.png", &damaged)]),
        ["The image figures/plot.png is damaged and cannot be read. Export the image again or replace the file."]
    );
}

#[test]
fn a_name_with_an_apostrophe_is_read_whole() {
    let log = fixture("tectonic-apostrophe-name");
    assert!(log.contains("! Unable to load picture or PDF file '\"figures/it's.png\"'."));
    let directory = project_with(
        &document_using(&["figures/it's.png"]),
        &[("figures/it's.png", b""), ("figures/other.png", b"")],
    );
    assert_eq!(
        diagnose_image_failures(directory.path(), Some("main.tex"), &log)
            .iter()
            .map(ImageFinding::message)
            .collect::<Vec<_>>(),
        ["The image figures/it's.png is empty. Export the image again or replace the file."]
    );
}

#[test]
fn the_note_parses_back_as_one_error_diagnostic_with_the_same_message() {
    let bad_filter = png_with_bad_filter();
    for (log, plot) in [
        (fixture("tectonic-png-abort"), &CORRUPT_PNG[..]),
        (fixture("tectonic-png-bad-filter"), &bad_filter[..]),
    ] {
        let directory = project_with(
            &document_using(&["figures/plot.png"]),
            &[("figures/plot.png", plot)],
        );
        let findings = diagnose_image_failures(directory.path(), Some("main.tex"), &log);
        assert_eq!(findings.len(), 1);
        let with_notes = format!("{log}{}", image_failure_notes(&findings));
        let diagnostics = parse_latex_log(&with_notes, Some("main.tex"));
        let errors: Vec<_> = diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.severity == LogSeverity::Error)
            .collect();
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].category, LogCategory::Error);
        assert_eq!(errors[0].message, findings[0].message());
        assert_eq!(errors[0].file, None);
        assert_eq!(errors[0].line, None);
    }
}

#[test]
fn a_scan_stops_after_its_file_cap() {
    let names: Vec<String> = (0..250)
        .map(|index| format!("figures/a{index:03}.png"))
        .collect();
    let mut files: Vec<(&str, &[u8])> = names
        .iter()
        .map(|name| (name.as_str(), &VALID_PNG[..]))
        .collect();
    files.push(("figures/z.png", b""));
    let used: Vec<&str> = files.iter().map(|(name, _)| *name).collect();
    let directory = project_with(&document_using(&used), &files);
    assert_eq!(
        diagnose_image_failures(
            directory.path(),
            Some("main.tex"),
            "libpng error: Read Error\n"
        ),
        [ImageFinding::Unidentified(Some(ImageFormat::Png))]
    );
    let few = project_with(
        &document_using(&["figures/z.png"]),
        &[("figures/z.png", b"")],
    );
    assert_eq!(
        diagnose_image_failures(few.path(), Some("main.tex"), "libpng error: Read Error\n").len(),
        1
    );
}
