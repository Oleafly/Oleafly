use std::{
    cell::Cell,
    fs,
    path::{Path, PathBuf},
};

use rusqlite::{params, Connection};
use tempfile::TempDir;
use zeroize::Zeroizing;

use super::*;

struct TestSafeStorage;

impl SafeStoragePasswordProvider for TestSafeStorage {
    fn password(&self, _browser: BrowserId) -> Result<Zeroizing<Vec<u8>>, CookieImportError> {
        Ok(Zeroizing::new(b"test-safe-storage".to_vec()))
    }
}

struct NoProvider;

impl SafeStoragePasswordProvider for NoProvider {
    fn password(&self, _browser: BrowserId) -> Result<Zeroizing<Vec<u8>>, CookieImportError> {
        Err(CookieImportError::UnsupportedPlatform)
    }
}

struct CountingSafeStorage {
    calls: Cell<usize>,
}

impl SafeStoragePasswordProvider for CountingSafeStorage {
    fn password(&self, _browser: BrowserId) -> Result<Zeroizing<Vec<u8>>, CookieImportError> {
        self.calls.set(self.calls.get() + 1);
        Ok(Zeroizing::new(b"test-safe-storage".to_vec()))
    }
}

struct MigratingSafeStorage {
    store: PathBuf,
}

impl SafeStoragePasswordProvider for MigratingSafeStorage {
    fn password(&self, _browser: BrowserId) -> Result<Zeroizing<Vec<u8>>, CookieImportError> {
        Connection::open(&self.store)
            .expect("migration fixture connection")
            .execute("UPDATE meta SET value = '25' WHERE key = 'version'", [])
            .expect("migrate fixture version");
        Ok(Zeroizing::new(b"test-safe-storage".to_vec()))
    }
}

fn create_file(path: &Path) {
    fs::create_dir_all(path.parent().expect("fixture parent")).expect("fixture directory");
    fs::File::create(path).expect("fixture file");
}

fn decode_hex(value: &str) -> Vec<u8> {
    value
        .as_bytes()
        .chunks(2)
        .map(|pair| {
            let text = std::str::from_utf8(pair).expect("hex pair");
            u8::from_str_radix(text, 16).expect("hex byte")
        })
        .collect()
}

fn create_chromium_store(path: &Path) {
    fs::create_dir_all(path.parent().expect("fixture parent")).expect("fixture directory");
    let connection = Connection::open(path).expect("chromium fixture");
    connection
        .execute_batch(
            "CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);\
             INSERT INTO meta(key, value) VALUES ('version', '24');\
             CREATE TABLE cookies(\
               creation_utc INTEGER NOT NULL DEFAULT 0,\
               host_key TEXT NOT NULL,\
               top_frame_site_key TEXT NOT NULL DEFAULT '',\
               name TEXT NOT NULL,\
               value TEXT NOT NULL,\
               encrypted_value BLOB NOT NULL,\
               path TEXT NOT NULL,\
               expires_utc INTEGER NOT NULL,\
               is_secure INTEGER NOT NULL,\
               is_httponly INTEGER NOT NULL,\
               last_access_utc INTEGER NOT NULL DEFAULT 0,\
               has_expires INTEGER NOT NULL DEFAULT 0,\
               is_persistent INTEGER NOT NULL DEFAULT 0,\
               priority INTEGER NOT NULL DEFAULT 1,\
               samesite INTEGER NOT NULL,\
               source_scheme INTEGER NOT NULL DEFAULT 0,\
               source_port INTEGER NOT NULL DEFAULT -1,\
               last_update_utc INTEGER NOT NULL DEFAULT 0,\
               source_type INTEGER NOT NULL DEFAULT 0,\
               has_cross_site_ancestor INTEGER NOT NULL DEFAULT 1\
             );\
             CREATE UNIQUE INDEX cookies_unique_index ON cookies(\
               host_key, top_frame_site_key, has_cross_site_ancestor, name, path, source_scheme, source_port\
             );",
        )
        .expect("chromium schema");
    let encrypted = decode_hex(
        "763130df4793e60a52efcfa849970ae2dc1ee4fc4b644d44af13b5149293b13012784a5cf5299258178d8597c0042b2d90c583",
    );
    connection
        .execute(
            "INSERT INTO cookies(host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite, last_update_utc)\
             VALUES (?1, ?2, '', ?3, '/', 0, 1, 1, 2, 200)",
            params![".example.com", "session", encrypted],
        )
        .expect("chromium cookie");
    connection
        .execute(
            "INSERT INTO cookies(host_key, top_frame_site_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite)\
             VALUES (?1, ?2, ?3, ?4, X'', '/', 0, 1, 0, 0)",
            params![".example.com", "https://partition.example", "partitioned", "do-not-import"],
        )
        .expect("partitioned cookie");
    connection
        .execute(
            "INSERT INTO cookies(host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite, last_update_utc)\
             VALUES (?1, ?2, ?3, X'', '/', 0, 0, 0, 1, 100)",
            params!["docs.example.com", "plain", "plain-value"],
        )
        .expect("plain cookie");
    connection
        .execute(
            "INSERT INTO cookies(host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite, last_update_utc)\
             VALUES (?1, ?2, ?3, X'', '/', 0, 0, 0, 1, 50)",
            params!["example.com", "host-only-parent", "do-not-import"],
        )
        .expect("host-only parent cookie");
    connection
        .execute(
            "INSERT INTO cookies(host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite)\
             VALUES (?1, ?2, ?3, X'', '/', 0, 0, 0, 1)",
            params!["unrelated.test", "other", "not-selected"],
        )
        .expect("unrelated cookie");
    connection
        .execute(
            "INSERT INTO cookies(host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite)\
             VALUES (?1, ?2, ?3, X'', '/', ?4, 0, 0, 1)",
            params![".example.com", "invalid-expiry", "do-not-import", i64::MAX],
        )
        .expect("invalid expiry cookie");
}

use crate::test_support::FIREFOX_COOKIE_SCHEMA as FIREFOX_SCHEMA;

fn create_firefox_store(path: &Path) {
    fs::create_dir_all(path.parent().expect("fixture parent")).expect("fixture directory");
    let connection = Connection::open(path).expect("firefox fixture");
    connection
        .execute_batch(&format!(
            "{FIREFOX_SCHEMA}\
             INSERT INTO moz_cookies(originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly, sameSite)\
             VALUES ('', 'firefox-session', 'firefox-secret', '.example.org', '/', 4102444800000, 0, 0, 1, 1, 2);\
             INSERT INTO moz_cookies(originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly, sameSite)\
             VALUES ('^userContextId=2', 'container', 'do-not-import', '.example.org', '/', 4102444800000, 0, 0, 1, 1, 2);\
             INSERT INTO moz_cookies(originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly, sameSite, isPartitionedAttributeSet)\
             VALUES ('', 'partitioned', 'do-not-import', '.example.org', '/', 4102444800000, 0, 0, 1, 1, 2, 1);\
             INSERT INTO moz_cookies(originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly, sameSite)\
             VALUES ('', 'expired', 'do-not-import', '.example.org', '/', 946684800000, 0, 0, 1, 1, 2);\
             INSERT INTO moz_cookies(originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly, sameSite)\
             VALUES ('', 'invalid-expiry', 'do-not-import', '.example.org', '/', 9223372036854775807, 0, 0, 1, 1, 2);"
        ))
        .expect("firefox schema");
    connection
        .execute(
            "INSERT INTO moz_cookies(originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly, sameSite)\
             VALUES ('', 'host-only-parent', 'do-not-import', 'example.org', '/', 4102444800000, 0, 0, 1, 1, 2)",
            [],
        )
        .expect("Firefox host-only parent cookie");
}

/// A Firefox store holding `(name, value, host)` rows that expire in 2100,
/// or at `expiry_ms` when given.
fn write_firefox_store(path: &Path, rows: &[(&str, &str, &str, Option<i64>)]) {
    fs::create_dir_all(path.parent().expect("fixture parent")).expect("fixture directory");
    let connection = Connection::open(path).expect("firefox fixture");
    connection
        .execute_batch(FIREFOX_SCHEMA)
        .expect("firefox schema");
    for (index, (name, value, host, expiry)) in rows.iter().enumerate() {
        connection
            .execute(
                "INSERT INTO moz_cookies(originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly, sameSite)\
                 VALUES ('', ?1, ?2, ?3, '/', ?4, 0, ?5, 1, 1, 1)",
                params![name, value, host, expiry.unwrap_or(4_102_444_800_000), index as i64],
            )
            .expect("firefox row");
    }
}

fn cookie(name: &str, value: &str, domain: &str, path: &str, secure: bool) -> ImportedCookie {
    ImportedCookie {
        name: name.to_string(),
        value: value.to_string(),
        domain: domain.to_string(),
        path: path.to_string(),
        expires_unix: None,
        secure,
        http_only: true,
        same_site: Some(ImportedSameSite::Lax),
    }
}

#[test]
fn detects_only_profiles_with_cookie_stores_and_marks_safari_coming_soon() {
    let fixture = TempDir::new().expect("home fixture");
    let home = fixture.path();
    create_file(&home.join("Library/Application Support/Google/Chrome/Default/Network/Cookies"));
    create_file(
        &home.join(
            "Library/Application Support/BraveSoftware/Brave-Browser/Profile 2/Network/Cookies",
        ),
    );
    create_file(
        &home.join("Library/Application Support/Firefox/Profiles/abc.default/cookies.sqlite"),
    );
    fs::create_dir_all(home.join("Library/Application Support/Google/Chrome/Profile 3"))
        .expect("empty Chromium profile");
    fs::create_dir_all(home.join("Library/Application Support/Firefox/Profiles/empty.default"))
        .expect("empty Firefox profile");
    create_file(&home.join("Library/Cookies/Cookies.binarycookies"));

    let detected = detect_sources_at(home, HostPlatform::Macos, ImportPolicy::App);

    assert!(detected.iter().any(|source| {
        source.browser == BrowserId::Chrome
            && source.profile.as_deref() == Some("Default")
            && source.status == CookieSourceStatus::Available
    }));
    for (browser, profile) in [
        (BrowserId::Chrome, "Profile 3"),
        (BrowserId::Firefox, "empty.default"),
    ] {
        let source = detected
            .iter()
            .find(|source| source.browser == browser && source.profile.as_deref() == Some(profile))
            .expect("profile without a cookie store");
        assert_eq!(
            serde_json::to_value(source).expect("detected source JSON")["status"],
            "no_cookie_store"
        );
    }
    assert!(detected.iter().any(|source| {
        source.browser == BrowserId::Brave
            && source.profile.as_deref() == Some("Profile 2")
            && source.status == CookieSourceStatus::Available
    }));
    assert!(detected.iter().any(|source| {
        source.browser == BrowserId::Firefox
            && source.profile.as_deref() == Some("abc.default")
            && source.status == CookieSourceStatus::Available
    }));
    assert!(detected.iter().any(|source| {
        source.browser == BrowserId::Safari && source.status == CookieSourceStatus::ComingSoon
    }));
    assert!(detected.iter().any(|source| {
        source.browser == BrowserId::Edge && source.status == CookieSourceStatus::NotInstalled
    }));
}

#[test]
fn detects_non_macos_profiles_as_coming_soon() {
    let fixture = TempDir::new().expect("home fixture");
    create_file(
        &fixture
            .path()
            .join("AppData/Local/Google/Chrome/User Data/Default/Network/Cookies"),
    );
    fs::create_dir_all(
        fixture
            .path()
            .join("AppData/Local/Google/Chrome/User Data/Profile 2"),
    )
    .expect("empty Windows profile");
    fs::create_dir_all(fixture.path().join(".mozilla/firefox/empty.default"))
        .expect("empty Linux profile");
    create_file(
        &fixture
            .path()
            .join(".mozilla/firefox/abc.default/cookies.sqlite"),
    );

    let windows = detect_sources_at(fixture.path(), HostPlatform::Windows, ImportPolicy::App);
    let linux = detect_sources_at(fixture.path(), HostPlatform::Linux, ImportPolicy::App);

    assert!(windows.iter().any(|source| {
        source.browser == BrowserId::Chrome
            && source.status == CookieSourceStatus::ComingSoon
            && source.detail.contains("Windows")
    }));
    assert!(windows.iter().any(|source| {
        source.browser == BrowserId::Chrome
            && source.profile.as_deref() == Some("Profile 2")
            && source.status == CookieSourceStatus::ComingSoon
    }));
    assert!(linux.iter().any(|source| {
        source.browser == BrowserId::Firefox
            && source.status == CookieSourceStatus::ComingSoon
            && source.detail.contains("Linux")
    }));
    assert!(linux.iter().any(|source| {
        source.browser == BrowserId::Firefox
            && source.profile.as_deref() == Some("empty.default")
            && source.status == CookieSourceStatus::ComingSoon
    }));
}

#[test]
fn decrypts_current_chromium_cookie_values_and_verifies_the_host_binding() {
    let encrypted = decode_hex(
        "763130df4793e60a52efcfa849970ae2dc1ee4fc4b644d44af13b5149293b13012784a5cf5299258178d8597c0042b2d90c583",
    );

    let value = decrypt_chromium_cookie_value(&encrypted, b"test-safe-storage", ".example.com", 24)
        .expect("decrypted cookie");

    assert_eq!(value, "session-secret");
    assert!(
        decrypt_chromium_cookie_value(&encrypted, b"test-safe-storage", ".wrong.example", 24)
            .is_err()
    );
}

#[test]
fn parses_unpartitioned_chromium_cookies_for_the_selected_domain() {
    let fixture = TempDir::new().expect("fixture");
    let store = fixture.path().join("Cookies");
    create_chromium_store(&store);

    let cookies = read_chromium_cookie_store(
        &store,
        BrowserId::Chrome,
        Some("docs.example.com"),
        &TestSafeStorage,
    )
    .expect("chromium cookies");

    assert_eq!(cookies.len(), 2);
    assert_eq!(cookies[0].name, "session");
    assert_eq!(cookies[0].value, "session-secret");
    assert_eq!(cookies[0].domain, ".example.com");
    assert!(cookies[0].secure);
    assert!(cookies[0].http_only);
    assert_eq!(cookies[0].same_site, Some(ImportedSameSite::Strict));
    assert_eq!(cookies[1].name, "plain");
    assert_eq!(cookies[1].value, "plain-value");
}

#[test]
fn parses_the_minimum_supported_chromium_cookie_store() {
    let fixture = TempDir::new().expect("fixture");
    let store = fixture.path().join("Cookies");
    create_chromium_store(&store);
    let encrypted =
        decode_hex("76313066132815f9734b7042008c9e4d13fdcd34a2e3c3866adc64a960056fd02b2e52");
    let connection = Connection::open(&store).expect("fixture connection");
    connection
        .execute("UPDATE meta SET value = '23' WHERE key = 'version'", [])
        .expect("minimum Chromium version");
    connection
        .execute(
            "UPDATE cookies SET encrypted_value = ?1 WHERE name = 'session'",
            params![encrypted],
        )
        .expect("v23 encrypted cookie");
    drop(connection);

    let cookies = read_chromium_cookie_store(
        &store,
        BrowserId::Chrome,
        Some("example.com"),
        &TestSafeStorage,
    )
    .expect("minimum supported Chromium cookies");

    let session = cookies
        .iter()
        .find(|cookie| cookie.name == "session")
        .expect("v23 session cookie");
    assert_eq!(session.value, "session-v23-secret");
}

#[test]
fn reads_safe_storage_once_and_rejects_unknown_chromium_versions() {
    let fixture = TempDir::new().expect("fixture");
    let store = fixture.path().join("Cookies");
    create_chromium_store(&store);
    let safe_storage = CountingSafeStorage {
        calls: Cell::new(0),
    };

    read_chromium_cookie_store(
        &store,
        BrowserId::Chrome,
        Some("example.com"),
        &safe_storage,
    )
    .expect("chromium cookies");

    assert_eq!(safe_storage.calls.get(), 1);
    Connection::open(&store)
        .expect("fixture connection")
        .execute("UPDATE meta SET value = '25' WHERE key = 'version'", [])
        .expect("future version");
    assert_eq!(
        read_chromium_cookie_store(&store, BrowserId::Chrome, None, &safe_storage),
        Err(CookieImportError::UnsupportedStoreVersion {
            browser: BrowserId::Chrome,
        })
    );
    assert_eq!(safe_storage.calls.get(), 1);
}

#[test]
fn rejects_chromium_versions_below_the_supported_range() {
    let fixture = TempDir::new().expect("fixture");
    let store = fixture.path().join("Cookies");
    create_chromium_store(&store);
    Connection::open(&store)
        .expect("fixture connection")
        .execute("UPDATE meta SET value = '22' WHERE key = 'version'", [])
        .expect("old version");

    assert_eq!(
        read_chromium_cookie_store(&store, BrowserId::Chrome, None, &TestSafeStorage),
        Err(CookieImportError::UnsupportedStoreVersion {
            browser: BrowserId::Chrome,
        })
    );
}

#[test]
fn revalidates_chromium_version_after_the_safe_storage_boundary() {
    let fixture = TempDir::new().expect("fixture");
    let store = fixture.path().join("Cookies");
    create_chromium_store(&store);
    let safe_storage = MigratingSafeStorage {
        store: store.clone(),
    };

    assert_eq!(
        read_chromium_cookie_store(&store, BrowserId::Chrome, None, &safe_storage),
        Err(CookieImportError::UnsupportedStoreVersion {
            browser: BrowserId::Chrome,
        })
    );
}

#[test]
fn orders_newest_chromium_duplicate_first() {
    let fixture = TempDir::new().expect("fixture");
    let store = fixture.path().join("Cookies");
    create_chromium_store(&store);
    Connection::open(&store)
        .expect("fixture connection")
        .execute(
            "INSERT INTO cookies(host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite, source_scheme, source_port, last_update_utc)\
             VALUES ('docs.example.com', 'plain', 'newest-value', X'', '/', 0, 0, 0, 1, 2, 443, 300)",
            [],
        )
        .expect("newest duplicate");

    let cookies = read_chromium_cookie_store(
        &store,
        BrowserId::Chrome,
        Some("docs.example.com"),
        &TestSafeStorage,
    )
    .expect("chromium cookies");
    let first_plain = cookies
        .iter()
        .find(|cookie| cookie.name == "plain")
        .expect("plain cookie");

    assert_eq!(first_plain.value, "newest-value");
    let unique = unique_cookies(cookies);
    assert_eq!(
        unique
            .iter()
            .filter(|cookie| cookie.name == "plain")
            .count(),
        1
    );
}

#[test]
fn parses_current_firefox_cookies_without_containers_or_expired_rows() {
    let fixture = TempDir::new().expect("fixture");
    let store = fixture.path().join("cookies.sqlite");
    create_firefox_store(&store);

    let cookies =
        read_firefox_cookie_store(&store, Some("login.example.org")).expect("firefox cookies");

    assert_eq!(cookies.len(), 1);
    assert_eq!(cookies[0].name, "firefox-session");
    assert_eq!(cookies[0].value, "firefox-secret");
    assert_eq!(cookies[0].domain, ".example.org");
    assert_eq!(cookies[0].expires_unix, Some(4_102_444_800));
    assert!(cookies[0].secure);
    assert!(cookies[0].http_only);
    assert_eq!(cookies[0].same_site, Some(ImportedSameSite::Strict));
}

#[test]
fn parses_the_minimum_supported_firefox_cookie_store() {
    let fixture = TempDir::new().expect("fixture");
    let store = fixture.path().join("cookies.sqlite");
    create_firefox_store(&store);
    Connection::open(&store)
        .expect("fixture connection")
        .execute_batch("PRAGMA user_version = 16;")
        .expect("minimum Firefox version");

    let cookies =
        read_firefox_cookie_store(&store, Some("login.example.org")).expect("Firefox v16 cookies");

    assert_eq!(cookies.len(), 1);
    assert_eq!(cookies[0].name, "firefox-session");
    assert_eq!(cookies[0].expires_unix, Some(4_102_444_800));
}

#[test]
fn rejects_unknown_firefox_store_versions() {
    let fixture = TempDir::new().expect("fixture");
    let store = fixture.path().join("cookies.sqlite");
    create_firefox_store(&store);
    Connection::open(&store)
        .expect("fixture connection")
        .execute_batch("PRAGMA user_version = 18;")
        .expect("future version");

    assert_eq!(
        read_firefox_cookie_store(&store, None),
        Err(CookieImportError::UnsupportedStoreVersion {
            browser: BrowserId::Firefox,
        })
    );
}

#[test]
fn rejects_firefox_versions_below_the_supported_range() {
    let fixture = TempDir::new().expect("fixture");
    let store = fixture.path().join("cookies.sqlite");
    create_firefox_store(&store);
    Connection::open(&store)
        .expect("fixture connection")
        .execute_batch("PRAGMA user_version = 15;")
        .expect("old version");

    assert_eq!(
        read_firefox_cookie_store(&store, None),
        Err(CookieImportError::UnsupportedStoreVersion {
            browser: BrowserId::Firefox,
        })
    );
}

#[test]
fn caps_selected_cookie_rows_at_ten_thousand() {
    let connection = Connection::open_in_memory().expect("limit fixture");

    assert_eq!(
        ensure_cookie_limits(
            &connection,
            BrowserId::Firefox,
            "SELECT 10001 WHERE :domain IS NULL",
            "SELECT 0 WHERE :domain IS NULL",
            None,
        ),
        Err(CookieImportError::StoreTooLarge {
            browser: BrowserId::Firefox,
        })
    );
}

#[test]
fn reports_missing_and_locked_cookie_stores_without_paths_or_secrets() {
    let fixture = TempDir::new().expect("fixture");
    let missing = fixture.path().join("missing.sqlite");

    let missing_error = read_firefox_cookie_store(&missing, None).expect_err("missing store error");
    assert_eq!(
        missing_error,
        CookieImportError::MissingStore {
            browser: BrowserId::Firefox,
        }
    );
    assert_eq!(
        missing_error.to_string(),
        "Firefox's cookie store could not be found. Refresh the browser list and try again."
    );
    assert!(!missing_error.to_string().contains("missing.sqlite"));

    let locked = fixture.path().join("locked.sqlite");
    create_firefox_store(&locked);
    let lock = Connection::open(&locked).expect("lock connection");
    lock.execute_batch("PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE;")
        .expect("exclusive lock");

    let locked_error = read_firefox_cookie_store(&locked, None).expect_err("locked store error");
    assert_eq!(
        locked_error,
        CookieImportError::LockedStore {
            browser: BrowserId::Firefox,
        }
    );
    assert_eq!(
        locked_error.to_string(),
        "Firefox's cookie store is locked. Close Firefox completely, then try again."
    );
    assert!(!locked_error.to_string().contains("firefox-secret"));
}

#[test]
fn accepts_only_single_profile_components_and_hostname_domain_filters() {
    assert_eq!(
        validate_profile("../Default"),
        Err(CookieImportError::InvalidProfile)
    );
    assert!(validate_profile("Profile 2").is_ok());
    assert_eq!(
        normalize_import_domain(Some(" Example.COM ")),
        Ok(Some("example.com".to_string()))
    );
    for invalid in [
        "https://example.com",
        "example.com/path",
        "*.example.com",
        ".example.com",
        "..example.com",
        "example.com:443",
        "example..com",
        "münchen.example",
    ] {
        assert_eq!(
            normalize_import_domain(Some(invalid)),
            Err(CookieImportError::InvalidDomain)
        );
    }
    assert_eq!(
        normalize_import_domain(Some(&format!("{}.com", "a".repeat(252)))),
        Err(CookieImportError::InvalidDomain)
    );
}

#[test]
fn hostname_scope_selects_exact_and_parent_cookie_domains_only() {
    assert!(domain_matches(
        "login.example.com",
        Some("login.example.com")
    ));
    assert!(domain_matches(".example.com", Some("login.example.com")));
    assert!(!domain_matches("example.com", Some("login.example.com")));
    assert!(!domain_matches(
        "accounts.login.example.com",
        Some("login.example.com")
    ));
    assert!(!domain_matches(".example.com", Some("com")));
}

#[test]
fn resolves_selected_profiles_only_beneath_known_browser_roots() {
    let fixture = TempDir::new().expect("home fixture");
    let store = fixture
        .path()
        .join("Library/Application Support/Firefox/Profiles/abc.default/cookies.sqlite");
    create_firefox_store(&store);

    let resolved = resolve_cookie_store_at(
        fixture.path(),
        HostPlatform::Macos,
        BrowserId::Firefox,
        "abc.default",
        ImportPolicy::App,
    )
    .expect("resolved store");

    assert_eq!(resolved, store.canonicalize().expect("canonical store"));
    assert_eq!(
        resolve_cookie_store_at(
            fixture.path(),
            HostPlatform::Macos,
            BrowserId::Firefox,
            "../abc.default",
            ImportPolicy::App,
        ),
        Err(CookieImportError::InvalidProfile)
    );
    assert_eq!(
        resolve_cookie_store_at(
            fixture.path(),
            HostPlatform::Windows,
            BrowserId::Firefox,
            "abc.default",
            ImportPolicy::App,
        ),
        Err(CookieImportError::UnsupportedPlatform)
    );
    assert_eq!(
        resolve_cookie_store_at(
            fixture.path(),
            HostPlatform::Macos,
            BrowserId::Safari,
            "Default",
            ImportPolicy::App,
        ),
        Err(CookieImportError::UnsupportedBrowser {
            browser: BrowserId::Safari,
        })
    );
}

#[cfg(unix)]
#[test]
fn rejects_symlinked_cookie_stores() {
    use std::os::unix::fs::symlink;

    let fixture = TempDir::new().expect("home fixture");
    let profile = fixture
        .path()
        .join("Library/Application Support/Firefox/Profiles/abc.default");
    fs::create_dir_all(&profile).expect("profile directory");
    let outside = fixture.path().join("outside.sqlite");
    create_firefox_store(&outside);
    symlink(&outside, profile.join("cookies.sqlite")).expect("store symlink");

    assert_eq!(
        resolve_cookie_store_at(
            fixture.path(),
            HostPlatform::Macos,
            BrowserId::Firefox,
            "abc.default",
            ImportPolicy::App,
        ),
        Err(CookieImportError::UnsafeStore)
    );
}

#[cfg(unix)]
#[test]
fn rejects_symlinked_browser_root_components() {
    use std::os::unix::fs::symlink;

    let fixture = TempDir::new().expect("home fixture");
    let redirected_root = fixture.path().join("redirected-chrome");
    create_file(&redirected_root.join("Default/Network/Cookies"));
    let expected_parent = fixture.path().join("Library/Application Support/Google");
    fs::create_dir_all(&expected_parent).expect("browser root parent");
    symlink(&redirected_root, expected_parent.join("Chrome")).expect("browser root symlink");

    assert_eq!(
        resolve_cookie_store_at(
            fixture.path(),
            HostPlatform::Macos,
            BrowserId::Chrome,
            "Default",
            ImportPolicy::App,
        ),
        Err(CookieImportError::UnsafeStore)
    );
}

#[cfg(unix)]
#[test]
fn detection_does_not_follow_symlinked_browser_roots() {
    use std::os::unix::fs::symlink;

    let fixture = TempDir::new().expect("home fixture");
    let redirected_root = fixture.path().join("redirected-chrome");
    create_file(&redirected_root.join("Default/Network/Cookies"));
    let expected_parent = fixture.path().join("Library/Application Support/Google");
    fs::create_dir_all(&expected_parent).expect("browser root parent");
    symlink(&redirected_root, expected_parent.join("Chrome")).expect("browser root symlink");

    let detected = detect_sources_at(fixture.path(), HostPlatform::Macos, ImportPolicy::App);

    assert!(detected.iter().any(|source| {
        source.browser == BrowserId::Chrome
            && source.profile.is_none()
            && source.status == CookieSourceStatus::NotInstalled
    }));
    assert!(!detected.iter().any(|source| {
        source.browser == BrowserId::Chrome && source.profile.as_deref() == Some("Default")
    }));
}

#[cfg(unix)]
#[test]
fn detection_does_not_surface_symlinked_profiles() {
    use std::os::unix::fs::symlink;

    let fixture = TempDir::new().expect("home fixture");
    let root = fixture
        .path()
        .join("Library/Application Support/Google/Chrome");
    let redirected_profile = fixture.path().join("redirected-profile");
    create_file(&redirected_profile.join("Network/Cookies"));
    fs::create_dir_all(&root).expect("browser root");
    symlink(&redirected_profile, root.join("Default")).expect("profile symlink");

    let detected = detect_sources_at(fixture.path(), HostPlatform::Macos, ImportPolicy::App);

    assert!(!detected.iter().any(|source| {
        source.browser == BrowserId::Chrome && source.profile.as_deref() == Some("Default")
    }));
}

#[cfg(unix)]
#[test]
fn rejects_symlinked_network_cookie_store_components() {
    use std::os::unix::fs::symlink;

    let fixture = TempDir::new().expect("home fixture");
    let profile = fixture
        .path()
        .join("Library/Application Support/Google/Chrome/Default");
    let redirected_network = profile.join("redirected-network");
    create_file(&redirected_network.join("Cookies"));
    symlink(&redirected_network, profile.join("Network")).expect("network symlink");

    assert_eq!(
        resolve_cookie_store_at(
            fixture.path(),
            HostPlatform::Macos,
            BrowserId::Chrome,
            "Default",
            ImportPolicy::App,
        ),
        Err(CookieImportError::UnsafeStore)
    );
}

#[test]
fn the_cli_reads_firefox_on_windows_and_linux_layouts() {
    for (platform, root) in [
        (
            HostPlatform::Windows,
            "AppData/Roaming/Mozilla/Firefox/Profiles",
        ),
        (HostPlatform::Linux, ".mozilla/firefox"),
    ] {
        let home = TempDir::new().unwrap();
        write_firefox_store(
            &home
                .path()
                .join(root)
                .join("ab12cd.default-release/cookies.sqlite"),
            &[("site_session", "v", "latex.example.edu", None)],
        );
        let found = detect_sources_at(home.path(), platform, ImportPolicy::Cli);
        assert!(found.iter().any(|source| {
            source.browser == BrowserId::Firefox && source.status == CookieSourceStatus::Available
        }));
        let cookies = read_cookies(
            home.path(),
            platform,
            BrowserId::Firefox,
            "ab12cd.default-release",
            Some("latex.example.edu"),
            ImportPolicy::Cli,
            &NoProvider,
        )
        .unwrap();
        assert_eq!(cookies.len(), 1);
        assert_eq!(cookies[0].name, "site_session");
    }
}

#[test]
fn the_app_policy_keeps_firefox_coming_soon_off_macos() {
    let home = TempDir::new().unwrap();
    write_firefox_store(
        &home
            .path()
            .join("AppData/Roaming/Mozilla/Firefox/Profiles/ab12cd.default-release/cookies.sqlite"),
        &[("site_session", "v", "latex.example.edu", None)],
    );
    let found = detect_sources_at(home.path(), HostPlatform::Windows, ImportPolicy::App);
    assert!(found.iter().any(|source| {
        source.browser == BrowserId::Firefox && source.status == CookieSourceStatus::ComingSoon
    }));
    assert_eq!(
        resolve_cookie_store_at(
            home.path(),
            HostPlatform::Windows,
            BrowserId::Firefox,
            "ab12cd.default-release",
            ImportPolicy::App,
        ),
        Err(CookieImportError::UnsupportedPlatform)
    );
}

#[test]
fn chromium_off_macos_is_unsupported_for_both_policies() {
    let home = TempDir::new().unwrap();
    create_file(
        &home
            .path()
            .join("AppData/Local/Google/Chrome/User Data/Default/Network/Cookies"),
    );
    for policy in [ImportPolicy::App, ImportPolicy::Cli] {
        assert_eq!(
            resolve_cookie_store_at(
                home.path(),
                HostPlatform::Windows,
                BrowserId::Chrome,
                "Default",
                policy,
            )
            .unwrap_err(),
            CookieImportError::UnsupportedPlatform
        );
    }
    assert!(ImportPolicy::Cli.supports(HostPlatform::Macos, BrowserId::Edge));
    assert!(!ImportPolicy::Cli.supports(HostPlatform::Linux, BrowserId::Brave));
    assert!(!ImportPolicy::Cli.supports(HostPlatform::Macos, BrowserId::Safari));
    assert_eq!(
        ImportPolicy::Cli.check(HostPlatform::Macos, BrowserId::Safari),
        Err(CookieImportError::UnsupportedBrowser {
            browser: BrowserId::Safari
        })
    );
}

#[test]
fn cookie_header_keeps_only_cookies_for_the_server() {
    let cookies = vec![
        cookie("a", "1", "latex.example.edu", "/", true),
        cookie("b", "2", ".example.edu", "/", true),
        cookie("c", "3", "other.org", "/", false),
        cookie("d", "4", "latex.example.edu", "/admin", true),
        cookie("e", "5", "example.edu", "/", true),
        cookie("f", "6", "127.0.0.1", "/", true),
    ];
    assert_eq!(
        cookie_header_for(
            &cookies,
            &url::Url::parse("https://latex.example.edu/").unwrap()
        ),
        "a=1; b=2"
    );
    assert_eq!(
        cookie_header_for(
            &cookies,
            &url::Url::parse("http://127.0.0.1:8080/").unwrap()
        ),
        "f=6"
    );
    assert_eq!(
        cookie_header_for(
            &cookies,
            &url::Url::parse("http://latex.example.edu/").unwrap()
        ),
        ""
    );
}

#[test]
fn an_expiry_past_year_9999_is_skipped() {
    let fixture = TempDir::new().unwrap();
    let store = fixture.path().join("cookies.sqlite");
    write_firefox_store(
        &store,
        &[
            (
                "kept",
                "v",
                "latex.example.edu",
                Some(MAX_COOKIE_EXPIRY_UNIX * 1_000),
            ),
            (
                "dropped",
                "v",
                "latex.example.edu",
                Some((MAX_COOKIE_EXPIRY_UNIX + 1) * 1_000),
            ),
        ],
    );
    let cookies = read_firefox_cookie_store(&store, Some("latex.example.edu")).unwrap();
    let names: Vec<_> = cookies.iter().map(|cookie| cookie.name.as_str()).collect();
    assert_eq!(names, vec!["kept"]);
}

#[test]
fn imported_cookie_debug_hides_values() {
    let cookie = cookie("site_session", "SECRETVALUE", ".example.edu", "/", true);
    let printed = format!("{cookie:?}");
    assert!(!printed.contains("SECRETVALUE"));
    assert!(printed.contains("site_session"));
}

/// The first Firefox profile `detect_sources_at` lists for the CLI.
fn first_firefox_profile(home: &Path, platform: HostPlatform) -> Option<String> {
    detect_sources_at(home, platform, ImportPolicy::Cli)
        .into_iter()
        .find(|source| {
            source.browser == BrowserId::Firefox && source.status == CookieSourceStatus::Available
        })
        .and_then(|source| source.profile)
}

#[test]
fn the_firefox_profile_the_browser_opens_is_listed_first() {
    // Profile folders start with random letters, so by name an old profile
    // can come before the one in use.
    let linux = TempDir::new().unwrap();
    let root = linux.path().join(".mozilla/firefox");
    for name in ["a1.default", "z9.default-release", "m5.dev-edition-default"] {
        create_file(&root.join(name).join("cookies.sqlite"));
    }
    assert_eq!(
        first_firefox_profile(linux.path(), HostPlatform::Linux).as_deref(),
        Some("a1.default")
    );
    fs::write(
        root.join("profiles.ini"),
        "[Profile1]\nName=default\nIsRelative=1\nPath=a1.default\nDefault=1\n\n[Profile0]\nName=default-release\nIsRelative=1\nPath=z9.default-release\n\n[Install4F96D1932A9F858E]\nDefault=z9.default-release\nLocked=1\n",
    )
    .unwrap();
    assert_eq!(
        first_firefox_profile(linux.path(), HostPlatform::Linux).as_deref(),
        Some("z9.default-release")
    );
    // Without an install section, the profile marked as the default.
    fs::write(
        root.join("profiles.ini"),
        "[Profile0]\nName=x\nIsRelative=1\nPath=m5.dev-edition-default\nDefault=1\n",
    )
    .unwrap();
    assert_eq!(
        first_firefox_profile(linux.path(), HostPlatform::Linux).as_deref(),
        Some("m5.dev-edition-default")
    );

    // macOS keeps the settings beside the `Profiles` folder, and
    // `installs.ini` names the install's profile with a path.
    let mac = TempDir::new().unwrap();
    let firefox = mac.path().join("Library/Application Support/Firefox");
    for name in ["a1.default", "z9.default-release"] {
        create_file(&firefox.join("Profiles").join(name).join("cookies.sqlite"));
    }
    fs::write(
        firefox.join("installs.ini"),
        "[2656FF1E876E9973]\nDefault=Profiles/z9.default-release\nLocked=1\n",
    )
    .unwrap();
    assert_eq!(
        first_firefox_profile(mac.path(), HostPlatform::Macos).as_deref(),
        Some("z9.default-release")
    );
    // A name that matches no profile changes nothing.
    fs::write(firefox.join("installs.ini"), "[X]\nDefault=Profiles/gone\n").unwrap();
    assert_eq!(
        first_firefox_profile(mac.path(), HostPlatform::Macos).as_deref(),
        Some("a1.default")
    );
}

#[test]
fn a_cookie_name_two_cookies_share_is_sent_once_with_the_newest_value() {
    let url = url::Url::parse("https://latex.example.edu/").unwrap();
    // A Chromium store is read newest first.
    let newest_first = vec![
        cookie("session", "new", "latex.example.edu", "/", true),
        cookie("session", "stale", ".example.edu", "/", true),
        cookie("other", "x", ".example.edu", "/", true),
    ];
    assert_eq!(
        cookie_header_for(&unique_cookies(newest_first), &url),
        "session=new; other=x"
    );
}
