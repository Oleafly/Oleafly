use std::future::Future;
use std::time::Duration;

use ::url::Url;
use oleafly_collab_protocol::auth::{
    challenge_message, ChallengePurpose, DeviceCodeRequest, DeviceCodeResponse, DevicePoll,
    DeviceTokenRequest, SessionTokens,
};
use oleafly_collab_protocol::capabilities::{negotiate, CapabilityManifest, ProtocolRange};
use oleafly_collab_protocol::ids::ServerId;
use serde::Serialize;

use super::http::json;
use super::sign_in::linked_to_another_account;
use super::{client_protocol, now_ms, ServerClient, ServerUrl};
use crate::{CollabError, DeviceKey, SessionManager};

pub struct CodeSignInRequest {
    pub url: ServerUrl,
    pub device_name: String,
    pub platform: String,
    pub setup_code: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInCode {
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_at: i64,
}

impl ServerClient {
    pub async fn request_device_code(
        &self,
        request: &DeviceCodeRequest,
    ) -> Result<DeviceCodeResponse, CollabError> {
        json(
            self.http()
                .post(self.url().endpoint("auth/device/code"))
                .json(request),
        )
        .await
    }

    pub async fn poll_device_token(
        &self,
        request: &DeviceTokenRequest,
    ) -> Result<DevicePoll, CollabError> {
        json(
            self.http()
                .post(self.url().endpoint("auth/device/token"))
                .json(request),
        )
        .await
    }
}

const NETWORK_RETRIES: usize = 3;
const SLOW_DOWN: Duration = Duration::from_secs(5);
const SHORTEST_WAIT: Duration = Duration::from_secs(1);
const LONGEST_WAIT: Duration = Duration::from_secs(60);

fn server_wait(seconds: u64, at_least: Duration) -> Duration {
    Duration::from_secs(seconds)
        .max(at_least)
        .clamp(SHORTEST_WAIT, LONGEST_WAIT)
}

pub(crate) async fn wait_for_approval<Poll, Polled, Sleep, Slept>(
    interval: Duration,
    mut poll: Poll,
    mut sleep: Sleep,
) -> Result<SessionTokens, CollabError>
where
    Poll: FnMut() -> Polled,
    Polled: Future<Output = Result<DevicePoll, CollabError>>,
    Sleep: FnMut(Duration) -> Slept,
    Slept: Future<Output = ()>,
{
    let mut interval = interval.clamp(SHORTEST_WAIT, LONGEST_WAIT);
    let mut failures = 0;
    loop {
        sleep(interval).await;
        match poll().await {
            Ok(DevicePoll::Approved { tokens }) => return Ok(tokens),
            Ok(DevicePoll::Pending { interval: next }) => {
                failures = 0;
                interval = server_wait(next, SHORTEST_WAIT);
            }
            Ok(DevicePoll::SlowDown { interval: next }) => {
                failures = 0;
                interval = server_wait(next, interval + SLOW_DOWN);
            }
            Ok(DevicePoll::Denied) => return Err(CollabError::SignInCancelled),
            Ok(DevicePoll::Expired) => return Err(CollabError::SignInTimedOut),
            Err(CollabError::Api { code, .. }) if code == "not_admitted" => {
                return Err(CollabError::NotAdmitted)
            }
            Err(CollabError::Api { status: 429, .. }) => {
                interval = (interval + SLOW_DOWN).min(LONGEST_WAIT);
            }
            Err(CollabError::Network(message)) => {
                failures += 1;
                if failures > NETWORK_RETRIES {
                    return Err(CollabError::Network(message));
                }
            }
            Err(other) => return Err(other),
        }
    }
}

// The approval page must be the sign-in server's own, or a server could send
// its users to approve a code another server issued for a key it holds.
fn on_page(approval: &Url, shown: &str) -> bool {
    let Ok(shown) = Url::parse(shown) else {
        return false;
    };
    let path = shown.path();
    shown.origin() == approval.origin()
        && shown.username().is_empty()
        && shown.password().is_none()
        && (path == approval.path() || path.starts_with(&format!("{}/", approval.path())))
}

async fn poll_once(
    client: &ServerClient,
    key: &DeviceKey,
    server_id: ServerId,
    device_code: &str,
) -> Result<DevicePoll, CollabError> {
    let challenge = client.challenge().await?;
    let message = challenge_message(ChallengePurpose::Token, server_id, &challenge.nonce);
    client
        .poll_device_token(&DeviceTokenRequest {
            device_code: device_code.to_string(),
            signature: key.sign_b64(&message),
            nonce: challenge.nonce,
        })
        .await
}

pub async fn sign_in_with_code_as(
    request: CodeSignInRequest,
    sessions: &SessionManager,
    server: ServerId,
    show_code: &(dyn Fn(&SignInCode) -> Result<(), CollabError> + Send + Sync),
) -> Result<(CapabilityManifest, SessionTokens), CollabError> {
    let key = sessions.device_key(server)?;
    let signed = sign_in_with_code(request, &key, show_code).await;
    if linked_to_another_account(&signed) {
        sessions.renew_device_key(server)?;
    }
    signed
}

pub async fn sign_in_with_code(
    request: CodeSignInRequest,
    key: &DeviceKey,
    show_code: &(dyn Fn(&SignInCode) -> Result<(), CollabError> + Send + Sync),
) -> Result<(CapabilityManifest, SessionTokens), CollabError> {
    let CodeSignInRequest {
        url,
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
    let issued = client
        .request_device_code(&DeviceCodeRequest {
            device_public_key: key.public_key_b64(),
            device_name,
            platform,
            setup_code: setup_code.filter(|_| manifest.needs_setup),
        })
        .await?;
    let approval = client.url().endpoint("auth/device");
    if !on_page(&approval, &issued.verification_uri)
        || !on_page(&approval, &issued.verification_uri_complete)
    {
        return Err(CollabError::Api {
            status: 400,
            code: "wrong_server".to_string(),
            message: "The server sent its sign-in page on another address, so Oleafly stopped."
                .to_string(),
        });
    }
    let lifetime = i64::try_from(issued.expires_in.saturating_mul(1000)).unwrap_or(i64::MAX);
    show_code(&SignInCode {
        user_code: issued.user_code.clone(),
        verification_uri: issued.verification_uri.clone(),
        verification_uri_complete: issued.verification_uri_complete.clone(),
        expires_at: now_ms().saturating_add(lifetime),
    })?;
    let server_id = manifest.server_id;
    let device_code = issued.device_code;
    let tokens = wait_for_approval(
        Duration::from_secs(issued.interval),
        || poll_once(&client, key, server_id, &device_code),
        tokio::time::sleep,
    )
    .await?;
    Ok((manifest, tokens))
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    use oleafly_collab_protocol::admin::{AllowlistMatcher, NewAllowlistEntry};
    use oleafly_collab_protocol::roles::ServerRole;
    use oleafly_server::test_support::approve_code;

    use super::*;
    use crate::client::test_util::{
        device_key, github_server, github_user, http_response, seed, server_url,
    };

    const ACCOUNT: &str = "01920000-0000-7000-8000-000000000002";
    const DEVICE: &str = "01920000-0000-7000-8000-000000000003";

    fn tokens() -> SessionTokens {
        SessionTokens {
            account_id: ACCOUNT.parse().unwrap(),
            device_id: DEVICE.parse().unwrap(),
            access_token: "at".to_string(),
            access_expires_at: 1,
            refresh_token: "rt".to_string(),
        }
    }

    async fn run(
        replies: Vec<Result<DevicePoll, CollabError>>,
    ) -> (Result<SessionTokens, CollabError>, Vec<u64>, usize) {
        let replies = Arc::new(Mutex::new(VecDeque::from(replies)));
        let slept = Arc::new(Mutex::new(Vec::new()));
        let polls = Arc::new(Mutex::new(0usize));
        let result = wait_for_approval(
            Duration::from_secs(5),
            || {
                let replies = Arc::clone(&replies);
                let polls = Arc::clone(&polls);
                async move {
                    *polls.lock().unwrap() += 1;
                    replies
                        .lock()
                        .unwrap()
                        .pop_front()
                        .expect("no more replies")
                }
            },
            |delay| {
                let slept = Arc::clone(&slept);
                async move { slept.lock().unwrap().push(delay.as_secs()) }
            },
        )
        .await;
        let slept = slept.lock().unwrap().clone();
        let polls = *polls.lock().unwrap();
        (result, slept, polls)
    }

    #[tokio::test]
    async fn the_app_waits_the_servers_interval_and_slows_down_when_told() {
        let (result, slept, polls) = run(vec![
            Ok(DevicePoll::Pending { interval: 5 }),
            Ok(DevicePoll::SlowDown { interval: 10 }),
            Ok(DevicePoll::Pending { interval: 10 }),
            Ok(DevicePoll::Approved { tokens: tokens() }),
        ])
        .await;
        assert_eq!(result.expect("tokens"), tokens());
        assert_eq!(slept, [5, 5, 10, 10]);
        assert_eq!(polls, 4);
    }

    #[tokio::test]
    async fn a_denied_code_cancels_and_an_expired_one_times_out() {
        let (denied, _, _) = run(vec![Ok(DevicePoll::Denied)]).await;
        assert!(matches!(denied, Err(CollabError::SignInCancelled)));
        let (expired, _, _) = run(vec![
            Ok(DevicePoll::Pending { interval: 5 }),
            Ok(DevicePoll::Expired),
        ])
        .await;
        assert!(matches!(expired, Err(CollabError::SignInTimedOut)));
    }

    #[tokio::test]
    async fn a_refused_person_hears_not_admitted() {
        let (refused, _, _) = run(vec![Err(CollabError::Api {
            status: 403,
            code: "not_admitted".to_string(),
            message: "no".to_string(),
        })])
        .await;
        assert!(matches!(refused, Err(CollabError::NotAdmitted)));
    }

    #[tokio::test]
    async fn short_network_trouble_and_rate_limits_do_not_end_the_wait() {
        let network = || Err(CollabError::Network("reset".to_string()));
        let (result, slept, _) = run(vec![
            network(),
            network(),
            Err(CollabError::Api {
                status: 429,
                code: "rate_limited".to_string(),
                message: String::new(),
            }),
            Ok(DevicePoll::Approved { tokens: tokens() }),
        ])
        .await;
        assert_eq!(result.expect("tokens"), tokens());
        assert_eq!(slept, [5, 5, 5, 10]);
        let (gave_up, _, polls) = run(vec![network(), network(), network(), network()]).await;
        assert!(matches!(gave_up, Err(CollabError::Network(_))));
        assert_eq!(polls, 4);
    }

    #[tokio::test]
    async fn a_code_that_sends_people_to_another_address_is_refused_before_it_is_shown() {
        let manifest =
            serde_json::to_string(&crate::client::test_util::sample_manifest(ProtocolRange {
                min: 1,
                max: 1,
            }))
            .expect("manifest");
        let elsewhere = [
            (
                "https://evil.example/auth/device",
                "OWN/auth/device?code=BCDF-GHJK",
            ),
            (
                "OWN/auth/device",
                "https://evil.example/auth/device?code=BCDF-GHJK",
            ),
            (
                "OWN/auth/device",
                "OWN/auth/devices-elsewhere?code=BCDF-GHJK",
            ),
            (
                "OWN/auth/device",
                "http://someone@OWNHOST/auth/device?code=BCDF-GHJK",
            ),
        ];
        for (plain, complete) in elsewhere {
            let (url, heard) = crate::client::test_util::routed(|own| {
                let host = own.as_str().trim_start_matches("http://");
                let place = |page: &str| page.replace("OWNHOST", host).replace("OWN", own.as_str());
                let (plain, complete) = (place(plain), place(complete));
                let issued = serde_json::json!({
                    "device_code": "dc",
                    "user_code": "BCDF-GHJK",
                    "verification_uri": plain,
                    "verification_uri_complete": complete,
                    "expires_in": 600,
                    "interval": 5,
                })
                .to_string();
                let json = [("Content-Type", "application/json")];
                vec![
                    (
                        "/.well-known/oleafly-server",
                        vec![http_response("200 OK", &json, &manifest)],
                    ),
                    (
                        "/auth/device/code",
                        vec![http_response("200 OK", &json, &issued)],
                    ),
                ]
            })
            .await;
            let shown = Arc::new(Mutex::new(false));
            let seen = Arc::clone(&shown);
            let show = move |_: &SignInCode| -> Result<(), CollabError> {
                *seen.lock().expect("lock") = true;
                Ok(())
            };
            let request = CodeSignInRequest {
                url,
                device_name: "Lab PC".to_string(),
                platform: "linux".to_string(),
                setup_code: None,
            };
            let result = sign_in_with_code(request, &device_key(), &show).await;
            assert!(
                matches!(result, Err(CollabError::Api { ref code, .. }) if code == "wrong_server"),
                "{result:?}"
            );
            assert!(!*shown.lock().expect("lock"));
            assert!(heard
                .lock()
                .expect("heard")
                .iter()
                .all(|request| !request.contains("/auth/device/token")));
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_code_sign_in_shows_the_code_and_returns_this_devices_session() {
        let (_github, server) = github_server(vec![github_user(4, "dana")]).await;
        let admin = seed(&server, ServerRole::Admin).await;
        let client = ServerClient::new(server_url(&server)).expect("client");
        client
            .admin_add_allowlist(
                &admin.access_token,
                &NewAllowlistEntry {
                    matcher: AllowlistMatcher::ProviderLogin {
                        provider: "github".to_string(),
                        login: "dana".to_string(),
                    },
                    role: ServerRole::Member,
                },
            )
            .await
            .expect("allowlist");
        let key = device_key();
        let shown: Arc<Mutex<Option<SignInCode>>> = Arc::new(Mutex::new(None));
        let seen = Arc::clone(&shown);
        let show = move |code: &SignInCode| -> Result<(), CollabError> {
            *seen.lock().expect("lock") = Some(code.clone());
            let complete = code.verification_uri_complete.clone();
            tokio::spawn(async move {
                let page = approve_code(&complete, "GitHub")
                    .await
                    .expect("the browser finishes");
                assert_eq!(page.status, 200, "{}", page.body);
            });
            Ok(())
        };
        let request = CodeSignInRequest {
            url: server_url(&server),
            device_name: "Lab PC".to_string(),
            platform: "linux".to_string(),
            setup_code: None,
        };
        let (manifest, tokens) = tokio::time::timeout(
            Duration::from_secs(60),
            sign_in_with_code(request, &key, &show),
        )
        .await
        .expect("the sign-in finishes")
        .expect("signed in with a code");
        assert_eq!(manifest.server_id, server.state().server_id);
        let shown = shown
            .lock()
            .expect("lock")
            .clone()
            .expect("the code was shown");
        assert_eq!(shown.user_code.len(), 9);
        assert!(shown.verification_uri.ends_with("/auth/device"));
        assert!(shown.expires_at > super::super::now_ms());
        let me = client.me(&tokens.access_token).await.expect("me");
        assert_eq!(me.logins, ["dana"]);
        let devices = client.devices(&tokens.access_token).await.expect("devices");
        assert!(devices
            .iter()
            .any(|device| device.current && device.name == "Lab PC"));
    }
}
