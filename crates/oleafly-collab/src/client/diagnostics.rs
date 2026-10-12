use std::time::{Duration, UNIX_EPOCH};

use oleafly_collab_protocol::auth::ApiError;
use oleafly_collab_protocol::capabilities::{
    negotiate, CapabilityManifest, ProtocolRange, VersionMismatch, WELL_KNOWN_PATH,
};
use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};
use reqwest::header::DATE;
use serde::{Deserialize, Serialize};

use super::http::{check_status, network_error};
use super::ws::{connect_tcp, open_socket};
use super::{client_protocol, now_ms, ServerClient, ServerUrl};
use crate::CollabError;

const CLOCK_TOLERANCE: Duration = Duration::from_secs(5 * 60);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckId {
    Reachable,
    Https,
    Protocol,
    #[serde(rename = "websocket")]
    WebSocket,
    SignInProviders,
    Email,
    Clock,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckStatus {
    Pass,
    Fail,
    Info,
    Skipped,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectionCheck {
    pub id: CheckId,
    pub status: CheckStatus,
    pub detail: Option<String>,
}

struct ManifestProbe {
    transport: Result<(), String>,
    date: Option<i64>,
    manifest: Result<CapabilityManifest, String>,
}

impl ManifestProbe {
    fn unavailable(reason: String) -> ManifestProbe {
        ManifestProbe {
            transport: Err(reason.clone()),
            date: None,
            manifest: Err(reason),
        }
    }
}

pub async fn test_connection(url: &ServerUrl) -> Vec<ConnectionCheck> {
    test_connection_pinned(url, None).await
}

pub async fn test_connection_pinned(
    url: &ServerUrl,
    expected: Option<ServerId>,
) -> Vec<ConnectionCheck> {
    let (reachable, probe, socket) =
        tokio::join!(reachable_check(url), probe_manifest(url), socket_opens(url));
    let websocket = websocket_check(url, socket, &probe).await;
    vec![
        reachable,
        https_check(url, &probe),
        protocol_check(&probe, expected),
        websocket,
        providers_check(&probe),
        email_check(&probe),
        clock_check(probe.date, now_ms()),
    ]
}

fn check(id: CheckId, status: CheckStatus, detail: Option<String>) -> ConnectionCheck {
    ConnectionCheck { id, status, detail }
}

fn detail(error: &CollabError) -> String {
    match error {
        CollabError::Network(message) => message.clone(),
        CollabError::Api { status, code, .. } => format!("{status} {code}"),
        CollabError::NotHttps => "not_https".to_string(),
        CollabError::Unauthorized => "unauthorized".to_string(),
        other => format!("{other:?}"),
    }
}

async fn reachable_check(url: &ServerUrl) -> ConnectionCheck {
    match connect_tcp(&url.endpoint("")).await {
        Ok(_) => check(CheckId::Reachable, CheckStatus::Pass, None),
        Err(error) => check(CheckId::Reachable, CheckStatus::Fail, Some(detail(&error))),
    }
}

async fn probe_manifest(url: &ServerUrl) -> ManifestProbe {
    let client = match ServerClient::new(url.clone()) {
        Ok(client) => client,
        Err(error) => return ManifestProbe::unavailable(detail(&error)),
    };
    let response = match client
        .http()
        .get(url.endpoint(WELL_KNOWN_PATH))
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => return ManifestProbe::unavailable(detail(&network_error(error))),
    };
    let date = response
        .headers()
        .get(DATE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| httpdate::parse_http_date(value).ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as i64);
    let manifest = match check_status(response).await {
        Ok(response) => response
            .json::<CapabilityManifest>()
            .await
            .map_err(|error| error.to_string()),
        Err(error) => Err(detail(&error)),
    };
    ManifestProbe {
        transport: Ok(()),
        date,
        manifest,
    }
}

async fn socket_opens(url: &ServerUrl) -> Result<(), CollabError> {
    let mut socket = open_socket(url).await?;
    let _ = socket.close(None).await;
    Ok(())
}

async fn long_poll_answers(url: &ServerUrl) -> bool {
    let Ok(client) = ServerClient::new(url.clone()) else {
        return false;
    };
    let mut target = url.endpoint("api/v1/projects");
    if let Ok(mut segments) = target.path_segments_mut() {
        segments.push(&SharedProjectId::new_v7().to_string());
        segments.push("poll");
    }
    let Ok(response) = client.http().get(target).send().await else {
        return false;
    };
    if response.status() != reqwest::StatusCode::UNAUTHORIZED {
        return false;
    }
    response
        .json::<ApiError>()
        .await
        .is_ok_and(|error| error.code == "unauthorized")
}

async fn websocket_check(
    url: &ServerUrl,
    opened: Result<(), CollabError>,
    probe: &ManifestProbe,
) -> ConnectionCheck {
    let Err(error) = opened else {
        return check(CheckId::WebSocket, CheckStatus::Pass, None);
    };
    if probe.transport.is_ok() && long_poll_answers(url).await {
        return check(
            CheckId::WebSocket,
            CheckStatus::Info,
            Some("fallback".to_string()),
        );
    }
    check(CheckId::WebSocket, CheckStatus::Fail, Some(detail(&error)))
}

fn https_check(url: &ServerUrl, probe: &ManifestProbe) -> ConnectionCheck {
    if url.as_str().starts_with("http://") {
        return check(
            CheckId::Https,
            CheckStatus::Info,
            Some("loopback".to_string()),
        );
    }
    match &probe.transport {
        Ok(()) => check(CheckId::Https, CheckStatus::Pass, None),
        Err(reason) => check(CheckId::Https, CheckStatus::Fail, Some(reason.clone())),
    }
}

fn protocol_check(probe: &ManifestProbe, expected: Option<ServerId>) -> ConnectionCheck {
    let manifest = match &probe.manifest {
        Ok(manifest) => manifest,
        Err(reason) => return check(CheckId::Protocol, CheckStatus::Fail, Some(reason.clone())),
    };
    if let Some(expected) = expected.filter(|expected| *expected != manifest.server_id) {
        return check(
            CheckId::Protocol,
            CheckStatus::Fail,
            Some(format!("server_changed {expected} {}", manifest.server_id)),
        );
    }
    let server = ProtocolRange {
        min: manifest.protocol.min,
        max: manifest.protocol.max,
    };
    match negotiate(client_protocol(), server) {
        Ok(version) => check(
            CheckId::Protocol,
            CheckStatus::Pass,
            Some(version.to_string()),
        ),
        Err(VersionMismatch::ClientTooOld) => check(
            CheckId::Protocol,
            CheckStatus::Fail,
            Some("client_too_old".to_string()),
        ),
        Err(VersionMismatch::ServerTooOld) => check(
            CheckId::Protocol,
            CheckStatus::Fail,
            Some("server_too_old".to_string()),
        ),
    }
}

fn providers_check(probe: &ManifestProbe) -> ConnectionCheck {
    match &probe.manifest {
        Ok(manifest) if manifest.providers.is_empty() => {
            check(CheckId::SignInProviders, CheckStatus::Fail, None)
        }
        Ok(manifest) => {
            let labels: Vec<&str> = manifest
                .providers
                .iter()
                .map(|provider| provider.label.as_str())
                .collect();
            check(
                CheckId::SignInProviders,
                CheckStatus::Pass,
                Some(labels.join(", ")),
            )
        }
        Err(_) => check(CheckId::SignInProviders, CheckStatus::Skipped, None),
    }
}

fn email_check(probe: &ManifestProbe) -> ConnectionCheck {
    match &probe.manifest {
        Ok(manifest) => {
            let state = if manifest.features.email {
                "configured"
            } else {
                "not_configured"
            };
            check(CheckId::Email, CheckStatus::Info, Some(state.to_string()))
        }
        Err(_) => check(CheckId::Email, CheckStatus::Skipped, None),
    }
}

fn clock_check(server_ms: Option<i64>, local_ms: i64) -> ConnectionCheck {
    match server_ms {
        None => check(CheckId::Clock, CheckStatus::Skipped, None),
        Some(server_ms) => {
            let skew = server_ms - local_ms;
            let status = if skew.unsigned_abs() as u128 <= CLOCK_TOLERANCE.as_millis() {
                CheckStatus::Pass
            } else {
                CheckStatus::Fail
            };
            check(CheckId::Clock, status, Some((skew / 1000).to_string()))
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::SystemTime;

    use oleafly_server::test_support::{test_config, TestServer};

    use super::*;
    use crate::client::test_util::{
        canned, closed_url, github_server, github_user, http_response, sample_manifest, server_url,
    };

    fn statuses(checks: &[ConnectionCheck]) -> Vec<(CheckId, CheckStatus)> {
        checks.iter().map(|item| (item.id, item.status)).collect()
    }

    #[test]
    fn clock_within_five_minutes_passes() {
        let local = 1_760_000_000_000;
        assert_eq!(
            clock_check(Some(local + 4 * 60_000), local).status,
            CheckStatus::Pass
        );
        assert_eq!(
            clock_check(Some(local - 4 * 60_000), local).status,
            CheckStatus::Pass
        );
        assert_eq!(
            clock_check(Some(local + 6 * 60_000), local),
            check(CheckId::Clock, CheckStatus::Fail, Some("360".to_string()))
        );
        assert_eq!(
            clock_check(Some(local - 6 * 60_000), local).status,
            CheckStatus::Fail
        );
        assert_eq!(clock_check(None, local).status, CheckStatus::Skipped);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn healthy_server_passes_every_check() {
        let (_github, server) = github_server(vec![github_user(1, "carol")]).await;
        let checks = test_connection(&server_url(&server)).await;
        assert_eq!(
            statuses(&checks),
            vec![
                (CheckId::Reachable, CheckStatus::Pass),
                (CheckId::Https, CheckStatus::Info),
                (CheckId::Protocol, CheckStatus::Pass),
                (CheckId::WebSocket, CheckStatus::Pass),
                (CheckId::SignInProviders, CheckStatus::Pass),
                (CheckId::Email, CheckStatus::Info),
                (CheckId::Clock, CheckStatus::Pass),
            ]
        );
        assert_eq!(checks[1].detail.as_deref(), Some("loopback"));
        assert_eq!(checks[2].detail.as_deref(), Some("1"));
        assert_eq!(checks[4].detail.as_deref(), Some("GitHub"));
        assert_eq!(checks[5].detail.as_deref(), Some("not_configured"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn server_without_providers_fails_only_that_check() {
        let server = TestServer::start(test_config()).await;
        let checks = test_connection(&server_url(&server)).await;
        assert_eq!(
            checks[4],
            check(CheckId::SignInProviders, CheckStatus::Fail, None)
        );
        assert_eq!(checks[0].status, CheckStatus::Pass);
        assert_eq!(checks[2].status, CheckStatus::Pass);
        assert_eq!(checks[3].status, CheckStatus::Pass);
        assert_eq!(checks[6].status, CheckStatus::Pass);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_different_server_identity_fails_the_protocol_check() {
        let server = TestServer::start(test_config()).await;
        let url = server_url(&server);
        let actual = server.state().server_id;
        let pinned = ServerId::new_v7();
        let checks = test_connection_pinned(&url, Some(pinned)).await;
        assert_eq!(
            checks[2],
            check(
                CheckId::Protocol,
                CheckStatus::Fail,
                Some(format!("server_changed {pinned} {actual}"))
            )
        );
        assert_eq!(checks[0].status, CheckStatus::Pass);
        assert_eq!(checks[3].status, CheckStatus::Pass);
        let matching = test_connection_pinned(&url, Some(actual)).await;
        assert_eq!(matching[2].status, CheckStatus::Pass);
    }

    #[tokio::test]
    async fn closed_port_still_reports_all_seven_checks() {
        let checks = test_connection(&closed_url().await).await;
        assert_eq!(
            statuses(&checks),
            vec![
                (CheckId::Reachable, CheckStatus::Fail),
                (CheckId::Https, CheckStatus::Info),
                (CheckId::Protocol, CheckStatus::Fail),
                (CheckId::WebSocket, CheckStatus::Fail),
                (CheckId::SignInProviders, CheckStatus::Skipped),
                (CheckId::Email, CheckStatus::Skipped),
                (CheckId::Clock, CheckStatus::Skipped),
            ]
        );
        assert!(checks[0].detail.is_some());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn skewed_clock_fails_while_the_rest_still_report() {
        let body = serde_json::to_string(&sample_manifest(ProtocolRange { min: 1, max: 1 }))
            .expect("manifest");
        let an_hour_ago = httpdate::fmt_http_date(SystemTime::now() - Duration::from_secs(3600));
        let url = canned(http_response(
            "200 OK",
            &[
                ("Content-Type", "application/json"),
                ("Date", an_hour_ago.as_str()),
            ],
            &body,
        ))
        .await;
        let checks = test_connection(&url).await;
        assert_eq!(
            statuses(&checks),
            vec![
                (CheckId::Reachable, CheckStatus::Pass),
                (CheckId::Https, CheckStatus::Info),
                (CheckId::Protocol, CheckStatus::Pass),
                (CheckId::WebSocket, CheckStatus::Fail),
                (CheckId::SignInProviders, CheckStatus::Pass),
                (CheckId::Email, CheckStatus::Info),
                (CheckId::Clock, CheckStatus::Fail),
            ]
        );
        assert_eq!(checks[5].detail.as_deref(), Some("configured"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_network_that_blocks_websockets_names_the_slower_fallback() {
        let server = TestServer::start(test_config()).await;
        let upstream = server
            .url()
            .trim_start_matches("http://")
            .parse()
            .expect("server address");
        let proxy = oleafly_server::test_support::BlockingProxy::start(upstream).await;
        let url = ServerUrl::parse(&proxy.url()).expect("proxy address");
        let checks = test_connection(&url).await;
        assert_eq!(
            checks[3],
            check(
                CheckId::WebSocket,
                CheckStatus::Info,
                Some("fallback".to_string())
            )
        );
        assert_eq!(checks[0].status, CheckStatus::Pass);
        assert_eq!(checks[2].status, CheckStatus::Pass);
        assert!(proxy.refused() >= 1);
        proxy.block_websockets(false);
        let open = test_connection(&url).await;
        assert_eq!(open[3], check(CheckId::WebSocket, CheckStatus::Pass, None));
    }
}
