use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use crate::{Error, ErrorKind, TexFlavor};

#[cfg(test)]
mod tests;

pub const ENTRY_STEM: &str = "_oleafly_entry";
pub const ENTRY_TEX: &str = "_oleafly_entry.tex";
/// Oleafly's mirror of the Tectonic TeX package bundle. Upstream's relay
/// rate-limits (HTTP 429) and is a single point of failure for every first
/// compile; the mirror serves the same tar (same content digest), so
/// Tectonic's content-addressed cache is shared across origins.
pub const TEX_BUNDLE_MIRROR_URL: &str =
    "https://mirrors.oleafly.com/tex-bundles/tlextras-2022.0r0.tar";
pub const TEX_BUNDLE_URL_VARIABLE: &str = "OLEAFLY_TEX_BUNDLE_URL";
pub const TEX_BUNDLE_UPSTREAM_URL: &str = "https://relay.fullyjustified.net/default_bundle_v33.tar";
pub const TECTONIC_CACHE_DIR_ARGS: [&str; 3] = ["-X", "show", "user-cache-dir"];
const TECTONIC_PREFETCH_LIST: &str = include_str!("../resources/tectonic-prefetch.txt");
pub const BUNDLE_FALLBACK_NOTE: &str =
    "[Oleafly] The TeX package mirror was unreachable; retried with the upstream bundle.\n";
pub const TAGGING_SKIPPED_NOTICE: &str =
    "Tagging is off: tagged PDF needs LaTeX 2025-11-01 or newer.";
pub const MERMAID_FIGURES_FILTER_NAME: &str = "oleafly-mermaid-figures.lua";
pub const MERMAID_FIGURES_FILTER: &str = include_str!("../resources/pandoc/mermaid-figures.lua");
pub const IMAGE_COMPAT_FILTER_NAME: &str = "oleafly-image-compat.lua";
pub const IMAGE_COMPAT_FILTER: &str = include_str!("../resources/pandoc/image-compat.lua");
pub const MARKDOWN_BIBLIOGRAPHY_FILTER_NAME: &str = "oleafly-markdown-bibliography.lua";
pub const MARKDOWN_BIBLIOGRAPHY_FILTER: &str =
    include_str!("../resources/pandoc/markdown-bibliography.lua");
pub const DEFAULT_FONTS_FILTER_NAME: &str = "oleafly-default-fonts.lua";
pub const DEFAULT_FONTS_FILTER: &str = include_str!("../resources/pandoc/default-fonts.lua");
pub const MARKDOWN_FILTERS: [(&str, &str); 4] = [
    (MERMAID_FIGURES_FILTER_NAME, MERMAID_FIGURES_FILTER),
    (IMAGE_COMPAT_FILTER_NAME, IMAGE_COMPAT_FILTER),
    (
        MARKDOWN_BIBLIOGRAPHY_FILTER_NAME,
        MARKDOWN_BIBLIOGRAPHY_FILTER,
    ),
    (DEFAULT_FONTS_FILTER_NAME, DEFAULT_FONTS_FILTER),
];
pub const MARKDOWN_TYPST_VARIABLE: &str = "OLEAFLY_PANDOC_TYPST";
const FALLBACK_BIBLIOGRAPHY_METADATA: &str = "oleafly-fallback-bibliography";
pub const LATEXMK_BINARY_MARKER: &str = ".oleafly-latexmk";
pub const TEX_DEFAULTS_DIR: &str = "tex-defaults";
pub const T1_KEPT_NOTE: &str = "[Oleafly] T1 font encoding kept";
pub const T1_ENCODING_SHIM: &str = concat!(
    "\\def\\OleaflyEightBitEncoding{T1}\n",
    "\\AddToHook{package/fontenc/after}{\\edef\\OleaflyRequestedEncoding{\\encodingdefault}\\ifx\\OleaflyRequestedEncoding\\OleaflyEightBitEncoding\\def\\encodingdefault{TU}\\fontencoding{TU}\\selectfont\\fi}\n",
    "\\def\\OleaflyIfEncodingFamily#1#2{\\ifcsname #1+#2\\endcsname\\expandafter\\OleaflyFirst\\else\\expandafter\\OleaflyFileCheck\\fi{#1}{#2}}\n",
    "\\long\\def\\OleaflyFirst#1#2#3#4{#3}\n",
    "\\def\\OleaflyFileCheck#1#2{\\lowercase{\\IfFileExists{#1#2.fd}}}\n",
    "\\def\\OleaflyCheckFamily#1{\\OleaflyIfEncodingFamily{TU}{#1}{}{\\OleaflyIfEncodingFamily{T1}{#1}{\\let\\OleaflyRevert\\relax}{}}}\n",
    "\\AddToHook{begindocument/before}{\\ifx\\OleaflyRequestedEncoding\\OleaflyEightBitEncoding\\let\\OleaflyRevert\\undefined\\expandafter\\OleaflyCheckFamily\\expandafter{\\rmdefault}\\expandafter\\OleaflyCheckFamily\\expandafter{\\sfdefault}\\expandafter\\OleaflyCheckFamily\\expandafter{\\ttdefault}\\ifdefined\\OleaflyRevert\\let\\encodingdefault\\OleaflyRequestedEncoding\\fontencoding{\\encodingdefault}\\selectfont\\wlog{[Oleafly] T1 font encoding kept}\\fi\\fi}\n",
    "\\AddToHook{begindocument/end}{\\ifx\\OleaflyRequestedEncoding\\OleaflyEightBitEncoding\\ifdefined\\OleaflyRevert\\else\\DeclareRobustCommand\\fontfamily[1]{\\expandafter\\edef\\csname f@family\\endcsname{#1}\\OleaflyIfEncodingFamily{TU}{#1}{}{\\OleaflyIfEncodingFamily{T1}{#1}{\\fontencoding{T1}}{}}}\\fi\\fi}\n",
);
const CTEX_DEFAULTS_CFG: &str = "\\ProvidesExplFile{ctexopts.cfg}{2026/11/03}{0}{Oleafly built-in engine defaults}\n\\ctex_set:nn { option } { fontset = fandol }\n";

#[derive(Clone, Copy)]
enum FontSpacing {
    Proportional,
    Monospaced,
}

const TU_FONT_FAMILIES: [(&str, &str, FontSpacing); 16] = [
    ("ptm", "texgyretermes", FontSpacing::Proportional),
    ("qtm", "texgyretermes", FontSpacing::Proportional),
    ("phv", "texgyreheros", FontSpacing::Proportional),
    ("qhv", "texgyreheros", FontSpacing::Proportional),
    ("pcr", "texgyrecursor", FontSpacing::Monospaced),
    ("qcr", "texgyrecursor", FontSpacing::Monospaced),
    ("ppl", "texgyrepagella", FontSpacing::Proportional),
    ("pplx", "texgyrepagella", FontSpacing::Proportional),
    ("pplj", "texgyrepagella", FontSpacing::Proportional),
    ("qpl", "texgyrepagella", FontSpacing::Proportional),
    ("pbk", "texgyrebonum", FontSpacing::Proportional),
    ("qbk", "texgyrebonum", FontSpacing::Proportional),
    ("pnc", "texgyreschola", FontSpacing::Proportional),
    ("qcs", "texgyreschola", FontSpacing::Proportional),
    ("pag", "texgyreadventor", FontSpacing::Proportional),
    ("qag", "texgyreadventor", FontSpacing::Proportional),
];
pub const MIKTEX_SHELL_COMMANDS_VARIABLE: &str = "MIKTEX_MIKTEX_CORE_ALLOWEDSHELLCOMMANDS";
const MIKTEX_RESTRICTED_SHELL_COMMANDS: [&str; 16] = [
    "miktex-bibtex",
    "miktex-bibtex8",
    "miktex-epstopdf",
    "miktex-gregorio",
    "miktex-kpsewhich",
    "miktex-makeindex",
    "bibtex",
    "bibtex8",
    "extractbb",
    "gregorio",
    "kpsewhich",
    "l3sys-query",
    "makeindex",
    "memoize-extract.pl",
    "memoize-extract.py",
    "texosquery-jre8",
];
const MAX_MARKER_BYTES: u64 = 64 * 1024;
const BUNDLE_FETCH_LINES: [&str; 3] = ["failure fetching \"", "caused by: ", "open of input "];
const MAX_BUNDLE_EXCERPT_BYTES: usize = 4 * 1024;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EngineFlags {
    pub offline: bool,
    pub fast: bool,
    pub halt_on_error: bool,
}

pub fn tex_bundle_url() -> String {
    std::env::var(TEX_BUNDLE_URL_VARIABLE)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| TEX_BUNDLE_MIRROR_URL.into())
}

pub fn validate_latex_main_document(path: &str) -> crate::Result<()> {
    if path.is_empty()
        || path.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '{' | '}' | '\\' | '%' | '#' | '$' | '&' | '^' | '~'
                )
        })
    {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            format!(
                "Oleafly can't compile \"{path}\" because its name has characters LaTeX reads as commands. Rename the file."
            ),
        ));
    }
    Ok(())
}

/// The entry file's text: pdfTeX-only primitives become no-ops (so a
/// document written for pdfLaTeX still builds on XeTeX), then the main
/// document is read.
pub fn latex_entry_source(main_document: &str) -> crate::Result<String> {
    latex_entry_source_with(main_document, None, true)
}

pub fn latex_entry_source_with(
    main_document: &str,
    shipped_bibliography: Option<&str>,
    t1_shim: bool,
) -> crate::Result<String> {
    validate_latex_main_document(main_document)?;
    let t1_shim = if t1_shim { T1_ENCODING_SHIM } else { "" };
    let bibliography = shipped_bibliography
        .map(|bbl| {
            format!(
                "\\AddToHook{{begindocument/end}}{{\\renewcommand{{\\bibliography}}[1]{{\\renewcommand{{\\bibliography}}[1]{{}}\\input{{\\detokenize{{{bbl}}}}}}}}}\n"
            )
        })
        .unwrap_or_default();
    Ok(format!(
        "\\ifdefined\\pdfglyphtounicode\\else\\def\\pdfglyphtounicode#1#2{{}}\\fi\n\
         \\ifdefined\\pdfgentounicode\\else\\newcount\\pdfgentounicode\\fi\n\
         \\ifdefined\\pdfminorversion\\else\\newcount\\pdfminorversion\\fi\n\
         \\ifdefined\\pdfmajorversion\\else\\newcount\\pdfmajorversion\\fi\n\
         \\ifdefined\\pdfcompresslevel\\else\\newcount\\pdfcompresslevel\\fi\n\
         \\ifdefined\\pdfobjcompresslevel\\else\\newcount\\pdfobjcompresslevel\\fi\n\
         \\ifdefined\\pdfsuppressptexinfo\\else\\newcount\\pdfsuppressptexinfo\\fi\n\
         \\ifdefined\\pdfsuppresswarningpagegroup\\else\\newcount\\pdfsuppresswarningpagegroup\\fi\n\
         \\ifdefined\\pdfinclusioncopyfonts\\else\\newcount\\pdfinclusioncopyfonts\\fi\n\
         \\ifdefined\\pdfinclusionerrorlevel\\else\\newcount\\pdfinclusionerrorlevel\\fi\n\
         \\ifdefined\\pdfimageresolution\\else\\newcount\\pdfimageresolution\\fi\n\
         \\ifdefined\\pdfpkresolution\\else\\newcount\\pdfpkresolution\\fi\n\
         \\ifdefined\\pdfdecimaldigits\\else\\newcount\\pdfdecimaldigits\\fi\n\
         \\ifdefined\\pdfmapfile\\else\\def\\pdfmapfile#1{{}}\\fi\n\
         \\ifdefined\\pdfmapline\\else\\def\\pdfmapline#1{{}}\\fi\n\
         \\ifdefined\\pdftrailerid\\else\\def\\pdftrailerid#1{{}}\\fi\n\
         \\ifdefined\\pdfinfo\\else\\def\\pdfinfo#1{{}}\\fi\n\
         \\ifdefined\\DocumentMetadata\\else\\def\\DocumentMetadata#1{{\\typeout{{{TAGGING_SKIPPED_NOTICE}}}}}\\fi\n\
         \\ifdefined\\pdfoutput\\AddToHook{{package/iftex/before}}{{\\global\\pdfoutput=0 }}\\fi\n\
         {t1_shim}\
         {bibliography}\
         \\input{{\\detokenize{{{main_document}}}}}\n"
    ))
}

pub fn tex_default_files() -> Vec<(String, String)> {
    let mut files = vec![("ctexopts.cfg".to_owned(), CTEX_DEFAULTS_CFG.to_owned())];
    for (family, font, spacing) in TU_FONT_FAMILIES {
        files.push((
            format!("tu{family}.fd"),
            tu_font_definition(family, font, spacing),
        ));
    }
    files
}

fn tu_font_definition(family: &str, font: &str, spacing: FontSpacing) -> String {
    let (family_setup, ligatures, separator) = match spacing {
        FontSpacing::Proportional => ("", "\\UnicodeFontTeXLigatures", ";"),
        FontSpacing::Monospaced => ("\\hyphenchar\\font=-1", "", ""),
    };
    let mut text = format!(
        "\\ProvidesFile{{tu{family}.fd}}\n\\DeclareFontFamily{{TU}}{{{family}}}{{{family_setup}}}\n"
    );
    for (series, upright, italic) in [("m", "regular", "italic"), ("b", "bold", "bolditalic")] {
        for (shape, face, feature) in [
            ("n", upright, ""),
            ("it", italic, ""),
            ("sl", upright, "slant=0.167"),
            ("sc", upright, "+smcp"),
        ] {
            let joiner = if feature.is_empty() { "" } else { separator };
            text.push_str(&format!(
                "\\DeclareFontShape{{TU}}{{{family}}}{{{series}}}{{{shape}}}{{<->\\UnicodeFontFile{{{font}-{face}}}{{{ligatures}{joiner}{feature}}}}}{{}}\n"
            ));
        }
    }
    for shape in ["n", "it", "sl", "sc"] {
        text.push_str(&format!(
            "\\DeclareFontShape{{TU}}{{{family}}}{{bx}}{{{shape}}}{{<->ssub * {family}/b/{shape}}}{{}}\n"
        ));
    }
    text
}

pub fn write_tex_defaults(dir: &Path) -> crate::Result<()> {
    std::fs::create_dir_all(dir).map_err(|error| defaults_write_error(dir, &error))?;
    for (name, contents) in tex_default_files() {
        let path = dir.join(name);
        if std::fs::read(&path).is_ok_and(|current| current == contents.as_bytes()) {
            continue;
        }
        crate::atomic::write_atomic(&path, contents.as_bytes())
            .map_err(|error| defaults_write_error(&path, &error))?;
    }
    Ok(())
}

fn defaults_write_error(path: &Path, error: &std::io::Error) -> Error {
    Error::new(
        ErrorKind::Io,
        format!("failed to write {}: {error}", path.display()),
    )
}

/// Tectonic's arguments. Every search path gets its own `-Z search-path=`,
/// in order (the compile directory before the project root).
pub fn tectonic_args(
    out_dir: &Path,
    search_paths: &[&Path],
    entry: &Path,
    bundle_url: Option<&str>,
    flags: EngineFlags,
) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec!["-X".into(), "compile".into()];
    // Pinned in offline mode too: a cache populated from either origin
    // satisfies --only-cached, and the upstream fallback covers a cache
    // whose URL mapping predates the mirror.
    if let Some(url) = bundle_url {
        args.extend(["--bundle".into(), url.into()]);
    }
    if flags.offline {
        args.push("--only-cached".into());
    }
    args.extend([
        "--synctex".into(),
        "--keep-logs".into(),
        "--keep-intermediates".into(),
        "--print".into(),
        "--outdir".into(),
        out_dir.as_os_str().to_owned(),
    ]);
    if flags.fast {
        args.extend(["--reruns".into(), "0".into()]);
    }
    if !flags.halt_on_error {
        args.extend(["-Z".into(), "continue-on-errors".into()]);
    }
    for path in search_paths {
        let mut value = OsString::from("search-path=");
        value.push(path.as_os_str());
        args.extend(["-Z".into(), value]);
    }
    args.push(entry.as_os_str().to_owned());
    args
}

/// latexmk's shell-escape flag: restricted unless trusted, and MiKTeX's
/// spelling for "none" (it has no restricted mode).
pub fn shell_escape_arg(allow: bool, distribution_kind: &str) -> &'static str {
    match (allow, distribution_kind) {
        (true, _) => "-shell-escape",
        (false, "miktex") => "-no-shell-escape",
        (false, _) => "-shell-restricted",
    }
}

pub fn restricted_miktex_shell_commands() -> String {
    MIKTEX_RESTRICTED_SHELL_COMMANDS.join(if cfg!(windows) { ";" } else { ":" })
}

pub fn latexmk_args(
    out_dir_arg: &str,
    entry_arg: &str,
    stem: &str,
    flavor: TexFlavor,
    flags: EngineFlags,
    allow_shell_escape: bool,
    distribution_kind: &str,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-norc".into(),
        shell_escape_arg(allow_shell_escape, distribution_kind).into(),
    ];
    args.extend(flavor.latexmk_args());
    for rule in crate::tex_outputs::LATEXMK_INDEX_RULES {
        args.extend(["-e".into(), rule.into()]);
    }
    args.extend([
        "-interaction=nonstopmode".into(),
        "-synctex=1".into(),
        format!("-outdir={out_dir_arg}"),
        format!("-jobname={stem}"),
    ]);
    if flags.halt_on_error {
        args.push("-halt-on-error".into());
    } else {
        args.push("-f".into());
    }
    if flavor == TexFlavor::Lualatex && !allow_shell_escape {
        args.push("-latexoption=--nosocket".into());
    }
    // `flags.fast` is intentionally ignored: deciding how many passes to
    // run is latexmk's whole job.
    args.push(entry_arg.into());
    args
}

pub fn validate_latexmk_path_characters(path: &str) -> crate::Result<()> {
    let safe = path.chars().all(|character| {
        if !character.is_ascii() {
            return !character.is_control();
        }
        character.is_ascii_alphanumeric()
            || matches!(
                character,
                '/' | '.' | '-' | '_' | ' ' | '(' | ')' | '[' | ']' | ',' | '+' | '=' | '@' | '\''
            )
    });
    if safe {
        Ok(())
    } else {
        Err(Error::new(
            ErrorKind::InvalidInput,
            format!(
                "latexmk can't compile \"{path}\" because its name has characters latexmk doesn't accept. Rename the file or folder, or switch this project to Tectonic."
            ),
        ))
    }
}

pub fn latexmk_relative_path_arg(path: &Path) -> crate::Result<String> {
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(Error::new(
            ErrorKind::UnsafePath,
            "latexmk paths must stay project-relative",
        ));
    }
    let value = path.to_string_lossy().replace('\\', "/");
    validate_latexmk_path_characters(&value)?;
    Ok(format!("./{value}"))
}

fn without_verbatim_prefix(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

/// An absolute path latexmk can take without handing a shell anything it
/// would interpret; `None` when there is no such spelling.
pub fn latexmk_absolute_path_text(path: &Path, windows: bool) -> Option<String> {
    path.to_str()?;
    let plain = without_verbatim_prefix(path);
    let text = plain.to_str()?;
    let text = if windows {
        text.replace('\\', "/")
    } else {
        text.to_owned()
    };
    let rooted = if windows {
        let bytes = text.as_bytes();
        bytes.len() > 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/'
    } else {
        text.starts_with('/')
    };
    let shell_safe = !text.chars().any(|character| {
        character.is_control()
            || matches!(character, '"' | '`' | '$' | '\\')
            || (windows && matches!(character, '%' | '!'))
    });
    (rooted && shell_safe && !text.split('/').any(|part| part == "..")).then_some(text)
}

/// latexmk's dependency database is not portable across TeX distributions:
/// after a switch it can report "Nothing to do" while replaying the old
/// error, so a changed latexmk binary means one full rebuild (`-gg`).
pub fn latexmk_binary_changed(out_dir: &Path, latexmk: &Path) -> bool {
    let marker = out_dir.join(LATEXMK_BINARY_MARKER);
    let resolved = std::fs::canonicalize(latexmk).unwrap_or_else(|_| latexmk.to_owned());
    let current = resolved.to_string_lossy();
    let previous = std::fs::symlink_metadata(&marker)
        .ok()
        .filter(|metadata| {
            metadata.is_file()
                && !metadata.file_type().is_symlink()
                && metadata.len() <= MAX_MARKER_BYTES
        })
        .and_then(|_| std::fs::read_to_string(&marker).ok())
        .unwrap_or_default();
    previous.trim() != current
}

pub fn record_latexmk_binary(out_dir: &Path, latexmk: &Path) {
    let resolved = std::fs::canonicalize(latexmk).unwrap_or_else(|_| latexmk.to_owned());
    if std::fs::create_dir_all(out_dir).is_ok() {
        let marker = out_dir.join(LATEXMK_BINARY_MARKER);
        if std::fs::symlink_metadata(&marker)
            .is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            let _ = std::fs::remove_file(&marker);
        }
        let _ = crate::atomic::write_atomic(&marker, resolved.to_string_lossy().as_bytes());
    }
}

pub fn forget_latexmk_run(log: &Path) {
    let _ = std::fs::remove_file(log.with_extension("fdb_latexmk"));
}

pub fn dvi_toolchain_missing(flavor: TexFlavor, latexmk: &Path) -> Option<&'static str> {
    if !flavor.goes_through_dvi() {
        return None;
    }
    let resolved = latexmk
        .canonicalize()
        .unwrap_or_else(|_| latexmk.to_path_buf());
    let available = |tool: &str| {
        [latexmk.parent(), resolved.parent()]
            .into_iter()
            .flatten()
            .any(|dir| crate::tex_distro::find_tool_in_dir(dir, tool).is_some())
    };
    let label = match flavor {
        TexFlavor::Platex => "pLaTeX",
        _ => "upLaTeX",
    };
    (!(available(flavor.as_str()) && available("dvipdfmx"))).then_some(label)
}

pub fn latex_compiler_missing(flavor: TexFlavor, path_env: &OsStr) -> Option<&'static str> {
    if flavor.goes_through_dvi() {
        return None;
    }
    (!crate::tex_distro::tool_on_path(path_env, flavor.as_str())).then_some(flavor.label())
}

pub fn dvi_toolchain_packages(flavor: TexFlavor) -> &'static [&'static str] {
    match flavor {
        TexFlavor::Uplatex => &["collection-langjapanese", "upmendex"],
        _ => &["collection-langjapanese"],
    }
}

pub fn write_markdown_filters(directory: &Path) -> crate::Result<()> {
    for (name, filter) in MARKDOWN_FILTERS {
        crate::atomic::write_atomic(&directory.join(name), filter.as_bytes())?;
    }
    Ok(())
}

pub struct MarkdownPdfArgs<'a> {
    pub resource_argument: &'a OsStr,
    pub tectonic: &'a Path,
    pub project: &'a Path,
    pub search_folders: &'a [PathBuf],
    pub output: &'a Path,
    pub main: &'a Path,
    pub bibliographies: &'a [PathBuf],
    pub bundle_url: Option<&'a str>,
}

fn joined(prefix: &str, value: &OsStr) -> OsString {
    let mut text = OsString::from(prefix);
    text.push(value);
    text
}

pub fn markdown_pdf_args(spec: &MarkdownPdfArgs<'_>) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec![
        spec.resource_argument.to_owned(),
        "--from=markdown".into(),
        "--standalone".into(),
        joined("--pdf-engine=", spec.tectonic.as_os_str()),
    ];
    if let Some(url) = spec.bundle_url {
        args.push("--pdf-engine-opt=--bundle".into());
        args.push(joined("--pdf-engine-opt=", OsStr::new(url)));
    }
    for folder in spec.search_folders {
        args.push(joined(
            "--pdf-engine-opt=-Zsearch-path=",
            folder.as_os_str(),
        ));
    }
    args.push(joined("--output=", spec.output.as_os_str()));
    args.push("--sandbox".into());
    args.push(format!("--lua-filter={MERMAID_FIGURES_FILTER_NAME}").into());
    args.push(format!("--lua-filter={IMAGE_COMPAT_FILTER_NAME}").into());
    args.push(format!("--lua-filter={MARKDOWN_BIBLIOGRAPHY_FILTER_NAME}").into());
    for bibliography in spec.bibliographies {
        let mut path = spec.project.to_path_buf();
        path.extend(bibliography.components());
        args.push(joined(
            &format!("--metadata={FALLBACK_BIBLIOGRAPHY_METADATA}="),
            path.as_os_str(),
        ));
    }
    args.push("--citeproc".into());
    args.push(format!("--lua-filter={DEFAULT_FONTS_FILTER_NAME}").into());
    args.push("--".into());
    args.push(spec.main.as_os_str().to_owned());
    args
}

pub fn is_bundle_fetch_failure(log: &str) -> bool {
    [
        "couldn't get it from the internet",
        "this bundle isn't cached",
        "unexpected HTTP response code",
        "failed to download",
        "error connecting to",
    ]
    .iter()
    .any(|marker| log.contains(marker))
}

pub fn is_cached_bundle_fetch_failure(output: &str) -> bool {
    output.contains("failure fetching \"")
        && output.contains("please check your network connection")
}

pub fn bundle_retry_needed(success: bool, output: &str) -> bool {
    (!success && is_bundle_fetch_failure(output)) || is_cached_bundle_fetch_failure(output)
}

pub fn bundle_retry_replaces_first_run(first_succeeded: bool, retry_succeeded: bool) -> bool {
    retry_succeeded || !first_succeeded
}

pub fn bundle_fetch_excerpt(output: &str) -> Option<String> {
    if !is_cached_bundle_fetch_failure(output) {
        return None;
    }
    let mut excerpt = String::new();
    for line in output.lines().filter(|line| {
        BUNDLE_FETCH_LINES
            .iter()
            .any(|marker| line.contains(marker))
    }) {
        if excerpt.len() + line.len() >= MAX_BUNDLE_EXCERPT_BYTES {
            break;
        }
        excerpt.push_str(line);
        excerpt.push('\n');
    }
    Some(excerpt)
}

pub fn tectonic_bundle_cache_dir(show_output: &str) -> Option<PathBuf> {
    show_output
        .lines()
        .map(str::trim)
        .rfind(|line| Path::new(line).is_absolute())
        .map(PathBuf::from)
}

fn tectonic_prefetch_file(url: &str) -> String {
    format!("{}.prefetch", url.replace(':', ",58,").replace('/', ",47,"))
}

pub fn write_tectonic_prefetch(bundles_dir: &Path, bundle_urls: &[&str]) {
    use std::io::Write;
    let data = bundles_dir.join("data");
    if std::fs::create_dir_all(&data).is_err() {
        return;
    }
    let list: String = TECTONIC_PREFETCH_LIST
        .lines()
        .flat_map(|name| [name, "\n"])
        .collect();
    for url in bundle_urls {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(data.join(tectonic_prefetch_file(url)));
        if let Ok(mut file) = file {
            let _ = file.write_all(list.as_bytes());
        }
    }
}

pub fn seed_tectonic_prefetch(show_output: &str) {
    if let Some(bundles_dir) = tectonic_bundle_cache_dir(show_output) {
        write_tectonic_prefetch(&bundles_dir, &[&tex_bundle_url(), TEX_BUNDLE_UPSTREAM_URL]);
    }
}

pub fn args_without_bundle<T: AsRef<OsStr> + Clone>(args: &[T]) -> Vec<T> {
    let mut out = Vec::with_capacity(args.len());
    let mut skip_next = false;
    for arg in args {
        if skip_next {
            skip_next = false;
            continue;
        }
        let text = arg.as_ref();
        if text == "--bundle" || text == "--pdf-engine-opt=--bundle" {
            skip_next = true;
            continue;
        }
        out.push(arg.clone());
    }
    out
}

pub const COMPILER_CRASH_LINE: &str = "error: the compiler crashed (";

#[cfg(unix)]
pub fn compiler_crash_note(status: &std::process::ExitStatus) -> Option<String> {
    use std::os::unix::process::ExitStatusExt;
    let name = match status.signal()? {
        libc::SIGABRT => "SIGABRT",
        libc::SIGSEGV => "SIGSEGV",
        libc::SIGBUS => "SIGBUS",
        libc::SIGILL => "SIGILL",
        libc::SIGFPE => "SIGFPE",
        libc::SIGTRAP => "SIGTRAP",
        _ => return None,
    };
    Some(format!(
        "\n{COMPILER_CRASH_LINE}{name}) before it finished, so this log ends early"
    ))
}

#[cfg(windows)]
pub fn compiler_crash_note(status: &std::process::ExitStatus) -> Option<String> {
    let code = status.code()? as u32;
    (code & 0xF000_0000 == 0xC000_0000).then(|| {
        format!("\n{COMPILER_CRASH_LINE}exception 0x{code:08X}) before it finished, so this log ends early")
    })
}

#[cfg(not(any(unix, windows)))]
pub fn compiler_crash_note(_status: &std::process::ExitStatus) -> Option<String> {
    None
}

pub fn discover_bibliographies(project_root: &Path) -> crate::Result<Vec<String>> {
    if !project_root.is_dir() {
        return Ok(Vec::new());
    }
    let mut found = Vec::new();
    crate::tree::walk_tree_skipping(
        project_root,
        "bibliography search",
        &|name| matches!(name.to_str(), Some(".oleafly" | ".git" | "node_modules")),
        &mut |relative, path| {
            let is_bib = relative
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("bib"));
            let placeholder = std::fs::metadata(path)
                .is_ok_and(|metadata| crate::is_cloud_placeholder(&metadata));
            if is_bib && !placeholder {
                found.push(crate::slash_path(relative));
            }
            Ok(())
        },
    )?;
    found.sort();
    Ok(found)
}
