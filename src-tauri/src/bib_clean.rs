//! On-demand BibTeX library cleaning: normalize citation keys to the app's
//! `firstauthorYEARfirstword` scheme, dedupe entries by DOI and by fuzzy
//! title, and rewrite the library plus every `\cite` of a renamed key in the
//! project. `apply = false` returns the same plan as a dry run.

use biblatex::{Bibliography, ChunksExt, Entry, Person};
use std::path::{Path, PathBuf};

const FUZZY_TITLE_THRESHOLD: f64 = 0.9;
const YEAR_WINDOW: i64 = 1;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "data")]
pub enum CleanAction {
    /// `old` renamed to `new`.
    #[serde(rename_all = "camelCase")]
    RenamedKey { old: String, new: String },
    /// Duplicate removed; `kept` is the surviving key.
    #[serde(rename_all = "camelCase")]
    RemovedDuplicate {
        removed: String,
        kept: String,
        by: String,
    },
    /// The entry is missing a field worth filling by hand.
    #[serde(rename_all = "camelCase")]
    Advisory { key: String, field: String },
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanOutcome {
    pub original: String,
    pub cleaned: String,
    pub entries_before: usize,
    pub entries_after: usize,
    pub actions: Vec<CleanAction>,
    pub applied: bool,
}

fn field_string(entry: &Entry, key: &str) -> Option<String> {
    entry
        .get(key)
        .map(|chunks| chunks.format_verbatim())
        .filter(|s| !s.trim().is_empty())
}

fn author_string(entry: &Entry) -> String {
    match entry.author() {
        Ok(persons) if !persons.is_empty() => persons
            .iter()
            .map(person_bibtex)
            .collect::<Vec<_>>()
            .join(" and "),
        _ => String::new(),
    }
}

fn person_bibtex(person: &Person) -> String {
    let family = person.name.trim();
    let given = person.given_name.trim();
    if given.is_empty() {
        family.to_string()
    } else {
        format!("{family}, {given}")
    }
}

fn year_string(entry: &Entry) -> String {
    field_string(entry, "year")
        .map(|y| crate::citation::year_of(&y))
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn normalize_doi(raw: &str) -> String {
    raw.trim()
        .trim_start_matches("https://doi.org/")
        .trim_start_matches("http://doi.org/")
        .trim_start_matches("https://dx.doi.org/")
        .trim_start_matches("http://dx.doi.org/")
        .trim_start_matches("doi:")
        .trim()
        .trim_end_matches('.')
        .to_ascii_lowercase()
}

fn normalize_title(raw: &str) -> String {
    let collapsed: String = raw
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { ' ' })
        .collect();
    collapsed
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
        .chars()
        .take(60)
        .collect()
}

/// Suffix a/b/... when a normalized key collides, mirroring the TS
/// collisionSuffix helper.
fn collision_suffix(mut n: usize) -> String {
    let mut s = String::new();
    loop {
        s.insert(0, char::from(b'a' + (n % 26) as u8));
        if n < 26 {
            return s;
        }
        n = n / 26 - 1;
    }
}

fn entry_richness(entry: &Entry) -> usize {
    entry
        .fields
        .iter()
        .filter(|(_, chunks)| !chunks.format_verbatim().trim().is_empty())
        .count()
}

/// Replace `old` with `new` wherever it appears as a whole cite key (inside
/// `\cite{...}`, Typst `@old`, Markdown `[@old]`). Key characters per
/// BibTeX: alphanumerics and `._+-/:`.
fn replace_cite_key(source: &str, old: &str, new: &str) -> String {
    if old.is_empty() {
        return source.to_string();
    }
    let is_key_char =
        |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-' | '/' | ':');
    let mut out = String::with_capacity(source.len());
    let bytes = source;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i..].starts_with(old) {
            let before_ok = i == 0 || !is_key_char(source[..i].chars().next_back().unwrap());
            let after = &bytes[i + old.len()..];
            let after_ok = after.chars().next().map_or(true, |c| !is_key_char(c));
            if before_ok && after_ok {
                out.push_str(new);
                i += old.len();
                continue;
            }
        }
        let ch = source[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn project_text_files(root: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
        if depth > 8 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if kind.is_dir() {
                if name.starts_with('.') || name == "build" || name == "figures" || name == "assets"
                {
                    continue;
                }
                walk(&entry.path(), out, depth + 1);
            } else if matches!(
                name.rsplit('.').next(),
                Some("tex") | Some("typ") | Some("md")
            ) && !name.ends_with(".oleafly")
            {
                out.push(entry.path());
            }
        }
    }
    let mut files = Vec::new();
    walk(root, &mut files, 0);
    files
}

/// The pure cleaning pass: parse `source`, plan every action, and emit the
/// rewritten library. Exposed separately so it is unit-testable.
pub(crate) fn clean_bibtex_source(source: &str) -> Result<CleanOutcome, String> {
    let bib =
        Bibliography::parse(source).map_err(|e| format!("the library could not be parsed: {e}"))?;
    let entries_before = bib.len();
    let mut actions: Vec<CleanAction> = Vec::new();

    if source.lines().any(|l| {
        let trimmed = l.trim_start();
        trimmed.starts_with('%') && !trimmed.starts_with("%!")
    }) {
        actions.push(CleanAction::Advisory {
            key: String::new(),
            field: "Comments between entries are dropped when the library is rewritten.".into(),
        });
    }

    let mut kept: Vec<Entry> = Vec::new();

    // Pass 1: exact DOI dedupe, keeping the richer entry.
    let mut seen_dois: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for entry in bib.into_iter() {
        let doi = field_string(&entry, "doi").map(|d| normalize_doi(&d));
        let mut duplicate_of: Option<usize> = None;
        if let Some(doi) = doi.as_deref().filter(|d| !d.is_empty()) {
            if let Some(&index) = seen_dois.get(doi) {
                duplicate_of = Some(index);
            } else {
                seen_dois.insert(doi.to_string(), kept.len());
            }
        }
        match duplicate_of {
            Some(index) => {
                let (removed, kept_entry) = {
                    let keeper = &mut kept[index];
                    if entry_richness(&entry) > entry_richness(keeper) {
                        // The newcomer wins; swap so the richer entry stays.
                        let loser = std::mem::replace(keeper, entry);
                        (loser.key.clone(), keeper.key.clone())
                    } else {
                        (entry.key.clone(), keeper.key.clone())
                    }
                };
                actions.push(CleanAction::RemovedDuplicate {
                    removed,
                    kept: kept_entry,
                    by: "doi".into(),
                });
            }
            None => kept.push(entry),
        }
    }

    // Pass 2: fuzzy title + year dedupe among survivors.
    let mut i = 0;
    while i < kept.len() {
        let mut j = i + 1;
        while j < kept.len() {
            let title_i = normalize_title(&field_string(&kept[i], "title").unwrap_or_default());
            let title_j = normalize_title(&field_string(&kept[j], "title").unwrap_or_default());
            let year_i: i64 = year_string(&kept[i]).parse().unwrap_or(0);
            let year_j: i64 = year_string(&kept[j]).parse().unwrap_or(0);
            let years_compatible =
                year_i == 0 || year_j == 0 || (year_i - year_j).abs() <= YEAR_WINDOW;
            let similar = !title_i.is_empty() && title_i == title_j;
            let fuzzy = !similar
                && !title_i.is_empty()
                && !title_j.is_empty()
                && years_compatible
                && rapidfuzz::distance::levenshtein::normalized_similarity(
                    title_i.chars(),
                    title_j.chars(),
                ) >= FUZZY_TITLE_THRESHOLD;
            if (similar || fuzzy) && years_compatible {
                let removed = kept[j].key.clone();
                let keeper = kept[i].key.clone();
                if entry_richness(&kept[j]) > entry_richness(&kept[i]) {
                    kept.swap(i, j);
                }
                kept.remove(j);
                actions.push(CleanAction::RemovedDuplicate {
                    removed,
                    kept: keeper,
                    by: if similar {
                        "title".into()
                    } else {
                        "similar title".into()
                    },
                });
            } else {
                j += 1;
            }
        }
        i += 1;
    }

    // Pass 3: rename keys to the app scheme, keeping each key unique.
    let mut taken: std::collections::HashSet<String> = std::collections::HashSet::new();
    for index in 0..kept.len() {
        let (entry_key, author, year, title, has_author, has_title) = {
            let entry = &kept[index];
            (
                entry.key.clone(),
                author_string(entry),
                year_string(entry),
                field_string(entry, "title").unwrap_or_default(),
                field_string(entry, "author").is_some(),
                field_string(entry, "title").is_some(),
            )
        };
        if !has_author {
            actions.push(CleanAction::Advisory {
                key: entry_key.clone(),
                field: "missing author".into(),
            });
        }
        if !has_title {
            actions.push(CleanAction::Advisory {
                key: entry_key.clone(),
                field: "missing title".into(),
            });
        }
        if year.is_empty() {
            actions.push(CleanAction::Advisory {
                key: entry_key.clone(),
                field: "missing year".into(),
            });
        }
        let desired = crate::citation::cite_key(&author, &year, &title);
        if desired.is_empty() || desired == entry_key {
            taken.insert(entry_key);
            continue;
        }
        let mut final_key = desired.clone();
        let mut n = 0;
        while taken.contains(&final_key)
            || (0..kept.len()).any(|j| j != index && kept[j].key == final_key)
        {
            final_key = format!("{}{}", desired, collision_suffix(n));
            n += 1;
        }
        actions.push(CleanAction::RenamedKey {
            old: entry_key,
            new: final_key.clone(),
        });
        kept[index].key = final_key.clone();
        taken.insert(final_key);
    }

    let mut cleaned_bib = Bibliography::new();
    for entry in kept {
        cleaned_bib.insert(entry);
    }
    Ok(CleanOutcome {
        original: source.to_string(),
        cleaned: cleaned_bib.to_biblatex_string(),
        entries_before,
        entries_after: cleaned_bib.len(),
        actions,
        applied: false,
    })
}

/// Clean (and optionally rewrite) one bibliography file inside a project.
#[tauri::command]
pub async fn clean_bibtex_library(
    project_id: String,
    bib_path: String,
    apply: bool,
) -> Result<CleanOutcome, String> {
    let root = crate::paths::project_dir(&project_id)?;
    let rel = Path::new(&bib_path);
    if rel
        .components()
        .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err("the bibliography path must stay inside the project".into());
    }
    let target = root.join(rel);
    let read_target = target.clone();
    let source = tauri::async_runtime::spawn_blocking(move || std::fs::read_to_string(read_target))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("could not read {bib_path}: {e}"))?;

    let mut outcome = clean_bibtex_source(&source)?;
    if !apply {
        return Ok(outcome);
    }

    // Rewrite the bibliography and every source file citing a renamed key.
    let mut renames: Vec<(String, String)> = Vec::new();
    for action in &outcome.actions {
        if let CleanAction::RenamedKey { old, new } = action {
            renames.push((old.clone(), new.clone()));
        }
    }
    let write_root = root.clone();
    let write_target = target.clone();
    let cleaned = outcome.cleaned.clone();
    let write = move || -> Result<(), String> {
        atomic_write(&write_target, cleaned.as_bytes())?;
        for file in project_text_files(&write_root) {
            let Ok(text) = std::fs::read_to_string(&file) else {
                continue;
            };
            let mut updated = text.clone();
            let mut changed = false;
            for (old, new) in &renames {
                let next = replace_cite_key(&updated, old, new);
                if next != updated {
                    updated = next;
                    changed = true;
                }
            }
            if changed {
                atomic_write(&file, updated.as_bytes())?;
            }
        }
        Ok(())
    };
    tauri::async_runtime::spawn_blocking(write)
        .await
        .map_err(|e| e.to_string())??;
    outcome.applied = true;
    Ok(outcome)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let mut writer = std::io::BufWriter::new(file);
    std::io::Write::write_all(&mut writer, bytes).map_err(|e| e.to_string())?;
    std::io::Write::flush(&mut writer).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIRTY: &str = r#"
@article{vaswani2023attention,
  author = {Vaswani, Ashish and Shazeer, Noam},
  title = {Attention Is All You Need},
  journal = {NeurIPS},
  year = {2017},
  doi = {10.5555/3294771.3294844},
}
@Article{vaswani17,
  author = {Vaswani, Ashish},
  title = {Attention Is All You Need},
  year = {2017},
  doi = {10.5555/3294771.3294844},
}
@inproceedings{SMITH2020_deep,
  author = {Smith, Jane},
  title = {A Very Deep Study of Attention Mechanisms},
  booktitle = {ICML},
  year = {2020},
}
@misc{john2020x,
  author = {John Doe},
  title = {A Very Deep Study of Attention Mechanism},
  year = {2021},
}
@article{incomplete2020,
  title = {Only A Title},
}
"#;

    #[test]
    fn doi_and_fuzzy_duplicates_are_removed_and_keys_normalized() {
        let outcome = clean_bibtex_source(DIRTY).unwrap();
        assert_eq!(outcome.entries_before, 5);
        assert_eq!(outcome.entries_after, 3);
        let removed: Vec<_> = outcome
            .actions
            .iter()
            .filter_map(|a| match a {
                CleanAction::RemovedDuplicate { removed, by, .. } => {
                    Some((removed.clone(), by.clone()))
                }
                _ => None,
            })
            .collect();
        assert!(
            removed
                .iter()
                .any(|(r, by)| r == "vaswani17" && by == "doi"),
            "{removed:?}"
        );
        assert!(
            removed
                .iter()
                .any(|(r, by)| by == "similar title" && (r == "SMITH2020_deep" || r == "john2020x")),
            "{removed:?}"
        );
        let renamed: Vec<_> = outcome
            .actions
            .iter()
            .filter_map(|a| match a {
                CleanAction::RenamedKey { old, new } => Some((old.clone(), new.clone())),
                _ => None,
            })
            .collect();
        assert!(
            renamed
                .iter()
                .any(|(old, new)| old == "vaswani2023attention" && new == "vaswani2017attention"),
            "{renamed:?}"
        );
        // Richer duplicate wins: the kept entry keeps both authors.
        assert!(outcome.cleaned.contains("Shazeer"));
        // Advisories fire for the entry missing author/year.
        assert!(outcome
            .actions
            .iter()
            .any(|a| matches!(a, CleanAction::Advisory { key, field } if key == "incomplete2020" && field.contains("author"))));
    }

    #[test]
    fn cite_key_replacement_respects_boundaries() {
        let source = r"\cite{old} and \cite{old,other} and \cite{boldold} and @old and [@old]";
        let out = replace_cite_key(source, "old", "new");
        assert_eq!(
            out,
            r"\cite{new} and \cite{new,other} and \cite{boldold} and @new and [@new]"
        );
        let swapped = replace_cite_key("prefixold", "old", "new");
        assert_eq!(swapped, "prefixold");
    }

    #[test]
    fn broken_libraries_error_clearly() {
        let err = clean_bibtex_source("@article{a,\n  title={Unclosed\n}").unwrap_err();
        assert!(err.contains("could not be parsed"), "{err}");
    }
}
