//! Keeps the webview of Oleafly's own windows (main, preview, update) the
//! size of its window on macOS (issue #169).
//!
//! The `unstable` Tauri feature makes every window's webview a child view.
//! Tauri then sizes that view itself on each tao `Resized` event, converting
//! the event's physical size back to points with the scale factor the window
//! has when Tauri gets to the event, not the one it had when the size was
//! measured. When a display wakes up, a resize can be measured at 1x and
//! handled at 2x. The
//! webview is then set to exactly half the window's width and height, pinned
//! top-left, and nothing sets it back.
//!
//! For windows whose only webview fills the window, this module turns that
//! resizing off and gives the WKWebView a width and height autoresizing mask,
//! so AppKit sizes it in points with no scale conversion. That is how these
//! windows behaved before `unstable` (0.3.x). As a safety net, focus, scale
//! and resize events check the frame, put it back if it drifted, and write a
//! line to app.log when they do.

const FILLING_WINDOWS: [&str; 5] = ["main", "preview", "update", "presentation", "presenter"];

const ADMIN_CONSOLE_PREFIX: &str = "admin-console-";

const TOLERANCE_POINTS: f64 = 0.5;

#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "e2e-testing", derive(serde::Serialize))]
pub(crate) struct Frame {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

pub(crate) fn fills_window(label: &str) -> bool {
    FILLING_WINDOWS.contains(&label)
        || label
            .strip_prefix(ADMIN_CONSOLE_PREFIX)
            .is_some_and(|server| !server.is_empty())
}

/// The frame the webview needs to fill `container` (its superview's bounds),
/// or `None` when it already fills it. Also `None` when the container has no
/// usable size, as happens while a window is created or torn down.
pub(crate) fn corrected_frame(frame: Frame, container: Frame) -> Option<Frame> {
    let values = [
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        container.x,
        container.y,
        container.width,
        container.height,
    ];
    if values.iter().any(|value| !value.is_finite())
        || container.width <= 0.0
        || container.height <= 0.0
    {
        return None;
    }
    let off = |a: f64, b: f64| (a - b).abs() > TOLERANCE_POINTS;
    let wrong = off(frame.x, container.x)
        || off(frame.y, container.y)
        || off(frame.width, container.width)
        || off(frame.height, container.height);
    wrong.then_some(container)
}

pub(crate) fn correction_log_line(
    label: &str,
    trigger: &str,
    old: Frame,
    new: Frame,
    scale: f64,
) -> String {
    format!(
        "Webview frame corrected in the {label} window on {trigger}: {} -> {} points, backing scale {scale}",
        describe(old),
        describe(new),
    )
}

fn describe(frame: Frame) -> String {
    format!(
        "{}x{} at ({}, {})",
        frame.width, frame.height, frame.x, frame.y
    )
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{corrected_frame, correction_log_line, fills_window, Frame};
    use dispatch2::DispatchQueue;
    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAutoresizingMaskOptions, NSResponder, NSView, NSWindow};
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use tauri::webview::PlatformWebview;
    use tauri::{Manager, Webview, Window, WindowEvent};

    pub(super) struct Hosted<'a> {
        pub(super) view: &'a NSView,
        pub(super) container: Retained<NSView>,
        pub(super) window: Retained<NSWindow>,
    }

    /// Finds the WKWebView behind `platform` and the view it should fill.
    ///
    /// Returns `None` off the main thread, and when the webview is not
    /// directly in its window's content view. WebKit moves it into a window
    /// of its own for element fullscreen (the PDF fullscreen button) and
    /// sizes it there itself.
    pub(super) fn hosted(platform: &PlatformWebview) -> Option<Hosted<'_>> {
        // Tauri runs `with_webview` closures on the main thread. Check
        // anyway: AppKit views must not be touched from any other thread.
        MainThreadMarker::new()?;
        // SAFETY: on macOS `inner()` is the webview's WKWebView, an NSView
        // subclass that stays alive while the `with_webview` closure runs,
        // and we are on the main thread. The borrow does not outlive
        // `platform`.
        let view = unsafe { platform.inner().cast::<NSView>().as_ref() }?;
        let window = view.window()?;
        let container = window.contentView()?;
        // SAFETY: `superview` hands back a retained reference, and `view`
        // is alive for the duration of the call.
        let superview = unsafe { view.superview() }?;
        std::ptr::eq(&*superview, &*container).then_some(Hosted {
            view,
            container,
            window,
        })
    }

    pub(super) fn frame_of(rect: NSRect) -> Frame {
        Frame {
            x: rect.origin.x,
            y: rect.origin.y,
            width: rect.size.width,
            height: rect.size.height,
        }
    }

    pub(super) fn ns_rect(frame: Frame) -> NSRect {
        NSRect::new(
            NSPoint::new(frame.x, frame.y),
            NSSize::new(frame.width, frame.height),
        )
    }

    pub(super) fn correct(hosted: &Hosted<'_>, label: &str, trigger: &str) {
        let frame = frame_of(hosted.view.frame());
        let Some(target) = corrected_frame(frame, frame_of(hosted.container.bounds())) else {
            return;
        };
        hosted.view.setFrame(ns_rect(target));
        log(correction_log_line(
            label,
            trigger,
            frame,
            target,
            hosted.window.backingScaleFactor(),
        ));
    }

    fn claim_keyboard(hosted: &Hosted<'_>) {
        let lost = hosted.window.firstResponder().is_none_or(|responder| {
            let responder: *const NSResponder = &*responder;
            let container: *const NSView = &*hosted.container;
            let window: *const NSWindow = &*hosted.window;
            responder.cast::<()>() == container.cast::<()>()
                || responder.cast::<()>() == window.cast::<()>()
        });
        if lost {
            hosted.window.makeFirstResponder(Some(hosted.view));
        }
    }

    fn claim_keyboard_later(window: &Window) {
        let app = window.app_handle().clone();
        let label = window.label().to_owned();
        DispatchQueue::main().exec_async(move || {
            let Some(webview) = app.get_webview(&label) else {
                return;
            };
            let _ = webview.with_webview(|platform| {
                if let Some(hosted) = hosted(&platform) {
                    claim_keyboard(&hosted);
                }
            });
        });
    }

    fn log(line: String) {
        tauri::async_runtime::spawn_blocking(move || {
            let _ = crate::project::append_app_log(line);
        });
    }

    /// Hands the sizing of a filling window's webview from Tauri to AppKit.
    /// Runs on the main thread (Tauri calls `on_webview_ready` there), so
    /// `with_webview` runs its closure before it returns.
    fn fill_window_with(webview: &Webview) {
        let label = webview.label().to_owned();
        if !fills_window(&label) {
            return;
        }
        let (sender, receiver) = std::sync::mpsc::channel();
        let closure_label = label.clone();
        let _ = webview.with_webview(move |platform| {
            let Some(hosted) = hosted(&platform) else {
                let _ = sender.send(false);
                return;
            };
            hosted.view.setAutoresizingMask(
                NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable,
            );
            correct(&hosted, &closure_label, "setup");
            hosted.window.setInitialFirstResponder(Some(hosted.view));
            claim_keyboard(&hosted);
            let _ = sender.send(true);
        });
        // Only now stop Tauri resizing it from `Resized` events (see the
        // module docs). This must not happen inside the closure: Tauri holds
        // the webview's window-id lock while the closure runs inline, and
        // `set_auto_resize` takes that lock again.
        if receiver.try_recv() != Ok(true) {
            log(format!(
                "The {label} webview is not in its window's content view; Tauri keeps sizing it"
            ));
            return;
        }
        if let Err(error) = webview.set_auto_resize(false) {
            log(format!(
                "Could not stop Tauri resizing the {label} webview: {error}"
            ));
        }
    }

    pub(super) fn resync(webview: &Webview, trigger: &'static str) {
        let label = webview.label().to_owned();
        let _ = webview.with_webview(move |platform| {
            if let Some(hosted) = hosted(&platform) {
                correct(&hosted, &label, trigger);
            }
        });
    }

    pub(crate) fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
        tauri::plugin::Builder::new("oleafly-webview-frame")
            .on_webview_ready(|webview| fill_window_with(&webview))
            .build()
    }

    /// Safety net: events after which a drifted frame is put back. Tauri
    /// hands these to the app before its own `Resized` handling, which no
    /// longer touches these webviews.
    pub(crate) fn on_window_event(window: &Window, event: &WindowEvent) {
        let trigger = match event {
            WindowEvent::Focused(true) => "focus",
            WindowEvent::ScaleFactorChanged { .. } => "scale change",
            WindowEvent::Resized(_) => "resize",
            _ => return,
        };
        if !fills_window(window.label()) {
            return;
        }
        if let Some(webview) = window.get_webview(window.label()) {
            resync(&webview, trigger);
        }
        if !matches!(event, WindowEvent::ScaleFactorChanged { .. }) {
            claim_keyboard_later(window);
        }
    }
}

#[cfg(target_os = "macos")]
pub(crate) use mac::{on_window_event, plugin};

#[cfg(all(target_os = "macos", feature = "e2e-testing"))]
#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FrameStep {
    Measure,
    /// Set the webview to half the window's width and height, pinned
    /// top-left: what the screenshots in #169 show.
    Shrink,
    Resync,
    /// Shrink the window by 40 points each way natively, then measure in
    /// the same main-thread turn. tao's `Resized` event has not reached Tauri
    /// by then, so only AppKit can have resized the webview.
    ResizeWindow,
}

#[cfg(all(target_os = "macos", feature = "e2e-testing"))]
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameProbe {
    frame: Frame,
    container: Frame,
    scale: f64,
    autoresizes: bool,
}

#[cfg(all(target_os = "macos", feature = "e2e-testing"))]
#[tauri::command]
pub async fn debug_webview_frame(
    app: tauri::AppHandle,
    label: String,
    step: FrameStep,
) -> Result<FrameProbe, String> {
    use objc2_app_kit::NSAutoresizingMaskOptions;
    use objc2_foundation::NSSize;
    use tauri::Manager;

    if !fills_window(&label) {
        return Err(format!("The {label} window is not one Oleafly sizes."));
    }
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("There is no {label} webview."))?;
    if matches!(step, FrameStep::Resync) {
        mac::resync(&webview, "an e2e request");
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    webview
        .with_webview(move |platform| {
            let Some(hosted) = mac::hosted(&platform) else {
                let _ = sender.send(Err(
                    "The webview is not in its window's content view.".to_string()
                ));
                return;
            };
            match step {
                FrameStep::Measure | FrameStep::Resync => {}
                FrameStep::Shrink => {
                    let container = mac::frame_of(hosted.container.bounds());
                    let top = if hosted.container.isFlipped() {
                        container.y
                    } else {
                        container.y + container.height / 2.0
                    };
                    hosted.view.setFrame(mac::ns_rect(Frame {
                        x: container.x,
                        y: top,
                        width: container.width / 2.0,
                        height: container.height / 2.0,
                    }));
                }
                FrameStep::ResizeWindow => {
                    let size = hosted.container.bounds().size;
                    hosted
                        .window
                        .setContentSize(NSSize::new(size.width - 40.0, size.height - 40.0));
                }
            }
            let _ = sender.send(Ok(FrameProbe {
                frame: mac::frame_of(hosted.view.frame()),
                container: mac::frame_of(hosted.container.bounds()),
                scale: hosted.window.backingScaleFactor(),
                autoresizes: hosted.view.autoresizingMask().contains(
                    NSAutoresizingMaskOptions::ViewWidthSizable
                        | NSAutoresizingMaskOptions::ViewHeightSizable,
                ),
            }));
        })
        .map_err(|error| error.to_string())?;
    receiver
        .await
        .map_err(|_| "The webview probe did not run.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Frame {
        Frame {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn only_oleafly_single_webview_windows_are_filled() {
        for label in [
            "main",
            "preview",
            "update",
            "presentation",
            "presenter",
            "admin-console-0192f0c4-7c00-7000-8000-000000000000",
        ] {
            assert!(fills_window(label), "{label}");
        }
        for label in [
            "oleafly-browser-window-1",
            "oleafly-browser-chrome-1",
            "oleafly-browser-pane-1",
            "Main",
            "admin-console",
            "",
        ] {
            assert!(!fills_window(label), "{label}");
        }
    }

    #[test]
    fn a_webview_that_fills_its_window_is_left_alone() {
        let window = rect(0.0, 0.0, 2560.0, 1440.0);
        assert_eq!(corrected_frame(window, window), None);
    }

    #[test]
    fn the_half_size_top_left_frame_from_issue_169_is_put_back() {
        let window = rect(0.0, 0.0, 2560.0, 1440.0);
        let stuck = rect(0.0, 720.0, 1280.0, 720.0);
        assert_eq!(corrected_frame(stuck, window), Some(window));
    }

    #[test]
    fn every_edge_counts() {
        let window = rect(0.0, 0.0, 1200.0, 800.0);
        for wrong in [
            rect(4.0, 0.0, 1200.0, 800.0),
            rect(0.0, 4.0, 1200.0, 800.0),
            rect(0.0, 0.0, 1196.0, 800.0),
            rect(0.0, 0.0, 1200.0, 804.0),
        ] {
            assert_eq!(corrected_frame(wrong, window), Some(window), "{wrong:?}");
        }
    }

    #[test]
    fn sub_point_rounding_is_not_a_wrong_frame() {
        let window = rect(0.0, 0.0, 1440.5, 900.0);
        let rounded = rect(0.25, -0.25, 1440.0, 900.5);
        assert_eq!(corrected_frame(rounded, window), None);
    }

    #[test]
    fn a_container_with_no_usable_size_is_ignored() {
        let frame = rect(0.0, 0.0, 800.0, 600.0);
        assert_eq!(corrected_frame(frame, rect(0.0, 0.0, 0.0, 600.0)), None);
        assert_eq!(corrected_frame(frame, rect(0.0, 0.0, 800.0, -1.0)), None);
        assert_eq!(
            corrected_frame(frame, rect(0.0, 0.0, f64::NAN, 600.0)),
            None
        );
        assert_eq!(
            corrected_frame(rect(0.0, 0.0, f64::INFINITY, 600.0), frame),
            None
        );
    }

    #[test]
    fn the_log_line_names_the_window_trigger_sizes_and_scale() {
        let line = correction_log_line(
            "main",
            "scale change",
            rect(0.0, 720.0, 1280.0, 720.0),
            rect(0.0, 0.0, 2560.0, 1440.0),
            2.0,
        );
        assert_eq!(
            line,
            "Webview frame corrected in the main window on scale change: \
             1280x720 at (0, 720) -> 2560x1440 at (0, 0) points, backing scale 2"
        );
    }
}
