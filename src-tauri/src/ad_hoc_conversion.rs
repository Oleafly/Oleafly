//! Project-independent document conversion for the Tools workspace.
//!
//! Inputs are staged under fixed names in a fresh temporary directory. The
//! route table owns every pandoc flag, and the response contains either text
//! or one binary artifact plus any locally extracted media.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const MAX_TEXT_INPUT_BYTES: usize = 20 * 1024 * 1024;
const MAX_BINARY_INPUT_BYTES: usize = 128 * 1024 * 1024;
const MAX_OUTPUT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_MEDIA_FILES: usize = 256;
const MAX_MEDIA_ENTRIES: usize = 4096;
const MAX_MEDIA_TOTAL_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AdHocConversionRequest {
    source: String,
    target: String,
    text: Option<String>,
    data_base64: Option<String>,
    #[serde(default)]
    report: bool,
    #[serde(default)]
    check: bool,
    #[serde(default)]
    files: Vec<AdHocInputFile>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdHocInputFile {
    path: String,
    data_base64: String,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct AdHocCheck {
    ok: bool,
    diagnostics: Vec<crate::conversion::TypstCheckDiagnostic>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdHocArtifact {
    path: String,
    data_base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdHocConversionResult {
    kind: &'static str,
    text: Option<String>,
    data_base64: Option<String>,
    file_name: String,
    media_type: String,
    files: Vec<AdHocArtifact>,
    report: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    check: Option<AdHocCheck>,
}

fn decode_input(request: &AdHocConversionRequest) -> Result<Vec<u8>, String> {
    match (&request.text, &request.data_base64) {
        (Some(text), None) => {
            if request.source == "docx" {
                return Err("Word input must be supplied as a .docx file.".into());
            }
            if text.len() > MAX_TEXT_INPUT_BYTES {
                return Err("This source is larger than the 20 MB text limit.".into());
            }
            Ok(text.as_bytes().to_vec())
        }
        (None, Some(data)) => {
            let estimated = data.len().saturating_mul(3) / 4;
            if estimated > MAX_BINARY_INPUT_BYTES {
                return Err("This file is larger than the 128 MB conversion limit.".into());
            }
            let bytes = STANDARD
                .decode(data.trim())
                .map_err(|_| "The selected file could not be decoded.".to_string())?;
            if bytes.len() > MAX_BINARY_INPUT_BYTES {
                return Err("This file is larger than the 128 MB conversion limit.".into());
            }
            if request.source == "docx" && !bytes.starts_with(b"PK") {
                return Err("The selected file is not a valid .docx document.".into());
            }
            Ok(bytes)
        }
        (Some(_), Some(_)) => Err("Supply text or a file, not both.".into()),
        (None, None) => Err("Add some source content before converting.".into()),
    }
}

const MAX_SUPPORT_FILES: usize = 4096;
const MAX_SUPPORT_TOTAL_BYTES: usize = 128 * 1024 * 1024;
const MAX_SUPPORT_DEPTH: usize = 16;
const TYPST_CHECK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
const TYPST_CHECK_PDF: &str = "oleafly-check.pdf";

fn support_file_path(path: &str, reserved: &[&str]) -> Result<PathBuf, String> {
    let relative = Path::new(path);
    let components = relative.components().count();
    let normal = relative
        .components()
        .all(|component| matches!(component, std::path::Component::Normal(_)));
    if path.is_empty()
        || path.contains('\\')
        || !normal
        || components == 0
        || components > MAX_SUPPORT_DEPTH
    {
        return Err(format!("The support file {path} has an invalid path."));
    }
    if reserved.iter().any(|name| relative == Path::new(name)) {
        return Err(format!(
            "The support file {path} would replace the converted document."
        ));
    }
    Ok(relative.to_path_buf())
}

fn decode_support_files(
    files: &[AdHocInputFile],
    reserved: &[&str],
) -> Result<Vec<(PathBuf, Vec<u8>)>, String> {
    if files.len() > MAX_SUPPORT_FILES {
        return Err("The conversion has too many support files.".into());
    }
    let mut total = 0_usize;
    files
        .iter()
        .map(|file| {
            let path = support_file_path(&file.path, reserved)?;
            let bytes = STANDARD
                .decode(file.data_base64.trim())
                .map_err(|_| format!("The support file {} could not be decoded.", file.path))?;
            total = total.saturating_add(bytes.len());
            if total > MAX_SUPPORT_TOTAL_BYTES {
                return Err("The support files are larger than the 128 MB limit.".into());
            }
            Ok((path, bytes))
        })
        .collect()
}

fn stage_support_files(root: &Path, files: &[(PathBuf, Vec<u8>)]) -> Result<(), String> {
    for (relative, bytes) in files {
        let destination = root.join(relative);
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Could not stage a support file: {error}"))?;
        }
        std::fs::write(&destination, bytes)
            .map_err(|error| format!("Could not stage a support file: {error}"))?;
    }
    Ok(())
}

pub(crate) fn typst_check_args(root: &Path, input: &str) -> Vec<String> {
    vec![
        "--color=never".into(),
        "compile".into(),
        input.into(),
        TYPST_CHECK_PDF.into(),
        "--root".into(),
        root.to_string_lossy().into_owned(),
        "--diagnostic-format".into(),
        "short".into(),
    ]
}

fn typst_check_command(
    typst: &Path,
    root: &Path,
    input: &str,
    packages: Option<&crate::typst_packages::TypstPackageDirs>,
) -> std::process::Command {
    let capabilities = oleafly_core::typst_toolchain::capabilities_for(
        &oleafly_core::typst_toolchain::bundled_typst_version().to_string(),
    );
    let mut command = std::process::Command::new(typst);
    command
        .args(typst_check_args(root, input))
        .args(crate::typst_render::package_args(packages, capabilities))
        .current_dir(root);
    for (name, value) in packages
        .map(crate::typst_packages::TypstPackageDirs::environment)
        .unwrap_or_default()
    {
        command.env(name, value);
    }
    command
}

fn run_typst_check(
    typst: &Path,
    root: &Path,
    input: &str,
    packages: Option<&crate::typst_packages::TypstPackageDirs>,
    timeout: std::time::Duration,
) -> AdHocCheck {
    let command = typst_check_command(typst, root, input, packages);
    let output = match crate::proc::output_contained_with_timeout(command, timeout) {
        Ok(output) => output,
        Err(error) => {
            let message = if error.kind() == std::io::ErrorKind::TimedOut {
                "Typst took too long to check the converted document.".to_string()
            } else {
                format!("Typst could not check the converted document: {error}")
            };
            return AdHocCheck {
                ok: false,
                diagnostics: vec![crate::conversion::TypstCheckDiagnostic {
                    severity: "error",
                    message,
                    line: None,
                }],
            };
        }
    };
    let log = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout)
    );
    let mut diagnostics = crate::conversion::typst_check_diagnostics(&log, input);
    let ok = output.status.success();
    if !ok
        && !diagnostics
            .iter()
            .any(|diagnostic| diagnostic.severity == "error")
    {
        diagnostics.insert(
            0,
            crate::conversion::TypstCheckDiagnostic {
                severity: "error",
                message: "Typst could not compile the converted document.".into(),
                line: None,
            },
        );
    }
    AdHocCheck { ok, diagnostics }
}

fn check_converted_typst(root: &Path, output_name: &str, text: &str) -> Option<AdHocCheck> {
    let typst = crate::document_engine::resolve_bundled_sidecar("typst").ok()?;
    std::fs::write(root.join(output_name), text).ok()?;
    let packages = crate::paths::oleafly_root()
        .ok()
        .map(|data| crate::typst_packages::TypstPackageDirs::app(&data));
    Some(run_typst_check(
        &typst,
        root,
        output_name,
        packages.as_ref(),
        TYPST_CHECK_TIMEOUT,
    ))
}

fn relative_slash(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "Converted media escaped its staging directory.".to_string())?;
    if relative
        .components()
        .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err("Converted media contains an invalid path.".into());
    }
    if relative.components().count() > 16 {
        return Err("Converted media contains a path that is too deeply nested.".into());
    }
    relative
        .to_str()
        .map(|path| path.replace('\\', "/"))
        .ok_or_else(|| "Converted media contains a filename that is not valid Unicode.".into())
}

fn collect_media(root: &Path, output: &Path) -> Result<Vec<AdHocArtifact>, String> {
    let assets = root.join("assets");
    if !assets.is_dir() {
        return Ok(Vec::new());
    }
    let mut pending = vec![assets];
    let mut files = Vec::new();
    let mut total = 0_u64;
    let mut entries_seen = 0_usize;
    while let Some(directory) = pending.pop() {
        let entries = std::fs::read_dir(&directory)
            .map_err(|error| format!("Could not inspect converted media: {error}"))?;
        for entry in entries {
            entries_seen += 1;
            if entries_seen > MAX_MEDIA_ENTRIES {
                return Err("The conversion produced too many media entries.".into());
            }
            let entry =
                entry.map_err(|error| format!("Could not inspect converted media: {error}"))?;
            let file_type = entry
                .file_type()
                .map_err(|error| format!("Could not inspect converted media: {error}"))?;
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                pending.push(entry.path());
                continue;
            }
            if !file_type.is_file() || entry.path() == output {
                continue;
            }
            if files.len() >= MAX_MEDIA_FILES {
                return Err("The conversion produced more than 256 media files.".into());
            }
            let metadata = entry
                .metadata()
                .map_err(|error| format!("Could not inspect converted media: {error}"))?;
            total = total.saturating_add(metadata.len());
            if total > MAX_MEDIA_TOTAL_BYTES {
                return Err("The converted media is larger than the 256 MB limit.".into());
            }
            let bytes = std::fs::read(entry.path())
                .map_err(|error| format!("Could not read converted media: {error}"))?;
            files.push(AdHocArtifact {
                path: relative_slash(root, &entry.path())?,
                data_base64: STANDARD.encode(bytes),
            });
        }
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(files)
}

fn stage_conversion_workspace(
    input: Vec<u8>,
    source_name: &'static str,
    references_filter: bool,
    support: &[(PathBuf, Vec<u8>)],
) -> Result<(tempfile::TempDir, PathBuf), String> {
    let temporary = tempfile::tempdir()
        .map_err(|error| format!("Could not prepare the conversion workspace: {error}"))?;
    let root = temporary.path().to_path_buf();
    stage_support_files(&root, support)?;
    std::fs::write(root.join(source_name), input)
        .map_err(|error| format!("Could not stage the source document: {error}"))?;
    if references_filter {
        crate::pandoc_citations::stage_filter(&root)?;
    }
    Ok((temporary, root))
}

/// Points the output's bibliography at local names: the converter has only
/// the text, and a path from this machine must not end up in the result.
/// The entry is pinned even when Rust reads no bibliography in the source:
/// pandoc accepts front matter the YAML reader here may not, and would
/// otherwise write the path it found.
fn localize_bibliographies(plan: &mut crate::conversion::AdHocPlan, source: &str, input: &[u8]) {
    let Some(kind) = crate::pandoc_citations::BibliographySource::for_reader(source) else {
        return;
    };
    if !plan.local_bibliography {
        return;
    }
    let declared =
        crate::pandoc_citations::declared_bibliographies(kind, &String::from_utf8_lossy(input));
    let names = crate::pandoc_citations::unique_local_names(declared.iter().map(String::as_str));
    plan.add_bibliographies(&names);
}

fn finish_conversion(
    temporary: tempfile::TempDir,
    plan: crate::conversion::AdHocPlan,
    target_is_typst: bool,
    report: Vec<String>,
    check: bool,
) -> Result<AdHocConversionResult, String> {
    let root = temporary.path();
    let output = root.join(plan.output_name);
    let metadata = std::fs::metadata(&output)
        .map_err(|_| "The converter did not produce an output file.".to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_OUTPUT_BYTES {
        return Err("The converted output is larger than the 256 MB limit.".into());
    }

    let mut bytes = std::fs::read(&output)
        .map_err(|error| format!("Could not read the converted output: {error}"))?;
    if target_is_typst {
        let source = String::from_utf8(bytes)
            .map_err(|_| "Pandoc returned invalid Typst text.".to_string())?;
        bytes = crate::conversion::fixup_typst_source(&source).into_bytes();
    }
    let files = collect_media(root, &output)?;
    if plan.binary_output {
        Ok(AdHocConversionResult {
            kind: "binary",
            text: None,
            data_base64: Some(STANDARD.encode(bytes)),
            file_name: plan.output_name.into(),
            media_type: plan.media_type.into(),
            files,
            report,
            check: None,
        })
    } else {
        let text = String::from_utf8(bytes)
            .map_err(|_| "Pandoc returned text in an unsupported encoding.".to_string())?;
        let check = (check && target_is_typst)
            .then(|| check_converted_typst(root, plan.output_name, &text))
            .flatten();
        Ok(AdHocConversionResult {
            kind: "text",
            text: Some(text),
            data_base64: None,
            file_name: plan.output_name.into(),
            media_type: plan.media_type.into(),
            files,
            report,
            check,
        })
    }
}

async fn discard_conversion_workspace(temporary: tempfile::TempDir) {
    let _ = tauri::async_runtime::spawn_blocking(move || drop(temporary)).await;
}

#[tauri::command]
pub async fn convert_ad_hoc(
    request: AdHocConversionRequest,
) -> Result<AdHocConversionResult, String> {
    let mut plan =
        crate::conversion::ad_hoc_plan(&request.source, &request.target).ok_or_else(|| {
            format!(
                "{} to {} is not an available ad-hoc conversion.",
                request.source, request.target
            )
        })?;
    let target_is_typst = request.target == "typst";
    let source_kind = request.source.clone();
    let report = request.report;
    let check = request.check && target_is_typst;
    if report {
        plan.args.insert(0, "--verbose".into());
    }
    let reserved = [plan.source_name, plan.output_name];
    let (input, support) = tauri::async_runtime::spawn_blocking(move || {
        let input = decode_input(&request)?;
        let support = decode_support_files(&request.files, &reserved)?;
        Ok::<_, String>((input, support))
    })
    .await
    .map_err(|error| error.to_string())??;
    localize_bibliographies(&mut plan, &source_kind, &input);
    let pandoc = tauri::async_runtime::spawn_blocking(crate::project::find_pandoc)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "Pandoc is not installed. Install it from Tools, then try again.".to_string()
        })?;

    let source_name = plan.source_name;
    let references_filter = plan.references_filter;
    let (temporary, root) = tauri::async_runtime::spawn_blocking(move || {
        stage_conversion_workspace(input, source_name, references_filter, &support)
    })
    .await
    .map_err(|error| error.to_string())??;

    let execution =
        crate::document_engine::run_supervised_external(Path::new(&pandoc), &plan.args, &root)
            .await;
    let (log, code) = match execution {
        Ok(result) => result,
        Err(error) => {
            discard_conversion_workspace(temporary).await;
            return Err(error);
        }
    };
    if code != Some(0) {
        let detail = log.trim();
        let error = if detail.is_empty() {
            "Pandoc could not convert this document.".into()
        } else {
            format!("Pandoc could not convert this document: {detail}")
        };
        discard_conversion_workspace(temporary).await;
        return Err(error);
    }
    let report = if report {
        crate::conversion::pandoc_report(&log)
    } else {
        Vec::new()
    };
    tauri::async_runtime::spawn_blocking(move || {
        finish_conversion(temporary, plan, target_is_typst, report, check)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(source: &str, text: Option<&str>, data: Option<&str>) -> AdHocConversionRequest {
        AdHocConversionRequest {
            source: source.into(),
            target: "latex".into(),
            text: text.map(str::to_string),
            data_base64: data.map(str::to_string),
            ..Default::default()
        }
    }

    #[test]
    fn input_requires_exactly_one_payload() {
        assert!(decode_input(&request("markdown", None, None)).is_err());
        assert!(decode_input(&request("markdown", Some("x"), Some("eA=="))).is_err());
        assert_eq!(
            decode_input(&request("markdown", Some("hello"), None)).unwrap(),
            b"hello"
        );
    }

    #[test]
    fn word_input_requires_zip_bytes() {
        assert!(decode_input(&request("docx", Some("not binary"), None)).is_err());
        assert!(decode_input(&request("docx", None, Some("bm90LWRvY3g="))).is_err());
        assert_eq!(
            decode_input(&request("docx", None, Some("UEs="))).unwrap(),
            b"PK"
        );
    }

    #[test]
    fn media_collection_is_bounded_and_sorted() {
        let directory = tempfile::tempdir().unwrap();
        let assets = directory.path().join("assets");
        std::fs::create_dir_all(assets.join("nested")).unwrap();
        std::fs::write(assets.join("z.png"), b"z").unwrap();
        std::fs::write(assets.join("nested/a.png"), b"a").unwrap();
        let files = collect_media(directory.path(), &std::path::PathBuf::from("missing")).unwrap();
        assert_eq!(
            files
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
            ["assets/nested/a.png", "assets/z.png"]
        );
    }

    #[test]
    fn text_and_file_limits_fail_before_conversion() {
        let oversized = "x".repeat(MAX_TEXT_INPUT_BYTES + 1);
        assert!(decode_input(&request("markdown", Some(&oversized), None))
            .unwrap_err()
            .contains("20 MB"));
        assert!(decode_input(&request("markdown", None, Some("not-base64")))
            .unwrap_err()
            .contains("could not be decoded"));
    }

    #[test]
    fn media_collection_handles_absent_output_and_enforces_path_bounds() {
        let empty = tempfile::tempdir().unwrap();
        assert!(
            collect_media(empty.path(), &empty.path().join("converted.tex"))
                .unwrap()
                .is_empty()
        );

        let directory = tempfile::tempdir().unwrap();
        let assets = directory.path().join("assets");
        std::fs::create_dir_all(&assets).unwrap();
        let output = assets.join("converted.tex");
        std::fs::write(&output, b"output").unwrap();
        assert!(collect_media(directory.path(), &output).unwrap().is_empty());

        let mut nested = assets;
        for _ in 0..17 {
            nested.push("nested");
        }
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("image.png"), b"image").unwrap();
        assert!(collect_media(directory.path(), &output)
            .err()
            .expect("deeply nested media should fail")
            .contains("deeply nested"));
        assert!(relative_slash(directory.path(), empty.path())
            .unwrap_err()
            .contains("escaped"));
    }

    #[test]
    fn media_file_count_is_bounded() {
        let directory = tempfile::tempdir().unwrap();
        let assets = directory.path().join("assets");
        std::fs::create_dir_all(&assets).unwrap();
        for index in 0..=MAX_MEDIA_FILES {
            std::fs::write(assets.join(format!("{index:03}.png")), b"x").unwrap();
        }
        assert!(
            collect_media(directory.path(), &directory.path().join("converted.tex"))
                .err()
                .expect("too many media files should fail")
                .contains("more than 256")
        );
    }

    #[cfg(unix)]
    #[test]
    fn media_collection_does_not_follow_symlinks() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let assets = directory.path().join("assets");
        std::fs::create_dir_all(&assets).unwrap();
        let outside = directory.path().join("outside.png");
        std::fs::write(&outside, b"private").unwrap();
        symlink(&outside, assets.join("linked.png")).unwrap();
        assert!(
            collect_media(directory.path(), &directory.path().join("converted.tex"))
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn native_pandoc_executes_every_ad_hoc_route() {
        if crate::project::find_pandoc().is_none() {
            eprintln!("Pandoc sidecar is not staged; skipping executable conversion check");
            return;
        }

        let sources = [
            (
                "latex",
                "\\documentclass{article}\\begin{document}A compact example $x^2$.\\end{document}",
            ),
            ("markdown", "# A compact example\n\nInline math $x^2$."),
            ("typst", "= A compact example\n\nInline math $x^2$."),
            ("html", "<h1>A compact example</h1><p>Inline text.</p>"),
        ];
        for (source, target) in [
            ("latex", "html"),
            ("latex", "markdown"),
            ("latex", "typst"),
            ("markdown", "latex"),
            ("markdown", "typst"),
            ("typst", "latex"),
            ("html", "latex"),
        ] {
            let text = sources
                .iter()
                .find_map(|(kind, text)| (*kind == source).then_some(*text))
                .unwrap();
            let result = convert_ad_hoc(AdHocConversionRequest {
                source: source.into(),
                target: target.into(),
                text: Some(text.into()),
                data_base64: None,
                ..Default::default()
            })
            .await
            .unwrap_or_else(|error| panic!("{source} -> {target} failed: {error}"));
            assert_eq!(result.kind, "text");
            assert!(result.text.as_deref().is_some_and(|text| !text.is_empty()));
            assert!(result.data_base64.is_none());
        }

        let word = convert_ad_hoc(AdHocConversionRequest {
            source: "latex".into(),
            target: "docx".into(),
            text: Some(sources[0].1.into()),
            data_base64: None,
            ..Default::default()
        })
        .await
        .unwrap();
        assert_eq!(word.kind, "binary");
        let word_bytes = STANDARD.decode(word.data_base64.unwrap()).unwrap();
        assert!(word_bytes.starts_with(b"PK"));

        let round_trip = convert_ad_hoc(AdHocConversionRequest {
            source: "docx".into(),
            target: "latex".into(),
            text: None,
            data_base64: Some(STANDARD.encode(word_bytes)),
            ..Default::default()
        })
        .await
        .unwrap();
        assert!(round_trip
            .text
            .as_deref()
            .is_some_and(|text| text.contains("compact example")));
    }

    #[tokio::test]
    async fn tools_converter_keeps_citations_and_local_bibliography_names() {
        if crate::project::find_pandoc().is_none() {
            eprintln!("Pandoc sidecar is not staged; skipping executable conversion check");
            return;
        }
        let latex = convert_ad_hoc(AdHocConversionRequest {
            source: "markdown".into(),
            target: "latex".into(),
            text: Some(
                "---\nbibliography: \"/Users/someone/Zotero/My Library.bib\"\n---\n\nWe follow [@smith2020] and @jones2021.\n".into(),
            ),
            data_base64: None,
            ..Default::default()
        })
        .await
        .unwrap();
        let tex = latex.text.unwrap();
        assert!(tex.contains("\\citep{smith2020}"), "{tex}");
        assert!(tex.contains("\\citet{jones2021}"), "{tex}");
        assert!(tex.contains("\\bibliography{My-Library.bib}"), "{tex}");
        assert!(!tex.contains("/Users/someone"), "{tex}");

        // Front matter after a blank line, or with nothing Rust can read,
        // still never puts a path from this machine into the result.
        for (target, text) in [
            (
                "latex",
                "\n---\nbibliography: \"/Users/someone/Zotero/My Library.bib\"\n---\n\nSee [@smith2020].\n",
            ),
            (
                "typst",
                "\n---\nbibliography: \"/Users/someone/Zotero/My Library.bib\"\n---\n\nSee [@smith2020].\n",
            ),
            (
                "latex",
                // Pandoc accepts the tab here; the Rust YAML reader does not.
                "---\nbibliography:\n\t- /Users/someone/a.bib\n---\n\nSee [@smith2020].\n",
            ),
        ] {
            let converted = convert_ad_hoc(AdHocConversionRequest {
                source: "markdown".into(),
                target: target.into(),
                text: Some(text.into()),
                data_base64: None,
                ..Default::default()
            })
            .await
            .unwrap();
            let output = converted.text.unwrap();
            assert!(!output.contains("/Users/someone"), "{target}: {output}");
        }

        let html = convert_ad_hoc(AdHocConversionRequest {
            source: "latex".into(),
            target: "html".into(),
            text: Some(
                "\\documentclass{article}\\usepackage{amsmath}\\begin{document}\nWe follow \\cite{smith2020}.\n\\begin{equation}\\label{eq:a} a = b \\end{equation}\nSee \\eqref{eq:a}.\n\\end{document}\n".into(),
            ),
            data_base64: None,
            ..Default::default()
        })
        .await
        .unwrap();
        let html = html.text.unwrap();
        assert!(html.contains("data-cites=\"smith2020\""), "{html}");
        assert!(html.contains("smith2020?"), "{html}");
        assert!(html.contains("See (eq:a)."), "{html}");
        assert!(!html.contains("[eq:a]"), "{html}");
    }

    #[tokio::test]
    async fn unsupported_ad_hoc_route_fails_before_process_launch() {
        let error = convert_ad_hoc(AdHocConversionRequest {
            source: "pdf".into(),
            target: "latex".into(),
            text: Some("data".into()),
            data_base64: None,
            ..Default::default()
        })
        .await
        .err()
        .expect("unsupported route should fail");
        assert!(error.contains("not an available ad-hoc conversion"));
    }

    fn support(path: &str, data: &[u8]) -> AdHocInputFile {
        AdHocInputFile {
            path: path.into(),
            data_base64: STANDARD.encode(data),
        }
    }

    fn bundled_typst() -> Option<PathBuf> {
        crate::document_engine::resolve_bundled_sidecar("typst").ok()
    }

    #[test]
    fn support_files_stay_inside_the_workspace() {
        let reserved = ["source.tex", "converted.typ"];
        assert_eq!(
            support_file_path("figs/plot.png", &reserved).unwrap(),
            PathBuf::from("figs/plot.png")
        );
        for invalid in [
            "",
            "../outside.png",
            "/etc/passwd",
            "figs/../../x.png",
            "figs\\plot.png",
            "./plot.png",
        ] {
            assert!(
                support_file_path(invalid, &reserved).is_err(),
                "{invalid} should be rejected"
            );
        }
        assert!(support_file_path("source.tex", &reserved)
            .unwrap_err()
            .contains("replace"));
        let deep = vec!["d"; MAX_SUPPORT_DEPTH + 1].join("/");
        assert!(support_file_path(&deep, &reserved).is_err());
    }

    #[test]
    fn support_files_decode_with_bounds_and_stage_on_disk() {
        let decoded = decode_support_files(
            &[support("figs/a.png", b"png"), support("b.bib", b"@misc{x}")],
            &["source.tex"],
        )
        .unwrap();
        assert_eq!(decoded.len(), 2);
        let directory = tempfile::tempdir().unwrap();
        stage_support_files(directory.path(), &decoded).unwrap();
        assert_eq!(
            std::fs::read(directory.path().join("figs/a.png")).unwrap(),
            b"png"
        );
        let broken = AdHocInputFile {
            path: "x.png".into(),
            data_base64: "not base64".into(),
        };
        assert!(decode_support_files(&[broken], &[])
            .unwrap_err()
            .contains("could not be decoded"));
        let too_many: Vec<AdHocInputFile> = (0..=MAX_SUPPORT_FILES)
            .map(|index| support(&format!("f{index}.txt"), b""))
            .collect();
        assert!(decode_support_files(&too_many, &[])
            .unwrap_err()
            .contains("too many"));
    }

    #[test]
    fn typst_checks_read_the_shared_package_folders() {
        let dirs = crate::typst_packages::TypstPackageDirs::app(Path::new("/data"));
        let command = typst_check_command(
            Path::new("typst"),
            Path::new("/work"),
            "converted.typ",
            Some(&dirs),
        );
        let arguments: Vec<String> = command
            .get_args()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect();
        let flag_value = |flag: &str| {
            arguments
                .iter()
                .position(|argument| argument == flag)
                .and_then(|index| arguments.get(index + 1))
                .cloned()
        };
        assert_eq!(
            flag_value("--package-path"),
            Some(dirs.package_path.to_string_lossy().into_owned())
        );
        assert_eq!(
            flag_value("--package-cache-path"),
            Some(dirs.cache_path.to_string_lossy().into_owned())
        );
        let environment: Vec<(String, String)> = command
            .get_envs()
            .filter_map(|(name, value)| {
                Some((
                    name.to_string_lossy().into_owned(),
                    value?.to_string_lossy().into_owned(),
                ))
            })
            .collect();
        for (name, value) in dirs.environment() {
            assert!(
                environment.contains(&(name.to_owned(), value.to_string_lossy().into_owned())),
                "{name} missing from {environment:?}"
            );
        }

        let bare = typst_check_command(
            Path::new("typst"),
            Path::new("/work"),
            "converted.typ",
            None,
        );
        let bare: Vec<String> = bare
            .get_args()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect();
        assert_eq!(bare, typst_check_args(Path::new("/work"), "converted.typ"));
    }

    #[test]
    fn bundled_typst_checks_converted_documents_that_import_cached_packages() {
        let Some(typst) = bundled_typst() else {
            eprintln!("Typst sidecar is not staged; skipping the package check");
            return;
        };
        let data = tempfile::tempdir().unwrap();
        let dirs = crate::typst_packages::TypstPackageDirs::app(data.path());
        let package = dirs
            .cache_path
            .join("preview")
            .join("zz-oleafly-check")
            .join("0.1.0");
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(
            package.join("typst.toml"),
            "[package]\nname = \"zz-oleafly-check\"\nversion = \"0.1.0\"\nentrypoint = \"lib.typ\"\n",
        )
        .unwrap();
        std::fs::write(package.join("lib.typ"), "#let shout(x) = upper(x)").unwrap();
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(
            directory.path().join("converted.typ"),
            "#import \"@preview/zz-oleafly-check:0.1.0\": shout\n#shout[converted]\n",
        )
        .unwrap();
        let checked = run_typst_check(
            &typst,
            directory.path(),
            "converted.typ",
            Some(&dirs),
            TYPST_CHECK_TIMEOUT,
        );
        assert!(checked.ok, "{checked:?}");
    }

    #[test]
    fn typst_check_compiles_in_the_workspace_with_short_diagnostics() {
        let root = Path::new("/work");
        assert_eq!(
            typst_check_args(root, "converted.typ"),
            [
                "--color=never",
                "compile",
                "converted.typ",
                TYPST_CHECK_PDF,
                "--root",
                "/work",
                "--diagnostic-format",
                "short",
            ]
        );
        let Some(typst) = bundled_typst() else {
            eprintln!("Typst sidecar is not staged; skipping the compile check");
            return;
        };
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("ok.typ"), "= Fine\n\nText $x^2$.\n").unwrap();
        let passed = run_typst_check(
            &typst,
            directory.path(),
            "ok.typ",
            None,
            TYPST_CHECK_TIMEOUT,
        );
        assert!(passed.ok, "{passed:?}");
        assert!(passed.diagnostics.is_empty(), "{passed:?}");
        std::fs::write(
            directory.path().join("bad.typ"),
            "= Broken\n\n#image(\"figs/missing.png\")\n#undefined-call()\n",
        )
        .unwrap();
        let failed = run_typst_check(
            &typst,
            directory.path(),
            "bad.typ",
            None,
            TYPST_CHECK_TIMEOUT,
        );
        assert!(!failed.ok);
        assert!(
            failed
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.severity == "error" && diagnostic.line.is_some()),
            "{failed:?}"
        );
    }

    #[tokio::test]
    async fn native_pandoc_executes_the_typst_tool_routes() {
        if crate::project::find_pandoc().is_none() {
            eprintln!("Pandoc sidecar is not staged; skipping executable conversion check");
            return;
        }
        let typst = "= A compact example\n\nInline math $x^2$ and *strong* text.\n";
        for target in ["html", "markdown"] {
            let result = convert_ad_hoc(AdHocConversionRequest {
                source: "typst".into(),
                target: target.into(),
                text: Some(typst.into()),
                ..Default::default()
            })
            .await
            .unwrap_or_else(|error| panic!("typst -> {target} failed: {error}"));
            assert_eq!(result.kind, "text");
            assert!(result.text.unwrap().contains("compact example"));
            assert!(result.report.is_empty());
            assert!(result.check.is_none());
        }
        let word = convert_ad_hoc(AdHocConversionRequest {
            source: "typst".into(),
            target: "docx".into(),
            text: Some(typst.into()),
            ..Default::default()
        })
        .await
        .unwrap();
        assert_eq!(word.kind, "binary");
        let word_bytes = STANDARD.decode(word.data_base64.unwrap()).unwrap();
        assert!(word_bytes.starts_with(b"PK"));
        let back = convert_ad_hoc(AdHocConversionRequest {
            source: "docx".into(),
            target: "typst".into(),
            data_base64: Some(STANDARD.encode(&word_bytes)),
            ..Default::default()
        })
        .await
        .unwrap();
        let back = back.text.unwrap();
        assert!(back.contains("compact example"), "{back}");
        let html = convert_ad_hoc(AdHocConversionRequest {
            source: "html".into(),
            target: "typst".into(),
            text: Some("<h1>Heading</h1><p>Some <em>emphasis</em>.</p>".into()),
            ..Default::default()
        })
        .await
        .unwrap();
        let html = html.text.unwrap();
        assert!(html.contains("= Heading"), "{html}");
        assert!(html.contains("#emph[emphasis]"), "{html}");
    }

    #[tokio::test]
    async fn equation_route_returns_bare_typst_math() {
        if crate::project::find_pandoc().is_none() {
            eprintln!("Pandoc sidecar is not staged; skipping executable conversion check");
            return;
        }
        let result = convert_ad_hoc(AdHocConversionRequest {
            source: "equation".into(),
            target: "typst".into(),
            text: Some("\\[ \\frac{a}{b} + \\sqrt{x} \\]".into()),
            ..Default::default()
        })
        .await
        .unwrap();
        let text = result.text.unwrap();
        assert_eq!(text.trim(), "$ a / b + sqrt(x) $", "{text}");
    }

    #[tokio::test]
    async fn reported_latex_to_typst_lists_skipped_markup_and_checks_the_result() {
        if crate::project::find_pandoc().is_none() || bundled_typst().is_none() {
            eprintln!("Pandoc or Typst sidecar is not staged; skipping the report check");
            return;
        }
        let latex = "\\documentclass{article}\n\\begin{document}\n\\maketitle\n\\section{Intro}\nText with a figure.\n\\begin{figure}\\includegraphics{figs/plot.png}\\caption{Plot}\\end{figure}\n\\weirdmacro{abc}\n\\end{document}\n";
        let png = STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
            .unwrap();
        let result = convert_ad_hoc(AdHocConversionRequest {
            source: "latex".into(),
            target: "typst".into(),
            text: Some(latex.into()),
            report: true,
            check: true,
            files: vec![support("figs/plot.png", &png)],
            ..Default::default()
        })
        .await
        .unwrap();
        assert!(
            result
                .report
                .iter()
                .any(|line| line.starts_with("Skipped '\\weirdmacro{abc}' at line 7")),
            "{:?}",
            result.report
        );
        let check = result.check.expect("the converted Typst was checked");
        assert!(check.ok, "{check:?}");
        let missing = convert_ad_hoc(AdHocConversionRequest {
            source: "latex".into(),
            target: "typst".into(),
            text: Some(latex.into()),
            check: true,
            ..Default::default()
        })
        .await
        .unwrap();
        let check = missing.check.expect("the converted Typst was checked");
        assert!(!check.ok);
        assert!(
            check
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.message.contains("figs/plot.png")),
            "{check:?}"
        );
        assert!(missing.report.is_empty());
    }
}
