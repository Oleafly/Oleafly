//! Public community signals shown beside the "Join Discord" links.
//!
//! The Discord server widget is a public, unauthenticated JSON document. It is
//! fetched from Rust so the webview needs no extra `connect-src` origin, and
//! only on demand: the Settings and About surfaces ask for it when they open.

use serde::{Deserialize, Serialize};

/// The Oleafly Community server widget. A guild id is permanent while invite
/// codes can rotate, so the count comes from the widget, not an invite lookup.
const DISCORD_WIDGET_URL: &str = "https://discord.com/api/guilds/1550031474697437264/widget.json";

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct DiscordCommunityStats {
    pub online: u64,
}

#[derive(Deserialize)]
struct DiscordWidgetResponse {
    presence_count: u64,
}

/// Load how many community members are online right now. Needs no account and
/// sends nothing about the user or their projects.
#[tauri::command]
pub async fn discord_community_stats() -> Result<DiscordCommunityStats, String> {
    fetch_discord_community_stats(&http_client()?, DISCORD_WIDGET_URL).await
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Oleafly")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|error| format!("could not build HTTP client: {error}"))
}

async fn fetch_discord_community_stats(
    client: &reqwest::Client,
    url: &str,
) -> Result<DiscordCommunityStats, String> {
    let response = client
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|error| format!("network error: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Could not load community statistics ({}).",
            response.status()
        ));
    }

    let widget = response
        .json::<DiscordWidgetResponse>()
        .await
        .map_err(|error| format!("invalid community response: {error}"))?;
    Ok(DiscordCommunityStats {
        online: widget.presence_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Answer one request with `status` and `body`, then hang up.
    async fn serve_once(status: &'static str, body: &'static str) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request).await;
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).await.unwrap();
        });
        format!("http://{address}/widget.json")
    }

    #[tokio::test]
    async fn community_stats_report_the_count_and_explain_provider_failures() {
        let client = http_client().unwrap();

        let url = serve_once(
            "200 OK",
            r#"{"id":"1","name":"Oleafly Community","members":[],"presence_count":12}"#,
        )
        .await;
        assert_eq!(
            fetch_discord_community_stats(&client, &url).await.unwrap(),
            DiscordCommunityStats { online: 12 }
        );

        let url = serve_once(
            "403 Forbidden",
            r#"{"message":"Widget Disabled","code":50004}"#,
        )
        .await;
        assert!(fetch_discord_community_stats(&client, &url)
            .await
            .unwrap_err()
            .contains("403"));

        let url = serve_once("200 OK", "not json").await;
        assert!(fetch_discord_community_stats(&client, &url)
            .await
            .unwrap_err()
            .contains("invalid community response"));
    }

    #[tokio::test]
    async fn an_unreachable_widget_is_a_network_error_not_a_panic() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/widget.json", listener.local_addr().unwrap());
        drop(listener);

        assert!(fetch_discord_community_stats(&http_client().unwrap(), &url)
            .await
            .unwrap_err()
            .contains("network error"));
    }

    #[test]
    fn widget_responses_map_the_presence_count_and_ignore_the_member_list() {
        let widget: DiscordWidgetResponse = serde_json::from_value(serde_json::json!({
            "id": "1550031474697437264",
            "name": "Oleafly Community",
            "instant_invite": "https://discord.com/invite/example",
            "channels": [],
            "members": [{ "id": "0", "username": "a", "status": "online" }],
            "presence_count": 42
        }))
        .unwrap();

        assert_eq!(widget.presence_count, 42);
    }

    #[test]
    fn a_widget_without_a_presence_count_is_rejected() {
        let widget = serde_json::from_value::<DiscordWidgetResponse>(serde_json::json!({
            "message": "Widget Disabled",
            "code": 50004
        }));

        assert!(widget.is_err());
    }

    #[test]
    fn the_widget_url_targets_the_fixed_discord_origin() {
        assert!(DISCORD_WIDGET_URL.starts_with("https://discord.com/api/guilds/"));
        assert!(DISCORD_WIDGET_URL.ends_with("/widget.json"));
    }
}
