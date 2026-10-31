use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

pub const TITLE_MATCH_THRESHOLD: f32 = 0.92;

const MAX_TITLE_CHARS: usize = 512;

pub fn normalize_title(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    let mut space = false;
    for character in title
        .nfkd()
        .filter(|character| !is_combining_mark(*character))
    {
        if character.is_alphanumeric() {
            if space && !out.is_empty() {
                out.push(' ');
            }
            space = false;
            out.extend(character.to_lowercase());
        } else {
            space = true;
        }
        if out.len() >= MAX_TITLE_CHARS * 4 {
            break;
        }
    }
    out
}

fn tokens(text: &str) -> usize {
    text.split(' ').filter(|word| !word.is_empty()).count()
}

fn levenshtein(left: &[char], right: &[char]) -> usize {
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    let mut current = vec![0; right.len() + 1];
    for (i, a) in left.iter().enumerate() {
        current[0] = i + 1;
        for (j, b) in right.iter().enumerate() {
            let substitution = previous[j] + usize::from(a != b);
            current[j + 1] = substitution.min(previous[j + 1] + 1).min(current[j] + 1);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[right.len()]
}

fn similarity(left: &str, right: &str) -> f32 {
    let left: Vec<char> = left.chars().take(MAX_TITLE_CHARS).collect();
    let right: Vec<char> = right.chars().take(MAX_TITLE_CHARS).collect();
    let longest = left.len().max(right.len());
    if longest == 0 {
        return 0.0;
    }
    1.0 - levenshtein(&left, &right) as f32 / longest as f32
}

pub fn title_match_score(query: &str, title: &str, subtitle: Option<&str>) -> f32 {
    let query = normalize_title(query);
    let title = normalize_title(title);
    if query.is_empty() || title.is_empty() {
        return 0.0;
    }
    let with_subtitle = subtitle
        .map(normalize_title)
        .filter(|subtitle| !subtitle.is_empty())
        .map(|subtitle| format!("{title} {subtitle}"));
    let candidates: Vec<&str> = std::iter::once(title.as_str())
        .chain(with_subtitle.as_deref())
        .collect();
    if candidates.iter().any(|candidate| *candidate == query) {
        return 1.0;
    }
    let extends = |long: &str, short: &str| long.starts_with(&format!("{short} "));
    if tokens(&query) >= 4
        && candidates
            .iter()
            .any(|candidate| extends(candidate, &query))
    {
        return 0.95;
    }
    if tokens(&title) >= 4 && extends(&query, &title) {
        return 0.95;
    }
    candidates
        .iter()
        .map(|candidate| similarity(&query, candidate))
        .fold(0.0, f32::max)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_match_across_case_punctuation_and_accents() {
        assert_eq!(
            title_match_score(
                "Attention Is All You Need",
                "Attention is all you need.",
                None
            ),
            1.0
        );
        assert_eq!(title_match_score("Über Graphen", "Uber graphen", None), 1.0);
    }

    #[test]
    fn a_subtitle_on_either_side_still_matches() {
        assert!(
            title_match_score(
                "Deep Residual Learning for Image Recognition",
                "Deep residual learning for image recognition: a study",
                None
            ) >= TITLE_MATCH_THRESHOLD
        );
        assert!(
            title_match_score(
                "Graph neural networks: a review",
                "Graph Neural Networks",
                Some("A Review")
            ) >= TITLE_MATCH_THRESHOLD
        );
    }

    #[test]
    fn a_negated_or_different_title_does_not_match() {
        assert!(
            title_match_score(
                "Attention Is All You Need",
                "Attention Is Not All You Need",
                None
            ) < TITLE_MATCH_THRESHOLD
        );
        assert!(title_match_score("BERT", "RoBERTa", None) < TITLE_MATCH_THRESHOLD);
    }

    #[test]
    fn empty_titles_never_match() {
        assert_eq!(title_match_score("", "Anything", None), 0.0);
        assert_eq!(title_match_score("—", "…", None), 0.0);
    }

    #[test]
    fn normalizing_collapses_symbols_and_keeps_scripts() {
        assert_eq!(
            normalize_title("  Graph—Neural  Nets!! "),
            "graph neural nets"
        );
        assert_eq!(normalize_title("深度学习: 综述"), "深度学习 综述");
    }
}
