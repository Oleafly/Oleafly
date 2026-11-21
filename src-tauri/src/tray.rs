use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Runtime};

const TRAY: &str = "quick-capture-tray";
const CAPTURE_ITEM: &str = "tray_quick_capture";
const OPEN_ITEM: &str = "tray_open_oleafly";
const QUIT_ITEM: &str = "tray_quit_oleafly";
#[cfg(target_os = "macos")]
const AUTOSAVE_NAME: &str = "oleafly-quick-capture";

#[cfg(target_os = "linux")]
const INDICATOR_LIBRARIES: [&str; 4] = [
    "libayatana-appindicator3.so.1",
    "libappindicator3.so.1",
    "libayatana-appindicator3.so",
    "libappindicator3.so",
];

#[cfg(target_os = "linux")]
fn indicator_available() -> bool {
    INDICATOR_LIBRARIES.iter().any(|name| {
        // SAFETY: loading the system's appindicator library runs only its
        // initialisers, the same load the tray itself does next.
        unsafe { libloading::Library::new(name) }.is_ok()
    })
}

#[cfg(not(target_os = "linux"))]
fn indicator_available() -> bool {
    true
}

fn log(message: String) {
    let _ = crate::project::append_app_log(message);
}

fn on_menu<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    match event.id().as_ref() {
        CAPTURE_ITEM => crate::quick_capture::toggle(app),
        OPEN_ITEM => crate::single_instance::reveal_main_window(app),
        QUIT_ITEM => {
            crate::single_instance::reveal_main_window(app);
            crate::menu::request_quit(app);
        }
        _ => {}
    }
}

#[cfg(target_os = "macos")]
fn remember_position<R: Runtime>(tray: &tauri::tray::TrayIcon<R>) {
    let named = tray.with_inner_tray_icon(|inner| {
        if let Some(item) = inner.ns_status_item() {
            item.setAutosaveName(Some(&objc2_foundation::NSString::from_str(AUTOSAVE_NAME)));
        }
    });
    if let Err(error) = named {
        log(format!("Could not name the tray icon: {error}"));
    }
}

fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(
                app,
                CAPTURE_ITEM,
                crate::i18n::t("notes.quickCapture.title"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                OPEN_ITEM,
                crate::i18n::t("tray.open"),
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                QUIT_ITEM,
                crate::i18n::t("menu.quit"),
                true,
                None::<&str>,
            )?,
        ],
    )?;
    let builder = TrayIconBuilder::with_id(TRAY)
        .menu(&menu)
        .tooltip(crate::i18n::t("menu.app"))
        .show_menu_on_left_click(true)
        .on_menu_event(on_menu);
    #[cfg(target_os = "macos")]
    let builder = builder
        .icon(tauri::image::Image::from_bytes(include_bytes!(
            "../icons/tray-template.png"
        ))?)
        .icon_as_template(true);
    #[cfg(not(target_os = "macos"))]
    let builder = match app.default_window_icon() {
        Some(icon) => builder.icon(icon.clone()),
        None => builder,
    };
    let tray = builder.build(app)?;
    #[cfg(target_os = "macos")]
    remember_position(&tray);
    #[cfg(not(target_os = "macos"))]
    drop(tray);
    Ok(())
}

pub(crate) fn show<R: Runtime>(app: &AppHandle<R>, shown: bool) {
    if shown && !indicator_available() {
        log("The tray icon was skipped: this system has no appindicator library.".into());
        return;
    }
    let handle = app.clone();
    let queued = app.run_on_main_thread(move || {
        if !shown {
            drop(handle.remove_tray_by_id(TRAY));
            return;
        }
        if handle.tray_by_id(TRAY).is_some() {
            return;
        }
        if let Err(error) = build(&handle) {
            log(format!("Could not add the tray icon: {error}"));
        }
    });
    if let Err(error) = queued {
        log(format!("Could not change the tray icon: {error}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::menu::MenuId;
    use tauri::Listener;

    fn pick(app: &tauri::App<tauri::test::MockRuntime>, id: &str) {
        on_menu(
            app.handle(),
            MenuEvent {
                id: MenuId::new(id),
            },
        );
    }

    #[test]
    fn only_quit_in_the_tray_menu_goes_through_the_save_check() {
        let app = tauri::test::mock_app();
        let (sender, heard) = std::sync::mpsc::channel();
        app.listen_any("quit-flush-requested", move |event| {
            let _ = sender.send(event.payload().to_owned());
        });
        pick(&app, OPEN_ITEM);
        pick(&app, "elsewhere");
        assert!(heard.try_recv().is_err());
        pick(&app, QUIT_ITEM);
        assert_eq!(
            heard.recv_timeout(std::time::Duration::from_secs(5)),
            Ok("false".to_owned())
        );
    }

    #[test]
    fn turning_background_capture_off_leaves_no_tray_icon() {
        let app = tauri::test::mock_app();
        show(app.handle(), false);
        assert!(app.tray_by_id(TRAY).is_none());
    }
}
