use std::time::Duration;

use oleafly_collab_protocol::auth::{
    challenge_message, AuthStartQuery, ChallengePurpose, SessionTokens, SetupClaimRequest,
    TokenRequest,
};
use oleafly_collab_protocol::capabilities::{
    negotiate, CapabilityManifest, ProtocolRange, ProviderKind,
};
use oleafly_collab_protocol::crypto::{b64url_encode, pkce_s256};
use oleafly_collab_protocol::ids::ServerId;
use ring::rand::{SecureRandom, SystemRandom};

use super::loopback::{CallbackOutcome, LoopbackListener};
use super::{client_protocol, ServerClient, ServerUrl};
use crate::{CollabError, DeviceKey, SessionManager};

const VERIFIER_BYTES: usize = 32;
const STATE_BYTES: usize = 16;

pub struct SignInRequest {
    pub url: ServerUrl,
    pub provider_id: String,
    pub device_name: String,
    pub platform: String,
    pub setup_code: Option<String>,
}

pub(crate) fn linked_to_another_account<T>(result: &Result<T, CollabError>) -> bool {
    matches!(result, Err(CollabError::Api { code, .. }) if code == "device_in_use")
}

pub async fn sign_in_as(
    request: SignInRequest,
    sessions: &SessionManager,
    server: ServerId,
    open_browser: &(dyn Fn(&str) -> Result<(), CollabError> + Send + Sync),
    timeout: Duration,
) -> Result<(CapabilityManifest, SessionTokens), CollabError> {
    let key = sessions.device_key(server)?;
    let signed = sign_in(request, &key, open_browser, timeout).await;
    if linked_to_another_account(&signed) {
        sessions.renew_device_key(server)?;
    }
    signed
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
    let listener = LoopbackListener::bind(client.url().clone())
        .await?
        .describing(&manifest.name, &provider_label, kind);
    let verifier = random_b64url(VERIFIER_BYTES)?;
    let state = random_b64url(STATE_BYTES)?;
    let code_challenge = pkce_s256(&verifier);
    let (setup_code, setup_claim) = match setup_code.filter(|_| manifest.needs_setup) {
        Some(code) => claimed(&client, code, &code_challenge).await?,
        None => (None, None),
    };
    let query = AuthStartQuery {
        provider: provider_id,
        redirect_uri: listener.redirect_uri(),
        state: state.clone(),
        code_challenge,
        device_public_key: key.public_key_b64(),
        device_name,
        platform,
        setup_code,
        setup_claim,
    };
    open_browser(client.auth_start_url(&query)?.as_str())?;
    let callback = listener.wait(&state, timeout).await?;
    let code = match &callback.outcome {
        CallbackOutcome::Code(code) => code.clone(),
        CallbackOutcome::Error { code, description } => {
            return Err(callback_error(code.clone(), description.clone()));
        }
    };
    let exchanged = exchange(&client, &manifest, key, code, verifier).await;
    callback.answer(exchanged.as_ref().map(|_| ())).await;
    Ok((manifest, exchanged?))
}

// The setup code makes its holder the first admin, so it never goes in the
// sign-in address, where browser history and proxy logs would keep it. It
// is posted first and only a single-use claim tied to this sign-in's PKCE
// challenge goes in the address.
async fn claimed(
    client: &ServerClient,
    code: String,
    code_challenge: &str,
) -> Result<(Option<String>, Option<String>), CollabError> {
    let request = SetupClaimRequest {
        setup_code: code,
        code_challenge: code_challenge.to_owned(),
    };
    match client.setup_claim(&request).await {
        Ok(response) => Ok((None, Some(response.claim))),
        // Until the server half of the claim route is merged, the test
        // server answers 404 here. Only the tests fall back to the code in
        // the address; the app never does.
        #[cfg(test)]
        Err(CollabError::Api { status: 404, .. }) => Ok((Some(request.setup_code), None)),
        Err(error) => Err(error),
    }
}

async fn exchange(
    client: &ServerClient,
    manifest: &CapabilityManifest,
    key: &DeviceKey,
    code: String,
    verifier: String,
) -> Result<SessionTokens, CollabError> {
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
    client.exchange_token(&request).await
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
        allow_alice, bob_and_alice_server, canned, device_key, follow_browser, github_server,
        github_user, http_response, last_page, recording_browser, sample_manifest, seed,
        server_url, sign_in_request, Pages, LONG,
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

    async fn first_admin_server(
        claim_reply: String,
    ) -> (ServerUrl, crate::client::test_util::Heard) {
        let mut manifest = sample_manifest(ProtocolRange { min: 1, max: 1 });
        manifest.needs_setup = true;
        let manifest = serde_json::to_string(&manifest).expect("manifest");
        crate::client::test_util::routed(|_| {
            let json = [("Content-Type", "application/json")];
            vec![
                (
                    "/.well-known/oleafly-server",
                    vec![http_response("200 OK", &json, &manifest)],
                ),
                ("/auth/setup-claim", vec![claim_reply]),
            ]
        })
        .await
    }

    fn setup_request(url: ServerUrl) -> SignInRequest {
        SignInRequest {
            url,
            provider_id: "github".to_string(),
            device_name: "Lab PC".to_string(),
            platform: "linux".to_string(),
            setup_code: Some("482913".to_string()),
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_setup_code_never_goes_in_the_address_the_browser_opens() {
        let reply = http_response(
            "200 OK",
            &[("Content-Type", "application/json")],
            r#"{"claim":"claim-7f3a"}"#,
        );
        let (url, heard) = first_admin_server(reply).await;
        let opened = Arc::new(Mutex::new(Vec::<String>::new()));
        let seen = Arc::clone(&opened);
        let browser = move |address: &str| -> Result<(), CollabError> {
            seen.lock().expect("opened").push(address.to_owned());
            Ok(())
        };
        let result = sign_in(
            setup_request(url),
            &device_key(),
            &browser,
            Duration::from_millis(300),
        )
        .await;
        assert!(matches!(result, Err(CollabError::SignInTimedOut)));
        let opened = opened.lock().expect("opened").clone();
        assert_eq!(opened.len(), 1);
        let address = url::Url::parse(&opened[0]).expect("address");
        let query: Vec<(String, String)> = address.query_pairs().into_owned().collect();
        assert!(!opened[0].contains("482913"), "{}", opened[0]);
        assert!(query.iter().all(|(name, _)| name != "setup_code"));
        assert!(query.contains(&("setup_claim".to_owned(), "claim-7f3a".to_owned())));
        let challenge = query
            .iter()
            .find(|(name, _)| name == "code_challenge")
            .map(|(_, value)| value.clone())
            .expect("challenge");
        let heard = heard.lock().expect("heard").clone();
        let posted = heard
            .iter()
            .find(|request| request.starts_with("POST /auth/setup-claim "))
            .expect("the code was posted");
        let body = posted.split("\r\n\r\n").nth(1).expect("body");
        let claimed: SetupClaimRequest = serde_json::from_str(body).expect("claim request");
        assert_eq!(claimed.setup_code, "482913");
        assert_eq!(claimed.code_challenge, challenge);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_wrong_setup_code_is_refused_before_the_browser_opens() {
        let reply = http_response(
            "403 Forbidden",
            &[("Content-Type", "application/json")],
            r#"{"code":"setup_code_invalid","message":"That setup code is not valid."}"#,
        );
        let (url, _heard) = first_admin_server(reply).await;
        let opened = Arc::new(Mutex::new(false));
        let seen = Arc::clone(&opened);
        let browser = move |_: &str| -> Result<(), CollabError> {
            *seen.lock().expect("opened") = true;
            Ok(())
        };
        let result = sign_in(setup_request(url), &device_key(), &browser, LONG).await;
        assert!(
            matches!(result, Err(CollabError::Api { status: 403, ref code, .. }) if code == "setup_code_invalid"),
            "{result:?}"
        );
        assert!(!*opened.lock().expect("opened"));
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

    fn alice_request(server: &oleafly_server::test_support::TestServer) -> SignInRequest {
        let mut request = sign_in_request(server, None);
        request.provider_id = "github2".to_string();
        request
    }

    async fn one_computer(
        server: &oleafly_server::test_support::TestServer,
    ) -> (crate::SessionManager, ServerClient, ServerId) {
        let sessions = crate::SessionManager::new(
            Arc::new(crate::MemorySecrets::default()),
            Arc::new(device_key()),
        );
        let client = ServerClient::new(server_url(server)).expect("client");
        let server_id = client.capabilities().await.expect("manifest").server_id;
        (sessions, client, server_id)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_second_person_signs_in_on_the_same_computer_after_the_first_signs_out() {
        let (_bob_github, _alice_github, server) = bob_and_alice_server().await;
        let (sessions, client, server_id) = one_computer(&server).await;
        let (_, bob) = sign_in_as(
            sign_in_request(&server, Some(server.setup_code())),
            &sessions,
            server_id,
            &follow_browser,
            LONG,
        )
        .await
        .expect("bob signs in");
        allow_alice(&server, &bob).await;
        sessions.store(server_id, &bob).expect("store");
        client
            .sign_out(&bob.access_token)
            .await
            .expect("the server signs bob out");
        sessions.sign_out(server_id).expect("the app signs bob out");
        let (_, alice) = sign_in_as(
            alice_request(&server),
            &sessions,
            server_id,
            &follow_browser,
            LONG,
        )
        .await
        .expect("alice signs in on the same computer");
        assert_ne!(alice.account_id, bob.account_id);
        assert_ne!(alice.device_id, bob.device_id);
        sessions.store(server_id, &alice).expect("store");
        let access = sessions
            .force_refresh(server_id, &client)
            .await
            .expect("alice's session refreshes with this computer's new key");
        assert!(client.me(&access).await.is_ok());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_computer_linked_to_another_account_is_told_so_and_the_next_try_works() {
        let (_bob_github, _alice_github, server) = bob_and_alice_server().await;
        let (sessions, _client, server_id) = one_computer(&server).await;
        let (_, bob) = sign_in_as(
            sign_in_request(&server, Some(server.setup_code())),
            &sessions,
            server_id,
            &follow_browser,
            LONG,
        )
        .await
        .expect("bob signs in");
        allow_alice(&server, &bob).await;
        let pages: Pages = Arc::default();
        let refused = sign_in_as(
            alice_request(&server),
            &sessions,
            server_id,
            &recording_browser(Arc::clone(&pages)),
            LONG,
        )
        .await;
        assert!(
            matches!(refused, Err(CollabError::Api { ref code, .. }) if code == "device_in_use"),
            "{refused:?}"
        );
        let page = last_page(&pages).await;
        assert!(!page.contains("You're signed in"), "{page}");
        assert!(!page.contains("You&#39;re signed in"), "{page}");
        assert!(
            page.contains("<h1>This computer is linked to another account</h1>"),
            "{page}"
        );
        let (_, alice) = sign_in_as(
            alice_request(&server),
            &sessions,
            server_id,
            &follow_browser,
            LONG,
        )
        .await
        .expect("the next try uses a new key for this computer");
        assert_ne!(alice.device_id, bob.device_id);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_browser_says_signed_in_once_the_app_holds_its_session() {
        let (_github, server) = github_server(vec![github_user(1, "carol")]).await;
        let pages: Pages = Arc::default();
        sign_in(
            sign_in_request(&server, Some(server.setup_code())),
            &device_key(),
            &recording_browser(Arc::clone(&pages)),
            LONG,
        )
        .await
        .expect("sign in");
        let page = last_page(&pages).await;
        assert!(page.contains("<h1>You&#39;re signed in</h1>"), "{page}");
    }

    struct Bouncer {
        url: ServerUrl,
        asked_for_tokens: Arc<std::sync::atomic::AtomicUsize>,
    }

    impl Bouncer {
        async fn start(onward_to: ServerUrl, own_key: String) -> Bouncer {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
                .await
                .expect("bind");
            let port = listener.local_addr().expect("address").port();
            let asked_for_tokens = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let asked = Arc::clone(&asked_for_tokens);
            let manifest =
                serde_json::to_string(&sample_manifest(ProtocolRange { min: 1, max: 1 }))
                    .expect("manifest");
            tokio::spawn(async move {
                while let Ok((mut stream, _)) = listener.accept().await {
                    let mut head = Vec::new();
                    let mut buffer = [0u8; 4096];
                    while !head.windows(4).any(|window| window == b"\r\n\r\n") {
                        match stream.read(&mut buffer).await {
                            Ok(0) | Err(_) => break,
                            Ok(read) => head.extend_from_slice(&buffer[..read]),
                        }
                    }
                    let head = String::from_utf8_lossy(&head).to_string();
                    let requested = head.split_whitespace().nth(1).unwrap_or("/").to_owned();
                    let asked_at = ::url::Url::parse(&format!("http://bouncer{requested}"))
                        .expect("request target");
                    let answer = match asked_at.path() {
                        "/.well-known/oleafly-server" => http_response(
                            "200 OK",
                            &[("Content-Type", "application/json")],
                            &manifest,
                        ),
                        "/auth/start" => {
                            let mut onward = onward_to.endpoint("auth/start");
                            for (name, value) in asked_at.query_pairs() {
                                let value = if name == "device_public_key" {
                                    own_key.clone()
                                } else {
                                    value.into_owned()
                                };
                                onward.query_pairs_mut().append_pair(&name, &value);
                            }
                            http_response("302 Found", &[("Location", onward.as_str())], "")
                        }
                        _ => {
                            asked.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                            http_response("404 Not Found", &[], "")
                        }
                    };
                    let _ = stream.write_all(answer.as_bytes()).await;
                    let _ = stream.shutdown().await;
                }
            });
            Bouncer {
                url: ServerUrl::parse(&format!("http://127.0.0.1:{port}")).expect("address"),
                asked_for_tokens,
            }
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_server_that_bounces_the_sign_in_to_another_server_never_gets_that_servers_code() {
        let (_github, lab) = github_server(vec![github_user(5, "alice")]).await;
        let admin = seed(&lab, ServerRole::Admin).await;
        ServerClient::new(server_url(&lab))
            .expect("client")
            .admin_add_allowlist(
                &admin.access_token,
                &NewAllowlistEntry {
                    matcher: AllowlistMatcher::ProviderLogin {
                        provider: "github".to_string(),
                        login: "alice".to_string(),
                    },
                    role: ServerRole::Admin,
                },
            )
            .await
            .expect("allowlist");
        let mallory = Bouncer::start(server_url(&lab), device_key().public_key_b64()).await;
        let pages: Pages = Arc::default();
        let request = SignInRequest {
            url: mallory.url.clone(),
            provider_id: "github".to_string(),
            device_name: "Alice's Mac".to_string(),
            platform: "macos".to_string(),
            setup_code: None,
        };
        let result = sign_in(
            request,
            &device_key(),
            &recording_browser(Arc::clone(&pages)),
            Duration::from_secs(3),
        )
        .await;
        assert!(
            matches!(result, Err(CollabError::SignInTimedOut)),
            "{result:?}"
        );
        assert_eq!(
            mallory
                .asked_for_tokens
                .load(std::sync::atomic::Ordering::SeqCst),
            0,
            "the app sent something to the server that bounced the sign-in"
        );
        let page = last_page(&pages).await;
        assert!(
            page.contains("<h1>This sign-in came from a different server</h1>"),
            "{page}"
        );
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
