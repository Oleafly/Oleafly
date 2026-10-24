//! `fs/read_text_file`: an agent reads project files through Oleafly, so it
//! sees the text open in the editor, unsaved changes included. Files that
//! are not open are read from disk.
use futures_util::future::BoxFuture;
use serde_json::json;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::oneshot;

/// Bytes read from disk at most.
pub(super) const MAX_READ_BYTES: u64 = 8 * 1024 * 1024;
/// The reply's text as it travels, escaped as a JSON string at most: the ACP
/// frame is 1 MiB, with room left for the envelope.
pub(super) const MAX_REPLY_BYTES: usize = oleafly_acp::limits::MAX_FRAME - 8 * 1024;
const BUFFER_WAIT: Duration = Duration::from_millis(1500);
const MAX_WAITING: usize = 32;

pub(super) const NOT_TEXT: &str = "This file is not text.";
pub(super) const TOO_LARGE: &str =
    "The file is too large to send over ACP. Read it with your own file tool.";
pub(super) const OUTSIDE: &str = "Oleafly only serves files inside this project.";

/// Where open editor text comes from.
pub trait BufferSource: Send + Sync {
    /// The open text of `relative` in the `owner` window, or `None` when the
    /// file is not open there (or the window does not answer in time).
    fn open_buffer(
        &self,
        owner: &str,
        project_id: &str,
        relative: &str,
    ) -> BoxFuture<'static, Option<String>>;
}

/// Asks the owner window for its open text over `acp:buffer-request`.
/// Requests waiting for a window, by request id: the window's label and
/// where its answer goes.
type Waiting = HashMap<String, (String, oneshot::Sender<Option<String>>)>;

pub(crate) struct WindowBuffers {
    app: tauri::AppHandle,
    waiting: Mutex<Waiting>,
}

impl WindowBuffers {
    pub(super) fn new(app: tauri::AppHandle) -> Arc<Self> {
        Arc::new(Self {
            app,
            waiting: Mutex::new(HashMap::new()),
        })
    }

    /// A window's answer. Only the window the request went to may answer.
    pub(super) fn reply(
        &self,
        window: &str,
        request_id: &str,
        content: Option<String>,
    ) -> Result<(), String> {
        if content
            .as_ref()
            .is_some_and(|text| text.len() as u64 > MAX_READ_BYTES)
        {
            return Err("The open file is too large to share with the agent.".into());
        }
        let mut waiting = self
            .waiting
            .lock()
            .map_err(|_| "The agent's file request is unavailable.")?;
        match waiting.get(request_id) {
            Some((owner, _)) if owner == window => {}
            Some(_) => return Err("This file request belongs to another window.".into()),
            None => return Ok(()),
        }
        if let Some((_, sender)) = waiting.remove(request_id) {
            let _ = sender.send(content);
        }
        Ok(())
    }
}

impl BufferSource for Arc<WindowBuffers> {
    fn open_buffer(
        &self,
        owner: &str,
        project_id: &str,
        relative: &str,
    ) -> BoxFuture<'static, Option<String>> {
        use tauri::Emitter;
        let buffers = self.clone();
        let owner = owner.to_owned();
        let payload = json!({
            "requestId": super::types::new_id(),
            "projectId": project_id,
            "path": relative,
        });
        Box::pin(async move {
            let request_id = payload["requestId"].as_str()?.to_owned();
            let (sender, receiver) = oneshot::channel();
            {
                let mut waiting = buffers.waiting.lock().ok()?;
                if waiting.len() >= MAX_WAITING {
                    return None;
                }
                waiting.insert(request_id.clone(), (owner.clone(), sender));
            }
            let sent = buffers.app.emit_to(
                tauri::EventTarget::webview_window(owner.as_str()),
                "acp:buffer-request",
                &payload,
            );
            let answer = if sent.is_ok() {
                tokio::time::timeout(BUFFER_WAIT, receiver)
                    .await
                    .ok()
                    .and_then(Result::ok)
                    .flatten()
            } else {
                None
            };
            if let Ok(mut waiting) = buffers.waiting.lock() {
                waiting.remove(&request_id);
            }
            answer
        })
    }
}

/// `absolute` relative to the project root as the editor names it
/// (forward slashes), when it is inside the root.
fn relative_name(roots: &[&Path], absolute: &Path) -> Option<String> {
    roots.iter().find_map(|root| {
        let rest = absolute.strip_prefix(root).ok()?;
        let parts: Vec<String> = rest
            .components()
            .map(|part| part.as_os_str().to_str().map(str::to_owned))
            .collect::<Option<_>>()?;
        (!parts.is_empty()).then(|| parts.join("/"))
    })
}

/// 1-based `line` and `limit` lines of `text`.
pub(super) fn slice_lines(text: &str, line: Option<u64>, limit: Option<u64>) -> String {
    if line.is_none() && limit.is_none() {
        return text.to_owned();
    }
    let skip = line.unwrap_or(1).saturating_sub(1) as usize;
    let take = limit.map_or(usize::MAX, |limit| limit as usize);
    text.split_inclusive('\n').skip(skip).take(take).collect()
}

/// The text an agent asked for: the open buffer of the owner window when
/// there is one, otherwise the file on disk; then `line`/`limit`. Errors
/// carry the JSON-RPC code to answer with.
#[allow(clippy::too_many_arguments)]
pub(super) async fn read_for_agent(
    source: Option<&dyn BufferSource>,
    owner: Option<&str>,
    project_id: &str,
    roots: &[&Path],
    absolute: &Path,
    line: Option<u64>,
    limit: Option<u64>,
) -> Result<String, (i64, String)> {
    let open = match (source, owner, relative_name(roots, absolute)) {
        (Some(source), Some(owner), Some(relative)) => {
            source.open_buffer(owner, project_id, &relative).await
        }
        _ => None,
    };
    let text = match open {
        Some(text) => text,
        None => {
            let path = absolute.to_path_buf();
            let bytes = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, (i64, String)> {
                let metadata = std::fs::metadata(&path)
                    .map_err(|_| (-32603, "The file could not be read.".to_string()))?;
                if !metadata.is_file() {
                    return Err((-32602, NOT_TEXT.to_string()));
                }
                if metadata.len() > MAX_READ_BYTES {
                    return Err((-32603, TOO_LARGE.to_string()));
                }
                std::fs::read(&path)
                    .map_err(|_| (-32603, "The file could not be read.".to_string()))
            })
            .await
            .map_err(|_| (-32603, "The file could not be read.".to_string()))??;
            String::from_utf8(bytes).map_err(|_| (-32603, NOT_TEXT.to_string()))?
        }
    };
    let text = slice_lines(&text, line, limit);
    if !fits_reply(&text) {
        return Err((-32603, TOO_LARGE.to_string()));
    }
    Ok(text)
}

/// Whether `text` fits a reply once JSON escaping has added its bytes (a
/// byte for each quote, backslash, newline and tab; five for other control
/// characters).
fn fits_reply(text: &str) -> bool {
    // Escaping makes a byte at most six bytes, so only a text between a
    // sixth of the limit and the whole limit needs measuring.
    if text.len() > MAX_REPLY_BYTES {
        return false;
    }
    if text.len() <= (MAX_REPLY_BYTES - 2) / 6 {
        return true;
    }
    serde_json::to_vec(text).is_ok_and(|encoded| encoded.len() <= MAX_REPLY_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_are_one_based_and_limited() {
        let text = "1\n2\n3\n4\n5\n";
        assert_eq!(slice_lines(text, Some(3), Some(2)), "3\n4\n");
        assert_eq!(slice_lines(text, None, Some(1)), "1\n");
        assert_eq!(slice_lines(text, Some(9), None), "");
        assert_eq!(slice_lines(text, None, None), text);
    }

    #[test]
    fn a_reply_must_fit_the_frame_after_json_escaping() {
        // Plain text: its raw size is what counts.
        assert!(fits_reply(&"a".repeat(MAX_REPLY_BYTES - 2)));
        assert!(!fits_reply(&"a".repeat(MAX_REPLY_BYTES)));
        // Quotes double in size: 600 KiB of them are 1.2 MiB on the wire,
        // though the raw text is well under the old 900 KiB limit.
        assert!(!fits_reply(&"\"".repeat(600 * 1024)));
        assert!(fits_reply(&"\"".repeat(400 * 1024)));
        // So do backslashes and newlines; other control characters grow six
        // times.
        assert!(!fits_reply(&"\\".repeat(600 * 1024)));
        assert!(!fits_reply(&"\n".repeat(600 * 1024)));
        assert!(!fits_reply(&"\u{1}".repeat(200 * 1024)));
        assert!(fits_reply("small"));
    }

    #[tokio::test]
    async fn a_file_that_grows_past_the_frame_once_escaped_is_refused() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let quoted = root.join("quoted.json");
        std::fs::write(&quoted, "\"".repeat(700 * 1024)).unwrap();
        let plain = root.join("plain.tex");
        std::fs::write(&plain, "x".repeat(700 * 1024)).unwrap();
        let roots = [root.as_path()];

        let refused = read_for_agent(None, None, "project", &roots, &quoted, None, None).await;
        assert_eq!(refused, Err((-32603, TOO_LARGE.to_string())));
        let text = read_for_agent(None, None, "project", &roots, &plain, None, None)
            .await
            .unwrap();
        assert_eq!(text.len(), 700 * 1024);
    }

    #[test]
    fn relative_names_use_forward_slashes() {
        let root = Path::new("/p");
        assert_eq!(
            relative_name(&[root], Path::new("/p/ch 1/a.tex")).as_deref(),
            Some("ch 1/a.tex")
        );
        assert!(relative_name(&[root], Path::new("/q/a.tex")).is_none());
    }
}
