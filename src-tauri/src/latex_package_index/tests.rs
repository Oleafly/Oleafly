use super::*;
use std::fs;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

const HOUR_MS: u64 = 60 * 60 * 1000;

fn ctan_json() -> String {
    serde_json::json!([
        {"key": "amsmath", "name": "amsmath", "caption": "AMS mathematical facilities for LaTeX"},
        {"key": "a4wide", "name": "a4wide", "caption": "<q>Wide</q> a4 layout"},
        {"key": "aalok", "name": "Aalok", "caption": "LaTeX class for the journal <i>Aalok</i> &amp; friends"},
        {"key": "ieeetran", "name": "IEEEtran", "caption": "Document class for IEEE Transactions journals and conferences"},
        {"key": "zz-oleafly-only-on-ctan", "name": "ZZ", "caption": "  A   package\nonly CTAN knows  "},
        {"key": "../escape", "name": "bad", "caption": "Not a package name"},
        {"key": "", "name": "empty", "caption": "No key"},
        {"name": "missing", "caption": "No key at all"},
        {"key": "nocaption", "name": "nocaption"}
    ])
    .to_string()
}

fn entry<'a>(index: &'a LatexPackageIndex, name: &str) -> &'a LatexPackageEntry {
    index
        .packages
        .iter()
        .find(|entry| entry.name == name)
        .unwrap_or_else(|| panic!("{name} is not in the index"))
}

fn has(index: &LatexPackageIndex, name: &str) -> bool {
    index.packages.iter().any(|entry| entry.name == name)
}

struct FakeFetch {
    calls: Arc<AtomicUsize>,
    result: Result<Vec<u8>, String>,
}

impl FakeFetch {
    fn ok() -> Self {
        Self {
            calls: Arc::new(AtomicUsize::new(0)),
            result: Ok(ctan_json().into_bytes()),
        }
    }

    fn failing() -> Self {
        Self {
            calls: Arc::new(AtomicUsize::new(0)),
            result: Err("offline".into()),
        }
    }

    fn fetch(&self) -> impl std::future::Future<Output = Result<Vec<u8>, String>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let result = self.result.clone();
        async move { result }
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

fn load(
    cache: &Path,
    now: u64,
    offline: bool,
    refresh: bool,
    fetch: &FakeFetch,
) -> LatexPackageIndex {
    tauri::async_runtime::block_on(load_index(cache, now, offline, refresh, || fetch.fetch()))
}

#[test]
fn ctan_entries_keep_valid_keys_and_plain_text_captions() {
    let packages = parse_ctan_packages(ctan_json().as_bytes()).unwrap();
    let keys: Vec<&str> = packages.iter().map(|entry| entry.key.as_str()).collect();
    assert_eq!(
        keys,
        [
            "amsmath",
            "a4wide",
            "aalok",
            "ieeetran",
            "zz-oleafly-only-on-ctan",
            "nocaption"
        ]
    );
    assert_eq!(packages[1].caption, "\"Wide\" a4 layout");
    assert_eq!(
        packages[2].caption,
        "LaTeX class for the journal Aalok & friends"
    );
    assert_eq!(packages[4].caption, "A package only CTAN knows");
    assert_eq!(packages[5].caption, "");
}

#[test]
fn a_ctan_body_that_is_not_a_package_list_is_rejected() {
    assert!(parse_ctan_packages(b"{\"key\": \"amsmath\"}").is_err());
    assert!(parse_ctan_packages(b"<html>maintenance</html>").is_err());
    assert!(parse_ctan_packages(b"[]").is_err());
    assert!(parse_ctan_packages(b"[{\"key\": \"../x\"}]").is_err());
}

#[test]
fn captions_decode_entities_and_drop_markup() {
    assert_eq!(
        plain_caption(
            "<span>Typeset</span> &lt;tags&gt; &#38; &#x41;&quot;B&quot; &apos;c&#39; &bogus;"
        ),
        "Typeset <tags> & A\"B\" 'c' &bogus;"
    );
    let long = "word ".repeat(200);
    assert!(plain_caption(&long).chars().count() <= MAX_CAPTION_CHARS);
}

#[test]
fn the_bundled_list_works_without_any_network() {
    let index = bundled_index();
    assert_eq!(index.source, LatexIndexSource::Bundled);
    assert_eq!(index.fetched_at, None);
    assert!(!index.stale);
    assert!(index.packages.len() > 2000, "{}", index.packages.len());
    let amsmath = entry(&index, "amsmath");
    assert!(amsmath.bundled);
    assert!(!amsmath.ctan);
    assert_eq!(amsmath.caption, "AMS mathematical facilities for LaTeX");
    assert!(index
        .packages
        .windows(2)
        .all(|pair| pair[0].name < pair[1].name));
    assert!(index
        .packages
        .iter()
        .all(|entry| entry.document_class.is_none()));
}

#[test]
fn ctan_packages_merge_into_the_bundled_list() {
    let ctan = parse_ctan_packages(ctan_json().as_bytes()).unwrap();
    let packages = merge_packages(Some(&ctan));
    let index = LatexPackageIndex {
        source: LatexIndexSource::Ctan,
        fetched_at: Some(1),
        stale: false,
        packages,
    };
    let amsmath = entry(&index, "amsmath");
    assert!(amsmath.bundled && amsmath.ctan);
    let ctan_only = entry(&index, "zz-oleafly-only-on-ctan");
    assert!(ctan_only.ctan && !ctan_only.bundled);
    assert_eq!(ctan_only.caption, "A package only CTAN knows");
    let bundled_only = entry(&index, "geometry");
    assert!(bundled_only.bundled && !bundled_only.ctan);
    assert_eq!(
        entry(&index, "ieeetran").document_class.as_deref(),
        Some("IEEEtran")
    );
    assert_eq!(entry(&index, "a4wide").caption, "\"Wide\" a4 layout");
    assert!(entry(&index, "a4wide").document_class.is_none());
    assert!(has(&index, "nocaption"));
    let names: BTreeSet<&str> = index
        .packages
        .iter()
        .map(|entry| entry.name.as_str())
        .collect();
    assert_eq!(names.len(), index.packages.len());
}

#[test]
fn a_bundled_caption_fills_a_missing_ctan_caption() {
    let ctan = vec![CtanPackage {
        key: "booktabs".into(),
        caption: String::new(),
    }];
    let packages = merge_packages(Some(&ctan));
    let booktabs = packages
        .iter()
        .find(|entry| entry.name == "booktabs")
        .unwrap();
    assert!(booktabs.ctan);
    assert_eq!(booktabs.caption, "Publication quality tables in LaTeX");
}

#[test]
fn the_list_is_fetched_once_and_served_from_the_cache_for_a_day() {
    let directory = tempfile::tempdir().unwrap();
    let cache = directory.path().join("catalogs").join(CACHE_FILE);
    let fetch = FakeFetch::ok();
    let first = load(&cache, 1_000, false, false, &fetch);
    assert_eq!(fetch.calls(), 1);
    assert_eq!(first.source, LatexIndexSource::Ctan);
    assert_eq!(first.fetched_at, Some(1_000));
    assert!(!first.stale);
    assert!(has(&first, "zz-oleafly-only-on-ctan"));
    assert!(cache.is_file());

    let cached = load(&cache, 1_000 + 23 * HOUR_MS, false, false, &fetch);
    assert_eq!(fetch.calls(), 1);
    assert_eq!(cached.packages, first.packages);

    let refreshed = load(&cache, 1_000 + 25 * HOUR_MS, false, false, &fetch);
    assert_eq!(fetch.calls(), 2);
    assert_eq!(refreshed.fetched_at, Some(1_000 + 25 * HOUR_MS));

    load(&cache, 1_000 + 25 * HOUR_MS, false, true, &fetch);
    assert_eq!(fetch.calls(), 3);
}

#[test]
fn offline_uses_an_old_cache_and_never_fetches() {
    let directory = tempfile::tempdir().unwrap();
    let cache = directory.path().join(CACHE_FILE);
    let fetch = FakeFetch::ok();
    let bundled = load(&cache, 1_000, true, false, &fetch);
    assert_eq!(fetch.calls(), 0);
    assert_eq!(bundled.source, LatexIndexSource::Bundled);
    assert!(!has(&bundled, "zz-oleafly-only-on-ctan"));

    load(&cache, 1_000, false, false, &fetch);
    let offline = load(&cache, 1_000 + 72 * HOUR_MS, true, true, &fetch);
    assert_eq!(fetch.calls(), 1);
    assert_eq!(offline.source, LatexIndexSource::Ctan);
    assert!(offline.stale);
    assert_eq!(offline.fetched_at, Some(1_000));
    assert!(has(&offline, "zz-oleafly-only-on-ctan"));
}

#[test]
fn a_failed_fetch_falls_back_to_the_old_cache_then_the_bundled_list() {
    let directory = tempfile::tempdir().unwrap();
    let cache = directory.path().join(CACHE_FILE);
    load(&cache, 1_000, false, false, &FakeFetch::ok());
    let failing = FakeFetch::failing();
    let stale = load(&cache, 1_000 + 48 * HOUR_MS, false, false, &failing);
    assert_eq!(failing.calls(), 1);
    assert_eq!(stale.source, LatexIndexSource::Ctan);
    assert!(stale.stale);
    assert_eq!(stale.fetched_at, Some(1_000));

    let empty = tempfile::tempdir().unwrap();
    let bundled = load(
        &empty.path().join(CACHE_FILE),
        1_000,
        false,
        false,
        &failing,
    );
    assert_eq!(bundled.source, LatexIndexSource::Bundled);
    assert!(has(&bundled, "amsmath"));
    assert!(!empty.path().join(CACHE_FILE).exists());
}

#[test]
fn a_damaged_cache_or_body_is_ignored() {
    let directory = tempfile::tempdir().unwrap();
    let cache = directory.path().join(CACHE_FILE);
    fs::write(&cache, "{ not json").unwrap();
    let fetch = FakeFetch::ok();
    let index = load(&cache, 5, false, false, &fetch);
    assert_eq!(fetch.calls(), 1);
    assert_eq!(index.source, LatexIndexSource::Ctan);

    let garbage = FakeFetch {
        calls: Arc::new(AtomicUsize::new(0)),
        result: Ok(b"<html>busy</html>".to_vec()),
    };
    let kept = load(&cache, 5 + 25 * HOUR_MS, false, false, &garbage);
    assert_eq!(garbage.calls(), 1);
    assert_eq!(kept.fetched_at, Some(5));
    assert!(kept.stale);
}

#[test]
fn the_list_downloads_over_http_and_refuses_oversized_bodies() {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let body = ctan_json();
    let server = std::thread::spawn(move || {
        for (index, stream) in listener.incoming().take(3).enumerate() {
            let mut stream = stream.unwrap();
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request);
            let response = if index == 1 {
                "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    .to_string()
            } else {
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
            };
            stream.write_all(response.as_bytes()).unwrap();
        }
    });
    let url = format!("http://{address}/json/2.0/packages");
    let bytes = tauri::async_runtime::block_on(fetch_ctan_bytes(&url, MAX_INDEX_BYTES)).unwrap();
    assert_eq!(parse_ctan_packages(&bytes).unwrap().len(), 6);
    let error =
        tauri::async_runtime::block_on(fetch_ctan_bytes(&url, MAX_INDEX_BYTES)).unwrap_err();
    assert!(error.contains("503"), "{error}");
    let error = tauri::async_runtime::block_on(fetch_ctan_bytes(&url, 16)).unwrap_err();
    assert!(error.contains("too large"), "{error}");
    server.join().unwrap();
}
