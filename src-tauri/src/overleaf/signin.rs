use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::webview::PageLoadEvent;
use tauri::{
    AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tokio::sync::oneshot;

use super::client::Http;
use super::session::{self, Session};
use crate::app_error::AppError;

const LABEL_PREFIX: &str = "overleaf-sign-in-";
const SIGN_IN_LIMIT: Duration = Duration::from_secs(20 * 60);

type Pending = Arc<Mutex<Option<oneshot::Sender<Result<Session, String>>>>>;

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(crate) fn cancelled() -> String {
    AppError::new("overleaf.sign_in_cancelled").into()
}

pub(crate) fn is_dashboard(url: &Url, base: &str) -> bool {
    let Ok(base_url) = Url::parse(base) else {
        return false;
    };
    if url.origin() != base_url.origin() {
        return false;
    }
    let prefix = base_url.path().trim_end_matches('/');
    let Some(rest) = url.path().strip_prefix(prefix) else {
        return false;
    };
    matches!(rest, "/project" | "/project/")
}

pub(crate) async fn session_from_cookie(base: &str, cookie: String) -> Result<Session, String> {
    let http = Http::new(base)?;
    let dashboard = http.dashboard(&cookie).await?;
    let cookie =
        session::merge_set_cookies(&cookie, dashboard.set_cookies.iter().map(String::as_str));
    Ok(Session {
        cookie,
        user_id: dashboard.user_id,
        email: dashboard.email,
    })
}

fn settle(pending: &Pending, outcome: Result<Session, String>) {
    let sender = pending
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take();
    if let Some(sender) = sender {
        let _ = sender.send(outcome);
    }
}

fn close_previous<R: Runtime>(app: &AppHandle<R>) {
    for (label, window) in app.webview_windows() {
        if label.starts_with(LABEL_PREFIX) {
            let _ = window.destroy();
        }
    }
}

async fn capture<R: Runtime>(
    window: WebviewWindow<R>,
    base: String,
    pending: Pending,
    capturing: Arc<AtomicBool>,
) {
    let cookies = Url::parse(&base)
        .map_err(|error| error.to_string())
        .and_then(|url| {
            window
                .cookies()
                .map(|all| {
                    all.into_iter()
                        .filter(|cookie| {
                            session::cookie_applies(
                                cookie.domain(),
                                cookie.path(),
                                cookie.secure().unwrap_or(false),
                                &url,
                            )
                        })
                        .collect::<Vec<_>>()
                })
                .map_err(|error| error.to_string())
        });
    let outcome = match cookies {
        Ok(cookies) => {
            let header = session::cookie_header(
                cookies
                    .iter()
                    .map(|cookie| (cookie.name().to_string(), cookie.value().to_string())),
            );
            if header.is_empty() {
                Err(AppError::new("overleaf.sign_in_failed").into())
            } else {
                session_from_cookie(&base, header).await
            }
        }
        Err(detail) => Err(AppError::new("overleaf.sign_in_failed")
            .detail(detail)
            .into()),
    };
    match outcome {
        Ok(session) => {
            settle(&pending, Ok(session));
            let _ = window.destroy();
        }
        Err(error) if client_is_expired(&error) => {
            capturing.store(false, Ordering::SeqCst);
        }
        Err(error) => {
            settle(&pending, Err(error));
            let _ = window.destroy();
        }
    }
}

fn client_is_expired(error: &str) -> bool {
    super::client::is_expired(error)
}

pub(crate) async fn sign_in_with_window<R: Runtime>(
    app: &AppHandle<R>,
    base: &str,
    title: &str,
) -> Result<Session, String> {
    close_previous(app);
    let login = Url::parse(&format!("{base}/login")).map_err(|error| error.to_string())?;
    let label = format!("{LABEL_PREFIX}{}", SEQUENCE.fetch_add(1, Ordering::SeqCst));
    let (sender, receiver) = oneshot::channel();
    let pending: Pending = Arc::new(Mutex::new(Some(sender)));
    let capturing = Arc::new(AtomicBool::new(false));
    let load_base = base.to_string();
    let load_pending = pending.clone();
    let load_capturing = capturing.clone();
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(login))
        .title(title)
        .inner_size(520.0, 760.0)
        .min_inner_size(420.0, 560.0)
        .center()
        .focused(true)
        .incognito(true)
        .on_navigation(|url| matches!(url.scheme(), "https" | "http"))
        .on_page_load(move |window, payload| {
            if payload.event() != PageLoadEvent::Finished
                || !is_dashboard(payload.url(), &load_base)
            {
                return;
            }
            if load_capturing.swap(true, Ordering::SeqCst) {
                return;
            }
            tauri::async_runtime::spawn(capture(
                window,
                load_base.clone(),
                load_pending.clone(),
                load_capturing.clone(),
            ));
        })
        .build()
        .map_err(|error| String::from(AppError::new("overleaf.sign_in_failed").detail(error)))?;
    let close_pending = pending.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            settle(&close_pending, Err(cancelled()));
        }
    });
    match tokio::time::timeout(SIGN_IN_LIMIT, receiver).await {
        Ok(Ok(outcome)) => outcome,
        Ok(Err(_)) => Err(cancelled()),
        Err(_) => {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.destroy();
            }
            Err(cancelled())
        }
    }
}
