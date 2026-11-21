use std::sync::OnceLock;

use objc2::runtime::{AnyClass, AnyObject};
use objc2::{define_class, ClassType, MainThreadOnly};
use objc2_app_kit::{
    NSEvent, NSPanel, NSResponder, NSScreen, NSWindow, NSWindowCollectionBehavior,
    NSWindowStyleMask,
};
use objc2_foundation::{NSObject, NSPoint, NSRect};
use tauri::{Runtime, WebviewWindow};

define_class!(
    #[unsafe(super(NSPanel, NSWindow, NSResponder, NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "OleaflyCapturePanel"]
    struct CapturePanel;

    impl CapturePanel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key_window(&self) -> bool {
            true
        }

        #[unsafe(method(canBecomeMainWindow))]
        fn can_become_main_window(&self) -> bool {
            false
        }
    }
);

static ORIGINAL_CLASS: OnceLock<&'static AnyClass> = OnceLock::new();

fn on_main_thread<R: Runtime>(
    window: &WebviewWindow<R>,
    work: impl FnOnce(&NSWindow) + Send + 'static,
) {
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
        if let Some(ns_window) = unsafe { pointer.cast::<NSWindow>().as_ref() } {
            work(ns_window);
        }
    });
}

pub(super) fn make_panel<R: Runtime>(window: &WebviewWindow<R>) {
    on_main_thread(window, |ns_window| {
        let object: &AnyObject = ns_window.as_ref();
        let original = object.class();
        if !std::ptr::eq(original, CapturePanel::class()) {
            let _ = ORIGINAL_CLASS.set(original);
            // SAFETY: CapturePanel adds no instance variables and only answers
            // canBecomeKeyWindow and canBecomeMainWindow, so the window's memory
            // and Tao's state stay valid. `restore_window` puts the original
            // class back before the window is destroyed.
            unsafe { AnyObject::set_class(object, CapturePanel::class()) };
        }
        ns_window.setStyleMask(ns_window.styleMask() | NSWindowStyleMask::NonactivatingPanel);
        ns_window.setHidesOnDeactivate(false);
        ns_window.setCollectionBehavior(
            ns_window.collectionBehavior()
                | NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
        );
        // SAFETY: the window's class is CapturePanel, an NSPanel subclass.
        let panel = unsafe { &*(ns_window as *const NSWindow).cast::<NSPanel>() };
        panel.setFloatingPanel(true);
    });
}

pub(super) fn restore_window<R: Runtime>(window: &WebviewWindow<R>) {
    on_main_thread(window, |ns_window| {
        let object: &AnyObject = ns_window.as_ref();
        if let Some(original) = ORIGINAL_CLASS.get() {
            if std::ptr::eq(object.class(), CapturePanel::class()) {
                // SAFETY: this puts back the class the window was created with.
                unsafe { AnyObject::set_class(object, original) };
            }
        }
    });
}

fn contains(rect: NSRect, point: NSPoint) -> bool {
    point.x >= rect.origin.x
        && point.x < rect.origin.x + rect.size.width
        && point.y >= rect.origin.y
        && point.y < rect.origin.y + rect.size.height
}

pub(super) fn bring_forward<R: Runtime>(window: &WebviewWindow<R>) {
    on_main_thread(window, |ns_window| {
        let Some(mtm) = objc2::MainThreadMarker::new() else {
            return;
        };
        let mouse = NSEvent::mouseLocation();
        if let Some(screen) = NSScreen::screens(mtm)
            .iter()
            .find(|screen| contains(screen.frame(), mouse))
        {
            let elsewhere = ns_window
                .screen()
                .is_none_or(|on| !std::ptr::eq(&*on, &*screen));
            if elsewhere {
                let area = screen.visibleFrame();
                let frame = ns_window.frame();
                ns_window.setFrameOrigin(NSPoint::new(
                    area.origin.x + (area.size.width - frame.size.width) / 2.0,
                    area.origin.y + (area.size.height - frame.size.height) / 2.0,
                ));
            }
        }
        ns_window.orderFrontRegardless();
        ns_window.makeKeyWindow();
    });
}
