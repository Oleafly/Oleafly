use std::collections::HashSet;
use std::sync::{Mutex, OnceLock, PoisonError};

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime, Url, Webview};

struct Origins {
    app: Vec<Url>,
    artifact: Option<Url>,
    video_page: Option<Url>,
    html_preview: Option<Url>,
    players: Vec<(Url, &'static str)>,
}

fn dev_url<R: Runtime>(webview: &Webview<R>) -> Option<Url> {
    if tauri::is_dev() {
        webview.config().build.dev_url.clone()
    } else {
        None
    }
}

impl Origins {
    fn of<R: Runtime>(webview: &Webview<R>) -> Self {
        Self::current(dev_url(webview))
    }

    fn current(dev: Option<Url>) -> Self {
        Self::new(
            dev,
            crate::note_video::origin(),
            crate::html_preview::origin().as_deref(),
        )
    }

    fn new(dev: Option<Url>, video_page: Option<&str>, html_preview: Option<&str>) -> Self {
        Self {
            app: packaged_app().into_iter().chain(dev).collect(),
            artifact: Url::parse(&crate::artifact_frame::frame_origin()).ok(),
            video_page: video_page.and_then(|origin| Url::parse(origin).ok()),
            html_preview: html_preview.and_then(|origin| Url::parse(origin).ok()),
            players: crate::note_video::PLAYERS
                .iter()
                .filter_map(|(origin, path)| Url::parse(origin).ok().map(|origin| (origin, *path)))
                .collect(),
        }
    }

    fn app_document(&self, url: &Url) -> bool {
        self.app.iter().any(|origin| same_origin(url, origin))
    }

    fn html_page(&self, url: &Url) -> bool {
        self.html_preview
            .as_ref()
            .is_some_and(|origin| same_origin(url, origin))
    }

    fn video(&self, url: &Url) -> bool {
        self.video_page
            .as_ref()
            .is_some_and(|origin| same_origin(url, origin))
            || (url.username().is_empty()
                && url.password().is_none()
                && self
                    .players
                    .iter()
                    .any(|(origin, path)| same_origin(url, origin) && url.path().starts_with(path)))
    }
}

fn packaged_app() -> Option<Url> {
    let app = if cfg!(any(windows, target_os = "android")) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    };
    Url::parse(app).ok()
}

fn page_origin(dev: Option<Url>) -> String {
    let Some(page) = dev.or_else(packaged_app) else {
        return String::new();
    };
    let host = page.host_str().unwrap_or_default();
    match page.port() {
        Some(port) => format!("{}://{host}:{port}", page.scheme()),
        None => format!("{}://{host}", page.scheme()),
    }
}

static APP_PAGE_ORIGIN: OnceLock<String> = OnceLock::new();

pub(crate) fn with_app_page_origin(script: &str) -> String {
    let origin = APP_PAGE_ORIGIN.get_or_init(|| page_origin(None));
    let literal = serde_json::to_string(origin).unwrap_or_else(|_| "\"\"".to_owned());
    script.replace("\"__OLEAFLY_APP_ORIGIN__\"", &literal)
}

fn same_origin(url: &Url, origin: &Url) -> bool {
    url.scheme() == origin.scheme()
        && url
            .host_str()
            .zip(origin.host_str())
            .is_some_and(|(host, expected)| host.eq_ignore_ascii_case(expected))
        && url.port_or_known_default() == origin.port_or_known_default()
}

fn allowed(url: &Url, origins: &Origins) -> bool {
    match url.scheme() {
        "about" => matches!(url.path(), "blank" | "srcdoc"),
        "blob" => Url::parse(url.path())
            .is_ok_and(|inner| origins.app_document(&inner) || origins.html_page(&inner)),
        _ => {
            origins.app_document(url)
                || origins.html_page(url)
                || origins
                    .artifact
                    .as_ref()
                    .is_some_and(|artifact| same_origin(url, artifact))
                || origins.video(url)
        }
    }
}

fn guards(label: &str) -> bool {
    !label.starts_with(crate::overleaf::SIGN_IN_LABEL_PREFIX)
}

fn destination(url: &Url) -> String {
    let origin = url.origin();
    if origin.is_tuple() {
        origin.ascii_serialization()
    } else {
        format!("a {}: address", url.scheme())
    }
}

fn first_block(label: &str, url: &Url) -> Option<String> {
    static SEEN: Mutex<Option<HashSet<(String, String)>>> = Mutex::new(None);
    let target = destination(url);
    let mut seen = SEEN.lock().unwrap_or_else(PoisonError::into_inner);
    seen.get_or_insert_with(HashSet::new)
        .insert((label.to_owned(), target.clone()))
        .then(|| format!("Navigation guard kept the {label} webview from loading {target}"))
}

fn log(line: String) {
    tauri::async_runtime::spawn_blocking(move || {
        let _ = crate::project::append_app_log(line);
    });
}

pub(crate) fn plugin<R: Runtime>() -> TauriPlugin<R> {
    let builder = Builder::new("oleafly-navigation-guard")
        .setup(|app, _| {
            let dev = tauri::is_dev()
                .then(|| app.config().build.dev_url.clone())
                .flatten();
            let _ = APP_PAGE_ORIGIN.set(page_origin(dev));
            Ok(())
        })
        .on_navigation(|webview, url| {
            let label = webview.label();
            let allow = !guards(label) || allowed(url, &Origins::of(webview));
            if !allow {
                if let Some(line) = first_block(label, url) {
                    log(line);
                }
            }
            allow
        });
    #[cfg(windows)]
    let builder = builder.on_webview_ready(|webview| frames::guard(&webview));
    #[cfg(target_os = "macos")]
    let builder = builder.on_webview_ready(|webview| {
        if guards(webview.label()) {
            crate::webview_user_agent::apply(&webview);
        }
    });
    builder.build()
}

#[cfg(windows)]
mod frames {
    use tauri::{Runtime, Webview};
    use webview2_com::{take_pwstr, NavigationStartingEventHandler};
    use windows_core::PWSTR;

    use super::{allowed, dev_url, first_block, guards, log, Origins};

    pub(super) fn guard<R: Runtime>(webview: &Webview<R>) {
        if !guards(webview.label()) {
            return;
        }
        let dev = dev_url(webview);
        let label = webview.label().to_string();
        let installed = webview.with_webview(move |platform| {
            let frame_label = label.clone();
            let handler = NavigationStartingEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut uri = PWSTR::null();
                // SAFETY: `args` is the live event argument WebView2 passed to this handler, and `uri` is an out pointer that `take_pwstr` frees.
                unsafe { args.Uri(&mut uri)? };
                let origins = Origins::current(dev.clone());
                let target = take_pwstr(uri).parse::<tauri::Url>().ok();
                let allow = target.as_ref().is_some_and(|url| allowed(url, &origins));
                if let Some(line) = target
                    .as_ref()
                    .filter(|_| !allow)
                    .and_then(|url| first_block(&frame_label, url))
                {
                    log(line);
                }
                // SAFETY: as above; cancelling is valid for every FrameNavigationStarting event.
                unsafe { args.SetCancel(!allow) }
            }));
            let mut token = 0;
            // SAFETY: the controller belongs to this webview and is used on the thread `with_webview` runs on.
            let added = unsafe {
                platform
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.add_FrameNavigationStarting(&handler, &mut token))
            };
            if let Err(error) = added {
                log(format!(
                    "Navigation guard for child frames was not installed in the {label} webview: {error}"
                ));
            }
        });
        if let Err(error) = installed {
            log(format!(
                "Navigation guard for child frames could not reach the {} webview: {error}",
                webview.label()
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    const VIDEO_PAGE: &str = "http://127.0.0.1:43123";
    const HTML_PREVIEW: &str = "http://127.0.0.1:52011";

    #[test]
    fn only_app_documents_artifact_frames_video_players_and_local_documents_may_load() {
        let packaged = Origins::new(None, Some(VIDEO_PAGE), Some(HTML_PREVIEW));
        let dev = Origins::new(
            Some(url("http://localhost:1420")),
            Some(VIDEO_PAGE),
            Some(HTML_PREVIEW),
        );
        let windows = cfg!(any(windows, target_os = "android"));
        let cases: &[(&str, bool, bool)] = &[
            ("tauri://localhost/", !windows, !windows),
            (
                "tauri://localhost/index.html?view=preview",
                !windows,
                !windows,
            ),
            (
                "http://tauri.localhost/index.html?view=update",
                windows,
                windows,
            ),
            (
                "oleafly-artifact://localhost/0123456789abcdef0123456789abcdef",
                !windows,
                !windows,
            ),
            (
                "http://oleafly-artifact.localhost/0123456789abcdef0123456789abcdef",
                windows,
                windows,
            ),
            ("http://oleafly-artifact.localhost:8080/x", false, false),
            ("http://localhost:1420/", false, true),
            (
                "http://localhost:1420/index.html?view=preview#x",
                false,
                true,
            ),
            ("http://localhost:1421/", false, false),
            ("http://127.0.0.1:1420/", false, false),
            ("https://localhost:1420/", false, false),
            ("about:blank", true, true),
            ("about:srcdoc", true, true),
            ("about:config", false, false),
            ("blob:tauri://localhost/5a0e6c1e", !windows, !windows),
            ("blob:http://tauri.localhost/5a0e6c1e", windows, windows),
            ("blob:http://localhost:1420/5a0e6c1e", false, true),
            ("blob:null/5a0e6c1e", false, false),
            ("blob:https://evil.example/5a0e6c1e", false, false),
            (
                "data:text/html,<script>fetch('https://evil.example')</script>",
                false,
                false,
            ),
            ("javascript:alert(1)", false, false),
            ("https://evil.example/c?d=secret", false, false),
            ("http://evil.example/", false, false),
            ("http://192.168.1.1/admin", false, false),
            ("http://localhost/", false, false),
            ("http://tauri.localhost.evil.example/", false, false),
            ("tauri://evil.example/", false, false),
            ("file:///etc/passwd", false, false),
            ("oleafly://note/abc", false, false),
            ("mailto:someone@example.com", false, false),
            ("http://127.0.0.1:43123/video", true, true),
            (
                "http://127.0.0.1:43123/video#youtube/dQw4w9WgXcQ?start=5",
                true,
                true,
            ),
            ("http://127.0.0.1:43124/video", false, false),
            ("http://127.0.0.1/video", false, false),
            ("https://127.0.0.1:43123/video", false, false),
            ("http://localhost:43123/video", false, false),
            ("http://[::1]:43123/video", false, false),
            ("blob:http://127.0.0.1:43123/5a0e6c1e", false, false),
            (
                "http://127.0.0.1:52011/0123456789abcdef0123456789abcdef/web/index.html?v=3",
                true,
                true,
            ),
            ("http://127.0.0.1:52011/", true, true),
            ("blob:http://127.0.0.1:52011/5a0e6c1e", true, true),
            ("http://127.0.0.1:52012/token/index.html", false, false),
            ("https://127.0.0.1:52011/token/index.html", false, false),
            ("http://localhost:52011/token/index.html", false, false),
            ("http://[::1]:52011/token/index.html", false, false),
            (
                "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&start=5",
                true,
                true,
            ),
            (
                "https://WWW.YouTube-NoCookie.com/embed/dQw4w9WgXcQ",
                true,
                true,
            ),
            ("https://www.youtube-nocookie.com:443/embed/x", true, true),
            (
                "https://player.vimeo.com/video/76979871?autoplay=1&dnt=1&h=ab12",
                true,
                true,
            ),
            ("https://www.youtube-nocookie.com/", false, false),
            (
                "https://www.youtube-nocookie.com/watch?v=dQw4w9WgXcQ",
                false,
                false,
            ),
            (
                "https://www.youtube-nocookie.com/embed/../watch",
                false,
                false,
            ),
            (
                "https://www.youtube-nocookie.com:8443/embed/x",
                false,
                false,
            ),
            ("http://www.youtube-nocookie.com/embed/x", false, false),
            ("https://www.youtube.com/embed/dQw4w9WgXcQ", false, false),
            ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", false, false),
            ("https://youtube-nocookie.com/embed/x", false, false),
            (
                "https://www.youtube-nocookie.com.evil.example/embed/x",
                false,
                false,
            ),
            (
                "https://evil.example/embed/x?https://www.youtube-nocookie.com",
                false,
                false,
            ),
            (
                "https://user@www.youtube-nocookie.com/embed/x",
                false,
                false,
            ),
            (
                "https://www.youtube-nocookie.com@evil.example/embed/x",
                false,
                false,
            ),
            ("https://player.vimeo.com/", false, false),
            ("https://player.vimeo.com/api/player.js", false, false),
            ("https://vimeo.com/76979871", false, false),
            ("blob:https://player.vimeo.com/5a0e6c1e", false, false),
        ];
        for (text, in_package, in_dev) in cases {
            let target = url(text);
            assert_eq!(allowed(&target, &packaged), *in_package, "packaged: {text}");
            assert_eq!(allowed(&target, &dev), *in_dev, "dev: {text}");
        }
    }

    #[test]
    fn the_video_page_and_html_previews_are_allowed_only_once_their_servers_have_a_port() {
        let before = Origins::new(None, None, None);
        assert!(!allowed(&url("http://127.0.0.1:43123/video"), &before));
        assert!(!allowed(
            &url("http://127.0.0.1:52011/token/index.html"),
            &before
        ));
        assert!(allowed(
            &url("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"),
            &before
        ));
        let after = Origins::new(None, Some(VIDEO_PAGE), Some(HTML_PREVIEW));
        assert!(allowed(&url("http://127.0.0.1:43123/video"), &after));
        assert!(allowed(
            &url("http://127.0.0.1:52011/token/index.html"),
            &after
        ));
    }

    #[test]
    fn a_blocked_destination_is_logged_once_per_webview_without_its_path() {
        let secret = url("https://blocked-once.example/c?d=secret");
        let line = first_block("main", &secret).unwrap();
        assert_eq!(
            line,
            "Navigation guard kept the main webview from loading https://blocked-once.example"
        );
        assert_eq!(
            first_block("main", &url("https://blocked-once.example/other")),
            None
        );
        assert!(first_block("preview", &secret).is_some());
        assert_eq!(
            first_block("main", &url("data:text/html,secret")).as_deref(),
            Some("Navigation guard kept the main webview from loading a data: address")
        );
    }

    #[test]
    fn frames_post_only_to_the_origin_the_app_page_loads_from() {
        let packaged = if cfg!(any(windows, target_os = "android")) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        };
        assert_eq!(page_origin(None), packaged);
        assert_eq!(
            page_origin(Some(url("http://localhost:1420/"))),
            "http://localhost:1420"
        );
        let script =
            with_app_page_origin(r#"parent.postMessage(message, "__OLEAFLY_APP_ORIGIN__");"#);
        assert_eq!(
            script,
            format!(r#"parent.postMessage(message, "{packaged}");"#)
        );
    }

    #[test]
    fn the_sign_in_window_keeps_its_own_navigation_rules() {
        assert!(guards("main"));
        assert!(guards("preview"));
        assert!(guards("admin-console-1"));
        assert!(!guards(&format!(
            "{}3",
            crate::overleaf::SIGN_IN_LABEL_PREFIX
        )));
    }
}
