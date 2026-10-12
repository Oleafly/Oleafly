use std::net::SocketAddr;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Method, Request, StatusCode};
use oleafly_server::build_router;
use oleafly_server::rate_limit::{RateLimiter, CONNECT_BURST};
use oleafly_server::test_support::test_app;
use serde_json::Value;
use tower::ServiceExt;

fn request(method: Method, path: &str, from: &str) -> Request<Body> {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .body(Body::empty())
        .expect("request");
    let address: SocketAddr = format!("{from}:40000").parse().expect("address");
    request.extensions_mut().insert(ConnectInfo(address));
    request
}

#[tokio::test]
async fn sign_in_endpoints_refuse_a_flood_from_one_address() {
    let mut app = test_app().await;
    app.state.rate_limiter = Arc::new(RateLimiter::new(3, 3));
    let router = build_router(app.state.clone());
    for _ in 0..3 {
        let response = router
            .clone()
            .oneshot(request(Method::POST, "/auth/challenge", "203.0.113.7"))
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
    }
    let refused = router
        .clone()
        .oneshot(request(Method::POST, "/auth/challenge", "203.0.113.7"))
        .await
        .expect("response");
    assert_eq!(refused.status(), StatusCode::TOO_MANY_REQUESTS);
    let body = axum::body::to_bytes(refused.into_body(), 64 * 1024)
        .await
        .expect("body");
    let error: Value = serde_json::from_slice(&body).expect("json");
    assert_eq!(error["code"], "rate_limited");
    let start = router
        .clone()
        .oneshot(request(Method::GET, "/auth/start", "203.0.113.7"))
        .await
        .expect("response");
    assert_eq!(start.status(), StatusCode::TOO_MANY_REQUESTS);
    let socket = router
        .clone()
        .oneshot(request(Method::GET, "/ws", "203.0.113.7"))
        .await
        .expect("response");
    assert_ne!(socket.status(), StatusCode::TOO_MANY_REQUESTS);
    let other = router
        .clone()
        .oneshot(request(Method::POST, "/auth/challenge", "198.51.100.4"))
        .await
        .expect("response");
    assert_eq!(other.status(), StatusCode::OK);
    let health = router
        .clone()
        .oneshot(request(Method::GET, "/healthz", "203.0.113.7"))
        .await
        .expect("response");
    assert_eq!(health.status(), StatusCode::OK);
    app.clock.advance(60_000);
    let refilled = router
        .clone()
        .oneshot(request(Method::POST, "/auth/challenge", "203.0.113.7"))
        .await
        .expect("response");
    assert_eq!(refilled.status(), StatusCode::OK);
}

#[tokio::test]
async fn one_ipv6_network_shares_one_limit() {
    let mut app = test_app().await;
    app.state.rate_limiter = Arc::new(RateLimiter::new(3, 3));
    let router = build_router(app.state.clone());
    for host in ["2001:db8:1:2::1", "2001:db8:1:2::2", "2001:db8:1:2:aaaa::3"] {
        let response = router
            .clone()
            .oneshot(request(
                Method::POST,
                "/auth/challenge",
                &format!("[{host}]"),
            ))
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
    }
    let refused = router
        .clone()
        .oneshot(request(
            Method::POST,
            "/auth/challenge",
            "[2001:db8:1:2:ffff:ffff:ffff:ffff]",
        ))
        .await
        .expect("response");
    assert_eq!(refused.status(), StatusCode::TOO_MANY_REQUESTS);
    let neighbour = router
        .clone()
        .oneshot(request(
            Method::POST,
            "/auth/challenge",
            "[2001:db8:1:3::1]",
        ))
        .await
        .expect("response");
    assert_eq!(neighbour.status(), StatusCode::OK);
}

#[tokio::test]
async fn socket_attempts_have_their_own_larger_allowance() {
    let app = test_app().await;
    let router = build_router(app.state.clone());
    for attempt in 0..CONNECT_BURST {
        let socket = router
            .clone()
            .oneshot(request(Method::GET, "/ws", "203.0.113.7"))
            .await
            .expect("response");
        assert_ne!(
            socket.status(),
            StatusCode::TOO_MANY_REQUESTS,
            "attempt {attempt}"
        );
    }
    let refused = router
        .clone()
        .oneshot(request(Method::GET, "/ws", "203.0.113.7"))
        .await
        .expect("response");
    assert_eq!(refused.status(), StatusCode::TOO_MANY_REQUESTS);
    let sign_in = router
        .clone()
        .oneshot(request(Method::POST, "/auth/challenge", "203.0.113.7"))
        .await
        .expect("response");
    assert_eq!(sign_in.status(), StatusCode::OK);
    let neighbour = router
        .clone()
        .oneshot(request(Method::GET, "/ws", "198.51.100.4"))
        .await
        .expect("response");
    assert_ne!(neighbour.status(), StatusCode::TOO_MANY_REQUESTS);
}

fn code_request(from: &str) -> Request<Body> {
    let body = serde_json::json!({
        "device_public_key": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "device_name": "Lab PC",
        "platform": "linux"
    });
    let mut request = Request::builder()
        .method(Method::POST)
        .uri("/auth/device/code")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("request");
    let address: SocketAddr = format!("{from}:40000").parse().expect("address");
    request.extensions_mut().insert(ConnectInfo(address));
    request
}

#[tokio::test]
async fn sign_in_codes_are_counted_per_ipv6_network() {
    let app = test_app().await;
    let router = build_router(app.state.clone());
    for index in 0..20 {
        let response = router
            .clone()
            .oneshot(code_request(&format!("[2001:db8:1:2::{index:x}]")))
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK, "code {index}");
    }
    let refused = router
        .clone()
        .oneshot(code_request("[2001:db8:1:2::ffff]"))
        .await
        .expect("response");
    assert_eq!(refused.status(), StatusCode::TOO_MANY_REQUESTS);
    let neighbour = router
        .clone()
        .oneshot(code_request("[2001:db8:1:3::1]"))
        .await
        .expect("response");
    assert_eq!(neighbour.status(), StatusCode::OK);
}
