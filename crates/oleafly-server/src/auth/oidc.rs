use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use async_trait::async_trait;
use reqwest::header::ACCEPT;
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::OnceCell;
use url::Url;

use crate::auth::jws::{self, IdClaims, IdTokenError, JwkSet};
use crate::auth::{
    normalize_email, provider_failed, ExternalIdentity, IdentityProvider, PROVIDER_TIMEOUT,
};
use crate::error::ServerError;

pub const SCOPES: &str = "openid email profile";

#[derive(Debug, Clone)]
pub struct Metadata {
    pub issuer: String,
    pub authorization_endpoint: Url,
    pub token_endpoint: Url,
    pub jwks_uri: Url,
    pub client_secret_post: bool,
}

#[derive(Deserialize)]
struct Discovery {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    jwks_uri: String,
    #[serde(default)]
    token_endpoint_auth_methods_supported: Vec<String>,
}

#[derive(Deserialize)]
struct TokenReply {
    id_token: Option<String>,
}

pub struct OidcProvider {
    id: String,
    issuer: String,
    client_id: String,
    client_secret: String,
    trust_email: bool,
    http: reqwest::Client,
    metadata: OnceCell<Metadata>,
    keys: Mutex<Option<Arc<JwkSet>>>,
}

pub fn uses_client_secret_post(methods: &[String]) -> bool {
    let offers = |name: &str| methods.iter().any(|method| method == name);
    !offers("client_secret_basic") && offers("client_secret_post")
}

pub fn verified_emails(claims: &IdClaims, trust_email: bool) -> Vec<String> {
    let verified = trust_email || matches!(claims.email_verified, Some(Value::Bool(true)));
    claims
        .email
        .as_deref()
        .map(normalize_email)
        .filter(|email| verified && email.contains('@'))
        .into_iter()
        .collect()
}

pub fn discovery_url(issuer: &str) -> String {
    let base = issuer.strip_suffix('/').unwrap_or(issuer);
    format!("{base}/.well-known/openid-configuration")
}

fn form_encode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

impl OidcProvider {
    pub fn new(
        id: String,
        issuer: String,
        client_id: String,
        client_secret: String,
        trust_email: bool,
        http: reqwest::Client,
    ) -> OidcProvider {
        OidcProvider {
            id,
            issuer,
            client_id,
            client_secret,
            trust_email,
            http,
            metadata: OnceCell::new(),
            keys: Mutex::new(None),
        }
    }

    pub async fn metadata(&self) -> Result<&Metadata, ServerError> {
        self.metadata.get_or_try_init(|| self.discover()).await
    }

    async fn discover(&self) -> Result<Metadata, ServerError> {
        let document: Discovery = self
            .http
            .get(discovery_url(&self.issuer))
            .timeout(PROVIDER_TIMEOUT)
            .header(ACCEPT, "application/json")
            .send()
            .await
            .map_err(|error| provider_failed(&self.id, error))?
            .error_for_status()
            .map_err(|error| provider_failed(&self.id, error))?
            .json()
            .await
            .map_err(|error| provider_failed(&self.id, error))?;
        if document.issuer != self.issuer {
            let detail = format!(
                "discovery names issuer {} instead of {}",
                document.issuer, self.issuer
            );
            return Err(provider_failed(&self.id, detail));
        }
        let endpoint =
            |value: &str| Url::parse(value).map_err(|error| provider_failed(&self.id, error));
        Ok(Metadata {
            authorization_endpoint: endpoint(&document.authorization_endpoint)?,
            token_endpoint: endpoint(&document.token_endpoint)?,
            jwks_uri: endpoint(&document.jwks_uri)?,
            client_secret_post: uses_client_secret_post(
                &document.token_endpoint_auth_methods_supported,
            ),
            issuer: document.issuer,
        })
    }

    async fn keys(&self, metadata: &Metadata, refresh: bool) -> Result<Arc<JwkSet>, ServerError> {
        let cached = self.cached_keys().clone();
        if let (false, Some(keys)) = (refresh, cached) {
            return Ok(keys);
        }
        let fetched: JwkSet = self
            .http
            .get(metadata.jwks_uri.clone())
            .timeout(PROVIDER_TIMEOUT)
            .header(ACCEPT, "application/json")
            .send()
            .await
            .map_err(|error| provider_failed(&self.id, error))?
            .error_for_status()
            .map_err(|error| provider_failed(&self.id, error))?
            .json()
            .await
            .map_err(|error| provider_failed(&self.id, error))?;
        let fetched = Arc::new(fetched);
        *self.cached_keys() = Some(Arc::clone(&fetched));
        Ok(fetched)
    }

    fn cached_keys(&self) -> MutexGuard<'_, Option<Arc<JwkSet>>> {
        self.keys.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn identity(&self, metadata: &Metadata, claims: &IdClaims) -> ExternalIdentity {
        let login = claims
            .preferred_username
            .as_deref()
            .map(str::trim)
            .filter(|login| !login.is_empty())
            .map(str::to_owned);
        let display_name = [
            claims.name.as_deref(),
            claims.preferred_username.as_deref(),
            claims.email.as_deref(),
        ]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|value| !value.is_empty())
        .unwrap_or(claims.sub.as_str())
        .to_owned();
        ExternalIdentity {
            provider_id: self.id.clone(),
            issuer: metadata.issuer.clone(),
            subject: claims.sub.clone(),
            login,
            display_name,
            avatar_url: claims.picture.clone(),
            verified_emails: verified_emails(claims, self.trust_email),
        }
    }
}

#[async_trait]
impl IdentityProvider for OidcProvider {
    fn id(&self) -> &str {
        &self.id
    }

    async fn authorize_url(
        &self,
        state: &str,
        redirect: &Url,
        pkce_challenge: &str,
        nonce: &str,
    ) -> Result<Url, ServerError> {
        let metadata = self.metadata().await?;
        let mut url = metadata.authorization_endpoint.clone();
        url.query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", &self.client_id)
            .append_pair("redirect_uri", redirect.as_str())
            .append_pair("scope", SCOPES)
            .append_pair("state", state)
            .append_pair("nonce", nonce)
            .append_pair("code_challenge", pkce_challenge)
            .append_pair("code_challenge_method", "S256");
        Ok(url)
    }

    async fn exchange(
        &self,
        code: &str,
        redirect: &Url,
        pkce_verifier: &str,
        nonce: &str,
    ) -> Result<ExternalIdentity, ServerError> {
        let metadata = self.metadata().await?;
        let mut form = vec![
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect.as_str()),
            ("code_verifier", pkce_verifier),
        ];
        let mut request = self
            .http
            .post(metadata.token_endpoint.clone())
            .timeout(PROVIDER_TIMEOUT)
            .header(ACCEPT, "application/json");
        if metadata.client_secret_post {
            form.push(("client_id", self.client_id.as_str()));
            form.push(("client_secret", self.client_secret.as_str()));
        } else {
            request = request.basic_auth(
                form_encode(&self.client_id),
                Some(form_encode(&self.client_secret)),
            );
        }
        let reply: TokenReply = request
            .form(&form)
            .send()
            .await
            .map_err(|error| provider_failed(&self.id, error))?
            .error_for_status()
            .map_err(|error| provider_failed(&self.id, error))?
            .json()
            .await
            .map_err(|error| provider_failed(&self.id, error))?;
        let id_token = reply
            .id_token
            .ok_or_else(|| provider_failed(&self.id, "the token response has no id_token"))?;
        let now = jws::unix_seconds();
        let keys = self.keys(metadata, false).await?;
        let checked = jws::validate_id_token(
            &id_token,
            &keys,
            &metadata.issuer,
            &self.client_id,
            nonce,
            now,
        );
        let checked = match checked {
            Err(IdTokenError::UnknownKey) => {
                let keys = self.keys(metadata, true).await?;
                jws::validate_id_token(
                    &id_token,
                    &keys,
                    &metadata.issuer,
                    &self.client_id,
                    nonce,
                    now,
                )
            }
            other => other,
        };
        let claims = checked.map_err(|error| provider_failed(&self.id, error))?;
        Ok(self.identity(metadata, &claims))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn claims(email_verified: Option<Value>) -> IdClaims {
        let mut value = json!({
            "iss": "https://id.uni.edu",
            "sub": "u-1",
            "aud": "client-1",
            "exp": 2,
            "iat": 1,
            "email": " Alice@Uni.EDU "
        });
        if let Some(flag) = email_verified {
            value["email_verified"] = flag;
        }
        serde_json::from_value(value).expect("claims")
    }

    #[test]
    fn only_a_boolean_true_claim_verifies_the_email() {
        assert_eq!(
            verified_emails(&claims(Some(json!(true))), false),
            vec!["alice@uni.edu".to_owned()]
        );
        for flag in [
            None,
            Some(json!(false)),
            Some(json!("true")),
            Some(json!(1)),
            Some(Value::Null),
        ] {
            assert!(verified_emails(&claims(flag), false).is_empty());
        }
    }

    #[test]
    fn trust_email_accepts_the_email_without_the_claim() {
        assert_eq!(
            verified_emails(&claims(None), true),
            vec!["alice@uni.edu".to_owned()]
        );
    }

    #[test]
    fn client_secret_post_only_when_basic_is_not_offered() {
        assert!(!uses_client_secret_post(&[]));
        let both = [
            "client_secret_basic".to_owned(),
            "client_secret_post".to_owned(),
        ];
        assert!(!uses_client_secret_post(&both));
        assert!(uses_client_secret_post(&["client_secret_post".to_owned()]));
    }

    #[test]
    fn the_discovery_url_drops_one_trailing_slash_only_for_the_request() {
        assert_eq!(
            discovery_url("https://id.uni.edu/realms/lab"),
            "https://id.uni.edu/realms/lab/.well-known/openid-configuration"
        );
        assert_eq!(
            discovery_url("https://id.uni.edu/realms/lab/"),
            "https://id.uni.edu/realms/lab/.well-known/openid-configuration"
        );
        assert_eq!(
            discovery_url("https://tenant.example//"),
            "https://tenant.example//.well-known/openid-configuration"
        );
    }
}
