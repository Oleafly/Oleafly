//! Desktop apps settings: which apps and websites agents may use. They are
//! device-local (paths and bundle ids mean nothing on another computer), so
//! they live in the app config, never in the settings file or cloud sync.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::apps::{blocked_reason, file_name_lower};
use super::Platform;
use crate::app_error::AppError;

pub(crate) const MAX_APPS: usize = 32;
pub(crate) const MAX_SITES: usize = 32;
const MAX_NAME_CHARS: usize = 120;
const MAX_BUNDLE_ID_BYTES: usize = 255;
const MAX_PATH_BYTES: usize = 4096;
const MAX_ORIGIN_BYTES: usize = 2048;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CuaDriverConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub apps: Vec<AllowedApp>,
    #[serde(default)]
    pub sites: Vec<AllowedSite>,
    /// Lets agents run Cua scripts (`run_script`); each script still asks.
    #[serde(default)]
    pub scripted_control: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AllowedApp {
    pub name: String,
    /// macOS: the app's bundle identifier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    /// Windows and Linux: the absolute, canonical program path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AllowedSite {
    /// `https://host[:port]`, or `http://` for this computer.
    pub origin: String,
    /// Use the user's own signed-in browser profile on this site.
    #[serde(default)]
    pub signed_in: bool,
}

/// Why a program path can't be an allowed app.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AppRejection {
    NotFound,
    NotAProgram,
}

/// Turns a program path into its canonical, plain (never `\\?\`) form.
pub(crate) trait ExecutableProbe: Send + Sync {
    fn check(&self, path: &str) -> Result<String, AppRejection>;
}

/// The real file system.
pub(crate) struct SystemProbe;

impl ExecutableProbe for SystemProbe {
    fn check(&self, path: &str) -> Result<String, AppRejection> {
        let located = crate::program_locator::locate_path(Path::new(path)).map_err(|reason| {
            if reason == crate::program_locator::RejectReason::NotFound {
                AppRejection::NotFound
            } else {
                AppRejection::NotAProgram
            }
        })?;
        let canonical = std::fs::canonicalize(&located.path).map_err(|_| AppRejection::NotFound)?;
        Ok(oleafly_core::plain_path(&canonical)
            .to_string_lossy()
            .into_owned())
    }
}

/// Settings are usable: on, with something agents may use.
pub(crate) fn ready(config: &CuaDriverConfig) -> bool {
    config.enabled && (!config.apps.is_empty() || !config.sites.is_empty())
}

fn app_invalid(name: &str) -> String {
    AppError::new("desktop_apps.app_invalid")
        .param("name", name)
        .into()
}

fn app_blocked(name: &str) -> String {
    AppError::new("desktop_apps.app_blocked")
        .param("name", name)
        .into()
}

fn site_invalid(site: &str) -> String {
    let shown: String = site.chars().take(200).collect();
    AppError::new("desktop_apps.site_invalid")
        .param("site", shown)
        .into()
}

fn valid_bundle_id(value: &str) -> bool {
    value.len() <= MAX_BUNDLE_ID_BYTES
        && value.contains('.')
        && value.split('.').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
}

fn clean_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
        return Err(app_invalid(
            &trimmed
                .chars()
                .filter(|c| !c.is_control())
                .collect::<String>(),
        ));
    }
    Ok(trimmed.chars().take(MAX_NAME_CHARS).collect())
}

fn windows_program(path: &str) -> bool {
    let name = file_name_lower(path);
    name.ends_with(".exe") || name.ends_with(".com")
}

/// Checks and normalizes settings before they are saved.
pub(crate) fn validate(
    config: CuaDriverConfig,
    platform: Platform,
    probe: &dyn ExecutableProbe,
    own_exe: &str,
) -> Result<CuaDriverConfig, String> {
    let mut apps: Vec<AllowedApp> = Vec::new();
    for app in config.apps {
        let name = clean_name(&app.name)?;
        let checked = match platform {
            Platform::Macos => {
                if app.executable.is_some() {
                    return Err(app_invalid(&name));
                }
                let bundle_id = app.bundle_id.as_deref().map(str::trim).unwrap_or_default();
                if !valid_bundle_id(bundle_id) {
                    return Err(app_invalid(&name));
                }
                if blocked_reason(platform, Some(bundle_id), None, own_exe).is_some() {
                    return Err(app_blocked(&name));
                }
                AllowedApp {
                    name,
                    bundle_id: Some(bundle_id.to_string()),
                    executable: None,
                }
            }
            Platform::Windows | Platform::Linux => {
                if app.bundle_id.is_some() {
                    return Err(app_invalid(&name));
                }
                let raw = app.executable.as_deref().map(str::trim).unwrap_or_default();
                if raw.is_empty() || raw.len() > MAX_PATH_BYTES || raw.chars().any(char::is_control)
                {
                    return Err(app_invalid(&name));
                }
                let executable = probe.check(raw).map_err(|_| app_invalid(&name))?;
                // Scripts (.cmd, .bat, .ps1) are not programs to start.
                if platform == Platform::Windows && !windows_program(&executable) {
                    return Err(app_invalid(&name));
                }
                // Both names count: a link named like an allowed program
                // can point at a shell, and the other way round.
                if blocked_reason(platform, None, Some(raw), own_exe).is_some()
                    || blocked_reason(platform, None, Some(executable.as_str()), own_exe).is_some()
                {
                    return Err(app_blocked(&name));
                }
                AllowedApp {
                    name,
                    bundle_id: None,
                    executable: Some(executable),
                }
            }
        };
        let duplicate = apps
            .iter()
            .any(|existing| same_app(existing, &checked, platform));
        if !duplicate {
            apps.push(checked);
        }
    }
    if apps.len() > MAX_APPS {
        return Err(AppError::new("desktop_apps.too_many_apps")
            .param("limit", MAX_APPS)
            .into());
    }
    let mut sites: Vec<AllowedSite> = Vec::new();
    for site in config.sites {
        let origin = canonical_origin(&site.origin)?;
        match sites.iter_mut().find(|existing| existing.origin == origin) {
            Some(existing) => existing.signed_in |= site.signed_in,
            None => sites.push(AllowedSite {
                origin,
                signed_in: site.signed_in,
            }),
        }
    }
    if sites.len() > MAX_SITES {
        return Err(AppError::new("desktop_apps.too_many_sites")
            .param("limit", MAX_SITES)
            .into());
    }
    Ok(CuaDriverConfig {
        enabled: config.enabled,
        apps,
        sites,
        scripted_control: config.scripted_control,
    })
}

fn same_app(left: &AllowedApp, right: &AllowedApp, platform: Platform) -> bool {
    match platform {
        Platform::Macos => left.bundle_id == right.bundle_id,
        Platform::Windows => match (&left.executable, &right.executable) {
            (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
            _ => false,
        },
        Platform::Linux => left.executable == right.executable,
    }
}

fn loopback_host(host: &str) -> bool {
    host == "localhost"
        || host == "[::1]"
        || host
            .parse::<std::net::Ipv4Addr>()
            .is_ok_and(|address| address.is_loopback())
}

/// `https://host[:port]` (or `http://` for this computer), lower case,
/// without the default port. No path, query, credentials or wildcards.
pub(crate) fn canonical_origin(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_ORIGIN_BYTES || !trimmed.contains("://") {
        return Err(site_invalid(trimmed));
    }
    let url = tauri::Url::parse(trimmed).map_err(|_| site_invalid(trimmed))?;
    let host = url
        .host_str()
        .filter(|host| !host.is_empty())
        .ok_or_else(|| site_invalid(trimmed))?
        .to_ascii_lowercase();
    let scheme = url.scheme();
    let allowed_scheme = scheme == "https" || (scheme == "http" && loopback_host(&host));
    if !allowed_scheme
        || host.contains('*')
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
        || trimmed.contains('?')
        || trimmed.contains('#')
    {
        return Err(site_invalid(trimmed));
    }
    let port = url
        .port()
        .map(|port| format!(":{port}"))
        .unwrap_or_default();
    Ok(format!("{scheme}://{host}{port}"))
}

/// One thing a settings change lets agents do that they could not before.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Widening {
    Enabled,
    App(String),
    Site(String),
    SignedIn(String),
    ScriptedControl,
}

fn app_key(app: &AllowedApp) -> (Option<String>, Option<String>) {
    (
        app.bundle_id.as_ref().map(|id| id.to_ascii_lowercase()),
        app.executable
            .as_ref()
            .map(|path| path.to_ascii_lowercase()),
    )
}

/// What `new` allows beyond `old`. Turning the connector on lists
/// everything it grants; narrowing lists nothing.
pub(crate) fn widening(old: &CuaDriverConfig, new: &CuaDriverConfig) -> Vec<Widening> {
    if !new.enabled {
        return Vec::new();
    }
    let empty = CuaDriverConfig::default();
    let mut found = Vec::new();
    let base = if old.enabled {
        old
    } else {
        found.push(Widening::Enabled);
        &empty
    };
    for app in &new.apps {
        if !base.apps.iter().any(|known| app_key(known) == app_key(app)) {
            found.push(Widening::App(app.name.clone()));
        }
    }
    for site in &new.sites {
        let known = base.sites.iter().find(|known| known.origin == site.origin);
        if known.is_none() {
            found.push(Widening::Site(site.origin.clone()));
        }
        if site.signed_in && !known.is_some_and(|known| known.signed_in) {
            found.push(Widening::SignedIn(site.origin.clone()));
        }
    }
    if new.scripted_control && !base.scripted_control {
        found.push(Widening::ScriptedControl);
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeProbe {
        answer: Option<String>,
    }

    impl FakeProbe {
        fn ok(path: &str) -> Self {
            Self {
                answer: Some(path.to_string()),
            }
        }

        /// Hands back whatever it is given.
        fn echo() -> Self {
            Self { answer: None }
        }
    }

    impl ExecutableProbe for FakeProbe {
        fn check(&self, path: &str) -> Result<String, AppRejection> {
            Ok(self.answer.clone().unwrap_or_else(|| path.to_string()))
        }
    }

    fn app(name: &str, bundle_id: &str) -> AllowedApp {
        AllowedApp {
            name: name.into(),
            bundle_id: Some(bundle_id.into()),
            executable: None,
        }
    }

    fn exe(name: &str, path: &str) -> AllowedApp {
        AllowedApp {
            name: name.into(),
            bundle_id: None,
            executable: Some(path.into()),
        }
    }

    fn site(origin: &str, signed_in: bool) -> AllowedSite {
        AllowedSite {
            origin: origin.into(),
            signed_in,
        }
    }

    fn code(error: &str) -> String {
        let json: serde_json::Value =
            serde_json::from_str(error.strip_prefix(crate::app_error::PREFIX).unwrap()).unwrap();
        json["code"].as_str().unwrap().to_string()
    }

    #[test]
    fn origins_are_canonical() {
        assert_eq!(
            canonical_origin("https://WWW.Example.org/").unwrap(),
            "https://www.example.org"
        );
        assert_eq!(
            canonical_origin("https://example.org:443").unwrap(),
            "https://example.org"
        );
        assert_eq!(
            canonical_origin("https://example.org:8443").unwrap(),
            "https://example.org:8443"
        );
        assert_eq!(
            canonical_origin("http://localhost:8080").unwrap(),
            "http://localhost:8080"
        );
        assert_eq!(
            canonical_origin("http://127.0.0.1:3000").unwrap(),
            "http://127.0.0.1:3000"
        );
        for bad in [
            "http://example.org",
            "https://example.org/path",
            "https://*.example.org",
            "ftp://example.org",
            "https://user:pw@example.org",
            "https://example.org?q=1",
            "https://example.org#top",
            "example.org",
            "",
        ] {
            assert!(canonical_origin(bad).is_err(), "{bad}");
        }
        assert_eq!(
            code(&canonical_origin("example.org").unwrap_err()),
            "desktop_apps.site_invalid"
        );
    }

    #[test]
    fn windows_apps_need_an_exe_and_lose_the_verbatim_prefix() {
        let probe = FakeProbe::ok(r"C:\Program Files\Stata 18\StataSE-64.exe");
        let config = CuaDriverConfig {
            enabled: true,
            apps: vec![exe(
                "Stata",
                r"\\?\C:\Program Files\Stata 18\StataSE-64.exe",
            )],
            ..Default::default()
        };
        assert_eq!(
            validate(config, Platform::Windows, &probe, "Oleafly.exe")
                .unwrap()
                .apps[0]
                .executable
                .as_deref(),
            Some(r"C:\Program Files\Stata 18\StataSE-64.exe")
        );
    }

    #[test]
    fn windows_refuses_scripts_and_blocked_programs_case_insensitively() {
        let probe = FakeProbe::echo();
        let one = |path: &str| CuaDriverConfig {
            enabled: true,
            apps: vec![exe("App", path)],
            ..Default::default()
        };
        let error = validate(
            one(r"C:\Tools\run.CMD"),
            Platform::Windows,
            &probe,
            "Oleafly.exe",
        )
        .unwrap_err();
        assert_eq!(code(&error), "desktop_apps.app_invalid");
        let error = validate(
            one(r"C:\Tools\setup.ps1"),
            Platform::Windows,
            &probe,
            "Oleafly.exe",
        )
        .unwrap_err();
        assert_eq!(code(&error), "desktop_apps.app_invalid");
        let error = validate(
            one(r"C:\WINDOWS\System32\WindowsPowerShell\v1.0\PowerShell.exe"),
            Platform::Windows,
            &probe,
            "Oleafly.exe",
        )
        .unwrap_err();
        assert_eq!(code(&error), "desktop_apps.app_blocked");
        let error = validate(
            one(r"D:\Apps\Oleafly.exe"),
            Platform::Windows,
            &probe,
            "Oleafly.exe",
        )
        .unwrap_err();
        assert_eq!(code(&error), "desktop_apps.app_blocked");
        assert!(validate(
            one(r"C:\Program Files\Zotero\zotero.EXE"),
            Platform::Windows,
            &probe,
            "Oleafly.exe"
        )
        .is_ok());
    }

    #[test]
    fn macos_apps_need_a_bundle_id_and_never_oleafly() {
        let probe = FakeProbe::echo();
        let error = validate(
            CuaDriverConfig {
                enabled: true,
                apps: vec![app("Oleafly", "com.oleafly.app")],
                ..Default::default()
            },
            Platform::Macos,
            &probe,
            "/Applications/Oleafly.app/Contents/MacOS/oleafly",
        )
        .unwrap_err();
        assert_eq!(code(&error), "desktop_apps.app_blocked");
        let error = validate(
            CuaDriverConfig {
                enabled: true,
                apps: vec![exe(
                    "Zotero",
                    "/Applications/Zotero.app/Contents/MacOS/zotero",
                )],
                ..Default::default()
            },
            Platform::Macos,
            &probe,
            "oleafly",
        )
        .unwrap_err();
        assert_eq!(code(&error), "desktop_apps.app_invalid");
        let error = validate(
            CuaDriverConfig {
                enabled: true,
                apps: vec![app("Bad", "not a bundle id")],
                ..Default::default()
            },
            Platform::Macos,
            &probe,
            "oleafly",
        )
        .unwrap_err();
        assert_eq!(code(&error), "desktop_apps.app_invalid");
    }

    #[test]
    fn linux_refuses_wrappers_and_shells() {
        let probe = FakeProbe::echo();
        for path in [
            "/usr/bin/flatpak",
            "/usr/bin/env",
            "/bin/bash",
            "/usr/bin/python3",
        ] {
            let error = validate(
                CuaDriverConfig {
                    enabled: true,
                    apps: vec![exe("App", path)],
                    ..Default::default()
                },
                Platform::Linux,
                &probe,
                "/opt/oleafly/oleafly",
            )
            .unwrap_err();
            assert_eq!(code(&error), "desktop_apps.app_blocked", "{path}");
        }
    }

    #[test]
    fn limits_and_duplicates() {
        let probe = FakeProbe::echo();
        let apps = (0..33)
            .map(|index| app(&format!("App {index}"), &format!("org.example.app{index}")))
            .collect();
        let error = validate(
            CuaDriverConfig {
                enabled: true,
                apps,
                ..Default::default()
            },
            Platform::Macos,
            &probe,
            "oleafly",
        )
        .unwrap_err();
        assert_eq!(code(&error), "desktop_apps.too_many_apps");
        assert!(error.contains("\"limit\":\"32\""), "{error}");

        let kept = validate(
            CuaDriverConfig {
                enabled: true,
                sites: vec![site("https://a.org", false), site("https://A.org/", true)],
                apps: vec![
                    app("Zotero", "org.zotero.zotero"),
                    app("Zotero", "org.zotero.zotero"),
                ],
                ..Default::default()
            },
            Platform::Macos,
            &probe,
            "oleafly",
        )
        .unwrap();
        assert_eq!(kept.sites, vec![site("https://a.org", true)]);
        assert_eq!(kept.apps.len(), 1);

        let sites = (0..33)
            .map(|index| site(&format!("https://site{index}.example.org"), false))
            .collect();
        let error = validate(
            CuaDriverConfig {
                enabled: true,
                sites,
                ..Default::default()
            },
            Platform::Macos,
            &probe,
            "oleafly",
        )
        .unwrap_err();
        assert_eq!(code(&error), "desktop_apps.too_many_sites");
    }

    #[test]
    fn enabling_needs_nothing_from_validate_but_names_are_bounded() {
        let probe = FakeProbe::echo();
        assert!(validate(
            CuaDriverConfig {
                enabled: true,
                ..Default::default()
            },
            Platform::Linux,
            &probe,
            "oleafly"
        )
        .is_ok());
        let error = validate(
            CuaDriverConfig {
                enabled: true,
                apps: vec![app("Zo\u{0}tero", "org.zotero.zotero")],
                ..Default::default()
            },
            Platform::Macos,
            &probe,
            "oleafly",
        )
        .unwrap_err();
        assert_eq!(code(&error), "desktop_apps.app_invalid");
        let long = "x".repeat(300);
        let kept = validate(
            CuaDriverConfig {
                enabled: true,
                apps: vec![app(&long, "org.zotero.zotero")],
                ..Default::default()
            },
            Platform::Macos,
            &probe,
            "oleafly",
        )
        .unwrap();
        assert_eq!(kept.apps[0].name.chars().count(), 120);
    }

    #[test]
    fn widening_lists_every_addition_and_nothing_for_narrowing() {
        let old = CuaDriverConfig {
            enabled: true,
            apps: vec![app("Zotero", "org.zotero.zotero")],
            sites: vec![site("https://a.org", false)],
            ..Default::default()
        };
        let new = CuaDriverConfig {
            enabled: true,
            apps: vec![
                app("Zotero", "org.zotero.zotero"),
                app("Excel", "com.microsoft.Excel"),
            ],
            sites: vec![site("https://a.org", true)],
            scripted_control: true,
        };
        assert_eq!(
            widening(&old, &new),
            vec![
                Widening::App("Excel".into()),
                Widening::SignedIn("https://a.org".into()),
                Widening::ScriptedControl
            ]
        );
        assert!(widening(&new, &old).is_empty());
        assert_eq!(
            widening(&CuaDriverConfig::default(), &old)[0],
            Widening::Enabled
        );
        assert!(widening(&old, &CuaDriverConfig::default()).is_empty());
    }

    #[test]
    fn ready_needs_something_to_use() {
        assert!(!ready(&CuaDriverConfig {
            enabled: true,
            ..Default::default()
        }));
        assert!(ready(&CuaDriverConfig {
            enabled: true,
            sites: vec![site("https://a.org", false)],
            ..Default::default()
        }));
        assert!(!ready(&CuaDriverConfig {
            enabled: false,
            sites: vec![site("https://a.org", false)],
            ..Default::default()
        }));
    }

    #[test]
    fn settings_serialize_in_camel_case() {
        let config = CuaDriverConfig {
            enabled: true,
            apps: vec![app("Zotero", "org.zotero.zotero")],
            sites: vec![site("https://a.org", true)],
            scripted_control: true,
        };
        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["scriptedControl"], true);
        assert_eq!(json["apps"][0]["bundleId"], "org.zotero.zotero");
        assert!(json["apps"][0].get("executable").is_none());
        assert_eq!(json["sites"][0]["signedIn"], true);
        let back: CuaDriverConfig = serde_json::from_value(json).unwrap();
        assert_eq!(back, config);
        let empty: CuaDriverConfig = serde_json::from_str("{}").unwrap();
        assert_eq!(empty, CuaDriverConfig::default());
    }
}
