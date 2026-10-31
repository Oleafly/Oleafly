use oleafly_preflight::text::{is_letter, is_mark, is_number};

fn trim_edges(text: &str, start: impl Fn(char) -> bool, end: impl Fn(char) -> bool) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut from = 0;
    let mut to = chars.len();
    while from < to && !start(chars[from]) {
        from += 1;
    }
    while to > from && !end(chars[to - 1]) {
        to -= 1;
    }
    chars[from..to].iter().collect()
}

pub fn without_soft_hyphens(text: &str) -> String {
    text.replace('\u{AD}', "")
}

pub fn trim_to_word_characters(text: &str) -> String {
    trim_edges(
        text,
        |ch| is_letter(ch) || is_number(ch),
        |ch| is_letter(ch) || is_mark(ch) || is_number(ch),
    )
}

pub fn trim_to_letters(text: &str) -> String {
    trim_edges(text, is_letter, |ch| is_letter(ch) || is_mark(ch))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edges_trim_to_words_and_letters() {
        assert_eq!(trim_to_word_characters("(“IEEE754”),"), "IEEE754");
        assert_eq!(trim_to_letters("42nd!"), "nd");
        assert_eq!(trim_to_letters("e\u{301}."), "e\u{301}");
        assert_eq!(without_soft_hyphens("Ole\u{AD}afly"), "Oleafly");
        assert_eq!(trim_to_word_characters("--"), "");
    }
}
