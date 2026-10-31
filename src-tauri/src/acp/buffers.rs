use futures_util::future::BoxFuture;
use serde_json::json;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::oneshot;

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

pub trait BufferSource: Send + Sync {
    fn open_buffer(
        &self,
        owner: &str,
        project_id: &str,
        relative: &str,
    ) -> BoxFuture<'static, Option<String>>;
}

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
        use tauri::{Emitter, Manager};
        if self.app.get_webview_window(owner).is_none() {
            return Box::pin(async { None });
        }
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

pub(super) fn slice_lines(text: &str, line: Option<u64>, limit: Option<u64>) -> String {
    if line.is_none() && limit.is_none() {
        return text.to_owned();
    }
    let skip = line.unwrap_or(1).saturating_sub(1) as usize;
    let take = limit.map_or(usize::MAX, |limit| limit as usize);
    text.split_inclusive('\n').skip(skip).take(take).collect()
}

fn open_no_follow(path: &Path) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options.open(path)
}

fn read_inside(path: &Path, within: &Path) -> Result<Vec<u8>, (i64, String)> {
    use std::io::Read as _;
    let unreadable = || (-32603, "The file could not be read.".to_string());
    let real = path.canonicalize().map_err(|_| unreadable())?;
    if !real.starts_with(within) {
        return Err((-32602, OUTSIDE.to_string()));
    }
    let file = open_no_follow(&real).map_err(|_| unreadable())?;
    let metadata = file.metadata().map_err(|_| unreadable())?;
    if !metadata.is_file() {
        return Err((-32602, NOT_TEXT.to_string()));
    }
    if metadata.len() > MAX_READ_BYTES {
        return Err((-32603, TOO_LARGE.to_string()));
    }
    if real.canonicalize().ok().as_deref() != Some(real.as_path()) {
        return Err((-32602, OUTSIDE.to_string()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        let named = std::fs::symlink_metadata(&real).map_err(|_| unreadable())?;
        if (named.dev(), named.ino()) != (metadata.dev(), metadata.ino()) {
            return Err((-32602, OUTSIDE.to_string()));
        }
    }
    let mut bytes = Vec::new();
    file.take(MAX_READ_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| unreadable())?;
    if bytes.len() as u64 > MAX_READ_BYTES {
        return Err((-32603, TOO_LARGE.to_string()));
    }
    Ok(bytes)
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn read_for_agent(
    source: Option<&dyn BufferSource>,
    owner: Option<&str>,
    project_id: &str,
    roots: &[&Path],
    within: &Path,
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
            let within = within.to_path_buf();
            let bytes = tokio::task::spawn_blocking(move || read_inside(&path, &within))
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
        assert!(fits_reply(&"a".repeat(MAX_REPLY_BYTES - 2)));
        assert!(!fits_reply(&"a".repeat(MAX_REPLY_BYTES)));
        // Quotes double in size: 600 KiB of them are 1.2 MiB on the wire,
        // though the raw text is well under the old 900 KiB limit.
        assert!(!fits_reply(&"\"".repeat(600 * 1024)));
        assert!(fits_reply(&"\"".repeat(400 * 1024)));
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

        let refused =
            read_for_agent(None, None, "project", &roots, &root, &quoted, None, None).await;
        assert_eq!(refused, Err((-32603, TOO_LARGE.to_string())));
        let text = read_for_agent(None, None, "project", &roots, &root, &plain, None, None)
            .await
            .unwrap();
        assert_eq!(text.len(), 700 * 1024);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_link_made_after_the_check_does_not_lead_out_of_the_project() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("project");
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let secret = temp.path().join("id_ed25519");
        std::fs::write(&secret, "private key").unwrap();
        let notes = root.join("notes.md");
        std::os::unix::fs::symlink(&secret, &notes).unwrap();
        let roots = [root.as_path()];
        let refused =
            read_for_agent(None, None, "project", &roots, &root, &notes, None, None).await;
        assert_eq!(refused, Err((-32602, OUTSIDE.to_string())));
        let outside = temp.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("a.tex"), "outside").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("chapters")).unwrap();
        let refused = read_for_agent(
            None,
            None,
            "project",
            &roots,
            &root,
            &root.join("chapters/a.tex"),
            None,
            None,
        )
        .await;
        assert_eq!(refused, Err((-32602, OUTSIDE.to_string())));
        std::fs::write(root.join("main.tex"), "inside").unwrap();
        std::os::unix::fs::symlink(root.join("main.tex"), root.join("alias.tex")).unwrap();
        let text = read_for_agent(
            None,
            None,
            "project",
            &roots,
            &root,
            &root.join("alias.tex"),
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(text, "inside");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_named_pipe_is_refused_without_waiting() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let pipe = root.join("pipe");
        let name = std::ffi::CString::new(pipe.to_string_lossy().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
        let roots = [root.as_path()];
        let refused = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            read_for_agent(None, None, "project", &roots, &root, &pipe, None, None),
        )
        .await
        .expect("the read does not wait for a writer");
        assert_eq!(refused, Err((-32602, NOT_TEXT.to_string())));
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
