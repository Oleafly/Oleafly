use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

pub const USER_LIBRARY: &str = "user";
const MAX_ALIASES: usize = 8;

const EXPORT_FIELDS: &[&str] = &[
    "publicationTitle",
    "proceedingsTitle",
    "bookTitle",
    "conferenceName",
    "volume",
    "issue",
    "pages",
    "publisher",
    "place",
    "ISBN",
    "ISSN",
    "url",
    "edition",
    "series",
    "seriesNumber",
    "university",
    "institution",
    "reportNumber",
    "reportType",
    "thesisType",
    "repository",
    "archiveID",
    "websiteTitle",
    "language",
    "number",
];

const SKIPPED_TYPES: &[&str] = &["note", "attachment", "annotation"];

const STOP_WORDS: &[&str] = &[
    "the", "a", "an", "of", "on", "in", "for", "and", "to", "with", "using", "via", "from", "by",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum KeySource {
    Bbt,
    Native,
    Extra,
    #[default]
    Generated,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Creator {
    pub family: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub given: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub role: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub library: String,
    pub key: String,
    pub version: u64,
    #[serde(default)]
    pub date_added: String,
    #[serde(default)]
    pub date_modified: String,
    pub item_type: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub creators: Vec<Creator>,
    #[serde(default)]
    pub date: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doi: Option<String>,
    #[serde(default)]
    pub citation_key: String,
    #[serde(default)]
    pub key_source: KeySource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bbt_key: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub fields: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Parsed {
    Item(Box<Item>),
    Skipped(String),
    Trashed(String),
}

pub fn group_library(group_id: u64) -> String {
    format!("group:{group_id}")
}

pub fn group_id(library: &str) -> Option<u64> {
    library.strip_prefix("group:")?.parse().ok()
}

fn text(value: &Value, name: &str) -> String {
    value
        .get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string()
}

fn non_empty(text: String) -> Option<String> {
    (!text.is_empty()).then_some(text)
}

pub fn normalize_doi(raw: &str) -> Option<String> {
    let lowered = raw.trim().to_lowercase();
    let stripped = [
        "https://doi.org/",
        "http://doi.org/",
        "https://dx.doi.org/",
        "http://dx.doi.org/",
        "doi:",
    ]
    .iter()
    .find_map(|prefix| lowered.strip_prefix(prefix))
    .unwrap_or(&lowered)
    .trim();
    stripped.starts_with("10.").then(|| stripped.to_string())
}

fn extra_line<'a>(extra: &'a str, label: &str) -> Option<&'a str> {
    extra.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.trim()
            .eq_ignore_ascii_case(label)
            .then(|| value.trim())
            .filter(|value| !value.is_empty())
    })
}

pub fn extra_citation_key(extra: &str) -> Option<String> {
    extra_line(extra, "citation key")
        .and_then(|value| value.split_whitespace().next())
        .map(str::to_string)
}

pub fn parse_year(date: &str, parsed_date: &str) -> Option<String> {
    let find = |text: &str| {
        let bytes = text.as_bytes();
        (0..bytes.len().saturating_sub(3)).find_map(|start| {
            let window = &bytes[start..start + 4];
            let before = start.checked_sub(1).map(|index| bytes[index]);
            let after = bytes.get(start + 4).copied();
            (window.iter().all(u8::is_ascii_digit)
                && !before.is_some_and(|byte| byte.is_ascii_digit())
                && !after.is_some_and(|byte| byte.is_ascii_digit()))
            .then(|| text[start..start + 4].to_string())
        })
    };
    find(parsed_date).or_else(|| find(date))
}

fn parse_creators(data: &Value) -> Vec<Creator> {
    data.get("creators")
        .and_then(Value::as_array)
        .map(|creators| {
            creators
                .iter()
                .filter_map(|creator| {
                    let role = text(creator, "creatorType");
                    let role = if role == "author" {
                        String::new()
                    } else {
                        role
                    };
                    let name = text(creator, "name");
                    let last = text(creator, "lastName");
                    let first = text(creator, "firstName");
                    let (family, given) = match (name.is_empty(), last.is_empty()) {
                        (false, _) => (name, String::new()),
                        (true, false) => (last, first),
                        (true, true) => (first, String::new()),
                    };
                    (!family.is_empty()).then_some(Creator {
                        family,
                        given,
                        role,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn parse_item(library: &str, value: &Value) -> Option<Parsed> {
    let data = value.get("data").unwrap_or(value);
    let key = non_empty(text(value, "key")).or_else(|| non_empty(text(data, "key")))?;
    let item_type = text(data, "itemType");
    if item_type.is_empty() || SKIPPED_TYPES.contains(&item_type.as_str()) {
        return Some(Parsed::Skipped(key));
    }
    let deleted = data
        .get("deleted")
        .is_some_and(|flag| flag.as_bool() == Some(true) || flag.as_u64() == Some(1));
    if deleted {
        return Some(Parsed::Trashed(key));
    }
    let version = value
        .get("version")
        .or_else(|| data.get("version"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let extra = text(data, "extra");
    let date = text(data, "date");
    let parsed_date = value
        .pointer("/meta/parsedDate")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let doi = normalize_doi(&text(data, "DOI"))
        .or_else(|| extra_line(&extra, "doi").and_then(normalize_doi));
    let fields = EXPORT_FIELDS
        .iter()
        .filter_map(|name| non_empty(text(data, name)).map(|value| (name.to_string(), value)))
        .collect();
    Some(Parsed::Item(Box::new(Item {
        library: library.to_string(),
        key,
        version,
        date_added: text(data, "dateAdded"),
        date_modified: text(data, "dateModified"),
        title: text(data, "title"),
        creators: parse_creators(data),
        year: parse_year(&date, parsed_date),
        date,
        doi,
        citation_key: String::new(),
        key_source: KeySource::Generated,
        native_key: non_empty(text(data, "citationKey")),
        extra_key: extra_citation_key(&extra),
        bbt_key: None,
        aliases: Vec::new(),
        fields,
        item_type,
    })))
}

pub fn fold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for character in text.nfkd() {
        if is_combining_mark(character) {
            continue;
        }
        match character {
            'ß' => out.push_str("ss"),
            'æ' | 'Æ' => out.push_str("ae"),
            'œ' | 'Œ' => out.push_str("oe"),
            'ø' | 'Ø' => out.push('o'),
            'đ' | 'Đ' => out.push('d'),
            'ł' | 'Ł' => out.push('l'),
            'þ' | 'Þ' => out.push_str("th"),
            'ı' => out.push('i'),
            other => out.extend(other.to_lowercase()),
        }
    }
    out
}

fn key_letters(text: &str) -> String {
    fold(text)
        .chars()
        .filter(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
        .collect()
}

fn first_title_word(title: &str) -> String {
    title
        .split(|character: char| character.is_whitespace())
        .map(|word| {
            key_letters(word)
                .chars()
                .filter(|character| !character.is_ascii_digit())
                .collect::<String>()
        })
        .find(|word| word.len() > 2 && !STOP_WORDS.contains(&word.as_str()))
        .unwrap_or_default()
}

pub fn first_author(item: &Item) -> Option<&Creator> {
    item.creators
        .iter()
        .find(|creator| creator.role.is_empty())
        .or_else(|| item.creators.first())
}

pub fn generated_base_key(item: &Item) -> String {
    let family = first_author(item)
        .map(|creator| key_letters(&creator.family))
        .unwrap_or_default();
    let year = item.year.clone().unwrap_or_default();
    let word = first_title_word(&item.title);
    if family.is_empty() && word.is_empty() {
        format!("ref{year}")
    } else {
        format!("{family}{year}{word}")
    }
}

pub fn collision_suffix(index: usize) -> String {
    let mut suffix = Vec::new();
    let mut value = index as i64;
    loop {
        suffix.push((b'a' + (value % 26) as u8) as char);
        value = value / 26 - 1;
        if value < 0 {
            break;
        }
    }
    suffix.iter().rev().collect()
}

fn preferred_key(item: &Item) -> Option<(String, KeySource)> {
    item.bbt_key
        .clone()
        .map(|key| (key, KeySource::Bbt))
        .or_else(|| item.native_key.clone().map(|key| (key, KeySource::Native)))
        .or_else(|| item.extra_key.clone().map(|key| (key, KeySource::Extra)))
}

fn remember_alias(item: &mut Item, previous: &str) {
    if previous.is_empty() || previous == item.citation_key {
        return;
    }
    item.aliases
        .retain(|alias| alias != previous && alias != &item.citation_key);
    item.aliases.insert(0, previous.to_string());
    item.aliases.truncate(MAX_ALIASES);
}

pub fn resolve_keys<'a>(items: impl IntoIterator<Item = &'a mut Item>) {
    let mut items: Vec<&mut Item> = items.into_iter().collect();
    let taken: HashSet<String> = items
        .iter()
        .filter_map(|item| preferred_key(item).map(|(key, _)| key))
        .collect();
    let mut generated: Vec<usize> = Vec::new();
    for (index, item) in items.iter_mut().enumerate() {
        let previous = std::mem::take(&mut item.citation_key);
        let previous_source = item.key_source;
        match preferred_key(item) {
            Some((key, source)) => {
                item.citation_key = key;
                item.key_source = source;
                if previous_source != KeySource::Generated {
                    remember_alias(item, &previous);
                }
            }
            None => {
                item.citation_key = previous;
                item.key_source = KeySource::Generated;
                generated.push(index);
            }
        }
    }
    generated.sort_by(|left, right| {
        let left = &items[*left];
        let right = &items[*right];
        (
            left.date_added.as_str(),
            left.library.as_str(),
            left.key.as_str(),
        )
            .cmp(&(
                right.date_added.as_str(),
                right.library.as_str(),
                right.key.as_str(),
            ))
    });
    let mut used = taken;
    let mut counters: HashMap<String, usize> = HashMap::new();
    for index in generated {
        let base = generated_base_key(items[index]);
        let mut key = base.clone();
        let counter = counters.entry(base.clone()).or_insert(0);
        while used.contains(&key) {
            key = format!("{base}{}", collision_suffix(*counter));
            *counter += 1;
        }
        used.insert(key.clone());
        let item = &mut items[index];
        item.citation_key = key;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn item_json(key: &str, data: Value) -> Value {
        let mut data = data;
        data["key"] = json!(key);
        json!({ "key": key, "version": 7, "meta": { "parsedDate": "2020-03-15" }, "data": data })
    }

    fn parsed(value: Value) -> Item {
        match parse_item(USER_LIBRARY, &value).unwrap() {
            Parsed::Item(item) => *item,
            other => panic!("expected an item, got {other:?}"),
        }
    }

    #[test]
    fn parses_a_journal_article() {
        let item = parsed(item_json(
            "ABCD2345",
            json!({
                "itemType": "journalArticle",
                "title": " Deep Learning ",
                "creators": [
                    { "creatorType": "author", "firstName": "Anna", "lastName": "Müller" },
                    { "creatorType": "author", "name": "张伟" },
                    { "creatorType": "editor", "firstName": "Ed", "lastName": "Itor" }
                ],
                "date": "March 2020",
                "DOI": "https://doi.org/10.1234/ABC",
                "publicationTitle": "Journal",
                "pages": "45-67",
                "abstractNote": "dropped",
                "extra": "PMID: 1\nCitation Key: muller2020deep",
                "citationKey": "",
                "dateAdded": "2020-01-01T00:00:00Z",
                "dateModified": "2021-01-01T00:00:00Z"
            }),
        ));
        assert_eq!(item.key, "ABCD2345");
        assert_eq!(item.version, 7);
        assert_eq!(item.title, "Deep Learning");
        assert_eq!(item.year.as_deref(), Some("2020"));
        assert_eq!(item.doi.as_deref(), Some("10.1234/abc"));
        assert_eq!(item.extra_key.as_deref(), Some("muller2020deep"));
        assert_eq!(item.native_key, None);
        assert_eq!(item.creators.len(), 3);
        assert_eq!(item.creators[0].family, "Müller");
        assert_eq!(item.creators[0].given, "Anna");
        assert_eq!(item.creators[1].family, "张伟");
        assert_eq!(item.creators[1].given, "");
        assert_eq!(item.creators[2].role, "editor");
        assert_eq!(item.fields.get("pages").map(String::as_str), Some("45-67"));
        assert!(!item.fields.contains_key("abstractNote"));
        assert_eq!(item.date_modified, "2021-01-01T00:00:00Z");
    }

    #[test]
    fn skips_notes_attachments_and_trash() {
        let note = parse_item(
            USER_LIBRARY,
            &item_json("NOTE2345", json!({ "itemType": "note" })),
        );
        assert_eq!(note, Some(Parsed::Skipped("NOTE2345".to_string())));
        let trashed = parse_item(
            USER_LIBRARY,
            &item_json("TRSH2345", json!({ "itemType": "book", "deleted": 1 })),
        );
        assert_eq!(trashed, Some(Parsed::Trashed("TRSH2345".to_string())));
        assert_eq!(parse_item(USER_LIBRARY, &json!({ "data": {} })), None);
    }

    #[test]
    fn reads_doi_from_extra_and_years_without_parsed_date() {
        let item = parsed(json!({
            "key": "BOOK2345",
            "data": { "itemType": "book", "title": "T", "date": "c. 1999", "extra": "DOI: 10.5555/X\nother: 1" }
        }));
        assert_eq!(item.doi.as_deref(), Some("10.5555/x"));
        assert_eq!(item.year.as_deref(), Some("1999"));
        assert_eq!(parse_year("12345", ""), None);
        assert_eq!(parse_year("", ""), None);
        assert_eq!(normalize_doi("not a doi"), None);
    }

    #[test]
    fn folds_diacritics_and_special_letters() {
        assert_eq!(fold("Müller Ångström Núñez"), "muller angstrom nunez");
        assert_eq!(
            fold("Łukasiewicz Søren Straße Æsir"),
            "lukasiewicz soren strasse aesir"
        );
        assert_eq!(fold("王小明"), "王小明");
        assert_eq!(fold("ИВАНОВ"), "иванов");
    }

    #[test]
    fn generates_keys_like_the_project_does() {
        let mut item = parsed(item_json(
            "GEN23456",
            json!({
                "itemType": "journalArticle",
                "title": "The Art of Computer Programming",
                "creators": [{ "creatorType": "author", "firstName": "Donald", "lastName": "Knüth" }],
                "date": "2020"
            }),
        ));
        assert_eq!(generated_base_key(&item), "knuth2020art");
        item.creators.clear();
        assert_eq!(generated_base_key(&item), "2020art");
        item.title = String::new();
        assert_eq!(generated_base_key(&item), "ref2020");
        item.creators = vec![Creator {
            family: "王".into(),
            ..Creator::default()
        }];
        item.title = "深度学习".into();
        assert_eq!(generated_base_key(&item), "ref2020");
        assert_eq!(collision_suffix(0), "a");
        assert_eq!(collision_suffix(25), "z");
        assert_eq!(collision_suffix(26), "aa");
    }

    fn keyed(key: &str, bbt: Option<&str>, native: Option<&str>, extra: Option<&str>) -> Item {
        Item {
            library: USER_LIBRARY.into(),
            key: key.into(),
            item_type: "book".into(),
            title: "Graph Theory".into(),
            year: Some("2001".into()),
            creators: vec![Creator {
                family: "Diestel".into(),
                ..Creator::default()
            }],
            bbt_key: bbt.map(str::to_string),
            native_key: native.map(str::to_string),
            extra_key: extra.map(str::to_string),
            date_added: key.into(),
            ..Item::default()
        }
    }

    #[test]
    fn resolves_keys_in_order_bbt_native_extra_generated() {
        let mut items = [
            keyed(
                "A2345678",
                Some("bbtKey"),
                Some("nativeKey"),
                Some("extraKey"),
            ),
            keyed("B2345678", None, Some("nativeKey2"), Some("extraKey2")),
            keyed("C2345678", None, None, Some("extraKey3")),
            keyed("D2345678", None, None, None),
        ];
        resolve_keys(items.iter_mut());
        let keys: Vec<_> = items
            .iter()
            .map(|item| (item.citation_key.as_str(), item.key_source))
            .collect();
        assert_eq!(
            keys,
            vec![
                ("bbtKey", KeySource::Bbt),
                ("nativeKey2", KeySource::Native),
                ("extraKey3", KeySource::Extra),
                ("diestel2001graph", KeySource::Generated),
            ]
        );
    }

    #[test]
    fn generated_keys_never_collide_with_real_or_generated_keys() {
        let mut items = [
            keyed("A2345678", Some("diestel2001graph"), None, None),
            keyed("B2345678", None, None, None),
            keyed("C2345678", None, None, None),
        ];
        resolve_keys(items.iter_mut());
        assert_eq!(items[0].citation_key, "diestel2001graph");
        assert_eq!(items[1].citation_key, "diestel2001grapha");
        assert_eq!(items[2].citation_key, "diestel2001graphb");
        resolve_keys(items.iter_mut());
        assert_eq!(items[1].citation_key, "diestel2001grapha");
        assert_eq!(items[2].citation_key, "diestel2001graphb");
    }

    #[test]
    fn remembers_former_keys_when_better_bibtex_changes_one() {
        let mut items = [keyed("A2345678", Some("oldKey"), None, None)];
        resolve_keys(items.iter_mut());
        items[0].bbt_key = Some("newKey".into());
        resolve_keys(items.iter_mut());
        assert_eq!(items[0].citation_key, "newKey");
        assert_eq!(items[0].aliases, vec!["oldKey".to_string()]);
        items[0].bbt_key = Some("oldKey".into());
        resolve_keys(items.iter_mut());
        assert_eq!(items[0].citation_key, "oldKey");
        assert_eq!(items[0].aliases, vec!["newKey".to_string()]);
    }

    #[test]
    fn identifies_group_libraries() {
        assert_eq!(group_library(2000001), "group:2000001");
        assert_eq!(group_id("group:2000001"), Some(2000001));
        assert_eq!(group_id(USER_LIBRARY), None);
    }
}
