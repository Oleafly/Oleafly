#[cfg(any(windows, test))]
mod explorer_menu;
#[cfg(any(target_os = "linux", test))]
mod file_manager;
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
}

impl Context {
    fn of<R: Runtime>(app: &AppHandle<R>) -> Self {
        #[cfg(windows)]
        let _ = app;
        Self {
            #[cfg(not(windows))]
            identifier: app.config().identifier.clone(),
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
fn status(context: &Context) -> Result<Status, String> {
    let services = quick_action::services_dir()?;
    Ok(Status {
        platform: "macos",
        items: vec![quick_action_item(context, &services)],
    })
}

#[cfg(target_os = "macos")]
fn set(context: &Context, id: ItemId, enabled: bool) -> Result<Item, String> {
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
fn status(_context: &Context) -> Result<Status, String> {
    let expected = explorer_values()?;
    Ok(Status {
        platform: "windows",
        items: vec![Item::managed(
            ItemId::ExplorerMenu,
            explorer_menu::state(windows_registry::CURRENT_USER, "", &expected),
            ELSEWHERE,
        )],
    })
}

#[cfg(windows)]
fn set(_context: &Context, id: ItemId, enabled: bool) -> Result<Item, String> {
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
    let data_home = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .map_or_else(
            || crate::paths::home_dir().map(|home| home.join(".local/share")),
            Ok,
        )?;
    Ok(file_manager::Layout {
        exe,
        identifier: context.identifier.clone(),
        data_home,
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
fn status(context: &Context) -> Result<Status, String> {
    let layout = linux_layout(context)?;
    Ok(Status {
        platform: "linux",
        items: file_manager::status(&layout),
    })
}

#[cfg(target_os = "linux")]
fn set(context: &Context, id: ItemId, enabled: bool) -> Result<Item, String> {
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
    if crate::single_instance::should_enable(
        cfg!(debug_assertions),
        cfg!(feature = "e2e-testing"),
        std::env::var_os("OLEAFLY_DATA_DIR").as_deref(),
    ) {
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
