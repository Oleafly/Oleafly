use std::collections::{HashMap, HashSet};

use serde::Serialize;

use super::item::{fold, Item, KeySource};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub library: String,
    pub item_key: String,
    pub citation_key: String,
    pub key_source: KeySource,
    pub title: String,
    pub authors: Vec<String>,
    pub author_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doi: Option<String>,
    pub item_type: String,
    pub date_modified: String,
    pub score: u32,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    pub total: usize,
}

struct Entry {
    key: Box<str>,
    families: Box<[Box<str>]>,
    words: Box<[Box<str>]>,
    year: Option<u32>,
    wide: bool,
}

pub struct Snapshot {
    items: Vec<Item>,
    entries: Vec<Entry>,
    by_key: HashMap<String, usize>,
    by_alias: HashMap<String, usize>,
    by_ref: HashMap<(String, String), usize>,
}

fn is_wide(character: char) -> bool {
    matches!(character as u32,
        0x1100..=0x11FF | 0x2E80..=0x9FFF | 0xA960..=0xA97F | 0xAC00..=0xD7FF | 0xF900..=0xFAFF | 0x20000..=0x2FFFF)
}

fn tokens(text: &str) -> Vec<String> {
    fold(text)
        .split(|character: char| !character.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(str::to_string)
        .collect()
}

fn boxed(tokens: impl IntoIterator<Item = String>) -> Box<[Box<str>]> {
    tokens.into_iter().map(String::into_boxed_str).collect()
}

fn entry_for(item: &Item) -> Entry {
    let mut families: Vec<String> = Vec::new();
    for creator in &item.creators {
        for token in tokens(&creator.family) {
            if !families.contains(&token) {
                families.push(token);
            }
        }
    }
    let wide = item
        .title
        .chars()
        .chain(
            item.creators
                .iter()
                .flat_map(|creator| creator.family.chars()),
        )
        .any(is_wide);
    Entry {
        key: fold(&item.citation_key).into_boxed_str(),
        families: boxed(families),
        words: boxed(tokens(&item.title)),
        year: item.year.as_deref().and_then(|year| year.parse().ok()),
        wide,
    }
}

fn year_score(entry: &Entry, term: &str) -> u32 {
    if term.len() == 4 && term.bytes().all(|byte| byte.is_ascii_digit()) {
        if entry.year == term.parse().ok() {
            return 300;
        }
    } else if term.len() >= 2 && term.bytes().all(|byte| byte.is_ascii_digit()) {
        if let Some(year) = entry.year {
            if year.to_string().starts_with(term) {
                return 90;
            }
        }
    }
    0
}

fn family_score(entry: &Entry, term: &str) -> u32 {
    let mut best = 0;
    for (index, family) in entry.families.iter().enumerate() {
        let first = index == 0;
        let score = if &**family == term {
            if first {
                560
            } else {
                460
            }
        } else if family.starts_with(term) {
            if first {
                450
            } else {
                350
            }
        } else if entry.wide && family.contains(term) {
            200
        } else {
            0
        };
        best = best.max(score);
    }
    best
}

fn key_score(entry: &Entry, term: &str) -> u32 {
    if entry.key.starts_with(term) {
        500
    } else if term.chars().count() >= 3 && entry.key.contains(term) {
        120
    } else {
        0
    }
}

fn word_score(entry: &Entry, term: &str) -> u32 {
    let mut best = 0;
    for word in entry.words.iter() {
        let score = if &**word == term {
            180
        } else if word.starts_with(term) {
            150
        } else if entry.wide && word.contains(term) {
            110
        } else {
            0
        };
        best = best.max(score);
    }
    best
}

fn term_score(entry: &Entry, term: &str) -> u32 {
    year_score(entry, term)
        .max(family_score(entry, term))
        .max(key_score(entry, term))
        .max(word_score(entry, term))
}

fn score(entry: &Entry, compact: &str, terms: &[String]) -> Option<u32> {
    let mut total = 0;
    if !compact.is_empty() {
        if &*entry.key == compact {
            total += 2_000;
        } else if compact.chars().count() >= 2 && entry.key.starts_with(compact) {
            total += 800;
        }
    }
    for term in terms {
        let term_total = term_score(entry, term);
        if term_total == 0 {
            return None;
        }
        total += term_total;
    }
    Some(total)
}

fn hit(item: &Item, score: u32) -> SearchHit {
    let authors: Vec<&str> = item
        .creators
        .iter()
        .filter(|creator| creator.role.is_empty())
        .map(|creator| creator.family.as_str())
        .collect();
    let authors = if authors.is_empty() {
        item.creators
            .iter()
            .map(|creator| creator.family.as_str())
            .collect()
    } else {
        authors
    };
    SearchHit {
        library: item.library.clone(),
        item_key: item.key.clone(),
        citation_key: item.citation_key.clone(),
        key_source: item.key_source,
        title: item.title.clone(),
        author_count: authors.len(),
        authors: authors.iter().take(3).map(ToString::to_string).collect(),
        year: item.year.clone(),
        doi: item.doi.clone(),
        item_type: item.item_type.clone(),
        date_modified: item.date_modified.clone(),
        score,
        aliases: item.aliases.clone(),
    }
}

impl Snapshot {
    pub fn new(items: Vec<Item>) -> Self {
        let entries = items.iter().map(entry_for).collect();
        let mut by_key = HashMap::with_capacity(items.len());
        let mut by_alias = HashMap::new();
        let mut by_ref = HashMap::with_capacity(items.len());
        for (index, item) in items.iter().enumerate() {
            by_key.entry(item.citation_key.clone()).or_insert(index);
            for alias in &item.aliases {
                by_alias.entry(alias.clone()).or_insert(index);
            }
            by_ref.insert((item.library.clone(), item.key.clone()), index);
        }
        Self {
            items,
            entries,
            by_key,
            by_alias,
            by_ref,
        }
    }

    pub fn empty() -> Self {
        Self::new(Vec::new())
    }

    pub fn item(&self, library: &str, key: &str) -> Option<&Item> {
        self.by_ref
            .get(&(library.to_string(), key.to_string()))
            .map(|index| &self.items[*index])
    }

    pub fn by_citation_key(&self, key: &str) -> Option<&Item> {
        self.by_key
            .get(key)
            .or_else(|| self.by_alias.get(key))
            .map(|index| &self.items[*index])
    }

    pub fn keys(&self, disabled: &HashSet<String>) -> Vec<String> {
        let mut keys = Vec::with_capacity(self.items.len());
        for item in &self.items {
            if disabled.contains(&item.library) {
                continue;
            }
            keys.push(item.citation_key.clone());
            keys.extend(item.aliases.iter().cloned());
        }
        keys
    }

    pub fn hit_for(&self, item: &Item) -> SearchHit {
        hit(item, 0)
    }

    pub fn search(&self, query: &str, limit: usize, disabled: &HashSet<String>) -> SearchResult {
        let limit = limit.clamp(1, 200);
        let folded = fold(query.trim().trim_start_matches('@'));
        let terms: Vec<String> = folded
            .split(|character: char| !character.is_alphanumeric())
            .filter(|term| !term.is_empty())
            .map(str::to_string)
            .collect();
        let compact: String = folded
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect();
        let mut scored: Vec<(u32, usize)> = Vec::new();
        if terms.is_empty() {
            scored.extend(
                self.items
                    .iter()
                    .enumerate()
                    .filter(|(_, item)| !disabled.contains(&item.library))
                    .map(|(index, _)| (0, index)),
            );
            let total = scored.len();
            let items = &self.items;
            let take = limit.min(total);
            if take < total {
                scored.select_nth_unstable_by(take, |left, right| {
                    items[right.1]
                        .date_modified
                        .cmp(&items[left.1].date_modified)
                });
                scored.truncate(take);
            }
            scored.sort_by(|left, right| {
                items[right.1]
                    .date_modified
                    .cmp(&items[left.1].date_modified)
                    .then_with(|| items[left.1].citation_key.cmp(&items[right.1].citation_key))
            });
            return SearchResult {
                hits: scored
                    .iter()
                    .map(|(_, index)| hit(&self.items[*index], 0))
                    .collect(),
                total,
            };
        }
        for (index, entry) in self.entries.iter().enumerate() {
            if disabled.contains(&self.items[index].library) {
                continue;
            }
            if let Some(score) = score(entry, &compact, &terms) {
                scored.push((score, index));
            }
        }
        let total = scored.len();
        let entries = &self.entries;
        let items = &self.items;
        let order = |left: &(u32, usize), right: &(u32, usize)| {
            right
                .0
                .cmp(&left.0)
                .then_with(|| entries[right.1].year.cmp(&entries[left.1].year))
                .then_with(|| items[left.1].citation_key.cmp(&items[right.1].citation_key))
        };
        if scored.len() > limit {
            scored.select_nth_unstable_by(limit, order);
            scored.truncate(limit);
        }
        scored.sort_by(order);
        SearchResult {
            hits: scored
                .iter()
                .map(|(score, index)| hit(&self.items[*index], *score))
                .collect(),
            total,
        }
    }

    #[cfg(test)]
    pub fn approximate_bytes(&self) -> usize {
        let item_bytes: usize = self
            .items
            .iter()
            .map(|item| {
                std::mem::size_of::<Item>()
                    + item.library.capacity()
                    + item.key.capacity()
                    + item.date_added.capacity()
                    + item.date_modified.capacity()
                    + item.item_type.capacity()
                    + item.title.capacity()
                    + item.date.capacity()
                    + item.citation_key.capacity()
                    + item.year.as_ref().map_or(0, String::capacity)
                    + item.doi.as_ref().map_or(0, String::capacity)
                    + item.native_key.as_ref().map_or(0, String::capacity)
                    + item.extra_key.as_ref().map_or(0, String::capacity)
                    + item.bbt_key.as_ref().map_or(0, String::capacity)
                    + item.aliases.iter().map(String::capacity).sum::<usize>()
                    + item
                        .creators
                        .iter()
                        .map(|creator| {
                            std::mem::size_of_val(creator)
                                + creator.family.capacity()
                                + creator.given.capacity()
                                + creator.role.capacity()
                        })
                        .sum::<usize>()
                    + item
                        .fields
                        .iter()
                        .map(|(name, value)| name.capacity() + value.capacity() + 64)
                        .sum::<usize>()
            })
            .sum();
        let entry_bytes: usize = self
            .entries
            .iter()
            .map(|entry| {
                std::mem::size_of::<Entry>()
                    + entry.key.len()
                    + entry
                        .families
                        .iter()
                        .map(|text| text.len() + 16)
                        .sum::<usize>()
                    + entry
                        .words
                        .iter()
                        .map(|text| text.len() + 16)
                        .sum::<usize>()
            })
            .sum();
        let map_bytes = (self.by_key.len() + self.by_alias.len()) * 64 + self.by_ref.len() * 96;
        item_bytes + entry_bytes + map_bytes
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::zotero::item::{group_library, Creator, USER_LIBRARY};

    pub(crate) fn sample(
        key: &str,
        citation_key: &str,
        families: &[&str],
        title: &str,
        year: Option<&str>,
    ) -> Item {
        Item {
            library: USER_LIBRARY.into(),
            key: key.into(),
            item_type: "journalArticle".into(),
            title: title.into(),
            creators: families
                .iter()
                .map(|family| Creator {
                    family: family.to_string(),
                    ..Creator::default()
                })
                .collect(),
            year: year.map(str::to_string),
            citation_key: citation_key.into(),
            key_source: KeySource::Bbt,
            date_modified: format!("2020-01-01T00:00:{key}"),
            ..Item::default()
        }
    }

    fn keys(result: &SearchResult) -> Vec<&str> {
        result
            .hits
            .iter()
            .map(|hit| hit.citation_key.as_str())
            .collect()
    }

    fn library() -> Snapshot {
        let mut group = sample(
            "G1",
            "leeGraphs2019",
            &["Lee"],
            "Graphs everywhere",
            Some("2019"),
        );
        group.library = group_library(7);
        Snapshot::new(vec![
            sample(
                "A1",
                "smithDeepLearning2020",
                &["Smith", "Doe"],
                "Deep learning for proteins",
                Some("2020"),
            ),
            sample(
                "A2",
                "doeSmithing2018",
                &["Doe"],
                "Smithing and forging",
                Some("2018"),
            ),
            sample(
                "A3",
                "mullerAngstrom2021",
                &["Müller"],
                "Ångström resolution imaging",
                Some("2021"),
            ),
            sample("A4", "wang2022", &["王"], "深度学习的应用", Some("2022")),
            sample("A5", "anonymous", &[], "Untitled notes", None),
            group,
        ])
    }

    #[test]
    fn ranks_key_prefix_then_surname_then_title() {
        let snapshot = library();
        let none = HashSet::new();
        assert_eq!(
            keys(&snapshot.search("smith", 10, &none))[0],
            "smithDeepLearning2020"
        );
        assert_eq!(
            keys(&snapshot.search("smith", 10, &none)),
            vec!["smithDeepLearning2020", "doeSmithing2018"]
        );
        assert_eq!(
            keys(&snapshot.search("doe", 10, &none))[0],
            "doeSmithing2018"
        );
        assert_eq!(
            keys(&snapshot.search("proteins", 10, &none)),
            vec!["smithDeepLearning2020"]
        );
        assert_eq!(
            keys(&snapshot.search("doe 2020", 10, &none)),
            vec!["smithDeepLearning2020"]
        );
        assert_eq!(
            keys(&snapshot.search("smithdeeplearning2020", 10, &none))[0],
            "smithDeepLearning2020"
        );
        assert!(snapshot.search("zzz", 10, &none).hits.is_empty());
    }

    #[test]
    fn matches_accents_and_cjk() {
        let snapshot = library();
        let none = HashSet::new();
        assert_eq!(
            keys(&snapshot.search("muller", 10, &none)),
            vec!["mullerAngstrom2021"]
        );
        assert_eq!(
            keys(&snapshot.search("Müll", 10, &none)),
            vec!["mullerAngstrom2021"]
        );
        assert_eq!(
            keys(&snapshot.search("angstrom", 10, &none)),
            vec!["mullerAngstrom2021"]
        );
        assert_eq!(keys(&snapshot.search("王", 10, &none)), vec!["wang2022"]);
        assert_eq!(keys(&snapshot.search("学习", 10, &none)), vec!["wang2022"]);
        assert_eq!(
            keys(&snapshot.search("@anon", 10, &none)),
            vec!["anonymous"]
        );
    }

    #[test]
    fn year_terms_match_years_and_prefixes() {
        let snapshot = library();
        let none = HashSet::new();
        assert_eq!(
            keys(&snapshot.search("2018", 10, &none)),
            vec!["doeSmithing2018"]
        );
        let decade = snapshot.search("202", 10, &none);
        assert_eq!(decade.total, 3);
    }

    #[test]
    fn honours_limits_disabled_libraries_and_empty_queries() {
        let snapshot = library();
        let none = HashSet::new();
        let limited = snapshot.search("", 2, &none);
        assert_eq!(limited.hits.len(), 2);
        assert_eq!(limited.total, 6);
        let disabled: HashSet<String> = [group_library(7)].into_iter().collect();
        assert!(snapshot.search("graphs", 10, &disabled).hits.is_empty());
        assert_eq!(
            snapshot.search("graphs", 10, &none).hits[0].library,
            "group:7"
        );
        assert_eq!(snapshot.keys(&disabled).len(), 5);
    }

    #[test]
    fn looks_up_keys_aliases_dois_and_refs() {
        let mut moved = sample("A9", "newKey", &["Roe"], "Moved", Some("2010"));
        moved.aliases = vec!["oldKey".into()];
        moved.doi = Some("10.1/abc".into());
        let snapshot = Snapshot::new(vec![moved]);
        assert_eq!(snapshot.by_citation_key("newKey").unwrap().key, "A9");
        assert_eq!(snapshot.by_citation_key("oldKey").unwrap().key, "A9");
        assert!(snapshot.by_citation_key("missing").is_none());
        assert_eq!(
            snapshot.item(USER_LIBRARY, "A9").unwrap().citation_key,
            "newKey"
        );
        assert_eq!(
            snapshot.keys(&HashSet::new()),
            vec!["newKey".to_string(), "oldKey".to_string()]
        );
    }

    #[test]
    fn hits_carry_display_fields() {
        let snapshot = library();
        let hit = &snapshot.search("smith deep", 1, &HashSet::new()).hits[0];
        assert_eq!(hit.authors, vec!["Smith".to_string(), "Doe".to_string()]);
        assert_eq!(hit.author_count, 2);
        assert_eq!(hit.year.as_deref(), Some("2020"));
        assert_eq!(hit.item_key, "A1");
    }

    fn synthetic(count: usize) -> Vec<Item> {
        let families = [
            "Smith",
            "Müller",
            "Nguyen",
            "王",
            "Иванов",
            "García",
            "Ó Briain",
            "van der Berg",
            "Kowalski",
            "Tanaka",
            "Okafor",
            "Søren",
            "Dvořák",
            "Lee",
            "Patel",
            "Rossi",
            "Kim",
            "Johnson",
            "Brown",
            "Martin",
        ];
        let words = [
            "deep",
            "learning",
            "protein",
            "folding",
            "graph",
            "neural",
            "networks",
            "quantum",
            "theory",
            "climate",
            "model",
            "analysis",
            "bayesian",
            "inference",
            "language",
            "vision",
            "robust",
            "optimal",
            "control",
            "dynamics",
            "sparse",
            "signal",
            "evolution",
            "genome",
            "cell",
            "market",
            "policy",
            "urban",
            "energy",
            "materials",
        ];
        let mut seed: u64 = 42;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        (0..count)
            .map(|index| {
                let authors = 1 + (next() % 5) as usize;
                let creators = (0..authors)
                    .map(|_| Creator {
                        family: families[(next() % families.len() as u64) as usize].to_string(),
                        given: "A.".to_string(),
                        ..Creator::default()
                    })
                    .collect::<Vec<_>>();
                let title = (0..(4 + next() % 8))
                    .map(|_| words[(next() % words.len() as u64) as usize])
                    .collect::<Vec<_>>()
                    .join(" ");
                let year = 1990 + next() % 36;
                let mut item = sample(
                    &format!("K{index:07}"),
                    &format!(
                        "{}{}{}",
                        creators[0].family.to_lowercase(),
                        title.split(' ').next().unwrap(),
                        year
                    ),
                    &[],
                    &title,
                    Some(&year.to_string()),
                );
                item.creators = creators;
                item.doi = (index % 3 != 0).then(|| format!("10.5555/mock.{index}"));
                item.fields.insert(
                    "publicationTitle".into(),
                    "Journal of Synthetic Results".into(),
                );
                item.fields.insert("pages".into(), "100-120".into());
                item
            })
            .collect()
    }

    #[test]
    #[ignore = "measurement, run with --ignored --nocapture"]
    fn measures_large_libraries() {
        for count in [1_000usize, 10_000] {
            let items = synthetic(count);
            let json = serde_json::to_vec(&items).unwrap().len();
            let started = std::time::Instant::now();
            let snapshot = Snapshot::new(items);
            let build = started.elapsed();
            let none = HashSet::new();
            let queries = [
                "smi",
                "smith",
                "muller deep",
                "protein 2020",
                "wang",
                "иван",
                "quantum theory model",
                "",
                "zzzz",
            ];
            let mut cold = Vec::new();
            for query in queries {
                let started = std::time::Instant::now();
                let result = snapshot.search(query, 50, &none);
                cold.push((
                    query,
                    started.elapsed().as_secs_f64() * 1000.0,
                    result.total,
                ));
            }
            let started = std::time::Instant::now();
            let rounds = 200;
            for round in 0..rounds {
                snapshot.search(queries[round % queries.len()], 50, &none);
            }
            let warm = started.elapsed().as_secs_f64() * 1000.0 / rounds as f64;
            println!(
                "items={count} build_ms={:.2} index_bytes={} cache_json_bytes={json} warm_avg_ms={warm:.3}",
                build.as_secs_f64() * 1000.0,
                snapshot.approximate_bytes()
            );
            for (query, ms, total) in cold {
                println!("  query={query:?} ms={ms:.3} matches={total}");
            }
        }
    }
}
