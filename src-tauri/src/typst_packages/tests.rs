use super::*;
use std::fs;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

fn capabilities(version: &str) -> TypstCapabilities {
    oleafly_core::typst_toolchain::capabilities_for(version).clone()
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn fake_package(root: &Path, namespace: &str, name: &str, version: &str, body: &str) -> PathBuf {
    let directory = root.join(namespace).join(name).join(version);
    write(
        &directory.join("typst.toml"),
        &format!(
            "[package]\nname = \"{name}\"\nversion = \"{version}\"\nentrypoint = \"lib.typ\"\n"
        ),
    );
    write(&directory.join("lib.typ"), body);
    directory
}

fn spec(text: &str) -> PackageSpec {
    PackageSpec::parse(text).unwrap()
}

fn index_json() -> String {
    serde_json::json!([
        {"name": "cetz", "version": "0.4.2", "description": "Drawing", "keywords": ["draw"], "categories": ["visualization"], "compiler": "0.13.0", "updatedAt": 10},
        {"name": "cetz", "version": "0.10.0", "description": "Drawing with Typst", "authors": ["Johannes"], "license": "LGPL-3.0-or-later", "keywords": ["draw", "canvas"], "categories": ["visualization"], "compiler": "0.14.0", "updatedAt": 30, "homepage": "https://cetz.example"},
        {"name": "cetz", "version": "0.5.2", "description": "Old", "updatedAt": 20},
        {"name": "tablex", "version": "0.0.9", "description": "Tables", "template": {"path": "template"}},
        {"name": "broken", "version": 7},
        {"name": "", "version": "1.0.0"}
    ])
    .to_string()
}

#[test]
fn app_directories_live_under_the_data_root() {
    let dirs = TypstPackageDirs::app(Path::new("/data"));
    assert_eq!(dirs.package_path, Path::new("/data/typst/packages"));
    assert_eq!(dirs.cache_path, Path::new("/data/typst/packages-cache"));
    assert_eq!(
        TypstPackageDirs::for_project(Path::new("/data"), Path::new("/project"), false),
        dirs
    );
}

#[test]
fn vendoring_moves_the_package_path_into_the_project_and_keeps_the_shared_cache() {
    let dirs = TypstPackageDirs::for_project(Path::new("/data"), Path::new("/project"), true);
    assert_eq!(dirs.package_path, Path::new("/project/typst-packages"));
    assert_eq!(dirs.cache_path, Path::new("/data/typst/packages-cache"));
}

#[test]
fn compile_flags_are_passed_only_to_versions_that_accept_them() {
    let dirs = TypstPackageDirs::app(Path::new("/data"));
    for version in ["0.12.0", "0.13.1", "0.14.2", "0.15.1"] {
        assert_eq!(
            dirs.compile_flags(&capabilities(version)),
            vec![
                TypstCompileFlag::PackagePath(PathBuf::from("/data/typst/packages")),
                TypstCompileFlag::PackageCachePath(PathBuf::from("/data/typst/packages-cache")),
            ],
            "{version}"
        );
    }
    assert!(dirs.compile_flags(&capabilities("0.11.1")).is_empty());
}

#[test]
fn the_environment_names_both_directories_for_every_version() {
    let dirs = TypstPackageDirs::app(Path::new("/data"));
    assert_eq!(
        dirs.environment(),
        vec![
            (
                "TYPST_PACKAGE_PATH",
                Path::new("/data")
                    .join("typst")
                    .join("packages")
                    .into_os_string()
            ),
            (
                "TYPST_PACKAGE_CACHE_PATH",
                Path::new("/data")
                    .join("typst")
                    .join("packages-cache")
                    .into_os_string()
            ),
        ]
    );
}

#[test]
fn offline_compiles_send_every_proxy_to_a_closed_local_port() {
    let environment = offline_environment();
    for name in [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ] {
        assert!(
            environment.contains(&(name, "http://127.0.0.1:9")),
            "{name} is not redirected"
        );
    }
    assert!(environment.contains(&("NO_PROXY", "")));
    assert!(environment.contains(&("no_proxy", "")));
}

#[test]
fn package_specs_parse_strictly() {
    let parsed = spec("@preview/cetz:0.4.2");
    assert_eq!(parsed.namespace, "preview");
    assert_eq!(parsed.name, "cetz");
    assert_eq!(parsed.version, "0.4.2");
    assert_eq!(parsed.to_string(), "@preview/cetz:0.4.2");
    assert_eq!(
        parsed.relative_dir(),
        Path::new("preview").join("cetz").join("0.4.2")
    );
    for invalid in [
        "@preview/cetz",
        "@preview/cetz:0.4",
        "@preview/../cetz:0.4.2",
        "@preview/cetz:0.4.2/x",
        "@/cetz:0.4.2",
        "@preview/Ce tz:0.4.2",
        "@preview/cetz:01.4.2.1",
        "preview/cetz:0.4.2",
    ] {
        assert!(PackageSpec::parse(invalid).is_none(), "{invalid}");
    }
}

#[test]
fn package_specs_are_read_from_string_literals_outside_comments() {
    let source = r#"#import "@preview/cetz:0.4.2": canvas
// #import "@preview/commented:1.0.0"
/* #import "@preview/blocked:1.0.0" */
#let text = "not a package @preview/x:1.0.0"
#import "@local/mine:0.1.0" as mine
#let escaped = "quote \" @preview/inside:1.0.0"
#import ("@preview/fletcher:" + "0.5.0")
#import "@preview/cetz:0.4.2"
"#;
    assert_eq!(
        specs_in_source(source),
        vec![spec("@preview/cetz:0.4.2"), spec("@local/mine:0.1.0")]
    );
}

#[test]
fn deps_inputs_map_back_to_the_packages_they_came_from() {
    let cache = Path::new("/data/typst/packages-cache");
    let local = Path::new("/data/typst/packages");
    let deps = serde_json::json!({
        "inputs": [
            "/data/typst/packages-cache/preview/cetz/0.4.2/src/lib.typ",
            "/data/typst/packages-cache/preview/cetz/0.4.2/typst.toml",
            "/data/typst/packages-cache/preview/oxifmt/0.2.1/lib.typ",
            "/data/typst/packages/local/mine/0.1.0/lib.typ",
            "main.typ",
            "/elsewhere/preview/x/1.0.0/lib.typ"
        ],
        "outputs": ["main.pdf"]
    })
    .to_string();
    assert_eq!(
        specs_from_deps(&deps, &[local, cache]).unwrap(),
        BTreeSet::from([
            spec("@preview/cetz:0.4.2"),
            spec("@preview/oxifmt:0.2.1"),
            spec("@local/mine:0.1.0"),
        ])
    );
    assert!(specs_from_deps("not json", &[cache]).is_err());
}

#[test]
fn vendoring_copies_cached_and_local_packages_and_their_dependencies() {
    let data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let app = TypstPackageDirs::app(data.path());
    fake_package(
        &app.cache_path,
        "preview",
        "alpha",
        "1.0.0",
        "#import \"@preview/beta:2.0.0\": helper\n#let alpha = helper",
    );
    fake_package(
        &app.cache_path,
        "preview",
        "beta",
        "2.0.0",
        "#let helper = 1",
    );
    fake_package(&app.cache_path, "preview", "unused", "1.0.0", "#let x = 1");
    fake_package(&app.package_path, "local", "mine", "0.1.0", "#let mine = 1");
    write(
        &project.path().join("main.typ"),
        "#import \"@preview/alpha:1.0.0\": alpha\n#include \"chapters/one.typ\"\n// #import \"@preview/unused:1.0.0\"\n",
    );
    write(
        &project.path().join("chapters/one.typ"),
        "#import \"@local/mine:0.1.0\": mine\n#import \"@preview/absent:3.0.0\"\n",
    );

    let report = vendor_into_project(project.path(), &app, None).unwrap();
    assert_eq!(
        report.vendored,
        vec![
            "@local/mine:0.1.0",
            "@preview/alpha:1.0.0",
            "@preview/beta:2.0.0"
        ]
    );
    assert_eq!(report.missing, vec!["@preview/absent:3.0.0"]);
    assert!(report.unchanged.is_empty());
    let vendor = project.path().join(VENDOR_DIR);
    for relative in [
        "preview/alpha/1.0.0/lib.typ",
        "preview/alpha/1.0.0/typst.toml",
        "preview/beta/2.0.0/lib.typ",
        "local/mine/0.1.0/lib.typ",
    ] {
        assert!(vendor.join(relative).is_file(), "{relative} was not copied");
    }
    assert!(!vendor.join("preview/unused").exists());

    let again = vendor_into_project(project.path(), &app, None).unwrap();
    assert!(again.vendored.is_empty());
    assert_eq!(
        again.unchanged,
        vec![
            "@local/mine:0.1.0",
            "@preview/alpha:1.0.0",
            "@preview/beta:2.0.0"
        ]
    );
    assert_eq!(vendored_packages(project.path()), again.unchanged);
}

#[test]
fn deps_from_the_compiler_add_packages_the_source_scan_cannot_see() {
    let data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let app = TypstPackageDirs::app(data.path());
    let dynamic = fake_package(&app.cache_path, "preview", "dynamic", "0.3.0", "#let d = 1");
    write(&project.path().join("main.typ"), "Hello");
    let deps = serde_json::json!({
        "inputs": [dynamic.join("lib.typ").to_string_lossy(), "main.typ"]
    })
    .to_string();
    let report = vendor_into_project(project.path(), &app, Some(&deps)).unwrap();
    assert_eq!(report.vendored, vec!["@preview/dynamic:0.3.0"]);
}

#[cfg(unix)]
#[test]
fn vendoring_skips_symlinks_inside_packages() {
    let data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let app = TypstPackageDirs::app(data.path());
    let package = fake_package(&app.cache_path, "preview", "linked", "1.0.0", "#let l = 1");
    let outside = data.path().join("secret.txt");
    write(&outside, "secret");
    std::os::unix::fs::symlink(&outside, package.join("leak.txt")).unwrap();
    write(
        &project.path().join("main.typ"),
        "#import \"@preview/linked:1.0.0\"",
    );
    vendor_into_project(project.path(), &app, None).unwrap();
    let copied = project.path().join(VENDOR_DIR).join("preview/linked/1.0.0");
    assert!(copied.join("lib.typ").is_file());
    assert!(!copied.join("leak.txt").exists());
}

#[test]
fn the_vendor_flag_survives_clearing_the_version_pin() {
    let mut meta = ProjectMeta {
        main_doc: "main.typ".into(),
        engine: "typst".into(),
        ..ProjectMeta::default()
    };
    assert!(!vendor_flag(&meta));
    set_vendor_flag(&mut meta, true);
    assert!(vendor_flag(&meta));
    assert_eq!(
        serde_json::to_value(&meta).unwrap()["typst"],
        serde_json::json!({"vendor_packages": true})
    );
    meta.set_typst_version_pin(None);
    assert!(vendor_flag(&meta));
    set_vendor_flag(&mut meta, false);
    assert!(meta.typst.is_none());

    meta.set_typst_version_pin(Some("0.15.1".into()));
    set_vendor_flag(&mut meta, true);
    set_vendor_flag(&mut meta, false);
    assert_eq!(meta.typst_version_pin(), Some("0.15.1"));
}

#[test]
fn index_entries_are_grouped_by_package_with_the_newest_version_first() {
    let packages = summarize_index(index_json().as_bytes()).unwrap();
    assert_eq!(
        packages
            .iter()
            .map(|package| package.name.as_str())
            .collect::<Vec<_>>(),
        ["cetz", "tablex"]
    );
    let cetz = &packages[0];
    assert_eq!(cetz.version, "0.10.0");
    assert_eq!(cetz.versions, ["0.10.0", "0.5.2", "0.4.2"]);
    assert_eq!(cetz.description, "Drawing with Typst");
    assert_eq!(cetz.compiler.as_deref(), Some("0.14.0"));
    assert_eq!(cetz.keywords, ["draw", "canvas"]);
    assert_eq!(cetz.authors, ["Johannes"]);
    assert_eq!(cetz.homepage.as_deref(), Some("https://cetz.example"));
    assert_eq!(cetz.updated_at, Some(30));
    assert!(!cetz.template);
    assert!(packages[1].template);
    assert!(summarize_index(b"{}").is_err());
}

struct FakeFetch {
    calls: Arc<AtomicUsize>,
    result: Result<Vec<u8>, String>,
}

impl FakeFetch {
    fn ok() -> Self {
        Self {
            calls: Arc::new(AtomicUsize::new(0)),
            result: Ok(index_json().into_bytes()),
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

const HOUR_MS: u64 = 60 * 60 * 1000;

fn load(
    cache: &Path,
    now: u64,
    offline: bool,
    refresh: bool,
    fetch: &FakeFetch,
) -> Result<TypstUniverseIndex, String> {
    tauri::async_runtime::block_on(load_index(cache, now, offline, refresh, || fetch.fetch()))
}

#[test]
fn the_index_is_fetched_once_and_served_from_the_cache_for_a_day() {
    let directory = tempfile::tempdir().unwrap();
    let cache = directory.path().join("typst").join(INDEX_CACHE_FILE);
    let fetch = FakeFetch::ok();
    let first = load(&cache, 1_000, false, false, &fetch).unwrap();
    assert_eq!(fetch.calls(), 1);
    assert_eq!(first.fetched_at, 1_000);
    assert!(!first.stale);
    assert_eq!(first.packages.len(), 2);
    assert!(cache.is_file());

    let cached = load(&cache, 1_000 + 23 * HOUR_MS, false, false, &fetch).unwrap();
    assert_eq!(fetch.calls(), 1);
    assert_eq!(cached.packages, first.packages);

    let refreshed = load(&cache, 1_000 + 25 * HOUR_MS, false, false, &fetch).unwrap();
    assert_eq!(fetch.calls(), 2);
    assert_eq!(refreshed.fetched_at, 1_000 + 25 * HOUR_MS);

    load(&cache, 1_000 + 25 * HOUR_MS, false, true, &fetch).unwrap();
    assert_eq!(fetch.calls(), 3);
}

#[test]
fn offline_reads_only_the_cache_even_when_it_is_old() {
    let directory = tempfile::tempdir().unwrap();
    let cache = directory.path().join(INDEX_CACHE_FILE);
    let fetch = FakeFetch::ok();
    let error = load(&cache, 1_000, true, false, &fetch).unwrap_err();
    assert!(error.contains("typst_packages.index_offline"), "{error}");
    assert_eq!(fetch.calls(), 0);

    load(&cache, 1_000, false, false, &fetch).unwrap();
    let offline = load(&cache, 1_000 + 72 * HOUR_MS, true, true, &fetch).unwrap();
    assert_eq!(fetch.calls(), 1);
    assert!(offline.stale);
    assert_eq!(offline.packages.len(), 2);
}

#[test]
fn a_failed_fetch_falls_back_to_the_old_cache() {
    let directory = tempfile::tempdir().unwrap();
    let cache = directory.path().join(INDEX_CACHE_FILE);
    load(&cache, 1_000, false, false, &FakeFetch::ok()).unwrap();
    let failing = FakeFetch::failing();
    let stale = load(&cache, 1_000 + 48 * HOUR_MS, false, false, &failing).unwrap();
    assert_eq!(failing.calls(), 1);
    assert!(stale.stale);
    assert_eq!(stale.fetched_at, 1_000);

    let empty = tempfile::tempdir().unwrap();
    let error = load(
        &empty.path().join(INDEX_CACHE_FILE),
        1_000,
        false,
        false,
        &failing,
    )
    .unwrap_err();
    assert!(
        error.contains("typst_packages.index_unavailable"),
        "{error}"
    );
}

#[test]
fn a_damaged_cache_is_ignored() {
    let directory = tempfile::tempdir().unwrap();
    let cache = directory.path().join(INDEX_CACHE_FILE);
    write(&cache, "{ not json");
    let fetch = FakeFetch::ok();
    let index = load(&cache, 5, false, false, &fetch).unwrap();
    assert_eq!(fetch.calls(), 1);
    assert_eq!(index.packages.len(), 2);
}

#[test]
fn the_index_downloads_over_http_and_refuses_oversized_bodies() {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let body = index_json();
    let server = std::thread::spawn(move || {
        for (index, stream) in listener.incoming().take(3).enumerate() {
            let mut stream = stream.unwrap();
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request);
            let response = if index != 1 {
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
            } else {
                "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    .to_string()
            };
            stream.write_all(response.as_bytes()).unwrap();
        }
    });
    let url = format!("http://{address}/preview/index.json");
    let bytes = tauri::async_runtime::block_on(fetch_index_bytes(&url, MAX_INDEX_BYTES)).unwrap();
    assert_eq!(summarize_index(&bytes).unwrap().len(), 2);
    let error =
        tauri::async_runtime::block_on(fetch_index_bytes(&url, MAX_INDEX_BYTES)).unwrap_err();
    assert!(error.contains("503"), "{error}");
    let error = tauri::async_runtime::block_on(fetch_index_bytes(&url, 16)).unwrap_err();
    assert!(error.contains("too large"), "{error}");
    server.join().unwrap();
}

fn bundled_typst() -> Option<PathBuf> {
    let triple = crate::biber_toolchain::host_triple_guess()?;
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("typst-{triple}{}", std::env::consts::EXE_SUFFIX));
    path.is_file().then_some(path)
}

fn bundled_resolved(path: PathBuf) -> ResolvedTypst {
    let version = oleafly_core::typst_toolchain::bundled_typst_version().clone();
    ResolvedTypst {
        path,
        capabilities: capabilities(&version.to_string()),
        version,
        source: oleafly_core::typst_toolchain::TypstSource::Bundled,
    }
}

#[test]
fn the_bundled_typst_vendors_with_deps_and_compiles_offline_from_the_project() {
    let Some(typst) = bundled_typst() else {
        eprintln!("Typst sidecar is not staged; skipping the vendoring compile");
        return;
    };
    let typst = bundled_resolved(typst);
    let data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let app = TypstPackageDirs::app(data.path());
    fake_package(
        &app.cache_path,
        "preview",
        "zz-oleafly-fake",
        "0.1.0",
        "#import \"@preview/zz-oleafly-dep:1.2.3\": inner\n#let hello() = inner",
    );
    fake_package(
        &app.cache_path,
        "preview",
        "zz-oleafly-dep",
        "1.2.3",
        "#let inner = [Inner]",
    );
    fake_package(
        &app.package_path,
        "local",
        "zz-mine",
        "0.2.0",
        "#let mine = [Mine]",
    );
    let dynamic_import = "#let name = \"zz-oleafly-fake\"\n#import (\"@preview/\" + name + \":0.1.0\"): hello\n#import \"@local/zz-mine:0.2.0\": mine\n#hello() #mine\n";
    write(&project.path().join("main.typ"), dynamic_import);

    let deps = run_deps_compile(&typst, project.path(), "main.typ", &app, true).unwrap();
    let report = vendor_into_project(project.path(), &app, deps.as_deref()).unwrap();
    assert_eq!(
        report.vendored,
        vec![
            "@local/zz-mine:0.2.0",
            "@preview/zz-oleafly-dep:1.2.3",
            "@preview/zz-oleafly-fake:0.1.0"
        ]
    );
    assert!(report.missing.is_empty());

    let empty_data = tempfile::tempdir().unwrap();
    let vendored = TypstPackageDirs::for_project(empty_data.path(), project.path(), true);
    let output = tempfile::tempdir().unwrap();
    let pdf = output.path().join("out.pdf");
    let args = oleafly_core::typst_toolchain::typst_compile_args(
        &typst.capabilities,
        &project.path().join("main.typ"),
        &pdf,
        project.path(),
        oleafly_core::typst_toolchain::TypstDiagnosticFormat::Short,
        &vendored.compile_flags(&typst.capabilities),
    )
    .unwrap();
    let mut command = std::process::Command::new(&typst.path);
    command.args(args).current_dir(project.path());
    for (name, value) in offline_environment() {
        command.env(name, value);
    }
    let result =
        crate::proc::output_contained_with_timeout(command, Duration::from_secs(60)).unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(pdf.is_file());
}

#[test]
fn an_offline_compile_of_an_uncached_package_fails_without_downloading() {
    let Some(typst) = bundled_typst() else {
        eprintln!("Typst sidecar is not staged; skipping the offline compile");
        return;
    };
    let typst = bundled_resolved(typst);
    let data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let app = TypstPackageDirs::app(data.path());
    write(
        &project.path().join("main.typ"),
        "#import \"@preview/cetz:0.4.2\": canvas\n",
    );
    let output = tempfile::tempdir().unwrap();
    let args = oleafly_core::typst_toolchain::typst_compile_args(
        &typst.capabilities,
        &project.path().join("main.typ"),
        &output.path().join("out.pdf"),
        project.path(),
        oleafly_core::typst_toolchain::TypstDiagnosticFormat::Short,
        &app.compile_flags(&typst.capabilities),
    )
    .unwrap();
    let mut command = std::process::Command::new(&typst.path);
    command.args(args).current_dir(project.path());
    for (name, value) in offline_environment() {
        command.env(name, value);
    }
    let result =
        crate::proc::output_contained_with_timeout(command, Duration::from_secs(60)).unwrap();
    assert!(!result.status.success());
    let log = String::from_utf8_lossy(&result.stderr);
    assert!(log.contains("failed to download package"), "{log}");
    assert!(!app.cache_path.join("preview").join("cetz").exists());
}

struct DataDir {
    _directory: tempfile::TempDir,
    root: PathBuf,
    _env: std::sync::MutexGuard<'static, ()>,
}

impl DataDir {
    fn new() -> Self {
        let env = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        Self {
            root: crate::paths::oleafly_root().unwrap(),
            _directory: directory,
            _env: env,
        }
    }
}

impl Drop for DataDir {
    fn drop(&mut self) {
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}

fn library_project(id: &str, vendor: bool) -> PathBuf {
    let root = crate::paths::create_project_dir(id).unwrap();
    fs::write(root.join("main.typ"), "= Hello\n").unwrap();
    let mut meta = ProjectMeta {
        name: id.into(),
        main_doc: "main.typ".into(),
        engine: "typst".into(),
        ..ProjectMeta::default()
    };
    set_vendor_flag(&mut meta, vendor);
    crate::project::write_meta_at(&root.join("project.json"), &meta).unwrap();
    root
}

#[test]
fn the_language_server_and_snippets_resolve_packages_like_the_project_compile() {
    let data = DataDir::new();
    let app = TypstPackageDirs::app(&data.root);
    let shared = library_project("packages-shared", false);
    let vendored = library_project("packages-vendored", true);
    let canonical = |path: &Path| path.canonicalize().unwrap_or_else(|_| path.to_path_buf());

    let environment = language_server_environment("packages-shared");
    assert_eq!(
        environment,
        vec![
            (
                "TYPST_PACKAGE_PATH",
                app.package_path.clone().into_os_string()
            ),
            (
                "TYPST_PACKAGE_CACHE_PATH",
                app.cache_path.clone().into_os_string()
            ),
        ]
    );
    let environment = language_server_environment("packages-vendored");
    assert_eq!(
        canonical(Path::new(&environment[0].1)),
        canonical(&vendored.join(VENDOR_DIR))
    );
    assert_eq!(environment[1].1, app.cache_path.clone().into_os_string());

    assert_eq!(snippet_dirs(None).unwrap(), app);
    assert_eq!(snippet_dirs(Some("packages-shared")).unwrap(), app);
    let snippet = snippet_dirs(Some("packages-vendored")).unwrap();
    assert_eq!(
        canonical(&snippet.package_path),
        canonical(&vendored.join(VENDOR_DIR))
    );
    assert_eq!(
        language_server_environment("missing-project"),
        app.environment()
    );
    assert!(shared.is_dir());
}
