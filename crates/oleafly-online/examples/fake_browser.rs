use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::Duration;

use futures_util::{SinkExt as _, StreamExt as _};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message;

const LISTENING: &str = "WebDriver BiDi listening on ";
const TEST_COPY_PREFIX: &str = "fake-";

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    SignIn,
    Close,
    Exit,
    DropPipe,
    Stall,
    Garbage,
}

fn test_copy() -> Option<(String, PathBuf)> {
    let exe = std::env::current_exe().ok()?;
    let stem = exe.file_stem()?.to_str()?;
    let mode = stem.strip_prefix(TEST_COPY_PREFIX)?.to_string();
    Some((mode, exe.with_extension("log")))
}

fn mode() -> Mode {
    match test_copy().map(|(mode, _)| mode).as_deref() {
        Some("close") => Mode::Close,
        Some("exit") => Mode::Exit,
        Some("drop-pipe") => Mode::DropPipe,
        Some("stall") => Mode::Stall,
        Some("garbage") => Mode::Garbage,
        _ => Mode::SignIn,
    }
}

fn log(line: &str) {
    if let Some((_, path)) = test_copy() {
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{line}");
        }
    }
}

struct Login {
    cookie: Option<(String, String)>,
    landed: String,
}

fn login(url: &str) -> Login {
    let failed = || Login {
        cookie: None,
        landed: url.to_string(),
    };
    let Ok(parsed) = url::Url::parse(url) else {
        return failed();
    };
    let (Some(host), Some(port)) = (parsed.host_str(), parsed.port_or_known_default()) else {
        return failed();
    };
    let Ok(mut stream) = TcpStream::connect((host, port)) else {
        return failed();
    };
    let request = format!(
        "GET {} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n",
        parsed.path()
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return failed();
    }
    let mut reply = String::new();
    let _ = stream.read_to_string(&mut reply);
    let head = reply.split("\r\n\r\n").next().unwrap_or_default();
    let header = |name: &str| {
        head.lines().find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.trim()
                .eq_ignore_ascii_case(name)
                .then(|| value.trim().to_string())
        })
    };
    let cookie = header("set-cookie").and_then(|value| {
        let pair = value.split(';').next()?;
        let (name, value) = pair.split_once('=')?;
        Some((name.trim().to_string(), value.trim().to_string()))
    });
    let landed = header("location")
        .and_then(|location| parsed.join(&location).ok())
        .map(|next| next.to_string())
        .unwrap_or_else(|| url.to_string());
    Login { cookie, landed }
}

struct Page {
    mode: Mode,
    url: String,
    polls: u32,
    login: Option<Login>,
}

impl Page {
    fn new(mode: Mode, url: String) -> Self {
        Self {
            mode,
            url,
            polls: 0,
            login: None,
        }
    }

    fn urls(&mut self) -> Vec<String> {
        self.polls += 1;
        match self.mode {
            Mode::Close if self.polls > 1 => Vec::new(),
            Mode::SignIn if self.polls > 1 => {
                let url = self.url.clone();
                let landed = self.login.get_or_insert_with(|| login(&url)).landed.clone();
                vec![landed]
            }
            _ => vec![self.url.clone()],
        }
    }

    fn cookies(&self) -> Vec<(String, String, String)> {
        let host = url::Url::parse(&self.url)
            .ok()
            .and_then(|url| url.host_str().map(str::to_string))
            .unwrap_or_default();
        let mut cookies = vec![(
            "SID".to_string(),
            "google".to_string(),
            ".google.com".to_string(),
        )];
        if let Some((name, value)) = self.login.as_ref().and_then(|login| login.cookie.clone()) {
            cookies.push((name, value, host));
        }
        cookies
    }
}

fn pipe_ends(args: &[String]) -> Option<(File, File)> {
    #[cfg(unix)]
    {
        let _ = args;
        use std::os::fd::FromRawFd as _;
        // SAFETY: the parent placed the pipe on descriptors 3 and 4 before
        // exec, and nothing else in this process owns them.
        Some(unsafe { (File::from_raw_fd(3), File::from_raw_fd(4)) })
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::{FromRawHandle as _, RawHandle};
        let value = args
            .iter()
            .find_map(|arg| arg.strip_prefix("--remote-debugging-io-pipes="))?;
        let (read, write) = value.split_once(',')?;
        let read: usize = read.parse().ok()?;
        let write: usize = write.parse().ok()?;
        // SAFETY: the parent made these two pipe handles inheritable and
        // passed their values on the command line for this process alone.
        Some(unsafe {
            (
                File::from_raw_handle(read as RawHandle),
                File::from_raw_handle(write as RawHandle),
            )
        })
    }
}

fn chromium(args: &[String], mode: Mode, url: String) {
    let Some((mut reader, mut writer)) = pipe_ends(args) else {
        log("no pipe");
        std::process::exit(3);
    };
    if mode == Mode::DropPipe {
        drop(reader);
        drop(writer);
        std::thread::sleep(Duration::from_secs(60));
        return;
    }
    if mode == Mode::Garbage {
        let _ = writer.write_all(b"not json\0");
        let _ = writer.write_all(&vec![b'x'; 17 * 1024 * 1024]);
        std::thread::sleep(Duration::from_secs(60));
        return;
    }
    let mut page = Page::new(mode, url);
    let mut pending = Vec::new();
    let mut buffer = [0_u8; 4096];
    loop {
        let read = match reader.read(&mut buffer) {
            Ok(0) | Err(_) => {
                log("pipe closed");
                return;
            }
            Ok(read) => read,
        };
        pending.extend_from_slice(&buffer[..read]);
        while let Some(end) = pending.iter().position(|byte| *byte == 0) {
            let frame: Vec<u8> = pending.drain(..=end).collect();
            let Ok(message) = serde_json::from_slice::<Value>(&frame[..frame.len() - 1]) else {
                continue;
            };
            let id = message["id"].clone();
            let method = message["method"].as_str().unwrap_or_default();
            log(&format!("cdp {method}"));
            let result = match method {
                "Target.getTargets" => json!({ "targetInfos": page
                    .urls()
                    .into_iter()
                    .map(|url| json!({ "type": "page", "url": url }))
                    .chain([json!({ "type": "service_worker", "url": "https://elsewhere.example/sw.js" })])
                    .collect::<Vec<_>>() }),
                "Storage.getCookies" => json!({ "cookies": page
                    .cookies()
                    .into_iter()
                    .map(|(name, value, domain)| json!({ "name": name, "value": value, "domain": domain, "path": "/", "secure": false }))
                    .collect::<Vec<_>>() }),
                "Browser.close" => {
                    let _ = writer.write_all(&reply(&id, json!({})));
                    log("closed by request");
                    std::process::exit(0);
                }
                _ => {
                    let _ = writer.write_all(&error_reply(&id));
                    continue;
                }
            };
            if writer.write_all(&reply(&id, result)).is_err() {
                return;
            }
        }
    }
}

fn reply(id: &Value, result: Value) -> Vec<u8> {
    let mut frame = serde_json::to_vec(&json!({ "id": id, "result": result })).unwrap_or_default();
    frame.push(0);
    frame
}

fn error_reply(id: &Value) -> Vec<u8> {
    let mut frame =
        serde_json::to_vec(&json!({ "id": id, "error": { "code": -32601, "message": "unknown" } }))
            .unwrap_or_default();
    frame.push(0);
    frame
}

async fn firefox(mode: Mode, url: String) {
    let listener = match tokio::net::TcpListener::bind("127.0.0.1:0").await {
        Ok(listener) => listener,
        Err(_) => std::process::exit(4),
    };
    let port = listener
        .local_addr()
        .map(|address| address.port())
        .unwrap_or_default();
    eprintln!("1700000000000\tINFO\tRead port: {port}");
    eprintln!("{LISTENING}ws://127.0.0.1:{port}");
    if mode == Mode::DropPipe {
        drop(listener);
        tokio::time::sleep(Duration::from_secs(60)).await;
        return;
    }
    let Ok((stream, _)) = listener.accept().await else {
        return;
    };
    let Ok(mut socket) = tokio_tungstenite::accept_async(stream).await else {
        return;
    };
    if mode == Mode::Garbage {
        let _ = socket.send(Message::text("not json")).await;
        let _ = socket.close(None).await;
        tokio::time::sleep(Duration::from_secs(60)).await;
        return;
    }
    let mut page = Page::new(mode, url);
    while let Some(Ok(message)) = socket.next().await {
        let Message::Text(text) = message else {
            continue;
        };
        let Ok(command) = serde_json::from_str::<Value>(text.as_str()) else {
            continue;
        };
        let id = command["id"].clone();
        let method = command["method"].as_str().unwrap_or_default().to_string();
        log(&format!("bidi {method}"));
        let result = match method.as_str() {
            "session.new" => json!({ "sessionId": "fake", "capabilities": {} }),
            "browsingContext.getTree" => json!({ "contexts": page
                .urls()
                .into_iter()
                .map(|url| json!({ "context": "top", "url": url, "children": [] }))
                .collect::<Vec<_>>() }),
            "storage.getCookies" => json!({ "cookies": page
                .cookies()
                .into_iter()
                .map(|(name, value, domain)| json!({ "name": name, "value": { "type": "string", "value": value }, "domain": domain, "path": "/", "secure": false }))
                .collect::<Vec<_>>(), "partitionKey": {} }),
            "browser.close" => {
                let _ = socket
                    .send(Message::text(
                        json!({ "type": "success", "id": id, "result": {} }).to_string(),
                    ))
                    .await;
                log("closed by request");
                std::process::exit(0);
            }
            _ => {
                let _ = socket
                    .send(Message::text(json!({ "type": "error", "id": id, "error": "unknown command", "message": method }).to_string()))
                    .await;
                continue;
            }
        };
        let _ = socket
            .send(Message::text(
                json!({ "type": "success", "id": id, "result": result }).to_string(),
            ))
            .await;
    }
    log("socket closed");
}

pub fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mode = mode();
    log(&format!("pid {}", std::process::id()));
    log(&format!("args {}", args.join(" ")));
    if mode == Mode::Exit {
        std::process::exit(1);
    }
    let url = args
        .iter()
        .rev()
        .find(|arg| !arg.starts_with('-'))
        .cloned()
        .unwrap_or_default();
    if args.iter().any(|arg| arg == "--remote-debugging-pipe") {
        chromium(&args, mode, url);
        return;
    }
    if args
        .iter()
        .any(|arg| arg.starts_with("--remote-debugging-port"))
    {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(firefox(mode, url));
        return;
    }
    log("unknown browser arguments");
    std::process::exit(2);
}
