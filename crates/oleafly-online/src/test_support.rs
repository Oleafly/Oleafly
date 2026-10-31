use std::collections::HashMap;
use std::io::Write as _;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Clone, Debug)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[derive(Clone)]
pub struct Reply {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Reply {
    pub fn ok(body: impl Into<Vec<u8>>) -> Self {
        Self {
            status: 200,
            headers: Vec::new(),
            body: body.into(),
        }
    }

    pub fn status(status: u16) -> Self {
        Self {
            status,
            headers: Vec::new(),
            body: Vec::new(),
        }
    }

    pub fn header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }
}

pub type Handler = Arc<dyn Fn(&Request) -> Reply + Send + Sync>;

pub struct FixtureServer {
    pub base: String,
    requests: Arc<Mutex<Vec<Request>>>,
}

async fn read_request(stream: &mut tokio::net::TcpStream) -> Option<Request> {
    let mut raw = Vec::new();
    let mut buffer = [0_u8; 4096];
    let head_end = loop {
        if let Some(at) = raw.windows(4).position(|window| window == b"\r\n\r\n") {
            break at;
        }
        let read = stream.read(&mut buffer).await.ok()?;
        if read == 0 {
            return None;
        }
        raw.extend_from_slice(&buffer[..read]);
    };
    let head = String::from_utf8_lossy(&raw[..head_end]).to_string();
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split_whitespace();
    let method = first.next()?.to_string();
    let path = first.next()?.to_string();
    let headers: HashMap<String, String> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_string()))
        .collect();
    let length: usize = headers
        .get("content-length")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let mut body = raw[head_end + 4..].to_vec();
    while body.len() < length {
        let read = stream.read(&mut buffer).await.ok()?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&buffer[..read]);
    }
    Some(Request {
        method,
        path,
        headers,
        body: String::from_utf8_lossy(&body).to_string(),
    })
}

impl FixtureServer {
    pub async fn start(handler: Handler) -> FixtureServer {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let requests: Arc<Mutex<Vec<Request>>> = Arc::default();
        let recorded = requests.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    return;
                };
                let handler = handler.clone();
                let recorded = recorded.clone();
                tokio::spawn(async move {
                    let Some(request) = read_request(&mut stream).await else {
                        return;
                    };
                    recorded.lock().unwrap().push(request.clone());
                    let reply = handler(&request);
                    let mut head = format!(
                        "HTTP/1.1 {} X\r\nContent-Length: {}\r\nConnection: close\r\n",
                        reply.status,
                        reply.body.len()
                    );
                    for (name, value) in &reply.headers {
                        head.push_str(&format!("{name}: {value}\r\n"));
                    }
                    head.push_str("\r\n");
                    let _ = stream.write_all(head.as_bytes()).await;
                    let _ = stream.write_all(&reply.body).await;
                });
            }
        });
        FixtureServer { base, requests }
    }

    pub fn requests(&self, prefix: &str) -> Vec<Request> {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|request| request.path.starts_with(prefix))
            .cloned()
            .collect()
    }
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub fn dashboard_page(projects: &Value) -> String {
    format!(
        "<!DOCTYPE html><html><head>\
         <meta name=\"ol-csrfToken\" content=\"csrf-123\">\
         <meta content=\"user-1\" name=\"ol-user_id\">\
         <meta name=\"ol-usersEmail\" content=\"ada@uni.edu\">\
         <meta name=\"ol-prefetchedProjectsBlob\" data-type=\"json\" content=\"{}\">\
         </head><body></body></html>",
        escape(&projects.to_string())
    )
}

pub fn remote_project_json(id: &str, name: &str) -> Value {
    json!({
        "id": id,
        "name": name,
        "lastUpdated": "2026-10-01T10:00:00.000Z",
        "accessLevel": "owner",
        "owner": { "id": "user-1", "firstName": "Ada", "lastName": "Lovelace", "email": "ada@uni.edu" },
        "lastUpdatedBy": { "firstName": "Grace", "lastName": "Hopper" },
        "archived": false,
        "trashed": false
    })
}

pub fn project_reply(project: &Value) -> String {
    let event = json!({ "name": "joinProjectResponse", "args": [{ "publicId": "p", "project": project, "permissionsLevel": "owner", "protocolVersion": 2 }] });
    frame(&[&format!("5:::{event}")])
}

pub fn frame(packets: &[&str]) -> String {
    let marker = char::REPLACEMENT_CHARACTER;
    packets
        .iter()
        .map(|packet| format!("{marker}{}{marker}{packet}", packet.encode_utf16().count()))
        .collect()
}

/// A current Firefox `cookies.sqlite` schema.
pub const FIREFOX_COOKIE_SCHEMA: &str = "PRAGMA user_version = 17;\
     CREATE TABLE moz_cookies(\
       id INTEGER PRIMARY KEY,\
       originAttributes TEXT NOT NULL DEFAULT '',\
       name TEXT,\
       value TEXT,\
       host TEXT,\
       path TEXT,\
       expiry INTEGER,\
       lastAccessed INTEGER,\
       creationTime INTEGER,\
       isSecure INTEGER,\
       isHttpOnly INTEGER,\
       inBrowserElement INTEGER DEFAULT 0,\
       sameSite INTEGER DEFAULT 0,\
       schemeMap INTEGER DEFAULT 0,\
       isPartitionedAttributeSet INTEGER DEFAULT 0,\
       updateTime INTEGER DEFAULT 0\
     );";

pub fn write_firefox_cookie_store(path: &std::path::Path, rows: &[(&str, &str, &str)]) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let connection = rusqlite::Connection::open(path).unwrap();
    connection.execute_batch(FIREFOX_COOKIE_SCHEMA).unwrap();
    for (index, (name, value, host)) in rows.iter().enumerate() {
        connection
            .execute(
                "INSERT INTO moz_cookies(originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly, sameSite)\
                 VALUES ('', ?1, ?2, ?3, '/', 4102444800000, 0, ?4, 0, 1, 1)",
                rusqlite::params![name, value, host, index as i64],
            )
            .unwrap();
    }
}

pub fn zip_bytes(files: &[(&str, &str)]) -> Vec<u8> {
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut cursor);
        let options = zip::write::SimpleFileOptions::default();
        for (name, body) in files {
            writer.start_file(*name, options).unwrap();
            writer.write_all(body.as_bytes()).unwrap();
        }
        writer.finish().unwrap();
    }
    cursor.into_inner()
}

pub fn socket_handler(
    project: Value,
    polls: Arc<Mutex<usize>>,
) -> impl Fn(&Request) -> Option<Reply> + Send + Sync {
    move |request: &Request| {
        let path = request.path.as_str();
        if path.starts_with("/socket.io/socket.io.js") {
            return Some(Reply::ok("js").header("Set-Cookie", "GCLB=affinity; Path=/"));
        }
        if path.starts_with("/socket.io/1/?projectId=") {
            if request
                .headers
                .get("cookie")
                .is_some_and(|cookie| cookie.contains("GCLB=affinity"))
            {
                return Some(Reply::ok("sid-7:60:60:websocket,xhr-polling"));
            }
            return Some(Reply::status(403));
        }
        if path.starts_with("/socket.io/1/xhr-polling/sid-7") {
            if request.method == "POST" {
                return Some(Reply::ok("1"));
            }
            let mut count = polls.lock().unwrap();
            *count += 1;
            return Some(match *count {
                1 => Reply::ok(frame(&["1::", "2::"])),
                _ => Reply::ok(project_reply(&project)),
            });
        }
        None
    }
}
