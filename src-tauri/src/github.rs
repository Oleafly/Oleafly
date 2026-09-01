//! GitHub OAuth device-flow transport.
//!
//! The device-flow endpoints (`github.com/login/device/code` and
//! `/login/oauth/access_token`) are not CORS-enabled, so they cannot be called
//! from the webview. These commands perform the HTTP on the Rust side (where
//! CORS does not apply) and return JSON to the frontend.
//!
//! Both commands are `async` and single-shot. Tauri runs synchronous commands
//! on the webview thread, so a long/blocking sync command would freeze the UI.
//! The poll loop lives in the frontend (cancellable, non-blocking); each tick
//! calls `gh_check_device_token` once.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

use crate::config;

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
/// `repo` = read/write public + private repos (push, pull, create).
/// `read:user` = show the connected account's login/avatar.
const OAUTH_SCOPE: &str = "repo read:user";

#[derive(Serialize)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

/// Result of one token poll. The frontend loops, calling this each tick.
#[derive(Serialize)]
pub struct TokenPoll {
    /// `"token"` | `"pending"` | `"slow_down"`
    pub status: String,
    pub token: Option<String>,
    pub interval: Option<u64>,
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Oleafly")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("could not build HTTP client: {e}"))
}

/// Step 1: request a user code.
#[tauri::command]
pub async fn gh_request_device_code(client_id: String) -> Result<DeviceCode, String> {
    let client = http_client()?;
    let resp = client
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .form(&[("client_id", client_id.as_str()), ("scope", OAUTH_SCOPE)])
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;

    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("invalid response ({status}): {e}"))?;

    if body.get("error").is_some() {
        let desc = body
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let err = body
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("error");
        let msg = if desc.is_empty() {
            err.to_string()
        } else {
            desc.to_string()
        };
        return Err(format!("GitHub: {}", msg.trim()));
    }

    Ok(DeviceCode {
        device_code: body
            .get("device_code")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        user_code: body
            .get("user_code")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        verification_uri: body
            .get("verification_uri")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        expires_in: body
            .get("expires_in")
            .and_then(|v| v.as_u64())
            .unwrap_or(900),
        interval: body.get("interval").and_then(|v| v.as_u64()).unwrap_or(5),
    })
}

/// Step 2 (one tick): check whether the user has authorized yet. The frontend
/// calls this repeatedly. Returns `token` on success, `pending` while waiting,
/// `slow_down` to increase the interval; errors on `expired_token`/denied.
#[tauri::command]
pub async fn gh_check_device_token(
    client_id: String,
    device_code: String,
) -> Result<TokenPoll, String> {
    let client = http_client()?;
    let resp = client
        .post(TOKEN_URL)
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id.as_str()),
            ("device_code", device_code.as_str()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("invalid response: {e}"))?;

    if let Some(t) = body.get("access_token").and_then(|v| v.as_str()) {
        return Ok(TokenPoll {
            status: "token".into(),
            token: Some(t.to_string()),
            interval: None,
        });
    }

    match body.get("error").and_then(|v| v.as_str()) {
        Some("authorization_pending") => Ok(TokenPoll {
            status: "pending".into(),
            token: None,
            interval: None,
        }),
        Some("slow_down") => Ok(TokenPoll {
            status: "slow_down".into(),
            token: None,
            interval: Some(body.get("interval").and_then(|v| v.as_u64()).unwrap_or(5)),
        }),
        Some("expired_token") => Err("The sign-in code expired. Try again.".into()),
        Some("access_denied") => Err("GitHub authorization was cancelled.".into()),
        Some(other) => Err(format!("GitHub sign-in error: {other}")),
        None => Ok(TokenPoll {
            status: "pending".into(),
            token: None,
            interval: None,
        }),
    }
}

// Authenticated GitHub REST API: these commands call api.github.com from Rust,
// reading the token from the on-disk config. The token is NEVER returned to
// the webview (get_config blanks it), so a webview compromise (XSS) can't
// read or exfiltrate it - it can only ask the core to perform these specific,
// scoped actions.

const API_USER: &str = "https://api.github.com/user";
const API_REPOS: &str = "https://api.github.com/user/repos";
const REPOSITORY_IMPORT_MAX_BYTES: usize = 256 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
pub struct GitHubUser {
    pub login: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub avatar_url: String,
    #[serde(default)]
    pub html_url: String,
}

#[derive(Serialize, Deserialize)]
pub struct GitHubRepo {
    pub full_name: String,
    #[serde(default)]
    pub html_url: String,
    pub clone_url: String,
    #[serde(default)]
    pub private: bool,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct GitHubRepoStats {
    pub stars: u64,
    pub forks: u64,
}

#[derive(Deserialize)]
struct GitHubRepoStatsResponse {
    stargazers_count: u64,
    forks_count: u64,
}

#[derive(Debug, Deserialize)]
struct GitHubRepositoryImportMetadata {
    default_branch: String,
}

/// Read the stored token, or a friendly error if GitHub isn't connected.
fn require_token() -> Result<String, String> {
    let cfg = config::read_config()?;
    if cfg.github_token.is_empty() {
        return Err("No GitHub token set. Connect in Settings → GitHub.".into());
    }
    Ok(cfg.github_token)
}

fn auth(req: reqwest::RequestBuilder, token: &str) -> reqwest::RequestBuilder {
    req.header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
}

/// Fetch the authenticated user for a given token (used to validate on connect).
async fn fetch_user(token: &str) -> Result<GitHubUser, String> {
    let client = http_client()?;
    let resp = auth(client.get(API_USER), token)
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Invalid token (401).".into());
    }
    if !resp.status().is_success() {
        return Err(format!("GitHub error ({}).", resp.status()));
    }
    resp.json::<GitHubUser>()
        .await
        .map_err(|e| format!("invalid response: {e}"))
}

/// Return the currently-connected GitHub user (validates the stored token).
#[tauri::command]
pub async fn gh_current_user() -> Result<GitHubUser, String> {
    let token = require_token()?;
    fetch_user(&token).await
}

/// Validate a token (OAuth or PAT) and persist it plus the resolved login.
/// The token is written on the Rust side and never handed back to the webview.
#[tauri::command]
pub async fn gh_set_token(token: String) -> Result<GitHubUser, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Empty token.".into());
    }
    let user = fetch_user(&token).await?;
    let login = user.login.clone();
    config::update_config(move |cfg| {
        cfg.github_token = token;
        cfg.github_user = login;
        Ok(())
    })?;
    Ok(user)
}

/// Clear the stored GitHub token + cached login (disconnect).
#[tauri::command]
pub fn gh_clear_token() -> Result<(), String> {
    config::update_config(|cfg| {
        cfg.github_token = String::new();
        cfg.github_user = String::new();
        Ok(())
    })
}

/// List the authenticated user's repositories (most recently updated first).
#[tauri::command]
pub async fn gh_list_repos() -> Result<Vec<GitHubRepo>, String> {
    let token = require_token()?;
    let client = http_client()?;
    let url = format!("{API_REPOS}?per_page=100&sort=updated");
    let resp = auth(client.get(url), &token)
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Could not load repositories ({}).", resp.status()));
    }
    resp.json::<Vec<GitHubRepo>>()
        .await
        .map_err(|e| format!("invalid response: {e}"))
}

/// Create a new repository under the authenticated user.
#[tauri::command]
pub async fn gh_create_repo(name: String, private: bool) -> Result<GitHubRepo, String> {
    let token = require_token()?;
    let client = http_client()?;
    let body = serde_json::json!({ "name": name, "private": private, "auto_init": false });
    let resp = auth(client.post(API_REPOS), &token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let detail = resp.text().await.unwrap_or_default();
        let detail: String = detail.chars().take(200).collect();
        return Err(format!("Could not create repo ({status}). {detail}"));
    }
    resp.json::<GitHubRepo>()
        .await
        .map_err(|e| format!("invalid response: {e}"))
}

fn validated_repository_name(full_name: &str) -> Result<(&str, &str), String> {
    let mut parts = full_name.split('/');
    let owner = parts.next().unwrap_or_default();
    let repository = parts.next().unwrap_or_default();
    let valid_part = |value: &str| {
        !value.is_empty()
            && value != "."
            && value != ".."
            && value.len() <= 100
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    };
    if parts.next().is_some() || !valid_part(owner) || !valid_part(repository) {
        return Err("Choose a valid GitHub repository.".into());
    }
    Ok((owner, repository))
}

/// Load public repository metadata without requiring a connected GitHub
/// account. The repository name is validated before it is interpolated into
/// the fixed GitHub API origin.
#[tauri::command]
pub async fn gh_public_repo_stats(full_name: String) -> Result<GitHubRepoStats, String> {
    let (owner, repository) = validated_repository_name(&full_name)?;
    let client = http_client()?;
    let url = format!("https://api.github.com/repos/{owner}/{repository}");
    fetch_public_repo_stats(&client, &url).await
}

async fn fetch_public_repo_stats(
    client: &reqwest::Client,
    url: &str,
) -> Result<GitHubRepoStats, String> {
    let response = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|error| format!("network error: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Could not load repository statistics ({}).",
            response.status()
        ));
    }

    let stats = response
        .json::<GitHubRepoStatsResponse>()
        .await
        .map_err(|error| format!("invalid repository response: {error}"))?;
    Ok(GitHubRepoStats {
        stars: stats.stargazers_count,
        forks: stats.forks_count,
    })
}

async fn download_repository_archive(
    client: &reqwest::Client,
    token: &str,
    full_name: &str,
    metadata_url: &str,
    archive_url: &str,
) -> Result<(GitHubRepositoryImportMetadata, Vec<u8>), String> {
    let metadata_response = auth(client.get(metadata_url), token)
        .send()
        .await
        .map_err(|error| format!("network error: {error}"))?;
    if !metadata_response.status().is_success() {
        return Err(format!(
            "Could not load {full_name} ({}).",
            metadata_response.status()
        ));
    }
    let metadata = metadata_response
        .json::<GitHubRepositoryImportMetadata>()
        .await
        .map_err(|error| format!("invalid repository response: {error}"))?;
    if metadata.default_branch.trim().is_empty() {
        return Err("This repository does not have a default branch.".into());
    }

    let response = auth(client.get(archive_url), token)
        .send()
        .await
        .map_err(|error| format!("network error: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Could not download {full_name} ({}).",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > REPOSITORY_IMPORT_MAX_BYTES as u64)
    {
        return Err("The repository archive is larger than 256 MB.".into());
    }

    let mut archive = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("repository download failed: {error}"))?;
        if archive.len().saturating_add(chunk.len()) > REPOSITORY_IMPORT_MAX_BYTES {
            return Err("The repository archive is larger than 256 MB.".into());
        }
        archive.extend_from_slice(&chunk);
    }
    if archive.len() < 4 || &archive[0..2] != b"PK" {
        return Err("GitHub returned an invalid repository archive.".into());
    }
    Ok((metadata, archive))
}

/// Download an authenticated repository archive and publish it through the
/// same guarded ZIP import path used for local projects.
#[tauri::command]
pub async fn gh_import_repo(full_name: String) -> Result<String, String> {
    let (owner, repository) = validated_repository_name(&full_name)?;
    let owner = owner.to_string();
    let repository = repository.to_string();
    let token = require_token()?;
    let client = reqwest::Client::builder()
        .user_agent("Oleafly")
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|error| format!("could not build HTTP client: {error}"))?;
    let metadata_url = format!("https://api.github.com/repos/{owner}/{repository}");
    let url = format!("https://api.github.com/repos/{owner}/{repository}/zipball");
    let (metadata, archive) =
        download_repository_archive(&client, &token, &full_name, &metadata_url, &url).await?;

    let remote_url = format!("https://github.com/{owner}/{repository}.git");
    tauri::async_runtime::spawn_blocking(move || {
        let project_id = crate::project::import_project_zip_bytes(repository, &archive)?;
        if let Err(error) = crate::git::attach_imported_repository_history(
            &project_id,
            &remote_url,
            &metadata.default_branch,
            &token,
        ) {
            return match crate::project::discard_project_after_failed_import(&project_id) {
                Ok(()) => Err(error),
                Err(cleanup_error) => Err(format!("{error} {cleanup_error}")),
            };
        }
        Ok(project_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{
        download_repository_archive, fetch_public_repo_stats, http_client,
        validated_repository_name, GitHubRepoStats, GitHubRepoStatsResponse,
        REPOSITORY_IMPORT_MAX_BYTES,
    };
    use std::io::{Read, Write};

    fn response(status: &str, body: &[u8]) -> Vec<u8> {
        let mut value = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        value.extend_from_slice(body);
        value
    }

    fn response_with_length(status: &str, length: usize) -> Vec<u8> {
        format!("HTTP/1.1 {status}\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n")
            .into_bytes()
    }

    fn serve(responses: Vec<Vec<u8>>) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for response in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
                let mut request = [0_u8; 4096];
                let _ = stream.read(&mut request);
                stream.write_all(&response).unwrap();
            }
        });
        format!("http://{address}")
    }

    #[test]
    fn repository_names_accept_one_safe_owner_and_repo_pair() {
        assert_eq!(
            validated_repository_name("oleafly/paper-template.v2").unwrap(),
            ("oleafly", "paper-template.v2")
        );
        assert!(validated_repository_name("missing-repository").is_err());
        assert!(validated_repository_name("owner/repo/extra").is_err());
        assert!(validated_repository_name("owner/repo?ref=main").is_err());
        assert!(validated_repository_name("owner/..").is_err());
    }

    #[test]
    fn repository_stats_map_githubs_public_field_names() {
        let response: GitHubRepoStatsResponse = serde_json::from_value(serde_json::json!({
            "stargazers_count": 123,
            "forks_count": 9
        }))
        .unwrap();

        assert_eq!(
            GitHubRepoStats {
                stars: response.stargazers_count,
                forks: response.forks_count,
            },
            GitHubRepoStats {
                stars: 123,
                forks: 9
            }
        );
    }

    #[tokio::test]
    async fn public_repository_stats_map_success_and_provider_failures() {
        let client = http_client().unwrap();
        let base = serve(vec![response(
            "200 OK",
            br#"{"stargazers_count":45,"forks_count":7}"#,
        )]);
        assert_eq!(
            fetch_public_repo_stats(&client, &format!("{base}/repo"))
                .await
                .unwrap(),
            GitHubRepoStats {
                stars: 45,
                forks: 7
            }
        );

        let base = serve(vec![response("404 Not Found", b"missing")]);
        assert!(fetch_public_repo_stats(&client, &format!("{base}/repo"))
            .await
            .unwrap_err()
            .contains("404"));

        let base = serve(vec![response("200 OK", b"not json")]);
        assert!(fetch_public_repo_stats(&client, &format!("{base}/repo"))
            .await
            .unwrap_err()
            .contains("invalid repository response"));
    }

    #[tokio::test]
    async fn repository_archive_download_validates_metadata_and_zip_bytes() {
        let client = http_client().unwrap();
        let base = serve(vec![
            response("200 OK", br#"{"default_branch":"main"}"#),
            response("200 OK", b"PK\x03\x04"),
        ]);
        let (metadata, archive) = download_repository_archive(
            &client,
            "secret",
            "owner/repo",
            &format!("{base}/metadata"),
            &format!("{base}/archive"),
        )
        .await
        .unwrap();
        assert_eq!(metadata.default_branch, "main");
        assert_eq!(archive, b"PK\x03\x04");

        let base = serve(vec![response("200 OK", br#"{"default_branch":""}"#)]);
        assert!(download_repository_archive(
            &client,
            "secret",
            "owner/repo",
            &format!("{base}/metadata"),
            &format!("{base}/archive"),
        )
        .await
        .unwrap_err()
        .contains("default branch"));

        let base = serve(vec![
            response("200 OK", br#"{"default_branch":"main"}"#),
            response("200 OK", b"not a zip"),
        ]);
        assert!(download_repository_archive(
            &client,
            "secret",
            "owner/repo",
            &format!("{base}/metadata"),
            &format!("{base}/archive"),
        )
        .await
        .unwrap_err()
        .contains("invalid repository archive"));
    }

    #[tokio::test]
    async fn repository_archive_download_rejects_provider_errors_and_declared_oversize() {
        let client = http_client().unwrap();
        let base = serve(vec![response("403 Forbidden", b"denied")]);
        assert!(download_repository_archive(
            &client,
            "secret",
            "owner/repo",
            &format!("{base}/metadata"),
            &format!("{base}/archive"),
        )
        .await
        .unwrap_err()
        .contains("Could not load"));

        let base = serve(vec![
            response("200 OK", br#"{"default_branch":"main"}"#),
            response("502 Bad Gateway", b"down"),
        ]);
        assert!(download_repository_archive(
            &client,
            "secret",
            "owner/repo",
            &format!("{base}/metadata"),
            &format!("{base}/archive"),
        )
        .await
        .unwrap_err()
        .contains("Could not download"));

        let base = serve(vec![
            response("200 OK", br#"{"default_branch":"main"}"#),
            response_with_length("200 OK", REPOSITORY_IMPORT_MAX_BYTES + 1),
        ]);
        assert!(download_repository_archive(
            &client,
            "secret",
            "owner/repo",
            &format!("{base}/metadata"),
            &format!("{base}/archive"),
        )
        .await
        .unwrap_err()
        .contains("larger than 256 MB"));
    }
}
