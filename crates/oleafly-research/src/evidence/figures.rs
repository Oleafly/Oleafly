//! Figures: images a task added should be used somewhere, and every figure
//! the changed text refers to should exist.
use std::collections::BTreeSet;
use std::path::Path;

const IMAGE_EXTENSIONS: [&str; 8] = ["png", "jpg", "jpeg", "pdf", "svg", "eps", "gif", "webp"];
const TEXT_EXTENSIONS: [&str; 3] = ["tex", "typ", "md"];
/// LaTeX finds a graphic without its extension in this order.
const GRAPHIC_SUFFIXES: [&str; 5] = ["", ".pdf", ".png", ".jpg", ".eps"];

fn extension(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .unwrap_or_default()
        .to_ascii_lowercase()
}

pub(crate) fn is_image(path: &str) -> bool {
    IMAGE_EXTENSIONS.contains(&extension(path).as_str())
}

pub(crate) fn is_text(path: &str) -> bool {
    TEXT_EXTENSIONS.contains(&extension(path).as_str())
}

fn argument_after(text: &str, at: usize, open: char, close: char) -> Option<&str> {
    let rest = &text[at..];
    let start = rest.find(open)? + 1;
    let end = rest[start..].find(close)? + start;
    Some(&rest[start..end])
}

/// The figure paths a text file refers to: `\includegraphics[...]{p}`,
/// `image("p")` and `![alt](p)`. Backslashes become slashes.
pub fn figure_references(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    for (at, _) in text.match_indices("\\includegraphics") {
        let rest = &text[at + "\\includegraphics".len()..];
        let skip_options = if rest.trim_start().starts_with('[') {
            rest.find(']').map(|end| end + 1).unwrap_or(0)
        } else {
            0
        };
        let base = at + "\\includegraphics".len() + skip_options;
        if let Some(path) = argument_after(text, base, '{', '}') {
            found.push(path.trim().to_owned());
        }
    }
    for (at, _) in text.match_indices("image(") {
        if let Some(path) = argument_after(text, at, '"', '"') {
            found.push(path.trim().to_owned());
        }
    }
    for (at, _) in text.match_indices("](") {
        let before = &text[..at];
        // Only an image: `![alt](path)` with nothing in between.
        if before
            .rfind("![")
            .is_some_and(|open| !before[open..].contains('\n') && !before[open..].contains("]("))
        {
            if let Some(path) = argument_after(text, at + 1, '(', ')') {
                let path = path.split_whitespace().next().unwrap_or_default();
                if !path.contains("://") {
                    found.push(path.to_owned());
                }
            }
        }
    }
    found
        .into_iter()
        .map(|path| path.replace('\\', "/"))
        .filter(|path| !path.is_empty())
        .collect()
}

/// Resolves a reference made from `from` (a workspace file) against the
/// files that exist, as LaTeX, Typst and Markdown would.
pub fn resolve_reference(
    reference: &str,
    from: &str,
    existing: &BTreeSet<String>,
) -> Option<String> {
    let reference = reference.trim_start_matches("./");
    let directory = Path::new(from)
        .parent()
        .map(|parent| parent.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    let mut candidates = vec![reference.to_owned()];
    if !directory.is_empty() {
        candidates.push(format!("{directory}/{reference}"));
    }
    for candidate in candidates {
        for suffix in GRAPHIC_SUFFIXES {
            let path = normalize(&format!("{candidate}{suffix}"));
            if existing.contains(&path) {
                return Some(path);
            }
        }
    }
    None
}

fn normalize(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            part => parts.push(part),
        }
    }
    parts.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn references_are_found_in_three_syntaxes() {
        let text = "\\includegraphics[width=0.5\\linewidth]{figures\\loss}\n#image(\"plots/acc.png\")\n![Curve](img/curve.svg \"title\") and [link](https://x.org)";
        assert_eq!(
            figure_references(text),
            vec![
                "figures/loss".to_owned(),
                "plots/acc.png".to_owned(),
                "img/curve.svg".to_owned()
            ]
        );
    }

    #[test]
    fn references_resolve_with_default_extensions_and_relative_folders() {
        let existing: BTreeSet<String> = ["figures/loss.pdf", "chapters/img/a.png"]
            .into_iter()
            .map(String::from)
            .collect();
        assert_eq!(
            resolve_reference("figures/loss", "main.tex", &existing).as_deref(),
            Some("figures/loss.pdf")
        );
        assert_eq!(
            resolve_reference("img/a.png", "chapters/one.md", &existing).as_deref(),
            Some("chapters/img/a.png")
        );
        assert_eq!(
            resolve_reference("missing.png", "main.tex", &existing),
            None
        );
    }
}
