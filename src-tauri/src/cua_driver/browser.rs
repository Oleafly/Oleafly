//! Websites with Cua Driver 0.38. A tab can only be driven after
//! `get_browser_state` binds one native browser window by pid and window id,
//! and every later call names the target and tab that bind returned. Agents
//! rarely know the pid or the window, so Oleafly fills them in: the browser
//! `browser_prepare` opened for this session (in the signed-in profile, the
//! user's running Chrome or Edge), that browser's largest window, and the
//! target and tab the last bind or page read returned.

use serde_json::{json, Map, Value};

use super::config::{AllowedApp, CuaDriverConfig};
use super::{Platform, RuntimeKind};

pub(crate) const PREPARE_FIRST_TEXT: &str =
    "Call browser_prepare first: it opens the separate browser. Then call get_browser_state.";
pub(crate) const OWN_BROWSER_TEXT: &str = "In the separate profile only the browser browser_prepare opened can be used. Call get_browser_state without pid or window_id.";
pub(crate) const NO_WINDOW_TEXT: &str =
    "The browser has no window to connect to yet. Call get_browser_state again in a moment.";
pub(crate) const BIND_FIRST_TEXT: &str = "Call get_browser_state first: it connects to the browser, and this call needs the target_id and tab_id it returns.";
pub(crate) const NO_BROWSER_TEXT: &str = "Chrome or Edge isn't open. Ask the user to open the site in their own browser, then call get_browser_state again.";

/// The Chromium browsers Cua Driver launches or attaches to. The browser
/// manifests list them so a bind can name their windows; 0.38 refuses a
/// window of an app the manifest doesn't list.
pub(crate) fn known_browsers() -> Vec<AllowedApp> {
    let program_files = |name: &str, fallback: &str| {
        std::env::var(name)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| fallback.to_string())
    };
    browsers_on(
        Platform::current(),
        &program_files("ProgramFiles", r"C:\Program Files"),
        &program_files("ProgramFiles(x86)", r"C:\Program Files (x86)"),
    )
}

/// The browsers Cua Driver 0.38 accepts on `platform`: vendor-signed
/// Chrome and Edge on macOS and Windows, the root-owned package payloads on
/// Linux (with Chrome's binary, which owns the windows, beside its wrapper).
fn browsers_on(
    platform: Option<Platform>,
    program_files: &str,
    program_files_x86: &str,
) -> Vec<AllowedApp> {
    let app = |name: &str, bundle_id: Option<&str>, executable: Option<String>| AllowedApp {
        name: name.into(),
        bundle_id: bundle_id.map(str::to_string),
        executable,
    };
    match platform {
        Some(Platform::Macos) => vec![
            app("Google Chrome", Some("com.google.Chrome"), None),
            app("Microsoft Edge", Some("com.microsoft.edgemac"), None),
        ],
        Some(Platform::Windows) => [
            (
                "Google Chrome",
                program_files,
                r"Google\Chrome\Application\chrome.exe",
            ),
            (
                "Google Chrome",
                program_files_x86,
                r"Google\Chrome\Application\chrome.exe",
            ),
            (
                "Microsoft Edge",
                program_files,
                r"Microsoft\Edge\Application\msedge.exe",
            ),
            (
                "Microsoft Edge",
                program_files_x86,
                r"Microsoft\Edge\Application\msedge.exe",
            ),
        ]
        .into_iter()
        .map(|(name, root, rest)| {
            app(
                name,
                None,
                Some(format!("{}\\{rest}", root.trim_end_matches('\\'))),
            )
        })
        .collect(),
        Some(Platform::Linux) => [
            ("Google Chrome", "/opt/google/chrome/chrome"),
            ("Google Chrome", "/opt/google/chrome/google-chrome"),
            ("Chromium", "/usr/lib/chromium/chromium"),
            ("Chromium", "/usr/lib/chromium-browser/chromium-browser"),
            ("Microsoft Edge", "/opt/microsoft/msedge/msedge"),
        ]
        .into_iter()
        .map(|(name, path)| app(name, None, Some(path.into())))
        .collect(),
        None => Vec::new(),
    }
}

pub(crate) fn main_window(answer: &Value) -> Option<u64> {
    answer
        .pointer("/structuredContent/windows")?
        .as_array()?
        .iter()
        .filter(|window| window.get("layer").and_then(Value::as_i64).unwrap_or(0) == 0)
        .filter_map(|window| {
            let id = window.get("window_id")?.as_u64()?;
            let bounds = window.get("bounds")?;
            let area = bounds.get("width")?.as_f64()? * bounds.get("height")?.as_f64()?;
            (area >= 10_000.0).then_some((id, area))
        })
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(id, _)| id)
}

/// In the separate profile `browser_prepare` launches the driver's own
/// browser, which 0.38 does only with `allow_launch` and a profile. A call
/// that names a running browser or a strategy is left alone.
pub(crate) fn prepare_defaults(kind: RuntimeKind, args: &mut Map<String, Value>) {
    if kind != RuntimeKind::Browser || args.contains_key("pid") || args.contains_key("strategy") {
        return;
    }
    args.insert("allow_launch".into(), Value::Bool(true));
    if !args.get("profile").is_some_and(Value::is_object) {
        args.insert(
            "profile".into(),
            json!({"mode": "isolated_named", "name": "oleafly"}),
        );
    }
}

pub(crate) fn site_allowed(config: &CuaDriverConfig, kind: RuntimeKind, url: &str) -> bool {
    if url.trim() == "about:blank" {
        return kind == RuntimeKind::Browser;
    }
    let Some(origin) = super::gate::origin_of(url) else {
        return false;
    };
    config
        .sites
        .iter()
        .filter(|site| kind == RuntimeKind::Browser || site.signed_in)
        .any(|site| super::gate::origin_of(&site.origin).as_deref() == Some(origin.as_str()))
}

pub(crate) fn answered_tab(structured: &Value) -> Option<String> {
    if let Some(tab) = structured.get("tab_id").and_then(Value::as_str) {
        return Some(tab.to_string());
    }
    let tabs = structured.get("tabs")?.as_array()?;
    tabs.iter()
        .find(|tab| tab.get("active").and_then(Value::as_bool) == Some(true))
        .or_else(|| tabs.first())
        .and_then(|tab| tab.get("tab_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cua_driver::config::AllowedSite;

    #[test]
    fn each_platform_lists_the_browsers_the_driver_accepts() {
        let mac = browsers_on(Some(Platform::Macos), "", "");
        assert_eq!(
            mac.iter()
                .filter_map(|app| app.bundle_id.as_deref())
                .collect::<Vec<_>>(),
            ["com.google.Chrome", "com.microsoft.edgemac"]
        );
        let windows = browsers_on(
            Some(Platform::Windows),
            r"D:\Programs\",
            r"C:\Program Files (x86)",
        );
        let paths: Vec<&str> = windows
            .iter()
            .filter_map(|app| app.executable.as_deref())
            .collect();
        assert!(paths.contains(&r"D:\Programs\Google\Chrome\Application\chrome.exe"));
        assert!(paths.contains(&r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"));
        let linux = browsers_on(Some(Platform::Linux), "", "");
        assert!(linux
            .iter()
            .any(|app| app.executable.as_deref() == Some("/opt/google/chrome/chrome")));
        assert!(browsers_on(None, "", "").is_empty());
    }

    #[test]
    fn the_largest_normal_window_is_bound_never_a_bubble() {
        let answer = json!({"structuredContent": {"windows": [
            {"window_id": 179696, "layer": 0, "title": "Restore pages?", "bounds": {"width": 320.0, "height": 238.0}},
            {"window_id": 179685, "layer": 0, "title": "about:blank", "bounds": {"width": 1200.0, "height": 1051.0}},
            {"window_id": 5, "layer": 3, "title": "menu", "bounds": {"width": 4000.0, "height": 4000.0}},
        ]}});
        assert_eq!(main_window(&answer), Some(179685));
        assert_eq!(
            main_window(&json!({"structuredContent": {"windows": []}})),
            None
        );
    }

    #[test]
    fn prepare_launches_the_separate_browser_unless_told_otherwise() {
        let mut args = Map::new();
        prepare_defaults(RuntimeKind::Browser, &mut args);
        assert_eq!(args["allow_launch"], json!(true));
        assert_eq!(args["profile"]["mode"], json!("isolated_named"));
        let mut own = Map::new();
        own.insert("profile".into(), json!({"mode": "isolated_new"}));
        prepare_defaults(RuntimeKind::Browser, &mut own);
        assert_eq!(own["profile"], json!({"mode": "isolated_new"}));
        let mut named = Map::new();
        named.insert("profile".into(), json!("separate"));
        prepare_defaults(RuntimeKind::Browser, &mut named);
        assert_eq!(named["profile"]["mode"], json!("isolated_named"));
        let mut running = Map::new();
        running.insert("pid".into(), json!(7));
        prepare_defaults(RuntimeKind::Browser, &mut running);
        assert!(!running.contains_key("allow_launch"));
        let mut signed_in = Map::new();
        prepare_defaults(RuntimeKind::SignedInBrowser, &mut signed_in);
        assert!(signed_in.is_empty());
    }

    #[test]
    fn a_tab_goes_only_to_a_listed_site() {
        let config = CuaDriverConfig {
            sites: vec![
                AllowedSite {
                    origin: "https://example.org".into(),
                    signed_in: false,
                },
                AllowedSite {
                    origin: "https://journal.example.com".into(),
                    signed_in: true,
                },
            ],
            ..CuaDriverConfig::default()
        };
        let separate = RuntimeKind::Browser;
        assert!(site_allowed(&config, separate, "https://example.org/a?b=1"));
        assert!(site_allowed(&config, separate, "about:blank"));
        assert!(!site_allowed(
            &config,
            separate,
            "https://www.wikipedia.org"
        ));
        assert!(!site_allowed(
            &config,
            separate,
            "https://example.org.evil.test"
        ));
        assert!(!site_allowed(&config, separate, "file:///etc/passwd"));
        let signed_in = RuntimeKind::SignedInBrowser;
        assert!(site_allowed(
            &config,
            signed_in,
            "https://journal.example.com/x"
        ));
        assert!(!site_allowed(&config, signed_in, "https://example.org"));
        assert!(!site_allowed(&config, signed_in, "about:blank"));
    }

    #[test]
    fn the_tab_comes_from_the_answer_or_the_active_one_of_a_bind() {
        assert_eq!(
            answered_tab(
                &json!({"tab_id": "tab-1", "tabs": [{"tab_id": "tab-2", "active": true}]})
            ),
            Some("tab-1".into())
        );
        assert_eq!(
            answered_tab(
                &json!({"tabs": [{"tab_id": "tab-2"}, {"tab_id": "tab-3", "active": true}]})
            ),
            Some("tab-3".into())
        );
        assert_eq!(answered_tab(&json!({"tabs": []})), None);
    }
}
