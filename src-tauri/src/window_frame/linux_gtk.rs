use super::{corners_script, edge_at, rounds_corners, Edge};

pub(crate) fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("oleafly-window-frame")
        .on_webview_ready(|webview| watch(&webview))
        .build()
}

fn watch<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
    use gtk::glib::{ObjectExt, Propagation};
    use gtk::prelude::{Cast, WidgetExt};

    if webview.label() != webview.window().label() {
        return;
    }
    let target = webview.clone();
    let _ = webview.with_webview(move |platform| {
        let view = platform.inner();
        view.connect_button_press_event(resize_from_edge);
        let Some(window) = view
            .toplevel()
            .and_then(|top| top.downcast::<gtk::Window>().ok())
        else {
            return;
        };
        let page = target.clone();
        let page_window = window.clone();
        view.connect_local("load-changed", true, move |_| {
            let state = page_window
                .window()
                .map(|surface| surface.state())
                .unwrap_or_else(gtk::gdk::WindowState::empty);
            sync_corners(&page, &page_window, state);
            None
        });
        window.connect_window_state_event(move |window, event| {
            sync_corners(&target, window, event.new_window_state());
            Propagation::Proceed
        });
    });
}

fn sync_corners<R: tauri::Runtime>(
    webview: &tauri::Webview<R>,
    window: &gtk::Window,
    state: gtk::gdk::WindowState,
) {
    use gtk::gdk::WindowState;
    use gtk::prelude::{GtkWindowExt, WidgetExt};

    let composited = GtkWindowExt::screen(window).is_some_and(|screen| screen.is_composited());
    let alpha = window.visual().is_some_and(|visual| visual.depth() == 32);
    let edge_to_edge =
        state.intersects(WindowState::MAXIMIZED | WindowState::FULLSCREEN | WindowState::TILED);
    let round = rounds_corners(composited, alpha, window.is_decorated(), edge_to_edge);
    let _ = webview.eval(corners_script(round));
}

fn resize_from_edge(
    view: &impl gtk::glib::IsA<gtk::Widget>,
    event: &gtk::gdk::EventButton,
) -> gtk::glib::Propagation {
    use gtk::gdk::WindowEdge;
    use gtk::glib::Propagation;
    use gtk::prelude::{Cast, GtkWindowExt, WidgetExt};

    if event.button() != 1 {
        return Propagation::Proceed;
    }
    let Some(window) = view
        .toplevel()
        .and_then(|top| top.downcast::<gtk::Window>().ok())
    else {
        return Propagation::Proceed;
    };
    if window.is_decorated() || !window.is_resizable() || window.is_maximized() {
        return Propagation::Proceed;
    }
    let (x, y) = event.position();
    let Some((x, y)) = view.translate_coordinates(&window, x as i32, y as i32) else {
        return Propagation::Proceed;
    };
    let edge = match edge_at(x, y, window.allocated_width(), window.allocated_height()) {
        Some(Edge::North) => WindowEdge::North,
        Some(Edge::South) => WindowEdge::South,
        Some(Edge::East) => WindowEdge::East,
        Some(Edge::West) => WindowEdge::West,
        Some(Edge::NorthEast) => WindowEdge::NorthEast,
        Some(Edge::NorthWest) => WindowEdge::NorthWest,
        Some(Edge::SouthEast) => WindowEdge::SouthEast,
        Some(Edge::SouthWest) => WindowEdge::SouthWest,
        None => return Propagation::Proceed,
    };
    let (root_x, root_y) = event.root();
    window.begin_resize_drag(edge, 1, root_x as i32, root_y as i32, event.time());
    Propagation::Stop
}
