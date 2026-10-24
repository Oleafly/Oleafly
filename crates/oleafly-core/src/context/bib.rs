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
    fn hayagriva_keys_are_top_level_mappings() {
        let facts = analyze_hayagriva("refs.yml", "# refs\nknuth:\n  type: book\n  title: X\nlamport: {type: article}\nnot-a-key: plain\n");
        let keys: Vec<&str> = facts.defs.iter().map(|def| def.name.as_str()).collect();
        assert_eq!(keys, ["knuth", "lamport"]);
    }
}
