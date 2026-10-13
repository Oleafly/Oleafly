use std::time::Duration;

use oleafly_collab_protocol::auth::{
    challenge_message, AuthStartQuery, ChallengePurpose, SessionTokens, TokenRequest,
};
use oleafly_collab_protocol::capabilities::{
    negotiate, CapabilityManifest, ProtocolRange, ProviderKind,
};
use oleafly_collab_protocol::crypto::{b64url_encode, pkce_s256};
use ring::rand::{SecureRandom, SystemRandom};

use super::loopback::{CallbackOutcome, LoopbackListener};
use super::{client_protocol, ServerClient, ServerUrl};
use crate::{CollabError, DeviceKey};

const VERIFIER_BYTES: usize = 32;
const STATE_BYTES: usize = 16;

pub struct SignInRequest {
    pub url: ServerUrl,
    pub provider_id: String,
    pub device_name: String,
    pub platform: String,
    pub setup_code: Option<String>,
}

pub async fn sign_in(
    request: SignInRequest,
    key: &DeviceKey,
    open_browser: &(dyn Fn(&str) -> Result<(), CollabError> + Send + Sync),
    timeout: Duration,
) -> Result<(CapabilityManifest, SessionTokens), CollabError> {
    let SignInRequest {
        url,
        provider_id,
        device_name,
        platform,
        setup_code,
    } = request;
    let client = ServerClient::new(url)?;
    let manifest = client.capabilities().await?;
    negotiate(
        client_protocol(),
        ProtocolRange {
            min: manifest.protocol.min,
            max: manifest.protocol.max,
        },
    )
    .map_err(CollabError::ProtocolMismatch)?;
    let Some((kind, provider_label)) = manifest
        .providers
        .iter()
        .find(|provider| provider.id == provider_id)
        .map(|provider| (provider.kind, provider.label.clone()))
    else {
        return Err(CollabError::Api {
            status: 400,
            code: "unknown_provider".to_string(),
            message: format!("this server has no sign-in provider {provider_id}"),
        });
    };
    let timeout = wait_for(kind, timeout);
    let listener =
        LoopbackListener::bind()
            .await?
            .describing(&manifest.name, &provider_label, kind);
    let verifier = random_b64url(VERIFIER_BYTES)?;
    let state = random_b64url(STATE_BYTES)?;
    let query = AuthStartQuery {
        provider: provider_id,
        redirect_uri: listener.redirect_uri(),
        state: state.clone(),
        code_challenge: pkce_s256(&verifier),
        device_public_key: key.public_key_b64(),
        device_name,
        platform,
        setup_code: setup_code.filter(|_| manifest.needs_setup),
    };
    open_browser(client.auth_start_url(&query)?.as_str())?;
    let code = match listener.wait(&state, timeout).await? {
        CallbackOutcome::Code(code) => code,
        CallbackOutcome::Error { code, description } => {
            return Err(callback_error(code, description));
        }
    };
    let challenge = client.challenge().await?;
    let message = challenge_message(
        ChallengePurpose::Token,
        manifest.server_id,
        &challenge.nonce,
    );
    let request = TokenRequest {
        code,
        code_verifier: verifier,
        device_public_key: key.public_key_b64(),
        signature: key.sign_b64(&message),
        nonce: challenge.nonce,
    };
    let tokens = client.exchange_token(&request).await?;
    Ok((manifest, tokens))
}

pub(crate) const EMAIL_LINK_WAIT: Duration = Duration::from_secs(16 * 60);

fn wait_for(kind: ProviderKind, timeout: Duration) -> Duration {
    match kind {
        ProviderKind::EmailLink => timeout.max(EMAIL_LINK_WAIT),
        _ => timeout,
    }
}

fn callback_error(code: String, description: Option<String>) -> CollabError {
    match code.as_str() {
        "not_admitted" => CollabError::NotAdmitted,
        "sign_in_cancelled" | "access_denied" => CollabError::SignInCancelled,
        _ => CollabError::Api {
            status: 400,
            message: description.unwrap_or_else(|| code.clone()),
            code,
        },
    }
}

fn random_b64url(length: usize) -> Result<String, CollabError> {
    let mut bytes = vec![0u8; length];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| CollabError::Crypto("the system random source failed".to_string()))?;
    Ok(b64url_encode(&bytes))
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use oleafly_collab_protocol::admin::{AllowlistMatcher, NewAllowlistEntry};
    use oleafly_collab_protocol::capabilities::VersionMismatch;
    use oleafly_collab_protocol::roles::ServerRole;

    use super::*;
    use crate::client::test_util::{
        canned, device_key, follow_browser, github_server, github_user, http_response,
        sample_manifest, seed, server_url, sign_in_request, LONG,
    };

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn setup_code_makes_the_first_admin() {
        let (_github, server) = github_server(vec![github_user(1, "carol")]).await;
        let key = device_key();
        let (manifest, tokens) = sign_in(
            sign_in_request(&server, Some(server.setup_code())),
            &key,
            &follow_browser,
            LONG,
        )
        .await
        .expect("sign in");
        assert!(manifest.needs_setup);
        assert_eq!(manifest.server_id, server.state().server_id);
        let client = ServerClient::new(server_url(&server)).expect("client");
        let me = client.me(&tokens.access_token).await.expect("me");
        assert!(matches!(me.server_role, ServerRole::Admin));
        assert!(!client.capabilities().await.expect("manifest").needs_setup);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn unlisted_user_is_not_admitted() {
        let (_github, server) = github_server(vec![github_user(2, "mallory")]).await;
        let _admin = seed(&server, ServerRole::Admin).await;
        let result = sign_in(
            sign_in_request(&server, None),
            &device_key(),
            &follow_browser,
            LONG,
        )
        .await;
        assert!(matches!(result, Err(CollabError::NotAdmitted)));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn allowlisted_handle_is_admitted_as_a_member() {
        let (_github, server) = github_server(vec![github_user(3, "alice-chen")]).await;
        let admin = seed(&server, ServerRole::Admin).await;
        let client = ServerClient::new(server_url(&server)).expect("client");
        client
            .admin_add_allowlist(
                &admin.access_token,
                &NewAllowlistEntry {
                    matcher: AllowlistMatcher::ProviderLogin {
                        provider: "github".to_string(),
                        login: "Alice-Chen".to_string(),
                    },
                    role: ServerRole::Member,
                },
            )
            .await
            .expect("allowlist");
        let (_, tokens) = sign_in(
            sign_in_request(&server, None),
            &device_key(),
            &follow_browser,
            LONG,
        )
        .await
        .expect("sign in");
        let me = client.me(&tokens.access_token).await.expect("me");
        assert!(matches!(me.server_role, ServerRole::Member));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn abandoned_sign_in_times_out_frees_the_port_and_a_retry_succeeds() {
        let (_github, server) = github_server(vec![github_user(1, "carol")]).await;
        let key = device_key();
        let opened: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let seen = opened.clone();
        let abandon = move |url: &str| -> Result<(), CollabError> {
            *seen.lock().expect("lock") = Some(url.to_string());
            Ok(())
        };
        let first = sign_in(
            sign_in_request(&server, Some(server.setup_code())),
            &key,
            &abandon,
            Duration::from_millis(500),
        )
        .await;
        assert!(matches!(first, Err(CollabError::SignInTimedOut)));
        let start = opened
            .lock()
            .expect("lock")
            .clone()
            .expect("browser opened");
        let start = ::url::Url::parse(&start).expect("start url");
        let redirect = start
            .query_pairs()
            .find(|(name, _)| name == "redirect_uri")
            .map(|(_, value)| value.into_owned())
            .expect("redirect_uri");
        let port = ::url::Url::parse(&redirect)
            .expect("redirect")
            .port()
            .expect("port");
        assert!(tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_err());
        let (_, tokens) = sign_in(
            sign_in_request(&server, Some(server.setup_code())),
            &key,
            &follow_browser,
            LONG,
        )
        .await
        .expect("retry");
        assert!(!tokens.access_token.is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn unknown_provider_is_refused_before_the_browser_opens() {
        let (_github, server) = github_server(vec![github_user(1, "carol")]).await;
        let mut request = sign_in_request(&server, None);
        request.provider_id = "gitlab".to_string();
        let opened = Arc::new(Mutex::new(false));
        let seen = opened.clone();
        let record = move |_: &str| -> Result<(), CollabError> {
            *seen.lock().expect("lock") = true;
            Ok(())
        };
        let result = sign_in(request, &device_key(), &record, LONG).await;
        assert!(matches!(
            result,
            Err(CollabError::Api { ref code, .. }) if code == "unknown_provider"
        ));
        assert!(!*opened.lock().expect("lock"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn incompatible_server_is_refused_before_the_browser_opens() {
        let body = serde_json::to_string(&sample_manifest(ProtocolRange { min: 2, max: 3 }))
            .expect("manifest");
        let url = canned(http_response(
            "200 OK",
            &[("Content-Type", "application/json")],
            &body,
        ))
        .await;
        let request = SignInRequest {
            url,
            provider_id: "github".to_string(),
            device_name: "Test Mac".to_string(),
            platform: "macos".to_string(),
            setup_code: None,
        };
        let result = sign_in(request, &device_key(), &follow_browser, LONG).await;
        assert!(matches!(
            result,
            Err(CollabError::ProtocolMismatch(VersionMismatch::ClientTooOld))
        ));
    }

    #[test]
    fn an_email_sign_in_waits_long_enough_for_the_link() {
        let usual = Duration::from_secs(300);
        assert_eq!(wait_for(ProviderKind::EmailLink, usual), EMAIL_LINK_WAIT);
        assert!(EMAIL_LINK_WAIT > Duration::from_secs(15 * 60));
        assert_eq!(wait_for(ProviderKind::Github, usual), usual);
        assert_eq!(wait_for(ProviderKind::Oidc, usual), usual);
        let longer = Duration::from_secs(30 * 60);
        assert_eq!(wait_for(ProviderKind::EmailLink, longer), longer);
    }

    #[test]
    fn callback_errors_map_to_their_kinds() {
        assert!(matches!(
            callback_error("not_admitted".to_string(), None),
            CollabError::NotAdmitted
        ));
        assert!(matches!(
            callback_error("sign_in_cancelled".to_string(), None),
            CollabError::SignInCancelled
        ));
        assert!(matches!(
            callback_error("access_denied".to_string(), None),
            CollabError::SignInCancelled
        ));
        assert!(matches!(
            callback_error("setup_code_invalid".to_string(), Some("used".to_string())),
            CollabError::Api { status: 400, ref code, ref message }
                if code == "setup_code_invalid" && message == "used"
        ));
    }
}
