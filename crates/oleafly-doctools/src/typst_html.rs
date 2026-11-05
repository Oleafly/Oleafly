use std::path::{Path, PathBuf};

use oleafly_core::typst_html::footnotes_for_pandoc;
use oleafly_core::typst_toolchain::{typst_compile_args, TypstCapabilities, TypstDiagnosticFormat};

use crate::ToolRunner;

pub const IMAGES_FILTER_NAME: &str = "typst-html-images.lua";
pub const SOURCE_IMAGES_FILTER_NAME: &str = "typst-source-images.lua";
const IMAGES_FILTER: &str = include_str!("../resources/pandoc/typst-html-images.lua");
const SOURCE_IMAGES_FILTER: &str = include_str!("../resources/pandoc/typst-source-images.lua");
const NEEDS_PDF: [&str; 3] = ["svg", "gif", "webp"];
const SVG_COMMAND: &str = "\\includesvg";
const GRAPHICS_COMMAND: &str = "\\includegraphics";
const SVG_PACKAGE: &str = "\\usepackage{svg}";

pub struct LatexMedia<'a> {
    pub typst: &'a Path,
    pub capabilities: &'a TypstCapabilities,
    pub staging: &'a Path,
    pub folder: &'a str,
    pub tex: &'a Path,
}

pub struct SourceMedia<'a> {
    pub staging: &'a Path,
    pub folder: &'a str,
}

pub fn prepare_html(html: &Path) -> Result<(), String> {
    let text = std::fs::read_to_string(html)
        .map_err(|error| format!("Could not read Typst's HTML: {error}"))?;
    let rewritten = footnotes_for_pandoc(&text);
    if rewritten != text {
        std::fs::write(html, rewritten)
            .map_err(|error| format!("Could not prepare Typst's HTML: {error}"))?;
    }
    Ok(())
}

pub fn media_folder_name(destination: &Path) -> String {
    let stem: String = destination
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect();
    format!("{stem}-media")
}

pub fn stage_images_filter(dir: &Path) -> Result<(), String> {
    std::fs::write(dir.join(IMAGES_FILTER_NAME), IMAGES_FILTER)
        .map_err(|error| format!("Could not prepare the image filter: {error}"))
}

pub fn stage_source_images_filter(dir: &Path) -> Result<(), String> {
    std::fs::write(dir.join(SOURCE_IMAGES_FILTER_NAME), SOURCE_IMAGES_FILTER)
        .map_err(|error| format!("Could not prepare the image filter: {error}"))
}

fn add_extraction_args(args: &mut Vec<String>, folder: &str, filter: &str) {
    args.splice(
        0..0,
        [
            format!("--extract-media={folder}"),
            format!("--lua-filter={filter}"),
        ],
    );
}

pub fn add_media_args(args: &mut Vec<String>, folder: &str) {
    add_extraction_args(args, folder, IMAGES_FILTER_NAME);
}

pub fn add_source_media_args(args: &mut Vec<String>, folder: &str) {
    add_extraction_args(args, folder, SOURCE_IMAGES_FILTER_NAME);
}

pub fn media_files(folder: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .map(|entry| entry.path())
        .collect();
    files.sort();
    files
}

fn needs_pdf(image: &Path) -> bool {
    image
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .is_some_and(|extension| NEEDS_PDF.contains(&extension.to_ascii_lowercase().as_str()))
}

fn image_entry_source(folder: &str, name: &str) -> String {
    format!("#set page(width: auto, height: auto, margin: 0pt)\n#image(\"/{folder}/{name}\")\n")
}

async fn joined<T>(task: tokio::task::JoinHandle<std::io::Result<T>>) -> std::io::Result<T> {
    task.await.map_err(std::io::Error::other)?
}

async fn image_to_pdf(
    runner: &dyn ToolRunner,
    job: &LatexMedia<'_>,
    image: &Path,
) -> Option<String> {
    let name = image.file_name()?.to_str()?;
    let stem = image.file_stem()?.to_str()?;
    let entry = job.staging.join(format!("{stem}.typ"));
    let entry_path = entry.clone();
    let entry_source = image_entry_source(job.folder, name);
    joined(tokio::task::spawn_blocking(move || {
        std::fs::write(entry_path, entry_source)
    }))
    .await
    .ok()?;
    let args: Vec<String> = typst_compile_args(
        job.capabilities,
        &entry,
        &image.with_extension("pdf"),
        job.staging,
        TypstDiagnosticFormat::Human,
        &[],
    )
    .ok()?
    .into_iter()
    .map(|argument| argument.to_string_lossy().into_owned())
    .collect();
    let (_, code) = runner.run(job.typst, &args, job.staging, &[]).await.ok()?;
    if code != Some(0) {
        return None;
    }
    let converted_image = image.to_path_buf();
    joined(tokio::task::spawn_blocking(move || {
        std::fs::remove_file(converted_image)
    }))
    .await
    .ok()?;
    Some(name.to_owned())
}

fn without_svg_package(mut text: String) -> String {
    let Some(start) = text.find(SVG_PACKAGE) else {
        return text;
    };
    let after = &text[start + SVG_PACKAGE.len()..];
    let rest = after.strip_prefix('\r').unwrap_or(after);
    let rest = rest.strip_prefix('\n').unwrap_or(rest);
    let end = text.len() - rest.len();
    text.replace_range(start..end, "");
    text
}

fn tex_with_pdf_images(tex: &str, folder: &str, converted: &[String]) -> String {
    let mut text = tex.to_owned();
    for name in converted {
        let original = format!("{folder}/{name}}}");
        let stem = name
            .rsplit_once('.')
            .map_or(name.as_str(), |(stem, _)| stem);
        let replacement = format!("{folder}/{stem}.pdf}}");
        while let Some(found) = text.find(&original) {
            if name.to_ascii_lowercase().ends_with(".svg") {
                if let Some(command) = text[..found].rfind(SVG_COMMAND) {
                    text.replace_range(command..command + SVG_COMMAND.len(), GRAPHICS_COMMAND);
                }
            }
            text = text.replacen(&original, &replacement, 1);
        }
    }
    if text.contains(SVG_COMMAND) {
        text
    } else {
        without_svg_package(text)
    }
}

pub async fn finish_latex_media(
    runner: &dyn ToolRunner,
    job: &LatexMedia<'_>,
) -> Result<(), String> {
    let mut converted = Vec::new();
    for image in media_files(&job.staging.join(job.folder)) {
        if needs_pdf(&image) {
            converted.extend(image_to_pdf(runner, job, &image).await);
        }
    }
    if converted.is_empty() {
        return Ok(());
    }
    let tex_path = job.tex.to_path_buf();
    let tex = joined(tokio::task::spawn_blocking(move || {
        std::fs::read_to_string(tex_path)
    }))
    .await
    .map_err(|error| format!("Could not read the exported LaTeX: {error}"))?;
    let tex_path = job.tex.to_path_buf();
    let updated = tex_with_pdf_images(&tex, job.folder, &converted);
    joined(tokio::task::spawn_blocking(move || {
        std::fs::write(tex_path, updated)
    }))
    .await
    .map_err(|error| format!("Could not update the exported LaTeX: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RunFuture;
    use oleafly_core::typst_toolchain::capabilities_for;
    use std::sync::Mutex;

    struct FakeTypst {
        fails_on: Option<&'static str>,
        entries: Mutex<Vec<String>>,
    }

    impl FakeTypst {
        fn new(fails_on: Option<&'static str>) -> Self {
            Self {
                fails_on,
                entries: Mutex::new(Vec::new()),
            }
        }
    }

    impl ToolRunner for FakeTypst {
        fn run<'a>(
            &'a self,
            _program: &'a Path,
            args: &'a [String],
            _working_dir: &'a Path,
            _variables: &'a [(String, String)],
        ) -> RunFuture<'a> {
            Box::pin(async move {
                let entry = std::fs::read_to_string(&args[2]).unwrap();
                self.entries.lock().unwrap().push(entry.clone());
                if self.fails_on.is_some_and(|name| entry.contains(name)) {
                    return Ok(("error: bad image".to_owned(), Some(1)));
                }
                std::fs::write(&args[3], "%PDF").unwrap();
                Ok((String::new(), Some(0)))
            })
        }
    }

    fn staged_media(names: &[&str]) -> (tempfile::TempDir, PathBuf) {
        let staging = tempfile::tempdir().unwrap();
        let folder = staging.path().join("paper-media");
        std::fs::create_dir(&folder).unwrap();
        for name in names {
            std::fs::write(folder.join(name), "image").unwrap();
        }
        let tex = staging.path().join("paper.tex");
        (staging, tex)
    }

    fn file_names(folder: &Path) -> Vec<String> {
        media_files(folder)
            .iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn folder_names_are_safe_for_latex_paths() {
        for (destination, folder) in [
            ("/out/paper.tex", "paper-media"),
            ("/out/50% draft #2.tex", "50__draft__2-media"),
            ("/out/논문_final-v2.tex", "논문_final-v2-media"),
            ("/out/a.b.tex", "a_b-media"),
        ] {
            assert_eq!(media_folder_name(Path::new(destination)), folder);
        }
    }

    #[test]
    fn media_arguments_come_before_the_input_separator() {
        let mut args = vec![
            "--to=latex".to_owned(),
            "--".to_owned(),
            "a.html".to_owned(),
        ];
        add_media_args(&mut args, "paper-media");
        assert_eq!(
            args,
            [
                "--extract-media=paper-media",
                "--lua-filter=typst-html-images.lua",
                "--to=latex",
                "--",
                "a.html"
            ]
        );
    }

    #[test]
    fn the_image_filter_reaches_the_working_folder() {
        let directory = tempfile::tempdir().unwrap();
        stage_images_filter(directory.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(directory.path().join(IMAGES_FILTER_NAME)).unwrap(),
            IMAGES_FILTER
        );
    }

    #[test]
    fn prepared_html_has_links_pandoc_keeps_as_footnotes() {
        let directory = tempfile::tempdir().unwrap();
        let html = directory.path().join("document.html");
        std::fs::write(
            &html,
            r##"<sup id="a" role="doc-noteref"><a href="#b">1</a></sup>"##,
        )
        .unwrap();
        prepare_html(&html).unwrap();
        assert_eq!(
            std::fs::read_to_string(&html).unwrap(),
            r##"<a id="a" role="doc-noteref" href="#b">1</a>"##
        );
    }

    #[test]
    fn vector_images_turn_into_pdfs_the_latex_can_read() {
        let (staging, tex) = staged_media(&["aa.svg", "bb.png", "cc.gif"]);
        std::fs::write(
            &tex,
            concat!(
                "\\usepackage{svg}\n\\begin{document}\n",
                "\\pandocbounded{\\includesvg[keepaspectratio,alt={a {b}}]{paper-media/aa.svg}}\n",
                "\\includegraphics{paper-media/bb.png}\n",
                "\\includegraphics{paper-media/cc.gif}\n",
                "\\pandocbounded{\\includesvg[keepaspectratio]{paper-media/aa.svg}}\n",
            ),
        )
        .unwrap();
        let typst = FakeTypst::new(None);
        let job = LatexMedia {
            typst: Path::new("typst"),
            capabilities: capabilities_for("0.15.1"),
            staging: staging.path(),
            folder: "paper-media",
            tex: &tex,
        };
        tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(finish_latex_media(&typst, &job))
            .unwrap();

        let entries = typst.entries.lock().unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries[0].contains("#image(\"/paper-media/aa.svg\")"));
        assert!(entries[0].starts_with("#set page(width: auto, height: auto, margin: 0pt)\n"));
        assert_eq!(
            file_names(&staging.path().join("paper-media")),
            ["aa.pdf", "bb.png", "cc.pdf"]
        );
        let text = std::fs::read_to_string(&tex).unwrap();
        assert_eq!(
            text,
            concat!(
                "\\begin{document}\n",
                "\\pandocbounded{\\includegraphics[keepaspectratio,alt={a {b}}]{paper-media/aa.pdf}}\n",
                "\\includegraphics{paper-media/bb.png}\n",
                "\\includegraphics{paper-media/cc.pdf}\n",
                "\\pandocbounded{\\includegraphics[keepaspectratio]{paper-media/aa.pdf}}\n",
            )
        );
    }

    #[test]
    fn windows_line_endings_still_lose_the_svg_package() {
        let converted = ["aa.svg".to_owned()];
        assert_eq!(
            tex_with_pdf_images(
                "\\usepackage{xcolor}\r\n\\usepackage{svg}\r\n\\begin{document}\r\n\\includesvg{paper-media/aa.svg}\r\n",
                "paper-media",
                &converted
            ),
            "\\usepackage{xcolor}\r\n\\begin{document}\r\n\\includegraphics{paper-media/aa.pdf}\r\n"
        );
        assert_eq!(
            tex_with_pdf_images(
                "\\usepackage{svg}\n\\includesvg{paper-media/aa.svg}\n",
                "paper-media",
                &converted
            ),
            "\\includegraphics{paper-media/aa.pdf}\n"
        );
        assert_eq!(
            tex_with_pdf_images(
                "\\usepackage{svg}\\includesvg{paper-media/aa.svg}",
                "paper-media",
                &converted
            ),
            "\\includegraphics{paper-media/aa.pdf}"
        );
    }

    #[test]
    fn source_exports_extract_media_with_their_own_filter() {
        let directory = tempfile::tempdir().unwrap();
        stage_source_images_filter(directory.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(directory.path().join(SOURCE_IMAGES_FILTER_NAME)).unwrap(),
            SOURCE_IMAGES_FILTER
        );
        let mut args = vec!["--".to_owned(), "main.typ".to_owned()];
        add_source_media_args(&mut args, "paper-media");
        assert_eq!(
            args,
            [
                "--extract-media=paper-media",
                "--lua-filter=typst-source-images.lua",
                "--",
                "main.typ"
            ]
        );
    }

    #[test]
    fn an_image_typst_refuses_stays_as_it_was() {
        let (staging, tex) = staged_media(&["aa.svg", "bb.svg"]);
        let original = concat!(
            "\\usepackage{svg}\n",
            "\\includesvg{paper-media/aa.svg}\n",
            "\\includesvg{paper-media/bb.svg}\n",
        );
        std::fs::write(&tex, original).unwrap();
        let typst = FakeTypst::new(Some("aa.svg"));
        let job = LatexMedia {
            typst: Path::new("typst"),
            capabilities: capabilities_for("0.15.1"),
            staging: staging.path(),
            folder: "paper-media",
            tex: &tex,
        };
        tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(finish_latex_media(&typst, &job))
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(&tex).unwrap(),
            concat!(
                "\\usepackage{svg}\n",
                "\\includesvg{paper-media/aa.svg}\n",
                "\\includegraphics{paper-media/bb.pdf}\n",
            )
        );
        assert_eq!(
            file_names(&staging.path().join("paper-media")),
            ["aa.svg", "bb.pdf"]
        );
    }

    #[test]
    fn a_document_without_images_needs_nothing() {
        let staging = tempfile::tempdir().unwrap();
        let tex = staging.path().join("missing.tex");
        let job = LatexMedia {
            typst: Path::new("typst"),
            capabilities: capabilities_for("0.15.1"),
            staging: staging.path(),
            folder: "paper-media",
            tex: &tex,
        };
        tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(finish_latex_media(&FakeTypst::new(None), &job))
            .unwrap();
        assert!(media_files(&staging.path().join("paper-media")).is_empty());
    }
}
