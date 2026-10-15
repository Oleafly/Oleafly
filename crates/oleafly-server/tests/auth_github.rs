use std::collections::HashMap;

use oleafly_collab_protocol::auth::AuthErrorCode;
use oleafly_collab_protocol::crypto::pkce_s256;
use oleafly_server::auth::github::GithubProvider;
use oleafly_server::auth::IdentityProvider;
use oleafly_server::error::ServerError;
use oleafly_server::test_support::{authorization_code, MockGithub, MockGithubUser};
use oleafly_server::tokens::random_token;
use url::Url;

fn alice() -> MockGithubUser {
    MockGithubUser {
        id: 4242,
        login: "Alice-Chen".to_owned(),
        name: "Alice Chen".to_owned(),
        emails: vec![
            ("Alice@Uni.EDU".to_owned(), true),
            ("old@example.com".to_owned(), false),
        ],
    }
}

fn provider(mock: &MockGithub) -> GithubProvider {
    GithubProvider::new(
        "github".to_owned(),
        "client-1".to_owned(),
        "secret-1".to_owned(),
        mock.web_url(),
        mock.api_url(),
        reqwest::Client::new(),
    )
}

fn redirect() -> Url {
    Url::parse("https://collab.test/auth/callback/github").expect("redirect")
}

#[tokio::test]
async fn the_authorize_url_carries_state_scopes_and_pkce() {
    let mock = MockGithub::start(vec![alice()]).await;
    let url = provider(&mock)
        .authorize_url("state-1", &redirect(), "challenge-1", "unused")
        .await
        .expect("authorize url");
    assert_eq!(url.path(), "/login/oauth/authorize");
    let pairs: HashMap<String, String> = url.query_pairs().into_owned().collect();
    assert_eq!(pairs["client_id"], "client-1");
    assert_eq!(
        pairs["redirect_uri"],
        "https://collab.test/auth/callback/github"
    );
    assert_eq!(pairs["scope"], "read:user user:email");
    assert_eq!(pairs["state"], "state-1");
    assert_eq!(pairs["code_challenge"], "challenge-1");
    assert_eq!(pairs["code_challenge_method"], "S256");
}

#[tokio::test]
async fn an_exchange_returns_the_numeric_id_and_only_verified_emails() {
    let mock = MockGithub::start(vec![alice()]).await;
    let provider = provider(&mock);
    let verifier = random_token();
    let authorize = provider
        .authorize_url("state-1", &redirect(), &pkce_s256(&verifier), "")
        .await
        .expect("authorize url");
    let code = authorization_code(&authorize).await;
    let identity = provider
        .exchange(&code, &redirect(), &verifier, "")
        .await
        .expect("identity");
    assert_eq!(identity.provider_id, "github");
    assert_eq!(
        identity.issuer,
        mock.web_url().as_str().trim_end_matches('/')
    );
    assert_eq!(identity.issuer, provider.issuer());
    assert_eq!(identity.subject, "4242");
    assert_eq!(identity.login.as_deref(), Some("Alice-Chen"));
    assert_eq!(identity.display_name, "Alice Chen");
    assert_eq!(identity.verified_emails, vec!["alice@uni.edu".to_owned()]);
    assert!(identity.avatar_url.is_some());
}

#[tokio::test]
async fn a_wrong_verifier_fails_the_exchange() {
    let mock = MockGithub::start(vec![alice()]).await;
    let provider = provider(&mock);
    let verifier = random_token();
    let authorize = provider
        .authorize_url("state-1", &redirect(), &pkce_s256(&verifier), "")
        .await
        .expect("authorize url");
    let code = authorization_code(&authorize).await;
    let error = provider
        .exchange(&code, &redirect(), &random_token(), "")
        .await
        .expect_err("wrong verifier");
    assert!(matches!(
        error,
        ServerError::Auth(AuthErrorCode::ProviderFailed)
    ));
}

#[tokio::test]
async fn a_code_cannot_be_exchanged_twice() {
    let mock = MockGithub::start(vec![alice()]).await;
    let provider = provider(&mock);
    let verifier = random_token();
    let authorize = provider
        .authorize_url("state-1", &redirect(), &pkce_s256(&verifier), "")
        .await
        .expect("authorize url");
    let code = authorization_code(&authorize).await;
    provider
        .exchange(&code, &redirect(), &verifier, "")
        .await
        .expect("first exchange");
    let error = provider
        .exchange(&code, &redirect(), &verifier, "")
        .await
        .expect_err("second exchange");
    assert!(matches!(
        error,
        ServerError::Auth(AuthErrorCode::ProviderFailed)
    ));
}
