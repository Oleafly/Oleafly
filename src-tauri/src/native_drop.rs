use std::sync::Mutex;
use std::time::{Duration, Instant};

const DROP_LIFETIME: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct NativeDropState(Mutex<NativeDrop>);

#[derive(Default)]
struct NativeDrop {
    #[cfg(any(target_os = "linux", test))]
    drag: usize,
    paths: Vec<String>,
    dropped_at: Option<Instant>,
}

impl NativeDrop {
    #[cfg(any(target_os = "linux", test))]
    fn motion(&mut self, drag: usize) {
        if self.drag != drag {
            *self = Self {
                drag,
                ..Self::default()
            };
        }
    }

    #[cfg(any(target_os = "linux", test))]
    fn offer(&mut self, drag: usize, paths: Vec<String>) {
        if self.drag == drag && self.paths == paths {
            return;
        }
        *self = Self {
            drag,
            paths,
            dropped_at: None,
        };
    }

    #[cfg(any(target_os = "linux", test))]
    fn dropped(&mut self, drag: usize, now: Instant) {
        if self.drag == drag && !self.paths.is_empty() {
            self.dropped_at = Some(now);
        }
    }

    fn take(&mut self, now: Instant) -> Vec<String> {
        let fresh = self
            .dropped_at
            .is_some_and(|at| now.saturating_duration_since(at) <= DROP_LIFETIME);
        let paths = std::mem::take(&mut self.paths);
        *self = Self::default();
        if fresh {
            paths
        } else {
            Vec::new()
        }
    }
}

impl NativeDropState {
    fn with<T>(&self, f: impl FnOnce(&mut NativeDrop) -> T) -> T {
        let mut drop = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        f(&mut drop)
    }
}

#[tauri::command]
pub fn take_dropped_paths(state: tauri::State<'_, NativeDropState>) -> Vec<String> {
    state.with(|drop| drop.take(Instant::now()))
}

#[cfg(target_os = "linux")]
pub(crate) fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("oleafly-native-drop")
        .on_webview_ready(|webview| watch(&webview))
        .build()
}

#[cfg(target_os = "linux")]
fn watch<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
    use gtk::glib::ObjectType;
    use gtk::prelude::WidgetExt;
    use tauri::Manager;

    if webview.label() != webview.window().label() {
        return;
    }
    let app = webview.app_handle().clone();
    let _ = webview.with_webview(move |platform| {
        let view = platform.inner();
        let drag_id = |ctx: &gtk::gdk::DragContext| ctx.as_ptr() as usize;

        let state = app.clone();
        view.connect_drag_motion(move |_, ctx, _, _, _| {
            state
                .state::<NativeDropState>()
                .with(|drop| drop.motion(drag_id(ctx)));
            false
        });

        let state = app.clone();
        view.connect_drag_data_received(move |_, ctx, _, _, data, _, _| {
            let uris = data.uris();
            if uris.is_empty() {
                return;
            }
            let paths = local_paths(uris.iter().map(|uri| uri.as_str()));
            state
                .state::<NativeDropState>()
                .with(|drop| drop.offer(drag_id(ctx), paths));
        });

        let state = app;
        view.connect_drag_drop(move |_, ctx, _, _, _| {
            state
                .state::<NativeDropState>()
                .with(|drop| drop.dropped(drag_id(ctx), Instant::now()));
            false
        });
    });
}

#[cfg(target_os = "linux")]
fn local_paths<'a>(uris: impl Iterator<Item = &'a str>) -> Vec<String> {
    uris.filter_map(|uri| gtk::glib::filename_from_uri(uri).ok())
        .filter_map(|(path, _host)| path.to_str().map(str::to_owned))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    #[test]
    fn hands_over_the_paths_of_a_drop_once() {
        let now = Instant::now();
        let mut drop = NativeDrop::default();
        drop.motion(7);
        drop.offer(7, paths(&["/home/a/figure.png", "/home/a/notes"]));
        drop.dropped(7, now);
        assert_eq!(
            drop.take(now),
            paths(&["/home/a/figure.png", "/home/a/notes"])
        );
        assert!(drop.take(now).is_empty());
    }

    #[test]
    fn keeps_paths_back_until_the_drag_is_dropped() {
        let now = Instant::now();
        let mut drop = NativeDrop::default();
        drop.offer(7, paths(&["/home/a/figure.png"]));
        assert!(drop.take(now).is_empty());
        drop.dropped(7, now);
        assert!(drop.take(now).is_empty());
    }

    #[test]
    fn forgets_a_drop_nobody_took_in_time() {
        let now = Instant::now();
        let mut drop = NativeDrop::default();
        drop.offer(7, paths(&["/home/a/figure.png"]));
        drop.dropped(7, now);
        assert!(drop
            .take(now + DROP_LIFETIME + Duration::from_millis(1))
            .is_empty());
    }

    #[test]
    fn data_offered_again_during_the_drop_keeps_it_releasable() {
        let now = Instant::now();
        let mut drop = NativeDrop::default();
        drop.offer(7, paths(&["/home/a/figure.png"]));
        drop.dropped(7, now);
        drop.offer(7, paths(&["/home/a/figure.png"]));
        assert_eq!(drop.take(now), paths(&["/home/a/figure.png"]));
    }

    #[test]
    fn a_new_drag_clears_the_previous_paths() {
        let now = Instant::now();
        let mut drop = NativeDrop::default();
        drop.offer(7, paths(&["/home/a/figure.png"]));
        drop.motion(8);
        drop.dropped(8, now);
        assert!(drop.take(now).is_empty());
    }

    #[test]
    fn a_drop_from_another_drag_does_not_release_the_paths() {
        let now = Instant::now();
        let mut drop = NativeDrop::default();
        drop.offer(7, paths(&["/home/a/figure.png"]));
        drop.dropped(8, now);
        assert!(drop.take(now).is_empty());
    }

    #[test]
    fn a_drag_without_local_files_releases_nothing() {
        let now = Instant::now();
        let mut drop = NativeDrop::default();
        drop.offer(7, paths(&["/home/a/figure.png"]));
        drop.offer(9, Vec::new());
        drop.dropped(9, now);
        assert!(drop.take(now).is_empty());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn keeps_only_local_file_uris() {
        let uris = [
            "file:///home/a/My%20Figure.png",
            "https://example.com/figure.png",
            "file:///home/a/caf%C3%A9.tex",
        ];
        assert_eq!(
            local_paths(uris.into_iter()),
            paths(&["/home/a/My Figure.png", "/home/a/café.tex"])
        );
    }
}
