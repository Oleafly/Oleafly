//! What kind of server a base URL is. The hosted presets answer without a
//! network call; any other server gets four unauthenticated probes at once.
use crate::http::{self, Call, ForgeHttp};
use crate::kind::{preset, ForgeKind, ServerFlavor};
use crate::ForgeError;
use serde::Serialize;
use std::time::Duration;

const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
const PROBE_BODY_MAX_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub base: String,
    /// `None` when the server answered but matched no known API.
    pub kind: Option<ForgeKind>,
    pub flavor: Option<ServerFlavor>,
}

struct Probe {
    status: u16,
    body: Option<serde_json::Value>,
}

impl Probe {
    fn field(&self, name: &str) -> Option<&str> {
        self.body.as_ref()?.get(name)?.as_str()
    }
}

async fn probe(http: &ForgeHttp, base: &str, path: &str) -> Result<Probe, ForgeError> {
    let url =
        url::Url::parse(&format!("{base}/{path}")).map_err(|_| ForgeError::InvalidBaseUrl {
            input: base.to_string(),
        })?;
    let response = http
        .send(Call::get(url, None).timeout(PROBE_TIMEOUT))
        .await?;
    let status = response.status().as_u16();
    let body = http::read_limited(response, PROBE_BODY_MAX_BYTES)
        .await
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok());
    Ok(Probe { status, body })
}

fn forgejo_match(probe: &Result<Probe, ForgeError>) -> bool {
    matches!(probe, Ok(found) if found.status == 200 && found.field("version").is_some())
}

/// Gitea's version endpoint. Forgejo reports `<version>+gitea-<version>`.
fn gitea_match(probe: &Result<Probe, ForgeError>) -> Option<ServerFlavor> {
    let Ok(found) = probe else { return None };
    if found.status != 200 {
        return None;
    }
    let version = found.field("version")?;
    Some(if version.contains("+gitea-") {
        ServerFlavor::Forgejo
    } else {
        ServerFlavor::Gitea
    })
}

/// GitLab answers its version to signed-in users only; a 401 with a JSON
/// message is GitLab too.
fn gitlab_match(probe: &Result<Probe, ForgeError>) -> bool {
    match probe {
        Ok(found) if found.status == 200 => found.field("version").is_some(),
        Ok(found) if found.status == 401 => found.field("message").is_some(),
        _ => false,
    }
}

fn github_match(probe: &Result<Probe, ForgeError>) -> bool {
    matches!(probe, Ok(found) if found.status == 200 && found.field("installed_version").is_some())
}

/// Detect the server at a normalized base URL. Every probe failing with a
/// certificate or connection error returns that error.
pub async fn detect_server(http: &ForgeHttp, base: &str) -> Result<ServerInfo, ForgeError> {
    if let Some((kind, flavor)) = preset(base) {
        return Ok(ServerInfo {
            base: base.to_string(),
            kind: Some(kind),
            flavor,
        });
    }
    let (forgejo, gitea, gitlab, github) = tokio::join!(
        probe(http, base, "api/forgejo/v1/version"),
        probe(http, base, "api/v1/version"),
        probe(http, base, "api/v4/version"),
        probe(http, base, "api/v3/meta"),
    );
    let (kind, flavor) = if forgejo_match(&forgejo) {
        (Some(ForgeKind::Gitea), Some(ServerFlavor::Forgejo))
    } else if let Some(flavor) = gitea_match(&gitea) {
        (Some(ForgeKind::Gitea), Some(flavor))
    } else if gitlab_match(&gitlab) {
        (Some(ForgeKind::GitLab), None)
    } else if github_match(&github) {
        (Some(ForgeKind::GitHub), None)
    } else {
        let failures: Vec<&ForgeError> = [&forgejo, &gitea, &gitlab, &github]
            .into_iter()
            .filter_map(|probe| probe.as_ref().err())
            .collect();
        let unreachable = failures.len() == 4
            && failures.iter().all(|error| {
                matches!(
                    error,
                    ForgeError::Tls { .. } | ForgeError::Unreachable { .. }
                )
            });
        if unreachable {
            let tls = failures
                .iter()
                .find(|error| matches!(error, ForgeError::Tls { .. }));
            return Err((*tls.unwrap_or(&failures[0])).clone());
        }
        (None, None)
    };
    Ok(ServerInfo {
        base: base.to_string(),
        kind,
        flavor,
    })
}

/// Whether a Gitea-compatible server is Forgejo.
pub async fn gitea_flavor(http: &ForgeHttp, base: &str) -> ServerFlavor {
    if let Some((_, Some(flavor))) = preset(base) {
        return flavor;
    }
    let (forgejo, gitea) = tokio::join!(
        probe(http, base, "api/forgejo/v1/version"),
        probe(http, base, "api/v1/version"),
    );
    if forgejo_match(&forgejo) {
        return ServerFlavor::Forgejo;
    }
    gitea_match(&gitea).unwrap_or(ServerFlavor::Gitea)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kind::GITHUB_COM;
    use crate::test_support::{MockResponse, MockServer};

    fn routes(found: Vec<MockResponse>) -> Vec<MockResponse> {
        let mut all = found;
        for path in [
            "/api/forgejo/v1/version",
            "/api/v1/version",
            "/api/v4/version",
            "/api/v3/meta",
        ] {
            all.push(MockResponse::json(404, r#"{"message":"not found"}"#).on("GET", path));
        }
        all
    }

    async fn detect(found: Vec<MockResponse>) -> ServerInfo {
        let server = MockServer::start(routes(found));
        let http = ForgeHttp::new(None).unwrap();
        let info = detect_server(&http, &server.url()).await.unwrap();
        for request in server.requests() {
            assert_eq!(
                request.header("authorization"),
                None,
                "probes carry no credential"
            );
        }
        info
    }

    #[tokio::test]
    async fn detection_recognizes_forgejo_gitea_gitlab_and_enterprise_github() {
        let forgejo =
            detect(vec![MockResponse::json(200, r#"{"version":"9.0.0"}"#)
                .on("GET", "/api/forgejo/v1/version")])
            .await;
        assert_eq!(
            (forgejo.kind, forgejo.flavor),
            (Some(ForgeKind::Gitea), Some(ServerFlavor::Forgejo))
        );

        let gitea = detect(vec![
            MockResponse::json(200, r#"{"version":"1.22.3"}"#).on("GET", "/api/v1/version")
        ])
        .await;
        assert_eq!(
            (gitea.kind, gitea.flavor),
            (Some(ForgeKind::Gitea), Some(ServerFlavor::Gitea))
        );

        let older_forgejo = detect(vec![MockResponse::json(
            200,
            r#"{"version":"7.0.0+gitea-1.21.0"}"#,
        )
        .on("GET", "/api/v1/version")])
        .await;
        assert_eq!(older_forgejo.flavor, Some(ServerFlavor::Forgejo));

        let gitlab = detect(vec![MockResponse::json(
            401,
            r#"{"message":"401 Unauthorized"}"#,
        )
        .on("GET", "/api/v4/version")])
        .await;
        assert_eq!(
            (gitlab.kind, gitlab.flavor),
            (Some(ForgeKind::GitLab), None)
        );

        let github = detect(vec![MockResponse::json(
            200,
            r#"{"installed_version":"3.14.2"}"#,
        )
        .on("GET", "/api/v3/meta")])
        .await;
        assert_eq!(github.kind, Some(ForgeKind::GitHub));
    }

    #[tokio::test]
    async fn detection_returns_no_kind_for_other_servers() {
        let other = detect(Vec::new()).await;
        assert_eq!((other.kind, other.flavor), (None, None));
    }

    #[tokio::test]
    async fn presets_are_known_without_a_network_call() {
        let http = ForgeHttp::new(None).unwrap();
        let info = detect_server(&http, GITHUB_COM).await.unwrap();
        assert_eq!(info.kind, Some(ForgeKind::GitHub));
        assert_eq!(
            gitea_flavor(&http, crate::kind::CODEBERG).await,
            ServerFlavor::Forgejo
        );
    }

    #[tokio::test]
    async fn an_unreachable_server_is_an_error_not_an_unknown_kind() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let http = ForgeHttp::new(None).unwrap();
        let result = detect_server(&http, &format!("http://{address}")).await;
        assert!(
            matches!(result, Err(ForgeError::Unreachable { .. })),
            "{result:?}"
        );
    }
}
