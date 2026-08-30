use serde::Serialize;
use tauri::{
    webview::{PageLoadEvent, PageLoadPayload},
    Emitter, Runtime, Webview,
};

const BROWSER_PAGE_LOAD_EVENT: &str = "browser-page-load";
const BROWSER_WEBVIEW_PREFIX: &str = "oleafly-browser-pane-";

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
struct BrowserPageLoadPayload {
    label: String,
    state: &'static str,
    url: String,
}

fn browser_page_load_payload(
    label: &str,
    url: &str,
    event: PageLoadEvent,
) -> Option<BrowserPageLoadPayload> {
    if !label.starts_with(BROWSER_WEBVIEW_PREFIX) {
        return None;
    }
    let state = match event {
        PageLoadEvent::Started => "started",
        PageLoadEvent::Finished => "finished",
    };
    Some(BrowserPageLoadPayload {
        label: label.to_owned(),
        state,
        url: url.to_owned(),
    })
}

pub fn on_page_load<R: Runtime>(webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
    let Some(event) =
        browser_page_load_payload(webview.label(), payload.url().as_str(), payload.event())
    else {
        return;
    };
    let _ = webview.emit(BROWSER_PAGE_LOAD_EVENT, event);
}

#[cfg(test)]
mod tests {
    use tauri::webview::PageLoadEvent;

    #[test]
    fn maps_browser_page_load_events() {
        let started = super::browser_page_load_payload(
            "oleafly-browser-pane-3",
            "https://example.com/start",
            PageLoadEvent::Started,
        )
        .expect("browser event");
        assert_eq!(started.label, "oleafly-browser-pane-3");
        assert_eq!(started.state, "started");
        assert_eq!(started.url, "https://example.com/start");

        let finished = super::browser_page_load_payload(
            "oleafly-browser-pane-3",
            "https://example.com/finish",
            PageLoadEvent::Finished,
        )
        .expect("browser event");
        assert_eq!(finished.state, "finished");
        assert_eq!(finished.url, "https://example.com/finish");
    }

    #[test]
    fn ignores_non_browser_webviews() {
        assert!(super::browser_page_load_payload(
            "main",
            "tauri://localhost",
            PageLoadEvent::Finished,
        )
        .is_none());
    }
}
