#![cfg_attr(target_os = "windows", allow(dead_code))]

use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::i18n::{t, t_with};

pub fn build<R: Runtime>(handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about = MenuItemBuilder::with_id("about", t("menu.about")).build(handle)?;
    let check_updates =
        MenuItemBuilder::with_id("check_updates", t("menu.checkUpdates")).build(handle)?;
    let reload_views =
        MenuItemBuilder::with_id("reload_views", t("menu.reloadViews")).build(handle)?;
    let restart_app =
        MenuItemBuilder::with_id("restart_app", t("menu.restartApp")).build(handle)?;
    let quit = MenuItemBuilder::with_id("quit_app", t("menu.quit"))
        .accelerator("CmdOrCtrl+Q")
        .build(handle)?;

    let app_menu = SubmenuBuilder::with_id(handle, "app_menu", t("menu.app"))
        .item(&reload_views)
        .item(&restart_app)
        .separator()
        .item(&about)
        .item(&check_updates)
        .separator()
        .item(&quit)
        .build()?;

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

    let toggle_terminal = MenuItemBuilder::with_id("toggle_terminal", t("menu.toggleTerminal"))
        .accelerator("Ctrl+`")
        .build(handle)?;
    let toggle_browser = MenuItemBuilder::with_id("toggle_browser", t("menu.toggleBrowser"))
        .accelerator("Ctrl+Shift+B")
        .build(handle)?;
    let view_menu = SubmenuBuilder::with_id(handle, "view_menu", t("menu.view"))
        .item(&toggle_terminal)
        .item(&toggle_browser)
        .build()?;

    MenuBuilder::new(handle)
        .item(&app_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .build()
}

pub fn rebuild<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "windows")]
    {
        let _ = app;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Ok(menu) = build(&handle) {
                let _ = handle.set_menu(menu);
            }
        });
    }
}

fn frontend_event(id: &str) -> Option<&'static str> {
    match id {
        "toggle_terminal" => Some("menu://toggle-terminal"),
        "toggle_browser" => Some("menu://toggle-browser"),
        "edit_undo" => Some("menu://undo"),
        "edit_redo" => Some("menu://redo"),
        _ => None,
    }
}

fn dock_accelerator_updates<'a>(
    terminal: &'a str,
    browser: &'a str,
) -> [(&'static str, &'a str); 2] {
    [("toggle_terminal", terminal), ("toggle_browser", browser)]
}

#[tauri::command]
pub fn set_dock_shortcut_accelerators(
    app: AppHandle,
    terminal_accelerator: String,
    browser_accelerator: String,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = (app, terminal_accelerator, browser_accelerator);
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let menu = app.menu().ok_or_else(|| t("errors.menuUnavailable"))?;
        let view_menu = menu
            .get("view_menu")
            .and_then(|item| item.as_submenu().cloned())
            .ok_or_else(|| t("errors.viewMenuUnavailable"))?;
        for (id, accelerator) in
            dock_accelerator_updates(&terminal_accelerator, &browser_accelerator)
        {
            let item = view_menu
                .get(id)
                .and_then(|item| item.as_menuitem().cloned())
                .ok_or_else(|| t_with("errors.menuItemUnavailable", &[("id", id)]))?;
            item.set_accelerator(Some(accelerator))
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }
}

fn reload_views<R: Runtime>(app: &AppHandle<R>) {
    // Iterate windows and their webviews, not `webview_windows()`:
    // that map drops a window the moment it hosts a second webview
    // (the browser dock), which made Reload Views a silent no-op.
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
        let _ = app.emit(event, ());
        return;
    }
    match id {
        "about" => {
            let _ = app.emit("menu://about", ());
        }
        "check_updates" => {
            let _ = app.emit("menu://check-updates", ());
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
