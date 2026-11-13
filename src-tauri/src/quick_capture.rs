use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

pub(crate) const WINDOW: &str = "quick-capture";
pub(crate) const FLAG: &str = "--quick-capture";
const SHOWN_EVENT: &str = "quick-capture:shown";
const OPEN_NOTES_EVENT: &str = "notes:quick-capture-open-notes";
const MAIN_WINDOW: &str = "main";
const URL: &str = "index.html?view=capture";
const SIZE: (f64, f64) = (460.0, 220.0);
const MIN_SIZE: (f64, f64) = (340.0, 150.0);

#[derive(Default)]
pub struct QuickCaptureState {
    shortcut: Mutex<Option<String>>,
    enabled: AtomicBool,
    requested: AtomicBool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RegisterFailure {
    Taken,
    Invalid,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickCaptureStatus {
    pub supported: bool,
    pub registered: bool,
    pub command: Option<String>,
    pub failure: Option<RegisterFailure>,
}

pub(crate) fn wayland_session(var: impl Fn(&str) -> Option<String>) -> bool {
    var("WAYLAND_DISPLAY").is_some_and(|display| !display.is_empty())
        || var("XDG_SESSION_TYPE").is_some_and(|kind| kind.eq_ignore_ascii_case("wayland"))
}

pub(crate) fn global_shortcuts_supported() -> bool {
    !cfg!(target_os = "linux") || !wayland_session(|name| std::env::var(name).ok())
}

pub(crate) fn requested_in<S: AsRef<str>>(args: &[S]) -> bool {
    args.iter().any(|arg| arg.as_ref() == FLAG)
}

pub(crate) fn launch_command(appimage: Option<String>, exe: Option<String>) -> Option<String> {
    let program = appimage.filter(|path| !path.is_empty()).or(exe)?;
    let quoted = if program.contains(' ') {
        format!("\"{program}\"")
    } else {
        program
    };
    Some(format!("{quoted} {FLAG}"))
}

fn this_launch_command() -> Option<String> {
    let exe = std::env::current_exe()
        .ok()
        .map(|path| path.to_string_lossy().into_owned());
    launch_command(std::env::var("APPIMAGE").ok(), exe)
}

pub(crate) fn failure_of(error: &tauri_plugin_global_shortcut::Error) -> RegisterFailure {
    match error {
        tauri_plugin_global_shortcut::Error::GlobalHotkey(_) => RegisterFailure::Taken,
        _ => RegisterFailure::Failed,
    }
}

pub(crate) fn parse_shortcut(
    accelerator: &str,
) -> Result<tauri_plugin_global_shortcut::Shortcut, RegisterFailure> {
    use std::str::FromStr;
    tauri_plugin_global_shortcut::Shortcut::from_str(accelerator.trim())
        .map_err(|_| RegisterFailure::Invalid)
}

fn show<R: Runtime>(window: &WebviewWindow<R>) {
    set_window_buttons(window, false);
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.emit(SHOWN_EVENT, ());
}

#[cfg(target_os = "macos")]
fn frameless<'a, R: Runtime>(
    builder: WebviewWindowBuilder<'a, R, AppHandle<R>>,
) -> WebviewWindowBuilder<'a, R, AppHandle<R>> {
    builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
}

#[cfg(not(target_os = "macos"))]
fn frameless<'a, R: Runtime>(
    builder: WebviewWindowBuilder<'a, R, AppHandle<R>>,
) -> WebviewWindowBuilder<'a, R, AppHandle<R>> {
    builder.decorations(false).shadow(true)
}

#[cfg(target_os = "macos")]
fn set_window_buttons<R: Runtime>(window: &WebviewWindow<R>, shown: bool) {
    use objc2_app_kit::{NSWindow, NSWindowButton};

    let target = window.clone();
    let _ = window.run_on_main_thread(move || {
        if objc2::MainThreadMarker::new().is_none() {
            return;
        }
        let Ok(pointer) = target.ns_window() else {
            return;
        };
        // SAFETY: `ns_window` is this window's NSWindow, which Tauri keeps
        // alive while the window exists, and we are on the main thread.
        let Some(ns_window) = (unsafe { pointer.cast::<NSWindow>().as_ref() }) else {
            return;
        };
        for kind in [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ] {
            if let Some(button) = ns_window.standardWindowButton(kind) {
                button.setHidden(!shown);
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn set_window_buttons<R: Runtime>(_window: &WebviewWindow<R>, _shown: bool) {}

fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let builder = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App(URL.into()))
        .title(crate::i18n::t("notes.quickCapture.title"))
        .inner_size(SIZE.0, SIZE.1)
        .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
        .resizable(true)
        .minimizable(false)
        .maximizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .visible(false)
        .center();
    let window = frameless(builder).build()?;
    let handle = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = handle.hide();
        }
    });
    show(&window);
    Ok(())
}

fn open_notes<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    crate::single_instance::reveal_main_window(app);
    app.emit_to(MAIN_WINDOW, OPEN_NOTES_EVENT, ())
}

pub(crate) fn toggle<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(WINDOW) {
        let open = window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false);
        if open {
            let _ = window.hide();
        } else {
            show(&window);
        }
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = build(&app) {
            let _ = crate::project::append_app_log(format!(
                "Could not open the quick capture window: {error}"
            ));
        }
    });
}

pub(crate) fn arrive<R: Runtime>(app: &AppHandle<R>, args: &[String]) -> bool {
    if !requested_in(args) {
        return false;
    }
    let Some(state) = app.try_state::<QuickCaptureState>() else {
        return false;
    };
    if !state.enabled.load(Ordering::Acquire) {
        return false;
    }
    toggle(app);
    true
}

pub(crate) fn note_launch_request(
    state: &QuickCaptureState,
    args: impl IntoIterator<Item = String>,
) {
    let args: Vec<String> = args.into_iter().collect();
    if requested_in(&args) {
        state.requested.store(true, Ordering::Release);
    }
}

fn unregister<R: Runtime>(app: &AppHandle<R>, state: &QuickCaptureState) {
    let previous = state
        .shortcut
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take();
    let (Some(previous), Some(shortcuts)) = (
        previous,
        app.try_state::<tauri_plugin_global_shortcut::GlobalShortcut<R>>(),
    ) else {
        return;
    };
    if let Ok(shortcut) = parse_shortcut(&previous) {
        let _ = shortcuts.unregister(shortcut);
    }
}

fn register<R: Runtime>(
    app: &AppHandle<R>,
    state: &QuickCaptureState,
    accelerator: &str,
) -> Result<(), RegisterFailure> {
    let shortcut = parse_shortcut(accelerator)?;
    let shortcuts = app
        .try_state::<tauri_plugin_global_shortcut::GlobalShortcut<R>>()
        .ok_or(RegisterFailure::Failed)?;
    shortcuts
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                toggle(app);
            }
        })
        .map_err(|error| failure_of(&error))?;
    *state
        .shortcut
        .lock()
        .unwrap_or_else(PoisonError::into_inner) = Some(shortcut.into_string());
    Ok(())
}

pub(crate) fn plugin() -> Option<tauri::plugin::TauriPlugin<tauri::Wry>> {
    global_shortcuts_supported().then(|| tauri_plugin_global_shortcut::Builder::new().build())
}

#[tauri::command]
pub async fn quick_capture_configure(
    app: AppHandle,
    state: tauri::State<'_, QuickCaptureState>,
    enabled: bool,
    accelerator: Option<String>,
) -> Result<QuickCaptureStatus, String> {
    let supported = global_shortcuts_supported();
    unregister(&app, &state);
    state.enabled.store(enabled, Ordering::Release);
    let wanted = accelerator.filter(|value| enabled && supported && !value.trim().is_empty());
    let failure = match wanted {
        Some(accelerator) => register(&app, &state, &accelerator).err(),
        None => None,
    };
    let registered = state
        .shortcut
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .is_some();
    if enabled && state.requested.swap(false, Ordering::AcqRel) {
        toggle(&app);
    }
    Ok(QuickCaptureStatus {
        supported,
        registered,
        command: this_launch_command(),
        failure,
    })
}

#[tauri::command]
pub async fn quick_capture_open(app: AppHandle) {
    toggle(&app);
}

#[tauri::command]
pub fn quick_capture_window_buttons(window: WebviewWindow, shown: bool) {
    if window.label() == WINDOW {
        set_window_buttons(&window, shown);
    }
}

#[tauri::command]
pub fn quick_capture_open_notes(app: AppHandle) -> Result<(), String> {
    open_notes(&app).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Listener;

    fn env(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |name| {
            pairs
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| (*value).to_string())
        }
    }

    #[test]
    fn a_wayland_session_is_found_from_its_display_or_session_type() {
        assert!(wayland_session(env(&[("WAYLAND_DISPLAY", "wayland-0")])));
        assert!(wayland_session(env(&[("XDG_SESSION_TYPE", "Wayland")])));
        assert!(!wayland_session(env(&[
            ("XDG_SESSION_TYPE", "x11"),
            ("DISPLAY", ":0")
        ])));
        assert!(!wayland_session(env(&[("WAYLAND_DISPLAY", "")])));
        assert!(!wayland_session(env(&[])));
    }

    #[test]
    fn only_the_exact_flag_asks_for_the_window() {
        assert!(requested_in(&["/usr/bin/oleafly", "--quick-capture"]));
        assert!(!requested_in(&["/usr/bin/oleafly", "--quick-capture=1"]));
        assert!(!requested_in(&[
            "/usr/bin/oleafly",
            "notes/--quick-capture"
        ]));
        assert!(!requested_in::<&str>(&[]));
    }

    #[test]
    fn the_launch_command_prefers_the_appimage_and_quotes_spaces() {
        assert_eq!(
            launch_command(
                Some("/home/me/Apps/Oleafly.AppImage".into()),
                Some("/tmp/.mount_x/oleafly".into())
            ),
            Some("/home/me/Apps/Oleafly.AppImage --quick-capture".into())
        );
        assert_eq!(
            launch_command(Some(String::new()), Some("/usr/bin/oleafly".into())),
            Some("/usr/bin/oleafly --quick-capture".into())
        );
        assert_eq!(
            launch_command(None, Some("/opt/My Apps/oleafly".into())),
            Some("\"/opt/My Apps/oleafly\" --quick-capture".into())
        );
        assert_eq!(launch_command(None, None), None);
    }

    #[test]
    fn a_refused_registration_reads_as_taken() {
        let taken = tauri_plugin_global_shortcut::Error::GlobalHotkey(
            "Unable to register hotkey: already in use".into(),
        );
        assert_eq!(failure_of(&taken), RegisterFailure::Taken);
        let lost = tauri_plugin_global_shortcut::Error::RecvError(std::sync::mpsc::RecvError);
        assert_eq!(failure_of(&lost), RegisterFailure::Failed);
    }

    #[test]
    fn the_accelerators_the_settings_send_parse() {
        for accelerator in [
            "Cmd+Shift+Alt+Space",
            "Ctrl+Shift+Alt+Space",
            "Ctrl+Alt+N",
            "Cmd+Shift+F12",
            " Ctrl+Shift+Digit1 ",
        ] {
            assert!(parse_shortcut(accelerator).is_ok(), "{accelerator}");
        }
        assert_eq!(parse_shortcut("Ctrl+Shift+"), Err(RegisterFailure::Invalid));
        assert_eq!(
            parse_shortcut("Hyper+Space+K"),
            Err(RegisterFailure::Invalid)
        );
    }

    #[test]
    fn opening_notes_asks_only_the_main_window() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let main = WebviewWindowBuilder::new(&app, MAIN_WINDOW, Default::default())
            .build()
            .unwrap();
        let capture = WebviewWindowBuilder::new(&app, WINDOW, Default::default())
            .build()
            .unwrap();
        let (sender, heard) = std::sync::mpsc::channel();
        let to_capture = sender.clone();
        main.listen(OPEN_NOTES_EVENT, move |_| {
            let _ = sender.send(MAIN_WINDOW);
        });
        capture.listen(OPEN_NOTES_EVENT, move |_| {
            let _ = to_capture.send(WINDOW);
        });
        open_notes(app.handle()).unwrap();
        assert_eq!(
            heard.recv_timeout(std::time::Duration::from_secs(5)),
            Ok(MAIN_WINDOW)
        );
        assert!(heard.try_recv().is_err());
    }

    #[test]
    fn a_launch_flag_waits_until_quick_capture_is_turned_on() {
        let state = QuickCaptureState::default();
        note_launch_request(&state, ["oleafly".to_string()]);
        assert!(!state.requested.load(Ordering::Acquire));
        note_launch_request(&state, ["oleafly".to_string(), FLAG.to_string()]);
        assert!(state.requested.load(Ordering::Acquire));
    }
}
