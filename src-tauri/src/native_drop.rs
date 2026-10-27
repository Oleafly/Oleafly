#[cfg(target_os = "linux")]
mod linux_gtk;

use std::sync::Mutex;
use std::time::{Duration, Instant};

const DROP_LIFETIME: Duration = Duration::from_secs(10);
const READ_LIFETIME: Duration = Duration::from_secs(60);
/// The largest dropped file read into the webview. Above every importer's
/// own limit (the converters take 128 MiB), so only a drop that would never
/// be used is refused, before a multi-gigabyte read runs out of memory.
const MAX_DROPPED_FILE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Default)]
pub struct NativeDropState(Mutex<NativeDrop>);

#[derive(Default)]
struct NativeDrop {
    #[cfg(any(target_os = "linux", test))]
    drag: usize,
    paths: Vec<String>,
    dropped_at: Option<Instant>,
    released: Vec<String>,
    released_at: Option<Instant>,
}

impl NativeDrop {
    #[cfg(any(target_os = "linux", test))]
    fn motion(&mut self, drag: usize) {
        if self.drag != drag {
            self.drag = drag;
            self.paths.clear();
            self.dropped_at = None;
        }
    }

    #[cfg(any(target_os = "linux", test))]
    fn offer(&mut self, drag: usize, paths: Vec<String>) {
        if self.drag == drag && self.paths == paths {
            return;
        }
        self.drag = drag;
        self.paths = paths;
        self.dropped_at = None;
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
        self.dropped_at = None;
        if !fresh {
            return Vec::new();
        }
        self.released = paths.clone();
        self.released_at = Some(now);
        paths
    }

    fn readable(&self, path: &str, now: Instant) -> bool {
        self.released_at
            .is_some_and(|at| now.saturating_duration_since(at) <= READ_LIFETIME)
            && self.released.iter().any(|released| released == path)
    }
}

impl NativeDropState {
    fn with<T>(&self, f: impl FnOnce(&mut NativeDrop) -> T) -> T {
        let mut drop = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        f(&mut drop)
    }

    /// Whether `path` came from the drop the webview just took, so a command
    /// may read it as if it had been picked in a dialog.
    pub(crate) fn released(&self, path: &str) -> bool {
        self.with(|drop| drop.readable(path, Instant::now()))
    }
}

#[tauri::command]
pub fn take_dropped_paths(state: tauri::State<'_, NativeDropState>) -> Vec<String> {
    state.with(|drop| drop.take(Instant::now()))
}

#[tauri::command]
pub async fn read_dropped_file(
    state: tauri::State<'_, NativeDropState>,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    if !state.with(|drop| drop.readable(&path, Instant::now())) {
        return Err(format!("{path} was not dropped on Oleafly"));
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        read_capped(std::path::Path::new(&path), MAX_DROPPED_FILE_BYTES)
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// A dropped file's bytes: a regular file of at most `cap` bytes, read no
/// further than the cap even if it grows meanwhile.
fn read_capped(path: &std::path::Path, cap: u64) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    let too_large = || {
        format!(
            "{} is larger than {} MiB",
            path.display(),
            cap / (1024 * 1024)
        )
    };
    if metadata.len() > cap {
        return Err(too_large());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    std::fs::File::open(path)
        .map_err(|error| error.to_string())?
        .take(cap + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > cap {
        return Err(too_large());
    }
    Ok(bytes)
}

#[cfg(target_os = "linux")]
pub(crate) use linux_gtk::plugin;

#[cfg(target_os = "linux")]
fn local_paths<'a>(uris: impl Iterator<Item = &'a str>) -> Vec<String> {
    uris.filter_map(|uri| gtk::glib::filename_from_uri(uri).ok())
        .filter_map(|(path, _host)| path.to_str().map(str::to_owned))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dropped_folder_or_an_oversized_file_is_not_read() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_capped(dir.path(), 16)
            .unwrap_err()
            .contains("not a file"));
        let file = dir.path().join("big.bin");
        std::fs::write(&file, vec![7u8; 32]).unwrap();
        assert!(read_capped(&file, 16).unwrap_err().contains("larger than"));
        assert_eq!(read_capped(&file, 32).unwrap(), vec![7u8; 32]);
    }

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
    fn only_paths_handed_over_by_a_drop_can_be_read_and_only_for_a_minute() {
        let now = Instant::now();
        let mut drop = NativeDrop::default();
        drop.offer(7, paths(&["/home/a/figure.png"]));
        assert!(!drop.readable("/home/a/figure.png", now));
        drop.dropped(7, now);
        assert!(!drop.readable("/home/a/figure.png", now));
        drop.take(now);
        assert!(drop.readable("/home/a/figure.png", now));
        assert!(!drop.readable("/home/a/.ssh/id_ed25519", now));
        assert!(!drop.readable(
            "/home/a/figure.png",
            now + READ_LIFETIME + Duration::from_millis(1)
        ));
    }

    #[test]
    fn a_path_from_the_drop_the_webview_took_counts_as_picked() {
        let state = NativeDropState::default();
        assert!(!state.released("/home/a/figure.png"));
        state.with(|drop| {
            drop.offer(7, paths(&["/home/a/figure.png"]));
            drop.dropped(7, Instant::now());
            drop.take(Instant::now());
        });
        assert!(state.released("/home/a/figure.png"));
        assert!(!state.released("/home/a/.ssh/id_ed25519"));
    }

    #[test]
    fn a_new_drag_keeps_the_last_drop_readable_until_the_next_hand_over() {
        let now = Instant::now();
        let mut drop = NativeDrop::default();
        drop.offer(7, paths(&["/home/a/figure.png"]));
        drop.dropped(7, now);
        drop.take(now);
        drop.motion(8);
        drop.offer(8, paths(&["/home/a/other.png"]));
        assert!(drop.readable("/home/a/figure.png", now));
        drop.dropped(8, now);
        drop.take(now);
        assert!(!drop.readable("/home/a/figure.png", now));
        assert!(drop.readable("/home/a/other.png", now));
    }

    #[test]
    fn a_stale_hand_over_releases_nothing_new() {
        let now = Instant::now();
        let mut drop = NativeDrop::default();
        drop.offer(7, paths(&["/home/a/figure.png"]));
        drop.dropped(7, now);
        assert!(drop
            .take(now + DROP_LIFETIME + Duration::from_millis(1))
            .is_empty());
        assert!(!drop.readable("/home/a/figure.png", now));
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
