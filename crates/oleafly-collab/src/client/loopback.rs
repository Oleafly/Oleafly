use std::collections::HashMap;
use std::time::Duration;

use ::url::Url;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::CollabError;

const MAX_REQUEST_BYTES: usize = 8192;
const READ_TIMEOUT: Duration = Duration::from_secs(5);
const DONE_PAGE: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Oleafly</title></head><body style=\"margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif\"><p style=\"font-size:3rem\">&#10003;</p></body></html>";
const FAILED_PAGE: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Oleafly</title></head><body style=\"margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif\"><p style=\"font-size:3rem\">&#10005;</p></body></html>";

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CallbackOutcome {
    Code(String),
    Error {
        code: String,
        description: Option<String>,
    },
}

pub(crate) struct LoopbackListener {
    listener: TcpListener,
    port: u16,
}

impl LoopbackListener {
    pub(crate) async fn bind() -> Result<LoopbackListener, CollabError> {
        LoopbackListener::bind_to(("127.0.0.1", 0)).await
    }

    pub(crate) async fn bind_to(address: (&str, u16)) -> Result<LoopbackListener, CollabError> {
        let listener = TcpListener::bind(address)
            .await
            .map_err(|_| CollabError::SignInTimedOut)?;
        let port = listener
            .local_addr()
            .map_err(|error| CollabError::Io(error.to_string()))?
            .port();
        Ok(LoopbackListener { listener, port })
    }

    pub(crate) fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}/callback", self.port)
    }

    pub(crate) async fn wait(
        self,
        expected_state: &str,
        timeout: Duration,
    ) -> Result<CallbackOutcome, CollabError> {
        match tokio::time::timeout(timeout, self.serve(expected_state)).await {
            Ok(outcome) => outcome,
            Err(_) => Err(CollabError::SignInTimedOut),
        }
    }

    async fn serve(&self, expected_state: &str) -> Result<CallbackOutcome, CollabError> {
        loop {
            let (mut stream, _) = self
                .listener
                .accept()
                .await
                .map_err(|error| CollabError::Io(error.to_string()))?;
            let Some(target) = read_target(&mut stream).await else {
                continue;
            };
            if target.path() != "/callback" {
                respond(&mut stream, "404 Not Found", FAILED_PAGE).await;
                continue;
            }
            let query: HashMap<String, String> = target.query_pairs().into_owned().collect();
            if query.get("state").map(String::as_str) != Some(expected_state) {
                respond(&mut stream, "400 Bad Request", FAILED_PAGE).await;
                return Err(CollabError::Unauthorized);
            }
            if let Some(code) = query.get("error") {
                respond(&mut stream, "200 OK", FAILED_PAGE).await;
                return Ok(CallbackOutcome::Error {
                    code: code.clone(),
                    description: query.get("error_description").cloned(),
                });
            }
            return match query.get("code").filter(|code| !code.is_empty()) {
                Some(code) => {
                    respond(&mut stream, "200 OK", DONE_PAGE).await;
                    Ok(CallbackOutcome::Code(code.clone()))
                }
                None => {
                    respond(&mut stream, "400 Bad Request", FAILED_PAGE).await;
                    Err(CollabError::Unauthorized)
                }
            };
        }
    }
}

async fn read_target(stream: &mut TcpStream) -> Option<Url> {
    let mut head = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    let reading = async {
        loop {
            let count = stream.read(&mut chunk).await.ok()?;
            if count == 0 {
                return None;
            }
            head.extend_from_slice(&chunk[..count]);
            if head.windows(4).any(|window| window == b"\r\n\r\n") {
                return Some(());
            }
            if head.len() > MAX_REQUEST_BYTES {
                return None;
            }
        }
    };
    tokio::time::timeout(READ_TIMEOUT, reading).await.ok()??;
    let text = String::from_utf8_lossy(&head);
    let mut parts = text.lines().next()?.split_whitespace();
    let method = parts.next()?;
    let target = parts.next()?;
    if method != "GET" || !target.starts_with('/') {
        return None;
    }
    Url::parse(&format!("http://127.0.0.1{target}")).ok()
}

async fn respond(stream: &mut TcpStream, status: &str, page: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{page}",
        page.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn port_of(listener: &LoopbackListener) -> u16 {
        Url::parse(&listener.redirect_uri())
            .expect("redirect")
            .port()
            .expect("port")
    }

    async fn get(url: String) -> reqwest::Response {
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("client")
            .get(url)
            .send()
            .await
            .expect("response")
    }

    async fn port_is_closed(port: u16) -> bool {
        TcpStream::connect(("127.0.0.1", port)).await.is_err()
    }

    #[tokio::test]
    async fn redirect_uri_is_a_loopback_callback() {
        let listener = LoopbackListener::bind().await.expect("bind");
        let redirect = listener.redirect_uri();
        assert!(redirect.starts_with("http://127.0.0.1:"));
        assert!(redirect.ends_with("/callback"));
    }

    #[tokio::test]
    async fn matching_state_returns_the_code_and_frees_the_port() {
        let listener = LoopbackListener::bind().await.expect("bind");
        let port = port_of(&listener);
        let url = format!("{}?code=abc&state=s1", listener.redirect_uri());
        let (outcome, response) =
            tokio::join!(listener.wait("s1", Duration::from_secs(5)), get(url));
        assert_eq!(
            outcome.expect("outcome"),
            CallbackOutcome::Code("abc".to_string())
        );
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        assert!(response
            .text()
            .await
            .expect("body")
            .contains("<title>Oleafly</title>"));
        assert!(port_is_closed(port).await);
    }

    #[tokio::test]
    async fn mismatched_state_is_refused_and_frees_the_port() {
        let listener = LoopbackListener::bind().await.expect("bind");
        let port = port_of(&listener);
        let url = format!("{}?code=abc&state=forged", listener.redirect_uri());
        let (outcome, response) =
            tokio::join!(listener.wait("s1", Duration::from_secs(5)), get(url));
        assert!(matches!(outcome, Err(CollabError::Unauthorized)));
        assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
        assert!(port_is_closed(port).await);
    }

    #[tokio::test]
    async fn server_error_is_reported_with_its_code() {
        let listener = LoopbackListener::bind().await.expect("bind");
        let url = format!(
            "{}?error=not_admitted&error_description=nope&state=s1",
            listener.redirect_uri()
        );
        let (outcome, _) = tokio::join!(listener.wait("s1", Duration::from_secs(5)), get(url));
        assert_eq!(
            outcome.expect("outcome"),
            CallbackOutcome::Error {
                code: "not_admitted".to_string(),
                description: Some("nope".to_string()),
            }
        );
    }

    #[tokio::test]
    async fn a_port_that_cannot_be_opened_reads_as_a_browser_that_never_came_back() {
        let outcome = LoopbackListener::bind_to(("192.0.2.1", 0)).await;
        assert!(matches!(outcome, Err(CollabError::SignInTimedOut)));
    }

    #[tokio::test]
    async fn silence_times_out_and_frees_the_port() {
        let listener = LoopbackListener::bind().await.expect("bind");
        let port = port_of(&listener);
        let outcome = listener.wait("s1", Duration::from_millis(100)).await;
        assert!(matches!(outcome, Err(CollabError::SignInTimedOut)));
        assert!(port_is_closed(port).await);
    }

    #[tokio::test]
    async fn other_paths_get_not_found_and_the_wait_continues() {
        let listener = LoopbackListener::bind().await.expect("bind");
        let base = format!("http://127.0.0.1:{}", port_of(&listener));
        let callback = format!("{}?code=xyz&state=s1", listener.redirect_uri());
        let requests = async {
            let favicon = get(format!("{base}/favicon.ico")).await;
            let done = get(callback).await;
            (favicon.status(), done.status())
        };
        let (outcome, (favicon, done)) =
            tokio::join!(listener.wait("s1", Duration::from_secs(5)), requests);
        assert_eq!(favicon, reqwest::StatusCode::NOT_FOUND);
        assert_eq!(done, reqwest::StatusCode::OK);
        assert_eq!(
            outcome.expect("outcome"),
            CallbackOutcome::Code("xyz".to_string())
        );
    }
}
