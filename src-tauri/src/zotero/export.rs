use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::http::{Http, Side};
use super::item::{parse_item, Creator, Item, KeySource, Parsed, USER_LIBRARY};
use super::sync::{library_path, probe_local, LocalState, SyncOptions, ZoteroLibrary};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Style {
    Biblatex,
    Bibtex,
}

impl Style {
    fn format(self) -> &'static str {
        match self {
            Self::Biblatex => "biblatex",
            Self::Bibtex => "bibtex",
        }
    }

    fn translator(self) -> &'static str {
        match self {
            Self::Biblatex => "Better BibLaTeX",
            Self::Bibtex => "Better BibTeX",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemRef {
    pub library: String,
    pub item_key: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Origin {
    BetterBibtex,
    Zotero,
    Cache,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedEntry {
    pub library: String,
    pub item_key: String,
    pub citation_key: String,
    pub key_source: KeySource,
    pub entry: String,
    pub origin: Origin,
    pub date_modified: String,
    pub version: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doi: Option<String>,
}

fn is_key_char(character: char) -> bool {
    !character.is_whitespace() && character != ',' && character != '{' && character != '}'
}

pub fn entry_heads(text: &str) -> Vec<(usize, String)> {
    let mut heads = Vec::new();
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix('@') {
            let kind: String = rest
                .chars()
                .take_while(|character| character.is_ascii_alphabetic())
                .collect();
            let after = rest[kind.len()..].trim_start();
            if !kind.is_empty()
                && !matches!(
                    kind.to_ascii_lowercase().as_str(),
                    "comment" | "string" | "preamble"
                )
            {
                if let Some(body) = after.strip_prefix('{').or_else(|| after.strip_prefix('(')) {
                    let key: String = body
                        .trim_start()
                        .chars()
                        .take_while(|character| is_key_char(*character))
                        .collect();
                    if !key.is_empty() {
                        heads.push((offset + line.len() - trimmed.len(), key));
                    }
                }
            }
        }
        offset += line.len();
    }
    heads
}

pub fn split_entries(text: &str) -> HashMap<String, String> {
    let heads = entry_heads(text);
    let mut entries = HashMap::new();
    for (index, (start, key)) in heads.iter().enumerate() {
        let end = heads
            .get(index + 1)
            .map(|(next, _)| *next)
            .unwrap_or(text.len());
        entries
            .entry(key.clone())
            .or_insert_with(|| text[*start..end].trim().to_string());
    }
    entries
}

pub fn with_key(entry: &str, key: &str) -> String {
    let trimmed = entry.trim();
    let Some(open) = trimmed.find(['{', '(']) else {
        return trimmed.to_string();
    };
    let rest = &trimmed[open + 1..];
    let leading = rest.len() - rest.trim_start().len();
    let old_length: usize = rest
        .trim_start()
        .chars()
        .take_while(|character| is_key_char(*character))
        .map(char::len_utf8)
        .sum();
    format!(
        "{}{}{}",
        &trimmed[..open + 1 + leading],
        key,
        &trimmed[open + 1 + leading + old_length..]
    )
}

fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' | '%' | '$' | '#' | '_' => {
                out.push('\\');
                out.push(character);
            }
            '~' => out.push_str("\\textasciitilde{}"),
            '^' => out.push_str("\\textasciicircum{}"),
            '\\' => out.push_str("\\textbackslash{}"),
            other => out.push(other),
        }
    }
    let mut depth = 0i32;
    for character in out.chars() {
        match character {
            '{' => depth += 1,
            '}' => depth -= 1,
            _ => {}
        }
        if depth < 0 {
            return out.replace(['{', '}'], "");
        }
    }
    if depth != 0 {
        return out.replace(['{', '}'], "");
    }
    out
}

fn names(creators: &[&Creator]) -> String {
    creators
        .iter()
        .map(|creator| {
            if creator.given.is_empty() {
                format!("{{{}}}", escape(&creator.family))
            } else {
                format!("{}, {}", escape(&creator.family), escape(&creator.given))
            }
        })
        .collect::<Vec<_>>()
        .join(" and ")
}

fn entry_type(item: &Item, style: Style) -> &'static str {
    let thesis = item
        .fields
        .get("thesisType")
        .map(|kind| kind.to_lowercase())
        .unwrap_or_default();
    match (item.item_type.as_str(), style) {
        ("journalArticle" | "magazineArticle" | "newspaperArticle", _) => "article",
        ("book", _) => "book",
        ("bookSection", _) => "incollection",
        ("conferencePaper", _) => "inproceedings",
        ("thesis", Style::Biblatex) => "thesis",
        ("thesis", Style::Bibtex) if thesis.contains("master") => "mastersthesis",
        ("thesis", Style::Bibtex) => "phdthesis",
        ("report", Style::Biblatex) => "report",
        ("report", Style::Bibtex) => "techreport",
        ("webpage" | "blogPost" | "forumPost", Style::Biblatex) => "online",
        ("preprint", Style::Biblatex) => "online",
        ("manuscript", _) => "unpublished",
        ("patent", Style::Biblatex) => "patent",
        _ => "misc",
    }
}

fn iso_date(date: &str) -> Option<&str> {
    let bytes = date.as_bytes();
    let digits = |range: std::ops::Range<usize>| {
        bytes
            .get(range)
            .is_some_and(|part| part.iter().all(u8::is_ascii_digit))
    };
    let shape = match date.len() {
        4 => digits(0..4),
        7 => digits(0..4) && bytes[4] == b'-' && digits(5..7),
        10 => digits(0..4) && bytes[4] == b'-' && digits(5..7) && bytes[7] == b'-' && digits(8..10),
        _ => false,
    };
    shape.then_some(date)
}

pub fn entry_from_item(item: &Item, key: &str, style: Style) -> String {
    let mut fields: Vec<(&str, String)> = Vec::new();
    let field = |name: &str| item.fields.get(name).map(|value| escape(value));
    if !item.title.is_empty() {
        fields.push(("title", escape(&item.title)));
    }
    let authors: Vec<&Creator> = item
        .creators
        .iter()
        .filter(|creator| creator.role.is_empty())
        .collect();
    let editors: Vec<&Creator> = item
        .creators
        .iter()
        .filter(|creator| creator.role == "editor")
        .collect();
    if !authors.is_empty() {
        fields.push(("author", names(&authors)));
    }
    if !editors.is_empty() {
        fields.push(("editor", names(&editors)));
    }
    match style {
        Style::Biblatex => {
            if let Some(date) = iso_date(item.date.trim())
                .map(str::to_string)
                .or_else(|| item.year.clone())
            {
                fields.push(("date", date));
            }
        }
        Style::Bibtex => {
            if let Some(year) = &item.year {
                fields.push(("year", year.clone()));
            }
        }
    }
    let container = match style {
        Style::Biblatex => "journaltitle",
        Style::Bibtex => "journal",
    };
    let mappings: [(&str, &str); 13] = [
        ("publicationTitle", container),
        ("bookTitle", "booktitle"),
        ("proceedingsTitle", "booktitle"),
        ("volume", "volume"),
        ("issue", "number"),
        ("number", "number"),
        ("edition", "edition"),
        ("series", "series"),
        ("publisher", "publisher"),
        ("ISBN", "isbn"),
        ("ISSN", "issn"),
        ("reportNumber", "number"),
        (
            "websiteTitle",
            if style == Style::Biblatex {
                "maintitle"
            } else {
                "howpublished"
            },
        ),
    ];
    let mut used: Vec<&str> = Vec::new();
    for (source, target) in mappings {
        if used.contains(&target) {
            continue;
        }
        if let Some(value) = field(source) {
            used.push(target);
            fields.push((target, value));
        }
    }
    if let Some(pages) = field("pages") {
        fields.push(("pages", pages.replace('-', "--").replace("----", "--")));
    }
    if let Some(place) = field("place") {
        fields.push((
            if style == Style::Biblatex {
                "location"
            } else {
                "address"
            },
            place,
        ));
    }
    if let Some(conference) = field("conferenceName").filter(|_| style == Style::Biblatex) {
        fields.push(("eventtitle", conference));
    }
    if let Some(school) = field("university").or_else(|| field("institution")) {
        let name = match (style, item.item_type.as_str()) {
            (Style::Bibtex, "thesis") => "school",
            _ => "institution",
        };
        fields.push((name, school));
    }
    if let Some(kind) = field("thesisType").or_else(|| field("reportType")) {
        fields.push(("type", kind));
    }
    if let Some(repository) = field("repository").filter(|_| item.item_type == "preprint") {
        let name = if style == Style::Biblatex {
            "eprinttype"
        } else {
            "howpublished"
        };
        fields.push((name, repository));
        if let Some(id) = field("archiveID").filter(|_| style == Style::Biblatex) {
            fields.push(("eprint", id));
        }
    }
    if let Some(doi) = &item.doi {
        fields.push(("doi", doi.clone()));
    }
    if let Some(url) = item.fields.get("url") {
        fields.push(("url", url.clone()));
    }
    let body = fields
        .iter()
        .map(|(name, value)| format!("  {name} = {{{value}}}"))
        .collect::<Vec<_>>()
        .join(",\n");
    format!("@{}{{{key},\n{body}\n}}", entry_type(item, style))
}

fn is_file_field(line: &str) -> bool {
    let trimmed = line.trim_start();
    let name = trimmed
        .chars()
        .take_while(char::is_ascii_alphabetic)
        .count();
    trimmed[..name].eq_ignore_ascii_case("file") && trimmed[name..].trim_start().starts_with('=')
}

fn skip_blanks(text: &str, from: usize) -> usize {
    let rest = &text[from..];
    from + rest.len() - rest.trim_start_matches([' ', '\t']).len()
}

fn file_field_end(entry: &str, start: usize) -> Option<usize> {
    let value = skip_blanks(entry, start + entry[start..].find('=')? + 1);
    if !entry[value..].starts_with('{') {
        return None;
    }
    let mut depth = 0usize;
    let mut end = None;
    for (offset, character) in entry[value..].char_indices() {
        match character {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    end = Some(value + offset + 1);
                    break;
                }
            }
            _ => {}
        }
    }
    let mut end = skip_blanks(entry, end?);
    if entry[end..].starts_with(',') {
        end = skip_blanks(entry, end + 1);
    }
    if entry[end..].starts_with("\r\n") {
        end += 2;
    } else if entry[end..].starts_with('\n') {
        end += 1;
    }
    Some(end)
}

pub fn without_file_field(entry: &str) -> String {
    let mut kept = String::with_capacity(entry.len());
    let mut depth = 0usize;
    let mut position = 0;
    while position < entry.len() {
        let line_end = entry[position..]
            .find('\n')
            .map_or(entry.len(), |end| position + end + 1);
        if depth == 1 && is_file_field(&entry[position..line_end]) {
            if let Some(end) = file_field_end(entry, position) {
                position = end;
                continue;
            }
        }
        for character in entry[position..line_end].chars() {
            match character {
                '{' => depth += 1,
                '}' => depth = depth.saturating_sub(1),
                _ => {}
            }
        }
        kept.push_str(&entry[position..line_end]);
        position = line_end;
    }
    kept
}

fn exported(item: &Item, entry: String, origin: Origin) -> ExportedEntry {
    ExportedEntry {
        library: item.library.clone(),
        item_key: item.key.clone(),
        citation_key: item.citation_key.clone(),
        key_source: item.key_source,
        entry: without_file_field(&with_key(&entry, &item.citation_key)),
        origin,
        date_modified: item.date_modified.clone(),
        version: item.version,
        doi: item.doi.clone(),
    }
}

async fn bbt_entries(
    http: &mut Http,
    items: &[&Item],
    style: Style,
    bbt_ids: &HashMap<String, u64>,
) -> HashMap<(String, String), String> {
    let mut found = HashMap::new();
    let mut by_library: HashMap<&str, Vec<&Item>> = HashMap::new();
    for item in items {
        if item.key_source == KeySource::Bbt {
            by_library
                .entry(item.library.as_str())
                .or_default()
                .push(item);
        }
    }
    for (library, items) in by_library {
        let keys: Vec<&str> = items
            .iter()
            .map(|item| item.citation_key.as_str())
            .collect();
        let params = if library == USER_LIBRARY {
            json!([keys, style.translator()])
        } else if let Some(id) = bbt_ids.get(library) {
            json!([keys, style.translator(), id])
        } else {
            continue;
        };
        let Ok(Some(Value::String(output))) = http.rpc("item.export", params).await else {
            continue;
        };
        let entries = split_entries(&output);
        for item in items {
            if let Some(entry) = entries.get(&item.citation_key) {
                found.insert((item.library.clone(), item.key.clone()), entry.clone());
            }
        }
    }
    found
}

async fn zotero_entries(
    http: &mut Http,
    side: Side,
    user_id: Option<&str>,
    items: &[&Item],
    style: Style,
) -> HashMap<(String, String), (String, Option<Item>)> {
    let mut found = HashMap::new();
    let mut by_library: HashMap<&str, Vec<&Item>> = HashMap::new();
    for item in items {
        by_library
            .entry(item.library.as_str())
            .or_default()
            .push(item);
    }
    for (library, items) in by_library {
        let path = library_path(side, library, user_id);
        for chunk in items.chunks(50) {
            let keys: Vec<&str> = chunk.iter().map(|item| item.key.as_str()).collect();
            let query = format!(
                "{path}/items?format=json&include=data,{}&itemKey={}",
                style.format(),
                keys.join(",")
            );
            let Ok(reply) = http.get(&query, None).await else {
                continue;
            };
            let Ok(Value::Array(values)) = reply.json() else {
                continue;
            };
            for value in values {
                let Some(key) = value.get("key").and_then(Value::as_str) else {
                    continue;
                };
                let Some(entry) = value.get(style.format()).and_then(Value::as_str) else {
                    continue;
                };
                let fresh = match parse_item(library, &value) {
                    Some(Parsed::Item(item)) => Some(*item),
                    _ => None,
                };
                let entries = split_entries(entry);
                if let Some(text) = entries.into_values().next() {
                    found.insert((library.to_string(), key.to_string()), (text, fresh));
                }
            }
        }
    }
    found
}

pub async fn export(
    library: &ZoteroLibrary,
    refs: &[ItemRef],
    style: Style,
    options: &SyncOptions,
) -> Vec<ExportedEntry> {
    let bbt_ids = library.bbt_ids();
    let snapshot = library.snapshot();
    let items: Vec<&Item> = refs
        .iter()
        .filter_map(|reference| snapshot.item(&reference.library, &reference.item_key))
        .collect();
    if items.is_empty() {
        return Vec::new();
    }
    let probe = probe_local(library.endpoints()).await;
    let mut entries: HashMap<(String, String), ExportedEntry> = HashMap::new();
    if probe.state == LocalState::Ready {
        if let Ok(mut http) = Http::new(Side::Local, &library.endpoints().local, None) {
            if probe.bbt_version.is_some() {
                for ((lib, key), entry) in bbt_entries(&mut http, &items, style, &bbt_ids).await {
                    if let Some(item) = items
                        .iter()
                        .find(|item| item.library == lib && item.key == key)
                    {
                        entries.insert((lib, key), exported(item, entry, Origin::BetterBibtex));
                    }
                }
            }
            let rest: Vec<&Item> = items
                .iter()
                .copied()
                .filter(|item| !entries.contains_key(&(item.library.clone(), item.key.clone())))
                .collect();
            for ((lib, key), (entry, fresh)) in
                zotero_entries(&mut http, Side::Local, None, &rest, style).await
            {
                if let Some(item) = rest
                    .iter()
                    .find(|item| item.library == lib && item.key == key)
                {
                    let mut result = exported(item, entry, Origin::Zotero);
                    if let Some(fresh) = fresh {
                        result.date_modified = fresh.date_modified;
                        result.version = fresh.version;
                    }
                    entries.insert((lib, key), result);
                }
            }
        }
    } else if let Some(credentials) = options
        .credentials
        .as_ref()
        .filter(|credentials| !options.offline && library.web_matches_index(&credentials.user_id))
    {
        if let Ok(mut http) = Http::new(
            Side::Web,
            &library.endpoints().web,
            Some(credentials.api_key.clone()),
        ) {
            for ((lib, key), (entry, fresh)) in zotero_entries(
                &mut http,
                Side::Web,
                Some(&credentials.user_id),
                &items,
                style,
            )
            .await
            {
                if let Some(item) = items
                    .iter()
                    .find(|item| item.library == lib && item.key == key)
                {
                    let mut result = exported(item, entry, Origin::Zotero);
                    if let Some(fresh) = fresh {
                        result.date_modified = fresh.date_modified;
                        result.version = fresh.version;
                    }
                    entries.insert((lib, key), result);
                }
            }
        }
    }
    items
        .iter()
        .map(|item| {
            entries
                .remove(&(item.library.clone(), item.key.clone()))
                .unwrap_or_else(|| {
                    exported(
                        item,
                        entry_from_item(item, &item.citation_key, style),
                        Origin::Cache,
                    )
                })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::zotero::http::WaitPolicy;
    use crate::zotero::mock::MockZotero;
    use crate::zotero::search::tests::sample;
    use crate::zotero::sync::{Credentials, SyncOptions};
    use std::time::Duration;

    #[test]
    fn splits_and_rekeys_entries() {
        let text = "\n@comment{x}\n@article{smith_deep_2020,\n\ttitle = {A},\n}\n\n  @book{doe2019,\n  title = {B}\n}\n";
        let entries = split_entries(text);
        assert_eq!(entries.len(), 2);
        assert!(entries["smith_deep_2020"].starts_with("@article{smith_deep_2020,"));
        assert!(entries["doe2019"].ends_with('}'));
        assert_eq!(
            with_key(
                "@article{smith_deep_2020,\n\ttitle = {A},\n}",
                "smithDeep2020"
            ),
            "@article{smithDeep2020,\n\ttitle = {A},\n}"
        );
        assert_eq!(with_key("@book{ old ,\n}", "new"), "@book{ new ,\n}");
    }

    #[test]
    fn leaves_local_file_paths_out_of_entries() {
        assert_eq!(
            without_file_field("@article{efron1979,\n\ttitle = {Bootstrap {Methods}},\n\tfile = {Full Text:/Users/ann/Zotero/storage/TGVKSI8L/Efron - 1979.pdf:application/pdf},\n\tyear = {1979},\n}"),
            "@article{efron1979,\n\ttitle = {Bootstrap {Methods}},\n\tyear = {1979},\n}"
        );
        assert_eq!(
            without_file_field("@book{k,\n  title = {A},\n  File = {/a/{b}\n c.pdf}\n}"),
            "@book{k,\n  title = {A},\n}"
        );
        assert_eq!(
            without_file_field("@misc{k,\n  note = {file = {x}},\n  file = {/a.pdf}}"),
            "@misc{k,\n  note = {file = {x}},\n}"
        );
        let untouched = "@misc{k,\n  filename = {kept},\n  title = {file = {kept}}\n}";
        assert_eq!(without_file_field(untouched), untouched);
    }

    #[test]
    fn builds_a_fallback_entry_from_cached_data() {
        let mut item = sample(
            "A1",
            "smithDeep2020",
            &["Smith", "王"],
            "Deep & wide_nets",
            Some("2020"),
        );
        item.creators[0].given = "Ann".into();
        item.date = "2020-03-15".into();
        item.doi = Some("10.1/x".into());
        item.fields
            .insert("publicationTitle".into(), "J. Tests".into());
        item.fields.insert("pages".into(), "45-67".into());
        let biblatex = entry_from_item(&item, "smithDeep2020", Style::Biblatex);
        assert_eq!(
            biblatex,
            "@article{smithDeep2020,\n  title = {Deep \\& wide\\_nets},\n  author = {Smith, Ann and {王}},\n  date = {2020-03-15},\n  journaltitle = {J. Tests},\n  pages = {45--67},\n  doi = {10.1/x}\n}"
        );
        let bibtex = entry_from_item(&item, "k", Style::Bibtex);
        assert!(bibtex.contains("  year = {2020}"));
        assert!(bibtex.contains("  journal = {J. Tests}"));
        item.item_type = "thesis".into();
        item.fields
            .insert("thesisType".into(), "Master's thesis".into());
        item.fields.insert("university".into(), "MIT".into());
        let thesis = entry_from_item(&item, "k", Style::Bibtex);
        assert!(thesis.starts_with("@mastersthesis{k,"));
        assert!(thesis.contains("school = {MIT}"));
        let anonymous = Item {
            item_type: "webpage".into(),
            ..Item::default()
        };
        assert_eq!(
            entry_from_item(&anonymous, "anon", Style::Biblatex),
            "@online{anon,\n\n}"
        );
        assert_eq!(escape("unbalanced {brace"), "unbalanced brace");
    }

    async fn synced(mock: &MockZotero) -> ZoteroLibrary {
        let library = ZoteroLibrary::new(mock.endpoints(), None).with_policy(WaitPolicy {
            max_single: Duration::from_secs(1),
            max_total: Duration::from_secs(2),
        });
        library
            .sync(
                SyncOptions {
                    force: true,
                    ..SyncOptions::default()
                },
                &mut |_| {},
            )
            .await;
        library
    }

    fn reference(library: &str, key: &str) -> ItemRef {
        ItemRef {
            library: library.into(),
            item_key: key.into(),
        }
    }

    #[tokio::test]
    async fn keeps_desktop_item_keys_away_from_a_different_zotero_org_library() {
        let mock = MockZotero::start().await;
        mock.set(|state| state.local_user_id = 0);
        let library = synced(&mock).await;
        mock.set(|state| state.running = false);
        mock.clear_requests();
        let entries = export(
            &library,
            &[reference(USER_LIBRARY, "SMITH234")],
            Style::Bibtex,
            &SyncOptions {
                credentials: Some(Credentials {
                    user_id: mock.user_id().into(),
                    api_key: mock.api_key().into(),
                }),
                ..SyncOptions::default()
            },
        )
        .await;
        assert_eq!(entries[0].origin, Origin::Cache);
        assert_eq!(mock.web_request_count(), 0);
    }

    #[tokio::test]
    async fn exports_through_better_bibtex_then_zotero_then_the_cache() {
        let mock = MockZotero::start().await;
        let library = synced(&mock).await;
        let refs = [
            reference(USER_LIBRARY, "SMITH234"),
            reference(USER_LIBRARY, "NATIV234"),
        ];
        let entries = export(&library, &refs, Style::Biblatex, &SyncOptions::default()).await;
        assert_eq!(entries[0].origin, Origin::BetterBibtex);
        assert!(entries[0].entry.starts_with("@article{smithBBT2020,"));
        assert!(entries[0].entry.contains("langid = {english}"));
        assert_eq!(entries[1].origin, Origin::Zotero);
        assert!(entries[1].entry.starts_with("@article{nativeKey2019,"));
        assert!(entries[1].entry.contains("journaltitle"));
        let group = export(
            &library,
            &[reference("group:777", "GROUP234")],
            Style::Bibtex,
            &SyncOptions::default(),
        )
        .await;
        assert_eq!(group[0].origin, Origin::BetterBibtex);
        assert!(group[0].entry.contains("journal = {Journal of Tests}"));
        mock.set(|state| state.running = false);
        let cached = export(&library, &refs, Style::Bibtex, &SyncOptions::default()).await;
        assert_eq!(cached[0].origin, Origin::Cache);
        assert!(cached[0].entry.starts_with("@article{smithBBT2020,"));
        let web = export(
            &library,
            &refs,
            Style::Biblatex,
            &SyncOptions {
                credentials: Some(Credentials {
                    user_id: mock.user_id().into(),
                    api_key: mock.api_key().into(),
                }),
                ..SyncOptions::default()
            },
        )
        .await;
        assert_eq!(web[0].origin, Origin::Zotero);
        assert!(web[0].entry.starts_with("@article{smithBBT2020,"));
        assert!(export(
            &library,
            &[reference(USER_LIBRARY, "MISSING2")],
            Style::Bibtex,
            &SyncOptions::default()
        )
        .await
        .is_empty());
    }
}
