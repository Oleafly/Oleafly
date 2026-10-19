//! New bibliography entries: each one is checked against its DOI or title.
use std::collections::{BTreeMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use biblatex::{Bibliography, ChunksExt, Entry};
use futures_util::StreamExt;

use crate::citation::CitationCheck;
use crate::model::EvidenceItem;

pub(crate) const MAX_ENTRIES: usize = 50;
const AT_ONCE: usize = 4;
const LOOKUP_LIMIT: Duration = Duration::from_secs(10);
const DOI_MISMATCH: &str = "The DOI belongs to a different title.";

/// Checks one reference by DOI or title (the real one asks Crossref).
pub(crate) type Verifier = Arc<
    dyn Fn(
            Option<String>,
            Option<String>,
        ) -> Pin<Box<dyn Future<Output = Result<CitationCheck, String>> + Send>>
        + Send
        + Sync,
>;

pub(crate) fn crossref_verifier() -> Verifier {
    Arc::new(|doi, title| {
        Box::pin(
            async move { crate::citation::verify_citation(doi.as_deref(), title.as_deref()).await },
        )
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NewEntry {
    pub key: String,
    pub doi: Option<String>,
    pub title: Option<String>,
    pub file: String,
}

fn field(entry: &Entry, name: &str) -> Option<String> {
    entry
        .get(name)
        .map(|chunks| chunks.format_verbatim())
        .map(|text| text.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|text| !text.is_empty())
}

/// Entries of `after` whose keys `before` did not have.
pub(crate) fn new_entries(before: Option<&str>, after: &str, file: &str) -> Vec<NewEntry> {
    let Ok(after) = Bibliography::parse(after) else {
        return Vec::new();
    };
    let known: HashSet<String> = before
        .and_then(|text| Bibliography::parse(text).ok())
        .map(|bibliography| bibliography.iter().map(|entry| entry.key.clone()).collect())
        .unwrap_or_default();
    after
        .iter()
        .filter(|entry| !known.contains(&entry.key))
        .map(|entry| NewEntry {
            key: entry.key.clone(),
            doi: field(entry, "doi"),
            title: field(entry, "title"),
            file: file.to_owned(),
        })
        .collect()
}

fn item(code: &str, entry: &NewEntry, extra: Option<(&str, String)>) -> EvidenceItem {
    let mut params = BTreeMap::from([("key".to_owned(), entry.key.clone())]);
    if let Some((name, value)) = extra {
        params.insert(name.to_owned(), value);
    }
    EvidenceItem {
        code: code.to_owned(),
        file: Some(entry.file.clone()),
        line: None,
        params,
    }
}

/// An entry and its check, or the time running out.
type CheckedEntry = (
    NewEntry,
    Result<Result<CitationCheck, String>, tokio::time::error::Elapsed>,
);

/// Checks up to 50 entries, four at a time, ten seconds each.
pub(crate) async fn verify_entries(entries: Vec<NewEntry>, verify: Verifier) -> Vec<EvidenceItem> {
    let results: Vec<CheckedEntry> =
        futures_util::stream::iter(entries.into_iter().take(MAX_ENTRIES))
            .map(|entry| {
                let verify = verify.clone();
                async move {
                    let lookup = verify(entry.doi.clone(), entry.title.clone());
                    let result = tokio::time::timeout(LOOKUP_LIMIT, lookup).await;
                    (entry, result)
                }
            })
            .buffer_unordered(AT_ONCE)
            .collect()
            .await;
    let mut items: Vec<EvidenceItem> = results
        .into_iter()
        .filter_map(|(entry, result)| match result {
            Ok(Ok(check)) if check.verified => None,
            Ok(Ok(check)) if check.reason.as_deref() == Some(DOI_MISMATCH) => Some(item(
                "bib.titleMismatch",
                &entry,
                Some(("found", check.matched_title.unwrap_or_default())),
            )),
            Ok(Ok(_)) => Some(item("bib.unverified", &entry, None)),
            Ok(Err(_)) | Err(_) => Some(item("bib.lookupFailed", &entry, None)),
        })
        .collect();
    items.sort_by(|left, right| left.params["key"].cmp(&right.params["key"]));
    items
}
