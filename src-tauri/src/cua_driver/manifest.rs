use std::path::{Path, PathBuf};

use serde::Serialize;

use super::config::CuaDriverConfig;
use super::policy;
use super::RuntimeKind;

const MANIFEST_VERSION: u8 = 3;
const EXPIRES_AFTER: &str = "8h";
const IDLE_TIMEOUT: &str = "30m";

#[derive(Serialize, Debug, PartialEq)]
pub(crate) struct Manifest {
    pub version: u8,
    pub expires_after: &'static str,
    pub idle_timeout: &'static str,
    pub allow: Allow,
    pub resources: Resources,
}

#[derive(Serialize, Debug, PartialEq)]
pub(crate) struct Allow {
    pub tools: Vec<&'static str>,
}

#[derive(Serialize, Debug, PartialEq, Default)]
pub(crate) struct Resources {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub apps: Vec<ManifestApp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub browser: Option<BrowserResources>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desktop: Option<DesktopResources>,
}

#[derive(Serialize, Debug, PartialEq)]
pub(crate) struct ManifestApp {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable: Option<String>,
    pub launch: bool,
    pub windows: &'static str,
    pub terminate: &'static str,
}

#[derive(Serialize, Debug, PartialEq)]
pub(crate) struct BrowserResources {
    pub profiles: Vec<Profile>,
    pub origins: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub(crate) struct Profile {
    pub kind: &'static str,
}

#[derive(Serialize, Debug, PartialEq)]
pub(crate) struct DesktopResources {
    pub display: bool,
}

fn browser_tools() -> Vec<&'static str> {
    let mut tools = policy::browser_allow_tools();
    tools.extend_from_slice(policy::BROWSER_INTERNAL_TOOLS);
    tools
}

/// The browsers Cua Driver launches or attaches to. Cua Driver 0.38 binds a
/// tab only through its browser's window, and only a window of a listed app.
/// They are never launched or quit from here, and the browser tools still
/// only act on the listed sites.
fn browser_apps() -> Vec<ManifestApp> {
    super::browser::known_browsers()
        .into_iter()
        .map(|app| ManifestApp {
            bundle_id: app.bundle_id,
            executable: app.executable,
            launch: false,
            windows: "all",
            terminate: "deny",
        })
        .collect()
}

fn manifest(tools: Vec<&'static str>, resources: Resources) -> Manifest {
    Manifest {
        version: MANIFEST_VERSION,
        expires_after: EXPIRES_AFTER,
        idle_timeout: IDLE_TIMEOUT,
        allow: Allow { tools },
        resources,
    }
}

pub(crate) fn build_manifest(config: &CuaDriverConfig, kind: RuntimeKind) -> Option<Manifest> {
    if !config.enabled {
        return None;
    }
    match kind {
        RuntimeKind::Desktop => Some(manifest(
            policy::desktop_allow_tools(config),
            Resources {
                apps: config
                    .apps
                    .iter()
                    .map(|app| ManifestApp {
                        bundle_id: app.bundle_id.clone(),
                        executable: app.executable.clone(),
                        launch: true,
                        windows: "all",
                        terminate: "driver_launched",
                    })
                    .collect(),
                browser: None,
                desktop: Some(DesktopResources { display: false }),
            },
        )),
        RuntimeKind::Browser => {
            let origins: Vec<String> = config
                .sites
                .iter()
                .map(|site| site.origin.clone())
                .collect();
            (!origins.is_empty()).then(|| {
                // The browser it launches opens on a blank page, and 0.38
                // checks the page a tab is on before it leaves it.
                let origins = std::iter::once("about:blank".to_string())
                    .chain(origins)
                    .collect();
                manifest(
                    browser_tools(),
                    Resources {
                        apps: browser_apps(),
                        browser: Some(BrowserResources {
                            profiles: vec![
                                Profile { kind: "isolated" },
                                Profile {
                                    kind: "isolated_new",
                                },
                            ],
                            origins,
                        }),
                        ..Resources::default()
                    },
                )
            })
        }
        RuntimeKind::SignedInBrowser => {
            let origins: Vec<String> = config
                .sites
                .iter()
                .filter(|site| site.signed_in)
                .map(|site| site.origin.clone())
                .collect();
            (!origins.is_empty()).then(|| {
                manifest(
                    browser_tools(),
                    Resources {
                        apps: browser_apps(),
                        browser: Some(BrowserResources {
                            profiles: vec![Profile {
                                kind: "existing_profile",
                            }],
                            origins,
                        }),
                        ..Resources::default()
                    },
                )
            })
        }
    }
}

/// The manifest as YAML. These plain structs always serialize; an empty
/// result would make the daemon refuse to start, never widen anything.
pub(crate) fn render_manifest(manifest: &Manifest) -> String {
    serde_norway::to_string(manifest).unwrap_or_default()
}

pub(crate) fn ensure_private_dir(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn write_manifest(
    dir: &Path,
    kind: RuntimeKind,
    rendered: &str,
) -> Result<PathBuf, String> {
    ensure_private_dir(dir)?;
    let path = dir.join(format!("{}.manifest.yaml", kind.as_str()));
    let temporary = dir.join(format!(
        "{}.manifest.yaml.{}.tmp",
        kind.as_str(),
        std::process::id()
    ));
    std::fs::write(&temporary, rendered).map_err(|error| error.to_string())?;
    crate::fsperm::harden_file(&temporary);
    if let Err(error) = crate::sandbox::replace_file(&temporary, &path) {
        let _ = std::fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    crate::fsperm::harden_file(&path);
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cua_driver::config::{AllowedApp, AllowedSite};
    use crate::cua_driver::policy::NEVER_ALLOWED;

    fn full_config(scripted_control: bool) -> CuaDriverConfig {
        CuaDriverConfig {
            enabled: true,
            apps: vec![AllowedApp {
                name: "Zotero".into(),
                bundle_id: Some("org.zotero.zotero".into()),
                executable: None,
            }],
            sites: vec![
                AllowedSite {
                    origin: "https://journal.example.org".into(),
                    signed_in: true,
                },
                AllowedSite {
                    origin: "https://library.example.org".into(),
                    signed_in: false,
                },
            ],
            scripted_control,
            ask_before_actions: false,
        }
    }

    fn zotero_on_macos() -> CuaDriverConfig {
        CuaDriverConfig {
            sites: Vec::new(),
            ..full_config(false)
        }
    }

    #[test]
    fn no_manifest_ever_allows_a_never_tool() {
        for config in [
            full_config(false),
            full_config(true),
            CuaDriverConfig {
                enabled: true,
                ..Default::default()
            },
        ] {
            for kind in RuntimeKind::ALL {
                if let Some(manifest) = build_manifest(&config, kind) {
                    for tool in &manifest.allow.tools {
                        assert!(!NEVER_ALLOWED.contains(tool), "{kind:?} {tool}");
                    }
                    assert!(
                        !manifest.allow.tools.contains(&policy::SELF_CHECK_TOOL),
                        "{kind:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn run_script_is_in_the_desktop_manifest_only_with_scripted_control() {
        let without = build_manifest(&full_config(false), RuntimeKind::Desktop).unwrap();
        assert!(!without.allow.tools.contains(&"run_script"));
        let with = build_manifest(&full_config(true), RuntimeKind::Desktop).unwrap();
        assert!(with.allow.tools.contains(&"run_script"));
        assert!(with.allow.tools.contains(&"health_report"));
        for kind in [RuntimeKind::Browser, RuntimeKind::SignedInBrowser] {
            assert!(!build_manifest(&full_config(true), kind)
                .unwrap()
                .allow
                .tools
                .contains(&"run_script"));
        }
    }

    #[test]
    fn browser_manifests_use_only_browser_and_session_tools() {
        for kind in [RuntimeKind::Browser, RuntimeKind::SignedInBrowser] {
            let manifest = build_manifest(&full_config(true), kind).unwrap();
            for tool in &manifest.allow.tools {
                assert!(
                    tool.starts_with("browser_")
                        || [
                            "get_browser_state",
                            "start_session",
                            "end_session",
                            "list_windows"
                        ]
                        .contains(tool),
                    "{kind:?} {tool}"
                );
            }
            assert_eq!(
                manifest.resources.apps.len(),
                super::super::browser::known_browsers().len()
            );
            assert!(manifest
                .resources
                .apps
                .iter()
                .all(|app| !app.launch && app.windows == "all" && app.terminate == "deny"));
            assert!(manifest.resources.desktop.is_none());
        }
    }

    #[test]
    fn signed_in_runtime_gets_only_the_marked_origins_and_the_existing_profile() {
        let signed_in = build_manifest(&full_config(false), RuntimeKind::SignedInBrowser).unwrap();
        let browser = signed_in.resources.browser.unwrap();
        assert_eq!(
            browser.origins,
            vec!["https://journal.example.org".to_string()]
        );
        assert_eq!(
            browser.profiles,
            vec![Profile {
                kind: "existing_profile"
            }]
        );

        let separate = build_manifest(&full_config(false), RuntimeKind::Browser).unwrap();
        let browser = separate.resources.browser.unwrap();
        // The launched browser starts on a blank page.
        assert_eq!(browser.origins.len(), 3);
        assert_eq!(browser.origins[0], "about:blank");
        assert!(browser
            .profiles
            .iter()
            .all(|profile| profile.kind != "existing_profile"));

        assert!(build_manifest(&zotero_on_macos(), RuntimeKind::Browser).is_none());
        assert!(build_manifest(&zotero_on_macos(), RuntimeKind::SignedInBrowser).is_none());
        let off = CuaDriverConfig {
            enabled: false,
            ..full_config(false)
        };
        for kind in RuntimeKind::ALL {
            assert!(build_manifest(&off, kind).is_none());
        }
    }

    #[test]
    fn desktop_manifest_renders_the_documented_yaml() {
        let rendered =
            render_manifest(&build_manifest(&zotero_on_macos(), RuntimeKind::Desktop).unwrap());
        let value: serde_json::Value = serde_norway::from_str(&rendered).unwrap();
        assert_eq!(value["version"], 3);
        assert_eq!(value["expires_after"], "8h");
        assert_eq!(value["idle_timeout"], "30m");
        assert_eq!(
            value["resources"]["apps"][0],
            serde_json::json!({"bundle_id":"org.zotero.zotero","launch":true,"windows":"all","terminate":"driver_launched"})
        );
        assert_eq!(value["resources"]["desktop"]["display"], false);
        assert!(value.get("mode").is_none());
        assert!(value["resources"].get("browser").is_none());

        let empty = CuaDriverConfig {
            enabled: true,
            ..Default::default()
        };
        let value: serde_json::Value = serde_norway::from_str(&render_manifest(
            &build_manifest(&empty, RuntimeKind::Desktop).unwrap(),
        ))
        .unwrap();
        assert!(value["resources"].get("apps").is_none());
    }

    #[test]
    fn windows_executables_with_spaces_survive_rendering() {
        let config = CuaDriverConfig {
            enabled: true,
            apps: vec![AllowedApp {
                name: "Stata".into(),
                bundle_id: None,
                executable: Some(r"C:\Program Files\Stata 18\StataSE-64.exe".into()),
            }],
            ..Default::default()
        };
        let rendered = render_manifest(&build_manifest(&config, RuntimeKind::Desktop).unwrap());
        let value: serde_json::Value = serde_norway::from_str(&rendered).unwrap();
        assert_eq!(
            value["resources"]["apps"][0]["executable"],
            r"C:\Program Files\Stata 18\StataSE-64.exe"
        );
        assert!(value["resources"]["apps"][0].get("bundle_id").is_none());
    }

    #[test]
    fn write_manifest_replaces_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let first = write_manifest(dir.path(), RuntimeKind::Browser, "version: 3\n").unwrap();
        let second =
            write_manifest(dir.path(), RuntimeKind::Browser, "version: 3\n# two\n").unwrap();
        assert_eq!(first, second);
        assert_eq!(first.file_name().unwrap(), "browser.manifest.yaml");
        assert_eq!(
            std::fs::read_to_string(&second).unwrap(),
            "version: 3\n# two\n"
        );
        let leftovers = std::fs::read_dir(dir.path())
            .unwrap()
            .filter(|entry| {
                entry
                    .as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".tmp")
            })
            .count();
        assert_eq!(leftovers, 0);
    }

    #[cfg(unix)]
    #[test]
    fn write_manifest_is_owner_only_on_unix() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("cua");
        let path = write_manifest(&folder, RuntimeKind::Desktop, "version: 3\n").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        let folder_mode = std::fs::metadata(&folder).unwrap().permissions().mode();
        assert_eq!(folder_mode & 0o777, 0o700);
    }
}
