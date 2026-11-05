use regex::Regex;
use std::sync::LazyLock;

pub(crate) struct Source {
    pub chars: Vec<char>,
    line_starts: Vec<usize>,
}

impl Source {
    pub fn new(text: &str) -> Source {
        let chars: Vec<char> = text.chars().collect();
        let mut line_starts = vec![0];
        for (index, character) in chars.iter().enumerate() {
            if *character == '\n' {
                line_starts.push(index + 1);
            }
        }
        Source { chars, line_starts }
    }

    pub fn line_of(&self, offset: usize) -> u32 {
        let index = match self.line_starts.binary_search(&offset) {
            Ok(index) => index,
            Err(index) => index.saturating_sub(1),
        };
        (index + 1) as u32
    }
}

pub(crate) fn string_of(chars: &[char]) -> String {
    chars.iter().collect()
}

pub(crate) fn starts_with_at(chars: &[char], at: usize, prefix: &str) -> bool {
    for (index, expected) in (at..).zip(prefix.chars()) {
        if chars.get(index) != Some(&expected) {
            return false;
        }
    }
    true
}

/// JavaScript's `\s`: Unicode white space, with U+FEFF and without U+0085.
pub(crate) fn is_js_space(character: char) -> bool {
    (character.is_whitespace() && character != '\u{85}') || character == '\u{feff}'
}

pub(crate) fn trim_js(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

/// `[\p{L}\p{M}]`.
pub(crate) fn is_letter_mark(character: char) -> bool {
    static LETTER_OR_MARK: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^[\p{L}\p{M}]$").expect("a valid pattern"));
    if character.is_ascii() {
        return character.is_ascii_alphabetic();
    }
    LETTER_OR_MARK.is_match(character.encode_utf8(&mut [0; 4]))
}

/// Unicode marks (`\p{M}`).
pub(crate) fn is_mark(character: char) -> bool {
    unicode_normalization::char::is_combining_mark(character)
}

pub(crate) fn is_name_character(character: char) -> bool {
    character.is_alphanumeric()
        || is_mark(character)
        || character == '_'
        || matches!(
            character,
            '\u{203F}' | '\u{2040}' | '\u{2054}' | '\u{FE33}' | '\u{FE34}' | '\u{FE4D}'
                ..='\u{FE4F}' | '\u{FF3F}'
        )
}

pub(crate) fn dirname(path: &str) -> &str {
    match path.rfind('/') {
        Some(index) => &path[..index],
        None => "",
    }
}

pub(crate) fn normalize_project_path(path: &str) -> Option<String> {
    let replaced = path.replace('\\', "/");
    let control = replaced
        .chars()
        .any(|character| (character as u32) <= 0x1f || character as u32 == 0x7f);
    let drive = {
        let bytes = replaced.as_bytes();
        bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/'
    };
    if replaced.starts_with('/') || drive || control {
        return None;
    }
    let mut parts: Vec<&str> = Vec::new();
    for part in replaced.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            parts.pop()?;
            continue;
        }
        parts.push(part);
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

fn has_scheme(raw: &str) -> bool {
    let mut characters = raw.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    if !first.is_ascii_alphabetic() {
        return false;
    }
    for character in characters {
        if character == ':' {
            return true;
        }
        if !(character.is_ascii_alphanumeric() || matches!(character, '+' | '.' | '-')) {
            return false;
        }
    }
    false
}

pub(crate) fn has_extension(path: &str) -> bool {
    let last = path.rsplit('/').next().unwrap_or(path);
    match last.rfind('.') {
        Some(dot) => {
            let extension = &last[dot + 1..];
            !extension.is_empty()
                && extension
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric())
        }
        None => false,
    }
}

pub(crate) fn resolve_project_path_from(
    directory: &str,
    raw_target: &str,
    default_extension: Option<&str>,
) -> Option<String> {
    let trimmed = trim_js(raw_target);
    let raw = trimmed.strip_prefix(['"', '\'']).unwrap_or(trimmed);
    let raw = raw.strip_suffix(['"', '\'']).unwrap_or(raw);
    if raw.is_empty()
        || raw.starts_with('#')
        || raw.starts_with('@')
        || raw.starts_with('/')
        || has_scheme(raw)
    {
        return None;
    }
    let relative = raw.strip_prefix("./").unwrap_or(raw);
    let joined = if directory.is_empty() {
        relative.to_string()
    } else {
        format!("{directory}/{relative}")
    };
    let mut normalized = normalize_project_path(&joined)?;
    if let Some(extension) = default_extension {
        if !has_extension(&normalized) {
            normalized.push_str(extension);
        }
    }
    Some(normalized)
}

pub(crate) fn resolve_project_path(
    from_file: &str,
    raw_target: &str,
    default_extension: Option<&str>,
) -> Option<String> {
    resolve_project_path_from(dirname(from_file), raw_target, default_extension)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_paths_resolve_like_the_app() {
        assert_eq!(
            resolve_project_path("chapters/intro.tex", "methods", None).as_deref(),
            Some("chapters/methods")
        );
        assert_eq!(
            resolve_project_path("main.tex", "./a/../b.tex", None).as_deref(),
            Some("b.tex")
        );
        assert_eq!(resolve_project_path("main.tex", "../x", None), None);
        assert_eq!(
            resolve_project_path("main.tex", "https://x.org/a", None),
            None
        );
        assert_eq!(
            resolve_project_path("main.typ", "refs", Some(".bib")).as_deref(),
            Some("refs.bib")
        );
        assert_eq!(normalize_project_path("C:/x"), None);
    }

    #[test]
    fn lines_are_one_based() {
        let source = Source::new("a\nbc\n\nd");
        assert_eq!(source.line_of(0), 1);
        assert_eq!(source.line_of(2), 2);
        assert_eq!(source.line_of(5), 3);
        assert_eq!(source.line_of(6), 4);
    }
}
