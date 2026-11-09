pub struct FrontMatter<'a> {
    lines: Vec<&'a str>,
    body: &'a str,
}

impl<'a> FrontMatter<'a> {
    pub fn lines(&self) -> &[&'a str] {
        &self.lines
    }

    pub fn body(&self) -> &'a str {
        self.body
    }

    pub fn scalar(&self, key: &str) -> Option<String> {
        scalar(&self.lines, key)
    }

    pub fn into_parts(self) -> (Vec<&'a str>, &'a str) {
        (self.lines, self.body)
    }
}

fn bare(line: &str) -> &str {
    let line = line.strip_suffix('\n').unwrap_or(line);
    line.strip_suffix('\r').unwrap_or(line)
}

fn is_fence(line: &str, closing: bool) -> bool {
    let line = line.trim_end_matches([' ', '\t']);
    line == "---" || (closing && line == "...")
}

pub fn split(text: &str) -> Option<FrontMatter<'_>> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut lines = text.split_inclusive('\n');
    let first = lines.next()?;
    if !first.ends_with('\n') || !is_fence(bare(first), false) {
        return None;
    }
    let mut offset = first.len();
    let mut found = Vec::new();
    for line in lines {
        offset += line.len();
        let line = bare(line);
        if is_fence(line, true) {
            return Some(FrontMatter {
                lines: found,
                body: &text[offset..],
            });
        }
        found.push(line);
    }
    None
}

fn unquoted_key(key: &str) -> &str {
    ['"', '\'']
        .into_iter()
        .find_map(|quote| {
            key.strip_prefix(quote)
                .and_then(|inner| inner.strip_suffix(quote))
        })
        .unwrap_or(key)
}

pub fn key_of(line: &str) -> Option<&str> {
    if line.starts_with([' ', '\t', '-', '#']) {
        return None;
    }
    let (key, rest) = line.split_once(':')?;
    if !(rest.is_empty() || rest.starts_with([' ', '\t'])) {
        return None;
    }
    let key = unquoted_key(key.trim_end_matches([' ', '\t']));
    (!key.is_empty()).then_some(key)
}

pub fn value_of(line: &str) -> &str {
    line.split_once(':').map_or("", |(_, rest)| rest.trim())
}

fn double_quoted(raw: &str) -> Option<(String, usize)> {
    let bytes = raw.as_bytes();
    let mut index = 1;
    while index < bytes.len() && bytes[index] != b'"' {
        index += if bytes[index] == b'\\' { 2 } else { 1 };
    }
    let value = serde_json::from_str::<String>(raw.get(..=index)?).ok()?;
    Some((value, index + 1))
}

fn single_quoted(raw: &str) -> Option<(String, usize)> {
    let mut value = String::new();
    let mut chars = raw.char_indices().skip(1).peekable();
    while let Some((at, c)) = chars.next() {
        if c == '\'' {
            if chars.peek().map(|(_, next)| *next) == Some('\'') {
                chars.next();
                value.push('\'');
                continue;
            }
            return Some((value, at + 1));
        }
        value.push(c);
    }
    None
}

pub fn quoted_scalar(raw: &str) -> Option<(String, usize)> {
    if raw.starts_with('"') {
        double_quoted(raw)
    } else if raw.starts_with('\'') {
        single_quoted(raw)
    } else {
        None
    }
}

fn without_comment(raw: &str) -> &str {
    let mut previous_space = false;
    for (at, c) in raw.char_indices() {
        if c == '#' && previous_space {
            return &raw[..at];
        }
        previous_space = c.is_whitespace();
    }
    raw
}

pub fn scalar_value(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let value = if raw.starts_with(['"', '\'']) {
        quoted_scalar(raw)?.0
    } else if raw.starts_with('#') {
        return None;
    } else {
        without_comment(raw).to_string()
    };
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

pub fn scalar(lines: &[&str], key: &str) -> Option<String> {
    lines
        .iter()
        .rfind(|line| key_of(line) == Some(key))
        .and_then(|line| scalar_value(value_of(line)))
}

#[cfg(test)]
mod tests {
    use super::{key_of, quoted_scalar, scalar, scalar_value, split, value_of};

    fn read(text: &str, key: &str) -> Option<String> {
        split(text)?.scalar(key)
    }

    #[test]
    fn splits_the_block_at_the_first_closing_fence() {
        let text = "\u{feff}---  \r\nid: a\r\nkind: note\r\n... \r\nBody\r\n";
        let front = split(text).unwrap();
        assert_eq!(front.lines(), ["id: a", "kind: note"]);
        assert_eq!(front.body(), "Body\r\n");
        let closed_last = split("---\nid: a\n---").unwrap();
        assert_eq!(closed_last.lines(), ["id: a"]);
        assert_eq!(closed_last.body(), "");
        assert_eq!(split("---\n---\nrest").unwrap().body(), "rest");
        for open in [
            "No front matter",
            "---",
            "---\nid: a\n",
            " ---\nid: a\n---\n",
            "...\nid: a\n...\n",
            "----\nid: a\n---\n",
        ] {
            assert!(split(open).is_none(), "{open:?}");
        }
    }

    #[test]
    fn reads_keys_with_spaces_quotes_and_comments_the_same_way() {
        assert_eq!(key_of("id: a"), Some("id"));
        assert_eq!(key_of("id : a"), Some("id"));
        assert_eq!(key_of("id\t: a"), Some("id"));
        assert_eq!(key_of("\"id\": a"), Some("id"));
        assert_eq!(key_of("'id': a"), Some("id"));
        assert_eq!(key_of("id:"), Some("id"));
        for line in [
            "  id: a",
            "\tid: a",
            "- id: a",
            "# id: a",
            "id:a",
            ": a",
            "plain text",
        ] {
            assert_eq!(key_of(line), None, "{line:?}");
        }
        assert_eq!(value_of("id :  a b "), "a b");
        assert_eq!(
            read("---\nid : abc # old\n---\n", "id").as_deref(),
            Some("abc")
        );
        assert_eq!(
            read("---\nid: abc\t# old\n---\n", "id").as_deref(),
            Some("abc")
        );
        assert_eq!(read("---\nid: a#b\n---\n", "id").as_deref(), Some("a#b"));
        assert_eq!(read("---\nid: # none\n---\n", "id"), None);
        assert_eq!(
            read("---\nid: \"a # b\" # c\n---\n", "id").as_deref(),
            Some("a # b")
        );
        assert_eq!(
            read("---\nid: 'it''s' # c\n---\n", "id").as_deref(),
            Some("it's")
        );
        assert_eq!(read("---\nkind:note\n---\n", "kind"), None);
        assert_eq!(read("---\nidentity: a\n---\n", "id"), None);
    }

    #[test]
    fn the_last_entry_wins_and_empty_values_read_as_missing() {
        assert_eq!(scalar(&["id: a", "id: \"b\""], "id").as_deref(), Some("b"));
        assert_eq!(scalar(&["id: a", "id:   "], "id"), None);
        assert_eq!(scalar(&["id: a", "  id: b"], "id").as_deref(), Some("a"));
        assert_eq!(scalar(&[], "id"), None);
    }

    #[test]
    fn reads_quoted_scalars_like_yaml() {
        assert_eq!(scalar_value("\"a\\\"b\\u00e9\"").as_deref(), Some("a\"bé"));
        assert_eq!(scalar_value("'a''b'").as_deref(), Some("a'b"));
        assert_eq!(scalar_value("\"  padded  \"").as_deref(), Some("padded"));
        assert_eq!(scalar_value("\"\""), None);
        assert_eq!(scalar_value("''"), None);
        assert_eq!(scalar_value("\"unterminated"), None);
        assert_eq!(scalar_value("'unterminated"), None);
        assert_eq!(scalar_value("\"bad \\q escape\""), None);
        assert_eq!(scalar_value("\"ends with \\"), None);
        assert_eq!(
            scalar_value("Paper: draft").as_deref(),
            Some("Paper: draft")
        );
        assert_eq!(scalar_value("  note  ").as_deref(), Some("note"));
    }

    #[test]
    fn quoted_scalars_report_where_they_end() {
        assert_eq!(quoted_scalar("\"a, b\", c"), Some(("a, b".to_string(), 6)));
        assert_eq!(quoted_scalar("'it''s']"), Some(("it's".to_string(), 7)));
        assert_eq!(quoted_scalar("'é' x"), Some(("é".to_string(), 4)));
        assert_eq!(quoted_scalar("\"x\\\"y\" z"), Some(("x\"y".to_string(), 6)));
        assert_eq!(quoted_scalar("plain"), None);
        assert_eq!(quoted_scalar("'open"), None);
        assert_eq!(quoted_scalar("\"open"), None);
    }
}
