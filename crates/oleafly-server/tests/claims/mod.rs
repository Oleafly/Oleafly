#![allow(dead_code)]

use oleafly_collab_protocol::auth::{SessionTokens, SetupClaimRequest, SetupClaimResponse};
use oleafly_collab_protocol::crypto::pkce_s256;
use oleafly_server::test_support::{
    api_error_code, app_callback, follow_to_app, no_redirect_client, redeem, SignInAttempt,
    TestDevice, TestServer,
};

pub async fn claim_for(
    server: &TestServer,
    setup_code: &str,
    code_challenge: &str,
) -> Result<String, String> {
    let response = reqwest::Client::new()
        .post(format!("{}/auth/setup-claim", server.url()))
        .json(&SetupClaimRequest {
            setup_code: setup_code.to_owned(),
            code_challenge: code_challenge.to_owned(),
        })
        .send()
        .await
        .expect("setup claim request");
    if response.status().is_success() {
        Ok(response
            .json::<SetupClaimResponse>()
            .await
            .expect("claim json")
            .claim)
    } else {
        Err(api_error_code(response).await)
    }
}

pub async fn attempt(
    server: &TestServer,
    provider: &str,
    device: &TestDevice,
    setup_code: Option<&str>,
) -> Result<SignInAttempt, String> {
    let mut attempt = SignInAttempt::new(server, provider, device, None);
    if let Some(code) = setup_code {
        let claim = claim_for(server, code, &pkce_s256(&attempt.verifier)).await?;
        attempt
            .start_url
            .query_pairs_mut()
            .append_pair("setup_claim", &claim);
    }
    Ok(attempt)
}

pub async fn sign_in(
    server: &TestServer,
    provider: &str,
    device: &TestDevice,
    setup_code: Option<&str>,
) -> Result<SessionTokens, String> {
    let attempt = attempt(server, provider, device, setup_code).await?;
    let landing = follow_to_app(&no_redirect_client(), attempt.start_url.clone()).await?;
    let code = app_callback(&landing, &attempt.state)?;
    redeem(server, device, &code, &attempt.verifier).await
}
