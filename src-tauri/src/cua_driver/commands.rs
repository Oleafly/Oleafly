//! Settings › Integrations › Desktop apps. Every command answers the main
//! window only. A change that widens what agents may control asks through a
//! native confirmation first, so the renderer can never widen control alone.

use std::path::Path;
use std::sync::Arc;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Runtime, Webview};

use super::apps::{self, InstalledApp};
use super::config::{self, CuaDriverConfig, ExecutableProbe, SystemProbe, Widening};
use super::detect::{self, PermissionsStatus, TerminalCommand};
use super::runtime::CALL_TIMEOUT;
use super::{global, lock, BoxFuture, CuaDriverState, Platform, RuntimeKind};
use crate::app_error::AppError;
use crate::mcp::protocol::ToolMeta;

const MAX_CONFIRM_LINES: usize = 10;

fn require_main<R: Runtime>(webview: &Webview<R>) -> Result<(), String> {
    if crate::caller::own_window_label(webview).as_deref() == Some("main") {
        Ok(())
    } else {
        Err(AppError::new("desktop_apps.main_window").into())
    }
}

fn unavailable() -> String {
    AppError::new("desktop_apps.start_failed")
        .param("detail", "Computer Use isn't available on this system.")
        .into()
}

pub(crate) fn own_exe() -> String {
    std::env::current_exe()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn blocking_error(error: impl std::fmt::Display) -> String {
    format!("Computer Use settings worker failed: {error}")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAppsStatus {
    pub platform: &'static str,
    pub supported: bool,
    pub driver_path: Option<String>,
    pub driver_version: Option<String>,
    /// `not_installed`, `too_old`, `no_app_bundle` or `unreadable_version`.
    pub driver_problem: Option<&'static str>,
    pub minimum_version: String,
    /// The official line, shown for copying.
    pub install_line: &'static str,
    /// The same line as a program and its arguments, for the terminal.
    pub install_command: TerminalCommand,
    /// macOS only.
    pub permissions: Option<PermissionsStatus>,
    /// Linux on GNOME Wayland only.
    pub gnome_helper: Option<bool>,
    pub gnome_helper_line: Option<String>,
    pub running: Vec<RuntimeKind>,
    pub spaces_cli_path: Option<String>,
    pub spaces_install_line: &'static str,
    pub spaces_install_command: TerminalCommand,
    pub settings: CuaDriverConfig,
    /// Allowed apps whose program is no longer on this computer (Windows
    /// and Linux), by `executable`.
    pub missing_apps: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeTest {
    pub kind: RuntimeKind,
    pub ok: bool,
    /// An `AppError` string or the driver's text, for `describeError`.
    pub detail: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAppsTestReport {
    pub ok: bool,
    pub version: Option<String>,
    pub runtimes: Vec<RuntimeTest>,
    /// Failed checks from `cua-driver doctor`.
    pub problems: Vec<String>,
}

fn process_env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

fn status_blocking(
    platform: Option<Platform>,
    settings: CuaDriverConfig,
    running: Vec<RuntimeKind>,
) -> DesktopAppsStatus {
    let shown = platform.unwrap_or(Platform::Linux);
    let install = platform.and_then(detect::detect_install);
    let driver_problem = match (&install, platform) {
        (_, None) => Some("not_installed"),
        (None, Some(_)) => Some("not_installed"),
        (Some(install), Some(platform)) => install.problem(platform),
    };
    let permissions = match (&install, platform) {
        (Some(install), Some(Platform::Macos)) => {
            Some(detect::permissions_status(&install.binary).unwrap_or_default())
        }
        _ => None,
    };
    let gnome_helper = match platform {
        Some(Platform::Linux) => detect::gnome_helper_state(&process_env),
        _ => None,
    };
    let gnome_helper_line = gnome_helper.and_then(|_| {
        detect::driver_home(Platform::Linux, &process_env)
            .map(|home| format!("{home}/packages/current/wayland-helper/install.sh"))
    });
    DesktopAppsStatus {
        platform: shown.as_str(),
        supported: platform.is_some(),
        driver_path: install
            .as_ref()
            .map(|install| install.binary.to_string_lossy().into_owned()),
        driver_version: install
            .as_ref()
            .and_then(|install| install.version)
            .map(detect::version_string),
        driver_problem,
        minimum_version: detect::version_string(detect::MIN_DRIVER_VERSION),
        install_line: detect::install_line(shown),
        install_command: detect::install_command(shown),
        permissions,
        gnome_helper,
        gnome_helper_line,
        running,
        spaces_cli_path: platform
            .and_then(detect::locate_spaces_cli)
            .map(|path| path.to_string_lossy().into_owned()),
        spaces_install_line: detect::spaces_install_line(shown),
        spaces_install_command: detect::spaces_install_command(shown),
        missing_apps: platform
            .map(|platform| config::missing_apps(&settings, platform, &SystemProbe))
            .unwrap_or_default(),
        settings,
    }
}

/// What the connector looks like on this computer. Never starts a runtime.
#[tauri::command]
pub async fn cua_driver_status<R: Runtime>(
    webview: Webview<R>,
) -> Result<DesktopAppsStatus, String> {
    require_main(&webview)?;
    let state = global();
    let settings = state
        .as_ref()
        .map(|state| state.settings())
        .unwrap_or_default();
    let running = state
        .as_ref()
        .map(|state| state.runtimes.running())
        .unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        status_blocking(Platform::current(), settings, running)
    })
    .await
    .map_err(blocking_error)
}

/// A bundle id or program path as the confirmation shows it: format
/// characters (bidi controls, zero-width characters) written out as
/// `\u{…}`, so they can't reorder or hide what is being allowed.
fn visible_identity(identity: &str) -> String {
    identity
        .chars()
        .map(|character| {
            if config::is_format_char(character) || character.is_control() {
                format!("\\u{{{:04x}}}", u32::from(character))
            } else {
                character.to_string()
            }
        })
        .collect()
}

/// One line per widening, for the confirmation. The identity that was
/// checked comes first, before the name the app gave itself.
pub(crate) fn widening_lines(widening: &[Widening]) -> Vec<String> {
    widening
        .iter()
        .map(|item| match item {
            Widening::Enabled => crate::i18n::t("dialog.desktopAppsSettings.enabled"),
            Widening::App { name, identity } => crate::i18n::t_with(
                "dialog.desktopAppsSettings.app",
                &[("name", name), ("identity", &visible_identity(identity))],
            ),
            Widening::Site(origin) => {
                crate::i18n::t_with("dialog.desktopAppsSettings.site", &[("origin", origin)])
            }
            Widening::SignedIn(origin) => {
                crate::i18n::t_with("dialog.desktopAppsSettings.signedIn", &[("origin", origin)])
            }
            Widening::ScriptedControl => crate::i18n::t("dialog.desktopAppsSettings.scripted"),
            Widening::NoAsking => crate::i18n::t("dialog.desktopAppsSettings.noAsking"),
        })
        .collect()
}

/// Validates, confirms widening, stores and applies new settings.
///
/// One change runs at a time, from the first read of the settings to the
/// write, because the native question can wait for a long time. What it
/// confirms is checked again against the settings as they are when the answer
/// comes: if more would be widened by then, it asks again.
///
/// Narrowing and turning off return as soon as the settings are saved:
/// calls still waiting on a daemon are cancelled and the daemons stop in the
/// background.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn apply_settings(
    state: &Arc<CuaDriverState>,
    next: CuaDriverConfig,
    platform: Platform,
    probe: &dyn ExecutableProbe,
    own_exe: &str,
    driver_problem: Option<String>,
    mut confirm: impl FnMut(Vec<String>) -> BoxFuture<'static, bool>,
) -> Result<CuaDriverConfig, String> {
    let _applying = state.apply.lock().await;
    let current = state.settings();
    let next = config::validate_against(next, platform, probe, own_exe, &current)?;
    if next.enabled && !current.enabled {
        if let Some(problem) = driver_problem {
            return Err(problem);
        }
    }
    let mut confirmed: Vec<Widening> = Vec::new();
    loop {
        let widening = config::widening(&state.settings(), &next, platform);
        if widening.iter().all(|item| confirmed.contains(item)) {
            break;
        }
        if !confirm(widening_lines(&widening)).await {
            return Err(AppError::new("desktop_apps.change_declined").into());
        }
        confirmed = widening;
    }
    let widened = !confirmed.is_empty();
    let stored = next.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::config::update_config(|config| {
            config.cua_driver = stored;
            Ok(())
        })
    })
    .await
    .map_err(blocking_error)??;
    state.set_settings(next.clone());
    // A grant names a tool, not an app or a site: "Allow for this chat" on
    // clicks must not carry over to an app or site added since.
    if widened || !next.enabled {
        lock(&state.grants).clear_all();
    }
    let stop = if next.enabled {
        state.runtimes.stale_kinds()
    } else {
        RuntimeKind::ALL.to_vec()
    };
    if !stop.is_empty() {
        state.runtimes.cancel(&stop);
        let background = state.clone();
        super::spawn_background(async move {
            if background.settings().enabled {
                background.runtimes.stop_changed().await;
            } else {
                background.runtimes.stop_all().await;
            }
        });
    }
    super::log(format!(
        "desktop apps: settings saved ({} apps, {} sites, {})",
        next.apps.len(),
        next.sites.len(),
        if next.enabled { "on" } else { "off" }
    ));
    Ok(next)
}

fn native_confirm<R: Runtime>(
    app: AppHandle<R>,
) -> impl FnMut(Vec<String>) -> BoxFuture<'static, bool> {
    native_confirm_with(
        app,
        "dialog.desktopAppsSettings.title",
        "dialog.desktopAppsSettings.message",
    )
}

/// A native "Allow" / "Cancel" question with `title_key` and `message_key`,
/// listing what would be allowed.
fn native_confirm_with<R: Runtime>(
    app: AppHandle<R>,
    title_key: &'static str,
    message_key: &'static str,
) -> impl FnMut(Vec<String>) -> BoxFuture<'static, bool> {
    move |lines: Vec<String>| {
        let app = app.clone();
        Box::pin(async move {
            use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
            let mut message = crate::i18n::t(message_key);
            for line in lines.iter().take(MAX_CONFIRM_LINES) {
                message.push_str("\n• ");
                message.push_str(line);
            }
            if lines.len() > MAX_CONFIRM_LINES {
                message.push('\n');
                message.push_str(&crate::i18n::t_with(
                    "dialog.desktopAppsSettings.more",
                    &[("count", &(lines.len() - MAX_CONFIRM_LINES).to_string())],
                ));
            }
            let (sender, receiver) = tokio::sync::oneshot::channel();
            app.dialog()
                .message(message)
                .title(crate::i18n::t(title_key))
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    crate::i18n::t("dialog.desktopAppsSettings.confirm"),
                    crate::i18n::t("dialog.cancel"),
                ))
                .show(move |confirmed| {
                    let _ = sender.send(confirmed);
                });
            receiver.await.unwrap_or(false)
        }) as BoxFuture<'static, bool>
    }
}

/// Saves the settings. Widening asks natively; turning on needs the driver.
#[tauri::command]
pub async fn cua_driver_settings_set<R: Runtime>(
    webview: Webview<R>,
    app: AppHandle<R>,
    settings: CuaDriverConfig,
) -> Result<CuaDriverConfig, String> {
    require_main(&webview)?;
    let state = global().ok_or_else(unavailable)?;
    let platform = Platform::current().ok_or_else(unavailable)?;
    let driver_problem = if settings.enabled && !state.settings().enabled {
        tauri::async_runtime::spawn_blocking(move || match detect::detect_install(platform) {
            None => Some(detect::problem_error("not_installed", None)),
            Some(install) => install
                .problem(platform)
                .map(|problem| detect::problem_error(problem, Some(&install))),
        })
        .await
        .map_err(blocking_error)?
    } else {
        None
    };
    apply_settings(
        &state,
        settings,
        platform,
        &SystemProbe,
        &own_exe(),
        driver_problem,
        native_confirm(app),
    )
    .await
}

/// Apps on this computer for the picker (blocked ones included).
#[tauri::command]
pub async fn cua_driver_installed_apps<R: Runtime>(
    webview: Webview<R>,
) -> Result<Vec<InstalledApp>, String> {
    require_main(&webview)?;
    let platform = Platform::current().ok_or_else(unavailable)?;
    let apps = tauri::async_runtime::spawn_blocking(move || apps::list_installed_apps(platform))
        .await
        .map_err(blocking_error)?;
    super::icons::remember(&apps);
    Ok(apps)
}

/// Icons for the picker's rows, by row key, as data URLs. Only apps from the
/// last listing have one; the rest are left out.
#[tauri::command]
pub async fn cua_driver_app_icons<R: Runtime>(
    webview: Webview<R>,
    keys: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    require_main(&webview)?;
    tauri::async_runtime::spawn_blocking(move || super::icons::icons_for(&keys))
        .await
        .map_err(blocking_error)
}

/// "Choose another app…": a native file dialog, then the app it stands for.
#[tauri::command]
pub async fn cua_driver_pick_app<R: Runtime>(
    webview: Webview<R>,
    app: AppHandle<R>,
) -> Result<Option<InstalledApp>, String> {
    use tauri_plugin_dialog::DialogExt;
    require_main(&webview)?;
    let platform = Platform::current().ok_or_else(unavailable)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file();
    match platform {
        Platform::Macos => {
            dialog = dialog
                .add_filter(crate::i18n::t("dialog.agentProgram.filter"), &["app"])
                .set_directory("/Applications");
        }
        Platform::Windows => {
            dialog = dialog.add_filter(crate::i18n::t("dialog.agentProgram.filter"), &["exe"]);
        }
        Platform::Linux => {}
    }
    dialog.pick_file(move |selection| {
        let _ = sender.send(selection);
    });
    let Some(selection) = receiver
        .await
        .map_err(|_| crate::i18n::t("errors.approvalDialogClosed"))?
    else {
        return Ok(None);
    };
    let shown = selection.to_string();
    let path = selection.into_path().map_err(|_| {
        String::from(
            AppError::new("desktop_apps.app_invalid").param("name", picked_name(Path::new(&shown))),
        )
    })?;
    let name = picked_name(&path);
    let picked = tauri::async_runtime::spawn_blocking(move || match platform {
        Platform::Macos => apps::app_from_bundle(&path),
        Platform::Windows | Platform::Linux => apps::app_from_executable(platform, &path),
    })
    .await
    .map_err(blocking_error)?;
    match picked {
        Some(app) => Ok(Some(app)),
        None => Err(AppError::new("desktop_apps.app_invalid")
            .param("name", name)
            .into()),
    }
}

/// The picked file as an error names it: its file name, without control or
/// format characters.
fn picked_name(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let name: String = name
        .chars()
        .filter(|character| !character.is_control() && !config::is_format_char(*character))
        .take(120)
        .collect();
    if name.trim().is_empty() {
        crate::i18n::t("dialog.desktopApps.pickedFile")
    } else {
        name
    }
}

const SPACES_CREDENTIALS_ENV: &str = "CUA_SPACES_AGENT_CREDENTIALS_HOME";

/// Whether `server` runs Cua Spaces (`cua daemon mcp`).
pub(crate) fn is_spaces_server(server: &crate::config::McpServerConfig) -> bool {
    spaces_guards(server).is_some()
}

/// A Cua Spaces server (`cua daemon mcp`), and whether each of its guards is
/// on: read-only, and the user's agent sign-ins kept out.
fn spaces_guards(server: &crate::config::McpServerConfig) -> Option<(bool, bool)> {
    let crate::config::McpServerTransport::Stdio { command, args, env } = &server.transport else {
        return None;
    };
    let program = apps::file_name_lower(command);
    let spaces = matches!(program.as_str(), "cua" | "cua.exe")
        && args.first().map(String::as_str) == Some("daemon")
        && args.get(1).map(String::as_str) == Some("mcp");
    if !spaces {
        return None;
    }
    let read_only = args
        .windows(2)
        .any(|pair| pair[0] == "--permissions" && pair[1] == "spaces:readonly")
        || args
            .iter()
            .any(|arg| arg == "--permissions=spaces:readonly");
    let no_sign_ins = env
        .get(SPACES_CREDENTIALS_ENV)
        .is_some_and(|value| value == "none");
    Some((read_only, no_sign_ins))
}

/// What saving `next` over `stored` lets agents in Cua Spaces do that they
/// could not before, as confirmation lines. A server that is off, or not a
/// Spaces server, has every guard on.
pub(crate) fn spaces_widening(
    stored: Option<&crate::config::McpServerConfig>,
    next: &crate::config::McpServerConfig,
) -> Vec<String> {
    use crate::config::McpServerTransport;
    let guards = |server: Option<&crate::config::McpServerConfig>| {
        server
            .filter(|server| server.enabled)
            .and_then(spaces_guards)
            .unwrap_or((true, true))
    };
    // A stored value comes back from Settings as a marker; it means the
    // value is kept.
    let mut next = next.clone();
    if let (
        Some(McpServerTransport::Stdio {
            env: stored_env, ..
        }),
        McpServerTransport::Stdio { env, .. },
    ) = (stored.map(|stored| &stored.transport), &mut next.transport)
    {
        for (key, value) in env.iter_mut() {
            if value == crate::config::REDACTED {
                if let Some(previous) = stored_env.get(key) {
                    value.clone_from(previous);
                }
            }
        }
    }
    let (was_read_only, kept_sign_ins) = guards(stored);
    let (read_only, no_sign_ins) = guards(Some(&next));
    let mut lines = Vec::new();
    if was_read_only && !read_only {
        lines.push(crate::i18n::t("dialog.desktopAppsSettings.spacesChanges"));
    }
    if kept_sign_ins && !no_sign_ins {
        lines.push(crate::i18n::t("dialog.desktopAppsSettings.spacesSignIns"));
    }
    lines
}

/// Before an MCP server is saved: when the save gives agents in Cua Spaces
/// more power (changes, or the user's agent sign-ins), ask natively first,
/// as Desktop apps settings do. `stored_name` is the server being edited.
pub(crate) async fn confirm_spaces_change<R: Runtime>(
    app: &AppHandle<R>,
    stored_name: Option<&str>,
    next: &crate::config::McpServerConfig,
) -> Result<(), String> {
    // Only a Spaces server that runs can give more power.
    if !next.enabled || spaces_guards(next).is_none() {
        return Ok(());
    }
    let stored = match stored_name {
        Some(name) => {
            let name = name.to_string();
            tauri::async_runtime::spawn_blocking(move || {
                crate::config::read_config().ok().and_then(|config| {
                    config
                        .mcp_servers
                        .into_iter()
                        .find(|server| server.name == name)
                })
            })
            .await
            .map_err(blocking_error)?
        }
        None => None,
    };
    let lines = spaces_widening(stored.as_ref(), next);
    if lines.is_empty() {
        return Ok(());
    }
    let mut confirm = native_confirm_with(
        app.clone(),
        "dialog.desktopAppsSettings.spacesTitle",
        "dialog.desktopAppsSettings.spacesMessage",
    );
    if confirm(lines).await {
        Ok(())
    } else {
        Err(AppError::new("desktop_apps.change_declined").into())
    }
}

/// `confirm_spaces_change` for turning a stored server on or off.
pub(crate) async fn confirm_spaces_enabled<R: Runtime>(
    app: &AppHandle<R>,
    name: &str,
    enabled: bool,
) -> Result<(), String> {
    if !enabled {
        return Ok(());
    }
    let owned = name.to_string();
    let stored = tauri::async_runtime::spawn_blocking(move || {
        crate::config::read_config().ok().and_then(|config| {
            config
                .mcp_servers
                .into_iter()
                .find(|server| server.name == owned)
        })
    })
    .await
    .map_err(blocking_error)?;
    let Some(stored) = stored else {
        return Ok(());
    };
    let next = crate::config::McpServerConfig {
        enabled: true,
        ..stored
    };
    confirm_spaces_change(app, Some(name), &next).await
}

fn result_ok(result: &Value) -> (bool, Option<String>) {
    if result.get("isError").and_then(Value::as_bool) == Some(true) {
        let text = super::dispatch::outcome_from_result(result).text;
        (false, Some(text))
    } else {
        (true, None)
    }
}

/// Starts the runtimes (each passes the bounded self-check), asks the
/// desktop one for its health report, and runs the driver's doctor.
pub(crate) async fn run_test(
    state: &Arc<CuaDriverState>,
    platform: Platform,
) -> Result<DesktopAppsTestReport, String> {
    let settings = state.settings();
    if !settings.enabled {
        return Err(AppError::new("desktop_apps.start_failed")
            .param("detail", "Computer Use is off.")
            .into());
    }
    let mut runtimes = Vec::new();
    let desktop = state
        .runtimes
        .call(
            RuntimeKind::Desktop,
            "",
            "health_report",
            json!({}),
            CALL_TIMEOUT,
        )
        .await;
    runtimes.push(match desktop {
        Ok(result) => {
            let (ok, detail) = result_ok(&result);
            RuntimeTest {
                kind: RuntimeKind::Desktop,
                ok,
                detail,
            }
        }
        Err(error) => RuntimeTest {
            kind: RuntimeKind::Desktop,
            ok: false,
            detail: Some(error),
        },
    });
    let mut browser_kinds = Vec::new();
    if !settings.sites.is_empty() {
        browser_kinds.push(RuntimeKind::Browser);
    }
    if settings.sites.iter().any(|site| site.signed_in) {
        browser_kinds.push(RuntimeKind::SignedInBrowser);
    }
    for kind in browser_kinds {
        let started = state.runtimes.tools(kind).await;
        runtimes.push(RuntimeTest {
            kind,
            ok: started.is_ok(),
            detail: started.err(),
        });
    }
    let (version, problems) =
        tauri::async_runtime::spawn_blocking(move || match detect::detect_install(platform) {
            Some(install) => (
                install.version.map(detect::version_string),
                detect::doctor(&install.binary),
            ),
            None => (None, Vec::new()),
        })
        .await
        .map_err(blocking_error)?;
    Ok(DesktopAppsTestReport {
        ok: runtimes.iter().all(|runtime| runtime.ok),
        version,
        runtimes,
        problems,
    })
}

#[tauri::command]
pub async fn cua_driver_test<R: Runtime>(
    webview: Webview<R>,
) -> Result<DesktopAppsTestReport, String> {
    require_main(&webview)?;
    let state = global().ok_or_else(unavailable)?;
    let platform = Platform::current().ok_or_else(unavailable)?;
    run_test(&state, platform).await
}

/// The `desktop_apps` tool for the assistant, or `null` until the
/// connector is ready.
pub(crate) fn tool_spec(state: Option<&CuaDriverState>) -> Option<ToolMeta> {
    state.and_then(|state| super::policy::tool_meta(&state.settings()))
}

#[tauri::command]
pub async fn cua_driver_tool_spec<R: Runtime>(
    webview: Webview<R>,
) -> Result<Option<ToolMeta>, String> {
    require_main(&webview)?;
    Ok(tool_spec(global().as_deref()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cua_driver::config::{AllowedApp, AppRejection};
    use crate::cua_driver::gate::testing::ScriptedApprover;
    use crate::cua_driver::runtime::testing::NoDriver;
    use std::sync::Mutex;

    struct Echo;

    impl ExecutableProbe for Echo {
        fn check(&self, path: &str) -> Result<String, AppRejection> {
            Ok(path.to_string())
        }
    }

    fn app(name: &str, bundle_id: &str) -> AllowedApp {
        AllowedApp {
            name: name.into(),
            bundle_id: Some(bundle_id.into()),
            executable: None,
        }
    }

    fn state(config: CuaDriverConfig, root: &std::path::Path) -> Arc<CuaDriverState> {
        Arc::new(CuaDriverState::for_test(
            config,
            Arc::new(NoDriver),
            Arc::new(ScriptedApprover::default()),
            root.to_path_buf(),
        ))
    }

    /// A data folder for one test; it goes away with the guard.
    struct DataDir {
        _dir: tempfile::TempDir,
    }

    impl DataDir {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            std::env::set_var("OLEAFLY_DATA_DIR", dir.path());
            Self { _dir: dir }
        }
    }

    impl Drop for DataDir {
        fn drop(&mut self) {
            std::env::remove_var("OLEAFLY_DATA_DIR");
        }
    }

    fn never_asked() -> impl FnMut(Vec<String>) -> BoxFuture<'static, bool> {
        |lines: Vec<String>| -> BoxFuture<'static, bool> { panic!("asked: {lines:?}") }
    }

    fn answering(
        asked: Arc<Mutex<Vec<String>>>,
        answer: bool,
    ) -> impl FnMut(Vec<String>) -> BoxFuture<'static, bool> {
        move |lines: Vec<String>| -> BoxFuture<'static, bool> {
            asked.lock().unwrap().extend(lines);
            Box::pin(async move { answer })
        }
    }

    #[test]
    fn settings_commands_refuse_other_windows() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let _main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let preview = tauri::WebviewWindowBuilder::new(&app, "preview", Default::default())
            .build()
            .unwrap();
        let webview: Webview<tauri::test::MockRuntime> = preview.as_ref().clone();
        let handle = app.handle().clone();
        let refused = |result: Result<(), String>| {
            let error = result.unwrap_err();
            assert!(error.contains("desktop_apps.main_window"), "{error}");
        };
        tauri::async_runtime::block_on(async {
            refused(cua_driver_status(webview.clone()).await.map(|_| ()));
            refused(
                cua_driver_settings_set(
                    webview.clone(),
                    handle.clone(),
                    CuaDriverConfig::default(),
                )
                .await
                .map(|_| ()),
            );
            refused(cua_driver_installed_apps(webview.clone()).await.map(|_| ()));
            refused(
                cua_driver_app_icons(webview.clone(), Vec::new())
                    .await
                    .map(|_| ()),
            );
            refused(
                cua_driver_pick_app(webview.clone(), handle.clone())
                    .await
                    .map(|_| ()),
            );
            refused(cua_driver_test(webview.clone()).await.map(|_| ()));
            refused(cua_driver_tool_spec(webview.clone()).await.map(|_| ()));
        });
    }

    #[tokio::test]
    async fn enabling_without_the_driver_names_the_problem() {
        let dir = tempfile::tempdir().unwrap();
        let state = state(CuaDriverConfig::default(), dir.path());
        let next = CuaDriverConfig {
            enabled: true,
            ..Default::default()
        };
        let error = apply_settings(
            &state,
            next.clone(),
            Platform::Macos,
            &Echo,
            "oleafly",
            Some(detect::problem_error("not_installed", None)),
            never_asked(),
        )
        .await
        .unwrap_err();
        assert!(error.contains("desktop_apps.not_installed"), "{error}");

        let old = detect::DriverInstall {
            binary: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver".into(),
            app_bundle: Some("/Applications/CuaDriver.app".into()),
            version: Some((0, 35, 0)),
        };
        let error = apply_settings(
            &state,
            next,
            Platform::Macos,
            &Echo,
            "oleafly",
            Some(detect::problem_error("too_old", Some(&old))),
            never_asked(),
        )
        .await
        .unwrap_err();
        assert!(error.contains("desktop_apps.too_old"), "{error}");
        assert!(
            error.contains("0.35.0") && error.contains("0.36.0"),
            "{error}"
        );
        assert!(!state.settings().enabled);
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)] // env-lock fixture, as in the other app tests
    async fn widening_asks_natively_and_narrowing_does_not() {
        let _env = crate::paths::data_dir_env_lock();
        let _data = DataDir::new();
        let dir = tempfile::tempdir().unwrap();
        let start = CuaDriverConfig {
            enabled: true,
            apps: vec![app("Zotero", "org.zotero.zotero")],
            ..Default::default()
        };
        let state = state(start.clone(), dir.path());
        let widened = CuaDriverConfig {
            apps: vec![
                app("Zotero", "org.zotero.zotero"),
                app("Excel", "com.microsoft.Excel"),
            ],
            ..start.clone()
        };

        let asked = Arc::new(Mutex::new(Vec::new()));
        let declined = apply_settings(
            &state,
            widened.clone(),
            Platform::Macos,
            &Echo,
            "oleafly",
            None,
            answering(asked.clone(), false),
        )
        .await
        .unwrap_err();
        assert!(
            declined.contains("desktop_apps.change_declined"),
            "{declined}"
        );
        assert_eq!(state.settings(), start);
        assert_ne!(crate::config::read_config().unwrap().cua_driver, widened);

        let saved = apply_settings(
            &state,
            widened.clone(),
            Platform::Macos,
            &Echo,
            "oleafly",
            None,
            answering(asked.clone(), true),
        )
        .await
        .unwrap();
        assert_eq!(saved, widened);
        assert!(
            asked
                .lock()
                .unwrap()
                .iter()
                .any(|line| line == "App: com.microsoft.Excel (Excel)"),
            "{asked:?}"
        );
        assert_eq!(crate::config::read_config().unwrap().cua_driver, widened);

        // Removing an app only narrows: no question.
        apply_settings(
            &state,
            start.clone(),
            Platform::Macos,
            &Echo,
            "oleafly",
            None,
            never_asked(),
        )
        .await
        .unwrap();
        assert_eq!(state.settings(), start);
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)] // env-lock fixture, as in the other app tests
    async fn disabling_stops_every_runtime_and_forgets_grants() {
        let _env = crate::paths::data_dir_env_lock();
        let _data = DataDir::new();
        let dir = tempfile::tempdir().unwrap();
        let start = CuaDriverConfig {
            enabled: true,
            apps: vec![app("Zotero", "org.zotero.zotero")],
            ..Default::default()
        };
        let state = state(start.clone(), dir.path());
        lock(&state.grants).grant("chat:1", "click");
        let off = CuaDriverConfig {
            enabled: false,
            ..start
        };
        apply_settings(
            &state,
            off,
            Platform::Macos,
            &Echo,
            "oleafly",
            None,
            never_asked(),
        )
        .await
        .unwrap();
        assert!(!lock(&state.grants).has("chat:1", "click"));
        assert!(state.runtimes.running().is_empty());
        assert!(!crate::config::read_config().unwrap().cua_driver.enabled);
    }

    struct Gone(&'static str);

    impl ExecutableProbe for Gone {
        fn check(&self, path: &str) -> Result<String, AppRejection> {
            if path == self.0 {
                Err(AppRejection::NotFound)
            } else {
                Ok(path.to_string())
            }
        }
    }

    const SLACK: &str = r"C:\Users\a\AppData\Local\slack\app-4.35.0\slack.exe";

    fn program(name: &str, path: &str) -> AllowedApp {
        AllowedApp {
            name: name.into(),
            bundle_id: None,
            executable: Some(path.into()),
        }
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)] // env-lock fixture, as in the other app tests
    async fn a_program_that_went_away_never_stops_a_save_or_the_off_switch() {
        let _env = crate::paths::data_dir_env_lock();
        let _data = DataDir::new();
        let dir = tempfile::tempdir().unwrap();
        let start = CuaDriverConfig {
            enabled: true,
            apps: vec![program("Slack", SLACK)],
            ..Default::default()
        };
        let state = state(start.clone(), dir.path());
        let gone = Gone(SLACK);

        // A new website next to the stale app saves, and asks only about the site.
        let asked = Arc::new(Mutex::new(Vec::new()));
        let with_site = CuaDriverConfig {
            sites: vec![crate::cua_driver::config::AllowedSite {
                origin: "https://a.org".into(),
                signed_in: false,
            }],
            ..start.clone()
        };
        apply_settings(
            &state,
            with_site.clone(),
            Platform::Windows,
            &gone,
            "Oleafly.exe",
            None,
            answering(asked.clone(), true),
        )
        .await
        .unwrap();
        assert_eq!(*asked.lock().unwrap(), vec!["Website: https://a.org"]);

        // So does turning desktop apps off.
        let off = CuaDriverConfig {
            enabled: false,
            ..with_site
        };
        apply_settings(
            &state,
            off.clone(),
            Platform::Windows,
            &gone,
            "Oleafly.exe",
            None,
            never_asked(),
        )
        .await
        .unwrap();
        assert_eq!(state.settings(), off);
        assert!(!crate::config::read_config().unwrap().cua_driver.enabled);

        // A program that isn't there is still refused when it is new.
        let added = CuaDriverConfig {
            apps: vec![program("Slack", SLACK), program("Other", r"C:\o\other.exe")],
            ..off
        };
        let error = apply_settings(
            &state,
            added,
            Platform::Windows,
            &Gone(r"C:\o\other.exe"),
            "Oleafly.exe",
            None,
            never_asked(),
        )
        .await
        .unwrap_err();
        assert!(error.contains("desktop_apps.app_invalid"), "{error}");
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)] // env-lock fixture, as in the other app tests
    async fn one_settings_change_runs_at_a_time_and_asks_about_what_it_changes() {
        let _env = crate::paths::data_dir_env_lock();
        let _data = DataDir::new();
        let dir = tempfile::tempdir().unwrap();
        let start = CuaDriverConfig {
            enabled: true,
            apps: vec![app("Zotero", "org.zotero.zotero")],
            ..Default::default()
        };
        let state = state(start.clone(), dir.path());
        let with = |names: &[(&str, &str)]| CuaDriverConfig {
            apps: names.iter().map(|(name, id)| app(name, id)).collect(),
            ..start.clone()
        };
        let excel = with(&[
            ("Zotero", "org.zotero.zotero"),
            ("Excel", "com.microsoft.Excel"),
        ]);
        let word = with(&[
            ("Zotero", "org.zotero.zotero"),
            ("Word", "com.microsoft.Word"),
        ]);

        // The first change waits on its dialog; the second starts meanwhile.
        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let slow = {
            let events = events.clone();
            move |lines: Vec<String>| -> BoxFuture<'static, bool> {
                let events = events.clone();
                Box::pin(async move {
                    events
                        .lock()
                        .unwrap()
                        .push(format!("ask {}", lines.join("|")));
                    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                    events.lock().unwrap().push("answered".into());
                    true
                })
            }
        };
        let quick = {
            let events = events.clone();
            move |lines: Vec<String>| -> BoxFuture<'static, bool> {
                events
                    .lock()
                    .unwrap()
                    .push(format!("ask {}", lines.join("|")));
                Box::pin(async { true })
            }
        };
        let first = apply_settings(&state, excel, Platform::Macos, &Echo, "oleafly", None, slow);
        let second = async {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            apply_settings(
                &state,
                word.clone(),
                Platform::Macos,
                &Echo,
                "oleafly",
                None,
                quick,
            )
            .await
        };
        let (first, second) = tokio::join!(first, second);
        first.unwrap();
        second.unwrap();
        // The second did not ask until the first had been answered and saved,
        // and then asked only about its own addition.
        assert_eq!(
            *events.lock().unwrap(),
            vec![
                "ask App: com.microsoft.Excel (Excel)".to_string(),
                "answered".into(),
                "ask App: com.microsoft.Word (Word)".into(),
            ]
        );
        assert_eq!(state.settings(), word);
        assert_eq!(crate::config::read_config().unwrap().cua_driver, word);
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)] // env-lock fixture, as in the other app tests
    async fn it_asks_again_when_more_would_be_widened_by_the_time_of_the_answer() {
        let _env = crate::paths::data_dir_env_lock();
        let _data = DataDir::new();
        let dir = tempfile::tempdir().unwrap();
        let start = CuaDriverConfig {
            enabled: true,
            apps: vec![app("Zotero", "org.zotero.zotero")],
            ..Default::default()
        };
        let state = state(start.clone(), dir.path());
        let next = CuaDriverConfig {
            apps: vec![
                app("Zotero", "org.zotero.zotero"),
                app("Excel", "com.microsoft.Excel"),
            ],
            ..start
        };
        // While the first question is open, Zotero is removed from the
        // settings: saving `next` would now allow it again, which the
        // question never listed.
        let asked = Arc::new(Mutex::new(Vec::<Vec<String>>::new()));
        let confirm = {
            let asked = asked.clone();
            let state = state.clone();
            move |lines: Vec<String>| -> BoxFuture<'static, bool> {
                let mut asked = asked.lock().unwrap();
                if asked.is_empty() {
                    state.set_settings(CuaDriverConfig {
                        enabled: true,
                        ..Default::default()
                    });
                }
                asked.push(lines);
                Box::pin(async { true })
            }
        };
        apply_settings(
            &state,
            next.clone(),
            Platform::Macos,
            &Echo,
            "oleafly",
            None,
            confirm,
        )
        .await
        .unwrap();
        let asked = asked.lock().unwrap();
        assert_eq!(asked.len(), 2, "{asked:?}");
        assert_eq!(asked[0], vec!["App: com.microsoft.Excel (Excel)"]);
        assert_eq!(
            asked[1],
            vec![
                "App: org.zotero.zotero (Zotero)".to_string(),
                "App: com.microsoft.Excel (Excel)".into()
            ]
        );
        assert_eq!(state.settings(), next);
    }

    #[test]
    fn the_tool_spec_is_null_until_ready() {
        let dir = tempfile::tempdir().unwrap();
        assert!(tool_spec(None).is_none());
        let off = state(
            CuaDriverConfig {
                enabled: true,
                ..Default::default()
            },
            dir.path(),
        );
        assert!(tool_spec(Some(&off)).is_none());
        let on = state(
            CuaDriverConfig {
                enabled: true,
                apps: vec![app("Zotero", "org.zotero.zotero")],
                ..Default::default()
            },
            dir.path(),
        );
        assert_eq!(tool_spec(Some(&on)).unwrap().name, "desktop_apps");
    }

    #[test]
    fn widening_lines_name_each_change() {
        let lines = widening_lines(&[
            Widening::Enabled,
            Widening::App {
                name: "Excel".into(),
                identity: "com.microsoft.Excel".into(),
            },
            Widening::App {
                name: "Stata".into(),
                identity: r"C:\Program Files\Stata 18\StataSE-64.exe".into(),
            },
            Widening::Site("https://a.org".into()),
            Widening::SignedIn("https://a.org".into()),
            Widening::ScriptedControl,
        ]);
        assert_eq!(
            lines,
            vec![
                "Computer Use".to_string(),
                "App: com.microsoft.Excel (Excel)".into(),
                r"App: C:\Program Files\Stata 18\StataSE-64.exe (Stata)".into(),
                "Website: https://a.org".into(),
                "Your signed-in browser on https://a.org".into(),
                "Cua scripts".into(),
            ]
        );
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)] // env-lock fixture, as in the other app tests
    async fn adding_an_app_or_site_forgets_allow_for_this_chat() {
        let _env = crate::paths::data_dir_env_lock();
        let _data = DataDir::new();
        let dir = tempfile::tempdir().unwrap();
        let start = CuaDriverConfig {
            enabled: true,
            apps: vec![app("Zotero", "org.zotero.zotero")],
            ..Default::default()
        };
        let state = state(start.clone(), dir.path());
        lock(&state.grants).grant("chat:1", "desktop:click");
        // Saving without widening keeps the grant.
        apply_settings(
            &state,
            start.clone(),
            Platform::Macos,
            &Echo,
            "oleafly",
            None,
            never_asked(),
        )
        .await
        .unwrap();
        assert!(lock(&state.grants).has("chat:1", "desktop:click"));
        let widened = CuaDriverConfig {
            apps: vec![
                app("Zotero", "org.zotero.zotero"),
                app("Excel", "com.microsoft.Excel"),
            ],
            ..start
        };
        let asked = Arc::new(Mutex::new(Vec::new()));
        apply_settings(
            &state,
            widened,
            Platform::Macos,
            &Echo,
            "oleafly",
            None,
            answering(asked, true),
        )
        .await
        .unwrap();
        assert!(!lock(&state.grants).has("chat:1", "desktop:click"));
    }

    #[test]
    fn the_confirmation_writes_out_characters_that_could_hide_the_identity() {
        let lines = widening_lines(&[Widening::App {
            name: "Notes".into(),
            identity: "/home/u/bin/evil\u{202e}txt.notes".into(),
        }]);
        assert_eq!(
            lines,
            vec![r"App: /home/u/bin/evil\u{202e}txt.notes (Notes)"]
        );
    }

    #[test]
    fn a_picked_file_is_named_in_the_error() {
        assert_eq!(
            picked_name(Path::new("/Users/a/Desktop/run.command")),
            "run.command"
        );
        assert_eq!(
            picked_name(Path::new("C:\\Tools\\setup\u{202e}.exe")),
            if cfg!(windows) {
                "setup.exe".to_string()
            } else {
                r"C:\Tools\setup.exe".to_string()
            }
        );
        assert_eq!(picked_name(Path::new("/")), "the file you picked");
    }

    fn spaces(
        args: &[&str],
        env: &[(&str, &str)],
        enabled: bool,
    ) -> crate::config::McpServerConfig {
        crate::config::McpServerConfig {
            name: "Cua Spaces".into(),
            enabled,
            transport: crate::config::McpServerTransport::Stdio {
                command: "/Users/a/.local/bin/cua".into(),
                args: args.iter().map(|arg| (*arg).to_string()).collect(),
                env: env
                    .iter()
                    .map(|(name, value)| ((*name).to_string(), (*value).to_string()))
                    .collect(),
            },
        }
    }

    #[test]
    fn spaces_changes_and_sign_ins_need_a_native_yes() {
        let guarded = spaces(
            &["daemon", "mcp", "--permissions", "spaces:readonly"],
            &[(SPACES_CREDENTIALS_ENV, "none")],
            true,
        );
        let open = spaces(&["daemon", "mcp"], &[], true);
        // Connecting with both guards on asks nothing.
        assert!(spaces_widening(None, &guarded).is_empty());
        // Dropping either guard asks, whether added or edited.
        assert_eq!(
            spaces_widening(Some(&guarded), &open),
            vec![
                "Create and delete Spaces, and run commands in them".to_string(),
                "Use your Claude Code or Codex sign-in inside a Space".into()
            ]
        );
        assert_eq!(spaces_widening(None, &open).len(), 2);
        let sign_ins_only = spaces(
            &["daemon", "mcp", "--permissions", "spaces:readonly"],
            &[],
            true,
        );
        assert_eq!(
            spaces_widening(Some(&guarded), &sign_ins_only),
            vec!["Use your Claude Code or Codex sign-in inside a Space".to_string()]
        );
        // Narrowing, an unchanged open server and a stored value kept as a
        // marker ask nothing.
        assert!(spaces_widening(Some(&open), &guarded).is_empty());
        assert!(spaces_widening(Some(&open), &open).is_empty());
        let marker = spaces(
            &["daemon", "mcp", "--permissions", "spaces:readonly"],
            &[(SPACES_CREDENTIALS_ENV, crate::config::REDACTED)],
            true,
        );
        assert!(spaces_widening(Some(&guarded), &marker).is_empty());
        // A server that is off does nothing yet; turning it on is the change.
        let off = spaces(&["daemon", "mcp"], &[], false);
        assert!(spaces_widening(Some(&guarded), &off).is_empty());
        assert_eq!(spaces_widening(Some(&off), &open).len(), 2);
        // Other servers are not Spaces.
        let other = crate::config::McpServerConfig {
            transport: crate::config::McpServerTransport::Stdio {
                command: "npx".into(),
                args: vec!["daemon".into(), "mcp".into()],
                env: Default::default(),
            },
            ..open
        };
        assert!(spaces_widening(None, &other).is_empty());
    }

    #[test]
    fn status_without_a_platform_is_unsupported() {
        let status = status_blocking(None, CuaDriverConfig::default(), Vec::new());
        assert!(!status.supported);
        assert_eq!(status.driver_problem, Some("not_installed"));
        let json = serde_json::to_value(&status).unwrap();
        assert!(json.get("installCommand").is_some());
        assert!(json.get("spacesInstallLine").is_some());
        assert_eq!(json["missingApps"], serde_json::json!([]));
        assert_eq!(json["minimumVersion"], "0.36.0");
    }
}
