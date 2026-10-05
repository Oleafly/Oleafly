use std::cell::Cell;
use std::rc::Rc;

use gtk::gdk::ModifierType;
use gtk::glib::Propagation;
use gtk::prelude::WidgetExt;
use tauri::{Manager, Runtime, Webview};

fn shortcut_key(key: Option<char>, state: ModifierType) -> Option<char> {
    let others = ModifierType::SHIFT_MASK | ModifierType::MOD1_MASK | ModifierType::SUPER_MASK;
    if !state.contains(ModifierType::CONTROL_MASK) || state.intersects(others) {
        return None;
    }
    key.filter(|key| matches!(key, 'l' | 't' | 'w' | 'r'))
}

pub(super) fn install<R: Runtime>(pane: &Webview<R>, chrome_label: String) {
    let app = pane.app_handle().clone();
    let result = pane.with_webview(move |platform| {
        let view = platform.inner();
        let held = Rc::new(Cell::new(None));
        let pressed = held.clone();
        view.connect_key_press_event(move |_, event| {
            let key = shortcut_key(event.keyval().to_lower().to_unicode(), event.state());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_only_the_four_plain_ctrl_shortcuts() {
        let ctrl = ModifierType::CONTROL_MASK;
        for key in ['l', 't', 'w', 'r'] {
            assert_eq!(shortcut_key(Some(key), ctrl), Some(key));
        }
        assert_eq!(shortcut_key(Some('a'), ctrl), None);
        assert_eq!(shortcut_key(None, ctrl), None);
        assert_eq!(shortcut_key(Some('t'), ModifierType::empty()), None);
        assert_eq!(
            shortcut_key(Some('t'), ctrl | ModifierType::SHIFT_MASK),
            None
        );
        assert_eq!(
            shortcut_key(Some('t'), ctrl | ModifierType::MOD1_MASK),
            None
        );
        assert_eq!(
            shortcut_key(Some('t'), ctrl | ModifierType::SUPER_MASK),
            None
        );
        assert_eq!(
            shortcut_key(Some('t'), ctrl | ModifierType::MOD2_MASK),
            Some('t')
        );
    }
}
