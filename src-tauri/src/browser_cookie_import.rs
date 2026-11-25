use std::collections::HashMap;
use std::time::Duration;

use oleafly_online::browser_cookies::{
    self as reader, CookieImportError, DetectedCookieSource, HostPlatform, ImportPolicy,
    ImportedCookie, ImportedSameSite, MacSafeStorage,
};
use serde::{Deserialize, Serialize};
use tauri::{Manager, Runtime, Webview};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

pub use oleafly_online::browser_cookies::BrowserId as BrowserCookieSourceId;

const MAIN_WEBVIEW_LABEL: &str = "main";
const STORED_WITHIN: Duration = Duration::from_secs(3);
const STORED_POLL: Duration = Duration::from_millis(100);
const NO_PROFILES: &str = "Oleafly could not locate your browser profiles.";

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

#[tauri::command]
pub async fn detect_browser_cookie_sources<R: Runtime>(
    webview: Webview<R>,
) -> Result<Vec<DetectedCookieSource>, String> {
    validate_command_caller(webview.label()).map_err(|error| error.to_string())?;
    let home = browser_home()?;
    tauri::async_runtime::spawn_blocking(move || {
        reader::detect_sources_at(&home, HostPlatform::current(), ImportPolicy::App)
    })
    .await
    .map_err(|_| NO_PROFILES.to_string())
}

fn browser_home() -> Result<std::path::PathBuf, String> {
    crate::paths::home_dir().map_err(|_| NO_PROFILES.to_string())
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
    let domain = reader::normalize_import_domain(request.domain.as_deref())
        .map_err(|error| error.to_string())?;
    let browser = request.browser;
    let profile = request.profile;
    let home = browser_home()?;
    let (names, named) = (home.clone(), profile.clone());
    let profile_name = tauri::async_runtime::spawn_blocking(move || {
        reader::profile_name_at(&names, platform, browser, &named)
    })
    .await
    .map_err(|_| NO_PROFILES.to_string())?;
    confirm_native_cookie_import(
        webview.app_handle().clone(),
        browser,
        &profile_name,
        domain.as_deref(),
    )
    .await
    .map_err(|error| error.to_string())?;
    let read_profile = profile;
    let read_domain = domain.clone();
    let cookies = tauri::async_runtime::spawn_blocking(move || {
        reader::read_cookies(
            &home,
            platform,
            browser,
            &read_profile,
            read_domain.as_deref(),
            ImportPolicy::App,
            &MacSafeStorage,
        )
    })
    .await
    .map_err(|_| "Oleafly could not finish reading the cookie store.".to_string())?
    .map_err(|error| error.to_string())?;

    let cookies = reader::unique_cookies(cookies);
    let runtime_cookies = cookies
        .iter()
        .map(runtime_cookie)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    for cookie in runtime_cookies {
        let name = cookie.name().to_string();
        if webview.set_cookie(cookie).is_err() {
            let _ = crate::project::append_app_log(format!(
                "Copying cookies: the webview refused the cookie {name}."
            ));
        }
    }
    let check = until_stored(STORED_WITHIN, || {
        Ok(check_stored(&cookies, &stored_cookies(&webview)?))
    })
    .await
    .map_err(|error| error.to_string())?;
    let site = domain.as_deref().unwrap_or("every site");
    if let Some(report) = check.report(cookies.len()) {
        let _ = crate::project::append_app_log(format!(
            "Copying cookies for {site} from {} {profile_name}: {report}",
            browser.name()
        ));
    }
    if check.stored == 0 {
        return Err(CookieImportError::CookieApplyFailed.to_string());
    }

    Ok(BrowserCookieImportSummary {
        imported: check.stored,
        browser_name: browser.name().to_string(),
        profile_name,
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
    reader::validate_profile(profile)?;
    if reader::normalize_import_domain(domain)?.is_none() {
        return Err(CookieImportError::InvalidDomain);
    }
    Ok(())
}

fn validate_supported_import(
    platform: HostPlatform,
    browser: BrowserCookieSourceId,
) -> Result<(), CookieImportError> {
    ImportPolicy::App.check(platform, browser)
}

fn cookie_import_prompt(
    browser: BrowserCookieSourceId,
    profile: &str,
    domain: Option<&str>,
) -> String {
    let browser_name = browser.name();
    match domain {
        Some(hostname) => crate::i18n::t_with(
            "dialog.cookieImport.copyHost",
            &[
                ("hostname", hostname),
                ("browser", browser_name),
                ("profile", profile),
            ],
        ),
        None => crate::i18n::t_with(
            "dialog.cookieImport.copyAll",
            &[("browser", browser_name), ("profile", profile)],
        ),
    }
}

async fn confirm_native_cookie_import<R: Runtime>(
    app: tauri::AppHandle<R>,
    browser: BrowserCookieSourceId,
    profile: &str,
    domain: Option<&str>,
) -> Result<(), CookieImportError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(cookie_import_prompt(browser, profile, domain))
        .title(crate::i18n::t("dialog.cookieImport.title"))
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            crate::i18n::t("dialog.cookieImport.copyConfirm"),
            crate::i18n::t("dialog.cancel"),
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

#[derive(Debug, Eq, Hash, PartialEq)]
struct CookieKey {
    name: String,
    domain: String,
    path: String,
}

fn key_of(cookie: &RuntimeCookieFingerprint) -> CookieKey {
    CookieKey {
        name: cookie.name.clone(),
        domain: cookie.domain.clone(),
        path: cookie.path.clone(),
    }
}

fn stored_cookies<R: Runtime>(
    webview: &Webview<R>,
) -> Result<HashMap<CookieKey, RuntimeCookieFingerprint>, CookieImportError> {
    let stored = webview
        .cookies()
        .map_err(|_| CookieImportError::CookieApplyFailed)?;
    Ok(stored
        .iter()
        .filter_map(stored_cookie_fingerprint)
        .map(|cookie| (key_of(&cookie), cookie))
        .collect())
}

#[derive(Debug, Default, Eq, PartialEq)]
struct StoreCheck {
    stored: usize,
    missing: Vec<String>,
    changed: Vec<String>,
}

impl StoreCheck {
    fn report(&self, copied: usize) -> Option<String> {
        if self.missing.is_empty() && self.changed.is_empty() {
            return None;
        }
        let mut report = format!("{} of {copied} stored.", self.stored);
        if !self.missing.is_empty() {
            report.push_str(&format!(" Not stored: {}.", self.missing.join(", ")));
        }
        if !self.changed.is_empty() {
            report.push_str(&format!(
                " Stored with other attributes: {}.",
                self.changed.join(", ")
            ));
        }
        Some(report)
    }
}

fn cookie_label(cookie: &RuntimeCookieFingerprint) -> String {
    format!("{} ({}{})", cookie.name, cookie.domain, cookie.path)
}

fn differences(
    expected: &RuntimeCookieFingerprint,
    actual: &RuntimeCookieFingerprint,
) -> Vec<String> {
    let mut changed = Vec::new();
    if expected.expires_unix != actual.expires_unix {
        changed.push(format!(
            "expiry {:?} became {:?}",
            expected.expires_unix, actual.expires_unix
        ));
    }
    if expected.secure != actual.secure {
        changed.push(format!(
            "secure {} became {}",
            expected.secure, actual.secure
        ));
    }
    if expected.http_only != actual.http_only {
        changed.push(format!(
            "httpOnly {} became {}",
            expected.http_only, actual.http_only
        ));
    }
    if expected.same_site != actual.same_site {
        changed.push(format!(
            "sameSite {:?} became {:?}",
            expected.same_site, actual.same_site
        ));
    }
    changed
}

fn check_stored(
    imported: &[ImportedCookie],
    stored: &HashMap<CookieKey, RuntimeCookieFingerprint>,
) -> StoreCheck {
    let mut check = StoreCheck::default();
    for cookie in imported {
        let expected = imported_cookie_fingerprint(cookie);
        match stored.get(&key_of(&expected)) {
            Some(actual) if actual.value == expected.value => {
                check.stored += 1;
                let changed = differences(&expected, actual);
                if !changed.is_empty() {
                    check.changed.push(format!(
                        "{} {}",
                        cookie_label(&expected),
                        changed.join(", ")
                    ));
                }
            }
            Some(_) => check
                .missing
                .push(format!("{} with another value", cookie_label(&expected))),
            None => check.missing.push(cookie_label(&expected)),
        }
    }
    check
}

async fn until_stored(
    within: Duration,
    mut check: impl FnMut() -> Result<StoreCheck, CookieImportError>,
) -> Result<StoreCheck, CookieImportError> {
    let deadline = tokio::time::Instant::now() + within;
    loop {
        let latest = check()?;
        if latest.missing.is_empty() || tokio::time::Instant::now() >= deadline {
            return Ok(latest);
        }
        tokio::time::sleep(STORED_POLL).await;
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{
        cookie_import_prompt, runtime_cookie, until_stored, validate_import_request,
        BrowserCookieImportSummary, BrowserCookieSourceId, CookieImportError, HostPlatform,
        STORED_POLL,
    };

    #[test]
    fn accepts_only_single_profile_components() {
        assert_eq!(
            validate_import_request("main", true, "../Default", None),
            Err(CookieImportError::InvalidProfile)
        );
        assert_eq!(
            validate_import_request("main", true, "Default", Some("example.com:443")),
            Err(CookieImportError::InvalidDomain)
        );
        assert!(validate_import_request("main", true, "Profile 2", Some("example.com")).is_ok());
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
    fn rejects_unknown_cookie_import_request_fields() {
        let request = serde_json::from_str::<super::BrowserCookieImportRequest>(
            r#"{"browser":"chrome","profile":"Default","domain":null,"confirmed":true,"background":true}"#,
        );

        assert!(request.is_err());
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

    #[test]
    fn the_confirmation_prompt_names_the_browser_profile_and_scope() {
        let scoped = cookie_import_prompt(
            BrowserCookieSourceId::Chrome,
            "Profile 1",
            Some("www.latex.example"),
        );
        assert_eq!(
            scoped,
            crate::i18n::t_with(
                "dialog.cookieImport.copyHost",
                &[
                    ("hostname", "www.latex.example"),
                    ("browser", "Google Chrome"),
                    ("profile", "Profile 1"),
                ],
            )
        );
        assert!(scoped.contains("www.latex.example"), "{scoped}");
        assert!(scoped.contains("Google Chrome"), "{scoped}");
        assert!(scoped.contains("Profile 1"), "{scoped}");
        assert!(!scoped.contains("{{"), "{scoped}");

        let everything = cookie_import_prompt(BrowserCookieSourceId::Firefox, "default", None);
        assert_eq!(
            everything,
            crate::i18n::t_with(
                "dialog.cookieImport.copyAll",
                &[("browser", "Firefox"), ("profile", "default")],
            )
        );
        assert!(!everything.contains("www.latex.example"), "{everything}");
        assert!(everything.contains("Firefox"), "{everything}");
        assert!(!everything.contains("{{"), "{everything}");
        assert_ne!(scoped, everything);
    }

    #[test]
    fn cookie_copy_prompt_names_the_site_and_never_the_in_app_browser() {
        let prompt = cookie_import_prompt(
            BrowserCookieSourceId::Chrome,
            "Default",
            Some("www.latex.example"),
        );
        assert!(prompt.contains("www.latex.example"), "{prompt}");
        assert!(
            !prompt.to_lowercase().contains("in-app browser"),
            "{prompt}"
        );
        let everything = cookie_import_prompt(BrowserCookieSourceId::Chrome, "Default", None);
        assert!(
            !everything.to_lowercase().contains("in-app browser"),
            "{everything}"
        );
    }

    #[test]
    fn a_copy_always_names_the_site_it_signs_in_to() {
        for domain in [None, Some(""), Some("  ")] {
            assert_eq!(
                validate_import_request("main", true, "Default", domain),
                Err(CookieImportError::InvalidDomain),
                "{domain:?}"
            );
        }
    }

    fn imported(name: &str, value: &str, expires_unix: Option<i64>) -> super::ImportedCookie {
        super::ImportedCookie {
            name: name.to_string(),
            value: value.to_string(),
            domain: ".latex.example".to_string(),
            path: "/".to_string(),
            expires_unix,
            secure: true,
            http_only: true,
            same_site: Some(super::ImportedSameSite::Lax),
        }
    }

    fn stored(
        cookies: &[super::ImportedCookie],
    ) -> HashMap<super::CookieKey, super::RuntimeCookieFingerprint> {
        cookies
            .iter()
            .map(|cookie| {
                let print =
                    super::stored_cookie_fingerprint(&runtime_cookie(cookie).unwrap()).unwrap();
                (super::key_of(&print), print)
            })
            .collect()
    }

    #[test]
    fn a_cookie_counts_as_copied_when_its_value_is_stored_and_other_fields_are_only_reported() {
        let session = imported("site_session", "SECRETVALUE", Some(4_102_444_800));
        let later = imported("site_session", "SECRETVALUE", Some(1_900_000_000));
        let other = imported("site_session", "OTHERVALUE", None);
        let gone = imported("tracker", "SECRETVALUE", None);

        let check = super::check_stored(std::slice::from_ref(&session), &stored(&[later]));
        assert_eq!(check.stored, 1);
        assert!(check.missing.is_empty());
        assert_eq!(
            check.changed,
            vec!["site_session (latex.example/) expiry Some(4102444800) became Some(1900000000)"]
        );

        let check = super::check_stored(&[session.clone(), gone], &stored(&[other]));
        assert_eq!(check.stored, 0);
        assert_eq!(
            check.missing,
            vec![
                "site_session (latex.example/) with another value",
                "tracker (latex.example/)"
            ]
        );
        let report = check.report(2).unwrap();
        assert_eq!(
            report,
            "0 of 2 stored. Not stored: site_session (latex.example/) with another value, tracker (latex.example/)."
        );
        assert!(!report.contains("SECRETVALUE") && !report.contains("OTHERVALUE"));
        assert_eq!(
            super::check_stored(
                std::slice::from_ref(&session),
                &stored(std::slice::from_ref(&session))
            )
            .report(1),
            None
        );
    }

    #[tokio::test]
    async fn a_copy_waits_for_the_webview_to_store_its_cookies_then_settles_for_what_it_has() {
        let within = STORED_POLL * 10;
        let pending = || super::StoreCheck {
            stored: 1,
            missing: vec!["late (latex.example/)".to_string()],
            changed: Vec::new(),
        };
        let mut looks = 0;
        let settled = until_stored(within, || {
            looks += 1;
            Ok(if looks > 2 {
                super::StoreCheck {
                    stored: 2,
                    ..Default::default()
                }
            } else {
                pending()
            })
        })
        .await;
        assert_eq!(settled.map(|check| check.stored), Ok(2));
        assert_eq!(looks, 3);
        let started = std::time::Instant::now();
        assert_eq!(
            until_stored(STORED_POLL * 2, || Ok(pending())).await,
            Ok(pending())
        );
        assert!(started.elapsed() >= STORED_POLL * 2);
        assert_eq!(
            until_stored(within, || Err(CookieImportError::CookieApplyFailed)).await,
            Err(CookieImportError::CookieApplyFailed)
        );
    }

    #[test]
    fn the_main_window_may_still_copy_cookies() {
        assert!(
            validate_import_request("main", true, "Default", Some("www.latex.example")).is_ok()
        );
    }
}
