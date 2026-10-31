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
pub const BUNDLE_FALLBACK_NOTE: &str =
    "[Oleafly] The TeX package mirror was unreachable; retried with the upstream bundle.\n";
pub const MERMAID_FIGURES_FILTER_NAME: &str = "oleafly-mermaid-figures.lua";
pub const MERMAID_FIGURES_FILTER: &str = include_str!("../resources/pandoc/mermaid-figures.lua");
pub const LATEXMK_BINARY_MARKER: &str = ".oleafly-latexmk";
const MAX_MARKER_BYTES: u64 = 64 * 1024;

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
            "LaTeX main document contains characters unsafe for the generated wrapper",
        ));
    }
    Ok(())
}

/// The entry file's text: pdfTeX-only primitives become no-ops (so a
/// document written for pdfLaTeX still builds on XeTeX), then the main
/// document is read.
pub fn latex_entry_source(main_document: &str) -> crate::Result<String> {
    validate_latex_main_document(main_document)?;
    Ok(format!(
        "\\ifdefined\\pdfglyphtounicode\\else\\def\\pdfglyphtounicode#1#2{{}}\\fi\n\
         \\ifdefined\\pdfgentounicode\\else\\newcount\\pdfgentounicode\\fi\n\
         \\input{{\\detokenize{{{main_document}}}}}\n"
    ))
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
                '/' | '.' | '-' | '_' | ' ' | '(' | ')' | '[' | ']' | ',' | '+' | '=' | '@'
            )
    });
    if safe {
        Ok(())
    } else {
        Err(Error::new(
            ErrorKind::InvalidInput,
            "latexmk paths may contain letters, numbers, spaces, and portable filename punctuation only",
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

pub struct MarkdownPdfArgs<'a> {
    pub resource_argument: &'a OsStr,
    pub tectonic: &'a Path,
    pub project: &'a Path,
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
    args.push(joined(
        "--pdf-engine-opt=-Zsearch-path=",
        spec.project.as_os_str(),
    ));
    args.push(joined("--output=", spec.output.as_os_str()));
    args.push("--sandbox".into());
    args.push(format!("--lua-filter={MERMAID_FIGURES_FILTER_NAME}").into());
    args.push("--citeproc".into());
    for bibliography in spec.bibliographies {
        let mut path = spec.project.to_path_buf();
        path.extend(bibliography.components());
        args.push(joined("--bibliography=", path.as_os_str()));
    }
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
