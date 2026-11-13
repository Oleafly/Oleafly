use std::sync::LazyLock;
use std::time::Duration;

use crate::app_error::AppError;
use crate::notes_render::{RenderStore, MAX_SVG_BYTES};

use crate::typst_render::{
    TypstDiagnosticSeverity, TypstSnippetDiagnostic, TypstSnippetFormat, TypstSnippetImage,
    TypstSnippetRender, TypstSnippetRequest,
};

const TIMEOUT: Duration = Duration::from_secs(10);
pub const MAX_SOURCE_BYTES: usize = 64 * 1024;

static RENDERS: LazyLock<RenderStore> = LazyLock::new(|| RenderStore::new("notes-typst"));

pub fn source_key(typst_version: &str, source: &str) -> String {
    crate::collab::disk::sha256_hex(format!("typst {typst_version}\0{source}").as_bytes())
}

pub fn check_source(source: &str) -> Result<(), String> {
    if source.trim().is_empty() {
        return Err(AppError::new("notes.typst_empty").into());
    }
    if source.len() > MAX_SOURCE_BYTES {
        return Err(AppError::new("notes.typst_too_large").into());
    }
    Ok(())
}

pub fn snippet_request(source: String) -> TypstSnippetRequest {
    TypstSnippetRequest {
        source,
        format: TypstSnippetFormat::Svg,
        ppi: None,
        project_id: None,
        document: false,
        offline: true,
    }
}

fn located(diagnostic: &TypstSnippetDiagnostic) -> String {
    match diagnostic.line {
        Some(line) => AppError::new("notes.typst_line")
            .param("line", line)
            .param("message", &diagnostic.message)
            .into(),
        None => diagnostic.message.clone(),
    }
}

pub fn render_outcome(render: TypstSnippetRender) -> Result<String, String> {
    match render {
        TypstSnippetRender::Rendered {
            image: TypstSnippetImage::Svg { svg },
            ..
        } => {
            if svg.len() > MAX_SVG_BYTES {
                Err(AppError::new("notes.typst_image_too_large").into())
            } else {
                Ok(svg)
            }
        }
        TypstSnippetRender::Rendered { .. } => Err(AppError::new("notes.typst_no_svg").into()),
        TypstSnippetRender::Failed { diagnostics } => Err(diagnostics
            .iter()
            .find(|diagnostic| diagnostic.severity == TypstDiagnosticSeverity::Error)
            .or_else(|| diagnostics.first())
            .map(located)
            .unwrap_or_else(|| AppError::new("notes.typst_failed").into())),
    }
}

fn render_with(
    typst: &oleafly_core::typst_toolchain::ResolvedTypst,
    source: String,
) -> Result<String, String> {
    let packages = crate::typst_packages::snippet_dirs(None).ok();
    let render = crate::typst_render::render_snippet(
        &typst.path,
        &typst.capabilities,
        packages.as_ref(),
        &snippet_request(source),
        TIMEOUT,
    )?;
    render_outcome(render)
}

#[tauri::command]
pub async fn notes_render_typst(app: tauri::AppHandle, source: String) -> Result<String, String> {
    check_source(&source)?;
    let typst =
        tauri::async_runtime::spawn_blocking(|| crate::typst_toolchain::snippet_typst(None))
            .await
            .map_err(|error| error.to_string())??;
    let key = source_key(&typst.version.to_string(), &source);
    if let Some(svg) = RENDERS.cached(&key) {
        return Ok(svg.as_ref().clone());
    }
    RENDERS
        .render(key, RENDERS.disk_dir(&app), move || async move {
            tauri::async_runtime::spawn_blocking(move || render_with(&typst, source))
                .await
                .map_err(|error| error.to_string())?
        })
        .await
        .map(|svg| svg.as_ref().clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    const TYPST: &str = "0.14.0";

    fn diagnostic(
        severity: TypstDiagnosticSeverity,
        message: &str,
        line: Option<u32>,
    ) -> TypstSnippetDiagnostic {
        TypstSnippetDiagnostic {
            severity,
            message: message.into(),
            line,
            column: None,
        }
    }

    #[test]
    fn rejects_empty_and_oversized_sources() {
        assert!(check_source("   \n")
            .unwrap_err()
            .contains("notes.typst_empty"));
        assert!(check_source(&"x".repeat(MAX_SOURCE_BYTES + 1))
            .unwrap_err()
            .contains("notes.typst_too_large"));
        assert!(check_source("$ x $").is_ok());
    }

    #[test]
    fn requests_an_offline_svg_snippet_outside_any_project() {
        let request = snippet_request("$ x $".into());
        assert_eq!(request.format, TypstSnippetFormat::Svg);
        assert!(request.offline);
        assert!(request.project_id.is_none());
        assert!(!request.document);
        assert!(request.ppi.is_none());
    }

    #[test]
    fn keys_are_stable_sha256_digests_of_the_typst_version_and_source() {
        assert_eq!(source_key(TYPST, "a"), source_key(TYPST, "a"));
        assert_ne!(source_key(TYPST, "a"), source_key(TYPST, "b"));
        assert_ne!(source_key(TYPST, "a"), source_key("0.15.0", "a"));
        assert_ne!(source_key("0.1", "4.0a"), source_key("0.14.0", "a"));
        assert_eq!(source_key(TYPST, "").len(), 64);
    }

    #[test]
    fn errors_are_coded_for_the_interface() {
        let english = |error: String| crate::app_error::english(&error).unwrap();
        assert_eq!(
            english(check_source("   \n").unwrap_err()),
            "This Typst block is empty."
        );
        assert_eq!(
            english(
                render_outcome(TypstSnippetRender::Failed {
                    diagnostics: vec![diagnostic(
                        TypstDiagnosticSeverity::Error,
                        "unclosed delimiter",
                        Some(2)
                    )],
                })
                .unwrap_err()
            ),
            "Line 2: unclosed delimiter"
        );
        for code in [
            "notes.typst_empty",
            "notes.typst_too_large",
            "notes.typst_image_too_large",
            "notes.typst_no_svg",
            "notes.typst_failed",
            "notes.typst_line",
        ] {
            let text: String = AppError::new(code).into();
            assert!(crate::app_error::english(&text).is_some(), "{code}");
        }
    }

    #[test]
    fn outcomes_return_the_svg_or_the_first_error() {
        assert_eq!(
            render_outcome(TypstSnippetRender::Rendered {
                image: TypstSnippetImage::Svg {
                    svg: "<svg/>".into()
                },
                diagnostics: Vec::new(),
            }),
            Ok("<svg/>".into())
        );
        assert!(render_outcome(TypstSnippetRender::Rendered {
            image: TypstSnippetImage::Svg {
                svg: "x".repeat(MAX_SVG_BYTES + 1)
            },
            diagnostics: Vec::new(),
        })
        .unwrap_err()
        .contains("notes.typst_image_too_large"));
        assert!(render_outcome(TypstSnippetRender::Rendered {
            image: TypstSnippetImage::Png {
                png_base64: "AA==".into()
            },
            diagnostics: Vec::new(),
        })
        .is_err());
        assert_eq!(
            render_outcome(TypstSnippetRender::Failed {
                diagnostics: vec![
                    diagnostic(TypstDiagnosticSeverity::Warning, "unknown font", Some(1)),
                    diagnostic(
                        TypstDiagnosticSeverity::Error,
                        "unclosed delimiter",
                        Some(2)
                    ),
                ],
            }),
            Err(AppError::new("notes.typst_line")
                .param("line", 2)
                .param("message", "unclosed delimiter")
                .into())
        );
        assert_eq!(
            render_outcome(TypstSnippetRender::Failed {
                diagnostics: vec![diagnostic(
                    TypstDiagnosticSeverity::Warning,
                    "only a warning",
                    None
                )],
            }),
            Err("only a warning".into())
        );
        assert!(render_outcome(TypstSnippetRender::Failed {
            diagnostics: Vec::new()
        })
        .unwrap_err()
        .contains("notes.typst_failed"));
    }

    #[test]
    fn renders_a_snippet_with_the_bundled_typst_when_present() {
        let triple = match crate::biber_toolchain::host_triple_guess() {
            Some(triple) => triple,
            None => return,
        };
        let typst = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("typst-{triple}{}", std::env::consts::EXE_SUFFIX));
        if !typst.is_file() {
            return;
        }
        let capabilities = oleafly_core::typst_toolchain::capabilities_for(
            &oleafly_core::typst_toolchain::bundled_typst_version().to_string(),
        );
        let render = crate::typst_render::render_snippet(
            &typst,
            capabilities,
            None,
            &snippet_request("$ E = m c^2 $".into()),
            TIMEOUT,
        )
        .unwrap();
        assert!(render_outcome(render).unwrap().contains("<svg"));
        let failed = crate::typst_render::render_snippet(
            &typst,
            capabilities,
            None,
            &snippet_request("#let x = (".into()),
            TIMEOUT,
        )
        .unwrap();
        assert!(render_outcome(failed)
            .unwrap_err()
            .contains("\"line\":\"1\""));
    }
}
