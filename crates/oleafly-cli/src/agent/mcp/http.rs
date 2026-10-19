//! An MCP server on the network (streamable HTTP): each message is a POST;
//! the answer is JSON or an event stream that carries it. The session id
//! the server gives is sent back; redirects stay on the same origin.
//!
//! An error never quotes the server's answer: it may echo a header value.
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, CONTENT_TYPE};
use serde_json::{json, Value};

use super::MAX_FRAME_BYTES;

const SESSION_HEADER: &str = "mcp-session-id";
const PROTOCOL_HEADER: &str = "mcp-protocol-version";
/// An event stream is read up to this much while waiting for its answer.
const MAX_STREAM_BYTES: usize = 16 << 20;
const CLOSE_WAIT: Duration = Duration::from_secs(2);

fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub struct HttpConnection {
    client: reqwest::Client,
    url: reqwest::Url,
    headers: HeaderMap,
    session: Mutex<Option<String>>,
    protocol: Mutex<Option<String>>,
    next_id: AtomicU64,
}

/// The configured headers; a name or value that is not a valid header is
/// an error that names the header, never its value.
fn header_map(headers: &BTreeMap<String, String>) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    for (name, value) in headers {
        let header = HeaderName::from_bytes(name.trim().as_bytes())
            .map_err(|_| format!("its header {name} has an invalid name"))?;
        let mut value = HeaderValue::from_str(value.trim())
            .map_err(|_| format!("its header {name} has an invalid value"))?;
        value.set_sensitive(true);
        map.insert(header, value);
    }
    Ok(map)
}

impl HttpConnection {
    pub fn new(url: &str, headers: &BTreeMap<String, String>) -> Result<Self, String> {
        let url = reqwest::Url::parse(url.trim())
            .map_err(|_| "its address is not a valid URL".to_string())?;
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("its address must be an http or https URL without a user name".into());
        }
        let origin = url.origin();
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .user_agent(crate::agent::tools::web_user_agent())
            .redirect(reqwest::redirect::Policy::custom(move |attempt| {
                if attempt.previous().len() >= 3 {
                    attempt.error("too many redirects")
                } else if attempt.url().origin() != origin {
                    attempt.stop()
                } else {
                    attempt.follow()
                }
            }))
            .build()
            .map_err(|_| "the HTTP client could not start".to_string())?;
        Ok(Self {
            client,
            url,
            headers: header_map(headers)?,
            session: Mutex::new(None),
            protocol: Mutex::new(None),
            next_id: AtomicU64::new(1),
        })
    }

    /// The version `initialize` settled on, sent with every later message.
    pub fn set_protocol_version(&self, version: &str) {
        if !version.is_empty()
            && version.len() <= 32
            && version
                .chars()
                .all(|character| character.is_ascii_graphic())
        {
            *lock(&self.protocol) = Some(version.to_string());
        }
    }

    fn post(&self, body: &Value) -> reqwest::RequestBuilder {
        let mut request = self
            .client
            .post(self.url.clone())
            .headers(self.headers.clone())
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json, text/event-stream")
            .json(body);
        if let Some(version) = lock(&self.protocol).clone() {
            request = request.header(PROTOCOL_HEADER, version);
        }
        if let Some(session) = lock(&self.session).clone() {
            request = request.header(SESSION_HEADER, session);
        }
        request
    }

    fn keep_session(&self, response: &reqwest::Response) {
        if let Some(session) = response
            .headers()
            .get(SESSION_HEADER)
            .and_then(|value| value.to_str().ok())
            .filter(|value| !value.is_empty() && value.len() <= 512)
        {
            *lock(&self.session) = Some(session.to_string());
        }
    }

    pub async fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::AcqRel);
        let body = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let exchange = async {
            let response = self
                .post(&body)
                .send()
                .await
                .map_err(|error| transport_error(&error))?;
            self.keep_session(&response);
            let status = response.status();
            if !status.is_success() {
                return Err(format!("it answered with HTTP {}", status.as_u16()));
            }
            let streamed = response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| value.to_ascii_lowercase().starts_with("text/event-stream"));
            let message = if streamed {
                read_event_stream(response, id).await?
            } else {
                let bytes = read_bounded(response, MAX_FRAME_BYTES).await?;
                find_response(
                    &serde_json::from_slice::<Value>(&bytes)
                        .map_err(|_| "it answered with something that isn't JSON".to_string())?,
                    id,
                )
                .ok_or("its answer was for another request")?
            };
            match message.get("error") {
                Some(error) if !error.is_null() => Err(error["message"]
                    .as_str()
                    .unwrap_or("the server reported an error")
                    .chars()
                    .filter(|character| !character.is_control())
                    .take(400)
                    .collect()),
                _ => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
            }
        };
        tokio::time::timeout(timeout, exchange)
            .await
            .map_err(|_| format!("it did not answer within {} seconds", timeout.as_secs()))?
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let body = json!({"jsonrpc": "2.0", "method": method, "params": params});
        let response = tokio::time::timeout(Duration::from_secs(20), self.post(&body).send())
            .await
            .map_err(|_| "it did not answer in time".to_string())?
            .map_err(|error| transport_error(&error))?;
        self.keep_session(&response);
        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!(
                "it answered with HTTP {}",
                response.status().as_u16()
            ))
        }
    }

    /// Ends the session on the server (when it gave one).
    pub async fn close(&self) {
        let Some(session) = lock(&self.session).take() else {
            return;
        };
        let request = self
            .client
            .delete(self.url.clone())
            .headers(self.headers.clone())
            .header(SESSION_HEADER, session);
        let _ = tokio::time::timeout(CLOSE_WAIT, request.send()).await;
    }
}

fn transport_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "it did not answer in time".into()
    } else if error.is_redirect() {
        "it redirected too often or to another site".into()
    } else if error.is_connect() {
        "it could not be reached".into()
    } else {
        "the connection failed".into()
    }
}

async fn read_bounded(mut response: reqwest::Response, max: usize) -> Result<Vec<u8>, String> {
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| transport_error(&error))?
    {
        body.extend_from_slice(&chunk);
        if body.len() > max {
            return Err("its answer is too large".into());
        }
    }
    Ok(body)
}

/// The response with `id` in a message or a batch.
fn find_response(message: &Value, id: u64) -> Option<Value> {
    match message {
        Value::Array(items) => items.iter().find_map(|item| find_response(item, id)),
        Value::Object(_)
            if message.get("id").and_then(Value::as_u64) == Some(id)
                && message.get("method").is_none() =>
        {
            Some(message.clone())
        }
        _ => None,
    }
}

/// `data:` lines of one event, joined.
fn event_data(event: &str) -> Option<String> {
    let lines: Vec<&str> = event
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|data| data.strip_prefix(' ').unwrap_or(data))
        .collect();
    (!lines.is_empty()).then(|| lines.join("\n"))
}

/// Reads an event stream until the response to `id`.
async fn read_event_stream(mut response: reqwest::Response, id: u64) -> Result<Value, String> {
    let mut buffer = String::new();
    let mut total = 0usize;
    loop {
        let chunk = response
            .chunk()
            .await
            .map_err(|error| transport_error(&error))?;
        let Some(chunk) = chunk else {
            if let Some(found) = event_data(&buffer)
                .and_then(|data| serde_json::from_str::<Value>(&data).ok())
                .and_then(|message| find_response(&message, id))
            {
                return Ok(found);
            }
            return Err("it ended the stream without an answer".into());
        };
        total += chunk.len();
        if total > MAX_STREAM_BYTES {
            return Err("its answer is too large".into());
        }
        buffer.push_str(&String::from_utf8_lossy(&chunk).replace("\r\n", "\n"));
        while let Some(end) = buffer.find("\n\n") {
            let event: String = buffer.drain(..end + 2).collect();
            if let Some(found) = event_data(&event)
                .and_then(|data| serde_json::from_str::<Value>(&data).ok())
                .and_then(|message| find_response(&message, id))
            {
                return Ok(found);
            }
        }
        if buffer.len() > MAX_FRAME_BYTES {
            return Err("one of its messages is too large".into());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_and_batches_yield_the_matching_response() {
        assert_eq!(
            event_data("event: message\ndata: {\"a\":1}\n"),
            Some("{\"a\":1}".into())
        );
        assert_eq!(event_data(": keep-alive\n"), None);
        let batch = json!([{"jsonrpc":"2.0","method":"notifications/progress"}, {"jsonrpc":"2.0","id":7,"result":{"ok":true}}]);
        assert_eq!(find_response(&batch, 7).unwrap()["result"]["ok"], true);
        assert!(find_response(&batch, 8).is_none());
        let request = json!({"jsonrpc":"2.0","id":7,"method":"ping"});
        assert!(find_response(&request, 7).is_none());
    }

    #[test]
    fn invalid_headers_name_the_header_but_not_the_value() {
        let headers =
            BTreeMap::from([("Authorization".to_string(), "Bearer s3cret\nx".to_string())]);
        let error = header_map(&headers).unwrap_err();
        assert!(error.contains("Authorization") && !error.contains("s3cret"));
        assert!(HttpConnection::new("ftp://example.com", &BTreeMap::new()).is_err());
        assert!(HttpConnection::new("https://user:pw@example.com/mcp", &BTreeMap::new()).is_err());
        assert!(HttpConnection::new("https://example.com/mcp", &BTreeMap::new()).is_ok());
    }
}
