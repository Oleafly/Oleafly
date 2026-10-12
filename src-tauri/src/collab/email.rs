use oleafly_collab::CollabError;
use oleafly_collab_protocol::email::{
    EmailPreferences, EmailPreferencesPatch, EmailStatus, EmailTestResult,
};
use oleafly_collab_protocol::ids::ServerId;

use super::commands::{authed, parse_id, AppHost, CollabCommandError, CollabHost};
use super::state::CollabState;

pub async fn admin_email_status(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
) -> Result<EmailStatus, CollabError> {
    authed(state, host, server, |client, access| {
        Box::pin(client.admin_email_status(access))
    })
    .await
}

pub async fn admin_email_test(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
) -> Result<EmailTestResult, CollabError> {
    authed(state, host, server, |client, access| {
        Box::pin(client.admin_email_test(access))
    })
    .await
}

pub async fn email_preferences(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
) -> Result<EmailPreferences, CollabError> {
    authed(state, host, server, |client, access| {
        Box::pin(client.email_preferences(access))
    })
    .await
}

pub async fn set_email_preferences(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    patch: EmailPreferencesPatch,
) -> Result<EmailPreferences, CollabError> {
    authed(state, host, server, move |client, access| {
        Box::pin(async move { client.set_email_preferences(access, &patch).await })
    })
    .await
}

#[tauri::command]
pub async fn collab_admin_email_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
) -> Result<EmailStatus, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    admin_email_status(state.inner(), &AppHost::new(app), server)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_email_test(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
) -> Result<EmailTestResult, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    admin_email_test(state.inner(), &AppHost::new(app), server)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_email_preferences(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
) -> Result<EmailPreferences, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    email_preferences(state.inner(), &AppHost::new(app), server)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_set_email_preferences(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    patch: EmailPreferencesPatch,
) -> Result<EmailPreferences, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    set_email_preferences(state.inner(), &AppHost::new(app), server, patch)
        .await
        .map_err(CollabCommandError::from)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use oleafly_collab::{CollabPaths, MemorySecrets};
    use oleafly_server::config::ProviderConfig;
    use oleafly_server::test_support::{
        mail_config, MockGithub, MockGithubUser, MockSmtp, TestServer,
    };

    use super::super::commands::sign_in_server;
    use super::*;

    struct FollowingHost;

    impl CollabHost for FollowingHost {
        fn open_browser(&self, url: &str) -> Result<(), CollabError> {
            let url = url.to_string();
            tokio::spawn(async move {
                if let Ok(client) = reqwest::Client::builder().no_proxy().build() {
                    let _ = client.get(url).send().await;
                }
            });
            Ok(())
        }

        fn server_changed(&self, _server: ServerId) {}

        fn signed_in(&self) {}

        fn device_name(&self) -> String {
            "Test Mac".to_string()
        }

        fn platform(&self) -> String {
            "macos".to_string()
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn email_commands_reach_the_server() {
        let github = MockGithub::start(vec![MockGithubUser {
            id: 1,
            login: "carol".to_string(),
            name: "Carol".to_string(),
            emails: vec![("carol@uni.edu".to_string(), true)],
        }])
        .await;
        let smtp = MockSmtp::start().await;
        let mut config = mail_config(&smtp);
        config.providers.push(ProviderConfig::Github {
            id: "github".to_string(),
            label: "GitHub".to_string(),
            client_id: "oleafly-test".to_string(),
            client_secret: "oleafly-test-secret".to_string(),
            web_url: github.web_url(),
            api_url: github.api_url(),
        });
        let server = TestServer::start(config).await;
        let dir = tempfile::tempdir().expect("tempdir");
        let state = CollabState::new(
            CollabPaths::new(dir.path().join("collab")),
            Arc::new(MemorySecrets::default()),
        );
        let host = FollowingHost;
        let added = sign_in_server(
            &state,
            &host,
            &server.url(),
            "github".to_string(),
            Some(server.setup_code()),
            Duration::from_secs(20),
        )
        .await
        .expect("sign in");
        let id = added.server_id;
        let status = admin_email_status(&state, &host, id).await.expect("status");
        assert!(status.configured);
        assert_eq!(status.from.as_deref(), Some("Smith Lab <oleafly@lab.test>"));
        let result = admin_email_test(&state, &host, id).await.expect("test");
        assert!(result.delivered);
        assert_eq!(result.sent_to, ["carol@uni.edu"]);
        assert_eq!(smtp.wait_for(1, Duration::from_secs(10)).await.len(), 1);
        let preferences = email_preferences(&state, &host, id).await.expect("read");
        assert!(preferences.shared_with_you);
        let changed = set_email_preferences(
            &state,
            &host,
            id,
            EmailPreferencesPatch {
                shared_with_you: Some(false),
            },
        )
        .await
        .expect("change");
        assert!(!changed.shared_with_you);
        assert!(
            !email_preferences(&state, &host, id)
                .await
                .expect("read again")
                .shared_with_you
        );
    }
}
