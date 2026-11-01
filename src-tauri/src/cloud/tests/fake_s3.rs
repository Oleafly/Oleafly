//! A small S3-compatible service for the S3 store's tests: signatures checked
//! against one key pair, conditional writes, user metadata, listings split
//! into pages, multipart uploads, slow replies, and failures on demand.
//! Path-style addressing only, as MinIO and most self-hosted servers use.

use crate::cloud::s3::{S3Config, S3Keys, S3Store};
use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use futures_util::StreamExt;
use oleafly_s3::sigv4::{self, Credentials, Request};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;
use tokio::sync::Notify;

pub(crate) const BUCKET: &str = "sync";
pub(crate) const KEY_ID: &str = "AKIAFAKEFAKEFAKE";
pub(crate) const SECRET: &str = "fake/secret+key";

pub(crate) struct Canned {
    pub(crate) status: u16,
    pub(crate) code: &'static str,
    pub(crate) retry_after: Option<u64>,
    pub(crate) date: Option<&'static str>,
}

impl Canned {
    pub(crate) fn new(status: u16, code: &'static str) -> Self {
        Self {
            status,
            code,
            retry_after: None,
            date: None,
        }
    }

    pub(crate) fn retry_now(status: u16, code: &'static str) -> Self {
        Self {
            status,
            code,
            retry_after: Some(0),
            date: None,
        }
    }

    pub(crate) fn dated(status: u16, code: &'static str, date: &'static str) -> Self {
        Self {
            date: Some(date),
            ..Self::new(status, code)
        }
    }
}

type Part = (Vec<u8>, String);

type Marks = Vec<(String, String)>;

pub(crate) struct Hold {
    pub(crate) prefix: String,
    pub(crate) arrived: Arc<Notify>,
    pub(crate) release: Arc<Notify>,
}

#[derive(Default)]
pub(crate) struct Bucket {
    pub(crate) objects: BTreeMap<String, (Vec<u8>, String)>,
    pub(crate) marks: BTreeMap<String, Marks>,
    pub(crate) uploads: BTreeMap<String, (String, BTreeMap<u32, Part>, Marks)>,
    next: u64,
    /// Most entries one listing page holds; zero means S3's 1,000.
    pub(crate) page_size: usize,
    pub(crate) ignore_conditions: bool,
    pub(crate) ignore_if_match: bool,
    pub(crate) refuse_conditions: bool,
    pub(crate) missing: bool,
    pub(crate) refuse_part: Option<u32>,
    pub(crate) fail_completion: bool,
    pub(crate) refuse_conditional_completion: bool,
    pub(crate) trickle: Option<(usize, Duration)>,
    pub(crate) slow_writes: Option<Duration>,
    pub(crate) hold: Option<Hold>,
    pub(crate) canned: VecDeque<Canned>,
    pub(crate) refused_prefix: Option<String>,
    pub(crate) modified: BTreeMap<String, u64>,
    pub(crate) requests: Vec<String>,
}

impl Bucket {
    fn etag(&mut self) -> String {
        self.next += 1;
        format!("\"{:032x}\"", self.next)
    }

    pub(crate) fn read(&self, key: &str) -> Option<Vec<u8>> {
        self.objects.get(key).map(|(bytes, _)| bytes.clone())
    }

    pub(crate) fn put(&mut self, key: &str, bytes: &[u8]) -> String {
        let etag = self.etag();
        self.objects
            .insert(key.to_string(), (bytes.to_vec(), etag.clone()));
        self.marks.remove(key);
        self.modified
            .insert(key.to_string(), crate::cloud::engine::now_ms());
        etag
    }

    fn modified_at(&self, key: &str) -> u64 {
        self.modified.get(key).copied().unwrap_or(0)
    }

    pub(crate) fn count(&self, prefix: &str) -> usize {
        self.requests
            .iter()
            .filter(|request| request.starts_with(prefix))
            .count()
    }
}

pub(crate) struct FakeS3 {
    shared: Arc<Mutex<Bucket>>,
    pub(crate) base: String,
    task: Arc<tokio::task::JoinHandle<()>>,
}

impl Drop for FakeS3 {
    fn drop(&mut self) {
        if Arc::strong_count(&self.task) == 1 {
            self.task.abort();
        }
    }
}

impl FakeS3 {
    pub(crate) async fn start() -> Self {
        let shared = Arc::new(Mutex::new(Bucket::default()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        // Single writes go up to 64 MiB; axum's own limit is 2 MB.
        let router = axum::Router::new()
            .fallback(handle)
            .layer(axum::extract::DefaultBodyLimit::max(80 * 1024 * 1024))
            .with_state(Arc::clone(&shared));
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        Self {
            shared,
            base,
            task: Arc::new(task),
        }
    }

    pub(crate) fn with<T>(&self, change: impl FnOnce(&mut Bucket) -> T) -> T {
        change(&mut self.lock())
    }

    fn lock(&self) -> MutexGuard<'_, Bucket> {
        self.shared.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn config(&self, prefix: &str) -> S3Config {
        S3Config {
            endpoint: self.base.clone(),
            region: String::new(),
            bucket: BUCKET.into(),
            prefix: prefix.into(),
            path_style: true,
        }
    }

    pub(crate) fn keys() -> S3Keys {
        S3Keys {
            access_key_id: KEY_ID.into(),
            secret_access_key: SECRET.into(),
        }
    }

    pub(crate) fn store(&self, prefix: &str) -> S3Store {
        S3Store::new(self.config(prefix), Self::keys()).unwrap()
    }

    pub(crate) fn store_with_secret(&self, prefix: &str, secret: &str) -> S3Store {
        let keys = S3Keys {
            access_key_id: KEY_ID.into(),
            secret_access_key: secret.into(),
        };
        S3Store::new(self.config(prefix), keys).unwrap()
    }
}

fn iso_date(ms: u64) -> String {
    let stamp = sigv4::amz_date(i64::try_from(ms).unwrap_or(0));
    format!(
        "{}-{}-{}T{}:{}:{}.000Z",
        &stamp[..4],
        &stamp[4..6],
        &stamp[6..8],
        &stamp[9..11],
        &stamp[11..13],
        &stamp[13..15]
    )
}

fn http_date(ms: u64) -> String {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let stamp = sigv4::amz_date(i64::try_from(ms).unwrap_or(0));
    let month: usize = stamp[4..6].parse().unwrap_or(1);
    format!(
        "Mon, {} {} {} {}:{}:{} GMT",
        &stamp[6..8],
        MONTHS[month - 1],
        &stamp[..4],
        &stamp[9..11],
        &stamp[11..13],
        &stamp[13..15]
    )
}

fn xml_error(status: u16, code: &str) -> Response {
    let body = if code.is_empty() {
        String::new()
    } else {
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Error><Code>{code}</Code><Message>{code} from the fake</Message></Error>"
        )
    };
    (StatusCode::from_u16(status).unwrap(), body).into_response()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let pair = text.get(index + 1..index + 3);
        match (
            bytes[index],
            pair.and_then(|hex| u8::from_str_radix(hex, 16).ok()),
        ) {
            (b'%', Some(byte)) => {
                out.push(byte);
                index += 3;
            }
            (byte, _) => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn query_map(uri: &Uri) -> BTreeMap<String, String> {
    uri.query()
        .unwrap_or_default()
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
            (percent_decode(name), percent_decode(value))
        })
        .collect()
}

fn signed_correctly(method: &Method, uri: &Uri, headers: &HeaderMap, body: &[u8]) -> bool {
    let header = |name: &str| headers.get(name).and_then(|value| value.to_str().ok());
    let (Some(authorization), Some(amz_date), Some(payload)) = (
        header("authorization"),
        header("x-amz-date"),
        header("x-amz-content-sha256"),
    ) else {
        return false;
    };
    if hex(ring::digest::digest(&ring::digest::SHA256, body).as_ref()) != payload {
        return false;
    }
    let Some(scope) = authorization
        .split("Credential=")
        .nth(1)
        .and_then(|rest| rest.split(',').next())
    else {
        return false;
    };
    let mut parts = scope.split('/');
    let (Some(KEY_ID), Some(_), Some(region)) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    let Some(names) = authorization
        .split("SignedHeaders=")
        .nth(1)
        .and_then(|rest| rest.split(',').next())
    else {
        return false;
    };
    let values: Vec<(&str, &str)> = names
        .split(';')
        .map(|name| (name, header(name).unwrap_or_default()))
        .collect();
    let expected = sigv4::sign(
        &Credentials {
            access_key_id: KEY_ID,
            secret_access_key: SECRET,
        },
        region,
        sigv4::SERVICE,
        amz_date,
        &Request {
            method: method.as_str(),
            path: uri.path(),
            query: uri.query().unwrap_or_default(),
            headers: &values,
            payload_sha256: payload,
        },
    );
    expected.authorization == authorization
}

fn key_of(uri: &Uri) -> (String, String) {
    let path = uri.path().trim_start_matches('/');
    let (name, raw_key) = path.split_once('/').unwrap_or((path, ""));
    (name.to_string(), percent_decode(raw_key))
}

async fn handle(
    State(shared): State<Arc<Mutex<Bucket>>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !signed_correctly(&method, &uri, &headers, &body) {
        return xml_error(403, "SignatureDoesNotMatch");
    }
    let (_, key) = key_of(&uri);
    let line = match uri.query() {
        Some(query) => format!("{method} {key}?{query}"),
        None => format!("{method} {key}"),
    };
    let held = {
        let mut bucket = shared.lock().unwrap_or_else(PoisonError::into_inner);
        bucket.hold.take_if(|hold| line.starts_with(&hold.prefix))
    };
    if let Some(hold) = held {
        hold.arrived.notify_one();
        hold.release.notified().await;
    }
    let (response, pause) = {
        let mut bucket = shared.lock().unwrap_or_else(PoisonError::into_inner);
        let pause = bucket.slow_writes.filter(|_| method == Method::PUT);
        (
            respond(&mut bucket, &method, &uri, &headers, &body, line),
            pause,
        )
    };
    if let Some(pause) = pause {
        tokio::time::sleep(pause).await;
    }
    response
}

fn respond(
    bucket: &mut Bucket,
    method: &Method,
    uri: &Uri,
    headers: &HeaderMap,
    body: &Bytes,
    line: String,
) -> Response {
    let (name, key) = key_of(uri);
    if name != BUCKET || bucket.missing {
        return xml_error(404, "NoSuchBucket");
    }
    let query = query_map(uri);
    bucket.requests.push(line);
    if let Some(canned) = bucket.canned.pop_front() {
        let mut response = xml_error(canned.status, canned.code);
        if let Some(after) = canned.retry_after {
            response
                .headers_mut()
                .insert("retry-after", after.to_string().parse().unwrap());
        }
        if let Some(date) = canned.date {
            response
                .headers_mut()
                .insert("date", HeaderValue::from_static(date));
        }
        return response;
    }
    let line = bucket.requests.last().cloned().unwrap_or_default();
    if bucket
        .refused_prefix
        .as_deref()
        .is_some_and(|prefix| line.starts_with(prefix))
    {
        return xml_error(400, "InvalidArgument");
    }
    match *method {
        Method::GET if key.is_empty() => list(bucket, &query),
        Method::GET => match bucket.objects.get(&key) {
            Some((bytes, etag)) => match bucket.trickle {
                Some((size, gap)) => trickled(bytes, etag, size, gap),
                None => (StatusCode::OK, [("etag", etag.clone())], bytes.clone()).into_response(),
            },
            None => xml_error(404, "NoSuchKey"),
        },
        Method::HEAD => match bucket.objects.get(&key) {
            Some((bytes, etag)) => {
                let mut response = (
                    StatusCode::OK,
                    [
                        ("etag", etag.clone()),
                        ("content-length", bytes.len().to_string()),
                        ("last-modified", http_date(bucket.modified_at(&key))),
                    ],
                )
                    .into_response();
                for (name, value) in bucket.marks.get(&key).into_iter().flatten() {
                    response.headers_mut().insert(
                        HeaderName::from_bytes(name.as_bytes()).unwrap(),
                        HeaderValue::from_str(value).unwrap(),
                    );
                }
                response
            }
            None => StatusCode::NOT_FOUND.into_response(),
        },
        Method::PUT if query.contains_key("uploadId") => {
            let number: u32 = query
                .get("partNumber")
                .and_then(|number| number.parse().ok())
                .unwrap_or(0);
            if bucket.refuse_part == Some(number) {
                return xml_error(400, "InvalidPart");
            }
            let etag = bucket.etag();
            match bucket.uploads.get_mut(&query["uploadId"]) {
                Some((_, parts, _)) => {
                    parts.insert(number, (body.to_vec(), etag.clone()));
                    (StatusCode::OK, [("etag", etag)]).into_response()
                }
                None => xml_error(404, "NoSuchUpload"),
            }
        }
        Method::PUT => {
            if let Some(refused) = refused(bucket, &key, headers) {
                return refused;
            }
            let etag = bucket.put(&key, body);
            bucket.marks.insert(key, marks_of(headers));
            (StatusCode::OK, [("etag", etag)]).into_response()
        }
        Method::POST if query.contains_key("uploads") => {
            let id = format!("upload-{}", bucket.next + 1);
            bucket.next += 1;
            bucket.uploads.insert(
                id.clone(),
                (key.clone(), BTreeMap::new(), marks_of(headers)),
            );
            format!(
                "<InitiateMultipartUploadResult><Bucket>{BUCKET}</Bucket><Key>{key}</Key><UploadId>{id}</UploadId></InitiateMultipartUploadResult>"
            )
            .into_response()
        }
        Method::POST if query.contains_key("uploadId") => {
            complete(bucket, &query["uploadId"], &key, headers, body)
        }
        Method::DELETE if query.contains_key("uploadId") => {
            bucket.uploads.remove(&query["uploadId"]);
            StatusCode::NO_CONTENT.into_response()
        }
        Method::DELETE => {
            bucket.objects.remove(&key);
            bucket.marks.remove(&key);
            bucket.modified.remove(&key);
            StatusCode::NO_CONTENT.into_response()
        }
        _ => xml_error(405, "MethodNotAllowed"),
    }
}

fn marks_of(headers: &HeaderMap) -> Marks {
    headers
        .iter()
        .filter(|(name, _)| {
            name.as_str().starts_with("x-amz-meta-") || name.as_str().starts_with("x-goog-meta-")
        })
        .filter_map(|(name, value)| Some((name.to_string(), value.to_str().ok()?.to_string())))
        .collect()
}

fn refused(bucket: &Bucket, key: &str, headers: &HeaderMap) -> Option<Response> {
    let header = |name: &str| headers.get(name).and_then(|value| value.to_str().ok());
    let (if_match, if_none_match) = (header("if-match"), header("if-none-match"));
    if bucket.refuse_conditions && (if_match.is_some() || if_none_match.is_some()) {
        return Some(xml_error(501, "NotImplemented"));
    }
    if bucket.ignore_conditions {
        return None;
    }
    let current = bucket.objects.get(key).map(|(_, etag)| etag.as_str());
    match (if_none_match, if_match) {
        (Some("*"), _) if current.is_some() => Some(xml_error(412, "PreconditionFailed")),
        // AWS answers a write against a version of a key that is gone so.
        (_, Some(_)) if current.is_none() && !bucket.ignore_if_match => {
            Some(xml_error(404, "NoSuchKey"))
        }
        (_, Some(wanted)) if current != Some(wanted) && !bucket.ignore_if_match => {
            Some(xml_error(412, "PreconditionFailed"))
        }
        _ => None,
    }
}

fn trickled(bytes: &[u8], etag: &str, size: usize, gap: Duration) -> Response {
    let pieces: Vec<Bytes> = bytes
        .chunks(size.max(1))
        .map(Bytes::copy_from_slice)
        .collect();
    let stream = futures_util::stream::iter(pieces).then(move |piece| async move {
        tokio::time::sleep(gap).await;
        Ok::<_, std::io::Error>(piece)
    });
    (
        StatusCode::OK,
        [("etag", etag.to_string())],
        Body::from_stream(stream),
    )
        .into_response()
}

fn complete(
    bucket: &mut Bucket,
    id: &str,
    key: &str,
    headers: &HeaderMap,
    body: &[u8],
) -> Response {
    if bucket.fail_completion {
        return "<Error><Code>InternalError</Code><Message>try again</Message></Error>"
            .into_response();
    }
    let conditional = headers.contains_key("if-match") || headers.contains_key("if-none-match");
    if bucket.refuse_conditional_completion && conditional {
        return xml_error(501, "NotImplemented");
    }
    if !bucket.uploads.contains_key(id) {
        return xml_error(404, "NoSuchUpload");
    }
    if let Some(refused) = refused(bucket, key, headers) {
        return refused;
    }
    let Some((upload_key, parts, marks)) = bucket.uploads.remove(id) else {
        return xml_error(404, "NoSuchUpload");
    };
    let manifest = String::from_utf8_lossy(body).into_owned();
    let Ok(document) = roxmltree::Document::parse(&manifest) else {
        return xml_error(400, "MalformedXML");
    };
    let mut bytes = Vec::new();
    for part in document
        .descendants()
        .filter(|node| node.has_tag_name("Part"))
    {
        let text = |name: &str| {
            part.children()
                .find(|child| child.has_tag_name(name))
                .and_then(|child| child.text())
                .unwrap_or_default()
                .to_string()
        };
        let number: u32 = text("PartNumber").parse().unwrap_or(0);
        match parts.get(&number) {
            Some((piece, etag)) if *etag == text("ETag") => bytes.extend_from_slice(piece),
            _ => return xml_error(400, "InvalidPart"),
        }
    }
    if upload_key != key {
        return xml_error(400, "InvalidRequest");
    }
    let etag = format!("\"{:032x}-{}\"", bucket.next + 1, parts.len());
    bucket.next += 1;
    bucket
        .objects
        .insert(key.to_string(), (bytes, etag.clone()));
    bucket.marks.insert(key.to_string(), marks);
    bucket
        .modified
        .insert(key.to_string(), crate::cloud::engine::now_ms());
    format!(
        "<CompleteMultipartUploadResult><Key>{key}</Key><ETag>{}</ETag></CompleteMultipartUploadResult>",
        etag.replace('"', "&quot;")
    )
    .into_response()
}

fn list(bucket: &Bucket, query: &BTreeMap<String, String>) -> Response {
    let prefix = query.get("prefix").cloned().unwrap_or_default();
    let limit = query
        .get("max-keys")
        .and_then(|value| value.parse().ok())
        .unwrap_or(1_000)
        .min(match bucket.page_size {
            0 => 1_000,
            size => size,
        });
    let delimited = query.contains_key("delimiter");
    let mut entries = BTreeSet::new();
    for key in bucket.objects.keys() {
        let Some(rest) = key.strip_prefix(&prefix) else {
            continue;
        };
        match rest.find('/').filter(|_| delimited) {
            Some(slash) => entries.insert((format!("{prefix}{}", &rest[..=slash]), true)),
            None => entries.insert((key.clone(), false)),
        };
    }
    let after = query.get("continuation-token").cloned().unwrap_or_default();
    let page: Vec<_> = entries
        .iter()
        .filter(|(name, _)| after.is_empty() || name.as_str() > after.as_str())
        .collect();
    let truncated = page.len() > limit;
    let mut xml = format!("<ListBucketResult><Name>{BUCKET}</Name><Prefix>{prefix}</Prefix>");
    for (name, folder) in page.iter().take(limit) {
        if *folder {
            xml.push_str(&format!(
                "<CommonPrefixes><Prefix>{name}</Prefix></CommonPrefixes>"
            ));
        } else {
            xml.push_str(&format!(
                "<Contents><Key>{name}</Key><LastModified>{}</LastModified></Contents>",
                iso_date(bucket.modified_at(name))
            ));
        }
    }
    xml.push_str(&format!("<IsTruncated>{truncated}</IsTruncated>"));
    if truncated {
        let last = &page[limit - 1].0;
        xml.push_str(&format!(
            "<NextContinuationToken>{last}</NextContinuationToken>"
        ));
    }
    xml.push_str("</ListBucketResult>");
    xml.into_response()
}
