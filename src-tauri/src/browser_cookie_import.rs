use std::{
    collections::HashSet,
    fmt,
    num::NonZeroU32,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use aes::Aes128;
use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use ring::{digest, pbkdf2};
use rusqlite::{named_params, Connection, ErrorCode, OpenFlags, TransactionBehavior};
use serde::{Deserialize, Serialize};
use tauri::{Manager, Runtime, Webview};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use zeroize::{Zeroize, Zeroizing};

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
const MAIN_WEBVIEW_LABEL: &str = "main";
const CHROMIUM_COOKIE_SCOPE: &str = "top_frame_site_key = '' AND (:domain IS NULL OR lower(ltrim(host_key, '.')) = :domain OR (substr(host_key, 1, 1) = '.' AND :domain LIKE '%.' || lower(ltrim(host_key, '.'))))";
const FIREFOX_COOKIE_SCOPE: &str = "originAttributes = '' AND isPartitionedAttributeSet = 0 AND (:domain IS NULL OR lower(ltrim(host, '.')) = :domain OR (substr(host, 1, 1) = '.' AND :domain LIKE '%.' || lower(ltrim(host, '.'))))";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BrowserCookieSourceId {
    Chrome,
    Brave,
    Edge,
    Firefox,
    Safari,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[allow(dead_code)]
enum HostPlatform {
    Macos,
    Windows,
    Linux,
    Other,
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
    browser: BrowserCookieSourceId,
    browser_name: String,
    profile: Option<String>,
    profile_name: Option<String>,
    status: CookieSourceStatus,
    detail: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ImportedCookie {
    name: String,
    value: String,
    domain: String,
    path: String,
    expires_unix: Option<i64>,
    secure: bool,
    http_only: bool,
    same_site: Option<ImportedSameSite>,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum ImportedSameSite {
    None,
    Lax,
    Strict,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
enum CookieImportError {
    ConfirmationRequired,
    ConfirmationCancelled,
    UnauthorizedCaller,
    InvalidProfile,
    InvalidDomain,
    UnsupportedPlatform,
    UnsupportedBrowser { browser: BrowserCookieSourceId },
    UnsafeStore,
    MissingStore { browser: BrowserCookieSourceId },
    LockedStore { browser: BrowserCookieSourceId },
    KeychainUnavailable { browser: BrowserCookieSourceId },
    DecryptionFailed { browser: BrowserCookieSourceId },
    StoreUnreadable { browser: BrowserCookieSourceId },
    UnsupportedStoreVersion { browser: BrowserCookieSourceId },
    StoreTooLarge { browser: BrowserCookieSourceId },
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

impl BrowserCookieSourceId {
    fn name(self) -> &'static str {
        match self {
            Self::Chrome => "Google Chrome",
            Self::Brave => "Brave",
            Self::Edge => "Microsoft Edge",
            Self::Firefox => "Firefox",
            Self::Safari => "Safari",
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCookieImportRequest {
    browser: BrowserCookieSourceId,
    profile: String,
    domain: Option<String>,
    confirmed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCookieImportSummary {
    imported: usize,
    browser_name: String,
    profile_name: String,
    domain: Option<String>,
}

trait SafeStoragePasswordProvider {
    fn password(
        &self,
        browser: BrowserCookieSourceId,
    ) -> Result<Zeroizing<Vec<u8>>, CookieImportError>;
}

struct MacSafeStoragePasswordProvider;

impl SafeStoragePasswordProvider for MacSafeStoragePasswordProvider {
    fn password(
        &self,
        browser: BrowserCookieSourceId,
    ) -> Result<Zeroizing<Vec<u8>>, CookieImportError> {
        #[cfg(target_os = "macos")]
        {
            let (service, account) = match browser {
                BrowserCookieSourceId::Chrome => ("Chrome Safe Storage", "Chrome"),
                BrowserCookieSourceId::Brave => ("Brave Safe Storage", "Brave"),
                BrowserCookieSourceId::Edge => ("Microsoft Edge Safe Storage", "Microsoft Edge"),
                BrowserCookieSourceId::Firefox | BrowserCookieSourceId::Safari => {
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

#[tauri::command]
pub fn detect_browser_cookie_sources<R: Runtime>(
    webview: Webview<R>,
) -> Result<Vec<DetectedCookieSource>, String> {
    validate_command_caller(webview.label()).map_err(|error| error.to_string())?;
    let home = crate::paths::home_dir()
        .map_err(|_| "Oleafly could not locate your browser profiles.".to_string())?;
    Ok(detect_browser_cookie_sources_at(
        &home,
        HostPlatform::current(),
    ))
}

#[tauri::command]
pub async fn import_browser_cookies<R: Runtime>(
    webview: Webview<R>,
    request: BrowserCookieImportRequest,
) -> Result<BrowserCookieImportSummary, String> {
    validate_command_caller(webview.label()).map_err(|error| error.to_string())?;
    let platform = HostPlatform::current();
    validate_supported_import(platform, request.browser).map_err(|error| error.to_string())?;
    validate_import_request(
        webview.label(),
        request.confirmed,
        &request.profile,
        request.domain.as_deref(),
    )
    .map_err(|error| error.to_string())?;
    let domain =
        normalize_import_domain(request.domain.as_deref()).map_err(|error| error.to_string())?;
    let browser = request.browser;
    let profile = request.profile;
    confirm_native_cookie_import(
        webview.app_handle().clone(),
        browser,
        &profile,
        domain.as_deref(),
    )
    .await
    .map_err(|error| error.to_string())?;
    let home = crate::paths::home_dir()
        .map_err(|_| "Oleafly could not locate your browser profiles.".to_string())?;
    let read_profile = profile.clone();
    let read_domain = domain.clone();
    let cookies = tauri::async_runtime::spawn_blocking(move || {
        let store = resolve_cookie_store_at(&home, platform, browser, &read_profile)?;
        match browser {
            BrowserCookieSourceId::Chrome
            | BrowserCookieSourceId::Brave
            | BrowserCookieSourceId::Edge => read_chromium_cookie_store(
                &store,
                browser,
                read_domain.as_deref(),
                &MacSafeStoragePasswordProvider,
            ),
            BrowserCookieSourceId::Firefox => {
                read_firefox_cookie_store(&store, read_domain.as_deref())
            }
            BrowserCookieSourceId::Safari => Err(CookieImportError::UnsupportedBrowser { browser }),
        }
    })
    .await
    .map_err(|_| "Oleafly could not finish reading the cookie store.".to_string())?
    .map_err(|error| error.to_string())?;

    let cookies = unique_runtime_cookies(cookies);
    let runtime_cookies = cookies
        .iter()
        .map(runtime_cookie)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    for cookie in runtime_cookies {
        webview
            .set_cookie(cookie)
            .map_err(|_| CookieImportError::CookieApplyFailed.to_string())?;
    }
    verify_runtime_cookies(&webview, &cookies).map_err(|error| error.to_string())?;

    Ok(BrowserCookieImportSummary {
        imported: cookies.len(),
        browser_name: browser.name().to_string(),
        profile_name: profile,
        domain,
    })
}

fn validate_command_caller(caller: &str) -> Result<(), CookieImportError> {
    if caller != MAIN_WEBVIEW_LABEL {
        return Err(CookieImportError::UnauthorizedCaller);
    }
    Ok(())
}

fn validate_import_request(
    caller: &str,
    confirmed: bool,
    profile: &str,
    domain: Option<&str>,
) -> Result<(), CookieImportError> {
    validate_command_caller(caller)?;
    if !confirmed {
        return Err(CookieImportError::ConfirmationRequired);
    }
    validate_profile(profile)?;
    normalize_import_domain(domain)?;
    Ok(())
}

fn validate_supported_import(
    platform: HostPlatform,
    browser: BrowserCookieSourceId,
) -> Result<(), CookieImportError> {
    if platform != HostPlatform::Macos {
        return Err(CookieImportError::UnsupportedPlatform);
    }
    if browser == BrowserCookieSourceId::Safari {
        return Err(CookieImportError::UnsupportedBrowser { browser });
    }
    Ok(())
}

async fn confirm_native_cookie_import<R: Runtime>(
    app: tauri::AppHandle<R>,
    browser: BrowserCookieSourceId,
    profile: &str,
    domain: Option<&str>,
) -> Result<(), CookieImportError> {
    let scope = domain
        .map(|hostname| format!("cookies for {hostname}"))
        .unwrap_or_else(|| "all cookies".to_string());
    let message = format!(
        "Import {scope} from {} profile \"{profile}\" into Oleafly's in-app browser? Imported cookies may sign you in to websites.",
        browser.name()
    );
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(message)
        .title("Confirm cookie import")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Import cookies".to_string(),
            "Cancel".to_string(),
        ))
        .show(move |confirmed| {
            let _ = sender.send(confirmed);
        });
    let confirmed = receiver
        .await
        .map_err(|_| CookieImportError::ConfirmationCancelled)?;
    require_native_confirmation(confirmed)
}

fn require_native_confirmation(confirmed: bool) -> Result<(), CookieImportError> {
    if confirmed {
        Ok(())
    } else {
        Err(CookieImportError::ConfirmationCancelled)
    }
}

fn validate_profile(profile: &str) -> Result<(), CookieImportError> {
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

fn normalize_import_domain(domain: Option<&str>) -> Result<Option<String>, CookieImportError> {
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

fn resolve_cookie_store_at(
    home: &Path,
    platform: HostPlatform,
    browser: BrowserCookieSourceId,
    profile: &str,
) -> Result<PathBuf, CookieImportError> {
    if platform != HostPlatform::Macos {
        return Err(CookieImportError::UnsupportedPlatform);
    }
    if browser == BrowserCookieSourceId::Safari {
        return Err(CookieImportError::UnsupportedBrowser { browser });
    }
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
    browser: BrowserCookieSourceId,
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

fn runtime_cookie(
    imported: &ImportedCookie,
) -> Result<tauri::webview::cookie::Cookie<'static>, CookieImportError> {
    let runtime_domain = if imported.domain.starts_with('.') {
        format!(".{}", imported.domain)
    } else {
        imported.domain.clone()
    };
    let mut builder =
        tauri::webview::cookie::Cookie::build((imported.name.clone(), imported.value.clone()))
            .domain(runtime_domain)
            .path(imported.path.clone())
            .secure(imported.secure)
            .http_only(imported.http_only);
    if let Some(expires_unix) = imported.expires_unix {
        let expires =
            tauri::webview::cookie::time::OffsetDateTime::from_unix_timestamp(expires_unix)
                .map_err(|_| CookieImportError::CookieApplyFailed)?;
        builder = builder.expires(expires);
    }
    if let Some(same_site) = imported.same_site {
        let same_site = match same_site {
            ImportedSameSite::None => tauri::webview::cookie::SameSite::None,
            ImportedSameSite::Lax => tauri::webview::cookie::SameSite::Lax,
            ImportedSameSite::Strict => tauri::webview::cookie::SameSite::Strict,
        };
        builder = builder.same_site(same_site);
    }
    Ok(builder.build().into_owned())
}

fn unique_runtime_cookies(cookies: Vec<ImportedCookie>) -> Vec<ImportedCookie> {
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

#[derive(Debug, Eq, Hash, PartialEq)]
struct RuntimeCookieFingerprint {
    name: String,
    value: String,
    domain: String,
    path: String,
    expires_unix: Option<i64>,
    secure: bool,
    http_only: bool,
    same_site: Option<ImportedSameSite>,
}

fn imported_cookie_fingerprint(cookie: &ImportedCookie) -> RuntimeCookieFingerprint {
    RuntimeCookieFingerprint {
        name: cookie.name.clone(),
        value: cookie.value.clone(),
        domain: cookie.domain.trim_start_matches('.').to_ascii_lowercase(),
        path: cookie.path.clone(),
        expires_unix: cookie.expires_unix,
        secure: cookie.secure,
        http_only: cookie.http_only,
        same_site: match cookie.same_site {
            Some(ImportedSameSite::Lax) => Some(ImportedSameSite::Lax),
            Some(ImportedSameSite::Strict) => Some(ImportedSameSite::Strict),
            Some(ImportedSameSite::None) | None => None,
        },
    }
}

fn stored_cookie_fingerprint(
    cookie: &tauri::webview::cookie::Cookie<'_>,
) -> Option<RuntimeCookieFingerprint> {
    Some(RuntimeCookieFingerprint {
        name: cookie.name().to_string(),
        value: cookie.value().to_string(),
        domain: cookie
            .domain()?
            .trim_start_matches('.')
            .to_ascii_lowercase(),
        path: cookie.path()?.to_string(),
        expires_unix: cookie
            .expires_datetime()
            .map(|expiry| expiry.unix_timestamp()),
        secure: cookie.secure().unwrap_or(false),
        http_only: cookie.http_only().unwrap_or(false),
        same_site: match cookie.same_site() {
            Some(tauri::webview::cookie::SameSite::Lax) => Some(ImportedSameSite::Lax),
            Some(tauri::webview::cookie::SameSite::Strict) => Some(ImportedSameSite::Strict),
            Some(tauri::webview::cookie::SameSite::None) | None => None,
        },
    })
}

fn verify_runtime_cookies<R: Runtime>(
    webview: &Webview<R>,
    imported: &[ImportedCookie],
) -> Result<(), CookieImportError> {
    if imported.is_empty() {
        return Ok(());
    }
    let stored = webview
        .cookies()
        .map_err(|_| CookieImportError::CookieApplyFailed)?;
    let stored_identities = stored
        .into_iter()
        .filter_map(|actual| stored_cookie_fingerprint(&actual))
        .collect::<HashSet<_>>();
    let all_present = imported
        .iter()
        .all(|expected| stored_identities.contains(&imported_cookie_fingerprint(expected)));
    if !all_present {
        return Err(CookieImportError::CookieApplyFailed);
    }
    Ok(())
}

fn detect_browser_cookie_sources_at(
    home: &Path,
    platform: HostPlatform,
) -> Vec<DetectedCookieSource> {
    let layouts = browser_layouts(platform);
    let mut detected = Vec::new();
    for layout in layouts {
        let mut profiles = resolve_real_browser_root(home, layout.root, layout.browser)
            .map(|root| discover_profiles(&root, layout.firefox))
            .unwrap_or_default();
        profiles.sort_by_key(|profile| profile_sort_key(&profile.name));
        if profiles.is_empty() {
            detected.push(detected_source(
                layout.browser,
                None,
                CookieSourceStatus::NotInstalled,
                format!("{} was not found on this computer.", layout.browser.name()),
            ));
            continue;
        }
        let supported = platform == HostPlatform::Macos;
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
        BrowserCookieSourceId::Safari,
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

#[cfg(test)]
fn decrypt_chromium_cookie_value(
    encrypted: &[u8],
    password: &[u8],
    host: &str,
    database_version: i64,
) -> Result<String, CookieImportError> {
    let key = derive_chromium_key(password);
    decrypt_chromium_cookie_with_key(
        encrypted,
        &key,
        host,
        database_version,
        BrowserCookieSourceId::Chrome,
    )
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
    browser: BrowserCookieSourceId,
) -> Result<String, CookieImportError> {
    let ciphertext = encrypted
        .strip_prefix(b"v10")
        .filter(|value| !value.is_empty() && value.len() % 16 == 0)
        .ok_or(CookieImportError::DecryptionFailed { browser })?;
    let mut buffer = ciphertext.to_vec();
    let result = (|| {
        // NOSONAR: Chromium's v10 os_crypt format fixes the IV to sixteen
        // spaces; decrypting cookies Chromium wrote requires matching it.
        let decryptor = cbc::Decryptor::<Aes128>::new(key.into(), (&[b' '; 16]).into()); // NOSONAR
        let plaintext = decryptor
            .decrypt_padded_mut::<Pkcs7>(&mut buffer)
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

fn read_chromium_cookie_store(
    path: &Path,
    browser: BrowserCookieSourceId,
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
            if expires_unix.is_some_and(|expiry| {
                expiry <= now
                    || tauri::webview::cookie::time::OffsetDateTime::from_unix_timestamp(expiry)
                        .is_err()
            }) {
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

fn read_firefox_cookie_store(
    path: &Path,
    domain: Option<&str>,
) -> Result<Vec<ImportedCookie>, CookieImportError> {
    let browser = BrowserCookieSourceId::Firefox;
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
            if expires_unix.is_some_and(|expiry| {
                expiry <= now
                    || tauri::webview::cookie::time::OffsetDateTime::from_unix_timestamp(expiry)
                        .is_err()
            }) {
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
    browser: BrowserCookieSourceId,
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
    browser: BrowserCookieSourceId,
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
            browser: BrowserCookieSourceId::Firefox,
        });
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct BrowserLayout {
    browser: BrowserCookieSourceId,
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
                browser: BrowserCookieSourceId::Chrome,
                root: "Library/Application Support/Google/Chrome",
                firefox: false,
            },
            BrowserLayout {
                browser: BrowserCookieSourceId::Brave,
                root: "Library/Application Support/BraveSoftware/Brave-Browser",
                firefox: false,
            },
            BrowserLayout {
                browser: BrowserCookieSourceId::Edge,
                root: "Library/Application Support/Microsoft Edge",
                firefox: false,
            },
            BrowserLayout {
                browser: BrowserCookieSourceId::Firefox,
                root: "Library/Application Support/Firefox/Profiles",
                firefox: true,
            },
        ],
        HostPlatform::Windows => [
            BrowserLayout {
                browser: BrowserCookieSourceId::Chrome,
                root: "AppData/Local/Google/Chrome/User Data",
                firefox: false,
            },
            BrowserLayout {
                browser: BrowserCookieSourceId::Brave,
                root: "AppData/Local/BraveSoftware/Brave-Browser/User Data",
                firefox: false,
            },
            BrowserLayout {
                browser: BrowserCookieSourceId::Edge,
                root: "AppData/Local/Microsoft/Edge/User Data",
                firefox: false,
            },
            BrowserLayout {
                browser: BrowserCookieSourceId::Firefox,
                root: "AppData/Roaming/Mozilla/Firefox/Profiles",
                firefox: true,
            },
        ],
        HostPlatform::Linux | HostPlatform::Other => [
            BrowserLayout {
                browser: BrowserCookieSourceId::Chrome,
                root: ".config/google-chrome",
                firefox: false,
            },
            BrowserLayout {
                browser: BrowserCookieSourceId::Brave,
                root: ".config/BraveSoftware/Brave-Browser",
                firefox: false,
            },
            BrowserLayout {
                browser: BrowserCookieSourceId::Edge,
                root: ".config/microsoft-edge",
                firefox: false,
            },
            BrowserLayout {
                browser: BrowserCookieSourceId::Firefox,
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
    browser: BrowserCookieSourceId,
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

fn profile_sort_key(profile: &str) -> (u8, String) {
    (
        if profile == "Default" { 0 } else { 1 },
        profile.to_lowercase(),
    )
}

impl HostPlatform {
    fn current() -> Self {
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

    fn name(self) -> &'static str {
        match self {
            Self::Macos => "macOS",
            Self::Windows => "Windows",
            Self::Linux => "Linux",
            Self::Other => "this platform",
        }
    }
}

fn open_cookie_store(
    path: &Path,
    browser: BrowserCookieSourceId,
) -> Result<Connection, CookieImportError> {
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

fn map_database_error(browser: BrowserCookieSourceId, error: rusqlite::Error) -> CookieImportError {
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
    browser: BrowserCookieSourceId,
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
mod tests {
    use std::{
        cell::Cell,
        fs,
        path::{Path, PathBuf},
    };

    use rusqlite::{params, Connection};
    use tempfile::TempDir;
    use zeroize::Zeroizing;

    use super::{
        decrypt_chromium_cookie_value, detect_browser_cookie_sources_at, domain_matches,
        ensure_cookie_limits, normalize_import_domain, read_chromium_cookie_store,
        read_firefox_cookie_store, resolve_cookie_store_at, runtime_cookie,
        validate_import_request, BrowserCookieImportSummary, BrowserCookieSourceId,
        CookieImportError, CookieSourceStatus, HostPlatform, SafeStoragePasswordProvider,
    };

    struct TestSafeStorage;

    impl SafeStoragePasswordProvider for TestSafeStorage {
        fn password(
            &self,
            _browser: BrowserCookieSourceId,
        ) -> Result<Zeroizing<Vec<u8>>, CookieImportError> {
            Ok(Zeroizing::new(b"test-safe-storage".to_vec()))
        }
    }

    struct CountingSafeStorage {
        calls: Cell<usize>,
    }

    impl SafeStoragePasswordProvider for CountingSafeStorage {
        fn password(
            &self,
            _browser: BrowserCookieSourceId,
        ) -> Result<Zeroizing<Vec<u8>>, CookieImportError> {
            self.calls.set(self.calls.get() + 1);
            Ok(Zeroizing::new(b"test-safe-storage".to_vec()))
        }
    }

    struct MigratingSafeStorage {
        store: PathBuf,
    }

    impl SafeStoragePasswordProvider for MigratingSafeStorage {
        fn password(
            &self,
            _browser: BrowserCookieSourceId,
        ) -> Result<Zeroizing<Vec<u8>>, CookieImportError> {
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
            .chunks_exact(2)
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

    fn create_firefox_store(path: &Path) {
        fs::create_dir_all(path.parent().expect("fixture parent")).expect("fixture directory");
        let connection = Connection::open(path).expect("firefox fixture");
        connection
            .execute_batch(
                "PRAGMA user_version = 17;\
                 CREATE TABLE moz_cookies(\
                   id INTEGER PRIMARY KEY,\
                   originAttributes TEXT NOT NULL DEFAULT '',\
                   name TEXT,\
                   value TEXT,\
                   host TEXT,\
                   path TEXT,\
                   expiry INTEGER,\
                   lastAccessed INTEGER,\
                   creationTime INTEGER,\
                   isSecure INTEGER,\
                   isHttpOnly INTEGER,\
                   inBrowserElement INTEGER DEFAULT 0,\
                   sameSite INTEGER DEFAULT 0,\
                   schemeMap INTEGER DEFAULT 0,\
                   isPartitionedAttributeSet INTEGER DEFAULT 0,\
                   updateTime INTEGER DEFAULT 0\
                 );\
                 INSERT INTO moz_cookies(originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly, sameSite)\
                 VALUES ('', 'firefox-session', 'firefox-secret', '.example.org', '/', 4102444800000, 0, 0, 1, 1, 2);\
                 INSERT INTO moz_cookies(originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly, sameSite)\
                 VALUES ('^userContextId=2', 'container', 'do-not-import', '.example.org', '/', 4102444800000, 0, 0, 1, 1, 2);\
                 INSERT INTO moz_cookies(originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly, sameSite, isPartitionedAttributeSet)\
                 VALUES ('', 'partitioned', 'do-not-import', '.example.org', '/', 4102444800000, 0, 0, 1, 1, 2, 1);\
                 INSERT INTO moz_cookies(originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly, sameSite)\
                 VALUES ('', 'expired', 'do-not-import', '.example.org', '/', 946684800000, 0, 0, 1, 1, 2);\
                 INSERT INTO moz_cookies(originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly, sameSite)\
                 VALUES ('', 'invalid-expiry', 'do-not-import', '.example.org', '/', 9223372036854775807, 0, 0, 1, 1, 2);",
            )
            .expect("firefox schema");
        connection
            .execute(
                "INSERT INTO moz_cookies(originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly, sameSite)\
                 VALUES ('', 'host-only-parent', 'do-not-import', 'example.org', '/', 4102444800000, 0, 0, 1, 1, 2)",
                [],
            )
            .expect("Firefox host-only parent cookie");
    }

    #[test]
    fn detects_only_profiles_with_cookie_stores_and_marks_safari_coming_soon() {
        let fixture = TempDir::new().expect("home fixture");
        let home = fixture.path();
        create_file(
            &home.join("Library/Application Support/Google/Chrome/Default/Network/Cookies"),
        );
        create_file(&home.join(
            "Library/Application Support/BraveSoftware/Brave-Browser/Profile 2/Network/Cookies",
        ));
        create_file(
            &home.join("Library/Application Support/Firefox/Profiles/abc.default/cookies.sqlite"),
        );
        fs::create_dir_all(home.join("Library/Application Support/Google/Chrome/Profile 3"))
            .expect("empty Chromium profile");
        fs::create_dir_all(home.join("Library/Application Support/Firefox/Profiles/empty.default"))
            .expect("empty Firefox profile");
        create_file(&home.join("Library/Cookies/Cookies.binarycookies"));

        let detected = detect_browser_cookie_sources_at(home, HostPlatform::Macos);

        assert!(detected.iter().any(|source| {
            source.browser == BrowserCookieSourceId::Chrome
                && source.profile.as_deref() == Some("Default")
                && source.status == CookieSourceStatus::Available
        }));
        for (browser, profile) in [
            (BrowserCookieSourceId::Chrome, "Profile 3"),
            (BrowserCookieSourceId::Firefox, "empty.default"),
        ] {
            let source = detected
                .iter()
                .find(|source| {
                    source.browser == browser && source.profile.as_deref() == Some(profile)
                })
                .expect("profile without a cookie store");
            assert_eq!(
                serde_json::to_value(source).expect("detected source JSON")["status"],
                "no_cookie_store"
            );
        }
        assert!(detected.iter().any(|source| {
            source.browser == BrowserCookieSourceId::Brave
                && source.profile.as_deref() == Some("Profile 2")
                && source.status == CookieSourceStatus::Available
        }));
        assert!(detected.iter().any(|source| {
            source.browser == BrowserCookieSourceId::Firefox
                && source.profile.as_deref() == Some("abc.default")
                && source.status == CookieSourceStatus::Available
        }));
        assert!(detected.iter().any(|source| {
            source.browser == BrowserCookieSourceId::Safari
                && source.status == CookieSourceStatus::ComingSoon
        }));
        assert!(detected.iter().any(|source| {
            source.browser == BrowserCookieSourceId::Edge
                && source.status == CookieSourceStatus::NotInstalled
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

        let windows = detect_browser_cookie_sources_at(fixture.path(), HostPlatform::Windows);
        let linux = detect_browser_cookie_sources_at(fixture.path(), HostPlatform::Linux);

        assert!(windows.iter().any(|source| {
            source.browser == BrowserCookieSourceId::Chrome
                && source.status == CookieSourceStatus::ComingSoon
                && source.detail.contains("Windows")
        }));
        assert!(windows.iter().any(|source| {
            source.browser == BrowserCookieSourceId::Chrome
                && source.profile.as_deref() == Some("Profile 2")
                && source.status == CookieSourceStatus::ComingSoon
        }));
        assert!(linux.iter().any(|source| {
            source.browser == BrowserCookieSourceId::Firefox
                && source.status == CookieSourceStatus::ComingSoon
                && source.detail.contains("Linux")
        }));
        assert!(linux.iter().any(|source| {
            source.browser == BrowserCookieSourceId::Firefox
                && source.profile.as_deref() == Some("empty.default")
                && source.status == CookieSourceStatus::ComingSoon
        }));
    }

    #[test]
    fn decrypts_current_chromium_cookie_values_and_verifies_the_host_binding() {
        let encrypted = decode_hex(
            "763130df4793e60a52efcfa849970ae2dc1ee4fc4b644d44af13b5149293b13012784a5cf5299258178d8597c0042b2d90c583",
        );

        let value =
            decrypt_chromium_cookie_value(&encrypted, b"test-safe-storage", ".example.com", 24)
                .expect("decrypted cookie");

        assert_eq!(value, "session-secret");
        assert!(decrypt_chromium_cookie_value(
            &encrypted,
            b"test-safe-storage",
            ".wrong.example",
            24,
        )
        .is_err());
    }

    #[test]
    fn parses_unpartitioned_chromium_cookies_for_the_selected_domain() {
        let fixture = TempDir::new().expect("fixture");
        let store = fixture.path().join("Cookies");
        create_chromium_store(&store);

        let cookies = read_chromium_cookie_store(
            &store,
            BrowserCookieSourceId::Chrome,
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
        assert_eq!(cookies[0].same_site, Some(super::ImportedSameSite::Strict));
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
            BrowserCookieSourceId::Chrome,
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
            BrowserCookieSourceId::Chrome,
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
            read_chromium_cookie_store(&store, BrowserCookieSourceId::Chrome, None, &safe_storage,),
            Err(CookieImportError::UnsupportedStoreVersion {
                browser: BrowserCookieSourceId::Chrome,
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
            read_chromium_cookie_store(
                &store,
                BrowserCookieSourceId::Chrome,
                None,
                &TestSafeStorage
            ),
            Err(CookieImportError::UnsupportedStoreVersion {
                browser: BrowserCookieSourceId::Chrome,
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
            read_chromium_cookie_store(&store, BrowserCookieSourceId::Chrome, None, &safe_storage,),
            Err(CookieImportError::UnsupportedStoreVersion {
                browser: BrowserCookieSourceId::Chrome,
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
            BrowserCookieSourceId::Chrome,
            Some("docs.example.com"),
            &TestSafeStorage,
        )
        .expect("chromium cookies");
        let first_plain = cookies
            .iter()
            .find(|cookie| cookie.name == "plain")
            .expect("plain cookie");

        assert_eq!(first_plain.value, "newest-value");
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
        assert_eq!(cookies[0].same_site, Some(super::ImportedSameSite::Strict));
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

        let cookies = read_firefox_cookie_store(&store, Some("login.example.org"))
            .expect("Firefox v16 cookies");

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
                browser: BrowserCookieSourceId::Firefox,
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
                browser: BrowserCookieSourceId::Firefox,
            })
        );
    }

    #[test]
    fn caps_selected_cookie_rows_at_ten_thousand() {
        let connection = Connection::open_in_memory().expect("limit fixture");

        assert_eq!(
            ensure_cookie_limits(
                &connection,
                BrowserCookieSourceId::Firefox,
                "SELECT 10001 WHERE :domain IS NULL",
                "SELECT 0 WHERE :domain IS NULL",
                None,
            ),
            Err(CookieImportError::StoreTooLarge {
                browser: BrowserCookieSourceId::Firefox,
            })
        );
    }

    #[test]
    fn reports_missing_and_locked_cookie_stores_without_paths_or_secrets() {
        let fixture = TempDir::new().expect("fixture");
        let missing = fixture.path().join("missing.sqlite");

        let missing_error =
            read_firefox_cookie_store(&missing, None).expect_err("missing store error");
        assert_eq!(
            missing_error,
            CookieImportError::MissingStore {
                browser: BrowserCookieSourceId::Firefox,
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

        let locked_error =
            read_firefox_cookie_store(&locked, None).expect_err("locked store error");
        assert_eq!(
            locked_error,
            CookieImportError::LockedStore {
                browser: BrowserCookieSourceId::Firefox,
            }
        );
        assert_eq!(
            locked_error.to_string(),
            "Firefox's cookie store is locked. Close Firefox completely, then try again."
        );
        assert!(!locked_error.to_string().contains("firefox-secret"));
    }

    #[test]
    fn requires_confirmation_from_the_main_webview() {
        assert_eq!(
            validate_import_request("main", false, "Default", None),
            Err(CookieImportError::ConfirmationRequired)
        );
        assert_eq!(
            validate_import_request("oleafly-browser-pane-1", true, "Default", None),
            Err(CookieImportError::UnauthorizedCaller)
        );
    }

    #[test]
    fn native_confirmation_cancellation_is_safe() {
        let error = super::require_native_confirmation(false)
            .expect_err("native confirmation cancellation");

        assert_eq!(
            error.to_string(),
            "Cookie import was cancelled. No cookies were imported."
        );
        assert!(super::require_native_confirmation(true).is_ok());
    }

    #[test]
    fn rejects_unsupported_sources_before_native_confirmation() {
        assert_eq!(
            super::validate_supported_import(HostPlatform::Windows, BrowserCookieSourceId::Chrome),
            Err(CookieImportError::UnsupportedPlatform)
        );
        assert_eq!(
            super::validate_supported_import(HostPlatform::Macos, BrowserCookieSourceId::Safari),
            Err(CookieImportError::UnsupportedBrowser {
                browser: BrowserCookieSourceId::Safari,
            })
        );
    }

    #[test]
    fn accepts_only_single_profile_components_and_hostname_domain_filters() {
        assert_eq!(
            validate_import_request("main", true, "../Default", None),
            Err(CookieImportError::InvalidProfile)
        );
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
    fn rejects_unknown_cookie_import_request_fields() {
        let request = serde_json::from_str::<super::BrowserCookieImportRequest>(
            r#"{"browser":"chrome","profile":"Default","domain":null,"confirmed":true,"background":true}"#,
        );

        assert!(request.is_err());
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
            BrowserCookieSourceId::Firefox,
            "abc.default",
        )
        .expect("resolved store");

        assert_eq!(resolved, store.canonicalize().expect("canonical store"));
        assert_eq!(
            resolve_cookie_store_at(
                fixture.path(),
                HostPlatform::Macos,
                BrowserCookieSourceId::Firefox,
                "../abc.default",
            ),
            Err(CookieImportError::InvalidProfile)
        );
        assert_eq!(
            resolve_cookie_store_at(
                fixture.path(),
                HostPlatform::Windows,
                BrowserCookieSourceId::Firefox,
                "abc.default",
            ),
            Err(CookieImportError::UnsupportedPlatform)
        );
        assert_eq!(
            resolve_cookie_store_at(
                fixture.path(),
                HostPlatform::Macos,
                BrowserCookieSourceId::Safari,
                "Default",
            ),
            Err(CookieImportError::UnsupportedBrowser {
                browser: BrowserCookieSourceId::Safari,
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
                BrowserCookieSourceId::Firefox,
                "abc.default",
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
                BrowserCookieSourceId::Chrome,
                "Default",
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

        let detected = detect_browser_cookie_sources_at(fixture.path(), HostPlatform::Macos);

        assert!(detected.iter().any(|source| {
            source.browser == BrowserCookieSourceId::Chrome
                && source.profile.is_none()
                && source.status == CookieSourceStatus::NotInstalled
        }));
        assert!(!detected.iter().any(|source| {
            source.browser == BrowserCookieSourceId::Chrome
                && source.profile.as_deref() == Some("Default")
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

        let detected = detect_browser_cookie_sources_at(fixture.path(), HostPlatform::Macos);

        assert!(!detected.iter().any(|source| {
            source.browser == BrowserCookieSourceId::Chrome
                && source.profile.as_deref() == Some("Default")
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
                BrowserCookieSourceId::Chrome,
                "Default",
            ),
            Err(CookieImportError::UnsafeStore)
        );
    }

    #[test]
    fn preserves_domain_cookie_scope_at_the_wry_boundary() {
        let imported = super::ImportedCookie {
            name: "session".to_string(),
            value: "secret".to_string(),
            domain: ".example.com".to_string(),
            path: "/".to_string(),
            expires_unix: None,
            secure: true,
            http_only: true,
            same_site: Some(super::ImportedSameSite::Lax),
        };

        let cookie = runtime_cookie(&imported).expect("runtime cookie");

        assert_eq!(cookie.domain(), Some(".example.com"));
        assert_eq!(cookie.path(), Some("/"));
        assert_eq!(cookie.secure(), Some(true));
        assert_eq!(cookie.http_only(), Some(true));
        assert_eq!(
            cookie.same_site(),
            Some(tauri::webview::cookie::SameSite::Lax)
        );
    }

    #[test]
    fn verification_fingerprint_covers_every_reported_cookie_attribute() {
        let expected = super::ImportedCookie {
            name: "session".to_string(),
            value: "secret".to_string(),
            domain: ".example.com".to_string(),
            path: "/account".to_string(),
            expires_unix: Some(4_102_444_800),
            secure: true,
            http_only: true,
            same_site: Some(super::ImportedSameSite::Lax),
        };
        let expected_fingerprint = super::imported_cookie_fingerprint(&expected);
        let matching = runtime_cookie(&expected).expect("matching runtime cookie");

        assert_eq!(
            super::stored_cookie_fingerprint(&matching),
            Some(expected_fingerprint)
        );

        for changed in [
            super::ImportedCookie {
                secure: false,
                ..expected.clone()
            },
            super::ImportedCookie {
                http_only: false,
                ..expected.clone()
            },
            super::ImportedCookie {
                expires_unix: Some(4_102_444_801),
                ..expected.clone()
            },
            super::ImportedCookie {
                same_site: Some(super::ImportedSameSite::Strict),
                ..expected.clone()
            },
        ] {
            let actual = runtime_cookie(&changed).expect("changed runtime cookie");
            assert_ne!(
                super::stored_cookie_fingerprint(&actual),
                Some(super::imported_cookie_fingerprint(&expected))
            );
        }
    }

    #[test]
    fn import_summary_serialization_contains_no_cookie_or_path_data() {
        let summary = BrowserCookieImportSummary {
            imported: 2,
            browser_name: "Chrome".to_string(),
            profile_name: "Default".to_string(),
            domain: Some("example.com".to_string()),
        };

        let serialized = serde_json::to_string(&summary).expect("serialized summary");

        assert_eq!(
            serialized,
            r#"{"imported":2,"browserName":"Chrome","profileName":"Default","domain":"example.com"}"#
        );
        assert!(!serialized.contains("session-secret"));
        assert!(!serialized.contains("Library/Application Support"));
    }

    #[test]
    fn cookie_apply_error_discloses_possible_partial_application() {
        assert_eq!(
            CookieImportError::CookieApplyFailed.to_string(),
            "Oleafly could not finish adding cookies to the browser session. Some cookies may already have been imported. You can safely try again."
        );
    }
}
