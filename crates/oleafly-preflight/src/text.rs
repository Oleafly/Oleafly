//! Text helpers that reproduce how the TypeScript rules see a string.
//!
//! Every offset the rules report is a UTF-16 code unit in LF-normalised text,
//! because that is what JavaScript string indexes are. [`SourceText`] keeps a
//! string together with its UTF-16 units and the tables that convert between
//! byte offsets (what `regex` reports) and UTF-16 offsets (what the app and the
//! goldens use).

use std::borrow::Cow;

use icu_properties::props::{GeneralCategory, GeneralCategoryGroup};
use icu_properties::CodePointMapData;
use serde::{Deserialize, Serialize};

pub const NEWLINE: u16 = b'\n' as u16;
pub const BACKSLASH: u16 = b'\\' as u16;
pub const PERCENT: u16 = b'%' as u16;
pub const OPEN_BRACE: u16 = b'{' as u16;
pub const CLOSE_BRACE: u16 = b'}' as u16;
pub const OPEN_BRACKET: u16 = b'[' as u16;
pub const CLOSE_BRACKET: u16 = b']' as u16;
pub const OPEN_PAREN: u16 = b'(' as u16;
pub const CLOSE_PAREN: u16 = b')' as u16;
pub const SPACE: u16 = b' ' as u16;
pub const TAB: u16 = b'\t' as u16;
pub const CARRIAGE_RETURN: u16 = b'\r' as u16;

/// `"\r\n"` and a lone `"\r"` become `"\n"`, exactly like the app's
/// `/\r\n?/g` replacement before it indexes or lints a file.
pub fn normalize_line_endings(text: &str) -> Cow<'_, str> {
    if !text.as_bytes().contains(&b'\r') {
        return Cow::Borrowed(text);
    }
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut start = 0;
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'\r' {
            out.push_str(&text[start..index]);
            out.push('\n');
            index += if bytes.get(index + 1) == Some(&b'\n') {
                2
            } else {
                1
            };
            start = index;
        } else {
            index += 1;
        }
    }
    out.push_str(&text[start..]);
    Cow::Owned(out)
}

/// A 1-based line and a 1-based column counted in UTF-16 code units.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Position {
    pub line: u32,
    pub column: u32,
}

/// A string with its UTF-16 view and offset tables.
#[derive(Clone, Debug)]
pub struct SourceText {
    text: String,
    units: Vec<u16>,
    /// `text.len() + 1` entries: the UTF-16 offset of the character that
    /// contains each byte.
    byte_to_unit: Vec<u32>,
    /// `units.len() + 1` entries: the byte offset of the character that
    /// contains each unit (both halves of a surrogate pair map to its start).
    unit_to_byte: Vec<u32>,
    /// UTF-16 offsets where lines start. Only `'\n'` breaks a line.
    line_starts: Vec<usize>,
}

impl SourceText {
    /// Callers normalise line endings first when offsets must match the app.
    pub fn new(text: String) -> Self {
        let units: Vec<u16> = text.encode_utf16().collect();
        Self::build(text, units)
    }

    /// Keeps the unit count of `units` exactly, so offsets stay valid. A lone
    /// surrogate becomes U+FFFD in the string view (also one unit) while
    /// [`SourceText::units`] keeps the original unit.
    pub fn from_units(units: Vec<u16>) -> Self {
        let text = String::from_utf16_lossy(&units);
        Self::build(text, units)
    }

    fn build(text: String, units: Vec<u16>) -> Self {
        let mut byte_to_unit = vec![0u32; text.len() + 1];
        let mut unit_to_byte = Vec::with_capacity(units.len() + 1);
        let mut unit = 0u32;
        for (byte, ch) in text.char_indices() {
            for slot in &mut byte_to_unit[byte..byte + ch.len_utf8()] {
                *slot = unit;
            }
            for _ in 0..ch.len_utf16() {
                unit_to_byte.push(byte as u32);
            }
            unit += ch.len_utf16() as u32;
        }
        byte_to_unit[text.len()] = unit;
        // `from_units` can only differ from the string's own encoding in lone
        // surrogates, which are one unit on both sides, so the counts agree.
        while unit_to_byte.len() < units.len() {
            unit_to_byte.push(text.len() as u32);
        }
        unit_to_byte.truncate(units.len());
        unit_to_byte.push(text.len() as u32);
        let mut line_starts = vec![0];
        for (index, &code) in units.iter().enumerate() {
            if code == NEWLINE {
                line_starts.push(index + 1);
            }
        }
        Self {
            text,
            units,
            byte_to_unit,
            unit_to_byte,
            line_starts,
        }
    }

    pub fn as_str(&self) -> &str {
        &self.text
    }

    pub fn into_string(self) -> String {
        self.text
    }

    pub fn units(&self) -> &[u16] {
        &self.units
    }

    pub fn len_utf16(&self) -> usize {
        self.units.len()
    }

    pub fn is_empty(&self) -> bool {
        self.units.is_empty()
    }

    /// The UTF-16 offset of a byte offset (a byte inside a character maps to
    /// the character's start).
    pub fn utf16_at(&self, byte: usize) -> usize {
        self.byte_to_unit[byte.min(self.text.len())] as usize
    }

    /// The byte offset of a UTF-16 offset. A unit inside a surrogate pair maps
    /// to the start of that character.
    pub fn byte_at(&self, unit: usize) -> usize {
        self.unit_to_byte[unit.min(self.units.len())] as usize
    }

    /// The units `[from, to)` as a string, like JavaScript `slice`. A split
    /// surrogate pair becomes U+FFFD, which keeps the unit count.
    pub fn slice(&self, from: usize, to: usize) -> String {
        let to = to.min(self.units.len());
        let from = from.min(to);
        String::from_utf16_lossy(&self.units[from..to])
    }

    /// The unit at `index`, like `text.charCodeAt(index)`.
    pub fn unit(&self, index: usize) -> Option<u16> {
        self.units.get(index).copied()
    }

    pub fn line_starts(&self) -> &[usize] {
        &self.line_starts
    }

    /// The 0-based line index that contains a UTF-16 offset.
    pub fn line_index(&self, unit: usize) -> usize {
        match self.line_starts.binary_search(&unit) {
            Ok(index) => index,
            Err(index) => index.saturating_sub(1),
        }
    }

    pub fn position(&self, unit: usize) -> Position {
        let unit = unit.min(self.units.len());
        let line = self.line_index(unit);
        Position {
            line: line as u32 + 1,
            column: (unit - self.line_starts[line]) as u32 + 1,
        }
    }

    /// The text of the line that contains `unit`, without its newline.
    pub fn line_text(&self, unit: usize) -> String {
        let line = self.line_index(unit.min(self.units.len()));
        let start = self.line_starts[line];
        let end = self
            .line_starts
            .get(line + 1)
            .map(|next| next - 1)
            .unwrap_or(self.units.len());
        self.slice(start, end)
    }
}

/// The number of UTF-16 code units in `text` (JavaScript `length`).
pub fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

pub fn to_units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

/// `text.split("\n")` with the UTF-16 offset where each piece starts.
pub fn lines_with_offsets(text: &str) -> impl Iterator<Item = (usize, &str)> {
    let mut offset = 0usize;
    text.split('\n').map(move |line| {
        let start = offset;
        offset += utf16_len(line) + 1;
        (start, line)
    })
}

/// JavaScript's whitespace set (`WhiteSpace` and `LineTerminator`), which
/// `trim()` strips and `\s` matches.
pub fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

pub fn is_js_space_unit(unit: u16) -> bool {
    char::from_u32(u32::from(unit)).is_some_and(is_js_space)
}

pub fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

pub fn js_trim_start(text: &str) -> &str {
    text.trim_start_matches(is_js_space)
}

pub fn js_trim_end(text: &str) -> &str {
    text.trim_end_matches(is_js_space)
}

fn general_category(code_point: u32) -> GeneralCategory {
    CodePointMapData::<GeneralCategory>::new().get32(code_point)
}

fn unit_category(unit: u16) -> Option<GeneralCategory> {
    // A lone surrogate never matches a Unicode class in JavaScript:
    // `/\p{L}/u.test("\uD835")` is false.
    if (0xD800..=0xDFFF).contains(&unit) {
        return None;
    }
    Some(general_category(u32::from(unit)))
}

pub fn is_letter(c: char) -> bool {
    GeneralCategoryGroup::Letter.contains(general_category(c as u32))
}

pub fn is_mark(c: char) -> bool {
    GeneralCategoryGroup::Mark.contains(general_category(c as u32))
}

pub fn is_number(c: char) -> bool {
    GeneralCategoryGroup::Number.contains(general_category(c as u32))
}

pub fn is_connector(c: char) -> bool {
    general_category(c as u32) == GeneralCategory::ConnectorPunctuation
}

pub fn is_letter_number(c: char) -> bool {
    general_category(c as u32) == GeneralCategory::LetterNumber
}

pub fn is_letter_unit(unit: u16) -> bool {
    unit_category(unit).is_some_and(|category| GeneralCategoryGroup::Letter.contains(category))
}

pub fn is_mark_unit(unit: u16) -> bool {
    unit_category(unit).is_some_and(|category| GeneralCategoryGroup::Mark.contains(category))
}

pub fn is_number_unit(unit: u16) -> bool {
    unit_category(unit).is_some_and(|category| GeneralCategoryGroup::Number.contains(category))
}

pub fn is_connector_unit(unit: u16) -> bool {
    unit_category(unit) == Some(GeneralCategory::ConnectorPunctuation)
}

pub fn is_letter_number_unit(unit: u16) -> bool {
    unit_category(unit) == Some(GeneralCategory::LetterNumber)
}

/// `/[\p{L}\p{N}]/u` on one character.
pub fn is_letter_or_number(c: char) -> bool {
    let category = general_category(c as u32);
    GeneralCategoryGroup::Letter.contains(category)
        || GeneralCategoryGroup::Number.contains(category)
}

/// JavaScript `Math.round`: halves round towards positive infinity.
pub fn js_round(value: f64) -> f64 {
    if !value.is_finite() {
        return value;
    }
    let floor = value.floor();
    let rounded = if value - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    };
    // `Math.round(-0.4)` is -0, which prints as "0".
    if rounded == 0.0 {
        0.0
    } else {
        rounded
    }
}

/// JavaScript `String(number)` for the values the rules print (integers and
/// short decimals). Rust's shortest round-trip formatting matches V8's except
/// for exponent notation, which these values never reach.
pub fn js_number_to_string(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    if value == 0.0 {
        return "0".to_string();
    }
    format!("{value}")
}

/// JavaScript `Number.prototype.toFixed`: the exact decimal value rounded
/// half up (away from zero), unlike Rust's `{:.N}`, which rounds ties to even.
pub fn js_to_fixed(value: f64, digits: usize) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    if value.abs() >= 1e21 {
        return js_number_to_string(value);
    }
    let negative = value < 0.0;
    // 1100 fractional digits hold every finite double exactly, so this
    // string is the exact decimal expansion and no rounding happened yet.
    let exact = format!("{:.1100}", value.abs());
    let (whole, fraction) = exact.split_once('.').unwrap_or((exact.as_str(), ""));
    let mut digits_out: Vec<u8> = whole.bytes().chain(fraction.bytes().take(digits)).collect();
    let rest = fraction.as_bytes().get(digits..).unwrap_or(&[]);
    if rest.first().is_some_and(|&d| d >= b'5') {
        let mut index = digits_out.len();
        loop {
            if index == 0 {
                digits_out.insert(0, b'1');
                break;
            }
            index -= 1;
            if digits_out[index] == b'9' {
                digits_out[index] = b'0';
            } else {
                digits_out[index] += 1;
                break;
            }
        }
    }
    let split = digits_out.len() - digits;
    let mut out = String::new();
    let all_zero = digits_out.iter().all(|&d| d == b'0');
    if negative && !all_zero {
        out.push('-');
    }
    out.push_str(std::str::from_utf8(&digits_out[..split]).unwrap_or("0"));
    if digits > 0 {
        out.push('.');
        out.push_str(std::str::from_utf8(&digits_out[split..]).unwrap_or(""));
    }
    out
}

/// `String.prototype.indexOf` over units, from `from`.
pub fn index_of_units(haystack: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    if needle.is_empty() {
        return Some(from.min(haystack.len()));
    }
    if from >= haystack.len() || needle.len() > haystack.len() {
        return None;
    }
    (from..=haystack.len() - needle.len()).find(|&index| haystack[index..].starts_with(needle))
}

/// `String.prototype.lastIndexOf` over units, at or before `before`.
pub fn last_index_of_units(haystack: &[u16], needle: &[u16], before: usize) -> Option<usize> {
    if needle.len() > haystack.len() {
        return None;
    }
    let last = (haystack.len() - needle.len()).min(before);
    (0..=last)
        .rev()
        .find(|&index| haystack[index..].starts_with(needle))
}

/// Whether `units` spell exactly `text`.
pub fn units_eq_str(units: &[u16], text: &str) -> bool {
    units.iter().copied().eq(text.encode_utf16())
}

pub fn starts_with_units(haystack: &[u16], at: usize, needle: &str) -> bool {
    for (index, unit) in (at..).zip(needle.encode_utf16()) {
        if haystack.get(index) != Some(&unit) {
            return false;
        }
    }
    true
}

/// `value.replace(/^L|T$/g, "")`: one leading `L` and one trailing `T`. The
/// trailing one is never the character the leading match already consumed.
pub fn strip_one_each_end(value: &str, leading: char, trailing: char) -> &str {
    let rest = value.strip_prefix(leading).unwrap_or(value);
    rest.strip_suffix(trailing).unwrap_or(rest)
}

/// `value.replace(/^X?|X?$/g, "")`: the leading match always wins at offset
/// zero, so a value that is only a trailing `X` keeps it.
pub fn strip_optional_each_end(value: &str, leading: char, trailing: char) -> &str {
    if let Some(rest) = value.strip_prefix(leading) {
        return rest.strip_suffix(trailing).unwrap_or(rest);
    }
    // The empty match at offset zero means the trailing character must start
    // at offset one or later.
    if value.chars().nth(1).is_some() {
        value.strip_suffix(trailing).unwrap_or(value)
    } else {
        value
    }
}

/// `/^(["'])|(["'])$/g` style quote stripping used for bibliography targets:
/// one leading quote and one trailing quote, each of either kind.
pub fn strip_quotes(value: &str) -> &str {
    let rest = value
        .strip_prefix('"')
        .or_else(|| value.strip_prefix('\''))
        .unwrap_or(value);
    rest.strip_suffix('"')
        .or_else(|| rest.strip_suffix('\''))
        .unwrap_or(rest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_offsets_count_surrogate_pairs() {
        let t = SourceText::new("a😀b".into());
        assert_eq!((t.len_utf16(), t.utf16_at(5), t.byte_at(3)), (4, 3, 5));
    }

    #[test]
    fn positions_are_one_based_utf16_columns() {
        let t = SourceText::new("é😀\nx".into());
        assert_eq!(t.position(3), Position { line: 1, column: 4 });
        assert_eq!(t.position(4), Position { line: 2, column: 1 });
    }

    #[test]
    fn normalizes_crlf_and_lone_cr_like_the_app() {
        assert_eq!(normalize_line_endings("a\r\nb\rc\n"), "a\nb\nc\n");
        assert!(matches!(
            normalize_line_endings("plain\n"),
            Cow::Borrowed(_)
        ));
    }

    #[test]
    fn js_trim_also_strips_bom_and_nbsp() {
        assert_eq!(js_trim("\u{feff} x \u{a0}"), "x");
    }

    #[test]
    fn from_units_keeps_the_unit_count_for_lone_surrogates() {
        let t = SourceText::from_units(vec![0xD835, 0x61]);
        assert_eq!(t.len_utf16(), 2);
        assert_eq!(t.units()[0], 0xD835);
        assert_eq!(t.byte_at(1), 3);
    }

    #[test]
    fn letter_tests_reject_lone_surrogates() {
        assert!(
            !is_letter_unit(0xD835) && is_letter_unit('é' as u16) && !is_letter_unit(b'@' as u16)
        );
    }

    #[test]
    fn slicing_a_surrogate_pair_keeps_the_unit_count() {
        let t = SourceText::new("😀x".into());
        assert_eq!(utf16_len(&t.slice(1, 3)), 2);
    }

    #[test]
    fn to_fixed_rounds_halves_up_like_javascript() {
        assert_eq!(js_to_fixed(10.25, 1), "10.3");
        assert_eq!(js_to_fixed(9.95, 1), "9.9");
        assert_eq!(js_to_fixed(10.0, 1), "10.0");
        assert_eq!(js_to_fixed(0.04, 1), "0.0");
        assert_eq!(js_to_fixed(99.96, 1), "100.0");
        assert_eq!(js_to_fixed(f64::NAN, 1), "NaN");
    }

    #[test]
    fn numbers_print_like_javascript_strings() {
        assert_eq!(js_number_to_string(612.0), "612");
        assert_eq!(js_number_to_string(841.9), "841.9");
        assert_eq!(js_number_to_string(-0.0), "0");
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(0.49999999999999994), 0.0);
    }

    #[test]
    fn replace_style_stripping_matches_the_regex_semantics() {
        assert_eq!(strip_one_each_end("{a}", '{', '}'), "a");
        assert_eq!(strip_one_each_end("}", '{', '}'), "");
        assert_eq!(strip_one_each_end("{a}}", '{', '}'), "a}");
        assert_eq!(strip_optional_each_end("}", '{', '}'), "}");
        assert_eq!(strip_optional_each_end("a}", '{', '}'), "a");
        assert_eq!(strip_optional_each_end("{}", '{', '}'), "");
        assert_eq!(strip_optional_each_end("{a}", '{', '}'), "a");
        assert_eq!(strip_quotes("\"refs\""), "refs");
        assert_eq!(strip_quotes("'"), "");
    }

    #[test]
    fn lines_report_utf16_starts() {
        let lines: Vec<_> = lines_with_offsets("é😀\nx").collect();
        assert_eq!(lines, vec![(0, "é😀"), (4, "x")]);
    }
}
