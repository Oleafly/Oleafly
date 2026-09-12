//! Project-independent document conversion for the Tools workspace.
//!
//! Inputs are staged under fixed names in a fresh temporary directory. The
//! route table owns every pandoc flag, and the response contains either text
//! or one binary artifact plus any locally extracted media.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::path::Path;

const MAX_TEXT_INPUT_BYTES: usize = 20 * 1024 * 1024;
const MAX_BINARY_INPUT_BYTES: usize = 128 * 1024 * 1024;
const MAX_OUTPUT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_MEDIA_FILES: usize = 256;
const MAX_MEDIA_ENTRIES: usize = 4096;
const MAX_MEDIA_TOTAL_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdHocConversionRequest {
    source: String,
    target: String,
    text: Option<String>,
    data_base64: Option<String>,
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

#[tauri::command]
pub async fn convert_ad_hoc(
    request: AdHocConversionRequest,
) -> Result<AdHocConversionResult, String> {
    let plan =
        crate::conversion::ad_hoc_plan(&request.source, &request.target).ok_or_else(|| {
            format!(
                "{} to {} is not an available ad-hoc conversion.",
                request.source, request.target
            )
        })?;
    let input = decode_input(&request)?;
    let pandoc = tauri::async_runtime::spawn_blocking(crate::project::find_pandoc)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "Pandoc is not installed. Install it from Tools, then try again.".to_string()
        })?;

    let temporary = tempfile::tempdir()
        .map_err(|error| format!("Could not prepare the conversion workspace: {error}"))?;
    let root = temporary.path().to_path_buf();
    let source = root.join(plan.source_name);
    let output = root.join(plan.output_name);
    std::fs::write(&source, input)
        .map_err(|error| format!("Could not stage the source document: {error}"))?;

    let (log, code) =
        crate::document_engine::run_supervised_external(Path::new(&pandoc), &plan.args, &root)
            .await?;
    if code != Some(0) {
        let detail = log.trim();
        return Err(if detail.is_empty() {
            "Pandoc could not convert this document.".into()
        } else {
            format!("Pandoc could not convert this document: {detail}")
        });
    }
    let metadata = std::fs::metadata(&output)
        .map_err(|_| "The converter did not produce an output file.".to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_OUTPUT_BYTES {
        return Err("The converted output is larger than the 256 MB limit.".into());
    }

    let mut bytes = std::fs::read(&output)
        .map_err(|error| format!("Could not read the converted output: {error}"))?;
    if request.target == "typst" {
        let source = String::from_utf8(bytes)
            .map_err(|_| "Pandoc returned invalid Typst text.".to_string())?;
        bytes = crate::conversion::fixup_typst_source(&source).into_bytes();
    }
    let files = collect_media(&root, &output)?;
    if plan.binary_output {
        Ok(AdHocConversionResult {
            kind: "binary",
            text: None,
            data_base64: Some(STANDARD.encode(bytes)),
            file_name: plan.output_name.into(),
            media_type: plan.media_type.into(),
            files,
        })
    } else {
        let text = String::from_utf8(bytes)
            .map_err(|_| "Pandoc returned text in an unsupported encoding.".to_string())?;
        Ok(AdHocConversionResult {
            kind: "text",
            text: Some(text),
            data_base64: None,
            file_name: plan.output_name.into(),
            media_type: plan.media_type.into(),
            files,
        })
    }
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
        })
        .await
        .unwrap();
        assert!(round_trip
            .text
            .as_deref()
            .is_some_and(|text| text.contains("compact example")));
    }

    #[tokio::test]
    async fn unsupported_ad_hoc_route_fails_before_process_launch() {
        let error = convert_ad_hoc(AdHocConversionRequest {
            source: "pdf".into(),
            target: "latex".into(),
            text: Some("data".into()),
            data_base64: None,
        })
        .await
        .err()
        .expect("unsupported route should fail");
        assert!(error.contains("not an available ad-hoc conversion"));
    }
}
