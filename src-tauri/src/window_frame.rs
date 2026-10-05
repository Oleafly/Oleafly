#[cfg(any(target_os = "linux", test))]
const EDGE_WIDTH: i32 = 6;

#[cfg(any(target_os = "linux", test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Edge {
    North,
    South,
    East,
    West,
    NorthEast,
    NorthWest,
    SouthEast,
    SouthWest,
}

#[cfg(any(target_os = "linux", test))]
fn edge_at(x: i32, y: i32, width: i32, height: i32) -> Option<Edge> {
    if x < 0 || y < 0 || x >= width || y >= height {
        return None;
    }
    let west = x < EDGE_WIDTH;
    let east = x >= width - EDGE_WIDTH;
    let north = y < EDGE_WIDTH;
    let south = y >= height - EDGE_WIDTH;
    match (north, south, west, east) {
        (true, _, true, _) => Some(Edge::NorthWest),
        (true, _, _, true) => Some(Edge::NorthEast),
        (_, true, true, _) => Some(Edge::SouthWest),
        (_, true, _, true) => Some(Edge::SouthEast),
        (true, _, _, _) => Some(Edge::North),
        (_, true, _, _) => Some(Edge::South),
        (_, _, true, _) => Some(Edge::West),
        (_, _, _, true) => Some(Edge::East),
        _ => None,
    }
}

#[cfg(any(target_os = "linux", test))]
fn rounds_corners(composited: bool, alpha: bool, decorated: bool, edge_to_edge: bool) -> bool {
    composited && alpha && !decorated && !edge_to_edge
}

#[cfg(any(target_os = "linux", test))]
fn corners_script(round: bool) -> &'static str {
    if round {
        "document.documentElement.dataset.windowCorners = \"round\";"
    } else {
        "delete document.documentElement.dataset.windowCorners;"
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("oleafly-window-frame")
        .on_webview_ready(|webview| watch(&webview))
        .build()
}

#[cfg(target_os = "linux")]
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

#[cfg(target_os = "linux")]
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

#[cfg(target_os = "linux")]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_each_side_and_corner_inside_the_band() {
        assert_eq!(edge_at(1276, 400, 1280, 800), Some(Edge::East));
        assert_eq!(edge_at(2, 400, 1280, 800), Some(Edge::West));
        assert_eq!(edge_at(600, 1, 1280, 800), Some(Edge::North));
        assert_eq!(edge_at(600, 797, 1280, 800), Some(Edge::South));
        assert_eq!(edge_at(1, 1, 1280, 800), Some(Edge::NorthWest));
        assert_eq!(edge_at(1279, 0, 1280, 800), Some(Edge::NorthEast));
        assert_eq!(edge_at(0, 799, 1280, 800), Some(Edge::SouthWest));
        assert_eq!(edge_at(1278, 798, 1280, 800), Some(Edge::SouthEast));
    }

    #[test]
    fn leaves_the_rest_of_the_window_to_the_page() {
        assert_eq!(edge_at(640, 400, 1280, 800), None);
        assert_eq!(edge_at(EDGE_WIDTH, 400, 1280, 800), None);
        assert_eq!(edge_at(1280 - EDGE_WIDTH - 1, 400, 1280, 800), None);
        assert_eq!(edge_at(-1, 400, 1280, 800), None);
        assert_eq!(edge_at(1280, 400, 1280, 800), None);
    }

    #[test]
    fn rounds_only_a_free_floating_see_through_window() {
        assert!(rounds_corners(true, true, false, false));
        assert!(!rounds_corners(false, true, false, false));
        assert!(!rounds_corners(true, false, false, false));
        assert!(!rounds_corners(true, true, true, false));
        assert!(!rounds_corners(true, true, false, true));
    }

    #[test]
    fn toggles_the_corner_attribute_the_stylesheet_reads() {
        assert!(corners_script(true).contains("dataset.windowCorners = \"round\""));
        assert!(corners_script(false)
            .starts_with("delete document.documentElement.dataset.windowCorners"));
    }
}
