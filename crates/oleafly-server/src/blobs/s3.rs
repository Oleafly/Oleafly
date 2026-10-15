use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Bytes;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HOST};
use reqwest::{Method, StatusCode};
use ring::rand::{SecureRandom, SystemRandom};
use url::Url;

use oleafly_collab_protocol::ids::SharedProjectId;

use crate::blobs::sigv4::{self, Credentials, Request};
use crate::blobs::{snapshot_key, BlobReader, Source};
use crate::clock::Clock;
use crate::config::S3Config;
use crate::error::ServerError;

const ERROR_BODY_LIMIT: usize = 4096;
const NO_SUCH_BUCKET: &str = "NoSuchBucket";

enum Attempt<T> {
    Done(T),
    Again(ServerError),
    Stop(ServerError),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct S3Timeouts {
    pub connect: Duration,
    pub first_byte: Duration,
    pub base: Duration,
    pub min_bytes_per_second: u64,
    pub attempts: u32,
    pub retry_pause: Duration,
}

impl Default for S3Timeouts {
    fn default() -> S3Timeouts {
        S3Timeouts {
            connect: Duration::from_secs(10),
            first_byte: Duration::from_secs(10),
            base: Duration::from_secs(30),
            min_bytes_per_second: 256 * 1024,
            attempts: 3,
            retry_pause: Duration::from_millis(200),
        }
    }
}

impl S3Timeouts {
    pub fn for_bytes(&self, bytes: u64) -> Duration {
        self.base.saturating_add(Duration::from_secs(
            bytes / self.min_bytes_per_second.max(1),
        ))
    }
}

#[derive(Clone)]
pub struct S3Blobs {
    inner: Arc<Inner>,
    max_snapshot_bytes: u64,
}

struct Inner {
    locks: Arc<[tokio::sync::Mutex<()>]>,
    client: reqwest::Client,
    clock: Arc<dyn Clock>,
    timeouts: S3Timeouts,
    origin: Url,
    host: String,
    bucket: String,
    bucket_path: String,
    key_prefix: String,
    // One probe key for the life of the process, so a key that may not
    // delete leaves one probe object behind rather than one per probe.
    probe_key: String,
    region: String,
    access_key_id: String,
    secret_access_key: String,
    max_blob_bytes: u64,
}

impl S3Blobs {
    pub fn new(
        config: &S3Config,
        max_blob_bytes: u64,
        clock: Arc<dyn Clock>,
        timeouts: S3Timeouts,
    ) -> Result<S3Blobs, ServerError> {
        let path_style = config.endpoint.is_some() || !virtual_host_safe(&config.bucket);
        let origin = match &config.endpoint {
            Some(endpoint) => endpoint.clone(),
            None if path_style => aws_origin(&format!("s3.{}.amazonaws.com", config.region))?,
            None => aws_origin(&format!(
                "{}.s3.{}.amazonaws.com",
                config.bucket, config.region
            ))?,
        };
        let host = match (origin.host_str(), origin.port()) {
            (Some(host), Some(port)) => format!("{host}:{port}"),
            (Some(host), None) => host.to_string(),
            (None, _) => {
                return Err(ServerError::Internal(format!(
                    "the S3 address {origin} has no host"
                )))
            }
        };
        let bucket_path = if path_style {
            format!("/{}", sigv4::uri_encode(&config.bucket, false))
        } else {
            String::new()
        };
        let key_prefix = if config.prefix.is_empty() {
            String::new()
        } else {
            format!("{}/", config.prefix)
        };
        let client = reqwest::Client::builder()
            .user_agent(concat!("oleafly-server/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(timeouts.connect)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| {
                ServerError::Internal(format!("could not build the S3 client: {error}"))
            })?;
        Ok(S3Blobs {
            max_snapshot_bytes: max_blob_bytes,
            inner: Arc::new(Inner {
                locks: crate::blobs::lock_stripes(),
                client,
                clock,
                timeouts,
                origin,
                host,
                bucket: config.bucket.clone(),
                bucket_path,
                probe_key: format!(
                    "{key_prefix}.oleafly-ready-{}",
                    crate::tokens::random_token()
                ),
                key_prefix,
                region: config.region.clone(),
                access_key_id: config.access_key_id.clone(),
                secret_access_key: config.secret_access_key.clone(),
                max_blob_bytes,
            }),
        })
    }

    pub(crate) fn locks(&self) -> &Arc<[tokio::sync::Mutex<()>]> {
        &self.inner.locks
    }

    pub fn with_snapshot_limit(mut self, bytes: u64) -> S3Blobs {
        self.max_snapshot_bytes = bytes;
        self
    }

    pub fn snapshot_read_timeout(&self) -> Duration {
        self.inner.timeouts.for_bytes(self.max_snapshot_bytes)
    }

    pub fn key(&self, hash: &str) -> String {
        format!("{}{}/{hash}", self.inner.key_prefix, &hash[..2])
    }

    pub fn snapshot_object_key(&self, project: SharedProjectId, hash: &str) -> String {
        format!("{}{}", self.inner.key_prefix, snapshot_key(project, hash))
    }

    pub fn object_url(&self, hash: &str) -> Url {
        self.url_of(&self.key(hash))
    }

    fn url_of(&self, key: &str) -> Url {
        let mut url = self.inner.origin.clone();
        url.set_path(&format!(
            "{}/{}",
            self.inner.bucket_path,
            sigv4::uri_encode(key, true)
        ));
        url
    }

    pub async fn put(&self, hash: &str, bytes: Bytes) -> Result<(), ServerError> {
        self.put_object(&self.key(hash), hash, bytes).await
    }

    pub async fn get(&self, hash: &str) -> Result<Option<Bytes>, ServerError> {
        self.get_object(&self.key(hash), self.inner.max_blob_bytes)
            .await
    }

    pub async fn remove(&self, hash: &str) -> Result<(), ServerError> {
        self.remove_object(&self.key(hash)).await
    }

    pub async fn open(&self, hash: &str) -> Result<Option<BlobReader>, ServerError> {
        self.open_object(&self.key(hash), hash).await
    }

    pub async fn open_snapshot(
        &self,
        project: SharedProjectId,
        hash: &str,
    ) -> Result<Option<BlobReader>, ServerError> {
        self.open_object(&self.snapshot_object_key(project, hash), hash)
            .await
    }

    pub async fn put_snapshot(
        &self,
        project: SharedProjectId,
        hash: &str,
        bytes: Bytes,
    ) -> Result<(), ServerError> {
        self.put_object(&self.snapshot_object_key(project, hash), hash, bytes)
            .await
    }

    pub async fn get_snapshot(
        &self,
        project: SharedProjectId,
        hash: &str,
    ) -> Result<Option<Bytes>, ServerError> {
        self.get_object(
            &self.snapshot_object_key(project, hash),
            self.max_snapshot_bytes,
        )
        .await
    }

    pub async fn snapshot_size(
        &self,
        project: SharedProjectId,
        hash: &str,
    ) -> Result<Option<u64>, ServerError> {
        let key = self.snapshot_object_key(project, hash);
        let timeout = self.inner.timeouts.first_byte;
        self.with_retries(|| async {
            let response = match self
                .send(
                    Method::HEAD,
                    &key,
                    None,
                    sigv4::EMPTY_PAYLOAD_SHA256,
                    Some(timeout),
                )
                .await
            {
                Ok(response) => response,
                Err(error) => return Attempt::Again(error),
            };
            let status = response.status();
            if status.is_success() {
                return Attempt::Done(
                    response
                        .headers()
                        .get(reqwest::header::CONTENT_LENGTH)
                        .and_then(|value| value.to_str().ok())
                        .and_then(|value| value.parse::<u64>().ok()),
                );
            }
            if status == StatusCode::NOT_FOUND {
                return Attempt::Done(None);
            }
            self.refused(&Method::HEAD, &key, status, None)
        })
        .await
    }

    pub async fn remove_snapshot(
        &self,
        project: SharedProjectId,
        hash: &str,
    ) -> Result<(), ServerError> {
        self.remove_object(&self.snapshot_object_key(project, hash))
            .await
    }

    // Writes, reads back and removes a small object, so a wrong key, a key
    // without the rights it needs or an unreachable bucket shows up before
    // anyone's work depends on it.
    pub async fn probe(&self) -> Result<(), ServerError> {
        let body = Bytes::from_static(b"ready");
        let hash = crate::blobs::sha256_hex(&body);
        let key = self.inner.probe_key.clone();
        self.put_object(&key, &hash, body).await?;
        let read = self.get_object(&key, 64).await;
        let removed = self.remove_object(&key).await;
        read?.ok_or_else(|| {
            ServerError::Internal(format!(
                "the S3 blob store accepted {} but did not return it",
                self.location(&key)
            ))
        })?;
        removed
    }

    async fn put_object(&self, key: &str, hash: &str, bytes: Bytes) -> Result<(), ServerError> {
        let timeout = self.inner.timeouts.for_bytes(bytes.len() as u64);
        self.with_retries(|| async {
            let response = match self
                .send(Method::PUT, key, Some(bytes.clone()), hash, Some(timeout))
                .await
            {
                Ok(response) => response,
                Err(error) => return Attempt::Again(error),
            };
            let status = response.status();
            if status.is_success() {
                return Attempt::Done(());
            }
            let code = error_code(response).await;
            self.refused(&Method::PUT, key, status, code.as_deref())
        })
        .await
    }

    async fn get_object(&self, key: &str, largest: u64) -> Result<Option<Bytes>, ServerError> {
        let first_byte = self.inner.timeouts.first_byte;
        self.with_retries(|| async {
            let sent = tokio::time::timeout(
                first_byte,
                self.send(Method::GET, key, None, sigv4::EMPTY_PAYLOAD_SHA256, None),
            )
            .await;
            let response = match sent {
                Ok(Ok(response)) => response,
                Ok(Err(error)) => return Attempt::Again(error),
                Err(_) => return Attempt::Again(self.timed_out(&Method::GET, key, first_byte)),
            };
            let status = response.status();
            if status.is_success() {
                let size = response.content_length().unwrap_or(largest);
                let reading = self.inner.timeouts.for_bytes(size);
                return match tokio::time::timeout(reading, response.bytes()).await {
                    Ok(Ok(bytes)) => Attempt::Done(Some(bytes)),
                    Ok(Err(error)) => {
                        Attempt::Again(self.transport_error(&Method::GET, key, &error, reading))
                    }
                    Err(_) => Attempt::Again(self.timed_out(&Method::GET, key, reading)),
                };
            }
            let code = error_code(response).await;
            if status == StatusCode::NOT_FOUND && code.as_deref() != Some(NO_SUCH_BUCKET) {
                return Attempt::Done(None);
            }
            self.refused(&Method::GET, key, status, code.as_deref())
        })
        .await
    }

    // Starts reading an object, which is then read in pieces as it is sent.
    // Only starting is retried, since a piece already sent can't be taken
    // back.
    async fn open_object(&self, key: &str, hash: &str) -> Result<Option<BlobReader>, ServerError> {
        let first_byte = self.inner.timeouts.first_byte;
        self.with_retries(|| async {
            let sent = tokio::time::timeout(
                first_byte,
                self.send(Method::GET, key, None, sigv4::EMPTY_PAYLOAD_SHA256, None),
            )
            .await;
            let response = match sent {
                Ok(Ok(response)) => response,
                Ok(Err(error)) => return Attempt::Again(error),
                Err(_) => return Attempt::Again(self.timed_out(&Method::GET, key, first_byte)),
            };
            let status = response.status();
            if status.is_success() {
                let Some(size) = response.content_length() else {
                    return Attempt::Stop(ServerError::Internal(format!(
                        "the S3 blob store sent {} without its length",
                        self.location(key)
                    )));
                };
                let mut reader = BlobReader::new(Source::S3(response), size, Some(hash));
                reader.within = Some(self.inner.timeouts.for_bytes(size));
                return Attempt::Done(Some(reader));
            }
            let code = error_code(response).await;
            if status == StatusCode::NOT_FOUND && code.as_deref() != Some(NO_SUCH_BUCKET) {
                return Attempt::Done(None);
            }
            self.refused(&Method::GET, key, status, code.as_deref())
        })
        .await
    }

    async fn remove_object(&self, key: &str) -> Result<(), ServerError> {
        let timeout = self.inner.timeouts.first_byte;
        self.with_retries(|| async {
            let response = match self
                .send(
                    Method::DELETE,
                    key,
                    None,
                    sigv4::EMPTY_PAYLOAD_SHA256,
                    Some(timeout),
                )
                .await
            {
                Ok(response) => response,
                Err(error) => return Attempt::Again(error),
            };
            let status = response.status();
            if status.is_success() {
                return Attempt::Done(());
            }
            let code = error_code(response).await;
            if status == StatusCode::NOT_FOUND && code.as_deref() != Some(NO_SUCH_BUCKET) {
                return Attempt::Done(());
            }
            self.refused(&Method::DELETE, key, status, code.as_deref())
        })
        .await
    }

    async fn with_retries<T, F, Fut>(&self, mut attempt: F) -> Result<T, ServerError>
    where
        F: FnMut() -> Fut,
        Fut: Future<Output = Attempt<T>>,
    {
        let attempts = self.inner.timeouts.attempts.max(1);
        let mut tried = 0;
        loop {
            tried += 1;
            match attempt().await {
                Attempt::Done(value) => return Ok(value),
                Attempt::Stop(error) => return Err(error),
                Attempt::Again(error) if tried >= attempts => return Err(error),
                Attempt::Again(_) => tokio::time::sleep(self.pause_before(tried)).await,
            }
        }
    }

    fn pause_before(&self, tried: u32) -> Duration {
        let ceiling = self
            .inner
            .timeouts
            .retry_pause
            .saturating_mul(1 << tried.saturating_sub(1).min(6));
        let mut random = [0u8; 8];
        if SystemRandom::new().fill(&mut random).is_err() {
            return ceiling;
        }
        let share = u64::from_le_bytes(random) % 1_000;
        ceiling.mul_f64(share as f64 / 1_000.0)
    }

    fn refused<T>(
        &self,
        method: &Method,
        key: &str,
        status: StatusCode,
        code: Option<&str>,
    ) -> Attempt<T> {
        let error = self.failure(method, key, status, code);
        if status.is_server_error()
            || status == StatusCode::TOO_MANY_REQUESTS
            || status == StatusCode::REQUEST_TIMEOUT
        {
            Attempt::Again(error)
        } else {
            Attempt::Stop(error)
        }
    }

    fn timed_out(&self, method: &Method, key: &str, timeout: Duration) -> ServerError {
        ServerError::Internal(format!(
            "the S3 blob store did not answer {method} {} within {:.1} s",
            self.location(key),
            timeout.as_secs_f64()
        ))
    }

    fn location(&self, key: &str) -> String {
        format!("s3://{}/{key}", self.inner.bucket)
    }

    async fn send(
        &self,
        method: Method,
        key: &str,
        body: Option<Bytes>,
        payload_sha256: &str,
        timeout: Option<Duration>,
    ) -> Result<reqwest::Response, ServerError> {
        let url = self.url_of(key);
        let amz_date = sigv4::amz_date(self.inner.clock.now_ms());
        let headers = [
            ("host", self.inner.host.as_str()),
            ("x-amz-content-sha256", payload_sha256),
            ("x-amz-date", amz_date.as_str()),
        ];
        let signed = sigv4::sign(
            &Credentials {
                access_key_id: &self.inner.access_key_id,
                secret_access_key: &self.inner.secret_access_key,
            },
            &self.inner.region,
            sigv4::SERVICE,
            &amz_date,
            &Request {
                method: method.as_str(),
                path: url.path(),
                query: "",
                headers: &headers,
                payload_sha256,
            },
        );
        let mut request = self
            .inner
            .client
            .request(method.clone(), url)
            .header(HOST, &self.inner.host)
            .header("x-amz-content-sha256", payload_sha256)
            .header("x-amz-date", &amz_date)
            .header(AUTHORIZATION, signed.authorization);
        if let Some(body) = body {
            request = request
                .header(CONTENT_TYPE, "application/octet-stream")
                .body(body);
        }
        if let Some(timeout) = timeout {
            request = request.timeout(timeout);
        }
        request.send().await.map_err(|error| {
            self.transport_error(
                &method,
                key,
                &error,
                timeout.unwrap_or(self.inner.timeouts.first_byte),
            )
        })
    }

    fn failure(
        &self,
        method: &Method,
        key: &str,
        status: StatusCode,
        code: Option<&str>,
    ) -> ServerError {
        let code = code.map(|code| format!(" ({code})")).unwrap_or_default();
        ServerError::Internal(format!(
            "the S3 blob store answered {status}{code} to {method} {}",
            self.location(key)
        ))
    }

    fn transport_error(
        &self,
        method: &Method,
        key: &str,
        error: &reqwest::Error,
        timeout: Duration,
    ) -> ServerError {
        let location = self.location(key);
        ServerError::Internal(if error.is_timeout() {
            format!(
                "the S3 blob store did not answer {method} {location} within {:.1} s",
                timeout.as_secs_f64()
            )
        } else if error.is_connect() {
            format!(
                "could not reach the S3 blob store at {} for {method} {location}: {error}",
                self.inner.origin
            )
        } else {
            format!("the S3 blob store request {method} {location} failed: {error}")
        })
    }
}

fn virtual_host_safe(bucket: &str) -> bool {
    bucket.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    })
}

fn aws_origin(host: &str) -> Result<Url, ServerError> {
    Url::parse(&format!("https://{host}/")).map_err(|error| {
        ServerError::Internal(format!("{host} is not a usable S3 address: {error}"))
    })
}

async fn error_code(mut response: reqwest::Response) -> Option<String> {
    let mut body = Vec::new();
    while body.len() < ERROR_BODY_LIMIT {
        match response.chunk().await {
            Ok(Some(chunk)) => body.extend_from_slice(&chunk),
            _ => break,
        }
    }
    let text = String::from_utf8_lossy(&body);
    let start = text.find("<Code>")? + "<Code>".len();
    let end = start + text[start..].find("</Code>")?;
    let code = text[start..end].trim();
    (!code.is_empty()
        && code.len() <= 64
        && code
            .chars()
            .all(|character| character.is_ascii_alphanumeric()))
    .then(|| code.to_string())
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::task::JoinHandle;

    use super::*;
    use crate::blobs::{sha256_hex, BlobStore};
    use crate::clock::{ManualClock, SystemClock};
    use crate::test_support::{MockS3, MockS3Fault};

    fn aws(bucket: &str, prefix: &str, region: &str) -> S3Config {
        S3Config {
            bucket: bucket.to_string(),
            prefix: prefix.to_string(),
            endpoint: None,
            region: region.to_string(),
            access_key_id: "AKIDEXAMPLE".to_string(),
            secret_access_key: "secret".to_string(),
        }
    }

    fn blobs(config: &S3Config) -> S3Blobs {
        S3Blobs::new(
            config,
            1 << 20,
            Arc::new(SystemClock),
            S3Timeouts::default(),
        )
        .expect("the S3 store builds")
    }

    fn internal<T: std::fmt::Debug>(result: Result<T, ServerError>) -> String {
        match result {
            Err(ServerError::Internal(detail)) => detail,
            other => panic!("expected a server error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn objects_are_addressed_by_folder_and_the_first_two_hash_digits() {
        let hash = sha256_hex(b"figure bytes");
        let shard = &hash[..2];
        let hosted = blobs(&aws("lab-bucket", "oleafly", "eu-west-1"));
        assert_eq!(hosted.key(&hash), format!("oleafly/{shard}/{hash}"));
        assert_eq!(
            hosted.object_url(&hash).as_str(),
            format!("https://lab-bucket.s3.eu-west-1.amazonaws.com/oleafly/{shard}/{hash}")
        );
        let dotted = blobs(&aws("lab.bucket", "", "us-east-1"));
        assert_eq!(dotted.key(&hash), format!("{shard}/{hash}"));
        assert_eq!(
            dotted.object_url(&hash).as_str(),
            format!("https://s3.us-east-1.amazonaws.com/lab.bucket/{shard}/{hash}")
        );
        let mut minio = aws("lab-bucket", "thesis/files", "us-east-1");
        minio.endpoint = Some(Url::parse("http://minio:9000").expect("endpoint"));
        assert_eq!(
            blobs(&minio).object_url(&hash).as_str(),
            format!("http://minio:9000/lab-bucket/thesis/files/{shard}/{hash}")
        );
    }

    #[test]
    fn snapshot_reads_wait_long_enough_for_a_whole_project() {
        let timeouts = S3Timeouts::default();
        let store = blobs(&aws("lab-bucket", "oleafly", "eu-west-1"));
        assert_eq!(store.snapshot_read_timeout(), timeouts.for_bytes(1 << 20));
        let store = store.with_snapshot_limit(200 << 20);
        assert_eq!(store.snapshot_read_timeout(), timeouts.for_bytes(200 << 20));
        let mut config = crate::test_support::test_config();
        config.limits.max_project_mb = 300;
        config.blob_store =
            crate::config::BlobStoreConfig::S3(Box::new(aws("lab-bucket", "oleafly", "eu-west-1")));
        match BlobStore::from_config(&config) {
            Ok(BlobStore::S3(configured)) => assert_eq!(
                configured.snapshot_read_timeout(),
                timeouts.for_bytes(300 << 20)
            ),
            _ => panic!("expected an S3 store"),
        }
    }

    #[tokio::test]
    async fn uploads_land_under_the_folder_in_the_bucket() {
        let mock = MockS3::start().await;
        let hash = sha256_hex(b"figure bytes");
        let shard = &hash[..2];
        for prefix in ["thesis/files", ""] {
            mock.store(prefix)
                .put(&hash, Bytes::from_static(b"figure bytes"))
                .await
                .expect("put");
        }
        assert_eq!(
            mock.keys(),
            vec![
                format!("{shard}/{hash}"),
                format!("thesis/files/{shard}/{hash}")
            ]
        );
        assert_eq!(
            mock.object(&format!("thesis/files/{shard}/{hash}")),
            Some(b"figure bytes".to_vec())
        );
        assert_eq!(mock.rejections(), Vec::<String>::new());
    }

    #[tokio::test]
    async fn wrong_keys_are_refused_and_reported_as_a_server_error() {
        let mock = MockS3::start().await;
        let hash = sha256_hex(b"figure bytes");
        let mut wrong_secret = mock.config("oleafly");
        wrong_secret.secret_access_key = "not-the-secret".to_string();
        let store = BlobStore::s3(
            &wrong_secret,
            1 << 20,
            Arc::new(SystemClock),
            S3Timeouts::default(),
        )
        .expect("store");
        let detail = internal(store.put(&hash, Bytes::from_static(b"figure bytes")).await);
        for expected in [
            "403",
            "SignatureDoesNotMatch",
            "PUT",
            &format!("s3://lab-bucket/oleafly/{}/{hash}", &hash[..2]),
        ] {
            assert!(
                detail.contains(expected),
                "{expected} missing from {detail}"
            );
        }
        assert!(!detail.contains("not-the-secret"));
        assert!(mock.keys().is_empty());
        let mut unknown = mock.config("oleafly");
        unknown.access_key_id = "AKIDUNKNOWN".to_string();
        let store = BlobStore::s3(
            &unknown,
            1 << 20,
            Arc::new(SystemClock),
            S3Timeouts::default(),
        )
        .expect("store");
        let detail = internal(store.get(&hash).await);
        assert!(detail.contains("InvalidAccessKeyId"), "{detail}");
        assert_eq!(
            mock.rejections(),
            vec![
                "SignatureDoesNotMatch".to_string(),
                "InvalidAccessKeyId".to_string()
            ]
        );
    }

    #[tokio::test]
    async fn a_clock_far_from_the_store_is_refused() {
        let mock = MockS3::start().await;
        let behind = ManualClock::new(SystemClock.now_ms() - 60 * 60 * 1000);
        let store = BlobStore::s3(
            &mock.config("oleafly"),
            1 << 20,
            behind,
            S3Timeouts::default(),
        )
        .expect("store");
        let detail = internal(
            store
                .put(
                    &sha256_hex(b"figure bytes"),
                    Bytes::from_static(b"figure bytes"),
                )
                .await,
        );
        assert!(detail.contains("RequestTimeTooSkewed"), "{detail}");
    }

    #[tokio::test]
    async fn refusals_and_outages_are_server_errors_that_leave_stored_files_alone() {
        let mock = MockS3::start().await;
        let store = mock.store("oleafly");
        let hash = sha256_hex(b"figure bytes");
        store
            .put(&hash, Bytes::from_static(b"figure bytes"))
            .await
            .expect("put");
        for (fault, status, code) in [
            (MockS3Fault::AccessDenied, "403", "AccessDenied"),
            (MockS3Fault::Unavailable, "503", "SlowDown"),
        ] {
            mock.set_fault(Some(fault));
            let other = sha256_hex(b"other bytes");
            for (operation, detail) in [
                (
                    "PUT",
                    internal(store.put(&other, Bytes::from_static(b"other bytes")).await),
                ),
                ("GET", internal(store.get(&hash).await)),
                ("DELETE", internal(store.remove(&hash).await)),
            ] {
                for expected in [status, code, operation] {
                    assert!(
                        detail.contains(expected),
                        "{expected} missing from {detail}"
                    );
                }
            }
        }
        mock.set_fault(None);
        assert_eq!(
            store.get(&hash).await.expect("get"),
            Some(Bytes::from_static(b"figure bytes"))
        );
        assert_eq!(mock.keys().len(), 1);
    }

    #[tokio::test]
    async fn a_missing_object_reads_as_absent_but_a_missing_bucket_is_an_error() {
        let mock = MockS3::start().await;
        let hash = sha256_hex(b"figure bytes");
        let store = mock.store("oleafly");
        assert_eq!(store.get(&hash).await.expect("get"), None);
        store.remove(&hash).await.expect("remove");
        let mut elsewhere = mock.config("oleafly");
        elsewhere.bucket = "other-bucket".to_string();
        let store = BlobStore::s3(
            &elsewhere,
            1 << 20,
            Arc::new(SystemClock),
            S3Timeouts::default(),
        )
        .expect("store");
        for detail in [
            internal(store.put(&hash, Bytes::from_static(b"figure bytes")).await),
            internal(store.get(&hash).await),
            internal(store.remove(&hash).await),
        ] {
            assert!(detail.contains("404"), "{detail}");
            assert!(detail.contains("NoSuchBucket"), "{detail}");
        }
    }

    #[tokio::test]
    async fn a_store_that_stalls_times_out_as_a_server_error() {
        let mock = MockS3::start().await;
        mock.set_fault(Some(MockS3Fault::Stall(Duration::from_secs(20))));
        let timeouts = S3Timeouts {
            connect: Duration::from_secs(2),
            first_byte: Duration::from_millis(300),
            base: Duration::from_millis(300),
            min_bytes_per_second: u64::MAX,
            ..S3Timeouts::default()
        };
        let store = BlobStore::s3(
            &mock.config("oleafly"),
            1 << 20,
            Arc::new(SystemClock),
            timeouts,
        )
        .expect("store");
        let hash = sha256_hex(b"figure bytes");
        let started = Instant::now();
        for detail in [
            internal(store.put(&hash, Bytes::from_static(b"figure bytes")).await),
            internal(store.get(&hash).await),
            internal(store.remove(&hash).await),
        ] {
            assert!(detail.contains("did not answer"), "{detail}");
        }
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(mock.keys().is_empty());
    }

    #[tokio::test]
    async fn an_unreachable_store_is_a_server_error() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("address");
        drop(listener);
        let mut config = aws("lab-bucket", "oleafly", "us-east-1");
        config.endpoint = Some(Url::parse(&format!("http://{address}")).expect("endpoint"));
        let store = BlobStore::s3(
            &config,
            1 << 20,
            Arc::new(SystemClock),
            S3Timeouts::default(),
        )
        .expect("store");
        let detail = internal(store.get(&sha256_hex(b"figure bytes")).await);
        assert!(detail.contains("could not reach"), "{detail}");
    }

    async fn raw_store(answer: &'static [u8], timeouts: S3Timeouts) -> (BlobStore, JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let address = listener.local_addr().expect("address");
        let task = tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let mut request = [0u8; 8192];
                    let _ = socket.read(&mut request).await;
                    let _ = socket.write_all(answer).await;
                    tokio::time::sleep(Duration::from_secs(120)).await;
                    drop(socket);
                });
            }
        });
        let mut config = aws("lab-bucket", "oleafly", "us-east-1");
        config.endpoint = Some(Url::parse(&format!("http://{address}")).expect("endpoint"));
        let store = BlobStore::s3(&config, 1 << 30, Arc::new(SystemClock), timeouts)
            .expect("store")
            .with_snapshot_limit(1 << 30);
        (store, task)
    }

    #[tokio::test]
    async fn a_read_that_never_starts_gives_up_after_the_first_byte_timeout() {
        let timeouts = S3Timeouts {
            first_byte: Duration::from_millis(300),
            base: Duration::from_secs(30),
            min_bytes_per_second: 1,
            retry_pause: Duration::from_millis(10),
            ..S3Timeouts::default()
        };
        let (store, task) = raw_store(b"", timeouts).await;
        let project = SharedProjectId::new_v7();
        let started = Instant::now();
        let read = tokio::time::timeout(
            Duration::from_secs(10),
            store.get_snapshot(project, &sha256_hex(b"state")),
        )
        .await;
        task.abort();
        let detail = internal(read.expect("the read gave up within 10 s"));
        assert!(detail.contains("did not answer"), "{detail}");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[tokio::test]
    async fn a_read_whose_body_stalls_gives_up_after_the_time_its_size_needs() {
        let timeouts = S3Timeouts {
            first_byte: Duration::from_secs(2),
            base: Duration::from_millis(300),
            min_bytes_per_second: 1024 * 1024,
            retry_pause: Duration::from_millis(10),
            ..S3Timeouts::default()
        };
        let (store, task) = raw_store(
            b"HTTP/1.1 200 OK\r\nContent-Length: 13\r\n\r\nproj",
            timeouts,
        )
        .await;
        let project = SharedProjectId::new_v7();
        let started = Instant::now();
        let read = tokio::time::timeout(
            Duration::from_secs(10),
            store.get_snapshot(project, &sha256_hex(b"project state")),
        )
        .await;
        task.abort();
        assert!(
            matches!(read, Ok(Err(ServerError::Internal(_)))),
            "the stalled read was still waiting after 10 s"
        );
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[tokio::test]
    async fn a_store_that_fails_for_a_moment_is_asked_again_but_a_refusal_is_not() {
        let mock = MockS3::start().await;
        let store = mock.store("oleafly");
        let hash = sha256_hex(b"figure bytes");
        let project = SharedProjectId::new_v7();
        mock.set_fault(Some(MockS3Fault::FailNext(2)));
        store
            .put(&hash, Bytes::from_static(b"figure bytes"))
            .await
            .expect("a put after two refusals");
        mock.set_fault(Some(MockS3Fault::FailNext(2)));
        assert_eq!(
            store.get(&hash).await.expect("a get after two refusals"),
            Some(Bytes::from_static(b"figure bytes"))
        );
        mock.set_fault(Some(MockS3Fault::FailNext(2)));
        let snapshot = store
            .put_snapshot(project, Bytes::from_static(b"state"))
            .await
            .expect("a snapshot put after two refusals");
        mock.set_fault(Some(MockS3Fault::FailNext(2)));
        assert_eq!(
            store
                .snapshot_size(project, &snapshot)
                .await
                .expect("a size after two refusals"),
            Some(5)
        );
        mock.set_fault(Some(MockS3Fault::FailNext(2)));
        store
            .remove(&hash)
            .await
            .expect("a remove after two refusals");
        assert_eq!(mock.object(&format!("oleafly/{}/{hash}", &hash[..2])), None);

        let before = mock.requests();
        mock.set_fault(Some(MockS3Fault::AccessDenied));
        internal(store.get(&hash).await);
        assert_eq!(mock.requests() - before, 1, "a refusal is not asked again");
        let before = mock.requests();
        mock.set_fault(Some(MockS3Fault::FailNext(10)));
        let detail = internal(store.get_snapshot(project, &snapshot).await);
        assert!(detail.contains("503"), "{detail}");
        assert_eq!(
            mock.requests() - before,
            3,
            "an outage is asked three times"
        );
        mock.set_fault(None);
    }

    #[tokio::test]
    async fn an_object_that_does_not_match_its_hash_is_an_error() {
        let mock = MockS3::start().await;
        let hash = sha256_hex(b"original bytes");
        mock.insert_object(&format!("oleafly/{}/{hash}", &hash[..2]), b"tampered");
        let detail = internal(mock.store("oleafly").get(&hash).await);
        assert!(detail.contains("does not match"), "{detail}");
    }
}
