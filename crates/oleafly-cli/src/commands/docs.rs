//! `oleafly stats`, `oleafly synctex`, `oleafly export` and `oleafly convert`:
//! the app's document tools on the command line. The counting, SyncTeX
//! search, export and conversion code is the app's own (`oleafly-doctools`).
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::time::Duration;

use clap::{Args, Subcommand, ValueEnum};
use oleafly_core::engine_spec::ENTRY_STEM;
use oleafly_core::typst_log::{parse_typst_diagnostics, TypstSeverity};
use oleafly_core::typst_toolchain::{
    typst_compile_args, TypstCapabilities, TypstCompileFlag, TypstDiagnosticFormat,
};
use oleafly_core::{Engine, Workspace};
use oleafly_doctools::conversion::{
    ad_hoc_plan, export_args, export_writer, fixup_typst_source, AdHocPlan, ExportSource,
};
use oleafly_doctools::export::{
    export_formats, export_would_write_inside_project, run_export_pandoc, ExportJob,
};
use oleafly_doctools::pandoc_citations::{self, BibliographySource};
use oleafly_doctools::stats::{
    collect_project_files, document_stats_with, DocumentStats, DocumentStatsRequest, FsReader,
    KnownFiles,
};
use oleafly_doctools::{synctex, DocError, ToolRunner};
use serde_json::{json, Map, Value};

use super::common::{display_path, install_hint};
use super::CommandModule;
use crate::contract::{path_arg, CliError, Context, ErrorKind, Outcome};
use crate::engine::{
    build_tools, open_project, typst_settings, typst_variant, OpenedProject, ProjectOrigin,
};
use crate::native::{
    output_locked_or, run_command, BuildTools, CliToolRunner, CompilerLog, Discovery, Launch,
};
use crate::typst_settings::TypstSettings;

/// Exports land here inside the build folder when `-o` is left out.
pub const EXPORT_DIR: &str = "exports";
const EXPORT_TIMEOUT: Duration = Duration::from_secs(300);
const DEFAULT_PPI: u32 = 144;
const STAGED_STEM: &str = "page";
/// Pandoc reads Typst's HTML without its wrapper divs and spans.
const HTML_READER: &str = "--from=html-native_divs-native_spans";
const MAX_TEXT_INPUT_BYTES: u64 = 20 * 1024 * 1024;
const MAX_BINARY_INPUT_BYTES: u64 = 128 * 1024 * 1024;
const MAX_MEDIA_FILES: usize = 4096;

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// Count the words, headings, figures and equations in the document
    Stats(StatsArgs),
    /// Map source lines to PDF positions and back (LaTeX projects)
    #[command(subcommand)]
    Synctex(SynctexCommand),
    /// Export the main document to Word, HTML, EPUB, slides and more
    Export(ExportArgs),
    /// Convert a file between LaTeX, Markdown, Typst, HTML and Word
    Convert(ConvertArgs),
}

#[derive(Debug, Args)]
pub struct StatsArgs {
    #[arg(
        long,
        value_name = "FILE",
        help = "Count this document instead of the project's main document"
    )]
    pub main: Option<String>,
    #[arg(long, help = "List each file's counts")]
    pub files: bool,
}

#[derive(Debug, Subcommand)]
pub enum SynctexCommand {
    /// Find where a source line appears in the PDF
    Forward(ForwardArgs),
    /// Find the source line at a point in the PDF
    Inverse(InverseArgs),
}

#[derive(Debug, Args)]
pub struct ForwardArgs {
    #[arg(
        long,
        value_name = "FILE",
        help = "The source file, relative to the project"
    )]
    pub file: String,
    #[arg(long, value_name = "N", value_parser = clap::value_parser!(u32).range(1..), help = "The line number (from 1)")]
    pub line: u32,
}

#[derive(Debug, Args)]
pub struct InverseArgs {
    #[arg(long, value_name = "N", value_parser = clap::value_parser!(u32).range(1..), help = "The page number (from 1)")]
    pub page: u32,
    #[arg(
        long,
        value_name = "POINTS",
        allow_negative_numbers = true,
        help = "Points from the page's left edge"
    )]
    pub x: f64,
    #[arg(
        long,
        value_name = "POINTS",
        allow_negative_numbers = true,
        help = "Points from the page's top edge"
    )]
    pub y: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum ExportFormat {
    #[value(alias = "word")]
    Docx,
    Html,
    #[value(alias = "markdown")]
    Md,
    #[value(alias = "text", alias = "plain")]
    Txt,
    #[value(alias = "powerpoint", alias = "slides")]
    Pptx,
    Epub,
    #[value(alias = "typ")]
    Typst,
    #[value(alias = "latex")]
    Tex,
    Pdf,
    Png,
    Svg,
}

impl ExportFormat {
    /// The app's export format id.
    fn id(self) -> &'static str {
        match self {
            Self::Docx => "docx",
            Self::Html => "html",
            Self::Md => "md",
            Self::Txt => "txt",
            Self::Pptx => "pptx",
            Self::Epub => "epub",
            Self::Typst => "typst",
            Self::Tex => "tex",
            Self::Pdf => "pdf",
            Self::Png => "png",
            Self::Svg => "svg",
        }
    }
}

#[derive(Debug, Args)]
pub struct ExportArgs {
    #[arg(
        long = "to",
        value_enum,
        value_name = "FORMAT",
        help = "docx, html, md, txt, pptx, epub, typst, tex, pdf, png or svg"
    )]
    pub format: ExportFormat,
    #[arg(short = 'o', long = "output", value_name = "PATH", value_parser = path_arg, help = "Write here: a file or a folder outside the project (default: the build folder's exports)")]
    pub output: Option<PathBuf>,
    #[arg(
        long,
        value_name = "FILE",
        help = "Export this file instead of the project's main document"
    )]
    pub main: Option<String>,
    #[arg(
        long,
        value_name = "NAME",
        help = "Typst projects: the variant from project.json"
    )]
    pub variant: Option<String>,
    #[arg(long, value_name = "PPI", value_parser = clap::value_parser!(u32).range(1..=1200), help = "Typst PNG export: pixels per inch (default 144)")]
    pub ppi: Option<u32>,
    #[arg(
        long,
        value_name = "PAGES",
        help = "Typst PDF, PNG or SVG export: the pages to include, such as 1-3,5"
    )]
    pub pages: Option<String>,
    #[arg(
        long = "pdf-standard",
        value_name = "STANDARD",
        help = "Typst PDF export: a PDF standard such as a-2b"
    )]
    pub pdf_standard: Option<String>,
}

/// A document format `oleafly convert` reads or writes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum DocumentKind {
    #[value(alias = "tex")]
    Latex,
    #[value(alias = "md")]
    Markdown,
    #[value(alias = "typ")]
    Typst,
    #[value(alias = "htm")]
    Html,
    #[value(alias = "word")]
    Docx,
}

impl DocumentKind {
    fn id(self) -> &'static str {
        match self {
            Self::Latex => "latex",
            Self::Markdown => "markdown",
            Self::Typst => "typst",
            Self::Html => "html",
            Self::Docx => "docx",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Latex => "LaTeX",
            Self::Markdown => "Markdown",
            Self::Typst => "Typst",
            Self::Html => "HTML",
            Self::Docx => "Word",
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Latex => "tex",
            Self::Markdown => "md",
            Self::Typst => "typ",
            Self::Html => "html",
            Self::Docx => "docx",
        }
    }

    fn of_path(path: &Path) -> Option<Self> {
        let extension = path.extension()?.to_str()?.to_ascii_lowercase();
        Some(match extension.as_str() {
            "tex" | "latex" => Self::Latex,
            "md" | "markdown" => Self::Markdown,
            "typ" => Self::Typst,
            "html" | "htm" => Self::Html,
            "docx" => Self::Docx,
            _ => return None,
        })
    }

    fn all() -> [Self; 5] {
        [
            Self::Latex,
            Self::Markdown,
            Self::Typst,
            Self::Html,
            Self::Docx,
        ]
    }
}

#[derive(Debug, Args)]
pub struct ConvertArgs {
    #[arg(value_name = "INPUT", value_parser = path_arg, help = "The file to convert")]
    pub input: PathBuf,
    #[arg(
        long = "to",
        value_enum,
        value_name = "FORMAT",
        help = "latex, markdown, typst, html or docx"
    )]
    pub to: DocumentKind,
    #[arg(
        long = "from",
        value_enum,
        value_name = "FORMAT",
        help = "The input's format (default: from its extension)"
    )]
    pub from: Option<DocumentKind>,
    #[arg(short = 'o', long = "output", value_name = "PATH", value_parser = path_arg, help = "Write here (default: beside the input, with the new extension)")]
    pub output: Option<PathBuf>,
    #[arg(
        long,
        help = "Replace the output and its extracted images when they exist"
    )]
    pub force: bool,
}

impl CommandModule for Commands {
    fn name(&self) -> &'static str {
        match self {
            Self::Stats(_) => "stats",
            Self::Synctex(SynctexCommand::Forward(_)) => "synctex forward",
            Self::Synctex(SynctexCommand::Inverse(_)) => "synctex inverse",
            Self::Export(_) => "export",
            Self::Convert(_) => "convert",
        }
    }

    async fn run(self, ctx: &Context) -> Result<Outcome, CliError> {
        match self {
            Self::Stats(args) => run_stats(ctx, args).await,
            Self::Synctex(SynctexCommand::Forward(args)) => run_forward(ctx, args).await,
            Self::Synctex(SynctexCommand::Inverse(args)) => run_inverse(ctx, args).await,
            Self::Export(args) => run_export(ctx, args).await,
            Self::Convert(args) => run_convert(ctx, args).await,
        }
    }
}

/// A shared document tool's error, with the app's code.
pub(crate) fn doc_error(error: DocError) -> CliError {
    let kind = match error.code {
        "export.inside_project" | "export.unsupported_format" | "synctex.not_compiled" => {
            ErrorKind::InvalidInput
        }
        "doc.failed" => ErrorKind::Io,
        _ => ErrorKind::Build,
    };
    let mut cli = CliError::new(kind, error.code, error.message);
    if !error.params.is_empty() {
        let params: Map<String, Value> = error
            .params
            .into_iter()
            .map(|(key, value)| (key.to_string(), json!(value)))
            .collect();
        cli = cli.details(Value::Object(params));
    }
    cli
}

fn join_error(error: tokio::task::JoinError) -> CliError {
    CliError::internal(format!("A background task failed: {error}"))
}

fn open(ctx: &Context, main: Option<&str>) -> Result<OpenedProject, CliError> {
    let opened = open_project(ctx.project(), main, None)?;
    for warning in &opened.warnings {
        ctx.warn(warning.code.clone(), warning.message.clone());
    }
    Ok(opened)
}

fn main_stem(main: &str) -> String {
    Path::new(main)
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "document".into())
}

/// `12345` as `12,345`.
fn grouped(value: u64) -> String {
    let digits = value.to_string();
    let mut out = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

// ---------------------------------------------------------------- stats

fn stats_json(stats: &DocumentStats) -> Value {
    json!({
        "words": stats.words,
        "words_in_text": stats.words_in_text,
        "words_in_headers": stats.words_in_headers,
        "words_outside_text": stats.words_outside_text,
        "headers": stats.headers,
        "figures": stats.figures,
        "math_inline": stats.math_inline,
        "math_displayed": stats.math_displayed,
        "characters": stats.characters,
        "lines": stats.lines,
    })
}

async fn run_stats(ctx: &Context, args: StatsArgs) -> Result<Outcome, CliError> {
    let opened = open(ctx, args.main.as_deref())?;
    let root = opened.workspace.root().to_path_buf();
    let main = opened.workspace.manifest().main_doc.clone();
    let request = DocumentStatsRequest {
        main_document: main.clone(),
        overrides: Default::default(),
    };
    let result = tokio::task::spawn_blocking(move || {
        let known = KnownFiles::from_paths(collect_project_files(&root));
        document_stats_with(&known, request, &FsReader { root: &root })
    })
    .await
    .map_err(join_error)?
    .map_err(doc_error)?;
    for path in &result.unreadable {
        ctx.warn(
            "stats.unreadable",
            format!("Oleafly couldn't read {path}, so it isn't counted."),
        );
    }
    if !ctx.json() {
        print_stats(ctx, &main, &result.stats, result.file_count);
        if args.files {
            ctx.say("");
            let width = result
                .files
                .iter()
                .map(|file| file.path.chars().count())
                .max()
                .unwrap_or(0);
            for file in &result.files {
                ctx.say(format!(
                    "  {:<width$}  {:>9} words",
                    file.path,
                    grouped(file.stats.words)
                ));
            }
        }
    }
    let files: Vec<Value> = result
        .files
        .iter()
        .map(|file| {
            let mut value = stats_json(&file.stats);
            value["path"] = json!(file.path);
            value
        })
        .collect();
    Ok(Outcome::success(json!({
        "stats": {
            "main_document": main,
            "file_count": result.file_count,
            "unreadable": result.unreadable,
            "totals": stats_json(&result.stats),
            "files": files,
        }
    })))
}

fn print_stats(ctx: &Context, main: &str, stats: &DocumentStats, file_count: usize) {
    if ctx.quiet() {
        ctx.say(stats.words.to_string());
        return;
    }
    let included = file_count.saturating_sub(1);
    ctx.say(match included {
        0 => main.to_string(),
        1 => format!("{main} and 1 included file"),
        count => format!("{main} and {count} included files"),
    });
    let rows = [
        ("Words", grouped(stats.words)),
        ("  in text", grouped(stats.words_in_text)),
        ("  in headings", grouped(stats.words_in_headers)),
        ("  elsewhere", grouped(stats.words_outside_text)),
        ("Headings", grouped(stats.headers)),
        ("Figures", grouped(stats.figures)),
        (
            "Equations",
            format!(
                "{} inline, {} displayed",
                grouped(stats.math_inline),
                grouped(stats.math_displayed)
            ),
        ),
        ("Characters", grouped(stats.characters)),
        ("Lines", grouped(stats.lines)),
    ];
    for (label, value) in rows {
        ctx.say(format!("  {label:<14} {value}"));
    }
}

// --------------------------------------------------------------- synctex

/// The parsed SyncTeX of the project's last LaTeX build, and the spellings
/// of its folder.
async fn synctex_doc(ctx: &Context) -> Result<(synctex::Doc, Vec<String>, Workspace), CliError> {
    let opened = open(ctx, None)?;
    let engine = opened.workspace.manifest().engine()?;
    if !matches!(engine, Engine::Tectonic | Engine::Latexmk) {
        return Err(CliError::new(
            ErrorKind::InvalidInput,
            "synctex.unsupported_engine",
            format!(
                "SyncTeX works with LaTeX projects; this one uses {}.",
                engine.canonical_name()
            ),
        ));
    }
    let workspace = opened.workspace;
    let build_dir = workspace.build_dir_path();
    let roots = synctex::project_roots(workspace.root());
    let doc = tokio::task::spawn_blocking(move || {
        synctex::read_synctex(&build_dir).map(|text| synctex::parse(&text))
    })
    .await
    .map_err(join_error)?
    .map_err(|error| {
        let not_compiled = error.code == "synctex.not_compiled";
        let cli = doc_error(error);
        if not_compiled {
            cli.hint("Run `oleafly build` first.")
        } else {
            cli
        }
    })?;
    Ok((doc, roots, workspace))
}

async fn run_forward(ctx: &Context, args: ForwardArgs) -> Result<Outcome, CliError> {
    let (doc, roots, workspace) = synctex_doc(ctx).await?;
    ctx.resolve_project_file(&workspace, &args.file)?;
    let line = i32::try_from(args.line).unwrap_or(i32::MAX);
    // SyncTeX names files with forward slashes.
    let file = crate::contract::project_path_arg(&args.file);
    let position = synctex::forward(&doc, &file, line, &roots).map(|(rect, _)| rect);
    if !ctx.json() {
        match &position {
            Some(rect) => ctx.say(format!(
                "Page {} at x {:.1} pt, y {:.1} pt ({:.1} × {:.1} pt)",
                rect.page, rect.x, rect.y, rect.width, rect.height
            )),
            None => ctx.note(format!(
                "The PDF has no position for {}:{}.",
                args.file, args.line
            )),
        }
    }
    Ok(Outcome::success(json!({
        "file": args.file,
        "line": args.line,
        "position": position,
    })))
}

async fn run_inverse(ctx: &Context, args: InverseArgs) -> Result<Outcome, CliError> {
    let (doc, roots, _) = synctex_doc(ctx).await?;
    let page = i32::try_from(args.page).unwrap_or(i32::MAX);
    let source = synctex::inverse(&doc, page, args.x, args.y, &roots);
    if !ctx.json() {
        match &source {
            Some(hit) => ctx.say(format!("{}:{}", hit.file, hit.line)),
            None => ctx.note(format!(
                "Nothing on page {} at that point comes from a source line.",
                args.page
            )),
        }
    }
    Ok(Outcome::success(json!({
        "page": args.page,
        "x": args.x,
        "y": args.y,
        "source": source,
    })))
}

// ---------------------------------------------------------------- export

fn missing_pandoc(tools: &BuildTools) -> CliError {
    let message = tools
        .pandoc_too_old_message()
        .unwrap_or_else(|| "Pandoc wasn't found. Exports and conversions need it.".to_string());
    let mut error = CliError::new(ErrorKind::MissingTool, "environment.missing_tool", message);
    if let Some(hint) = install_hint("pandoc") {
        error = error.hint(hint);
    }
    error
}

fn find_pandoc(discovery: &Discovery) -> Result<PathBuf, CliError> {
    let mut tools = BuildTools::discover_with(discovery);
    tools.resolve_pandoc(discovery);
    tools.pandoc.clone().ok_or_else(|| missing_pandoc(&tools))
}

fn canonical_parent(path: &Path) -> Option<PathBuf> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    parent.canonicalize().ok()
}

/// Where an export goes: `-o` (a file with the format's extension, or a
/// folder), else `<build folder>/exports/<main stem>.<extension>`. An
/// explicit path inside the project is refused, as in the app.
fn export_destination(
    workspace: &Workspace,
    requested: Option<&Path>,
    stem: &str,
    extension: &str,
) -> Result<PathBuf, CliError> {
    let name = format!("{stem}.{extension}");
    let Some(requested) = requested else {
        let folder = workspace.build_dir_path().join(EXPORT_DIR);
        std::fs::create_dir_all(&folder).map_err(CliError::from)?;
        return Ok(folder.join(name));
    };
    let destination = if requested.is_dir() {
        requested.join(name)
    } else {
        let matches = requested
            .extension()
            .and_then(OsStr::to_str)
            .is_some_and(|value| value.eq_ignore_ascii_case(extension));
        if !matches {
            return Err(CliError::usage(format!(
                "-o needs a folder or a .{extension} file, not {}.",
                requested.display()
            )));
        }
        if canonical_parent(requested).is_none() {
            let parent = requested.parent().unwrap_or_else(|| Path::new("."));
            return Err(CliError::usage(format!(
                "The folder {} doesn't exist.",
                parent.display()
            )));
        }
        requested.to_path_buf()
    };
    let in_build_folder = match (
        canonical_parent(&destination),
        workspace.build_dir_path().canonicalize(),
    ) {
        (Some(parent), Ok(build)) => parent.starts_with(build),
        _ => false,
    };
    if !in_build_folder
        && export_would_write_inside_project(workspace.root(), &destination.to_string_lossy())
    {
        return Err(CliError::new(
            ErrorKind::InvalidInput,
            "export.inside_project",
            "Choose an export destination outside this project.",
        )
        .hint("Pass a path outside the project, or leave out -o to write into the build folder."));
    }
    Ok(destination)
}

fn publish(source: &Path, destination: &Path) -> Result<(), CliError> {
    oleafly_core::atomic::copy_atomic(source, destination)
        .map(|_| ())
        .map_err(output_locked_or)
}

fn warn_ignored(ctx: &Context, engine: Engine, args: &ExportArgs) {
    let typst = engine == Engine::Typst;
    let native = typst
        && matches!(
            args.format,
            ExportFormat::Pdf | ExportFormat::Png | ExportFormat::Svg | ExportFormat::Html
        );
    let mut ignored = Vec::new();
    if args.variant.is_some() && !typst {
        ignored.push("--variant");
    }
    if args.ppi.is_some() && !(native && args.format == ExportFormat::Png) {
        ignored.push("--ppi");
    }
    if args.pages.is_some() && !(native && args.format != ExportFormat::Html) {
        ignored.push("--pages");
    }
    if args.pdf_standard.is_some() && !(native && args.format == ExportFormat::Pdf) {
        ignored.push("--pdf-standard");
    }
    for flag in ignored {
        ctx.warn(
            "export.flag_ignored",
            format!("{flag} is ignored for this export."),
        );
    }
}

async fn run_export(ctx: &Context, args: ExportArgs) -> Result<Outcome, CliError> {
    let opened = open(ctx, args.main.as_deref())?;
    let workspace = &opened.workspace;
    let engine = workspace.manifest().engine()?;
    let main = workspace.manifest().main_doc.clone();
    let stem = main_stem(&main);
    typst_variant(workspace, args.variant.as_deref())?;
    warn_ignored(ctx, engine, &args);
    ctx.event(
        "export_started",
        json!({"format": args.format.id(), "main_document": main}),
    )?;
    let files = match (engine, args.format) {
        (
            Engine::Typst,
            ExportFormat::Pdf | ExportFormat::Png | ExportFormat::Svg | ExportFormat::Html,
        ) => export_typst(&opened, &args, &stem).await?,
        (_, ExportFormat::Pdf) => copy_last_pdf(ctx, &opened, &args, &stem)?,
        (_, ExportFormat::Png | ExportFormat::Svg) => {
            return Err(CliError::new(
                ErrorKind::InvalidInput,
                "export.unsupported_format",
                format!(
                    "{} projects can't export to {}; PNG and SVG come from Typst.",
                    engine.canonical_name(),
                    args.format.id()
                ),
            ));
        }
        (_, format) => vec![export_with_pandoc(&opened, &args, format, &stem).await?],
    };
    if !ctx.json() {
        for file in &files {
            if ctx.quiet() {
                ctx.say(file.display().to_string());
            } else {
                ctx.say(format!("Exported {}", file.display()));
            }
        }
    }
    Ok(Outcome::success(json!({
        "export": {
            "format": args.format.id(),
            "main_document": main,
            "files": files,
        }
    })))
}

/// A LaTeX or Markdown project's PDF export is its last good build.
fn copy_last_pdf(
    ctx: &Context,
    opened: &OpenedProject,
    args: &ExportArgs,
    stem: &str,
) -> Result<Vec<PathBuf>, CliError> {
    let workspace = &opened.workspace;
    let build_dir = workspace.build_dir_path();
    let pdf = build_dir.join(format!("{ENTRY_STEM}.pdf"));
    // A link in the build folder (a project can ship one) would copy whatever
    // it points at under the name of a PDF.
    match std::fs::symlink_metadata(&pdf) {
        Ok(metadata) if metadata.is_file() => {}
        Ok(_) => {
            return Err(CliError::new(
                ErrorKind::UnsafePath,
                "project.unsafe_path",
                "The PDF in the build folder is a link, not a file a build wrote, so Oleafly won't copy it.",
            )
            .hint("Run `oleafly build` to make a new one."));
        }
        Err(_) => {
            return Err(CliError::new(ErrorKind::InvalidInput, "export.not_compiled", "This project has no PDF yet.")
                .hint("Run `oleafly build` first, or `oleafly build -o <file>` to build and copy in one step."));
        }
    }
    if let Some(record) = crate::record::read_record(&build_dir) {
        if record.main_document != workspace.manifest().main_doc {
            ctx.warn(
                "export.other_document",
                format!(
                    "The last build was of {}, so this PDF is that document.",
                    record.main_document
                ),
            );
        } else if !record.ok {
            ctx.warn(
                "export.last_build_failed",
                "The last build failed, so this is the last good PDF.",
            );
        }
    }
    let destination = export_destination(workspace, args.output.as_deref(), stem, "pdf")?;
    publish(&pdf, &destination)?;
    Ok(vec![destination])
}

/// The folder the export's citation filter is staged in, where pandoc can
/// reach it by a relative path: `.oleafly/` for a project folder, the
/// app's state folder for a linked one.
fn filter_staging_dir(opened: &OpenedProject) -> Option<PathBuf> {
    match opened.origin {
        ProjectOrigin::Linked { .. } => opened
            .workspace
            .build_dir_path()
            .parent()
            .map(|state| state.join(pandoc_citations::STAGING_DIR)),
        _ => Some(
            opened
                .workspace
                .root()
                .join(".oleafly")
                .join(pandoc_citations::STAGING_DIR),
        ),
    }
}

async fn export_with_pandoc(
    opened: &OpenedProject,
    args: &ExportArgs,
    format: ExportFormat,
    stem: &str,
) -> Result<PathBuf, CliError> {
    let workspace = &opened.workspace;
    let engine = workspace.manifest().engine()?;
    let id = format.id();
    if !export_formats(engine).contains(&id) {
        return Err(CliError::new(
            ErrorKind::InvalidInput,
            "export.unsupported_format",
            format!("{} projects can't export to {id}.", engine.canonical_name()),
        )
        .hint(format!(
            "Pick one of: {}.",
            export_formats(engine).join(", ")
        )));
    }
    let (_, extension) = export_writer(id)
        .ok_or_else(|| CliError::internal(format!("{id} has no Pandoc writer.")))?;
    let destination = export_destination(workspace, args.output.as_deref(), stem, extension)?;
    let root = workspace.root().to_path_buf();
    let discovery = Discovery::from_env(&root);
    let pandoc = find_pandoc(&discovery)?;
    let staging = tempfile::Builder::new()
        .prefix("oleafly-export-")
        .tempdir()
        .map_err(CliError::from)?;
    let staged = staging.path().join(format!("export.{extension}"));
    let staged_text = staged.to_string_lossy().into_owned();
    let main = workspace.manifest().main_doc.clone();

    // A Typst project goes through Typst's own HTML first, as in the app;
    // Pandoc's Typst reader is the fallback.
    let mut html_error = None;
    if engine == Engine::Typst && id != "typst" {
        match typst_through_html(opened, args, &pandoc, id, &staged_text, staging.path()).await {
            Ok(true) => {
                publish(&staged, &destination)?;
                return Ok(destination);
            }
            Ok(false) => {}
            Err(error) => html_error = Some(error),
        }
    }
    let build_dir = Some(workspace.build_dir_path()).filter(|build| build.is_dir());
    let job = ExportJob {
        root: &root,
        build_dir,
        main_doc: &main,
        format: id,
        output: &staged_text,
        staging_dir: filter_staging_dir(opened),
        temp_dir: Some(staging.path()),
    };
    if let Err(error) = run_export_pandoc(&CliToolRunner, &pandoc, job).await {
        return Err(html_error.unwrap_or_else(|| doc_error(error)));
    }
    publish(&staged, &destination)?;
    Ok(destination)
}

struct TypstRun {
    typst: PathBuf,
    capabilities: TypstCapabilities,
    root: PathBuf,
    main: String,
    settings: TypstSettings,
}

async fn typst_run(opened: &OpenedProject, variant: Option<&str>) -> Result<TypstRun, CliError> {
    let workspace = &opened.workspace;
    let discovery = Discovery::from_env(workspace.root());
    let tools = build_tools(workspace, &discovery, None);
    let Some(typst) = tools.typst.clone() else {
        let message = tools
            .typst_pin_error()
            .map_or_else(|| "Typst wasn't found.".to_string(), str::to_string);
        let mut error = CliError::new(ErrorKind::MissingTool, "environment.missing_tool", message);
        if tools.typst_pin_error().is_none() {
            if let Some(hint) = install_hint("typst") {
                error = error.hint(hint);
            }
        }
        return Err(error);
    };
    let settings =
        typst_settings(workspace, variant, false, discovery.data_root.as_deref()).await?;
    Ok(TypstRun {
        typst,
        capabilities: tools.typst_capabilities().clone(),
        root: workspace.root().to_path_buf(),
        main: workspace.manifest().main_doc.clone(),
        settings,
    })
}

/// The first error Typst reports, with its place and hints.
fn typst_failure_detail(log: &str) -> String {
    let diagnostics = parse_typst_diagnostics(log);
    let Some(error) = diagnostics
        .iter()
        .find(|diagnostic| diagnostic.severity == TypstSeverity::Error)
    else {
        return log
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .unwrap_or("Typst stopped without a message.")
            .to_string();
    };
    let mut detail = match error.user_span() {
        Some(span) => format!(
            "{}:{}:{}: {}",
            span.file,
            span.line,
            span.column + 1,
            error.message
        ),
        None => error.message.clone(),
    };
    for hint in &error.hints {
        detail.push_str("\nHint: ");
        detail.push_str(hint);
    }
    detail
}

async fn run_typst(
    run: &TypstRun,
    output: &Path,
    extra: &[TypstCompileFlag],
) -> Result<(), CliError> {
    let mut flags = run.settings.compile_flags(&run.capabilities);
    flags.extend_from_slice(extra);
    let arguments: Vec<OsString> = typst_compile_args(
        &run.capabilities,
        &run.root.join(&run.main),
        output,
        &run.root,
        TypstDiagnosticFormat::Human,
        &flags,
    )
    .map_err(|error| {
        CliError::new(
            ErrorKind::InvalidInput,
            "export.unsupported",
            error.to_string(),
        )
    })?;
    let environment = run.settings.environment();
    let launch = Launch {
        executable: &run.typst,
        arguments: &arguments,
        working_directory: &run.root,
        environment: &environment,
        unset: &[],
        variables: &[],
    };
    let (log, status) = run_command(&launch, EXPORT_TIMEOUT, &CompilerLog::default()).await?;
    if !status.success() {
        return Err(CliError::new(
            ErrorKind::Build,
            "export.failed",
            typst_failure_detail(&log),
        ));
    }
    Ok(())
}

fn supports_html(capabilities: &TypstCapabilities) -> bool {
    capabilities.supports_output_format("html") && capabilities.supports_flag("--features")
}

/// Typst's HTML, then Pandoc from HTML; `false` when this Typst can't write
/// HTML.
async fn typst_through_html(
    opened: &OpenedProject,
    args: &ExportArgs,
    pandoc: &Path,
    format: &str,
    output: &str,
    staging: &Path,
) -> Result<bool, CliError> {
    let run = typst_run(opened, args.variant.as_deref()).await?;
    if !supports_html(&run.capabilities) {
        return Ok(false);
    }
    let html = staging.join("document.html");
    run_typst(
        &run,
        &html,
        &[
            TypstCompileFlag::Features("html".into()),
            TypstCompileFlag::Format("html".into()),
        ],
    )
    .await?;
    let source = ExportSource {
        file_name: html.to_string_lossy().into_owned(),
        resource_path: oleafly_core::plain_path(&run.root)
            .to_string_lossy()
            .into_owned(),
    };
    let mut pandoc_args = export_args(format, &source, output, None)
        .ok_or_else(|| CliError::internal(format!("{format} has no Pandoc writer.")))?;
    pandoc_args.insert(0, HTML_READER.to_string());
    let (log, code) = CliToolRunner
        .run(pandoc, &pandoc_args, staging, &[])
        .await
        .map_err(|message| CliError::new(ErrorKind::Build, "export.failed", message))?;
    if code != Some(0) {
        return Err(doc_error(pandoc_citations::export_failure(&log, &run.root)));
    }
    Ok(true)
}

/// Pages Typst wrote as `page-<n>.<extension>`, in page order.
fn staged_pages(staging: &Path, extension: &str) -> Vec<PathBuf> {
    let mut pages: Vec<(u32, PathBuf)> = std::fs::read_dir(staging)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let number = name
                .strip_prefix(&format!("{STAGED_STEM}-"))?
                .strip_suffix(&format!(".{extension}"))?
                .parse::<u32>()
                .ok()?;
            Some((number, entry.path()))
        })
        .collect();
    pages.sort();
    pages.into_iter().map(|(_, path)| path).collect()
}

/// One destination per page: `paper.png` for a single page, else
/// `paper-01.png`, `paper-02.png`, ...
fn page_destinations(destination: &Path, produced: &[PathBuf]) -> Vec<PathBuf> {
    if produced.len() <= 1 {
        return vec![destination.to_path_buf()];
    }
    let stem = destination.file_stem().map_or_else(
        || "export".into(),
        |stem| stem.to_string_lossy().into_owned(),
    );
    let extension = destination
        .extension()
        .map(|extension| extension.to_string_lossy().into_owned());
    let folder = destination
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    produced
        .iter()
        .map(|page| {
            let number = page
                .file_stem()
                .and_then(std::ffi::OsStr::to_str)
                .and_then(|name| name.strip_prefix(&format!("{STAGED_STEM}-")))
                .unwrap_or("0");
            let name = match &extension {
                Some(extension) => format!("{stem}-{number}.{extension}"),
                None => format!("{stem}-{number}"),
            };
            folder.join(name)
        })
        .collect()
}

/// PDF, PNG, SVG or HTML straight from Typst.
async fn export_typst(
    opened: &OpenedProject,
    args: &ExportArgs,
    stem: &str,
) -> Result<Vec<PathBuf>, CliError> {
    let run = typst_run(opened, args.variant.as_deref()).await?;
    let mut flags = Vec::new();
    let (extension, paged) = match args.format {
        ExportFormat::Pdf => {
            if let Some(standard) = args
                .pdf_standard
                .as_deref()
                .map(str::trim)
                .filter(|standard| !standard.is_empty())
            {
                flags.push(TypstCompileFlag::PdfStandard(standard.to_string()));
            }
            ("pdf", false)
        }
        ExportFormat::Png => {
            flags.push(TypstCompileFlag::Format("png".into()));
            flags.push(TypstCompileFlag::Ppi(args.ppi.unwrap_or(DEFAULT_PPI)));
            ("png", true)
        }
        ExportFormat::Svg => {
            flags.push(TypstCompileFlag::Format("svg".into()));
            ("svg", true)
        }
        ExportFormat::Html => {
            if !supports_html(&run.capabilities) {
                return Err(CliError::new(
                    ErrorKind::InvalidInput,
                    "export.unsupported",
                    "This Typst version can't write HTML. Typst 0.13 or newer can.",
                ));
            }
            flags.push(TypstCompileFlag::Features("html".into()));
            flags.push(TypstCompileFlag::Format("html".into()));
            ("html", false)
        }
        _ => return Err(CliError::internal("not a Typst export format")),
    };
    if args.format != ExportFormat::Html {
        if let Some(pages) = args
            .pages
            .as_deref()
            .filter(|pages| !pages.trim().is_empty())
        {
            flags.push(TypstCompileFlag::Pages(pages.to_string()));
        }
    }
    let destination =
        export_destination(&opened.workspace, args.output.as_deref(), stem, extension)?;
    let staging = tempfile::Builder::new()
        .prefix("oleafly-export-")
        .tempdir()
        .map_err(CliError::from)?;
    let output = if paged {
        staging
            .path()
            .join(format!("{STAGED_STEM}-{{0p}}.{extension}"))
    } else {
        staging.path().join(format!("{STAGED_STEM}.{extension}"))
    };
    run_typst(&run, &output, &flags).await?;
    let produced = if paged {
        staged_pages(staging.path(), extension)
    } else {
        Some(output)
            .filter(|path| path.is_file())
            .into_iter()
            .collect()
    };
    if produced.is_empty() {
        return Err(CliError::new(
            ErrorKind::Build,
            "export.failed",
            "Typst finished without writing a file.",
        ));
    }
    let destinations = page_destinations(&destination, &produced);
    for (source, destination) in produced.iter().zip(&destinations) {
        publish(source, destination)?;
    }
    Ok(destinations)
}

// --------------------------------------------------------------- convert

fn conversion_targets(from: DocumentKind) -> Vec<&'static str> {
    DocumentKind::all()
        .into_iter()
        .filter(|to| ad_hoc_plan(from.id(), to.id()).is_some())
        .map(DocumentKind::id)
        .collect()
}

/// Every file under `assets/` the conversion extracted (images from Word
/// and HTML), relative to `root`.
fn extracted_media(root: &Path) -> Result<Vec<PathBuf>, CliError> {
    let assets = root.join("assets");
    if !assets.is_dir() {
        return Ok(Vec::new());
    }
    let mut pending = vec![assets];
    let mut files = Vec::new();
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(&directory).map_err(CliError::from)? {
            let entry = entry.map_err(CliError::from)?;
            let file_type = entry.file_type().map_err(CliError::from)?;
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                pending.push(entry.path());
            } else if file_type.is_file() {
                if files.len() >= MAX_MEDIA_FILES {
                    return Err(CliError::new(
                        ErrorKind::Build,
                        "convert.too_much_media",
                        "The conversion extracted too many images.",
                    ));
                }
                let relative = entry
                    .path()
                    .strip_prefix(root)
                    .map(Path::to_path_buf)
                    .map_err(|_| {
                        CliError::internal("An extracted image escaped the conversion folder.")
                    })?;
                files.push(relative);
            }
        }
    }
    files.sort();
    Ok(files)
}

fn same_file(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

async fn run_convert(ctx: &Context, args: ConvertArgs) -> Result<Outcome, CliError> {
    let from = match args.from {
        Some(from) => from,
        None => DocumentKind::of_path(&args.input).ok_or_else(|| {
            CliError::usage(format!(
                "Oleafly can't tell the format of {} from its name. Name it with --from.",
                args.input.display()
            ))
        })?,
    };
    let to = args.to;
    let mut plan = ad_hoc_plan(from.id(), to.id()).ok_or_else(|| unsupported_route(from, to))?;
    let input = read_convert_input(&args.input, from).await?;
    let destination = convert_destination(&args)?;
    // The output names the source's bibliographies by file name only, so no
    // path from this computer ends up in it.
    if plan.local_bibliography {
        if let Some(kind) = BibliographySource::for_reader(from.id()) {
            let declared =
                pandoc_citations::declared_bibliographies(kind, &String::from_utf8_lossy(&input));
            let names = pandoc_citations::unique_local_names(declared.iter().map(String::as_str));
            plan.add_bibliographies(&names);
        }
    }
    let cwd = std::env::current_dir().map_err(CliError::from)?;
    let pandoc = find_pandoc(&Discovery::from_env(&cwd))?;
    let workspace = tempfile::Builder::new()
        .prefix("oleafly-convert-")
        .tempdir()
        .map_err(CliError::from)?;
    let root = workspace.path().to_path_buf();
    let produced = convert_in_workspace(ctx, &plan, &input, from, to, &root, &pandoc).await?;
    let media = extracted_media(&root)?;
    let media_folder = destination
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    if !args.force {
        ensure_media_free(&media, media_folder)?;
    }
    let mut written = Vec::new();
    for relative in &media {
        let target = media_folder.join(relative);
        if let Some(parent) = target.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(CliError::from)?;
        }
        publish(&root.join(relative), &target)?;
        written.push(target);
    }
    publish(&produced, &destination)?;
    if !ctx.json() {
        say_converted(ctx, &args.input, &destination, written.len(), &cwd);
    }
    Ok(Outcome::success(json!({
        "convert": {
            "from": from.id(),
            "to": to.id(),
            "input": args.input,
            "output": destination,
            "media": written,
        }
    })))
}

/// The error for a pair of formats Oleafly has no route between, with the
/// formats the input does convert to.
fn unsupported_route(from: DocumentKind, to: DocumentKind) -> CliError {
    let targets = conversion_targets(from);
    let error = CliError::new(
        ErrorKind::InvalidInput,
        "convert.unsupported_route",
        format!("Oleafly can't convert {} to {}.", from.label(), to.label()),
    );
    if targets.is_empty() {
        error
    } else {
        error.hint(format!(
            "{} converts to: {}.",
            from.label(),
            targets.join(", ")
        ))
    }
}

/// The input's bytes, once it is a file within the size limit and, for a
/// Word file, looks like one.
async fn read_convert_input(path: &Path, from: DocumentKind) -> Result<Vec<u8>, CliError> {
    let metadata = match tokio::fs::metadata(path).await {
        Ok(metadata) if metadata.is_file() => metadata,
        Ok(_) => return Err(CliError::usage(format!("{} isn't a file.", path.display()))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(CliError::new(
                ErrorKind::InvalidInput,
                "convert.input_missing",
                format!("{} doesn't exist.", path.display()),
            ));
        }
        Err(error) => return Err(error.into()),
    };
    let limit = if from == DocumentKind::Docx {
        MAX_BINARY_INPUT_BYTES
    } else {
        MAX_TEXT_INPUT_BYTES
    };
    if metadata.len() > limit {
        return Err(CliError::new(
            ErrorKind::InvalidInput,
            "convert.too_large",
            format!(
                "{} is larger than the {} MB conversion limit.",
                path.display(),
                limit / (1024 * 1024)
            ),
        ));
    }
    let input = tokio::fs::read(path).await.map_err(CliError::from)?;
    if from == DocumentKind::Docx && !input.starts_with(b"PK") {
        return Err(CliError::new(
            ErrorKind::InvalidInput,
            "convert.invalid_input",
            format!("{} isn't a Word (.docx) file.", path.display()),
        ));
    }
    Ok(input)
}

/// Where the converted file goes: `-o`, or beside the input. It must not
/// replace the input, and an existing file needs `--force`.
fn convert_destination(args: &ConvertArgs) -> Result<PathBuf, CliError> {
    let default_name = format!(
        "{}.{}",
        args.input.file_stem().map_or_else(
            || "converted".into(),
            |stem| stem.to_string_lossy().into_owned()
        ),
        args.to.extension()
    );
    let destination = match &args.output {
        Some(output) if output.is_dir() => output.join(&default_name),
        Some(output) => output.clone(),
        None => args.input.with_file_name(&default_name),
    };
    if canonical_parent(&destination).is_none() {
        let parent = destination.parent().unwrap_or_else(|| Path::new("."));
        return Err(CliError::usage(format!(
            "The folder {} doesn't exist.",
            parent.display()
        )));
    }
    if same_file(&destination, &args.input) {
        return Err(CliError::usage(
            "The output would replace the input. Pick another name with -o.",
        ));
    }
    if destination.exists() && !args.force {
        return Err(CliError::new(
            ErrorKind::Conflict,
            "convert.output_exists",
            format!("{} already exists.", destination.display()),
        )
        .hint("Pass --force to replace it, or pick another name with -o."));
    }
    Ok(destination)
}

/// Stages the source in `root`, runs Pandoc there and returns the converted
/// file.
async fn convert_in_workspace(
    ctx: &Context,
    plan: &AdHocPlan,
    input: &[u8],
    from: DocumentKind,
    to: DocumentKind,
    root: &Path,
    pandoc: &Path,
) -> Result<PathBuf, CliError> {
    tokio::fs::write(root.join(plan.source_name), input)
        .await
        .map_err(CliError::from)?;
    if plan.references_filter {
        pandoc_citations::stage_filter(root)
            .map_err(|message| CliError::new(ErrorKind::Io, "io.failed", message))?;
    }
    if plan.ocr_filter {
        oleafly_doctools::conversion::stage_ocr_filter(root)
            .map_err(|message| CliError::new(ErrorKind::Io, "io.failed", message))?;
    }
    ctx.event("convert_started", json!({"from": from.id(), "to": to.id()}))?;
    let (log, code) = CliToolRunner
        .run(pandoc, &plan.args, root, &[])
        .await
        .map_err(|message| CliError::new(ErrorKind::Build, "convert.failed", message))?;
    if code != Some(0) {
        let detail = log.trim();
        let message = if detail.is_empty() {
            "Pandoc couldn't convert this document.".to_string()
        } else {
            format!("Pandoc couldn't convert this document: {detail}")
        };
        return Err(CliError::new(ErrorKind::Build, "convert.failed", message));
    }
    let produced = root.join(plan.output_name);
    if !produced.is_file() {
        return Err(CliError::new(
            ErrorKind::Build,
            "convert.failed",
            "Pandoc finished without writing the converted file.",
        ));
    }
    if to == DocumentKind::Typst {
        let text = tokio::fs::read_to_string(&produced)
            .await
            .map_err(CliError::from)?;
        tokio::fs::write(&produced, fixup_typst_source(&text))
            .await
            .map_err(CliError::from)?;
    }
    Ok(produced)
}

/// Stops when an extracted image would replace a file in `media_folder`.
fn ensure_media_free(media: &[PathBuf], media_folder: &Path) -> Result<(), CliError> {
    let existing = media
        .iter()
        .map(|relative| media_folder.join(relative))
        .find(|path| path.exists());
    match existing {
        Some(existing) => Err(CliError::new(
            ErrorKind::Conflict,
            "convert.output_exists",
            format!("{} already exists.", existing.display()),
        )
        .hint(
            "Pass --force to replace the extracted images, or convert into another folder with -o.",
        )),
        None => Ok(()),
    }
}

/// Tells a person what was converted and how many images came with it.
fn say_converted(ctx: &Context, input: &Path, destination: &Path, images: usize, cwd: &Path) {
    if ctx.quiet() {
        ctx.say(destination.display().to_string());
        return;
    }
    ctx.say(format!(
        "Converted {} to {}",
        input.display(),
        destination.display()
    ));
    if images > 0 {
        let media_folder = destination
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        ctx.note(format!(
            "Extracted {images} images into {}.",
            display_path(&media_folder.join("assets"), cwd)
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_are_grouped_by_thousands() {
        assert_eq!(grouped(0), "0");
        assert_eq!(grouped(999), "999");
        assert_eq!(grouped(1_000), "1,000");
        assert_eq!(grouped(12_345_678), "12,345,678");
    }

    #[test]
    fn convert_reads_formats_from_extensions() {
        assert_eq!(
            DocumentKind::of_path(Path::new("paper.TEX")),
            Some(DocumentKind::Latex)
        );
        assert_eq!(
            DocumentKind::of_path(Path::new("notes.markdown")),
            Some(DocumentKind::Markdown)
        );
        assert_eq!(
            DocumentKind::of_path(Path::new("report.docx")),
            Some(DocumentKind::Docx)
        );
        assert_eq!(DocumentKind::of_path(Path::new("data.csv")), None);
        assert!(conversion_targets(DocumentKind::Latex).contains(&"typst"));
        assert!(!conversion_targets(DocumentKind::Markdown).contains(&"docx"));
    }

    fn convert_args(input: PathBuf, output: Option<PathBuf>, force: bool) -> ConvertArgs {
        ConvertArgs {
            input,
            to: DocumentKind::Markdown,
            from: None,
            output,
            force,
        }
    }

    #[test]
    fn convert_writes_beside_the_input_and_never_over_it_or_an_existing_file() {
        let folder = tempfile::tempdir().unwrap();
        let input = folder.path().join("paper.tex");
        std::fs::write(&input, "x").unwrap();
        let beside = convert_destination(&convert_args(input.clone(), None, false)).unwrap();
        assert_eq!(beside, folder.path().join("paper.md"));
        std::fs::write(&beside, "old").unwrap();
        let exists = convert_destination(&convert_args(input.clone(), None, false)).unwrap_err();
        assert_eq!(exists.code, "convert.output_exists");
        let forced = convert_destination(&convert_args(input.clone(), None, true)).unwrap();
        assert_eq!(forced, beside);
        let same = convert_destination(&convert_args(input.clone(), Some(input.clone()), true))
            .unwrap_err();
        assert!(same.message.contains("would replace the input"));
        let nowhere = folder.path().join("nope").join("out.md");
        let missing =
            convert_destination(&convert_args(input.clone(), Some(nowhere), false)).unwrap_err();
        assert!(missing.message.contains("doesn't exist"));
        // A folder given to -o takes the default name inside it.
        let inside = convert_args(input, Some(folder.path().to_path_buf()), true);
        assert_eq!(convert_destination(&inside).unwrap(), beside);
    }

    #[tokio::test]
    async fn convert_input_must_be_a_file_of_the_right_kind_within_the_limit() {
        let folder = tempfile::tempdir().unwrap();
        let missing = read_convert_input(&folder.path().join("none.md"), DocumentKind::Markdown)
            .await
            .unwrap_err();
        assert_eq!(missing.code, "convert.input_missing");
        let not_a_file = read_convert_input(folder.path(), DocumentKind::Markdown)
            .await
            .unwrap_err();
        assert!(not_a_file.message.contains("isn't a file"));
        let big = folder.path().join("big.md");
        std::fs::File::create(&big)
            .unwrap()
            .set_len(MAX_TEXT_INPUT_BYTES + 1)
            .unwrap();
        let too_large = read_convert_input(&big, DocumentKind::Markdown)
            .await
            .unwrap_err();
        assert_eq!(too_large.code, "convert.too_large");
        let fake = folder.path().join("fake.docx");
        std::fs::write(&fake, "not a zip").unwrap();
        let invalid = read_convert_input(&fake, DocumentKind::Docx)
            .await
            .unwrap_err();
        assert_eq!(invalid.code, "convert.invalid_input");
        let real = folder.path().join("real.docx");
        std::fs::write(&real, b"PK\x03\x04").unwrap();
        let bytes = read_convert_input(&real, DocumentKind::Docx).await.unwrap();
        assert_eq!(bytes, b"PK\x03\x04");
    }

    #[test]
    fn extracted_images_do_not_replace_existing_files() {
        let folder = tempfile::tempdir().unwrap();
        let media = [PathBuf::from("assets/a.png")];
        assert!(ensure_media_free(&media, folder.path()).is_ok());
        std::fs::create_dir(folder.path().join("assets")).unwrap();
        std::fs::write(folder.path().join("assets/a.png"), "x").unwrap();
        let error = ensure_media_free(&media, folder.path()).unwrap_err();
        assert_eq!(error.code, "convert.output_exists");
    }

    #[test]
    fn an_unsupported_route_says_which_formats_it_joins() {
        let error = unsupported_route(DocumentKind::Docx, DocumentKind::Docx);
        assert_eq!(error.code, "convert.unsupported_route");
        assert!(error.message.contains("Word to Word"));
    }

    #[test]
    fn several_pages_get_numbered_names() {
        let produced = [
            PathBuf::from("/s/page-01.png"),
            PathBuf::from("/s/page-02.png"),
        ];
        let destinations = page_destinations(Path::new("/out/paper.png"), &produced);
        assert_eq!(
            destinations,
            [
                PathBuf::from("/out/paper-01.png"),
                PathBuf::from("/out/paper-02.png")
            ]
        );
        assert_eq!(
            page_destinations(Path::new("/out/paper.png"), &produced[..1]),
            [PathBuf::from("/out/paper.png")]
        );
    }

    #[test]
    fn exports_default_to_the_build_folder_and_refuse_the_project() {
        let project = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("main.tex"), "\\documentclass{article}").unwrap();
        let workspace = Workspace::detected(project.path(), None).unwrap();
        let default = export_destination(&workspace, None, "main", "docx").unwrap();
        assert!(default.starts_with(workspace.build_dir_path().join(EXPORT_DIR)));
        let inside = export_destination(
            &workspace,
            Some(&project.path().join("main.docx")),
            "main",
            "docx",
        )
        .unwrap_err();
        assert_eq!(inside.code, "export.inside_project");
        let elsewhere =
            export_destination(&workspace, Some(outside.path()), "main", "docx").unwrap();
        assert_eq!(elsewhere, outside.path().join("main.docx"));
        let wrong = export_destination(
            &workspace,
            Some(&outside.path().join("main.pdf")),
            "main",
            "docx",
        )
        .unwrap_err();
        assert_eq!(wrong.code, "usage.invalid");
    }

    #[test]
    fn doc_errors_keep_their_codes() {
        let error = doc_error(DocError::new(
            "export.inside_project",
            "Choose an export destination outside this project.",
        ));
        assert_eq!(
            (error.kind, error.code.as_ref()),
            (ErrorKind::InvalidInput, "export.inside_project")
        );
        let failed =
            doc_error(DocError::new("export.failed", "pandoc failed").param("detail", "x"));
        assert_eq!(failed.kind, ErrorKind::Build);
        assert!(failed.details.is_some());
    }
}
