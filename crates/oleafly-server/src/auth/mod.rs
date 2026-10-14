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

use std::time::Duration;

use oleafly_collab_protocol::auth::AuthErrorCode;
use oleafly_collab_protocol::capabilities::{ProviderInfo, ProviderKind};
use oleafly_collab_protocol::ids::{AccountId, DeviceId};
use url::Url;

use crate::config::{ProviderConfig, ServerConfig};
use crate::error::ServerError;

pub const PROVIDER_TIMEOUT: Duration = Duration::from_secs(15);
pub const USER_AGENT: &str = concat!("oleafly-server/", env!("CARGO_PKG_VERSION"));

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
        ProviderRegistry { infos, providers }
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
    tracing::warn!(provider, %detail, "sign-in provider request failed");
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
