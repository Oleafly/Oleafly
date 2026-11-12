const WEBKIT_DEFAULT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const SAFARI_BUILD: &str = "605.1.15";
const FALLBACK_SAFARI: &str = "15.6";

fn safari_version(macos_major: u64, macos_minor: u64) -> String {
    let safari = match macos_major {
        11..=15 => macos_major + 3,
        16..=25 => macos_major + 10,
        26.. => macos_major,
        _ => return FALLBACK_SAFARI.into(),
    };
    format!("{safari}.{macos_minor}")
}

fn user_agent(macos: &tauri_plugin_os::Version) -> String {
    let safari = match macos {
        tauri_plugin_os::Version::Semantic(major, minor, _) => safari_version(*major, *minor),
        _ => FALLBACK_SAFARI.into(),
    };
    format!("{WEBKIT_DEFAULT} Version/{safari} Safari/{SAFARI_BUILD}")
}

#[cfg(target_os = "macos")]
pub(crate) fn apply<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use objc2_foundation::NSString;
    use std::sync::LazyLock;

    static AGENT: LazyLock<String> = LazyLock::new(|| user_agent(&tauri_plugin_os::version()));
    let label = webview.label().to_owned();
    let applied = webview.with_webview(|platform| {
        let view = platform.inner().cast::<AnyObject>();
        if view.is_null() {
            return;
        }
        let agent = NSString::from_str(&AGENT);
        // SAFETY: `inner` is this webview's live WKWebView, `with_webview` runs on the main thread, and setCustomUserAgent: takes one NSString.
        unsafe {
            let _: () = msg_send![&*view, setCustomUserAgent: &*agent];
        }
    });
    if let Err(error) = applied {
        let line = format!("The Safari user agent was not set on the {label} webview: {error}");
        tauri::async_runtime::spawn_blocking(move || {
            let _ = crate::project::append_app_log(line);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_os::Version;

    #[test]
    fn safari_versions_follow_the_running_macos() {
        assert_eq!(safari_version(15, 6), "18.6");
        assert_eq!(safari_version(14, 2), "17.2");
        assert_eq!(safari_version(11, 0), "14.0");
        assert_eq!(safari_version(26, 1), "26.1");
        assert_eq!(safari_version(16, 0), "26.0");
        assert_eq!(safari_version(10, 15), FALLBACK_SAFARI);
    }

    #[test]
    fn the_user_agent_keeps_webkits_default_and_adds_the_safari_token() {
        assert_eq!(
            user_agent(&Version::Semantic(15, 6, 1)),
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15"
        );
        assert_eq!(
            user_agent(&Version::Semantic(26, 1, 0)),
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15"
        );
        assert!(user_agent(&Version::Unknown).ends_with(" Version/15.6 Safari/605.1.15"));
    }
}
