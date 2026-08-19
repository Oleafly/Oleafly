use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub fn build<R: Runtime>(handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about = MenuItemBuilder::with_id("about", "About Oleafly").build(handle)?;
    let check_updates =
        MenuItemBuilder::with_id("check_updates", "Check for Updates…").build(handle)?;
    let reload_views = MenuItemBuilder::with_id("reload_views", "Reload Views").build(handle)?;
    let restart_app =
        MenuItemBuilder::with_id("restart_app", "Restart Application").build(handle)?;
    let quit = MenuItemBuilder::with_id("quit_app", "Quit Oleafly")
        .accelerator("CmdOrCtrl+Q")
        .build(handle)?;

    let app_menu = SubmenuBuilder::new(handle, "Oleafly")
        .item(&reload_views)
        .item(&restart_app)
        .separator()
        .item(&about)
        .item(&check_updates)
        .separator()
        .item(&quit)
        .build()?;

    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    MenuBuilder::new(handle)
        .item(&app_menu)
        .item(&edit_menu)
        .build()
}

/// Route a menu click to the webview. The frontend listens for these events and
/// opens the matching in-app surface.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "about" => {
            let _ = app.emit("menu://about", ());
        }
        "check_updates" => {
            let _ = app.emit("menu://check-updates", ());
        }
        "reload_views" => {
            for window in app.webview_windows().values() {
                let _ = window.reload();
            }
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
