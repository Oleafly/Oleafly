use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::SystemTime;

use tauri::Manager;

pub const MAX_SVG_BYTES: usize = 8 * 1024 * 1024;
const CACHE_ENTRIES: usize = 48;
const CACHE_BYTES: usize = 32 * 1024 * 1024;
const MAX_RENDERS: usize = 2;
const DISK_ENTRIES: usize = 500;
const DISK_BYTES: u64 = 50 * 1024 * 1024;

type Flight = Arc<tokio::sync::OnceCell<Result<Arc<String>, String>>>;

#[derive(Default)]
struct Rendered {
    entries: VecDeque<(String, Arc<String>)>,
    bytes: usize,
}

impl Rendered {
    fn get(&mut self, key: &str) -> Option<Arc<String>> {
        let index = self.entries.iter().position(|(entry, _)| entry == key)?;
        let entry = self.entries.remove(index)?;
        let svg = Arc::clone(&entry.1);
        self.entries.push_back(entry);
        Some(svg)
    }

    fn insert(&mut self, key: String, svg: Arc<String>) {
        self.remove(&key);
        while !self.entries.is_empty()
            && (self.entries.len() >= CACHE_ENTRIES || self.bytes + svg.len() > CACHE_BYTES)
        {
            if let Some((_, old)) = self.entries.pop_front() {
                self.bytes -= old.len();
            }
        }
        self.bytes += svg.len();
        self.entries.push_back((key, svg));
    }

    fn remove(&mut self, key: &str) {
        if let Some(index) = self.entries.iter().position(|(entry, _)| entry == key) {
            if let Some((_, old)) = self.entries.remove(index) {
                self.bytes -= old.len();
            }
        }
    }
}

pub struct RenderStore {
    folder: &'static str,
    cache: Mutex<Rendered>,
    flights: Mutex<HashMap<String, Flight>>,
    renders: tokio::sync::Semaphore,
}

impl RenderStore {
    pub fn new(folder: &'static str) -> Self {
        Self {
            folder,
            cache: Mutex::default(),
            flights: Mutex::default(),
            renders: tokio::sync::Semaphore::new(MAX_RENDERS),
        }
    }

    fn with_cache<T>(&self, apply: impl FnOnce(&mut Rendered) -> T) -> T {
        let mut guard = self.cache.lock().unwrap_or_else(PoisonError::into_inner);
        apply(&mut guard)
    }

    fn lock_flights(&self) -> MutexGuard<'_, HashMap<String, Flight>> {
        self.flights.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn cached(&self, key: &str) -> Option<Arc<String>> {
        self.with_cache(|cache| cache.get(key))
    }

    pub fn disk_dir(&self, app: &tauri::AppHandle) -> Option<PathBuf> {
        app.path()
            .app_cache_dir()
            .ok()
            .map(|dir| dir.join(self.folder))
    }

    async fn produce<F, Fut>(
        &self,
        key: String,
        dir: Option<PathBuf>,
        render: F,
    ) -> Result<Arc<String>, String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<String, String>>,
    {
        if let Some(svg) = self.cached(&key) {
            return Ok(svg);
        }
        let read_dir = dir.clone();
        let read_key = key.clone();
        let stored = tauri::async_runtime::spawn_blocking(move || {
            read_dir.and_then(|dir| disk_read(&dir, &read_key))
        })
        .await
        .ok()
        .flatten();
        let svg = match stored {
            Some(svg) => Arc::new(svg),
            None => {
                let _permit = self
                    .renders
                    .acquire()
                    .await
                    .map_err(|error| error.to_string())?;
                let svg = Arc::new(render().await?);
                if let Some(dir) = dir {
                    let (write_key, written) = (key.clone(), Arc::clone(&svg));
                    let _ = tauri::async_runtime::spawn_blocking(move || {
                        disk_write(&dir, &write_key, &written, DISK_ENTRIES, DISK_BYTES)
                    })
                    .await;
                }
                svg
            }
        };
        self.with_cache(|cache| cache.insert(key, Arc::clone(&svg)));
        Ok(svg)
    }

    pub async fn render<F, Fut>(
        &self,
        key: String,
        dir: Option<PathBuf>,
        render: F,
    ) -> Result<Arc<String>, String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<String, String>>,
    {
        let flight = Arc::clone(self.lock_flights().entry(key.clone()).or_default());
        let result = flight
            .get_or_init(|| self.produce(key.clone(), dir, render))
            .await
            .clone();
        let mut flights = self.lock_flights();
        if flights
            .get(&key)
            .is_some_and(|current| Arc::ptr_eq(current, &flight))
        {
            flights.remove(&key);
        }
        result
    }
}

fn disk_path(dir: &Path, key: &str) -> Option<PathBuf> {
    let valid = key.len() == 64 && key.bytes().all(|byte| byte.is_ascii_hexdigit());
    valid.then(|| dir.join(format!("{key}.svg")))
}

fn disk_read(dir: &Path, key: &str) -> Option<String> {
    let path = disk_path(dir, key)?;
    let metadata = std::fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_SVG_BYTES as u64 {
        return None;
    }
    let svg = std::fs::read_to_string(&path).ok()?;
    let _ = std::fs::File::options()
        .write(true)
        .open(&path)
        .and_then(|file| file.set_modified(SystemTime::now()));
    Some(svg)
}

fn disk_write(dir: &Path, key: &str, svg: &str, entries: usize, bytes: u64) -> Result<(), String> {
    let path = disk_path(dir, key).ok_or("This render cache key is not valid.")?;
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    crate::sandbox::atomic_write(&path, svg.as_bytes())?;
    prune(dir, entries, bytes);
    Ok(())
}

fn prune(dir: &Path, entries: usize, bytes: u64) {
    let Ok(listing) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(SystemTime, u64, PathBuf)> = listing
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "svg"))
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            metadata.is_file().then(|| {
                let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                (modified, metadata.len(), entry.path())
            })
        })
        .collect();
    files.sort_by_key(|(modified, _, _)| *modified);
    let mut count = files.len();
    let mut total: u64 = files.iter().map(|(_, len, _)| len).sum();
    for (_, len, path) in files {
        if count <= entries && total <= bytes {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            count -= 1;
            total = total.saturating_sub(len);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    fn key(name: &str) -> String {
        crate::collab::disk::sha256_hex(name.as_bytes())
    }

    async fn counted(
        calls: Arc<AtomicUsize>,
        result: Result<&'static str, &'static str>,
    ) -> Result<String, String> {
        calls.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(20)).await;
        result.map(str::to_string).map_err(str::to_string)
    }

    #[test]
    fn the_cache_keeps_recent_renders_within_its_caps() {
        let mut cache = Rendered::default();
        for index in 0..CACHE_ENTRIES + 2 {
            cache.insert(format!("{index}"), Arc::new("x".repeat(10)));
        }
        assert_eq!(cache.entries.len(), CACHE_ENTRIES);
        assert!(cache.get("0").is_none());
        assert!(cache.get("2").is_some());
        cache.insert("2".into(), Arc::new("y".repeat(20)));
        assert_eq!(cache.get("2").unwrap().as_str(), "y".repeat(20));
        assert_eq!(cache.bytes, (CACHE_ENTRIES - 1) * 10 + 20);
        let mut big = Rendered::default();
        big.insert("a".into(), Arc::new("x".repeat(CACHE_BYTES / 2)));
        big.insert("b".into(), Arc::new("x".repeat(CACHE_BYTES / 2)));
        big.insert("c".into(), Arc::new("x".repeat(CACHE_BYTES / 2)));
        assert!(big.get("a").is_none());
        assert!(big.get("c").is_some());
        assert!(big.bytes <= CACHE_BYTES);
    }

    #[tokio::test]
    async fn concurrent_requests_for_one_key_render_once() {
        let store = RenderStore::new("test");
        let shared = key("shared-flight");
        let calls = Arc::new(AtomicUsize::new(0));
        let requests = (0..5).map(|_| {
            let calls = calls.clone();
            store.render(shared.clone(), None, move || {
                counted(calls, Ok("<svg>one</svg>"))
            })
        });
        let results = futures_util::future::join_all(requests).await;
        assert!(results
            .iter()
            .all(|result| result.as_deref().map(String::as_str) == Ok("<svg>one</svg>")));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(store.lock_flights().get(&shared).is_none());
        assert!(store.cached(&shared).is_some());
    }

    #[tokio::test]
    async fn renders_run_at_most_two_at_a_time() {
        let store = RenderStore::new("test");
        let running = Arc::new(AtomicUsize::new(0));
        let most = Arc::new(AtomicUsize::new(0));
        let requests = (0..6).map(|index| {
            let (now, peak) = (running.clone(), most.clone());
            store.render(key(&format!("limit-{index}")), None, move || async move {
                let current = now.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(current, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(40)).await;
                now.fetch_sub(1, Ordering::SeqCst);
                Ok(format!("<svg>{index}</svg>"))
            })
        });
        let results = futures_util::future::join_all(requests).await;
        assert!(results.iter().all(Result::is_ok));
        let peak = most.load(Ordering::SeqCst);
        assert!((1..=MAX_RENDERS).contains(&peak), "{peak}");
    }

    #[tokio::test]
    async fn failures_are_not_kept_and_the_next_request_renders_again() {
        let store = RenderStore::new("test");
        let once = key("fails-once");
        let calls = Arc::new(AtomicUsize::new(0));
        let failed = store
            .render(once.clone(), None, || {
                counted(calls.clone(), Err("Line 1: bad"))
            })
            .await;
        assert_eq!(failed.unwrap_err(), "Line 1: bad");
        let worked = store
            .render(once, None, || counted(calls.clone(), Ok("<svg/>")))
            .await;
        assert_eq!(worked.unwrap().as_str(), "<svg/>");
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn rendered_svgs_are_kept_on_disk_across_restarts() {
        let dir = tempfile::tempdir().unwrap();
        let stored = key("on-disk");
        let calls = Arc::new(AtomicUsize::new(0));
        let first = RenderStore::new("test")
            .render(stored.clone(), Some(dir.path().to_path_buf()), || {
                counted(calls.clone(), Ok("<svg>disk</svg>"))
            })
            .await
            .unwrap();
        assert_eq!(first.as_str(), "<svg>disk</svg>");
        assert!(dir.path().join(format!("{stored}.svg")).is_file());
        let restarted = RenderStore::new("test");
        let again = restarted
            .render(stored.clone(), Some(dir.path().to_path_buf()), || {
                counted(calls.clone(), Err("should not render"))
            })
            .await
            .unwrap();
        assert_eq!(again.as_str(), "<svg>disk</svg>");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(restarted.cached(&stored).is_some());
    }

    #[test]
    fn the_disk_cache_drops_the_oldest_entries_past_its_caps() {
        let dir = tempfile::tempdir().unwrap();
        let keys: Vec<String> = (0..5).map(|index| key(&format!("prune-{index}"))).collect();
        let start = SystemTime::now() - Duration::from_secs(600);
        for (index, key) in keys.iter().enumerate() {
            disk_write(dir.path(), key, "0123456789", 100, 1_000).unwrap();
            let file = std::fs::File::options()
                .write(true)
                .open(dir.path().join(format!("{key}.svg")))
                .unwrap();
            file.set_modified(start + Duration::from_secs(index as u64 * 10))
                .unwrap();
        }
        assert!(disk_read(dir.path(), &keys[0]).is_some());
        disk_write(dir.path(), &key("prune-new"), "0123456789", 4, 1_000).unwrap();
        let left = |key: &str| dir.path().join(format!("{key}.svg")).is_file();
        assert!(left(&keys[0]), "a cache hit counts as recent");
        assert!(!left(&keys[1]) && !left(&keys[2]));
        assert!(left(&keys[3]) && left(&keys[4]) && left(&key("prune-new")));
        disk_write(dir.path(), &key("prune-big"), "0123456789", 100, 25).unwrap();
        let svgs = std::fs::read_dir(dir.path())
            .unwrap()
            .filter(|entry| {
                entry
                    .as_ref()
                    .is_ok_and(|entry| entry.path().extension().is_some_and(|ext| ext == "svg"))
            })
            .count();
        assert_eq!(svgs, 2);
        assert!(left(&key("prune-big")));
    }

    #[test]
    fn disk_reads_refuse_bad_keys_and_oversized_files() {
        let dir = tempfile::tempdir().unwrap();
        assert!(disk_read(dir.path(), "../escape").is_none());
        assert!(disk_write(dir.path(), "not-a-key", "<svg/>", 10, 10).is_err());
        let big = key("too-big");
        std::fs::write(
            dir.path().join(format!("{big}.svg")),
            "x".repeat(MAX_SVG_BYTES + 1),
        )
        .unwrap();
        assert!(disk_read(dir.path(), &big).is_none());
        assert!(disk_read(dir.path(), &key("missing")).is_none());
    }
}
