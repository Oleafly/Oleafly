use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

/// Replaces Tauri's default menu with a trimmed app menu plus a standard Edit
/// menu. The Edit menu is required, not decorative: on macOS the native
/// predefined Copy/Paste/Cut/Select All/Undo/Redo items are what bind the
/// ⌘C/⌘V/⌘X/⌘A/⌘Z accelerators into the WKWebView; replacing the default menu
/// without it silently kills clipboard everywhere, including CodeMirror.
pub fn build<R: Runtime>(handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about = MenuItemBuilder::with_id("about", "About OpenLeaf").build(handle)?;
    let check_updates =
        MenuItemBuilder::with_id("check_updates", "Check for Updates…").build(handle)?;

    let app_menu = SubmenuBuilder::new(handle, "OpenLeaf")
        .item(&about)
        .separator()
        .item(&check_updates)
        .separator()
        .quit()
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
        _ => {}
    }
}
