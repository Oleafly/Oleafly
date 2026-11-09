use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, SystemTime};

use tauri::Manager;

use crate::app_error::AppError;

use crate::typst_render::{
    TypstDiagnosticSeverity, TypstSnippetDiagnostic, TypstSnippetFormat, TypstSnippetImage,
    TypstSnippetRender, TypstSnippetRequest,
};

const TIMEOUT: Duration = Duration::from_secs(10);
pub const MAX_SOURCE_BYTES: usize = 64 * 1024;
pub const MAX_SVG_BYTES: usize = 8 * 1024 * 1024;
const CACHE_ENTRIES: usize = 48;
const CACHE_BYTES: usize = 32 * 1024 * 1024;
const MAX_RENDERS: usize = 2;
const DISK_FOLDER: &str = "notes-typst";
const DISK_ENTRIES: usize = 500;
const DISK_BYTES: u64 = 50 * 1024 * 1024;

type Renderer = Arc<dyn Fn(String) -> Result<String, String> + Send + Sync>;
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
        if let Some(index) = self.entries.iter().position(|(entry, _)| *entry == key) {
            if let Some((_, old)) = self.entries.remove(index) {
                self.bytes -= old.len();
            }
        }
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

    #[cfg(test)]
    fn remove(&mut self, key: &str) {
        if let Some(index) = self.entries.iter().position(|(entry, _)| entry == key) {
            if let Some((_, old)) = self.entries.remove(index) {
                self.bytes -= old.len();
            }
        }
    }
}

fn cache() -> &'static Mutex<Rendered> {
    static CACHE: OnceLock<Mutex<Rendered>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Rendered::default()))
}

fn with_cache<T>(apply: impl FnOnce(&mut Rendered) -> T) -> T {
    let mut guard = cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    apply(&mut guard)
}

fn renders() -> &'static tokio::sync::Semaphore {
    static RENDERS: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
    RENDERS.get_or_init(|| tokio::sync::Semaphore::new(MAX_RENDERS))
}

fn lock_flights() -> MutexGuard<'static, HashMap<String, Flight>> {
    static FLIGHTS: OnceLock<Mutex<HashMap<String, Flight>>> = OnceLock::new();
    FLIGHTS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
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
    let path = disk_path(dir, key).ok_or("This Typst cache key is not valid.")?;
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

async fn produce(
    key: String,
    source: String,
    dir: Option<PathBuf>,
    render: Renderer,
) -> Result<Arc<String>, String> {
    if let Some(svg) = with_cache(|cache| cache.get(&key)) {
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
        Some(svg) => svg,
        None => {
            let _permit = renders()
                .acquire()
                .await
                .map_err(|error| error.to_string())?;
            let write_key = key.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let svg = render(source)?;
                if let Some(dir) = dir {
                    let _ = disk_write(&dir, &write_key, &svg, DISK_ENTRIES, DISK_BYTES);
                }
                Ok::<_, String>(svg)
            })
            .await
            .map_err(|error| error.to_string())??
        }
    };
    let svg = Arc::new(svg);
    with_cache(|cache| cache.insert(key, Arc::clone(&svg)));
    Ok(svg)
}

async fn render_shared(
    key: String,
    source: String,
    dir: Option<PathBuf>,
    render: Renderer,
) -> Result<Arc<String>, String> {
    let flight = Arc::clone(lock_flights().entry(key.clone()).or_default());
    let result = flight
        .get_or_init(|| produce(key.clone(), source, dir, render))
        .await
        .clone();
    let mut flights = lock_flights();
    if flights
        .get(&key)
        .is_some_and(|current| Arc::ptr_eq(current, &flight))
    {
        flights.remove(&key);
    }
    result
}

pub fn source_key(typst_version: &str, source: &str) -> String {
    crate::collab::disk::sha256_hex(format!("typst {typst_version}\0{source}").as_bytes())
}

pub fn check_source(source: &str) -> Result<(), String> {
    if source.trim().is_empty() {
        return Err(AppError::new("notes.typst_empty").into());
    }
    if source.len() > MAX_SOURCE_BYTES {
        return Err(AppError::new("notes.typst_too_large").into());
    }
    Ok(())
}

pub fn snippet_request(source: String) -> TypstSnippetRequest {
    TypstSnippetRequest {
        source,
        format: TypstSnippetFormat::Svg,
        ppi: None,
        project_id: None,
        document: false,
        offline: true,
    }
}

fn located(diagnostic: &TypstSnippetDiagnostic) -> String {
    match diagnostic.line {
        Some(line) => AppError::new("notes.typst_line")
            .param("line", line)
            .param("message", &diagnostic.message)
            .into(),
        None => diagnostic.message.clone(),
    }
}

pub fn render_outcome(render: TypstSnippetRender) -> Result<String, String> {
    match render {
        TypstSnippetRender::Rendered {
            image: TypstSnippetImage::Svg { svg },
            ..
        } => {
            if svg.len() > MAX_SVG_BYTES {
                Err(AppError::new("notes.typst_image_too_large").into())
            } else {
                Ok(svg)
            }
        }
        TypstSnippetRender::Rendered { .. } => Err(AppError::new("notes.typst_no_svg").into()),
        TypstSnippetRender::Failed { diagnostics } => Err(diagnostics
            .iter()
            .find(|diagnostic| diagnostic.severity == TypstDiagnosticSeverity::Error)
            .or_else(|| diagnostics.first())
            .map(located)
            .unwrap_or_else(|| AppError::new("notes.typst_failed").into())),
    }
}

fn render_with(
    typst: &oleafly_core::typst_toolchain::ResolvedTypst,
    source: String,
) -> Result<String, String> {
    let packages = crate::typst_packages::snippet_dirs(None).ok();
    let render = crate::typst_render::render_snippet(
        &typst.path,
        &typst.capabilities,
        packages.as_ref(),
        &snippet_request(source),
        TIMEOUT,
    )?;
    render_outcome(render)
}

#[tauri::command]
pub async fn notes_render_typst(app: tauri::AppHandle, source: String) -> Result<String, String> {
    check_source(&source)?;
    let typst =
        tauri::async_runtime::spawn_blocking(|| crate::typst_toolchain::snippet_typst(None))
            .await
            .map_err(|error| error.to_string())??;
    let key = source_key(&typst.version.to_string(), &source);
    if let Some(svg) = with_cache(|cache| cache.get(&key)) {
        return Ok(svg.as_ref().clone());
    }
    let dir = app
        .path()
        .app_cache_dir()
        .ok()
        .map(|dir| dir.join(DISK_FOLDER));
    let render: Renderer = Arc::new(move |source| render_with(&typst, source));
    render_shared(key, source, dir, render)
        .await
        .map(|svg| svg.as_ref().clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    const TYPST: &str = "0.14.0";

    fn diagnostic(
        severity: TypstDiagnosticSeverity,
        message: &str,
        line: Option<u32>,
    ) -> TypstSnippetDiagnostic {
        TypstSnippetDiagnostic {
            severity,
            message: message.into(),
            line,
            column: None,
        }
    }

    #[test]
    fn rejects_empty_and_oversized_sources() {
        assert!(check_source("   \n")
            .unwrap_err()
            .contains("notes.typst_empty"));
        assert!(check_source(&"x".repeat(MAX_SOURCE_BYTES + 1))
            .unwrap_err()
            .contains("notes.typst_too_large"));
        assert!(check_source("$ x $").is_ok());
    }

    #[test]
    fn requests_an_offline_svg_snippet_outside_any_project() {
        let request = snippet_request("$ x $".into());
        assert_eq!(request.format, TypstSnippetFormat::Svg);
        assert!(request.offline);
        assert!(request.project_id.is_none());
        assert!(!request.document);
        assert!(request.ppi.is_none());
    }

    #[test]
    fn keys_are_stable_sha256_digests_of_the_typst_version_and_source() {
        assert_eq!(source_key(TYPST, "a"), source_key(TYPST, "a"));
        assert_ne!(source_key(TYPST, "a"), source_key(TYPST, "b"));
        assert_ne!(source_key(TYPST, "a"), source_key("0.15.0", "a"));
        assert_ne!(source_key("0.1", "4.0a"), source_key("0.14.0", "a"));
        assert_eq!(source_key(TYPST, "").len(), 64);
    }

    #[test]
    fn errors_are_coded_for_the_interface() {
        let english = |error: String| crate::app_error::english(&error).unwrap();
        assert_eq!(
            english(check_source("   \n").unwrap_err()),
            "This Typst block is empty."
        );
        assert_eq!(
            english(
                render_outcome(TypstSnippetRender::Failed {
                    diagnostics: vec![diagnostic(
                        TypstDiagnosticSeverity::Error,
                        "unclosed delimiter",
                        Some(2)
                    )],
                })
                .unwrap_err()
            ),
            "Line 2: unclosed delimiter"
        );
        for code in [
            "notes.typst_empty",
            "notes.typst_too_large",
            "notes.typst_image_too_large",
            "notes.typst_no_svg",
            "notes.typst_failed",
            "notes.typst_line",
        ] {
            let text: String = AppError::new(code).into();
            assert!(crate::app_error::english(&text).is_some(), "{code}");
        }
    }

    #[test]
    fn outcomes_return_the_svg_or_the_first_error() {
        assert_eq!(
            render_outcome(TypstSnippetRender::Rendered {
                image: TypstSnippetImage::Svg {
                    svg: "<svg/>".into()
                },
                diagnostics: Vec::new(),
            }),
            Ok("<svg/>".into())
        );
        assert!(render_outcome(TypstSnippetRender::Rendered {
            image: TypstSnippetImage::Svg {
                svg: "x".repeat(MAX_SVG_BYTES + 1)
            },
            diagnostics: Vec::new(),
        })
        .unwrap_err()
        .contains("notes.typst_image_too_large"));
        assert!(render_outcome(TypstSnippetRender::Rendered {
            image: TypstSnippetImage::Png {
                png_base64: "AA==".into()
            },
            diagnostics: Vec::new(),
        })
        .is_err());
        assert_eq!(
            render_outcome(TypstSnippetRender::Failed {
                diagnostics: vec![
                    diagnostic(TypstDiagnosticSeverity::Warning, "unknown font", Some(1)),
                    diagnostic(
                        TypstDiagnosticSeverity::Error,
                        "unclosed delimiter",
                        Some(2)
                    ),
                ],
            }),
            Err(AppError::new("notes.typst_line")
                .param("line", 2)
                .param("message", "unclosed delimiter")
                .into())
        );
        assert_eq!(
            render_outcome(TypstSnippetRender::Failed {
                diagnostics: vec![diagnostic(
                    TypstDiagnosticSeverity::Warning,
                    "only a warning",
                    None
                )],
            }),
            Err("only a warning".into())
        );
        assert!(render_outcome(TypstSnippetRender::Failed {
            diagnostics: Vec::new()
        })
        .unwrap_err()
        .contains("notes.typst_failed"));
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

    fn counting(
        calls: Arc<std::sync::atomic::AtomicUsize>,
        result: Result<&'static str, &'static str>,
    ) -> Renderer {
        Arc::new(move |_source| {
            calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(20));
            result.map(str::to_string).map_err(str::to_string)
        })
    }

    #[tokio::test]
    async fn concurrent_requests_for_one_source_render_once() {
        let source = "$ shared-flight $".to_string();
        let key = source_key(TYPST, &source);
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let render = counting(calls.clone(), Ok("<svg>one</svg>"));
        let requests =
            (0..5).map(|_| render_shared(key.clone(), source.clone(), None, render.clone()));
        let results = futures_util::future::join_all(requests).await;
        assert!(results
            .iter()
            .all(|result| result.as_deref().map(String::as_str) == Ok("<svg>one</svg>")));
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(lock_flights().get(&key).is_none());
    }

    #[tokio::test]
    async fn renders_run_at_most_two_at_a_time() {
        let running = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let most = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let (now, peak) = (running.clone(), most.clone());
        let render: Renderer = Arc::new(move |source| {
            let current = now.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            peak.fetch_max(current, std::sync::atomic::Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(40));
            now.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
            Ok(format!("<svg>{source}</svg>"))
        });
        let requests = (0..6).map(|index| {
            let source = format!("$ limit-{index} $");
            render_shared(source_key(TYPST, &source), source, None, render.clone())
        });
        let results = futures_util::future::join_all(requests).await;
        assert!(results.iter().all(Result::is_ok));
        let peak = most.load(std::sync::atomic::Ordering::SeqCst);
        assert!((1..=MAX_RENDERS).contains(&peak), "{peak}");
    }

    #[tokio::test]
    async fn failures_are_not_kept_and_the_next_request_renders_again() {
        let source = "$ fails-once $".to_string();
        let key = source_key(TYPST, &source);
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let failed = render_shared(
            key.clone(),
            source.clone(),
            None,
            counting(calls.clone(), Err("Line 1: bad")),
        )
        .await;
        assert_eq!(failed.unwrap_err(), "Line 1: bad");
        let worked = render_shared(key, source, None, counting(calls.clone(), Ok("<svg/>"))).await;
        assert_eq!(worked.unwrap().as_str(), "<svg/>");
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn rendered_svgs_are_kept_on_disk_across_restarts() {
        let dir = tempfile::tempdir().unwrap();
        let source = "$ on-disk $".to_string();
        let key = source_key(TYPST, &source);
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let first = render_shared(
            key.clone(),
            source.clone(),
            Some(dir.path().to_path_buf()),
            counting(calls.clone(), Ok("<svg>disk</svg>")),
        )
        .await
        .unwrap();
        assert_eq!(first.as_str(), "<svg>disk</svg>");
        assert!(dir.path().join(format!("{key}.svg")).is_file());
        with_cache(|cache| cache.remove(&key));
        let again = render_shared(
            key.clone(),
            source,
            Some(dir.path().to_path_buf()),
            counting(calls.clone(), Err("should not render")),
        )
        .await
        .unwrap();
        assert_eq!(again.as_str(), "<svg>disk</svg>");
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(with_cache(|cache| cache.get(&key)).is_some());
    }

    #[test]
    fn the_disk_cache_drops_the_oldest_entries_past_its_caps() {
        let dir = tempfile::tempdir().unwrap();
        let keys: Vec<String> = (0..5)
            .map(|index| source_key(TYPST, &format!("prune-{index}")))
            .collect();
        let start = std::time::SystemTime::now() - Duration::from_secs(600);
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
        disk_write(
            dir.path(),
            &source_key(TYPST, "prune-new"),
            "0123456789",
            4,
            1_000,
        )
        .unwrap();
        let left = |key: &str| dir.path().join(format!("{key}.svg")).is_file();
        assert!(left(&keys[0]), "a cache hit counts as recent");
        assert!(!left(&keys[1]) && !left(&keys[2]));
        assert!(left(&keys[3]) && left(&keys[4]) && left(&source_key(TYPST, "prune-new")));
        disk_write(
            dir.path(),
            &source_key(TYPST, "prune-big"),
            "0123456789",
            100,
            25,
        )
        .unwrap();
        let svgs = std::fs::read_dir(dir.path())
            .unwrap()
            .filter(|entry| {
                entry
                    .as_ref()
                    .is_ok_and(|entry| entry.path().extension().is_some_and(|ext| ext == "svg"))
            })
            .count();
        assert_eq!(svgs, 2);
        assert!(left(&source_key(TYPST, "prune-big")));
    }

    #[test]
    fn disk_reads_refuse_bad_keys_and_oversized_files() {
        let dir = tempfile::tempdir().unwrap();
        assert!(disk_read(dir.path(), "../escape").is_none());
        assert!(disk_write(dir.path(), "not-a-key", "<svg/>", 10, 10).is_err());
        let key = source_key(TYPST, "too-big");
        std::fs::write(
            dir.path().join(format!("{key}.svg")),
            "x".repeat(MAX_SVG_BYTES + 1),
        )
        .unwrap();
        assert!(disk_read(dir.path(), &key).is_none());
        assert!(disk_read(dir.path(), &source_key(TYPST, "missing")).is_none());
    }

    #[test]
    fn renders_a_snippet_with_the_bundled_typst_when_present() {
        let triple = match crate::biber_toolchain::host_triple_guess() {
            Some(triple) => triple,
            None => return,
        };
        let typst = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("typst-{triple}{}", std::env::consts::EXE_SUFFIX));
        if !typst.is_file() {
            return;
        }
        let capabilities = oleafly_core::typst_toolchain::capabilities_for(
            &oleafly_core::typst_toolchain::bundled_typst_version().to_string(),
        );
        let render = crate::typst_render::render_snippet(
            &typst,
            capabilities,
            None,
            &snippet_request("$ E = m c^2 $".into()),
            TIMEOUT,
        )
        .unwrap();
        assert!(render_outcome(render).unwrap().contains("<svg"));
        let failed = crate::typst_render::render_snippet(
            &typst,
            capabilities,
            None,
            &snippet_request("#let x = (".into()),
            TIMEOUT,
        )
        .unwrap();
        assert!(render_outcome(failed)
            .unwrap_err()
            .contains("\"line\":\"1\""));
    }
}
