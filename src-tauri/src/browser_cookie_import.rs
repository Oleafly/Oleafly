use std::collections::HashSet;

use oleafly_online::browser_cookies::{
    self as reader, CookieImportError, DetectedCookieSource, HostPlatform, ImportPolicy,
    ImportedCookie, ImportedSameSite, MacSafeStorage,
};
use serde::{Deserialize, Serialize};
use tauri::{Manager, Runtime, Webview};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

pub use oleafly_online::browser_cookies::BrowserId as BrowserCookieSourceId;

const MAIN_WEBVIEW_LABEL: &str = "main";

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
pub fn detect_browser_cookie_sources<R: Runtime>(
    webview: Webview<R>,
) -> Result<Vec<DetectedCookieSource>, String> {
    validate_command_caller(webview.label()).map_err(|error| error.to_string())?;
    let home = crate::paths::home_dir()
        .map_err(|_| "Oleafly could not locate your browser profiles.".to_string())?;
    Ok(reader::detect_sources_at(
        &home,
        HostPlatform::current(),
        ImportPolicy::App,
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
    let domain = reader::normalize_import_domain(request.domain.as_deref())
        .map_err(|error| error.to_string())?;
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

#[cfg(test)]
mod tests {
    use super::{
        cookie_import_prompt, runtime_cookie, validate_import_request, BrowserCookieImportSummary,
        BrowserCookieSourceId, CookieImportError, HostPlatform,
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

    #[test]
    fn the_main_window_may_still_copy_cookies() {
        assert!(
            validate_import_request("main", true, "Default", Some("www.latex.example")).is_ok()
        );
    }
}
