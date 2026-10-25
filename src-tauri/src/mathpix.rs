//! Mathpix OCR with the user's own keys (Settings > AI > Tools).
//!
//! The app ID and key live in the encrypted connector map as
//! `mathpix.app_id` / `mathpix.app_key`. Only this module reads or writes
//! them; the generic connector commands refuse `mathpix.*` (see
//! `connectors.rs`). The key travels only in the `app_key` header of requests
//! to api.mathpix.com: never in a URL, a log, an error string or a reply to
//! the webview. Redirects are not followed, so the headers cannot reach
//! another host.
//!
//! Images go to `/v3/text`. PDFs are uploaded whole to `/v3/pdf` with the
//! chosen page range, polled until Mathpix finishes, read as Mathpix Markdown
//! and then deleted from Mathpix, also when the user cancels or the wait
//! times out.

use std::borrow::Cow;
use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, PoisonError};
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE, RETRY_AFTER};
use serde::Serialize;
use serde_json::{json, Value};

use crate::app_error::AppError;

pub const APP_ID_ACCOUNT: &str = "mathpix.app_id";
pub const APP_KEY_ACCOUNT: &str = "mathpix.app_key";
const API_BASE: &str = "https://api.mathpix.com";
/// Mathpix takes a base64 `src` of up to 2 MB.
const MAX_IMAGE_BASE64_CHARS: usize = 2_000_000;
const MAX_PDF_BYTES: usize = 256 * 1024 * 1024;
/// The most a PDF may be when the webview delivers it as a JSON array of
/// numbers (the `postMessage` fallback). Tauri has already turned every byte
/// into a 32-byte JSON value by then, so this keeps that near half a gigabyte.
const MAX_JSON_PDF_BYTES: usize = 16 * 1024 * 1024;
const _: () = assert!(MAX_JSON_PDF_BYTES < MAX_PDF_BYTES);
const MAX_TEXT_REPLY_BYTES: usize = 8 * 1024 * 1024;
const MAX_MMD_BYTES: usize = 32 * 1024 * 1024;
const MAX_CREDENTIAL_CHARS: usize = 256;
const MAX_REASON_CHARS: usize = 200;
const MAX_PDF_ID_CHARS: usize = 128;
const MAX_PAGE_RANGES_CHARS: usize = 256;
const MAX_REQUEST_ID_CHARS: usize = 64;
const MAX_CANCEL_ENTRIES: usize = 64;
const MAX_BOUNDARY_TRIES: usize = 8;
const PAGE_RANGES_HEADER: &str = "x-oleafly-page-ranges";
const REQUEST_ID_HEADER: &str = "x-oleafly-request-id";
const MAIN_WINDOW: &str = "main";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const TEXT_TIMEOUT: Duration = Duration::from_secs(60);
const TOKEN_TIMEOUT: Duration = Duration::from_secs(15);
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const POLL_TIMEOUT: Duration = Duration::from_secs(30);
/// How often a running wait looks at its cancel flag.
const CANCEL_CHECK: Duration = Duration::from_millis(100);

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MathpixKeyStatus {
    pub configured: bool,
    /// Not secret: Settings shows "Connected as {app ID}".
    pub app_id: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MathpixTextResult {
    pub text: String,
    /// Only when the whole image is one equation.
    pub latex_styled: Option<String>,
    pub confidence: Option<f64>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MathpixPdfProgress {
    pub status: String,
    pub pages_done: u32,
    pub pages_total: u32,
}

fn code(code: &'static str) -> String {
    AppError::new(code).into()
}

fn http_error(status: u16) -> String {
    AppError::new("mathpix.http_error")
        .param("status", status)
        .into()
}

#[derive(Clone)]
struct MathpixKeys {
    app_id: String,
    app_key: String,
}

impl std::fmt::Debug for MathpixKeys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MathpixKeys")
            .field("app_id", &self.app_id)
            .field("app_key", &"<redacted>")
            .finish()
    }
}

impl MathpixKeys {
    fn headers(&self) -> Result<HeaderMap, String> {
        let app_id =
            HeaderValue::from_str(&self.app_id).map_err(|_| code("mathpix.invalid_keys"))?;
        let mut app_key =
            HeaderValue::from_str(&self.app_key).map_err(|_| code("mathpix.invalid_keys"))?;
        app_key.set_sensitive(true);
        let mut headers = HeaderMap::new();
        headers.insert(HeaderName::from_static("app_id"), app_id);
        headers.insert(HeaderName::from_static("app_key"), app_key);
        Ok(headers)
    }

    /// `text` with both credentials replaced by an ellipsis.
    fn scrub(&self, text: &str) -> String {
        let mut scrubbed = text.to_string();
        for secret in [&self.app_key, &self.app_id] {
            if !secret.is_empty() {
                scrubbed = scrubbed.replace(secret.as_str(), "…");
            }
        }
        scrubbed
    }
}

/// Mathpix keys are printable ASCII without spaces, so nothing in them can
/// break out of an HTTP header.
fn valid_credential(value: &str) -> Result<(), String> {
    let printable = !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_graphic());
    if printable && value.len() <= MAX_CREDENTIAL_CHARS {
        Ok(())
    } else {
        Err(code("mathpix.invalid_keys"))
    }
}

/// A PDF id goes into a URL path: letters, digits, `_` and `-` only.
fn valid_pdf_id(id: &str) -> Result<(), String> {
    let safe = id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-');
    if safe && !id.is_empty() && id.len() <= MAX_PDF_ID_CHARS {
        Ok(())
    } else {
        Err(code("mathpix.invalid_response"))
    }
}

/// Mathpix page ranges such as `3-5` or `2,4-6`.
fn valid_page_ranges(ranges: &str) -> Result<(), String> {
    let page = |text: &str| {
        !text.is_empty()
            && text.len() <= 6
            && text.bytes().all(|byte| byte.is_ascii_digit())
            && text.parse::<u32>().is_ok_and(|number| number >= 1)
    };
    let valid = !ranges.is_empty()
        && ranges.len() <= MAX_PAGE_RANGES_CHARS
        && ranges.split(',').all(|part| match part.split_once('-') {
            Some((first, last)) => page(first) && page(last),
            None => page(part),
        });
    if valid {
        Ok(())
    } else {
        Err(code("mathpix.invalid_response"))
    }
}

fn valid_request_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_REQUEST_ID_CHARS
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

/// Mathpix bills the user's account, so only the main window may use it:
/// not the preview, presentation or console windows.
fn require_main_window(label: Option<&str>) -> Result<(), String> {
    if label == Some(MAIN_WINDOW) {
        Ok(())
    } else {
        Err(code("mathpix.wrong_window"))
    }
}

fn require_main(webview: &tauri::Webview) -> Result<(), String> {
    require_main_window(crate::caller::own_window_label(webview).as_deref())
}

/// Mathpix's own error text, made safe to show: no control characters, one
/// space between words, neither credential, at most 200 characters.
fn sanitize_reason(reason: &str, keys: &MathpixKeys) -> String {
    let visible: String = reason
        .chars()
        .filter_map(|character| {
            if character.is_whitespace() {
                Some(' ')
            } else if character.is_control() {
                None
            } else {
                Some(character)
            }
        })
        .collect();
    let collapsed = visible.split_whitespace().collect::<Vec<_>>().join(" ");
    let scrubbed = keys.scrub(&collapsed);
    // A key split by spaces would survive the replacement above.
    let compact: String = scrubbed
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect();
    if !keys.app_key.is_empty() && compact.contains(&keys.app_key) {
        return "…".to_string();
    }
    scrubbed.chars().take(MAX_REASON_CHARS).collect()
}

fn reply_error(reply: &Value, keys: &MathpixKeys) -> Option<String> {
    let message = reply
        .get("error")
        .and_then(Value::as_str)
        .or_else(|| reply.pointer("/error_info/message").and_then(Value::as_str))?
        .trim();
    if message.is_empty() {
        return None;
    }
    let reason = sanitize_reason(message, keys);
    Some(if reason.is_empty() {
        code("mathpix.invalid_response")
    } else {
        AppError::new("mathpix.rejected")
            .param("reason", reason)
            .into()
    })
}

fn status_error(status: reqwest::StatusCode, too_large: &'static str) -> String {
    match status.as_u16() {
        401 | 403 => code("mathpix.key_rejected"),
        413 => code(too_large),
        429 => code("mathpix.rate_limited"),
        other => http_error(other),
    }
}

async fn send(request: reqwest::RequestBuilder) -> Result<reqwest::Response, String> {
    // reqwest's error text names the URL; keep it out of the message.
    request
        .send()
        .await
        .map_err(|_| code("mathpix.unreachable"))
}

async fn read_capped(response: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(code("mathpix.invalid_response"));
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| code("mathpix.unreachable"))?;
        if body.len().saturating_add(chunk.len()) > limit {
            return Err(code("mathpix.invalid_response"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn parse_json(body: &[u8]) -> Result<Value, String> {
    serde_json::from_slice(body).map_err(|_| code("mathpix.invalid_response"))
}

fn page_count(reply: &Value, field: &str) -> u32 {
    reply
        .get(field)
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_f64().map(|number| number.max(0.0) as u64))
        })
        .map(|number| u32::try_from(number).unwrap_or(u32::MAX))
        .unwrap_or(0)
}

fn is_base64_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'=')
}

fn random_boundary() -> String {
    format!("oleafly-{:032x}", rand::random::<u128>())
}

fn occurs_in(haystack: &[u8], needle: &[u8]) -> bool {
    aho_corasick::AhoCorasick::new([needle])
        .map(|search| search.is_match(haystack))
        .unwrap_or(true)
}

/// The first candidate whose `--boundary` line does not occur in the PDF.
fn pick_boundary(pdf: &[u8], candidates: impl IntoIterator<Item = String>) -> Option<String> {
    candidates
        .into_iter()
        .find(|boundary| !occurs_in(pdf, format!("--{boundary}").as_bytes()))
}

/// A `multipart/form-data` body with the options and the PDF, framed with
/// CRLF as RFC 7578 requires.
fn multipart_body(boundary: &str, options_json: &str, pdf: &[u8]) -> Vec<u8> {
    let head = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"options_json\"\r\n\r\n{options_json}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"document.pdf\"\r\nContent-Type: application/pdf\r\n\r\n"
    );
    let tail = format!("\r\n--{boundary}--\r\n");
    let mut body = Vec::with_capacity(head.len() + pdf.len() + tail.len());
    body.extend_from_slice(head.as_bytes());
    body.extend_from_slice(pdf);
    body.extend_from_slice(tail.as_bytes());
    body
}

/// How a PDF wait polls: the first delay grows by `factor` up to `max`, and
/// the whole wait ends at `deadline`.
struct PollPlan {
    first: Duration,
    factor: f32,
    max: Duration,
    deadline: Duration,
}

impl PollPlan {
    const PRODUCTION: PollPlan = PollPlan {
        first: Duration::from_secs(2),
        factor: 1.5,
        max: Duration::from_secs(10),
        deadline: Duration::from_secs(30 * 60),
    };

    fn next(&self, delay: Duration) -> Duration {
        delay.mul_f32(self.factor).min(self.max)
    }
}

/// What `GET /v3/pdf/{id}.mmd` answered.
enum Mmd {
    Ready(String),
    /// Not converted yet; Mathpix may say when to ask again.
    NotYet(Option<Duration>),
}

async fn until_cancelled(cancelled: &AtomicBool) {
    while !cancelled.load(Ordering::SeqCst) {
        tokio::time::sleep(CANCEL_CHECK).await;
    }
}

struct Api {
    base: String,
    client: reqwest::Client,
    poll: PollPlan,
}

impl Api {
    fn new() -> Result<Self, String> {
        Self::with(API_BASE, PollPlan::PRODUCTION)
    }

    fn with(base: &str, poll: PollPlan) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .user_agent(concat!("Oleafly/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(CONNECT_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| code("mathpix.unreachable"))?;
        Ok(Self {
            base: base.trim_end_matches('/').to_string(),
            client,
            poll,
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    /// Checks the keys with a free, short-lived app token.
    async fn verify(&self, keys: &MathpixKeys) -> Result<(), String> {
        let response = send(
            self.client
                .post(self.url("/v3/app-tokens"))
                .headers(keys.headers()?)
                .timeout(TOKEN_TIMEOUT)
                .json(&json!({ "expires": 30 })),
        )
        .await?;
        let status = response.status();
        if status.is_success() {
            Ok(())
        } else {
            Err(status_error(status, "mathpix.invalid_response"))
        }
    }

    async fn text(
        &self,
        keys: &MathpixKeys,
        image_base64: &str,
        mime: &str,
    ) -> Result<MathpixTextResult, String> {
        if image_base64.len() > MAX_IMAGE_BASE64_CHARS {
            return Err(code("mathpix.image_too_large"));
        }
        if !matches!(mime, "image/png" | "image/jpeg")
            || image_base64.is_empty()
            || !image_base64.bytes().all(is_base64_byte)
        {
            return Err(code("mathpix.invalid_response"));
        }
        let body = json!({
            "src": format!("data:{mime};base64,{image_base64}"),
            "formats": ["text", "latex_styled"],
            "math_inline_delimiters": ["\\(", "\\)"],
            "math_display_delimiters": ["\\[", "\\]"],
            "rm_spaces": true,
            "metadata": { "improve_mathpix": false },
        });
        let response = send(
            self.client
                .post(self.url("/v3/text"))
                .headers(keys.headers()?)
                .timeout(TEXT_TIMEOUT)
                .json(&body),
        )
        .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(status_error(status, "mathpix.image_too_large"));
        }
        let reply = parse_json(&read_capped(response, MAX_TEXT_REPLY_BYTES).await?)?;
        if let Some(error) = reply_error(&reply, keys) {
            return Err(error);
        }
        Ok(MathpixTextResult {
            text: reply
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            latex_styled: reply
                .get("latex_styled")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|latex| !latex.is_empty())
                .map(str::to_owned),
            confidence: reply.get("confidence").and_then(Value::as_f64),
        })
    }

    /// [`Self::text`], dropped when `cancelled` is set: an image read the
    /// user stopped ends with its request, and one stopped before it started
    /// sends nothing.
    async fn text_unless_cancelled(
        &self,
        keys: &MathpixKeys,
        image_base64: &str,
        mime: &str,
        cancelled: &AtomicBool,
    ) -> Result<MathpixTextResult, String> {
        if cancelled.load(Ordering::SeqCst) {
            return Err(code("mathpix.cancelled"));
        }
        tokio::select! {
            result = self.text(keys, image_base64, mime) => result,
            () = until_cancelled(cancelled) => Err(code("mathpix.cancelled")),
        }
    }

    async fn pdf_upload(
        &self,
        keys: &MathpixKeys,
        pdf: &[u8],
        page_ranges: Option<&str>,
    ) -> Result<String, String> {
        if pdf.len() > MAX_PDF_BYTES {
            return Err(code("mathpix.pdf_too_large"));
        }
        let mut options = json!({
            "include_page_breaks": true,
            "math_inline_delimiters": ["\\(", "\\)"],
            "math_display_delimiters": ["\\[", "\\]"],
            "rm_spaces": true,
            "metadata": { "improve_mathpix": false },
        });
        if let Some(ranges) = page_ranges {
            valid_page_ranges(ranges)?;
            options["page_ranges"] = Value::String(ranges.to_owned());
        }
        let boundary = pick_boundary(pdf, (0..MAX_BOUNDARY_TRIES).map(|_| random_boundary()))
            .ok_or_else(|| code("mathpix.invalid_response"))?;
        let body = multipart_body(&boundary, &options.to_string(), pdf);
        let response = send(
            self.client
                .post(self.url("/v3/pdf"))
                .headers(keys.headers()?)
                .header(
                    CONTENT_TYPE,
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .timeout(UPLOAD_TIMEOUT)
                .body(body),
        )
        .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(status_error(status, "mathpix.pdf_too_large"));
        }
        let reply = parse_json(&read_capped(response, MAX_TEXT_REPLY_BYTES).await?)?;
        if let Some(error) = reply_error(&reply, keys) {
            return Err(error);
        }
        let pdf_id = reply
            .get("pdf_id")
            .and_then(Value::as_str)
            .ok_or_else(|| code("mathpix.invalid_response"))?;
        valid_pdf_id(pdf_id)?;
        Ok(pdf_id.to_owned())
    }

    /// [`Self::pdf_upload`], dropped when `cancelled` is set: the request is
    /// abandoned, so a PDF whose upload the user stopped is not converted
    /// (and billed) behind their back.
    async fn pdf_upload_unless_cancelled(
        &self,
        keys: &MathpixKeys,
        pdf: &[u8],
        page_ranges: Option<&str>,
        cancelled: &AtomicBool,
    ) -> Result<String, String> {
        if cancelled.load(Ordering::SeqCst) {
            return Err(code("mathpix.cancelled"));
        }
        tokio::select! {
            result = self.pdf_upload(keys, pdf, page_ranges) => result,
            () = until_cancelled(cancelled) => Err(code("mathpix.cancelled")),
        }
    }

    /// The PDF's progress, and the error Mathpix reported, if any.
    async fn pdf_status(
        &self,
        keys: &MathpixKeys,
        pdf_id: &str,
    ) -> Result<(MathpixPdfProgress, Option<String>), String> {
        let response = send(
            self.client
                .get(self.url(&format!("/v3/pdf/{pdf_id}")))
                .headers(keys.headers()?)
                .timeout(POLL_TIMEOUT),
        )
        .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(status_error(status, "mathpix.pdf_too_large"));
        }
        let reply = parse_json(&read_capped(response, MAX_TEXT_REPLY_BYTES).await?)?;
        let state = reply
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("received")
            .to_owned();
        let mut failure = reply_error(&reply, keys);
        if failure.is_none() && state == "error" {
            failure = Some(code("mathpix.invalid_response"));
        }
        let pages_total = page_count(&reply, "num_pages");
        let pages_done = page_count(&reply, "num_pages_completed");
        Ok((
            MathpixPdfProgress {
                status: state,
                pages_done: if pages_total > 0 {
                    pages_done.min(pages_total)
                } else {
                    pages_done
                },
                pages_total,
            },
            failure,
        ))
    }

    async fn pdf_mmd(&self, keys: &MathpixKeys, pdf_id: &str) -> Result<Mmd, String> {
        let response = send(
            self.client
                .get(self.url(&format!("/v3/pdf/{pdf_id}.mmd")))
                .headers(keys.headers()?)
                .timeout(POLL_TIMEOUT),
        )
        .await?;
        let status = response.status();
        if matches!(status.as_u16(), 202 | 404) {
            let retry = response
                .headers()
                .get(RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.trim().parse::<u64>().ok())
                .map(Duration::from_secs);
            return Ok(Mmd::NotYet(retry));
        }
        if !status.is_success() {
            return Err(status_error(status, "mathpix.pdf_too_large"));
        }
        let body = read_capped(response, MAX_MMD_BYTES).await?;
        String::from_utf8(body)
            .map(Mmd::Ready)
            .map_err(|_| code("mathpix.invalid_response"))
    }

    /// Removes the PDF and its results from Mathpix. Best effort.
    async fn pdf_delete(&self, keys: &MathpixKeys, pdf_id: &str) {
        let Ok(headers) = keys.headers() else {
            return;
        };
        let _ = self
            .client
            .delete(self.url(&format!("/v3/pdf/{pdf_id}")))
            .headers(headers)
            .timeout(POLL_TIMEOUT)
            .send()
            .await;
    }

    /// Runs `work` until it finishes, the user cancels, or the deadline passes.
    async fn guarded<T>(
        &self,
        cancelled: &AtomicBool,
        deadline: tokio::time::Instant,
        work: impl Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        if cancelled.load(Ordering::SeqCst) {
            return Err(code("mathpix.cancelled"));
        }
        tokio::select! {
            result = tokio::time::timeout_at(deadline, work) => {
                result.unwrap_or_else(|_| Err(code("mathpix.timed_out")))
            }
            () = until_cancelled(cancelled) => Err(code("mathpix.cancelled")),
        }
    }

    async fn pause(
        &self,
        cancelled: &AtomicBool,
        deadline: tokio::time::Instant,
        duration: Duration,
    ) -> Result<(), String> {
        self.guarded(cancelled, deadline, async {
            tokio::time::sleep(duration).await;
            Ok(())
        })
        .await
    }

    async fn poll_until_converted(
        &self,
        keys: &MathpixKeys,
        pdf_id: &str,
        cancelled: &AtomicBool,
        progress: &(impl Fn(MathpixPdfProgress) + Sync),
        deadline: tokio::time::Instant,
    ) -> Result<String, String> {
        let mut delay = self.poll.first;
        loop {
            let (state, failure) = self
                .guarded(cancelled, deadline, self.pdf_status(keys, pdf_id))
                .await?;
            if let Some(error) = failure {
                return Err(error);
            }
            let completed = state.status == "completed";
            progress(state);
            if completed {
                break;
            }
            self.pause(cancelled, deadline, delay).await?;
            delay = self.poll.next(delay);
        }
        loop {
            match self
                .guarded(cancelled, deadline, self.pdf_mmd(keys, pdf_id))
                .await?
            {
                Mmd::Ready(markdown) => return Ok(markdown),
                Mmd::NotYet(retry) => {
                    let wait = retry.unwrap_or(self.poll.first).min(self.poll.max);
                    self.pause(cancelled, deadline, wait).await?;
                }
            }
        }
    }

    /// Waits for Mathpix to convert the PDF and returns its Mathpix Markdown.
    /// The PDF is deleted from Mathpix on every way out.
    async fn pdf_wait(
        &self,
        keys: &MathpixKeys,
        pdf_id: &str,
        cancelled: &AtomicBool,
        progress: &(impl Fn(MathpixPdfProgress) + Sync),
    ) -> Result<String, String> {
        valid_pdf_id(pdf_id)?;
        let deadline = tokio::time::Instant::now() + self.poll.deadline;
        let outcome = self
            .poll_until_converted(keys, pdf_id, cancelled, progress, deadline)
            .await;
        self.pdf_delete(keys, pdf_id).await;
        outcome
    }
}

/// Cancel flags of image reads, PDF uploads and PDF waits, by request id. A
/// cancel can arrive before its wait starts (the upload was still running);
/// it leaves a set flag behind.
#[derive(Default)]
struct CancelRegistry {
    flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl CancelRegistry {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<AtomicBool>>> {
        self.flags.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Makes room for one entry. Flags already set go first: their wait has
    /// stopped or never came.
    fn make_room(flags: &mut HashMap<String, Arc<AtomicBool>>) {
        if flags.len() < MAX_CANCEL_ENTRIES {
            return;
        }
        flags.retain(|_, flag| !flag.load(Ordering::SeqCst));
        while flags.len() >= MAX_CANCEL_ENTRIES {
            let Some(id) = flags.keys().next().cloned() else {
                break;
            };
            flags.remove(&id);
        }
    }

    fn cancel(&self, id: &str) {
        if !valid_request_id(id) {
            return;
        }
        let mut flags = self.lock();
        if let Some(flag) = flags.get(id) {
            flag.store(true, Ordering::SeqCst);
            return;
        }
        Self::make_room(&mut flags);
        flags.insert(id.to_owned(), Arc::new(AtomicBool::new(true)));
    }

    fn register(&self, id: &str) -> Registration<'_> {
        let mut flags = self.lock();
        let flag = match flags.get(id) {
            Some(flag) => Arc::clone(flag),
            None => {
                Self::make_room(&mut flags);
                let flag = Arc::new(AtomicBool::new(false));
                flags.insert(id.to_owned(), Arc::clone(&flag));
                flag
            }
        };
        Registration {
            registry: self,
            id: id.to_owned(),
            flag,
        }
    }
}

/// A wait's place in the registry, removed when the wait ends unless it was
/// cancelled: a cancel that lands as an upload finishes must still stop the
/// wait that follows under the same id, so its set flag stays (until
/// [`CancelRegistry::make_room`] drops it).
struct Registration<'a> {
    registry: &'a CancelRegistry,
    id: String,
    flag: Arc<AtomicBool>,
}

impl Drop for Registration<'_> {
    fn drop(&mut self) {
        let mut flags = self.registry.lock();
        if !self.flag.load(Ordering::SeqCst)
            && flags
                .get(&self.id)
                .is_some_and(|flag| Arc::ptr_eq(flag, &self.flag))
        {
            flags.remove(&self.id);
        }
    }
}

static CANCELS: LazyLock<CancelRegistry> = LazyLock::new(CancelRegistry::default);

fn stored_keys() -> Result<Option<MathpixKeys>, String> {
    let all = crate::secrets::read_connector_secrets()?;
    let value = |account: &str| {
        all.get(account)
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
    };
    Ok(match (value(APP_ID_ACCOUNT), value(APP_KEY_ACCOUNT)) {
        (Some(app_id), Some(app_key)) => Some(MathpixKeys { app_id, app_key }),
        _ => None,
    })
}

fn key_status() -> MathpixKeyStatus {
    match stored_keys() {
        Ok(Some(keys)) => MathpixKeyStatus {
            configured: true,
            app_id: Some(keys.app_id),
        },
        _ => MathpixKeyStatus {
            configured: false,
            app_id: None,
        },
    }
}

async fn load_keys() -> Result<MathpixKeys, String> {
    tauri::async_runtime::spawn_blocking(stored_keys)
        .await
        .ok()
        .and_then(Result::ok)
        .flatten()
        .ok_or_else(|| code("mathpix.keys_missing"))
}

fn write_keys(keys: MathpixKeys) -> Result<(), String> {
    crate::connectors::update_connector_secrets(|all| {
        all.insert(APP_ID_ACCOUNT.to_owned(), keys.app_id);
        all.insert(APP_KEY_ACCOUNT.to_owned(), keys.app_key);
    })
}

fn clear_keys() -> Result<(), String> {
    crate::connectors::update_connector_secrets(|all| {
        all.remove(APP_ID_ACCOUNT);
        all.remove(APP_KEY_ACCOUNT);
    })
}

async fn save_keys_with(
    api: &Api,
    app_id: &str,
    app_key: &str,
) -> Result<MathpixKeyStatus, String> {
    let keys = MathpixKeys {
        app_id: app_id.trim().to_owned(),
        app_key: app_key.trim().to_owned(),
    };
    valid_credential(&keys.app_id)?;
    valid_credential(&keys.app_key)?;
    api.verify(&keys).await?;
    let app_id = keys.app_id.clone();
    tauri::async_runtime::spawn_blocking(move || write_keys(keys))
        .await
        .map_err(|error| format!("failed to save the Mathpix keys: {error}"))??;
    Ok(MathpixKeyStatus {
        configured: true,
        app_id: Some(app_id),
    })
}

/// The raw request body. Linux builds that fall back to `postMessage` IPC
/// deliver it as a JSON array of numbers.
fn upload_bytes(body: &tauri::ipc::InvokeBody) -> Result<Cow<'_, [u8]>, String> {
    upload_bytes_within(body, MAX_JSON_PDF_BYTES)
}

/// [`upload_bytes`] with `json_limit` as the most a JSON array may carry.
/// The length is checked before any byte is converted.
fn upload_bytes_within(
    body: &tauri::ipc::InvokeBody,
    json_limit: usize,
) -> Result<Cow<'_, [u8]>, String> {
    match body {
        tauri::ipc::InvokeBody::Raw(bytes) => {
            if bytes.len() > MAX_PDF_BYTES {
                return Err(code("mathpix.pdf_too_large"));
            }
            Ok(Cow::Borrowed(bytes.as_slice()))
        }
        tauri::ipc::InvokeBody::Json(Value::Array(values)) => {
            if values.len() > json_limit {
                return Err(code("mathpix.pdf_too_large_ipc"));
            }
            values
                .iter()
                .map(|value| {
                    value
                        .as_u64()
                        .and_then(|number| u8::try_from(number).ok())
                        .ok_or_else(|| code("mathpix.invalid_response"))
                })
                .collect::<Result<Vec<u8>, String>>()
                .map(Cow::Owned)
        }
        tauri::ipc::InvokeBody::Json(_) => Err(code("mathpix.invalid_response")),
    }
}

fn page_ranges_header(headers: &tauri::http::HeaderMap) -> Result<Option<String>, String> {
    let Some(value) = headers.get(PAGE_RANGES_HEADER) else {
        return Ok(None);
    };
    let ranges = value
        .to_str()
        .map_err(|_| code("mathpix.invalid_response"))?
        .trim();
    if ranges.is_empty() {
        return Ok(None);
    }
    valid_page_ranges(ranges)?;
    Ok(Some(ranges.to_owned()))
}

/// The id the renderer gave this PDF's upload and wait, so Cancel reaches
/// either; `None` when the header is absent.
fn request_id_header(headers: &tauri::http::HeaderMap) -> Result<Option<String>, String> {
    let Some(value) = headers.get(REQUEST_ID_HEADER) else {
        return Ok(None);
    };
    let id = value
        .to_str()
        .map_err(|_| code("mathpix.invalid_response"))?
        .trim();
    if valid_request_id(id) {
        Ok(Some(id.to_owned()))
    } else {
        Err(code("mathpix.invalid_response"))
    }
}

#[tauri::command]
pub async fn mathpix_key_status(webview: tauri::Webview) -> Result<MathpixKeyStatus, String> {
    require_main(&webview)?;
    tauri::async_runtime::spawn_blocking(key_status)
        .await
        .map_err(|_| code("mathpix.keys_missing"))
}

/// Checks the keys with Mathpix, then stores them encrypted. The key is never
/// sent back.
#[tauri::command]
pub async fn mathpix_save_keys(
    webview: tauri::Webview,
    app_id: String,
    app_key: String,
) -> Result<MathpixKeyStatus, String> {
    require_main(&webview)?;
    save_keys_with(&Api::new()?, &app_id, &app_key).await
}

#[tauri::command]
pub async fn mathpix_clear_keys(webview: tauri::Webview) -> Result<(), String> {
    require_main(&webview)?;
    tauri::async_runtime::spawn_blocking(clear_keys)
        .await
        .map_err(|error| format!("failed to remove the Mathpix keys: {error}"))?
}

/// Reads one image (PNG or JPEG, base64) with Mathpix. With a `request_id`,
/// `mathpix_text_cancel` with the same id stops the read.
#[tauri::command]
pub async fn mathpix_text(
    webview: tauri::Webview,
    image_base64: String,
    mime: String,
    request_id: Option<String>,
) -> Result<MathpixTextResult, String> {
    require_main(&webview)?;
    if image_base64.len() > MAX_IMAGE_BASE64_CHARS {
        return Err(code("mathpix.image_too_large"));
    }
    if request_id
        .as_deref()
        .is_some_and(|id| !valid_request_id(id))
    {
        return Err(code("mathpix.invalid_response"));
    }
    // Registered before the keys load, so a cancel from then on stops it.
    let registration = request_id.as_deref().map(|id| CANCELS.register(id));
    let keys = load_keys().await?;
    let api = Api::new()?;
    match &registration {
        Some(registration) => {
            api.text_unless_cancelled(&keys, &image_base64, &mime, &registration.flag)
                .await
        }
        None => api.text(&keys, &image_base64, &mime).await,
    }
}

/// Stops the image read `mathpix_text` runs under `request_id`, also when
/// it has not started yet.
#[tauri::command]
pub fn mathpix_text_cancel(request_id: String) {
    CANCELS.cancel(&request_id);
}

/// Uploads a PDF sent as the raw request body; the `x-oleafly-page-ranges`
/// header names the pages Mathpix converts and bills. The optional
/// `x-oleafly-request-id` header lets `mathpix_pdf_cancel` stop the upload
/// itself, not only the wait that follows it. Returns the PDF id.
#[tauri::command]
pub async fn mathpix_pdf_upload(
    webview: tauri::Webview,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    require_main(&webview)?;
    let page_ranges = page_ranges_header(request.headers())?;
    let request_id = request_id_header(request.headers())?;
    let pdf = upload_bytes(request.body())?;
    let keys = load_keys().await?;
    let api = Api::new()?;
    match request_id.as_deref().map(|id| CANCELS.register(id)) {
        Some(registration) => {
            api.pdf_upload_unless_cancelled(&keys, &pdf, page_ranges.as_deref(), &registration.flag)
                .await
        }
        None => api.pdf_upload(&keys, &pdf, page_ranges.as_deref()).await,
    }
}

/// Waits for an uploaded PDF, reports progress, and returns its Mathpix
/// Markdown. `mathpix_pdf_cancel` with the same request id stops it.
#[tauri::command]
pub async fn mathpix_pdf_wait(
    webview: tauri::Webview,
    request_id: String,
    pdf_id: String,
    on_progress: tauri::ipc::Channel<MathpixPdfProgress>,
) -> Result<String, String> {
    require_main(&webview)?;
    if !valid_request_id(&request_id) {
        return Err(code("mathpix.invalid_response"));
    }
    valid_pdf_id(&pdf_id)?;
    let registration = CANCELS.register(&request_id);
    let keys = load_keys().await?;
    let report = |progress: MathpixPdfProgress| {
        let _ = on_progress.send(progress);
    };
    Api::new()?
        .pdf_wait(&keys, &pdf_id, &registration.flag, &report)
        .await
}

#[tauri::command]
pub fn mathpix_pdf_cancel(request_id: String) {
    CANCELS.cancel(&request_id);
}

#[cfg(test)]
mod tests;
