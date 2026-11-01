use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use reqwest::header::SET_COOKIE;
use serde_json::Value;

use crate::client::Http;
use crate::error::{OnlineError, OnlineErrorKind};
use crate::session;

const FRAME: char = char::REPLACEMENT_CHARACTER;
const EXCHANGE_LIMIT: Duration = Duration::from_secs(25);
const POLL_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_POLLS: usize = 12;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProjectSettings {
    pub compiler: Option<String>,
    pub main_doc: Option<String>,
    pub tex_live: Option<String>,
}

#[derive(Debug, PartialEq)]
pub enum Packet {
    Disconnect,
    Connect,
    Heartbeat,
    Event { name: String, args: Vec<Value> },
    Error(String),
    Other,
}

pub fn decode_payload(payload: &str) -> Vec<String> {
    if !payload.starts_with(FRAME) {
        return if payload.is_empty() {
            Vec::new()
        } else {
            vec![payload.to_string()]
        };
    }
    let mut packets = Vec::new();
    let mut rest = payload;
    while let Some(stripped) = rest.strip_prefix(FRAME) {
        let Some(end) = stripped.find(FRAME) else {
            break;
        };
        let Ok(length) = stripped[..end].parse::<usize>() else {
            break;
        };
        let body = &stripped[end + FRAME.len_utf8()..];
        let split = utf16_prefix(body, length);
        packets.push(body[..split].to_string());
        rest = &body[split..];
    }
    packets
}

fn utf16_prefix(text: &str, units: usize) -> usize {
    let mut counted = 0;
    for (index, character) in text.char_indices() {
        if counted >= units {
            return index;
        }
        counted += character.len_utf16();
    }
    text.len()
}

pub fn parse_packet(raw: &str) -> Packet {
    let mut parts = raw.splitn(4, ':');
    let kind = parts.next().unwrap_or_default();
    let _id = parts.next();
    let _endpoint = parts.next();
    let data = parts.next().unwrap_or_default();
    match kind {
        "0" => Packet::Disconnect,
        "1" => Packet::Connect,
        "2" => Packet::Heartbeat,
        "5" => match serde_json::from_str::<Value>(data) {
            Ok(event) => Packet::Event {
                name: event
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                args: event
                    .get("args")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default(),
            },
            Err(_) => Packet::Other,
        },
        "7" => Packet::Error(data.to_string()),
        _ => Packet::Other,
    }
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default()
}

fn absorb_cookies(cookie: &str, response: &reqwest::Response) -> String {
    let lines: Vec<String> = response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok().map(str::to_string))
        .collect();
    session::merge_set_cookies(cookie, lines.iter().map(String::as_str))
}

pub async fn fetch_project(
    http: &Http,
    cookie: &str,
    project_id: &str,
) -> Result<Value, OnlineError> {
    fetch_project_text(http, cookie, project_id)
        .await
        .map_err(|detail| {
            OnlineError::new(OnlineErrorKind::Unreachable)
                .param("server", &http.base)
                .detail(detail)
        })
}

async fn fetch_project_text(http: &Http, cookie: &str, project_id: &str) -> Result<Value, String> {
    let started = Instant::now();
    let mut cookie = cookie.to_string();
    if let Ok(response) = http.get("/socket.io/socket.io.js", &cookie).send().await {
        cookie = absorb_cookies(&cookie, &response);
    }
    let query = format!("projectId={project_id}");
    let handshake = http
        .get(
            &format!("/socket.io/1/?{query}&t={}", now_millis()),
            &cookie,
        )
        .send()
        .await
        .map_err(|error| error.to_string())?;
    cookie = absorb_cookies(&cookie, &handshake);
    if !handshake.status().is_success() {
        return Err(format!(
            "handshake refused with HTTP {}",
            handshake.status().as_u16()
        ));
    }
    let body = handshake.text().await.map_err(|error| error.to_string())?;
    let sid = body
        .split(':')
        .next()
        .filter(|sid| {
            !sid.is_empty()
                && sid
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
        })
        .ok_or_else(|| "handshake returned no session".to_string())?
        .to_string();
    let channel = format!("/socket.io/1/xhr-polling/{sid}?{query}");
    let result = poll_for_project(http, &cookie, &channel, started).await;
    let _ = http
        .post(&format!("{channel}&t={}", now_millis()), &cookie)
        .body("0::")
        .send()
        .await;
    result
}

async fn poll_for_project(
    http: &Http,
    cookie: &str,
    channel: &str,
    started: Instant,
) -> Result<Value, String> {
    for _ in 0..MAX_POLLS {
        if started.elapsed() >= EXCHANGE_LIMIT {
            break;
        }
        let response = http
            .get(&format!("{channel}&t={}", now_millis()), cookie)
            .timeout(POLL_TIMEOUT)
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            return Err(format!(
                "poll refused with HTTP {}",
                response.status().as_u16()
            ));
        }
        let payload = response.text().await.map_err(|error| error.to_string())?;
        for packet in decode_payload(&payload) {
            match parse_packet(&packet) {
                Packet::Heartbeat => {
                    let _ = http
                        .post(&format!("{channel}&t={}", now_millis()), cookie)
                        .body("2::")
                        .send()
                        .await;
                }
                Packet::Event { name, args } if name == "joinProjectResponse" => {
                    return args
                        .first()
                        .and_then(|reply| reply.get("project"))
                        .cloned()
                        .ok_or_else(|| "the project reply was empty".to_string());
                }
                Packet::Event { name, .. }
                    if name == "connectionRejected" || name == "forceDisconnect" =>
                {
                    return Err(format!("the server sent {name}"));
                }
                Packet::Error(reason) => return Err(format!("the server sent an error: {reason}")),
                Packet::Disconnect => return Err("the server closed the connection".to_string()),
                _ => {}
            }
        }
    }
    Err("the server did not send the project".to_string())
}

pub fn settings_from_project(project: &Value) -> ProjectSettings {
    let text = |key: &str| {
        project
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let main_doc = text("rootDoc_id").and_then(|root| {
        project
            .get("rootFolder")
            .and_then(Value::as_array)
            .and_then(|folders| folders.first())
            .and_then(|folder| find_doc_path(folder, &root, ""))
    });
    ProjectSettings {
        compiler: text("compiler"),
        main_doc,
        tex_live: text("imageName").and_then(|image| tex_live_year(&image)),
    }
}

fn find_doc_path(folder: &Value, doc_id: &str, prefix: &str) -> Option<String> {
    let id_of = |entry: &Value| {
        entry
            .get("_id")
            .or_else(|| entry.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let name_of = |entry: &Value| {
        entry
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    for doc in folder
        .get("docs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if id_of(doc).as_deref() == Some(doc_id) {
            return name_of(doc).map(|name| format!("{prefix}{name}"));
        }
    }
    for child in folder
        .get("folders")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(name) = name_of(child) else {
            continue;
        };
        if let Some(found) = find_doc_path(child, doc_id, &format!("{prefix}{name}/")) {
            return Some(found);
        }
    }
    None
}

pub fn tex_live_year(image: &str) -> Option<String> {
    let tag = image.rsplit(':').next()?;
    let year: String = tag.chars().take_while(char::is_ascii_digit).collect();
    (year.len() == 4).then_some(year)
}

pub fn flavor_for_compiler(compiler: &str) -> Option<&'static str> {
    match compiler.trim().to_ascii_lowercase().as_str() {
        "pdflatex" => Some("pdflatex"),
        "xelatex" => Some("xelatex"),
        "lualatex" => Some("lualatex"),
        _ => None,
    }
}
