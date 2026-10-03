use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use oleafly_core::typst_toolchain::{TypstCapabilities, TypstCompileFlag};

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
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub document: bool,
    #[serde(default)]
    pub offline: bool,
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

impl TypstSnippetRequest {
    fn preamble_lines(&self) -> u32 {
        if self.document {
            0
        } else {
            PREAMBLE_LINES
        }
    }

    fn file_source(&self) -> String {
        if self.document {
            format!("{}\n", self.source)
        } else {
            format!("{PREAMBLE}{}\n", self.source)
        }
    }

    fn output_name(&self) -> String {
        let stem = if self.document {
            "snippet-{n}"
        } else {
            "snippet"
        };
        format!("{stem}.{}", self.format.extension())
    }

    fn page_args(&self, capabilities: &TypstCapabilities) -> Vec<String> {
        if self.document && capabilities.supports_flag("--pages") {
            vec!["--pages".into(), "1".into()]
        } else {
            Vec::new()
        }
    }
}

fn first_page(root: &Path, request: &TypstSnippetRequest) -> PathBuf {
    let extension = format!(".{}", request.format.extension());
    if !request.document {
        return root.join(format!("snippet{extension}"));
    }
    std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let page = name
                .strip_prefix("snippet-")?
                .strip_suffix(extension.as_str())?
                .parse::<u32>()
                .ok()?;
            Some((page, entry.path()))
        })
        .min_by_key(|(page, _)| *page)
        .map(|(_, path)| path)
        .unwrap_or_else(|| root.join(format!("snippet-1{extension}")))
}

fn bounded_message(message: &str) -> String {
    message.trim().chars().take(MAX_MESSAGE_CHARS).collect()
}

fn snippet_position(location: &str, preamble_lines: u32) -> Option<(u32, u32)> {
    let span = oleafly_core::typst_log::parse_typst_location(location)?;
    if !oleafly_core::typst_log::typst_paths_match(&span.file, SNIPPET_FILE) {
        return None;
    }
    let line = span
        .line
        .checked_sub(preamble_lines)
        .filter(|line| *line > 0)?;
    Some((line, span.column))
}

fn parse_diagnostic_line(line: &str, preamble_lines: u32) -> Option<TypstSnippetDiagnostic> {
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
                (snippet_position(location, preamble_lines), message)
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

fn parse_snippet_diagnostics(log: &str, preamble_lines: u32) -> Vec<TypstSnippetDiagnostic> {
    log.lines()
        .filter_map(|line| parse_diagnostic_line(line, preamble_lines))
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
    capabilities: &TypstCapabilities,
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
    ];
    if capabilities.supports_flag("--format") {
        args.extend(["--format".into(), format.extension().into()]);
    }
    if let Some(ppi) = ppi.filter(|_| capabilities.supports_flag("--ppi")) {
        args.extend(["--ppi".into(), ppi.to_string()]);
    }
    args
}

pub(crate) fn package_args(
    packages: Option<&crate::typst_packages::TypstPackageDirs>,
    capabilities: &TypstCapabilities,
) -> Vec<String> {
    packages
        .map(|packages| packages.compile_flags(capabilities))
        .unwrap_or_default()
        .into_iter()
        .flat_map(|flag| {
            let value = match &flag {
                TypstCompileFlag::PackagePath(path) | TypstCompileFlag::PackageCachePath(path) => {
                    path.to_string_lossy().into_owned()
                }
                _ => String::new(),
            };
            [flag.name().to_owned(), value]
        })
        .collect()
}

fn snippet_environment(
    request: &TypstSnippetRequest,
    packages: Option<&crate::typst_packages::TypstPackageDirs>,
) -> Vec<(&'static str, OsString)> {
    let mut environment = packages
        .map(crate::typst_packages::TypstPackageDirs::environment)
        .unwrap_or_default();
    if request.offline {
        environment.extend(
            crate::typst_packages::offline_environment()
                .into_iter()
                .map(|(name, value)| (name, OsString::from(value))),
        );
    }
    environment
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
    capabilities: &TypstCapabilities,
    packages: Option<&crate::typst_packages::TypstPackageDirs>,
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
    std::fs::write(root.join(SNIPPET_FILE), request.file_source())
        .map_err(|error| format!("failed to write the Typst snippet: {error}"))?;
    let output_name = request.output_name();
    let mut command = Command::new(typst);
    command
        .args(snippet_args(
            root,
            &output_name,
            request.format,
            ppi,
            capabilities,
        ))
        .args(request.page_args(capabilities))
        .args(package_args(packages, capabilities))
        .current_dir(root);
    for (name, value) in snippet_environment(request, packages) {
        command.env(name, value);
    }
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
    let mut diagnostics = parse_snippet_diagnostics(&log, request.preamble_lines());
    if !output.status.success() {
        if !diagnostics
            .iter()
            .any(|diagnostic| diagnostic.severity == TypstDiagnosticSeverity::Error)
        {
            diagnostics.insert(0, failure_without_diagnostics(&log, output.status.code()));
        }
        return Ok(TypstSnippetRender::Failed { diagnostics });
    }
    let image = read_image(&first_page(root, request), request.format)?;
    Ok(TypstSnippetRender::Rendered { image, diagnostics })
}

#[tauri::command]
pub async fn render_typst_snippet(
    request: TypstSnippetRequest,
) -> Result<TypstSnippetRender, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let typst = crate::typst_toolchain::snippet_typst(request.project_id.as_deref())?;
        let packages = crate::typst_packages::snippet_dirs(request.project_id.as_deref()).ok();
        render_snippet(
            &typst.path,
            &typst.capabilities,
            packages.as_ref(),
            &request,
            RENDER_TIMEOUT,
        )
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
            project_id: None,
            document: false,
            offline: false,
        }
    }

    fn document(source: &str) -> TypstSnippetRequest {
        TypstSnippetRequest {
            document: true,
            ..request(source, TypstSnippetFormat::Png, Some(72))
        }
    }

    fn with_pages(capabilities: &TypstCapabilities) -> TypstCapabilities {
        let mut capabilities = capabilities.clone();
        capabilities.flags.push("--pages".into());
        capabilities
    }

    fn png_size(png_base64: &str) -> (u32, u32) {
        let bytes = STANDARD.decode(png_base64).unwrap();
        assert!(bytes.starts_with(&[0x89, b'P', b'N', b'G']));
        let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
        let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
        (width, height)
    }

    fn bundled_capabilities() -> &'static TypstCapabilities {
        oleafly_core::typst_toolchain::capabilities_for(
            &oleafly_core::typst_toolchain::bundled_typst_version().to_string(),
        )
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
            parse_snippet_diagnostics(log, PREAMBLE_LINES),
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
            let error = render_snippet(
                missing,
                bundled_capabilities(),
                None,
                &request,
                RENDER_TIMEOUT,
            )
            .unwrap_err();
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
        assert_eq!(parsed.project_id, None);
        let pinned: TypstSnippetRequest = serde_json::from_value(serde_json::json!({
            "source": "$x$",
            "format": "png",
            "projectId": "paper"
        }))
        .unwrap();
        assert_eq!(pinned.project_id.as_deref(), Some("paper"));
    }

    #[test]
    fn snippet_arguments_only_pass_flags_the_resolved_version_supports() {
        let root = Path::new("/snippet");
        let full = snippet_args(
            root,
            "snippet.png",
            TypstSnippetFormat::Png,
            Some(288),
            bundled_capabilities(),
        );
        assert_eq!(
            full,
            [
                "--color=never",
                "compile",
                SNIPPET_FILE,
                "snippet.png",
                "--root",
                "/snippet",
                "--diagnostic-format",
                "short",
                "--format",
                "png",
                "--ppi",
                "288",
            ]
        );
        let bare = snippet_args(
            root,
            "snippet.png",
            TypstSnippetFormat::Png,
            Some(288),
            &TypstCapabilities::default(),
        );
        assert_eq!(bare.len(), 8);
        assert!(!bare.iter().any(|argument| argument == "--format"));
        assert!(!bare.iter().any(|argument| argument == "--ppi"));
    }

    #[test]
    fn snippet_renders_pass_the_package_directories_the_version_accepts() {
        let dirs = crate::typst_packages::TypstPackageDirs::app(Path::new("/data"));
        let package_path = dirs.package_path.to_string_lossy().into_owned();
        let cache_path = dirs.cache_path.to_string_lossy().into_owned();
        assert_eq!(
            package_args(Some(&dirs), bundled_capabilities()),
            [
                "--package-path",
                package_path.as_str(),
                "--package-cache-path",
                cache_path.as_str(),
            ]
        );
        assert!(package_args(
            Some(&dirs),
            oleafly_core::typst_toolchain::capabilities_for("0.11.1")
        )
        .is_empty());
        assert!(package_args(None, bundled_capabilities()).is_empty());
    }

    #[test]
    fn bundled_typst_renders_snippets_that_import_cached_packages() {
        let Some(typst) = bundled_typst() else {
            eprintln!("Typst sidecar is not staged; skipping the package snippet render");
            return;
        };
        let data = tempfile::tempdir().unwrap();
        let dirs = crate::typst_packages::TypstPackageDirs::app(data.path());
        let package = dirs
            .cache_path
            .join("preview")
            .join("zz-oleafly-snippet")
            .join("0.1.0");
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(
            package.join("typst.toml"),
            "[package]\nname = \"zz-oleafly-snippet\"\nversion = \"0.1.0\"\nentrypoint = \"lib.typ\"\n",
        )
        .unwrap();
        std::fs::write(package.join("lib.typ"), "#let shout(x) = upper(x)").unwrap();
        let rendered = render_snippet(
            &typst,
            bundled_capabilities(),
            Some(&dirs),
            &request(
                "#import \"@preview/zz-oleafly-snippet:0.1.0\": shout\n#shout[hi]",
                TypstSnippetFormat::Svg,
                None,
            ),
            RENDER_TIMEOUT,
        )
        .unwrap();
        assert!(
            matches!(rendered, TypstSnippetRender::Rendered { .. }),
            "{rendered:?}"
        );
    }

    #[test]
    fn offline_requests_add_the_offline_environment_after_the_package_variables() {
        let dirs = crate::typst_packages::TypstPackageDirs::app(Path::new("/data"));
        let offline_pairs: Vec<(&'static str, std::ffi::OsString)> =
            crate::typst_packages::offline_environment()
                .into_iter()
                .map(|(name, value)| (name, value.into()))
                .collect();
        let online = request("$x$", TypstSnippetFormat::Svg, None);
        let offline = TypstSnippetRequest {
            offline: true,
            ..request("$x$", TypstSnippetFormat::Svg, None)
        };
        assert_eq!(
            snippet_environment(&online, Some(&dirs)),
            dirs.environment()
        );
        assert!(snippet_environment(&online, None).is_empty());
        assert_eq!(
            snippet_environment(&offline, Some(&dirs)),
            dirs.environment()
                .into_iter()
                .chain(offline_pairs.clone())
                .collect::<Vec<_>>()
        );
        assert_eq!(snippet_environment(&offline, None), offline_pairs);

        let parsed: TypstSnippetRequest =
            serde_json::from_value(serde_json::json!({ "source": "$x$", "format": "svg" }))
                .unwrap();
        assert!(!parsed.offline);
        let parsed: TypstSnippetRequest = serde_json::from_value(serde_json::json!({
            "source": "$x$",
            "format": "svg",
            "offline": true
        }))
        .unwrap();
        assert!(parsed.offline);
    }

    #[test]
    fn bundled_typst_offline_snippets_fail_fast_on_packages_that_are_not_cached() {
        let Some(typst) = bundled_typst() else {
            eprintln!("Typst sidecar is not staged; skipping the offline snippet render");
            return;
        };
        let data = tempfile::tempdir().unwrap();
        let dirs = crate::typst_packages::TypstPackageDirs::app(data.path());
        let rendered = render_snippet(
            &typst,
            bundled_capabilities(),
            Some(&dirs),
            &TypstSnippetRequest {
                offline: true,
                ..request(
                    "#import \"@preview/zz-oleafly-uncached:0.1.0\": shout\n#shout[hi]",
                    TypstSnippetFormat::Svg,
                    None,
                )
            },
            RENDER_TIMEOUT,
        )
        .unwrap();
        let TypstSnippetRender::Failed { diagnostics } = rendered else {
            panic!("expected a failure, got {rendered:?}");
        };
        assert!(
            diagnostics[0]
                .message
                .contains("failed to download package"),
            "{diagnostics:?}"
        );
        assert_eq!(diagnostics[0].line, Some(1));
    }

    #[test]
    fn bundled_typst_renders_display_math_as_svg_and_png() {
        let Some(typst) = bundled_typst() else {
            eprintln!("Typst sidecar is not staged; skipping snippet render check");
            return;
        };
        let svg = render_snippet(
            &typst,
            bundled_capabilities(),
            None,
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
            bundled_capabilities(),
            None,
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
            bundled_capabilities(),
            None,
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
            bundled_capabilities(),
            None,
            &request("#read(\"/etc/hosts\")", TypstSnippetFormat::Svg, None),
            RENDER_TIMEOUT,
        )
        .unwrap();
        assert!(
            matches!(outside, TypstSnippetRender::Failed { .. }),
            "{outside:?}"
        );
    }

    #[test]
    fn document_requests_skip_the_preamble_and_ask_for_the_first_page_only() {
        let snippet = request("$x$", TypstSnippetFormat::Png, None);
        assert_eq!(snippet.file_source(), format!("{PREAMBLE}$x$\n"));
        assert_eq!(snippet.output_name(), "snippet.png");
        assert!(snippet
            .page_args(&with_pages(bundled_capabilities()))
            .is_empty());

        let full = document("= Title");
        assert_eq!(full.file_source(), "= Title\n");
        assert_eq!(full.output_name(), "snippet-{n}.png");
        assert_eq!(
            full.page_args(&with_pages(bundled_capabilities())),
            ["--pages", "1"]
        );
        assert!(full.page_args(&TypstCapabilities::default()).is_empty());

        let parsed: TypstSnippetRequest = serde_json::from_value(serde_json::json!({
            "source": "= Title",
            "format": "png",
            "document": true
        }))
        .unwrap();
        assert!(parsed.document);
        let snippet: TypstSnippetRequest =
            serde_json::from_value(serde_json::json!({ "source": "$x$", "format": "svg" }))
                .unwrap();
        assert!(!snippet.document);
    }

    #[test]
    fn diagnostics_find_the_snippet_behind_windows_and_absolute_paths() {
        let log = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\oleafly-typst-snippet-x\\snippet.typ:2:6: error: unclosed delimiter\n\
                   .\\snippet.typ:3:1: warning: unknown font family: foo\n\
                   /private/var/folders/x/oleafly-typst-snippet-y/snippet.typ:2:0: error: unknown variable: a\n\
                   C:\\Temp\\lib\\other.typ:2:0: error: elsewhere\n";
        let diagnostics = parse_snippet_diagnostics(log, PREAMBLE_LINES);
        assert_eq!(
            diagnostics[0],
            error("unclosed delimiter", Some(1), Some(6))
        );
        assert_eq!(
            (diagnostics[1].line, diagnostics[1].column),
            (Some(2), Some(1))
        );
        assert_eq!(
            diagnostics[2],
            error("unknown variable: a", Some(1), Some(0))
        );
        assert_eq!(diagnostics[3], error("elsewhere", None, None));
    }

    #[test]
    fn document_diagnostics_keep_their_source_line_numbers() {
        let log = "snippet.typ:1:5: error: unknown variable: foo\n\
                   snippet.typ:12:2: warning: unused value\n";
        assert_eq!(
            parse_snippet_diagnostics(log, 0),
            vec![
                error("unknown variable: foo", Some(1), Some(5)),
                TypstSnippetDiagnostic {
                    severity: TypstDiagnosticSeverity::Warning,
                    message: "unused value".into(),
                    line: Some(12),
                    column: Some(2),
                },
            ]
        );
        assert_eq!(parse_snippet_diagnostics(log, PREAMBLE_LINES)[0].line, None);
    }

    #[test]
    fn first_page_is_the_lowest_numbered_page_the_compiler_wrote() {
        let root = tempfile::tempdir().unwrap();
        for name in [
            "snippet-02.png",
            "snippet-01.png",
            "snippet-10.png",
            "snippet-x.png",
            "snippet-01.svg",
            "snippet.typ",
        ] {
            std::fs::write(root.path().join(name), b"").unwrap();
        }
        assert_eq!(
            first_page(root.path(), &document("x")),
            root.path().join("snippet-01.png")
        );
        assert_eq!(
            first_page(root.path(), &request("x", TypstSnippetFormat::Png, None)),
            root.path().join("snippet.png")
        );
    }

    #[test]
    fn bundled_typst_renders_the_first_page_of_a_multi_page_document() {
        let Some(typst) = bundled_typst() else {
            eprintln!("Typst sidecar is not staged; skipping document render check");
            return;
        };
        let source = "#set page(width: 100pt, height: 50pt, margin: 5pt)\n\
                      First\n\
                      #set page(width: 300pt, height: 200pt)\n\
                      Second\n";
        for capabilities in [
            bundled_capabilities().clone(),
            with_pages(bundled_capabilities()),
        ] {
            let rendered = render_snippet(
                &typst,
                &capabilities,
                None,
                &document(source),
                RENDER_TIMEOUT,
            )
            .unwrap();
            let TypstSnippetRender::Rendered {
                image: TypstSnippetImage::Png { png_base64 },
                diagnostics,
            } = rendered
            else {
                panic!("expected page 1 as a PNG, got {rendered:?}");
            };
            assert!(diagnostics.is_empty(), "{diagnostics:?}");
            assert_eq!(png_size(&png_base64), (100, 50));
        }

        let broken = render_snippet(
            &typst,
            &with_pages(bundled_capabilities()),
            None,
            &document("= Title\n#let x = (\n"),
            RENDER_TIMEOUT,
        )
        .unwrap();
        let TypstSnippetRender::Failed { diagnostics } = broken else {
            panic!("expected a failure, got {broken:?}");
        };
        assert_eq!(diagnostics[0].severity, TypstDiagnosticSeverity::Error);
        assert_eq!(diagnostics[0].line, Some(2));
    }
}
