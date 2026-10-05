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
mod linux_gtk;

#[cfg(target_os = "linux")]
pub(crate) use linux_gtk::plugin;

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
