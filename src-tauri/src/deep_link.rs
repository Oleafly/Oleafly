#[cfg(test)]
mod tests;

use serde::Serialize;
use std::sync::{Mutex, MutexGuard, PoisonError};
use tauri::webview::{PageLoadEvent, PageLoadPayload};
use tauri::{AppHandle, Emitter, Manager, Runtime, Webview};

pub(crate) const SCHEME: &str = "oleafly";
pub(crate) const TEMPLATE_LINK_EVENT: &str = "template-link";
const MAIN_WINDOW: &str = "main";
const TEMPLATE_HOST: &str = "template";
const MAX_LINK_LEN: usize = 512;
pub(crate) const MAX_ID_LEN: usize = 128;
const LOGGED_CHARS: usize = 160;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TemplateLink {
    pub(crate) pack_id: String,
    pub(crate) template_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Rejection {
    OtherScheme,
    Malformed,
}

pub(crate) fn is_deep_link_arg(text: &str) -> bool {
    text.get(..=SCHEME.len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("oleafly:"))
}

fn link_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'/')
}

fn valid_id(id: &str) -> bool {
    id.len() <= MAX_ID_LEN && crate::template_packs::is_valid_id(id)
}

pub(crate) fn parse(raw: &str) -> Result<TemplateLink, Rejection> {
    if !is_deep_link_arg(raw) {
        return Err(Rejection::OtherScheme);
    }
    if raw.len() > MAX_LINK_LEN {
        return Err(Rejection::Malformed);
    }
    let rest = raw[SCHEME.len() + 1..]
        .strip_prefix("//")
        .ok_or(Rejection::Malformed)?;
    if !rest.bytes().all(link_byte) {
        return Err(Rejection::Malformed);
    }
    let mut segments = rest.split('/');
    let (Some(TEMPLATE_HOST), Some(pack_id), Some(template_id), None) = (
        segments.next(),
        segments.next(),
        segments.next(),
        segments.next(),
    ) else {
        return Err(Rejection::Malformed);
    };
    if !valid_id(pack_id) || !valid_id(template_id) {
        return Err(Rejection::Malformed);
    }
    Ok(TemplateLink {
        pack_id: pack_id.to_string(),
        template_id: template_id.to_string(),
    })
}

pub(crate) fn ignored_message(raw: &str) -> String {
    let shown: String = raw
        .chars()
        .take(LOGGED_CHARS)
        .flat_map(char::escape_debug)
        .collect();
    let cut = if raw.chars().nth(LOGGED_CHARS).is_some() {
        "…"
    } else {
        ""
    };
    format!("Ignored a link that is not oleafly://template/<pack>/<template>: \"{shown}{cut}\"")
}

#[derive(Default)]
struct InboxState {
    ready: bool,
    waiting: Option<TemplateLink>,
}

#[derive(Default)]
pub(crate) struct LinkInbox {
    state: Mutex<InboxState>,
}

impl LinkInbox {
    fn state(&self) -> MutexGuard<'_, InboxState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn admit(&self, link: TemplateLink) -> Option<TemplateLink> {
        let mut state = self.state();
        if state.ready {
            return Some(link);
        }
        state.waiting = Some(link);
        None
    }

    pub(crate) fn open(&self) -> Option<TemplateLink> {
        let mut state = self.state();
        state.ready = true;
        state.waiting.take()
    }

    pub(crate) fn close(&self) {
        self.state().ready = false;
    }
}

pub(crate) fn reported(rejection: Rejection, raw: &str) -> bool {
    rejection == Rejection::Malformed && !crate::collab::links::is_link(raw)
}

pub(crate) fn receive<R: Runtime>(app: &AppHandle<R>, raw: &str) {
    match parse(raw) {
        Ok(link) => deliver(app, link),
        Err(rejection) if reported(rejection, raw) => {
            let _ = crate::project::append_app_log(ignored_message(raw));
        }
        Err(_) => {}
    }
}

fn deliver<R: Runtime>(app: &AppHandle<R>, link: TemplateLink) {
    crate::single_instance::reveal_main_window(app);
    let Some(inbox) = app.try_state::<LinkInbox>() else {
        return;
    };
    if let Some(link) = inbox.admit(link) {
        let _ = app.emit_to(MAIN_WINDOW, TEMPLATE_LINK_EVENT, link);
    }
}

pub(crate) fn plugin_allowed(native_argv: bool, args_unicode: bool) -> bool {
    !native_argv || args_unicode
}

pub(crate) fn enabled_for_this_launch() -> bool {
    let allowed = plugin_allowed(
        cfg!(any(windows, target_os = "linux")),
        crate::single_instance::args_are_forwardable(std::env::args_os()),
    );
    if !allowed {
        let _ = crate::project::append_app_log(
            "Links were turned off for this launch because a launch argument is not valid Unicode."
                .to_string(),
        );
    }
    allowed
}

pub(crate) fn start<R: Runtime>(app: &AppHandle<R>) {
    let Some(deep_link) = app.try_state::<tauri_plugin_deep_link::DeepLink<R>>() else {
        return;
    };
    let handle = app.clone();
    deep_link.on_open_url(move |event| {
        for url in event.urls() {
            receive(&handle, url.as_str());
        }
    });
    match deep_link.get_current() {
        Ok(Some(urls)) => {
            for url in urls {
                receive(app, url.as_str());
            }
        }
        Ok(None) => {}
        Err(error) => {
            let _ = crate::project::append_app_log(format!(
                "Could not read the link this launch was opened with: {error}"
            ));
        }
    }
    register_at_runtime(app);
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Launch {
    pub(crate) registers_schemes: bool,
    pub(crate) debug_build: bool,
    pub(crate) automated: bool,
    pub(crate) appimage: bool,
}

pub(crate) fn registers_at_runtime(launch: Launch) -> bool {
    launch.registers_schemes && !launch.automated && (launch.debug_build || launch.appimage)
}

#[cfg(target_os = "linux")]
fn running_as_appimage<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.env().appimage.is_some()
}

#[cfg(not(target_os = "linux"))]
fn running_as_appimage<R: Runtime>(_app: &AppHandle<R>) -> bool {
    false
}

fn register_at_runtime<R: Runtime>(app: &AppHandle<R>) {
    let launch = Launch {
        registers_schemes: cfg!(any(windows, target_os = "linux")),
        debug_build: cfg!(debug_assertions),
        automated: cfg!(any(test, feature = "e2e-testing")),
        appimage: running_as_appimage(app),
    };
    if !registers_at_runtime(launch) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(deep_link) = app.try_state::<tauri_plugin_deep_link::DeepLink<R>>() else {
            return;
        };
        if deep_link.is_registered(SCHEME).unwrap_or(false) {
            return;
        }
        if let Err(error) = deep_link.register_all() {
            let _ = crate::project::append_app_log(format!(
                "Could not register oleafly:// links for this copy of Oleafly: {error}"
            ));
        }
    });
}

pub(crate) fn on_page_load<R: Runtime>(webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
    if crate::caller::own_window_label(webview).as_deref() != Some(MAIN_WINDOW)
        || !matches!(payload.event(), PageLoadEvent::Started)
    {
        return;
    }
    if let Some(inbox) = webview.try_state::<LinkInbox>() {
        inbox.close();
    }
}

pub(crate) fn claim_for<R: Runtime>(webview: &Webview<R>) -> Option<TemplateLink> {
    if crate::caller::own_window_label(webview).as_deref() != Some(MAIN_WINDOW) {
        return None;
    }
    webview.try_state::<LinkInbox>()?.open()
}

#[tauri::command]
pub async fn template_link_ready(webview: Webview) -> Result<Option<TemplateLink>, String> {
    Ok(claim_for(&webview))
}
