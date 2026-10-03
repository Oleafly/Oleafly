use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::ffi::OsString;
use std::fmt::{Display, Formatter};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use oleafly_core::typst_toolchain::{
    ResolvedTypst, ToolchainVersion, TypstCapabilities, TypstCompileFlag, TypstDiagnosticFormat,
};
use serde::{Deserialize, Serialize};

use crate::app_error::AppError;
use crate::project::ProjectMeta;

pub(crate) const VENDOR_DIR: &str = "typst-packages";
const TYPST_DATA_DIR: &str = "typst";
const PACKAGES_DIR: &str = "packages";
const PACKAGE_CACHE_DIR: &str = "packages-cache";
const INDEX_CACHE_FILE: &str = "universe-index.json";
const INDEX_URL: &str = "https://packages.typst.org/preview/index.json";
const INDEX_MAX_AGE_MS: u64 = 24 * 60 * 60 * 1000;
const INDEX_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const INDEX_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_INDEX_BYTES: usize = 32 * 1024 * 1024;
const PACKAGE_PATH_VARIABLE: &str = "TYPST_PACKAGE_PATH";
const PACKAGE_CACHE_PATH_VARIABLE: &str = "TYPST_PACKAGE_CACHE_PATH";
const OFFLINE_PROXY: &str = "http://127.0.0.1:9";
const PROXY_VARIABLES: [&str; 6] = [
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "ALL_PROXY",
    "all_proxy",
];
const VENDOR_COMPILE_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_SCANNED_FILES: usize = 5000;
const MAX_SCANNED_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TypstPackageDirs {
    pub(crate) package_path: PathBuf,
    pub(crate) cache_path: PathBuf,
}

impl TypstPackageDirs {
    pub(crate) fn app(data_root: &Path) -> Self {
        let typst = data_root.join(TYPST_DATA_DIR);
        Self {
            package_path: typst.join(PACKAGES_DIR),
            cache_path: typst.join(PACKAGE_CACHE_DIR),
        }
    }

    pub(crate) fn for_project(data_root: &Path, project_root: &Path, vendor: bool) -> Self {
        let app = Self::app(data_root);
        if vendor {
            Self {
                package_path: project_root.join(VENDOR_DIR),
                ..app
            }
        } else {
            app
        }
    }

    pub(crate) fn compile_flags(&self, capabilities: &TypstCapabilities) -> Vec<TypstCompileFlag> {
        [
            TypstCompileFlag::PackagePath(self.package_path.clone()),
            TypstCompileFlag::PackageCachePath(self.cache_path.clone()),
        ]
        .into_iter()
        .filter(|flag| capabilities.supports_flag(flag.name()))
        .collect()
    }

    pub(crate) fn environment(&self) -> Vec<(&'static str, OsString)> {
        vec![
            (
                PACKAGE_PATH_VARIABLE,
                self.package_path.as_os_str().to_owned(),
            ),
            (
                PACKAGE_CACHE_PATH_VARIABLE,
                self.cache_path.as_os_str().to_owned(),
            ),
        ]
    }
}

pub(crate) fn offline_environment() -> Vec<(&'static str, &'static str)> {
    PROXY_VARIABLES
        .into_iter()
        .map(|name| (name, OFFLINE_PROXY))
        .chain([("NO_PROXY", ""), ("no_proxy", "")])
        .collect()
}

pub(crate) fn vendor_flag(meta: &ProjectMeta) -> bool {
    meta.typst.as_ref().is_some_and(|spec| spec.vendor_packages)
}

pub(crate) fn set_vendor_flag(meta: &mut ProjectMeta, enabled: bool) {
    match meta.typst.as_mut() {
        Some(spec) => {
            spec.vendor_packages = enabled;
            if spec.is_empty() {
                meta.typst = None;
            }
        }
        None if enabled => {
            meta.typst = Some(oleafly_core::TypstSpec {
                vendor_packages: true,
                ..oleafly_core::TypstSpec::default()
            });
        }
        None => {}
    }
}

pub(crate) fn for_compile(
    meta: &ProjectMeta,
    project_root: &Path,
) -> Result<Option<TypstPackageDirs>, String> {
    if !crate::typst_toolchain::is_typst_project(meta) {
        return Ok(None);
    }
    Ok(Some(TypstPackageDirs::for_project(
        &crate::paths::oleafly_root()?,
        project_root,
        vendor_flag(meta),
    )))
}

fn project_dirs(project_id: &str, data_root: &Path) -> TypstPackageDirs {
    let project = crate::project::read_meta(project_id).ok().and_then(|meta| {
        let root = crate::project_location::locate(project_id).ok()?.root;
        Some((vendor_flag(&meta), root))
    });
    match project {
        Some((vendor, root)) => TypstPackageDirs::for_project(data_root, &root, vendor),
        None => TypstPackageDirs::app(data_root),
    }
}

pub(crate) fn snippet_dirs(project_id: Option<&str>) -> Result<TypstPackageDirs, String> {
    let data_root = crate::paths::oleafly_root()?;
    Ok(match project_id {
        Some(project_id) => project_dirs(project_id, &data_root),
        None => TypstPackageDirs::app(&data_root),
    })
}

pub(crate) fn language_server_environment(project_id: &str) -> Vec<(&'static str, OsString)> {
    crate::paths::oleafly_root()
        .map(|data_root| project_dirs(project_id, &data_root).environment())
        .unwrap_or_default()
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct PackageSpec {
    pub(crate) namespace: String,
    pub(crate) name: String,
    pub(crate) version: String,
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && !value.starts_with('-')
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_')
        })
}

fn valid_version(value: &str) -> bool {
    let parts: Vec<&str> = value.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.len() <= 9
                && part.bytes().all(|byte| byte.is_ascii_digit())
                && (part.len() == 1 || !part.starts_with('0'))
        })
}

impl PackageSpec {
    pub(crate) fn parse(text: &str) -> Option<Self> {
        let (namespace, rest) = text.strip_prefix('@')?.split_once('/')?;
        let (name, version) = rest.split_once(':')?;
        (valid_identifier(namespace) && valid_identifier(name) && valid_version(version)).then(
            || Self {
                namespace: namespace.to_owned(),
                name: name.to_owned(),
                version: version.to_owned(),
            },
        )
    }

    fn from_components(namespace: &str, name: &str, version: &str) -> Option<Self> {
        Self::parse(&format!("@{namespace}/{name}:{version}"))
    }

    pub(crate) fn relative_dir(&self) -> PathBuf {
        Path::new(&self.namespace)
            .join(&self.name)
            .join(&self.version)
    }
}

impl Display for PackageSpec {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "@{}/{}:{}",
            self.namespace, self.name, self.version
        )
    }
}

fn string_literals(source: &str) -> Vec<String> {
    let mut literals = Vec::new();
    let mut characters = source.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '/' if characters.peek() == Some(&'/') => {
                for next in characters.by_ref() {
                    if next == '\n' {
                        break;
                    }
                }
            }
            '/' if characters.peek() == Some(&'*') => {
                characters.next();
                let mut previous = '\0';
                for next in characters.by_ref() {
                    if previous == '*' && next == '/' {
                        break;
                    }
                    previous = next;
                }
            }
            '"' => {
                let mut literal = String::new();
                while let Some(next) = characters.next() {
                    match next {
                        '\\' => {
                            if let Some(escaped) = characters.next() {
                                literal.push(escaped);
                            }
                        }
                        '"' | '\n' => break,
                        other => literal.push(other),
                    }
                }
                literals.push(literal);
            }
            _ => {}
        }
    }
    literals
}

pub(crate) fn specs_in_source(source: &str) -> Vec<PackageSpec> {
    let mut seen = BTreeSet::new();
    string_literals(source)
        .into_iter()
        .filter_map(|literal| PackageSpec::parse(&literal))
        .filter(|spec| seen.insert(spec.clone()))
        .collect()
}

#[derive(Deserialize)]
struct DepsFile {
    #[serde(default)]
    inputs: Vec<String>,
}

fn spec_under(path: &Path, root: &Path) -> Option<PackageSpec> {
    let relative = path.strip_prefix(root).ok()?;
    let mut components = relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(part) => part.to_str(),
            _ => None,
        });
    PackageSpec::from_components(components.next()?, components.next()?, components.next()?)
}

pub(crate) fn specs_from_deps(
    json: &str,
    roots: &[&Path],
) -> Result<BTreeSet<PackageSpec>, String> {
    let deps: DepsFile = serde_json::from_str(json)
        .map_err(|error| format!("Typst wrote an unreadable dependency list: {error}"))?;
    let roots: Vec<PathBuf> = roots
        .iter()
        .flat_map(|root| {
            let canonical = root.canonicalize().ok();
            std::iter::once(root.to_path_buf()).chain(canonical)
        })
        .collect();
    Ok(deps
        .inputs
        .iter()
        .filter_map(|input| {
            let path = Path::new(input);
            roots.iter().find_map(|root| spec_under(path, root))
        })
        .collect())
}

fn typst_sources(root: &Path, skip_vendor: bool) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut pending = VecDeque::from([root.to_path_buf()]);
    while let Some(directory) = pending.pop_front() {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(std::fs::DirEntry::file_name);
        for entry in entries {
            if found.len() >= MAX_SCANNED_FILES {
                return found;
            }
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                let vendored = skip_vendor && directory == root && name == VENDOR_DIR;
                if !name.starts_with('.') && !vendored {
                    pending.push_back(entry.path());
                }
            } else if file_type.is_file()
                && Path::new(name)
                    .extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("typ"))
                && entry
                    .metadata()
                    .is_ok_and(|metadata| metadata.len() <= MAX_SCANNED_BYTES)
            {
                found.push(entry.path());
            }
        }
    }
    found
}

fn specs_in_tree(root: &Path, skip_vendor: bool) -> Vec<PackageSpec> {
    typst_sources(root, skip_vendor)
        .iter()
        .filter_map(|path| std::fs::read_to_string(path).ok())
        .flat_map(|source| specs_in_source(&source))
        .collect()
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstVendorReport {
    pub vendored: Vec<String>,
    pub unchanged: Vec<String>,
    pub missing: Vec<String>,
}

fn copy_tree(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::create_dir(destination)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

fn copy_package(source: &Path, destination: &Path) -> Result<(), String> {
    let failed = |error: std::io::Error| {
        AppError::new("typst_packages.vendor_failed")
            .detail(format!("{}: {error}", destination.display()))
            .to_string()
    };
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::new("typst_packages.vendor_failed").to_string())?;
    std::fs::create_dir_all(parent).map_err(failed)?;
    let version = destination
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let staging = parent.join(format!(".{version}.vendoring-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    if let Err(error) = copy_tree(source, &staging) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(failed(error));
    }
    if let Err(error) = std::fs::rename(&staging, destination) {
        let _ = std::fs::remove_dir_all(&staging);
        if !destination.is_dir() {
            return Err(failed(error));
        }
    }
    Ok(())
}

pub(crate) fn vendor_into_project(
    project_root: &Path,
    app: &TypstPackageDirs,
    deps_json: Option<&str>,
) -> Result<TypstVendorReport, String> {
    let vendor = project_root.join(VENDOR_DIR);
    let locations = [vendor.as_path(), &app.package_path, &app.cache_path];
    let locate = |spec: &PackageSpec| {
        locations
            .iter()
            .map(|root| root.join(spec.relative_dir()))
            .find(|directory| directory.is_dir())
    };
    let mut wanted: BTreeSet<PackageSpec> = match deps_json {
        Some(json) => specs_from_deps(json, &[&vendor, &app.package_path, &app.cache_path])?,
        None => BTreeSet::new(),
    };
    let mut queue: VecDeque<PackageSpec> = specs_in_tree(project_root, true)
        .into_iter()
        .chain(wanted.iter().cloned())
        .collect();
    let mut visited = BTreeSet::new();
    while let Some(spec) = queue.pop_front() {
        if !visited.insert(spec.clone()) {
            continue;
        }
        wanted.insert(spec.clone());
        if let Some(directory) = locate(&spec) {
            queue.extend(specs_in_tree(&directory, false));
        }
    }
    let mut report = TypstVendorReport::default();
    for spec in wanted {
        let destination = vendor.join(spec.relative_dir());
        if destination.is_dir() {
            report.unchanged.push(spec.to_string());
            continue;
        }
        match locate(&spec) {
            Some(source) => {
                copy_package(&source, &destination)?;
                report.vendored.push(spec.to_string());
            }
            None => report.missing.push(spec.to_string()),
        }
    }
    Ok(report)
}

pub(crate) fn vendored_packages(project_root: &Path) -> Vec<String> {
    let vendor = project_root.join(VENDOR_DIR);
    let children = |directory: &Path| -> Vec<(String, PathBuf)> {
        let mut found: Vec<(String, PathBuf)> = std::fs::read_dir(directory)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|entry| entry.file_type().is_ok_and(|file_type| file_type.is_dir()))
            .filter_map(|entry| Some((entry.file_name().into_string().ok()?, entry.path())))
            .collect();
        found.sort();
        found
    };
    let mut packages = Vec::new();
    for (namespace, namespace_dir) in children(&vendor) {
        for (name, name_dir) in children(&namespace_dir) {
            for (version, _) in children(&name_dir) {
                if let Some(spec) = PackageSpec::from_components(&namespace, &name, &version) {
                    packages.push(spec.to_string());
                }
            }
        }
    }
    packages
}

fn supports_deps(version: &ToolchainVersion) -> bool {
    (version.major, version.minor) >= (0, 14)
}

pub(crate) fn run_deps_compile(
    typst: &ResolvedTypst,
    project_root: &Path,
    main_doc: &str,
    app: &TypstPackageDirs,
    offline: bool,
) -> Result<Option<String>, String> {
    let scratch = tempfile::Builder::new()
        .prefix("oleafly-typst-vendor-")
        .tempdir()
        .map_err(|error| format!("failed to create a Typst workspace: {error}"))?;
    let deps = scratch.path().join("deps.json");
    let mut args = oleafly_core::typst_toolchain::typst_compile_args(
        &typst.capabilities,
        &project_root.join(main_doc),
        &scratch.path().join("vendor.pdf"),
        project_root,
        TypstDiagnosticFormat::Short,
        &app.compile_flags(&typst.capabilities),
    )
    .map_err(|error| error.to_string())?;
    let with_deps = supports_deps(&typst.version);
    if with_deps {
        args.extend([
            OsString::from("--deps"),
            deps.as_os_str().to_owned(),
            OsString::from("--deps-format"),
            OsString::from("json"),
        ]);
    }
    let mut command = std::process::Command::new(&typst.path);
    command.args(args).current_dir(project_root);
    for (name, value) in app.environment() {
        command.env(name, value);
    }
    if offline {
        for (name, value) in offline_environment() {
            command.env(name, value);
        }
    }
    crate::proc::output_contained_with_timeout(command, VENDOR_COMPILE_TIMEOUT).map_err(
        |error| {
            AppError::new("typst_packages.vendor_failed")
                .detail(error)
                .to_string()
        },
    )?;
    if !with_deps {
        return Ok(None);
    }
    Ok(std::fs::read_to_string(&deps).ok())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UniversePackage {
    pub name: String,
    pub version: String,
    pub versions: Vec<String>,
    pub description: String,
    pub authors: Vec<String>,
    pub license: Option<String>,
    pub keywords: Vec<String>,
    pub categories: Vec<String>,
    pub disciplines: Vec<String>,
    pub compiler: Option<String>,
    pub template: bool,
    pub updated_at: Option<u64>,
    pub homepage: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstUniverseIndex {
    pub fetched_at: u64,
    pub stale: bool,
    pub packages: Vec<UniversePackage>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedIndex {
    fetched_at: u64,
    packages: Vec<UniversePackage>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexEntry {
    name: String,
    version: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    authors: Vec<String>,
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    keywords: Vec<String>,
    #[serde(default)]
    categories: Vec<String>,
    #[serde(default)]
    disciplines: Vec<String>,
    #[serde(default)]
    compiler: Option<String>,
    #[serde(default)]
    template: Option<serde_json::Value>,
    #[serde(default)]
    updated_at: Option<u64>,
    #[serde(default)]
    homepage: Option<String>,
    #[serde(default)]
    repository: Option<String>,
}

fn version_order(left: &str, right: &str) -> std::cmp::Ordering {
    match (
        ToolchainVersion::parse(left),
        ToolchainVersion::parse(right),
    ) {
        (Some(left), Some(right)) => left.cmp(&right),
        (Some(_), None) => std::cmp::Ordering::Greater,
        (None, Some(_)) => std::cmp::Ordering::Less,
        (None, None) => left.cmp(right),
    }
}

pub(crate) fn summarize_index(bytes: &[u8]) -> Result<Vec<UniversePackage>, String> {
    let entries: Vec<serde_json::Value> = serde_json::from_slice(bytes)
        .map_err(|error| format!("the Typst Universe index is not a package list: {error}"))?;
    let mut grouped: BTreeMap<String, Vec<IndexEntry>> = BTreeMap::new();
    for value in entries {
        let Ok(entry) = serde_json::from_value::<IndexEntry>(value) else {
            continue;
        };
        if valid_identifier(&entry.name) && valid_version(&entry.version) {
            grouped.entry(entry.name.clone()).or_default().push(entry);
        }
    }
    Ok(grouped
        .into_iter()
        .filter_map(|(name, mut releases)| {
            releases.sort_by(|left, right| version_order(&right.version, &left.version));
            let versions = releases
                .iter()
                .map(|release| release.version.clone())
                .collect();
            let latest = releases.into_iter().next()?;
            Some(UniversePackage {
                name,
                version: latest.version,
                versions,
                description: latest.description.unwrap_or_default(),
                authors: latest.authors,
                license: latest.license,
                keywords: latest.keywords,
                categories: latest.categories,
                disciplines: latest.disciplines,
                compiler: latest.compiler,
                template: latest.template.is_some_and(|template| !template.is_null()),
                updated_at: latest.updated_at,
                homepage: latest.homepage.or(latest.repository),
            })
        })
        .collect())
}

fn read_cached_index(cache: &Path) -> Option<CachedIndex> {
    serde_json::from_slice(&std::fs::read(cache).ok()?).ok()
}

fn write_cached_index(cache: &Path, index: &CachedIndex) {
    let Ok(bytes) = serde_json::to_vec(index) else {
        return;
    };
    if let Some(parent) = cache.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = crate::sandbox::atomic_write(cache, &bytes);
}

fn from_cache(cached: CachedIndex, now: u64) -> TypstUniverseIndex {
    TypstUniverseIndex {
        stale: now.saturating_sub(cached.fetched_at) >= INDEX_MAX_AGE_MS,
        fetched_at: cached.fetched_at,
        packages: cached.packages,
    }
}

pub(crate) async fn load_index<F, Fut>(
    cache: &Path,
    now: u64,
    offline: bool,
    refresh: bool,
    fetch: F,
) -> Result<TypstUniverseIndex, String>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<Vec<u8>, String>>,
{
    let cached = read_cached_index(cache);
    if offline {
        return cached
            .map(|cached| from_cache(cached, now))
            .ok_or_else(|| AppError::new("typst_packages.index_offline").to_string());
    }
    let cached = match cached {
        Some(cached) if !refresh && now.saturating_sub(cached.fetched_at) < INDEX_MAX_AGE_MS => {
            return Ok(from_cache(cached, now));
        }
        cached => cached,
    };
    let fetched = fetch().await.and_then(|bytes| summarize_index(&bytes));
    match fetched {
        Ok(packages) => {
            let fresh = CachedIndex {
                fetched_at: now,
                packages,
            };
            write_cached_index(cache, &fresh);
            Ok(from_cache(fresh, now))
        }
        Err(error) => cached.map(|cached| from_cache(cached, now)).ok_or_else(|| {
            AppError::new("typst_packages.index_unavailable")
                .detail(error)
                .to_string()
        }),
    }
}

pub(crate) async fn fetch_index_bytes(url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Oleafly")
        .connect_timeout(INDEX_CONNECT_TIMEOUT)
        .timeout(INDEX_TIMEOUT)
        .build()
        .map_err(|error| format!("could not build HTTP client: {error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("network error: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "the Typst Universe index returned HTTP {}",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err("the Typst Universe index is too large".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("network error: {error}"))?;
    if bytes.len() > limit {
        return Err("the Typst Universe index is too large".into());
    }
    Ok(bytes.to_vec())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn index_cache_path(data_root: &Path) -> PathBuf {
    data_root.join(TYPST_DATA_DIR).join(INDEX_CACHE_FILE)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstPackageSettings {
    pub vendor_packages: bool,
    pub vendored: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstVendorResult {
    pub report: TypstVendorReport,
    pub project: ProjectMeta,
}

async fn blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("the Typst package task stopped: {error}"))?
}

fn typst_meta(project_id: &str) -> Result<ProjectMeta, String> {
    let meta = crate::project::read_meta(project_id)?;
    if !crate::typst_toolchain::is_typst_project(&meta) {
        return Err(AppError::new("typst_toolchain.not_typst_project").into());
    }
    Ok(meta)
}

fn settings_blocking(project_id: &str) -> Result<TypstPackageSettings, String> {
    let meta = typst_meta(project_id)?;
    let root = crate::project_location::locate(project_id)?.root;
    Ok(TypstPackageSettings {
        vendor_packages: vendor_flag(&meta),
        vendored: vendored_packages(&root),
    })
}

fn vendor_blocking(project_id: &str, offline: bool) -> Result<TypstVendorReport, String> {
    let meta = typst_meta(project_id)?;
    let root = crate::project_location::locate(project_id)?.root;
    let app = TypstPackageDirs::app(&crate::paths::oleafly_root()?);
    let deps = match crate::typst_toolchain::resolve_for_compile(&meta)? {
        Some(typst) => run_deps_compile(&typst, &root, &meta.main_doc, &app, offline)?,
        None => None,
    };
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
    vendor_into_project(&root, &app, deps.as_deref())
}

fn publish_engine_change(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, crate::state::AppState>,
    project_id: &str,
    meta: &ProjectMeta,
    files_changed: bool,
) {
    let _ = crate::project::publish_project_state_changed(
        app,
        state,
        project_id,
        meta.clone(),
        "engine-changed",
        files_changed,
        crate::project::project_mutation_generation(project_id.to_owned()).ok(),
    );
}

#[tauri::command]
pub async fn typst_universe_index(
    offline: Option<bool>,
    refresh: Option<bool>,
) -> Result<TypstUniverseIndex, String> {
    let cache = index_cache_path(&crate::paths::oleafly_root()?);
    load_index(
        &cache,
        now_ms(),
        offline.unwrap_or(false),
        refresh.unwrap_or(false),
        || fetch_index_bytes(INDEX_URL, MAX_INDEX_BYTES),
    )
    .await
}

#[tauri::command]
pub async fn typst_package_settings(project_id: String) -> Result<TypstPackageSettings, String> {
    blocking(move || settings_blocking(&project_id)).await
}

#[tauri::command]
pub async fn set_typst_vendor_packages(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    enabled: bool,
) -> Result<ProjectMeta, String> {
    let _guard = state.compile_lock.lock().await;
    let owned = project_id.clone();
    let meta = blocking(move || {
        crate::project::set_project_typst_vendor_packages_unlocked(&owned, enabled)
    })
    .await?;
    publish_engine_change(&app, &state, &project_id, &meta, false);
    Ok(meta)
}

#[tauri::command]
pub async fn vendor_typst_packages(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    offline: Option<bool>,
) -> Result<TypstVendorResult, String> {
    let owned = project_id.clone();
    let offline = offline.unwrap_or(false);
    let report = blocking(move || vendor_blocking(&owned, offline)).await?;
    let _guard = state.compile_lock.lock().await;
    let owned = project_id.clone();
    let project =
        blocking(move || crate::project::set_project_typst_vendor_packages_unlocked(&owned, true))
            .await?;
    publish_engine_change(
        &app,
        &state,
        &project_id,
        &project,
        !report.vendored.is_empty(),
    );
    Ok(TypstVendorResult { report, project })
}

#[cfg(test)]
mod tests;
