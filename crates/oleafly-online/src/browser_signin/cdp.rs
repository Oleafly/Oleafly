use std::io::{Read as _, Write as _};
use std::path::Path;
use std::process::Command;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::process::{spawn_with_pipe, Running};
use super::{BrowserCookie, BrowserSignInError, InstalledBrowser};
use crate::browser_cookies::HostPlatform;

const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
const CALL_LIMIT: Duration = Duration::from_secs(15);

#[derive(Default)]
pub(crate) struct Frames {
    pending: Vec<u8>,
}

impl Frames {
    pub(crate) fn push(&mut self, bytes: &[u8]) -> Result<Vec<Vec<u8>>, BrowserSignInError> {
        let mut frames = Vec::new();
        for chunk in bytes.split_inclusive(|byte| *byte == 0) {
            match chunk.split_last() {
                Some((0, body)) => {
                    self.pending.extend_from_slice(body);
                    frames.push(std::mem::take(&mut self.pending));
                }
                _ => self.pending.extend_from_slice(chunk),
            }
            if self.pending.len() > MAX_FRAME_BYTES {
                return Err(BrowserSignInError::Protocol(
                    "the browser sent a message that is too large".into(),
                ));
            }
        }
        Ok(frames)
    }
}

pub(crate) fn chromium_args(platform: HostPlatform, profile: &Path, url: &str) -> Vec<String> {
    let mut args = vec![
        format!("--user-data-dir={}", profile.display()),
        "--remote-debugging-pipe".to_string(),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
    ];
    match platform {
        HostPlatform::Macos => args.push("--use-mock-keychain".to_string()),
        HostPlatform::Linux => args.push("--password-store=basic".to_string()),
        HostPlatform::Windows | HostPlatform::Other => {}
    }
    args.push(url.to_string());
    args
}

pub(crate) fn cookies_from(result: &Value) -> Vec<BrowserCookie> {
    result["cookies"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|cookie| {
            Some(BrowserCookie {
                name: cookie["name"].as_str()?.to_string(),
                value: cookie["value"].as_str()?.to_string(),
                domain: cookie["domain"].as_str().map(str::to_string),
                path: cookie["path"].as_str().map(str::to_string),
                secure: cookie["secure"].as_bool().unwrap_or(false),
            })
        })
        .collect()
}

pub(crate) fn page_urls(result: &Value) -> Vec<String> {
    result["targetInfos"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|target| target["type"] == "page")
        .filter_map(|target| target["url"].as_str().map(str::to_string))
        .collect()
}

pub(super) struct Cdp {
    running: Running,
    outgoing: Option<std::sync::mpsc::Sender<Vec<u8>>>,
    incoming: mpsc::UnboundedReceiver<Value>,
    next_id: u64,
}

impl Cdp {
    pub(super) fn launch(
        browser: &InstalledBrowser,
        platform: HostPlatform,
        profile: &Path,
        url: &str,
    ) -> Result<Self, BrowserSignInError> {
        let mut command = Command::new(&browser.path);
        command.args(chromium_args(platform, profile, url));
        let piped = spawn_with_pipe(command)
            .map_err(|error| BrowserSignInError::Launch(error.to_string()))?;
        let (sender, incoming) = mpsc::unbounded_channel();
        let mut reader = piped.from_browser;
        std::thread::spawn(move || {
            let mut frames = Frames::default();
            let mut buffer = vec![0_u8; 64 * 1024];
            loop {
                let read = match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => return,
                    Ok(read) => read,
                };
                let Ok(decoded) = frames.push(&buffer[..read]) else {
                    return;
                };
                for frame in decoded {
                    if let Ok(message) = serde_json::from_slice::<Value>(&frame) {
                        if sender.send(message).is_err() {
                            return;
                        }
                    }
                }
            }
        });
        let (outgoing, queue) = std::sync::mpsc::channel::<Vec<u8>>();
        let mut writer = piped.to_browser;
        std::thread::spawn(move || {
            while let Ok(frame) = queue.recv() {
                if writer.write_all(&frame).is_err() || writer.flush().is_err() {
                    return;
                }
            }
        });
        Ok(Self {
            running: piped.running,
            outgoing: Some(outgoing),
            incoming,
            next_id: 0,
        })
    }

    pub(super) async fn call(
        &mut self,
        method: &str,
        params: Value,
    ) -> Result<Value, BrowserSignInError> {
        self.next_id += 1;
        let id = self.next_id;
        let mut frame =
            serde_json::to_vec(&json!({ "id": id, "method": method, "params": params }))
                .map_err(|error| BrowserSignInError::Protocol(error.to_string()))?;
        frame.push(0);
        let sent = self
            .outgoing
            .as_ref()
            .is_some_and(|outgoing| outgoing.send(frame).is_ok());
        if !sent {
            return Err(self.gone());
        }
        let reply = tokio::time::timeout(CALL_LIMIT, async {
            while let Some(message) = self.incoming.recv().await {
                if message["id"].as_u64() == Some(id) {
                    return Some(message);
                }
            }
            None
        })
        .await;
        match reply {
            Ok(Some(message)) => match message.get("error") {
                Some(error) => Err(BrowserSignInError::Protocol(error.to_string())),
                None => Ok(message["result"].clone()),
            },
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
        let result = self.call("Target.getTargets", json!({})).await?;
        Ok(page_urls(&result))
    }

    pub(super) async fn cookies(&mut self) -> Result<Vec<BrowserCookie>, BrowserSignInError> {
        let result = self.call("Storage.getCookies", json!({})).await?;
        Ok(cookies_from(&result))
    }

    pub(super) async fn close(&mut self) {
        if !self.running.exited() {
            let _ = tokio::time::timeout(
                Duration::from_secs(3),
                self.call("Browser.close", json!({})),
            )
            .await;
        }
        self.outgoing = None;
        self.running.finish().await;
    }
}
