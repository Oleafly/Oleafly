use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use std::time::Duration;

const TYPST_SIDECAR: &str = "typst";
const RENDER_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_SOURCE_BYTES: usize = 256 * 1024;
const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
const DEFAULT_PPI: u32 = 144;
const MAX_PPI: u32 = 1200;
const MAX_DIAGNOSTICS: usize = 32;
const MAX_MESSAGE_CHARS: usize = 1000;
const SNIPPET_FILE: &str = "snippet.typ";
const PREAMBLE: &str = "#set page(width: auto, height: auto, margin: 2pt, fill: none)\n";
const PREAMBLE_LINES: u32 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TypstSnippetFormat {
    Svg,
    Png,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstSnippetRequest {
    pub source: String,
    pub format: TypstSnippetFormat,
    #[serde(default)]
    pub ppi: Option<u32>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TypstDiagnosticSeverity {
    Error,
    Warning,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TypstSnippetDiagnostic {
    pub severity: TypstDiagnosticSeverity,
    pub message: String,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(
    tag = "format",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TypstSnippetImage {
    Svg { svg: String },
    Png { png_base64: String },
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TypstSnippetRender {
    Rendered {
        image: TypstSnippetImage,
        diagnostics: Vec<TypstSnippetDiagnostic>,
    },
    Failed {
        diagnostics: Vec<TypstSnippetDiagnostic>,
    },
}

impl TypstSnippetFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Svg => "svg",
            Self::Png => "png",
        }
    }
}

fn bounded_message(message: &str) -> String {
    message.trim().chars().take(MAX_MESSAGE_CHARS).collect()
}

fn snippet_position(location: &str) -> Option<(u32, u32)> {
    let mut fields = location.rsplitn(3, ':');
    let column = fields.next()?.parse::<u32>().ok()?;
    let line = fields.next()?.parse::<u32>().ok()?;
    let file = fields.next()?;
    if file.trim_start_matches("./") != SNIPPET_FILE {
        return None;
    }
    let line = line.checked_sub(PREAMBLE_LINES).filter(|line| *line > 0)?;
    Some((line, column))
}

fn parse_diagnostic_line(line: &str) -> Option<TypstSnippetDiagnostic> {
    let line = line.trim_end();
    [
        (TypstDiagnosticSeverity::Error, "error: "),
        (TypstDiagnosticSeverity::Warning, "warning: "),
    ]
    .into_iter()
    .find_map(|(severity, label)| {
        let (position, message) = match line.strip_prefix(label) {
            Some(message) => (None, message),
            None => {
                let (location, message) = line.split_once(&format!(": {label}"))?;
                (snippet_position(location), message)
            }
        };
        Some(TypstSnippetDiagnostic {
            severity,
            message: bounded_message(message),
            line: position.map(|(line, _)| line),
            column: position.map(|(_, column)| column),
        })
    })
}

fn parse_snippet_diagnostics(log: &str) -> Vec<TypstSnippetDiagnostic> {
    log.lines()
        .filter_map(parse_diagnostic_line)
        .take(MAX_DIAGNOSTICS)
        .collect()
}

fn resolution(request: &TypstSnippetRequest) -> Result<Option<u32>, String> {
    if request.format != TypstSnippetFormat::Png {
        return Ok(None);
    }
    let ppi = request.ppi.unwrap_or(DEFAULT_PPI);
    if ppi == 0 || ppi > MAX_PPI {
        return Err(format!(
            "The PNG resolution must be between 1 and {MAX_PPI} pixels per inch."
        ));
    }
    Ok(Some(ppi))
}

fn snippet_args(
    root: &Path,
    output: &str,
    format: TypstSnippetFormat,
    ppi: Option<u32>,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--color=never".into(),
        "compile".into(),
        SNIPPET_FILE.into(),
        output.into(),
        "--root".into(),
        root.to_string_lossy().into_owned(),
        "--diagnostic-format".into(),
        "short".into(),
        "--format".into(),
        format.extension().into(),
    ];
    if let Some(ppi) = ppi {
        args.extend(["--ppi".into(), ppi.to_string()]);
    }
    args
}

fn failure_without_diagnostics(log: &str, code: Option<i32>) -> TypstSnippetDiagnostic {
    let message = log
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(bounded_message)
        .unwrap_or_else(|| match code {
            Some(code) => format!("Typst stopped with exit code {code}."),
            None => "Typst stopped before it finished.".into(),
        });
    TypstSnippetDiagnostic {
        severity: TypstDiagnosticSeverity::Error,
        message,
        line: None,
        column: None,
    }
}

fn read_image(path: &Path, format: TypstSnippetFormat) -> Result<TypstSnippetImage, String> {
    let size = std::fs::metadata(path)
        .map_err(|error| format!("Typst did not write the rendered image: {error}"))?
        .len();
    if size > MAX_IMAGE_BYTES {
        return Err("The rendered Typst image is too large.".into());
    }
    let bytes = std::fs::read(path)
        .map_err(|error| format!("failed to read the rendered Typst image: {error}"))?;
    Ok(match format {
        TypstSnippetFormat::Svg => TypstSnippetImage::Svg {
            svg: String::from_utf8(bytes)
                .map_err(|_| "Typst wrote an SVG that is not valid UTF-8.".to_string())?,
        },
        TypstSnippetFormat::Png => TypstSnippetImage::Png {
            png_base64: STANDARD.encode(bytes),
        },
    })
}

pub(crate) fn render_snippet(
    typst: &Path,
    request: &TypstSnippetRequest,
    timeout: Duration,
) -> Result<TypstSnippetRender, String> {
    if request.source.len() > MAX_SOURCE_BYTES {
        return Err("This Typst snippet is too large to render.".into());
    }
    let ppi = resolution(request)?;
    let workspace = tempfile::Builder::new()
        .prefix("oleafly-typst-snippet-")
        .tempdir()
        .map_err(|error| format!("failed to create a Typst workspace: {error}"))?;
    let root = workspace.path();
    std::fs::write(
        root.join(SNIPPET_FILE),
        format!("{PREAMBLE}{}\n", request.source),
    )
    .map_err(|error| format!("failed to write the Typst snippet: {error}"))?;
    let output_name = format!("snippet.{}", request.format.extension());
    let mut command = Command::new(typst);
    command
        .args(snippet_args(root, &output_name, request.format, ppi))
        .current_dir(root);
    let output = crate::proc::output_contained_with_timeout(command, timeout).map_err(|error| {
        if error.kind() == std::io::ErrorKind::TimedOut {
            "Typst took too long to render this snippet.".to_string()
        } else {
            format!("failed to run Typst: {error}")
        }
    })?;
    let log = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout)
    );
    let mut diagnostics = parse_snippet_diagnostics(&log);
    if !output.status.success() {
        if !diagnostics
            .iter()
            .any(|diagnostic| diagnostic.severity == TypstDiagnosticSeverity::Error)
        {
            diagnostics.insert(0, failure_without_diagnostics(&log, output.status.code()));
        }
        return Ok(TypstSnippetRender::Failed { diagnostics });
    }
    let image = read_image(&root.join(&output_name), request.format)?;
    Ok(TypstSnippetRender::Rendered { image, diagnostics })
}

#[tauri::command]
pub async fn render_typst_snippet(
    request: TypstSnippetRequest,
) -> Result<TypstSnippetRender, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let typst = crate::document_engine::resolve_bundled_sidecar(TYPST_SIDECAR)?;
        render_snippet(&typst, &request, RENDER_TIMEOUT)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn request(source: &str, format: TypstSnippetFormat, ppi: Option<u32>) -> TypstSnippetRequest {
        TypstSnippetRequest {
            source: source.into(),
            format,
            ppi,
        }
    }

    fn bundled_typst() -> Option<PathBuf> {
        let triple = crate::biber_toolchain::host_triple_guess()?;
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("typst-{triple}{}", std::env::consts::EXE_SUFFIX));
        path.is_file().then_some(path)
    }

    fn error(message: &str, line: Option<u32>, column: Option<u32>) -> TypstSnippetDiagnostic {
        TypstSnippetDiagnostic {
            severity: TypstDiagnosticSeverity::Error,
            message: message.into(),
            line,
            column,
        }
    }

    #[test]
    fn diagnostics_point_at_snippet_lines_and_keep_unlocated_messages() {
        let log = "snippet.typ:2:6: error: unclosed delimiter\n\
                   snippet.typ:4:1: warning: unknown font family: foo\n\
                   error: cannot export multiple images without a page number template\n\
                   @preview/pkg:0.1.0/lib.typ:3:2: error: deep failure\n\
                   snippet.typ:1:9: error: inside the preamble\n\
                   compiled with errors\n";
        assert_eq!(
            parse_snippet_diagnostics(log),
            vec![
                error("unclosed delimiter", Some(1), Some(6)),
                TypstSnippetDiagnostic {
                    severity: TypstDiagnosticSeverity::Warning,
                    message: "unknown font family: foo".into(),
                    line: Some(3),
                    column: Some(1),
                },
                error(
                    "cannot export multiple images without a page number template",
                    None,
                    None
                ),
                error("deep failure", None, None),
                error("inside the preamble", None, None),
            ]
        );
    }

    #[test]
    fn rejects_oversized_sources_and_unusable_resolutions_before_launching() {
        let missing = Path::new("/nonexistent/typst");
        let huge = "x".repeat(MAX_SOURCE_BYTES + 1);
        for (request, expected) in [
            (request(&huge, TypstSnippetFormat::Svg, None), "too large"),
            (
                request("$x$", TypstSnippetFormat::Png, Some(0)),
                "resolution",
            ),
            (
                request("$x$", TypstSnippetFormat::Png, Some(MAX_PPI + 1)),
                "resolution",
            ),
        ] {
            let error = render_snippet(missing, &request, RENDER_TIMEOUT).unwrap_err();
            assert!(error.contains(expected), "{error}");
        }
    }

    #[test]
    fn serializes_a_tagged_result_for_the_bridge() {
        let rendered = TypstSnippetRender::Rendered {
            image: TypstSnippetImage::Png {
                png_base64: "AA==".into(),
            },
            diagnostics: Vec::new(),
        };
        assert_eq!(
            serde_json::to_value(&rendered).unwrap(),
            serde_json::json!({
                "status": "rendered",
                "image": { "format": "png", "pngBase64": "AA==" },
                "diagnostics": [],
            })
        );
        let failed = TypstSnippetRender::Failed {
            diagnostics: vec![error("unclosed delimiter", Some(1), Some(6))],
        };
        assert_eq!(
            serde_json::to_value(&failed).unwrap(),
            serde_json::json!({
                "status": "failed",
                "diagnostics": [{
                    "severity": "error",
                    "message": "unclosed delimiter",
                    "line": 1,
                    "column": 6,
                }],
            })
        );
        let parsed: TypstSnippetRequest =
            serde_json::from_value(serde_json::json!({ "source": "$x$", "format": "svg" }))
                .unwrap();
        assert_eq!(parsed.format, TypstSnippetFormat::Svg);
        assert_eq!(parsed.ppi, None);
    }

    #[test]
    fn bundled_typst_renders_display_math_as_svg_and_png() {
        let Some(typst) = bundled_typst() else {
            eprintln!("Typst sidecar is not staged; skipping snippet render check");
            return;
        };
        let svg = render_snippet(
            &typst,
            &request("$ frac(a, b) $", TypstSnippetFormat::Svg, None),
            RENDER_TIMEOUT,
        )
        .unwrap();
        let TypstSnippetRender::Rendered {
            image: TypstSnippetImage::Svg { svg },
            ..
        } = svg
        else {
            panic!("expected an SVG, got {svg:?}");
        };
        assert!(svg.starts_with("<svg"), "{svg}");
        assert!(svg.trim_end().ends_with("</svg>"));
        assert!(svg.contains("<path") || svg.contains("<use"));

        let png = render_snippet(
            &typst,
            &request("$x^2$", TypstSnippetFormat::Png, Some(288)),
            RENDER_TIMEOUT,
        )
        .unwrap();
        let TypstSnippetRender::Rendered {
            image: TypstSnippetImage::Png { png_base64 },
            ..
        } = png
        else {
            panic!("expected a PNG, got {png:?}");
        };
        let bytes = STANDARD.decode(png_base64).unwrap();
        assert!(bytes.starts_with(&[0x89, b'P', b'N', b'G']));
    }

    #[test]
    fn bundled_typst_reports_snippet_errors_and_stays_inside_its_root() {
        let Some(typst) = bundled_typst() else {
            eprintln!("Typst sidecar is not staged; skipping snippet diagnostics check");
            return;
        };
        let broken = render_snippet(
            &typst,
            &request("$ frac(a, $", TypstSnippetFormat::Svg, None),
            RENDER_TIMEOUT,
        )
        .unwrap();
        let TypstSnippetRender::Failed { diagnostics } = broken else {
            panic!("expected a failure, got {broken:?}");
        };
        assert_eq!(diagnostics[0].severity, TypstDiagnosticSeverity::Error);
        assert_eq!(diagnostics[0].line, Some(1));

        let outside = render_snippet(
            &typst,
            &request("#read(\"/etc/hosts\")", TypstSnippetFormat::Svg, None),
            RENDER_TIMEOUT,
        )
        .unwrap();
        assert!(
            matches!(outside, TypstSnippetRender::Failed { .. }),
            "{outside:?}"
        );
    }
}
