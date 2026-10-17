use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{header, HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Router;
use tokio::task::JoinHandle;
use url::Url;

use crate::blobs::s3::S3Timeouts;
use crate::blobs::sigv4::{self, Credentials, Request};
use crate::blobs::{sha256_hex, BlobStore};
use crate::clock::{Clock, SystemClock};
use crate::config::S3Config;

pub const MOCK_S3_BUCKET: &str = "lab-bucket";
pub const MOCK_S3_REGION: &str = "eu-test-1";
pub const MOCK_S3_ACCESS_KEY_ID: &str = "AKIAMOCKOLEAFLYTEST";
pub const MOCK_S3_SECRET_ACCESS_KEY: &str = "mock+secret/access/key";
const MAX_CLOCK_SKEW_MS: i64 = 15 * 60 * 1000;
const REQUIRED_SIGNED_HEADERS: [&str; 3] = ["host", "x-amz-content-sha256", "x-amz-date"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MockS3Fault {
    AccessDenied,
    Unavailable,
    Stall(Duration),
    LoseWrites,
    FailNext(u32),
    RefuseDeletes,
}

pub struct MockS3 {
    addr: SocketAddr,
    shared: Arc<Shared>,
    task: JoinHandle<()>,
}

#[derive(Default)]
struct Shared {
    // Shared bytes, so answering a read never copies a large object.
    objects: Mutex<BTreeMap<String, Bytes>>,
    fault: Mutex<Option<MockS3Fault>>,
    rejections: Mutex<Vec<String>>,
    requests: Mutex<usize>,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

type Refusal = (StatusCode, &'static str);

impl MockS3 {
    pub async fn start() -> MockS3 {
        let shared = Arc::new(Shared::default());
        let router = Router::new()
            .fallback(handle)
            .layer(DefaultBodyLimit::disable())
            .with_state(Arc::clone(&shared));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind the mock S3 store");
        let addr = listener.local_addr().expect("mock S3 address");
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        MockS3 { addr, shared, task }
    }

    pub fn endpoint(&self) -> Url {
        Url::parse(&format!("http://{}/", self.addr)).expect("mock S3 address")
    }

    pub fn config(&self, prefix: &str) -> S3Config {
        S3Config {
            bucket: MOCK_S3_BUCKET.to_string(),
            prefix: prefix.to_string(),
            endpoint: Some(self.endpoint()),
            region: MOCK_S3_REGION.to_string(),
            access_key_id: MOCK_S3_ACCESS_KEY_ID.to_string(),
            secret_access_key: MOCK_S3_SECRET_ACCESS_KEY.to_string(),
        }
    }

    pub fn store(&self, prefix: &str) -> BlobStore {
        BlobStore::s3(
            &self.config(prefix),
            1 << 20,
            Arc::new(SystemClock),
            S3Timeouts::default(),
        )
        .expect("the mock S3 store builds")
    }

    pub fn keys(&self) -> Vec<String> {
        locked(&self.shared.objects).keys().cloned().collect()
    }

    pub fn object(&self, key: &str) -> Option<Vec<u8>> {
        locked(&self.shared.objects)
            .get(key)
            .map(|bytes| bytes.to_vec())
    }

    pub fn insert_object(&self, key: &str, bytes: &[u8]) {
        locked(&self.shared.objects).insert(key.to_string(), Bytes::copy_from_slice(bytes));
    }

    pub fn set_fault(&self, fault: Option<MockS3Fault>) {
        *locked(&self.shared.fault) = fault;
    }

    pub fn rejections(&self) -> Vec<String> {
        locked(&self.shared.rejections).clone()
    }

    pub fn requests(&self) -> usize {
        *locked(&self.shared.requests)
    }
}

impl Drop for MockS3 {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn handle(
    State(shared): State<Arc<Shared>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    *locked(&shared.requests) += 1;
    let fault = {
        let mut current = locked(&shared.fault);
        let seen = *current;
        if let Some(MockS3Fault::FailNext(left)) = seen {
            *current = left
                .checked_sub(1)
                .filter(|left| *left > 0)
                .map(MockS3Fault::FailNext);
        }
        seen
    };
    if let Some(MockS3Fault::Stall(delay)) = fault {
        tokio::time::sleep(delay).await;
    }
    if let Err((status, code)) = verify(&method, &uri, &headers, &body) {
        locked(&shared.rejections).push(code.to_string());
        return s3_error(status, code);
    }
    match fault {
        Some(MockS3Fault::AccessDenied) => return s3_error(StatusCode::FORBIDDEN, "AccessDenied"),
        Some(MockS3Fault::Unavailable | MockS3Fault::FailNext(_)) => {
            return s3_error(StatusCode::SERVICE_UNAVAILABLE, "SlowDown")
        }
        Some(MockS3Fault::RefuseDeletes) if method == Method::DELETE => {
            return s3_error(StatusCode::SERVICE_UNAVAILABLE, "SlowDown")
        }
        _ => {}
    }
    let bucket_path = format!("/{MOCK_S3_BUCKET}/");
    let Some(key) = uri
        .path()
        .strip_prefix(&bucket_path)
        .filter(|key| !key.is_empty())
    else {
        return s3_error(StatusCode::NOT_FOUND, "NoSuchBucket");
    };
    let mut objects = locked(&shared.objects);
    match method {
        Method::PUT => {
            if fault != Some(MockS3Fault::LoseWrites) {
                objects.insert(key.to_string(), body);
            }
            StatusCode::OK.into_response()
        }
        Method::GET => match objects.get(key) {
            Some(bytes) => (StatusCode::OK, bytes.clone()).into_response(),
            None => s3_error(StatusCode::NOT_FOUND, "NoSuchKey"),
        },
        Method::HEAD => match objects.get(key) {
            Some(bytes) => (
                StatusCode::OK,
                [(header::CONTENT_LENGTH, bytes.len().to_string())],
            )
                .into_response(),
            None => StatusCode::NOT_FOUND.into_response(),
        },
        Method::DELETE => {
            objects.remove(key);
            StatusCode::NO_CONTENT.into_response()
        }
        _ => s3_error(StatusCode::METHOD_NOT_ALLOWED, "MethodNotAllowed"),
    }
}

fn s3_error(status: StatusCode, code: &str) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "application/xml")],
        format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Error><Code>{code}</Code><Message>The mock S3 store refused the request.</Message><RequestId>mock</RequestId></Error>"),
    )
        .into_response()
}

fn verify(method: &Method, uri: &Uri, headers: &HeaderMap, body: &[u8]) -> Result<(), Refusal> {
    let malformed = (StatusCode::BAD_REQUEST, "AuthorizationHeaderMalformed");
    let denied = (StatusCode::FORBIDDEN, "AccessDenied");
    let mismatch = (StatusCode::FORBIDDEN, "SignatureDoesNotMatch");
    let header = |name: &str| headers.get(name).and_then(|value| value.to_str().ok());
    let authorization = header("authorization").ok_or(denied)?;
    let fields = authorization
        .strip_prefix(sigv4::ALGORITHM)
        .and_then(|rest| rest.strip_prefix(' '))
        .ok_or(malformed)?;
    let mut credential = None;
    let mut signed_headers = None;
    let mut signature = None;
    for field in fields.split(',') {
        match field.trim().split_once('=') {
            Some(("Credential", value)) => credential = Some(value),
            Some(("SignedHeaders", value)) => signed_headers = Some(value),
            Some(("Signature", value)) => signature = Some(value),
            _ => return Err(malformed),
        }
    }
    let (Some(credential), Some(signed_headers), Some(signature)) =
        (credential, signed_headers, signature)
    else {
        return Err(malformed);
    };
    let scope: Vec<&str> = credential.split('/').collect();
    let [access_key_id, date, region, service, terminator] = scope[..] else {
        return Err(malformed);
    };
    if access_key_id != MOCK_S3_ACCESS_KEY_ID {
        return Err((StatusCode::FORBIDDEN, "InvalidAccessKeyId"));
    }
    if region != MOCK_S3_REGION || service != sigv4::SERVICE || terminator != "aws4_request" {
        return Err(malformed);
    }
    let amz_date = header("x-amz-date").ok_or(denied)?;
    if amz_date.len() != 16 || !amz_date.starts_with(date) {
        return Err(mismatch);
    }
    let now = SystemClock.now_ms();
    if amz_date < sigv4::amz_date(now - MAX_CLOCK_SKEW_MS).as_str()
        || amz_date > sigv4::amz_date(now + MAX_CLOCK_SKEW_MS).as_str()
    {
        return Err((StatusCode::FORBIDDEN, "RequestTimeTooSkewed"));
    }
    let payload_sha256 =
        header("x-amz-content-sha256").ok_or((StatusCode::BAD_REQUEST, "InvalidRequest"))?;
    if payload_sha256 != sha256_hex(body) {
        return Err((StatusCode::BAD_REQUEST, "XAmzContentSHA256Mismatch"));
    }
    let names: Vec<&str> = signed_headers.split(';').collect();
    if REQUIRED_SIGNED_HEADERS
        .iter()
        .any(|required| !names.contains(required))
    {
        return Err(denied);
    }
    let mut pairs = Vec::new();
    for name in &names {
        let mut found = false;
        for value in headers.get_all(*name) {
            pairs.push((*name, value.to_str().map_err(|_| mismatch)?));
            found = true;
        }
        if !found {
            return Err(mismatch);
        }
    }
    let expected = sigv4::sign(
        &Credentials {
            access_key_id,
            secret_access_key: MOCK_S3_SECRET_ACCESS_KEY,
        },
        region,
        service,
        amz_date,
        &Request {
            method: method.as_str(),
            path: uri.path(),
            query: uri.query().unwrap_or(""),
            headers: &pairs,
            payload_sha256,
        },
    );
    if expected.signed_headers != signed_headers || expected.signature != signature {
        return Err(mismatch);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn send(
        mock: &MockS3,
        body: &'static [u8],
        signed_payload: &[u8],
        secret_access_key: &str,
    ) -> reqwest::StatusCode {
        let url = mock.endpoint().join("lab-bucket/notes/key").expect("url");
        let host = format!("127.0.0.1:{}", url.port().expect("port"));
        let amz_date = sigv4::amz_date(SystemClock.now_ms());
        let payload_sha256 = sha256_hex(signed_payload);
        let headers = [
            ("host", host.as_str()),
            ("x-amz-content-sha256", payload_sha256.as_str()),
            ("x-amz-date", amz_date.as_str()),
        ];
        let signed = sigv4::sign(
            &Credentials {
                access_key_id: MOCK_S3_ACCESS_KEY_ID,
                secret_access_key,
            },
            MOCK_S3_REGION,
            sigv4::SERVICE,
            &amz_date,
            &Request {
                method: "PUT",
                path: url.path(),
                query: "",
                headers: &headers,
                payload_sha256: &payload_sha256,
            },
        );
        reqwest::Client::new()
            .put(url)
            .header("x-amz-content-sha256", &payload_sha256)
            .header("x-amz-date", &amz_date)
            .header("authorization", signed.authorization)
            .body(body)
            .send()
            .await
            .expect("request")
            .status()
    }

    #[tokio::test]
    async fn the_mock_checks_the_signature_and_the_payload_hash() {
        let mock = MockS3::start().await;
        assert_eq!(
            send(&mock, b"notes", b"notes", MOCK_S3_SECRET_ACCESS_KEY).await,
            reqwest::StatusCode::OK
        );
        assert_eq!(mock.object("notes/key"), Some(b"notes".to_vec()));
        assert_eq!(
            send(&mock, b"changed", b"notes", MOCK_S3_SECRET_ACCESS_KEY).await,
            reqwest::StatusCode::BAD_REQUEST
        );
        assert_eq!(
            send(&mock, b"notes", b"notes", "guessed").await,
            reqwest::StatusCode::FORBIDDEN
        );
        let unsigned = reqwest::Client::new()
            .delete(mock.endpoint().join("lab-bucket/notes/key").expect("url"))
            .send()
            .await
            .expect("request");
        assert_eq!(unsigned.status(), reqwest::StatusCode::FORBIDDEN);
        assert_eq!(mock.object("notes/key"), Some(b"notes".to_vec()));
        assert_eq!(
            mock.rejections(),
            [
                "XAmzContentSHA256Mismatch",
                "SignatureDoesNotMatch",
                "AccessDenied"
            ]
        );
    }
}
