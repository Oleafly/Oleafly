use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent, PageLoadPayload, WebviewBuilder},
    window::WindowBuilder,
    AppHandle, Emitter, EventTarget, Manager, PhysicalPosition, PhysicalSize, Runtime, Url,
    Webview, WebviewUrl, Window, WindowEvent,
};

pub const CHROME_HEIGHT_LOGICAL: f64 = 88.0;

const WINDOW_TITLE: &str = "Oleafly Browser";
const WINDOW_PREFIX: &str = "oleafly-browser-window-";
const CHROME_PREFIX: &str = "oleafly-browser-chrome-";
const PANE_PREFIX: &str = "oleafly-browser-pane-";
const MAIN_LABEL: &str = "main";

const PAGE_LOAD_EVENT: &str = "browser-page-load";
const TAB_OPENED_EVENT: &str = "browser-tab-opened";
const TAB_CLOSED_EVENT: &str = "browser-tab-closed";
const TAB_ACTIVATED_EVENT: &str = "browser-tab-activated";
const TITLE_EVENT: &str = "browser-title";
const WINDOW_CLOSED_EVENT: &str = "browser-window-closed";

static SEQUENCE: AtomicU64 = AtomicU64::new(0);
static WINDOWS: Mutex<Vec<BrowserWindowState>> = Mutex::new(Vec::new());

#[derive(Clone, Debug, Serialize)]
pub struct BrowserTabInfo {
    label: String,
    url: String,
    title: String,
    loading: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct BrowserSnapshot {
    window: String,
    tabs: Vec<BrowserTabInfo>,
    active: Option<String>,
}

#[derive(Clone, Debug)]
struct BrowserWindowState {
    window: String,
    chrome: String,
    tabs: Vec<BrowserTabInfo>,
    active: Option<String>,
    overlay_open: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
struct PageLoadEventPayload {
    label: String,
    state: &'static str,
    url: String,
    active: bool,
}

#[derive(Clone, Debug, Serialize)]
struct TabOpenedPayload {
    label: String,
    url: String,
    active: bool,
}

#[derive(Clone, Debug, Serialize)]
struct TabClosedPayload {
    label: String,
    active: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct LabelPayload {
    label: String,
}

#[derive(Clone, Debug, Serialize)]
struct ActivatedPayload {
    label: String,
    url: String,
}

#[derive(Clone, Debug, Serialize)]
struct TitlePayload {
    label: String,
    title: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Caller {
    Main,
    Chrome,
    Other,
}

fn caller_kind(label: &str) -> Caller {
    if label == MAIN_LABEL {
        Caller::Main
    } else if label.starts_with(CHROME_PREFIX) {
        Caller::Chrome
    } else {
        Caller::Other
    }
}

fn next_sequence() -> u64 {
    SEQUENCE.fetch_add(1, Ordering::SeqCst) + 1
}

fn is_app_origin(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    if host == "tauri.localhost" || host.ends_with(".localhost") {
        return true;
    }
    cfg!(debug_assertions)
        && matches!(host.as_str(), "localhost" | "127.0.0.1")
        && url.port() == Some(1420)
}

pub fn validate_browser_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|_| "that is not a valid web address".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("only http and https pages can open in the browser".to_string());
    }
    if url.host_str().map(str::is_empty).unwrap_or(true) {
        return Err("that web address has no host".to_string());
    }
    if is_app_origin(&url) {
        return Err("the browser cannot open the app's own pages".to_string());
    }
    Ok(url)
}

fn navigation_allowed(url: &Url) -> bool {
    (matches!(url.scheme(), "http" | "https") && !is_app_origin(url))
        || url.as_str() == "about:blank"
}

fn chrome_height_physical(scale: f64) -> u32 {
    (CHROME_HEIGHT_LOGICAL * scale.max(0.1)).round() as u32
}

fn content_bounds(
    window: PhysicalSize<u32>,
    scale: f64,
) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let chrome = chrome_height_physical(scale).min(window.height);
    let height = window.height.saturating_sub(chrome).max(1);
    (
        PhysicalPosition::new(0, chrome as i32),
        PhysicalSize::new(window.width.max(1), height),
    )
}

fn chrome_bounds(window: PhysicalSize<u32>) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    (
        PhysicalPosition::new(0, 0),
        PhysicalSize::new(window.width.max(1), window.height.max(1)),
    )
}

fn next_active_after_close(tabs: &[String], closed: &str, active: Option<&str>) -> Option<String> {
    if active.is_some_and(|current| current != closed) {
        return active.map(str::to_owned);
    }
    let index = tabs.iter().position(|label| label == closed)?;
    tabs.get(index + 1)
        .or_else(|| index.checked_sub(1).and_then(|prev| tabs.get(prev)))
        .cloned()
}

fn browser_page_load_payload(
    label: &str,
    url: &str,
    event: PageLoadEvent,
    active: bool,
) -> Option<PageLoadEventPayload> {
    if !label.starts_with(PANE_PREFIX) {
        return None;
    }
    let state = match event {
        PageLoadEvent::Started => "started",
        PageLoadEvent::Finished => "finished",
    };
    Some(PageLoadEventPayload {
        label: label.to_owned(),
        state,
        url: url.to_owned(),
        active,
    })
}

fn with_windows<T>(f: impl FnOnce(&mut Vec<BrowserWindowState>) -> T) -> T {
    let mut guard = WINDOWS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    f(&mut guard)
}

fn with_window_state<T>(
    window_label: &str,
    f: impl FnOnce(&mut BrowserWindowState) -> T,
) -> Result<T, String> {
    with_windows(|windows| {
        windows
            .iter_mut()
            .find(|state| state.window == window_label)
            .map(f)
            .ok_or_else(|| "the browser window is not open".to_string())
    })
}

fn window_label_for_pane(pane: &str) -> Option<String> {
    with_windows(|windows| {
        windows
            .iter()
            .find(|state| state.tabs.iter().any(|tab| tab.label == pane))
            .map(|state| state.window.clone())
    })
}

fn latest_window_label() -> Option<String> {
    with_windows(|windows| windows.last().map(|state| state.window.clone()))
}

fn forget_window(window_label: &str) -> Option<BrowserWindowState> {
    with_windows(|windows| {
        let index = windows
            .iter()
            .position(|state| state.window == window_label)?;
        Some(windows.remove(index))
    })
}

fn find_window<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<Window<R>, String> {
    app.windows()
        .get(label)
        .cloned()
        .ok_or_else(|| "the browser window is not open".to_string())
}

fn find_webview<R: Runtime>(window: &Window<R>, label: &str) -> Result<Webview<R>, String> {
    window
        .webviews()
        .into_iter()
        .find(|webview| webview.label() == label)
        .ok_or_else(|| "that browser tab is no longer open".to_string())
}

fn emit_to_chrome<R: Runtime>(
    app: &AppHandle<R>,
    window_label: &str,
    event: &str,
    payload: impl Serialize + Clone,
) {
    if let Ok(chrome) = with_window_state(window_label, |state| state.chrome.clone()) {
        let _ = app.emit_to(EventTarget::labeled(chrome), event, payload);
    }
}

fn emit_to_main<R: Runtime>(app: &AppHandle<R>, event: &str, payload: impl Serialize + Clone) {
    let _ = app.emit_to(EventTarget::labeled(MAIN_LABEL), event, payload);
}

fn chrome_window<R: Runtime>(webview: &Webview<R>) -> Result<String, String> {
    let denied = || "browser tabs can only be driven from the browser window".to_string();
    if caller_kind(webview.label()) != Caller::Chrome {
        return Err(denied());
    }
    let window_label = webview.window().label().to_owned();
    let chrome = with_window_state(&window_label, |state| state.chrome.clone())?;
    if chrome == webview.label() {
        Ok(window_label)
    } else {
        Err(denied())
    }
}

fn require_main<R: Runtime>(webview: &Webview<R>) -> Result<(), String> {
    if caller_kind(webview.label()) == Caller::Main {
        Ok(())
    } else {
        Err("the browser window can only be opened from the main window".to_string())
    }
}

fn apply_layout<R: Runtime>(window: &Window<R>, size: PhysicalSize<u32>, scale: f64) {
    let Ok((chrome, panes)) = with_window_state(window.label(), |state| {
        (
            state.chrome.clone(),
            state
                .tabs
                .iter()
                .map(|tab| tab.label.clone())
                .collect::<Vec<_>>(),
        )
    }) else {
        return;
    };
    let (chrome_position, chrome_size) = chrome_bounds(size);
    let (pane_position, pane_size) = content_bounds(size, scale);
    for webview in window.webviews() {
        if webview.label() == chrome {
            let _ = webview.set_position(chrome_position);
            let _ = webview.set_size(chrome_size);
        } else if panes.iter().any(|pane| pane == webview.label()) {
            let _ = webview.set_position(pane_position);
            let _ = webview.set_size(pane_size);
        }
    }
}

fn on_window_destroyed<R: Runtime>(app: &AppHandle<R>, window_label: &str) {
    if forget_window(window_label).is_some() {
        emit_to_main(
            app,
            WINDOW_CLOSED_EVENT,
            LabelPayload {
                label: window_label.to_owned(),
            },
        );
    }
}

fn install_window_events<R: Runtime>(app: &AppHandle<R>, window: &Window<R>) {
    let app = app.clone();
    let label = window.label().to_owned();
    window.on_window_event(move |event| match event {
        WindowEvent::Resized(size) => {
            if let Ok(window) = find_window(&app, &label) {
                let scale = window.scale_factor().unwrap_or(1.0);
                apply_layout(&window, *size, scale);
            }
        }
        WindowEvent::ScaleFactorChanged {
            scale_factor,
            new_inner_size,
            ..
        } => {
            if let Ok(window) = find_window(&app, &label) {
                apply_layout(&window, *new_inner_size, *scale_factor);
            }
        }
        WindowEvent::Destroyed => on_window_destroyed(&app, &label),
        _ => {}
    });
}

fn set_pane_visible<R: Runtime>(window: &Window<R>, pane: &str, visible: bool) {
    if let Ok(webview) = find_webview(window, pane) {
        let _ = if visible {
            webview.show()
        } else {
            webview.hide()
        };
    }
}

fn set_window_title<R: Runtime>(window: &Window<R>, title: &str) {
    let title = title.trim();
    let full = if title.is_empty() {
        WINDOW_TITLE.to_owned()
    } else {
        format!("{title} - {WINDOW_TITLE}")
    };
    let _ = window.set_title(&full);
}

fn activate_pane<R: Runtime>(
    app: &AppHandle<R>,
    window: &Window<R>,
    pane: &str,
) -> Result<(), String> {
    let (previous, overlay_open, title, url) = with_window_state(window.label(), |state| {
        let (title, url) = state
            .tabs
            .iter()
            .find(|tab| tab.label == pane)
            .map(|tab| (tab.title.clone(), tab.url.clone()))
            .ok_or_else(|| "that browser tab is no longer open".to_string())?;
        let previous = state.active.replace(pane.to_owned());
        Ok::<_, String>((previous, state.overlay_open, title, url))
    })??;
    if let Some(previous) = previous.filter(|previous| previous != pane) {
        set_pane_visible(window, &previous, false);
    }
    if !overlay_open {
        set_pane_visible(window, pane, true);
    }
    set_window_title(window, &title);
    let payload = ActivatedPayload {
        label: pane.to_owned(),
        url,
    };
    emit_to_chrome(app, window.label(), TAB_ACTIVATED_EVENT, payload.clone());
    emit_to_main(app, TAB_ACTIVATED_EVENT, payload);
    Ok(())
}

fn on_title_changed<R: Runtime>(webview: Webview<R>, title: String) {
    let pane = webview.label().to_owned();
    let Some(window_label) = window_label_for_pane(&pane) else {
        return;
    };
    let active = with_window_state(&window_label, |state| {
        if let Some(tab) = state.tabs.iter_mut().find(|tab| tab.label == pane) {
            tab.title = title.clone();
        }
        state.active.as_deref() == Some(pane.as_str())
    })
    .unwrap_or(false);
    if active {
        set_window_title(&webview.window(), &title);
    }
    emit_to_chrome(
        webview.app_handle(),
        &window_label,
        TITLE_EVENT,
        TitlePayload { label: pane, title },
    );
}

fn request_tab<R: Runtime>(app: AppHandle<R>, window_label: String, url: Url) {
    tauri::async_runtime::spawn(async move {
        if let Ok(window) = find_window(&app, &window_label) {
            let _ = open_tab(&app, &window, url);
        }
    });
}

fn open_tab<R: Runtime>(
    app: &AppHandle<R>,
    window: &Window<R>,
    url: Url,
) -> Result<String, String> {
    let window_label = window.label().to_owned();
    with_window_state(&window_label, |_| ())?;
    let size = window
        .inner_size()
        .map_err(|e| format!("could not measure the browser window: {e}"))?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let (position, pane_size) = content_bounds(size, scale);
    let label = format!("{PANE_PREFIX}{}", next_sequence());
    let new_tab_app = app.clone();
    let new_tab_window = window_label.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url.clone()))
        .on_navigation(navigation_allowed)
        .on_new_window(move |url, _features| {
            if navigation_allowed(&url) && url.as_str() != "about:blank" {
                request_tab(new_tab_app.clone(), new_tab_window.clone(), url);
            }
            NewWindowResponse::Deny
        })
        .on_document_title_changed(on_title_changed);
    let webview = window
        .add_child(builder, position, pane_size)
        .map_err(|e| format!("could not open the tab: {e}"))?;
    let _ = webview.hide();
    with_window_state(&window_label, |state| {
        state.tabs.push(BrowserTabInfo {
            label: label.clone(),
            url: url.to_string(),
            title: String::new(),
            loading: true,
        });
    })?;
    emit_to_chrome(
        app,
        &window_label,
        TAB_OPENED_EVENT,
        TabOpenedPayload {
            label: label.clone(),
            url: url.to_string(),
            active: true,
        },
    );
    activate_pane(app, window, &label)?;
    Ok(label)
}

fn create_window<R: Runtime>(app: &AppHandle<R>, url: Url) -> Result<String, String> {
    let sequence = next_sequence();
    let window_label = format!("{WINDOW_PREFIX}{sequence}");
    let chrome_label = format!("{CHROME_PREFIX}{sequence}");
    let builder = WindowBuilder::new(app, &window_label)
        .title(WINDOW_TITLE)
        .inner_size(1024.0, 768.0)
        .min_inner_size(480.0, 320.0);
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    let window = builder
        .resizable(true)
        .center()
        .build()
        .map_err(|e| format!("could not open the browser window: {e}"))?;
    with_windows(|windows| {
        windows.push(BrowserWindowState {
            window: window_label.clone(),
            chrome: chrome_label.clone(),
            tabs: Vec::new(),
            active: None,
            overlay_open: false,
        })
    });
    install_window_events(app, &window);
    let size = window
        .inner_size()
        .map_err(|e| format!("could not measure the browser window: {e}"))?;
    let (position, chrome_size) = chrome_bounds(size);
    let chrome_url = WebviewUrl::App(PathBuf::from(format!(
        "index.html?view=browser&window={window_label}"
    )));
    window
        .add_child(
            WebviewBuilder::new(&chrome_label, chrome_url),
            position,
            chrome_size,
        )
        .map_err(|e| format!("could not open the browser window: {e}"))?;
    open_tab(app, &window, url)?;
    let _ = window.set_focus();
    Ok(window_label)
}

pub fn on_page_load<R: Runtime>(webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
    let pane = webview.label();
    let Some(window_label) = window_label_for_pane(pane) else {
        return;
    };
    let url = payload.url().to_string();
    let loading = matches!(payload.event(), PageLoadEvent::Started);
    let active = with_window_state(&window_label, |state| {
        if let Some(tab) = state.tabs.iter_mut().find(|tab| tab.label == pane) {
            tab.url = url.clone();
            tab.loading = loading;
        }
        state.active.as_deref() == Some(pane)
    })
    .unwrap_or(false);
    let Some(event) = browser_page_load_payload(pane, &url, payload.event(), active) else {
        return;
    };
    let app = webview.app_handle();
    emit_to_chrome(app, &window_label, PAGE_LOAD_EVENT, event.clone());
    emit_to_main(app, PAGE_LOAD_EVENT, event);
}

#[tauri::command]
pub async fn browser_window_open<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    url: String,
) -> Result<String, String> {
    require_main(&webview)?;
    let url = validate_browser_url(&url)?;
    if let Some(existing) = latest_window_label() {
        match find_window(&app, &existing) {
            Ok(window) => {
                open_tab(&app, &window, url)?;
                let _ = window.set_focus();
                return Ok(existing);
            }
            Err(_) => {
                forget_window(&existing);
            }
        }
    }
    create_window(&app, url)
}

#[tauri::command]
pub async fn browser_window_focus<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    label: String,
) -> Result<(), String> {
    require_main(&webview)?;
    with_window_state(&label, |_| ())?;
    find_window(&app, &label)?
        .set_focus()
        .map_err(|e| format!("could not focus the browser window: {e}"))
}

#[tauri::command]
pub async fn browser_window_close<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    label: String,
) -> Result<(), String> {
    require_main(&webview)?;
    with_window_state(&label, |_| ())?;
    find_window(&app, &label)?
        .close()
        .map_err(|e| format!("could not close the browser window: {e}"))
}

#[tauri::command]
pub async fn browser_state<R: Runtime>(webview: Webview<R>) -> Result<BrowserSnapshot, String> {
    let window_label = chrome_window(&webview)?;
    with_window_state(&window_label, |state| BrowserSnapshot {
        window: state.window.clone(),
        tabs: state.tabs.clone(),
        active: state.active.clone(),
    })
}

#[tauri::command]
pub async fn browser_tab_open<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    url: String,
) -> Result<String, String> {
    let window_label = chrome_window(&webview)?;
    let url = validate_browser_url(&url)?;
    let window = find_window(&app, &window_label)?;
    open_tab(&app, &window, url)
}

#[tauri::command]
pub async fn browser_tab_activate<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    tab: String,
) -> Result<(), String> {
    let window_label = chrome_window(&webview)?;
    let window = find_window(&app, &window_label)?;
    activate_pane(&app, &window, &tab)
}

#[tauri::command]
pub async fn browser_tab_close<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    tab: String,
) -> Result<(), String> {
    let window_label = chrome_window(&webview)?;
    let window = find_window(&app, &window_label)?;
    let (next, remaining) = with_window_state(&window_label, |state| {
        let labels: Vec<String> = state.tabs.iter().map(|t| t.label.clone()).collect();
        if !labels.iter().any(|label| label == &tab) {
            return Err("that browser tab is no longer open".to_string());
        }
        let next = next_active_after_close(&labels, &tab, state.active.as_deref());
        state.tabs.retain(|t| t.label != tab);
        if state.active.as_deref() == Some(tab.as_str()) {
            state.active = None;
        }
        Ok((next, state.tabs.len()))
    })??;
    if let Ok(pane) = find_webview(&window, &tab) {
        let _ = pane.close();
    }
    emit_to_chrome(
        &app,
        &window_label,
        TAB_CLOSED_EVENT,
        TabClosedPayload {
            label: tab.clone(),
            active: next.clone(),
        },
    );
    if remaining == 0 {
        let _ = window.close();
        return Ok(());
    }
    if let Some(next) = next {
        let already_active = with_window_state(&window_label, |state| {
            state.active.as_deref() == Some(next.as_str())
        })?;
        if !already_active {
            activate_pane(&app, &window, &next)?;
        }
    }
    Ok(())
}

fn resolve_pane<R: Runtime>(
    app: &AppHandle<R>,
    webview: &Webview<R>,
    tab: Option<String>,
) -> Result<(Window<R>, String), String> {
    let window_label = match caller_kind(webview.label()) {
        Caller::Chrome => chrome_window(webview)?,
        Caller::Main => {
            latest_window_label().ok_or_else(|| "the browser window is not open".to_string())?
        }
        Caller::Other => {
            return Err("browser tabs can only be driven from the browser window".to_string())
        }
    };
    let pane = match tab {
        Some(tab) => tab,
        None => with_window_state(&window_label, |state| state.active.clone())?
            .ok_or_else(|| "the browser window has no open tab".to_string())?,
    };
    let owned = with_window_state(&window_label, |state| {
        state.tabs.iter().any(|t| t.label == pane)
    })?;
    if !owned {
        return Err("that browser tab is no longer open".to_string());
    }
    Ok((find_window(app, &window_label)?, pane))
}

#[tauri::command]
pub async fn browser_navigate<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    tab: Option<String>,
    url: String,
) -> Result<(), String> {
    let url = validate_browser_url(&url)?;
    let (window, pane) = resolve_pane(&app, &webview, tab)?;
    let target = find_webview(&window, &pane)?;
    with_window_state(window.label(), |state| {
        if let Some(entry) = state.tabs.iter_mut().find(|t| t.label == pane) {
            entry.url = url.to_string();
            entry.loading = true;
        }
    })?;
    target
        .navigate(url)
        .map_err(|e| format!("could not open that page: {e}"))
}

fn eval_in_pane<R: Runtime>(
    app: &AppHandle<R>,
    webview: &Webview<R>,
    tab: String,
    script: &str,
) -> Result<(), String> {
    chrome_window(webview)?;
    let (window, pane) = resolve_pane(app, webview, Some(tab))?;
    find_webview(&window, &pane)?
        .eval(script)
        .map_err(|e| format!("the page did not respond: {e}"))
}

#[tauri::command]
pub async fn browser_back<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    tab: String,
) -> Result<(), String> {
    eval_in_pane(&app, &webview, tab, "history.back()")
}

#[tauri::command]
pub async fn browser_forward<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    tab: String,
) -> Result<(), String> {
    eval_in_pane(&app, &webview, tab, "history.forward()")
}

#[tauri::command]
pub async fn browser_reload<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    tab: String,
) -> Result<(), String> {
    eval_in_pane(&app, &webview, tab, "location.reload()")
}

#[tauri::command]
pub async fn browser_content_visible<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    visible: bool,
) -> Result<(), String> {
    let window_label = chrome_window(&webview)?;
    let active = with_window_state(&window_label, |state| {
        state.overlay_open = !visible;
        state.active.clone()
    })?;
    let window = find_window(&app, &window_label)?;
    if let Some(active) = active {
        set_pane_visible(&window, &active, visible);
    }
    Ok(())
}

#[cfg(test)]
mod tests {

    #[test]
    fn rejects_the_app_origin_for_panes() {
        for raw in [
            "http://tauri.localhost/",
            "https://tauri.localhost/x",
            "http://oleafly.localhost/",
        ] {
            assert!(validate_browser_url(raw).is_err(), "{raw}");
            assert!(
                !navigation_allowed(&super::Url::parse(raw).unwrap()),
                "{raw}"
            );
        }
        assert!(validate_browser_url("https://example.com/").is_ok());
        assert!(navigation_allowed(
            &super::Url::parse("https://example.com/").unwrap()
        ));
        assert!(navigation_allowed(
            &super::Url::parse("about:blank").unwrap()
        ));
        if cfg!(debug_assertions) {
            assert!(validate_browser_url("http://localhost:1420/").is_err());
            assert!(!navigation_allowed(
                &super::Url::parse("http://localhost:1420/").unwrap()
            ));
        }
    }
    use tauri::webview::PageLoadEvent;
    use tauri::PhysicalSize;

    use super::{
        browser_page_load_payload, caller_kind, chrome_bounds, content_bounds, navigation_allowed,
        next_active_after_close, validate_browser_url, Caller,
    };

    #[test]
    fn maps_browser_page_load_events() {
        let started = browser_page_load_payload(
            "oleafly-browser-pane-3",
            "https://example.com/start",
            PageLoadEvent::Started,
            true,
        )
        .expect("browser event");
        assert_eq!(started.label, "oleafly-browser-pane-3");
        assert_eq!(started.state, "started");
        assert_eq!(started.url, "https://example.com/start");
        assert!(started.active);

        let finished = browser_page_load_payload(
            "oleafly-browser-pane-3",
            "https://example.com/finish",
            PageLoadEvent::Finished,
            false,
        )
        .expect("browser event");
        assert_eq!(finished.state, "finished");
        assert_eq!(finished.url, "https://example.com/finish");
        assert!(!finished.active);
    }

    #[test]
    fn ignores_non_browser_webviews() {
        assert!(browser_page_load_payload(
            "main",
            "tauri://localhost",
            PageLoadEvent::Finished,
            false
        )
        .is_none());
        assert!(browser_page_load_payload(
            "oleafly-browser-chrome-1",
            "tauri://localhost",
            PageLoadEvent::Finished,
            false
        )
        .is_none());
    }

    #[test]
    fn accepts_only_web_urls() {
        assert_eq!(
            validate_browser_url(" https://example.com/a?b=c ")
                .unwrap()
                .as_str(),
            "https://example.com/a?b=c"
        );
        assert!(validate_browser_url("http://example.org").is_ok());
        for bad in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hi",
            "tauri://localhost",
            "ftp://example.com",
            "https://",
            "example.com",
            "",
        ] {
            assert!(
                validate_browser_url(bad).is_err(),
                "{bad} should be rejected"
            );
        }
    }

    #[test]
    fn navigation_policy_permits_web_and_blank_only() {
        let ok = |s: &str| navigation_allowed(&s.parse().unwrap());
        assert!(ok("https://example.com"));
        assert!(ok("http://example.com/path"));
        assert!(ok("about:blank"));
        assert!(!ok("file:///tmp/x"));
        assert!(!ok("javascript:void(0)"));
        assert!(!ok("data:text/plain,x"));
        assert!(!ok("tauri://localhost/index.html"));
    }

    #[test]
    fn lays_out_chrome_over_the_whole_window_and_content_below_it() {
        let window = PhysicalSize::new(1000, 700);
        let (chrome_pos, chrome_size) = chrome_bounds(window);
        assert_eq!((chrome_pos.x, chrome_pos.y), (0, 0));
        assert_eq!((chrome_size.width, chrome_size.height), (1000, 700));

        let (pos, size) = content_bounds(window, 1.0);
        assert_eq!((pos.x, pos.y), (0, 88));
        assert_eq!((size.width, size.height), (1000, 612));

        let (pos, size) = content_bounds(window, 2.0);
        assert_eq!(pos.y, 176);
        assert_eq!(size.height, 524);
    }

    #[test]
    fn layout_never_produces_a_zero_sized_pane() {
        let (pos, size) = content_bounds(PhysicalSize::new(0, 0), 1.0);
        assert_eq!(pos.y, 0);
        assert_eq!((size.width, size.height), (1, 1));
        let (pos, size) = content_bounds(PhysicalSize::new(300, 50), 1.0);
        assert_eq!(pos.y, 50);
        assert_eq!(size.height, 1);
    }

    #[test]
    fn picks_the_neighbour_when_the_active_tab_closes() {
        let tabs: Vec<String> = ["a", "b", "c"].iter().map(|s| s.to_string()).collect();
        assert_eq!(
            next_active_after_close(&tabs, "b", Some("b")).as_deref(),
            Some("c")
        );
        assert_eq!(
            next_active_after_close(&tabs, "c", Some("c")).as_deref(),
            Some("b")
        );
        assert_eq!(
            next_active_after_close(&tabs, "a", Some("c")).as_deref(),
            Some("c")
        );
        let single = vec!["only".to_string()];
        assert_eq!(next_active_after_close(&single, "only", Some("only")), None);
        assert_eq!(
            next_active_after_close(&tabs, "zzz", Some("a")).as_deref(),
            Some("a")
        );
    }

    #[test]
    fn classifies_callers_by_label() {
        assert_eq!(caller_kind("main"), Caller::Main);
        assert_eq!(caller_kind("oleafly-browser-chrome-4"), Caller::Chrome);
        assert_eq!(caller_kind("oleafly-browser-pane-4"), Caller::Other);
        assert_eq!(caller_kind("preview"), Caller::Other);
    }
}
