use std::sync::Arc;
use std::time::Duration;

use axum::body::Bytes;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HOST};
use reqwest::{Method, StatusCode};
use url::Url;

use crate::blobs::sigv4::{self, Credentials, Request};
use crate::clock::Clock;
use crate::config::S3Config;
use crate::error::ServerError;

const ERROR_BODY_LIMIT: usize = 4096;
const NO_SUCH_BUCKET: &str = "NoSuchBucket";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct S3Timeouts {
    pub connect: Duration,
    pub base: Duration,
    pub min_bytes_per_second: u64,
}

impl Default for S3Timeouts {
    fn default() -> S3Timeouts {
        S3Timeouts {
            connect: Duration::from_secs(10),
            base: Duration::from_secs(30),
            min_bytes_per_second: 256 * 1024,
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
}

struct Inner {
    client: reqwest::Client,
    clock: Arc<dyn Clock>,
    timeouts: S3Timeouts,
    origin: Url,
    host: String,
    bucket: String,
    bucket_path: String,
    key_prefix: String,
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
            inner: Arc::new(Inner {
                client,
                clock,
                timeouts,
                origin,
                host,
                bucket: config.bucket.clone(),
                bucket_path,
                key_prefix,
                region: config.region.clone(),
                access_key_id: config.access_key_id.clone(),
                secret_access_key: config.secret_access_key.clone(),
                max_blob_bytes,
            }),
        })
    }

    pub fn key(&self, hash: &str) -> String {
        format!("{}{}/{hash}", self.inner.key_prefix, &hash[..2])
    }

    pub fn object_url(&self, hash: &str) -> Url {
        let mut url = self.inner.origin.clone();
        url.set_path(&format!(
            "{}/{}",
            self.inner.bucket_path,
            sigv4::uri_encode(&self.key(hash), true)
        ));
        url
    }

    pub async fn put(&self, hash: &str, bytes: Bytes) -> Result<(), ServerError> {
        let timeout = self.inner.timeouts.for_bytes(bytes.len() as u64);
        let response = self
            .send(Method::PUT, hash, Some(bytes), hash, timeout)
            .await?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let code = error_code(response).await;
        Err(self.failure(&Method::PUT, hash, status, code.as_deref()))
    }

    pub async fn get(&self, hash: &str) -> Result<Option<Bytes>, ServerError> {
        let timeout = self.inner.timeouts.for_bytes(self.inner.max_blob_bytes);
        let response = self
            .send(
                Method::GET,
                hash,
                None,
                sigv4::EMPTY_PAYLOAD_SHA256,
                timeout,
            )
            .await?;
        let status = response.status();
        if status.is_success() {
            return response
                .bytes()
                .await
                .map(Some)
                .map_err(|error| self.transport_error(&Method::GET, hash, &error, timeout));
        }
        let code = error_code(response).await;
        if status == StatusCode::NOT_FOUND && code.as_deref() != Some(NO_SUCH_BUCKET) {
            return Ok(None);
        }
        Err(self.failure(&Method::GET, hash, status, code.as_deref()))
    }

    pub async fn remove(&self, hash: &str) -> Result<(), ServerError> {
        let timeout = self.inner.timeouts.base;
        let response = self
            .send(
                Method::DELETE,
                hash,
                None,
                sigv4::EMPTY_PAYLOAD_SHA256,
                timeout,
            )
            .await?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let code = error_code(response).await;
        if status == StatusCode::NOT_FOUND && code.as_deref() != Some(NO_SUCH_BUCKET) {
            return Ok(());
        }
        Err(self.failure(&Method::DELETE, hash, status, code.as_deref()))
    }

    fn location(&self, hash: &str) -> String {
        format!("s3://{}/{}", self.inner.bucket, self.key(hash))
    }

    async fn send(
        &self,
        method: Method,
        hash: &str,
        body: Option<Bytes>,
        payload_sha256: &str,
        timeout: Duration,
    ) -> Result<reqwest::Response, ServerError> {
        let url = self.object_url(hash);
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
            .timeout(timeout)
            .header(HOST, &self.inner.host)
            .header("x-amz-content-sha256", payload_sha256)
            .header("x-amz-date", &amz_date)
            .header(AUTHORIZATION, signed.authorization);
        if let Some(body) = body {
            request = request
                .header(CONTENT_TYPE, "application/octet-stream")
                .body(body);
        }
        request
            .send()
            .await
            .map_err(|error| self.transport_error(&method, hash, &error, timeout))
    }

    fn failure(
        &self,
        method: &Method,
        hash: &str,
        status: StatusCode,
        code: Option<&str>,
    ) -> ServerError {
        let code = code.map(|code| format!(" ({code})")).unwrap_or_default();
        ServerError::Internal(format!(
            "the S3 blob store answered {status}{code} to {method} {}",
            self.location(hash)
        ))
    }

    fn transport_error(
        &self,
        method: &Method,
        hash: &str,
        error: &reqwest::Error,
        timeout: Duration,
    ) -> ServerError {
        let location = self.location(hash);
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
            base: Duration::from_millis(300),
            min_bytes_per_second: u64::MAX,
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

    #[tokio::test]
    async fn an_object_that_does_not_match_its_hash_is_an_error() {
        let mock = MockS3::start().await;
        let hash = sha256_hex(b"original bytes");
        mock.insert_object(&format!("oleafly/{}/{hash}", &hash[..2]), b"tampered");
        let detail = internal(mock.store("oleafly").get(&hash).await);
        assert!(detail.contains("does not match"), "{detail}");
    }
}
