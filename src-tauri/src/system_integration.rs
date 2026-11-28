#[cfg(any(target_os = "macos", target_os = "linux", test))]
mod default_apps;
#[cfg(any(windows, test))]
mod explorer_menu;
#[cfg(any(target_os = "linux", test))]
mod file_manager;
#[cfg(any(target_os = "linux", test))]
mod launcher;
#[cfg(any(target_os = "macos", test))]
mod quick_action;
#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use tauri::{AppHandle, Runtime};

const PREFS_FILE: &str = "system-integration.json";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ItemId {
    QuickAction,
    ExplorerMenu,
    Dolphin,
    Nemo,
    Nautilus,
    FolderOpenWith,
    DefaultLatex,
    DefaultTypst,
    DefaultMarkdown,
    DefaultQuarto,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ItemState {
    Installed,
    NotInstalled,
    NeedsAttention,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct Item {
    pub(crate) id: ItemId,
    pub(crate) state: ItemState,
    pub(crate) packaged: bool,
    pub(crate) attention: Option<&'static str>,
    pub(crate) quick_actions_menu: Option<bool>,
    pub(crate) menu_title: Option<String>,
}

impl Item {
    #[cfg(any(target_os = "macos", windows))]
    fn managed(id: ItemId, state: ItemState, attention: &'static str) -> Self {
        Self {
            id,
            state,
            packaged: false,
            attention: (state == ItemState::NeedsAttention).then_some(attention),
            quick_actions_menu: None,
            menu_title: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct Status {
    pub(crate) platform: &'static str,
    pub(crate) items: Vec<Item>,
}

#[derive(Clone, Debug)]
struct Context {
    #[cfg(not(windows))]
    identifier: String,
    #[cfg(target_os = "linux")]
    product_name: Option<String>,
}

impl Context {
    fn of<R: Runtime>(app: &AppHandle<R>) -> Self {
        #[cfg(windows)]
        let _ = app;
        Self {
            #[cfg(not(windows))]
            identifier: app.config().identifier.clone(),
            #[cfg(target_os = "linux")]
            product_name: app.config().product_name.clone(),
        }
    }
}

fn prefs_path() -> Result<PathBuf, String> {
    Ok(crate::paths::oleafly_root()?.join(PREFS_FILE))
}

fn read_prefs_at(path: &Path) -> Map<String, Value> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| match value {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default()
}

fn update_prefs_at<T>(
    path: &Path,
    change: impl FnOnce(&mut Map<String, Value>) -> T,
) -> Result<T, String> {
    static LOCK: Mutex<()> = Mutex::new(());
    let _guard = LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    let before = read_prefs_at(path);
    let mut prefs = before.clone();
    let outcome = change(&mut prefs);
    if prefs != before {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let text =
            serde_json::to_vec_pretty(&Value::Object(prefs)).map_err(|error| error.to_string())?;
        crate::sandbox::atomic_write(path, &text)?;
    }
    Ok(outcome)
}

fn update_prefs<T>(change: impl FnOnce(&mut Map<String, Value>) -> T) -> Result<T, String> {
    update_prefs_at(&prefs_path()?, change)
}

#[cfg(any(windows, target_os = "linux"))]
fn read_prefs() -> Map<String, Value> {
    prefs_path()
        .map(|path| read_prefs_at(&path))
        .unwrap_or_default()
}

fn log(message: String) {
    let _ = crate::project::append_app_log(message);
}

#[cfg(target_os = "macos")]
const OFFERED_PREF: &str = "quick_action_offered";
#[cfg(target_os = "macos")]
const OUTDATED: &str = "outdated";

#[cfg(target_os = "macos")]
fn quick_action_item(context: &Context, services: &Path) -> Item {
    let state = quick_action::state(services, &context.identifier);
    let mut item = Item::managed(ItemId::QuickAction, state, OUTDATED);
    if state == ItemState::Installed {
        let (service_id, title) = quick_action::installed_service(
            services,
            &context.identifier,
            &crate::i18n::t("systemIntegration.openInOleafly"),
        );
        item.quick_actions_menu = quick_action::quick_actions_menu(&service_id, &title);
        item.menu_title = Some(title);
    }
    item
}

#[cfg(target_os = "macos")]
const NO_FILE_TYPE: &str = "no_file_type";

#[cfg(target_os = "macos")]
fn default_app_item(context: &Context, id: ItemId) -> Item {
    let state = match default_apps::mac_state(id, &context.identifier) {
        default_apps::MacState::Default => ItemState::Installed,
        default_apps::MacState::Other => ItemState::NotInstalled,
        default_apps::MacState::NoFileType => ItemState::NeedsAttention,
    };
    Item::managed(id, state, NO_FILE_TYPE)
}

#[cfg(target_os = "macos")]
fn status(context: &Context) -> Result<Status, String> {
    let services = quick_action::services_dir()?;
    let mut items = vec![quick_action_item(context, &services)];
    items.extend(
        default_apps::ITEMS
            .iter()
            .map(|id| default_app_item(context, *id)),
    );
    Ok(Status {
        platform: "macos",
        items,
    })
}

#[cfg(target_os = "macos")]
fn set(context: &Context, id: ItemId, enabled: bool) -> Result<Item, String> {
    if default_apps::ITEMS.contains(&id) {
        if !enabled {
            return Err("macOS keeps an app as the default until another app is chosen".into());
        }
        default_apps::mac_make_default(id, &context.identifier)?;
        return Ok(default_app_item(context, id));
    }
    if id != ItemId::QuickAction {
        return Err(format!("{id:?} is not available on macOS"));
    }
    let services = quick_action::services_dir()?;
    if enabled {
        let title = crate::i18n::t("systemIntegration.openInOleafly");
        quick_action::install(&services, &title, &context.identifier)?;
    } else {
        quick_action::remove(&services)?;
    }
    quick_action::refresh_services();
    Ok(quick_action_item(context, &services))
}

#[cfg(target_os = "macos")]
fn claim_offer(context: &Context) -> Result<bool, String> {
    let first = update_prefs(|prefs| {
        let offered = prefs
            .get(OFFERED_PREF)
            .and_then(Value::as_bool)
            .unwrap_or(false);
        prefs.insert(OFFERED_PREF.to_string(), Value::Bool(true));
        !offered
    })?;
    if !first {
        return Ok(false);
    }
    let services = quick_action::services_dir()?;
    Ok(quick_action::state(&services, &context.identifier) == ItemState::NotInstalled)
}

#[cfg(not(target_os = "macos"))]
fn claim_offer(_context: &Context) -> Result<bool, String> {
    Ok(false)
}

#[cfg(any(target_os = "linux", test))]
const DEFAULT_APPS_PREF: &str = "default_apps_claimed";

#[cfg(any(target_os = "linux", test))]
const DEFAULT_APPS_POLICY_PREF: &str = "default_apps_policy";

#[cfg(any(target_os = "linux", test))]
const DEFAULT_APPS_POLICY: u64 = 2;

#[cfg(any(target_os = "linux", test))]
fn undo_silent_markdown_claim_once(
    prefs: &Path,
    undo: impl FnOnce() -> Result<(), String>,
) -> Result<bool, String> {
    let current = read_prefs_at(prefs);
    let settled = current
        .get(DEFAULT_APPS_POLICY_PREF)
        .and_then(Value::as_u64)
        .is_some_and(|policy| policy >= DEFAULT_APPS_POLICY);
    if settled {
        return Ok(false);
    }
    let claimed = current
        .get(DEFAULT_APPS_PREF)
        .and_then(Value::as_bool)
        .unwrap_or(false);
    update_prefs_at(prefs, |prefs| {
        prefs.insert(
            DEFAULT_APPS_POLICY_PREF.to_string(),
            Value::from(DEFAULT_APPS_POLICY),
        )
    })?;
    if !claimed {
        return Ok(false);
    }
    undo()?;
    Ok(true)
}

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
fn integrates_with_the_system() -> bool {
    crate::single_instance::should_enable(
        cfg!(debug_assertions),
        cfg!(feature = "e2e-testing"),
        std::env::var_os("OLEAFLY_DATA_DIR").as_deref(),
    )
}

#[cfg(windows)]
const EXPLORER_MENU_PREF: &str = "explorer_menu";
#[cfg(windows)]
const ELSEWHERE: &str = "elsewhere";

#[cfg(windows)]
fn explorer_values() -> Result<Vec<explorer_menu::RegistryValue>, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let exe = explorer_menu::exe_text(&exe)
        .ok_or_else(|| "The app's path is not valid Unicode.".to_string())?;
    Ok(explorer_menu::verb_values(
        &exe,
        &crate::i18n::t("systemIntegration.openWithOleafly"),
    ))
}

#[cfg(windows)]
const WINDOWS_DEFAULT_TYPES: [(ItemId, &[&str]); 4] = [
    (ItemId::DefaultLatex, &["tex"]),
    (ItemId::DefaultTypst, &["typ"]),
    (ItemId::DefaultMarkdown, &["md", "markdown"]),
    (ItemId::DefaultQuarto, &["qmd", "Rmd"]),
];

#[cfg(windows)]
fn windows_user_choice(extension: &str) -> Option<String> {
    windows_registry::CURRENT_USER
        .open(format!(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.{extension}\\UserChoice"
        ))
        .ok()?
        .get_string("ProgId")
        .ok()
        .or_else(|| {
            windows_registry::CLASSES_ROOT
                .open(format!(".{extension}"))
                .ok()?
                .get_string("")
                .ok()
        })
}

#[cfg(windows)]
fn windows_default_item(id: ItemId, extensions: &[&str]) -> Item {
    let ours = extensions.iter().all(|extension| {
        windows_user_choice(extension)
            .is_some_and(|prog_id| prog_id.eq_ignore_ascii_case(&format!("Oleafly.{extension}")))
    });
    let state = if ours {
        ItemState::Installed
    } else {
        ItemState::NotInstalled
    };
    Item::managed(id, state, ELSEWHERE)
}

#[cfg(windows)]
fn open_windows_default_apps() -> Result<(), String> {
    let per_user = windows_registry::CURRENT_USER
        .open("Software\\RegisteredApplications")
        .and_then(|key| key.get_string("Oleafly"))
        .is_ok();
    let target = if per_user {
        "ms-settings:defaultapps?registeredAppUser=Oleafly"
    } else {
        "ms-settings:defaultapps?registeredAppMachine=Oleafly"
    };
    std::process::Command::new("explorer.exe")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(windows)]
fn status(_context: &Context) -> Result<Status, String> {
    let expected = explorer_values()?;
    let mut items = vec![Item::managed(
        ItemId::ExplorerMenu,
        explorer_menu::state(windows_registry::CURRENT_USER, "", &expected),
        ELSEWHERE,
    )];
    items.extend(
        WINDOWS_DEFAULT_TYPES
            .iter()
            .map(|(id, extensions)| windows_default_item(*id, extensions)),
    );
    Ok(Status {
        platform: "windows",
        items,
    })
}

#[cfg(windows)]
fn set(_context: &Context, id: ItemId, enabled: bool) -> Result<Item, String> {
    if let Some((_, extensions)) = WINDOWS_DEFAULT_TYPES.iter().find(|(item, _)| *item == id) {
        if !enabled {
            return Err("Windows keeps an app as the default until another app is chosen".into());
        }
        open_windows_default_apps()?;
        return Ok(windows_default_item(id, extensions));
    }
    if id != ItemId::ExplorerMenu {
        return Err(format!("{id:?} is not available on Windows"));
    }
    let expected = explorer_values()?;
    if enabled {
        explorer_menu::write(windows_registry::CURRENT_USER, "", &expected)?;
    } else {
        explorer_menu::remove(windows_registry::CURRENT_USER, "")?;
    }
    update_prefs(|prefs| prefs.insert(EXPLORER_MENU_PREF.to_string(), Value::Bool(enabled)))?;
    Ok(Item::managed(
        id,
        explorer_menu::state(windows_registry::CURRENT_USER, "", &expected),
        ELSEWHERE,
    ))
}

#[cfg(windows)]
fn repair() {
    let enabled = read_prefs()
        .get(EXPLORER_MENU_PREF)
        .and_then(Value::as_bool)
        .unwrap_or(true);
    if !enabled {
        return;
    }
    match explorer_values()
        .and_then(|expected| explorer_menu::write(windows_registry::CURRENT_USER, "", &expected))
    {
        Ok(true) => {
            log("The File Explorer menu entry was written for this copy of Oleafly.".into())
        }
        Ok(false) => {}
        Err(error) => log(format!(
            "The File Explorer menu entry could not be written: {error}"
        )),
    }
}

#[cfg(target_os = "linux")]
const NAUTILUS_PREF: &str = "nautilus_script";

#[cfg(any(target_os = "linux", test))]
const LAUNCHER_PREF: &str = "appimage_menu_entry";

#[cfg(target_os = "linux")]
fn linux_layout(context: &Context) -> Result<file_manager::Layout, String> {
    let exe = std::env::var_os("APPIMAGE")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .map_or_else(std::env::current_exe, Ok)
        .map_err(|error| error.to_string())?;
    let exe = exe
        .to_str()
        .ok_or_else(|| "The app's path is not valid Unicode.".to_string())?
        .to_string();
    Ok(file_manager::Layout {
        exe,
        identifier: context.identifier.clone(),
        data_home: data_home()?,
        system_share: PathBuf::from("/usr/share"),
        programs: file_manager::Programs::detect(),
        folder_handler_set: file_manager::folder_handler_is_set(),
        nautilus_script: read_prefs()
            .get(NAUTILUS_PREF)
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

#[cfg(target_os = "linux")]
fn data_home() -> Result<PathBuf, String> {
    launcher::data_home(std::env::var_os("XDG_DATA_HOME"), crate::paths::home_dir())
}

#[cfg(target_os = "linux")]
fn config_home() -> Result<PathBuf, String> {
    launcher::config_home(
        std::env::var_os("XDG_CONFIG_HOME"),
        crate::paths::home_dir(),
    )
}

/// GTK names the window after its program name, which Wayland desktops match to a desktop
/// entry. Tauri sets no GTK application id here (`enableGTKAppId` is off).
#[cfg(target_os = "linux")]
fn launcher() -> Option<launcher::Launcher> {
    launcher::from_env(
        |name| std::env::var_os(name),
        gtk::glib::prgname().map(|name| name.to_string()),
        std::env::current_exe().ok(),
        data_home(),
    )
}

#[cfg(target_os = "linux")]
fn sync_launcher(
    launcher: &launcher::Launcher,
    may_create: bool,
    prefs: Result<PathBuf, String>,
) -> Option<launcher::Outcome> {
    // Read at run time, so a launch-time sync that runs late keeps the icon picked meanwhile.
    let icon = crate::app_icon::current().png();
    prefs
        .and_then(|prefs| sync_launcher_at(launcher, icon, may_create, &prefs))
        .inspect_err(|error| log(format!("AppImage menu entry: {error}")))
        .ok()
}

#[cfg(target_os = "linux")]
fn appimage_desktop_id(
    launcher: &launcher::Launcher,
    prefs: Result<PathBuf, String>,
) -> Option<String> {
    let outcome = sync_launcher(launcher, true, prefs)?;
    if !matches!(
        outcome,
        launcher::Outcome::Written | launcher::Outcome::Current
    ) {
        return None;
    }
    if outcome == launcher::Outcome::Written {
        file_manager::refresh_desktop_database(Some(
            &launcher.data_home.join(file_manager::APPLICATIONS_DIR),
        ));
    }
    match launcher::sync_mime_package(&launcher.data_home) {
        Ok(true) => file_manager::refresh_mime_database(&launcher.data_home.join("mime")),
        Ok(false) => {}
        Err(error) => log(format!("AppImage file types: {error}")),
    }
    Some(format!("{}.desktop", launcher.app_id))
}

#[cfg(target_os = "linux")]
fn packaged_desktop_id(product_name: Option<String>, applications: &Path) -> Option<String> {
    product_name
        .map(|name| format!("{name}.desktop"))
        .filter(|id| applications.join(id).is_file())
}

#[cfg(target_os = "linux")]
fn settle_launch(
    launcher: Option<&launcher::Launcher>,
    product_name: Option<String>,
    claims: bool,
    applications: &Path,
    prefs: Result<PathBuf, String>,
    config_home: Result<PathBuf, String>,
) -> Option<String> {
    let desktop_id = match launcher {
        Some(launcher) => appimage_desktop_id(launcher, prefs.clone()),
        None => packaged_desktop_id(product_name, applications),
    }?;
    if !claims {
        return None;
    }
    let undone = prefs.and_then(|prefs| {
        undo_silent_markdown_claim_once(&prefs, || {
            default_apps::linux_undo_silent_markdown_claim(&config_home?, &desktop_id)
        })
    });
    match undone {
        Ok(true) => Some("Oleafly is no longer the default app for Markdown files.".into()),
        Ok(false) => None,
        Err(error) => Some(format!(
            "Oleafly could not hand Markdown files back to the previous app: {error}"
        )),
    }
}

/// Syncs the menu entry and notes in the prefs file at `prefs` that it was written, so a
/// deleted entry stays deleted. Without `may_create` (the icon changed) it never adds one.
#[cfg(any(target_os = "linux", test))]
fn sync_launcher_at(
    launcher: &launcher::Launcher,
    icon: &[u8],
    may_create: bool,
    prefs: &Path,
) -> Result<launcher::Outcome, String> {
    static LOCK: Mutex<()> = Mutex::new(());
    let _guard = LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    let wrote_before = !may_create
        || read_prefs_at(prefs)
            .get(LAUNCHER_PREF)
            .and_then(Value::as_bool)
            .unwrap_or(false);
    let outcome = launcher::sync(launcher, icon, wrote_before)?;
    if outcome == launcher::Outcome::Written {
        update_prefs_at(prefs, |prefs| {
            prefs.insert(LAUNCHER_PREF.to_string(), Value::Bool(true))
        })?;
    }
    Ok(outcome)
}

/// Puts the AppImage in the applications menu, so Wayland docks and taskbars show its icon.
#[cfg(target_os = "linux")]
pub(crate) fn install_launcher_at_launch(product_name: Option<String>) {
    let launcher = launcher();
    let claims = integrates_with_the_system();
    tauri::async_runtime::spawn_blocking(move || {
        let applications = Path::new("/usr/share/applications");
        let prefs = prefs_path();
        let settled = settle_launch(
            launcher.as_ref(),
            product_name,
            claims,
            applications,
            prefs,
            config_home(),
        );
        if let Some(message) = settled {
            log(message);
        }
    });
}

/// Gives the menu entry the icon picked under App icon, if Oleafly wrote that entry.
#[cfg(target_os = "linux")]
pub(crate) fn refresh_launcher_icon() {
    if let Some(launcher) = launcher() {
        tauri::async_runtime::spawn_blocking(move || {
            sync_launcher(&launcher, false, prefs_path());
        });
    }
}

#[cfg(target_os = "linux")]
fn installed_desktop_id(context: &Context) -> Option<String> {
    match launcher() {
        Some(launcher) => launcher
            .entry_path()
            .is_file()
            .then(|| format!("{}.desktop", launcher.app_id)),
        None => packaged_desktop_id(
            context.product_name.clone(),
            Path::new("/usr/share/applications"),
        ),
    }
}

#[cfg(target_os = "linux")]
fn linux_default_item(id: ItemId, desktop_id: &str) -> Result<Item, String> {
    let ours = default_apps::linux_state(&config_home()?, id, desktop_id)?;
    Ok(Item {
        id,
        state: if ours {
            ItemState::Installed
        } else {
            ItemState::NotInstalled
        },
        packaged: false,
        attention: None,
        quick_actions_menu: None,
        menu_title: None,
    })
}

#[cfg(target_os = "linux")]
fn status(context: &Context) -> Result<Status, String> {
    let layout = linux_layout(context)?;
    let mut items = file_manager::status(&layout);
    if let Some(desktop_id) = installed_desktop_id(context) {
        for id in default_apps::ITEMS {
            items.push(linux_default_item(id, &desktop_id)?);
        }
    }
    Ok(Status {
        platform: "linux",
        items,
    })
}

#[cfg(target_os = "linux")]
fn set(context: &Context, id: ItemId, enabled: bool) -> Result<Item, String> {
    if default_apps::ITEMS.contains(&id) {
        let desktop_id = installed_desktop_id(context)
            .ok_or_else(|| "Oleafly has no menu entry to open files with".to_string())?;
        default_apps::linux_set(&config_home()?, id, &desktop_id, enabled)?;
        return linux_default_item(id, &desktop_id);
    }
    let layout = linux_layout(context)?;
    let label = crate::i18n::t("systemIntegration.openWithOleafly");
    let recorded = file_manager::set(&layout, id, enabled, &label)?;
    if id == ItemId::Nautilus {
        update_prefs(|prefs| match recorded {
            Some(name) => prefs.insert(NAUTILUS_PREF.to_string(), Value::String(name)),
            None => prefs.remove(NAUTILUS_PREF),
        })?;
    }
    let layout = linux_layout(context)?;
    file_manager::item(&layout, id).ok_or_else(|| format!("{id:?} is not available here"))
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
fn status(_context: &Context) -> Result<Status, String> {
    Ok(Status {
        platform: "other",
        items: Vec::new(),
    })
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
fn set(_context: &Context, id: ItemId, _enabled: bool) -> Result<Item, String> {
    Err(format!("{id:?} is not available on this system"))
}

#[cfg(windows)]
pub(crate) fn repair_at_launch() {
    if integrates_with_the_system() {
        tauri::async_runtime::spawn_blocking(repair);
    }
}

async fn blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn system_integration_status(app: AppHandle) -> Result<Status, String> {
    let context = Context::of(&app);
    blocking(move || status(&context)).await
}

#[tauri::command]
pub async fn system_integration_set(
    app: AppHandle,
    item: ItemId,
    enabled: bool,
) -> Result<Item, String> {
    let context = Context::of(&app);
    blocking(move || {
        set(&context, item, enabled).inspect_err(|error| {
            log(format!(
                "System integration {item:?} (enable: {enabled}) failed: {error}"
            ));
        })
    })
    .await
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
const DEFAULT_APPS_OFFERED_PREF: &str = "default_apps_offered";

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn first_default_apps_offer() -> Result<bool, String> {
    update_prefs(|prefs| {
        let offered = prefs
            .get(DEFAULT_APPS_OFFERED_PREF)
            .and_then(Value::as_bool)
            .unwrap_or(false);
        prefs.insert(DEFAULT_APPS_OFFERED_PREF.to_string(), Value::Bool(true));
        !offered
    })
}

#[cfg(target_os = "macos")]
fn default_apps_offer(context: &Context) -> Result<Vec<ItemId>, String> {
    if !integrates_with_the_system() || !first_default_apps_offer()? {
        return Ok(Vec::new());
    }
    Ok(default_apps::ITEMS
        .into_iter()
        .filter(|id| {
            matches!(
                default_apps::mac_state(*id, &context.identifier),
                default_apps::MacState::Other
            )
        })
        .collect())
}

#[cfg(target_os = "linux")]
fn default_apps_offer(context: &Context) -> Result<Vec<ItemId>, String> {
    if !integrates_with_the_system() {
        return Ok(Vec::new());
    }
    let Some(desktop_id) = installed_desktop_id(context) else {
        return Ok(Vec::new());
    };
    if !first_default_apps_offer()? {
        return Ok(Vec::new());
    }
    let config_home = config_home()?;
    Ok(default_apps::ITEMS
        .into_iter()
        .filter(|id| !default_apps::linux_state(&config_home, *id, &desktop_id).unwrap_or(true))
        .collect())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn default_apps_offer(_context: &Context) -> Result<Vec<ItemId>, String> {
    Ok(Vec::new())
}

#[tauri::command]
pub async fn claim_default_apps_offer(app: AppHandle) -> Result<Vec<ItemId>, String> {
    let context = Context::of(&app);
    blocking(move || default_apps_offer(&context)).await
}

#[tauri::command]
pub async fn claim_quick_action_offer(app: AppHandle) -> Result<bool, String> {
    let context = Context::of(&app);
    blocking(move || claim_offer(&context)).await
}

#[cfg(target_os = "macos")]
pub(crate) fn lifecycle_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("system-integration")
        .on_event(|app, event| on_run_event(app, event))
        .build()
}

#[cfg(target_os = "macos")]
pub(crate) fn on_run_event<R: Runtime>(app: &AppHandle<R>, event: &tauri::RunEvent) {
    if matches!(event, tauri::RunEvent::Ready) {
        let context = Context::of(app);
        std::thread::spawn(move || {
            let Ok(services) = quick_action::services_dir() else {
                return;
            };
            if quick_action::state(&services, &context.identifier) == ItemState::Installed {
                quick_action::refresh_services();
            }
        });
        return;
    }
    if let tauri::RunEvent::Opened { urls } = event {
        crate::collab::links::arrive(
            app,
            crate::collab::links::links_in(urls.iter().map(|url| url.to_string())),
        );
        let entries = opened_entries(urls);
        if !entries.is_empty() {
            crate::open_request::arrive_targets(
                app,
                entries,
                None,
                crate::open_request::OpenSource::Os,
            );
        }
    }
}

#[cfg(any(target_os = "macos", test))]
pub(crate) fn opened_entries(urls: &[tauri::Url]) -> Vec<std::ffi::OsString> {
    urls.iter()
        .filter(|url| url.scheme().eq_ignore_ascii_case("file"))
        .map(|url| std::ffi::OsString::from(url.as_str()))
        .collect()
}

#[cfg(target_os = "macos")]
pub(crate) fn note_recent_folder<R: Runtime>(app: &AppHandle<R>, folder: &Path) {
    let Some(text) = folder.to_str().map(str::to_string) else {
        return;
    };
    let _ = app.run_on_main_thread(move || {
        use objc2::rc::Retained;
        use objc2::runtime::AnyObject;
        use objc2::{class, msg_send};
        use objc2_foundation::{NSString, NSURL};
        let url = NSURL::fileURLWithPath_isDirectory(&NSString::from_str(&text), true);
        let controller: Option<Retained<AnyObject>> =
            unsafe { msg_send![class!(NSDocumentController), sharedDocumentController] };
        if let Some(controller) = controller {
            let _: () = unsafe { msg_send![&*controller, noteNewRecentDocumentURL: &*url] };
        }
    });
}
