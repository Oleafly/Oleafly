//! Citation keys and BibTeX entry helpers shared by the app's research
//! tools, bibliography cleanup and `oleafly cite` (ports of
//! `src/lib/citation/bibtex.ts` and `dedup.ts`).
use std::collections::{BTreeMap, BTreeSet};

/// Key in the app's `firstauthorYEARfirstword` scheme.
pub fn cite_key(author: &str, year: &str, title: &str) -> String {
    const STOP: &[&str] = &[
        "the", "a", "an", "of", "on", "in", "for", "and", "to", "with", "using", "via", "from",
        "by",
    ];
    let ascii = |text: &str| -> String {
        text.chars()
            .filter(char::is_ascii_alphanumeric)
            .collect::<String>()
            .to_ascii_lowercase()
    };
    let first_author = author
        .split(" and ")
        .next()
        .unwrap_or_default()
        .split(',')
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();
    let family = if first_author.is_empty() {
        String::new()
    } else if first_author.contains(' ') {
        first_author
            .split_whitespace()
            .next_back()
            .unwrap_or_default()
            .to_string()
    } else {
        first_author
    };
    let word = title
        .split_whitespace()
        .map(|word| word.trim_matches(|character: char| !character.is_ascii_alphanumeric()))
        .map(str::to_ascii_lowercase)
        .find(|word| {
            word.chars()
                .all(|character| character.is_ascii_alphabetic())
                && word.len() > 2
                && !STOP.contains(&word.as_str())
        })
        .unwrap_or_default();
    let mut key = format!("{}{}{}", ascii(&family), year, word);
    if key.is_empty() {
        key = format!("ref{year}");
    }
    key
}

/// The first 4-digit year in a free-form or ISO date string.
pub fn year_of(date: &str) -> String {
    date.split(|character: char| !character.is_ascii_digit())
        .find(|token| token.len() == 4)
        .unwrap_or_default()
        .to_string()
}

/// One parsed entry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BibEntry {
    pub entry_type: String,
    pub key: String,
    pub fields: BTreeMap<String, String>,
}

/// `@type{key,` at the start of `text` (after spaces): type, key and where
/// the fields begin.
fn entry_head(text: &str) -> Option<(String, String, usize)> {
    let bytes = text.as_bytes();
    if bytes.first() != Some(&b'@') {
        return None;
    }
    let mut index = 1;
    while index < bytes.len() && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'_') {
        index += 1;
    }
    if index == 1 {
        return None;
    }
    let entry_type = text[1..index].to_ascii_lowercase();
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }
    if bytes.get(index) != Some(&b'{') {
        return None;
    }
    index += 1;
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }
    let key_start = index;
    while index < bytes.len()
        && !matches!(bytes[index], b',' | b'}')
        && !bytes[index].is_ascii_whitespace()
    {
        index += 1;
    }
    if index == key_start {
        return None;
    }
    let key = text[key_start..index].to_string();
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }
    if bytes.get(index) != Some(&b',') {
        return None;
    }
    Some((entry_type, key, index + 1))
}

/// A field value at `index` (braced, quoted or bare) and where it ends.
fn entry_value(body: &str, index: usize) -> (String, usize) {
    let bytes = body.as_bytes();
    match bytes.get(index) {
        Some(b'{') => {
            let mut depth = 0i32;
            let mut end = index;
            while end < bytes.len() {
                match bytes[end] {
                    b'{' => depth += 1,
                    b'}' => {
                        depth -= 1;
                        if depth == 0 {
                            end += 1;
                            break;
                        }
                    }
                    _ => {}
                }
                end += 1;
            }
            let inner_end = end.saturating_sub(1).max(index + 1);
            (
                body.get(index + 1..inner_end)
                    .unwrap_or_default()
                    .to_string(),
                end,
            )
        }
        Some(b'"') => {
            let end = body[index + 1..]
                .find('"')
                .map_or(body.len(), |offset| index + 1 + offset);
            (body[index + 1..end].to_string(), (end + 1).min(body.len()))
        }
        _ => {
            let end = body[index..]
                .find([',', '}', '\n'])
                .map_or(body.len(), |offset| index + offset);
            (body[index..end].to_string(), end)
        }
    }
}

/// `name =` at or after `from` (a name not preceded by a letter).
fn next_field_name(body: &str, from: usize) -> Option<(String, usize)> {
    let bytes = body.as_bytes();
    let mut index = from;
    while index < bytes.len() {
        if bytes[index].is_ascii_alphabetic()
            && (index == 0 || !bytes[index - 1].is_ascii_alphabetic())
        {
            let start = index;
            while index < bytes.len() && bytes[index].is_ascii_alphabetic() {
                index += 1;
            }
            let name_end = index;
            while index < bytes.len() && bytes[index].is_ascii_whitespace() {
                index += 1;
            }
            if bytes.get(index) == Some(&b'=') {
                index += 1;
                while index < bytes.len() && bytes[index].is_ascii_whitespace() {
                    index += 1;
                }
                return Some((body[start..name_end].to_ascii_lowercase(), index));
            }
            continue;
        }
        index += 1;
    }
    None
}

/// Parses one entry, tolerating nested braces and quoted or bare values.
pub fn parse_entry(text: &str) -> Option<BibEntry> {
    let text = text.trim();
    let (entry_type, key, start) = entry_head(text)?;
    let body = &text[start..];
    let mut fields = BTreeMap::new();
    let mut index = 0;
    while index < body.len() {
        let Some((name, value_start)) = next_field_name(body, index) else {
            break;
        };
        let (value, next) = entry_value(body, value_start);
        fields.insert(name, value.trim().to_string());
        match body[next.min(body.len())..].find(',') {
            Some(offset) => index = next + offset + 1,
            None => break,
        }
    }
    Some(BibEntry {
        entry_type,
        key,
        fields,
    })
}

/// The entries of a `.bib` file, split at each `@type{`.
fn chunks(content: &str) -> Vec<&str> {
    let mut starts: Vec<usize> = Vec::new();
    let bytes = content.as_bytes();
    for (index, byte) in bytes.iter().enumerate() {
        if *byte != b'@' {
            continue;
        }
        let mut cursor = index + 1;
        while cursor < bytes.len()
            && (bytes[cursor].is_ascii_alphanumeric() || bytes[cursor] == b'_')
        {
            cursor += 1;
        }
        if cursor == index + 1 {
            continue;
        }
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if bytes.get(cursor) == Some(&b'{') {
            starts.push(index);
        }
    }
    let mut out = Vec::new();
    for (position, start) in starts.iter().enumerate() {
        let end = starts.get(position + 1).copied().unwrap_or(content.len());
        out.push(&content[*start..end]);
    }
    out
}

/// Every entry in a `.bib` file (not `@string`, `@preamble` or `@comment`).
pub fn parse_entries(content: &str) -> Vec<BibEntry> {
    chunks(content)
        .into_iter()
        .filter_map(parse_entry)
        .filter(|entry| !matches!(entry.entry_type.as_str(), "string" | "preamble" | "comment"))
        .collect()
}

/// Every entry key in a `.bib` file.
pub fn entry_keys(content: &str) -> BTreeSet<String> {
    chunks(content)
        .into_iter()
        .filter_map(|chunk| entry_head(chunk.trim()).map(|(_, key, _)| key))
        .collect()
}

/// The key of the entry with this DOI (compared trimmed, case-insensitive).
pub fn find_key_by_doi(content: &str, doi: &str) -> Option<String> {
    let wanted = doi.trim().to_lowercase();
    if wanted.is_empty() {
        return None;
    }
    chunks(content)
        .into_iter()
        .filter_map(parse_entry)
        .find(|entry| {
            entry
                .fields
                .get("doi")
                .is_some_and(|value| value.trim().to_lowercase() == wanted)
        })
        .map(|entry| entry.key)
}

/// The entry with its key replaced.
pub fn set_key(bibtex: &str, key: &str) -> String {
    let leading = bibtex.len() - bibtex.trim_start().len();
    let text = &bibtex[leading..];
    let bytes = text.as_bytes();
    if bytes.first() != Some(&b'@') {
        return bibtex.to_string();
    }
    let mut index = 1;
    while index < bytes.len() && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'_') {
        index += 1;
    }
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }
    if bytes.get(index) != Some(&b'{') {
        return bibtex.to_string();
    }
    index += 1;
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }
    let key_start = index;
    while index < bytes.len()
        && !matches!(bytes[index], b',' | b'}')
        && !bytes[index].is_ascii_whitespace()
    {
        index += 1;
    }
    format!(
        "{}{}{}{}",
        &bibtex[..leading],
        &text[..key_start],
        key,
        &text[index..]
    )
}

/// a, b, ..., z, aa, ab, ... (bijective base 26).
fn collision_suffix(n: usize) -> String {
    let mut suffix = String::new();
    let mut index = n as i64;
    loop {
        suffix.insert(0, char::from(b'a' + (index % 26) as u8));
        index = index / 26 - 1;
        if index < 0 {
            break;
        }
    }
    suffix
}

/// `base`, or `base` plus the first free suffix.
pub fn unique_key(base: &str, existing: &BTreeSet<String>) -> String {
    let mut key = base.to_string();
    let mut n = 0;
    while existing.contains(&key) {
        key = format!("{base}{}", collision_suffix(n));
        n += 1;
    }
    key
}

/// The file with the entries appended after one blank line.
pub fn append_entries(content: &str, blocks: &[String]) -> String {
    let body = blocks.join("\n\n");
    if content.trim().is_empty() {
        format!("{body}\n")
    } else {
        format!("{}\n\n{body}\n", content.trim_end())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AddOutcome {
    Added { key: String },
    AlreadyPresent { key: String },
}

/// Adds an entry the way the app does: an entry whose DOI is already there
/// is not added again; a new one gets the app's key (made unique).
pub fn add_entry(content: &str, bibtex: &str) -> Option<(String, AddOutcome)> {
    let entry = parse_entry(bibtex)?;
    if let Some(doi) = entry.fields.get("doi") {
        if let Some(key) = find_key_by_doi(content, doi) {
            return Some((content.to_string(), AddOutcome::AlreadyPresent { key }));
        }
    }
    let field = |name: &str| {
        entry
            .fields
            .get(name)
            .map(String::as_str)
            .unwrap_or_default()
    };
    let base = cite_key(field("author"), &year_of(field("year")), field("title"));
    let key = unique_key(&base, &entry_keys(content));
    let rekeyed = set_key(bibtex.trim(), &key);
    Some((
        append_entries(content, &[rekeyed]),
        AddOutcome::Added { key },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_entry_is_parsed_but_strings_and_comments() {
        let content = "@string{acm = {ACM}}\n@article{a, title = {One}, doi = {10.1/x}}\n@comment{note}\n@book{b,\n  title = \"Two\"\n}\n";
        let entries = parse_entries(content);
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.key.as_str())
                .collect::<Vec<_>>(),
            ["a", "b"]
        );
        assert_eq!(
            entries[0].fields.get("doi").map(String::as_str),
            Some("10.1/x")
        );
        assert_eq!(
            entries[1].fields.get("title").map(String::as_str),
            Some("Two")
        );
    }

    #[test]
    fn cite_keys_match_the_app_scheme() {
        assert_eq!(
            cite_key(
                "Vaswani, A. and Shazeer, N.",
                "2017",
                "Attention Is All You Need"
            ),
            "vaswani2017attention"
        );
        assert_eq!(cite_key("", "2020", "A Study"), "2020study");
        assert_eq!(cite_key("Jane Doe", "2021", "The of and"), "doe2021");
        assert_eq!(cite_key("", "", ""), "ref");
        assert_eq!(year_of("2019-04-01"), "2019");
        assert_eq!(year_of("spring 18"), "");
    }

    #[test]
    fn entries_parse_braced_quoted_and_bare_values() {
        let entry = parse_entry(
            "@Article{k1,\n  title = {A {Nested} Title},\n  year = 2020,\n  note = \"quoted\"\n}",
        )
        .unwrap();
        assert_eq!(
            (entry.entry_type.as_str(), entry.key.as_str()),
            ("article", "k1")
        );
        assert_eq!(entry.fields["title"], "A {Nested} Title");
        assert_eq!(entry.fields["year"], "2020");
        assert_eq!(entry.fields["note"], "quoted");
        assert!(parse_entry("not bibtex").is_none());
    }

    #[test]
    fn adding_reuses_a_doi_and_rekeys_new_entries() {
        let content = "@article{knuth1984literate,\n  doi = {10.1093/comjnl/27.2.97}\n}\n";
        let (unchanged, outcome) =
            add_entry(content, "@article{x, doi = {10.1093/COMJNL/27.2.97}}").unwrap();
        assert_eq!(
            outcome,
            AddOutcome::AlreadyPresent {
                key: "knuth1984literate".into()
            }
        );
        assert_eq!(unchanged, content);
        let vaswani = "@article{Vaswani_2017, author = {Vaswani, Ashish and Shazeer, Noam}, year = {2017}, title = {Attention Is All You Need}}";
        let (added, outcome) = add_entry(content, vaswani).unwrap();
        assert_eq!(
            outcome,
            AddOutcome::Added {
                key: "vaswani2017attention".into()
            }
        );
        assert!(added.contains("\n\n@article{vaswani2017attention, author"));
        assert!(!added.contains("\n\n\n"));
        assert!(added.ends_with("}\n"));
        let (_, again) = add_entry(&added, vaswani).unwrap();
        assert_eq!(
            again,
            AddOutcome::Added {
                key: "vaswani2017attentiona".into()
            }
        );
        let (fresh, _) = add_entry("", vaswani).unwrap();
        assert!(fresh.starts_with("@article{vaswani2017attention,") && fresh.ends_with("}\n"));
        assert!(add_entry(content, "not bibtex").is_none());
    }

    #[test]
    fn unique_keys_use_a_bijective_base_26_suffix() {
        let mut existing: BTreeSet<String> = BTreeSet::from(["k".to_string()]);
        for letter in b'a'..=b'z' {
            existing.insert(format!("k{}", letter as char));
        }
        assert_eq!(unique_key("k", &existing), "kaa");
        assert_eq!(unique_key("new", &existing), "new");
    }
}
