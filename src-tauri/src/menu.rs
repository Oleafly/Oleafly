#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};

use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::i18n::t;
#[cfg(not(target_os = "windows"))]
use crate::i18n::t_with;

const OPEN_RECENT_PREFIX: &str = "open_recent:";
const OPEN_RECENT_MENU: &str = "open_recent_menu";
const FILE_MENU: &str = "file_menu";
const OPEN_FOLDER_ITEM: &str = "open_folder";
const OPEN_FOLDER_ACCELERATOR: &str = "CmdOrCtrl+Shift+O";
const RECENT_LIMIT: usize = 10;
const VIEW_MENU: &str = "view_menu";
const TERMINAL_ACCELERATOR: &str = "Ctrl+`";
#[cfg(target_os = "linux")]
const BROWSER_ACCELERATOR: &str = "Ctrl+Alt+B";
#[cfg(not(target_os = "linux"))]
const BROWSER_ACCELERATOR: &str = "Ctrl+Shift+B";
const QUIT_ACCELERATOR: &str = "CmdOrCtrl+Q";
const APP_MENU: &str = "app_menu";
const QUIT_ITEM: &str = "quit_app";
const SETTINGS_ITEM: &str = "open_settings";
const SETTINGS_ACCELERATOR: &str = "CmdOrCtrl+,";
const SETTINGS_EVENT: &str = "settings:open";
const TOGGLE_TERMINAL_ITEM: &str = "toggle_terminal";
const TOGGLE_BROWSER_ITEM: &str = "toggle_browser";

static RECENT_PROJECTS: Mutex<Vec<RecentProject>> = Mutex::new(Vec::new());
static SHORTCUT_ACCELERATORS: Mutex<Option<ShortcutAccelerators>> = Mutex::new(None);
static BROWSER_SHORTCUTS_ENABLED: AtomicBool = AtomicBool::new(false);

struct BrowserShortcut {
    submenu: &'static str,
    id: &'static str,
    label: &'static str,
    accelerator: &'static str,
    key: char,
}

const BROWSER_SHORTCUTS: [BrowserShortcut; 4] = [
    BrowserShortcut {
        submenu: FILE_MENU,
        id: "browser_new_tab",
        label: "menu.newTab",
        accelerator: "CmdOrCtrl+T",
        key: 't',
    },
    BrowserShortcut {
        submenu: FILE_MENU,
        id: "browser_open_location",
        label: "menu.openLocation",
        accelerator: "CmdOrCtrl+L",
        key: 'l',
    },
    BrowserShortcut {
        submenu: FILE_MENU,
        id: "browser_close_tab",
        label: "menu.closeTab",
        accelerator: "CmdOrCtrl+W",
        key: 'w',
    },
    BrowserShortcut {
        submenu: VIEW_MENU,
        id: "browser_reload",
        label: "menu.reloadPage",
        accelerator: "CmdOrCtrl+R",
        key: 'r',
    },
];

#[derive(Clone, Debug, PartialEq, Eq)]
struct ShortcutAccelerators {
    terminal: String,
    browser: String,
    open_folder: String,
    settings: String,
}

fn shortcut_accelerators() -> ShortcutAccelerators {
    SHORTCUT_ACCELERATORS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone()
        .unwrap_or_else(|| ShortcutAccelerators {
            terminal: TERMINAL_ACCELERATOR.to_owned(),
            browser: BROWSER_ACCELERATOR.to_owned(),
            open_folder: OPEN_FOLDER_ACCELERATOR.to_owned(),
            settings: SETTINGS_ACCELERATOR.to_owned(),
        })
}

fn remember_shortcut_accelerators(
    terminal: &str,
    browser: &str,
    open_folder: Option<&str>,
    settings: Option<&str>,
) {
    let current = shortcut_accelerators();
    *SHORTCUT_ACCELERATORS
        .lock()
        .unwrap_or_else(PoisonError::into_inner) = Some(ShortcutAccelerators {
        terminal: terminal.to_owned(),
        browser: browser.to_owned(),
        open_folder: open_folder.map_or(current.open_folder, str::to_owned),
        settings: settings.map_or(current.settings, str::to_owned),
    });
}

fn recent_projects() -> Vec<RecentProject> {
    RECENT_PROJECTS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone()
}

fn recent_submenu<R: Runtime>(
    handle: &AppHandle<R>,
    recent: &[RecentProject],
) -> tauri::Result<Submenu<R>> {
    let submenu =
        SubmenuBuilder::with_id(handle, OPEN_RECENT_MENU, t("menu.openRecent")).build()?;
    fill_recent_submenu(handle, &submenu, recent)?;
    Ok(submenu)
}

fn fill_recent_submenu<R: Runtime>(
    handle: &AppHandle<R>,
    submenu: &Submenu<R>,
    recent: &[RecentProject],
) -> tauri::Result<()> {
    if recent.is_empty() {
        let empty = MenuItemBuilder::with_id("open_recent_empty", t("menu.noRecent"))
            .enabled(false)
            .build(handle)?;
        return submenu.append(&empty);
    }
    for project in recent {
        let item = MenuItemBuilder::with_id(
            format!("{OPEN_RECENT_PREFIX}{}", project.id),
            menu_label(&project.name),
        )
        .build(handle)?;
        submenu.append(&item)?;
    }
    Ok(())
}

fn menu_label(name: &str) -> String {
    name.replace('&', "&&")
}

pub fn build<R: Runtime>(handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let accelerators = shortcut_accelerators();
    let about = MenuItemBuilder::with_id("about", t("menu.about")).build(handle)?;
    let check_updates =
        MenuItemBuilder::with_id("check_updates", t("menu.checkUpdates")).build(handle)?;
    let reload_views =
        MenuItemBuilder::with_id("reload_views", t("menu.reloadViews")).build(handle)?;
    let restart_app =
        MenuItemBuilder::with_id("restart_app", t("menu.restartApp")).build(handle)?;
    let quit = MenuItemBuilder::with_id(QUIT_ITEM, t("menu.quit"))
        .accelerator(QUIT_ACCELERATOR)
        .build(handle)?;
    let settings = MenuItemBuilder::with_id(SETTINGS_ITEM, t("menu.settings"))
        .accelerator(&accelerators.settings)
        .build(handle)?;

    let open_folder = MenuItemBuilder::with_id(OPEN_FOLDER_ITEM, t("menu.openFolder"))
        .accelerator(&accelerators.open_folder)
        .build(handle)?;
    let open_recent = recent_submenu(handle, &recent_projects())?;
    let browser_enabled = BROWSER_SHORTCUTS_ENABLED.load(Ordering::Relaxed);
    let [new_tab, open_location, close_tab, reload_page] = BROWSER_SHORTCUTS.map(|shortcut| {
        MenuItemBuilder::with_id(shortcut.id, t(shortcut.label))
            .accelerator(shortcut.accelerator)
            .enabled(browser_enabled)
            .build(handle)
    });
    let (new_tab, open_location, close_tab, reload_page) =
        (new_tab?, open_location?, close_tab?, reload_page?);
    let file_menu = SubmenuBuilder::with_id(handle, FILE_MENU, t("menu.file"))
        .item(&open_folder)
        .item(&open_recent)
        .separator()
        .item(&new_tab)
        .item(&open_location)
        .item(&close_tab)
        .build()?;

    let app_menu = SubmenuBuilder::with_id(handle, APP_MENU, t("menu.app"))
        .item(&reload_views)
        .item(&restart_app)
        .separator()
        .item(&about)
        .item(&check_updates)
        .separator()
        .item(&settings)
        .separator();
    #[cfg(target_os = "macos")]
    let app_menu = app_menu
        .hide_with_text(t("menu.hide"))
        .hide_others_with_text(t("menu.hideOthers"))
        .show_all_with_text(t("menu.showAll"))
        .separator();
    let app_menu = app_menu.item(&quit).build()?;

    // Custom Undo/Redo instead of the predefined items, and deliberately with
    // NO accelerator. The predefined items bind Cmd/Ctrl+Z to the native
    // responder chain, which does nothing for the CodeMirror editor. Binding
    // the accelerator here instead is not portable either: macOS consumes the
    // key so the webview never sees it, but on Windows and Linux the menu and
    // the webview can both receive it, double-undoing. So the keystroke is
    // handled entirely in the webview (uniform on every platform) and these
    // items exist only as clickable Edit-menu entries that route to the same
    // editor history.
    let undo = MenuItemBuilder::with_id("edit_undo", t("menu.undo")).build(handle)?;
    let redo = MenuItemBuilder::with_id("edit_redo", t("menu.redo")).build(handle)?;
    let edit_menu = SubmenuBuilder::with_id(handle, "edit_menu", t("menu.edit"))
        .item(&undo)
        .item(&redo)
        .separator()
        .cut_with_text(t("menu.cut"))
        .copy_with_text(t("menu.copy"))
        .paste_with_text(t("menu.paste"))
        .select_all_with_text(t("menu.selectAll"))
        .build()?;

    let toggle_terminal = MenuItemBuilder::with_id(TOGGLE_TERMINAL_ITEM, t("menu.toggleTerminal"))
        .accelerator(&accelerators.terminal)
        .build(handle)?;
    let toggle_browser = MenuItemBuilder::with_id(TOGGLE_BROWSER_ITEM, t("menu.toggleBrowser"))
        .accelerator(&accelerators.browser)
        .build(handle)?;
    let view_menu = SubmenuBuilder::with_id(handle, VIEW_MENU, t("menu.view"))
        .item(&toggle_terminal)
        .item(&toggle_browser)
        .separator()
        .item(&reload_page)
        .build()?;

    let menu = MenuBuilder::new(handle)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu);
    #[cfg(target_os = "macos")]
    let menu = {
        let window_menu = SubmenuBuilder::new(handle, t("menu.window"))
            .minimize_with_text(t("menu.minimize"))
            .fullscreen_with_text(t("menu.fullscreen"))
            .separator()
            .bring_all_to_front_with_text(t("menu.bringAllToFront"))
            .build()?;
        window_menu.set_as_windows_menu_for_nsapp()?;
        menu.item(&window_menu)
    };
    menu.build()
}

pub fn rebuild<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
    }
    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Ok(menu) = build(&handle) {
                let _ = handle.set_menu(menu);
            }
        });
    }
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
pub struct RecentProject {
    id: String,
    name: String,
}

fn recent_target(id: &str) -> Option<&str> {
    id.strip_prefix(OPEN_RECENT_PREFIX)
        .filter(|project_id| crate::paths::validate_project_id(project_id).is_ok())
}

fn normalized_recent(projects: Vec<RecentProject>) -> Vec<RecentProject> {
    let mut kept: Vec<RecentProject> = Vec::new();
    for project in projects {
        if kept.len() == RECENT_LIMIT {
            break;
        }
        if crate::paths::validate_project_id(&project.id).is_ok()
            && kept.iter().all(|seen| seen.id != project.id)
        {
            kept.push(project);
        }
    }
    kept
}

#[tauri::command]
pub fn set_recent_projects(app: AppHandle, projects: Vec<RecentProject>) -> Result<(), String> {
    let recent = normalized_recent(projects);
    {
        let mut stored = RECENT_PROJECTS
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if *stored == recent {
            return Ok(());
        }
        stored.clone_from(&recent);
    }
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let Some(submenu) = handle
                .menu()
                .and_then(|menu| menu.get(FILE_MENU))
                .and_then(|item| item.as_submenu().cloned())
                .and_then(|file| file.get(OPEN_RECENT_MENU))
                .and_then(|item| item.as_submenu().cloned())
            else {
                return;
            };
            if let Ok(items) = submenu.items() {
                for item in items {
                    let _ = submenu.remove(&item);
                }
            }
            let _ = fill_recent_submenu(&handle, &submenu, &recent);
        })
        .map_err(|error| error.to_string())
    }
}

fn frontend_event(id: &str) -> Option<&'static str> {
    match id {
        TOGGLE_TERMINAL_ITEM => Some("menu://toggle-terminal"),
        TOGGLE_BROWSER_ITEM => Some("menu://toggle-browser"),
        "edit_undo" => Some("menu://undo"),
        "edit_redo" => Some("menu://redo"),
        OPEN_FOLDER_ITEM => Some("menu://open-folder"),
        _ => None,
    }
}

fn edits_main_document(id: &str) -> bool {
    matches!(id, "edit_undo" | "edit_redo")
}

fn main_window_focused<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.get_window("main")
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false)
}

fn dock_accelerator_updates<'a>(
    terminal: &'a str,
    browser: &'a str,
) -> [(&'static str, &'a str); 2] {
    [
        (TOGGLE_TERMINAL_ITEM, terminal),
        (TOGGLE_BROWSER_ITEM, browser),
    ]
}

fn unregistrable_accelerator<'a>(accelerators: &[&'a str]) -> Option<&'a str> {
    accelerators.iter().copied().find(|accelerator| {
        accelerator
            .parse::<muda::accelerator::Accelerator>()
            .is_err()
    })
}

fn paused_accelerators(
    accelerators: &ShortcutAccelerators,
) -> [(&'static str, &'static str, String); 5] {
    [
        (
            VIEW_MENU,
            TOGGLE_TERMINAL_ITEM,
            accelerators.terminal.clone(),
        ),
        (VIEW_MENU, TOGGLE_BROWSER_ITEM, accelerators.browser.clone()),
        (
            FILE_MENU,
            OPEN_FOLDER_ITEM,
            accelerators.open_folder.clone(),
        ),
        (APP_MENU, SETTINGS_ITEM, accelerators.settings.clone()),
        (APP_MENU, QUIT_ITEM, QUIT_ACCELERATOR.to_owned()),
    ]
}

#[cfg(not(target_os = "windows"))]
fn menu_item<R: Runtime>(
    menu: &Menu<R>,
    submenu: &str,
    id: &str,
) -> Result<tauri::menu::MenuItem<R>, String> {
    menu.get(submenu)
        .and_then(|item| item.as_submenu().cloned())
        .and_then(|submenu| submenu.get(id))
        .and_then(|item| item.as_menuitem().cloned())
        .ok_or_else(|| t_with("errors.menuItemUnavailable", &[("id", id)]))
}

fn browser_shortcut_key(id: &str) -> Option<char> {
    BROWSER_SHORTCUTS
        .iter()
        .find(|shortcut| shortcut.id == id)
        .map(|shortcut| shortcut.key)
}

pub fn set_browser_shortcuts_enabled<R: Runtime>(app: &AppHandle<R>, enabled: bool) {
    BROWSER_SHORTCUTS_ENABLED.store(enabled, Ordering::Relaxed);
    #[cfg(target_os = "windows")]
    {
        let _ = app;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let Some(menu) = app.menu() else {
            return;
        };
        for shortcut in BROWSER_SHORTCUTS {
            if let Ok(item) = menu_item(&menu, shortcut.submenu, shortcut.id) {
                let _ = item.set_enabled(enabled);
            }
        }
    }
}

#[tauri::command]
pub fn set_native_shortcuts_paused(app: AppHandle, paused: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = (app, paused);
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let menu = app.menu().ok_or_else(|| t("errors.menuUnavailable"))?;
        for (submenu, id, accelerator) in paused_accelerators(&shortcut_accelerators()) {
            menu_item(&menu, submenu, id)?
                .set_accelerator((!paused).then_some(accelerator))
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }
}

fn optional_accelerator_updates<'a>(
    open_folder: Option<&'a str>,
    settings: Option<&'a str>,
) -> Vec<(&'static str, &'static str, &'a str)> {
    [
        (FILE_MENU, OPEN_FOLDER_ITEM, open_folder),
        (APP_MENU, SETTINGS_ITEM, settings),
    ]
    .into_iter()
    .filter_map(|(submenu, id, accelerator)| Some((submenu, id, accelerator?)))
    .collect()
}

#[tauri::command]
pub fn set_dock_shortcut_accelerators(
    app: AppHandle,
    terminal_accelerator: String,
    browser_accelerator: String,
    open_folder_accelerator: Option<String>,
    settings_accelerator: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = (
            app,
            terminal_accelerator,
            browser_accelerator,
            open_folder_accelerator,
            settings_accelerator,
        );
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut requested = vec![terminal_accelerator.as_str(), browser_accelerator.as_str()];
        requested.extend(open_folder_accelerator.as_deref());
        requested.extend(settings_accelerator.as_deref());
        if let Some(accelerator) = unregistrable_accelerator(&requested) {
            return Err(format!("The menu cannot register {accelerator}."));
        }
        remember_shortcut_accelerators(
            &terminal_accelerator,
            &browser_accelerator,
            open_folder_accelerator.as_deref(),
            settings_accelerator.as_deref(),
        );
        let menu = app.menu().ok_or_else(|| t("errors.menuUnavailable"))?;
        for (id, accelerator) in
            dock_accelerator_updates(&terminal_accelerator, &browser_accelerator)
        {
            menu_item(&menu, VIEW_MENU, id)?
                .set_accelerator(Some(accelerator))
                .map_err(|error| error.to_string())?;
        }
        for (submenu, id, accelerator) in optional_accelerator_updates(
            open_folder_accelerator.as_deref(),
            settings_accelerator.as_deref(),
        ) {
            menu_item(&menu, submenu, id)?
                .set_accelerator(Some(accelerator))
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }
}

fn reload_views<R: Runtime>(app: &AppHandle<R>) {
    // Iterate windows and their webviews, not `webview_windows()`:
    // that map drops a window the moment it hosts a second webview,
    // as the browser window does, and Reload Views would skip it.
    for window in app.windows().values() {
        for webview in window.webviews() {
            let _ = webview.eval("window.location.reload()");
        }
    }
}

/// Route a menu click to the webview. The frontend listens for these events and
/// opens the matching in-app surface.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if app
        .try_state::<crate::updater::UpdateState>()
        .is_some_and(|state| state.installing())
    {
        return;
    }
    if let Some(event) = frontend_event(id) {
        if edits_main_document(id) && !main_window_focused(app) {
            return;
        }
        let _ = app.emit(event, ());
        return;
    }
    if let Some(key) = browser_shortcut_key(id) {
        crate::browser::route_shortcut_to_focused_window(app, key);
        return;
    }
    if let Some(project_id) = recent_target(id) {
        let _ = app.emit("menu://open-recent", project_id);
        return;
    }
    match id {
        "about" => {
            let _ = app.emit("menu://about", ());
        }
        "check_updates" => {
            let _ = app.emit("menu://check-updates", ());
        }
        SETTINGS_ITEM => {
            crate::single_instance::reveal_main_window(app);
            let _ = app.emit_to("main", SETTINGS_EVENT, ());
        }
        "reload_views" => {
            reload_views(app);
        }
        "restart_app" => {
            // A restart tears the webview down exactly like a quit, so it
            // must flush dirty buffers first; the frontend calls
            // `confirm_quit_flush { restart: true }` when the flush is done.
            if !crate::quit_gate::flush_confirmed() {
                let _ = app.emit("quit-flush-requested", true);
            } else {
                app.request_restart();
            }
        }
        "quit_app" => {
            // Cmd+Q flushes dirty buffers first (`quit-flush-requested`);
            // the TinyTeX install confirm then runs from `confirm_quit_flush`
            // so confirming it can no longer discard unsaved edits.
            if !crate::quit_gate::flush_confirmed() {
                let _ = app.emit("quit-flush-requested", false);
            } else if crate::latex_engine::install_in_progress()
                && !crate::latex_engine::quit_confirmed()
            {
                let _ = app.emit("tinytex-quit-blocked", ());
            } else {
                app.exit(0);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_dock_menu_items_to_frontend_events() {
        assert_eq!(
            frontend_event("toggle_terminal"),
            Some("menu://toggle-terminal")
        );
        assert_eq!(
            frontend_event("toggle_browser"),
            Some("menu://toggle-browser")
        );
        assert_eq!(frontend_event("edit_undo"), Some("menu://undo"));
        assert_eq!(frontend_event("edit_redo"), Some("menu://redo"));
        assert_eq!(frontend_event("unknown"), None);
    }

    #[test]
    fn a_rebuilt_menu_keeps_the_shortcuts_the_user_chose() {
        assert_eq!(shortcut_accelerators().terminal, TERMINAL_ACCELERATOR);
        remember_shortcut_accelerators("Cmd+J", "Cmd+Shift+K", None, None);
        assert_eq!(
            shortcut_accelerators(),
            ShortcutAccelerators {
                terminal: "Cmd+J".to_owned(),
                browser: "Cmd+Shift+K".to_owned(),
                open_folder: OPEN_FOLDER_ACCELERATOR.to_owned(),
                settings: SETTINGS_ACCELERATOR.to_owned(),
            }
        );
        remember_shortcut_accelerators("Cmd+J", "Cmd+Shift+K", Some("Cmd+Alt+O"), None);
        assert_eq!(shortcut_accelerators().open_folder, "Cmd+Alt+O");
        assert_eq!(shortcut_accelerators().settings, SETTINGS_ACCELERATOR);
        remember_shortcut_accelerators("Cmd+J", "Cmd+Shift+K", None, Some("Cmd+Alt+,"));
        assert_eq!(shortcut_accelerators().open_folder, "Cmd+Alt+O");
        assert_eq!(shortcut_accelerators().settings, "Cmd+Alt+,");
    }

    #[test]
    fn keys_the_menu_cannot_register_are_refused_before_anything_changes() {
        assert_eq!(unregistrable_accelerator(&["Ctrl+`", "Cmd+Shift+O"]), None);
        assert_eq!(
            unregistrable_accelerator(&["Ctrl+`", "Ctrl+Alt+\u{2020}", "Cmd+Shift+O"]),
            Some("Ctrl+Alt+\u{2020}")
        );
        assert_eq!(
            unregistrable_accelerator(&["Cmd+\u{f6}"]),
            Some("Cmd+\u{f6}")
        );
    }

    #[test]
    fn a_paused_recorder_frees_the_dock_open_folder_settings_and_quit_keys() {
        let paused = paused_accelerators(&ShortcutAccelerators {
            terminal: "Cmd+J".to_owned(),
            browser: "Cmd+Shift+K".to_owned(),
            open_folder: "Cmd+Alt+O".to_owned(),
            settings: "Cmd+,".to_owned(),
        });
        let items: Vec<_> = paused
            .iter()
            .map(|(menu, id, accelerator)| (*menu, *id, accelerator.as_str()))
            .collect();
        assert_eq!(
            items,
            [
                (VIEW_MENU, TOGGLE_TERMINAL_ITEM, "Cmd+J"),
                (VIEW_MENU, TOGGLE_BROWSER_ITEM, "Cmd+Shift+K"),
                (FILE_MENU, OPEN_FOLDER_ITEM, "Cmd+Alt+O"),
                (APP_MENU, SETTINGS_ITEM, "Cmd+,"),
                (APP_MENU, QUIT_ITEM, QUIT_ACCELERATOR),
            ]
        );
    }

    #[test]
    fn browser_shortcut_items_send_the_toolbar_its_own_keys() {
        assert_eq!(browser_shortcut_key("browser_new_tab"), Some('t'));
        assert_eq!(browser_shortcut_key("browser_open_location"), Some('l'));
        assert_eq!(browser_shortcut_key("browser_close_tab"), Some('w'));
        assert_eq!(browser_shortcut_key("browser_reload"), Some('r'));
        assert_eq!(browser_shortcut_key("toggle_browser"), None);
        for shortcut in BROWSER_SHORTCUTS {
            assert_eq!(
                unregistrable_accelerator(&[shortcut.accelerator]),
                None,
                "{}",
                shortcut.accelerator
            );
        }
    }

    #[test]
    fn only_undo_and_redo_wait_for_the_main_window() {
        assert!(edits_main_document("edit_undo"));
        assert!(edits_main_document("edit_redo"));
        for id in [
            "toggle_terminal",
            "toggle_browser",
            "open_folder",
            "open_settings",
            "about",
        ] {
            assert!(!edits_main_document(id), "{id}");
        }
    }

    #[test]
    fn routes_file_menu_items_to_frontend_events() {
        assert_eq!(frontend_event("open_folder"), Some("menu://open-folder"));
    }

    #[test]
    fn recent_project_names_keep_their_ampersands() {
        assert_eq!(menu_label("R&D notes"), "R&&D notes");
        assert_eq!(menu_label("A && B"), "A &&&& B");
        assert_eq!(menu_label("Thesis"), "Thesis");
    }

    #[test]
    fn the_open_folder_and_settings_shortcuts_follow_the_binding_when_one_is_sent() {
        assert_eq!(
            optional_accelerator_updates(Some("Cmd+Shift+O"), None),
            [(FILE_MENU, "open_folder", "Cmd+Shift+O")]
        );
        assert_eq!(
            optional_accelerator_updates(None, Some("Cmd+,")),
            [(APP_MENU, "open_settings", "Cmd+,")]
        );
        assert_eq!(
            optional_accelerator_updates(Some("Cmd+Shift+O"), Some("Ctrl+,")),
            [
                (FILE_MENU, "open_folder", "Cmd+Shift+O"),
                (APP_MENU, "open_settings", "Ctrl+,"),
            ]
        );
        assert!(optional_accelerator_updates(None, None).is_empty());
    }

    #[test]
    fn the_settings_shortcut_is_one_the_menu_can_register() {
        assert_eq!(
            unregistrable_accelerator(&[SETTINGS_ACCELERATOR, "Cmd+,", "Ctrl+Alt+,"]),
            None
        );
    }

    #[test]
    fn recent_items_name_only_valid_project_ids() {
        assert_eq!(
            recent_target("open_recent:linked-0123456789abcdef0123456789abcdef"),
            Some("linked-0123456789abcdef0123456789abcdef")
        );
        assert_eq!(recent_target("open_recent:thesis-1"), Some("thesis-1"));
        assert_eq!(recent_target("open_recent:../escape"), None);
        assert_eq!(recent_target("open_recent:"), None);
        assert_eq!(recent_target("open_folder"), None);
    }

    #[test]
    fn the_recent_list_keeps_ten_distinct_valid_projects_in_order() {
        let mut projects: Vec<RecentProject> = (0..14)
            .map(|index| RecentProject {
                id: format!("project-{index}"),
                name: format!("Project {index}"),
            })
            .collect();
        projects.insert(
            1,
            RecentProject {
                id: "../bad".into(),
                name: "Bad".into(),
            },
        );
        projects.insert(
            2,
            RecentProject {
                id: "project-0".into(),
                name: "Again".into(),
            },
        );
        let kept = normalized_recent(projects);
        assert_eq!(kept.len(), 10);
        assert_eq!(kept[0].name, "Project 0");
        assert_eq!(kept[1].id, "project-1");
        assert_eq!(kept[9].id, "project-9");
    }

    #[test]
    fn maps_accelerators_to_the_matching_menu_items() {
        assert_eq!(
            dock_accelerator_updates("Ctrl+`", "Ctrl+Shift+B"),
            [
                ("toggle_terminal", "Ctrl+`"),
                ("toggle_browser", "Ctrl+Shift+B"),
            ]
        );
    }
}
