pub const ENGLISH: &str = "en";

pub const LOCALES: [&str; 22] = [
    "en", "zh-Hans", "zh-Hant", "de", "fr", "es", "it", "nl", "pt-BR", "pl", "ru", "uk", "tr",
    "cs", "da", "sv", "nb", "fi", "ro", "ja", "ko", "vi",
];

pub fn supported(tag: &str) -> Option<&'static str> {
    LOCALES
        .into_iter()
        .find(|supported| supported.eq_ignore_ascii_case(tag))
}

fn quality(parameters: std::str::Split<'_, char>) -> Option<u16> {
    let mut weight = 1000;
    for parameter in parameters {
        let Some((name, value)) = parameter.split_once('=') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case("q") {
            let value: f64 = value.trim().parse().ok()?;
            if !(0.0..=1.0).contains(&value) {
                return None;
            }
            weight = (value * 1000.0).round() as u16;
        }
    }
    Some(weight)
}

fn supported_or_fallback(candidate: &str) -> Option<&'static str> {
    let fallback = match candidate {
        "pt" | "pt-PT" => Some("pt-BR"),
        "no" | "nn" => Some("nb"),
        _ => None,
    };
    supported(candidate).or_else(|| fallback.and_then(supported))
}

pub fn matching(tag: &str) -> Option<&'static str> {
    let lowered = tag.trim().to_ascii_lowercase();
    let parts: Vec<&str> = lowered
        .split(['-', '_'])
        .filter(|part| !part.is_empty())
        .collect();
    let (&language, rest) = parts.split_first()?;
    if language == "zh" {
        let traditional = rest
            .iter()
            .any(|part| matches!(*part, "hant" | "tw" | "hk" | "mo"));
        return supported(if traditional { "zh-Hant" } else { "zh-Hans" });
    }
    let region = rest
        .iter()
        .find(|part| part.len() == 2 && part.chars().all(|c| c.is_ascii_alphabetic()))
        .map(|region| format!("{language}-{}", region.to_ascii_uppercase()));
    region
        .as_deref()
        .and_then(supported_or_fallback)
        .or_else(|| supported_or_fallback(language))
}

pub fn negotiate(accept_language: &str) -> &'static str {
    let mut ranges: Vec<(u16, usize, &str)> = accept_language
        .split(',')
        .enumerate()
        .filter_map(|(index, range)| {
            let mut pieces = range.split(';');
            let tag = pieces.next()?.trim();
            let weight = quality(pieces)?;
            (!tag.is_empty() && weight > 0).then_some((weight, index, tag))
        })
        .collect();
    ranges.sort_by_key(|&(weight, index, _)| (std::cmp::Reverse(weight), index));
    ranges
        .into_iter()
        .find_map(|(_, _, tag)| matching(tag))
        .unwrap_or(ENGLISH)
}

pub fn fill(template: &str, values: &[(&str, &str)]) -> String {
    let mut filled = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(open) = rest.find('{') {
        filled.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let value = after.find('}').and_then(|close| {
            let name = &after[..close];
            values
                .iter()
                .find(|(candidate, _)| *candidate == name)
                .map(|(_, value)| (*value, close))
        });
        match value {
            Some((value, close)) => {
                filled.push_str(value);
                rest = &after[close + 1..];
            }
            None => {
                filled.push('{');
                rest = after;
            }
        }
    }
    filled.push_str(rest);
    filled
}

pub fn placeholders(text: &str) -> Vec<&str> {
    let mut names: Vec<&str> = text
        .split('{')
        .skip(1)
        .filter_map(|rest| rest.split_once('}').map(|(name, _)| name))
        .collect();
    names.sort_unstable();
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_languages_are_the_apps() {
        assert_eq!(LOCALES.len(), 22);
        assert_eq!(LOCALES[0], ENGLISH);
        assert_eq!(supported("PT-br"), Some("pt-BR"));
        assert_eq!(supported("pt"), None);
        assert_eq!(supported("xx"), None);
    }

    #[test]
    fn an_exact_language_is_used_as_is() {
        for tag in LOCALES {
            assert_eq!(negotiate(tag), tag);
        }
        assert_eq!(negotiate("zh-hans"), "zh-Hans");
        assert_eq!(negotiate(" de "), "de");
    }

    #[test]
    fn a_region_falls_back_to_its_language_the_way_the_app_does() {
        for (asked, expected) in [
            ("de-AT", "de"),
            ("es-419", "es"),
            ("sv_SE", "sv"),
            ("pt", "pt-BR"),
            ("pt-PT", "pt-BR"),
            ("nn", "nb"),
            ("no", "nb"),
            ("zh", "zh-Hans"),
            ("zh-CN", "zh-Hans"),
            ("zh-TW", "zh-Hant"),
            ("zh-HK", "zh-Hant"),
            ("zh-Hant-HK", "zh-Hant"),
        ] {
            assert_eq!(matching(asked), Some(expected), "{asked}");
        }
        assert_eq!(matching("tlh"), None);
    }

    #[test]
    fn quality_values_set_the_order_and_anything_else_gets_english() {
        for (asked, expected) in [
            ("en;q=0.5, de;q=0.9", "de"),
            ("it;q=0.4, nl;q=0.4", "it"),
            ("de;q=0, fr;q=0.1", "fr"),
            ("de;q=1.5, fr;q=0.5", "fr"),
            ("ru ; q = 0.3, uk; q=0.6", "uk"),
            ("", "en"),
            ("xx, tlh-KL", "en"),
            ("*", "en"),
            (",,;;,", "en"),
        ] {
            assert_eq!(negotiate(asked), expected, "{asked:?}");
        }
    }

    #[test]
    fn values_fill_their_placeholders_once() {
        assert_eq!(fill("{a}{b} {c", &[("a", "{b}"), ("b", "2")]), "{b}2 {c");
        assert_eq!(fill("{x} and {", &[]), "{x} and {");
        assert_eq!(placeholders("{b} then {a} and {"), ["a", "b"]);
    }
}
