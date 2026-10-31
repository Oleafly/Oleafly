use crate::ForgeError;
use futures_util::StreamExt;
use reqwest::header::HeaderMap;
use reqwest::{Method, StatusCode};
use serde::de::DeserializeOwned;
use std::path::Path;
use std::time::Duration;

const MAX_REDIRECTS: usize = 5;
pub const CA_FILE_MAX_BYTES: u64 = 1024 * 1024;
const JSON_REPLY_MAX_BYTES: usize = 8 * 1024 * 1024;
const ERROR_BODY_MAX_BYTES: usize = 64 * 1024;
const DETAIL_MAX_CHARS: usize = 200;
pub(crate) const CALL_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone)]
pub struct ForgeHttp {
    client: reqwest::Client,
}

impl std::fmt::Debug for ForgeHttp {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ForgeHttp")
    }
}

/// How a token is presented. GitHub and GitLab take `Bearer`, Gitea takes
/// `token`.
#[derive(Clone, Copy)]
pub(crate) enum Credential<'a> {
    Bearer(&'a str),
    Token(&'a str),
}

impl std::fmt::Debug for Credential<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Credential([redacted])")
    }
}

#[derive(Clone, Debug)]
pub(crate) enum CallBody {
    Empty,
    Json(serde_json::Value),
    Form(Vec<(&'static str, String)>),
}

#[derive(Debug)]
pub(crate) struct Call<'a> {
    pub method: Method,
    pub url: url::Url,
    pub credential: Option<Credential<'a>>,
    pub accept: &'static str,
    pub headers: &'static [(&'static str, &'static str)],
    pub body: CallBody,
    pub timeout: Duration,
}

impl<'a> Call<'a> {
    pub(crate) fn new(method: Method, url: url::Url, credential: Option<Credential<'a>>) -> Self {
        Call {
            method,
            url,
            credential,
            accept: "application/json",
            headers: &[],
            body: CallBody::Empty,
            timeout: CALL_TIMEOUT,
        }
    }

    pub(crate) fn get(url: url::Url, credential: Option<Credential<'a>>) -> Self {
        Call::new(Method::GET, url, credential)
    }

    pub(crate) fn post(url: url::Url, credential: Option<Credential<'a>>, body: CallBody) -> Self {
        Call {
            body,
            ..Call::new(Method::POST, url, credential)
        }
    }

    pub(crate) fn accept(mut self, accept: &'static str) -> Self {
        self.accept = accept;
        self
    }

    pub(crate) fn headers(mut self, headers: &'static [(&'static str, &'static str)]) -> Self {
        self.headers = headers;
        self
    }

    pub(crate) fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }
}

impl ForgeHttp {
    pub fn new(ca_file: Option<&Path>) -> Result<ForgeHttp, ForgeError> {
        let mut builder = reqwest::Client::builder()
            .user_agent("Oleafly")
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(60))
            .tls_built_in_root_certs(true)
            // Spelled out so a build without native roots fails to compile:
            // corporate certificate authorities live in the platform store.
            .tls_built_in_native_certs(true);
        if let Some(path) = ca_file {
            for certificate in ForgeHttp::load_ca_certificates(path)? {
                builder = builder.add_root_certificate(certificate);
            }
        }
        let client = builder.build().map_err(|error| ForgeError::Tls {
            detail: limit_chars(&transport_text(&error), DETAIL_MAX_CHARS),
        })?;
        Ok(ForgeHttp { client })
    }

    pub fn load_ca_certificates(path: &Path) -> Result<Vec<reqwest::Certificate>, ForgeError> {
        let ca_error = |detail: &str| ForgeError::CaFile {
            detail: detail.to_string(),
        };
        let metadata = std::fs::metadata(path).map_err(|error| ForgeError::CaFile {
            detail: format!("the file could not be opened ({})", error.kind()),
        })?;
        if !metadata.is_file() {
            return Err(ca_error("this is not a file"));
        }
        if metadata.len() > CA_FILE_MAX_BYTES {
            return Err(ca_error("the file is larger than 1 MB"));
        }
        let bytes = std::fs::read(path).map_err(|error| ForgeError::CaFile {
            detail: format!("the file could not be read ({})", error.kind()),
        })?;
        let certificates = match reqwest::Certificate::from_pem_bundle(&bytes) {
            Ok(certificates) if !certificates.is_empty() => certificates,
            _ => vec![reqwest::Certificate::from_der(&bytes)
                .map_err(|_| ca_error("the file holds no certificate"))?],
        };
        // reqwest parses certificates when a client is built, so build one
        // that trusts only these to prove they load.
        let mut probe = reqwest::Client::builder().tls_built_in_root_certs(false);
        for certificate in &certificates {
            probe = probe.add_root_certificate(certificate.clone());
        }
        probe
            .build()
            .map_err(|_| ca_error("the file holds no certificate"))?;
        Ok(certificates)
    }

    fn request(
        &self,
        call: &Call<'_>,
        url: &url::Url,
        credential: Option<Credential<'_>>,
    ) -> reqwest::RequestBuilder {
        let mut request = self
            .client
            .request(call.method.clone(), url.clone())
            .timeout(call.timeout)
            .header(reqwest::header::ACCEPT, call.accept);
        for (name, value) in call.headers {
            request = request.header(*name, *value);
        }
        request = match credential {
            Some(Credential::Bearer(token)) => {
                request.header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
            }
            Some(Credential::Token(token)) => {
                request.header(reqwest::header::AUTHORIZATION, format!("token {token}"))
            }
            None => request,
        };
        match &call.body {
            CallBody::Empty => request,
            CallBody::Json(value) => request.json(value),
            CallBody::Form(fields) => request.form(fields),
        }
    }

    pub(crate) async fn send(&self, call: Call<'_>) -> Result<reqwest::Response, ForgeError> {
        let origin = call.url.origin();
        let mut url = call.url.clone();
        let mut credential = call.credential;
        for _ in 0..=MAX_REDIRECTS {
            let response = self
                .request(&call, &url, credential)
                .send()
                .await
                .map_err(map_transport_error)?;
            if !response.status().is_redirection() {
                return Ok(response);
            }
            if call.method != Method::GET {
                return Err(ForgeError::InvalidResponse {
                    detail: "the server redirected a request that changes data".into(),
                });
            }
            let next = location(&response, &url)?;
            if !redirect_allowed(&url, &next) {
                return Err(ForgeError::RedirectRefused {
                    target: crate::address::host_of(next.as_str()).unwrap_or_default(),
                });
            }
            if next.origin() != origin {
                credential = None;
            }
            url = next;
        }
        Err(ForgeError::InvalidResponse {
            detail: "too many redirects".into(),
        })
    }
}

fn location(response: &reqwest::Response, current: &url::Url) -> Result<url::Url, ForgeError> {
    let missing = || ForgeError::InvalidResponse {
        detail: "a redirect without a valid location".into(),
    };
    let value = response
        .headers()
        .get(reqwest::header::LOCATION)
        .ok_or_else(missing)?
        .to_str()
        .map_err(|_| missing())?;
    current.join(value).map_err(|_| missing())
}

pub(crate) fn redirect_allowed(from: &url::Url, to: &url::Url) -> bool {
    matches!(
        (from.scheme(), to.scheme()),
        (_, "https") | ("http", "http")
    )
}

pub(crate) async fn read_json<T: DeserializeOwned>(
    response: reqwest::Response,
    secrets: &[&str],
    scopes_hint: &'static str,
) -> Result<T, ForgeError> {
    let response = ensure_success(response, secrets, scopes_hint).await?;
    let bytes = read_limited(response, JSON_REPLY_MAX_BYTES).await?;
    serde_json::from_slice(&bytes).map_err(|error| ForgeError::InvalidResponse {
        detail: scrub(&error.to_string(), secrets),
    })
}

pub(crate) async fn ensure_success(
    response: reqwest::Response,
    secrets: &[&str],
    scopes_hint: &'static str,
) -> Result<reqwest::Response, ForgeError> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let headers = response.headers().clone();
    let body = read_limited(response, ERROR_BODY_MAX_BYTES)
        .await
        .unwrap_or_default();
    Err(error_for_status(
        status,
        &headers,
        &String::from_utf8_lossy(&body),
        secrets,
        scopes_hint,
    ))
}

pub(crate) async fn read_limited(
    response: reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, ForgeError> {
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(map_transport_error)?;
        if body.len().saturating_add(chunk.len()) > limit {
            return Err(ForgeError::InvalidResponse {
                detail: "the reply was larger than expected".into(),
            });
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

pub(crate) fn error_for_status(
    status: StatusCode,
    headers: &HeaderMap,
    body: &str,
    secrets: &[&str],
    scopes_hint: &'static str,
) -> ForgeError {
    let header = |name: &str| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
    };
    let retry_after_secs = header("retry-after").and_then(|value| value.parse::<u64>().ok());
    let lower = body.to_ascii_lowercase();
    match status.as_u16() {
        401 => ForgeError::Unauthorized,
        // GitHub also answers its secondary rate limit with 403: a
        // `Retry-After` header, or the limit named in the body.
        403 if header("x-ratelimit-remaining") == Some("0")
            || retry_after_secs.is_some()
            || lower.contains("rate limit") =>
        {
            ForgeError::RateLimited { retry_after_secs }
        }
        // An organization that enforces SAML single sign-on refuses a token
        // that was not authorized for it, with the same 403.
        403 if header("x-github-sso").is_some() || lower.contains("saml") => {
            ForgeError::SsoRequired
        }
        403 => ForgeError::Forbidden {
            scopes: scopes_hint,
        },
        404 => ForgeError::NotFound,
        409 => ForgeError::Conflict,
        429 => ForgeError::RateLimited { retry_after_secs },
        code => ForgeError::Server {
            status: code,
            detail: scrub(&body_message(body), secrets),
        },
    }
}

pub(crate) fn body_message(body: &str) -> String {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return body.trim().to_string();
    };
    for field in ["message", "error_description", "error"] {
        match value.get(field) {
            Some(serde_json::Value::String(text)) => return text.trim().to_string(),
            Some(other @ serde_json::Value::Object(_)) => return other.to_string(),
            _ => {}
        }
    }
    body.trim().to_string()
}

pub fn scrub(text: &str, secrets: &[&str]) -> String {
    let mut clean = text.to_string();
    for secret in secrets.iter().filter(|secret| !secret.is_empty()) {
        clean = clean.replace(secret, "***");
    }
    limit_chars(&clean, DETAIL_MAX_CHARS)
}

fn limit_chars(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

fn transport_text(error: &reqwest::Error) -> String {
    let mut parts = vec![error.to_string()];
    let mut source = std::error::Error::source(error);
    while let Some(cause) = source {
        let text = cause.to_string();
        if !parts.iter().any(|part| part.contains(&text)) {
            parts.push(text);
        }
        source = cause.source();
    }
    parts.join(": ")
}

pub(crate) fn map_transport_error(error: reqwest::Error) -> ForgeError {
    let error = error.without_url();
    let text = transport_text(&error);
    let detail = limit_chars(&text, DETAIL_MAX_CHARS);
    let certificate = [
        "certificate",
        "UnknownIssuer",
        "InvalidCertificate",
        "invalid peer certificate",
    ]
    .iter()
    .any(|needle| text.contains(needle));
    if certificate {
        ForgeError::Tls { detail }
    } else {
        ForgeError::Unreachable { detail }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{MockResponse, MockServer};

    fn u(text: &str) -> url::Url {
        url::Url::parse(text).unwrap()
    }

    fn authorization(request: &crate::test_support::RecordedRequest) -> Option<String> {
        request.header("authorization")
    }

    #[tokio::test]
    async fn same_origin_redirects_keep_the_credential() {
        let server = MockServer::start(vec![
            MockResponse::redirect(302, "/next"),
            MockResponse::json(200, "{}"),
        ]);
        let http = ForgeHttp::new(None).unwrap();
        let response = http
            .send(Call::get(
                u(&format!("{}/start", server.url())),
                Some(Credential::Bearer("secret-token")),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        let requests = server.requests();
        assert_eq!(requests.len(), 2);
        for request in &requests {
            assert_eq!(
                authorization(request).as_deref(),
                Some("Bearer secret-token")
            );
        }
        assert_eq!(requests[1].path, "/next");
    }

    #[tokio::test]
    async fn cross_origin_redirects_drop_the_credential() {
        let other = MockServer::start(vec![MockResponse::json(200, "{}")]);
        let server = MockServer::start(vec![MockResponse::redirect(
            302,
            &format!("{}/elsewhere", other.url()),
        )]);
        let http = ForgeHttp::new(None).unwrap();
        http.send(Call::get(
            u(&format!("{}/start", server.url())),
            Some(Credential::Token("secret-token")),
        ))
        .await
        .unwrap();
        assert_eq!(
            authorization(&server.requests()[0]).as_deref(),
            Some("token secret-token")
        );
        assert_eq!(authorization(&other.requests()[0]), None);
    }

    #[tokio::test]
    async fn a_redirect_back_to_the_origin_does_not_regain_the_credential() {
        let a = MockServer::start(vec![
            MockResponse::redirect(302, "/placeholder"),
            MockResponse::json(200, "{}"),
        ]);
        let b = MockServer::start(vec![MockResponse::redirect(
            302,
            &format!("{}/back", a.url()),
        )]);
        a.set_location(0, &format!("{}/away", b.url()));
        let http = ForgeHttp::new(None).unwrap();
        http.send(Call::get(
            u(&format!("{}/start", a.url())),
            Some(Credential::Bearer("secret-token")),
        ))
        .await
        .unwrap();
        let seen = a.requests();
        assert_eq!(seen.len(), 2);
        assert_eq!(
            authorization(&seen[0]).as_deref(),
            Some("Bearer secret-token")
        );
        assert_eq!(seen[1].path, "/back");
        assert_eq!(
            authorization(&seen[1]),
            None,
            "the credential came back after the call left its origin"
        );
        assert_eq!(authorization(&b.requests()[0]), None);
    }

    #[test]
    fn https_never_redirects_to_plain_http() {
        assert!(!redirect_allowed(
            &u("https://a.org/x"),
            &u("http://a.org/y")
        ));
        assert!(redirect_allowed(
            &u("http://192.168.1.2/x"),
            &u("http://192.168.1.2/y")
        ));
        assert!(redirect_allowed(
            &u("http://192.168.1.2/x"),
            &u("https://192.168.1.2/y")
        ));
        assert!(!redirect_allowed(&u("https://a.org"), &u("ftp://a.org")));
    }

    #[tokio::test]
    async fn redirects_after_a_post_are_errors() {
        let server = MockServer::start(vec![MockResponse::redirect(302, "/next")]);
        let http = ForgeHttp::new(None).unwrap();
        let result = http
            .send(Call::post(
                u(&format!("{}/create", server.url())),
                Some(Credential::Bearer("secret-token")),
                CallBody::Json(serde_json::json!({ "name": "paper" })),
            ))
            .await;
        assert!(
            matches!(result, Err(ForgeError::InvalidResponse { .. })),
            "{result:?}"
        );
        assert_eq!(server.requests().len(), 1);
    }

    #[tokio::test]
    async fn error_bodies_never_echo_the_token() {
        let server = MockServer::start(vec![MockResponse::raw(
            500,
            &[("content-type", "text/plain")],
            b"bad credentials for glpat-secret123",
        )]);
        let http = ForgeHttp::new(None).unwrap();
        let response = http
            .send(Call::get(
                u(&format!("{}/user", server.url())),
                Some(Credential::Bearer("glpat-secret123")),
            ))
            .await
            .unwrap();
        let error = read_json::<serde_json::Value>(response, &["glpat-secret123"], "api")
            .await
            .unwrap_err();
        assert!(
            matches!(error, ForgeError::Server { status: 500, .. }),
            "{error:?}"
        );
        assert!(!error.to_string().contains("glpat-secret123"));
        assert!(!format!("{error:?}").contains("glpat-secret123"));
    }

    #[tokio::test]
    async fn statuses_map_to_error_kinds() {
        let cases: Vec<(MockResponse, ForgeError)> = vec![
            (MockResponse::json(401, "{}"), ForgeError::Unauthorized),
            (
                MockResponse::json(403, "{}"),
                ForgeError::Forbidden {
                    scopes: "repo, read:user",
                },
            ),
            (
                MockResponse::raw(403, &[("x-ratelimit-remaining", "0")], b"{}"),
                ForgeError::RateLimited {
                    retry_after_secs: None,
                },
            ),
            (
                MockResponse::raw(
                    403,
                    &[("retry-after", "60")],
                    br#"{"message":"You have exceeded a secondary rate limit."}"#,
                ),
                ForgeError::RateLimited {
                    retry_after_secs: Some(60),
                },
            ),
            (
                MockResponse::json(
                    403,
                    r#"{"message":"You have exceeded a secondary rate limit. Please wait a few minutes."}"#,
                ),
                ForgeError::RateLimited {
                    retry_after_secs: None,
                },
            ),
            (
                MockResponse::json(
                    403,
                    r#"{"message":"Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization."}"#,
                ),
                ForgeError::SsoRequired,
            ),
            (
                MockResponse::raw(
                    403,
                    &[(
                        "x-github-sso",
                        "required; url=https://github.com/orgs/o/sso",
                    )],
                    b"{}",
                ),
                ForgeError::SsoRequired,
            ),
            (
                MockResponse::raw(429, &[("retry-after", "30")], b"{}"),
                ForgeError::RateLimited {
                    retry_after_secs: Some(30),
                },
            ),
            (MockResponse::json(404, "{}"), ForgeError::NotFound),
            (
                MockResponse::json(502, r#"{"message":"bad gateway"}"#),
                ForgeError::Server {
                    status: 502,
                    detail: "bad gateway".into(),
                },
            ),
        ];
        let http = ForgeHttp::new(None).unwrap();
        for (reply, expected) in cases {
            let server = MockServer::start(vec![reply]);
            let response = http
                .send(Call::get(u(&format!("{}/user", server.url())), None))
                .await
                .unwrap();
            let error = read_json::<serde_json::Value>(response, &[], "repo, read:user")
                .await
                .unwrap_err();
            assert_eq!(error, expected);
        }
    }

    #[tokio::test]
    async fn an_unreachable_server_is_reported_without_its_address() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let http = ForgeHttp::new(None).unwrap();
        let error = http
            .send(Call::get(
                u(&format!("http://{address}/user?search=thesis")),
                None,
            ))
            .await
            .unwrap_err();
        let ForgeError::Unreachable { detail } = error else {
            panic!("expected an unreachable server, got {error:?}");
        };
        assert!(!detail.contains("thesis"), "{detail}");
    }

    fn native_certificate() -> Option<Vec<u8>> {
        let loaded = rustls_native_certs::load_native_certs();
        let first = loaded.certs.into_iter().next();
        if first.is_none() {
            eprintln!("skipped: this machine's certificate store is empty");
        }
        first.map(|certificate| certificate.as_ref().to_vec())
    }

    #[test]
    fn ca_files_load_from_pem_der_and_paths_with_spaces() {
        use base64::Engine as _;
        let Some(der) = native_certificate() else {
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("Zoë certs");
        std::fs::create_dir_all(&folder).unwrap();

        let der_path = folder.join("corp ca.der");
        std::fs::write(&der_path, &der).unwrap();
        assert_eq!(ForgeHttp::load_ca_certificates(&der_path).unwrap().len(), 1);

        let encoded = base64::engine::general_purpose::STANDARD.encode(&der);
        let mut pem = String::from("-----BEGIN CERTIFICATE-----\n");
        for line in encoded.as_bytes().chunks(64) {
            pem.push_str(std::str::from_utf8(line).unwrap());
            pem.push('\n');
        }
        pem.push_str("-----END CERTIFICATE-----\n");
        let pem_path = folder.join("corp ca.pem");
        std::fs::write(&pem_path, pem).unwrap();
        assert_eq!(ForgeHttp::load_ca_certificates(&pem_path).unwrap().len(), 1);
        assert!(ForgeHttp::new(Some(&pem_path)).is_ok());
    }

    #[test]
    fn unreadable_ca_files_are_reported_without_their_contents() {
        let dir = tempfile::tempdir().unwrap();
        let garbage = dir.path().join("garbage.pem");
        std::fs::write(&garbage, "this-is-not-a-certificate-at-all").unwrap();
        let Err(ForgeError::CaFile { detail }) = ForgeHttp::load_ca_certificates(&garbage) else {
            panic!("garbage must not load");
        };
        assert!(!detail.contains("this-is-not-a-certificate"), "{detail}");

        assert!(matches!(
            ForgeHttp::load_ca_certificates(&dir.path().join("missing.pem")),
            Err(ForgeError::CaFile { .. })
        ));

        let large = dir.path().join("large.pem");
        std::fs::write(&large, vec![b'a'; 2 * 1024 * 1024]).unwrap();
        assert!(matches!(
            ForgeHttp::load_ca_certificates(&large),
            Err(ForgeError::CaFile { .. })
        ));
        assert!(matches!(
            ForgeHttp::load_ca_certificates(dir.path()),
            Err(ForgeError::CaFile { .. })
        ));
    }

    #[test]
    fn scrubbing_removes_secrets_and_bounds_the_length() {
        assert_eq!(
            scrub("token abc123 and abc123", &["abc123", ""]),
            "token *** and ***"
        );
        let long = "é".repeat(500);
        assert_eq!(scrub(&long, &[]).chars().count(), 200);
    }

    #[test]
    fn json_error_messages_are_extracted() {
        assert_eq!(body_message(r#"{"message":" Not Found "}"#), "Not Found");
        assert_eq!(
            body_message(r#"{"error":"invalid_grant"}"#),
            "invalid_grant"
        );
        assert_eq!(body_message("plain text\n"), "plain text");
    }
}
