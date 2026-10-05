use std::cell::Cell;
use std::rc::Rc;

use gtk::glib::object::Cast;
use gtk::glib::Propagation;
use gtk::prelude::{BoxExt, ContainerExt, OverlayExt, WidgetExt};
use gtk::OverlaySignals;
use tauri::{Manager, Runtime, Webview};

const LAYOUT_NAME: &str = "oleafly-browser-layout";

#[derive(Clone, Copy)]
pub(super) enum Role {
    Chrome,
    Pane,
}

pub(super) fn adopt<R: Runtime>(webview: &Webview<R>, role: Role) {
    let result = webview.with_webview(move |platform| {
        let view = platform.inner();
        let Some(column) = view
            .parent()
            .and_then(|parent| parent.downcast::<gtk::Box>().ok())
        else {
            return;
        };
        let overlay = layout_in(&column);
        column.remove(&view);
        match role {
            Role::Chrome => overlay.add(&view),
            Role::Pane => overlay.add_overlay(&view),
        }
    });
    if let Err(error) = result {
        eprintln!("could not lay out browser webview: {error}");
    }
}

fn layout_in(column: &gtk::Box) -> gtk::Overlay {
    let existing = column
        .children()
        .into_iter()
        .find(|child| child.widget_name() == LAYOUT_NAME)
        .and_then(|child| child.downcast::<gtk::Overlay>().ok());
    if let Some(overlay) = existing {
        return overlay;
    }
    let overlay = gtk::Overlay::new();
    overlay.set_widget_name(LAYOUT_NAME);
    overlay.connect_get_child_position(|overlay, _| {
        let (x, y, width, height) =
            super::pane_allocation(overlay.allocated_width(), overlay.allocated_height());
        Some(gtk::gdk::Rectangle::new(x, y, width, height))
    });
    column.pack_start(&overlay, true, true, 0);
    overlay.show();
    overlay
}

pub(super) fn install_shortcuts<R: Runtime>(pane: &Webview<R>, chrome_label: String) {
    let app = pane.app_handle().clone();
    let result = pane.with_webview(move |platform| {
        let view = platform.inner();
        let held = Rc::new(Cell::new(None));
        let pressed = held.clone();
        view.connect_key_press_event(move |_, event| {
            let key = super::linux_shortcuts::shortcut_key(
                event.keyval().to_lower().to_unicode(),
                event.state(),
            );
            let Some(key) = key else {
                return Propagation::Proceed;
            };
            if pressed.replace(Some(key)) != Some(key) {
                super::route_shortcut(&app, chrome_label.clone(), key);
            }
            Propagation::Stop
        });
        view.connect_key_release_event(move |_, _| {
            held.set(None);
            Propagation::Proceed
        });
    });
    if let Err(error) = result {
        eprintln!("could not access browser shortcut webview: {error}");
    }
}
