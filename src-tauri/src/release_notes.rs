use serde::{Deserialize, Serialize};

const RELEASES_URL: &str = "https://api.github.com/repos/Oleafly/Oleafly/releases";
const PAGE_SIZE: u32 = 5;
const MAX_PAGE: u32 = 50;
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct ReleaseNotesEntry {
    pub tag_name: String,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub prerelease: bool,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub html_url: Option<String>,
}

#[tauri::command]
pub async fn release_notes_page(page: u32) -> Result<Vec<ReleaseNotesEntry>, String> {
    fetch_release_notes_page(&http_client()?, RELEASES_URL, page).await
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Oleafly")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| format!("could not build HTTP client: {error}"))
}

async fn fetch_release_notes_page(
    client: &reqwest::Client,
    base: &str,
    page: u32,
) -> Result<Vec<ReleaseNotesEntry>, String> {
    if page == 0 || page > MAX_PAGE {
        return Err(format!("release notes page {page} is out of range"));
    }
    let response = client
        .get(format!("{base}?per_page={PAGE_SIZE}&page={page}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|error| format!("network error: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Could not load release notes ({}).",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("release notes response is too large".to_string());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("network error: {error}"))?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err("release notes response is too large".to_string());
    }
    serde_json::from_slice::<Vec<ReleaseNotesEntry>>(&bytes)
        .map_err(|error| format!("invalid release notes response: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::sync::oneshot;

    async fn serve_once(status: &'static str, body: String) -> (String, oneshot::Receiver<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (sender, receiver) = oneshot::channel();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 4096];
            let read = stream.read(&mut request).await.unwrap_or(0);
            let _ = sender.send(String::from_utf8_lossy(&request[..read]).to_string());
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).await.unwrap();
        });
        (format!("http://{address}/releases"), receiver)
    }

    #[tokio::test]
    async fn a_page_keeps_the_fields_the_update_window_reads() {
        let body = serde_json::json!([
            {
                "tag_name": "v0.4.2",
                "draft": false,
                "prerelease": false,
                "body": "## What's new in 0.4.2\n\n### Fixed\n\n- A fix.",
                "published_at": "2026-09-21T07:47:46Z",
                "html_url": "https://github.com/Oleafly/Oleafly/releases/tag/v0.4.2",
                "assets": [{ "name": "Oleafly.dmg" }],
                "author": { "login": "someone" }
            },
            { "tag_name": "cli-v0.1.0", "draft": false, "prerelease": true, "body": null }
        ])
        .to_string();
        let (url, request) = serve_once("200 OK", body).await;
        let entries = fetch_release_notes_page(&http_client().unwrap(), &url, 2)
            .await
            .unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].tag_name, "v0.4.2");
        assert_eq!(
            entries[0].published_at.as_deref(),
            Some("2026-09-21T07:47:46Z")
        );
        assert!(entries[0]
            .body
            .as_deref()
            .unwrap()
            .starts_with("## What's new"));
        assert!(entries[1].prerelease);
        assert_eq!(entries[1].body, None);

        let request = request.await.unwrap();
        let request_line = request.lines().next().unwrap();
        assert!(request_line.contains("per_page=5"), "{request_line}");
        assert!(request_line.contains("page=2"), "{request_line}");
        let lowered = request.to_ascii_lowercase();
        assert!(lowered.contains("accept: application/vnd.github+json"));
        assert!(lowered.contains("user-agent: oleafly"));
    }

    #[tokio::test]
    async fn provider_failures_and_bad_payloads_are_errors_not_panics() {
        let client = http_client().unwrap();

        let (url, _) = serve_once(
            "403 Forbidden",
            r#"{"message":"API rate limit exceeded"}"#.to_string(),
        )
        .await;
        assert!(fetch_release_notes_page(&client, &url, 1)
            .await
            .unwrap_err()
            .contains("403"));

        let (url, _) = serve_once("200 OK", "not json".to_string()).await;
        assert!(fetch_release_notes_page(&client, &url, 1)
            .await
            .unwrap_err()
            .contains("invalid release notes response"));

        let (url, _) = serve_once("200 OK", r#"{"message":"not a list"}"#.to_string()).await;
        assert!(fetch_release_notes_page(&client, &url, 1)
            .await
            .unwrap_err()
            .contains("invalid release notes response"));

        let (url, _) = serve_once("200 OK", "x".repeat(MAX_RESPONSE_BYTES + 1)).await;
        assert!(fetch_release_notes_page(&client, &url, 1)
            .await
            .unwrap_err()
            .contains("too large"));
    }

    #[tokio::test]
    async fn out_of_range_pages_and_unreachable_hosts_fail_cleanly() {
        let client = http_client().unwrap();
        assert!(
            fetch_release_notes_page(&client, "http://127.0.0.1:9/releases", 0)
                .await
                .unwrap_err()
                .contains("out of range")
        );
        assert!(
            fetch_release_notes_page(&client, "http://127.0.0.1:9/releases", MAX_PAGE + 1)
                .await
                .unwrap_err()
                .contains("out of range")
        );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/releases", listener.local_addr().unwrap());
        drop(listener);
        assert!(fetch_release_notes_page(&client, &url, 1)
            .await
            .unwrap_err()
            .contains("network error"));
    }
}
