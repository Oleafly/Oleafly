use std::collections::HashMap;

use super::sources::LiteratureRecord;
use crate::similarity::normalize_title;

pub const MAX_MERGED: usize = 50;

fn identities(record: &LiteratureRecord) -> Vec<String> {
    let mut keys: Vec<String> = record
        .source_ids
        .iter()
        .map(|(source, id)| format!("{source}:{id}"))
        .collect();
    if let Some(doi) = &record.doi {
        keys.push(format!("doi:{}", doi.to_ascii_lowercase()));
    }
    if let Some(arxiv) = &record.arxiv_id {
        keys.push(format!("arxiv:{}", arxiv.to_ascii_lowercase()));
    }
    let title = normalize_title(&record.title);
    if !title.is_empty() {
        keys.push(format!("title:{title}"));
    }
    keys
}

fn richer(first: Option<String>, second: Option<String>) -> Option<String> {
    match (first, second) {
        (Some(first), Some(second)) if second.len() > first.len() => Some(second),
        (Some(first), _) => Some(first),
        (None, second) => second,
    }
}

fn merge_record(first: LiteratureRecord, second: LiteratureRecord) -> LiteratureRecord {
    let mut sources = first.sources.clone();
    for source in second.sources {
        if !sources.contains(&source) {
            sources.push(source);
        }
    }
    let mut source_ids = first.source_ids.clone();
    for (source, id) in second.source_ids {
        source_ids.entry(source).or_insert(id);
    }
    LiteratureRecord {
        id: first.id,
        title: richer(Some(first.title), Some(second.title)).unwrap_or_default(),
        authors: if second.authors.len() > first.authors.len() {
            second.authors
        } else {
            first.authors
        },
        year: first.year.or(second.year),
        venue: richer(first.venue, second.venue),
        doi: first.doi.or(second.doi),
        arxiv_id: first.arxiv_id.or(second.arxiv_id),
        url: first.url.or(second.url),
        pdf_url: first.pdf_url.or(second.pdf_url),
        abstract_text: richer(first.abstract_text, second.abstract_text),
        citation_count: match (first.citation_count, second.citation_count) {
            (Some(left), Some(right)) => Some(left.max(right)),
            (left, right) => left.or(right),
        },
        open_access: if first.open_access == Some(true) || second.open_access == Some(true) {
            Some(true)
        } else {
            first.open_access.or(second.open_access)
        },
        sources,
        source_ids,
    }
}

pub fn merge(groups: Vec<Vec<LiteratureRecord>>) -> Vec<LiteratureRecord> {
    let longest = groups.iter().map(Vec::len).max().unwrap_or(0);
    let mut iterators: Vec<_> = groups.into_iter().map(Vec::into_iter).collect();
    let mut merged: Vec<LiteratureRecord> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for _ in 0..longest {
        for records in &mut iterators {
            let Some(record) = records.next() else {
                continue;
            };
            let keys = identities(&record);
            match keys.iter().find_map(|key| index.get(key).copied()) {
                Some(at) => {
                    let existing = std::mem::take(&mut merged[at]);
                    merged[at] = merge_record(existing, record);
                    for key in identities(&merged[at]) {
                        index.insert(key, at);
                    }
                }
                None if merged.len() < MAX_MERGED => {
                    for key in keys {
                        index.entry(key).or_insert(merged.len());
                    }
                    merged.push(record);
                }
                None => {}
            }
        }
    }
    merged
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::literature::sources::LiteratureSourceId;

    fn found(source: LiteratureSourceId, id: &str, title: &str) -> LiteratureRecord {
        LiteratureRecord {
            id: format!("{}:{id}", source.as_str()),
            title: title.into(),
            sources: vec![source],
            source_ids: [(source.as_str().to_owned(), id.to_owned())]
                .into_iter()
                .collect(),
            ..LiteratureRecord::default()
        }
    }

    #[test]
    fn fan_out_merges_by_doi_then_arxiv_then_title() {
        let mut openalex = found(LiteratureSourceId::Openalex, "W1", "Graph networks");
        openalex.doi = Some("10.1/ABC".into());
        let mut s2 = found(LiteratureSourceId::SemanticScholar, "p1", "Graph Networks");
        s2.doi = Some("10.1/abc".into());
        s2.citation_count = Some(9);
        let mut arxiv = found(LiteratureSourceId::Arxiv, "2410.1", "Attention models");
        arxiv.arxiv_id = Some("2410.1".into());
        let mut s2_arxiv = found(
            LiteratureSourceId::SemanticScholar,
            "p2",
            "Attention Models: a study",
        );
        s2_arxiv.arxiv_id = Some("2410.1".into());
        s2_arxiv.abstract_text = Some("Longer abstract.".into());
        let crossref_twin = found(
            LiteratureSourceId::Crossref,
            "c1",
            "Transformers in practice",
        );
        let crossref_original = found(
            LiteratureSourceId::Openalex,
            "W9",
            "Transformers in Practice!",
        );
        let merged = merge(vec![
            vec![openalex, crossref_original],
            vec![s2, s2_arxiv],
            vec![arxiv, crossref_twin],
        ]);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].citation_count, Some(9));
        assert_eq!(merged[0].sources.len(), 2);
        let attention = merged
            .iter()
            .find(|record| record.arxiv_id.as_deref() == Some("2410.1"))
            .unwrap();
        assert_eq!(attention.abstract_text.as_deref(), Some("Longer abstract."));
        let transformers = merged
            .iter()
            .find(|record| record.title.starts_with("Transformers"))
            .unwrap();
        assert_eq!(transformers.sources.len(), 2);
    }

    #[test]
    fn at_most_fifty_records_are_kept() {
        let many: Vec<LiteratureRecord> = (0..80)
            .map(|index| {
                found(
                    LiteratureSourceId::Crossref,
                    &index.to_string(),
                    &format!("Paper number {index}"),
                )
            })
            .collect();
        assert_eq!(merge(vec![many]).len(), MAX_MERGED);
    }
}
