use std::net::SocketAddr;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Method, Request, StatusCode};
use oleafly_collab_protocol::auth::{
    challenge_message, ChallengePurpose, ChallengeResponse, RefreshRequest, SessionTokens,
};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::auth::{devices, refresh};
use oleafly_server::build_router;
use oleafly_server::clock::Clock;
use oleafly_server::members;
use oleafly_server::rate_limit::RateLimiter;
use oleafly_server::test_support::{test_app, TestApp, TestDevice};
use tower::ServiceExt;

const FROM: &str = "203.0.113.7";

fn request(path: &str, body: Option<String>) -> Request<Body> {
    let mut request = Request::builder()
        .method(Method::POST)
        .uri(path)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body.map_or_else(Body::empty, Body::from))
        .expect("request");
    let address: SocketAddr = format!("{FROM}:40000").parse().expect("address");
    request.extensions_mut().insert(ConnectInfo(address));
    request
}

async fn signed_in(app: &TestApp, device: &TestDevice) -> SessionTokens {
    let key = device.public_key_b64().to_owned();
    let now = app.clock.now_ms();
    app.state
        .db
        .call(move |conn| {
            let account = members::create_account(conn, "Ada", None, ServerRole::Member, now)?;
            let registered = devices::register(conn, account, &key, "Laptop", "macos", now)?;
            refresh::issue_session(conn, account, registered.device_id, now)
        })
        .await
        .expect("a session")
}

async fn refreshed(
    app: &TestApp,
    router: &axum::Router,
    device: &TestDevice,
    tokens: &SessionTokens,
    sign_properly: bool,
) -> (StatusCode, Option<SessionTokens>) {
    let challenge = router
        .clone()
        .oneshot(request("/auth/challenge", None))
        .await
        .expect("challenge");
    if challenge.status() != StatusCode::OK {
        return (challenge.status(), None);
    }
    let body = axum::body::to_bytes(challenge.into_body(), 64 * 1024)
        .await
        .expect("body");
    let challenge: ChallengeResponse = serde_json::from_slice(&body).expect("challenge json");
    let message = challenge_message(
        ChallengePurpose::Refresh,
        app.state.server_id,
        &challenge.nonce,
    );
    let signature = if sign_properly {
        device.sign_b64(&message)
    } else {
        TestDevice::generate().sign_b64(&message)
    };
    let refresh = RefreshRequest {
        refresh_token: tokens.refresh_token.clone(),
        device_id: tokens.device_id,
        nonce: challenge.nonce,
        signature,
    };
    let response = router
        .clone()
        .oneshot(request(
            "/auth/refresh",
            Some(serde_json::to_string(&refresh).expect("json")),
        ))
        .await
        .expect("refresh");
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), 64 * 1024)
        .await
        .expect("body");
    (status, serde_json::from_slice(&body).ok())
}

#[tokio::test]
async fn refreshes_that_prove_their_device_do_not_use_up_the_address_allowance() {
    let mut app = test_app().await;
    app.state.rate_limiter = Arc::new(RateLimiter::new(2, 1));
    let router = build_router(app.state.clone());
    let device = TestDevice::generate();
    let mut tokens = signed_in(&app, &device).await;
    for round in 0..5 {
        let (status, fresh) = refreshed(&app, &router, &device, &tokens, true).await;
        assert_eq!(status, StatusCode::OK, "refresh {round}");
        tokens = fresh.expect("new tokens");
    }
}

#[tokio::test]
async fn refreshes_that_fail_their_check_still_use_up_the_address_allowance() {
    let mut app = test_app().await;
    app.state.rate_limiter = Arc::new(RateLimiter::new(2, 1));
    let router = build_router(app.state.clone());
    let device = TestDevice::generate();
    let tokens = signed_in(&app, &device).await;
    let mut statuses = Vec::new();
    for _ in 0..3 {
        statuses.push(refreshed(&app, &router, &device, &tokens, false).await.0);
    }
    assert_eq!(statuses[0], StatusCode::UNAUTHORIZED, "{statuses:?}");
    assert!(
        statuses[1..].contains(&StatusCode::TOO_MANY_REQUESTS),
        "{statuses:?}"
    );
}
