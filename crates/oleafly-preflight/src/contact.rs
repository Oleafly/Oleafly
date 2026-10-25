//! Contact detection (`packages/preflight/src/contact.ts`).

use std::sync::LazyLock;

use unicode_normalization::UnicodeNormalization;

use crate::jsre::JsRegex;
use crate::text::js_trim;

static EMAIL: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(r"[0-9A-Za-z_.+-]{1,100}@[0-9A-Za-z_-]{1,100}\.[0-9A-Za-z_.-]{1,100}")
});

// Deliberately requires either a conventional grouped number or 10-15
// contiguous digits. Candidate validation below rejects year ranges and other
// numeric résumé content before it can masquerade as a phone number. The
// separator classes hold a literal U+00A0.
static PHONE_CANDIDATE: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::fancy(concat!(
        r"(?i)(?<![\p{L}\p{N}])(?:tel\s*:\s*)?",
        r"(?:(?:\+[0-9]{1,3}[ \t",
        "\u{a0}",
        r".-]*)?(?:\(\s*[0-9]{1,5}\s*\)|[0-9]{1,5})(?:[ \t",
        "\u{a0}",
        r".-]+[0-9]{1,8}){1,6}|\+?[0-9]{10,15})",
        r"(?:[ \t",
        "\u{a0}",
        r"]*(?:x|ext(?:\.|ension)?)[ \t",
        "\u{a0}",
        r"]*[0-9]{1,6})?(?![\p{L}\p{N}])",
    ))
});

static TEL_SCHEME: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"(?i)^tel\s*:\s*"));
static EXTENSION: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(concat!(
        r"(?i)[ \t",
        "\u{a0}",
        r"]*(?:x|ext(?:\.|ension)?)[ \t",
        "\u{a0}",
        r"]*[0-9]{1,6}$",
    ))
});
static DATE_RANGE: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"^[0-9]{4}(?:\s*[-–—.]\s*[0-9]{2,4}){1,3}$"));
static CALENDAR_DATE: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"^[0-9]{1,4}[./-][0-9]{1,2}[./-][0-9]{1,4}$"));
static GPA: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"^[0-9](?:\.[0-9]+)?\s*/\s*[0-9](?:\.[0-9]+)?$"));
static MAILTO: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"(?i)mailto\s*:"));

pub fn extract_email(text: &str) -> Option<String> {
    EMAIL
        .first_str(text)
        .map(|found| found.as_str(text).to_string())
}

fn replace_first(regex: &JsRegex, text: &str) -> String {
    match regex.first_str(text) {
        Some(found) => format!("{}{}", &text[..found.start], &text[found.end..]),
        None => text.to_string(),
    }
}

pub fn extract_phone_number(text: &str) -> Option<String> {
    let normalized: String = text.nfkc().filter(|&ch| ch != '\0').collect();
    let (candidates, _) = PHONE_CANDIDATE.captures_str(&normalized);
    for found in candidates {
        let candidate = js_trim(found.as_str(&normalized));
        let without_scheme = replace_first(&TEL_SCHEME, candidate);
        let without_extension = replace_first(&EXTENSION, &without_scheme);
        let compact = js_trim(&without_extension);
        if DATE_RANGE.is_match(compact) || CALENDAR_DATE.is_match(compact) || GPA.is_match(compact)
        {
            continue;
        }
        let open_parens = compact.matches('(').count();
        let close_parens = compact.matches(')').count();
        if open_parens != close_parens || open_parens > 1 {
            continue;
        }
        let digits: Vec<u8> = compact.bytes().filter(u8::is_ascii_digit).collect();
        if digits.len() < 10 || digits.len() > 15 {
            continue;
        }
        if digits.iter().all(|&digit| digit == digits[0]) {
            continue;
        }
        return Some(js_trim(&without_scheme).to_string());
    }
    None
}

pub fn contains_contact_token(text: &str) -> bool {
    extract_email(text).is_some() || MAILTO.is_match(text) || extract_phone_number(text).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_grouped_phone_numbers_and_rejects_dates() {
        assert_eq!(
            extract_phone_number("Call +1 (555) 123-4567 today").as_deref(),
            Some("+1 (555) 123-4567")
        );
        assert_eq!(extract_phone_number("2019 - 2023"), None);
        assert_eq!(extract_phone_number("1111111111"), None);
        assert_eq!(
            extract_phone_number("tel: 555 123 4567 ext. 12").as_deref(),
            Some("555 123 4567 ext. 12")
        );
    }

    #[test]
    fn finds_emails_and_mailto_links() {
        assert_eq!(
            extract_email("x ana@example.com y").as_deref(),
            Some("ana@example.com")
        );
        assert!(contains_contact_token("\\href{mailto:ana}{Mail}"));
        assert!(!contains_contact_token("Experience"));
    }
}
