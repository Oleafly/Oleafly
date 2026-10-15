use std::collections::HashMap;

use oleafly_collab_protocol::auth::AuthErrorCode;
use oleafly_collab_protocol::crypto::pkce_s256;
use oleafly_server::auth::oidc::OidcProvider;
use oleafly_server::auth::{ExternalIdentity, IdentityProvider};
use oleafly_server::error::ServerError;
use oleafly_server::test_support::{authorization_code, MockOidc, MockOidcUser};
use oleafly_server::tokens::random_token;
use serde_json::{json, Value};
use url::Url;

fn alice(email_verified: Option<Value>) -> MockOidcUser {
    MockOidcUser {
        subject: "uni-user-77".to_owned(),
        name: "Alice Chen".to_owned(),
        email: Some("Alice@Uni.EDU".to_owned()),
        email_verified,
    }
}

fn provider(issuer: String, trust_email: bool) -> OidcProvider {
    OidcProvider::new(
        "uni".to_owned(),
        issuer,
        "client-1".to_owned(),
        "secret-1".to_owned(),
        trust_email,
        reqwest::Client::new(),
    )
}

fn redirect() -> Url {
    Url::parse("https://collab.test/auth/callback/uni").expect("redirect")
}

async fn identity_from(
    mock: &MockOidc,
    trust_email: bool,
) -> Result<ExternalIdentity, ServerError> {
    let provider = provider(mock.issuer().to_string(), trust_email);
    let verifier = random_token();
    let nonce = random_token();
    let authorize = provider
        .authorize_url("state-1", &redirect(), &pkce_s256(&verifier), &nonce)
        .await?;
    let code = authorization_code(&authorize).await;
    provider
        .exchange(&code, &redirect(), &verifier, &nonce)
        .await
}

#[tokio::test]
async fn the_authorize_url_comes_from_discovery_with_pkce_and_nonce() {
    let mock = MockOidc::start(vec![alice(Some(json!(true)))]).await;
    let url = provider(mock.issuer().to_string(), false)
        .authorize_url("state-1", &redirect(), "challenge-1", "nonce-1")
        .await
        .expect("authorize url");
    assert_eq!(url.path(), "/authorize");
    assert_eq!(url.host_str(), mock.issuer().host_str());
    let pairs: HashMap<String, String> = url.query_pairs().into_owned().collect();
    assert_eq!(pairs["response_type"], "code");
    assert_eq!(pairs["client_id"], "client-1");
    assert_eq!(
        pairs["redirect_uri"],
        "https://collab.test/auth/callback/uni"
    );
    assert_eq!(pairs["scope"], "openid email profile");
    assert_eq!(pairs["state"], "state-1");
    assert_eq!(pairs["nonce"], "nonce-1");
    assert_eq!(pairs["code_challenge"], "challenge-1");
    assert_eq!(pairs["code_challenge_method"], "S256");
}

#[tokio::test]
async fn a_verified_email_comes_through_lowercased() {
    let mock = MockOidc::start(vec![alice(Some(json!(true)))]).await;
    let identity = identity_from(&mock, false).await.expect("identity");
    assert_eq!(identity.provider_id, "uni");
    assert_eq!(identity.issuer, mock.issuer().as_str());
    assert_eq!(identity.subject, "uni-user-77");
    assert_eq!(identity.display_name, "Alice Chen");
    assert_eq!(identity.verified_emails, vec!["alice@uni.edu".to_owned()]);
}

#[tokio::test]
async fn a_missing_or_non_boolean_claim_yields_no_email() {
    for claim in [
        None,
        Some(json!("true")),
        Some(json!(1)),
        Some(json!(false)),
    ] {
        let mock = MockOidc::start(vec![alice(claim)]).await;
        let identity = identity_from(&mock, false).await.expect("identity");
        assert!(identity.verified_emails.is_empty());
    }
}

#[tokio::test]
async fn trust_email_takes_the_email_without_the_claim() {
    let mock = MockOidc::start(vec![alice(None)]).await;
    let identity = identity_from(&mock, true).await.expect("identity");
    assert_eq!(identity.verified_emails, vec!["alice@uni.edu".to_owned()]);
}

#[tokio::test]
async fn a_different_nonce_fails_the_exchange() {
    let mock = MockOidc::start(vec![alice(Some(json!(true)))]).await;
    let provider = provider(mock.issuer().to_string(), false);
    let verifier = random_token();
    let authorize = provider
        .authorize_url("state-1", &redirect(), &pkce_s256(&verifier), "nonce-1")
        .await
        .expect("authorize url");
    let code = authorization_code(&authorize).await;
    let error = provider
        .exchange(&code, &redirect(), &verifier, "nonce-2")
        .await
        .expect_err("nonce mismatch");
    assert!(matches!(
        error,
        ServerError::Auth(AuthErrorCode::ProviderFailed)
    ));
}

#[tokio::test]
async fn an_unreachable_issuer_fails_cleanly() {
    let provider = provider("http://127.0.0.1:9".to_owned(), false);
    let error = provider
        .authorize_url("state-1", &redirect(), "challenge-1", "nonce-1")
        .await
        .expect_err("no discovery");
    assert!(matches!(
        error,
        ServerError::Auth(AuthErrorCode::ProviderFailed)
    ));
}

#[tokio::test]
async fn the_issuer_must_match_byte_for_byte() {
    let mock = MockOidc::start(vec![alice(Some(json!(true)))]).await;
    let without_slash = mock.issuer().as_str().trim_end_matches('/').to_owned();
    assert_ne!(without_slash, mock.issuer().as_str());
    let error = provider(without_slash, false)
        .authorize_url("state-1", &redirect(), "challenge-1", "nonce-1")
        .await
        .expect_err("issuer mismatch");
    assert!(matches!(
        error,
        ServerError::Auth(AuthErrorCode::ProviderFailed)
    ));
}
