use std::collections::{BTreeMap, BTreeSet};

use crate::engine_spec::BUNDLE_FALLBACK_NOTE;
use crate::tex_errors::CompileError;

const UNSUPPORTED_IMAGE_MARKER: &str = "[oleafly:unsupported-image] ";
const FAILED_IMAGE_MARKER: &str = "[oleafly:image-conversion-failed] ";
const UNSIZED_GRAPHIC: &str = "Cannot determine size of graphic in ";
const MISSING_CHARACTER: &str = "Missing character: There is no ";
const UNREPRESENTABLE_CHARACTER: &str = "could not represent character ";
const GENERATED_SOURCE: &str = "texput.tex:";
const MAX_WARNINGS: usize = 200;
const MAX_SAMPLE_CHARACTERS: usize = 8;
const SPACE: u32 = 0x20;
const NEVER_FATAL_PREFIXES: [&str; 3] = ["warning", "[warning]", "fontconfig "];
const FATAL_PREFIXES: [&str; 6] = [
    "error",
    "pandoc:",
    "! ",
    "utf-8 decoding error",
    "could not find",
    "yaml parse exception",
];
const NOISE_MARKERS: [&str; 11] = [
    "you may need to load the `fontspec` package",
    "choose a different font that covers the unrepresentable",
    "which is newer than current output pdf setting",
    "pdf file is tagged",
    UNREPRESENTABLE_CHARACTER,
    "tried to end an annotation without starting one",
    "interpreting special command eann",
    "unbalanced bann and eann found",
    "warning: >> ",
    "creating tounicode cmap failed",
    "failed to load tounicode cmap",
];

fn pandoc_line_kind(lower: &str, parent: Option<&'static str>) -> Option<&'static str> {
    if lower.starts_with("caused by:") {
        return parent.filter(|kind| *kind == "error");
    }
    // Tectonic on Windows can emit this Fontconfig initialization
    // message and still successfully resolve bundled fonts and write
    // the PDF. Pandoc forwards it verbatim. Keep it visible without
    // rejecting valid output; a nonzero exit still fails compilation.
    if NEVER_FATAL_PREFIXES
        .iter()
        .any(|prefix| lower.starts_with(prefix))
    {
        return Some("warning");
    }
    let fatal = FATAL_PREFIXES
        .iter()
        .any(|prefix| lower.starts_with(prefix))
        || lower.contains("--pdf-engine")
        || (lower.starts_with("file ") && lower.ends_with("not found in resource path"));
    if fatal {
        Some("error")
    } else if lower.contains("warning") {
        Some("warning")
    } else {
        None
    }
}

fn is_scratch_media_noise(lower: &str) -> bool {
    let media = lower.contains("/media-") || lower.contains("\\media-");
    let failed_input = lower.starts_with("warning: open of input ");
    (media && lower.starts_with("warning: accessing absolute path"))
        || (media && failed_input && lower.ends_with(" failed"))
        || (failed_input && lower.ends_with(".bb failed"))
}

fn is_transcript_rule(line: &str) -> bool {
    line.len() >= 40 && line.bytes().all(|byte| byte == b'=')
}

fn is_empty_location(line: &str) -> bool {
    line.strip_prefix("warning: ")
        .and_then(|rest| rest.strip_suffix(':'))
        .and_then(|rest| rest.rsplit_once(':'))
        .is_some_and(|(_, digits)| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()))
}

fn hexadecimal_after(text: &str, marker: &str) -> Option<u32> {
    let rest = &text[text.find(marker)? + marker.len()..];
    let end = rest
        .find(|character: char| !character.is_ascii_hexdigit())
        .unwrap_or(rest.len());
    u32::from_str_radix(&rest[..end], 16).ok()
}

fn missing_character(line: &str) -> Option<Option<u32>> {
    let at = line.find(MISSING_CHARACTER)?;
    let rest = &line[at + MISSING_CHARACTER.len()..];
    if rest.ends_with("in font nullfont!") {
        return Some(None);
    }
    let code = hexadecimal_after(rest, "(U+").or_else(|| hexadecimal_after(rest, "(\""));
    Some(code.filter(|code| *code > SPACE))
}

fn unrepresentable_character(line: &str) -> Option<u32> {
    let at = line.find(UNREPRESENTABLE_CHARACTER)?;
    hexadecimal_after(&line[at..], "(0x").filter(|code| *code > SPACE)
}

fn without_generated_location(line: &str) -> String {
    for prefix in ["error: ", "warning: "] {
        let Some(rest) = line
            .strip_prefix(prefix)
            .and_then(|rest| rest.strip_prefix(GENERATED_SOURCE))
        else {
            continue;
        };
        if let Some((digits, message)) = rest.split_once(": ") {
            if digits.bytes().all(|byte| byte.is_ascii_digit()) {
                return format!("{prefix}{message}");
            }
        }
    }
    line.to_owned()
}

fn image_error(code: &str, path: &str, explanation: String) -> CompileError {
    CompileError {
        message: explanation.clone(),
        kind: "error".to_owned(),
        explanation: Some(explanation),
        code: Some(code.to_owned()),
        params: BTreeMap::from([("path".to_owned(), path.to_owned())]),
        ..Default::default()
    }
}

fn unsupported_image(path: &str) -> CompileError {
    image_error(
        "markdown.image_unsupported",
        path,
        format!("The image {path} can't go in the PDF. Save it as PNG, JPG, PDF, SVG, GIF, WebP or BMP, then compile again."),
    )
}

fn failed_image(path: &str) -> CompileError {
    image_error(
        "markdown.image_conversion_failed",
        path,
        format!("Oleafly couldn't convert the image {path} for the PDF. Check that the file opens, or save it as PNG or PDF, then compile again."),
    )
}

fn unsized_image_path(rest: &str) -> &str {
    let path = rest
        .trim()
        .trim_end_matches('.')
        .trim_end_matches(" (no BoundingBox)");
    path.rsplit_once("/media-")
        .or_else(|| path.rsplit_once("\\media-"))
        .map(|(_, tail)| tail)
        .or_else(|| path.strip_prefix("media-"))
        .and_then(|tail| tail.split_once(['/', '\\']))
        .map_or(path, |(_, relative)| relative)
}

fn image_marker(line: &str) -> Option<CompileError> {
    if let Some(path) = line.split_once(UNSUPPORTED_IMAGE_MARKER) {
        return Some(unsupported_image(path.1.trim()));
    }
    if let Some(path) = line.split_once(FAILED_IMAGE_MARKER) {
        return Some(failed_image(path.1.trim()));
    }
    line.split_once(UNSIZED_GRAPHIC)
        .map(|(_, path)| unsupported_image(unsized_image_path(path)))
}

fn sample_text(code: u32) -> String {
    let invisible =
        matches!(code, 0x2000..=0x200F | 0x2028..=0x202F | 0x2060..=0x206F | 0xFE00..=0xFE0F);
    match char::from_u32(code).filter(|character| !invisible && !character.is_control()) {
        Some(character) => character.to_string(),
        None => format!("U+{code:04X}"),
    }
}

fn missing_glyphs_warning(codes: &[u32]) -> CompileError {
    let count = codes.len();
    let sample = codes
        .iter()
        .take(MAX_SAMPLE_CHARACTERS)
        .map(|code| sample_text(*code))
        .collect::<Vec<_>>()
        .join(" ");
    let explanation = if count == 1 {
        format!("A character, {sample}, is missing from the PDF because the fonts in use don't have it. Set mainfont or CJKmainfont in the YAML header to a font that does, or replace it with an image.")
    } else {
        format!("{count} characters, such as {sample}, are missing from the PDF because the fonts in use don't have them. Set mainfont or CJKmainfont in the YAML header to a font that does, or replace them with images.")
    };
    CompileError {
        message: format!("Missing characters: {sample}"),
        kind: "warning".to_owned(),
        explanation: Some(explanation),
        code: Some("markdown.missing_glyphs".to_owned()),
        params: BTreeMap::from([
            ("count".to_owned(), count.to_string()),
            ("sample".to_owned(), sample),
        ]),
        ..Default::default()
    }
}

fn note_missing_character(line: &str, seen: &mut BTreeSet<u32>, missing: &mut Vec<u32>) -> bool {
    if let Some(found) = missing_character(line) {
        if let Some(code) = found.filter(|code| seen.insert(*code)) {
            missing.push(code);
        }
        return true;
    }
    let Some(code) = unrepresentable_character(line) else {
        return false;
    };
    if seen.insert(code) {
        missing.push(code);
    }
    true
}

pub fn parse_pandoc_diagnostics(log: &str) -> Vec<CompileError> {
    let attempt = log
        .rsplit_once(BUNDLE_FALLBACK_NOTE.trim_end())
        .map_or(log, |(_, retry)| retry);
    let mut diagnostics: Vec<CompileError> = Vec::new();
    let mut missing: Vec<u32> = Vec::new();
    let mut seen = BTreeSet::new();
    let mut parent = None;
    let mut warnings = 0;
    let mut in_transcript = false;
    let mut image_stopped = false;
    for line in attempt.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if is_transcript_rule(trimmed) {
            in_transcript = !in_transcript;
            continue;
        }
        if in_transcript {
            continue;
        }
        if note_missing_character(trimmed, &mut seen, &mut missing) {
            continue;
        }
        if let Some(error) = image_marker(trimmed) {
            image_stopped = true;
            diagnostics.push(error);
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        if is_empty_location(trimmed)
            || is_scratch_media_noise(&lower)
            || NOISE_MARKERS.iter().any(|marker| lower.contains(marker))
        {
            parent = None;
            continue;
        }
        let kind = pandoc_line_kind(&lower, parent);
        if !lower.starts_with("caused by:") {
            parent = kind;
        }
        let Some(kind) = kind else {
            continue;
        };
        if kind == "warning" {
            warnings += 1;
            if warnings > MAX_WARNINGS {
                continue;
            }
        }
        diagnostics.push(CompileError {
            message: without_generated_location(trimmed),
            kind: kind.to_owned(),
            ..Default::default()
        });
    }
    if image_stopped {
        diagnostics.retain(|error| error.code.is_some() || error.kind != "error");
    }
    if !missing.is_empty() {
        diagnostics.push(missing_glyphs_warning(&missing));
    }
    diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;

    const IMAGE_NOISE: &str = "warning: accessing absolute path `/t/media-a28520/figures/test_error.png`; build may not be reproducible in other environments\n\
warning: open of input /t/media-a28520/figures/test_error.bb failed\n\
caused by: access to the path `/t/media-a28520/figures/test_error.bb` is forbidden\n";

    #[test]
    fn an_image_named_error_does_not_fail_a_compile() {
        assert_eq!(parse_pandoc_diagnostics(IMAGE_NOISE), []);
    }

    #[test]
    fn a_cause_stays_an_error_only_under_an_error() {
        let errors = parse_pandoc_diagnostics("error: x\ncaused by: y\n");
        assert_eq!(errors.len(), 2);
        assert!(errors.iter().all(|error| error.kind == "error"));
        let warnings = parse_pandoc_diagnostics("warning: x\ncaused by: y error\n");
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].kind, "warning");
    }

    #[test]
    fn plain_output_that_mentions_an_error_is_not_a_failure() {
        assert_eq!(
            parse_pandoc_diagnostics("note: wrote test_error.pdf\nordinary error_bars output\n"),
            []
        );
    }

    #[test]
    fn only_the_last_attempt_counts_after_a_bundle_fallback() {
        let first = "error: couldn't get it from the internet\nError producing PDF.\n";
        let fixed = format!("{first}\n{BUNDLE_FALLBACK_NOTE}\nnote: Running TeX ...\n");
        assert_eq!(parse_pandoc_diagnostics(&fixed), []);
        let failed = format!("{first}\n{BUNDLE_FALLBACK_NOTE}\nerror: still broken\n");
        let errors = parse_pandoc_diagnostics(&failed);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].message, "error: still broken");
    }

    #[test]
    fn every_fontconfig_line_is_a_warning() {
        let diagnostics =
            parse_pandoc_diagnostics("Fontconfig error: No writable cache directories\n");
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].kind, "warning");
    }

    #[test]
    fn known_pandoc_failures_stay_errors() {
        for line in [
            "Error producing PDF.",
            "Error reading bibliography file old.bib:",
            "Error running filter x.lua:",
            "File styles/x.csl not found in resource path",
            "UTF-8 decoding error in latin1.bib at byte offset 20",
            "Could not find data file templates/x",
            "tectonic not found. Please select a different --pdf-engine or install tectonic",
            "pandoc: x",
        ] {
            let errors = parse_pandoc_diagnostics(line);
            assert_eq!(errors.len(), 1, "{line}");
            assert_eq!(errors[0].kind, "error", "{line}");
        }
    }

    #[test]
    fn the_tex_transcript_adds_no_cards() {
        let log = "error: texput.tex:75: Undefined control sequence\n\
error: something bad happened inside XeTeX; its output follows:\n\n\
===============================================================================\n\
(texput.tex\nPackage hyperref Warning: Rerun to get /PageLabels entry.\n! Undefined control sequence.\n\
===============================================================================\n\
error: the XeTeX engine had an unrecoverable error\n";
        let messages: Vec<String> = parse_pandoc_diagnostics(log)
            .into_iter()
            .map(|error| error.message)
            .collect();
        assert_eq!(
            messages,
            [
                "error: Undefined control sequence",
                "error: something bad happened inside XeTeX; its output follows:",
                "error: the XeTeX engine had an unrecoverable error",
            ]
        );
    }

    fn glyph_log() -> String {
        let mut log = String::new();
        for (code, text) in [(0xD55C, "한"), (0x1F600, "😀"), (0xD55C, "한")] {
            log.push_str(&format!(
                "warning: texput.tex:139: Missing character: There is no \u{FFFD}\u{FFFD}\u{FFFD} (U+{code:04X}) in font [lmroman10-regular]:mapping=tex-text;!\n\
warning: could not represent character \"{text}\" (0x{code:x}) in font \"[lmroman10-regular]:mapping=tex-text;\"\n\
warning:   you may need to load the `fontspec` package and use (e.g.) \\setmainfont to\n\
warning:   choose a different font that covers the unrepresentable character(s)\n"
            ));
        }
        log.push_str(
            "warning: texput.tex:208: \nMissing character: There is no \u{FFFD} (U+1D4B3) in font [lmroman10-regular]:mapping=tex-text;!\n",
        );
        log
    }

    #[test]
    fn missing_characters_collapse_into_one_card() {
        let diagnostics = parse_pandoc_diagnostics(&glyph_log());
        assert_eq!(diagnostics.len(), 1);
        let warning = &diagnostics[0];
        assert_eq!(warning.kind, "warning");
        assert_eq!(warning.code.as_deref(), Some("markdown.missing_glyphs"));
        assert_eq!(warning.params["count"], "3");
        assert_eq!(warning.params["sample"], "한 😀 𝒳");
        assert!(!warning.message.contains('\u{FFFD}'));
        assert!(!warning.explanation.as_deref().unwrap().contains("fontspec"));
    }

    #[test]
    fn a_long_document_shows_a_short_sample() {
        let log: String = (0..50)
            .map(|index| {
                format!(
                    "warning: x:1: Missing character: There is no ? (U+{:04X}) in font y!\n",
                    0x0410 + index
                )
            })
            .collect();
        let diagnostics = parse_pandoc_diagnostics(&log);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].params["count"], "50");
        assert_eq!(
            diagnostics[0].params["sample"].split(' ').count(),
            MAX_SAMPLE_CHARACTERS
        );
    }

    #[test]
    fn preamble_nullfont_noise_is_no_missing_character() {
        let log = "warning: x:1: Missing character: There is no r (\"72) in font nullfont!\n";
        assert_eq!(parse_pandoc_diagnostics(log), []);
    }

    #[test]
    fn a_font_without_a_space_glyph_loses_no_text() {
        let log = "warning: x:1: Missing character: There is no   (U+0020) in font [a.ttf]/OT!\n\
warning: could not represent character \" \" (0x20) in font \"[a.ttf]/OT\"\n";
        assert_eq!(parse_pandoc_diagnostics(log), []);
    }

    #[test]
    fn invisible_characters_are_named_by_code_point() {
        assert_eq!(sample_text(0xFE0F), "U+FE0F");
        assert_eq!(sample_text(0x200D), "U+200D");
        assert_eq!(sample_text(0x3131), "ㄱ");
    }

    #[test]
    fn image_markers_become_coded_errors_that_name_the_file() {
        let log = "Error running filter oleafly-image-compat.lua:\n\
[oleafly:unsupported-image] figs/t.tiff\n\
stack traceback:\n\
\toleafly-image-compat.lua:14: in upvalue 'stop'\n";
        let errors = parse_pandoc_diagnostics(log);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].kind, "error");
        assert_eq!(
            errors[0].code.as_deref(),
            Some("markdown.image_unsupported")
        );
        assert_eq!(errors[0].params["path"], "figs/t.tiff");
        assert!(errors[0].message.contains("figs/t.tiff"));

        let failed = parse_pandoc_diagnostics("[oleafly:image-conversion-failed] a b.svg\n");
        assert_eq!(
            failed[0].code.as_deref(),
            Some("markdown.image_conversion_failed")
        );
        assert_eq!(failed[0].params["path"], "a b.svg");
    }

    #[test]
    fn a_graphic_tex_cannot_size_is_named() {
        for (shown, expected) in [
            ("figs/g.gif", "figs/g.gif"),
            ("/t/x/media-0cae2c562c2869d3/figs/g.gif", "figs/g.gif"),
            ("media-0cae2c562c2869d3/figs/g.gif", "figs/g.gif"),
            (
                r"C:\Temp\x\media-0cae2c562c2869d3\figs\g.gif",
                r"figs\g.gif",
            ),
        ] {
            let log = format!(
                "error: texput.tex:75: LaTeX Error: Cannot determine size of graphic in {shown} (no BoundingBox).\n"
            );
            let errors = parse_pandoc_diagnostics(&log);
            assert_eq!(
                errors[0].code.as_deref(),
                Some("markdown.image_unsupported")
            );
            assert_eq!(errors[0].params["path"], expected);
            assert!(!errors[0].message.contains("BoundingBox"));
        }
    }

    #[test]
    fn a_picture_xetex_cannot_read_leaves_one_card() {
        let media = "/t/x/media-81a756637939c341/figs/a.ico";
        let log = format!(
            "warning: accessing absolute path `{media}`; build may not be reproducible in other environments\n\
warning: open of input {media}.pdf failed\n\
caused by: access to the path `{media}.pdf` is forbidden\n\
warning: open of input {media}.PNG failed\n\
caused by: access to the path `{media}.PNG` is forbidden\n\
error: texput.tex:71: LaTeX Error: Cannot determine size of graphic in {media} (no BoundingBox).\n\
error: something bad happened inside XeTeX; its output follows:\n\
error: the XeTeX engine had an unrecoverable error\n\
Error producing PDF.\n"
        );
        let errors = parse_pandoc_diagnostics(&log);
        assert_eq!(errors.len(), 1, "{errors:?}");
        assert_eq!(errors[0].params["path"], "figs/a.ico");
    }

    #[test]
    fn a_failed_input_outside_the_scratch_media_stays_visible() {
        let errors = parse_pandoc_diagnostics("warning: open of input /t/macros.tex failed\n");
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].kind, "warning");
    }

    #[test]
    fn link_and_cmap_notes_from_the_pdf_writer_add_no_cards() {
        let log = "warning: Tried to end an annotation without starting one!\n\
warning: Interpreting special command eann (pdf:) failed.\n\
warning: >> at page=\"1\" position=\"(414.352, 657.235)\" (in PDF)\n\
warning: >> xxx \"pdf:eann\"\n\
warning: Unbalanced bann and eann found.\n\
warning: Creating ToUnicode CMap failed for \"DejaVuSans.ttf\"\n\
warning: Failed to load ToUnicode CMap for font \"DejaVuSans.ttf\"\n";
        assert_eq!(parse_pandoc_diagnostics(log), []);
    }

    #[test]
    fn a_pathological_log_stays_bounded() {
        let log = "warning: y\n".repeat(MAX_WARNINGS * 3);
        assert_eq!(parse_pandoc_diagnostics(&log).len(), MAX_WARNINGS);
    }

    #[test]
    fn included_pdf_noise_adds_no_cards() {
        let log = "warning: Trying to include PDF file with version (1.7), which is newer than current output PDF setting (1.5).\nwarning: PDF file is tagged... Ignoring tags.\n";
        assert_eq!(parse_pandoc_diagnostics(log), []);
    }
}
