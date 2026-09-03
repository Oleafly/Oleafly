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

fn plan_tab_close(
    labels: &[String],
    closed: &str,
    active: Option<&str>,
) -> Result<Option<String>, String> {
    if !labels.iter().any(|label| label == closed) {
        return Err("that browser tab is no longer open".to_string());
    }
    Ok(next_active_after_close(labels, closed, active))
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

fn window_state_in<'a>(
    windows: &'a mut [BrowserWindowState],
    window_label: &str,
) -> Result<&'a mut BrowserWindowState, String> {
    windows
        .iter_mut()
        .find(|state| state.window == window_label)
        .ok_or_else(|| "the browser window is not open".to_string())
}

fn with_window_state<T>(
    window_label: &str,
    f: impl FnOnce(&mut BrowserWindowState) -> T,
) -> Result<T, String> {
    with_windows(|windows| window_state_in(windows, window_label).map(f))
}

fn window_label_for_pane_in(windows: &[BrowserWindowState], pane: &str) -> Option<String> {
    windows
        .iter()
        .find(|state| state.tabs.iter().any(|tab| tab.label == pane))
        .map(|state| state.window.clone())
}

fn window_label_for_pane(pane: &str) -> Option<String> {
    with_windows(|windows| window_label_for_pane_in(windows, pane))
}

fn latest_window_label_in(windows: &[BrowserWindowState]) -> Option<String> {
    windows.last().map(|state| state.window.clone())
}

fn latest_window_label() -> Option<String> {
    with_windows(|windows| latest_window_label_in(windows))
}

fn forget_window_in(
    windows: &mut Vec<BrowserWindowState>,
    window_label: &str,
) -> Option<BrowserWindowState> {
    let index = windows
        .iter()
        .position(|state| state.window == window_label)?;
    Some(windows.remove(index))
}

fn forget_window(window_label: &str) -> Option<BrowserWindowState> {
    with_windows(|windows| forget_window_in(windows, window_label))
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

fn browser_window_title(title: &str) -> String {
    let title = title.trim();
    if title.is_empty() {
        WINDOW_TITLE.to_owned()
    } else {
        format!("{title} - {WINDOW_TITLE}")
    }
}

fn set_window_title<R: Runtime>(window: &Window<R>, title: &str) {
    let _ = window.set_title(&browser_window_title(title));
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
        let next = plan_tab_close(&labels, &tab, state.active.as_deref())?;
        state.tabs.retain(|t| t.label != tab);
        if state.active.as_deref() == Some(tab.as_str()) {
            state.active = None;
        }
        Ok::<_, String>((next, state.tabs.len()))
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

    use tauri::async_runtime::block_on;
    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
    use tauri::{App, AppHandle, LogicalPosition, LogicalSize, Webview, WebviewWindowBuilder};

    use super::{
        apply_layout, browser_back, browser_content_visible, browser_forward, browser_navigate,
        browser_reload, browser_state, browser_tab_activate, browser_tab_close, browser_tab_open,
        browser_window_close, browser_window_focus, browser_window_open, browser_window_title,
        chrome_height_physical, chrome_window, create_window, eval_in_pane, find_webview,
        find_window, forget_window, forget_window_in, is_app_origin, latest_window_label,
        latest_window_label_in, next_sequence, on_title_changed, on_window_destroyed,
        plan_tab_close, request_tab, resolve_pane, window_label_for_pane, window_label_for_pane_in,
        window_state_in, with_window_state, with_windows, BrowserTabInfo, BrowserWindowState,
        WebviewBuilder, WebviewUrl,
    };

    static REGISTRY_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    struct GlobalRegistry {
        _lock: std::sync::MutexGuard<'static, ()>,
    }

    impl GlobalRegistry {
        fn acquire() -> Self {
            let lock = REGISTRY_LOCK
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            with_windows(|windows| windows.clear());
            Self { _lock: lock }
        }
    }

    impl Drop for GlobalRegistry {
        fn drop(&mut self) {
            with_windows(|windows| windows.clear());
        }
    }

    fn tab(label: &str, url: &str) -> BrowserTabInfo {
        BrowserTabInfo {
            label: label.to_string(),
            url: url.to_string(),
            title: String::new(),
            loading: false,
        }
    }

    fn state(window: &str, tabs: &[&str], active: Option<&str>) -> BrowserWindowState {
        BrowserWindowState {
            window: window.to_string(),
            chrome: format!("oleafly-browser-chrome-{window}"),
            tabs: tabs
                .iter()
                .map(|label| tab(label, "https://example.com/"))
                .collect(),
            active: active.map(str::to_owned),
            overlay_open: false,
        }
    }

    struct MockApp {
        app: App<MockRuntime>,
        main: Webview<MockRuntime>,
    }

    impl MockApp {
        fn new() -> Self {
            let app = mock_builder()
                .build(mock_context(noop_assets()))
                .expect("mock app");
            let main = WebviewWindowBuilder::new(app.handle(), "main", Default::default())
                .build()
                .expect("main window");
            let main = main.as_ref().clone();
            Self { app, main }
        }

        fn handle(&self) -> AppHandle<MockRuntime> {
            self.app.handle().clone()
        }

        fn open(&self, url: &str) -> String {
            create_window(self.app.handle(), url.parse().expect("url")).expect("browser window")
        }

        fn chrome(&self, window_label: &str) -> Webview<MockRuntime> {
            let window = find_window(self.app.handle(), window_label).expect("window");
            let chrome =
                with_window_state(window_label, |state| state.chrome.clone()).expect("state");
            find_webview(&window, &chrome).expect("chrome webview")
        }

        fn pane(&self, window_label: &str, index: usize) -> Webview<MockRuntime> {
            let window = find_window(self.app.handle(), window_label).expect("window");
            let label = with_window_state(window_label, |state| state.tabs[index].label.clone())
                .expect("state");
            find_webview(&window, &label).expect("pane webview")
        }

        fn tabs(&self, window_label: &str) -> Vec<String> {
            with_window_state(window_label, |state| {
                state.tabs.iter().map(|tab| tab.label.clone()).collect()
            })
            .expect("state")
        }

        fn active(&self, window_label: &str) -> Option<String> {
            with_window_state(window_label, |state| state.active.clone()).expect("state")
        }
    }

    #[test]
    fn scales_the_chrome_strip_with_the_display() {
        assert_eq!(chrome_height_physical(1.0), 88);
        assert_eq!(chrome_height_physical(1.5), 132);
        assert_eq!(chrome_height_physical(2.0), 176);
        assert_eq!(chrome_height_physical(0.0), 9);
        assert_eq!(chrome_height_physical(-4.0), 9);

        let (pos, size) = content_bounds(PhysicalSize::new(1000, 700), 1.5);
        assert_eq!(pos.y, 132);
        assert_eq!((size.width, size.height), (1000, 568));
        let (pos, size) = content_bounds(PhysicalSize::new(300, 50), 2.0);
        assert_eq!(pos.y, 50);
        assert_eq!((size.width, size.height), (300, 1));
        let (pos, size) = chrome_bounds(PhysicalSize::new(0, 0));
        assert_eq!((pos.x, pos.y), (0, 0));
        assert_eq!((size.width, size.height), (1, 1));
    }

    #[test]
    fn a_url_without_a_host_is_never_the_app_origin() {
        assert!(!is_app_origin(
            &super::Url::parse("mailto:someone@example.com").unwrap()
        ));
        assert!(!is_app_origin(
            &super::Url::parse("data:text/plain,x").unwrap()
        ));
        assert!(is_app_origin(
            &super::Url::parse("https://TAURI.localhost/x").unwrap()
        ));
    }

    #[test]
    fn window_sequence_numbers_never_repeat() {
        let first = next_sequence();
        let second = next_sequence();
        assert!(second > first);
    }

    #[test]
    fn window_titles_fall_back_to_the_product_name() {
        assert_eq!(browser_window_title(""), "Oleafly Browser");
        assert_eq!(browser_window_title("   \n"), "Oleafly Browser");
        assert_eq!(
            browser_window_title("  Example Domain  "),
            "Example Domain - Oleafly Browser"
        );
    }

    #[test]
    fn closing_an_unknown_tab_is_refused_before_the_window_changes() {
        let labels: Vec<String> = ["a", "b"].iter().map(|s| s.to_string()).collect();
        assert_eq!(
            plan_tab_close(&labels, "zzz", Some("a")).unwrap_err(),
            "that browser tab is no longer open"
        );
        assert_eq!(
            plan_tab_close(&labels, "a", Some("a")).unwrap().as_deref(),
            Some("b")
        );
        assert_eq!(
            plan_tab_close(&labels, "a", Some("b")).unwrap().as_deref(),
            Some("b")
        );
    }

    #[test]
    fn the_registry_finds_windows_panes_and_the_newest_window() {
        let mut windows = vec![
            state("w1", &["p1", "p2"], Some("p1")),
            state("w2", &["p3"], None),
        ];

        assert_eq!(
            window_state_in(&mut windows, "w2").unwrap().window,
            "w2".to_string()
        );
        assert_eq!(
            window_state_in(&mut windows, "missing").unwrap_err(),
            "the browser window is not open"
        );
        assert_eq!(
            window_label_for_pane_in(&windows, "p3").as_deref(),
            Some("w2")
        );
        assert_eq!(window_label_for_pane_in(&windows, "nope"), None);
        assert_eq!(latest_window_label_in(&windows).as_deref(), Some("w2"));

        assert!(forget_window_in(&mut windows, "missing").is_none());
        let removed = forget_window_in(&mut windows, "w1").expect("removed");
        assert_eq!(removed.tabs.len(), 2);
        assert_eq!(latest_window_label_in(&windows).as_deref(), Some("w2"));
        assert!(forget_window_in(&mut windows, "w2").is_some());
        assert_eq!(latest_window_label_in(&windows), None);
        assert_eq!(window_label_for_pane_in(&windows, "p1"), None);
    }

    #[test]
    fn the_process_registry_delegates_to_the_slice_helpers() {
        let _registry = GlobalRegistry::acquire();
        assert_eq!(latest_window_label(), None);
        assert_eq!(window_label_for_pane("p1"), None);
        assert_eq!(
            with_window_state("w1", |state| state.window.clone()).unwrap_err(),
            "the browser window is not open"
        );

        with_windows(|windows| {
            windows.push(state("w1", &["p1"], Some("p1")));
            windows.push(state("w2", &["p2"], None));
        });
        assert_eq!(latest_window_label().as_deref(), Some("w2"));
        assert_eq!(window_label_for_pane("p1").as_deref(), Some("w1"));
        with_window_state("w2", |state| state.active = Some("p2".to_string())).unwrap();
        assert_eq!(
            with_window_state("w2", |state| state.active.clone()).unwrap(),
            Some("p2".to_string())
        );
        assert!(forget_window("w2").is_some());
        assert!(forget_window("w2").is_none());
        assert_eq!(latest_window_label().as_deref(), Some("w1"));
    }

    #[test]
    fn opening_a_browser_window_adds_chrome_and_a_first_tab() {
        let _registry = GlobalRegistry::acquire();
        let mock = MockApp::new();
        let window_label = mock.open("https://example.com/first");

        assert!(window_label.starts_with("oleafly-browser-window-"));
        let window = find_window(mock.app.handle(), &window_label).expect("window");
        let labels: Vec<String> = window
            .webviews()
            .iter()
            .map(|webview| webview.label().to_string())
            .collect();
        let chrome = with_window_state(&window_label, |state| state.chrome.clone()).unwrap();
        assert!(labels.contains(&chrome));

        let tabs = mock.tabs(&window_label);
        assert_eq!(tabs.len(), 1);
        assert!(tabs[0].starts_with("oleafly-browser-pane-"));
        assert_eq!(
            mock.active(&window_label).as_deref(),
            Some(tabs[0].as_str())
        );

        let snapshot = block_on(browser_state(mock.chrome(&window_label))).expect("snapshot");
        assert_eq!(snapshot.window, window_label);
        assert_eq!(snapshot.tabs.len(), 1);
        assert_eq!(snapshot.tabs[0].url, "https://example.com/first");
        assert!(snapshot.tabs[0].loading);
        assert_eq!(snapshot.active, Some(tabs[0].clone()));

        assert_eq!(
            block_on(browser_state(mock.main.clone())).unwrap_err(),
            "browser tabs can only be driven from the browser window"
        );
    }

    #[test]
    fn only_the_windows_own_chrome_webview_may_drive_its_tabs() {
        let _registry = GlobalRegistry::acquire();
        let mock = MockApp::new();
        let window_label = mock.open("https://example.com/");
        let window = find_window(mock.app.handle(), &window_label).expect("window");

        let rogue = window
            .add_child(
                WebviewBuilder::new("oleafly-browser-chrome-rogue", WebviewUrl::default()),
                LogicalPosition::new(0, 0),
                LogicalSize::new(100, 100),
            )
            .expect("rogue chrome webview");
        assert_eq!(
            chrome_window(&rogue).unwrap_err(),
            "browser tabs can only be driven from the browser window"
        );
        assert_eq!(
            chrome_window(&mock.pane(&window_label, 0)).unwrap_err(),
            "browser tabs can only be driven from the browser window"
        );
        let chrome = mock.chrome(&window_label);
        assert_eq!(chrome_window(&chrome).unwrap(), window_label);

        forget_window(&window_label);
        assert_eq!(
            chrome_window(&chrome).unwrap_err(),
            "the browser window is not open"
        );
    }

    #[test]
    fn tabs_open_activate_and_close_in_order() {
        let _registry = GlobalRegistry::acquire();
        let mock = MockApp::new();
        let window_label = mock.open("https://example.com/one");
        let chrome = mock.chrome(&window_label);

        let second = block_on(browser_tab_open(
            mock.handle(),
            chrome.clone(),
            "https://example.com/two".to_string(),
        ))
        .expect("second tab");
        let third = block_on(browser_tab_open(
            mock.handle(),
            chrome.clone(),
            "https://example.com/three".to_string(),
        ))
        .expect("third tab");
        let tabs = mock.tabs(&window_label);
        assert_eq!(tabs.len(), 3);
        assert_eq!(mock.active(&window_label).as_deref(), Some(third.as_str()));

        assert_eq!(
            block_on(browser_tab_open(
                mock.handle(),
                chrome.clone(),
                "ftp://example.com".to_string()
            ))
            .unwrap_err(),
            "only http and https pages can open in the browser"
        );

        block_on(browser_tab_activate(
            mock.handle(),
            chrome.clone(),
            tabs[0].clone(),
        ))
        .expect("activate the first tab");
        assert_eq!(
            mock.active(&window_label).as_deref(),
            Some(tabs[0].as_str())
        );
        assert_eq!(
            block_on(browser_tab_activate(
                mock.handle(),
                chrome.clone(),
                "oleafly-browser-pane-gone".to_string()
            ))
            .unwrap_err(),
            "that browser tab is no longer open"
        );

        block_on(browser_tab_close(
            mock.handle(),
            chrome.clone(),
            second.clone(),
        ))
        .expect("close an inactive tab");
        assert_eq!(
            mock.tabs(&window_label),
            vec![tabs[0].clone(), third.clone()]
        );
        assert_eq!(
            mock.active(&window_label).as_deref(),
            Some(tabs[0].as_str())
        );

        block_on(browser_tab_close(
            mock.handle(),
            chrome.clone(),
            tabs[0].clone(),
        ))
        .expect("close the active tab");
        assert_eq!(mock.tabs(&window_label), vec![third.clone()]);
        assert_eq!(mock.active(&window_label).as_deref(), Some(third.as_str()));

        assert_eq!(
            block_on(browser_tab_close(
                mock.handle(),
                chrome.clone(),
                second.clone()
            ))
            .unwrap_err(),
            "that browser tab is no longer open"
        );

        block_on(browser_tab_close(mock.handle(), chrome, third)).expect("close the last tab");
        assert!(with_window_state(&window_label, |state| state.tabs.len())
            .map(|len| len == 0)
            .unwrap_or(true));
    }

    #[test]
    fn a_second_open_reuses_the_window_and_a_stale_entry_is_dropped() {
        let _registry = GlobalRegistry::acquire();
        let mock = MockApp::new();

        let first = block_on(browser_window_open(
            mock.handle(),
            mock.main.clone(),
            "https://example.com/one".to_string(),
        ))
        .expect("first window");
        let second = block_on(browser_window_open(
            mock.handle(),
            mock.main.clone(),
            "https://example.com/two".to_string(),
        ))
        .expect("reused window");
        assert_eq!(first, second);
        assert_eq!(mock.tabs(&first).len(), 2);

        assert_eq!(
            block_on(browser_window_open(
                mock.handle(),
                mock.pane(&first, 0),
                "https://example.com/".to_string()
            ))
            .unwrap_err(),
            "the browser window can only be opened from the main window"
        );
        assert_eq!(
            block_on(browser_window_open(
                mock.handle(),
                mock.main.clone(),
                "file:///etc/passwd".to_string()
            ))
            .unwrap_err(),
            "only http and https pages can open in the browser"
        );

        with_windows(|windows| windows.push(state("oleafly-browser-window-ghost", &[], None)));
        let third = block_on(browser_window_open(
            mock.handle(),
            mock.main.clone(),
            "https://example.com/three".to_string(),
        ))
        .expect("a fresh window replaces the stale entry");
        assert_ne!(third, first);
        assert_eq!(window_label_for_pane("oleafly-browser-window-ghost"), None);
        assert!(with_window_state("oleafly-browser-window-ghost", |_| ()).is_err());
    }

    #[test]
    fn focus_and_close_commands_check_the_caller_and_the_window() {
        let _registry = GlobalRegistry::acquire();
        let mock = MockApp::new();
        let window_label = mock.open("https://example.com/");

        assert!(block_on(browser_window_focus(
            mock.handle(),
            mock.main.clone(),
            window_label.clone()
        ))
        .is_ok());
        assert_eq!(
            block_on(browser_window_focus(
                mock.handle(),
                mock.main.clone(),
                "oleafly-browser-window-ghost".to_string()
            ))
            .unwrap_err(),
            "the browser window is not open"
        );
        assert_eq!(
            block_on(browser_window_focus(
                mock.handle(),
                mock.chrome(&window_label),
                window_label.clone()
            ))
            .unwrap_err(),
            "the browser window can only be opened from the main window"
        );
        assert_eq!(
            block_on(browser_window_close(
                mock.handle(),
                mock.pane(&window_label, 0),
                window_label.clone()
            ))
            .unwrap_err(),
            "the browser window can only be opened from the main window"
        );
        assert!(block_on(browser_window_close(
            mock.handle(),
            mock.main.clone(),
            window_label.clone()
        ))
        .is_ok());
    }

    #[test]
    fn navigation_and_history_commands_resolve_the_target_pane() {
        let _registry = GlobalRegistry::acquire();
        let mock = MockApp::new();
        let window_label = mock.open("https://example.com/");
        let chrome = mock.chrome(&window_label);
        let pane = mock.tabs(&window_label)[0].clone();

        block_on(browser_navigate(
            mock.handle(),
            chrome.clone(),
            Some(pane.clone()),
            "https://example.com/next".to_string(),
        ))
        .expect("navigate a named tab");
        let entry = with_window_state(&window_label, |state| state.tabs[0].clone()).unwrap();
        assert_eq!(entry.url, "https://example.com/next");
        assert!(entry.loading);

        block_on(browser_navigate(
            mock.handle(),
            mock.main.clone(),
            None,
            "https://example.com/from-main".to_string(),
        ))
        .expect("the main window navigates the active tab");
        assert_eq!(
            with_window_state(&window_label, |state| state.tabs[0].url.clone()).unwrap(),
            "https://example.com/from-main"
        );

        assert_eq!(
            block_on(browser_navigate(
                mock.handle(),
                chrome.clone(),
                None,
                "not a url".to_string()
            ))
            .unwrap_err(),
            "that is not a valid web address"
        );
        assert_eq!(
            block_on(browser_navigate(
                mock.handle(),
                mock.pane(&window_label, 0),
                None,
                "https://example.com/".to_string()
            ))
            .unwrap_err(),
            "browser tabs can only be driven from the browser window"
        );
        assert_eq!(
            block_on(browser_navigate(
                mock.handle(),
                chrome.clone(),
                Some("oleafly-browser-pane-gone".to_string()),
                "https://example.com/".to_string()
            ))
            .unwrap_err(),
            "that browser tab is no longer open"
        );

        block_on(browser_back(mock.handle(), chrome.clone(), pane.clone())).expect("back");
        block_on(browser_forward(mock.handle(), chrome.clone(), pane.clone())).expect("forward");
        block_on(browser_reload(mock.handle(), chrome.clone(), pane.clone())).expect("reload");
        assert_eq!(
            block_on(browser_back(mock.handle(), mock.main.clone(), pane.clone())).unwrap_err(),
            "browser tabs can only be driven from the browser window"
        );
        assert_eq!(
            eval_in_pane(
                &mock.handle(),
                &chrome,
                "oleafly-browser-pane-gone".to_string(),
                "history.back()"
            )
            .unwrap_err(),
            "that browser tab is no longer open"
        );

        with_window_state(&window_label, |state| state.active = None).unwrap();
        assert_eq!(
            resolve_pane(&mock.handle(), &chrome, None).err(),
            Some("the browser window has no open tab".to_string())
        );
        forget_window(&window_label);
        assert_eq!(
            resolve_pane(&mock.handle(), &mock.main, None).err(),
            Some("the browser window is not open".to_string())
        );
    }

    #[test]
    fn hiding_the_content_keeps_the_active_pane_off_screen() {
        let _registry = GlobalRegistry::acquire();
        let mock = MockApp::new();
        let window_label = mock.open("https://example.com/");
        let chrome = mock.chrome(&window_label);

        block_on(browser_content_visible(
            mock.handle(),
            chrome.clone(),
            false,
        ))
        .expect("hide the content");
        assert!(with_window_state(&window_label, |state| state.overlay_open).unwrap());

        let hidden = mock.tabs(&window_label)[0].clone();
        block_on(browser_tab_activate(
            mock.handle(),
            chrome.clone(),
            hidden.clone(),
        ))
        .expect("activating while the overlay is open leaves the pane hidden");

        block_on(browser_content_visible(mock.handle(), chrome.clone(), true))
            .expect("show the content");
        assert!(!with_window_state(&window_label, |state| state.overlay_open).unwrap());
        assert_eq!(
            block_on(browser_content_visible(
                mock.handle(),
                mock.main.clone(),
                true
            ))
            .unwrap_err(),
            "browser tabs can only be driven from the browser window"
        );
    }

    #[test]
    fn a_page_title_reaches_the_tab_and_the_window() {
        let _registry = GlobalRegistry::acquire();
        let mock = MockApp::new();
        let window_label = mock.open("https://example.com/");
        let pane = mock.pane(&window_label, 0);

        on_title_changed(pane.clone(), "Example Domain".to_string());
        assert_eq!(
            with_window_state(&window_label, |state| state.tabs[0].title.clone()).unwrap(),
            "Example Domain"
        );

        with_window_state(&window_label, |state| state.active = None).unwrap();
        on_title_changed(pane, "Background".to_string());
        assert_eq!(
            with_window_state(&window_label, |state| state.tabs[0].title.clone()).unwrap(),
            "Background"
        );

        on_title_changed(mock.main.clone(), "Not A Tab".to_string());
    }

    #[test]
    fn resizing_moves_the_chrome_and_every_pane() {
        let _registry = GlobalRegistry::acquire();
        let mock = MockApp::new();
        let window_label = mock.open("https://example.com/");
        let window = find_window(mock.app.handle(), &window_label).expect("window");

        apply_layout(&window, PhysicalSize::new(1200, 800), 2.0);
        apply_layout(&window, PhysicalSize::new(0, 0), 1.0);

        forget_window(&window_label);
        apply_layout(&window, PhysicalSize::new(1200, 800), 1.0);
        assert_eq!(
            find_webview(&window, "oleafly-browser-pane-gone").unwrap_err(),
            "that browser tab is no longer open"
        );
        assert_eq!(
            find_window(mock.app.handle(), "oleafly-browser-window-ghost").unwrap_err(),
            "the browser window is not open"
        );
    }

    #[test]
    fn a_destroyed_window_is_forgotten_exactly_once() {
        let _registry = GlobalRegistry::acquire();
        let mock = MockApp::new();
        let window_label = mock.open("https://example.com/");

        on_window_destroyed(&mock.handle(), &window_label);
        assert!(with_window_state(&window_label, |_| ()).is_err());
        on_window_destroyed(&mock.handle(), &window_label);
        assert_eq!(latest_window_label(), None);
    }

    #[test]
    fn a_popup_request_opens_another_tab_in_the_same_window() {
        let _registry = GlobalRegistry::acquire();
        let mock = MockApp::new();
        let window_label = mock.open("https://example.com/");

        request_tab(
            mock.handle(),
            window_label.clone(),
            "https://example.com/popup".parse().expect("url"),
        );
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while mock.tabs(&window_label).len() < 2 && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert_eq!(mock.tabs(&window_label).len(), 2);
        assert_eq!(
            with_window_state(&window_label, |state| state.tabs[1].url.clone()).unwrap(),
            "https://example.com/popup"
        );

        request_tab(
            mock.handle(),
            "oleafly-browser-window-ghost".to_string(),
            "https://example.com/popup".parse().expect("url"),
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert_eq!(mock.tabs(&window_label).len(), 2);
    }

    struct Invokable(Webview<MockRuntime>);

    impl AsRef<Webview<MockRuntime>> for Invokable {
        fn as_ref(&self) -> &Webview<MockRuntime> {
            &self.0
        }
    }

    fn invoke(
        webview: &Webview<MockRuntime>,
        cmd: &str,
        body: serde_json::Value,
    ) -> Result<serde_json::Value, serde_json::Value> {
        tauri::test::get_ipc_response(
            &Invokable(webview.clone()),
            tauri::webview::InvokeRequest {
                cmd: cmd.to_string(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(windows) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .expect("origin"),
                body: body.into(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .map(|body| body.deserialize::<serde_json::Value>().expect("response"))
    }

    #[test]
    fn every_browser_command_is_reachable_over_the_ipc_bridge() {
        let _registry = GlobalRegistry::acquire();
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![
                browser_window_open,
                browser_window_focus,
                browser_window_close,
                browser_state,
                browser_tab_open,
                browser_tab_activate,
                browser_tab_close,
                browser_navigate,
                browser_back,
                browser_forward,
                browser_reload,
                browser_content_visible
            ])
            .build(mock_context(noop_assets()))
            .expect("mock app");
        let main = WebviewWindowBuilder::new(app.handle(), "main", Default::default())
            .build()
            .expect("main window");
        let main = main.as_ref().clone();

        let window_label = invoke(
            &main,
            "browser_window_open",
            serde_json::json!({ "url": "https://example.com/one" }),
        )
        .expect("browser_window_open")
        .as_str()
        .expect("window label")
        .to_string();
        let window = find_window(app.handle(), &window_label).expect("window");
        let chrome_label = with_window_state(&window_label, |state| state.chrome.clone()).unwrap();
        let chrome = find_webview(&window, &chrome_label).expect("chrome webview");

        let snapshot = invoke(&chrome, "browser_state", serde_json::json!({})).expect("state");
        assert_eq!(snapshot["window"], window_label.as_str());
        let first = snapshot["tabs"][0]["label"]
            .as_str()
            .expect("first tab")
            .to_string();

        let second = invoke(
            &chrome,
            "browser_tab_open",
            serde_json::json!({ "url": "https://example.com/two" }),
        )
        .expect("browser_tab_open")
        .as_str()
        .expect("tab label")
        .to_string();

        invoke(
            &chrome,
            "browser_navigate",
            serde_json::json!({ "tab": null, "url": "https://example.com/three" }),
        )
        .expect("browser_navigate");
        for command in ["browser_back", "browser_forward", "browser_reload"] {
            invoke(&chrome, command, serde_json::json!({ "tab": second }))
                .unwrap_or_else(|error| panic!("{command}: {error}"));
        }
        invoke(
            &chrome,
            "browser_content_visible",
            serde_json::json!({ "visible": false }),
        )
        .expect("browser_content_visible");
        invoke(
            &chrome,
            "browser_tab_activate",
            serde_json::json!({ "tab": first }),
        )
        .expect("browser_tab_activate");
        invoke(
            &chrome,
            "browser_tab_close",
            serde_json::json!({ "tab": second }),
        )
        .expect("browser_tab_close");
        assert_eq!(
            with_window_state(&window_label, |state| state.tabs.len()).unwrap(),
            1
        );

        invoke(
            &main,
            "browser_window_focus",
            serde_json::json!({ "label": window_label }),
        )
        .expect("browser_window_focus");
        invoke(
            &main,
            "browser_window_close",
            serde_json::json!({ "label": window_label }),
        )
        .expect("browser_window_close");
        assert_eq!(
            invoke(&main, "browser_state", serde_json::json!({})).unwrap_err(),
            serde_json::json!("browser tabs can only be driven from the browser window")
        );
    }
}
