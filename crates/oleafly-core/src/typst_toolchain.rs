use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::fmt::{Display, Formatter};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, OnceLock};
use std::time::{Duration, Instant, UNIX_EPOCH};

const CATALOG_JSON: &str = include_str!("../../../src-tauri/resources/typst-toolchain.json");
pub const TYPST_VERSION_TIMEOUT: Duration = Duration::from_secs(5);
pub const INSTALLED_CACHE_FILE: &str = "installed.json";
const TOOLCHAINS_DIR: &str = "toolchains";
const MAX_VERSION_OUTPUT_BYTES: u64 = 64 * 1024;
const MAX_CACHE_BYTES: u64 = 64 * 1024;
const PROBE_POLL: Duration = Duration::from_millis(10);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

static EMBEDDED: OnceLock<TypstToolchainCatalog> = OnceLock::new();
static NO_CAPABILITIES: TypstCapabilities = TypstCapabilities {
    flags: Vec::new(),
    output_formats: Vec::new(),
    pdf_standards: Vec::new(),
};

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ToolchainVersion {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
    pre: Vec<PrereleaseIdentifier>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
enum PrereleaseIdentifier {
    Numeric(u64),
    Alphanumeric(String),
}

impl ToolchainVersion {
    pub fn parse(value: &str) -> Option<Self> {
        let value = value.trim();
        let value = value.split_once('+').map_or(value, |(version, build)| {
            if valid_identifiers(build) {
                version
            } else {
                ""
            }
        });
        let (core, pre) = match value.split_once('-') {
            Some((core, pre)) => (core, Some(pre)),
            None => (value, None),
        };
        let mut numbers = core.split('.').map(numeric_identifier);
        let major = numbers.next()??;
        let minor = numbers.next()??;
        let patch = numbers.next()??;
        if numbers.next().is_some() {
            return None;
        }
        let pre = match pre {
            None => Vec::new(),
            Some(pre) => {
                if !valid_identifiers(pre) {
                    return None;
                }
                pre.split('.')
                    .map(|identifier| match numeric_identifier(identifier) {
                        Some(number) => Some(PrereleaseIdentifier::Numeric(number)),
                        None if identifier.bytes().all(|byte| byte.is_ascii_digit()) => None,
                        None => Some(PrereleaseIdentifier::Alphanumeric(identifier.to_string())),
                    })
                    .collect::<Option<Vec<_>>>()?
            }
        };
        Some(Self {
            major,
            minor,
            patch,
            pre,
        })
    }

    pub fn is_prerelease(&self) -> bool {
        !self.pre.is_empty()
    }

    pub fn minor_line(&self) -> String {
        format!("{}.{}", self.major, self.minor)
    }
}

fn numeric_identifier(value: &str) -> Option<u64> {
    if value.is_empty()
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return None;
    }
    value.parse().ok()
}

fn valid_identifiers(value: &str) -> bool {
    value.split('.').all(|identifier| {
        !identifier.is_empty()
            && identifier
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    })
}

impl Ord for ToolchainVersion {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.major, self.minor, self.patch)
            .cmp(&(other.major, other.minor, other.patch))
            .then_with(|| match (self.pre.is_empty(), other.pre.is_empty()) {
                (true, true) => Ordering::Equal,
                (true, false) => Ordering::Greater,
                (false, true) => Ordering::Less,
                (false, false) => self.pre.cmp(&other.pre),
            })
    }
}

impl PartialOrd for ToolchainVersion {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Display for ToolchainVersion {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}.{}.{}", self.major, self.minor, self.patch)?;
        for (index, identifier) in self.pre.iter().enumerate() {
            formatter.write_str(if index == 0 { "-" } else { "." })?;
            match identifier {
                PrereleaseIdentifier::Numeric(number) => write!(formatter, "{number}")?,
                PrereleaseIdentifier::Alphanumeric(text) => formatter.write_str(text)?,
            }
        }
        Ok(())
    }
}

impl Serialize for ToolchainVersion {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for ToolchainVersion {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value)
            .ok_or_else(|| serde::de::Error::custom(format!("invalid version `{value}`")))
    }
}

pub fn parse_typst_version_output(output: &str) -> Option<ToolchainVersion> {
    output.lines().find_map(|line| {
        let mut tokens = line.split_whitespace();
        let program = tokens.next()?;
        if !program.eq_ignore_ascii_case("typst") && !program.eq_ignore_ascii_case("typst-cli") {
            return None;
        }
        let token = tokens.next()?;
        ToolchainVersion::parse(token.strip_prefix('v').unwrap_or(token))
    })
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstToolchainCatalog {
    pub schema_version: u32,
    pub generated_at: String,
    pub supported_targets: Vec<String>,
    pub allowed_download_hosts: Vec<String>,
    pub typst: TypstReleases,
    pub tinymist: TinymistReleases,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstReleases {
    pub repository: String,
    pub bundled: ToolchainVersion,
    pub versions: Vec<TypstRelease>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstRelease {
    pub version: ToolchainVersion,
    pub tag: String,
    pub minor: String,
    pub released_at: String,
    pub capabilities: TypstCapabilities,
    pub targets: BTreeMap<String, ToolchainArtifact>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstCapabilities {
    pub flags: Vec<String>,
    pub output_formats: Vec<String>,
    pub pdf_standards: Vec<String>,
}

impl TypstCapabilities {
    pub fn supports_flag(&self, flag: &str) -> bool {
        self.flags.iter().any(|known| known == flag)
    }

    pub fn supports_output_format(&self, format: &str) -> bool {
        self.output_formats.iter().any(|known| known == format)
    }

    pub fn supports_pdf_standard(&self, standard: &str) -> bool {
        self.pdf_standards.iter().any(|known| known == standard)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TinymistReleases {
    pub repository: String,
    pub bundled: ToolchainVersion,
    pub versions: Vec<TinymistRelease>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TinymistRelease {
    pub typst_minor: String,
    pub version: ToolchainVersion,
    pub tag: String,
    pub released_at: String,
    pub targets: BTreeMap<String, ToolchainArtifact>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainArtifact {
    pub asset: String,
    pub archive_type: ArchiveType,
    pub archive_member: Option<String>,
    pub archive_sha256: String,
    pub archive_size: u64,
    pub binary_sha256: String,
    pub binary_size: u64,
    pub mirror_url: String,
    pub github_url: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ArchiveType {
    #[serde(rename = "tar.xz")]
    TarXz,
    #[serde(rename = "tar.gz")]
    TarGz,
    #[serde(rename = "zip")]
    Zip,
    #[serde(rename = "binary")]
    Binary,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct InstalledTypst {
    pub version: ToolchainVersion,
    pub path: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SystemTypst {
    pub path: PathBuf,
    pub version: ToolchainVersion,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TypstSource {
    Bundled,
    Downloaded,
    System,
}

impl TypstSource {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Bundled => "bundled",
            Self::Downloaded => "downloaded",
            Self::System => "system",
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct TypstResolveRequest<'a> {
    pub pin: Option<&'a str>,
    pub default_choice: Option<&'a str>,
    pub bundled: Option<(&'a Path, &'a str)>,
    pub data_root: &'a Path,
    pub target: &'a str,
    pub system: Option<&'a SystemTypst>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ResolvedTypst {
    pub path: PathBuf,
    pub version: ToolchainVersion,
    pub source: TypstSource,
    pub capabilities: TypstCapabilities,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TypstResolveError {
    NotInstalled { version: String },
    UnknownVersion { version: String },
}

impl TypstResolveError {
    pub fn version(&self) -> &str {
        match self {
            Self::NotInstalled { version } | Self::UnknownVersion { version } => version,
        }
    }
}

impl Display for TypstResolveError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotInstalled { version } => write!(formatter, "Typst {version} is not installed"),
            Self::UnknownVersion { version } => write!(
                formatter,
                "Oleafly does not offer Typst {version}, and no Typst on this system reports that version"
            ),
        }
    }
}

impl std::error::Error for TypstResolveError {}

impl TypstToolchainCatalog {
    pub fn parse(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }

    pub fn embedded() -> &'static Self {
        EMBEDDED.get_or_init(|| {
            Self::parse(CATALOG_JSON).expect("the bundled Typst toolchain catalog is valid")
        })
    }

    pub fn bundled_version(&self) -> &ToolchainVersion {
        &self.typst.bundled
    }

    pub fn curated_typst_versions(&self) -> Vec<&TypstRelease> {
        let mut releases: Vec<&TypstRelease> = self.typst.versions.iter().collect();
        releases.sort_by(|left, right| right.version.cmp(&left.version));
        releases
    }

    pub fn typst_release(&self, version: &str) -> Option<&TypstRelease> {
        let version = ToolchainVersion::parse(version)?;
        self.release_for(&version)
    }

    fn release_for(&self, version: &ToolchainVersion) -> Option<&TypstRelease> {
        self.typst
            .versions
            .iter()
            .find(|release| &release.version == version)
    }

    pub fn typst_artifact(&self, version: &str, target: &str) -> Option<&ToolchainArtifact> {
        self.typst_release(version)?.targets.get(target)
    }

    pub fn tinymist_for_typst_minor(&self, minor: &str) -> Option<&TinymistRelease> {
        self.tinymist
            .versions
            .iter()
            .find(|release| release.typst_minor == minor.trim())
    }

    pub fn tinymist_for_typst(&self, version: &ToolchainVersion) -> Option<&TinymistRelease> {
        self.tinymist_for_typst_minor(&version.minor_line())
    }

    pub fn capabilities_for(&self, version: &str) -> &TypstCapabilities {
        let releases = self.curated_typst_versions();
        let Some(newest) = releases.first() else {
            return &NO_CAPABILITIES;
        };
        let Some(version) = ToolchainVersion::parse(version) else {
            return &newest.capabilities;
        };
        releases
            .iter()
            .find(|release| release.version <= version)
            .or_else(|| releases.last())
            .map_or(&NO_CAPABILITIES, |release| &release.capabilities)
    }

    pub fn verify_typst_install(
        &self,
        data_root: &Path,
        version: &ToolchainVersion,
        target: &str,
    ) -> bool {
        self.release_for(version)
            .and_then(|release| release.targets.get(target))
            .is_some_and(|artifact| {
                verify_toolchain_binary(&typst_binary_path(data_root, version, target), artifact)
            })
    }

    pub fn installed_typst_versions(&self, data_root: &Path, target: &str) -> Vec<InstalledTypst> {
        self.curated_typst_versions()
            .into_iter()
            .filter(|release| self.verify_typst_install(data_root, &release.version, target))
            .map(|release| InstalledTypst {
                version: release.version.clone(),
                path: typst_binary_path(data_root, &release.version, target),
            })
            .collect()
    }

    pub fn resolve_typst(
        &self,
        request: &TypstResolveRequest<'_>,
    ) -> Result<ResolvedTypst, TypstResolveError> {
        let chosen = [request.pin, request.default_choice]
            .into_iter()
            .flatten()
            .map(str::trim)
            .find(|value| !value.is_empty());
        let wanted = match chosen {
            Some(text) => {
                ToolchainVersion::parse(text).ok_or_else(|| TypstResolveError::UnknownVersion {
                    version: text.to_string(),
                })?
            }
            None => request
                .bundled
                .and_then(|(_, version)| ToolchainVersion::parse(version))
                .unwrap_or_else(|| self.typst.bundled.clone()),
        };
        let resolved = |path: PathBuf, source: TypstSource| ResolvedTypst {
            path,
            capabilities: self.capabilities_for(&wanted.to_string()).clone(),
            version: wanted.clone(),
            source,
        };
        if let Some((path, _)) = request
            .bundled
            .filter(|(_, version)| ToolchainVersion::parse(version).as_ref() == Some(&wanted))
        {
            return Ok(resolved(path.to_path_buf(), TypstSource::Bundled));
        }
        if self.verify_typst_install(request.data_root, &wanted, request.target) {
            return Ok(resolved(
                typst_binary_path(request.data_root, &wanted, request.target),
                TypstSource::Downloaded,
            ));
        }
        if let Some(system) = request.system.filter(|system| system.version == wanted) {
            return Ok(resolved(system.path.clone(), TypstSource::System));
        }
        let version = chosen.map_or_else(|| wanted.to_string(), str::to_string);
        if self.release_for(&wanted).is_some() {
            Err(TypstResolveError::NotInstalled { version })
        } else {
            Err(TypstResolveError::UnknownVersion { version })
        }
    }
}

pub fn bundled_typst_version() -> &'static ToolchainVersion {
    TypstToolchainCatalog::embedded().bundled_version()
}

pub fn capabilities_for(version: &str) -> &'static TypstCapabilities {
    TypstToolchainCatalog::embedded().capabilities_for(version)
}

pub fn installed_typst_versions(data_root: &Path, target: &str) -> Vec<InstalledTypst> {
    TypstToolchainCatalog::embedded().installed_typst_versions(data_root, target)
}

pub fn resolve_typst(
    request: &TypstResolveRequest<'_>,
) -> Result<ResolvedTypst, TypstResolveError> {
    TypstToolchainCatalog::embedded().resolve_typst(request)
}

pub fn host_target() -> Option<&'static str> {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("aarch64-apple-darwin")
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        Some("aarch64-unknown-linux-gnu")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some("x86_64-unknown-linux-gnu")
    } else if cfg!(all(windows, target_arch = "x86_64")) {
        Some("x86_64-pc-windows-msvc")
    } else {
        None
    }
}

fn binary_name(tool: &str, target: &str) -> String {
    if target.contains("windows") {
        format!("{tool}.exe")
    } else {
        tool.to_string()
    }
}

pub fn toolchains_root(data_root: &Path) -> PathBuf {
    data_root.join(TOOLCHAINS_DIR)
}

pub fn typst_install_dir(data_root: &Path, version: &ToolchainVersion) -> PathBuf {
    toolchains_root(data_root)
        .join("typst")
        .join(version.to_string())
}

pub fn typst_binary_path(data_root: &Path, version: &ToolchainVersion, target: &str) -> PathBuf {
    typst_install_dir(data_root, version).join(binary_name("typst", target))
}

pub fn tinymist_install_dir(data_root: &Path, version: &ToolchainVersion) -> PathBuf {
    toolchains_root(data_root)
        .join("tinymist")
        .join(version.to_string())
}

pub fn tinymist_binary_path(data_root: &Path, version: &ToolchainVersion, target: &str) -> PathBuf {
    tinymist_install_dir(data_root, version).join(binary_name("tinymist", target))
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifiedBinary {
    binary: String,
    binary_sha256: String,
    size: u64,
    modified_secs: u64,
    modified_nanos: u32,
}

struct FileStamp {
    size: u64,
    modified: Option<Duration>,
}

impl FileStamp {
    fn of(metadata: &std::fs::Metadata) -> Self {
        Self {
            size: metadata.len(),
            modified: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok()),
        }
    }
}

pub fn verify_toolchain_binary(binary: &Path, artifact: &ToolchainArtifact) -> bool {
    let Some(name) = binary.file_name().and_then(OsStr::to_str) else {
        return false;
    };
    let Ok(metadata) = std::fs::metadata(binary) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    let stamp = FileStamp::of(&metadata);
    let cache = binary.with_file_name(INSTALLED_CACHE_FILE);
    if cached_verification(&cache, name, &artifact.binary_sha256, &stamp) {
        return true;
    }
    if stamp.size != artifact.binary_size {
        return false;
    }
    let Some(digest) = sha256_file(binary) else {
        return false;
    };
    if !digest.eq_ignore_ascii_case(&artifact.binary_sha256) {
        return false;
    }
    if let Some(modified) = stamp.modified {
        record_verification(
            &cache,
            &VerifiedBinary {
                binary: name.to_string(),
                binary_sha256: artifact.binary_sha256.to_ascii_lowercase(),
                size: stamp.size,
                modified_secs: modified.as_secs(),
                modified_nanos: modified.subsec_nanos(),
            },
        );
    }
    true
}

fn cached_verification(cache: &Path, name: &str, expected: &str, stamp: &FileStamp) -> bool {
    let Some(modified) = stamp.modified else {
        return false;
    };
    let Ok(file) = std::fs::File::open(cache) else {
        return false;
    };
    let mut bytes = Vec::new();
    if file.take(MAX_CACHE_BYTES).read_to_end(&mut bytes).is_err() {
        return false;
    }
    serde_json::from_slice::<VerifiedBinary>(&bytes).is_ok_and(|recorded| {
        recorded.binary == name
            && recorded.binary_sha256.eq_ignore_ascii_case(expected)
            && recorded.size == stamp.size
            && recorded.modified_secs == modified.as_secs()
            && recorded.modified_nanos == modified.subsec_nanos()
    })
}

fn record_verification(cache: &Path, verified: &VerifiedBinary) {
    let Ok(bytes) = serde_json::to_vec_pretty(verified) else {
        return;
    };
    let staged = cache.with_file_name(format!("{INSTALLED_CACHE_FILE}.{}.tmp", std::process::id()));
    if std::fs::write(&staged, bytes).is_err() || std::fs::rename(&staged, cache).is_err() {
        let _ = std::fs::remove_file(&staged);
    }
}

fn sha256_file(path: &Path) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).ok()?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Some(format!("{:x}", hasher.finalize()))
}

pub fn typst_version_of(binary: &Path, timeout: Duration) -> Option<ToolchainVersion> {
    let mut command = Command::new(binary);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().ok()?;
    let deadline = Instant::now() + timeout;
    let (sender, receiver) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            let mut output = Vec::new();
            let _ = stdout
                .take(MAX_VERSION_OUTPUT_BYTES)
                .read_to_end(&mut output);
            let _ = sender.send(output);
        });
    }
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(PROBE_POLL),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    if !status.success() {
        return None;
    }
    let output = receiver
        .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        .ok()?;
    parse_typst_version_output(&String::from_utf8_lossy(&output))
}

pub fn system_typst_candidates() -> Vec<PathBuf> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    system_typst_candidates_from(
        std::env::var_os("PATH").as_deref(),
        home.as_deref(),
        cfg!(windows),
    )
}

fn system_typst_candidates_from(
    path_variable: Option<&OsStr>,
    home: Option<&Path>,
    windows: bool,
) -> Vec<PathBuf> {
    let name = if windows { "typst.exe" } else { "typst" };
    let mut directories: Vec<PathBuf> = path_variable
        .map(|value| std::env::split_paths(value).collect())
        .unwrap_or_default();
    if !windows {
        directories.push(PathBuf::from("/opt/homebrew/bin"));
        directories.push(PathBuf::from("/usr/local/bin"));
    }
    if let Some(home) = home {
        directories.push(home.join(".cargo").join("bin"));
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    for directory in directories {
        if !directory.is_absolute() {
            continue;
        }
        let candidate = directory.join(name);
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }
    candidates
}

pub fn detect_system_typst(data_root: &Path, bundled: Option<&Path>) -> Option<SystemTypst> {
    detect_system_typst_among(
        &system_typst_candidates(),
        data_root,
        bundled,
        TYPST_VERSION_TIMEOUT,
    )
}

fn detect_system_typst_among(
    candidates: &[PathBuf],
    data_root: &Path,
    bundled: Option<&Path>,
    timeout: Duration,
) -> Option<SystemTypst> {
    let bundled = bundled.and_then(|path| path.canonicalize().ok());
    let managed = toolchains_root(data_root);
    let managed = managed.canonicalize().unwrap_or(managed);
    candidates.iter().find_map(|candidate| {
        if !is_executable_file(candidate) {
            return None;
        }
        let path = candidate.canonicalize().ok()?;
        if bundled.as_ref() == Some(&path) || path.starts_with(&managed) {
            return None;
        }
        let version = typst_version_of(&path, timeout)?;
        Some(SystemTypst { path, version })
    })
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TypstDiagnosticFormat {
    Human,
    #[default]
    Short,
}

impl TypstDiagnosticFormat {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Human => "human",
            Self::Short => "short",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TypstCompileFlag {
    FontPath(PathBuf),
    IgnoreSystemFonts,
    Input { key: String, value: String },
    Format(String),
    Ppi(u32),
    PdfStandard(String),
    PackagePath(PathBuf),
    PackageCachePath(PathBuf),
    Pages(String),
    CreationTimestamp(u64),
    Deps(PathBuf),
    Features(String),
}

impl TypstCompileFlag {
    pub const fn name(&self) -> &'static str {
        match self {
            Self::FontPath(_) => "--font-path",
            Self::IgnoreSystemFonts => "--ignore-system-fonts",
            Self::Input { .. } => "--input",
            Self::Format(_) => "--format",
            Self::Ppi(_) => "--ppi",
            Self::PdfStandard(_) => "--pdf-standard",
            Self::PackagePath(_) => "--package-path",
            Self::PackageCachePath(_) => "--package-cache-path",
            Self::Pages(_) => "--pages",
            Self::CreationTimestamp(_) => "--creation-timestamp",
            Self::Deps(_) => "--deps",
            Self::Features(_) => "--features",
        }
    }

    fn values(&self, capabilities: &TypstCapabilities) -> Result<Vec<OsString>, TypstArgsError> {
        let flag = self.name();
        let invalid = |value: &str| TypstArgsError::InvalidValue {
            flag,
            value: value.to_string(),
        };
        match self {
            Self::Pages(pages) => normalize_page_ranges(pages)
                .map(|pages| vec![pages.into()])
                .ok_or_else(|| invalid(pages)),
            Self::CreationTimestamp(seconds) => Ok(vec![seconds.to_string().into()]),
            Self::Deps(path) => Ok(vec![
                path.as_os_str().to_owned(),
                "--deps-format".into(),
                "json".into(),
            ]),
            Self::Features(feature)
                if !feature.is_empty()
                    && feature.bytes().all(|byte| {
                        byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'
                    }) =>
            {
                Ok(vec![feature.into()])
            }
            Self::Features(feature) => Err(invalid(feature)),
            _ => Ok(self.value(capabilities)?.into_iter().collect()),
        }
    }

    fn value(&self, capabilities: &TypstCapabilities) -> Result<Option<OsString>, TypstArgsError> {
        let flag = self.name();
        let unsupported = |value: &str| TypstArgsError::UnsupportedValue {
            flag,
            value: value.to_string(),
        };
        let invalid = |value: String| TypstArgsError::InvalidValue { flag, value };
        match self {
            Self::IgnoreSystemFonts => Ok(None),
            Self::FontPath(path) | Self::PackagePath(path) | Self::PackageCachePath(path) => {
                Ok(Some(path.as_os_str().to_owned()))
            }
            Self::Input { key, value } => {
                if key.is_empty() || key.contains('=') {
                    return Err(invalid(key.clone()));
                }
                Ok(Some(format!("{key}={value}").into()))
            }
            Self::Format(format) if capabilities.supports_output_format(format) => {
                Ok(Some(format.into()))
            }
            Self::Format(format) => Err(unsupported(format)),
            Self::Ppi(0) => Err(invalid("0".to_string())),
            Self::Ppi(ppi) => Ok(Some(ppi.to_string().into())),
            Self::PdfStandard(standard) if capabilities.supports_pdf_standard(standard) => {
                Ok(Some(standard.into()))
            }
            Self::PdfStandard(standard) => Err(unsupported(standard)),
            Self::Pages(_) | Self::CreationTimestamp(_) | Self::Deps(_) | Self::Features(_) => {
                Ok(None)
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TypstArgsError {
    UnsupportedFlag { flag: &'static str },
    UnsupportedValue { flag: &'static str, value: String },
    InvalidValue { flag: &'static str, value: String },
}

impl Display for TypstArgsError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedFlag { flag } => {
                write!(formatter, "this Typst version does not support {flag}")
            }
            Self::UnsupportedValue { flag, value } => {
                write!(
                    formatter,
                    "this Typst version does not support {flag} {value}"
                )
            }
            Self::InvalidValue { flag, value } => {
                write!(formatter, "`{value}` is not a valid value for {flag}")
            }
        }
    }
}

impl std::error::Error for TypstArgsError {}

pub fn typst_compile_args(
    capabilities: &TypstCapabilities,
    input: &Path,
    output: &Path,
    root: &Path,
    diagnostic_format: TypstDiagnosticFormat,
    extra: &[TypstCompileFlag],
) -> Result<Vec<OsString>, TypstArgsError> {
    let mut arguments: Vec<OsString> = vec![
        "--color=never".into(),
        "compile".into(),
        input.as_os_str().to_owned(),
        output.as_os_str().to_owned(),
        "--root".into(),
        root.as_os_str().to_owned(),
        "--diagnostic-format".into(),
        diagnostic_format.as_str().into(),
    ];
    for flag in extra {
        if !capabilities.supports_flag(flag.name()) {
            return Err(TypstArgsError::UnsupportedFlag { flag: flag.name() });
        }
        let values = flag.values(capabilities)?;
        arguments.push(flag.name().into());
        arguments.extend(values);
    }
    Ok(arguments)
}

const MAX_PAGE_NUMBER: u64 = 1_000_000;

pub fn normalize_page_ranges(pages: &str) -> Option<String> {
    let compact: String = pages
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect();
    if compact.is_empty() {
        return None;
    }
    let page = |text: &str| -> Option<Option<u64>> {
        if text.is_empty() {
            return Some(None);
        }
        let number: u64 = text
            .bytes()
            .all(|byte| byte.is_ascii_digit())
            .then(|| text.parse().ok())??;
        (1..=MAX_PAGE_NUMBER)
            .contains(&number)
            .then_some(Some(number))
    };
    for part in compact.split(',') {
        let (first, last) = match part.split_once('-') {
            Some((first, last)) => (page(first)?, page(last)?),
            None => {
                page(part)?.filter(|_| !part.is_empty())?;
                continue;
            }
        };
        match (first, last) {
            (None, None) => return None,
            (Some(first), Some(last)) if first > last => return None,
            _ => {}
        }
    }
    Some(compact)
}

pub const TYPST_FONT_SOURCES_SINCE: (u64, u64) = (0, 15);

pub fn typst_fonts_args(
    capabilities: &TypstCapabilities,
    version: &ToolchainVersion,
    font_dirs: &[PathBuf],
    ignore_system_fonts: bool,
) -> Vec<OsString> {
    let mut arguments: Vec<OsString> = vec!["--color=never".into(), "fonts".into()];
    for directory in font_dirs {
        arguments.push("--font-path".into());
        arguments.push(directory.as_os_str().to_owned());
    }
    if ignore_system_fonts && capabilities.supports_flag("--ignore-system-fonts") {
        arguments.push("--ignore-system-fonts".into());
    }
    if (version.major, version.minor) >= TYPST_FONT_SOURCES_SINCE {
        arguments.push("--variants".into());
    }
    arguments
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct TypstFontFamily {
    pub name: String,
    pub sources: Vec<String>,
}

pub fn parse_typst_fonts(output: &str) -> Vec<TypstFontFamily> {
    let mut families: Vec<TypstFontFamily> = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !line.starts_with(char::is_whitespace) {
            if !trimmed.starts_with("- ") {
                families.push(TypstFontFamily {
                    name: trimmed.to_string(),
                    sources: Vec::new(),
                });
            }
            continue;
        }
        let Some(source) = trimmed
            .strip_prefix('\u{2514}')
            .or_else(|| trimmed.strip_prefix('\u{251c}'))
            .map(str::trim)
        else {
            continue;
        };
        let source = source
            .strip_suffix("(Variable)")
            .map_or(source, str::trim_end);
        if let Some(family) = families.last_mut() {
            if !source.is_empty() && !family.sources.iter().any(|known| known == source) {
                family.sources.push(source.to_string());
            }
        }
    }
    families
}

pub fn parse_typst_deps(json: &str) -> Option<Vec<String>> {
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    Some(
        value
            .get("inputs")?
            .as_array()?
            .iter()
            .filter_map(|input| input.as_str().map(str::to_owned))
            .collect(),
    )
}

pub fn typst_project_font_dirs(spec: Option<&crate::TypstSpec>, root: &Path) -> Vec<PathBuf> {
    let Ok(root) = root.canonicalize() else {
        return Vec::new();
    };
    let declared = spec
        .map(|spec| spec.font_paths.as_slice())
        .unwrap_or_default();
    let mut directories: Vec<PathBuf> = Vec::new();
    for relative in std::iter::once("fonts").chain(declared.iter().map(String::as_str)) {
        let relative = Path::new(relative.trim());
        if relative.as_os_str().is_empty()
            || relative.has_root()
            || relative.components().any(|component| {
                !matches!(
                    component,
                    std::path::Component::Normal(_) | std::path::Component::CurDir
                )
            })
        {
            continue;
        }
        let Ok(directory) = root.join(relative).canonicalize() else {
            continue;
        };
        if directory.starts_with(&root) && directory.is_dir() && !directories.contains(&directory) {
            directories.push(directory);
        }
    }
    directories
}

#[cfg(test)]
mod tests;
