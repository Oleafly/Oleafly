use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, PoisonError};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use oleafly_core::engine_spec::{
    args_without_bundle, bundle_retry_needed, bundle_retry_replaces_first_run, tectonic_args,
    tex_bundle_url, write_tectonic_prefetch, write_tex_defaults, EngineFlags,
    TEX_BUNDLE_UPSTREAM_URL, TEX_DEFAULTS_DIR,
};
use tauri::Manager;

use crate::app_error::AppError;
use crate::document_engine::CompileResult;
use crate::notes_render::{RenderStore, MAX_SVG_BYTES};
use crate::proc::NoConsole;
use crate::typst_render::{TypstSnippetImage, TypstSnippetRender};

const MAX_DOCUMENT_BYTES: usize = 64 * 1024;
const RENDER_VERSION: u32 = 2;
const TIME_LIMIT: Duration = Duration::from_secs(90);
const CONVERT_TIMEOUT: Duration = Duration::from_secs(20);
const STEM: &str = "figure";
const ENTRY: &str = "figure.tex";
const CONVERT: &str = "#set page(margin: 0pt)\n#image(\"figure.pdf\")";
const EMBEDDED_SVG: &str = "data:image/svg+xml;base64,";
const SANDBOX_OWNER: &str = "notes:tikz";
const TEX_HOME: &str = "notes-tikz-tex";
const TEX_CACHE: &str = "tectonic";
const TEX_CACHE_VARIABLE: &str = "TECTONIC_CACHE_DIR";
const RUN_HOME: &str = "home";
const WARM_UP: &str = "\\documentclass[border=4pt]{standalone}\n\\usepackage{tikz}\n\\usepackage{circuitikz}\n\\begin{document}\n\\begin{tikzpicture}\\draw (0,0) circle (1) node {$\\int x$};\\end{tikzpicture}\n\\begin{circuitikz}\\draw (0,0) to[R, l=$R$] (2,0);\\end{circuitikz}\n\\end{document}\n";

static RENDERS: LazyLock<RenderStore> = LazyLock::new(|| RenderStore::new("notes-tikz"));
static WARMING: Mutex<()> = Mutex::new(());

fn check_document(document: &str) -> Result<(), String> {
    if document.trim().is_empty() {
        return Err(AppError::new("notes.tikz_empty").into());
    }
    if document.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::new("notes.tikz_too_large").into());
    }
    Ok(())
}

fn document_key(typst_version: &str, document: &str) -> String {
    crate::collab::disk::sha256_hex(
        format!("tikz {RENDER_VERSION} {typst_version}\0{document}").as_bytes(),
    )
}

fn in_entry(file: Option<&str>) -> bool {
    file.is_none_or(|file| {
        Path::new(file)
            .file_name()
            .is_some_and(|name| name == ENTRY)
    })
}

fn tex_failure(result: &CompileResult) -> String {
    if result.stopped {
        return AppError::new("notes.tikz_timeout").into();
    }
    let Some(error) = result
        .errors
        .iter()
        .find(|error| error.kind == "error")
        .or_else(|| result.errors.first())
    else {
        return AppError::new("notes.tikz_failed").into();
    };
    let message = error.message.trim();
    match error.line.filter(|_| in_entry(error.file.as_deref())) {
        Some(line) => AppError::new("notes.tikz_line")
            .param("line", line)
            .param("message", message)
            .into(),
        None if message.is_empty() => AppError::new("notes.tikz_failed").into(),
        None => message.to_owned(),
    }
}

fn attribute<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let marker = format!(" {name}=\"");
    let start = tag.find(&marker)? + marker.len();
    let length = tag[start..].find('"')?;
    Some(&tag[start..start + length])
}

fn without_attribute(tag: &str, name: &str) -> String {
    match attribute(tag, name) {
        Some(value) => tag.replacen(&format!(" {name}=\"{value}\""), "", 1),
        None => tag.to_owned(),
    }
}

fn unwrapped(svg: &str) -> Option<String> {
    if svg.matches("<image").count() != 1 || svg.contains("transform=") {
        return None;
    }
    let root = &svg[..svg.find('>')?];
    let (width, height) = (attribute(root, "width")?, attribute(root, "height")?);
    let start = svg.find(EMBEDDED_SVG)? + EMBEDDED_SVG.len();
    let end = start + svg[start..].find('"')?;
    let inner = String::from_utf8(STANDARD.decode(&svg[start..end]).ok()?).ok()?;
    let inner = inner.trim_start();
    if !inner.starts_with("<svg") {
        return None;
    }
    let close = inner.find('>')?;
    let tag = &inner[..close];
    attribute(tag, "viewBox")?;
    let tag = without_attribute(&without_attribute(tag, "width"), "height");
    Some(format!(
        "{tag} width=\"{width}\" height=\"{height}\"{}",
        &inner[close..]
    ))
}

fn flattened(svg: String) -> String {
    unwrapped(&svg).unwrap_or(svg)
}

fn converted(render: TypstSnippetRender) -> Result<String, String> {
    match render {
        TypstSnippetRender::Rendered {
            image: TypstSnippetImage::Svg { svg },
            ..
        } => {
            let svg = flattened(svg);
            if svg.len() > MAX_SVG_BYTES {
                Err(AppError::new("notes.tikz_image_too_large").into())
            } else {
                Ok(svg)
            }
        }
        _ => Err(AppError::new("notes.tikz_convert_failed").into()),
    }
}

fn pdf_svg(typst: &Path, dir: &Path) -> Result<String, String> {
    let version = oleafly_core::typst_toolchain::bundled_typst_version().to_string();
    let render = crate::typst_render::render_snippet_in(
        typst,
        oleafly_core::typst_toolchain::capabilities_for(&version),
        None,
        &crate::notes_typst::snippet_request(CONVERT.into()),
        CONVERT_TIMEOUT,
        dir,
    )?;
    converted(render)
}

fn tex_args(build: &Path) -> Vec<OsString> {
    let defaults = build.join(TEX_DEFAULTS_DIR);
    tectonic_args(
        build,
        &[build, &defaults],
        &build.join(ENTRY),
        Some(&tex_bundle_url()),
        EngineFlags {
            offline: false,
            fast: true,
            halt_on_error: true,
        },
    )
}

fn sandbox_owner(build: &Path) -> String {
    let name = build.file_name().unwrap_or(build.as_os_str());
    format!("{SANDBOX_OWNER}:{}", name.to_string_lossy())
}

fn tex_sandbox(build: &Path, tectonic: &Path) -> oleafly_sandbox::SandboxSpec {
    let mut spec = oleafly_sandbox::SandboxSpec::new(
        sandbox_owner(build),
        build.to_path_buf(),
        build.join(RUN_HOME),
    );
    spec.read_write = vec![build.to_path_buf()];
    spec.read_only = std::iter::once(tectonic)
        .chain(tectonic.parent())
        .map(Path::to_path_buf)
        .collect();
    spec.network = true;
    spec.env.insert(
        TEX_CACHE_VARIABLE.into(),
        build.join(TEX_CACHE).to_string_lossy().into_owned(),
    );
    spec
}

struct TexRun {
    ok: bool,
    log: String,
    stopped: bool,
}

fn run_tex(
    spec: &oleafly_sandbox::SandboxSpec,
    tectonic: &Path,
    args: &[OsString],
) -> Result<TexRun, String> {
    let mut command = oleafly_sandbox::command(spec, tectonic, args)?;
    command.no_console().current_dir(&spec.workspace);
    match crate::proc::output_contained_with_timeout(command, TIME_LIMIT) {
        Ok(output) => Ok(TexRun {
            ok: output.status.success(),
            log: format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            ),
            stopped: false,
        }),
        Err(error) if error.kind() == std::io::ErrorKind::TimedOut => Ok(TexRun {
            ok: false,
            log: String::new(),
            stopped: true,
        }),
        Err(error) => Err(setup_failed(error)),
    }
}

fn setup_failed(error: impl ToString) -> String {
    AppError::new("notes.tikz_setup_failed")
        .detail(error)
        .into()
}

fn compile_entry(
    spec: &oleafly_sandbox::SandboxSpec,
    tectonic: &Path,
) -> Result<CompileResult, String> {
    let build = spec.workspace.as_path();
    write_tex_defaults(&build.join(TEX_DEFAULTS_DIR)).map_err(|error| error.to_string())?;
    write_tectonic_prefetch(
        &build.join(TEX_CACHE).join("bundles"),
        &[&tex_bundle_url(), TEX_BUNDLE_UPSTREAM_URL],
    );
    let args = tex_args(build);
    let mut run = run_tex(spec, tectonic, &args)?;
    if !run.stopped && bundle_retry_needed(run.ok, &run.log) {
        let retry = run_tex(spec, tectonic, &args_without_bundle(&args))?;
        if bundle_retry_replaces_first_run(run.ok, retry.ok) {
            run = retry;
        }
    }
    Ok(CompileResult {
        ok: run.ok,
        has_pdf: build.join(format!("{STEM}.pdf")).is_file(),
        errors: oleafly_core::tex_errors::parse_tectonic_log_errors(&run.log),
        stopped: run.stopped,
        ..Default::default()
    })
}

fn draw_in(tectonic: &Path, build: &Path, document: &str) -> Result<(), String> {
    std::fs::write(build.join(ENTRY), document).map_err(setup_failed)?;
    std::fs::create_dir_all(build.join(RUN_HOME)).map_err(setup_failed)?;
    let spec = tex_sandbox(build, tectonic);
    let result = compile_entry(&spec, tectonic);
    let _ = oleafly_sandbox::release(&spec.owner);
    let result = result?;
    if !result.ok || !result.has_pdf {
        return Err(tex_failure(&result));
    }
    Ok(())
}

fn base_cache_name() -> String {
    let key = crate::collab::disk::sha256_hex(
        format!(
            "{RENDER_VERSION} {} {}\0{WARM_UP}",
            env!("CARGO_PKG_VERSION"),
            tex_bundle_url()
        )
        .as_bytes(),
    );
    format!("base-{}", &key[..16])
}

fn base_cache(tectonic: &Path, home: &Path) -> Result<PathBuf, String> {
    let base = home.join(base_cache_name());
    let _warming = WARMING.lock().unwrap_or_else(PoisonError::into_inner);
    if base.is_dir() {
        return Ok(base);
    }
    let _ = std::fs::remove_dir_all(home);
    std::fs::create_dir_all(home).map_err(setup_failed)?;
    let warm = tempfile::Builder::new()
        .prefix("warm-")
        .tempdir_in(home)
        .map_err(setup_failed)?;
    draw_in(tectonic, warm.path(), WARM_UP)?;
    std::fs::rename(warm.path().join(TEX_CACHE), &base).map_err(setup_failed)?;
    Ok(base)
}

fn render_in_sandbox(
    tectonic: &Path,
    typst: &Path,
    home: &Path,
    document: &str,
) -> Result<String, String> {
    if let oleafly_sandbox::Availability::Unavailable(_) = oleafly_sandbox::availability() {
        return Err(AppError::new("notes.tikz_unconfined").into());
    }
    let base = base_cache(tectonic, home)?;
    let build = tempfile::Builder::new()
        .prefix("oleafly-notes-tikz-")
        .tempdir()
        .map_err(setup_failed)?;
    oleafly_core::templates::copy_tree_with(&base, &build.path().join(TEX_CACHE), 0, false)
        .map_err(setup_failed)?;
    draw_in(tectonic, build.path(), document)?;
    pdf_svg(typst, build.path())
}

async fn render_document(app: &tauri::AppHandle, document: String) -> Result<String, String> {
    let home: PathBuf = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("failed to find a folder for LaTeX drawings: {error}"))?
        .join(TEX_HOME);
    tauri::async_runtime::spawn_blocking(move || {
        let tectonic = crate::document_engine::resolve_bundled_sidecar("tectonic")?;
        let typst = crate::document_engine::resolve_bundled_sidecar("typst")?;
        render_in_sandbox(&tectonic, &typst, &home, &document)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn notes_render_tikz(app: tauri::AppHandle, document: String) -> Result<String, String> {
    check_document(&document)?;
    let typst_version = oleafly_core::typst_toolchain::bundled_typst_version().to_string();
    let key = document_key(&typst_version, &document);
    if let Some(svg) = RENDERS.cached(&key) {
        return Ok(svg.as_ref().clone());
    }
    RENDERS
        .render(key, RENDERS.disk_dir(&app), || {
            render_document(&app, document)
        })
        .await
        .map(|svg| svg.as_ref().clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document_engine::CompileError;

    const TYPST: &str = "0.15.1";

    fn english(error: String) -> String {
        crate::app_error::english(&error).unwrap_or(error)
    }

    fn failed(errors: Vec<CompileError>) -> CompileResult {
        CompileResult {
            errors,
            ..Default::default()
        }
    }

    fn error(message: &str, line: Option<u32>, file: Option<&str>, kind: &str) -> CompileError {
        CompileError {
            message: message.into(),
            line,
            file: file.map(Into::into),
            kind: kind.into(),
            ..Default::default()
        }
    }

    fn typst_page(inner: &str, extra: &str) -> String {
        format!(
            "<svg viewBox=\"0 0 10.5 20\" width=\"10.5pt\" height=\"20pt\" xmlns=\"http://www.w3.org/2000/svg\"><image {extra}xlink:href=\"{EMBEDDED_SVG}{}\" width=\"10.5\" height=\"20\" preserveAspectRatio=\"none\"/></svg>",
            STANDARD.encode(inner)
        )
    }

    fn bundled(name: &str) -> Option<std::path::PathBuf> {
        let triple = crate::biber_toolchain::host_triple_guess()?;
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("{name}-{triple}{}", std::env::consts::EXE_SUFFIX));
        path.is_file().then_some(path)
    }

    #[test]
    fn rejects_empty_and_oversized_documents() {
        assert!(check_document(" \n")
            .unwrap_err()
            .contains("notes.tikz_empty"));
        assert!(check_document(&"x".repeat(MAX_DOCUMENT_BYTES + 1))
            .unwrap_err()
            .contains("notes.tikz_too_large"));
        assert!(check_document("\\documentclass{standalone}").is_ok());
    }

    #[test]
    fn keys_depend_on_the_document_and_the_converter() {
        assert_eq!(document_key(TYPST, "a"), document_key(TYPST, "a"));
        assert_ne!(document_key(TYPST, "a"), document_key(TYPST, "b"));
        assert_ne!(document_key(TYPST, "a"), document_key("0.16.0", "a"));
        assert_ne!(
            document_key(TYPST, "a"),
            crate::notes_typst::source_key(TYPST, "a")
        );
        assert_eq!(document_key(TYPST, "").len(), 64);
        let before_the_private_cache =
            crate::collab::disk::sha256_hex(format!("tikz 1 {TYPST}\0a").as_bytes());
        assert_ne!(document_key(TYPST, "a"), before_the_private_cache);
    }

    #[test]
    fn tex_errors_keep_the_line_only_when_it_is_in_the_drawing() {
        let located = tex_failure(&failed(vec![
            error("Overfull box", Some(2), Some("figure.tex"), "warning"),
            error(
                " Undefined control sequence. ",
                Some(7),
                Some("./figure.tex"),
                "error",
            ),
        ]));
        assert_eq!(
            located,
            String::from(
                AppError::new("notes.tikz_line")
                    .param("line", 7)
                    .param("message", "Undefined control sequence.")
            )
        );
        assert_eq!(english(located), "Line 7: Undefined control sequence.");
        assert_eq!(
            tex_failure(&failed(vec![error(
                "Package pgfkeys Error",
                Some(40),
                Some("/bundle/tikz.code.tex"),
                "error"
            )])),
            "Package pgfkeys Error"
        );
        assert!(english(tex_failure(&failed(vec![error(
            "x",
            Some(3),
            None,
            "error"
        )])))
        .starts_with("Line 3"));
        assert!(tex_failure(&failed(Vec::new())).contains("notes.tikz_failed"));
        assert!(tex_failure(&failed(vec![error(" ", None, None, "error")]))
            .contains("notes.tikz_failed"));
        let stopped = CompileResult {
            stopped: true,
            ..failed(vec![error("x", Some(1), None, "error")])
        };
        assert!(tex_failure(&stopped).contains("notes.tikz_timeout"));
    }

    #[test]
    fn every_error_has_english_text() {
        for code in [
            "notes.tikz_empty",
            "notes.tikz_too_large",
            "notes.tikz_failed",
            "notes.tikz_timeout",
            "notes.tikz_line",
            "notes.tikz_image_too_large",
            "notes.tikz_convert_failed",
            "notes.tikz_unconfined",
        ] {
            let text: String = AppError::new(code).into();
            assert!(crate::app_error::english(&text).is_some(), "{code}");
        }
    }

    #[test]
    fn the_converter_page_is_unwrapped_into_one_svg_sized_in_points() {
        let inner = "<svg viewBox=\"0 0 10.5 20\" width=\"10.5\" height=\"20\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0\"/></svg>";
        let svg = flattened(typst_page(inner, ""));
        assert_eq!(
            svg,
            "<svg viewBox=\"0 0 10.5 20\" xmlns=\"http://www.w3.org/2000/svg\" width=\"10.5pt\" height=\"20pt\"><path d=\"M0 0\"/></svg>"
        );
        let moved = typst_page(inner, "transform=\"translate(2 2)\" ");
        assert_eq!(flattened(moved.clone()), moved);
        let no_view_box = typst_page("<svg><path/></svg>", "");
        assert_eq!(flattened(no_view_box.clone()), no_view_box);
        let raster = "<svg width=\"1pt\" height=\"1pt\"><image xlink:href=\"data:image/png;base64,AA==\"/></svg>";
        assert_eq!(flattened(raster.into()), raster);
        assert_eq!(flattened("not svg".into()), "not svg");
    }

    #[test]
    fn conversions_return_an_svg_or_a_coded_error() {
        assert_eq!(
            converted(TypstSnippetRender::Rendered {
                image: TypstSnippetImage::Svg {
                    svg: "<svg/>".into()
                },
                diagnostics: Vec::new(),
            }),
            Ok("<svg/>".into())
        );
        assert!(converted(TypstSnippetRender::Rendered {
            image: TypstSnippetImage::Svg {
                svg: "x".repeat(MAX_SVG_BYTES + 1)
            },
            diagnostics: Vec::new(),
        })
        .unwrap_err()
        .contains("notes.tikz_image_too_large"));
        assert!(converted(TypstSnippetRender::Failed {
            diagnostics: Vec::new()
        })
        .unwrap_err()
        .contains("notes.tikz_convert_failed"));
    }

    #[test]
    fn the_bundled_typst_turns_a_pdf_page_into_vector_svg() {
        let Some(typst) = bundled("typst") else {
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("page.typ"),
            "#set page(width: 40pt, height: 20pt, margin: 0pt)\n#rect(width: 40pt, height: 20pt)",
        )
        .unwrap();
        let output = std::process::Command::new(&typst)
            .args(["compile", "page.typ", "figure.pdf"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        let svg = pdf_svg(&typst, dir.path()).unwrap();
        assert!(svg.starts_with("<svg"), "{svg}");
        assert!(!svg.contains(EMBEDDED_SVG));
        assert!(svg.contains("width=\"40pt\""), "{svg}");
        assert!(svg.contains("<path"));
    }

    #[test]
    fn latex_runs_confined_to_the_drawing_folder_with_its_own_cache() {
        let build = Path::new("/tmp/oleafly-notes-tikz-1");
        let tectonic = Path::new("/apps/Oleafly/tectonic");
        let spec = tex_sandbox(build, tectonic);
        assert_eq!(spec.owner, "notes:tikz:oleafly-notes-tikz-1");
        assert_ne!(
            spec.owner,
            tex_sandbox(Path::new("/tmp/oleafly-notes-tikz-2"), tectonic).owner
        );
        assert_eq!(spec.workspace, build);
        assert_eq!(spec.home, build.join(RUN_HOME));
        assert_eq!(spec.read_write, vec![build.to_path_buf()]);
        assert_eq!(
            spec.read_only,
            vec![tectonic.to_path_buf(), PathBuf::from("/apps/Oleafly")]
        );
        assert!(spec.project_read_only.is_empty());
        assert!(spec.network && !spec.child_processes && !spec.gpu);
        assert_eq!(
            spec.env.get(TEX_CACHE_VARIABLE).map(PathBuf::from),
            Some(build.join(TEX_CACHE))
        );
        let args: Vec<String> = tex_args(build)
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args.last().map(PathBuf::from), Some(build.join(ENTRY)));
        let defaults = format!("search-path={}", build.join(TEX_DEFAULTS_DIR).display());
        assert!(args.contains(&defaults), "{args:?}");
        assert!(!args
            .iter()
            .any(|arg| arg == "--only-cached" || arg == "-shell-escape"));
    }

    #[test]
    fn the_shared_cache_is_named_for_the_engine_bundle_and_warm_up() {
        let name = base_cache_name();
        assert_eq!(name, base_cache_name());
        assert!(name.starts_with("base-") && name.len() == 21, "{name}");
        assert_ne!(name, TEX_CACHE);
    }

    #[test]
    #[ignore = "needs the bundled Tectonic and Typst in src-tauri/binaries, and Tectonic's bundle on the network"]
    fn the_bundled_engines_draw_tikz_and_circuitikz_in_the_sandbox_and_report_tex_errors() {
        let (Some(tectonic), Some(typst)) = (bundled("tectonic"), bundled("typst")) else {
            panic!("the bundled Tectonic and Typst are missing");
        };
        let home = tempfile::tempdir().unwrap();
        let draw = |document: &str| render_in_sandbox(&tectonic, &typst, home.path(), document);
        for document in [
            "\\documentclass[border=4pt]{standalone}\n\\usepackage{tikz}\n\\begin{document}\n\\begin{tikzpicture}\\draw (0,0) circle (1) node {$\\int x$};\\end{tikzpicture}\n\\end{document}\n",
            "\\documentclass[border=4pt]{standalone}\n\\usepackage{circuitikz}\n\\begin{document}\n\\begin{circuitikz}\\draw (0,0) to[R, l=$R$] (2,0);\\end{circuitikz}\n\\end{document}\n",
        ] {
            let svg = draw(document).unwrap();
            assert!(svg.starts_with("<svg") && svg.contains("<path"), "{svg}");
        }
        assert!(home.path().join(base_cache_name()).join("formats").is_dir());
        let failure = english(
            draw("\\documentclass{standalone}\n\\usepackage{tikz}\n\\begin{document}\n\\begin{tikzpicture}\n\\drawx (0,0);\n\\end{tikzpicture}\n\\end{document}\n")
                .unwrap_err(),
        );
        assert!(failure.starts_with("Line 5: "), "{failure}");

        let outside = tempfile::tempdir().unwrap();
        let planted = outside.path().join("planted.txt");
        let secret = outside.path().join("secret.txt");
        std::fs::write(&secret, "secret").unwrap();
        let wrote = draw(&format!(
            "\\documentclass{{standalone}}\n\\begin{{document}}\n\\newwrite\\f\\immediate\\openout\\f={}\\immediate\\write\\f{{X}}\\immediate\\closeout\\f\nx\n\\end{{document}}\n",
            planted.display()
        ));
        assert!(!planted.exists(), "{wrote:?}");
        let read = draw(&format!(
            "\\documentclass{{standalone}}\n\\begin{{document}}\n\\input{{{}}}\n\\end{{document}}\n",
            secret.display()
        ));
        assert!(read.is_err(), "{read:?}");
    }

    fn files_named(folder: &Path, name: &str) -> Vec<PathBuf> {
        let mut found = Vec::new();
        for entry in std::fs::read_dir(folder).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                found.extend(files_named(&path, name));
            } else if path.file_name().is_some_and(|file| file == name) {
                found.push(path);
            }
        }
        found
    }

    #[test]
    #[ignore = "needs the bundled Tectonic and Typst in src-tauri/binaries, and Tectonic's bundle on the network"]
    fn a_drawing_that_writes_into_the_tex_cache_cannot_change_the_next_drawing() {
        let (Some(tectonic), Some(typst)) = (bundled("tectonic"), bundled("typst")) else {
            panic!("the bundled Tectonic and Typst are missing");
        };
        let home = tempfile::tempdir().unwrap();
        let draw = |document: &str| render_in_sandbox(&tectonic, &typst, home.path(), document);
        let plain = "\\documentclass[border=4pt]{standalone}\n\\usepackage{tikz}\n\\begin{document}\n\\begin{tikzpicture}\\draw (0,0) rectangle (1,1);\\end{tikzpicture}\n\\end{document}\n";
        draw(plain).unwrap();
        let base = home.path().join(base_cache_name());
        let shared = files_named(&base, "standalone.cls");
        assert_eq!(shared.len(), 1, "{shared:?}");
        let shared = shared[0].clone();
        let original = std::fs::read(&shared).unwrap();
        let copied = Path::new(TEX_CACHE).join(shared.strip_prefix(&base).unwrap());
        let planted = "\\NeedsTeXFormat{LaTeX2e}\\ProvidesClass{standalone}\\errmessage{PLANTED}";
        for target in [copied, shared.clone()] {
            let target = target.to_string_lossy().replace('\\', "/");
            let _ = draw(&format!(
                "\\documentclass{{article}}\n\\begin{{document}}\n\\newwrite\\f\\immediate\\openout\\f={target}\\immediate\\write\\f{{\\unexpanded{{{planted}}}}}\\immediate\\closeout\\f\nx\n\\end{{document}}\n"
            ));
        }
        assert!(
            std::fs::read(&shared).unwrap() == original,
            "{}",
            shared.display()
        );
        let next = draw(&plain.replace("(1,1)", "(2,1)"));
        assert!(next.is_ok(), "{next:?}");
    }
}
