use tauri::{Runtime, Webview};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Controller, ICoreWebView2Settings3, COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC,
};
use windows_core::Interface;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows_sys::Win32::UI::WindowsAndMessaging::{WM_NCDESTROY, WM_SETFOCUS};

const SUBCLASS_ID: usize = 0x4f4c_4643;

pub(crate) fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("oleafly-webview-focus")
        .on_webview_ready(|webview| forward_window_focus(&webview))
        .build()
}

fn forward_window_focus<R: Runtime>(webview: &Webview<R>) {
    let window = webview.window();
    if webview.label() != window.label() {
        return;
    }
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let hwnd = hwnd.0 as usize;
    let _ = webview.with_webview(move |platform| {
        if !cfg!(debug_assertions) {
            let _ = disable_browser_keys(&platform.controller());
        }
        let controller = Box::into_raw(Box::new(platform.controller()));
        let installed = unsafe {
            SetWindowSubclass(
                hwnd as HWND,
                Some(forward_focus),
                SUBCLASS_ID,
                controller as usize,
            )
        };
        if installed == 0 {
            drop(unsafe { Box::from_raw(controller) });
        }
    });
}

fn disable_browser_keys(controller: &ICoreWebView2Controller) -> windows_core::Result<()> {
    unsafe {
        controller
            .CoreWebView2()?
            .Settings()?
            .cast::<ICoreWebView2Settings3>()?
            .SetAreBrowserAcceleratorKeysEnabled(false)
    }
}

unsafe extern "system" fn forward_focus(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    data: usize,
) -> LRESULT {
    let controller = data as *mut ICoreWebView2Controller;
    match message {
        WM_SETFOCUS if !controller.is_null() => {
            let _ = unsafe { (*controller).MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC) };
        }
        WM_NCDESTROY => unsafe {
            RemoveWindowSubclass(hwnd, Some(forward_focus), SUBCLASS_ID);
            if !controller.is_null() {
                drop(Box::from_raw(controller));
            }
        },
        _ => {}
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}
