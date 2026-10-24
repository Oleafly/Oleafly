//! Citation keys from BibTeX/BibLaTeX files and Hayagriva YAML.
use super::text::Source;
use super::{Def, DefKind, FileFacts};

/// `@type{key,` entries, except `@comment`, `@string` and `@preamble`.
pub(crate) fn analyze_bibtex(file: &str, text: &str) -> FileFacts {
    let source = Source::new(text);
    let chars = &source.chars;
    let mut facts = FileFacts::default();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] != '@' {
            index += 1;
            continue;
        }
        let mut cursor = index + 1;
        while cursor < chars.len() && (chars[cursor].is_alphanumeric() || chars[cursor] == '_') {
            cursor += 1;
        }
        let entry_type: String = chars[index + 1..cursor]
            .iter()
            .collect::<String>()
            .to_lowercase();
        if entry_type.is_empty() {
            index += 1;
            continue;
        }
        while cursor < chars.len() && chars[cursor].is_whitespace() {
            cursor += 1;
        }
        if chars.get(cursor) != Some(&'{') && chars.get(cursor) != Some(&'(') {
            index = cursor;
            continue;
        }
        cursor += 1;
        while cursor < chars.len() && chars[cursor].is_whitespace() {
            cursor += 1;
        }
        let key_start = cursor;
        while cursor < chars.len()
            && !chars[cursor].is_whitespace()
            && !matches!(chars[cursor], ',' | '}' | ')')
        {
            cursor += 1;
        }
        if cursor > key_start && !matches!(entry_type.as_str(), "comment" | "string" | "preamble") {
            facts.defs.push(Def {
                kind: DefKind::Bibentry,
                name: chars[key_start..cursor].iter().collect(),
                file: file.to_string(),
                from: key_start,
                line: source.line_of(key_start),
                level: None,
                explicit: true,
            });
        }
        index = cursor.max(index + 1);
    }
    facts
}

/// A mapping line split into its key and what follows the colon. A quoted
/// key ends at its closing quote. A plain key ends at the first colon that
/// is followed by whitespace, a `{` or the end of the line (YAML's rule), so
/// a key such as `knuth:1984` keeps its colon.
fn split_mapping_key(line: &str) -> Option<(&str, &str)> {
    if let Some(quote) = line
        .chars()
        .next()
        .filter(|first| matches!(first, '"' | '\''))
    {
        let close = line[1..].find(quote)? + 1;
        let rest = line[close + 1..].trim_start().strip_prefix(':')?;
        return Some((&line[1..close], rest));
    }
    let mut from = 0;
    while let Some(found) = line[from..].find(':') {
        let colon = from + found;
        let rest = &line[colon + 1..];
        if rest.is_empty() || rest.starts_with(char::is_whitespace) || rest.starts_with('{') {
            return Some((line[..colon].trim_end(), rest));
        }
        from = colon + 1;
    }
    None
}

/// The most UTF-16 units a YAML bibliography may have
/// (`MAX_BIBLIOGRAPHY_YAML_CHARACTERS`).
const MAX_BIBLIOGRAPHY_YAML_CHARACTERS: usize = 1_000_000;
/// How much of a YAML file the Hayagriva sniff reads.
const SNIFF_WINDOW: usize = 8192;

/// A YAML line without its comment (a `#` at the start or after a space,
/// outside quotes).
fn without_comment(line: &str) -> &str {
    let mut quote: Option<char> = None;
    let mut previous: Option<char> = None;
    for (index, character) in line.char_indices() {
        match quote {
            Some(open) if character == open => quote = None,
            Some(_) => {}
            None if character == '"' || character == '\'' => quote = Some(character),
            None if character == '#' && previous.is_none_or(char::is_whitespace) => {
                return line[..index].trim_end();
            }
            None => {}
        }
        previous = Some(character);
    }
    line.trim_end()
}

/// The keys of a flow mapping (`{type: Article, title: X}`).
fn flow_map_keys(value: &str) -> Vec<String> {
    let Some(body) = value
        .trim()
        .strip_prefix('{')
        .and_then(|rest| rest.strip_suffix('}'))
    else {
        return Vec::new();
    };
    let mut keys = Vec::new();
    let mut depth = 0i32;
    let mut item = String::new();
    for character in body.chars().chain(std::iter::once(',')) {
        match character {
            '{' | '[' => depth += 1,
            '}' | ']' => depth -= 1,
            ',' if depth == 0 => {
                if let Some((key, _)) = split_mapping_key(item.trim()) {
                    keys.push(key.trim().trim_matches(['"', '\'']).to_string());
                }
                item.clear();
                continue;
            }
            _ => {}
        }
        item.push(character);
    }
    keys
}

/// `looksLikeHayagriva`: the first entry of the file has a `type` or a
/// `title` field.
fn looks_like_hayagriva(text: &str) -> bool {
    let mut window = String::new();
    let mut units = 0;
    for character in text.chars() {
        units += character.len_utf16();
        if units > SNIFF_WINDOW {
            break;
        }
        window.push(character);
    }
    let indent = |line: &str| line.len() - line.trim_start_matches([' ', '\t']).len();
    let blank = |line: &str| {
        let rest = line.trim_start_matches([' ', '\t']);
        rest.trim().is_empty() || rest.starts_with('#')
    };
    let mut lines = window.split('\n').map(|line| line.trim_end_matches('\r'));
    let first = lines.find(|line| {
        !blank(line)
            && !line.starts_with("---")
            && !line.starts_with("...")
            && !line.starts_with('%')
    });
    let Some(first) = first else {
        return false;
    };
    if indent(first) > 0
        || first.starts_with(['-', '?', '[', '{', '&', '*', '!', '|', '>', '@', '`'])
    {
        return false;
    }
    let Some((_, rest)) = split_mapping_key(without_comment(first)) else {
        return false;
    };
    let is_entry_field = |name: &str| name == "type" || name == "title";
    if !rest.trim().is_empty() {
        return flow_map_keys(rest).iter().any(|name| is_entry_field(name));
    }
    let body: Vec<&str> = lines
        .take_while(|line| blank(line) || indent(line) > 0)
        .filter(|line| !blank(line))
        .collect();
    let Some(field_indent) = body.first().map(|line| indent(line)) else {
        return false;
    };
    body.iter()
        .filter(|line| indent(line) == field_indent)
        .filter_map(|line| split_mapping_key(without_comment(line.trim_start())))
        .any(|(name, _)| is_entry_field(name.trim().trim_matches(['"', '\''])))
}

/// `acceptsBibliographyYaml`: small enough, and Hayagriva-shaped or named
/// by a Typst `#bibliography`.
pub(crate) fn accepts_bibliography_yaml(text: &str, named: bool) -> bool {
    text.chars().map(char::len_utf16).sum::<usize>() <= MAX_BIBLIOGRAPHY_YAML_CHARACTERS
        && (looks_like_hayagriva(text) || named)
}

/// Top-level keys of a Hayagriva file (`key:` at the start of a line).
pub(crate) fn analyze_hayagriva(file: &str, text: &str) -> FileFacts {
    let mut facts = FileFacts::default();
    let mut offset = 0;
    for (index, line) in text.split('\n').enumerate() {
        let length = line.chars().count();
        let first = line.chars().next();
        let top_level = first.is_some_and(|character| {
            !character.is_whitespace() && !matches!(character, '#' | '-' | '%')
        }) && !line.starts_with("---")
            && !line.starts_with("...");
        if top_level {
            if let Some((key, rest)) = split_mapping_key(line) {
                let key = key.trim();
                let value = rest.trim();
                let value_is_mapping = value.is_empty() || value.starts_with('{');
                if !key.is_empty() && value_is_mapping {
                    facts.defs.push(Def {
                        kind: DefKind::Bibentry,
                        name: key.to_string(),
                        file: file.to_string(),
                        from: offset,
                        line: (index + 1) as u32,
                        level: None,
                        explicit: true,
                    });
                }
            }
        }
        offset += length + 1;
    }
    facts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bibtex_keys_skip_strings_and_comments() {
        let facts = analyze_bibtex(
            "refs.bib",
            "@string{x = \"y\"}\n@comment{nothing}\n@article{knuth1984,\n  title={T}}\n@Book( lamport ,title={L})\n",
        );
        let keys: Vec<&str> = facts.defs.iter().map(|def| def.name.as_str()).collect();
        assert_eq!(keys, ["knuth1984", "lamport"]);
        assert_eq!(facts.defs[0].line, 3);
    }

    #[test]
    fn hayagriva_keys_may_contain_colons() {
        let facts = analyze_hayagriva(
            "refs.yml",
            "knuth:1984:\n  type: book\nsmith:2020: {type: article}\n\"quoted:key\":\n  type: web\n'single:key': {type: web}\nurl: https://example.org/a:b\nplain:{type: book}\n",
        );
        let keys: Vec<&str> = facts.defs.iter().map(|def| def.name.as_str()).collect();
        assert_eq!(
            keys,
            [
                "knuth:1984",
                "smith:2020",
                "quoted:key",
                "single:key",
                "plain"
            ]
        );
    }

    #[test]
    fn only_hayagriva_shaped_or_named_yaml_is_a_bibliography() {
        let hayagriva = "# refs\nknuth:\n  type: book\n  title: X\n";
        assert!(accepts_bibliography_yaml(hayagriva, false));
        assert!(accepts_bibliography_yaml(
            "---\nsmith: {type: article, title: Y}\n",
            false
        ));
        let conda = "name: env\nchannels:\n  - conda-forge\ndependencies:\n  - numpy\n";
        assert!(!accepts_bibliography_yaml(conda, false));
        let compose = "services:\n  web:\n    image: nginx\nvolumes:\n  data: {}\n";
        assert!(!accepts_bibliography_yaml(compose, false));
        // A Typst `#bibliography("x.yml")` vouches for it.
        assert!(accepts_bibliography_yaml(conda, true));
        let huge = format!("{hayagriva}{}", "# padding\n".repeat(110_000));
        assert!(!accepts_bibliography_yaml(&huge, true));
    }

    #[test]
    fn hayagriva_keys_are_top_level_mappings() {
        let facts = analyze_hayagriva("refs.yml", "# refs\nknuth:\n  type: book\n  title: X\nlamport: {type: article}\nnot-a-key: plain\n");
        let keys: Vec<&str> = facts.defs.iter().map(|def| def.name.as_str()).collect();
        assert_eq!(keys, ["knuth", "lamport"]);
    }
}
