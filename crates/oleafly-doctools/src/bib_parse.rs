//! Parsing a BibTeX or BibLaTeX library with biblatex, safely. biblatex 0.12
//! follows `crossref` and `xdata` links recursively without checking for a
//! loop, so a library where an entry leads back to itself (`crossref={x}` in
//! `x`, or `a` → `b` → `a`) overflows the stack and aborts the whole process.
//! [`parse_library`] refuses such a library instead.
use std::collections::HashMap;

use biblatex::{Bibliography, RawBibliography};

pub fn parse_library(source: &str) -> Result<Bibliography, String> {
    let raw = RawBibliography::parse(source).map_err(|error| error.to_string())?;
    if let Some(key) = linked_loop(source, &raw) {
        return Err(format!(
            "the entry {key} leads back to itself through crossref or xdata"
        ));
    }
    Bibliography::from_raw(raw).map_err(|error| error.to_string())
}

fn linked_loop<'s>(source: &'s str, raw: &RawBibliography<'s>) -> Option<&'s str> {
    first_loop(&entry_links(source, raw))
}

/// Each entry's key with the keys its `crossref` and `xdata` fields name,
/// read from the source (a parsed bibliography drops `xdata`).
pub(crate) fn entry_links<'s>(
    source: &'s str,
    raw: &RawBibliography<'s>,
) -> HashMap<&'s str, Vec<String>> {
    let abbreviations: HashMap<&str, &str> = raw
        .abbreviations
        .iter()
        .map(|pair| (pair.key.v, &source[pair.value.span.clone()]))
        .collect();
    let mut links: HashMap<&str, Vec<String>> = HashMap::new();
    for entry in &raw.entries {
        let targets = links.entry(entry.v.key.v).or_default();
        for field in &entry.v.fields {
            let name = field.key.v.to_ascii_lowercase();
            if name != "crossref" && name != "xdata" {
                continue;
            }
            let text = &source[field.value.span.clone()];
            let text = abbreviations.get(text.trim()).copied().unwrap_or(text);
            let text = unbraced(text);
            if name == "crossref" {
                targets.push(text);
            } else {
                targets.extend(text.split(',').map(|key| key.trim().to_string()));
            }
        }
    }
    links
}

/// The value without its braces and quotes, as biblatex reads a key.
fn unbraced(text: &str) -> String {
    text.chars()
        .filter(|ch| !matches!(ch, '{' | '}' | '"'))
        .collect::<String>()
        .trim()
        .to_string()
}

fn first_loop<'s>(links: &HashMap<&'s str, Vec<String>>) -> Option<&'s str> {
    #[derive(Clone, Copy, PartialEq)]
    enum Mark {
        OnPath,
        Done,
    }
    let mut marks: HashMap<&str, Mark> = HashMap::new();
    let mut starts: Vec<&str> = links.keys().copied().collect();
    starts.sort_unstable();
    for start in starts {
        if marks.contains_key(start) {
            continue;
        }
        let mut path: Vec<(&str, usize)> = vec![(start, 0)];
        marks.insert(start, Mark::OnPath);
        while let Some(&(key, next)) = path.last() {
            let Some(target) = links[key].get(next) else {
                marks.insert(key, Mark::Done);
                path.pop();
                continue;
            };
            if let Some(step) = path.last_mut() {
                step.1 += 1;
            }
            let Some((&target, _)) = links.get_key_value(target.as_str()) else {
                continue;
            };
            match marks.get(target) {
                Some(Mark::OnPath) => return Some(target),
                Some(Mark::Done) => {}
                None => {
                    marks.insert(target, Mark::OnPath);
                    path.push((target, 0));
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_library_with_ordinary_links() {
        let source = "@book{parent, title={The Book}, doi={10.1/x}}\n\
                      @inbook{child, crossref={parent}, chapter={2}}\n\
                      @xdata{shared, publisher={Press}}\n\
                      @book{other, xdata={shared}, title={Other}}";
        let bibliography = parse_library(source).unwrap();
        assert_eq!(bibliography.len(), 4);
        let child = bibliography.get("child").unwrap();
        assert!(
            child.get("doi").is_some(),
            "the child inherits its parent's fields"
        );
    }

    #[test]
    fn refuses_an_entry_that_links_to_itself() {
        let error = parse_library("@book{x, title={T}, crossref={x}}").unwrap_err();
        assert!(error.contains("x leads back to itself"), "{error}");
    }

    #[test]
    fn refuses_longer_loops_through_crossref_and_xdata() {
        let crossref = "@book{a, crossref={b}}\n@book{b, crossref = \"a\"}";
        assert!(parse_library(crossref).is_err());
        let xdata = "@xdata{a, xdata={c, b}}\n@xdata{b, title={B}}\n@xdata{c, xdata={a}}";
        assert!(parse_library(xdata).is_err());
        let through_abbreviation = "@string{parent = \"p\"}\n@book{p, crossref=parent}";
        assert!(parse_library(through_abbreviation).is_err());
    }

    #[test]
    fn a_link_to_a_missing_entry_is_not_a_loop() {
        assert!(parse_library("@inbook{child, crossref={nowhere}, title={T}}").is_ok());
    }

    #[test]
    fn keeps_biblatex_parse_errors() {
        let error = parse_library("@book{a, title={T}}\n@book{a, title={U}}").unwrap_err();
        assert_eq!(
            error,
            Bibliography::parse("@book{a, title={T}}\n@book{a, title={U}}")
                .unwrap_err()
                .to_string()
        );
    }
}
