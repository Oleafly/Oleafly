use std::sync::OnceLock;

use oleafly_agent::tools::web::{link_preview, LinkPreview, WebClient};

use crate::agent::web::WEB_USER_AGENT;

static CLIENT: OnceLock<WebClient> = OnceLock::new();

fn client() -> Result<&'static WebClient, String> {
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let client = WebClient::new(WEB_USER_AGENT).map_err(|error| error.to_string())?;
    Ok(CLIENT.get_or_init(|| client))
}

#[tauri::command]
pub async fn note_link_preview(url: String) -> Result<LinkPreview, String> {
    link_preview(client()?, &url, WEB_USER_AGENT)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn the_command_refuses_private_addresses_and_other_schemes() {
        for refused in [
            "http://127.0.0.1:1420/",
            "https://192.168.1.1/",
            "file:///etc/passwd",
        ] {
            assert!(
                note_link_preview(refused.into()).await.is_err(),
                "{refused}"
            );
        }
        assert!(std::ptr::eq(client().unwrap(), client().unwrap()));
    }
}
