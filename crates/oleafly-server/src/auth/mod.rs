pub mod admission;
pub mod browser_binding;
pub mod csrf;
pub mod device_code;
pub mod devices;
pub mod email_link;
pub mod github;
pub mod jws;
pub mod nonce;
pub mod oidc;
pub mod pending;
pub mod refresh;
pub mod setup;
pub mod split_token;
pub mod throttle;

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::future::Future;
use std::ops::RangeInclusive;
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use oleafly_collab_protocol::auth::AuthErrorCode;
use oleafly_collab_protocol::capabilities::{ProviderInfo, ProviderKind};
use oleafly_collab_protocol::console::SignInProblem;
use oleafly_collab_protocol::ids::{AccountId, DeviceId};
use url::Url;

use crate::config::{ProviderConfig, ServerConfig};
use crate::error::ServerError;

pub const PROVIDER_TIMEOUT: Duration = Duration::from_secs(15);
pub const USER_AGENT: &str = concat!("oleafly-server/", env!("CARGO_PKG_VERSION"));
pub const DETAIL_CHARS: usize = 300;
pub const PROBLEM_TTL_MS: i64 = 24 * 60 * 60 * 1000;
const ERROR_CODE_CHARS: usize = 40;

tokio::task_local! {
    static FAILURE: RefCell<Option<String>>;
}

#[async_trait::async_trait]
pub trait IdentityProvider: Send + Sync {
    fn id(&self) -> &str;

    async fn authorize_url(
        &self,
        state: &str,
        redirect: &Url,
        pkce_challenge: &str,
        nonce: &str,
    ) -> Result<Url, ServerError>;

    async fn exchange(
        &self,
        code: &str,
        redirect: &Url,
        pkce_verifier: &str,
        nonce: &str,
    ) -> Result<ExternalIdentity, ServerError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalIdentity {
    pub provider_id: String,
    pub issuer: String,
    pub subject: String,
    pub login: Option<String>,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub verified_emails: Vec<String>,
}

pub struct ProviderRegistry {
    infos: Vec<ProviderInfo>,
    providers: Vec<Box<dyn IdentityProvider>>,
    problems: Mutex<BTreeMap<String, Noted>>,
}

struct Noted {
    problem: SignInProblem,
    seen_by_server: bool,
}

impl ProviderRegistry {
    pub fn from_config(config: &ServerConfig, http: reqwest::Client) -> ProviderRegistry {
        let mut infos = Vec::new();
        let mut providers: Vec<Box<dyn IdentityProvider>> = Vec::new();
        for provider in &config.providers {
            match provider {
                ProviderConfig::Github {
                    id,
                    label,
                    client_id,
                    client_secret,
                    web_url,
                    api_url,
                } => {
                    infos.push(ProviderInfo {
                        id: id.clone(),
                        kind: ProviderKind::Github,
                        label: label.clone(),
                    });
                    providers.push(Box::new(github::GithubProvider::new(
                        id.clone(),
                        client_id.clone(),
                        client_secret.clone(),
                        web_url.clone(),
                        api_url.clone(),
                        http.clone(),
                    )));
                }
                ProviderConfig::Oidc {
                    id,
                    label,
                    issuer,
                    client_id,
                    client_secret,
                    trust_email,
                } => {
                    infos.push(ProviderInfo {
                        id: id.clone(),
                        kind: ProviderKind::Oidc,
                        label: label.clone(),
                    });
                    providers.push(Box::new(oidc::OidcProvider::new(
                        id.clone(),
                        issuer.clone(),
                        client_id.clone(),
                        client_secret.clone(),
                        *trust_email,
                        http.clone(),
                    )));
                }
            }
        }
        ProviderRegistry {
            infos,
            providers,
            problems: Mutex::new(BTreeMap::new()),
        }
    }

    pub fn infos(&self) -> Vec<ProviderInfo> {
        self.infos.clone()
    }

    pub fn get(&self, id: &str) -> Option<&dyn IdentityProvider> {
        self.providers
            .iter()
            .find(|provider| provider.id() == id)
            .map(AsRef::as_ref)
    }

    pub fn kind(&self, id: &str) -> Option<ProviderKind> {
        self.infos
            .iter()
            .find(|info| info.id == id)
            .map(|info| info.kind)
    }

    pub fn note_problem(&self, provider: &str, at: i64, reason: &str) {
        self.problems
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(
                provider.to_string(),
                Noted {
                    problem: SignInProblem {
                        provider: provider.to_string(),
                        at,
                        reason: short(reason),
                    },
                    seen_by_server: true,
                },
            );
    }

    pub fn note_reported_error(&self, provider: &str, at: i64, error: &str) {
        let Some(code) = error_code(error) else {
            return;
        };
        let mut problems = self.problems.lock().unwrap_or_else(PoisonError::into_inner);
        let seen = problems
            .get(provider)
            .is_some_and(|noted| noted.seen_by_server && at - noted.problem.at < PROBLEM_TTL_MS);
        if seen {
            return;
        }
        problems.insert(
            provider.to_string(),
            Noted {
                problem: SignInProblem {
                    provider: provider.to_string(),
                    at,
                    reason: format!(
                        "{code}, as reported by the browser. The server could not check it."
                    ),
                },
                seen_by_server: false,
            },
        );
    }

    pub fn clear_problem(&self, provider: &str) {
        self.problems
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(provider);
    }

    pub fn failing(&self, now: i64) -> bool {
        self.problems
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .values()
            .any(|noted| noted.seen_by_server && now - noted.problem.at < PROBLEM_TTL_MS)
    }

    pub fn problems(&self, now: i64) -> Vec<SignInProblem> {
        let mut problems = self.problems.lock().unwrap_or_else(PoisonError::into_inner);
        problems.retain(|_, noted| now - noted.problem.at < PROBLEM_TTL_MS);
        problems
            .values()
            .map(|noted| noted.problem.clone())
            .collect()
    }
}

// An OAuth error code the way RFC 6749 and OpenID Connect write them.
pub fn error_code(text: &str) -> Option<&str> {
    let well_formed = !text.is_empty()
        && text.len() <= ERROR_CODE_CHARS
        && text
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte == b'_');
    well_formed.then_some(text)
}

// Unicode's bidirectional controls and line and paragraph separators,
// which reorder text or break it into lines.
const REORDERING: [RangeInclusive<char>; 4] = [
    '\u{061c}'..='\u{061c}',
    '\u{200e}'..='\u{200f}',
    '\u{2028}'..='\u{202e}',
    '\u{2066}'..='\u{2069}',
];

// Format characters nobody can see: zero-width spaces and joiners, word
// joiners and invisible operators, the deprecated format controls, the byte
// order mark and the tag characters.
const INVISIBLE: [RangeInclusive<char>; 5] = [
    '\u{200b}'..='\u{200d}',
    '\u{2060}'..='\u{2064}',
    '\u{206a}'..='\u{206f}',
    '\u{feff}'..='\u{feff}',
    '\u{e0000}'..='\u{e007f}',
];

pub fn plain(text: &str) -> String {
    text.chars().filter_map(printable).collect()
}

pub fn short(text: &str) -> String {
    text.chars()
        .filter_map(printable)
        .take(DETAIL_CHARS)
        .collect()
}

pub fn clean_label(text: &str) -> String {
    plain(text).split_whitespace().collect::<Vec<_>>().join(" ")
}

fn printable(character: char) -> Option<char> {
    let within =
        |ranges: &[RangeInclusive<char>]| ranges.iter().any(|range| range.contains(&character));
    if within(&INVISIBLE) {
        None
    } else if character.is_control() || within(&REORDERING) {
        Some(' ')
    } else {
        Some(character)
    }
}

pub async fn noting_failure<F: Future>(work: F) -> (F::Output, Option<String>) {
    FAILURE
        .scope(RefCell::new(None), async move {
            let output = work.await;
            let detail = FAILURE.with(|slot| slot.borrow_mut().take());
            (output, detail)
        })
        .await
}

pub fn join_url(base: &Url, path: &str) -> Url {
    let mut url = base.clone();
    let prefix = base.path().trim_end_matches('/');
    url.set_path(&format!("{prefix}/{}", path.trim_start_matches('/')));
    url.set_query(None);
    url.set_fragment(None);
    url
}

pub fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

pub fn provider_failed(provider: &str, detail: impl std::fmt::Display) -> ServerError {
    let detail = plain(&detail.to_string());
    tracing::warn!(provider, %detail, "sign-in provider request failed");
    let _ = FAILURE.try_with(|slot| {
        slot.borrow_mut().get_or_insert_with(|| short(&detail));
    });
    ServerError::Auth(AuthErrorCode::ProviderFailed)
}

pub fn db_error(error: rusqlite::Error) -> ServerError {
    ServerError::Internal(error.to_string())
}

pub fn parse_account(raw: &str) -> Result<AccountId, ServerError> {
    raw.parse()
        .map_err(|_| ServerError::Internal(format!("stored account id {raw} is not canonical")))
}

pub fn parse_device(raw: &str) -> Result<DeviceId, ServerError> {
    raw.parse()
        .map_err(|_| ServerError::Internal(format!("stored device id {raw} is not canonical")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_config;

    fn github_config() -> ProviderConfig {
        ProviderConfig::Github {
            id: "github".to_owned(),
            label: "GitHub".to_owned(),
            client_id: "client-1".to_owned(),
            client_secret: "secret-1".to_owned(),
            web_url: Url::parse("https://github.com").expect("web url"),
            api_url: Url::parse("https://api.github.com").expect("api url"),
        }
    }

    #[test]
    fn join_url_keeps_an_enterprise_path_prefix() {
        let api = Url::parse("https://ghe.uni.edu/api/v3").expect("api");
        assert_eq!(
            join_url(&api, "user").as_str(),
            "https://ghe.uni.edu/api/v3/user"
        );
        assert_eq!(
            join_url(&api, "/user/emails").as_str(),
            "https://ghe.uni.edu/api/v3/user/emails"
        );
        let web = Url::parse("https://ghe.uni.edu/").expect("web");
        assert_eq!(
            join_url(&web, "login/oauth/authorize").as_str(),
            "https://ghe.uni.edu/login/oauth/authorize"
        );
        let prefixed = Url::parse("https://uni.edu/github/?x=1").expect("prefixed");
        assert_eq!(
            join_url(&prefixed, "login/oauth/access_token").as_str(),
            "https://uni.edu/github/login/oauth/access_token"
        );
    }

    #[test]
    fn emails_are_trimmed_and_lowercased() {
        assert_eq!(normalize_email("  Alice@Uni.EDU "), "alice@uni.edu");
    }

    #[test]
    fn the_registry_finds_providers_by_id() {
        let mut config = test_config();
        config.providers.push(github_config());
        let registry = ProviderRegistry::from_config(&config, reqwest::Client::new());
        assert_eq!(
            registry.get("github").map(|provider| provider.id()),
            Some("github")
        );
        assert!(registry.get("gitlab").is_none());
        let infos = registry.infos();
        assert_eq!(infos.len(), 1);
        assert_eq!(infos[0].id, "github");
        assert!(matches!(infos[0].kind, ProviderKind::Github));
    }

    #[test]
    fn stored_ids_must_be_canonical() {
        let account = AccountId::new_v7();
        assert_eq!(
            parse_account(&account.to_string()).expect("account"),
            account
        );
        assert!(matches!(
            parse_device("NOT-AN-ID"),
            Err(ServerError::Internal(_))
        ));
    }

    fn registry() -> ProviderRegistry {
        let mut config = test_config();
        config.providers.push(github_config());
        ProviderRegistry::from_config(&config, reqwest::Client::new())
    }

    #[test]
    fn provider_text_reaches_a_log_line_without_line_breaks_or_hidden_marks() {
        let forged = concat!(
            "bad_code\r\n2026-10-14T03:12:00Z  INFO admin signed in",
            "\u{202e}txt.exe\u{2028}\u{1b}[2J\tend"
        );
        let cleaned = plain(forged);
        assert!(
            !cleaned
                .chars()
                .any(|character| character.is_control()
                    || matches!(character, '\u{202e}' | '\u{2028}')),
            "{cleaned:?}"
        );
        assert!(cleaned.starts_with("bad_code  2026-10-14"), "{cleaned:?}");
        assert_eq!(short(forged), cleaned);
        assert_eq!(
            short(&"x".repeat(DETAIL_CHARS + 5)).chars().count(),
            DETAIL_CHARS
        );
        for mark in ['\u{061c}', '\u{200e}', '\u{2029}', '\u{202a}', '\u{2069}'] {
            assert_eq!(plain(&format!("a{mark}b")), "a b", "{mark:?}");
        }
        let hidden = [
            '\u{200b}',
            '\u{200c}',
            '\u{200d}',
            '\u{2060}',
            '\u{2064}',
            '\u{206a}',
            '\u{206f}',
            '\u{feff}',
            '\u{e0000}',
            '\u{e0041}',
            '\u{e007f}',
        ];
        for mark in hidden {
            assert_eq!(plain(&format!("in{mark}visible")), "invisible", "{mark:?}");
        }
        let tagged: String = hidden.iter().collect();
        assert_eq!(short(&format!("{tagged}ok")), "ok");
        assert_eq!(plain("Ådne’s café, 東京"), "Ådne’s café, 東京");
    }

    #[test]
    fn a_device_name_keeps_its_words_and_loses_breaks_marks_and_extra_spaces() {
        assert_eq!(
            clean_label("  Ada's\tLaptop\r\n\u{202e}exe.txt\u{200b}  "),
            "Ada's Laptop exe.txt"
        );
        assert_eq!(
            clean_label("Bjørn’s  ThinkPad (lab)"),
            "Bjørn’s ThinkPad (lab)"
        );
        assert_eq!(clean_label("\u{200b}\r\n\u{2066}\u{feff}"), "");
    }

    #[test]
    fn only_a_well_formed_oauth_error_code_counts_as_one() {
        for code in [
            "access_denied",
            "invalid_scope",
            "interaction_required",
            "redirect_uri_mismatch",
        ] {
            assert_eq!(error_code(code), Some(code));
        }
        let too_long = "a".repeat(ERROR_CODE_CHARS + 1);
        for text in [
            "",
            "Invalid_Client",
            "rotate the secret",
            "server_error\n",
            "a-b",
            too_long.as_str(),
        ] {
            assert_eq!(error_code(text), None, "{text:?}");
        }
    }

    #[test]
    fn a_browser_report_keeps_only_its_code_and_never_replaces_what_the_server_saw() {
        let registry = registry();
        registry.note_reported_error("github", 1_000, "Visit https://evil.example to fix this");
        assert!(registry.problems(1_000).is_empty());
        registry.note_reported_error("github", 1_000, "invalid_client");
        let reported = registry.problems(1_000);
        assert_eq!(reported.len(), 1);
        assert!(!registry.failing(1_000));
        assert_eq!(
            reported[0].reason,
            "invalid_client, as reported by the browser. The server could not check it."
        );
        registry.note_problem(
            "github",
            2_000,
            "bad_verification_code: The code passed is incorrect or expired.",
        );
        registry.note_reported_error("github", 3_000, "server_error");
        let seen = registry.problems(3_000);
        assert!(registry.failing(3_000));
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].at, 2_000);
        assert!(
            seen[0].reason.starts_with("bad_verification_code"),
            "{seen:?}"
        );
        registry.note_reported_error("github", 2_000 + PROBLEM_TTL_MS, "server_error");
        let later = registry.problems(2_000 + PROBLEM_TTL_MS);
        assert!(!registry.failing(2_000 + PROBLEM_TTL_MS));
        assert_eq!(later.len(), 1);
        assert!(
            later[0].reason.starts_with("server_error, as reported"),
            "{later:?}"
        );
    }

    #[test]
    fn a_sign_in_problem_is_forgotten_after_a_day() {
        let registry = registry();
        registry.note_problem("github", 5_000, "the token endpoint answered 500");
        assert_eq!(registry.problems(5_000 + PROBLEM_TTL_MS - 1).len(), 1);
        assert!(registry.problems(5_000 + PROBLEM_TTL_MS).is_empty());
        assert!(registry.problems(5_000).is_empty());
    }

    #[test]
    fn the_registry_builds_oidc_providers() {
        let mut config = test_config();
        config.providers.push(ProviderConfig::Oidc {
            id: "uni".to_owned(),
            label: "University login".to_owned(),
            issuer: "https://id.uni.edu".to_owned(),
            client_id: "client-1".to_owned(),
            client_secret: "secret-1".to_owned(),
            trust_email: false,
        });
        let registry = ProviderRegistry::from_config(&config, reqwest::Client::new());
        assert_eq!(
            registry.get("uni").map(|provider| provider.id()),
            Some("uni")
        );
        assert!(matches!(registry.infos()[0].kind, ProviderKind::Oidc));
    }
}
