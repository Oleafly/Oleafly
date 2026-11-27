use std::path::{Path, PathBuf};

use super::{Engine, InstalledBrowser, Packaging, PROFILES_DIR};
use crate::browser_cookies::{BrowserId, HostPlatform};

pub trait Probe {
    fn var(&self, name: &str) -> Option<String>;
    fn is_file(&self, path: &Path) -> bool;
    fn snap_launcher(&self, path: &Path) -> bool;
    fn read(&self, path: &Path) -> Option<String>;
    fn registry(&self, key: &str, value: &str) -> Option<String>;
    fn launch_services_https(&self) -> Option<String>;
}

struct Known {
    id: BrowserId,
    engine: Engine,
    mac_app: &'static str,
    mac_binary: &'static str,
    mac_bundle: &'static str,
    windows_exe: &'static str,
    windows_prog_id: &'static str,
    linux_names: &'static [&'static str],
    linux_desktop: &'static [&'static str],
    snap: Option<&'static str>,
    flatpak: &'static str,
}

const KNOWN: [Known; 5] = [
    Known {
        id: BrowserId::Chrome,
        engine: Engine::Chromium,
        mac_app: "Google Chrome",
        mac_binary: "Google Chrome",
        mac_bundle: "com.google.chrome",
        windows_exe: "chrome.exe",
        windows_prog_id: "ChromeHTML",
        linux_names: &["google-chrome", "google-chrome-stable"],
        linux_desktop: &["google-chrome.desktop", "google-chrome-stable.desktop"],
        snap: None,
        flatpak: "com.google.Chrome",
    },
    Known {
        id: BrowserId::Edge,
        engine: Engine::Chromium,
        mac_app: "Microsoft Edge",
        mac_binary: "Microsoft Edge",
        mac_bundle: "com.microsoft.edgemac",
        windows_exe: "msedge.exe",
        windows_prog_id: "MSEdgeHTM",
        linux_names: &["microsoft-edge", "microsoft-edge-stable"],
        linux_desktop: &["microsoft-edge.desktop", "microsoft-edge-stable.desktop"],
        snap: None,
        flatpak: "com.microsoft.Edge",
    },
    Known {
        id: BrowserId::Brave,
        engine: Engine::Chromium,
        mac_app: "Brave Browser",
        mac_binary: "Brave Browser",
        mac_bundle: "com.brave.browser",
        windows_exe: "brave.exe",
        windows_prog_id: "BraveHTML",
        linux_names: &["brave-browser", "brave"],
        linux_desktop: &["brave-browser.desktop"],
        snap: Some("brave"),
        flatpak: "com.brave.Browser",
    },
    Known {
        id: BrowserId::Chromium,
        engine: Engine::Chromium,
        mac_app: "Chromium",
        mac_binary: "Chromium",
        mac_bundle: "org.chromium.chromium",
        windows_exe: "chromium.exe",
        windows_prog_id: "ChromiumHTM",
        linux_names: &["chromium", "chromium-browser"],
        linux_desktop: &["chromium.desktop", "chromium-browser.desktop"],
        snap: Some("chromium"),
        flatpak: "org.chromium.Chromium",
    },
    Known {
        id: BrowserId::Firefox,
        engine: Engine::Firefox,
        mac_app: "Firefox",
        mac_binary: "firefox",
        mac_bundle: "org.mozilla.firefox",
        windows_exe: "firefox.exe",
        windows_prog_id: "FirefoxURL",
        linux_names: &["firefox", "firefox-esr"],
        linux_desktop: &["firefox.desktop", "firefox-esr.desktop"],
        snap: Some("firefox"),
        flatpak: "org.mozilla.firefox",
    },
];

impl InstalledBrowser {
    pub fn icon_names(&self) -> Vec<&'static str> {
        let Some(known) = KNOWN.iter().find(|known| known.id == self.id) else {
            return Vec::new();
        };
        if self.packaging == Packaging::Flatpak {
            return vec![known.flatpak];
        }
        known
            .linux_desktop
            .iter()
            .filter_map(|entry| entry.strip_suffix(".desktop"))
            .collect()
    }
}

const APP_PATHS: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths";
const HTTPS_CHOICE: &str =
    r"HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice";
const FLATPAK_EXPORTS: &str = "/var/lib/flatpak/exports/bin";

fn joined(platform: HostPlatform, base: &str, parts: &[&str]) -> PathBuf {
    let separator = if platform == HostPlatform::Windows {
        '\\'
    } else {
        '/'
    };
    let mut path = base.trim_end_matches(['/', '\\']).to_string();
    for part in parts {
        path.push(separator);
        path.push_str(part);
    }
    PathBuf::from(path)
}

fn found(
    known: &Known,
    path: PathBuf,
    packaging: Packaging,
    profiles: PathBuf,
) -> InstalledBrowser {
    InstalledBrowser {
        id: known.id,
        path,
        engine: known.engine,
        packaging,
        profiles,
    }
}

fn macos(probe: &dyn Probe) -> Vec<InstalledBrowser> {
    let Some(home) = probe.var("HOME") else {
        return Vec::new();
    };
    let platform = HostPlatform::Macos;
    let profiles = joined(platform, &home, &["Library", "Caches", PROFILES_DIR]);
    let roots = [
        "/Applications".to_string(),
        joined(platform, &home, &["Applications"])
            .to_string_lossy()
            .into_owned(),
    ];
    KNOWN
        .iter()
        .filter_map(|known| {
            let bundle = format!("{}.app", known.mac_app);
            roots
                .iter()
                .map(|root| {
                    joined(
                        platform,
                        root,
                        &[&bundle, "Contents", "MacOS", known.mac_binary],
                    )
                })
                .find(|path| probe.is_file(path))
                .map(|path| found(known, path, Packaging::Native, profiles.clone()))
        })
        .collect()
}

fn unquoted(value: &str) -> &str {
    let value = value.trim();
    value
        .strip_prefix('"')
        .and_then(|rest| rest.split('"').next())
        .unwrap_or(value)
}

fn windows(probe: &dyn Probe) -> Vec<InstalledBrowser> {
    let Some(local) = probe.var("LOCALAPPDATA") else {
        return Vec::new();
    };
    let platform = HostPlatform::Windows;
    let profiles = joined(platform, &local, &[PROFILES_DIR]);
    let program_files: Vec<String> = ["ProgramFiles(x86)", "ProgramFiles"]
        .into_iter()
        .filter_map(|name| probe.var(name))
        .collect();
    KNOWN
        .iter()
        .filter_map(|known| {
            let registered = ["HKCU", "HKLM"].into_iter().find_map(|hive| {
                probe
                    .registry(&format!(r"{hive}\{APP_PATHS}\{}", known.windows_exe), "")
                    .map(|value| PathBuf::from(unquoted(&value)))
                    .filter(|path| probe.is_file(path))
            });
            let fixed = || {
                (known.id == BrowserId::Edge)
                    .then(|| {
                        program_files.iter().find_map(|root| {
                            Some(joined(
                                platform,
                                root,
                                &["Microsoft", "Edge", "Application", "msedge.exe"],
                            ))
                            .filter(|path| probe.is_file(path))
                        })
                    })
                    .flatten()
            };
            registered
                .or_else(fixed)
                .map(|path| found(known, path, Packaging::Native, profiles.clone()))
        })
        .collect()
}

fn classify(known: &Known, path: &Path, probe: &dyn Probe) -> Packaging {
    let text = path.to_string_lossy();
    if text.contains("/flatpak/exports/bin/") {
        Packaging::Flatpak
    } else if known.snap.is_some() && (text.starts_with("/snap/") || probe.snap_launcher(path)) {
        Packaging::Snap
    } else {
        Packaging::Native
    }
}

fn linux(probe: &dyn Probe) -> Vec<InstalledBrowser> {
    let Some(home) = probe.var("HOME") else {
        return Vec::new();
    };
    let platform = HostPlatform::Linux;
    let cache = probe
        .var("XDG_CACHE_HOME")
        .filter(|value| value.starts_with('/'))
        .unwrap_or_else(|| format!("{home}/.cache"));
    let native_profiles = joined(platform, &cache, &[PROFILES_DIR]);
    let mut dirs: Vec<String> = probe
        .var("PATH")
        .unwrap_or_default()
        .split(':')
        .filter(|dir| dir.starts_with('/'))
        .map(str::to_string)
        .collect();
    dirs.push("/usr/bin".to_string());
    let flatpak_roots = [
        FLATPAK_EXPORTS.to_string(),
        format!("{home}/.local/share/flatpak/exports/bin"),
    ];
    let mut browsers = Vec::new();
    for known in &KNOWN {
        let profiles_for = |packaging: Packaging| match (packaging, known.snap) {
            (Packaging::Snap, Some(snap)) => {
                joined(platform, &home, &["snap", snap, "common", PROFILES_DIR])
            }
            (Packaging::Flatpak, _) => joined(
                platform,
                &home,
                &[".var", "app", known.flatpak, "cache", PROFILES_DIR],
            ),
            _ => native_profiles.clone(),
        };
        let mut candidates: Vec<PathBuf> = known
            .linux_names
            .iter()
            .filter_map(|name| {
                dirs.iter()
                    .map(|dir| joined(platform, dir, &[name]))
                    .find(|path| probe.is_file(path))
            })
            .collect();
        if let Some(snap) = known.snap {
            candidates.push(joined(platform, "/snap/bin", &[snap]));
        }
        candidates.extend(
            flatpak_roots
                .iter()
                .map(|root| joined(platform, root, &[known.flatpak])),
        );
        for path in candidates {
            if !probe.is_file(&path) {
                continue;
            }
            let packaging = classify(known, &path, probe);
            if browsers.iter().any(|browser: &InstalledBrowser| {
                browser.id == known.id && browser.packaging == packaging
            }) {
                continue;
            }
            browsers.push(found(known, path, packaging, profiles_for(packaging)));
        }
    }
    browsers
}

fn mimeapps_https(text: &str) -> Option<String> {
    let mut in_defaults = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            in_defaults = line == "[Default Applications]";
            continue;
        }
        if !in_defaults {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            if key.trim() == "x-scheme-handler/https" {
                return value
                    .split(';')
                    .map(str::trim)
                    .find(|entry| !entry.is_empty())
                    .map(str::to_string);
            }
        }
    }
    None
}

fn default_choice(
    platform: HostPlatform,
    probe: &dyn Probe,
) -> Option<(BrowserId, Option<Packaging>)> {
    match platform {
        HostPlatform::Macos => {
            let bundle = probe.launch_services_https()?.to_ascii_lowercase();
            KNOWN
                .iter()
                .find(|known| known.mac_bundle == bundle)
                .map(|known| (known.id, None))
        }
        HostPlatform::Windows => {
            let prog_id = probe.registry(HTTPS_CHOICE, "ProgId")?;
            KNOWN
                .iter()
                .find(|known| prog_id.starts_with(known.windows_prog_id))
                .map(|known| (known.id, None))
        }
        HostPlatform::Linux => {
            let home = probe.var("HOME")?;
            let config = probe
                .var("XDG_CONFIG_HOME")
                .filter(|value| value.starts_with('/'))
                .unwrap_or_else(|| format!("{home}/.config"));
            let desktop =
                mimeapps_https(&probe.read(&joined(platform, &config, &["mimeapps.list"]))?)?;
            KNOWN.iter().find_map(|known| {
                if desktop == format!("{}.desktop", known.flatpak) {
                    Some((known.id, Some(Packaging::Flatpak)))
                } else if known
                    .snap
                    .is_some_and(|snap| desktop.starts_with(&format!("{snap}_")))
                {
                    Some((known.id, Some(Packaging::Snap)))
                } else if known.linux_desktop.contains(&desktop.as_str()) {
                    Some((known.id, None))
                } else {
                    None
                }
            })
        }
        HostPlatform::Other => None,
    }
}

pub fn installed_with(platform: HostPlatform, probe: &dyn Probe) -> Vec<InstalledBrowser> {
    let mut browsers = match platform {
        HostPlatform::Macos => macos(probe),
        HostPlatform::Windows => windows(probe),
        HostPlatform::Linux => linux(probe),
        HostPlatform::Other => Vec::new(),
    };
    if let Some((id, packaging)) = default_choice(platform, probe) {
        if let Some(at) = browsers.iter().position(|browser| {
            browser.id == id && packaging.is_none_or(|packaging| browser.packaging == packaging)
        }) {
            let chosen = browsers.remove(at);
            browsers.insert(0, chosen);
        }
    }
    browsers
}

pub fn installed(platform: HostPlatform) -> Vec<InstalledBrowser> {
    installed_with(platform, &SystemProbe)
}

pub struct SystemProbe;

impl Probe for SystemProbe {
    fn var(&self, name: &str) -> Option<String> {
        std::env::var(name).ok().filter(|value| !value.is_empty())
    }

    fn is_file(&self, path: &Path) -> bool {
        std::fs::metadata(path).is_ok_and(|metadata| metadata.is_file())
    }

    fn snap_launcher(&self, path: &Path) -> bool {
        use std::io::Read as _;
        if std::fs::canonicalize(path)
            .is_ok_and(|real| real.starts_with("/snap/") || real == Path::new("/usr/bin/snap"))
        {
            return true;
        }
        let mut head = Vec::new();
        let read =
            std::fs::File::open(path).and_then(|file| file.take(4096).read_to_end(&mut head));
        read.is_ok()
            && head.starts_with(b"#!")
            && head.windows(10).any(|window| window == b"/snap/bin/")
    }

    fn read(&self, path: &Path) -> Option<String> {
        use std::io::Read as _;
        let mut text = String::new();
        std::fs::File::open(path)
            .and_then(|file| file.take(1 << 20).read_to_string(&mut text))
            .ok()?;
        Some(text)
    }

    fn registry(&self, key: &str, value: &str) -> Option<String> {
        #[cfg(windows)]
        {
            let (hive, path) = key.split_once('\\')?;
            let root = match hive {
                "HKCU" => windows_registry::CURRENT_USER,
                "HKLM" => windows_registry::LOCAL_MACHINE,
                _ => return None,
            };
            root.open(path).ok()?.get_string(value).ok()
        }
        #[cfg(not(windows))]
        {
            let _ = (key, value);
            None
        }
    }

    fn launch_services_https(&self) -> Option<String> {
        #[cfg(target_os = "macos")]
        {
            use core_foundation::base::TCFType;
            use core_foundation::string::{CFString, CFStringRef};

            #[link(name = "CoreServices", kind = "framework")]
            extern "C" {
                fn LSCopyDefaultHandlerForURLScheme(scheme: CFStringRef) -> CFStringRef;
            }

            let scheme = CFString::from_static_string("https");
            // SAFETY: the scheme is a live CFString for the whole call, and
            // the function returns a new reference or null.
            let handler = unsafe { LSCopyDefaultHandlerForURLScheme(scheme.as_concrete_TypeRef()) };
            if handler.is_null() {
                return None;
            }
            // SAFETY: a non-null result follows the Create rule, so this
            // wrapper takes over the one reference it carries.
            Some(unsafe { CFString::wrap_under_create_rule(handler) }.to_string())
        }
        #[cfg(not(target_os = "macos"))]
        {
            None
        }
    }
}
