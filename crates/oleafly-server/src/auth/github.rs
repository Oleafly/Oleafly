use async_trait::async_trait;
use reqwest::header::{ACCEPT, USER_AGENT as USER_AGENT_HEADER};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use url::Url;

use crate::auth::{
    join_url, normalize_email, provider_failed, ExternalIdentity, IdentityProvider,
    PROVIDER_TIMEOUT, USER_AGENT,
};
use crate::error::ServerError;

pub const SCOPES: &str = "read:user user:email";

pub struct GithubProvider {
    id: String,
    client_id: String,
    client_secret: String,
    web_url: Url,
    api_url: Url,
    issuer: String,
    http: reqwest::Client,
}

#[derive(Deserialize)]
struct TokenReply {
    access_token: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct GithubUser {
    id: u64,
    login: String,
    name: Option<String>,
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct GithubEmail {
    email: String,
    verified: bool,
}

impl GithubProvider {
    pub fn new(
        id: String,
        client_id: String,
        client_secret: String,
        web_url: Url,
        api_url: Url,
        http: reqwest::Client,
    ) -> GithubProvider {
        let issuer = web_url.as_str().trim_end_matches('/').to_owned();
        GithubProvider {
            id,
            client_id,
            client_secret,
            web_url,
            api_url,
            issuer,
            http,
        }
    }

    pub fn issuer(&self) -> &str {
        &self.issuer
    }

    async fn api<T: DeserializeOwned>(&self, path: &str, token: &str) -> Result<T, ServerError> {
        self.http
            .get(join_url(&self.api_url, path))
            .timeout(PROVIDER_TIMEOUT)
            .bearer_auth(token)
            .header(ACCEPT, "application/vnd.github+json")
            .header(USER_AGENT_HEADER, USER_AGENT)
            .send()
            .await
            .map_err(|error| provider_failed(&self.id, error))?
            .error_for_status()
            .map_err(|error| provider_failed(&self.id, error))?
            .json::<T>()
            .await
            .map_err(|error| provider_failed(&self.id, error))
    }
}

#[async_trait]
impl IdentityProvider for GithubProvider {
    fn id(&self) -> &str {
        &self.id
    }

    async fn authorize_url(
        &self,
        state: &str,
        redirect: &Url,
        pkce_challenge: &str,
        _nonce: &str,
    ) -> Result<Url, ServerError> {
        let mut url = join_url(&self.web_url, "login/oauth/authorize");
        url.query_pairs_mut()
            .append_pair("client_id", &self.client_id)
            .append_pair("redirect_uri", redirect.as_str())
            .append_pair("scope", SCOPES)
            .append_pair("state", state)
            .append_pair("code_challenge", pkce_challenge)
            .append_pair("code_challenge_method", "S256");
        Ok(url)
    }

    async fn exchange(
        &self,
        code: &str,
        redirect: &Url,
        pkce_verifier: &str,
        _nonce: &str,
    ) -> Result<ExternalIdentity, ServerError> {
        let form = [
            ("client_id", self.client_id.as_str()),
            ("client_secret", self.client_secret.as_str()),
            ("code", code),
            ("redirect_uri", redirect.as_str()),
            ("code_verifier", pkce_verifier),
        ];
        let reply: TokenReply = self
            .http
            .post(join_url(&self.web_url, "login/oauth/access_token"))
            .timeout(PROVIDER_TIMEOUT)
            .header(ACCEPT, "application/json")
            .header(USER_AGENT_HEADER, USER_AGENT)
            .form(&form)
            .send()
            .await
            .map_err(|error| provider_failed(&self.id, error))?
            .error_for_status()
            .map_err(|error| provider_failed(&self.id, error))?
            .json()
            .await
            .map_err(|error| provider_failed(&self.id, error))?;
        let Some(token) = reply.access_token else {
            let reason = reply.error.unwrap_or_else(|| "no access token".to_owned());
            return Err(provider_failed(&self.id, reason));
        };
        let user: GithubUser = self.api("user", &token).await?;
        let emails: Vec<GithubEmail> = self.api("user/emails", &token).await.unwrap_or_default();
        let mut verified_emails: Vec<String> = emails
            .into_iter()
            .filter(|email| email.verified)
            .map(|email| normalize_email(&email.email))
            .collect();
        verified_emails.sort();
        verified_emails.dedup();
        let display_name = user
            .name
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| user.login.clone());
        Ok(ExternalIdentity {
            provider_id: self.id.clone(),
            issuer: self.issuer.clone(),
            subject: user.id.to_string(),
            login: Some(user.login),
            display_name,
            avatar_url: user.avatar_url,
            verified_emails,
        })
    }
}
