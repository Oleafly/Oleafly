use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::time::Duration;

use oleafly_collab_protocol::capabilities::Limits;
use url::{Host, Url};

pub const DEFAULT_DATA_DIR: &str = "/data";
pub const DEFAULT_SERVER_NAME: &str = "Oleafly Server";
pub const DEFAULT_POLL_HOLD_SECONDS: u64 = 25;
pub const DEFAULT_SIGN_IN_BURST: u32 = 300;
pub const DEFAULT_SIGN_IN_PER_MINUTE: u32 = 120;
pub const DEFAULT_EMAIL_LINKS_PER_IP: u32 = 100;
pub const DEFAULT_DEVICE_CODES_PER_IP: u32 = 100;
pub const DEFAULT_EMAIL_LINKS_PER_ADDRESS: u32 = 3;
pub const DEFAULT_EMAIL_LINKS_PER_HOUR: u32 = 300;
pub const MAX_POLL_HOLD_SECONDS: u64 = 40;
pub const MAX_PROXY_HOPS: u8 = 8;
pub const MIN_SETUP_CODE_CHARS: usize = 12;
const RESERVED_PREFIXES: [&str; 7] = [".well-known", "api", "auth", "healthz", "p", "readyz", "ws"];
const OIDC_PREFIX: &str = "OLEAFLY_OIDC_";
const OIDC_SUFFIXES: [&str; 6] = [
    "_CLIENT_SECRET_FILE",
    "_CLIENT_SECRET",
    "_CLIENT_ID",
    "_TRUST_EMAIL",
    "_ISSUER",
    "_LABEL",
];
const GITHUB_VARIABLES: [&str; 6] = [
    "OLEAFLY_GITHUB_CLIENT_ID",
    "OLEAFLY_GITHUB_CLIENT_SECRET",
    "OLEAFLY_GITHUB_CLIENT_SECRET_FILE",
    "OLEAFLY_GITHUB_URL",
    "OLEAFLY_GITHUB_API_URL",
    "OLEAFLY_GITHUB_LABEL",
];
const LOG_LEVELS: [&str; 5] = ["error", "warn", "info", "debug", "trace"];
// Docker Compose reads these from the same .env file to set up Caddy and the
// network, so the server sees them too but has no use for them.
const FOR_OTHER_TOOLS: [&str; 2] = ["OLEAFLY_DOMAIN", "OLEAFLY_IPV6"];
const CLOSE_ENOUGH: usize = 3;
const S3_VARIABLES: [&str; 6] = [
    "OLEAFLY_S3_ENDPOINT",
    "OLEAFLY_S3_REGION",
    "OLEAFLY_S3_ACCESS_KEY_ID",
    "OLEAFLY_S3_ACCESS_KEY_ID_FILE",
    "OLEAFLY_S3_SECRET_ACCESS_KEY",
    "OLEAFLY_S3_SECRET_ACCESS_KEY_FILE",
];
pub const DEFAULT_S3_REGION: &str = "us-east-1";
pub const OPEN_SIGNUP_STORAGE_MB: u64 = 100;
pub const OPEN_SIGNUP_PROJECTS: u32 = 50;
pub const OPEN_SIGNUP_UPLOADS_PER_HOUR: u32 = 300;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AccountQuotas {
    pub storage_mb: Option<u64>,
    pub projects: Option<u32>,
    pub uploads_per_hour: Option<u32>,
}

impl AccountQuotas {
    pub fn sentence(&self) -> Option<String> {
        let mut parts = Vec::new();
        if let Some(storage) = self.storage_mb {
            parts.push(format!("store {storage} MB"));
        }
        if let Some(projects) = self.projects {
            parts.push(format!("own {projects} projects"));
        }
        if let Some(uploads) = self.uploads_per_hour {
            parts.push(format!("make {uploads} uploads an hour"));
        }
        let listed = match parts.as_slice() {
            [] => return None,
            [only] => only.clone(),
            [first @ .., last] => format!("{} and {last}", first.join(", ")),
        };
        Some(format!("Each account may {listed}."))
    }
}

#[derive(Clone)]
pub enum ProviderConfig {
    Github {
        id: String,
        label: String,
        client_id: String,
        client_secret: String,
        web_url: Url,
        api_url: Url,
    },
    Oidc {
        id: String,
        label: String,
        issuer: String,
        client_id: String,
        client_secret: String,
        trust_email: bool,
    },
}

impl ProviderConfig {
    pub fn id(&self) -> &str {
        match self {
            ProviderConfig::Github { id, .. } | ProviderConfig::Oidc { id, .. } => id,
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub enum BlobStoreConfig {
    Filesystem,
    S3(Box<S3Config>),
}

#[derive(Clone, PartialEq, Eq)]
pub struct S3Config {
    pub bucket: String,
    pub prefix: String,
    pub endpoint: Option<Url>,
    pub region: String,
    pub access_key_id: String,
    pub secret_access_key: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SignInLimits {
    pub requests_burst: u32,
    pub requests_per_minute: u32,
    pub email_links_per_ip: u32,
    pub email_links_per_address: u32,
    pub email_links_per_hour: u32,
    pub device_codes_per_ip: u32,
}

impl Default for SignInLimits {
    fn default() -> SignInLimits {
        SignInLimits {
            requests_burst: DEFAULT_SIGN_IN_BURST,
            requests_per_minute: DEFAULT_SIGN_IN_PER_MINUTE,
            email_links_per_ip: DEFAULT_EMAIL_LINKS_PER_IP,
            email_links_per_address: DEFAULT_EMAIL_LINKS_PER_ADDRESS,
            email_links_per_hour: DEFAULT_EMAIL_LINKS_PER_HOUR,
            device_codes_per_ip: DEFAULT_DEVICE_CODES_PER_IP,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProxyRange {
    network: IpAddr,
    prefix: u8,
}

impl ProxyRange {
    pub fn parse(text: &str) -> Option<ProxyRange> {
        let (address, prefix) = match text.trim().split_once('/') {
            Some((address, prefix)) => (address, Some(prefix)),
            None => (text.trim(), None),
        };
        let address = address.parse::<IpAddr>().ok()?.to_canonical();
        let widest = if address.is_ipv4() { 32 } else { 128 };
        let prefix = match prefix {
            Some(prefix) => prefix
                .parse::<u8>()
                .ok()
                .filter(|bits| *bits > 0 && *bits <= widest)?,
            None => widest,
        };
        Some(ProxyRange {
            network: masked(address, prefix),
            prefix,
        })
    }

    pub fn contains(&self, address: IpAddr) -> bool {
        let address = address.to_canonical();
        address.is_ipv4() == self.network.is_ipv4() && masked(address, self.prefix) == self.network
    }

    // Wide enough to take in a large part of the public internet: shorter
    // than /8 for IPv4, or than /24 for IPv6 outside the private fc00::/7
    // and link-local fe80::/10 ranges.
    pub fn very_broad(&self) -> bool {
        match self.network {
            IpAddr::V4(_) => self.prefix < 8,
            IpAddr::V6(network) => {
                let first = network.segments()[0];
                let private = (self.prefix >= 7 && first & 0xfe00 == 0xfc00)
                    || (self.prefix >= 10 && first & 0xffc0 == 0xfe80);
                self.prefix < 24 && !private
            }
        }
    }
}

fn masked(address: IpAddr, prefix: u8) -> IpAddr {
    match address {
        IpAddr::V4(address) => {
            let mask = u32::MAX.checked_shl(32 - u32::from(prefix)).unwrap_or(0);
            IpAddr::V4(Ipv4Addr::from(u32::from(address) & mask))
        }
        IpAddr::V6(address) => {
            let mask = u128::MAX.checked_shl(128 - u32::from(prefix)).unwrap_or(0);
            IpAddr::V6(Ipv6Addr::from(u128::from(address) & mask))
        }
    }
}

impl fmt::Display for ProxyRange {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}/{}", self.network, self.prefix)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StartupNote {
    Info(String),
    Warning(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IgnoredSetting {
    pub name: String,
    pub instead: Option<String>,
}

impl IgnoredSetting {
    fn sentence(&self) -> String {
        match &self.instead {
            Some(base) if self.name.strip_suffix("_FILE") == Some(base.as_str()) => format!(
                "{} is not a setting. Only secrets can come from a file, so set {base} itself.",
                self.name
            ),
            Some(close) => format!("{} is not a setting. Did you mean {close}?", self.name),
            None => format!("{} is not a setting, so it has no effect.", self.name),
        }
    }
}

#[derive(Clone)]
pub struct ServerConfig {
    pub public_url: Url,
    pub bind: SocketAddr,
    pub data_dir: PathBuf,
    pub server_name: String,
    pub server_icon_url: Option<String>,
    pub setup_code: Option<String>,
    pub providers: Vec<ProviderConfig>,
    pub smtp_url: Option<String>,
    pub mail_from: Option<String>,
    pub blob_store: BlobStoreConfig,
    pub limits: Limits,
    pub open_signup: bool,
    pub quotas: AccountQuotas,
    pub web: bool,
    pub sign_in: SignInLimits,
    pub behind_proxy: bool,
    pub proxy_hops: u8,
    pub trusted_proxies: Vec<ProxyRange>,
    pub log_level: String,
    pub security_log_days: u32,
    pub archive_days: u32,
    pub snapshot_memory_mb: u64,
    pub poll_hold: Duration,
    pub startup_notes: Vec<StartupNote>,
    pub ignored_settings: Vec<IgnoredSetting>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigError {
    pub variable: String,
    pub message: String,
}

impl ConfigError {
    fn new(variable: impl Into<String>, message: impl Into<String>) -> ConfigError {
        ConfigError {
            variable: variable.into(),
            message: message.into(),
        }
    }
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ConfigError {}

impl ServerConfig {
    pub fn from_env() -> Result<ServerConfig, ConfigError> {
        let vars: BTreeMap<String, String> = std::env::vars_os()
            .filter_map(|(key, value)| Some((key.into_string().ok()?, value.into_string().ok()?)))
            .filter(|(key, _)| key.starts_with("OLEAFLY_"))
            .collect();
        ServerConfig::from_vars(&vars, &read_secret_file)
    }

    pub fn from_vars(
        vars: &BTreeMap<String, String>,
        read_file: &dyn Fn(&Path) -> std::io::Result<String>,
    ) -> Result<ServerConfig, ConfigError> {
        let source = Source {
            vars,
            read_file,
            read: RefCell::new(BTreeSet::new()),
        };
        let public_url = match source.get("OLEAFLY_PUBLIC_URL") {
            Some(raw) => parse_public_url(&raw)?,
            None => {
                return Err(ConfigError::new(
                    "OLEAFLY_PUBLIC_URL",
                    "OLEAFLY_PUBLIC_URL is not set. Set it to the https address people use to reach this server, for example https://collab.example.edu.",
                ))
            }
        };
        let bind = match source.get("OLEAFLY_BIND") {
            Some(raw) => raw.parse::<SocketAddr>().map_err(|_| {
                ConfigError::new(
                    "OLEAFLY_BIND",
                    format!(
                        "OLEAFLY_BIND must be an address and port such as 0.0.0.0:8080, not {raw}."
                    ),
                )
            })?,
            None => SocketAddr::from(([0, 0, 0, 0], 8080)),
        };
        let data_dir = PathBuf::from(
            source
                .get("OLEAFLY_DATA_DIR")
                .unwrap_or_else(|| DEFAULT_DATA_DIR.to_string()),
        );
        let server_name = source
            .get("OLEAFLY_SERVER_NAME")
            .unwrap_or_else(|| DEFAULT_SERVER_NAME.to_string());
        if server_name.chars().count() > 80 {
            return Err(ConfigError::new(
                "OLEAFLY_SERVER_NAME",
                "OLEAFLY_SERVER_NAME can be at most 80 characters.",
            ));
        }
        let server_icon_url = match source.get("OLEAFLY_SERVER_ICON_URL") {
            Some(raw) => {
                let url =
                    Url::parse(&raw).map_err(|_| invalid_url("OLEAFLY_SERVER_ICON_URL", &raw))?;
                check_scheme("OLEAFLY_SERVER_ICON_URL", &url)?;
                Some(url.to_string())
            }
            None => None,
        };
        let setup_code = match source.secret("OLEAFLY_SETUP_CODE")? {
            Some(code) => {
                let normalized = normalize_setup_code(&code);
                if normalized.chars().count() < MIN_SETUP_CODE_CHARS
                    || !normalized
                        .chars()
                        .all(|character| character.is_ascii_alphanumeric())
                {
                    return Err(ConfigError::new(
                        "OLEAFLY_SETUP_CODE",
                        "OLEAFLY_SETUP_CODE needs at least 12 letters or digits, and nothing else apart from dashes and spaces. Leave it unset and the server prints a code for you.",
                    ));
                }
                Some(code)
            }
            None => None,
        };
        let providers = parse_providers(&source)?;
        let smtp_url = source.secret("OLEAFLY_SMTP_URL")?;
        let mail_from = source.get("OLEAFLY_MAIL_FROM");
        check_email(smtp_url.as_deref(), mail_from.as_deref())?;
        let blob_store = parse_blob_store(&source)?;
        let limits = Limits {
            max_project_mb: source.number("OLEAFLY_MAX_PROJECT_MB", 200u64)?,
            max_file_mb: source.number("OLEAFLY_MAX_FILE_MB", 50u64)?,
            max_members_per_project: source.number("OLEAFLY_MAX_MEMBERS_PER_PROJECT", 20u32)?,
        };
        if limits.max_file_mb > limits.max_project_mb {
            return Err(ConfigError::new(
                "OLEAFLY_MAX_FILE_MB",
                "OLEAFLY_MAX_FILE_MB cannot be larger than OLEAFLY_MAX_PROJECT_MB.",
            ));
        }
        let open_signup = source.flag("OLEAFLY_OPEN_SIGNUP", false)?;
        let quotas = AccountQuotas {
            storage_mb: quota(
                &source,
                "OLEAFLY_ACCOUNT_STORAGE_MB",
                open_signup.then_some(OPEN_SIGNUP_STORAGE_MB),
            )?,
            projects: quota(
                &source,
                "OLEAFLY_MAX_PROJECTS_PER_ACCOUNT",
                open_signup.then_some(OPEN_SIGNUP_PROJECTS),
            )?,
            uploads_per_hour: quota(
                &source,
                "OLEAFLY_UPLOADS_PER_HOUR",
                open_signup.then_some(OPEN_SIGNUP_UPLOADS_PER_HOUR),
            )?,
        };
        let web = source.flag("OLEAFLY_WEB", false)?;
        let sign_in = parse_sign_in_limits(&source)?;
        let behind_proxy = source.flag("OLEAFLY_BEHIND_PROXY", false)?;
        let proxy_hops = source.number("OLEAFLY_PROXY_HOPS", 1u8)?;
        if proxy_hops > MAX_PROXY_HOPS {
            return Err(ConfigError::new(
                "OLEAFLY_PROXY_HOPS",
                format!("OLEAFLY_PROXY_HOPS can be at most {MAX_PROXY_HOPS}, not {proxy_hops}."),
            ));
        }
        if source.is_set("OLEAFLY_PROXY_HOPS") && !behind_proxy {
            return Err(ConfigError::new(
                "OLEAFLY_PROXY_HOPS",
                "OLEAFLY_PROXY_HOPS only applies when OLEAFLY_BEHIND_PROXY is true.",
            ));
        }
        let trusted_proxies = match source.get("OLEAFLY_TRUSTED_PROXIES") {
            Some(raw) => parse_trusted_proxies(&raw)?,
            None => Vec::new(),
        };
        if !trusted_proxies.is_empty() && !behind_proxy {
            return Err(ConfigError::new(
                "OLEAFLY_TRUSTED_PROXIES",
                "OLEAFLY_TRUSTED_PROXIES only applies when OLEAFLY_BEHIND_PROXY is true.",
            ));
        }
        if !trusted_proxies.is_empty() && source.is_set("OLEAFLY_PROXY_HOPS") {
            return Err(ConfigError::new(
                "OLEAFLY_TRUSTED_PROXIES",
                "Set OLEAFLY_TRUSTED_PROXIES or OLEAFLY_PROXY_HOPS, not both. The trusted list is safer, so remove OLEAFLY_PROXY_HOPS.",
            ));
        }
        let broad_proxies: Vec<String> = trusted_proxies
            .iter()
            .filter(|range| range.very_broad())
            .map(ToString::to_string)
            .collect();
        let log_level = match source.get("OLEAFLY_LOG_LEVEL") {
            Some(raw) => {
                let level = raw.to_ascii_lowercase();
                if !LOG_LEVELS.contains(&level.as_str()) {
                    return Err(ConfigError::new(
                        "OLEAFLY_LOG_LEVEL",
                        format!("OLEAFLY_LOG_LEVEL must be error, warn, info, debug or trace, not {raw}."),
                    ));
                }
                level
            }
            None => "info".to_string(),
        };
        let security_log_days = source.number("OLEAFLY_SECURITY_LOG_DAYS", 365u32)?;
        let archive_days = source.number("OLEAFLY_ARCHIVE_DAYS", 30u32)?;
        let mut startup_notes = Vec::new();
        let (detected_mb, memory) = source.half_the_memory_limit_mb();
        let snapshot_memory_mb = source.number("OLEAFLY_SNAPSHOT_MEMORY_MB", detected_mb)?;
        startup_notes.push(StartupNote::Info(
            match (source.is_set("OLEAFLY_SNAPSHOT_MEMORY_MB"), memory) {
                (true, _) => format!(
                    "Documents and large file transfers may use {snapshot_memory_mb} MB together, as OLEAFLY_SNAPSHOT_MEMORY_MB says."
                ),
                (false, Some(memory)) => format!(
                    "Documents and large file transfers may use {snapshot_memory_mb} MB together (half of {} MB).",
                    memory / MB
                ),
                (false, None) => format!(
                    "Documents and large file transfers may use {snapshot_memory_mb} MB together. The server could not tell how much memory it has, so set OLEAFLY_SNAPSHOT_MEMORY_MB to about half of it."
                ),
            },
        ));
        if !broad_proxies.is_empty() {
            startup_notes.push(StartupNote::Warning(format!(
                "OLEAFLY_TRUSTED_PROXIES includes {}, which covers a large part of the internet. The server believes X-Forwarded-For from every address in it, so a client there can choose its own address for the sign-in limits and the security log. List only the ranges your proxies send from.",
                broad_proxies.join(", ")
            )));
        }
        if web && !cfg!(feature = "web") {
            startup_notes.push(StartupNote::Warning(
                "OLEAFLY_WEB is true, but this build of Oleafly Server has no browser app, so browser access stays off. Use the official image or build with the web feature.".to_string(),
            ));
        }
        let poll_hold_seconds =
            source.number("OLEAFLY_POLL_HOLD_SECONDS", DEFAULT_POLL_HOLD_SECONDS)?;
        if poll_hold_seconds > MAX_POLL_HOLD_SECONDS {
            return Err(ConfigError::new(
                "OLEAFLY_POLL_HOLD_SECONDS",
                format!("OLEAFLY_POLL_HOLD_SECONDS can be at most {MAX_POLL_HOLD_SECONDS}, not {poll_hold_seconds}. Set it a few seconds below the idle timeout of your proxy."),
            ));
        }
        let poll_hold = Duration::from_secs(poll_hold_seconds);
        let ignored_settings = source.ignored();
        if !ignored_settings.is_empty() {
            let sentences: Vec<String> = ignored_settings
                .iter()
                .map(IgnoredSetting::sentence)
                .collect();
            startup_notes.push(StartupNote::Warning(sentences.join(" ")));
        }
        Ok(ServerConfig {
            public_url,
            bind,
            data_dir,
            server_name,
            server_icon_url,
            setup_code,
            providers,
            smtp_url,
            mail_from,
            blob_store,
            limits,
            open_signup,
            quotas,
            web,
            sign_in,
            behind_proxy,
            proxy_hops,
            trusted_proxies,
            log_level,
            security_log_days,
            archive_days,
            snapshot_memory_mb,
            poll_hold,
            startup_notes,
            ignored_settings,
        })
    }

    pub fn endpoint(&self, path: &str) -> Url {
        join_url(&self.public_url, path)
    }

    pub fn path_prefix(&self) -> &str {
        self.public_url.path().trim_end_matches('/')
    }

    pub fn web_enabled(&self) -> bool {
        cfg!(feature = "web") && self.web
    }

    pub fn sign_up_note(&self) -> String {
        let mode = if self.open_signup {
            "Open sign-up is on, so anyone who signs in gets an account as a member."
        } else {
            "Open sign-up is off, so only people the allowlist, a domain rule or an invitation lets in get an account."
        };
        match self.quotas.sentence() {
            Some(limits) => format!("{mode} {limits}"),
            None => mode.to_string(),
        }
    }

    pub fn require_sign_in(&self) -> Result<(), ConfigError> {
        if self.providers.is_empty() {
            return Err(ConfigError::new(
                "OLEAFLY_GITHUB_CLIENT_ID",
                "No sign-in method is set up, so nobody could sign in. For GitHub, set OLEAFLY_GITHUB_CLIENT_ID and OLEAFLY_GITHUB_CLIENT_SECRET. For OpenID Connect, set OLEAFLY_OIDC_<NAME>_ISSUER, OLEAFLY_OIDC_<NAME>_CLIENT_ID and OLEAFLY_OIDC_<NAME>_CLIENT_SECRET. Email doesn't count, because sign-in by email link stays off until an admin turns it on.",
            ));
        }
        Ok(())
    }
}

pub fn join_url(base: &Url, path: &str) -> Url {
    let mut url = base.clone();
    let prefix = base.path().trim_end_matches('/');
    let suffix = path.trim_start_matches('/');
    url.set_path(&format!("{prefix}/{suffix}"));
    url.set_query(None);
    url.set_fragment(None);
    url
}

pub fn normalize_setup_code(code: &str) -> String {
    code.chars()
        .filter(|character| !character.is_whitespace() && *character != '-')
        .map(|character| character.to_ascii_uppercase())
        .collect()
}

fn read_secret_file(path: &Path) -> std::io::Result<String> {
    std::fs::read_to_string(path)
}

fn quota<T>(
    source: &Source<'_>,
    name: &str,
    open_default: Option<T>,
) -> Result<Option<T>, ConfigError>
where
    T: std::str::FromStr + PartialOrd + From<u8>,
{
    if source.is_set(name) {
        return source.number(name, T::from(1u8)).map(Some);
    }
    Ok(open_default)
}

const DEFAULT_SNAPSHOT_MEMORY_MB: u64 = 1024;
const MB: u64 = 1024 * 1024;
const UNLIMITED: u64 = 1 << 40;
const MEMORY_LIMIT_FILES: [&str; 2] = [
    "/sys/fs/cgroup/memory.max",
    "/sys/fs/cgroup/memory/memory.limit_in_bytes",
];
const OWN_CGROUP_FILE: &str = "/proc/self/cgroup";
const MEMORY_INFO_FILE: &str = "/proc/meminfo";

struct Source<'a> {
    vars: &'a BTreeMap<String, String>,
    read_file: &'a dyn Fn(&Path) -> std::io::Result<String>,
    read: RefCell<BTreeSet<String>>,
}

impl Source<'_> {
    fn noted(&self, name: &str) {
        self.read.borrow_mut().insert(name.to_string());
    }

    fn ignored(&self) -> Vec<IgnoredSetting> {
        let read = self.read.borrow();
        self.vars
            .iter()
            .filter(|(name, value)| {
                name.starts_with("OLEAFLY_")
                    && !value.trim().is_empty()
                    && !read.contains(name.as_str())
                    && !FOR_OTHER_TOOLS.contains(&name.as_str())
            })
            .map(|(name, _)| IgnoredSetting {
                name: name.clone(),
                instead: instead_of(name, &read),
            })
            .collect()
    }

    fn get(&self, name: &str) -> Option<String> {
        self.noted(name);
        present(self.vars, name).map(str::to_string)
    }

    fn secret(&self, name: &str) -> Result<Option<String>, ConfigError> {
        let file_variable = format!("{name}_FILE");
        self.noted(name);
        self.noted(&file_variable);
        match (present(self.vars, name), present(self.vars, &file_variable)) {
            (Some(_), Some(_)) => Err(ConfigError::new(
                name,
                format!("Set {name} or {file_variable}, not both."),
            )),
            (Some(value), None) => Ok(Some(value.to_string())),
            (None, Some(path)) => {
                let contents = (self.read_file)(Path::new(path)).map_err(|error| {
                    ConfigError::new(
                        file_variable.as_str(),
                        format!(
                            "{file_variable} points to {path}, which could not be read ({error})."
                        ),
                    )
                })?;
                let value = contents.trim();
                if value.is_empty() {
                    return Err(ConfigError::new(
                        file_variable.as_str(),
                        format!("{file_variable} points to {path}, which is empty."),
                    ));
                }
                Ok(Some(value.to_string()))
            }
            (None, None) => Ok(None),
        }
    }

    fn is_set(&self, name: &str) -> bool {
        self.noted(name);
        present(self.vars, name).is_some()
    }

    fn number<T>(&self, name: &str, default: T) -> Result<T, ConfigError>
    where
        T: std::str::FromStr + PartialOrd + From<u8>,
    {
        let Some(raw) = self.get(name) else {
            return Ok(default);
        };
        match raw.parse::<T>() {
            Ok(value) if value >= T::from(1u8) => Ok(value),
            _ => Err(ConfigError::new(
                name,
                format!("{name} must be a whole number of at least 1, not {raw}."),
            )),
        }
    }

    fn half_the_memory_limit_mb(&self) -> (u64, Option<u64>) {
        let files = self.memory_limit_files();
        let limits = files
            .iter()
            .filter_map(|file| (self.read_file)(file).ok())
            .filter_map(|text| text.trim().parse::<u64>().ok());
        let smallest = limits
            .chain(self.memory_total())
            .filter(|limit| *limit < UNLIMITED)
            .min();
        match smallest {
            Some(limit) => ((limit / 2 / MB).max(1), Some(limit)),
            None => (DEFAULT_SNAPSHOT_MEMORY_MB, None),
        }
    }

    fn memory_limit_files(&self) -> Vec<PathBuf> {
        let mut files: Vec<PathBuf> = MEMORY_LIMIT_FILES.iter().map(PathBuf::from).collect();
        let Ok(own) = (self.read_file)(Path::new(OWN_CGROUP_FILE)) else {
            return files;
        };
        for line in own.lines() {
            let mut fields = line.splitn(3, ':');
            let (Some(_), Some(controllers), Some(path)) =
                (fields.next(), fields.next(), fields.next())
            else {
                continue;
            };
            let (root, file) = if controllers.is_empty() {
                ("/sys/fs/cgroup", "memory.max")
            } else if controllers
                .split(',')
                .any(|controller| controller == "memory")
            {
                ("/sys/fs/cgroup/memory", "memory.limit_in_bytes")
            } else {
                continue;
            };
            let mut group = PathBuf::from(path.trim());
            loop {
                let relative = group.strip_prefix("/").unwrap_or(&group);
                files.push(Path::new(root).join(relative).join(file));
                if !group.pop() {
                    break;
                }
            }
        }
        files
    }

    fn memory_total(&self) -> Option<u64> {
        let text = (self.read_file)(Path::new(MEMORY_INFO_FILE)).ok()?;
        let line = text.lines().find(|line| line.starts_with("MemTotal:"))?;
        let kilobytes = line
            .trim_start_matches("MemTotal:")
            .trim()
            .trim_end_matches("kB")
            .trim()
            .parse::<u64>()
            .ok()?;
        kilobytes.checked_mul(1024)
    }

    fn flag(&self, name: &str, default: bool) -> Result<bool, ConfigError> {
        let Some(raw) = self.get(name) else {
            return Ok(default);
        };
        if raw.eq_ignore_ascii_case("true") {
            Ok(true)
        } else if raw.eq_ignore_ascii_case("false") {
            Ok(false)
        } else {
            Err(ConfigError::new(
                name,
                format!("{name} must be true or false, not {raw}."),
            ))
        }
    }
}

fn instead_of(name: &str, read: &BTreeSet<String>) -> Option<String> {
    let oidc_shaped = |base: &str| {
        base.starts_with(OIDC_PREFIX) && OIDC_SUFFIXES.iter().any(|suffix| base.ends_with(suffix))
    };
    if let Some(base) = name
        .strip_suffix("_FILE")
        .filter(|base| read.contains(*base) || oidc_shaped(base))
    {
        return Some(base.to_string());
    }
    let mut candidates: Vec<String> = read.iter().cloned().collect();
    if let Some(rest) = name.strip_prefix(OIDC_PREFIX) {
        for (split, _) in rest.match_indices('_') {
            for suffix in OIDC_SUFFIXES {
                candidates.push(format!("{OIDC_PREFIX}{}{suffix}", &rest[..split]));
            }
        }
    }
    candidates
        .into_iter()
        .map(|candidate| (edit_distance(name, &candidate), candidate))
        .filter(|(distance, _)| *distance <= CLOSE_ENOUGH)
        .min_by_key(|(distance, _)| *distance)
        .map(|(_, candidate)| candidate)
}

fn edit_distance(left: &str, right: &str) -> usize {
    let right: Vec<char> = right.chars().collect();
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    for (row, left_char) in left.chars().enumerate() {
        let mut current = vec![row + 1; right.len() + 1];
        for (column, right_char) in right.iter().enumerate() {
            let substitution = previous[column] + usize::from(left_char != *right_char);
            current[column + 1] = substitution
                .min(previous[column + 1] + 1)
                .min(current[column] + 1);
        }
        previous = current;
    }
    previous[right.len()]
}

fn present<'a>(vars: &'a BTreeMap<String, String>, name: &str) -> Option<&'a str> {
    vars.get(name)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
}

fn invalid_url(name: &str, raw: &str) -> ConfigError {
    ConfigError::new(
        name,
        format!("{name} must be a full address such as https://collab.example.edu, not {raw}."),
    )
}

fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(domain)) => domain == "localhost",
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    }
}

fn check_scheme(name: &str, url: &Url) -> Result<(), ConfigError> {
    match url.scheme() {
        "https" => Ok(()),
        "http" if is_loopback(url) => Ok(()),
        _ => Err(ConfigError::new(
            name,
            format!("{name} must use https. Plain http works only for 127.0.0.1, ::1 or localhost while testing."),
        )),
    }
}

fn parse_base_url(name: &str, raw: &str) -> Result<Url, ConfigError> {
    let url = Url::parse(raw).map_err(|_| invalid_url(name, raw))?;
    check_scheme(name, &url)?;
    if url.query().is_some() || url.fragment().is_some() {
        return Err(ConfigError::new(
            name,
            format!("{name} cannot have a query string or a # part."),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(ConfigError::new(
            name,
            format!("{name} cannot contain a user name or password."),
        ));
    }
    let trimmed = url.path().trim_end_matches('/').to_string();
    let mut normalized = url;
    normalized.set_path(if trimmed.is_empty() { "/" } else { &trimmed });
    Ok(normalized)
}

fn parse_public_url(raw: &str) -> Result<Url, ConfigError> {
    let url = parse_base_url("OLEAFLY_PUBLIC_URL", raw)?;
    let path = url.path().trim_matches('/');
    if path.is_empty() {
        return Ok(url);
    }
    let segments_ok = path.split('/').all(|segment| {
        !segment.is_empty()
            && segment.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | '~')
            })
    });
    if !segments_ok {
        return Err(ConfigError::new(
            "OLEAFLY_PUBLIC_URL",
            format!(
                "The path in OLEAFLY_PUBLIC_URL ({}) may only use letters, digits, dashes, underscores, dots and tildes.",
                url.path()
            ),
        ));
    }
    let first = path.split('/').next().unwrap_or_default();
    if RESERVED_PREFIXES.contains(&first) {
        return Err(ConfigError::new(
            "OLEAFLY_PUBLIC_URL",
            format!("The path in OLEAFLY_PUBLIC_URL cannot start with /{first} because the server uses that path itself."),
        ));
    }
    Ok(url)
}

fn parse_providers(source: &Source<'_>) -> Result<Vec<ProviderConfig>, ConfigError> {
    let mut providers = Vec::new();
    if let Some(github) = parse_github(source)? {
        providers.push(github);
    }
    for name in oidc_names(source.vars)? {
        providers.push(parse_oidc(source, &name)?);
    }
    let mut seen = BTreeSet::new();
    for provider in &providers {
        if !seen.insert(provider.id().to_string()) {
            let id = provider.id();
            return Err(ConfigError::new(
                format!("{OIDC_PREFIX}{}_ISSUER", id.to_ascii_uppercase()),
                format!("Two sign-in providers use the id {id}. Rename one of the OLEAFLY_OIDC_ blocks."),
            ));
        }
    }
    Ok(providers)
}

fn parse_github(source: &Source<'_>) -> Result<Option<ProviderConfig>, ConfigError> {
    if !GITHUB_VARIABLES.iter().any(|name| source.is_set(name)) {
        return Ok(None);
    }
    let client_id = source.get("OLEAFLY_GITHUB_CLIENT_ID");
    let client_secret = source.secret("OLEAFLY_GITHUB_CLIENT_SECRET")?;
    let Some(client_id) = client_id else {
        return Err(ConfigError::new(
            "OLEAFLY_GITHUB_CLIENT_ID",
            "GitHub sign-in is half configured. OLEAFLY_GITHUB_CLIENT_ID is missing. Set it and OLEAFLY_GITHUB_CLIENT_SECRET, or remove every OLEAFLY_GITHUB_ setting.",
        ));
    };
    let Some(client_secret) = client_secret else {
        return Err(ConfigError::new(
            "OLEAFLY_GITHUB_CLIENT_SECRET",
            "GitHub sign-in is half configured. OLEAFLY_GITHUB_CLIENT_SECRET (or OLEAFLY_GITHUB_CLIENT_SECRET_FILE) is missing.",
        ));
    };
    let web_url = match source.get("OLEAFLY_GITHUB_URL") {
        Some(raw) => parse_base_url("OLEAFLY_GITHUB_URL", &raw)?,
        None => parse_base_url("OLEAFLY_GITHUB_URL", "https://github.com")?,
    };
    let api_url = match source.get("OLEAFLY_GITHUB_API_URL") {
        Some(raw) => parse_base_url("OLEAFLY_GITHUB_API_URL", &raw)?,
        None if web_url.host_str() == Some("github.com") => {
            parse_base_url("OLEAFLY_GITHUB_API_URL", "https://api.github.com")?
        }
        None => join_url(&web_url, "/api/v3"),
    };
    let label = source
        .get("OLEAFLY_GITHUB_LABEL")
        .unwrap_or_else(|| "GitHub".to_string());
    Ok(Some(ProviderConfig::Github {
        id: "github".to_string(),
        label,
        client_id,
        client_secret,
        web_url,
        api_url,
    }))
}

fn oidc_names(vars: &BTreeMap<String, String>) -> Result<BTreeSet<String>, ConfigError> {
    let mut names = BTreeSet::new();
    for (key, value) in vars {
        if value.trim().is_empty() {
            continue;
        }
        let Some(rest) = key.strip_prefix(OIDC_PREFIX) else {
            continue;
        };
        let Some(name) = OIDC_SUFFIXES
            .iter()
            .find_map(|suffix| rest.strip_suffix(*suffix))
        else {
            continue;
        };
        if name.is_empty()
            || !name
                .chars()
                .all(|character| character.is_ascii_alphanumeric())
        {
            return Err(ConfigError::new(
                key.as_str(),
                format!("{key} is not a valid OpenID Connect setting. The <NAME> in OLEAFLY_OIDC_<NAME>_ISSUER may only use letters and digits, for example OLEAFLY_OIDC_UNI_ISSUER."),
            ));
        }
        names.insert(name.to_string());
    }
    Ok(names)
}

fn parse_oidc(source: &Source<'_>, name: &str) -> Result<ProviderConfig, ConfigError> {
    let variable = |suffix: &str| format!("{OIDC_PREFIX}{name}_{suffix}");
    let issuer = source.get(&variable("ISSUER"));
    let client_id = source.get(&variable("CLIENT_ID"));
    let client_secret = source.secret(&variable("CLIENT_SECRET"))?;
    let missing: Vec<String> = [
        ("ISSUER", issuer.is_none()),
        ("CLIENT_ID", client_id.is_none()),
        ("CLIENT_SECRET", client_secret.is_none()),
    ]
    .into_iter()
    .filter(|(_, absent)| *absent)
    .map(|(suffix, _)| variable(suffix))
    .collect();
    let (Some(issuer), Some(client_id), Some(client_secret)) = (issuer, client_id, client_secret)
    else {
        let first = missing
            .first()
            .cloned()
            .unwrap_or_else(|| variable("ISSUER"));
        return Err(ConfigError::new(
            first,
            format!(
                "The {name} sign-in provider is half configured. Missing: {}. Each OpenID Connect block needs _ISSUER, _CLIENT_ID and _CLIENT_SECRET.",
                missing.join(", ")
            ),
        ));
    };
    let issuer_name = variable("ISSUER");
    let parsed = Url::parse(&issuer).map_err(|_| invalid_url(&issuer_name, &issuer))?;
    check_scheme(&issuer_name, &parsed)?;
    if parsed.query().is_some()
        || parsed.fragment().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(ConfigError::new(
            issuer_name.as_str(),
            format!("{issuer_name} must be the provider's issuer address with no query string, # part or password."),
        ));
    }
    let label = source
        .get(&variable("LABEL"))
        .unwrap_or_else(|| name.to_string());
    let trust_email = source.flag(&variable("TRUST_EMAIL"), false)?;
    Ok(ProviderConfig::Oidc {
        id: name.to_ascii_lowercase(),
        label,
        issuer,
        client_id,
        client_secret,
        trust_email,
    })
}

fn parse_trusted_proxies(raw: &str) -> Result<Vec<ProxyRange>, ConfigError> {
    raw.split([',', ' ', '\t', '\n'])
        .filter(|item| !item.trim().is_empty())
        .map(|item| {
            let item = item.trim();
            ProxyRange::parse(item).ok_or_else(|| {
                let everything = item
                    .rsplit_once('/')
                    .is_some_and(|(_, bits)| bits.parse::<u8>() == Ok(0));
                ConfigError::new(
                    "OLEAFLY_TRUSTED_PROXIES",
                    if everything {
                        format!("OLEAFLY_TRUSTED_PROXIES can't include {item}, which would trust X-Forwarded-For from every address. List only the ranges your proxies send from.")
                    } else {
                        format!("OLEAFLY_TRUSTED_PROXIES must list addresses or ranges such as 173.245.48.0/20 or 10.0.0.0/8, separated by commas. {item} is not one.")
                    },
                )
            })
        })
        .collect()
}

fn parse_sign_in_limits(source: &Source<'_>) -> Result<SignInLimits, ConfigError> {
    let limits = SignInLimits {
        requests_burst: source.number("OLEAFLY_SIGN_IN_BURST", DEFAULT_SIGN_IN_BURST)?,
        requests_per_minute: source
            .number("OLEAFLY_SIGN_IN_PER_MINUTE", DEFAULT_SIGN_IN_PER_MINUTE)?,
        email_links_per_ip: source
            .number("OLEAFLY_EMAIL_LINKS_PER_IP", DEFAULT_EMAIL_LINKS_PER_IP)?,
        email_links_per_address: source.number(
            "OLEAFLY_EMAIL_LINKS_PER_ADDRESS",
            DEFAULT_EMAIL_LINKS_PER_ADDRESS,
        )?,
        email_links_per_hour: source
            .number("OLEAFLY_EMAIL_LINKS_PER_HOUR", DEFAULT_EMAIL_LINKS_PER_HOUR)?,
        device_codes_per_ip: source
            .number("OLEAFLY_DEVICE_CODES_PER_IP", DEFAULT_DEVICE_CODES_PER_IP)?,
    };
    if limits.email_links_per_address > limits.email_links_per_ip {
        return Err(ConfigError::new(
            "OLEAFLY_EMAIL_LINKS_PER_ADDRESS",
            "OLEAFLY_EMAIL_LINKS_PER_ADDRESS cannot be larger than OLEAFLY_EMAIL_LINKS_PER_IP.",
        ));
    }
    Ok(limits)
}

fn check_email(smtp_url: Option<&str>, mail_from: Option<&str>) -> Result<(), ConfigError> {
    match (smtp_url, mail_from) {
        (None, None) => Ok(()),
        (Some(_), None) => Err(ConfigError::new(
            "OLEAFLY_MAIL_FROM",
            "Email needs OLEAFLY_MAIL_FROM as well as OLEAFLY_SMTP_URL. Set both, or neither to run without email.",
        )),
        (None, Some(_)) => Err(ConfigError::new(
            "OLEAFLY_SMTP_URL",
            "Email needs OLEAFLY_SMTP_URL as well as OLEAFLY_MAIL_FROM. Set both, or neither to run without email.",
        )),
        (Some(smtp), Some(from)) => {
            crate::mail::SmtpSettings::parse(smtp)
                .map_err(|message| ConfigError::new("OLEAFLY_SMTP_URL", message))?;
            crate::mail::parse_from(from)
                .map_err(|message| ConfigError::new("OLEAFLY_MAIL_FROM", message))?;
            Ok(())
        }
    }
}

fn parse_blob_store(source: &Source<'_>) -> Result<BlobStoreConfig, ConfigError> {
    let location = match source.secret("OLEAFLY_BLOB_STORE")? {
        Some(raw) if !raw.eq_ignore_ascii_case("fs") => Some(parse_s3_location(&raw)?),
        _ => None,
    };
    let Some((bucket, prefix)) = location else {
        if let Some(name) = S3_VARIABLES.iter().find(|name| source.is_set(name)) {
            return Err(ConfigError::new(
                *name,
                format!("{name} is set, but OLEAFLY_BLOB_STORE is not an s3:// address, so the server would ignore it. Set OLEAFLY_BLOB_STORE to your bucket, such as s3://lab-bucket, or remove the OLEAFLY_S3_ settings."),
            ));
        }
        return Ok(BlobStoreConfig::Filesystem);
    };
    let endpoint = match source.get("OLEAFLY_S3_ENDPOINT") {
        Some(raw) => Some(parse_s3_endpoint(&raw)?),
        None => None,
    };
    let region = match source.get("OLEAFLY_S3_REGION") {
        Some(raw) => {
            if raw.len() > 64
                || !raw.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
                })
            {
                return Err(ConfigError::new(
                    "OLEAFLY_S3_REGION",
                    format!("OLEAFLY_S3_REGION must be a region name such as us-east-1 or auto, not {raw}."),
                ));
            }
            raw
        }
        None => DEFAULT_S3_REGION.to_string(),
    };
    let access_key_id = source.secret("OLEAFLY_S3_ACCESS_KEY_ID")?;
    let secret_access_key = source.secret("OLEAFLY_S3_SECRET_ACCESS_KEY")?;
    let (access_key_id, secret_access_key) = match (access_key_id, secret_access_key) {
        (Some(id), Some(secret)) => (id, secret),
        (None, None) => {
            return Err(ConfigError::new(
                "OLEAFLY_S3_ACCESS_KEY_ID",
                "OLEAFLY_BLOB_STORE points to an S3 bucket, but the server has no keys for it. Set OLEAFLY_S3_ACCESS_KEY_ID and OLEAFLY_S3_SECRET_ACCESS_KEY, or their _FILE versions.",
            ))
        }
        (None, Some(_)) => {
            return Err(ConfigError::new(
                "OLEAFLY_S3_ACCESS_KEY_ID",
                "S3 storage is half configured. OLEAFLY_S3_ACCESS_KEY_ID (or OLEAFLY_S3_ACCESS_KEY_ID_FILE) is missing.",
            ))
        }
        (Some(_), None) => {
            return Err(ConfigError::new(
                "OLEAFLY_S3_SECRET_ACCESS_KEY",
                "S3 storage is half configured. OLEAFLY_S3_SECRET_ACCESS_KEY (or OLEAFLY_S3_SECRET_ACCESS_KEY_FILE) is missing.",
            ))
        }
    };
    Ok(BlobStoreConfig::S3(Box::new(S3Config {
        bucket,
        prefix,
        endpoint,
        region,
        access_key_id,
        secret_access_key,
    })))
}

fn parse_s3_location(raw: &str) -> Result<(String, String), ConfigError> {
    let invalid = || {
        ConfigError::new(
            "OLEAFLY_BLOB_STORE",
            "OLEAFLY_BLOB_STORE must be fs or an s3:// address such as s3://lab-bucket or s3://lab-bucket/oleafly.",
        )
    };
    let url = Url::parse(raw).map_err(|_| invalid())?;
    if url.scheme() != "s3"
        || !raw
            .get(..5)
            .is_some_and(|start| start.eq_ignore_ascii_case("s3://"))
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid());
    }
    let bucket = url.host_str().unwrap_or_default();
    if !valid_bucket(bucket) {
        return Err(ConfigError::new(
            "OLEAFLY_BLOB_STORE",
            format!("The bucket in OLEAFLY_BLOB_STORE ({bucket}) must be 3 to 63 lowercase letters, digits, dots and dashes, starting and ending with a letter or digit."),
        ));
    }
    let path = url.path().trim_start_matches('/');
    let prefix = path.strip_suffix('/').unwrap_or(path);
    let prefix_ok = prefix.is_empty()
        || prefix.split('/').all(|segment| {
            !segment.is_empty()
                && segment != "."
                && segment != ".."
                && segment.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | '~')
                })
        });
    if !prefix_ok {
        return Err(ConfigError::new(
            "OLEAFLY_BLOB_STORE",
            format!("The folder in OLEAFLY_BLOB_STORE ({}) may only use letters, digits, dashes, underscores, dots and tildes, with one slash between parts.", url.path()),
        ));
    }
    Ok((bucket.to_string(), prefix.to_string()))
}

fn valid_bucket(bucket: &str) -> bool {
    let edge_ok = |character: Option<char>| {
        character
            .is_some_and(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
    };
    (3..=63).contains(&bucket.len())
        && bucket.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '.' | '-')
        })
        && edge_ok(bucket.chars().next())
        && edge_ok(bucket.chars().last())
}

fn parse_s3_endpoint(raw: &str) -> Result<Url, ConfigError> {
    let name = "OLEAFLY_S3_ENDPOINT";
    let url = Url::parse(raw).map_err(|_| {
        ConfigError::new(
            name,
            format!("{name} must be the address of an S3-compatible store, such as https://minio.example.edu:9000, not {raw}."),
        )
    })?;
    if !matches!(url.scheme(), "https" | "http") || url.host_str().is_none() {
        return Err(ConfigError::new(
            name,
            format!("{name} must start with https:// or http://, such as https://minio.example.edu:9000."),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(ConfigError::new(
            name,
            format!("{name} cannot contain a user name or password. Use OLEAFLY_S3_ACCESS_KEY_ID and OLEAFLY_S3_SECRET_ACCESS_KEY."),
        ));
    }
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err(ConfigError::new(
            name,
            format!("{name} must be only the address of the store, with no path, query string or # part. Put the bucket and folder in OLEAFLY_BLOB_STORE."),
        ));
    }
    Ok(url)
}

impl fmt::Debug for ProviderConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProviderConfig::Github {
                id,
                label,
                client_id,
                web_url,
                api_url,
                ..
            } => formatter
                .debug_struct("Github")
                .field("id", id)
                .field("label", label)
                .field("client_id", client_id)
                .field("client_secret", &"<hidden>")
                .field("web_url", &web_url.as_str())
                .field("api_url", &api_url.as_str())
                .finish(),
            ProviderConfig::Oidc {
                id,
                label,
                issuer,
                client_id,
                trust_email,
                ..
            } => formatter
                .debug_struct("Oidc")
                .field("id", id)
                .field("label", label)
                .field("issuer", issuer)
                .field("client_id", client_id)
                .field("client_secret", &"<hidden>")
                .field("trust_email", trust_email)
                .finish(),
        }
    }
}

impl fmt::Debug for BlobStoreConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BlobStoreConfig::Filesystem => formatter.write_str("Filesystem"),
            BlobStoreConfig::S3(s3) => formatter
                .debug_struct("S3")
                .field("bucket", &s3.bucket)
                .field("prefix", &s3.prefix)
                .field("endpoint", &s3.endpoint.as_ref().map(Url::as_str))
                .field("region", &s3.region)
                .finish_non_exhaustive(),
        }
    }
}

impl fmt::Debug for ServerConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ServerConfig")
            .field("public_url", &self.public_url.as_str())
            .field("bind", &self.bind)
            .field("data_dir", &self.data_dir)
            .field("server_name", &self.server_name)
            .field("server_icon_url", &self.server_icon_url)
            .field("setup_code", &self.setup_code.as_ref().map(|_| "<hidden>"))
            .field("providers", &self.providers)
            .field("smtp_url", &self.smtp_url.as_ref().map(|_| "<hidden>"))
            .field("mail_from", &self.mail_from)
            .field("blob_store", &self.blob_store)
            .field("max_project_mb", &self.limits.max_project_mb)
            .field("max_file_mb", &self.limits.max_file_mb)
            .field(
                "max_members_per_project",
                &self.limits.max_members_per_project,
            )
            .field("open_signup", &self.open_signup)
            .field("quotas", &self.quotas)
            .field("web", &self.web)
            .field("sign_in", &self.sign_in)
            .field("behind_proxy", &self.behind_proxy)
            .field("proxy_hops", &self.proxy_hops)
            .field(
                "trusted_proxies",
                &self
                    .trusted_proxies
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>(),
            )
            .field("log_level", &self.log_level)
            .field("security_log_days", &self.security_log_days)
            .field("archive_days", &self.archive_days)
            .field("snapshot_memory_mb", &self.snapshot_memory_mb)
            .field("poll_hold", &self.poll_hold)
            .field("startup_notes", &self.startup_notes)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: (&str, &str) = ("OLEAFLY_PUBLIC_URL", "https://c.example.edu");

    fn vars(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect()
    }

    fn missing_file(path: &Path) -> std::io::Result<String> {
        Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            path.display().to_string(),
        ))
    }

    fn load(pairs: &[(&str, &str)]) -> Result<ServerConfig, ConfigError> {
        ServerConfig::from_vars(&vars(pairs), &missing_file)
    }

    fn load_err(pairs: &[(&str, &str)]) -> ConfigError {
        match load(pairs) {
            Ok(_) => panic!("expected a configuration error"),
            Err(error) => error,
        }
    }

    fn load_with(
        pairs: &[(&str, &str)],
        read: &dyn Fn(&Path) -> std::io::Result<String>,
    ) -> Result<ServerConfig, ConfigError> {
        ServerConfig::from_vars(&vars(pairs), read)
    }

    fn cgroup_file(
        wanted: &'static str,
        answer: &'static str,
    ) -> impl Fn(&Path) -> std::io::Result<String> {
        move |path: &Path| {
            if path == Path::new(wanted) {
                Ok(answer.to_string())
            } else {
                missing_file(path)
            }
        }
    }

    #[test]
    fn snapshot_memory_is_half_the_container_limit_unless_set() {
        let v2 = "/sys/fs/cgroup/memory.max";
        let v1 = "/sys/fs/cgroup/memory/memory.limit_in_bytes";
        assert_eq!(load(&[BASE]).unwrap().snapshot_memory_mb, 1024);
        let memory = |file, answer| {
            load_with(&[BASE], &cgroup_file(file, answer))
                .unwrap()
                .snapshot_memory_mb
        };
        assert_eq!(memory(v2, "536870912\n"), 256);
        assert_eq!(memory(v2, "max\n"), 1024);
        assert_eq!(memory(v1, "1073741824\n"), 512);
        assert_eq!(memory(v1, "9223372036854771712\n"), 1024);
        let set = load_with(
            &[BASE, ("OLEAFLY_SNAPSHOT_MEMORY_MB", "300")],
            &cgroup_file(v2, "536870912"),
        )
        .unwrap();
        assert_eq!(set.snapshot_memory_mb, 300);
        assert_eq!(
            load_err(&[BASE, ("OLEAFLY_SNAPSHOT_MEMORY_MB", "0")]).variable,
            "OLEAFLY_SNAPSHOT_MEMORY_MB"
        );
    }

    fn files(
        answers: &'static [(&'static str, &'static str)],
    ) -> impl Fn(&Path) -> std::io::Result<String> {
        move |path: &Path| {
            answers
                .iter()
                .find(|(wanted, _)| path == Path::new(wanted))
                .map(|(_, answer)| Ok((*answer).to_string()))
                .unwrap_or_else(|| missing_file(path))
        }
    }

    fn budget_and_note(
        answers: &'static [(&'static str, &'static str)],
    ) -> (u64, Vec<StartupNote>) {
        let config = load_with(&[BASE], &files(answers)).unwrap();
        (config.snapshot_memory_mb, config.startup_notes)
    }

    #[test]
    fn snapshot_memory_is_half_the_smaller_of_the_limit_and_the_machine() {
        let (budget, notes) = budget_and_note(&[
            ("/sys/fs/cgroup/memory.max", "max\n"),
            (
                "/proc/meminfo",
                "MemTotal:        1000000 kB\nMemFree:          200000 kB\n",
            ),
        ]);
        assert_eq!(budget, 488);
        assert_eq!(
            notes,
            [StartupNote::Info(
                "Documents and large file transfers may use 488 MB together (half of 976 MB)."
                    .to_string()
            )]
        );
        let (bigger_limit, _) = budget_and_note(&[
            ("/sys/fs/cgroup/memory.max", "4294967296\n"),
            ("/proc/meminfo", "MemTotal: 2048000 kB\n"),
        ]);
        assert_eq!(bigger_limit, 1000);
        let (smaller_limit, _) = budget_and_note(&[
            ("/sys/fs/cgroup/memory.max", "536870912\n"),
            ("/proc/meminfo", "MemTotal: 8192000 kB\n"),
        ]);
        assert_eq!(smaller_limit, 256);
    }

    #[test]
    fn a_systemd_memory_limit_on_the_service_or_its_slice_counts() {
        let (service, _) = budget_and_note(&[
            (
                "/proc/self/cgroup",
                "0::/system.slice/oleafly-server.service\n",
            ),
            (
                "/sys/fs/cgroup/system.slice/oleafly-server.service/memory.max",
                "1073741824\n",
            ),
            ("/sys/fs/cgroup/system.slice/memory.max", "max\n"),
            ("/proc/meminfo", "MemTotal: 16384000 kB\n"),
        ]);
        assert_eq!(service, 512);
        let (slice, _) = budget_and_note(&[
            (
                "/proc/self/cgroup",
                "0::/system.slice/oleafly-server.service\n",
            ),
            (
                "/sys/fs/cgroup/system.slice/oleafly-server.service/memory.max",
                "max\n",
            ),
            ("/sys/fs/cgroup/system.slice/memory.max", "805306368\n"),
        ]);
        assert_eq!(slice, 384);
        let (version_one, _) = budget_and_note(&[
            (
                "/proc/self/cgroup",
                "12:cpu,cpuacct:/docker/abc\n4:memory:/docker/abc\n",
            ),
            (
                "/sys/fs/cgroup/memory/docker/abc/memory.limit_in_bytes",
                "268435456\n",
            ),
        ]);
        assert_eq!(version_one, 128);
    }

    #[test]
    fn without_any_memory_figure_the_default_stays_and_the_note_says_how_to_change_it() {
        let (budget, notes) = budget_and_note(&[]);
        assert_eq!(budget, 1024);
        assert!(
            matches!(&notes[..], [StartupNote::Info(text)] if text.contains("set OLEAFLY_SNAPSHOT_MEMORY_MB")),
            "{notes:?}"
        );
        let set = load(&[BASE, ("OLEAFLY_SNAPSHOT_MEMORY_MB", "300")]).unwrap();
        assert_eq!(
            set.startup_notes,
            [StartupNote::Info(
                "Documents and large file transfers may use 300 MB together, as OLEAFLY_SNAPSHOT_MEMORY_MB says.".to_string()
            )]
        );
    }

    #[test]
    fn minimal_configuration_uses_documented_defaults() {
        let config = load(&[("OLEAFLY_PUBLIC_URL", "https://collab.example.edu")]).unwrap();
        assert_eq!(config.public_url.as_str(), "https://collab.example.edu/");
        assert_eq!(config.bind, "0.0.0.0:8080".parse::<SocketAddr>().unwrap());
        assert_eq!(config.data_dir, PathBuf::from("/data"));
        assert_eq!(config.server_name, "Oleafly Server");
        assert_eq!(config.server_icon_url, None);
        assert_eq!(config.setup_code, None);
        assert!(config.providers.is_empty());
        assert_eq!(config.smtp_url, None);
        assert_eq!(config.mail_from, None);
        assert_eq!(config.blob_store, BlobStoreConfig::Filesystem);
        assert_eq!(config.limits.max_project_mb, 200);
        assert_eq!(config.limits.max_file_mb, 50);
        assert_eq!(config.limits.max_members_per_project, 20);
        assert!(!config.behind_proxy);
        assert_eq!(config.log_level, "info");
        assert_eq!(config.security_log_days, 365);
        assert_eq!(config.archive_days, 30);
    }

    #[test]
    fn sign_in_limits_let_fifty_people_behind_one_address_sign_in_within_fifteen_minutes() {
        let limits = load(&[BASE]).unwrap().sign_in;
        assert_eq!(
            limits,
            SignInLimits {
                requests_burst: 300,
                requests_per_minute: 120,
                email_links_per_ip: 100,
                email_links_per_address: 3,
                email_links_per_hour: 300,
                device_codes_per_ip: 100,
            }
        );
        let people = 50u32;
        let requests_each = 6u32;
        assert!(people * requests_each <= limits.requests_burst);
        assert!(people * 2 <= limits.email_links_per_ip);
        assert!(limits.email_links_per_address <= 3);
        assert!(people * 2 <= limits.device_codes_per_ip);
    }

    #[test]
    fn sign_in_limits_can_be_set_and_must_be_whole_numbers_of_at_least_one() {
        let limits = load(&[
            BASE,
            ("OLEAFLY_SIGN_IN_BURST", "500"),
            ("OLEAFLY_SIGN_IN_PER_MINUTE", "250"),
            ("OLEAFLY_EMAIL_LINKS_PER_IP", "400"),
            ("OLEAFLY_EMAIL_LINKS_PER_ADDRESS", "5"),
            ("OLEAFLY_EMAIL_LINKS_PER_HOUR", "50"),
            ("OLEAFLY_DEVICE_CODES_PER_IP", "300"),
        ])
        .unwrap()
        .sign_in;
        assert_eq!(
            limits,
            SignInLimits {
                requests_burst: 500,
                requests_per_minute: 250,
                email_links_per_ip: 400,
                email_links_per_address: 5,
                email_links_per_hour: 50,
                device_codes_per_ip: 300,
            }
        );
        for variable in [
            "OLEAFLY_SIGN_IN_BURST",
            "OLEAFLY_SIGN_IN_PER_MINUTE",
            "OLEAFLY_EMAIL_LINKS_PER_IP",
            "OLEAFLY_EMAIL_LINKS_PER_ADDRESS",
            "OLEAFLY_EMAIL_LINKS_PER_HOUR",
            "OLEAFLY_DEVICE_CODES_PER_IP",
        ] {
            for bad in ["0", "-3", "lots", "1.5"] {
                let error = load_err(&[BASE, (variable, bad)]);
                assert_eq!(error.variable, variable, "{variable}={bad}");
                assert!(
                    error.message.contains("whole number of at least 1"),
                    "{}",
                    error.message
                );
            }
        }
        let error = load_err(&[
            BASE,
            ("OLEAFLY_EMAIL_LINKS_PER_IP", "4"),
            ("OLEAFLY_EMAIL_LINKS_PER_ADDRESS", "5"),
        ]);
        assert_eq!(error.variable, "OLEAFLY_EMAIL_LINKS_PER_ADDRESS");
        assert!(
            error
                .message
                .contains("cannot be larger than OLEAFLY_EMAIL_LINKS_PER_IP"),
            "{}",
            error.message
        );
    }

    #[test]
    fn missing_public_url_is_a_clear_error() {
        let error = load_err(&[]);
        assert_eq!(error.variable, "OLEAFLY_PUBLIC_URL");
        assert!(error.message.contains("OLEAFLY_PUBLIC_URL is not set"));
        assert_eq!(
            load_err(&[("OLEAFLY_PUBLIC_URL", "   ")]).variable,
            "OLEAFLY_PUBLIC_URL"
        );
    }

    #[test]
    fn public_url_must_be_https_except_on_loopback() {
        let error = load_err(&[("OLEAFLY_PUBLIC_URL", "http://collab.example.edu")]);
        assert_eq!(error.variable, "OLEAFLY_PUBLIC_URL");
        assert!(error.message.contains("https"));
        for local in [
            "http://127.0.0.1:8080",
            "http://localhost:8080",
            "http://[::1]:8080",
        ] {
            assert!(
                load(&[("OLEAFLY_PUBLIC_URL", local)]).is_ok(),
                "{local} should be accepted"
            );
        }
        assert!(
            load_err(&[("OLEAFLY_PUBLIC_URL", "http://localhost.example.edu")])
                .message
                .contains("https")
        );
        assert!(
            load_err(&[("OLEAFLY_PUBLIC_URL", "ftp://collab.example.edu")])
                .message
                .contains("https")
        );
        assert_eq!(
            load_err(&[("OLEAFLY_PUBLIC_URL", "collab.example.edu")]).variable,
            "OLEAFLY_PUBLIC_URL"
        );
    }

    #[test]
    fn path_prefix_trailing_slash_and_case_are_the_same_server() {
        for raw in [
            "https://uni.edu/oleafly",
            "https://uni.edu/oleafly/",
            "HTTPS://Uni.edu/oleafly",
        ] {
            let config = load(&[("OLEAFLY_PUBLIC_URL", raw)]).unwrap();
            assert_eq!(
                config.public_url.as_str(),
                "https://uni.edu/oleafly",
                "{raw}"
            );
            assert_eq!(config.path_prefix(), "/oleafly");
            assert_eq!(
                config.endpoint("/auth/callback/github").as_str(),
                "https://uni.edu/oleafly/auth/callback/github"
            );
            assert_eq!(
                config.endpoint(".well-known/oleafly-server").as_str(),
                "https://uni.edu/oleafly/.well-known/oleafly-server"
            );
        }
        let root = load(&[("OLEAFLY_PUBLIC_URL", "https://collab.example.edu/")]).unwrap();
        assert_eq!(root.path_prefix(), "");
        assert_eq!(
            root.endpoint("/healthz").as_str(),
            "https://collab.example.edu/healthz"
        );
    }

    #[test]
    fn public_url_rejects_queries_credentials_odd_paths_and_reserved_prefixes() {
        for raw in [
            "https://uni.edu/oleafly?x=1",
            "https://uni.edu/#top",
            "https://me:pw@uni.edu",
            "https://uni.edu/a%20b",
            "https://uni.edu/api",
            "https://uni.edu/auth/lab",
        ] {
            assert_eq!(
                load_err(&[("OLEAFLY_PUBLIC_URL", raw)]).variable,
                "OLEAFLY_PUBLIC_URL",
                "{raw}"
            );
        }
    }

    #[test]
    fn secrets_from_files_are_trimmed_like_the_same_value_in_a_variable() {
        let read = |path: &Path| -> std::io::Result<String> {
            match path.to_str() {
                Some("/run/secrets/github") => Ok("gh-secret \n".to_string()),
                Some("/run/secrets/setup") => Ok("ABCD-EFGH-JKMN-PQRS\r\n".to_string()),
                Some("/run/secrets/smtp") => {
                    Ok("smtps://mailer:pw@smtp.example.edu:465".to_string())
                }
                Some("/run/secrets/oidc") => Ok("oidc-secret\n\n".to_string()),
                Some("/run/secrets/blobs") => Ok("s3://lab-bucket\n".to_string()),
                Some("/run/secrets/s3-id") => Ok("  AKIDFROMFILE\r\n\r\n".to_string()),
                Some("/run/secrets/s3-secret") => Ok("s3-secret-from-file\n".to_string()),
                _ => Err(std::io::Error::new(std::io::ErrorKind::NotFound, "missing")),
            }
        };
        let config = load_with(
            &[
                BASE,
                ("OLEAFLY_GITHUB_CLIENT_ID", "Iv1.abc"),
                ("OLEAFLY_GITHUB_CLIENT_SECRET", ""),
                ("OLEAFLY_GITHUB_CLIENT_SECRET_FILE", "/run/secrets/github"),
                ("OLEAFLY_SETUP_CODE_FILE", "/run/secrets/setup"),
                ("OLEAFLY_SMTP_URL_FILE", "/run/secrets/smtp"),
                ("OLEAFLY_MAIL_FROM", "Smith Lab <lab@example.edu>"),
                ("OLEAFLY_BLOB_STORE_FILE", "/run/secrets/blobs"),
                ("OLEAFLY_S3_ACCESS_KEY_ID_FILE", "/run/secrets/s3-id"),
                (
                    "OLEAFLY_S3_SECRET_ACCESS_KEY_FILE",
                    "/run/secrets/s3-secret",
                ),
                (
                    "OLEAFLY_OIDC_UNI_ISSUER",
                    "https://login.uni.edu/realms/main",
                ),
                ("OLEAFLY_OIDC_UNI_CLIENT_ID", "oleafly"),
                ("OLEAFLY_OIDC_UNI_CLIENT_SECRET_FILE", "/run/secrets/oidc"),
            ],
            &read,
        )
        .unwrap();
        assert_eq!(config.setup_code.as_deref(), Some("ABCD-EFGH-JKMN-PQRS"));
        assert_eq!(
            config.smtp_url.as_deref(),
            Some("smtps://mailer:pw@smtp.example.edu:465")
        );
        match &config.blob_store {
            BlobStoreConfig::S3(s3) => {
                assert_eq!(s3.bucket, "lab-bucket");
                assert_eq!(s3.access_key_id, "AKIDFROMFILE");
                assert_eq!(s3.secret_access_key, "s3-secret-from-file");
            }
            BlobStoreConfig::Filesystem => panic!("expected an S3 blob store"),
        }
        match &config.providers[..] {
            [ProviderConfig::Github { client_secret, .. }, ProviderConfig::Oidc {
                client_secret: oidc_secret,
                ..
            }] => {
                assert_eq!(client_secret, "gh-secret");
                assert_eq!(oidc_secret, "oidc-secret");
            }
            other => panic!("unexpected providers: {other:?}"),
        }
    }

    #[test]
    fn only_secret_settings_have_file_variants_and_unknown_names_are_ignored_but_named() {
        let read =
            |_: &Path| -> std::io::Result<String> { Ok("https://other.example.edu".to_string()) };
        let config = load_with(
            &[
                BASE,
                ("OLEAFLY_PUBLIC_URL_FILE", "/run/secrets/url"),
                ("OLEAFLY_GITHUB_CLIENT_ID_FILE", "/run/secrets/id"),
                ("OLEAFLY_OIDC_UNI_ISSUER_FILE", "/run/secrets/issuer"),
                ("OLEAFLY_OIDC_UNI_ISSUR", "https://login.uni.edu"),
                ("OLEAFLY_DOMAIN", "collab.example.edu"),
            ],
            &read,
        )
        .unwrap();
        assert_eq!(config.public_url.as_str(), "https://c.example.edu/");
        assert!(config.providers.is_empty());
        let named: Vec<(&str, Option<&str>)> = config
            .ignored_settings
            .iter()
            .map(|ignored| (ignored.name.as_str(), ignored.instead.as_deref()))
            .collect();
        assert_eq!(
            named,
            [
                (
                    "OLEAFLY_GITHUB_CLIENT_ID_FILE",
                    Some("OLEAFLY_GITHUB_CLIENT_ID")
                ),
                (
                    "OLEAFLY_OIDC_UNI_ISSUER_FILE",
                    Some("OLEAFLY_OIDC_UNI_ISSUER")
                ),
                ("OLEAFLY_OIDC_UNI_ISSUR", Some("OLEAFLY_OIDC_UNI_ISSUER")),
                ("OLEAFLY_PUBLIC_URL_FILE", Some("OLEAFLY_PUBLIC_URL")),
            ]
        );
    }

    #[test]
    fn a_misspelled_setting_is_named_at_startup_with_the_one_it_was_meant_to_be() {
        let config = load(&[
            BASE,
            ("OLEAFLY_SMTP_URI", "smtps://lab:secret@smtp.example.edu"),
            ("OLEAFLY_SECURITY_LOGS_DAYS", "30"),
            ("OLEAFLY_BEHIND_PROXIES", "true"),
            ("OLEAFLY_COLOUR_SCHEME", "dark"),
            ("OLEAFLY_DOMAIN", "c.example.edu"),
            ("OLEAFLY_EMPTY_ONE", " "),
        ])
        .unwrap();
        let named: Vec<(&str, Option<&str>)> = config
            .ignored_settings
            .iter()
            .map(|ignored| (ignored.name.as_str(), ignored.instead.as_deref()))
            .collect();
        assert_eq!(
            named,
            [
                ("OLEAFLY_BEHIND_PROXIES", Some("OLEAFLY_BEHIND_PROXY")),
                ("OLEAFLY_COLOUR_SCHEME", None),
                (
                    "OLEAFLY_SECURITY_LOGS_DAYS",
                    Some("OLEAFLY_SECURITY_LOG_DAYS")
                ),
                ("OLEAFLY_SMTP_URI", Some("OLEAFLY_SMTP_URL")),
            ]
        );
        let warning = config
            .startup_notes
            .iter()
            .find_map(|note| match note {
                StartupNote::Warning(text) => Some(text.as_str()),
                StartupNote::Info(_) => None,
            })
            .expect("one warning");
        assert!(
            warning.contains("OLEAFLY_SMTP_URI is not a setting. Did you mean OLEAFLY_SMTP_URL?"),
            "{warning}"
        );
        assert!(
            warning.contains("OLEAFLY_COLOUR_SCHEME is not a setting, so it has no effect."),
            "{warning}"
        );
        assert!(!warning.contains("secret"), "{warning}");
        assert!(!format!("{config:?}").contains("smtp.example.edu"));
        let clean = load(&[
            BASE,
            ("OLEAFLY_DOMAIN", "c.example.edu"),
            ("OLEAFLY_IPV6", "true"),
        ])
        .unwrap();
        assert!(clean.ignored_settings.is_empty());
        assert!(clean
            .startup_notes
            .iter()
            .all(|note| matches!(note, StartupNote::Info(_))));
    }

    #[test]
    fn edit_distance_counts_single_character_changes() {
        assert_eq!(edit_distance("OLEAFLY_SMTP_URI", "OLEAFLY_SMTP_URL"), 1);
        assert_eq!(edit_distance("PROXIES", "PROXY"), 3);
        assert_eq!(edit_distance("", "abc"), 3);
        assert_eq!(edit_distance("same", "same"), 0);
    }

    #[test]
    fn a_secret_set_twice_unreadable_or_empty_is_an_error() {
        let both = load_err(&[
            BASE,
            ("OLEAFLY_SETUP_CODE", "ABCD-EFGH-JKMN-PQRS"),
            ("OLEAFLY_SETUP_CODE_FILE", "/run/secrets/setup"),
        ]);
        assert_eq!(both.variable, "OLEAFLY_SETUP_CODE");
        assert!(both.message.contains("OLEAFLY_SETUP_CODE_FILE"));
        let unreadable = load_err(&[
            BASE,
            ("OLEAFLY_GITHUB_CLIENT_ID", "id"),
            ("OLEAFLY_GITHUB_CLIENT_SECRET_FILE", "/run/secrets/missing"),
        ]);
        assert_eq!(unreadable.variable, "OLEAFLY_GITHUB_CLIENT_SECRET_FILE");
        assert!(unreadable.message.contains("/run/secrets/missing"));
        let blank = |_: &Path| -> std::io::Result<String> { Ok("\n".to_string()) };
        let empty = match load_with(
            &[
                BASE,
                ("OLEAFLY_SMTP_URL_FILE", "/run/secrets/smtp"),
                ("OLEAFLY_MAIL_FROM", "lab@example.edu"),
            ],
            &blank,
        ) {
            Ok(_) => panic!("an empty secret file must be refused"),
            Err(error) => error,
        };
        assert_eq!(empty.variable, "OLEAFLY_SMTP_URL_FILE");
        assert!(empty.message.contains("empty"));
    }

    #[test]
    fn starting_needs_github_or_openid_connect_and_email_alone_is_not_enough() {
        let nothing = load(&[BASE]).unwrap().require_sign_in().unwrap_err();
        assert_eq!(nothing.variable, "OLEAFLY_GITHUB_CLIENT_ID");
        assert!(
            nothing.message.starts_with("No sign-in method is set up"),
            "{}",
            nothing.message
        );
        assert!(
            nothing.message.contains("OLEAFLY_GITHUB_CLIENT_SECRET"),
            "{}",
            nothing.message
        );
        assert!(
            nothing.message.contains("OLEAFLY_OIDC_<NAME>_ISSUER"),
            "{}",
            nothing.message
        );
        let email_only = load(&[
            BASE,
            (
                "OLEAFLY_SMTP_URL",
                "smtps://lab:secret@smtp.example.edu:465",
            ),
            ("OLEAFLY_MAIL_FROM", "lab@example.edu"),
        ])
        .unwrap();
        assert_eq!(email_only.require_sign_in(), Err(nothing));
        let github = load(&[
            BASE,
            ("OLEAFLY_GITHUB_CLIENT_ID", "id"),
            ("OLEAFLY_GITHUB_CLIENT_SECRET", "secret"),
        ])
        .unwrap();
        assert_eq!(github.require_sign_in(), Ok(()));
        let oidc = load(&[
            BASE,
            ("OLEAFLY_OIDC_UNI_ISSUER", "https://login.uni.edu"),
            ("OLEAFLY_OIDC_UNI_CLIENT_ID", "id"),
            ("OLEAFLY_OIDC_UNI_CLIENT_SECRET", "secret"),
        ])
        .unwrap();
        assert_eq!(oidc.require_sign_in(), Ok(()));
    }

    #[test]
    fn half_configured_providers_name_the_missing_variable() {
        assert_eq!(
            load_err(&[BASE, ("OLEAFLY_GITHUB_CLIENT_ID", "id")]).variable,
            "OLEAFLY_GITHUB_CLIENT_SECRET"
        );
        assert_eq!(
            load_err(&[BASE, ("OLEAFLY_GITHUB_CLIENT_SECRET", "secret")]).variable,
            "OLEAFLY_GITHUB_CLIENT_ID"
        );
        assert_eq!(
            load_err(&[BASE, ("OLEAFLY_GITHUB_URL", "https://ghe.uni.edu")]).variable,
            "OLEAFLY_GITHUB_CLIENT_ID"
        );
        let oidc = load_err(&[BASE, ("OLEAFLY_OIDC_UNI_ISSUER", "https://login.uni.edu")]);
        assert_eq!(oidc.variable, "OLEAFLY_OIDC_UNI_CLIENT_ID");
        assert!(oidc.message.contains("OLEAFLY_OIDC_UNI_CLIENT_SECRET"));
        assert!(oidc.message.contains("half configured"));
        let typo = load_err(&[
            BASE,
            ("OLEAFLY_OIDC_UNI_ISSUR", "https://login.uni.edu"),
            ("OLEAFLY_OIDC_UNI_CLIENT_ID", "id"),
            ("OLEAFLY_OIDC_UNI_CLIENT_SECRET", "secret"),
        ]);
        assert_eq!(typo.variable, "OLEAFLY_OIDC_UNI_ISSUER");
        let underscored = load_err(&[
            BASE,
            ("OLEAFLY_OIDC_UNI_LOGIN_ISSUER", "https://login.uni.edu"),
        ]);
        assert_eq!(underscored.variable, "OLEAFLY_OIDC_UNI_LOGIN_ISSUER");
        assert!(underscored.message.contains("letters and digits"));
    }

    #[test]
    fn github_defaults_and_enterprise_api_url() {
        let config = load(&[
            BASE,
            ("OLEAFLY_GITHUB_CLIENT_ID", "id"),
            ("OLEAFLY_GITHUB_CLIENT_SECRET", "secret"),
        ])
        .unwrap();
        match &config.providers[..] {
            [ProviderConfig::Github {
                id,
                label,
                web_url,
                api_url,
                ..
            }] => {
                assert_eq!(id, "github");
                assert_eq!(label, "GitHub");
                assert_eq!(web_url.as_str(), "https://github.com/");
                assert_eq!(api_url.as_str(), "https://api.github.com/");
            }
            other => panic!("unexpected providers: {other:?}"),
        }
        let enterprise = load(&[
            BASE,
            ("OLEAFLY_GITHUB_CLIENT_ID", "id"),
            ("OLEAFLY_GITHUB_CLIENT_SECRET", "secret"),
            ("OLEAFLY_GITHUB_URL", "https://GHE.uni.edu/"),
            ("OLEAFLY_GITHUB_LABEL", "University GitHub"),
        ])
        .unwrap();
        match &enterprise.providers[..] {
            [ProviderConfig::Github {
                label,
                web_url,
                api_url,
                ..
            }] => {
                assert_eq!(label, "University GitHub");
                assert_eq!(web_url.as_str(), "https://ghe.uni.edu/");
                assert_eq!(api_url.as_str(), "https://ghe.uni.edu/api/v3");
            }
            other => panic!("unexpected providers: {other:?}"),
        }
    }

    #[test]
    fn oidc_blocks_become_providers_with_the_issuer_kept_as_written() {
        let config = load(&[
            BASE,
            (
                "OLEAFLY_OIDC_UNI_ISSUER",
                "https://login.uni.edu/realms/main",
            ),
            ("OLEAFLY_OIDC_UNI_CLIENT_ID", "oleafly"),
            ("OLEAFLY_OIDC_UNI_CLIENT_SECRET", "uni-secret"),
            ("OLEAFLY_OIDC_UNI_LABEL", "University login"),
            ("OLEAFLY_OIDC_UNI_TRUST_EMAIL", "TRUE"),
            ("OLEAFLY_OIDC_GitLab_ISSUER", "https://gitlab.com"),
            ("OLEAFLY_OIDC_GitLab_CLIENT_ID", "gitlab-id"),
            ("OLEAFLY_OIDC_GitLab_CLIENT_SECRET", "gitlab-secret"),
            ("OLEAFLY_OIDC_UNUSED_ISSUER", ""),
            ("OLEAFLY_OIDC_UNUSED_CLIENT_ID", ""),
        ])
        .unwrap();
        let ids: Vec<&str> = config.providers.iter().map(ProviderConfig::id).collect();
        assert_eq!(ids, ["gitlab", "uni"]);
        match &config.providers[..] {
            [ProviderConfig::Oidc {
                label: gitlab_label,
                issuer: gitlab_issuer,
                trust_email: gitlab_trust,
                ..
            }, ProviderConfig::Oidc {
                label,
                issuer,
                client_id,
                trust_email,
                ..
            }] => {
                assert_eq!(gitlab_label, "GitLab");
                assert_eq!(gitlab_issuer, "https://gitlab.com");
                assert!(!gitlab_trust);
                assert_eq!(label, "University login");
                assert_eq!(issuer, "https://login.uni.edu/realms/main");
                assert_eq!(client_id, "oleafly");
                assert!(*trust_email);
            }
            other => panic!("unexpected providers: {other:?}"),
        }
        let local = load(&[
            BASE,
            ("OLEAFLY_OIDC_MOCK_ISSUER", "http://127.0.0.1:9000/issuer"),
            ("OLEAFLY_OIDC_MOCK_CLIENT_ID", "id"),
            ("OLEAFLY_OIDC_MOCK_CLIENT_SECRET", "secret"),
        ])
        .unwrap();
        assert!(matches!(
            &local.providers[..],
            [ProviderConfig::Oidc { issuer, .. }] if issuer == "http://127.0.0.1:9000/issuer"
        ));
        for issuer in [
            "http://login.uni.edu",
            "login.uni.edu",
            "https://login.uni.edu/?tenant=x",
        ] {
            let error = load_err(&[
                BASE,
                ("OLEAFLY_OIDC_UNI_ISSUER", issuer),
                ("OLEAFLY_OIDC_UNI_CLIENT_ID", "id"),
                ("OLEAFLY_OIDC_UNI_CLIENT_SECRET", "secret"),
            ]);
            assert_eq!(error.variable, "OLEAFLY_OIDC_UNI_ISSUER", "{issuer}");
        }
        let twice = load_err(&[
            BASE,
            ("OLEAFLY_OIDC_UNI_ISSUER", "https://a.example.edu"),
            ("OLEAFLY_OIDC_UNI_CLIENT_ID", "id"),
            ("OLEAFLY_OIDC_UNI_CLIENT_SECRET", "secret"),
            ("OLEAFLY_OIDC_Uni_ISSUER", "https://b.example.edu"),
            ("OLEAFLY_OIDC_Uni_CLIENT_ID", "id"),
            ("OLEAFLY_OIDC_Uni_CLIENT_SECRET", "secret"),
        ]);
        assert!(twice.message.contains("uni"));
    }

    #[test]
    fn empty_values_count_as_unset() {
        let config = load(&[
            BASE,
            ("OLEAFLY_BIND", ""),
            ("OLEAFLY_SMTP_URL", ""),
            ("OLEAFLY_SMTP_URL_FILE", ""),
            ("OLEAFLY_MAIL_FROM", " "),
            ("OLEAFLY_GITHUB_CLIENT_ID", ""),
            ("OLEAFLY_SERVER_NAME", ""),
            ("OLEAFLY_SETUP_CODE", ""),
            ("OLEAFLY_BEHIND_PROXY", ""),
            ("OLEAFLY_PROXY_HOPS", ""),
            ("OLEAFLY_MAX_PROJECT_MB", ""),
            ("OLEAFLY_LOG_LEVEL", ""),
            ("OLEAFLY_BLOB_STORE", ""),
            ("OLEAFLY_S3_ENDPOINT", ""),
            ("OLEAFLY_S3_REGION", " "),
            ("OLEAFLY_S3_ACCESS_KEY_ID", ""),
            ("OLEAFLY_S3_SECRET_ACCESS_KEY_FILE", ""),
            ("OLEAFLY_OIDC_UNI_ISSUER", ""),
            ("OLEAFLY_OIDC_UNI_CLIENT_SECRET_FILE", ""),
        ])
        .unwrap();
        assert!(config.providers.is_empty());
        assert_eq!(config.smtp_url, None);
        assert_eq!(config.setup_code, None);
        assert_eq!(config.server_name, "Oleafly Server");
        assert_eq!(config.bind, "0.0.0.0:8080".parse::<SocketAddr>().unwrap());
        assert!(!config.behind_proxy);
        assert_eq!(config.proxy_hops, 1);
        assert_eq!(config.limits.max_project_mb, 200);
        assert_eq!(config.log_level, "info");
        assert_eq!(config.blob_store, BlobStoreConfig::Filesystem);
    }

    #[test]
    fn numbers_flags_levels_and_blob_store_are_validated() {
        let config = load(&[
            BASE,
            ("OLEAFLY_BIND", "127.0.0.1:9000"),
            ("OLEAFLY_DATA_DIR", "/srv/oleafly"),
            ("OLEAFLY_MAX_PROJECT_MB", "500"),
            ("OLEAFLY_MAX_FILE_MB", "100"),
            ("OLEAFLY_MAX_MEMBERS_PER_PROJECT", "40"),
            ("OLEAFLY_BEHIND_PROXY", "TRUE"),
            ("OLEAFLY_LOG_LEVEL", "DEBUG"),
            ("OLEAFLY_SECURITY_LOG_DAYS", "90"),
            ("OLEAFLY_ARCHIVE_DAYS", "7"),
            ("OLEAFLY_BLOB_STORE", "s3://lab-bucket"),
            ("OLEAFLY_S3_ACCESS_KEY_ID", "AKID"),
            ("OLEAFLY_S3_SECRET_ACCESS_KEY", "secret"),
        ])
        .unwrap();
        assert_eq!(config.bind, "127.0.0.1:9000".parse::<SocketAddr>().unwrap());
        assert_eq!(config.data_dir, PathBuf::from("/srv/oleafly"));
        assert_eq!(
            (
                config.limits.max_project_mb,
                config.limits.max_file_mb,
                config.limits.max_members_per_project
            ),
            (500, 100, 40)
        );
        assert!(config.behind_proxy);
        assert!(
            !load(&[BASE, ("OLEAFLY_BEHIND_PROXY", "False")])
                .unwrap()
                .behind_proxy
        );
        assert_eq!(
            load(&[
                BASE,
                ("OLEAFLY_BEHIND_PROXY", "true"),
                ("OLEAFLY_PROXY_HOPS", "2")
            ])
            .unwrap()
            .proxy_hops,
            2
        );
        for hops in ["0", "9", "two"] {
            assert_eq!(
                load_err(&[
                    BASE,
                    ("OLEAFLY_BEHIND_PROXY", "true"),
                    ("OLEAFLY_PROXY_HOPS", hops)
                ])
                .variable,
                "OLEAFLY_PROXY_HOPS",
                "OLEAFLY_PROXY_HOPS={hops}"
            );
        }
        assert_eq!(
            load_err(&[BASE, ("OLEAFLY_PROXY_HOPS", "2")]).variable,
            "OLEAFLY_PROXY_HOPS"
        );
        assert_eq!(config.log_level, "debug");
        assert_eq!((config.security_log_days, config.archive_days), (90, 7));
        assert!(matches!(&config.blob_store, BlobStoreConfig::S3(s3) if s3.bucket == "lab-bucket"));
        assert_eq!(
            load(&[BASE, ("OLEAFLY_BLOB_STORE", "fs")])
                .unwrap()
                .blob_store,
            BlobStoreConfig::Filesystem
        );
        let long_name = "x".repeat(81);
        let rejected = [
            ("OLEAFLY_BIND", "8080"),
            ("OLEAFLY_MAX_PROJECT_MB", "0"),
            ("OLEAFLY_MAX_FILE_MB", "lots"),
            ("OLEAFLY_MAX_FILE_MB", "300"),
            ("OLEAFLY_BEHIND_PROXY", "maybe"),
            ("OLEAFLY_BEHIND_PROXY", "yes"),
            ("OLEAFLY_BEHIND_PROXY", "1"),
            ("OLEAFLY_LOG_LEVEL", "loud"),
            ("OLEAFLY_SECURITY_LOG_DAYS", "-1"),
            ("OLEAFLY_BLOB_STORE", "gs://bucket"),
            ("OLEAFLY_SERVER_NAME", long_name.as_str()),
            ("OLEAFLY_SERVER_ICON_URL", "http://cdn.example.edu/icon.png"),
        ];
        for (name, value) in rejected {
            assert_eq!(
                load_err(&[BASE, (name, value)]).variable,
                name,
                "{name}={value}"
            );
        }
    }

    #[test]
    fn trusted_proxy_ranges_match_the_addresses_inside_them() {
        let range = |text: &str| ProxyRange::parse(text).expect(text);
        let docker = range("10.0.0.0/8");
        assert!(docker.contains("10.1.2.3".parse().unwrap()));
        assert!(docker.contains("::ffff:10.0.15.2".parse().unwrap()));
        assert!(!docker.contains("11.0.0.1".parse().unwrap()));
        assert!(!docker.contains("2001:db8::1".parse().unwrap()));
        let edge = range(" 173.245.48.0/20 ");
        assert!(edge.contains("173.245.63.255".parse().unwrap()));
        assert!(!edge.contains("173.245.64.0".parse().unwrap()));
        let one = range("198.51.100.9");
        assert_eq!(one.to_string(), "198.51.100.9/32");
        assert!(one.contains("198.51.100.9".parse().unwrap()));
        assert!(!one.contains("198.51.100.10".parse().unwrap()));
        let v6 = range("2400:cb00::/32");
        assert!(v6.contains("2400:cb00:1:2::3".parse().unwrap()));
        assert!(!v6.contains("2400:cb01::1".parse().unwrap()));
        assert_eq!(range("10.1.2.3/8").to_string(), "10.0.0.0/8");
        for bad in [
            "0.0.0.0/0",
            "::/0",
            "10.0.0.0/33",
            "2001:db8::/129",
            "10.0.0/8",
            "proxy",
            "10.0.0.0/x",
            "",
        ] {
            assert_eq!(ProxyRange::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn trusted_proxies_need_a_proxy_and_replace_the_hop_count() {
        let config = load(&[
            BASE,
            ("OLEAFLY_BEHIND_PROXY", "true"),
            (
                "OLEAFLY_TRUSTED_PROXIES",
                "173.245.48.0/20, 2400:cb00::/32 10.0.0.0/8",
            ),
        ])
        .unwrap();
        assert_eq!(
            config
                .trusted_proxies
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>(),
            ["173.245.48.0/20", "2400:cb00::/32", "10.0.0.0/8"]
        );
        assert!(format!("{config:?}").contains("10.0.0.0/8"));
        assert!(load(&[BASE]).unwrap().trusted_proxies.is_empty());
        let without_proxy = load_err(&[BASE, ("OLEAFLY_TRUSTED_PROXIES", "10.0.0.0/8")]);
        assert_eq!(without_proxy.variable, "OLEAFLY_TRUSTED_PROXIES");
        assert!(without_proxy.message.contains("OLEAFLY_BEHIND_PROXY"));
        let both = load_err(&[
            BASE,
            ("OLEAFLY_BEHIND_PROXY", "true"),
            ("OLEAFLY_PROXY_HOPS", "2"),
            ("OLEAFLY_TRUSTED_PROXIES", "10.0.0.0/8"),
        ]);
        assert_eq!(both.variable, "OLEAFLY_TRUSTED_PROXIES");
        assert!(both.message.contains("not both"), "{}", both.message);
        let bad = load_err(&[
            BASE,
            ("OLEAFLY_BEHIND_PROXY", "true"),
            ("OLEAFLY_TRUSTED_PROXIES", "10.0.0.0/8, cloudflare"),
        ]);
        assert_eq!(bad.variable, "OLEAFLY_TRUSTED_PROXIES");
        assert!(
            bad.message.contains("cloudflare is not one"),
            "{}",
            bad.message
        );
    }

    #[test]
    fn trusting_every_address_is_refused_and_a_very_wide_range_is_warned_about() {
        for everything in ["0.0.0.0/0", "::/0", "10.0.0.0/8, 0.0.0.0/0"] {
            let refused = load_err(&[
                BASE,
                ("OLEAFLY_BEHIND_PROXY", "true"),
                ("OLEAFLY_TRUSTED_PROXIES", everything),
            ]);
            assert_eq!(refused.variable, "OLEAFLY_TRUSTED_PROXIES");
            assert!(
                refused.message.contains("from every address"),
                "{}",
                refused.message
            );
        }
        let warnings = |list: &str| -> Vec<String> {
            load(&[
                BASE,
                ("OLEAFLY_BEHIND_PROXY", "true"),
                ("OLEAFLY_TRUSTED_PROXIES", list),
            ])
            .unwrap()
            .startup_notes
            .into_iter()
            .filter_map(|note| match note {
                StartupNote::Warning(text) => Some(text),
                StartupNote::Info(_) => None,
            })
            .collect()
        };
        let wide = warnings("10.0.0.0/8, 0.0.0.0/1, 2000::/3");
        assert_eq!(wide.len(), 1, "{wide:?}");
        assert!(
            wide[0].starts_with("OLEAFLY_TRUSTED_PROXIES includes 0.0.0.0/1, 2000::/3,"),
            "{}",
            wide[0]
        );
        let usual = warnings(
            "173.245.48.0/20, 104.16.0.0/13, 2a06:98c0::/29, 10.0.0.0/8, 172.16.0.0/12, fc00::/7, fe80::/10",
        );
        assert!(usual.is_empty(), "{usual:?}");
    }

    #[test]
    fn email_and_setup_code_are_checked() {
        assert_eq!(
            load_err(&[BASE, ("OLEAFLY_SMTP_URL", "smtps://smtp.example.edu")]).variable,
            "OLEAFLY_MAIL_FROM"
        );
        assert_eq!(
            load_err(&[BASE, ("OLEAFLY_MAIL_FROM", "lab@example.edu")]).variable,
            "OLEAFLY_SMTP_URL"
        );
        assert_eq!(
            load_err(&[
                BASE,
                ("OLEAFLY_SMTP_URL", "https://smtp.example.edu"),
                ("OLEAFLY_MAIL_FROM", "lab@example.edu"),
            ])
            .variable,
            "OLEAFLY_SMTP_URL"
        );
        for from in ["Smith Lab <lab@>", "lab@", "Smith Lab <@example.edu>"] {
            assert_eq!(
                load_err(&[
                    BASE,
                    ("OLEAFLY_SMTP_URL", "smtps://smtp.example.edu"),
                    ("OLEAFLY_MAIL_FROM", from),
                ])
                .variable,
                "OLEAFLY_MAIL_FROM",
                "{from}"
            );
        }
        for smtp in ["smtp://", "smtps://:465", "smtp://user:pw@"] {
            assert_eq!(
                load_err(&[
                    BASE,
                    ("OLEAFLY_SMTP_URL", smtp),
                    ("OLEAFLY_MAIL_FROM", "lab@example.edu"),
                ])
                .variable,
                "OLEAFLY_SMTP_URL",
                "{smtp}"
            );
        }
        for short in ["short-code", "ABCD-EFGH-JKM", "ABCD-EFGH-JKMN-PQRS!"] {
            let error = load_err(&[BASE, ("OLEAFLY_SETUP_CODE", short)]);
            assert_eq!(error.variable, "OLEAFLY_SETUP_CODE", "{short}");
            assert!(error.message.contains("12"));
        }
        assert_eq!(
            load(&[BASE, ("OLEAFLY_SETUP_CODE", "abcd-efgh jkmn")])
                .unwrap()
                .setup_code
                .as_deref(),
            Some("abcd-efgh jkmn")
        );
        let short_file = |_: &Path| -> std::io::Result<String> { Ok("short-code\n".to_string()) };
        let from_file = match load_with(
            &[BASE, ("OLEAFLY_SETUP_CODE_FILE", "/run/secrets/setup")],
            &short_file,
        ) {
            Ok(_) => panic!("a short setup code from a file must be refused"),
            Err(error) => error,
        };
        assert_eq!(from_file.variable, "OLEAFLY_SETUP_CODE");
        assert_eq!(
            normalize_setup_code(" abcd-efgh jkmn-pqrs "),
            "ABCDEFGHJKMNPQRS"
        );
    }

    #[test]
    fn debug_output_hides_secrets() {
        let config = load(&[
            BASE,
            ("OLEAFLY_GITHUB_CLIENT_ID", "id"),
            ("OLEAFLY_GITHUB_CLIENT_SECRET", "gh-secret-value"),
            ("OLEAFLY_OIDC_UNI_ISSUER", "https://login.uni.edu"),
            ("OLEAFLY_OIDC_UNI_CLIENT_ID", "oleafly"),
            ("OLEAFLY_OIDC_UNI_CLIENT_SECRET", "oidc-secret-value"),
            ("OLEAFLY_SETUP_CODE", "ABCD-EFGH-JKMN-PQRS"),
            (
                "OLEAFLY_SMTP_URL",
                "smtps://u:smtp-password@smtp.example.edu",
            ),
            ("OLEAFLY_MAIL_FROM", "lab@example.edu"),
        ])
        .unwrap();
        let text = format!("{config:?}");
        for secret in [
            "gh-secret-value",
            "oidc-secret-value",
            "ABCD-EFGH-JKMN-PQRS",
            "smtp-password",
        ] {
            assert!(!text.contains(secret), "{secret} leaked");
        }
        assert!(text.contains("c.example.edu"));
    }

    const S3_KEYS: [(&str, &str); 2] = [
        ("OLEAFLY_S3_ACCESS_KEY_ID", "AKIDEXAMPLE"),
        ("OLEAFLY_S3_SECRET_ACCESS_KEY", "s3-secret-value"),
    ];

    fn s3_of(config: &ServerConfig) -> &S3Config {
        match &config.blob_store {
            BlobStoreConfig::S3(s3) => s3,
            BlobStoreConfig::Filesystem => panic!("expected an S3 blob store"),
        }
    }

    #[test]
    fn an_s3_blob_store_reads_its_bucket_folder_endpoint_region_and_keys() {
        let read = |path: &Path| -> std::io::Result<String> {
            match path.to_str() {
                Some("/run/secrets/s3") => Ok("secret-from-file\n".to_string()),
                _ => Err(std::io::Error::new(std::io::ErrorKind::NotFound, "missing")),
            }
        };
        let config = load_with(
            &[
                BASE,
                ("OLEAFLY_BLOB_STORE", "s3://lab-bucket/oleafly/files/"),
                ("OLEAFLY_S3_ENDPOINT", "https://minio.example.edu:9000/"),
                ("OLEAFLY_S3_REGION", "eu-central-1"),
                ("OLEAFLY_S3_ACCESS_KEY_ID", "AKIDEXAMPLE"),
                ("OLEAFLY_S3_SECRET_ACCESS_KEY_FILE", "/run/secrets/s3"),
            ],
            &read,
        )
        .unwrap();
        let s3 = s3_of(&config);
        assert_eq!(s3.bucket, "lab-bucket");
        assert_eq!(s3.prefix, "oleafly/files");
        assert_eq!(
            s3.endpoint.as_ref().map(Url::as_str),
            Some("https://minio.example.edu:9000/")
        );
        assert_eq!(s3.region, "eu-central-1");
        assert_eq!(s3.access_key_id, "AKIDEXAMPLE");
        assert_eq!(s3.secret_access_key, "secret-from-file");
        let plain = load(&[
            BASE,
            ("OLEAFLY_BLOB_STORE", "s3://lab.bucket"),
            S3_KEYS[0],
            S3_KEYS[1],
        ])
        .unwrap();
        let s3 = s3_of(&plain);
        assert_eq!(s3.bucket, "lab.bucket");
        assert_eq!(s3.prefix, "");
        assert_eq!(s3.endpoint, None);
        assert_eq!(s3.region, "us-east-1");
        let private = load(&[
            BASE,
            ("OLEAFLY_BLOB_STORE", "s3://lab-bucket"),
            ("OLEAFLY_S3_ENDPOINT", "http://minio:9000"),
            ("OLEAFLY_S3_REGION", "auto"),
            S3_KEYS[0],
            S3_KEYS[1],
        ])
        .unwrap();
        assert_eq!(
            s3_of(&private).endpoint.as_ref().map(Url::as_str),
            Some("http://minio:9000/")
        );
        assert_eq!(s3_of(&private).region, "auto");
    }

    #[test]
    fn an_s3_blob_store_without_keys_names_what_is_missing() {
        let neither = load_err(&[BASE, ("OLEAFLY_BLOB_STORE", "s3://lab-bucket")]);
        assert_eq!(neither.variable, "OLEAFLY_S3_ACCESS_KEY_ID");
        assert!(neither.message.contains("OLEAFLY_S3_SECRET_ACCESS_KEY"));
        assert!(neither.message.contains("_FILE"));
        let no_secret = load_err(&[BASE, ("OLEAFLY_BLOB_STORE", "s3://lab-bucket"), S3_KEYS[0]]);
        assert_eq!(no_secret.variable, "OLEAFLY_S3_SECRET_ACCESS_KEY");
        let no_id = load_err(&[BASE, ("OLEAFLY_BLOB_STORE", "s3://lab-bucket"), S3_KEYS[1]]);
        assert_eq!(no_id.variable, "OLEAFLY_S3_ACCESS_KEY_ID");
        let unreadable = load_err(&[
            BASE,
            ("OLEAFLY_BLOB_STORE", "s3://lab-bucket"),
            S3_KEYS[0],
            ("OLEAFLY_S3_SECRET_ACCESS_KEY_FILE", "/run/secrets/missing"),
        ]);
        assert_eq!(unreadable.variable, "OLEAFLY_S3_SECRET_ACCESS_KEY_FILE");
    }

    #[test]
    fn s3_settings_without_an_s3_blob_store_are_refused() {
        for (name, value) in [
            ("OLEAFLY_S3_ENDPOINT", "https://minio.example.edu"),
            ("OLEAFLY_S3_REGION", "eu-west-1"),
            ("OLEAFLY_S3_ACCESS_KEY_ID", "AKIDEXAMPLE"),
            ("OLEAFLY_S3_SECRET_ACCESS_KEY_FILE", "/run/secrets/s3"),
        ] {
            let error = load_err(&[BASE, (name, value)]);
            assert_eq!(error.variable, name);
            assert!(error.message.contains("OLEAFLY_BLOB_STORE"), "{name}");
            let with_fs = load_err(&[BASE, ("OLEAFLY_BLOB_STORE", "fs"), (name, value)]);
            assert_eq!(with_fs.variable, name);
        }
        assert_eq!(
            load(&[
                BASE,
                ("OLEAFLY_S3_ENDPOINT", ""),
                ("OLEAFLY_S3_REGION", " ")
            ])
            .unwrap()
            .blob_store,
            BlobStoreConfig::Filesystem
        );
    }

    #[test]
    fn odd_s3_addresses_endpoints_and_regions_are_refused() {
        for store in [
            "s3://",
            "s3:lab-bucket",
            "s3://ab",
            "s3://Lab-Bucket",
            "s3://lab_bucket",
            "s3://-lab-bucket",
            "s3://lab-bucket:9000",
            "s3://key:secret@lab-bucket",
            "s3://lab-bucket?region=x",
            "s3://lab-bucket#top",
            "s3://lab-bucket/a//b",
            "s3://lab-bucket/a%20b",
            "gs://lab-bucket",
        ] {
            let error = load_err(&[BASE, ("OLEAFLY_BLOB_STORE", store), S3_KEYS[0], S3_KEYS[1]]);
            assert_eq!(error.variable, "OLEAFLY_BLOB_STORE", "{store}");
        }
        for endpoint in [
            "minio.example.edu:9000",
            "ftp://minio.example.edu",
            "https://minio.example.edu/s3",
            "https://user:pw@minio.example.edu",
            "https://minio.example.edu/?x=1",
        ] {
            let error = load_err(&[
                BASE,
                ("OLEAFLY_BLOB_STORE", "s3://lab-bucket"),
                ("OLEAFLY_S3_ENDPOINT", endpoint),
                S3_KEYS[0],
                S3_KEYS[1],
            ]);
            assert_eq!(error.variable, "OLEAFLY_S3_ENDPOINT", "{endpoint}");
        }
        for region in ["us east 1", "eu/west", "région"] {
            let error = load_err(&[
                BASE,
                ("OLEAFLY_BLOB_STORE", "s3://lab-bucket"),
                ("OLEAFLY_S3_REGION", region),
                S3_KEYS[0],
                S3_KEYS[1],
            ]);
            assert_eq!(error.variable, "OLEAFLY_S3_REGION", "{region}");
        }
    }

    #[test]
    fn debug_output_hides_s3_keys() {
        let config = load(&[
            BASE,
            ("OLEAFLY_BLOB_STORE", "s3://lab-bucket/thesis-files"),
            ("OLEAFLY_S3_ACCESS_KEY_ID", "AKIDHIDDEN"),
            ("OLEAFLY_S3_SECRET_ACCESS_KEY", "s3-secret-value"),
        ])
        .unwrap();
        let text = format!("{config:?}");
        assert!(!text.contains("s3-secret-value"));
        assert!(!text.contains("AKIDHIDDEN"));
        assert!(text.contains("lab-bucket"));
        assert!(text.contains("thesis-files"));
        assert!(text.contains("us-east-1"));
    }

    #[test]
    fn account_quotas_apply_by_default_only_with_open_sign_up() {
        let closed = load(&[BASE]).unwrap();
        assert!(!closed.open_signup);
        assert_eq!(closed.quotas, AccountQuotas::default());
        assert_eq!(
            closed.sign_up_note(),
            "Open sign-up is off, so only people the allowlist, a domain rule or an invitation lets in get an account."
        );
        let open = load(&[BASE, ("OLEAFLY_OPEN_SIGNUP", "true")]).unwrap();
        assert!(open.open_signup);
        assert_eq!(
            open.quotas,
            AccountQuotas {
                storage_mb: Some(100),
                projects: Some(50),
                uploads_per_hour: Some(300),
            }
        );
        assert_eq!(
            open.sign_up_note(),
            "Open sign-up is on, so anyone who signs in gets an account as a member. Each account may store 100 MB, own 50 projects and make 300 uploads an hour."
        );
        let tuned = load(&[
            BASE,
            ("OLEAFLY_OPEN_SIGNUP", "TRUE"),
            ("OLEAFLY_ACCOUNT_STORAGE_MB", "2048"),
            ("OLEAFLY_UPLOADS_PER_HOUR", "500"),
        ])
        .unwrap();
        assert_eq!(
            tuned.quotas,
            AccountQuotas {
                storage_mb: Some(2048),
                projects: Some(50),
                uploads_per_hour: Some(500),
            }
        );
        let limited = load(&[BASE, ("OLEAFLY_MAX_PROJECTS_PER_ACCOUNT", "3")]).unwrap();
        assert_eq!(
            limited.quotas,
            AccountQuotas {
                projects: Some(3),
                ..AccountQuotas::default()
            }
        );
        assert!(limited
            .sign_up_note()
            .ends_with("Each account may own 3 projects."));
        assert!(limited.ignored_settings.is_empty());
    }

    #[test]
    fn browser_access_is_off_unless_asked_for_and_built_in() {
        let off = load(&[BASE]).unwrap();
        assert!(!off.web);
        assert!(!off.web_enabled());
        let on = load(&[BASE, ("OLEAFLY_WEB", "true")]).unwrap();
        assert!(on.web);
        assert_eq!(on.web_enabled(), cfg!(feature = "web"));
        let warned = on
            .startup_notes
            .iter()
            .any(|note| matches!(note, StartupNote::Warning(text) if text.contains("OLEAFLY_WEB")));
        assert_eq!(warned, !cfg!(feature = "web"));
        assert!(on.ignored_settings.is_empty());
        assert_eq!(
            load_err(&[BASE, ("OLEAFLY_WEB", "on")]).variable,
            "OLEAFLY_WEB"
        );
    }

    #[test]
    fn a_quota_or_the_sign_up_switch_that_does_not_parse_names_its_setting() {
        assert_eq!(
            load_err(&[BASE, ("OLEAFLY_OPEN_SIGNUP", "yes")]).variable,
            "OLEAFLY_OPEN_SIGNUP"
        );
        for name in [
            "OLEAFLY_ACCOUNT_STORAGE_MB",
            "OLEAFLY_MAX_PROJECTS_PER_ACCOUNT",
            "OLEAFLY_UPLOADS_PER_HOUR",
        ] {
            for value in ["0", "-1", "lots"] {
                let error = load_err(&[BASE, ("OLEAFLY_OPEN_SIGNUP", "true"), (name, value)]);
                assert_eq!(error.variable, name, "{name}={value}");
            }
        }
    }
}
