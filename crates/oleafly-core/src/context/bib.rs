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
            if let Some(colon) = line.find(':') {
                let key = line[..colon].trim().trim_matches(['"', '\'']);
                let value = line[colon + 1..].trim();
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
    fn hayagriva_keys_are_top_level_mappings() {
        let facts = analyze_hayagriva("refs.yml", "# refs\nknuth:\n  type: book\n  title: X\nlamport: {type: article}\nnot-a-key: plain\n");
        let keys: Vec<&str> = facts.defs.iter().map(|def| def.name.as_str()).collect();
        assert_eq!(keys, ["knuth", "lamport"]);
    }
}
