use tauri::{Manager, Runtime, Webview};
use webview2_com::{
    AcceleratorKeyPressedEventHandler,
    Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_PHYSICAL_KEY_STATUS,
    },
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_MENU, VK_SHIFT};

fn shortcut_key(key: u32, control: bool, shift: bool, alt: bool) -> Option<char> {
    if !control || shift || alt {
        return None;
    }
    match key {
        0x4c => Some('l'),
        0x54 => Some('t'),
        0x57 => Some('w'),
        0x52 => Some('r'),
        _ => None,
    }
}

pub(super) fn install<R: Runtime>(pane: &Webview<R>, chrome_label: String) {
    let app = pane.app_handle().clone();
    // Remote pages have a separate webview and cannot send privileged IPC.
    // Handle actual native accelerators, then route only our four shortcuts
    // to the existing handler in the trusted browser toolbar.
    let result = pane.with_webview(move |platform| {
        let callback = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
            let mut key = 0;
            unsafe {
                args.KeyEventKind(&mut kind)?;
                args.VirtualKey(&mut key)?;
            }
            if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN {
                return Ok(());
            }
            let key = unsafe {
                shortcut_key(
                    key,
                    GetKeyState(VK_CONTROL as i32) < 0,
                    GetKeyState(VK_SHIFT as i32) < 0,
                    GetKeyState(VK_MENU as i32) < 0,
                )
            };
            let Some(key) = key else { return Ok(()) };
            let mut physical = COREWEBVIEW2_PHYSICAL_KEY_STATUS::default();
            unsafe {
                args.SetHandled(true)?;
                args.PhysicalKeyStatus(&mut physical)?;
            }
            if physical.WasKeyDown.as_bool() {
                return Ok(());
            }
            let app = app.clone();
            let chrome_label = chrome_label.clone();
            // Leave WebView2's synchronous accelerator callback before
            // changing focus or evaluating script in another controller.
            tauri::async_runtime::spawn(async move {
                if let Some(chrome) = app.get_webview(&chrome_label) {
                    let _ = chrome.set_focus();
                    let _ = chrome.eval(format!(
                        "window.dispatchEvent(new KeyboardEvent('keydown', {{key:'{key}',ctrlKey:true,bubbles:true,cancelable:true}}));"
                    ));
                }
            });
            Ok(())
        }));
        let mut token = 0;
        if let Err(error) = unsafe {
            platform
                .controller()
                .add_AcceleratorKeyPressed(&callback, &mut token)
        } {
            eprintln!("could not install browser shortcuts: {error}");
        }
        // The controller owns the callback until the tab is closed.
    });
    if let Err(error) = result {
        eprintln!("could not access browser shortcut controller: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::shortcut_key;

    #[test]
    fn routes_browser_accelerators_but_preserves_page_editing_shortcuts() {
        for (key, expected) in [(0x4c, 'l'), (0x54, 't'), (0x57, 'w'), (0x52, 'r')] {
            assert_eq!(shortcut_key(key, true, false, false), Some(expected));
            assert_eq!(shortcut_key(key, false, false, false), None);
            assert_eq!(shortcut_key(key, true, true, false), None);
            assert_eq!(shortcut_key(key, true, false, true), None);
        }
        for key in [0x41, 0x43, 0x56, 0x58, 0x5a, 0x25, 0x27] {
            assert_eq!(shortcut_key(key, true, false, false), None);
        }
    }
}
