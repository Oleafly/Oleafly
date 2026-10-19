//! Prose masks: the editor's views of a LaTeX, Markdown or Typst source with
//! everything that is not prose blanked out, so spelling and grammar checks
//! never see commands, math, code, citation keys or URLs.
//!
//! LaTeX and Typst masks keep the source's UTF-16 length, so their offsets
//! are the source's. The Markdown view is compacted and carries a map from
//! each prose unit back to its source unit, like the proofreading worker's
//! `grammarInput`.

mod latex_mask;
mod markdown_mask;
mod math_scan;
mod spelling_words;
mod typst_mask;
mod typst_syntax;
mod word_edges;

use oleafly_preflight::text::SourceText;

pub use latex_mask::mask_latex_for_prose_regions;
pub use markdown_mask::{markdown_to_prose, mask_markdown};
pub use spelling_words::{email_address_pattern, spelling_word_spans, SpellingWordSpan};
pub use typst_mask::mask_typst_for_prose_regions;
pub use word_edges::{trim_to_letters, trim_to_word_characters, without_soft_hyphens};

/// The word written over an inline region (a citation, URL or inline math)
/// so the sentence around it still reads as a sentence.
pub const PROSE_PLACEHOLDER: &str = "Dummy";
/// The placeholder for inline regions too short for [`PROSE_PLACEHOLDER`].
pub const PROSE_SHORT_PLACEHOLDER: &str = "X";

/// The source formats the proofreader understands.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ProseFormat {
    Latex,
    Markdown,
    Typst,
}

impl ProseFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Latex => "latex",
            Self::Markdown => "markdown",
            Self::Typst => "typst",
        }
    }
}

const TYPST_VENDOR_DIRECTORY: &str = "typst-packages";

/// `isVendoredTypstPackagePath`: files under the project's vendored Typst
/// packages are dependencies, not the author's prose.
pub fn is_vendored_typst_package_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    let trimmed = normalized.trim_start_matches('/');
    trimmed.split('/').next() == Some(TYPST_VENDOR_DIRECTORY)
}

/// `isProseSourcePath` plus the format the proofreading worker would use.
pub fn format_for_path(path: &str) -> Option<ProseFormat> {
    if is_vendored_typst_package_path(path) {
        return None;
    }
    let (_, extension) = path.rsplit_once('.')?;
    let extension = extension.to_ascii_lowercase();
    match extension.as_str() {
        "tex" | "latex" | "ltx" => Some(ProseFormat::Latex),
        "md" | "markdown" => Some(ProseFormat::Markdown),
        "typ" => Some(ProseFormat::Typst),
        _ => None,
    }
}

/// A masked region of the source, in UTF-16 units.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct MaskSpan {
    pub from: usize,
    pub to: usize,
}

/// A same-length prose copy of a LaTeX or Typst source and the regions that
/// were masked (`ProseMask`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProseMask {
    pub prose: Vec<u16>,
    pub masked: Vec<MaskSpan>,
}

/// What the grammar checker reads (`grammarInput`, worker.ts:334-359):
/// `map` is `None` when prose offsets are source offsets.
#[derive(Clone, Debug)]
pub struct ProseInput {
    pub prose: SourceText,
    pub map: Option<Vec<u32>>,
    pub masked: Vec<MaskSpan>,
}

/// The prose view of a source in `format`.
pub fn prose_for(format: ProseFormat, text: &SourceText) -> ProseInput {
    match format {
        ProseFormat::Latex | ProseFormat::Typst => {
            let mask = if format == ProseFormat::Latex {
                mask_latex_for_prose_regions(text.units())
            } else {
                mask_typst_for_prose_regions(text.units())
            };
            ProseInput {
                prose: SourceText::from_units(mask.prose),
                map: None,
                masked: mask.masked,
            }
        }
        ProseFormat::Markdown => {
            let (prose, map) = markdown_to_prose(text.units());
            ProseInput {
                prose: SourceText::from_units(prose),
                map: Some(map),
                masked: Vec::new(),
            }
        }
    }
}

/// Whether `[from, to)` touches a masked region. `masked` is sorted and
/// non-overlapping.
pub fn intersects_masked_region(masked: &[MaskSpan], from: usize, to: usize) -> bool {
    let mut low = 0isize;
    let mut high = masked.len() as isize - 1;
    while low <= high {
        let middle = (low + high) >> 1;
        let span = masked[middle as usize];
        if span.to <= from {
            low = middle + 1;
        } else if span.from >= to {
            high = middle - 1;
        } else {
            return true;
        }
    }
    false
}

/// The JavaScript `\s` set as the body of a regex character class.
pub(crate) const JS_SPACE_CLASS: &str = r"\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}";

/// `text.codePointAt(index)` as `(code point, units)`: a lone surrogate is
/// its own one-unit code point.
pub(crate) fn code_point_at(text: &[u16], index: usize) -> Option<(u32, usize)> {
    let unit = *text.get(index)?;
    if (0xD800..0xDC00).contains(&unit) {
        if let Some(&low) = text.get(index + 1) {
            if (0xDC00..0xE000).contains(&low) {
                let code = 0x10000 + ((u32::from(unit) - 0xD800) << 10) + (u32::from(low) - 0xDC00);
                return Some((code, 2));
            }
        }
    }
    Some((u32::from(unit), 1))
}

/// The character at `index` when it is a valid scalar value (never a lone
/// surrogate), with its UTF-16 length.
pub(crate) fn char_at(text: &[u16], index: usize) -> Option<(char, usize)> {
    let (code, length) = code_point_at(text, index)?;
    char::from_u32(code).map(|ch| (ch, length))
}

/// Replaces every unit in `[from, to)` except `"\n"` with a space (the
/// LaTeX mask's `blankInto`).
pub(crate) fn blank_into(out: &mut [u16], from: usize, to: usize) {
    let end = to.min(out.len());
    for unit in out.iter_mut().take(end).skip(from) {
        if *unit != u16::from(b'\n') {
            *unit = u16::from(b' ');
        }
    }
}

/// The `[from, to)` units as a string, with JavaScript `slice` clamping.
pub(crate) fn lossy(text: &[u16], from: usize, to: usize) -> String {
    let to = to.min(text.len());
    String::from_utf16_lossy(&text[from.min(to)..to])
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_preflight::text::to_units;

    #[test]
    fn prose_paths_follow_the_editor() {
        assert_eq!(format_for_path("paper.TEX"), Some(ProseFormat::Latex));
        assert_eq!(
            format_for_path("notes/readme.markdown"),
            Some(ProseFormat::Markdown)
        );
        assert_eq!(format_for_path("main.typ"), Some(ProseFormat::Typst));
        assert_eq!(format_for_path("typst-packages/x/lib.typ"), None);
        assert_eq!(format_for_path("\\typst-packages\\x\\lib.typ"), None);
        assert_eq!(format_for_path("style.sty"), None);
    }

    #[test]
    fn masked_regions_are_found_by_binary_search() {
        let masked = [MaskSpan { from: 2, to: 4 }, MaskSpan { from: 8, to: 9 }];
        assert!(intersects_masked_region(&masked, 3, 5));
        assert!(!intersects_masked_region(&masked, 4, 8));
        assert!(intersects_masked_region(&masked, 0, 20));
        assert!(!intersects_masked_region(&[], 0, 20));
    }

    #[test]
    fn latex_and_typst_prose_keep_the_utf16_length() {
        let latex = "Intro 😀 with $x$ and \\cite{key}.\n\\begin{equation}a\\end{equation}\n";
        let typst = "= Title\nText 😀 with $x$ and @key. #emph[word]\n";
        for (format, source) in [(ProseFormat::Latex, latex), (ProseFormat::Typst, typst)] {
            let text = SourceText::new(source.to_string());
            let input = prose_for(format, &text);
            assert_eq!(input.prose.len_utf16(), text.len_utf16(), "{format:?}");
            assert!(input.map.is_none());
        }
    }

    #[test]
    fn markdown_map_points_into_the_source() {
        let source = "# Title\n\nSome `code` and *prose* 😀 here, see [@key].\n";
        let text = SourceText::new(source.to_string());
        let input = prose_for(ProseFormat::Markdown, &text);
        let map = input.map.expect("markdown prose has a map");
        assert_eq!(map.len(), input.prose.len_utf16());
        assert!(map.iter().all(|&at| (at as usize) < text.len_utf16()));
        // A collapsed space maps to the unit after it, so the map only never
        // goes backwards (markdownToProse pushes the same index twice).
        assert!(map.windows(2).all(|pair| pair[0] <= pair[1]));
        assert_eq!(code_point_at(&to_units("😀"), 0), Some((0x1F600, 2)));
    }
}
