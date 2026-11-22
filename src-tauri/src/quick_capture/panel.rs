use std::ffi::CStr;
use std::sync::OnceLock;

use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
use objc2::{sel, ClassType};
use objc2_app_kit::{
    NSEvent, NSPanel, NSScreen, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask,
};
use objc2_foundation::{NSPoint, NSRect};
use tauri::{Runtime, WebviewWindow};

const PANEL_CLASS: &CStr = c"OleaflyCapturePanel";
const FOCUSABLE: &CStr = c"focusable";

static ORIGINAL_CLASS: OnceLock<&AnyClass> = OnceLock::new();

extern "C-unwind" fn can_become_key(_this: &AnyObject, _sel: Sel) -> Bool {
    Bool::YES
}

extern "C-unwind" fn can_become_main(_this: &AnyObject, _sel: Sel) -> Bool {
    Bool::NO
}

fn panel_class() -> Option<&'static AnyClass> {
    static PANEL: OnceLock<Option<&AnyClass>> = OnceLock::new();
    *PANEL.get_or_init(|| {
        let mut builder = ClassBuilder::new(PANEL_CLASS, NSPanel::class())?;
        builder.add_ivar::<Bool>(FOCUSABLE);
        // SAFETY: canBecomeKeyWindow and canBecomeMainWindow take no arguments
        // and return BOOL, which is what both functions take and return.
        unsafe {
            builder.add_method(
                sel!(canBecomeKeyWindow),
                can_become_key as extern "C-unwind" fn(_, _) -> _,
            );
            builder.add_method(
                sel!(canBecomeMainWindow),
                can_become_main as extern "C-unwind" fn(_, _) -> _,
            );
        }
        Some(builder.register())
    })
}

fn own_ivars(class: &AnyClass) -> Vec<(String, isize, String)> {
    class
        .instance_variables()
        .iter()
        .map(|ivar| {
            (
                ivar.name().to_string_lossy().into_owned(),
                ivar.offset(),
                ivar.type_encoding().to_string_lossy().into_owned(),
            )
        })
        .collect()
}

fn same_layout(window: &AnyClass, panel: &AnyClass) -> bool {
    window.instance_size() == panel.instance_size() && own_ivars(window) == own_ivars(panel)
}

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
        let Some(panel) = panel_class() else {
            return;
        };
        let object: &AnyObject = ns_window.as_ref();
        let original = object.class();
        if !std::ptr::eq(original, panel) {
            if !same_layout(original, panel) {
                let _ = crate::project::append_app_log(format!(
                    "Quick capture stays an ordinary window: its window class {} is laid out differently from the panel.",
                    original.name().to_string_lossy()
                ));
                return;
            }
            let _ = ORIGINAL_CLASS.set(original);
            // SAFETY: same_layout checked that the panel class has the window
            // class's instance size and its own instance variables at the same
            // offsets with the same types, so the object's memory means the same
            // under both. `restore_window` puts the original class back before
            // the window is destroyed.
            unsafe { AnyObject::set_class(object, panel) };
        }
        ns_window.setStyleMask(ns_window.styleMask() | NSWindowStyleMask::NonactivatingPanel);
        ns_window.setHidesOnDeactivate(false);
        ns_window.setCollectionBehavior(
            ns_window.collectionBehavior()
                | NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
        );
        // SAFETY: the window's class is now the panel class, an NSPanel subclass.
        let panel_window = unsafe { &*(ns_window as *const NSWindow).cast::<NSPanel>() };
        panel_window.setFloatingPanel(true);
    });
}

pub(super) fn restore_window<R: Runtime>(window: &WebviewWindow<R>) {
    on_main_thread(window, |ns_window| {
        let (Some(panel), Some(original)) = (panel_class(), ORIGINAL_CLASS.get()) else {
            return;
        };
        let object: &AnyObject = ns_window.as_ref();
        if std::ptr::eq(object.class(), panel) {
            // SAFETY: this puts back the class the window was created with,
            // whose layout same_layout matched before the swap.
            unsafe { AnyObject::set_class(object, original) };
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

#[cfg(test)]
mod tests {
    use super::*;

    fn window_class_like_tao(name: &CStr) -> &'static AnyClass {
        let mut builder = ClassBuilder::new(name, NSWindow::class()).unwrap();
        builder.add_ivar::<Bool>(FOCUSABLE);
        builder.register()
    }

    #[test]
    fn the_panel_matches_a_window_class_laid_out_like_tao_s() {
        let panel = panel_class().unwrap();
        assert!(same_layout(
            window_class_like_tao(c"OleaflyTaoLikeWindow"),
            panel
        ));
    }

    #[test]
    fn the_panel_refuses_a_window_class_with_another_layout() {
        let panel = panel_class().unwrap();
        assert!(!same_layout(NSWindow::class(), panel));
        let mut builder = ClassBuilder::new(c"OleaflyWiderWindow", NSWindow::class()).unwrap();
        builder.add_ivar::<Bool>(FOCUSABLE);
        builder.add_ivar::<usize>(c"extra");
        assert!(!same_layout(builder.register(), panel));
    }
}
