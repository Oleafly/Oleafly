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
        .user_agent("OpenLeaf")
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

// --- Authenticated GitHub REST API (token stays in the Rust core) ---
//
// These commands call api.github.com from Rust, reading the token from the
// on-disk config. The token is NEVER returned to the webview (get_config blanks
// it), so a webview compromise (XSS) can't read or exfiltrate it - it can only
// ask the core to perform these specific, scoped actions.

const API_USER: &str = "https://api.github.com/user";
const API_REPOS: &str = "https://api.github.com/user/repos";

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
    let mut cfg = config::read_config()?;
    cfg.github_token = token;
    cfg.github_user = user.login.clone();
    config::write_config(&cfg)?;
    Ok(user)
}

/// Clear the stored GitHub token + cached login (disconnect).
#[tauri::command]
pub fn gh_clear_token() -> Result<(), String> {
    let mut cfg = config::read_config()?;
    cfg.github_token = String::new();
    cfg.github_user = String::new();
    config::write_config(&cfg)
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
