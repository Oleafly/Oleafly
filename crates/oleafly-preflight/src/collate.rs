//! An approximation of `String.prototype.localeCompare` with the default
//! (root) collation, which the project index uses to order files.
//!
//! Punctuation and symbols sort before digits and digits before letters, in
//! the CLDR root order; letters compare without case first and lower case
//! wins a tie. Accented letters compare by their base letter first. This is
//! exact for the ASCII paths projects use; other scripts fall back to code
//! point order after the Latin letters.

use std::cmp::Ordering;

use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// CLDR root order of ASCII punctuation and symbols (all sort before digits).
const PUNCTUATION: &str = "\t\n\u{b}\u{c}\r _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";

fn primary(ch: char) -> u32 {
    if let Some(index) = PUNCTUATION.find(ch) {
        return 1 + index as u32;
    }
    if ch.is_ascii_digit() {
        return 100 + (ch as u32 - '0' as u32);
    }
    if ch.is_ascii_alphabetic() {
        return 200 + (ch.to_ascii_lowercase() as u32 - 'a' as u32);
    }
    1000 + ch as u32
}

struct Key {
    primary: Vec<u32>,
    secondary: Vec<u32>,
    tertiary: Vec<u8>,
}

fn key(text: &str) -> Key {
    let mut key = Key {
        primary: Vec::new(),
        secondary: Vec::new(),
        tertiary: Vec::new(),
    };
    for ch in text.nfd() {
        if is_combining_mark(ch) {
            if let Some(last) = key.secondary.last_mut() {
                *last = last.wrapping_mul(31).wrapping_add(ch as u32);
            }
            continue;
        }
        let base = if ch.is_ascii() {
            ch
        } else {
            ch.to_lowercase().next().unwrap_or(ch)
        };
        key.primary.push(primary(base));
        key.secondary.push(0);
        key.tertiary.push(u8::from(ch.is_uppercase()));
    }
    key
}

pub fn locale_compare(left: &str, right: &str) -> Ordering {
    let left = key(left);
    let right = key(right);
    left.primary
        .cmp(&right.primary)
        .then_with(|| left.secondary.cmp(&right.secondary))
        .then_with(|| left.tertiary.cmp(&right.tertiary))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn letters_ignore_case_first_and_lower_case_wins_ties() {
        assert_eq!(locale_compare("a.tex", "B.tex"), Ordering::Less);
        assert_eq!(locale_compare("a.tex", "A.tex"), Ordering::Less);
        assert_eq!(
            locale_compare("refs.bib", "refs-old.bib"),
            Ordering::Greater
        );
    }

    #[test]
    fn punctuation_sorts_before_digits_and_letters() {
        assert_eq!(locale_compare("main_x.tex", "main.tex"), Ordering::Less);
        assert_eq!(locale_compare("a/b.tex", "a.tex"), Ordering::Greater);
        assert_eq!(locale_compare("ch1.tex", "cha.tex"), Ordering::Less);
    }
}
