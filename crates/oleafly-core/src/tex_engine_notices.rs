use std::collections::BTreeMap;

use crate::compile_limit::{timed_out_during_download, DOWNLOAD_MARKERS, TIMED_OUT_LINE};
use crate::engine_spec::T1_KEPT_NOTE;
use crate::tex_errors::CompileError;

const BANNER_LINES: usize = 64;
const FONT_STALL_LINES: usize = 4;

const GUARDED_T1_ENCODING: &str =
    "\\usepackage{iftex}\n\\ifPDFTeX\n  \\usepackage[T1]{fontenc}\n\\fi";

const BUNDLED_FONT_FILES: &[(&str, &str)] = &[
    ("UnBatang", "UnBatang.ttf"),
    ("UnDotum", "UnDotum.ttf"),
    ("UnDinaru", "UnDinaru.ttf"),
    ("FandolSong", "FandolSong-Regular.otf"),
    ("FandolHei", "FandolHei-Regular.otf"),
    ("FandolKai", "FandolKai-Regular.otf"),
    ("FandolFang", "FandolFang-Regular.otf"),
    ("IPAexMincho", "ipaexm.ttf"),
    ("IPAexGothic", "ipaexg.ttf"),
    ("TeX Gyre Termes", "texgyretermes-regular.otf"),
    ("TeX Gyre Heros", "texgyreheros-regular.otf"),
    ("TeX Gyre Cursor", "texgyrecursor-regular.otf"),
    ("TeX Gyre Pagella", "texgyrepagella-regular.otf"),
    ("TeX Gyre Bonum", "texgyrebonum-regular.otf"),
    ("TeX Gyre Schola", "texgyreschola-regular.otf"),
    ("TeX Gyre Adventor", "texgyreadventor-regular.otf"),
    ("Libertinus Serif", "LibertinusSerif-Regular.otf"),
    ("Libertinus Sans", "LibertinusSans-Regular.otf"),
    ("Noto Serif", "NotoSerif-Regular.ttf"),
    ("Noto Sans", "NotoSans-Regular.ttf"),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LogEngine {
    Bundled,
    Pdftex,
    Xetex,
    Luatex,
}

fn log_engine(lines: &[&str]) -> LogEngine {
    lines
        .iter()
        .take(BANNER_LINES)
        .find_map(|line| {
            let name = line.trim_start().strip_prefix("This is ")?;
            if name.starts_with("XeTeX") {
                Some(LogEngine::Xetex)
            } else if name.starts_with("LuaHBTeX") || name.starts_with("LuaTeX") {
                Some(LogEngine::Luatex)
            } else if ["pdfTeX", "e-pTeX", "e-upTeX", "pTeX", "upTeX"]
                .iter()
                .any(|engine| name.starts_with(engine))
            {
                Some(LogEngine::Pdftex)
            } else {
                None
            }
        })
        .unwrap_or(LogEngine::Bundled)
}

fn t1_encoding_in_use(lines: &[&str], engine: LogEngine) -> bool {
    match engine {
        LogEngine::Pdftex => false,
        LogEngine::Bundled => lines.iter().any(|line| line.trim_end() == T1_KEPT_NOTE),
        LogEngine::Xetex | LogEngine::Luatex => {
            lines
                .iter()
                .any(|line| line.contains("font information for T1+"))
                && !lines
                    .iter()
                    .any(|line| line.starts_with("Package: fontspec "))
        }
    }
}

pub(crate) fn t1_fontenc_warning(lines: &[&str]) -> Option<CompileError> {
    t1_encoding_in_use(lines, log_engine(lines)).then(|| CompileError {
        message: "\\usepackage[T1]{fontenc} doesn't work with this compiler".into(),
        kind: "warning".into(),
        explanation: Some("This document loads \\usepackage[T1]{fontenc}, which this compiler can't use for typed accents and symbols. ß can print as SS, § and « can turn into other letters, and curly quotes, dashes and € can disappear. Remove that line or wrap it as shown below. pdfLaTeX compiles it correctly too.".into()),
        hints: vec![GUARDED_T1_ENCODING.to_owned()],
        code: Some("tex.t1_fontenc_unicode_engine".into()),
        ..Default::default()
    })
}

fn is_download_note(line: &str) -> bool {
    DOWNLOAD_MARKERS
        .iter()
        .any(|marker| line.trim_start().starts_with(marker))
}

fn font_lookup_stalled(lines: &[&str]) -> bool {
    let Some(stopped) = lines
        .iter()
        .position(|line| line.trim_start().starts_with(TIMED_OUT_LINE))
    else {
        return false;
    };
    if timed_out_during_download(lines[stopped].trim_start()) {
        return false;
    }
    lines[..stopped]
        .iter()
        .rev()
        .filter(|line| !line.trim().is_empty() && !is_download_note(line))
        .take(FONT_STALL_LINES)
        .any(|line| {
            ["ctex-fontset-mac", "fontspec", "xeCJK", "Requested font \""]
                .iter()
                .any(|marker| line.contains(marker))
        })
}

pub(crate) fn font_download_error(lines: &[&str]) -> Option<CompileError> {
    (cfg!(target_os = "macos") && font_lookup_stalled(lines)).then(|| CompileError {
        message: "macOS is waiting for an answer about downloading a font".into(),
        kind: "error".into(),
        explanation: Some("The compile stopped while macOS was asking to download a font. Answer that dialog and compile again. To avoid it, add fontset=fandol to the \\documentclass options, or pick a font that ships with TeX.".into()),
        code: Some("tex.font_download_prompt".into()),
        ..Default::default()
    })
}

fn missing_fontspec_family(message: &str) -> Option<&str> {
    let family = message
        .strip_prefix("Package fontspec Error: The font \"")?
        .split('"')
        .next()?;
    family.split(['/', ':']).next()
}

pub(crate) fn point_to_bundled_fonts(errors: &mut [CompileError], lines: &[&str]) {
    if log_engine(lines) != LogEngine::Bundled {
        return;
    }
    for error in errors.iter_mut().filter(|error| error.kind == "error") {
        let Some(family) = missing_fontspec_family(&error.message) else {
            continue;
        };
        let Some((name, file)) = BUNDLED_FONT_FILES
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(family))
        else {
            continue;
        };
        error.explanation = Some(format!(
            "{name} ships with the built-in TeX bundle, which finds fonts by file name. Write {file} instead."
        ));
        error.code = Some("tex.font_in_bundle".into());
        error.params = BTreeMap::from([
            ("file".to_owned(), (*file).to_owned()),
            ("font".to_owned(), (*name).to_owned()),
        ]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tex_errors::parse_tex_log_errors;

    fn notices(log: &str) -> Vec<CompileError> {
        parse_tex_log_errors(log)
            .into_iter()
            .filter(|error| error.kind == "warning")
            .collect()
    }

    #[test]
    fn a_kept_t1_encoding_warns_on_the_built_in_engine() {
        let log = format!("(main.tex\n{T1_KEPT_NOTE}\n)\n");
        let warnings = notices(&log);
        assert_eq!(warnings.len(), 1, "{warnings:?}");
        assert_eq!(
            warnings[0].code.as_deref(),
            Some("tex.t1_fontenc_unicode_engine")
        );
        assert_eq!(warnings[0].hints, [GUARDED_T1_ENCODING]);
    }

    #[test]
    fn t1_font_loads_warn_only_on_unicode_engines_without_fontspec() {
        let load =
            "LaTeX Font Info:    Trying to load font information for T1+lmr on input line 3.\n";
        let xetex = format!("This is XeTeX, Version 3.14\n{load}");
        assert_eq!(notices(&xetex).len(), 1);
        let luatex = format!("This is LuaHBTeX, Version 1.22\n{load}");
        assert_eq!(notices(&luatex).len(), 1);
        let pdftex = format!("This is pdfTeX, Version 3.14\n{load}");
        assert!(notices(&pdftex).is_empty());
        let fontspec = format!("This is XeTeX, Version 3.14\nPackage: fontspec 2024/05/11\n{load}");
        assert!(notices(&fontspec).is_empty());
        assert!(notices(load).is_empty());
    }

    #[test]
    fn a_stalled_font_lookup_is_told_apart_from_a_slow_compile() {
        let timed_out = "error: process timed out after 300.000s and was stopped";
        assert!(font_lookup_stalled(&[
            "(ctex-fontset-macold.def",
            "Package fontspec Warning: Font \"STSong\" does not contain requested Script \"CJK\"",
            "",
            timed_out,
        ]));
        assert!(font_lookup_stalled(&[
            "(fontspec-xetex.sty (fontenc.sty) (fontspec.cfg)))",
            timed_out,
        ]));
        assert!(!font_lookup_stalled(&[
            "(fontspec.cfg)))",
            "[1] [2] [3]",
            "[4]",
            "[5]",
            "[6]",
            timed_out,
        ]));
        assert!(!font_lookup_stalled(&["(fontspec.cfg)))"]));
        assert!(!font_lookup_stalled(&[
            "note: downloading fontspec-xetex.sty",
            "error: process timed out after 1800.000s while TeX packages were downloading and was stopped",
        ]));
        assert!(!font_lookup_stalled(&[
            "note: downloading fontspec-xetex.sty",
            "note: prefetching xeCJK.sty",
            timed_out,
        ]));
        assert!(font_lookup_stalled(&[
            "(ctex-fontset-macold.def",
            "note: downloading fontspec-xetex.sty",
            timed_out,
        ]));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_stalled_font_lookup_on_macos_is_a_coded_error() {
        let log =
            "(ctex-fontset-macold.def\nerror: process timed out after 300.000s and was stopped\n";
        let errors = parse_tex_log_errors(log);
        assert_eq!(errors.len(), 1, "{errors:?}");
        assert_eq!(errors[0].code.as_deref(), Some("tex.font_download_prompt"));
        assert_eq!(errors[0].kind, "error");
    }

    #[test]
    fn a_bundled_family_name_points_at_its_file() {
        for (family, file) in [
            ("UnBatang", "UnBatang.ttf"),
            ("fandolsong", "FandolSong-Regular.otf"),
            ("TeX Gyre Pagella", "texgyrepagella-regular.otf"),
            ("IPAexMincho/B", "ipaexm.ttf"),
        ] {
            let log = format!(
                "(main.tex\n! Package fontspec Error: The font \"{family}\" cannot be found.\n\nl.4 \\begin{{document}}\n)\n"
            );
            let errors = parse_tex_log_errors(&log);
            assert_eq!(errors.len(), 1, "{errors:?}");
            assert_eq!(errors[0].code.as_deref(), Some("tex.font_in_bundle"));
            assert_eq!(errors[0].params["file"], file);
            assert!(errors[0]
                .explanation
                .as_deref()
                .unwrap()
                .contains("by file name"));
        }
    }

    #[test]
    fn other_fonts_and_system_tex_keep_the_generic_font_error() {
        for log in [
            "! Package fontspec Error: The font \"HaranoAjiMincho\" cannot be found.\nl.4 x\n",
            "! Package fontspec Error: The font \"Comic Sans\" cannot be found.\nl.4 x\n",
            "This is XeTeX, Version 3.14\n! Package fontspec Error: The font \"UnBatang\" cannot be found.\nl.4 x\n",
        ] {
            let errors = parse_tex_log_errors(log);
            assert_eq!(errors.len(), 1, "{errors:?}");
            assert_eq!(
                errors[0].code.as_deref(),
                Some("tex.explain.package_error")
            );
            assert!(errors[0].params.is_empty());
        }
    }
}
