use std::collections::HashMap;
use std::sync::OnceLock;

use oleafly_collab_protocol::language;
use oleafly_collab_protocol::page::escape;

type Catalog = HashMap<String, String>;

const SOURCES: [(&str, &str); 21] = [
    ("en", include_str!("../../locales/en.json")),
    ("zh-Hans", include_str!("../../locales/zh-Hans.json")),
    ("zh-Hant", include_str!("../../locales/zh-Hant.json")),
    ("de", include_str!("../../locales/de.json")),
    ("fr", include_str!("../../locales/fr.json")),
    ("es", include_str!("../../locales/es.json")),
    ("it", include_str!("../../locales/it.json")),
    ("nl", include_str!("../../locales/nl.json")),
    ("pt-BR", include_str!("../../locales/pt-BR.json")),
    ("pl", include_str!("../../locales/pl.json")),
    ("ru", include_str!("../../locales/ru.json")),
    ("uk", include_str!("../../locales/uk.json")),
    ("tr", include_str!("../../locales/tr.json")),
    ("cs", include_str!("../../locales/cs.json")),
    ("da", include_str!("../../locales/da.json")),
    ("sv", include_str!("../../locales/sv.json")),
    ("nb", include_str!("../../locales/nb.json")),
    ("fi", include_str!("../../locales/fi.json")),
    ("ro", include_str!("../../locales/ro.json")),
    ("ja", include_str!("../../locales/ja.json")),
    ("ko", include_str!("../../locales/ko.json")),
];

macro_rules! texts {
    ($($variant:ident => $key:literal,)*) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub(crate) enum Text {
            $($variant,)*
        }

        impl Text {
            #[cfg(test)]
            pub(crate) const ALL: &[Text] = &[$(Text::$variant,)*];

            pub(crate) fn key(self) -> &'static str {
                match self {
                    $(Text::$variant => $key,)*
                }
            }
        }
    };
}

texts! {
    SignedInTitle => "signed_in.title",
    SignedInBody => "signed_in.body",
    SignedInNext => "signed_in.next",
    RefusedTitle => "refused.title",
    RefusedHeading => "refused.heading",
    RefusedEmailAccount => "refused.email_account",
    RefusedEmail => "refused.email",
    RefusedEmailNext => "refused.email_next",
    RefusedProviderAccount => "refused.provider_account",
    RefusedProvider => "refused.provider",
    RefusedProviderNext => "refused.provider_next",
    CancelledTitle => "cancelled.title",
    CancelledBody => "cancelled.body",
    CancelledNext => "cancelled.next",
    SetupCodeTitle => "setup_code.title",
    SetupCodeBody => "setup_code.body",
    SetupCodeNext => "setup_code.next",
    ProviderFailedHeading => "provider_failed.heading",
    ProviderFailedBody => "provider_failed.body",
    ProviderFailedNext => "provider_failed.next",
    ExpiredTitle => "expired.title",
    ExpiredBody => "expired.body",
    StartAgain => "start_again",
    DeviceInUseTitle => "device_in_use.title",
    DeviceInUseHeading => "device_in_use.heading",
    DeviceInUseBody => "device_in_use.body",
    DeviceInUseNext => "device_in_use.next",
    OptionOffTitle => "option_off.title",
    OptionOffBody => "option_off.body",
    OptionOffNext => "option_off.next",
    UnfinishedTitle => "unfinished.title",
    UnfinishedBody => "unfinished.body",
    UnfinishedNext => "unfinished.next",
    OutOfDateTitle => "out_of_date.title",
    OutOfDateBody => "out_of_date.body",
    OtherServerTitle => "other_server.title",
    OtherServerBody => "other_server.body",
    OtherServerNext => "other_server.next",
    ElsewhereTitle => "elsewhere.title",
    ElsewhereHeading => "elsewhere.heading",
    ElsewhereBody => "elsewhere.body",
    DefaultServer => "default.server",
    DefaultProvider => "default.provider",
}

fn catalogs() -> &'static HashMap<&'static str, Catalog> {
    static CATALOGS: OnceLock<HashMap<&str, Catalog>> = OnceLock::new();
    CATALOGS.get_or_init(|| {
        SOURCES
            .iter()
            .map(|(tag, source)| (*tag, serde_json::from_str(source).unwrap_or_default()))
            .collect()
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Language(&'static str);

impl Language {
    pub(crate) fn of_request(accept_language: &str) -> Language {
        Language(language::negotiate(accept_language))
    }

    pub(crate) fn tag(self) -> &'static str {
        self.0
    }

    pub(crate) fn text(self, text: Text) -> &'static str {
        let catalogs = catalogs();
        catalogs
            .get(self.0)
            .and_then(|catalog| catalog.get(text.key()))
            .or_else(|| catalogs[language::ENGLISH].get(text.key()))
            .map_or(text.key(), String::as_str)
    }

    pub(crate) fn plain(self, text: Text, values: &[(&str, &str)]) -> String {
        language::fill(self.text(text), values)
    }

    pub(crate) fn html(self, text: Text, values: &[(&str, &str)]) -> String {
        language::fill(&escape(self.text(text)), values)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use oleafly_collab_protocol::language::{placeholders, LOCALES};

    fn parsed(tag: &str) -> Catalog {
        let source = SOURCES
            .iter()
            .find(|(candidate, _)| *candidate == tag)
            .map(|(_, source)| *source)
            .unwrap_or_else(|| panic!("{tag} has no catalog"));
        serde_json::from_str(source).unwrap_or_else(|error| panic!("{tag} is not JSON: {error}"))
    }

    #[test]
    fn the_page_speaks_every_language_the_app_does() {
        assert_eq!(SOURCES.map(|(tag, _)| tag), LOCALES);
        for tag in LOCALES {
            assert_eq!(Language::of_request(tag).tag(), tag);
        }
    }

    #[test]
    fn english_has_exactly_the_texts_the_page_uses() {
        let english: BTreeSet<String> = parsed("en").into_keys().collect();
        let used: BTreeSet<String> = Text::ALL.iter().map(|text| text.key().to_owned()).collect();
        assert_eq!(english, used);
        assert_eq!(Text::ALL.len(), used.len());
    }

    #[test]
    fn every_locale_has_every_text_with_the_same_placeholders() {
        let english = parsed("en");
        for tag in LOCALES {
            let catalog = parsed(tag);
            let mut missing: Vec<&String> = english
                .keys()
                .filter(|key| !catalog.contains_key(*key))
                .collect();
            missing.sort();
            assert!(missing.is_empty(), "{tag} is missing {missing:?}");
            let mut extra: Vec<&String> = catalog
                .keys()
                .filter(|key| !english.contains_key(*key))
                .collect();
            extra.sort();
            assert!(extra.is_empty(), "{tag} has unknown texts {extra:?}");
            for (key, text) in &catalog {
                assert!(!text.trim().is_empty(), "{tag} {key} is empty");
                assert_eq!(
                    placeholders(text),
                    placeholders(&english[key]),
                    "{tag} {key}: {text}"
                );
            }
        }
    }

    #[test]
    fn translations_are_written_in_their_own_language() {
        let english = parsed("en");
        for tag in LOCALES.into_iter().filter(|tag| *tag != language::ENGLISH) {
            let catalog = parsed(tag);
            let same = english
                .iter()
                .filter(|(key, text)| catalog.get(*key) == Some(*text))
                .count();
            assert!(same * 4 < english.len(), "{tag} is mostly English");
        }
    }

    #[test]
    fn page_text_uses_no_dashes_or_semicolons_and_keeps_the_brand() {
        let english = parsed("en");
        for tag in LOCALES {
            for (key, text) in parsed(tag) {
                for mark in ['\u{2014}', '\u{2013}', ';', '\u{ff1b}'] {
                    assert!(!text.contains(mark), "{tag} {key}: {text}");
                }
                if english[&key].contains("Oleafly") {
                    assert!(text.contains("Oleafly"), "{tag} {key}: {text}");
                }
                if english[&key].contains("Setup code") {
                    assert!(text.contains("Setup code"), "{tag} {key}: {text}");
                }
            }
        }
    }

    #[test]
    fn an_unknown_language_reads_english_and_html_escapes_only_the_template() {
        assert_eq!(
            Language::of_request("tlh").text(Text::SignedInTitle),
            "You're signed in"
        );
        assert_eq!(
            Language::of_request(language::ENGLISH)
                .html(Text::RefusedHeading, &[("server", "<b>Lab</b>")]),
            "<b>Lab</b> didn&#39;t let you in"
        );
        assert_eq!(
            Language::of_request(language::ENGLISH).plain(Text::RefusedTitle, &[("server", "Lab")]),
            "Not allowed on Lab"
        );
    }
}
