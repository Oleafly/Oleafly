mod support;

use axum::http::{header, StatusCode};
use oleafly_collab_protocol::capabilities::{
    CapabilityManifest, EncryptionSupport, ProviderKind, PROTOCOL_VERSION,
};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::clock::Clock;
use oleafly_server::test_support::{test_app, test_app_with};
use oleafly_server::{members, settings};
use serde_json::json;

const MANIFEST: &str = "/.well-known/oleafly-server";

#[tokio::test]
async fn manifest_needs_setup_until_an_admin_exists() {
    let app = test_app().await;
    let reply = support::send_get(&app.router, MANIFEST, None).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(
        reply
            .headers
            .get(header::CACHE_CONTROL)
            .and_then(|value| value.to_str().ok()),
        Some("no-store")
    );
    let manifest: CapabilityManifest = serde_json::from_value(reply.body).unwrap();
    assert!(manifest.needs_setup);
    assert_eq!(manifest.server_id, app.state.server_id);
    let now = app.clock.now_ms();
    app.state
        .db
        .call(move |conn| members::create_account(conn, "Ada", None, ServerRole::Admin, now))
        .await
        .unwrap();
    let after: CapabilityManifest =
        serde_json::from_value(support::send_get(&app.router, MANIFEST, None).await.body).unwrap();
    assert!(!after.needs_setup);
}

#[tokio::test]
async fn manifest_reports_name_providers_features_and_limits() {
    let config = support::config_with(&[
        ("OLEAFLY_SERVER_NAME", "Smith Lab"),
        (
            "OLEAFLY_SERVER_ICON_URL",
            "https://lab.example.edu/icon.png",
        ),
        ("OLEAFLY_GITHUB_CLIENT_ID", "id"),
        ("OLEAFLY_GITHUB_CLIENT_SECRET", "secret"),
        (
            "OLEAFLY_OIDC_UNI_ISSUER",
            "https://login.uni.edu/realms/main",
        ),
        ("OLEAFLY_OIDC_UNI_CLIENT_ID", "oleafly"),
        ("OLEAFLY_OIDC_UNI_CLIENT_SECRET", "secret"),
        ("OLEAFLY_OIDC_UNI_LABEL", "University login"),
        ("OLEAFLY_SMTP_URL", "smtps://mailer:pw@smtp.example.edu:465"),
        ("OLEAFLY_MAIL_FROM", "lab@example.edu"),
        ("OLEAFLY_MAX_PROJECT_MB", "500"),
        ("OLEAFLY_MAX_FILE_MB", "100"),
        ("OLEAFLY_MAX_MEMBERS_PER_PROJECT", "40"),
    ]);
    let app = test_app_with(config).await;
    let manifest: CapabilityManifest =
        serde_json::from_value(support::send_get(&app.router, MANIFEST, None).await.body).unwrap();
    assert_eq!(manifest.name, "Smith Lab");
    assert_eq!(
        manifest.icon_url.as_deref(),
        Some("https://lab.example.edu/icon.png")
    );
    assert_eq!(manifest.version, env!("CARGO_PKG_VERSION"));
    assert_eq!(
        (manifest.protocol.min, manifest.protocol.max),
        (PROTOCOL_VERSION, PROTOCOL_VERSION)
    );
    let providers: Vec<(&str, &str)> = manifest
        .providers
        .iter()
        .map(|provider| (provider.id.as_str(), provider.label.as_str()))
        .collect();
    assert_eq!(
        providers,
        [("github", "GitHub"), ("uni", "University login")]
    );
    assert!(matches!(manifest.providers[0].kind, ProviderKind::Github));
    assert!(matches!(manifest.providers[1].kind, ProviderKind::Oidc));
    assert_eq!(
        (
            manifest.limits.max_project_mb,
            manifest.limits.max_file_mb,
            manifest.limits.max_members_per_project
        ),
        (500, 100, 40)
    );
}

#[tokio::test]
async fn only_link_sharing_is_advertised_among_the_optional_features() {
    let config = support::config_with(&[
        ("OLEAFLY_SMTP_URL", "smtps://mailer:pw@smtp.example.edu:465"),
        ("OLEAFLY_MAIL_FROM", "lab@example.edu"),
    ]);
    let app = test_app_with(config).await;
    app.state
        .db
        .call(|conn| {
            conn.execute_batch(
                "INSERT INTO settings (key, value) VALUES ('guests_enabled', 1), ('link_sharing_allowed', 1), ('access_logs_allowed', 1), ('comments_allowed', 1), ('email_notifications', 1);",
            )?;
            Ok(())
        })
        .await
        .unwrap();
    assert!(
        app.state
            .db
            .call(|conn| settings::load(conn))
            .await
            .unwrap()
            .guests_enabled
    );
    let manifest: CapabilityManifest =
        serde_json::from_value(support::send_get(&app.router, MANIFEST, None).await.body).unwrap();
    assert!(!manifest.features.email);
    assert!(!manifest.features.guests);
    assert!(manifest.features.link_sharing);
    assert!(!manifest.features.access_logs);
    assert!(!manifest.features.comments);
    assert!(matches!(
        manifest.features.encryption,
        EncryptionSupport::None
    ));
}

#[tokio::test]
async fn health_and_readiness_answer() {
    let app = test_app().await;
    let health = support::send_get(&app.router, "/healthz", None).await;
    assert_eq!(health.status, StatusCode::OK);
    assert_eq!(health.body, json!({"status": "ok"}));
    let ready = support::send_get(&app.router, "/readyz", None).await;
    assert_eq!(ready.status, StatusCode::OK);
    assert_eq!(ready.body, json!({"status": "ready"}));
}

#[tokio::test]
async fn routes_answer_with_and_without_the_public_url_prefix() {
    for public in [
        "https://uni.edu/oleafly",
        "https://uni.edu/oleafly/",
        "HTTPS://Uni.edu/oleafly",
    ] {
        let app = test_app_with(support::config_with(&[("OLEAFLY_PUBLIC_URL", public)])).await;
        assert_eq!(
            app.state.config.public_url.as_str(),
            "https://uni.edu/oleafly"
        );
        assert_eq!(
            app.state.config.endpoint("/auth/callback/github").as_str(),
            "https://uni.edu/oleafly/auth/callback/github"
        );
        for path in [
            "/oleafly/.well-known/oleafly-server",
            "/.well-known/oleafly-server",
            "/oleafly/healthz",
            "/healthz",
        ] {
            assert_eq!(
                support::send_get(&app.router, path, None).await.status,
                StatusCode::OK,
                "{public} {path}"
            );
        }
        assert_eq!(
            support::send_get(&app.router, "/elsewhere/healthz", None)
                .await
                .status,
            StatusCode::NOT_FOUND
        );
    }
}

#[tokio::test]
async fn unknown_paths_return_api_error_json() {
    let app = test_app().await;
    let reply = support::send_get(&app.router, "/api/v1/nothing-here", None).await;
    assert_eq!(reply.status, StatusCode::NOT_FOUND);
    assert_eq!(reply.body["code"], "not_found");
}

#[tokio::test]
async fn serve_reports_a_port_that_is_already_taken() {
    let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let bind = taken.local_addr().unwrap().to_string();
    let directory = tempfile::tempdir().unwrap();
    let data_dir = directory.path().join("data").display().to_string();
    let config = support::config_with(&[
        ("OLEAFLY_BIND", bind.as_str()),
        ("OLEAFLY_DATA_DIR", data_dir.as_str()),
    ]);
    let error = oleafly_server::serve(config).await.unwrap_err();
    assert!(error.to_string().contains("could not listen"), "{error}");
    assert!(directory
        .path()
        .join("data")
        .join("oleafly-server.sqlite3")
        .exists());
}
