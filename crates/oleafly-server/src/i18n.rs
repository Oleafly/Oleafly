use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::OnceLock;

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::{header, HeaderMap};
use oleafly_collab_protocol::auth::AuthErrorCode;
use oleafly_collab_protocol::language;
use oleafly_collab_protocol::page::escape;

type Catalog = HashMap<String, String>;

const SOURCES: &[(&str, &str)] = &[
    ("en", include_str!("../locales/en.json")),
    ("zh-Hans", include_str!("../locales/zh-Hans.json")),
    ("zh-Hant", include_str!("../locales/zh-Hant.json")),
    ("de", include_str!("../locales/de.json")),
    ("fr", include_str!("../locales/fr.json")),
    ("es", include_str!("../locales/es.json")),
    ("it", include_str!("../locales/it.json")),
    ("nl", include_str!("../locales/nl.json")),
    ("pt-BR", include_str!("../locales/pt-BR.json")),
    ("pl", include_str!("../locales/pl.json")),
    ("ru", include_str!("../locales/ru.json")),
    ("uk", include_str!("../locales/uk.json")),
    ("tr", include_str!("../locales/tr.json")),
    ("cs", include_str!("../locales/cs.json")),
    ("da", include_str!("../locales/da.json")),
    ("sv", include_str!("../locales/sv.json")),
    ("nb", include_str!("../locales/nb.json")),
    ("fi", include_str!("../locales/fi.json")),
    ("ro", include_str!("../locales/ro.json")),
    ("ja", include_str!("../locales/ja.json")),
    ("ko", include_str!("../locales/ko.json")),
];

macro_rules! keys {
    ($($variant:ident => $name:literal,)*) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub enum Key {
            $($variant,)*
        }

        impl Key {
            pub const ALL: &[Key] = &[$(Key::$variant,)*];

            pub fn name(self) -> &'static str {
                match self {
                    $(Key::$variant => $name,)*
                }
            }
        }
    };
}

keys! {
    SignInTitle => "sign_in.title",
    CodeLabel => "sign_in.code_label",
    Continue => "sign_in.continue",
    ContinueWith => "sign_in.continue_with",
    ContinueWithEmail => "sign_in.continue_with_email",
    SignInButton => "sign_in.button",
    LandingTitle => "landing.title",
    LandingBody => "landing.body",
    LandingNext => "landing.next",
    LandingOpen => "landing.open",
    LandingGet => "landing.get",
    BadLinkTitle => "start.bad_link_title",
    BadLinkBody => "start.bad_link_body",
    OverTitle => "callback.over_title",
    OverBody => "callback.over_body",
    CodeEnter => "code.enter",
    CodeWrong => "code.wrong",
    CodeLockedTitle => "code.locked_title",
    CodeLockedBody => "code.locked_body",
    CodeAsked => "code.asked",
    CodeOnlyIfYou => "code.only_if_you",
    CodeOtherNetwork => "code.other_network",
    CodeNoProviders => "code.no_providers",
    CodeDeny => "code.deny",
    CodeStoppedTitle => "code.stopped_title",
    CodeStoppedBody => "code.stopped_body",
    CodeDoneTitle => "code.done_title",
    CodeDoneBody => "code.done_body",
    CodeExpiredTitle => "code.expired_title",
    CodeExpiredBody => "code.expired_body",
    RefusedTitle => "code.refused_title",
    RefusedEmailAccount => "code.refused_email_account",
    RefusedProviderAccount => "code.refused_provider_account",
    RefusedEmailAdvice => "code.refused_email_advice",
    RefusedProviderAdvice => "code.refused_provider_advice",
    SomeProvider => "code.some_provider",
    NotFinishedTitle => "code.not_finished_title",
    CodeRetry => "code.retry",
    EmailEnterAddress => "email.enter_address",
    EmailAddressLabel => "email.address_label",
    EmailSend => "email.send",
    EmailInvalidAddress => "email.invalid_address",
    EmailTypeCode => "email.type_code",
    EmailOnlyIfYou => "email.only_if_you",
    EmailFinish => "email.finish",
    EmailWrongDevice => "email.wrong_device",
    PageExpiredTitle => "email.page_expired_title",
    PageExpiredBody => "email.page_expired_body",
    SignInExpiredTitle => "email.sign_in_expired_title",
    SignInExpiredBody => "email.sign_in_expired_body",
    EmailOffTitle => "email.off_title",
    EmailOffBody => "email.off_body",
    LinkUsedTitle => "email.link_used_title",
    LinkUsedBody => "email.link_used_body",
    LinkExpiredTitle => "email.link_expired_title",
    LinkExpiredBody => "email.link_expired_body",
    LinkInvalidTitle => "email.link_invalid_title",
    LinkInvalidBody => "email.link_invalid_body",
    TooManyEmailsTitle => "email.too_many_title",
    TooManyEmailsBody => "email.too_many_body",
    EmailSentTitle => "email.sent_title",
    EmailSentBody => "email.sent_body",
    EmailSentSameDevice => "email.sent_same_device",
    EmailSentOtherDevice => "email.sent_other_device",
    NotAdmitted => "auth_error.not_admitted",
    InvalidCode => "auth_error.invalid_code",
    InvalidSignature => "auth_error.invalid_signature",
    ExpiredNonce => "auth_error.expired_nonce",
    InvalidRedirect => "auth_error.invalid_redirect",
    UnknownProvider => "auth_error.unknown_provider",
    ProviderFailed => "auth_error.provider_failed",
    RefreshReused => "auth_error.refresh_reused",
    Revoked => "auth_error.revoked",
    SetupCodeInvalid => "auth_error.setup_code_invalid",
    SignInCancelled => "auth_error.sign_in_cancelled",
}

pub fn locales() -> impl Iterator<Item = &'static str> {
    SOURCES.iter().map(|(tag, _)| *tag)
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

fn lookup(catalog: Option<&'static Catalog>, key: Key) -> &'static str {
    catalog
        .and_then(|catalog| catalog.get(key.name()))
        .or_else(|| catalogs()[Locale::ENGLISH.tag].get(key.name()))
        .map_or(key.name(), String::as_str)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Locale {
    tag: &'static str,
}

impl Locale {
    pub const ENGLISH: Locale = Locale { tag: "en" };

    pub fn named(tag: &str) -> Option<Locale> {
        locales()
            .find(|supported| supported.eq_ignore_ascii_case(tag))
            .map(|tag| Locale { tag })
    }

    pub fn from_headers(headers: &HeaderMap) -> Locale {
        let ranges = headers
            .get_all(header::ACCEPT_LANGUAGE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .collect::<Vec<_>>()
            .join(",");
        negotiate(&ranges)
    }

    pub fn tag(self) -> &'static str {
        self.tag
    }

    pub fn text(self, key: Key) -> &'static str {
        lookup(catalogs().get(self.tag), key)
    }

    pub fn fill(self, key: Key, values: &[(&str, &str)]) -> String {
        language::fill(self.text(key), values)
    }

    pub fn fill_html(self, key: Key, values: &[(&str, &str)]) -> String {
        language::fill(&escape(self.text(key)), values)
    }

    pub fn auth_error(self, code: AuthErrorCode) -> &'static str {
        self.text(match code {
            AuthErrorCode::NotAdmitted => Key::NotAdmitted,
            AuthErrorCode::InvalidCode => Key::InvalidCode,
            AuthErrorCode::InvalidSignature => Key::InvalidSignature,
            AuthErrorCode::ExpiredNonce => Key::ExpiredNonce,
            AuthErrorCode::InvalidRedirect => Key::InvalidRedirect,
            AuthErrorCode::UnknownProvider => Key::UnknownProvider,
            AuthErrorCode::ProviderFailed => Key::ProviderFailed,
            AuthErrorCode::RefreshReused => Key::RefreshReused,
            AuthErrorCode::Revoked => Key::Revoked,
            AuthErrorCode::SetupCodeInvalid => Key::SetupCodeInvalid,
            AuthErrorCode::SignInCancelled => Key::SignInCancelled,
        })
    }
}

pub fn matching(tag: &str) -> Option<Locale> {
    language::matching(tag).and_then(Locale::named)
}

pub fn negotiate(accept_language: &str) -> Locale {
    Locale::named(language::negotiate(accept_language)).unwrap_or(Locale::ENGLISH)
}

pub struct PageLocale(pub Locale);

impl<S: Send + Sync> FromRequestParts<S> for PageLocale {
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        Ok(PageLocale(Locale::from_headers(&parts.headers)))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use axum::http::HeaderValue;

    use super::*;
    use crate::error::ServerError;
    use oleafly_collab_protocol::language::{fill, placeholders, LOCALES};

    const AUTH_ERRORS: [AuthErrorCode; 11] = [
        AuthErrorCode::NotAdmitted,
        AuthErrorCode::InvalidCode,
        AuthErrorCode::InvalidSignature,
        AuthErrorCode::ExpiredNonce,
        AuthErrorCode::InvalidRedirect,
        AuthErrorCode::UnknownProvider,
        AuthErrorCode::ProviderFailed,
        AuthErrorCode::RefreshReused,
        AuthErrorCode::Revoked,
        AuthErrorCode::SetupCodeInvalid,
        AuthErrorCode::SignInCancelled,
    ];

    fn picked(accept_language: &str) -> &'static str {
        negotiate(accept_language).tag()
    }

    fn parsed(tag: &str) -> Catalog {
        let source = SOURCES
            .iter()
            .find(|(candidate, _)| *candidate == tag)
            .map(|(_, source)| *source)
            .expect("a known locale");
        serde_json::from_str(source).unwrap_or_else(|error| panic!("{tag} is not JSON: {error}"))
    }

    #[test]
    fn the_server_speaks_the_same_languages_as_the_app() {
        assert_eq!(
            locales().collect::<Vec<_>>(),
            [
                "en", "zh-Hans", "zh-Hant", "de", "fr", "es", "it", "nl", "pt-BR", "pl", "ru",
                "uk", "tr", "cs", "da", "sv", "nb", "fi", "ro", "ja", "ko"
            ]
        );
        assert_eq!(locales().collect::<Vec<_>>(), LOCALES);
    }

    #[test]
    fn an_exact_language_is_used_as_is() {
        for tag in locales() {
            assert_eq!(picked(tag), tag);
        }
        assert_eq!(picked("PT-br"), "pt-BR");
        assert_eq!(picked("zh-hans"), "zh-Hans");
        assert_eq!(picked(" de "), "de");
    }

    #[test]
    fn a_region_falls_back_to_its_language() {
        for (asked, expected) in [
            ("de-AT", "de"),
            ("fr-CA", "fr"),
            ("en-GB", "en"),
            ("es-419", "es"),
            ("sv_SE", "sv"),
            ("pt", "pt-BR"),
            ("pt-PT", "pt-BR"),
            ("nn", "nb"),
            ("no", "nb"),
            ("nb-NO", "nb"),
            ("zh", "zh-Hans"),
            ("zh-CN", "zh-Hans"),
            ("zh-SG", "zh-Hans"),
            ("zh-TW", "zh-Hant"),
            ("zh-HK", "zh-Hant"),
            ("zh-Hant-HK", "zh-Hant"),
            ("ja-JP", "ja"),
            ("ko-KR", "ko"),
        ] {
            assert_eq!(picked(asked), expected, "{asked}");
        }
    }

    #[test]
    fn quality_values_set_the_order() {
        for (asked, expected) in [
            ("en;q=0.5, de;q=0.9", "de"),
            ("fr;q=0.8, ja", "ja"),
            ("ko, ja", "ko"),
            ("it;q=0.4, nl;q=0.4", "it"),
            ("de;q=0, fr;q=0.1", "fr"),
            ("xx, tlh;q=0.9, it;q=0.4", "it"),
            ("de;q=abc, fr;q=0.5", "fr"),
            ("de;q=1.5, fr;q=0.5", "fr"),
            ("*, nl;q=0.9", "nl"),
            ("fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5", "fr"),
            ("en-US,en;q=0.9,de;q=0.8", "en"),
            ("ru;Q=0.3, uk;q=0.2", "ru"),
            ("ru ; q = 0.3, uk; q=0.6", "uk"),
        ] {
            assert_eq!(picked(asked), expected, "{asked}");
        }
    }

    #[test]
    fn unknown_or_missing_languages_get_english() {
        for asked in [
            "", " ", "xx", "tlh-KL", "*", "de;q=0", ";q=0.5", ",,;;,", "-",
        ] {
            assert_eq!(picked(asked), "en", "{asked:?}");
        }
        assert_eq!(Locale::from_headers(&HeaderMap::new()), Locale::ENGLISH);
    }

    #[test]
    fn every_accept_language_header_counts() {
        let mut headers = HeaderMap::new();
        headers.append(header::ACCEPT_LANGUAGE, HeaderValue::from_static("xx"));
        headers.append(
            header::ACCEPT_LANGUAGE,
            HeaderValue::from_static("da;q=0.7"),
        );
        assert_eq!(Locale::from_headers(&headers).tag(), "da");
    }

    #[test]
    fn english_has_exactly_the_keys_the_pages_use() {
        let english: BTreeSet<String> = parsed("en").into_keys().collect();
        let used: BTreeSet<String> = Key::ALL.iter().map(|key| key.name().to_owned()).collect();
        assert_eq!(english, used);
        assert_eq!(Key::ALL.len(), used.len());
    }

    #[test]
    fn every_locale_has_every_key_with_the_same_placeholders() {
        let english = parsed("en");
        for tag in locales() {
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
            assert!(extra.is_empty(), "{tag} has unknown keys {extra:?}");
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
        for tag in locales().filter(|tag| *tag != "en") {
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
        for tag in locales() {
            for (key, text) in parsed(tag) {
                for mark in ['\u{2014}', '\u{2013}', ';', '\u{ff1b}'] {
                    assert!(!text.contains(mark), "{tag} {key}: {text}");
                }
                if english[&key].contains("Oleafly") {
                    assert!(text.contains("Oleafly"), "{tag} {key}: {text}");
                }
            }
        }
    }

    #[test]
    fn missing_text_falls_back_to_english() {
        let empty: &'static Catalog = Box::leak(Box::default());
        assert_eq!(
            lookup(Some(empty), Key::LandingTitle),
            "A shared Oleafly project"
        );
        assert_eq!(lookup(None, Key::Continue), "Continue");
    }

    #[test]
    fn english_page_text_for_sign_in_errors_matches_the_api() {
        for code in AUTH_ERRORS {
            assert_eq!(
                Locale::ENGLISH.auth_error(code),
                ServerError::Auth(code).public_message()
            );
        }
        for tag in locales() {
            let locale = Locale::named(tag).expect("a known locale");
            for code in AUTH_ERRORS {
                assert!(!locale.auth_error(code).is_empty());
            }
        }
    }

    #[test]
    fn values_fill_their_placeholders_once() {
        assert_eq!(
            Locale::ENGLISH.fill(
                Key::RefusedProviderAccount,
                &[("provider", "{account}"), ("account", "@ada")]
            ),
            "You signed in to {account} as @ada."
        );
        assert_eq!(fill("{a}{b} {c", &[("a", "1"), ("b", "2")]), "12 {c");
        assert_eq!(fill("{x} and {", &[]), "{x} and {");
    }

    #[test]
    fn html_filling_escapes_only_the_template() {
        let locale = Locale::named("en").expect("english");
        assert_eq!(
            locale.fill_html(
                Key::RefusedEmailAccount,
                &[("account", "<strong>a&amp;b</strong>")]
            ),
            "You signed in with <strong>a&amp;b</strong>."
        );
        assert_eq!(
            locale.fill_html(Key::CodeDeny, &[]),
            "Stop, this wasn&#39;t me"
        );
    }

    #[test]
    fn locales_are_found_by_name_only_when_supported() {
        assert_eq!(Locale::named("zh-hant").map(Locale::tag), Some("zh-Hant"));
        assert_eq!(Locale::named("pt"), None);
        assert_eq!(Locale::named("xx"), None);
    }
}
