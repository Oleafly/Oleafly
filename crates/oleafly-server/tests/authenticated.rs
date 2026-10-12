mod support;

use std::net::SocketAddr;

use axum::extract::ConnectInfo;
use axum::http::{HeaderValue, Method, StatusCode};
use axum::routing::get;
use axum::{Json, Router};
use oleafly_collab_protocol::roles::{ServerAction, ServerRole};
use oleafly_server::clock::Clock;
use oleafly_server::error::ServerError;
use oleafly_server::members;
use oleafly_server::routes::{Authenticated, ClientIp};
use oleafly_server::state::AppState;
use oleafly_server::test_support::{seed_member, test_app, test_app_with};
use serde_json::{json, Value};

fn probe(state: AppState) -> Router {
    Router::new()
        .route(
            "/probe",
            get(|auth: Authenticated| async move {
                auth.require(ServerAction::ShareProjects)?;
                Ok::<_, ServerError>(Json(json!({
                    "account_id": auth.account_id,
                    "device_id": auth.device_id,
                    "role": auth.role,
                })))
            }),
        )
        .route(
            "/staff",
            get(|auth: Authenticated| async move {
                auth.require(ServerAction::ManageMembers)?;
                Ok::<_, ServerError>(Json(json!({"ok": true})))
            }),
        )
        .with_state(state)
}

fn ip_probe(state: AppState) -> Router {
    Router::new()
        .route(
            "/ip",
            get(|ClientIp(ip): ClientIp| async move { Json(json!({ "ip": ip })) }),
        )
        .with_state(state)
}

#[tokio::test]
async fn missing_or_malformed_credentials_are_unauthorized() {
    let app = test_app().await;
    let router = probe(app.state.clone());
    let missing = support::send_get(&router, "/probe", None).await;
    assert_eq!(missing.status, StatusCode::UNAUTHORIZED);
    assert_eq!(missing.body["code"], "unauthorized");
    for header in [
        "Basic dXNlcjpwYXNz",
        "Bearer",
        "Bearer    ",
        "Bearer not-a-real-token",
    ] {
        let reply = support::send_with_authorization(&router, "/probe", header).await;
        assert_eq!(reply.status, StatusCode::UNAUTHORIZED, "{header}");
    }
}

#[tokio::test]
async fn a_seeded_member_is_authenticated_with_its_role() {
    let app = test_app().await;
    let member = seed_member(&app, ServerRole::Member).await;
    let router = probe(app.state.clone());
    let reply = support::send_get(&router, "/probe", Some(&member.access_token)).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.body["account_id"], member.account_id.to_string());
    assert_eq!(reply.body["device_id"], member.device_id.to_string());
    assert_eq!(reply.body["role"], "member");
    let lower = support::send_with_authorization(
        &router,
        "/probe",
        &format!("bearer {}", member.access_token),
    )
    .await;
    assert_eq!(lower.status, StatusCode::OK);
}

#[tokio::test]
async fn expired_tokens_are_unauthorized() {
    let app = test_app().await;
    let member = seed_member(&app, ServerRole::Member).await;
    let router = probe(app.state.clone());
    app.clock.advance(10 * 60 * 1000 - 1);
    assert_eq!(
        support::send_get(&router, "/probe", Some(&member.access_token))
            .await
            .status,
        StatusCode::OK
    );
    app.clock.advance(1);
    assert_eq!(
        support::send_get(&router, "/probe", Some(&member.access_token))
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn revoked_devices_and_suspended_accounts_are_unauthorized() {
    let app = test_app().await;
    let first = seed_member(&app, ServerRole::Member).await;
    let second = seed_member(&app, ServerRole::Member).await;
    let router = probe(app.state.clone());
    let (device, account_of_device) = (first.device_id, first.account_id);
    app.state
        .db
        .call(move |conn| {
            conn.execute(
                "INSERT INTO refresh_tokens (token_hash, family_id, account_id, device_id, created_at, expires_at, grace_reply) VALUES ('r1', 'f1', ?1, ?2, 0, 9999999999999, x'0102')",
                [account_of_device.to_string(), device.to_string()],
            )?;
            Ok(())
        })
        .await
        .unwrap();
    let revoked_at = app.clock.now_ms();
    app.state.revoke_device(device).await.unwrap();
    assert_eq!(
        support::send_get(&router, "/probe", Some(&first.access_token))
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    app.clock.advance(1_000);
    app.state.revoke_device(device).await.unwrap();
    let (device_rows, device_revoked, refresh_revoked, grace, access_rows) = app
        .state
        .db
        .call(move |conn| {
            let id = device.to_string();
            let device_rows: i64 =
                conn.query_row("SELECT COUNT(*) FROM devices WHERE id = ?1", [&id], |row| {
                    row.get(0)
                })?;
            let device_revoked: Option<i64> = conn.query_row(
                "SELECT revoked_at FROM devices WHERE id = ?1",
                [&id],
                |row| row.get(0),
            )?;
            let (refresh_revoked, grace): (Option<i64>, Option<Vec<u8>>) = conn.query_row(
                "SELECT revoked_at, grace_reply FROM refresh_tokens WHERE token_hash = 'r1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let access_rows: i64 = conn.query_row(
                "SELECT COUNT(*) FROM access_tokens WHERE device_id = ?1",
                [&id],
                |row| row.get(0),
            )?;
            Ok((
                device_rows,
                device_revoked,
                refresh_revoked,
                grace,
                access_rows,
            ))
        })
        .await
        .unwrap();
    assert_eq!(device_rows, 1);
    assert_eq!(device_revoked, Some(revoked_at));
    assert_eq!(refresh_revoked, Some(revoked_at));
    assert_eq!(grace, None);
    assert_eq!(access_rows, 0);
    let account = second.account_id;
    app.state
        .db
        .call(move |conn| {
            conn.execute(
                "UPDATE accounts SET status = 'suspended' WHERE id = ?1",
                [account.to_string()],
            )?;
            Ok(())
        })
        .await
        .unwrap();
    assert_eq!(
        support::send_get(&router, "/probe", Some(&second.access_token))
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn require_follows_the_role_table() {
    let app = test_app().await;
    let router = probe(app.state.clone());
    let member = seed_member(&app, ServerRole::Member).await;
    let maintainer = seed_member(&app, ServerRole::Maintainer).await;
    let guest = seed_member(&app, ServerRole::Guest).await;
    let denied = support::send_get(&router, "/staff", Some(&member.access_token)).await;
    assert_eq!(denied.status, StatusCode::FORBIDDEN);
    assert_eq!(denied.body["code"], "forbidden");
    assert_eq!(
        support::send_get(&router, "/staff", Some(&maintainer.access_token))
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        support::send_get(&router, "/probe", Some(&guest.access_token))
            .await
            .status,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn client_ip_comes_from_a_trusted_proxy_or_the_socket() {
    for (behind_proxy, expected) in [
        ("true", json!("198.51.100.7")),
        ("false", json!("127.0.0.1")),
    ] {
        let app = test_app_with(support::config_with(&[(
            "OLEAFLY_BEHIND_PROXY",
            behind_proxy,
        )]))
        .await;
        let mut request = support::build_request(Method::GET, "/ip", None, None);
        request.headers_mut().insert(
            "x-forwarded-for",
            HeaderValue::from_static("203.0.113.5, 198.51.100.7"),
        );
        request
            .extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 40_000))));
        let reply = support::send_request(&ip_probe(app.state.clone()), request).await;
        assert_eq!(reply.body["ip"], expected, "behind proxy: {behind_proxy}");
    }
    let app = test_app().await;
    let request = support::build_request(Method::GET, "/ip", None, None);
    let reply = support::send_request(&ip_probe(app.state.clone()), request).await;
    assert_eq!(reply.body["ip"], Value::Null);
}

#[tokio::test]
async fn client_ip_looks_past_every_proxy_in_front_of_the_server() {
    let app = test_app_with(support::config_with(&[
        ("OLEAFLY_BEHIND_PROXY", "true"),
        ("OLEAFLY_PROXY_HOPS", "2"),
    ]))
    .await;
    for (forwarded, expected) in [
        ("152.44.135.141, 10.0.1.1", "152.44.135.141"),
        ("203.0.113.9, 152.44.135.141, 10.0.1.1", "152.44.135.141"),
        ("2001:db8::7, 10.0.1.1", "2001:db8::7"),
        ("198.51.100.4", "198.51.100.4"),
    ] {
        let mut request = support::build_request(Method::GET, "/ip", None, None);
        request
            .headers_mut()
            .insert("x-forwarded-for", HeaderValue::from_static(forwarded));
        request
            .extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([10, 0, 15, 2], 40_000))));
        let reply = support::send_request(&ip_probe(app.state.clone()), request).await;
        assert_eq!(reply.body["ip"], json!(expected), "forwarded: {forwarded}");
    }
}

#[tokio::test]
async fn seeding_an_admin_ends_setup() {
    let app = test_app().await;
    let before = app
        .state
        .db
        .call(|conn| members::count_admins(conn))
        .await
        .unwrap();
    assert_eq!(before, 0);
    seed_member(&app, ServerRole::Admin).await;
    let after = app
        .state
        .db
        .call(|conn| members::count_admins(conn))
        .await
        .unwrap();
    assert_eq!(after, 1);
    let manifest = support::send_get(&app.router, "/.well-known/oleafly-server", None).await;
    assert_eq!(manifest.body["needs_setup"], false);
}
