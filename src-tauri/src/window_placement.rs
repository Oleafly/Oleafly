use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Monitor, PhysicalPosition, PhysicalSize,
    Runtime, Window, WindowEvent,
};

const FILE_NAME: &str = "window.json";
const SAVE_DELAY: Duration = Duration::from_millis(750);
const SIZE_SLACK: f64 = 2.0;
const MOVE_SLACK: f64 = 1.0;
const FRAME_SLACK: f64 = 20.0;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Placement {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    maximized: bool,
}

impl Placement {
    fn is_usable(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|value| value.is_finite())
            && self.width >= 1.0
            && self.height >= 1.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Area {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Seen {
    Normal(Placement),
    Maximized(Option<Area>),
}

struct Tracker {
    tracking: bool,
    current: Option<Placement>,
    written: Option<Placement>,
    generation: u64,
}

static TRACKER: Mutex<Tracker> = Mutex::new(Tracker {
    tracking: false,
    current: None,
    written: None,
    generation: 0,
});

fn tracker() -> MutexGuard<'static, Tracker> {
    TRACKER.lock().unwrap_or_else(PoisonError::into_inner)
}

fn overlap(placement: &Placement, area: &Area) -> f64 {
    let width = (placement.x + placement.width).min(area.x + area.width) - placement.x.max(area.x);
    let height =
        (placement.y + placement.height).min(area.y + area.height) - placement.y.max(area.y);
    if width <= 0.0 || height <= 0.0 {
        0.0
    } else {
        width * height
    }
}

fn fit(saved: Placement, areas: &[Area], slack: f64) -> Placement {
    let overlapping = areas
        .iter()
        .map(|area| (overlap(&saved, area), area))
        .filter(|(shared, _)| *shared > 0.0)
        .max_by(|left, right| left.0.total_cmp(&right.0))
        .map(|(_, area)| area);
    let Some(area) = overlapping.or_else(|| areas.first()) else {
        return saved;
    };
    let width = saved.width.min(area.width);
    let height = saved.height.min(area.height);
    let (x, y) = if overlapping.is_some() {
        (
            saved
                .x
                .max(area.x - slack)
                .min(area.x + area.width - width + slack),
            saved
                .y
                .max(area.y - slack)
                .min(area.y + area.height - height + slack),
        )
    } else {
        (
            area.x + (area.width - width) / 2.0,
            area.y + (area.height - height) / 2.0,
        )
    };
    Placement {
        x,
        y,
        width,
        height,
        maximized: saved.maximized,
    }
}

fn fit_size(saved: Placement, areas: &[Area]) -> Placement {
    let Some(largest) = areas
        .iter()
        .max_by(|left, right| (left.width * left.height).total_cmp(&(right.width * right.height)))
    else {
        return saved;
    };
    Placement {
        width: saved.width.min(largest.width),
        height: saved.height.min(largest.height),
        ..saved
    }
}

fn next(current: Option<Placement>, seen: Seen) -> Option<Placement> {
    match seen {
        Seen::Normal(placement) => Some(placement).filter(Placement::is_usable),
        Seen::Maximized(screen) => current.map(|placement| {
            let placement = match screen {
                Some(area) if overlap(&placement, &area) == 0.0 => fit(placement, &[area], 0.0),
                _ => placement,
            };
            Placement {
                maximized: true,
                ..placement
            }
        }),
    }
}

fn moved(current: Option<Placement>, next: &Placement) -> bool {
    current.is_none_or(|current| {
        current.maximized != next.maximized
            || [
                current.x - next.x,
                current.y - next.y,
                current.width - next.width,
                current.height - next.height,
            ]
            .iter()
            .any(|delta| delta.abs() > MOVE_SLACK)
    })
}

fn read(path: &Path) -> Result<Option<Placement>, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let placement: Placement = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    Ok(Some(placement).filter(Placement::is_usable))
}

fn write(path: &Path, placement: &Placement) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(placement).map_err(|error| error.to_string())?;
    oleafly_core::atomic::write_atomic(path, &bytes).map_err(|error| error.to_string())
}

fn file() -> Result<PathBuf, String> {
    Ok(crate::paths::oleafly_root()?.join(FILE_NAME))
}

fn log(message: String) {
    let _ = crate::project::append_app_log(message);
}

fn uses_points() -> bool {
    !cfg!(target_os = "windows")
}

fn frame_slack() -> f64 {
    if uses_points() {
        0.0
    } else {
        FRAME_SLACK
    }
}

fn positions_unknown() -> bool {
    cfg!(target_os = "linux")
        && crate::quick_capture::wayland_session(|name| std::env::var(name).ok())
}

fn area_of(monitor: &Monitor) -> Area {
    let scale = if uses_points() {
        monitor.scale_factor()
    } else {
        1.0
    };
    let work = monitor.work_area();
    Area {
        x: f64::from(work.position.x) / scale,
        y: f64::from(work.position.y) / scale,
        width: f64::from(work.size.width) / scale,
        height: f64::from(work.size.height) / scale,
    }
}

fn work_areas<R: Runtime>(window: &Window<R>) -> Vec<Area> {
    let primary = window
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| *monitor.position());
    let mut monitors = window.available_monitors().unwrap_or_default();
    monitors.sort_by_key(|monitor| Some(*monitor.position()) != primary);
    monitors
        .iter()
        .map(area_of)
        .filter(|area| area.width >= 1.0 && area.height >= 1.0)
        .collect()
}

fn seen<R: Runtime>(window: &Window<R>) -> Option<Seen> {
    if window.is_minimized().unwrap_or(true) {
        return None;
    }
    if window.is_fullscreen().unwrap_or(false) || window.is_maximized().unwrap_or(false) {
        let screen = window.current_monitor().ok().flatten();
        return Some(Seen::Maximized(screen.as_ref().map(area_of)));
    }
    let scale = if uses_points() {
        window.scale_factor().ok()?
    } else {
        1.0
    };
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    Some(Seen::Normal(Placement {
        x: f64::from(position.x) / scale,
        y: f64::from(position.y) / scale,
        width: f64::from(size.width) / scale,
        height: f64::from(size.height) / scale,
        maximized: false,
    }))
}

fn set_size<R: Runtime>(window: &Window<R>, placement: &Placement) {
    let _ = if uses_points() {
        window.set_size(LogicalSize::new(placement.width, placement.height))
    } else {
        window.set_size(PhysicalSize::new(
            placement.width.round() as u32,
            placement.height.round() as u32,
        ))
    };
}

fn size_differs<R: Runtime>(window: &Window<R>, placement: &Placement) -> bool {
    let scale = if uses_points() {
        window.scale_factor().unwrap_or(1.0)
    } else {
        1.0
    };
    window.inner_size().is_ok_and(|size| {
        (f64::from(size.width) / scale - placement.width).abs() > SIZE_SLACK
            || (f64::from(size.height) / scale - placement.height).abs() > SIZE_SLACK
    })
}

fn place<R: Runtime>(window: &Window<R>, placement: &Placement, positioned: bool) {
    if positioned {
        let _ = if uses_points() {
            window.set_position(LogicalPosition::new(placement.x, placement.y))
        } else {
            window.set_position(PhysicalPosition::new(
                placement.x.round() as i32,
                placement.y.round() as i32,
            ))
        };
    }
    set_size(window, placement);
    if size_differs(window, placement) {
        set_size(window, placement);
    }
    if placement.maximized {
        let _ = window.maximize();
    }
}

pub(crate) fn apply<R: Runtime>(window: &Window<R>) {
    let saved = if cfg!(feature = "e2e-testing") {
        None
    } else {
        match file().and_then(|path| read(&path)) {
            Ok(saved) => saved,
            Err(error) => {
                log(format!("Could not read the saved window size: {error}"));
                None
            }
        }
    };
    let current = match saved {
        Some(saved) => {
            let positioned = !positions_unknown();
            let areas = work_areas(window);
            let placement = if positioned {
                fit(saved, &areas, frame_slack())
            } else {
                fit_size(saved, &areas)
            };
            place(window, &placement, positioned);
            Some(placement)
        }
        None => {
            let launch = match seen(window) {
                Some(Seen::Normal(placement)) => Some(Placement {
                    maximized: true,
                    ..placement
                }),
                _ => None,
            };
            let _ = window.maximize();
            launch
        }
    };
    let mut tracker = tracker();
    tracker.tracking = true;
    tracker.current = current;
    tracker.written = if saved.is_some() { current } else { None };
}

fn record<R: Runtime>(window: &Window<R>) {
    let Some(seen) = seen(window) else {
        return;
    };
    let mut tracker = tracker();
    if let Some(placement) = next(tracker.current, seen)
        .filter(|placement| tracker.tracking && moved(tracker.current, placement))
    {
        tracker.current = Some(placement);
    }
}

pub(crate) fn observe<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {}
        WindowEvent::CloseRequested { .. } if tracker().tracking => return record(window),
        _ => return,
    }
    let generation = {
        let mut tracker = tracker();
        if !tracker.tracking {
            return;
        }
        tracker.generation += 1;
        tracker.generation
    };
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SAVE_DELAY).await;
        if tracker().generation != generation {
            return;
        }
        let _ = tauri::async_runtime::spawn_blocking(move || {
            record(&window);
            flush();
        })
        .await;
    });
}

pub(crate) fn settle<R: Runtime>(app: &AppHandle<R>) {
    if !tracker().tracking {
        return;
    }
    if let Some(window) = app.get_window("main") {
        record(&window);
    }
}

pub(crate) fn flush() {
    let pending = {
        let tracker = tracker();
        match tracker.current {
            Some(current) if tracker.tracking && tracker.written != Some(current) => Some(current),
            _ => None,
        }
    };
    let Some(placement) = pending else {
        return;
    };
    match file().and_then(|path| write(&path, &placement)) {
        Ok(()) => tracker().written = Some(placement),
        Err(error) => log(format!("Could not save the window size: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn placement(x: f64, y: f64, width: f64, height: f64) -> Placement {
        Placement {
            x,
            y,
            width,
            height,
            maximized: false,
        }
    }

    fn maximized(placement: Placement) -> Placement {
        Placement {
            maximized: true,
            ..placement
        }
    }

    fn area(x: f64, y: f64, width: f64, height: f64) -> Area {
        Area {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn a_window_inside_its_screen_comes_back_where_it_was() {
        let saved = placement(120.0, 80.0, 1100.0, 760.0);

        assert_eq!(fit(saved, &[area(0.0, 25.0, 1920.0, 1055.0)], 0.0), saved);
    }

    #[test]
    fn a_window_hanging_off_the_edge_is_pulled_back_onto_the_screen() {
        let saved = placement(1500.0, 900.0, 1000.0, 700.0);

        assert_eq!(
            fit(saved, &[area(0.0, 0.0, 1920.0, 1080.0)], 0.0),
            placement(920.0, 380.0, 1000.0, 700.0)
        );
        assert_eq!(
            fit(
                placement(-300.0, 200.0, 800.0, 600.0),
                &[area(0.0, 0.0, 1920.0, 1080.0)],
                0.0
            ),
            placement(0.0, 200.0, 800.0, 600.0)
        );
    }

    #[test]
    fn a_window_snapped_against_an_edge_keeps_its_invisible_frame_on_windows() {
        let snapped = placement(-7.0, 0.0, 974.0, 1000.0);

        assert_eq!(
            fit(snapped, &[area(0.0, 0.0, 1920.0, 1040.0)], FRAME_SLACK),
            snapped
        );
        assert_eq!(
            fit(snapped, &[area(0.0, 0.0, 1920.0, 1040.0)], 0.0),
            placement(0.0, 0.0, 974.0, 1000.0)
        );
    }

    #[test]
    fn a_window_bigger_than_its_screen_is_shrunk_to_fit() {
        let saved = maximized(placement(0.0, 0.0, 2560.0, 1440.0));

        assert_eq!(
            fit(saved, &[area(0.0, 0.0, 1440.0, 875.0)], 0.0),
            maximized(placement(0.0, 0.0, 1440.0, 875.0))
        );
    }

    #[test]
    fn the_window_returns_to_the_screen_it_mostly_covered() {
        let screens = [
            area(0.0, 0.0, 1920.0, 1080.0),
            area(1920.0, 0.0, 2560.0, 1440.0),
        ];
        let saved = placement(1800.0, 100.0, 1200.0, 800.0);

        assert_eq!(
            fit(saved, &screens, 0.0),
            placement(1920.0, 100.0, 1200.0, 800.0)
        );
    }

    #[test]
    fn a_screen_left_of_or_above_the_main_one_keeps_its_windows() {
        let screens = [
            area(0.0, 0.0, 1920.0, 1080.0),
            area(-2560.0, -360.0, 2560.0, 1440.0),
        ];
        let saved = placement(-2400.0, -300.0, 1600.0, 1000.0);

        assert_eq!(fit(saved, &screens, 0.0), saved);
    }

    #[test]
    fn a_window_on_a_screen_that_is_gone_is_centred_on_the_first_screen() {
        let screens = [area(0.0, 0.0, 1920.0, 1080.0)];

        assert_eq!(
            fit(placement(3000.0, 200.0, 1000.0, 600.0), &screens, 0.0),
            placement(460.0, 240.0, 1000.0, 600.0)
        );
        assert_eq!(
            fit(
                maximized(placement(3000.0, 200.0, 1000.0, 600.0)),
                &screens,
                0.0
            ),
            maximized(placement(460.0, 240.0, 1000.0, 600.0))
        );
    }

    #[test]
    fn with_no_screens_listed_the_saved_placement_is_used_as_is() {
        let saved = placement(10.0, 10.0, 900.0, 600.0);

        assert_eq!(fit(saved, &[], 0.0), saved);
        assert_eq!(fit_size(saved, &[]), saved);
    }

    #[test]
    fn without_known_positions_only_the_size_is_fitted_to_the_largest_screen() {
        let screens = [
            area(0.0, 0.0, 1920.0, 1080.0),
            area(0.0, 0.0, 2560.0, 1440.0),
        ];

        assert_eq!(
            fit_size(placement(0.0, 0.0, 2300.0, 1300.0), &screens),
            placement(0.0, 0.0, 2300.0, 1300.0)
        );
        assert_eq!(
            fit_size(placement(0.0, 0.0, 3000.0, 2000.0), &screens),
            placement(0.0, 0.0, 2560.0, 1440.0)
        );
    }

    #[test]
    fn maximizing_keeps_the_size_the_window_returns_to() {
        let normal = placement(100.0, 100.0, 1200.0, 800.0);
        let screen = area(0.0, 0.0, 1920.0, 1080.0);

        assert_eq!(
            next(Some(normal), Seen::Maximized(Some(screen))),
            Some(maximized(normal))
        );
        assert_eq!(
            next(Some(normal), Seen::Maximized(None)),
            Some(maximized(normal))
        );
        assert_eq!(next(None, Seen::Maximized(Some(screen))), None);
        let moved = placement(300.0, 120.0, 1000.0, 700.0);
        assert_eq!(next(Some(normal), Seen::Normal(moved)), Some(moved));
    }

    #[test]
    fn maximizing_on_another_screen_moves_the_normal_size_there() {
        let normal = placement(100.0, 100.0, 1200.0, 800.0);
        let other = area(1920.0, 0.0, 2560.0, 1440.0);

        assert_eq!(
            next(Some(normal), Seen::Maximized(Some(other))),
            Some(maximized(placement(2600.0, 320.0, 1200.0, 800.0)))
        );
    }

    #[test]
    fn a_sample_within_a_point_of_the_placement_is_not_a_move() {
        let placed = placement(400.0, 237.5, 1000.0, 680.0);

        assert!(!moved(
            Some(placed),
            &placement(400.0, 238.0, 1000.0, 680.5)
        ));
        assert!(moved(Some(placed), &placement(400.0, 240.0, 1000.0, 680.0)));
        assert!(moved(Some(placed), &maximized(placed)));
        assert!(moved(None, &placed));
    }

    #[test]
    fn an_unusable_sample_is_not_recorded() {
        let normal = placement(100.0, 100.0, 1200.0, 800.0);

        assert_eq!(
            next(
                Some(normal),
                Seen::Normal(placement(-32000.0, -32000.0, 0.0, 0.0))
            ),
            None
        );
    }

    #[test]
    fn a_saved_placement_round_trips_through_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join(FILE_NAME);
        let saved = maximized(placement(-1280.0, 40.5, 1180.0, 790.0));

        write(&path, &saved).unwrap();

        assert_eq!(read(&path).unwrap(), Some(saved));
    }

    #[test]
    fn a_missing_file_means_no_saved_placement() {
        let dir = tempfile::tempdir().unwrap();

        assert_eq!(read(&dir.path().join(FILE_NAME)).unwrap(), None);
    }

    #[test]
    fn a_damaged_incomplete_or_empty_file_is_not_used() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        std::fs::write(&path, b"{\"x\":").unwrap();
        assert!(read(&path).is_err());

        std::fs::write(&path, br#"{"x":0,"y":0,"width":900,"maximized":false}"#).unwrap();
        assert!(read(&path).is_err());

        for (width, height) in [(0, 600), (-900, 600), (900, -1)] {
            std::fs::write(
                &path,
                format!(r#"{{"x":0,"y":0,"width":{width},"height":{height},"maximized":false}}"#),
            )
            .unwrap();
            assert_eq!(read(&path).unwrap(), None, "{width}x{height}");
        }
    }
}
