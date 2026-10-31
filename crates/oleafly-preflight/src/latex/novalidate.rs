use std::sync::LazyLock;

use crate::jsre::JsRegex;
use crate::latex::lexical::{latex_ignored_ranges, IgnoredKind, IgnoredRange};
use crate::text::{index_of_units, NEWLINE, SPACE, TAB};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Novalidate {
    File,
    Begin,
    End,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NovalidateScan {
    pub file_disabled: bool,
    pub regions: Vec<(usize, usize)>,
}

static NOVALIDATE_LINE: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"^[ \t]*%+[ \t]*(?:(begin|end)[ \t]+)?novalidate[ \t]*\r?$"));

pub fn novalidate_directive(line: &[u16]) -> Option<Novalidate> {
    let line = String::from_utf16_lossy(line);
    let found = NOVALIDATE_LINE.first_str(&line)?;
    Some(match found.group(&line, 1) {
        Some("begin") => Novalidate::Begin,
        Some("end") => Novalidate::End,
        _ => Novalidate::File,
    })
}

fn comment_owns_line(text: &[u16], cursor: usize) -> bool {
    let mut index = cursor;
    while index > 0 && (text[index - 1] == SPACE || text[index - 1] == TAB) {
        index -= 1;
    }
    index == 0 || text[index - 1] == NEWLINE
}

pub fn novalidate_directive_at(text: &[u16], from: usize, to: usize) -> Option<Novalidate> {
    if !comment_owns_line(text, from) {
        return None;
    }
    novalidate_directive(&text[from..to.min(text.len())])
}

pub fn skip_novalidate_region(text: &[u16], from: usize) -> usize {
    let mut line_start = if text.get(from) == Some(&NEWLINE) {
        from + 1
    } else {
        from
    };
    while line_start < text.len() {
        let line_end = index_of_units(text, &[NEWLINE], line_start);
        let stop = line_end.unwrap_or(text.len());
        if novalidate_directive(&text[line_start..stop]) == Some(Novalidate::End) {
            return line_end.map(|end| end + 1).unwrap_or(text.len());
        }
        match line_end {
            None => return text.len(),
            Some(end) => line_start = end + 1,
        }
    }
    text.len()
}

pub fn scan_latex_novalidate(text: &[u16], ranges: &[IgnoredRange]) -> NovalidateScan {
    let mut regions = Vec::new();
    let mut resume_at = 0;
    for range in ranges {
        if range.kind != IgnoredKind::Comment || range.from < resume_at {
            continue;
        }
        match novalidate_directive_at(text, range.from, range.to) {
            Some(Novalidate::File) => {
                return NovalidateScan {
                    file_disabled: true,
                    regions: Vec::new(),
                }
            }
            Some(Novalidate::Begin) => {
                resume_at = skip_novalidate_region(text, range.to);
                regions.push((range.from, resume_at));
            }
            _ => {}
        }
    }
    NovalidateScan {
        file_disabled: false,
        regions,
    }
}

pub fn scan_latex_novalidate_text(text: &[u16]) -> NovalidateScan {
    scan_latex_novalidate(text, &latex_ignored_ranges(text))
}

pub fn mask_novalidate_regions(text: &[u16], regions: &[(usize, usize)]) -> Vec<u16> {
    let mut out = text.to_vec();
    for &(from, to) in regions {
        let to = to.min(out.len());
        for unit in out.iter_mut().take(to).skip(from) {
            if *unit != NEWLINE {
                *unit = SPACE;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::to_units;

    #[test]
    fn novalidate_file_marker_disables_everything() {
        let scan = scan_latex_novalidate_text(&to_units("% novalidate\n\\begin{x}"));
        assert!(scan.file_disabled);
    }

    #[test]
    fn begin_and_end_markers_bound_a_region() {
        let text = to_units("a\n% begin novalidate\n}\n% end novalidate\nb");
        let scan = scan_latex_novalidate_text(&text);
        assert!(!scan.file_disabled);
        assert_eq!(scan.regions, vec![(2, 40)]);
    }

    #[test]
    fn an_inline_comment_is_not_a_directive() {
        let scan = scan_latex_novalidate_text(&to_units("x % novalidate"));
        assert!(!scan.file_disabled);
    }
}
