use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime, Url, Webview};

struct Origins {
    app: Vec<Url>,
    artifact: Option<Url>,
    video_page: Option<Url>,
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
        Self::new(dev_url(webview), crate::note_video::origin())
    }

    fn new(dev: Option<Url>, video_page: Option<&str>) -> Self {
        let app = if cfg!(any(windows, target_os = "android")) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        };
        Self {
            app: Url::parse(app).ok().into_iter().chain(dev).collect(),
            artifact: Url::parse(&crate::artifact_frame::frame_origin()).ok(),
            video_page: video_page.and_then(|origin| Url::parse(origin).ok()),
            players: crate::note_video::PLAYERS
                .iter()
                .filter_map(|(origin, path)| Url::parse(origin).ok().map(|origin| (origin, *path)))
                .collect(),
        }
    }

    fn app_document(&self, url: &Url) -> bool {
        self.app.iter().any(|origin| same_origin(url, origin))
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
        "blob" => Url::parse(url.path()).is_ok_and(|inner| origins.app_document(&inner)),
        _ => {
            origins.app_document(url)
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

pub(crate) fn plugin<R: Runtime>() -> TauriPlugin<R> {
    let builder = Builder::new("oleafly-navigation-guard").on_navigation(|webview, url| {
        !guards(webview.label()) || allowed(url, &Origins::of(webview))
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

    use super::{allowed, dev_url, guards, Origins};

    pub(super) fn guard<R: Runtime>(webview: &Webview<R>) {
        if !guards(webview.label()) {
            return;
        }
        let dev = dev_url(webview);
        let label = webview.label().to_string();
        let installed = webview.with_webview(move |platform| {
            let handler = NavigationStartingEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut uri = PWSTR::null();
                // SAFETY: `args` is the live event argument WebView2 passed to this handler, and `uri` is an out pointer that `take_pwstr` frees.
                unsafe { args.Uri(&mut uri)? };
                let origins = Origins::new(dev.clone(), crate::note_video::origin());
                let allow = take_pwstr(uri)
                    .parse::<tauri::Url>()
                    .is_ok_and(|url| allowed(&url, &origins));
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

    fn log(line: String) {
        tauri::async_runtime::spawn_blocking(move || {
            let _ = crate::project::append_app_log(line);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    const VIDEO_PAGE: &str = "http://127.0.0.1:43123";

    #[test]
    fn only_app_documents_artifact_frames_video_players_and_local_documents_may_load() {
        let packaged = Origins::new(None, Some(VIDEO_PAGE));
        let dev = Origins::new(Some(url("http://localhost:1420")), Some(VIDEO_PAGE));
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
    fn the_video_page_is_allowed_only_once_its_server_has_a_port() {
        let before = Origins::new(None, None);
        assert!(!allowed(&url("http://127.0.0.1:43123/video"), &before));
        assert!(allowed(
            &url("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"),
            &before
        ));
        let after = Origins::new(None, Some(VIDEO_PAGE));
        assert!(allowed(&url("http://127.0.0.1:43123/video"), &after));
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
