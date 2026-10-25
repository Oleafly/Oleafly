//! PDF text for `read_paper` from the main window's pdf.js, which handles
//! more PDFs than the Rust extractor. The task asks the window by token, the
//! window fetches the bytes and answers with one string per page. When no
//! window answers in time, `read_paper` falls back to the Rust extractor.
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use oleafly_research::literature::paper::PdfTextExtractor;
use rand::RngCore;
use tauri::{Emitter, Manager};
use tokio::sync::oneshot;

const MAIN_WINDOW: &str = "main";
const ANSWER_WITHIN: Duration = Duration::from_secs(60);
const MAX_PDF_BYTES: u64 = 100 * 1024 * 1024;
const MAX_PAGES: usize = 2_000;
const UNKNOWN_REQUEST: &str = "This PDF request has ended.";

struct Pending {
    path: PathBuf,
    reply: oneshot::Sender<Result<Vec<String>, String>>,
}

fn pending() -> &'static Mutex<HashMap<String, Pending>> {
    static PENDING: OnceLock<Mutex<HashMap<String, Pending>>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}

fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn new_token() -> String {
    let mut bytes = [0_u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Removes the request when the extractor stops waiting for it.
struct Forget(String);

impl Drop for Forget {
    fn drop(&mut self) {
        lock(pending()).remove(&self.0);
    }
}

pub(crate) struct AppPdfText {
    pub app: tauri::AppHandle,
}

#[async_trait::async_trait]
impl PdfTextExtractor for AppPdfText {
    async fn pages(&self, pdf: PathBuf) -> Result<Vec<String>, String> {
        if self.app.get_webview_window(MAIN_WINDOW).is_none() {
            return Err("No Oleafly window is open to read the PDF.".into());
        }
        let token = new_token();
        let (reply, answer) = oneshot::channel();
        lock(pending()).insert(token.clone(), Pending { path: pdf, reply });
        let _forget = Forget(token.clone());
        self.app
            .emit_to(
                MAIN_WINDOW,
                "research-pdf-text-request",
                serde_json::json!({"token": token}),
            )
            .map_err(|error| error.to_string())?;
        match tokio::time::timeout(ANSWER_WITHIN, answer).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(UNKNOWN_REQUEST.into()),
            Err(_) => Err("The window did not read the PDF in time.".into()),
        }
    }
}

/// The bytes of a PDF the window was asked to read.
#[tauri::command]
pub async fn research_pdf_text_fetch(token: String) -> Result<tauri::ipc::Response, String> {
    let path = lock(pending())
        .get(&token)
        .map(|pending| pending.path.clone())
        .ok_or(UNKNOWN_REQUEST)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let size = std::fs::metadata(&path)
            .map_err(|error| error.to_string())?
            .len();
        if size > MAX_PDF_BYTES {
            return Err(
                "This PDF is larger than 100 MB. Extract the pages you need first.".to_string(),
            );
        }
        std::fs::read(&path).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// The window's answer: the text of each page, or why it could not read them.
#[tauri::command]
pub fn research_pdf_text_result(
    token: String,
    pages: Option<Vec<String>>,
    error: Option<String>,
) -> Result<(), String> {
    let pending = lock(pending()).remove(&token).ok_or(UNKNOWN_REQUEST)?;
    let result = match (pages, error) {
        (Some(mut pages), None) => {
            pages.truncate(MAX_PAGES);
            Ok(pages)
        }
        (_, Some(error)) => Err(error.chars().take(500).collect()),
        (None, None) => Err("The window returned no text.".into()),
    };
    let _ = pending.reply.send(result);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn an_answer_reaches_the_waiting_request_once() {
        let (reply, answer) = oneshot::channel();
        lock(pending()).insert(
            "token-a".into(),
            Pending {
                path: PathBuf::from("paper.pdf"),
                reply,
            },
        );
        research_pdf_text_result("token-a".into(), Some(vec!["page one".into()]), None).unwrap();
        assert_eq!(answer.await.unwrap(), Ok(vec!["page one".to_string()]));
        assert_eq!(
            research_pdf_text_result("token-a".into(), None, Some("late".into())).unwrap_err(),
            UNKNOWN_REQUEST
        );
    }

    #[tokio::test]
    async fn a_failure_is_reported_instead_of_hanging() {
        let (reply, answer) = oneshot::channel();
        lock(pending()).insert(
            "token-b".into(),
            Pending {
                path: PathBuf::from("paper.pdf"),
                reply,
            },
        );
        research_pdf_text_result(
            "token-b".into(),
            None,
            Some("Invalid PDF structure.".into()),
        )
        .unwrap();
        assert_eq!(
            answer.await.unwrap(),
            Err("Invalid PDF structure.".to_string())
        );
    }

    #[test]
    fn tokens_are_random_hex() {
        let token = new_token();
        assert_eq!(token.len(), 32);
        assert!(token.chars().all(|character| character.is_ascii_hexdigit()));
        assert_ne!(token, new_token());
    }
}
