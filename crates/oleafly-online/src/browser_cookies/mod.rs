use std::{
    collections::HashSet,
    fmt,
    num::NonZeroU32,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use aes::Aes128;
use cbc::cipher::{block_padding::Pkcs7, BlockModeDecrypt, KeyIvInit};
use ring::{digest, pbkdf2};
use rusqlite::{named_params, Connection, ErrorCode, OpenFlags, TransactionBehavior};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

use crate::session::{cookie_applies, cookie_header};

const CHROMIUM_EPOCH_OFFSET_SECONDS: i64 = 11_644_473_600;
const CHROMIUM_KEY_ITERATIONS: u32 = 1003;
const MAX_COOKIE_COUNT: usize = 10_000;
const MAX_COOKIE_NAME_BYTES: usize = 4_096;
const MAX_COOKIE_VALUE_BYTES: usize = 65_536;
const MAX_COOKIE_DOMAIN_BYTES: usize = 254;
const MAX_COOKIE_PATH_BYTES: usize = 4_096;
const MAX_ENCRYPTED_VALUE_BYTES: usize = 1_048_576;
const MAX_SELECTED_COOKIE_BYTES: i64 = 64 * 1_024 * 1_024;
const MIN_SUPPORTED_CHROMIUM_DATABASE_VERSION: i64 = 23;
const MAX_SUPPORTED_CHROMIUM_DATABASE_VERSION: i64 = 24;
const MIN_SUPPORTED_FIREFOX_DATABASE_VERSION: i64 = 16;
const MAX_SUPPORTED_FIREFOX_DATABASE_VERSION: i64 = 17;
const CHROMIUM_COOKIE_SCOPE: &str = "top_frame_site_key = '' AND (:domain IS NULL OR lower(ltrim(host_key, '.')) = :domain OR (substr(host_key, 1, 1) = '.' AND :domain LIKE '%.' || lower(ltrim(host_key, '.'))))";
const FIREFOX_COOKIE_SCOPE: &str = "originAttributes = '' AND isPartitionedAttributeSet = 0 AND (:domain IS NULL OR lower(ltrim(host, '.')) = :domain OR (substr(host, 1, 1) = '.' AND :domain LIKE '%.' || lower(ltrim(host, '.'))))";

/// 9999-12-31T23:59:59Z: the latest expiry a webview cookie can carry.
pub const MAX_COOKIE_EXPIRY_UNIX: i64 = 253_402_300_799;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BrowserId {
    Chrome,
    Brave,
    Edge,
    Firefox,
    Safari,
}

impl BrowserId {
    pub fn name(self) -> &'static str {
        match self {
            Self::Chrome => "Google Chrome",
            Self::Brave => "Brave",
            Self::Edge => "Microsoft Edge",
            Self::Firefox => "Firefox",
            Self::Safari => "Safari",
        }
    }

    fn chromium(self) -> bool {
        matches!(self, Self::Chrome | Self::Brave | Self::Edge)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HostPlatform {
    Macos,
    Windows,
    Linux,
    Other,
}

impl HostPlatform {
    pub fn current() -> Self {
        #[cfg(target_os = "macos")]
        {
            Self::Macos
        }
        #[cfg(target_os = "windows")]
        {
            Self::Windows
        }
        #[cfg(target_os = "linux")]
        {
            Self::Linux
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            Self::Other
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Macos => "macOS",
            Self::Windows => "Windows",
            Self::Linux => "Linux",
            Self::Other => "this platform",
        }
    }
}

/// Which browsers a caller may read. The app copies cookies into its own
/// webview and supports the macOS Chromium browsers and Firefox there; the
/// CLI reads Firefox everywhere (its store is unencrypted) and the
/// Chromium browsers on macOS, where their key lives in the Keychain.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImportPolicy {
    App,
    Cli,
}

impl ImportPolicy {
    pub fn supports(self, platform: HostPlatform, browser: BrowserId) -> bool {
        match (self, browser) {
            (_, BrowserId::Safari) => false,
            (Self::App, _) => platform == HostPlatform::Macos,
            (Self::Cli, BrowserId::Firefox) => matches!(
                platform,
                HostPlatform::Macos | HostPlatform::Windows | HostPlatform::Linux
            ),
            (Self::Cli, _) => platform == HostPlatform::Macos,
        }
    }

    pub fn check(
        self,
        platform: HostPlatform,
        browser: BrowserId,
    ) -> Result<(), CookieImportError> {
        if self.supports(platform, browser) {
            Ok(())
        } else if browser == BrowserId::Safari && platform == HostPlatform::Macos {
            Err(CookieImportError::UnsupportedBrowser { browser })
        } else {
            Err(CookieImportError::UnsupportedPlatform)
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CookieSourceStatus {
    Available,
    NoCookieStore,
    NotInstalled,
    ComingSoon,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedCookieSource {
    pub browser: BrowserId,
    pub browser_name: String,
    pub profile: Option<String>,
    pub profile_name: Option<String>,
    pub status: CookieSourceStatus,
    pub detail: String,
}

#[derive(Clone, Eq, PartialEq)]
pub struct ImportedCookie {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    pub expires_unix: Option<i64>,
    pub secure: bool,
    pub http_only: bool,
    pub same_site: Option<ImportedSameSite>,
}

impl fmt::Debug for ImportedCookie {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ImportedCookie")
            .field("name", &self.name)
            .field("value", &"[redacted]")
            .field("domain", &self.domain)
            .field("path", &self.path)
            .field("expires_unix", &self.expires_unix)
            .field("secure", &self.secure)
            .field("http_only", &self.http_only)
            .field("same_site", &self.same_site)
            .finish()
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ImportedSameSite {
    None,
    Lax,
    Strict,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CookieImportError {
    ConfirmationRequired,
    ConfirmationCancelled,
    UnauthorizedCaller,
    InvalidProfile,
    InvalidDomain,
    UnsupportedPlatform,
    UnsupportedBrowser { browser: BrowserId },
    UnsafeStore,
    MissingStore { browser: BrowserId },
    LockedStore { browser: BrowserId },
    KeychainUnavailable { browser: BrowserId },
    DecryptionFailed { browser: BrowserId },
    StoreUnreadable { browser: BrowserId },
    UnsupportedStoreVersion { browser: BrowserId },
    StoreTooLarge { browser: BrowserId },
    CookieApplyFailed,
}

impl fmt::Display for CookieImportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ConfirmationRequired => {
                formatter.write_str("Confirm the cookie import before continuing.")
            }
            Self::ConfirmationCancelled => {
                formatter.write_str("Cookie import was cancelled. No cookies were imported.")
            }
            Self::UnauthorizedCaller => {
                formatter.write_str("Cookie import is only available from Browser settings.")
            }
            Self::InvalidProfile => formatter.write_str("Choose a valid browser profile."),
            Self::InvalidDomain => formatter
                .write_str("Enter a hostname such as example.com, without a path or port."),
            Self::UnsupportedPlatform => formatter
                .write_str("Cookie import is not supported on this operating system yet."),
            Self::UnsupportedBrowser { browser } => write!(
                formatter,
                "{} cookie import is not supported yet.",
                browser.name()
            ),
            Self::UnsafeStore => formatter
                .write_str("Oleafly refused to open a cookie store outside the selected profile."),
            Self::MissingStore { browser } => write!(
                formatter,
                "{}'s cookie store could not be found. Refresh the browser list and try again.",
                browser.name()
            ),
            Self::LockedStore { browser } => write!(
                formatter,
                "{}'s cookie store is locked. Close {} completely, then try again.",
                browser.name(),
                browser.name()
            ),
            Self::KeychainUnavailable { browser } => write!(
                formatter,
                "Oleafly could not access {} Safe Storage in macOS Keychain. Unlock Keychain and try again.",
                browser.name()
            ),
            Self::DecryptionFailed { browser } => write!(
                formatter,
                "Oleafly could not decrypt {}'s cookies. Unlock macOS Keychain and try again.",
                browser.name()
            ),
            Self::StoreUnreadable { browser } => write!(
                formatter,
                "Oleafly could not read {}'s cookie store. The store may be damaged or use an unsupported format.",
                browser.name()
            ),
            Self::UnsupportedStoreVersion { browser } => write!(
                formatter,
                "{} uses a cookie format that this version of Oleafly does not support.",
                browser.name()
            ),
            Self::StoreTooLarge { browser } => write!(
                formatter,
                "{} has too many cookies to import safely. Remove old site data, then try again.",
                browser.name()
            ),
            Self::CookieApplyFailed => formatter.write_str(
                "Oleafly could not finish adding cookies to the browser session. Some cookies may already have been imported. You can safely try again.",
            ),
        }
    }
}

impl std::error::Error for CookieImportError {}

pub trait SafeStoragePasswordProvider {
    fn password(&self, browser: BrowserId) -> Result<Zeroizing<Vec<u8>>, CookieImportError>;
}

/// The browser's "Safe Storage" password in the macOS Keychain.
pub struct MacSafeStorage;

impl SafeStoragePasswordProvider for MacSafeStorage {
    fn password(&self, browser: BrowserId) -> Result<Zeroizing<Vec<u8>>, CookieImportError> {
        #[cfg(target_os = "macos")]
        {
            let (service, account) = match browser {
                BrowserId::Chrome => ("Chrome Safe Storage", "Chrome"),
                BrowserId::Brave => ("Brave Safe Storage", "Brave"),
                BrowserId::Edge => ("Microsoft Edge Safe Storage", "Microsoft Edge"),
                BrowserId::Firefox | BrowserId::Safari => {
                    return Err(CookieImportError::UnsupportedBrowser { browser });
                }
            };
            security_framework::passwords::get_generic_password(service, account)
                .map(Zeroizing::new)
                .map_err(|_| CookieImportError::KeychainUnavailable { browser })
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = browser;
            Err(CookieImportError::UnsupportedPlatform)
        }
    }
}

pub fn validate_profile(profile: &str) -> Result<(), CookieImportError> {
    let valid = !profile.is_empty()
        && profile.len() <= 128
        && profile != "."
        && profile != ".."
        && profile
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b" ._-".contains(&byte))
        && profile
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric());
    if !valid {
        return Err(CookieImportError::InvalidProfile);
    }
    Ok(())
}

pub fn normalize_import_domain(domain: Option<&str>) -> Result<Option<String>, CookieImportError> {
    let Some(domain) = domain.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if domain.len() > 255 || !domain.is_ascii() {
        return Err(CookieImportError::InvalidDomain);
    }
    let normalized = domain
        .strip_suffix('.')
        .unwrap_or(domain)
        .to_ascii_lowercase();
    if domain.starts_with('.')
        || domain.contains("://")
        || domain.contains(['/', '\\', ':', '*'])
        || !valid_cookie_domain(&normalized)
    {
        return Err(CookieImportError::InvalidDomain);
    }
    Ok(Some(normalized))
}

pub fn resolve_cookie_store_at(
    home: &Path,
    platform: HostPlatform,
    browser: BrowserId,
    profile: &str,
    policy: ImportPolicy,
) -> Result<PathBuf, CookieImportError> {
    policy.check(platform, browser)?;
    validate_profile(profile)?;
    let layout = browser_layouts(platform)
        .into_iter()
        .find(|layout| layout.browser == browser)
        .ok_or(CookieImportError::UnsupportedBrowser { browser })?;
    let canonical_home = home
        .canonicalize()
        .map_err(|_| CookieImportError::UnsafeStore)?;
    let root = home.join(layout.root);
    let canonical_root = resolve_real_browser_root(home, layout.root, browser)?;
    if !canonical_root.starts_with(&canonical_home) {
        return Err(CookieImportError::UnsafeStore);
    }
    let profile_path = root.join(profile);
    let profile_metadata = std::fs::symlink_metadata(&profile_path)
        .map_err(|_| CookieImportError::MissingStore { browser })?;
    if !profile_metadata.is_dir() || profile_metadata.file_type().is_symlink() {
        return Err(CookieImportError::UnsafeStore);
    }
    let canonical_profile = profile_path
        .canonicalize()
        .map_err(|_| CookieImportError::MissingStore { browser })?;
    if canonical_profile.parent() != Some(canonical_root.as_path()) {
        return Err(CookieImportError::UnsafeStore);
    }
    let mut candidates = Vec::new();
    if layout.firefox {
        candidates.push(profile_path.join("cookies.sqlite"));
    } else {
        let network = profile_path.join("Network");
        match std::fs::symlink_metadata(&network) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
                candidates.push(network.join("Cookies"));
            }
            Ok(_) => return Err(CookieImportError::UnsafeStore),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(CookieImportError::MissingStore { browser }),
        }
        candidates.push(profile_path.join("Cookies"));
    }
    for candidate in candidates {
        let metadata = match std::fs::symlink_metadata(&candidate) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err(CookieImportError::MissingStore { browser }),
        };
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(CookieImportError::UnsafeStore);
        }
        let canonical_store = candidate
            .canonicalize()
            .map_err(|_| CookieImportError::MissingStore { browser })?;
        if !canonical_store.starts_with(&canonical_profile) {
            return Err(CookieImportError::UnsafeStore);
        }
        return Ok(canonical_store);
    }
    Err(CookieImportError::MissingStore { browser })
}

fn resolve_real_browser_root(
    home: &Path,
    relative_root: &str,
    browser: BrowserId,
) -> Result<PathBuf, CookieImportError> {
    let canonical_home = home
        .canonicalize()
        .map_err(|_| CookieImportError::UnsafeStore)?;
    let mut current = home.to_path_buf();
    for component in Path::new(relative_root).components() {
        let std::path::Component::Normal(component) = component else {
            return Err(CookieImportError::UnsafeStore);
        };
        current.push(component);
        let metadata = std::fs::symlink_metadata(&current).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                CookieImportError::MissingStore { browser }
            } else {
                CookieImportError::UnsafeStore
            }
        })?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(CookieImportError::UnsafeStore);
        }
    }
    let canonical_root = current
        .canonicalize()
        .map_err(|_| CookieImportError::MissingStore { browser })?;
    if !canonical_root.starts_with(canonical_home) {
        return Err(CookieImportError::UnsafeStore);
    }
    Ok(canonical_root)
}

pub fn unique_cookies(cookies: Vec<ImportedCookie>) -> Vec<ImportedCookie> {
    let mut identities = HashSet::new();
    let mut unique = Vec::with_capacity(cookies.len());
    for cookie in cookies {
        let identity = (
            cookie.name.clone(),
            cookie.domain.to_ascii_lowercase(),
            cookie.path.clone(),
        );
        if identities.insert(identity) {
            unique.push(cookie);
        }
    }
    unique
}

pub fn cookie_header_for(cookies: &[ImportedCookie], url: &url::Url) -> String {
    let host = url
        .host_str()
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let mut names = HashSet::new();
    cookie_header(
        cookies
            .iter()
            .filter(|cookie| {
                if cookie.domain.starts_with('.') {
                    cookie_applies(Some(&cookie.domain), Some(&cookie.path), cookie.secure, url)
                } else {
                    cookie.domain.eq_ignore_ascii_case(&host)
                        && cookie_applies(None, Some(&cookie.path), cookie.secure, url)
                }
            })
            .filter(|cookie| names.insert(cookie.name.clone()))
            .map(|cookie| (cookie.name.clone(), cookie.value.clone())),
    )
}

pub fn detect_sources_at(
    home: &Path,
    platform: HostPlatform,
    policy: ImportPolicy,
) -> Vec<DetectedCookieSource> {
    let layouts = browser_layouts(platform);
    let mut detected = Vec::new();
    for layout in layouts {
        let root = resolve_real_browser_root(home, layout.root, layout.browser).ok();
        let mut profiles = root
            .as_deref()
            .map(|root| discover_profiles(root, layout.firefox))
            .unwrap_or_default();
        let preferred = root
            .as_deref()
            .filter(|_| layout.firefox)
            .and_then(firefox_default_profile);
        profiles.sort_by_key(|profile| profile_sort_key(&profile.name, preferred.as_deref()));
        if profiles.is_empty() {
            detected.push(detected_source(
                layout.browser,
                None,
                CookieSourceStatus::NotInstalled,
                format!("{} was not found on this computer.", layout.browser.name()),
            ));
            continue;
        }
        let supported = policy.supports(platform, layout.browser);
        for profile in profiles {
            let status = if supported {
                if profile.has_cookie_store {
                    CookieSourceStatus::Available
                } else {
                    CookieSourceStatus::NoCookieStore
                }
            } else {
                CookieSourceStatus::ComingSoon
            };
            let detail = if supported && profile.has_cookie_store {
                format!("Import cookies from {}.", layout.browser.name())
            } else if supported {
                format!(
                    "No cookie store was found for this {} profile.",
                    layout.browser.name()
                )
            } else {
                format!(
                    "{} cookie import is not supported on {} yet.",
                    layout.browser.name(),
                    platform.name()
                )
            };
            detected.push(detected_source(
                layout.browser,
                Some(profile.name),
                status,
                detail,
            ));
        }
    }
    let safari_installed = platform == HostPlatform::Macos;
    detected.push(detected_source(
        BrowserId::Safari,
        None,
        if safari_installed {
            CookieSourceStatus::ComingSoon
        } else {
            CookieSourceStatus::NotInstalled
        },
        if safari_installed {
            "Safari cookie import is not supported yet.".to_string()
        } else {
            "Safari was not found on this computer.".to_string()
        },
    ));
    detected
}

pub fn read_cookies(
    home: &Path,
    platform: HostPlatform,
    browser: BrowserId,
    profile: &str,
    domain: Option<&str>,
    policy: ImportPolicy,
    safe_storage: &dyn SafeStoragePasswordProvider,
) -> Result<Vec<ImportedCookie>, CookieImportError> {
    let domain = normalize_import_domain(domain)?;
    let store = resolve_cookie_store_at(home, platform, browser, profile, policy)?;
    if browser.chromium() {
        read_chromium_cookie_store(&store, browser, domain.as_deref(), safe_storage)
    } else if browser == BrowserId::Firefox {
        read_firefox_cookie_store(&store, domain.as_deref())
    } else {
        Err(CookieImportError::UnsupportedBrowser { browser })
    }
}

#[cfg(test)]
fn decrypt_chromium_cookie_value(
    encrypted: &[u8],
    password: &[u8],
    host: &str,
    database_version: i64,
) -> Result<String, CookieImportError> {
    let key = derive_chromium_key(password);
    decrypt_chromium_cookie_with_key(encrypted, &key, host, database_version, BrowserId::Chrome)
}

fn derive_chromium_key(password: &[u8]) -> Zeroizing<[u8; 16]> {
    let mut key = Zeroizing::new([0_u8; 16]);
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA1,
        NonZeroU32::new(CHROMIUM_KEY_ITERATIONS).expect("nonzero Chromium iteration count"),
        b"saltysalt",
        password,
        key.as_mut(),
    );
    key
}

fn decrypt_chromium_cookie_with_key(
    encrypted: &[u8],
    key: &[u8; 16],
    host: &str,
    database_version: i64,
    browser: BrowserId,
) -> Result<String, CookieImportError> {
    let ciphertext = encrypted
        .strip_prefix(b"v10")
        .filter(|value| !value.is_empty() && value.len() % 16 == 0)
        .ok_or(CookieImportError::DecryptionFailed { browser })?;
    let mut buffer = ciphertext.to_vec();
    let result = (|| {
        // NOSONAR: Chromium's v10 os_crypt format fixes the IV to sixteen
        let decryptor = cbc::Decryptor::<Aes128>::new(key.into(), (&[b' '; 16]).into()); // NOSONAR
        let plaintext = decryptor
            .decrypt_padded::<Pkcs7>(&mut buffer)
            .map_err(|_| CookieImportError::DecryptionFailed { browser })?;
        let value = if database_version >= 24 {
            if plaintext.len() < 32 {
                return Err(CookieImportError::DecryptionFailed { browser });
            }
            let (bound_host, value) = plaintext.split_at(32);
            let expected_host = digest::digest(&digest::SHA256, host.as_bytes());
            if bound_host != expected_host.as_ref() {
                return Err(CookieImportError::DecryptionFailed { browser });
            }
            value
        } else {
            plaintext
        };
        String::from_utf8(value.to_vec())
            .map_err(|_| CookieImportError::DecryptionFailed { browser })
    })();
    buffer.zeroize();
    result
}

fn expiry_unusable(expiry: i64, now: i64) -> bool {
    expiry <= now || expiry > MAX_COOKIE_EXPIRY_UNIX
}

pub fn read_chromium_cookie_store(
    path: &Path,
    browser: BrowserId,
    domain: Option<&str>,
    safe_storage: &dyn SafeStoragePasswordProvider,
) -> Result<Vec<ImportedCookie>, CookieImportError> {
    {
        let connection = open_cookie_store(path, browser)?;
        let database_version = chromium_database_version(&connection, browser)?;
        validate_chromium_database_version(database_version, browser)?;
    }
    let password = safe_storage.password(browser)?;
    let key = derive_chromium_key(&password);
    drop(password);
    let mut connection = open_cookie_store(path, browser)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Deferred)
        .map_err(|error| map_database_error(browser, error))?;
    let database_version = chromium_database_version(&transaction, browser)?;
    validate_chromium_database_version(database_version, browser)?;
    ensure_cookie_limits(
        &transaction,
        browser,
        &format!("SELECT COUNT(*) FROM cookies WHERE {CHROMIUM_COOKIE_SCOPE}"),
        &format!(
            "SELECT COALESCE(SUM(length(CAST(host_key AS BLOB)) + length(CAST(name AS BLOB)) + length(CAST(value AS BLOB)) + length(encrypted_value) + length(CAST(path AS BLOB))), 0) FROM cookies WHERE {CHROMIUM_COOKIE_SCOPE}"
        ),
        domain,
    )?;
    let query = format!(
        "SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite \
         FROM cookies WHERE {CHROMIUM_COOKIE_SCOPE} \
         AND length(CAST(host_key AS BLOB)) BETWEEN 1 AND {MAX_COOKIE_DOMAIN_BYTES} \
         AND length(CAST(name AS BLOB)) BETWEEN 1 AND {MAX_COOKIE_NAME_BYTES} \
         AND length(CAST(value AS BLOB)) <= {MAX_COOKIE_VALUE_BYTES} \
         AND length(encrypted_value) <= {MAX_ENCRYPTED_VALUE_BYTES} \
         AND length(CAST(path AS BLOB)) <= {MAX_COOKIE_PATH_BYTES} \
         ORDER BY last_update_utc DESC, rowid DESC"
    );
    let now = unix_now();
    let cookies = {
        let mut statement = transaction
            .prepare(&query)
            .map_err(|error| map_database_error(browser, error))?;
        let rows = statement
            .query_map(named_params! { ":domain": domain }, |row| {
                Ok(ChromiumCookieRow {
                    domain: row.get(0)?,
                    name: row.get(1)?,
                    value: row.get(2)?,
                    encrypted_value: row.get(3)?,
                    path: row.get(4)?,
                    expires_utc: row.get(5)?,
                    secure: row.get::<_, i64>(6)? != 0,
                    http_only: row.get::<_, i64>(7)? != 0,
                    same_site: row.get(8)?,
                })
            })
            .map_err(|error| map_database_error(browser, error))?;
        let mut cookies = Vec::new();
        let mut rows_seen = 0_usize;
        for row in rows {
            rows_seen += 1;
            if rows_seen > MAX_COOKIE_COUNT {
                return Err(CookieImportError::StoreTooLarge { browser });
            }
            let row = row.map_err(|error| map_database_error(browser, error))?;
            if !domain_matches(&row.domain, domain) || !valid_cookie_row(&row) {
                continue;
            }
            if !row.value.is_empty() && !row.encrypted_value.is_empty() {
                continue;
            }
            let value = if row.encrypted_value.is_empty() {
                row.value
            } else {
                decrypt_chromium_cookie_with_key(
                    &row.encrypted_value,
                    &key,
                    &row.domain,
                    database_version,
                    browser,
                )?
            };
            if value.len() > MAX_COOKIE_VALUE_BYTES || value.chars().any(char::is_control) {
                continue;
            }
            let expires_unix = chromium_expiry(row.expires_utc);
            if expires_unix.is_some_and(|expiry| expiry_unusable(expiry, now)) {
                continue;
            }
            cookies.push(ImportedCookie {
                name: row.name,
                value,
                domain: row.domain,
                path: row.path,
                expires_unix,
                secure: row.secure,
                http_only: row.http_only,
                same_site: chromium_same_site(row.same_site),
            });
        }
        cookies
    };
    transaction
        .commit()
        .map_err(|error| map_database_error(browser, error))?;
    Ok(cookies)
}

pub fn read_firefox_cookie_store(
    path: &Path,
    domain: Option<&str>,
) -> Result<Vec<ImportedCookie>, CookieImportError> {
    let browser = BrowserId::Firefox;
    let mut connection = open_cookie_store(path, browser)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Deferred)
        .map_err(|error| map_database_error(browser, error))?;
    let schema_version = transaction
        .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
        .map_err(|error| map_database_error(browser, error))?;
    validate_firefox_database_version(schema_version)?;
    ensure_cookie_limits(
        &transaction,
        browser,
        &format!("SELECT COUNT(*) FROM moz_cookies WHERE {FIREFOX_COOKIE_SCOPE}"),
        &format!(
            "SELECT COALESCE(SUM(length(CAST(name AS BLOB)) + length(CAST(value AS BLOB)) + length(CAST(host AS BLOB)) + length(CAST(path AS BLOB))), 0) FROM moz_cookies WHERE {FIREFOX_COOKIE_SCOPE}"
        ),
        domain,
    )?;
    let query = format!(
        "SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite \
         FROM moz_cookies WHERE {FIREFOX_COOKIE_SCOPE} \
         AND length(CAST(host AS BLOB)) BETWEEN 1 AND {MAX_COOKIE_DOMAIN_BYTES} \
         AND length(CAST(name AS BLOB)) BETWEEN 1 AND {MAX_COOKIE_NAME_BYTES} \
         AND length(CAST(value AS BLOB)) <= {MAX_COOKIE_VALUE_BYTES} \
         AND length(CAST(path AS BLOB)) <= {MAX_COOKIE_PATH_BYTES} ORDER BY creationTime"
    );
    let now = unix_now();
    let cookies = {
        let mut statement = transaction
            .prepare(&query)
            .map_err(|error| map_database_error(browser, error))?;
        let rows = statement
            .query_map(named_params! { ":domain": domain }, |row| {
                Ok(FirefoxCookieRow {
                    name: row.get(0)?,
                    value: row.get(1)?,
                    domain: row.get(2)?,
                    path: row.get(3)?,
                    expiry: row.get(4)?,
                    secure: row.get::<_, i64>(5)? != 0,
                    http_only: row.get::<_, i64>(6)? != 0,
                    same_site: row.get(7)?,
                })
            })
            .map_err(|error| map_database_error(browser, error))?;
        let mut cookies = Vec::new();
        let mut rows_seen = 0_usize;
        for row in rows {
            rows_seen += 1;
            if rows_seen > MAX_COOKIE_COUNT {
                return Err(CookieImportError::StoreTooLarge { browser });
            }
            let row = row.map_err(|error| map_database_error(browser, error))?;
            if !domain_matches(&row.domain, domain) || !valid_firefox_cookie_row(&row) {
                continue;
            }
            let expires_unix = (row.expiry != 0).then_some(row.expiry / 1_000);
            if expires_unix.is_some_and(|expiry| expiry_unusable(expiry, now)) {
                continue;
            }
            cookies.push(ImportedCookie {
                name: row.name,
                value: row.value,
                domain: row.domain,
                path: row.path,
                expires_unix,
                secure: row.secure,
                http_only: row.http_only,
                same_site: firefox_same_site(row.same_site),
            });
        }
        cookies
    };
    transaction
        .commit()
        .map_err(|error| map_database_error(browser, error))?;
    Ok(cookies)
}

fn chromium_database_version(
    connection: &Connection,
    browser: BrowserId,
) -> Result<i64, CookieImportError> {
    connection
        .query_row("SELECT value FROM meta WHERE key = 'version'", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| map_database_error(browser, error))?
        .parse::<i64>()
        .map_err(|_| CookieImportError::StoreUnreadable { browser })
}

fn validate_chromium_database_version(
    database_version: i64,
    browser: BrowserId,
) -> Result<(), CookieImportError> {
    if !(MIN_SUPPORTED_CHROMIUM_DATABASE_VERSION..=MAX_SUPPORTED_CHROMIUM_DATABASE_VERSION)
        .contains(&database_version)
    {
        return Err(CookieImportError::UnsupportedStoreVersion { browser });
    }
    Ok(())
}

fn validate_firefox_database_version(schema_version: i64) -> Result<(), CookieImportError> {
    if !(MIN_SUPPORTED_FIREFOX_DATABASE_VERSION..=MAX_SUPPORTED_FIREFOX_DATABASE_VERSION)
        .contains(&schema_version)
    {
        return Err(CookieImportError::UnsupportedStoreVersion {
            browser: BrowserId::Firefox,
        });
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct BrowserLayout {
    browser: BrowserId,
    root: &'static str,
    firefox: bool,
}

struct ChromiumCookieRow {
    domain: String,
    name: String,
    value: String,
    encrypted_value: Vec<u8>,
    path: String,
    expires_utc: i64,
    secure: bool,
    http_only: bool,
    same_site: i64,
}

struct FirefoxCookieRow {
    name: String,
    value: String,
    domain: String,
    path: String,
    expiry: i64,
    secure: bool,
    http_only: bool,
    same_site: i64,
}

fn browser_layouts(platform: HostPlatform) -> [BrowserLayout; 4] {
    match platform {
        HostPlatform::Macos => [
            BrowserLayout {
                browser: BrowserId::Chrome,
                root: "Library/Application Support/Google/Chrome",
                firefox: false,
            },
            BrowserLayout {
                browser: BrowserId::Brave,
                root: "Library/Application Support/BraveSoftware/Brave-Browser",
                firefox: false,
            },
            BrowserLayout {
                browser: BrowserId::Edge,
                root: "Library/Application Support/Microsoft Edge",
                firefox: false,
            },
            BrowserLayout {
                browser: BrowserId::Firefox,
                root: "Library/Application Support/Firefox/Profiles",
                firefox: true,
            },
        ],
        HostPlatform::Windows => [
            BrowserLayout {
                browser: BrowserId::Chrome,
                root: "AppData/Local/Google/Chrome/User Data",
                firefox: false,
            },
            BrowserLayout {
                browser: BrowserId::Brave,
                root: "AppData/Local/BraveSoftware/Brave-Browser/User Data",
                firefox: false,
            },
            BrowserLayout {
                browser: BrowserId::Edge,
                root: "AppData/Local/Microsoft/Edge/User Data",
                firefox: false,
            },
            BrowserLayout {
                browser: BrowserId::Firefox,
                root: "AppData/Roaming/Mozilla/Firefox/Profiles",
                firefox: true,
            },
        ],
        HostPlatform::Linux | HostPlatform::Other => [
            BrowserLayout {
                browser: BrowserId::Chrome,
                root: ".config/google-chrome",
                firefox: false,
            },
            BrowserLayout {
                browser: BrowserId::Brave,
                root: ".config/BraveSoftware/Brave-Browser",
                firefox: false,
            },
            BrowserLayout {
                browser: BrowserId::Edge,
                root: ".config/microsoft-edge",
                firefox: false,
            },
            BrowserLayout {
                browser: BrowserId::Firefox,
                root: ".mozilla/firefox",
                firefox: true,
            },
        ],
    }
}

struct DiscoveredProfile {
    name: String,
    has_cookie_store: bool,
}

fn discover_profiles(root: &Path, firefox: bool) -> Vec<DiscoveredProfile> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let profile = entry.file_name().to_str()?.to_string();
            let profile_path = entry.path();
            let metadata = std::fs::symlink_metadata(&profile_path).ok()?;
            if !metadata.is_dir()
                || metadata.file_type().is_symlink()
                || validate_profile(&profile).is_err()
                || (!firefox && !is_chromium_profile_name(&profile))
            {
                return None;
            }
            Some(DiscoveredProfile {
                name: profile,
                has_cookie_store: profile_has_cookie_store(&profile_path, firefox),
            })
        })
        .collect()
}

fn is_chromium_profile_name(profile: &str) -> bool {
    matches!(profile, "Default" | "Guest Profile" | "System Profile")
        || profile
            .strip_prefix("Profile ")
            .is_some_and(|suffix| !suffix.is_empty())
}

fn profile_has_cookie_store(profile_path: &Path, firefox: bool) -> bool {
    if firefox {
        return is_regular_nonsymlink_file(&profile_path.join("cookies.sqlite"));
    }
    let network = profile_path.join("Network");
    let network_is_real_directory = std::fs::symlink_metadata(&network)
        .is_ok_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink());
    (network_is_real_directory && is_regular_nonsymlink_file(&network.join("Cookies")))
        || is_regular_nonsymlink_file(&profile_path.join("Cookies"))
}

fn is_regular_nonsymlink_file(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
}

fn detected_source(
    browser: BrowserId,
    profile: Option<String>,
    status: CookieSourceStatus,
    detail: String,
) -> DetectedCookieSource {
    DetectedCookieSource {
        browser,
        browser_name: browser.name().to_string(),
        profile_name: profile.clone(),
        profile,
        status,
        detail,
    }
}

fn profile_sort_key(profile: &str, preferred: Option<&str>) -> (u8, String) {
    (
        if profile == "Default" || preferred == Some(profile) {
            0
        } else {
            1
        },
        profile.to_lowercase(),
    )
}

fn read_small_ini(path: &Path) -> Option<String> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > 64 * 1024 {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

fn ini_sections(text: &str) -> Vec<(String, Vec<(String, String)>)> {
    let mut sections: Vec<(String, Vec<(String, String)>)> = Vec::new();
    for line in text.lines().map(str::trim) {
        if let Some(name) = line
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
        {
            sections.push((name.to_string(), Vec::new()));
        } else if let (Some((_, entries)), Some((key, value))) =
            (sections.last_mut(), line.split_once('='))
        {
            entries.push((key.trim().to_string(), value.trim().to_string()));
        }
    }
    sections
}

/// The folder name of the profile Firefox opens: the default of its install
/// (`installs.ini`, or an `[Install…]` section of `profiles.ini`), else the
/// profile marked `Default=1`. Profile folders start with random letters, so
/// their names say nothing about which one is in use.
fn firefox_default_profile(root: &Path) -> Option<String> {
    let folder = [Some(root), root.parent()]
        .into_iter()
        .flatten()
        .find(|folder| {
            folder.join("profiles.ini").is_file() || folder.join("installs.ini").is_file()
        })?;
    let value_of = |entries: &[(String, String)], wanted: &str| {
        entries
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(wanted))
            .map(|(_, value)| value.clone())
    };
    let last_part = |path: &str| {
        path.rsplit(['/', '\\'])
            .next()
            .filter(|name| !name.is_empty() && *name != "." && *name != "..")
            .map(str::to_string)
    };
    let installs = read_small_ini(&folder.join("installs.ini")).unwrap_or_default();
    let profiles = read_small_ini(&folder.join("profiles.ini")).unwrap_or_default();
    let installed = ini_sections(&installs)
        .into_iter()
        .chain(
            ini_sections(&profiles)
                .into_iter()
                .filter(|(name, _)| name.starts_with("Install")),
        )
        .find_map(|(_, entries)| value_of(&entries, "Default").and_then(|path| last_part(&path)));
    installed.or_else(|| {
        ini_sections(&profiles)
            .into_iter()
            .filter(|(name, _)| name.starts_with("Profile"))
            .find(|(_, entries)| value_of(entries, "Default").as_deref() == Some("1"))
            .and_then(|(_, entries)| value_of(&entries, "Path"))
            .and_then(|path| last_part(&path))
    })
}

fn open_cookie_store(path: &Path, browser: BrowserId) -> Result<Connection, CookieImportError> {
    let metadata =
        std::fs::symlink_metadata(path).map_err(|_| CookieImportError::MissingStore { browser })?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(CookieImportError::MissingStore { browser });
    }
    let canonical_path = path
        .canonicalize()
        .map_err(|_| CookieImportError::MissingStore { browser })?;
    let connection = Connection::open_with_flags(
        canonical_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .map_err(|error| map_database_error(browser, error))?;
    connection
        .busy_timeout(Duration::ZERO)
        .map_err(|error| map_database_error(browser, error))?;
    Ok(connection)
}

fn map_database_error(browser: BrowserId, error: rusqlite::Error) -> CookieImportError {
    let locked = matches!(
        error.sqlite_error_code(),
        Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked)
    ) || matches!(
        error,
        rusqlite::Error::SqliteFailure(ref failure, _)
            if matches!(failure.extended_code & 0xff, 5 | 6)
    );
    if locked {
        CookieImportError::LockedStore { browser }
    } else {
        CookieImportError::StoreUnreadable { browser }
    }
}

fn ensure_cookie_limits(
    connection: &Connection,
    browser: BrowserId,
    count_query: &str,
    bytes_query: &str,
    domain: Option<&str>,
) -> Result<(), CookieImportError> {
    let count = connection
        .query_row(count_query, named_params! { ":domain": domain }, |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| map_database_error(browser, error))?;
    if count > MAX_COOKIE_COUNT as i64 {
        return Err(CookieImportError::StoreTooLarge { browser });
    }
    let bytes = connection
        .query_row(bytes_query, named_params! { ":domain": domain }, |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| map_database_error(browser, error))?;
    if bytes > MAX_SELECTED_COOKIE_BYTES {
        return Err(CookieImportError::StoreTooLarge { browser });
    }
    Ok(())
}

fn domain_matches(cookie_domain: &str, filter: Option<&str>) -> bool {
    let Some(filter) = filter else {
        return true;
    };
    let is_domain_cookie = cookie_domain.starts_with('.');
    let normalized_cookie_domain = cookie_domain.trim_start_matches('.').to_ascii_lowercase();
    normalized_cookie_domain == filter
        || (is_domain_cookie
            && filter
                .strip_suffix(normalized_cookie_domain.as_str())
                .is_some_and(|prefix| prefix.ends_with('.')))
}

fn valid_cookie_row(row: &ChromiumCookieRow) -> bool {
    valid_cookie_fields(&row.name, &row.domain, &row.path)
        && row.value.len() <= MAX_COOKIE_VALUE_BYTES
        && row.encrypted_value.len() <= MAX_ENCRYPTED_VALUE_BYTES
        && !row.value.chars().any(char::is_control)
}

fn valid_firefox_cookie_row(row: &FirefoxCookieRow) -> bool {
    valid_cookie_fields(&row.name, &row.domain, &row.path)
        && row.value.len() <= MAX_COOKIE_VALUE_BYTES
        && !row.value.chars().any(char::is_control)
}

fn valid_cookie_fields(name: &str, domain: &str, path: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_COOKIE_NAME_BYTES
        && !name
            .bytes()
            .any(|byte| byte <= 0x20 || b"()<>@,;:\\\"/[]?={}".contains(&byte))
        && valid_cookie_domain(domain)
        && path.starts_with('/')
        && path.len() <= MAX_COOKIE_PATH_BYTES
        && !path.chars().any(char::is_control)
}

fn valid_cookie_domain(domain: &str) -> bool {
    let normalized = domain.trim_start_matches('.');
    !normalized.is_empty()
        && normalized.len() <= 253
        && normalized.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                && !label.starts_with('-')
                && !label.ends_with('-')
        })
}

fn chromium_expiry(expires_utc: i64) -> Option<i64> {
    (expires_utc > 0).then(|| expires_utc / 1_000_000 - CHROMIUM_EPOCH_OFFSET_SECONDS)
}

fn chromium_same_site(value: i64) -> Option<ImportedSameSite> {
    match value {
        0 => Some(ImportedSameSite::None),
        1 => Some(ImportedSameSite::Lax),
        2 => Some(ImportedSameSite::Strict),
        _ => None,
    }
}

fn firefox_same_site(value: i64) -> Option<ImportedSameSite> {
    match value {
        0 => Some(ImportedSameSite::None),
        1 => Some(ImportedSameSite::Lax),
        2 => Some(ImportedSameSite::Strict),
        _ => None,
    }
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests;
