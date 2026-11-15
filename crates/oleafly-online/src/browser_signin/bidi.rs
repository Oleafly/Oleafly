use std::io::{BufRead as _, BufReader};
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

use futures_util::{SinkExt as _, StreamExt as _};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use super::process::{spawn_with_stderr, Running};
use super::{BrowserCookie, BrowserSignInError, InstalledBrowser};
use crate::browser_cookies::HostPlatform;

const LISTENING: &str = "WebDriver BiDi listening on ";
const SERVER_FILE: &str = "WebDriverBiDiServer.json";
const START_LIMIT: Duration = Duration::from_secs(45);
const CALL_LIMIT: Duration = Duration::from_secs(15);
const START_POLL: Duration = Duration::from_millis(200);
const MAX_MESSAGE_BYTES: usize = 16 * 1024 * 1024;

const USER_PREFS: &str = "user_pref(\"browser.shell.checkDefaultBrowser\", false);\n\
user_pref(\"browser.aboutwelcome.enabled\", false);\n\
user_pref(\"browser.startup.homepage_override.mstone\", \"ignore\");\n\
user_pref(\"datareporting.policy.dataSubmissionPolicyBypassNotification\", true);\n\
user_pref(\"toolkit.telemetry.reportingpolicy.firstRun\", false);\n\
user_pref(\"trailhead.firstrun.didSeeAboutWelcome\", true);\n";

pub(crate) fn firefox_args(platform: HostPlatform, profile: &Path, url: &str) -> Vec<String> {
    let mut args = vec![
        "--no-remote".to_string(),
        "--new-instance".to_string(),
        "--profile".to_string(),
        profile.display().to_string(),
        "--remote-debugging-port=0".to_string(),
    ];
    match platform {
        HostPlatform::Macos => args.push("--foreground".to_string()),
        HostPlatform::Windows => args.push("--wait-for-browser".to_string()),
        HostPlatform::Linux | HostPlatform::Other => {}
    }
    args.push(url.to_string());
    args
}

pub(crate) fn loopback_endpoint(announced: &str) -> Option<(String, u16)> {
    let url = url::Url::parse(announced.trim()).ok()?;
    if url.scheme() != "ws" {
        return None;
    }
    let host = match url.host()? {
        url::Host::Domain(domain) if domain.eq_ignore_ascii_case("localhost") => {
            "127.0.0.1".to_string()
        }
        url::Host::Ipv4(address) if address.is_loopback() => address.to_string(),
        url::Host::Ipv6(address) if address.is_loopback() => address.to_string(),
        _ => return None,
    };
    Some((host, url.port()?))
}

pub(crate) fn announced_in(line: &str) -> Option<(String, u16)> {
    let (_, rest) = line.split_once(LISTENING)?;
    loopback_endpoint(rest.split_whitespace().next()?)
}

pub(crate) fn endpoint_in_server_file(text: &str) -> Option<(String, u16)> {
    let value: Value = serde_json::from_str(text).ok()?;
    let host = value["ws_host"].as_str()?;
    let port = u16::try_from(value["ws_port"].as_u64()?).ok()?;
    loopback_endpoint(&format!("ws://{host}:{port}"))
}

pub(crate) fn cookies_from(result: &Value) -> Vec<BrowserCookie> {
    result["cookies"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|cookie| {
            if cookie["value"]["type"] != "string" {
                return None;
            }
            Some(BrowserCookie {
                name: cookie["name"].as_str()?.to_string(),
                value: cookie["value"]["value"].as_str()?.to_string(),
                domain: cookie["domain"].as_str().map(str::to_string),
                path: cookie["path"].as_str().map(str::to_string),
                secure: cookie["secure"].as_bool().unwrap_or(false),
            })
        })
        .collect()
}

pub(crate) fn context_urls(result: &Value) -> Vec<String> {
    result["contexts"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|context| context["url"].as_str().map(str::to_string))
        .collect()
}

pub(super) struct Bidi {
    running: Running,
    socket: WebSocketStream<TcpStream>,
    next_id: u64,
}

async fn announced_endpoint(
    running: &mut Running,
    lines: &mut mpsc::UnboundedReceiver<String>,
    profile: &Path,
) -> Result<(String, u16), BrowserSignInError> {
    let started = Instant::now();
    let server_file = profile.join(SERVER_FILE);
    while started.elapsed() < START_LIMIT {
        while let Ok(line) = lines.try_recv() {
            if let Some(endpoint) = announced_in(&line) {
                return Ok(endpoint);
            }
        }
        if let Some(endpoint) = std::fs::read_to_string(&server_file)
            .ok()
            .and_then(|text| endpoint_in_server_file(&text))
        {
            return Ok(endpoint);
        }
        if running.exited() {
            return Err(BrowserSignInError::Launch(
                "the browser closed before it was ready".into(),
            ));
        }
        tokio::time::sleep(START_POLL).await;
    }
    Err(BrowserSignInError::Launch(
        "the browser did not open its sign-in connection".into(),
    ))
}

impl Bidi {
    pub(super) async fn launch(
        browser: &InstalledBrowser,
        platform: HostPlatform,
        profile: &Path,
        url: &str,
    ) -> Result<Self, BrowserSignInError> {
        let launch_error = |error: std::io::Error| BrowserSignInError::Launch(error.to_string());
        std::fs::write(profile.join("user.js"), USER_PREFS).map_err(launch_error)?;
        let mut command = Command::new(&browser.path);
        command.args(firefox_args(platform, profile, url));
        let (mut running, stderr) = spawn_with_stderr(command).map_err(launch_error)?;
        let (sender, mut lines) = mpsc::unbounded_channel();
        std::thread::spawn(move || {
            let mut announced = false;
            for line in BufReader::new(stderr).lines() {
                let Ok(line) = line else {
                    return;
                };
                if !announced && line.contains(LISTENING) {
                    announced = true;
                    let _ = sender.send(line);
                }
            }
        });
        let (host, port) = announced_endpoint(&mut running, &mut lines, profile).await?;
        let stream = TcpStream::connect((host.as_str(), port))
            .await
            .map_err(launch_error)?;
        let authority = if host.contains(':') {
            format!("[{host}]:{port}")
        } else {
            format!("{host}:{port}")
        };
        let config = tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default()
            .max_message_size(Some(MAX_MESSAGE_BYTES))
            .max_frame_size(Some(MAX_MESSAGE_BYTES));
        let (socket, _) = tokio_tungstenite::client_async_with_config(
            format!("ws://{authority}/session"),
            stream,
            Some(config),
        )
        .await
        .map_err(|error| BrowserSignInError::Launch(error.to_string()))?;
        let mut session = Self {
            running,
            socket,
            next_id: 0,
        };
        session
            .call(
                "session.new",
                json!({ "capabilities": { "alwaysMatch": { "unhandledPromptBehavior": "ignore" } } }),
            )
            .await?;
        Ok(session)
    }

    async fn call(&mut self, method: &str, params: Value) -> Result<Value, BrowserSignInError> {
        self.next_id += 1;
        let id = self.next_id;
        let text = json!({ "id": id, "method": method, "params": params }).to_string();
        if self.socket.send(Message::text(text)).await.is_err() {
            return Err(self.gone());
        }
        let reply = tokio::time::timeout(CALL_LIMIT, async {
            while let Some(Ok(message)) = self.socket.next().await {
                let Message::Text(text) = message else {
                    continue;
                };
                let Ok(value) = serde_json::from_str::<Value>(text.as_str()) else {
                    continue;
                };
                if value["id"].as_u64() == Some(id) {
                    return Some(value);
                }
            }
            None
        })
        .await;
        match reply {
            Ok(Some(value)) if value["type"] == "success" => Ok(value["result"].clone()),
            Ok(Some(value)) => Err(BrowserSignInError::Protocol(format!(
                "{}: {}",
                value["error"].as_str().unwrap_or("error"),
                value["message"].as_str().unwrap_or_default()
            ))),
            Ok(None) | Err(_) => Err(self.gone()),
        }
    }

    fn gone(&mut self) -> BrowserSignInError {
        if self.running.exited() {
            BrowserSignInError::Cancelled
        } else {
            BrowserSignInError::Protocol("the browser stopped answering".into())
        }
    }

    pub(super) async fn pages(&mut self) -> Result<Vec<String>, BrowserSignInError> {
        let result = self
            .call("browsingContext.getTree", json!({ "maxDepth": 0 }))
            .await?;
        Ok(context_urls(&result))
    }

    pub(super) async fn cookies(&mut self) -> Result<Vec<BrowserCookie>, BrowserSignInError> {
        let result = self.call("storage.getCookies", json!({})).await?;
        Ok(cookies_from(&result))
    }

    pub(super) async fn close(&mut self) {
        if !self.running.exited() {
            let _ = tokio::time::timeout(
                Duration::from_secs(3),
                self.call("browser.close", json!({})),
            )
            .await;
        }
        let _ = self.socket.close(None).await;
        self.running.finish().await;
    }
}
