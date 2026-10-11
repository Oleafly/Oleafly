#![allow(dead_code)]

use std::collections::BTreeMap;
use std::path::Path;

use axum::body::Body;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use axum::Router;
use oleafly_server::config::ServerConfig;
use oleafly_server::test_support::{TEST_PUBLIC_URL, TEST_SETUP_CODE};
use serde_json::Value;
use tower::ServiceExt;

pub struct Reply {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Value,
}

pub fn build_request(
    method: Method,
    path: &str,
    authorization: Option<String>,
    body: Option<String>,
) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(path);
    if let Some(value) = authorization {
        builder = builder.header(header::AUTHORIZATION, value);
    }
    let built = match body {
        Some(text) => builder
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(text)),
        None => builder.body(Body::empty()),
    };
    built.expect("the test request is valid")
}

pub async fn send_request(router: &Router, request: Request<Body>) -> Reply {
    let response = router
        .clone()
        .oneshot(request)
        .await
        .expect("the router always answers");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .expect("the body is readable");
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()))
    };
    Reply {
        status,
        headers,
        body,
    }
}

fn bearer(token: Option<&str>) -> Option<String> {
    token.map(|token| format!("Bearer {token}"))
}

pub async fn send(
    router: &Router,
    method: Method,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> Reply {
    let request = build_request(
        method,
        path,
        bearer(token),
        body.map(|json| json.to_string()),
    );
    send_request(router, request).await
}

pub async fn send_get(router: &Router, path: &str, token: Option<&str>) -> Reply {
    send(router, Method::GET, path, token, None).await
}

pub async fn send_post(router: &Router, path: &str, token: Option<&str>, body: Value) -> Reply {
    send(router, Method::POST, path, token, Some(body)).await
}

pub async fn send_patch(router: &Router, path: &str, token: Option<&str>, body: Value) -> Reply {
    send(router, Method::PATCH, path, token, Some(body)).await
}

pub async fn send_delete(router: &Router, path: &str, token: Option<&str>) -> Reply {
    send(router, Method::DELETE, path, token, None).await
}

pub async fn send_raw(
    router: &Router,
    method: Method,
    path: &str,
    token: Option<&str>,
    raw_body: &str,
) -> Reply {
    let request = build_request(method, path, bearer(token), Some(raw_body.to_string()));
    send_request(router, request).await
}

pub async fn send_with_authorization(router: &Router, path: &str, authorization: &str) -> Reply {
    let request = build_request(Method::GET, path, Some(authorization.to_string()), None);
    send_request(router, request).await
}

pub fn config_with(pairs: &[(&str, &str)]) -> ServerConfig {
    let mut vars = BTreeMap::new();
    vars.insert(
        "OLEAFLY_PUBLIC_URL".to_string(),
        TEST_PUBLIC_URL.to_string(),
    );
    vars.insert(
        "OLEAFLY_SETUP_CODE".to_string(),
        TEST_SETUP_CODE.to_string(),
    );
    vars.insert(
        "OLEAFLY_DATA_DIR".to_string(),
        std::env::temp_dir()
            .join("oleafly-server-test-data")
            .display()
            .to_string(),
    );
    for (key, value) in pairs {
        vars.insert((*key).to_string(), (*value).to_string());
    }
    ServerConfig::from_vars(&vars, &missing_file).expect("the test configuration is valid")
}

fn missing_file(path: &Path) -> std::io::Result<String> {
    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        path.display().to_string(),
    ))
}
