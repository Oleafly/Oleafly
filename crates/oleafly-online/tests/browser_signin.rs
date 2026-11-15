#[path = "../examples/fake_browser.rs"]
mod fake_browser;

use std::io::{Read as _, Write as _};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use oleafly_online::browser_cookies::BrowserId;
use oleafly_online::browser_signin::{
    sign_in, sweep, BrowserSignInError, Engine, InstalledBrowser, Packaging,
};
use oleafly_online::client::Http;
use oleafly_online::session;
use oleafly_secrets::SecretStore;

const SESSION: &str = "overleaf_session2=fake-abc";
const CRASH_FLAG: &str = "--sign-in-then-crash";
const VALUE_FLAGS: [&str; 6] = [
    "--test-threads",
    "--skip",
    "--format",
    "--color",
    "--logfile",
    "-Z",
];

fn dashboard() -> String {
    let projects = r#"{"totalSize":0,"projects":[]}"#.replace('"', "&quot;");
    format!(
        "<!DOCTYPE html><html><head>\
         <meta name=\"ol-csrfToken\" content=\"csrf-123\">\
         <meta content=\"user-1\" name=\"ol-user_id\">\
         <meta name=\"ol-usersEmail\" content=\"ada@uni.edu\">\
         <meta name=\"ol-prefetchedProjectsBlob\" data-type=\"json\" content=\"{projects}\">\
         </head><body></body></html>"
    )
}

fn answer(mut stream: TcpStream) {
    let mut raw = Vec::new();
    let mut buffer = [0_u8; 2048];
    while !raw.windows(4).any(|window| window == b"\r\n\r\n") {
        match stream.read(&mut buffer) {
            Ok(0) | Err(_) => return,
            Ok(read) => raw.extend_from_slice(&buffer[..read]),
        }
    }
    let head = String::from_utf8_lossy(&raw).to_string();
    let path = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or_default()
        .to_string();
    let signed_in = head
        .lines()
        .any(|line| line.to_ascii_lowercase().starts_with("cookie:") && line.contains("fake-abc"));
    let (status, headers, body) = match path.as_str() {
        "/login" => (
            "302 Found",
            format!("Location: /project\r\nSet-Cookie: {SESSION}; Path=/; HttpOnly\r\n"),
            String::new(),
        ),
        "/project" if signed_in => (
            "200 OK",
            "Content-Type: text/html\r\n".to_string(),
            dashboard(),
        ),
        "/project" => (
            "302 Found",
            "Location: /login\r\n".to_string(),
            String::new(),
        ),
        _ => ("404 Not Found", String::new(), String::new()),
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

fn mock_service() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            std::thread::spawn(move || answer(stream));
        }
    });
    base
}

struct Fake {
    _home: tempfile::TempDir,
    browser: InstalledBrowser,
    log: PathBuf,
}

fn fake_in(dir: &Path, engine: Engine, mode: &str, profiles: &Path) -> (InstalledBrowser, PathBuf) {
    std::fs::create_dir_all(dir).unwrap();
    let path = dir.join(format!("fake-{mode}{}", std::env::consts::EXE_SUFFIX));
    std::fs::copy(std::env::current_exe().unwrap(), &path).unwrap();
    let log = path.with_extension("log");
    let browser = InstalledBrowser {
        id: if engine == Engine::Firefox {
            BrowserId::Firefox
        } else {
            BrowserId::Chrome
        },
        path,
        engine,
        packaging: Packaging::Native,
        profiles: profiles.to_path_buf(),
    };
    (browser, log)
}

impl Fake {
    fn new(engine: Engine, mode: &str, profiles: &Path) -> Fake {
        let home = tempfile::tempdir().unwrap();
        let (browser, log) = fake_in(home.path(), engine, mode, profiles);
        Fake {
            browser,
            log,
            _home: home,
        }
    }

    fn log(&self) -> String {
        std::fs::read_to_string(&self.log).unwrap_or_default()
    }

    fn wait_for(&self, needle: &str) -> bool {
        wait_for_text(&self.log, needle)
    }
}

fn wait_for_text(path: &Path, needle: &str) -> bool {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(20) {
        if std::fs::read_to_string(path)
            .unwrap_or_default()
            .contains(needle)
        {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    false
}

fn entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
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

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap()
}

fn signs_in_and_the_session_is_validated_and_saved() {
    let base = mock_service();
    let runtime = runtime();
    for engine in [Engine::Chromium, Engine::Firefox] {
        let profiles = tempfile::tempdir().unwrap();
        let fake = Fake::new(engine, "sign-in", profiles.path());
        let header = runtime
            .block_on(sign_in(&fake.browser, &base, Duration::from_secs(60)))
            .unwrap_or_else(|error| panic!("{engine:?}: {error}\n{}", fake.log()));
        assert_eq!(header, SESSION, "{engine:?}");

        let http = Http::new(&base, "Oleafly/test").unwrap();
        let signed_in = runtime
            .block_on(session::session_from_cookie(&http, header, "app"))
            .unwrap();
        assert_eq!(
            (signed_in.user_id.as_str(), signed_in.email.as_str()),
            ("user-1", "ada@uni.edu")
        );
        let data = tempfile::tempdir().unwrap();
        let store = SecretStore::at(data.path());
        session::save(&store, &base, &signed_in).unwrap();
        assert_eq!(session::load(&store, &base).unwrap(), Some(signed_in));

        assert!(fake.wait_for("closed by request"), "{}", fake.log());
        assert_eq!(entries(profiles.path()), Vec::<String>::new(), "{engine:?}");
        let launched = fake.log();
        let profile = profiles.path().join("profile-").display().to_string();
        assert!(launched.contains(&profile), "{launched}");
        assert!(launched.contains(&format!("{base}/login")), "{launched}");
        assert!(!launched.contains("automation"), "{launched}");
        let read = if engine == Engine::Chromium {
            "cdp Storage.getCookies"
        } else {
            "bidi storage.getCookies"
        };
        assert!(launched.contains(read), "{launched}");
    }
}

fn unavailable(error: &BrowserSignInError) -> bool {
    matches!(
        error,
        BrowserSignInError::Launch(_) | BrowserSignInError::Protocol(_)
    )
}

fn failing_case(base: &str, engine: Engine, mode: &str, limit: u64, expected: &str) {
    let profiles = tempfile::tempdir().unwrap();
    let fake = Fake::new(engine, mode, profiles.path());
    let error = runtime()
        .block_on(sign_in(&fake.browser, base, Duration::from_secs(limit)))
        .expect_err(mode);
    let matched = match expected {
        "cancelled" => error == BrowserSignInError::Cancelled,
        "timed out" => error == BrowserSignInError::TimedOut,
        _ => unavailable(&error),
    };
    assert!(matched, "{engine:?} {mode}: {error:?}\n{}", fake.log());
    assert_eq!(
        entries(profiles.path()),
        Vec::<String>::new(),
        "{engine:?} {mode}"
    );
}

fn failures_end_cleanly_with_the_right_error() {
    let base = mock_service();
    std::thread::scope(|scope| {
        let mut cases = Vec::new();
        for engine in [Engine::Chromium, Engine::Firefox] {
            for (mode, limit, expected) in [
                ("close", 60, "cancelled"),
                ("exit", 60, "unavailable"),
                ("drop-pipe", 60, "unavailable"),
                ("garbage", 60, "unavailable"),
                ("stall", 2, "timed out"),
            ] {
                let base = base.as_str();
                let handle = scope.spawn(move || failing_case(base, engine, mode, limit, expected));
                cases.push((format!("{engine:?} {mode}"), handle));
            }
        }
        let failed: Vec<String> = cases
            .into_iter()
            .filter_map(|(label, handle)| handle.join().err().map(|_| label))
            .collect();
        assert!(failed.is_empty(), "{failed:?}");
    });
    let profiles = tempfile::tempdir().unwrap();
    let missing = InstalledBrowser {
        id: BrowserId::Chrome,
        path: profiles.path().join("no-such-browser"),
        engine: Engine::Chromium,
        packaging: Packaging::Native,
        profiles: profiles.path().join("profiles"),
    };
    let error = runtime()
        .block_on(sign_in(&missing, &base, Duration::from_secs(10)))
        .unwrap_err();
    assert!(unavailable(&error), "{error:?}");
    assert_eq!(
        entries(&profiles.path().join("profiles")),
        Vec::<String>::new()
    );
}

fn sign_in_then_crash(root: PathBuf) {
    let base = mock_service();
    let runtime = runtime();
    let (browser, log) = fake_in(
        &root.join("fake"),
        Engine::Chromium,
        "stall",
        &root.join("profiles"),
    );
    std::fs::write(root.join("fake-log"), log.display().to_string()).unwrap();
    runtime.spawn(async move { sign_in(&browser, &base, Duration::from_secs(60)).await });
    if wait_for_text(&log, "cdp Target.getTargets") {
        std::process::abort();
    }
    std::process::exit(3);
}

fn a_crash_while_the_browser_is_open_is_cleaned_up_next_start() {
    let root = tempfile::tempdir().unwrap();
    let status = Command::new(std::env::current_exe().unwrap())
        .arg(CRASH_FLAG)
        .arg(root.path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap();
    assert_ne!(status.code(), Some(3), "the browser never started");
    assert!(!status.success());
    let profiles = root.path().join("profiles");
    assert_eq!(entries(&profiles).len(), 2, "{:?}", entries(&profiles));
    let log = PathBuf::from(std::fs::read_to_string(root.path().join("fake-log")).unwrap());
    assert!(
        wait_for_text(&log, "pipe closed"),
        "the orphaned browser kept running"
    );
    assert_eq!(sweep(&profiles), 1);
    assert_eq!(entries(&profiles), Vec::<String>::new());
}

type Case = (&'static str, fn());

const CASES: [Case; 3] = [
    (
        "browser_signin::fake_browser_signs_in_and_the_session_is_validated_and_saved",
        signs_in_and_the_session_is_validated_and_saved,
    ),
    (
        "browser_signin::fake_browser_failures_end_cleanly_with_the_right_error",
        failures_end_cleanly_with_the_right_error,
    ),
    (
        "browser_signin::a_crash_while_the_fake_browser_is_open_is_cleaned_up_next_start",
        a_crash_while_the_browser_is_open_is_cleaned_up_next_start,
    ),
];

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args
        .iter()
        .any(|arg| arg == "--remote-debugging-pipe" || arg.starts_with("--remote-debugging-port"))
    {
        fake_browser::main();
        return;
    }
    if let Some(at) = args.iter().position(|arg| arg == CRASH_FLAG) {
        sign_in_then_crash(PathBuf::from(&args[at + 1]));
        return;
    }
    if args.iter().any(|arg| arg == "--list") {
        for (name, _) in CASES {
            println!("{name}: test");
        }
        return;
    }
    let exact = args.iter().any(|arg| arg == "--exact");
    let mut filters = Vec::new();
    let mut skips = Vec::new();
    let mut words = args.iter();
    while let Some(arg) = words.next() {
        if arg == "--skip" {
            skips.extend(words.next().cloned());
        } else if VALUE_FLAGS.contains(&arg.as_str()) {
            words.next();
        } else if !arg.starts_with('-') {
            filters.push(arg.clone());
        }
    }
    let chosen = |name: &str| {
        let wanted = filters.is_empty()
            || filters.iter().any(|filter| {
                if exact {
                    name == filter
                } else {
                    name.contains(filter.as_str())
                }
            });
        wanted && !skips.iter().any(|skip| name.contains(skip.as_str()))
    };
    let selected: Vec<&Case> = CASES.iter().filter(|(name, _)| chosen(name)).collect();
    println!("\nrunning {} tests", selected.len());
    let mut failed = Vec::new();
    for &&(name, case) in &selected {
        let outcome = std::panic::catch_unwind(case);
        println!(
            "test {name} ... {}",
            if outcome.is_ok() { "ok" } else { "FAILED" }
        );
        if outcome.is_err() {
            failed.push(name);
        }
    }
    println!(
        "\ntest result: {}. {} passed; {} failed; 0 ignored; 0 measured; {} filtered out\n",
        if failed.is_empty() { "ok" } else { "FAILED" },
        selected.len() - failed.len(),
        failed.len(),
        CASES.len() - selected.len()
    );
    if !failed.is_empty() {
        std::process::exit(101);
    }
}
