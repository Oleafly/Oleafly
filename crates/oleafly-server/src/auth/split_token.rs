use crate::tokens::{hash_token, random_token};

const SELECTOR_LENGTH: usize = 22;

pub struct SplitToken {
    pub token: String,
    pub selector: String,
    pub verifier_hash: String,
}

pub fn generate() -> SplitToken {
    let selector: String = random_token().chars().take(SELECTOR_LENGTH).collect();
    let verifier = random_token();
    SplitToken {
        token: format!("{selector}.{verifier}"),
        verifier_hash: hash_token(&verifier),
        selector,
    }
}

fn token_part(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 64
        && text
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

pub fn parse(token: &str) -> Option<(&str, &str)> {
    let (selector, verifier) = token.split_once('.')?;
    (token_part(selector) && token_part(verifier)).then_some((selector, verifier))
}

pub fn verifier_matches(verifier: &str, stored_hash: &str) -> bool {
    constant_time_eq(hash_token(verifier).as_bytes(), stored_hash.as_bytes())
}

pub fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let difference = left
        .iter()
        .zip(right)
        .fold(0u8, |difference, (a, b)| difference | (a ^ b));
    std::hint::black_box(difference) == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tokens::hash_token;

    #[test]
    fn a_split_token_is_a_selector_and_a_secret_whose_hash_is_kept() {
        let split = generate();
        let (selector, verifier) = parse(&split.token).expect("the token parses");
        assert_eq!(selector, split.selector);
        assert_eq!(selector.len(), 22);
        assert_eq!(verifier.len(), 43);
        assert_eq!(split.verifier_hash, hash_token(verifier));
        assert!(!split.token.contains(&split.verifier_hash));
        assert!(verifier_matches(verifier, &split.verifier_hash));
        assert!(!verifier_matches("guess", &split.verifier_hash));
        assert_ne!(generate().token, split.token);
    }

    #[test]
    fn malformed_tokens_do_not_parse() {
        for bad in [
            "",
            "no-dot",
            ".verifier",
            "selector.",
            "a.b.c",
            "sel ector.verifier",
            "selector.veri+fier",
        ] {
            assert!(parse(bad).is_none(), "{bad}");
        }
        assert_eq!(parse("abc_-.DEF-_"), Some(("abc_-", "DEF-_")));
    }

    #[test]
    fn equal_bytes_compare_equal_and_anything_else_does_not() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(constant_time_eq(b"", b""));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }
}
