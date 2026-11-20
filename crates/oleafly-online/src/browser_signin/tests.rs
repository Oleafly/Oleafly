use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::json;

use super::discover::{installed_with, Probe};
use super::{
    bidi, cdp, header_for, run, sweep, BrowserCookie, BrowserSignInError, Driver, Engine,
    InstalledBrowser, Packaging, Profile,
};
use crate::browser_cookies::{BrowserId, HostPlatform};

#[derive(Default)]
struct FakeProbe {
    vars: HashMap<&'static str, &'static str>,
    files: HashSet<&'static str>,
    snap_launchers: HashSet<&'static str>,
    texts: HashMap<&'static str, &'static str>,
    registry: HashMap<(&'static str, &'static str), &'static str>,
    https: Option<&'static str>,
}

impl Probe for FakeProbe {
    fn var(&self, name: &str) -> Option<String> {
        self.vars.get(name).map(|value| value.to_string())
    }

    fn is_file(&self, path: &Path) -> bool {
        self.files.contains(path.to_string_lossy().as_ref())
    }

    fn snap_launcher(&self, path: &Path) -> bool {
        self.snap_launchers
            .contains(path.to_string_lossy().as_ref())
    }

    fn read(&self, path: &Path) -> Option<String> {
        self.texts
            .get(path.to_string_lossy().as_ref())
            .map(|text| text.to_string())
    }

    fn registry(&self, key: &str, value: &str) -> Option<String> {
        self.registry
            .iter()
            .find(|((stored_key, stored_value), _)| *stored_key == key && *stored_value == value)
            .map(|(_, found)| found.to_string())
    }

    fn launch_services_https(&self) -> Option<String> {
        self.https.map(str::to_string)
    }
}

type Row = (String, String, String);
type Case<'a> = (&'a str, HostPlatform, &'a FakeProbe, Vec<Row>);

fn listed(platform: HostPlatform, probe: &FakeProbe) -> Vec<Row> {
    installed_with(platform, probe)
        .into_iter()
        .map(|browser| {
            (
                browser.key(),
                browser.path.to_string_lossy().into_owned(),
                browser.profiles.to_string_lossy().into_owned(),
            )
        })
        .collect()
}

#[test]
fn browser_discovery_paths_per_os() {
    let mac = FakeProbe {
        vars: HashMap::from([("HOME", "/Users/ada")]),
        files: HashSet::from([
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Users/ada/Applications/Firefox.app/Contents/MacOS/firefox",
            "/Applications/Safari.app/Contents/MacOS/Safari",
        ]),
        https: Some("org.mozilla.Firefox"),
        ..FakeProbe::default()
    };
    let windows = FakeProbe {
        vars: HashMap::from([
            ("LOCALAPPDATA", r"C:\Users\ada\AppData\Local"),
            ("ProgramFiles(x86)", r"C:\Program Files (x86)"),
            ("ProgramFiles", r"C:\Program Files"),
        ]),
        files: HashSet::from([
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Mozilla Firefox\firefox.exe",
        ]),
        registry: HashMap::from([
            (
                (
                    r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
                    "",
                ),
                r#""C:\Program Files\Google\Chrome\Application\chrome.exe""#,
            ),
            (
                (
                    r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe",
                    "",
                ),
                r"C:\Program Files\Mozilla Firefox\firefox.exe",
            ),
            (
                (
                    r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\brave.exe",
                    "",
                ),
                r"C:\Gone\brave.exe",
            ),
            (
                (
                    r"HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice",
                    "ProgId",
                ),
                "MSEdgeHTM",
            ),
        ]),
        ..FakeProbe::default()
    };
    let linux = FakeProbe {
        vars: HashMap::from([
            ("HOME", "/home/ada"),
            ("PATH", "/usr/local/bin:/usr/bin:relative:/snap/bin"),
        ]),
        files: HashSet::from([
            "/usr/bin/google-chrome",
            "/usr/bin/firefox",
            "/snap/bin/firefox",
            "/snap/bin/chromium",
            "/var/lib/flatpak/exports/bin/org.mozilla.firefox",
            "/home/ada/.local/share/flatpak/exports/bin/com.brave.Browser",
        ]),
        snap_launchers: HashSet::from(["/usr/bin/firefox"]),
        texts: HashMap::from([(
            "/home/ada/.config/mimeapps.list",
            "[Added Associations]\nx-scheme-handler/https=google-chrome.desktop;\n\n[Default Applications]\nx-scheme-handler/http=org.mozilla.firefox.desktop\nx-scheme-handler/https=org.mozilla.firefox.desktop;google-chrome.desktop;\n",
        )]),
        ..FakeProbe::default()
    };
    let linux_custom_cache = FakeProbe {
        vars: HashMap::from([
            ("HOME", "/home/ada"),
            ("XDG_CACHE_HOME", "/data/cache"),
            ("XDG_CONFIG_HOME", "/data/config"),
            ("PATH", "/opt/bin"),
        ]),
        files: HashSet::from([
            "/opt/bin/chromium",
            "/usr/bin/microsoft-edge",
            "/usr/bin/firefox-esr",
        ]),
        texts: HashMap::from([(
            "/data/config/mimeapps.list",
            "[Default Applications]\nx-scheme-handler/https=firefox-esr.desktop\n",
        )]),
        ..FakeProbe::default()
    };

    let empty = FakeProbe::default();
    let owned = |rows: &[(&str, &str, &str)]| -> Vec<Row> {
        rows.iter()
            .map(|(key, path, profiles)| (key.to_string(), path.to_string(), profiles.to_string()))
            .collect()
    };
    let cases: Vec<Case> = vec![
        (
            "macOS lists apps in both Applications folders, default first, never Safari",
            HostPlatform::Macos,
            &mac,
            owned(&[
                (
                    "firefox",
                    "/Users/ada/Applications/Firefox.app/Contents/MacOS/firefox",
                    "/Users/ada/Library/Caches/oleafly-browser-sign-in",
                ),
                (
                    "chrome",
                    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                    "/Users/ada/Library/Caches/oleafly-browser-sign-in",
                ),
            ]),
        ),
        (
            "Windows reads App Paths, adds Edge's fixed path, skips a missing exe",
            HostPlatform::Windows,
            &windows,
            owned(&[
                (
                    "edge",
                    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                    r"C:\Users\ada\AppData\Local\oleafly-browser-sign-in",
                ),
                (
                    "chrome",
                    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                    r"C:\Users\ada\AppData\Local\oleafly-browser-sign-in",
                ),
                (
                    "firefox",
                    r"C:\Program Files\Mozilla Firefox\firefox.exe",
                    r"C:\Users\ada\AppData\Local\oleafly-browser-sign-in",
                ),
            ]),
        ),
        (
            "Linux finds PATH, Snap and Flatpak browsers with a profile folder each sandbox can reach",
            HostPlatform::Linux,
            &linux,
            owned(&[
                (
                    "firefox-flatpak",
                    "/var/lib/flatpak/exports/bin/org.mozilla.firefox",
                    "/home/ada/.var/app/org.mozilla.firefox/cache/oleafly-browser-sign-in",
                ),
                (
                    "chrome",
                    "/usr/bin/google-chrome",
                    "/home/ada/.cache/oleafly-browser-sign-in",
                ),
                (
                    "brave-flatpak",
                    "/home/ada/.local/share/flatpak/exports/bin/com.brave.Browser",
                    "/home/ada/.var/app/com.brave.Browser/cache/oleafly-browser-sign-in",
                ),
                (
                    "chromium-snap",
                    "/snap/bin/chromium",
                    "/home/ada/snap/chromium/common/oleafly-browser-sign-in",
                ),
                (
                    "firefox-snap",
                    "/usr/bin/firefox",
                    "/home/ada/snap/firefox/common/oleafly-browser-sign-in",
                ),
            ]),
        ),
        (
            "Linux honours the XDG folders, finds Firefox ESR and looks in /usr/bin past a short PATH",
            HostPlatform::Linux,
            &linux_custom_cache,
            owned(&[
                (
                    "firefox",
                    "/usr/bin/firefox-esr",
                    "/data/cache/oleafly-browser-sign-in",
                ),
                (
                    "edge",
                    "/usr/bin/microsoft-edge",
                    "/data/cache/oleafly-browser-sign-in",
                ),
                (
                    "chromium",
                    "/opt/bin/chromium",
                    "/data/cache/oleafly-browser-sign-in",
                ),
            ]),
        ),
        (
            "an unknown platform lists nothing",
            HostPlatform::Other,
            &linux,
            Vec::new(),
        ),
        (
            "no home folder lists nothing",
            HostPlatform::Linux,
            &empty,
            Vec::new(),
        ),
    ];
    for (name, platform, probe, expected) in cases {
        assert_eq!(listed(platform, probe), expected, "{name}");
    }
}

#[test]
fn browsers_have_stable_keys_and_readable_names() {
    let browser = |id, packaging| InstalledBrowser {
        id,
        path: PathBuf::from("/bin/browser"),
        engine: Engine::Chromium,
        packaging,
        profiles: PathBuf::from("/tmp"),
    };
    let chromium_snap = browser(BrowserId::Chromium, Packaging::Snap);
    assert_eq!(chromium_snap.key(), "chromium-snap");
    assert_eq!(chromium_snap.name(), "Chromium (Snap)");
    let edge = browser(BrowserId::Edge, Packaging::Native);
    assert_eq!(edge.key(), "edge");
    assert_eq!(edge.name(), "Microsoft Edge");
    let firefox = browser(BrowserId::Firefox, Packaging::Flatpak);
    assert_eq!(firefox.key(), "firefox-flatpak");
    assert_eq!(firefox.name(), "Firefox (Flatpak)");
}

#[test]
fn cdp_pipe_frames_split_on_nul() {
    let mut frames = cdp::Frames::default();
    assert_eq!(
        frames.push(b"{\"id\":1}\0{\"id\"").unwrap(),
        vec![b"{\"id\":1}".to_vec()]
    );
    assert_eq!(
        frames.push(b":2,\"result\":{}").unwrap(),
        Vec::<Vec<u8>>::new()
    );
    assert_eq!(
        frames.push(b"}\0\0{\"id\":3}\0").unwrap(),
        vec![
            b"{\"id\":2,\"result\":{}}".to_vec(),
            Vec::new(),
            b"{\"id\":3}".to_vec()
        ]
    );
    let mut flooded = cdp::Frames::default();
    assert!(flooded.push(&vec![b'a'; 16 * 1024 * 1024 + 1]).is_err());
}

#[test]
fn chromium_reads_pages_and_cookies_from_cdp_replies() {
    let targets = json!({ "targetInfos": [
        { "type": "page", "url": "https://www.overleaf.com/login" },
        { "type": "service_worker", "url": "https://www.overleaf.com/sw.js" },
        { "type": "page", "url": "https://accounts.google.com/signin" }
    ] });
    assert_eq!(
        cdp::page_urls(&targets),
        vec![
            "https://www.overleaf.com/login",
            "https://accounts.google.com/signin"
        ]
    );
    let cookies = cdp::cookies_from(&json!({ "cookies": [
        { "name": "overleaf_session2", "value": "s%3Aabc", "domain": ".overleaf.com", "path": "/", "secure": true },
        { "name": "SID", "value": "google", "domain": ".google.com", "path": "/", "secure": true },
        { "name": "broken" }
    ] }));
    let url = url::Url::parse("https://www.overleaf.com").unwrap();
    assert_eq!(header_for(&cookies, &url), "overleaf_session2=s%3Aabc");
}

#[test]
fn bidi_cookie_reply_to_cookie_header() {
    let reply = json!({
        "cookies": [
            { "name": "overleaf_session2", "value": { "type": "string", "value": "s%3Aabc" }, "domain": ".overleaf.com", "path": "/", "secure": true, "httpOnly": true, "sameSite": "lax", "size": 20 },
            { "name": "GCLB", "value": { "type": "string", "value": "xyz" }, "domain": "www.overleaf.com", "path": "/", "secure": false },
            { "name": "blob", "value": { "type": "base64", "value": "AAEC" }, "domain": "www.overleaf.com", "path": "/" },
            { "name": "deep", "value": { "type": "string", "value": "1" }, "domain": "www.overleaf.com", "path": "/learn" },
            { "name": "NID", "value": { "type": "string", "value": "google" }, "domain": ".google.com", "path": "/" }
        ],
        "partitionKey": {}
    });
    let cookies = bidi::cookies_from(&reply);
    let url = url::Url::parse("https://www.overleaf.com").unwrap();
    assert_eq!(
        header_for(&cookies, &url),
        "overleaf_session2=s%3Aabc; GCLB=xyz"
    );
    let plain = url::Url::parse("http://evil.example").unwrap();
    assert_eq!(header_for(&cookies, &plain), "");
    assert_eq!(
        bidi::context_urls(&json!({ "contexts": [
            { "context": "a", "url": "https://www.overleaf.com/project", "children": [] }
        ] })),
        vec!["https://www.overleaf.com/project"]
    );
}

#[test]
fn firefox_connects_only_to_a_loopback_endpoint_it_announced() {
    assert_eq!(
        bidi::announced_in("1731600000000\tWebDriver BiDi listening on ws://127.0.0.1:53111"),
        Some(("127.0.0.1".to_string(), 53111))
    );
    assert_eq!(
        bidi::announced_in("WebDriver BiDi listening on ws://localhost:9222"),
        Some(("127.0.0.1".to_string(), 9222))
    );
    assert_eq!(
        bidi::announced_in("WebDriver BiDi listening on ws://[::1]:9222"),
        Some(("::1".to_string(), 9222))
    );
    assert_eq!(
        bidi::announced_in("WebDriver BiDi listening on ws://192.168.1.4:9222"),
        None
    );
    assert_eq!(
        bidi::announced_in("WebDriver BiDi listening on wss://127.0.0.1:9222"),
        None
    );
    assert_eq!(bidi::announced_in("Read port: 9222"), None);
    assert_eq!(
        bidi::endpoint_in_server_file(r#"{"ws_host":"127.0.0.1","ws_port":51234}"#),
        Some(("127.0.0.1".to_string(), 51234))
    );
    assert_eq!(
        bidi::endpoint_in_server_file(r#"{"ws_host":"example.com","ws_port":51234}"#),
        None
    );
}

#[test]
fn launch_arguments_use_a_fresh_profile_and_no_automation_switch() {
    let profile = Path::new("/tmp/oleafly-browser-sign-in/profile-1");
    let url = "https://www.overleaf.com/login";
    for platform in [
        HostPlatform::Macos,
        HostPlatform::Windows,
        HostPlatform::Linux,
    ] {
        let chromium = cdp::chromium_args(platform, profile, url);
        assert!(chromium
            .contains(&"--user-data-dir=/tmp/oleafly-browser-sign-in/profile-1".to_string()));
        assert!(chromium.contains(&"--remote-debugging-pipe".to_string()));
        assert_eq!(chromium.last().map(String::as_str), Some(url));
        let firefox = bidi::firefox_args(platform, profile, url);
        assert!(firefox
            .windows(2)
            .any(|pair| pair == ["--profile", "/tmp/oleafly-browser-sign-in/profile-1"]));
        assert!(firefox.contains(&"--remote-debugging-port=0".to_string()));
        assert_eq!(firefox.last().map(String::as_str), Some(url));
        for argument in chromium.iter().chain(&firefox) {
            assert!(!argument.contains("automation"), "{argument}");
            assert!(!argument.contains("headless"), "{argument}");
        }
    }
}

pub(super) struct FakeDriver {
    pages: VecDeque<Result<Vec<String>, BrowserSignInError>>,
    cookies: Vec<BrowserCookie>,
    profile: PathBuf,
    seen: Arc<Mutex<Vec<String>>>,
}

impl FakeDriver {
    pub(super) fn pages(&mut self) -> Result<Vec<String>, BrowserSignInError> {
        self.seen
            .lock()
            .unwrap()
            .push(format!("pages, profile there: {}", self.profile.is_dir()));
        self.pages
            .pop_front()
            .unwrap_or(Err(BrowserSignInError::Cancelled))
    }

    pub(super) fn cookies(&self) -> Vec<BrowserCookie> {
        self.seen.lock().unwrap().push("cookies".to_string());
        self.cookies.clone()
    }

    pub(super) fn close(&mut self) {
        self.seen.lock().unwrap().push("close".to_string());
    }
}

fn cookie(name: &str, value: &str, domain: &str) -> BrowserCookie {
    BrowserCookie {
        name: name.into(),
        value: value.into(),
        domain: Some(domain.into()),
        path: Some("/".into()),
        secure: false,
    }
}

fn profile_entries(root: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(root)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

async fn fake_sign_in(
    root: &Path,
    pages: Vec<Result<Vec<String>, BrowserSignInError>>,
    timeout: Duration,
) -> (Result<String, BrowserSignInError>, Vec<String>) {
    let seen: Arc<Mutex<Vec<String>>> = Arc::default();
    let recorded = seen.clone();
    let outcome = run(
        root.to_path_buf(),
        "http://127.0.0.1:8080",
        timeout,
        |profile, login| async move {
            recorded.lock().unwrap().push(format!("open {login}"));
            Ok(Driver::Fake(FakeDriver {
                pages: pages.into(),
                cookies: vec![
                    cookie("overleaf_session2", "abc", "127.0.0.1"),
                    cookie("SID", "google", ".google.com"),
                ],
                profile,
                seen: recorded,
            }))
        },
    )
    .await;
    let seen = seen.lock().unwrap().clone();
    (outcome, seen)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn throwaway_profile_removed_after_sign_in() {
    let root = tempfile::tempdir().unwrap();
    let (outcome, seen) = fake_sign_in(
        root.path(),
        vec![
            Ok(Vec::new()),
            Ok(vec!["http://127.0.0.1:8080/login".into()]),
            Ok(vec!["http://127.0.0.1:8080/project".into()]),
        ],
        Duration::from_secs(30),
    )
    .await;
    assert_eq!(outcome, Ok("overleaf_session2=abc".to_string()));
    assert_eq!(
        seen,
        vec![
            "open http://127.0.0.1:8080/login",
            "pages, profile there: true",
            "pages, profile there: true",
            "pages, profile there: true",
            "cookies",
            "close",
        ]
    );
    assert_eq!(profile_entries(root.path()), Vec::<String>::new());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn closing_the_browser_cancels_and_still_removes_the_profile() {
    let root = tempfile::tempdir().unwrap();
    let (closed, seen) = fake_sign_in(
        root.path(),
        vec![
            Ok(vec!["http://127.0.0.1:8080/login".into()]),
            Ok(Vec::new()),
        ],
        Duration::from_secs(30),
    )
    .await;
    assert_eq!(closed, Err(BrowserSignInError::Cancelled));
    assert_eq!(seen.last().map(String::as_str), Some("close"));
    assert_eq!(profile_entries(root.path()), Vec::<String>::new());

    let (gone, _) = fake_sign_in(
        root.path(),
        vec![
            Ok(vec!["http://127.0.0.1:8080/login".into()]),
            Err(BrowserSignInError::Cancelled),
        ],
        Duration::from_secs(30),
    )
    .await;
    assert_eq!(gone, Err(BrowserSignInError::Cancelled));
    assert_eq!(profile_entries(root.path()), Vec::<String>::new());

    let waiting = (0..100)
        .map(|_| Ok(vec!["http://127.0.0.1:8080/login".to_string()]))
        .collect();
    let (late, _) = fake_sign_in(root.path(), waiting, Duration::from_millis(900)).await;
    assert_eq!(late, Err(BrowserSignInError::TimedOut));
    assert_eq!(profile_entries(root.path()), Vec::<String>::new());
}

#[test]
fn a_crashed_sign_in_profile_is_cleaned_up_next_start() {
    let root = tempfile::tempdir().unwrap();
    let crashed = root.path().join("profile-00000000000000aa");
    std::fs::create_dir_all(crashed.join("Default/Network")).unwrap();
    std::fs::write(crashed.join("Default/Network/Cookies"), b"session").unwrap();
    std::fs::write(root.path().join("profile-00000000000000aa.lock"), b"").unwrap();
    std::fs::create_dir_all(root.path().join("profile-00000000000000bb")).unwrap();
    std::fs::write(root.path().join("profile-00000000000000cc.lock"), b"").unwrap();
    std::fs::create_dir_all(root.path().join("keep-me")).unwrap();
    std::fs::create_dir_all(root.path().join("profile-not-hex")).unwrap();
    let live = Profile::create(root.path()).unwrap();
    let live_name = live
        .dir()
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();

    assert_eq!(sweep(root.path()), 2);

    assert!(live.dir().is_dir());
    assert_eq!(
        profile_entries(root.path()),
        vec![
            "keep-me".to_string(),
            live_name.clone(),
            format!("{live_name}.lock"),
            "profile-not-hex".to_string(),
        ]
    );
    assert!(live.remove());
    assert_eq!(
        profile_entries(root.path()),
        vec!["keep-me".to_string(), "profile-not-hex".to_string()]
    );
    assert_eq!(sweep(&root.path().join("missing")), 0);
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cdp_pipe_reaches_the_browser_on_fds_3_and_4() {
    use std::io::{Read as _, Write as _};
    let mut command = std::process::Command::new("/bin/sh");
    command.args(["-c", "cat <&3 >&4"]);
    let mut piped = super::process::spawn_with_pipe(command).unwrap();
    piped
        .to_browser
        .write_all(b"{\"id\":1,\"method\":\"Browser.getVersion\"}\0")
        .unwrap();
    drop(piped.to_browser);
    let mut echoed = Vec::new();
    piped.from_browser.read_to_end(&mut echoed).unwrap();
    let mut frames = cdp::Frames::default();
    assert_eq!(
        frames.push(&echoed).unwrap(),
        vec![b"{\"id\":1,\"method\":\"Browser.getVersion\"}".to_vec()]
    );
    piped.running.finish().await;
    assert!(piped.running.exited());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "opens each installed browser against a local test server"]
async fn installed_browsers_sign_in_against_a_local_server() {
    use crate::test_support::{dashboard_page, FixtureServer, Reply};
    let server =
        FixtureServer::start(Arc::new(
            |request: &crate::test_support::Request| match request.path.as_str() {
                "/login" => Reply::status(302)
                    .header("Location", "/project")
                    .header("Set-Cookie", "overleaf_session2=live-abc; Path=/; HttpOnly"),
                "/project"
                    if request
                        .headers
                        .get("cookie")
                        .is_some_and(|cookie| cookie.contains("live-abc")) =>
                {
                    Reply::ok(dashboard_page(&json!({ "totalSize": 0, "projects": [] })))
                        .header("Content-Type", "text/html")
                }
                "/project" => Reply::status(302).header("Location", "/login"),
                _ => Reply::status(404),
            },
        ))
        .await;
    let wanted = std::env::var("OLEAFLY_LIVE_BROWSERS").unwrap_or_default();
    let browsers: Vec<InstalledBrowser> = super::installed(HostPlatform::current())
        .into_iter()
        .filter(|browser| wanted.is_empty() || wanted.split(',').any(|key| key == browser.key()))
        .collect();
    assert!(!browsers.is_empty(), "no browser to try");
    for browser in browsers {
        let root = tempfile::tempdir().unwrap();
        let browser = InstalledBrowser {
            profiles: root.path().to_path_buf(),
            ..browser
        };
        let started = std::time::Instant::now();
        let header = super::sign_in(&browser, &server.base, Duration::from_secs(90)).await;
        assert_eq!(
            header,
            Ok("overleaf_session2=live-abc".to_string()),
            "{}",
            browser.key()
        );
        let http = crate::client::Http::new(&server.base, "Oleafly/test").unwrap();
        let session = crate::session::session_from_cookie(&http, header.unwrap(), "app")
            .await
            .unwrap();
        assert_eq!(
            (session.user_id.as_str(), session.email.as_str()),
            ("user-1", "ada@uni.edu")
        );
        assert_eq!(
            profile_entries(root.path()),
            Vec::<String>::new(),
            "{}",
            browser.key()
        );
        eprintln!(
            "{} signed in and closed in {:?}",
            browser.key(),
            started.elapsed()
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn a_profile_dropped_on_an_async_task_is_cleaned_up_off_that_task() {
    use std::os::unix::fs::PermissionsExt as _;
    let root = tempfile::tempdir().unwrap();
    let profile = Profile::create(root.path()).unwrap();
    let dir = profile.dir().to_path_buf();
    let stuck = dir.join("Default");
    std::fs::create_dir_all(&stuck).unwrap();
    std::fs::write(stuck.join("Cookies"), b"session").unwrap();
    std::fs::set_permissions(&stuck, std::fs::Permissions::from_mode(0o500)).unwrap();
    let started = std::time::Instant::now();
    drop(profile);
    let dropped = started.elapsed();
    std::fs::set_permissions(&stuck, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(dropped < Duration::from_millis(150), "{dropped:?}");
    let waited = std::time::Instant::now();
    while dir.exists() {
        assert!(waited.elapsed() < Duration::from_secs(10));
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
