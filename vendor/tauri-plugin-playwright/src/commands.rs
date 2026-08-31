use serde::{Deserialize, Serialize};

use crate::server::PendingResults;

#[tauri::command]
pub async fn pw_result(
    pending: tauri::State<'_, PendingResults>,
    id: String,
    ok: bool,
    data: Option<String>,
    error: Option<String>,
) -> Result<(), String> {
    let mut map = pending.lock().await;
    if let Some(tx) = map.remove(&id) {
        let result = if ok {
            let v: serde_json::Value = data
                .as_deref()
                .and_then(|d| serde_json::from_str(d).ok())
                .unwrap_or(serde_json::Value::Null);
            serde_json::json!({"ok": true, "v": v}).to_string()
        } else {
            let err_str = error.unwrap_or_else(|| "unknown".to_string());
            let escaped = serde_json::to_string(&err_str).unwrap_or_else(|_| r#""unknown""#.to_string());
            format!(r#"{{"ok":false,"e":{}}}"#, escaped)
        };
        let _ = tx.send(result);
    }
    Ok(())
}

/// Wire-level envelope for incoming commands.
///
/// The optional `window` field selects which webview window the command targets.
/// When omitted, the server falls back to the plugin's configured default window
/// label. Existing clients that send a bare `Command` (no `window` field) still
/// parse cleanly thanks to `#[serde(flatten)]` + `Option<String>`, so this
/// wrapper is fully backward compatible with the pre-0.3 wire protocol.
#[derive(Debug, Deserialize)]
pub struct CommandEnvelope {
    /// Webview window label to target. Falls back to the plugin's default when `None`.
    #[serde(default)]
    pub window: Option<String>,

    /// The actual command. Flattened so the discriminator (`type`) and the
    /// command's own fields sit at the top level of the JSON object — matching
    /// the legacy wire format.
    #[serde(flatten)]
    pub cmd: Command,
}

/// A command sent from the Playwright test runner to the plugin.
/// Protocol: newline-delimited JSON over Unix socket or TCP.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    /// Health check — verify the connection is alive
    Ping,

    /// Execute arbitrary JavaScript and return the result
    Eval { script: String },

    // ── Actions (auto-wait for visible + enabled) ─────────────────────

    Click {
        selector: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    Dblclick {
        selector: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    Hover {
        selector: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    Fill {
        selector: String,
        text: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    TypeText {
        selector: String,
        text: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    Press {
        selector: String,
        key: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    Check {
        selector: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    Uncheck {
        selector: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    SelectOption {
        selector: String,
        value: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    Focus {
        selector: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    Blur {
        selector: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    DragAndDrop {
        source: String,
        target: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    SetInputFiles {
        selector: String,
        files: Vec<FilePayload>,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    // ── Queries (auto-wait for element to exist) ──────────────────────

    TextContent {
        selector: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    InnerHtml {
        selector: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    InnerText {
        selector: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    GetAttribute {
        selector: String,
        name: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    InputValue {
        selector: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    BoundingBox {
        selector: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    // ── State checks (instant, no retry) ──────────────────────────────

    IsVisible { selector: String },
    IsChecked { selector: String },
    IsDisabled { selector: String },
    IsEditable { selector: String },

    // ── Bulk queries (no retry, work on zero matches) ─────────────────

    AllTextContents { selector: String },
    AllInnerTexts { selector: String },
    Count { selector: String },

    // ── Waiting ───────────────────────────────────────────────────────

    WaitForSelector {
        selector: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    WaitForFunction {
        expression: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    /// Dispatch a custom DOM event on an element
    DispatchEvent {
        selector: String,
        event_type: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    /// Get computed CSS style value
    GetComputedStyle {
        selector: String,
        property: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    /// Check if an element is focused
    IsFocused { selector: String },

    // ── Page info (no selector) ───────────────────────────────────────

    Title,
    Url,
    Content,
    Goto { url: String },
    Reload,
    GoBack,
    GoForward,

    /// Wait for the URL to match a pattern
    WaitForUrl {
        pattern: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },

    // ── Dialogs ───────────────────────────────────────────────────────

    InstallDialogHandler {
        #[serde(default)]
        default_confirm: bool,
        #[serde(default)]
        default_prompt_text: Option<String>,
    },
    GetDialogs,
    ClearDialogs,

    // ── Network mocking ───────────────────────────────────────────────

    AddNetworkRoute {
        pattern: String,
        status: u16,
        body: String,
        #[serde(default)]
        content_type: Option<String>,
    },
    RemoveNetworkRoute { pattern: String },
    ClearNetworkRoutes,
    GetNetworkRequests,
    ClearNetworkRequests,

    // ── Capture ───────────────────────────────────────────────────────

    Screenshot {
        #[serde(default)]
        path: Option<String>,
    },
    NativeScreenshot {
        #[serde(default)]
        path: Option<String>,
    },
    StartRecording {
        path: String,
        #[serde(default = "default_fps")]
        fps: u32,
    },
    StopRecording,

    // ── Multi-window ──────────────────────────────────────────────────

    /// List all open webview windows. Used by tests to discover newly-opened
    /// windows (e.g., a viewer, a settings dialog) and scope subsequent
    /// commands to them via the envelope's `window` field.
    ListWindows,
}

fn default_timeout() -> u64 {
    5000
}

fn default_fps() -> u32 {
    10
}

/// A file to set on a file input element.
#[derive(Debug, Deserialize)]
pub struct FilePayload {
    pub name: String,
    pub mime_type: String,
    /// Base64-encoded file content.
    pub base64: String,
}

/// Information about a single webview window, returned by `ListWindows`.
#[derive(Debug, Serialize)]
pub struct WindowInfo {
    /// The window's Tauri label (passed to the envelope's `window` field).
    pub label: String,
    /// The URL currently loaded in the window's webview.
    pub url: String,
    /// The window's title bar text.
    pub title: String,
    /// Whether the window is currently visible (not minimised/hidden).
    pub visible: bool,
}

/// Response sent back to the Playwright test runner.
#[derive(Debug, Serialize)]
pub struct Response {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Response {
    pub fn ok(data: impl Into<Option<serde_json::Value>>) -> Self {
        Self {
            ok: true,
            data: data.into(),
            error: None,
        }
    }

    pub fn err(msg: impl Into<String>) -> Self {
        Self {
            ok: false,
            data: None,
            error: Some(msg.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_parses_legacy_bare_command_without_window() {
        // Old clients (pre-0.3) send commands with no `window` field.
        let raw = r##"{"type":"click","selector":"#btn","timeout_ms":1000}"##;
        let env: CommandEnvelope = serde_json::from_str(raw).expect("parse legacy command");
        assert!(env.window.is_none());
        match env.cmd {
            Command::Click { selector, timeout_ms } => {
                assert_eq!(selector, "#btn");
                assert_eq!(timeout_ms, 1000);
            }
            _ => panic!("expected Click variant"),
        }
    }

    #[test]
    fn envelope_parses_command_with_window_field() {
        let raw = r##"{"window":"viewer","type":"click","selector":"#btn"}"##;
        let env: CommandEnvelope = serde_json::from_str(raw).expect("parse scoped command");
        assert_eq!(env.window.as_deref(), Some("viewer"));
        match env.cmd {
            Command::Click { selector, .. } => assert_eq!(selector, "#btn"),
            _ => panic!("expected Click variant"),
        }
    }

    #[test]
    fn envelope_parses_list_windows_command() {
        let raw = r#"{"type":"list_windows"}"#;
        let env: CommandEnvelope = serde_json::from_str(raw).expect("parse list_windows");
        assert!(env.window.is_none());
        assert!(matches!(env.cmd, Command::ListWindows));
    }

    #[test]
    fn envelope_rejects_unknown_command_type() {
        // Lock in the error wording for unknown variants — guards against a
        // future `#[serde(flatten)]` regression silently swallowing typos.
        let raw = r#"{"window":"v","type":"definitely_not_a_command"}"#;
        let err = serde_json::from_str::<CommandEnvelope>(raw).unwrap_err();
        assert!(
            err.to_string().contains("unknown variant"),
            "expected `unknown variant` in error, got: {err}"
        );
    }

    #[test]
    fn window_info_serializes_with_expected_field_names() {
        let info = WindowInfo {
            label: "viewer".into(),
            url: "http://x/v".into(),
            title: "Viewer".into(),
            visible: true,
        };
        let json = serde_json::to_string(&info).unwrap();
        // Field names must match what the TS client expects.
        assert!(json.contains(r#""label":"viewer""#));
        assert!(json.contains(r#""url":"http://x/v""#));
        assert!(json.contains(r#""title":"Viewer""#));
        assert!(json.contains(r#""visible":true"#));
    }
}
