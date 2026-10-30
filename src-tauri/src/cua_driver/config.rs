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
    /// Lets agents run Cua scripts (`run_script`).
    #[serde(default)]
    pub scripted_control: bool,
    /// Every action asks in a dialog first. Off, the allowed apps and sites
    /// are the whole of the user's say, and actions run without asking.
    #[serde(default)]
    pub ask_before_actions: bool,
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

/// Takes every program path as it is, without touching the file system:
/// the quick check at startup, before `SystemProbe` runs in the background
/// (a program on a share that can't be reached must not hold up the app).
pub(crate) struct NameOnlyProbe;

impl ExecutableProbe for NameOnlyProbe {
    fn check(&self, path: &str) -> Result<String, AppRejection> {
        Ok(path.to_string())
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

/// Unicode format characters (category Cf): bidi controls, zero-width
/// characters and the like, which can reorder or hide text around them.
pub(crate) fn is_format_char(character: char) -> bool {
    matches!(
        character,
        '\u{00AD}'
            | '\u{0600}'..='\u{0605}'
            | '\u{061C}'
            | '\u{06DD}'
            | '\u{070F}'
            | '\u{0890}'..='\u{0891}'
            | '\u{08E2}'
            | '\u{180E}'
            | '\u{200B}'..='\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2060}'..='\u{2064}'
            | '\u{2066}'..='\u{206F}'
            | '\u{FEFF}'
            | '\u{FFF9}'..='\u{FFFB}'
            | '\u{110BD}'
            | '\u{110CD}'
            | '\u{13430}'..='\u{1343F}'
            | '\u{1BCA0}'..='\u{1BCA3}'
            | '\u{1D173}'..='\u{1D17A}'
            | '\u{E0001}'
            | '\u{E0020}'..='\u{E007F}'
    )
}

/// A name without format characters, trimmed; control characters make it
/// invalid.
fn clean_name(name: &str) -> Result<String, String> {
    let visible: String = name.chars().filter(|c| !is_format_char(*c)).collect();
    let trimmed = visible.trim();
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

/// Why an app entry can't be used.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AppFault {
    /// Not a usable entry: no bundle id or program path, or a script.
    Invalid,
    /// An app agents may never use.
    Blocked,
    /// A program that isn't on this computer (any more).
    Missing,
}

/// One entry, checked against the platform's rules and the blocklist, in its
/// stored form (name trimmed, program path canonical). The fault comes with
/// the entry's name for the error text.
fn check_app(
    app: &AllowedApp,
    platform: Platform,
    probe: &dyn ExecutableProbe,
    own_exe: &str,
) -> Result<AllowedApp, (AppFault, String)> {
    let name = clean_name(&app.name).map_err(|_| {
        let shown: String = app
            .name
            .trim()
            .chars()
            .filter(|c| !c.is_control() && !is_format_char(*c))
            .collect();
        (AppFault::Invalid, shown)
    })?;
    let fail = |fault: AppFault| (fault, name.clone());
    match platform {
        Platform::Macos => {
            if app.executable.is_some() {
                return Err(fail(AppFault::Invalid));
            }
            let bundle_id = app.bundle_id.as_deref().map(str::trim).unwrap_or_default();
            if !valid_bundle_id(bundle_id) {
                return Err(fail(AppFault::Invalid));
            }
            if blocked_reason(platform, Some(bundle_id), None, own_exe).is_some() {
                return Err(fail(AppFault::Blocked));
            }
            Ok(AllowedApp {
                name,
                bundle_id: Some(bundle_id.to_string()),
                executable: None,
            })
        }
        Platform::Windows | Platform::Linux => {
            if app.bundle_id.is_some() {
                return Err(fail(AppFault::Invalid));
            }
            let raw = app.executable.as_deref().map(str::trim).unwrap_or_default();
            if raw.is_empty() || raw.len() > MAX_PATH_BYTES || raw.chars().any(char::is_control) {
                return Err(fail(AppFault::Invalid));
            }
            let executable = match probe.check(raw) {
                Ok(executable) => executable,
                Err(AppRejection::NotAProgram) => return Err(fail(AppFault::Invalid)),
                // Gone, but still a name the blocklist knows.
                Err(AppRejection::NotFound) => {
                    return Err(fail(
                        if blocked_reason(platform, None, Some(raw), own_exe).is_some() {
                            AppFault::Blocked
                        } else {
                            AppFault::Missing
                        },
                    ));
                }
            };
            // Scripts (.cmd, .bat, .ps1) are not programs to start.
            if platform == Platform::Windows && !windows_program(&executable) {
                return Err(fail(AppFault::Invalid));
            }
            // Both names count: a link named like an allowed program
            // can point at a shell, and the other way round.
            if blocked_reason(platform, None, Some(raw), own_exe).is_some()
                || blocked_reason(platform, None, Some(executable.as_str()), own_exe).is_some()
            {
                return Err(fail(AppFault::Blocked));
            }
            Ok(AllowedApp {
                name,
                bundle_id: None,
                executable: Some(executable),
            })
        }
    }
}

fn fault_error((fault, name): (AppFault, String)) -> String {
    match fault {
        AppFault::Blocked => app_blocked(&name),
        AppFault::Invalid | AppFault::Missing => app_invalid(&name),
    }
}

/// Checks and normalizes settings that were never saved: every app is new.
#[cfg(test)]
pub(crate) fn validate(
    config: CuaDriverConfig,
    platform: Platform,
    probe: &dyn ExecutableProbe,
    own_exe: &str,
) -> Result<CuaDriverConfig, String> {
    validate_against(
        config,
        platform,
        probe,
        own_exe,
        &CuaDriverConfig::default(),
    )
}

/// Like `validate`, but an app that is already in `stored` exactly as it is
/// kept as it is, without looking at the file system again. A program that
/// went away, or that a newer blocklist names, then never stops an unrelated
/// change from saving, and never stops desktop apps from being turned off.
pub(crate) fn validate_against(
    config: CuaDriverConfig,
    platform: Platform,
    probe: &dyn ExecutableProbe,
    own_exe: &str,
    stored: &CuaDriverConfig,
) -> Result<CuaDriverConfig, String> {
    let mut apps: Vec<AllowedApp> = Vec::new();
    for app in config.apps {
        let checked = if stored.apps.contains(&app) {
            app
        } else {
            check_app(&app, platform, probe, own_exe).map_err(fault_error)?
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
        ask_before_actions: config.ask_before_actions,
    })
}

/// Settings read from the config file at startup, cleaned the way a save
/// would: an entry that is no usable app or site, or that the blocklist
/// names, is dropped (how many comes back for the log; duplicates are merged
/// and not counted). A program that is only missing stays: it may be on a
/// drive that isn't plugged in, and Settings shows it as removable.
pub(crate) fn sanitize_loaded(
    config: CuaDriverConfig,
    platform: Platform,
    probe: &dyn ExecutableProbe,
    own_exe: &str,
) -> (CuaDriverConfig, usize) {
    let mut dropped = 0;
    let mut apps: Vec<AllowedApp> = Vec::new();
    for app in config.apps {
        let kept = match check_app(&app, platform, probe, own_exe) {
            Ok(checked) => checked,
            Err((AppFault::Missing, _)) => app,
            Err(_) => {
                dropped += 1;
                continue;
            }
        };
        if !apps.iter().any(|known| same_app(known, &kept, platform)) {
            apps.push(kept);
        }
    }
    apps.truncate(MAX_APPS);
    let mut sites: Vec<AllowedSite> = Vec::new();
    for site in config.sites {
        let Ok(origin) = canonical_origin(&site.origin) else {
            dropped += 1;
            continue;
        };
        match sites.iter_mut().find(|known| known.origin == origin) {
            Some(known) => known.signed_in |= site.signed_in,
            None => sites.push(AllowedSite {
                origin,
                signed_in: site.signed_in,
            }),
        }
    }
    sites.truncate(MAX_SITES);
    (
        CuaDriverConfig {
            enabled: config.enabled,
            apps,
            sites,
            scripted_control: config.scripted_control,
            ask_before_actions: config.ask_before_actions,
        },
        dropped,
    )
}

/// Stored apps whose program is gone (Windows and Linux; macOS apps are
/// kept by bundle id only), by `executable`, for Settings to show.
pub(crate) fn missing_apps(
    config: &CuaDriverConfig,
    platform: Platform,
    probe: &dyn ExecutableProbe,
) -> Vec<String> {
    if platform == Platform::Macos {
        return Vec::new();
    }
    config
        .apps
        .iter()
        .filter_map(|app| app.executable.as_deref())
        .filter(|path| probe.check(path) == Err(AppRejection::NotFound))
        .map(str::to_string)
        .collect()
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
    /// An app by the name it was given and the identity that was validated:
    /// the bundle id (macOS) or the canonical program path (elsewhere).
    App {
        name: String,
        identity: String,
    },
    Site(String),
    SignedIn(String),
    ScriptedControl,
    /// Actions run without a dialog.
    NoAsking,
}

/// What `new` allows beyond `old`. Turning the connector on lists
/// everything it grants; narrowing lists nothing. Apps count as the same by
/// the platform's own rules (`same_app`), the ones saving uses: on Linux a
/// path that differs only in case is another program.
pub(crate) fn widening(
    old: &CuaDriverConfig,
    new: &CuaDriverConfig,
    platform: Platform,
) -> Vec<Widening> {
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
        if !base.apps.iter().any(|known| same_app(known, app, platform)) {
            found.push(Widening::App {
                name: app.name.clone(),
                identity: app
                    .bundle_id
                    .clone()
                    .or_else(|| app.executable.clone())
                    .unwrap_or_default(),
            });
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
    // Asking starts on in `empty` so turning the connector on names it.
    let asked_before = if old.enabled {
        old.ask_before_actions
    } else {
        true
    };
    if !new.ask_before_actions && asked_before {
        found.push(Widening::NoAsking);
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
            ask_before_actions: false,
        };
        assert_eq!(
            widening(&old, &new, Platform::Macos),
            vec![
                Widening::App {
                    name: "Excel".into(),
                    identity: "com.microsoft.Excel".into()
                },
                Widening::SignedIn("https://a.org".into()),
                Widening::ScriptedControl
            ]
        );
        assert!(widening(&new, &old, Platform::Macos).is_empty());
        assert_eq!(
            widening(&CuaDriverConfig::default(), &old, Platform::Macos)[0],
            Widening::Enabled
        );
        assert!(widening(&old, &CuaDriverConfig::default(), Platform::Macos).is_empty());
    }

    #[test]
    fn turning_asking_off_is_a_widening_and_turning_it_on_is_not() {
        let asking = CuaDriverConfig {
            enabled: true,
            ask_before_actions: true,
            ..Default::default()
        };
        let quiet = CuaDriverConfig {
            ask_before_actions: false,
            ..asking.clone()
        };
        assert_eq!(
            widening(&asking, &quiet, Platform::Macos),
            vec![Widening::NoAsking]
        );
        assert!(widening(&quiet, &asking, Platform::Macos).is_empty());
        // Turning the connector on names it unless asking is on.
        let off = CuaDriverConfig::default();
        assert!(widening(&off, &quiet, Platform::Macos).contains(&Widening::NoAsking));
        assert!(!widening(&off, &asking, Platform::Macos).contains(&Widening::NoAsking));
    }

    #[test]
    fn a_linux_path_that_differs_only_in_case_is_a_new_app_to_confirm() {
        let old = CuaDriverConfig {
            enabled: true,
            apps: vec![exe("Zotero", "/home/u/Apps/zotero/zotero")],
            ..Default::default()
        };
        let new = CuaDriverConfig {
            apps: vec![
                exe("Zotero", "/home/u/Apps/zotero/zotero"),
                exe("Zotero", "/home/u/apps/zotero/zotero"),
            ],
            ..old.clone()
        };
        assert_eq!(
            widening(&old, &new, Platform::Linux),
            vec![Widening::App {
                name: "Zotero".into(),
                identity: "/home/u/apps/zotero/zotero".into()
            }]
        );
        // Windows paths ignore case, there and when saving.
        let windows_old = CuaDriverConfig {
            apps: vec![exe("Stata", r"C:\Stata\StataSE-64.exe")],
            ..old
        };
        let windows_new = CuaDriverConfig {
            apps: vec![exe("Stata", r"c:\stata\statase-64.exe")],
            ..windows_old.clone()
        };
        assert!(widening(&windows_old, &windows_new, Platform::Windows).is_empty());
    }

    #[test]
    fn names_lose_bidi_and_zero_width_characters() {
        let probe = FakeProbe::echo();
        let saved = validate(
            CuaDriverConfig {
                enabled: true,
                apps: vec![app("Zo\u{202E}te\u{200B}ro\u{2066}", "org.zotero.zotero")],
                ..Default::default()
            },
            Platform::Macos,
            &probe,
            "oleafly",
        )
        .unwrap();
        assert_eq!(saved.apps[0].name, "Zotero");
        let error = validate(
            CuaDriverConfig {
                enabled: true,
                apps: vec![app("\u{202E}\u{200F}", "org.zotero.zotero")],
                ..Default::default()
            },
            Platform::Macos,
            &probe,
            "oleafly",
        )
        .unwrap_err();
        assert_eq!(code(&error), "desktop_apps.app_invalid");
        assert!(is_format_char('\u{FEFF}') && !is_format_char('é'));
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
            ask_before_actions: false,
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

    /// A probe that says these programs are gone.
    struct Gone(Vec<&'static str>);

    impl ExecutableProbe for Gone {
        fn check(&self, path: &str) -> Result<String, AppRejection> {
            if self.0.contains(&path) {
                Err(AppRejection::NotFound)
            } else {
                Ok(path.to_string())
            }
        }
    }

    const SLACK: &str = r"C:\Users\a\AppData\Local\slack\app-4.35.0\slack.exe";

    #[test]
    fn an_app_that_is_already_stored_is_not_looked_at_again() {
        let stored = CuaDriverConfig {
            enabled: true,
            apps: vec![exe("Slack", SLACK)],
            ..Default::default()
        };
        let gone = Gone(vec![SLACK]);
        // Turning off, and changing something else, don't need the program.
        let off = CuaDriverConfig {
            enabled: false,
            ..stored.clone()
        };
        assert_eq!(
            validate_against(
                off.clone(),
                Platform::Windows,
                &gone,
                "Oleafly.exe",
                &stored
            )
            .unwrap(),
            off
        );
        let with_site = CuaDriverConfig {
            sites: vec![site("https://a.org", false)],
            ..stored.clone()
        };
        assert_eq!(
            validate_against(
                with_site.clone(),
                Platform::Windows,
                &gone,
                "Oleafly.exe",
                &stored
            )
            .unwrap(),
            with_site
        );
        // Saving it from scratch (not stored yet) still needs the program.
        let error = validate(stored.clone(), Platform::Windows, &gone, "Oleafly.exe").unwrap_err();
        assert_eq!(code(&error), "desktop_apps.app_invalid");
        // So does a new one, even next to the stored one.
        let added = CuaDriverConfig {
            apps: vec![exe("Slack", SLACK), exe("Zotero", r"C:\z\zotero.exe")],
            ..stored.clone()
        };
        let gone_both = Gone(vec![SLACK, r"C:\z\zotero.exe"]);
        let error = validate_against(added, Platform::Windows, &gone_both, "Oleafly.exe", &stored)
            .unwrap_err();
        assert_eq!(code(&error), "desktop_apps.app_invalid");
        // An entry that changed (a renamed copy) is looked at again.
        let renamed = CuaDriverConfig {
            apps: vec![exe("Chat", SLACK)],
            ..stored.clone()
        };
        assert!(
            validate_against(renamed, Platform::Windows, &gone, "Oleafly.exe", &stored).is_err()
        );
    }

    #[test]
    fn a_missing_program_with_a_blocked_name_is_blocked_not_just_missing() {
        let error = validate(
            CuaDriverConfig {
                enabled: true,
                apps: vec![exe("Shell", r"C:\Windows\System32\cmd.exe")],
                ..Default::default()
            },
            Platform::Windows,
            &Gone(vec![r"C:\Windows\System32\cmd.exe"]),
            "Oleafly.exe",
        )
        .unwrap_err();
        assert_eq!(code(&error), "desktop_apps.app_blocked");
    }

    #[test]
    fn startup_keeps_what_a_save_would_keep_and_drops_the_rest() {
        let loaded = CuaDriverConfig {
            enabled: true,
            apps: vec![
                app("Zotero", "org.zotero.zotero"),
                app("Chrome", "com.google.Chrome"),
                app("Terminal", "com.apple.Terminal"),
                app("Bad", "not a bundle id"),
                app("Zotero again", "org.zotero.zotero"),
            ],
            sites: vec![
                site("https://a.org", false),
                site("http://example.org", false),
                site("https://A.org/", true),
            ],
            scripted_control: true,
            ask_before_actions: false,
        };
        let (kept, dropped) =
            sanitize_loaded(loaded, Platform::Macos, &FakeProbe::echo(), "oleafly");
        assert_eq!(kept.apps, vec![app("Zotero", "org.zotero.zotero")]);
        assert_eq!(kept.sites, vec![site("https://a.org", true)]);
        assert!(kept.enabled && kept.scripted_control);
        // Chrome, Terminal, Bad and the invalid site; the duplicates merge
        // and are not counted.
        assert_eq!(dropped, 4);
    }

    #[test]
    fn startup_keeps_a_program_that_is_only_missing() {
        let loaded = CuaDriverConfig {
            enabled: true,
            apps: vec![
                exe("Slack", SLACK),
                exe("Shell", r"C:\Windows\System32\cmd.exe"),
                exe("Script", r"C:\Tools\run.cmd"),
            ],
            ..Default::default()
        };
        let gone = Gone(vec![SLACK, r"C:\Windows\System32\cmd.exe"]);
        let (kept, dropped) = sanitize_loaded(loaded, Platform::Windows, &gone, "Oleafly.exe");
        // The script and the shell can never be allowed; Slack may be on a
        // drive that is not plugged in.
        assert_eq!(kept.apps, vec![exe("Slack", SLACK)]);
        assert_eq!(dropped, 2);
    }

    #[test]
    fn settings_say_which_stored_programs_are_gone() {
        let config = CuaDriverConfig {
            enabled: true,
            apps: vec![exe("Slack", SLACK), exe("Zotero", r"C:\z\zotero.exe")],
            ..Default::default()
        };
        assert_eq!(
            missing_apps(&config, Platform::Windows, &Gone(vec![SLACK])),
            vec![SLACK.to_string()]
        );
        // macOS apps are stored by bundle id only.
        let mac = CuaDriverConfig {
            apps: vec![app("Zotero", "org.zotero.zotero")],
            ..config
        };
        assert!(missing_apps(&mac, Platform::Macos, &Gone(vec![])).is_empty());
    }
}
