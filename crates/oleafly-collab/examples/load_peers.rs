#[path = "../tests/crowd/typist.rs"]
mod typist;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Display;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab::editor::DocMessage;
use oleafly_collab::live::{DocSink, LiveProject};
use oleafly_collab::materialize;
use oleafly_collab::ot::{Component, TextOperation};
use oleafly_collab::sync::{
    spawn_live, EndReason, LiveEvent, LiveHandle, LiveLink, LiveStatus, SharedLive,
};
use oleafly_collab::{
    sign_in, write_atomic, CollabError, DeviceKey, MemorySecrets, SecretPort, ServerClient,
    ServerUrl, SessionManager, SignInRequest,
};
use oleafly_collab_protocol::admin::{NewDomainRule, RuntimeSettingsPatch};
use oleafly_collab_protocol::auth::SessionTokens;
use oleafly_collab_protocol::capabilities::ProviderKind;
use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};
use oleafly_collab_protocol::projects::{
    project_role_allows, PresenceState, ProjectAction, ProjectPatch, ProjectRole,
};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::clock::SystemClock;
use oleafly_server::config::ServerConfig;
use oleafly_server::state::AppState;
use oleafly_server::test_support::{seed_person, serve_until, PersonSeed};
use reqwest::header::{HeaderMap, CONTENT_TYPE, COOKIE, LOCATION, ORIGIN, REFERER, SET_COOKIE};
use serde_json::{json, Value};
use tokio::sync::{mpsc, watch, Semaphore};
use url::Url;

use crate::typist::{unit_index, EditorDoc, Reaction, Rng, WORDS};

const USAGE: &str = "usage: load_peers --link LINK --mailpit URL --email-domain DOMAIN [--server URL] [--peers N] [--name-prefix TEXT] [--file PATH] [--rate EDITS_PER_SECOND] [--duration SECONDS] [--ramp SECONDS] [--churn PROBABILITY_PER_SECOND] [--settle SECONDS] [--report FILE] [--state-dir DIR] [--sign-in-concurrency N] [--sign-in-spacing SECONDS] [--sign-in-timeout SECONDS] [--sign-in-only] [--mail-timeout SECONDS] [--seed N] [--save-text DIR] [--local-stack SMTP_HOST:PORT [--local-data DIR]]";
const STATUS_EVERY: Duration = Duration::from_secs(5);
const SETTLE_POLL: Duration = Duration::from_millis(500);
const MAIL_POLL: Duration = Duration::from_millis(500);
const PRESENCE_EVERY: Duration = Duration::from_millis(500);
const STOP_WAIT: Duration = Duration::from_secs(10);
const ATTEMPT_SLACK: Duration = Duration::from_secs(120);
const RATE_LIMIT_RETRY: Duration = Duration::from_secs(60);
const TRANSIENT_RETRY: Duration = Duration::from_secs(5);
const TRANSIENT_ATTEMPTS: u32 = 3;
const THROTTLE_WAIT: Duration = Duration::from_secs(10);
const THROTTLE_RETRIES: u32 = 6;
const JOIN_ATTEMPTS: u32 = 5;
const MAX_HOPS: usize = 10;
const DELETE_PERCENT: usize = 10;
const BLOCK_PERCENT: usize = 10;
const APPEND_PERCENT: u64 = 15;
const ERROR_SAMPLES: usize = 8;
const CLIENT_LAG_WARNING: u64 = 100;
const VERIFY_PATH: &str = "/auth/email-link/verify?token=";
const BROWSER_AGENT: &str = concat!(
    "Mozilla/5.0 (compatible; oleafly-load-peers/",
    env!("CARGO_PKG_VERSION"),
    ")"
);
const LOCAL_MAIN: &str =
    "\\documentclass{article}\n\\begin{document}\nA project for the load test.\n\\end{document}\n";

#[derive(Clone, Debug)]
struct Options {
    server: Option<String>,
    mailpit: Option<String>,
    peers: usize,
    email_domain: Option<String>,
    name_prefix: String,
    link: Option<String>,
    file: String,
    rate: f64,
    duration: Duration,
    ramp: Duration,
    churn: f64,
    settle: Duration,
    report: Option<PathBuf>,
    state_dir: Option<PathBuf>,
    sign_in_concurrency: usize,
    sign_in_spacing: Duration,
    sign_in_timeout: Duration,
    sign_in_only: bool,
    mail_timeout: Duration,
    seed: u64,
    save_text: Option<PathBuf>,
    local_stack: Option<String>,
    local_data: Option<PathBuf>,
}

impl Options {
    fn defaults() -> Options {
        Options {
            server: None,
            mailpit: None,
            peers: 5,
            email_domain: None,
            name_prefix: "Load".to_owned(),
            link: None,
            file: "main.tex".to_owned(),
            rate: 2.0,
            duration: Duration::from_secs(60),
            ramp: Duration::ZERO,
            churn: 0.0,
            settle: Duration::from_secs(20),
            report: None,
            state_dir: None,
            sign_in_concurrency: 4,
            sign_in_spacing: Duration::from_secs(6),
            sign_in_timeout: Duration::from_secs(20 * 60),
            sign_in_only: false,
            mail_timeout: Duration::from_secs(120),
            seed: now_ms(),
            save_text: None,
            local_stack: None,
            local_data: None,
        }
    }

    fn domain(&self) -> String {
        self.email_domain
            .clone()
            .unwrap_or_else(|| "load.test".to_owned())
    }
}

fn number<T: std::str::FromStr>(flag: &str, value: &str) -> Result<T, String> {
    value
        .trim()
        .parse()
        .map_err(|_| format!("{flag} expects a number, not {value}"))
}

fn seconds(flag: &str, value: &str) -> Result<Duration, String> {
    let amount: f64 = number(flag, value)?;
    if !amount.is_finite() || amount < 0.0 {
        return Err(format!("{flag} expects a number of seconds, not {value}"));
    }
    Ok(Duration::from_secs_f64(amount))
}

fn parse_options(args: impl Iterator<Item = String>) -> Result<Options, String> {
    let mut options = Options::defaults();
    let mut args = args;
    while let Some(arg) = args.next() {
        let (flag, inline) = match arg.split_once('=') {
            Some((flag, value)) if flag.starts_with("--") => {
                (flag.to_owned(), Some(value.to_owned()))
            }
            _ => (arg.clone(), None),
        };
        if flag == "--help" || flag == "-h" {
            return Err(USAGE.to_owned());
        }
        if flag == "--sign-in-only" && inline.is_none() {
            options.sign_in_only = true;
            continue;
        }
        if !flag.starts_with("--") {
            return Err(format!("unexpected argument {arg}\n{USAGE}"));
        }
        let value = match inline {
            Some(value) => value,
            None => args.next().ok_or_else(|| format!("{flag} needs a value"))?,
        };
        apply_option(&mut options, &flag, value)?;
    }
    validate_options(&options)?;
    Ok(options)
}

fn apply_option(options: &mut Options, flag: &str, value: String) -> Result<(), String> {
    match flag {
        "--server" => options.server = Some(value),
        "--mailpit" => options.mailpit = Some(value),
        "--peers" => options.peers = number(flag, &value)?,
        "--email-domain" => {
            options.email_domain = Some(value.trim().trim_start_matches('@').to_lowercase());
        }
        "--name-prefix" => options.name_prefix = value.trim().to_owned(),
        "--link" => options.link = Some(value),
        "--file" => options.file = value.trim().trim_start_matches("./").to_owned(),
        "--rate" => options.rate = number(flag, &value)?,
        "--duration" => options.duration = seconds(flag, &value)?,
        "--ramp" => options.ramp = seconds(flag, &value)?,
        "--churn" => options.churn = number(flag, &value)?,
        "--settle" => options.settle = seconds(flag, &value)?,
        "--report" => options.report = Some(PathBuf::from(value)),
        "--state-dir" => options.state_dir = Some(PathBuf::from(value)),
        "--sign-in-concurrency" => options.sign_in_concurrency = number(flag, &value)?,
        "--sign-in-spacing" => options.sign_in_spacing = seconds(flag, &value)?,
        "--sign-in-timeout" => options.sign_in_timeout = seconds(flag, &value)?,
        "--mail-timeout" => options.mail_timeout = seconds(flag, &value)?,
        "--seed" => options.seed = number(flag, &value)?,
        "--save-text" => options.save_text = Some(PathBuf::from(value)),
        "--local-stack" => options.local_stack = Some(value.trim().to_owned()),
        "--local-data" => options.local_data = Some(PathBuf::from(value)),
        other => return Err(format!("unknown option {other}\n{USAGE}")),
    }
    Ok(())
}

fn validate_options(options: &Options) -> Result<(), String> {
    if options.peers == 0 || options.peers > 999 {
        return Err("--peers must be between 1 and 999".to_owned());
    }
    if !options.rate.is_finite() || options.rate <= 0.0 || options.rate > 50.0 {
        return Err("--rate must be more than 0 and at most 50 edits per second".to_owned());
    }
    if !options.churn.is_finite() || !(0.0..=1.0).contains(&options.churn) {
        return Err("--churn is a probability per second, between 0 and 1".to_owned());
    }
    if options.sign_in_concurrency == 0 {
        return Err("--sign-in-concurrency must be at least 1".to_owned());
    }
    if options.name_prefix.is_empty() {
        return Err("--name-prefix cannot be empty".to_owned());
    }
    if options.file.is_empty() {
        return Err("--file cannot be empty".to_owned());
    }
    if options.local_data.is_some() && options.local_stack.is_none() {
        return Err("--local-data only works with --local-stack".to_owned());
    }
    if options.local_stack.is_none() {
        let server_only = options.sign_in_only && options.server.is_some();
        if options.link.is_none() && !server_only {
            return Err(format!("--link is required\n{USAGE}"));
        }
        if options.email_domain.as_deref().is_none_or(str::is_empty) {
            return Err(format!("--email-domain is required\n{USAGE}"));
        }
    }
    Ok(())
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

fn ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

fn text(error: impl Display) -> String {
    error.to_string()
}

fn sha256(content: &str) -> String {
    ring::digest::digest(&ring::digest::SHA256, content.as_bytes())
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn fraction(rng: &mut Rng) -> f64 {
    (rng.next_u64() >> 11) as f64 / (1u64 << 53) as f64
}

fn platform() -> String {
    match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        _ => "linux",
    }
    .to_owned()
}

fn parse_link(link: &str) -> Result<(String, SharedProjectId), String> {
    let invalid = || format!("{link:?} is not a shared project link");
    let cleaned = link
        .trim()
        .trim_matches(|character: char| character == '"' || character == '\'')
        .trim();
    let url = Url::parse(cleaned).map_err(|_| invalid())?;
    if url.scheme() == "oleafly" {
        let pairs: HashMap<String, String> = url.query_pairs().into_owned().collect();
        let server = pairs.get("server").ok_or_else(invalid)?;
        let project = pairs
            .get("project")
            .and_then(|id| id.parse().ok())
            .ok_or_else(invalid)?;
        return Ok((server.trim_end_matches('/').to_owned(), project));
    }
    if !matches!(url.scheme(), "http" | "https") {
        return Err(invalid());
    }
    let mut page = url.clone();
    page.set_query(None);
    page.set_fragment(None);
    let page = page.as_str().trim_end_matches('/');
    let (server, id) = page.rsplit_once("/p/").ok_or_else(invalid)?;
    let project = id.parse().map_err(|_| invalid())?;
    Ok((server.to_owned(), project))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct Marker {
    author: u32,
    seq: u64,
    epoch: u64,
}

impl Marker {
    fn key(self) -> (u32, u64, u64) {
        (self.author, self.seq, self.epoch)
    }
}

fn digits<T: std::str::FromStr>(value: &str) -> Option<T> {
    let plain = !value.is_empty() && value.len() <= 20 && value.bytes().all(|b| b.is_ascii_digit());
    plain.then(|| value.parse().ok()).flatten()
}

fn parse_marker(rest: &str) -> Option<Marker> {
    let end = rest.char_indices().nth(64).map_or(rest.len(), |(at, _)| at);
    let window = &rest[..end];
    let (author, after) = window.split_once(':')?;
    let (seq, after) = after.split_once('@')?;
    let (epoch, _) = after.split_once('⟧')?;
    Some(Marker {
        author: digits(author)?,
        seq: digits(seq)?,
        epoch: digits(epoch)?,
    })
}

fn markers(content: &str) -> impl Iterator<Item = Marker> + '_ {
    content
        .match_indices("⟦p")
        .filter_map(move |(at, open)| parse_marker(&content[at + open.len()..]))
}

fn floor_boundary(content: &str, byte: usize) -> usize {
    let mut byte = byte.min(content.len());
    while !content.is_char_boundary(byte) {
        byte -= 1;
    }
    byte
}

fn body(content: &str) -> (usize, usize) {
    let start = content.find("\\begin{document}").map_or(0, |at| {
        content[at..]
            .find('\n')
            .map_or(content.len(), |newline| at + newline + 1)
    });
    let end = content
        .rfind("\\end{document}")
        .filter(|at| *at >= start)
        .map_or(content.len(), |at| {
            content[..at]
                .rfind('\n')
                .map_or(0, |newline| newline + 1)
                .max(start)
        });
    (start, end)
}

fn insertion_point(content: &str, append: bool, rng: &mut Rng) -> usize {
    let (start, end) = body(content);
    if append || start >= end {
        return end;
    }
    let pick = floor_boundary(content, start + rng.below(end - start + 1));
    content[start..pick]
        .rfind('\n')
        .map_or(start, |at| start + at + 1)
}

fn filler_line(label: &str, rng: &mut Rng) -> String {
    let count = 3 + rng.below(6);
    let words: Vec<&str> = (0..count).map(|_| *rng.pick(WORDS)).collect();
    format!("%{label}~ {}\n", words.join(" "))
}

fn find_file(doc: &ProjectDoc, wanted: &str) -> Result<(String, String), String> {
    let nodes = doc.nodes().map_err(text)?;
    let layout = materialize::layout(&nodes);
    let mut texts: Vec<String> = Vec::new();
    for (id, placed) in &layout {
        if placed.kind != NodeKind::Text {
            continue;
        }
        if placed.path == wanted {
            return Ok((id.clone(), placed.path.clone()));
        }
        texts.push(placed.path.clone());
    }
    texts.sort();
    texts.truncate(12);
    Err(format!(
        "the project has no text file {wanted}; it has {}",
        if texts.is_empty() {
            "no text files".to_owned()
        } else {
            texts.join(", ")
        }
    ))
}

fn percentiles(samples: &[u64]) -> Option<(usize, u64, u64, u64, u64)> {
    if samples.is_empty() {
        return None;
    }
    let mut sorted = samples.to_vec();
    sorted.sort_unstable();
    let last = sorted.len() - 1;
    let at = |fraction: f64| sorted[((last as f64) * fraction).round() as usize];
    Some((sorted.len(), at(0.50), at(0.95), at(0.99), sorted[last]))
}

fn summary(samples: &[u64]) -> Value {
    match percentiles(samples) {
        Some((count, p50, p95, p99, max)) => {
            json!({ "count": count, "p50": p50, "p95": p95, "p99": p99, "max": max })
        }
        None => json!({ "count": 0 }),
    }
}

fn describe(samples: &[u64]) -> String {
    match percentiles(samples) {
        Some((count, p50, p95, p99, max)) => {
            format!("p50 {p50} ms, p95 {p95} ms, p99 {p99} ms, max {max} ms (n={count})")
        }
        None => "no samples".to_owned(),
    }
}

#[derive(Debug, Clone)]
struct Failure {
    kind: String,
    message: String,
}

impl Failure {
    fn new(kind: impl Into<String>, message: impl Into<String>) -> Failure {
        Failure {
            kind: kind.into(),
            message: message.into(),
        }
    }

    fn of(error: &CollabError) -> Failure {
        Failure::new(collab_kind(error), error.to_string())
    }

    fn rate_limited(&self) -> bool {
        self.kind == "rate_limited" || self.kind.starts_with("429")
    }

    fn transient(&self) -> bool {
        self.kind == "network"
            || self.kind == "server_error"
            || self.kind == "timeout"
            || self.kind.starts_with('5')
    }
}

fn collab_kind(error: &CollabError) -> String {
    match error {
        CollabError::Api { status, code, .. } => format!("{status}:{code}"),
        CollabError::Network(_) => "network".to_owned(),
        CollabError::Unauthorized => "unauthorized".to_owned(),
        CollabError::SessionEnded(reason) => format!("session_ended:{}", reason.as_str()),
        CollabError::NotAdmitted => "not_admitted".to_owned(),
        CollabError::SignInTimedOut => "timeout".to_owned(),
        CollabError::SignInCancelled => "cancelled".to_owned(),
        CollabError::Io(_) => "io".to_owned(),
        CollabError::Corrupt(_) => "corrupt".to_owned(),
        CollabError::Secret(_) => "secret".to_owned(),
        CollabError::Crypto(_) => "crypto".to_owned(),
        CollabError::InvalidPath(_) => "invalid_path".to_owned(),
        CollabError::NotHttps => "not_https".to_owned(),
        CollabError::ProtocolMismatch(_) => "protocol_mismatch".to_owned(),
        CollabError::ServerChanged { .. } => "server_changed".to_owned(),
        CollabError::DuplicateServer { .. } => "duplicate_server".to_owned(),
    }
}

fn network(error: reqwest::Error) -> Failure {
    Failure::new("network", error.to_string())
}

struct FileSecrets {
    path: PathBuf,
    values: Mutex<BTreeMap<String, String>>,
}

impl FileSecrets {
    fn open(path: PathBuf) -> Result<FileSecrets, String> {
        let values = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|error| format!("{} is not a peer state file: {error}", path.display()))?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(error) => return Err(format!("could not read {}: {error}", path.display())),
        };
        Ok(FileSecrets {
            path,
            values: Mutex::new(values),
        })
    }

    fn save(&self, values: &BTreeMap<String, String>) -> Result<(), CollabError> {
        let bytes = serde_json::to_vec_pretty(values)
            .map_err(|error| CollabError::Secret(error.to_string()))?;
        write_atomic(&self.path, &bytes)
    }
}

impl SecretPort for FileSecrets {
    fn get(&self, account: &str) -> Result<Option<String>, CollabError> {
        Ok(lock(&self.values).get(account).cloned())
    }

    fn set(&self, account: &str, value: &str) -> Result<(), CollabError> {
        if value.is_empty() {
            return Err(CollabError::Secret(format!(
                "refusing to store an empty value for {account}"
            )));
        }
        let mut values = lock(&self.values);
        values.insert(account.to_owned(), value.to_owned());
        self.save(&values)
    }

    fn remove(&self, account: &str) -> Result<(), CollabError> {
        let mut values = lock(&self.values);
        if values.remove(account).is_some() {
            self.save(&values)?;
        }
        Ok(())
    }
}

fn private_folder(path: &Path) -> Result<(), String> {
    std::fs::create_dir_all(path)
        .map_err(|error| format!("could not create {}: {error}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("could not protect {}: {error}", path.display()))?;
    }
    Ok(())
}

#[derive(Default)]
struct Stats {
    state: String,
    signed_in: String,
    sign_in_ms: Option<u64>,
    sign_in_wait_ms: Option<u64>,
    join_ms: Option<u64>,
    sent: u64,
    markers_made: u64,
    blocks: u64,
    deletes: u64,
    acked: u64,
    lost: u64,
    observed: u64,
    missed: u64,
    latency: Vec<u64>,
    delayed: Vec<u64>,
    ack_latency: Vec<u64>,
    reconnects: u64,
    reconnect_ms: Vec<u64>,
    outage_ms: Vec<u64>,
    client_lag: Vec<u64>,
    offline_events: u64,
    errors: BTreeMap<String, u64>,
    error_samples: Vec<String>,
    final_sha256: Option<String>,
    final_chars: Option<usize>,
    final_bytes: Option<usize>,
    final_run_markers: Option<u64>,
    editor_matches: Option<bool>,
}

struct Peer {
    index: u32,
    label: String,
    email: String,
    name: String,
    key: Arc<DeviceKey>,
    sessions: Arc<SessionManager>,
    stats: Mutex<Stats>,
    live: Mutex<Option<(SharedLive, String)>>,
    online: AtomicBool,
    synced: AtomicBool,
    failed: AtomicBool,
    ended: AtomicBool,
}

impl Peer {
    fn stats(&self) -> MutexGuard<'_, Stats> {
        lock(&self.stats)
    }

    fn error(&self, kind: &str, detail: impl Display) {
        let mut stats = self.stats();
        *stats.errors.entry(kind.to_owned()).or_default() += 1;
        if stats.error_samples.len() < ERROR_SAMPLES {
            stats.error_samples.push(format!("{kind}: {detail}"));
        }
    }

    fn set_state(&self, state: &str) {
        self.stats().state = state.to_owned();
    }

    fn fail(&self, kind: &str, failure: &Failure) {
        self.error(kind, &failure.message);
        {
            let mut stats = self.stats();
            if stats.signed_in == "no" {
                stats.signed_in = "failed".to_owned();
            }
        }
        self.failed.store(true, Ordering::SeqCst);
        self.set_state("failed");
        eprintln!(
            "{} gave up: {} ({})",
            self.label, failure.message, failure.kind
        );
    }
}

fn make_peers(options: &Options) -> Result<Vec<Arc<Peer>>, String> {
    let width = options.peers.to_string().len().max(2);
    let domain = options.domain();
    if let Some(dir) = &options.state_dir {
        private_folder(dir)?;
    }
    let mut peers = Vec::new();
    for number in 1..=options.peers {
        let label = format!("p{number:0width$}");
        let email = format!("peer{number:0width$}@{domain}");
        let name = format!("{} {number:0width$}", options.name_prefix);
        let secrets: Arc<dyn SecretPort> = match &options.state_dir {
            Some(dir) => Arc::new(FileSecrets::open(dir.join(format!("{email}.json")))?),
            None => Arc::new(MemorySecrets::new()),
        };
        let key = Arc::new(
            DeviceKey::load_or_create(secrets.as_ref())
                .map_err(|error| format!("{label} has no device key: {error}"))?,
        );
        let sessions = Arc::new(SessionManager::new(secrets, Arc::clone(&key)));
        peers.push(Arc::new(Peer {
            index: u32::try_from(number).unwrap_or(u32::MAX),
            label,
            email,
            name,
            key,
            sessions,
            stats: Mutex::new(Stats {
                state: "waiting".to_owned(),
                signed_in: "no".to_owned(),
                ..Stats::default()
            }),
            live: Mutex::new(None),
            online: AtomicBool::new(false),
            synced: AtomicBool::new(false),
            failed: AtomicBool::new(false),
            ended: AtomicBool::new(false),
        }));
    }
    Ok(peers)
}

struct HtmlForm {
    action: String,
    fields: Vec<(String, String)>,
}

fn unescape(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn attribute(tag: &str, name: &str) -> Option<String> {
    let needle = format!(" {name}=\"");
    let start = tag.find(&needle)? + needle.len();
    let end = tag[start..].find('"')? + start;
    Some(unescape(&tag[start..end]))
}

fn forms(html: &str) -> Vec<HtmlForm> {
    let mut found = Vec::new();
    let mut rest = html;
    while let Some(start) = rest.find("<form") {
        let after = &rest[start..];
        let Some(tag_end) = after.find('>') else {
            break;
        };
        let tag = &after[..tag_end];
        let close = after.find("</form>").unwrap_or(after.len()).max(tag_end);
        let inner = &after[tag_end..close];
        let fields = inner
            .match_indices("<input")
            .filter_map(|(at, _)| {
                let input = &inner[at..];
                let input = &input[..input.find('>').unwrap_or(input.len())];
                Some((
                    attribute(input, "name")?,
                    attribute(input, "value").unwrap_or_default(),
                ))
            })
            .collect();
        found.push(HtmlForm {
            action: attribute(tag, "action").unwrap_or_default(),
            fields,
        });
        rest = &after[close.max(1)..];
    }
    found
}

fn form_with(html: &str, field: &str) -> Option<HtmlForm> {
    forms(html)
        .into_iter()
        .find(|form| form.fields.iter().any(|(name, _)| name == field))
}

fn strip_tags(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for character in html.chars() {
        match character {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(character),
            _ => {}
        }
    }
    unescape(out.trim())
}

fn inner_text(html: &str, close: &str) -> Option<String> {
    let open_end = html.find('>')? + 1;
    let end = html[open_end..].find(close)? + open_end;
    Some(strip_tags(&html[open_end..end]))
}

fn page_text(html: &str) -> String {
    let heading_at = html.find("<h1");
    let from = heading_at.unwrap_or(0);
    let heading = heading_at.and_then(|at| inner_text(&html[at..], "</h1>"));
    let paragraph = html[from..]
        .match_indices("<p")
        .find(|(at, _)| matches!(html[from + at + 2..].chars().next(), Some('>' | ' ')))
        .and_then(|(at, _)| inner_text(&html[from + at..], "</p>"));
    let parts: Vec<String> = [heading, paragraph]
        .into_iter()
        .flatten()
        .filter(|part| !part.is_empty())
        .collect();
    if parts.is_empty() {
        html.chars().take(200).collect::<String>().trim().to_owned()
    } else {
        parts.join(": ")
    }
}

fn sign_in_link(content: &str) -> Option<String> {
    let at = content.find(VERIFY_PATH)?;
    let start = content[..at].rfind("http")?;
    let end = content[at..]
        .find(|character: char| {
            character.is_whitespace() || matches!(character, '"' | '\'' | '<' | '>' | ')' | ']')
        })
        .map_or(content.len(), |offset| at + offset);
    Some(content[start..end].replace("&amp;", "&"))
}

fn is_loopback_callback(url: &Url) -> bool {
    let local = match url.host() {
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        Some(url::Host::Domain(name)) => name == "localhost",
        None => false,
    };
    url.scheme() == "http" && local && url.path() == "/callback"
}

fn page_failure(page: &Page) -> Failure {
    let kind = match page.status {
        429 => "rate_limited".to_owned(),
        403 => "page_expired".to_owned(),
        400 => "refused".to_owned(),
        500..=599 => "server_error".to_owned(),
        other => format!("http_{other}"),
    };
    Failure::new(
        kind,
        format!(
            "{} answered HTTP {}: {}",
            page.url.path(),
            page.status,
            page_text(&page.body)
        ),
    )
}

#[derive(Default)]
struct Jar {
    cookies: BTreeMap<String, String>,
}

impl Jar {
    fn absorb(&mut self, headers: &HeaderMap) {
        for value in headers.get_all(SET_COOKIE) {
            let Ok(raw) = value.to_str() else {
                continue;
            };
            let first = raw.split(';').next().unwrap_or_default();
            let Some((name, value)) = first.split_once('=') else {
                continue;
            };
            let name = name.trim().to_owned();
            let value = value.trim();
            if value.is_empty() || raw.to_ascii_lowercase().contains("max-age=0") {
                self.cookies.remove(&name);
            } else {
                self.cookies.insert(name, value.to_owned());
            }
        }
    }

    fn header(&self) -> Option<String> {
        (!self.cookies.is_empty()).then(|| {
            self.cookies
                .iter()
                .map(|(name, value)| format!("{name}={value}"))
                .collect::<Vec<_>>()
                .join("; ")
        })
    }
}

struct Page {
    url: Url,
    status: u16,
    body: String,
}

impl Page {
    fn form(&self, field: &str, what: &str) -> Result<HtmlForm, Failure> {
        if self.status != 200 {
            return Err(page_failure(self));
        }
        form_with(&self.body, field).ok_or_else(|| {
            Failure::new(
                "unexpected_page",
                format!(
                    "{what} at {} has no form with a {field} field: {}",
                    self.url.path(),
                    page_text(&self.body)
                ),
            )
        })
    }
}

enum Visit {
    Page(Page),
    Done,
}

#[derive(Clone)]
struct Mailpit {
    http: reqwest::Client,
    base: Url,
    user: Option<(String, Option<String>)>,
}

impl Mailpit {
    fn new(raw: &str) -> Result<Mailpit, String> {
        let mut base = Url::parse(raw.trim())
            .map_err(|error| format!("--mailpit {raw} is not a URL: {error}"))?;
        if !matches!(base.scheme(), "http" | "https") {
            return Err(format!("--mailpit {raw} must be an http or https address"));
        }
        let user = (!base.username().is_empty()).then(|| {
            (
                base.username().to_owned(),
                base.password().map(str::to_owned),
            )
        });
        let _ = base.set_username("");
        let _ = base.set_password(None);
        base.set_query(None);
        if !base.path().ends_with('/') {
            let path = format!("{}/", base.path());
            base.set_path(&path);
        }
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(text)?;
        Ok(Mailpit { http, base, user })
    }

    fn endpoint(&self, path: &str) -> Result<Url, Failure> {
        self.base
            .join(path)
            .map_err(|error| Failure::new("mail_api", error.to_string()))
    }

    async fn fetch(&self, url: Url) -> Result<Value, Failure> {
        let mut request = self.http.get(url);
        if let Some((user, password)) = &self.user {
            request = request.basic_auth(user, password.as_deref());
        }
        let response = request.send().await.map_err(|error| {
            Failure::new("mail_api", format!("Mailpit did not answer: {error}"))
        })?;
        let status = response.status();
        if !status.is_success() {
            return Err(Failure::new(
                "mail_api",
                format!("Mailpit answered {status}"),
            ));
        }
        response.json().await.map_err(|error| {
            Failure::new(
                "mail_api",
                format!("Mailpit sent something that is not JSON: {error}"),
            )
        })
    }

    async fn ids(&self, address: &str) -> Result<HashSet<String>, Failure> {
        let mut url = self.endpoint("api/v1/search")?;
        url.query_pairs_mut()
            .append_pair("query", &format!("to:\"{address}\""))
            .append_pair("limit", "50");
        let found = self.fetch(url).await?;
        Ok(found["messages"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|message| addressed_to(message, address))
            .filter_map(|message| message["ID"].as_str().map(str::to_owned))
            .collect())
    }

    async fn link_in(&self, id: &str) -> Result<Option<String>, Failure> {
        let message = self
            .fetch(self.endpoint(&format!("api/v1/message/{id}"))?)
            .await?;
        Ok(["Text", "HTML"]
            .iter()
            .find_map(|part| message[*part].as_str().and_then(sign_in_link)))
    }

    async fn wait_for_link(
        &self,
        address: &str,
        before: &HashSet<String>,
        timeout: Duration,
    ) -> Result<String, Failure> {
        let deadline = Instant::now() + timeout;
        let mut checked: HashSet<String> = HashSet::new();
        let mut trouble: Option<Failure> = None;
        loop {
            match self.ids(address).await {
                Ok(ids) => {
                    for id in ids {
                        if before.contains(&id) || !checked.insert(id.clone()) {
                            continue;
                        }
                        match self.link_in(&id).await {
                            Ok(Some(link)) => return Ok(link),
                            Ok(None) => {}
                            Err(failure) => {
                                checked.remove(&id);
                                trouble = Some(failure);
                            }
                        }
                    }
                }
                Err(failure) => trouble = Some(failure),
            }
            if Instant::now() >= deadline {
                return Err(trouble.unwrap_or_else(|| {
                    Failure::new(
                        "mail_timeout",
                        format!(
                            "no sign-in email for {address} reached Mailpit within {} s",
                            timeout.as_secs()
                        ),
                    )
                }));
            }
            tokio::time::sleep(MAIL_POLL).await;
        }
    }
}

fn addressed_to(message: &Value, address: &str) -> bool {
    message["To"].as_array().is_some_and(|recipients| {
        recipients.iter().any(|recipient| {
            recipient["Address"]
                .as_str()
                .is_some_and(|found| found.eq_ignore_ascii_case(address))
        })
    })
}

#[derive(Clone)]
struct Browser {
    http: reqwest::Client,
    loopback: reqwest::Client,
    mailpit: Mailpit,
    email: String,
    mail_timeout: Duration,
}

impl Browser {
    async fn visit(
        &self,
        url: Url,
        form: Option<(Vec<(String, String)>, Url)>,
        jar: &mut Jar,
    ) -> Result<Visit, Failure> {
        let mut url = url;
        let mut form = form;
        for _ in 0..MAX_HOPS {
            if is_loopback_callback(&url) {
                self.loopback.get(url).send().await.map_err(|error| {
                    Failure::new(
                        "loopback",
                        format!("the sign-in callback did not answer: {error}"),
                    )
                })?;
                return Ok(Visit::Done);
            }
            let response = self.send(&url, form.as_ref(), jar).await?;
            form = None;
            jar.absorb(response.headers());
            let status = response.status();
            if status.is_redirection() {
                let location = response
                    .headers()
                    .get(LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .ok_or_else(|| {
                        Failure::new(
                            "unexpected_page",
                            format!("{} redirected without a location", url.path()),
                        )
                    })?
                    .to_owned();
                url = url.join(&location).map_err(|error| {
                    Failure::new(
                        "unexpected_page",
                        format!("the redirect to {location} does not resolve: {error}"),
                    )
                })?;
                continue;
            }
            let body = response.text().await.map_err(network)?;
            return Ok(Visit::Page(Page {
                url,
                status: status.as_u16(),
                body,
            }));
        }
        Err(Failure::new(
            "redirect_loop",
            format!("more than {MAX_HOPS} redirects"),
        ))
    }

    async fn send(
        &self,
        url: &Url,
        form: Option<&(Vec<(String, String)>, Url)>,
        jar: &Jar,
    ) -> Result<reqwest::Response, Failure> {
        let mut throttled = 0;
        loop {
            let mut request = match form {
                Some((fields, referer)) => self
                    .http
                    .post(url.clone())
                    .form(fields)
                    .header(ORIGIN, referer.origin().ascii_serialization())
                    .header(REFERER, referer.as_str()),
                None => self.http.get(url.clone()),
            };
            if let Some(cookies) = jar.header() {
                request = request.header(COOKIE, cookies);
            }
            let response = request.send().await.map_err(network)?;
            let limited = response.status().as_u16() == 429
                && response
                    .headers()
                    .get(CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .is_some_and(|value| value.starts_with("application/json"));
            if !limited || throttled == THROTTLE_RETRIES {
                return Ok(response);
            }
            throttled += 1;
            eprintln!(
                "{}: the server is throttling sign-in requests from this address; waiting {} s",
                self.email,
                THROTTLE_WAIT.as_secs()
            );
            tokio::time::sleep(THROTTLE_WAIT).await;
        }
    }

    async fn submit(
        &self,
        page: &Page,
        form: &HtmlForm,
        fields: Vec<(String, String)>,
        jar: &mut Jar,
    ) -> Result<Visit, Failure> {
        let action = page.url.join(&form.action).map_err(|error| {
            Failure::new(
                "unexpected_page",
                format!("the form action {} does not resolve: {error}", form.action),
            )
        })?;
        self.visit(action, Some((fields, page.url.clone())), jar)
            .await
    }

    async fn run(self, start: String) -> Result<(), Failure> {
        let mut jar = Jar::default();
        let start =
            Url::parse(&start).map_err(|error| Failure::new("unexpected_page", text(error)))?;
        let Visit::Page(page) = self.visit(start, None, &mut jar).await? else {
            return Ok(());
        };
        let form = page.form("email", "the sign-in page")?;
        let before = self.mailpit.ids(&self.email).await?;
        let fields = form
            .fields
            .iter()
            .map(|(name, value)| {
                let value = if name == "email" {
                    self.email.clone()
                } else {
                    value.clone()
                };
                (name.clone(), value)
            })
            .collect();
        let Visit::Page(sent) = self.submit(&page, &form, fields, &mut jar).await? else {
            return Ok(());
        };
        if sent.status != 200 {
            return Err(page_failure(&sent));
        }
        let link = self
            .mailpit
            .wait_for_link(&self.email, &before, self.mail_timeout)
            .await?;
        let link = Url::parse(&link).map_err(|error| {
            Failure::new(
                "unexpected_mail",
                format!("the sign-in link {link} is not a URL: {error}"),
            )
        })?;
        let Visit::Page(confirm) = self.visit(link, None, &mut jar).await? else {
            return Ok(());
        };
        let form = confirm.form("token", "the sign-in link page")?;
        let fields = form.fields.clone();
        match self.submit(&confirm, &form, fields, &mut jar).await? {
            Visit::Done => Ok(()),
            Visit::Page(page) => Err(page_failure(&page)),
        }
    }
}

struct SignInContext {
    url: ServerUrl,
    server_id: ServerId,
    provider: Option<String>,
    mailpit: Option<Mailpit>,
    browser: reqwest::Client,
    loopback: reqwest::Client,
    sign_in_timeout: Duration,
    mail_timeout: Duration,
    platform: String,
    spacing: Duration,
    next_start: tokio::sync::Mutex<tokio::time::Instant>,
}

impl SignInContext {
    async fn pace(&self) {
        let mut next = self.next_start.lock().await;
        tokio::time::sleep_until(*next).await;
        *next = tokio::time::Instant::now() + self.spacing;
    }
}

async fn email_sign_in(peer: &Peer, context: &SignInContext) -> Result<SessionTokens, Failure> {
    let provider = context.provider.clone().ok_or_else(|| {
        Failure::new(
            "no_email_provider",
            "the server does not offer email sign-in; it needs mail settings and the email sign-in switch in the admin console",
        )
    })?;
    let mailpit = context.mailpit.clone().ok_or_else(|| {
        Failure::new(
            "no_mailpit",
            "this peer has no saved session, so it needs --mailpit to read its sign-in email",
        )
    })?;
    let browser = Browser {
        http: context.browser.clone(),
        loopback: context.loopback.clone(),
        mailpit,
        email: peer.email.clone(),
        mail_timeout: context.mail_timeout,
    };
    let (outcome, mut outcomes) = mpsc::unbounded_channel::<Result<(), Failure>>();
    let open = move |url: &str| -> Result<(), CollabError> {
        let browser = browser.clone();
        let outcome = outcome.clone();
        let url = url.to_owned();
        tokio::spawn(async move {
            let _ = outcome.send(browser.run(url).await);
        });
        Ok(())
    };
    let request = SignInRequest {
        url: context.url.clone(),
        provider_id: provider,
        device_name: peer.name.clone(),
        platform: context.platform.clone(),
        setup_code: None,
    };
    let signing = sign_in(request, &peer.key, &open, context.mail_timeout);
    tokio::pin!(signing);
    let raced = tokio::time::timeout(context.mail_timeout + ATTEMPT_SLACK, async {
        tokio::select! {
            result = &mut signing => result.map_err(|error| Failure::of(&error)),
            Some(Err(failure)) = outcomes.recv() => Err(failure),
        }
    })
    .await;
    let (manifest, tokens) = match raced {
        Ok(result) => result?,
        Err(_) => {
            return Err(Failure::new(
                "timeout",
                "the sign-in did not finish in time",
            ))
        }
    };
    if manifest.server_id != context.server_id {
        return Err(Failure::new(
            "server_changed",
            "the server answered with a different server id during sign-in",
        ));
    }
    Ok(tokens)
}

async fn reuse_session(peer: &Peer, context: &SignInContext) -> Result<(), Failure> {
    let client = ServerClient::new(context.url.clone()).map_err(|error| Failure::of(&error))?;
    let access = peer
        .sessions
        .access_token(context.server_id, &client)
        .await
        .map_err(|error| Failure::of(&error))?;
    let me = client
        .me(&access)
        .await
        .map_err(|error| Failure::of(&error))?;
    if me
        .emails
        .iter()
        .any(|email| email.eq_ignore_ascii_case(&peer.email))
    {
        Ok(())
    } else {
        Err(Failure::new(
            "other_account",
            format!(
                "the saved session belongs to {}, not {}",
                me.emails.join(", "),
                peer.email
            ),
        ))
    }
}

async fn ensure_session(peer: Arc<Peer>, context: Arc<SignInContext>, gate: Arc<Semaphore>) {
    peer.set_state("signing in");
    if matches!(peer.sessions.tokens(context.server_id), Ok(Some(_))) {
        for attempt in 1..=TRANSIENT_ATTEMPTS {
            let checked = Instant::now();
            match reuse_session(&peer, &context).await {
                Ok(()) => {
                    let mut stats = peer.stats();
                    stats.signed_in = "reused".to_owned();
                    stats.sign_in_ms = Some(ms(checked.elapsed()));
                    stats.state = "signed in".to_owned();
                    drop(stats);
                    println!("{} reused its saved session", peer.label);
                    return;
                }
                Err(failure) if failure.transient() || failure.rate_limited() => {
                    let kind = format!("sign_in:reuse:{}", failure.kind);
                    if attempt == TRANSIENT_ATTEMPTS {
                        peer.fail(&kind, &failure);
                        return;
                    }
                    peer.error(&kind, &failure.message);
                    tokio::time::sleep(TRANSIENT_RETRY).await;
                }
                Err(failure) => {
                    peer.error(&format!("sign_in:reuse:{}", failure.kind), &failure.message);
                    let _ = peer.sessions.clear(context.server_id);
                    println!(
                        "{}: the saved session no longer works ({}), so it signs in again",
                        peer.label, failure.message
                    );
                    break;
                }
            }
        }
    }
    let Ok(_permit) = gate.acquire_owned().await else {
        peer.fail(
            "sign_in:gate",
            &Failure::new("gate", "the sign-in queue closed"),
        );
        return;
    };
    let started = Instant::now();
    let mut transient = 0u32;
    loop {
        context.pace().await;
        let attempt = Instant::now();
        match email_sign_in(&peer, &context).await {
            Ok(tokens) => {
                if let Err(error) = peer.sessions.store(context.server_id, &tokens) {
                    peer.fail("sign_in:store", &Failure::of(&error));
                    return;
                }
                let mut stats = peer.stats();
                stats.signed_in = "fresh".to_owned();
                stats.sign_in_ms = Some(ms(attempt.elapsed()));
                stats.sign_in_wait_ms = Some(ms(started.elapsed()));
                stats.state = "signed in".to_owned();
                drop(stats);
                println!(
                    "{} signed in as {} in {:.1} s",
                    peer.label,
                    peer.email,
                    attempt.elapsed().as_secs_f64()
                );
                return;
            }
            Err(failure) => {
                let kind = format!("sign_in:{}", failure.kind);
                let wait = if failure.rate_limited() {
                    Some(RATE_LIMIT_RETRY)
                } else if failure.transient() && transient < TRANSIENT_ATTEMPTS {
                    transient += 1;
                    Some(TRANSIENT_RETRY)
                } else {
                    None
                };
                match wait {
                    Some(wait) if started.elapsed() + wait < context.sign_in_timeout => {
                        peer.error(&kind, &failure.message);
                        eprintln!(
                            "{}: {}; trying again in {} s",
                            peer.label,
                            failure.message,
                            wait.as_secs()
                        );
                        tokio::time::sleep(wait).await;
                    }
                    _ => {
                        peer.fail(&kind, &failure);
                        return;
                    }
                }
            }
        }
    }
}

async fn sign_in_all(peers: &[Arc<Peer>], context: Arc<SignInContext>, concurrency: usize) {
    let gate = Arc::new(Semaphore::new(concurrency));
    let tasks: Vec<_> = peers
        .iter()
        .map(|peer| {
            tokio::spawn(ensure_session(
                Arc::clone(peer),
                Arc::clone(&context),
                Arc::clone(&gate),
            ))
        })
        .collect();
    for task in tasks {
        let _ = task.await;
    }
}

struct Run {
    options: Options,
    url: ServerUrl,
    server_id: ServerId,
    project: SharedProjectId,
    started_ms: u64,
    offline_markers: Mutex<HashSet<(u32, u64)>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Run,
    Settle,
    Done,
}

struct Observer {
    peer: Arc<Peer>,
    run: Arc<Run>,
    seen: HashSet<(u32, u64, u64)>,
    online_since: Option<u64>,
}

impl Observer {
    fn remember(&mut self, content: &str) {
        for marker in markers(content) {
            self.seen.insert(marker.key());
        }
    }

    fn see(&mut self, content: &str) {
        let now = now_ms();
        let mut fresh: Vec<Marker> = Vec::new();
        for marker in markers(content) {
            if marker.author == self.peer.index || marker.epoch < self.run.started_ms {
                continue;
            }
            if self.seen.insert(marker.key()) {
                fresh.push(marker);
            }
        }
        if fresh.is_empty() {
            return;
        }
        let mut clean = Vec::new();
        let mut delayed = Vec::new();
        {
            let offline = lock(&self.run.offline_markers);
            for marker in &fresh {
                let latency = now.saturating_sub(marker.epoch);
                let authored_online = !offline.contains(&(marker.author, marker.seq));
                let watched = self.online_since.is_some_and(|since| marker.epoch >= since);
                if authored_online && watched {
                    clean.push(latency);
                } else {
                    delayed.push(latency);
                }
            }
        }
        let mut stats = self.peer.stats();
        stats.observed += fresh.len() as u64;
        stats.latency.extend(clean);
        stats.delayed.extend(delayed);
    }
}

fn sink_for(sender: &mpsc::UnboundedSender<(u64, DocMessage)>, generation: u64) -> DocSink {
    let sender = sender.clone();
    Arc::new(move |message| {
        let _ = sender.send((generation, message));
    })
}

#[derive(Clone, Copy)]
struct LocalEdit {
    at: Instant,
    online: bool,
    marker: Option<u64>,
}

struct Session {
    peer: Arc<Peer>,
    run: Arc<Run>,
    link: LiveLink,
    live: SharedLive,
    file_id: String,
    path: String,
    events: mpsc::UnboundedSender<LiveEvent>,
    sender: mpsc::UnboundedSender<(u64, DocMessage)>,
    handle: Option<LiveHandle>,
    editor: EditorDoc,
    observer: Observer,
    rng: Rng,
    seq: u64,
    pending_local: Vec<LocalEdit>,
    own: Vec<(i32, LocalEdit)>,
    acked: usize,
    online: bool,
    ended: bool,
    can_edit: bool,
    joined_at: Option<Instant>,
    down_since: Option<Instant>,
    reconnecting_since: Option<Instant>,
    reconnect_at: Option<tokio::time::Instant>,
    last_presence: Option<Instant>,
}

type Joined = (
    Session,
    mpsc::UnboundedReceiver<(u64, DocMessage)>,
    mpsc::UnboundedReceiver<LiveEvent>,
);

impl Session {
    async fn join(peer: &Arc<Peer>, run: &Arc<Run>, started: Instant) -> Result<Joined, Failure> {
        let of = |error: CollabError| Failure::of(&error);
        let client = Arc::new(ServerClient::new(run.url.clone()).map_err(of)?);
        let tokens = peer
            .sessions
            .tokens(run.server_id)
            .map_err(of)?
            .ok_or_else(|| Failure::new("no_session", "the peer is not signed in"))?;
        let access = peer
            .sessions
            .access_token(run.server_id, &client)
            .await
            .map_err(of)?;
        let summary = match client.project(&access, run.project).await {
            Err(CollabError::Api { status: 404, .. }) => {
                client
                    .join_project(&access, run.project)
                    .await
                    .map_err(|error| {
                        let mut failure = Failure::of(&error);
                        failure.message = format!(
                            "the project is not visible and joining through the link was refused ({}); turn on link sharing or add the peers as members",
                            failure.message
                        );
                        failure
                    })?
            }
            other => other.map_err(of)?,
        };
        let (seq, snapshot) = client
            .get_snapshot(&access, run.project)
            .await
            .map_err(of)?;
        let doc = ProjectDoc::load(&snapshot).map_err(of)?;
        let (file_id, path) = find_file(&doc, &run.options.file)
            .map_err(|message| Failure::new("file_missing", message))?;
        let live: SharedLive = Arc::new(Mutex::new(LiveProject::new(doc, seq, summary.role)));
        let (events, events_rx) = mpsc::unbounded_channel();
        let (sender, messages_rx) = mpsc::unbounded_channel();
        let generation = 1;
        let (rev, content) = lock(&live)
            .open_file(&file_id, sink_for(&sender, generation))
            .map_err(of)?;
        let editor = EditorDoc::opened(&file_id, generation, rev, content);
        let mut observer = Observer {
            peer: Arc::clone(peer),
            run: Arc::clone(run),
            seen: HashSet::new(),
            online_since: None,
        };
        observer.remember(&editor.content);
        *lock(&peer.live) = Some((Arc::clone(&live), file_id.clone()));
        let link = LiveLink {
            client,
            server_id: run.server_id,
            project: run.project,
            device_id: tokens.device_id,
            key: Arc::clone(&peer.key),
            sessions: Arc::clone(&peer.sessions),
        };
        let seed = run.options.seed ^ u64::from(peer.index).wrapping_mul(0x9E37_79B9_7F4A_7C15);
        let mut session = Session {
            peer: Arc::clone(peer),
            run: Arc::clone(run),
            link,
            live,
            file_id,
            path,
            events,
            sender,
            handle: None,
            editor,
            observer,
            rng: Rng::new(seed),
            seq: 0,
            pending_local: Vec::new(),
            own: Vec::new(),
            acked: 0,
            online: false,
            ended: false,
            can_edit: project_role_allows(summary.role, ProjectAction::Edit),
            joined_at: Some(started),
            down_since: None,
            reconnecting_since: None,
            reconnect_at: None,
            last_presence: None,
        };
        if !session.can_edit {
            peer.error(
                "join:viewer",
                "the peer joined as a viewer, so it only watches",
            );
        }
        session.go_live();
        Ok((session, messages_rx, events_rx))
    }

    fn pause(&mut self) -> Duration {
        let base = 1000.0 / self.run.options.rate;
        let low = (base * 0.6).max(1.0) as u64;
        let high = (base * 1.4).max(1.0) as u64;
        Duration::from_millis(self.rng.between(low, high))
    }

    fn can_type(&self) -> bool {
        self.can_edit && !self.ended
    }

    fn go_live(&mut self) {
        if self.reconnect_at.take().is_some() {
            self.reconnecting_since = Some(Instant::now());
        }
        self.handle = Some(spawn_live(
            self.link.clone(),
            Arc::clone(&self.live),
            self.events.clone(),
        ));
    }

    fn strand_unconfirmed(&mut self) {
        let mut stranded = Vec::new();
        let unconfirmed = self.own[self.acked..]
            .iter_mut()
            .map(|(_, edit)| edit)
            .chain(self.pending_local.iter_mut());
        for edit in unconfirmed {
            if edit.online {
                edit.online = false;
                stranded.extend(edit.marker);
            }
        }
        if !stranded.is_empty() {
            let mut offline = lock(&self.run.offline_markers);
            for seq in stranded {
                offline.insert((self.peer.index, seq));
            }
        }
    }

    fn went_down(&mut self) {
        if self.online {
            self.down_since = Some(Instant::now());
            self.strand_unconfirmed();
        }
        self.online = false;
        self.observer.online_since = None;
        self.peer.online.store(false, Ordering::SeqCst);
    }

    fn on_status(&mut self, status: LiveStatus) {
        match status {
            LiveStatus::Online => {
                if !self.online {
                    if let Some(at) = self.joined_at.take() {
                        self.peer.stats().join_ms = Some(ms(at.elapsed()));
                        println!(
                            "{} is live in {} after {:.1} s",
                            self.peer.label,
                            self.path,
                            at.elapsed().as_secs_f64()
                        );
                    } else if let Some(at) = self.reconnecting_since.take() {
                        self.peer.stats().reconnect_ms.push(ms(at.elapsed()));
                    } else if let Some(at) = self.down_since.take() {
                        self.peer.stats().outage_ms.push(ms(at.elapsed()));
                    }
                    self.down_since = None;
                }
                self.online = true;
                self.observer.online_since = Some(now_ms());
                self.peer.online.store(true, Ordering::SeqCst);
                self.peer.set_state("online");
            }
            LiveStatus::Connecting => {
                self.went_down();
                self.peer.set_state("connecting");
            }
            LiveStatus::Offline { retry_in_ms } => {
                self.went_down();
                self.peer.stats().offline_events += 1;
                self.peer.error(
                    "live:offline",
                    format!("the connection dropped; retrying in {retry_in_ms} ms"),
                );
                self.peer.set_state("offline");
            }
            LiveStatus::Ended { reason } => {
                self.went_down();
                if reason == EndReason::Stopped {
                    return;
                }
                let name = serde_json::to_value(reason)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .unwrap_or_else(|| format!("{reason:?}"));
                self.ended = true;
                self.handle = None;
                self.peer.ended.store(true, Ordering::SeqCst);
                self.peer
                    .error(&format!("live:ended:{name}"), "the live session ended");
                self.peer.set_state("ended");
                eprintln!("{}: the live session ended ({name})", self.peer.label);
            }
        }
    }

    fn on_event(&mut self, event: LiveEvent) {
        match event {
            LiveEvent::Status(status) => self.on_status(status),
            LiveEvent::Role(role) => self.can_edit = project_role_allows(role, ProjectAction::Edit),
            LiveEvent::Acknowledged => self.confirm(),
            LiveEvent::Unsendable => self.peer.error(
                "live:unsendable",
                "a change was too large for the server to take",
            ),
            LiveEvent::Untrusted { device_id, seq } => self.peer.error(
                "live:untrusted",
                format!("update {seq} came from an unrecognised device {device_id}"),
            ),
            _ => {}
        }
    }

    fn on_message(&mut self, generation: u64, message: DocMessage) {
        if generation != self.editor.generation {
            return;
        }
        if let DocMessage::Remote { op, .. } = &message {
            for component in op.components() {
                if let Component::Insert(inserted) = component {
                    self.observer.see(inserted);
                }
            }
        }
        let reset = matches!(message, DocMessage::Reset { .. });
        let lost_before = self.editor.lost_edits;
        match self.editor.receive(message) {
            Reaction::Nothing => {}
            Reaction::Send(rev, operation) => self.submit(rev, operation),
            Reaction::Resync => {
                self.peer.error(
                    "editor:resync",
                    "the editor fell out of step and reloaded the file",
                );
                self.reopen();
            }
        }
        if reset {
            self.peer
                .error("editor:reset", "the document replaced the editor text");
            self.observer.see(&self.editor.content);
        }
        if self.editor.lost_edits > lost_before {
            self.lose_pending();
        }
    }

    fn reopen(&mut self) {
        let generation = self.editor.generation + 1;
        let opened = lock(&self.live).open_file(&self.file_id, sink_for(&self.sender, generation));
        match opened {
            Ok((rev, content)) => {
                self.editor.reopened(generation, rev, content);
                self.observer.see(&self.editor.content);
            }
            Err(error) => self.peer.error("editor:reopen", error),
        }
    }

    fn lose_pending(&mut self) {
        if self.pending_local.is_empty() {
            return;
        }
        let count = self.pending_local.len() as u64;
        self.pending_local.clear();
        self.peer.stats().lost += count;
        self.peer.error(
            "editor:lost_edits",
            format!("{count} edits that were not sent yet were dropped by a reset"),
        );
    }

    fn submit(&mut self, rev: u64, operation: TextOperation) {
        let (before, after, result) = {
            let mut live = lock(&self.live);
            let own = live.doc().peer_id();
            let before = live.doc().version().get(&own).copied();
            let result = live.editor_change(&self.file_id, rev, operation);
            let after = live.doc().version().get(&own).copied();
            (before, after, result)
        };
        if let Err(error) = result {
            self.peer.error("edit:refused", error);
        }
        match after.filter(|end| Some(*end) != before) {
            Some(end) => {
                for edit in self.pending_local.drain(..) {
                    self.own.push((end, edit));
                }
            }
            None => self.lose_pending(),
        }
        if let Some(handle) = &self.handle {
            handle.flush();
        }
    }

    fn confirm(&mut self) {
        let (end, pending) = {
            let live = lock(&self.live);
            let own = live.doc().peer_id();
            (
                live.doc().version().get(&own).copied(),
                live.pending_changes(),
            )
        };
        let Some(end) = end else {
            return;
        };
        let confirmed = i64::from(end) - i64::try_from(pending).unwrap_or(i64::MAX);
        let mut confirmed_now = 0u64;
        let mut fresh = Vec::new();
        while self.acked < self.own.len() && i64::from(self.own[self.acked].0) <= confirmed {
            let (_, edit) = self.own[self.acked];
            if edit.online {
                fresh.push(ms(edit.at.elapsed()));
            }
            confirmed_now += 1;
            self.acked += 1;
        }
        if confirmed_now > 0 {
            let mut stats = self.peer.stats();
            stats.acked += confirmed_now;
            stats.ack_latency.extend(fresh);
        }
    }

    fn after_local(&mut self, sent: Option<(u64, TextOperation)>, marker: Option<u64>) {
        self.pending_local.push(LocalEdit {
            at: Instant::now(),
            online: self.online,
            marker,
        });
        self.peer.stats().sent += 1;
        if let Some((rev, operation)) = sent {
            self.submit(rev, operation);
        }
    }

    fn insert_marker(&mut self, lines: usize) -> Result<(), String> {
        self.seq += 1;
        let epoch = now_ms();
        if !self.online {
            lock(&self.run.offline_markers).insert((self.peer.index, self.seq));
        }
        let append = self.rng.chance(APPEND_PERCENT);
        let byte = insertion_point(&self.editor.content, append, &mut self.rng);
        let needs_break = byte > 0 && !self.editor.content[..byte].ends_with('\n');
        let mut inserted = String::new();
        if needs_break {
            inserted.push('\n');
        }
        inserted.push_str(&format!("⟦{}:{}@{epoch}⟧", self.peer.label, self.seq));
        if lines > 0 {
            inserted.push('\n');
            for _ in 0..lines {
                let line = filler_line(&self.peer.label, &mut self.rng);
                inserted.push_str(&line);
            }
        } else if append {
            inserted.push('\n');
        } else {
            inserted.push(' ');
        }
        let unit = unit_index(&self.editor.content, byte);
        self.editor.jump(unit);
        let sent = self.editor.type_text(&inserted).map_err(text)?;
        {
            let mut stats = self.peer.stats();
            stats.markers_made += 1;
            if lines > 0 {
                stats.blocks += 1;
            }
        }
        self.after_local(sent, Some(self.seq));
        Ok(())
    }

    fn delete_filler(&mut self) -> Result<bool, String> {
        let prefix = format!("%{}~ ", self.peer.label);
        let spots: Vec<usize> = self
            .editor
            .content
            .match_indices(&prefix)
            .map(|(at, _)| at + prefix.len())
            .collect();
        if spots.is_empty() {
            return Ok(false);
        }
        let start = spots[self.rng.below(spots.len())];
        let line = &self.editor.content[start..];
        let line = &line[..line.find('\n').unwrap_or(line.len())];
        let characters = line.chars().count();
        if characters == 0 {
            return Ok(false);
        }
        let count = 1 + self.rng.below(characters.min(5));
        let skip = self.rng.below(characters - count + 1);
        let offset = line
            .char_indices()
            .nth(skip)
            .map_or(line.len(), |(at, _)| at);
        let unit = unit_index(&self.editor.content, start + offset);
        self.editor.jump(unit);
        let sent = self.editor.delete_ahead(count).map_err(text)?;
        self.peer.stats().deletes += 1;
        self.after_local(sent, None);
        Ok(true)
    }

    fn edit(&mut self) {
        let roll = self.rng.below(100);
        let result = if roll < DELETE_PERCENT {
            match self.delete_filler() {
                Ok(true) => Ok(()),
                Ok(false) => self.insert_marker(0),
                Err(error) => Err(error),
            }
        } else if roll < DELETE_PERCENT + BLOCK_PERCENT {
            let lines = 3 + self.rng.below(10);
            self.insert_marker(lines)
        } else {
            self.insert_marker(0)
        };
        if let Err(error) = result {
            self.peer.error("edit:failed", error);
        }
        self.announce();
    }

    fn announce(&mut self) {
        if self
            .last_presence
            .is_some_and(|last| last.elapsed() < PRESENCE_EVERY)
        {
            return;
        }
        self.last_presence = Some(Instant::now());
        if let Some(handle) = &self.handle {
            handle.presence(PresenceState {
                file_id: Some(self.path.clone()),
                cursor: u32::try_from(self.editor.cursor).ok(),
                anchor: None,
            });
        }
    }

    async fn maybe_drop(&mut self) {
        if fraction(&mut self.rng) >= self.run.options.churn {
            return;
        }
        let Some(handle) = self.handle.take() else {
            return;
        };
        let _ = tokio::time::timeout(STOP_WAIT, handle.stopped()).await;
        self.went_down();
        self.peer.stats().reconnects += 1;
        self.peer.set_state("dropped");
        let downtime = Duration::from_millis(self.rng.between(500, 3000));
        self.reconnect_at = Some(tokio::time::Instant::now() + downtime);
    }

    fn settle(&mut self) {
        if self.reconnect_at.is_some() {
            self.go_live();
        }
        if let Some(handle) = &self.handle {
            handle.flush();
        }
    }

    fn publish(&self) {
        let synced = self.editor.synchronized() && self.pending_local.is_empty();
        self.peer.synced.store(synced, Ordering::SeqCst);
    }

    async fn finish(mut self) {
        self.confirm();
        let document = lock(&self.live).doc().text(&self.file_id).ok();
        let matches = document.as_deref() == Some(self.editor.content.as_str());
        let own = self.peer.index;
        let since = self.run.started_ms;
        let missed = markers(&self.editor.content)
            .filter(|marker| {
                marker.author != own
                    && marker.epoch >= since
                    && !self.observer.seen.contains(&marker.key())
            })
            .count() as u64;
        {
            let mut stats = self.peer.stats();
            stats.missed = missed;
            stats.editor_matches = Some(matches);
        }
        if !matches {
            self.peer.error(
                "final:editor_mismatch",
                "the editor text and the shared document differ",
            );
        }
        if missed > 0 {
            self.peer.error(
                "final:missed_markers",
                format!("{missed} markers from others reached the text without passing through the editor channel"),
            );
        }
        if let Some(handle) = self.handle.take() {
            handle.leave_presence();
            let _ = tokio::time::timeout(STOP_WAIT, handle.stopped()).await;
        }
        self.peer.online.store(false, Ordering::SeqCst);
        self.peer
            .set_state(if self.ended { "ended" } else { "finished" });
    }
}

async fn join_with_retries(peer: &Arc<Peer>, run: &Arc<Run>) -> Option<Joined> {
    for attempt in 1..=JOIN_ATTEMPTS {
        let started = Instant::now();
        match Session::join(peer, run, started).await {
            Ok(joined) => return Some(joined),
            Err(failure) if failure.transient() || failure.rate_limited() => {
                if attempt == JOIN_ATTEMPTS {
                    peer.fail(&format!("join:{}", failure.kind), &failure);
                    return None;
                }
                peer.error(&format!("join:{}", failure.kind), &failure.message);
                tokio::time::sleep(Duration::from_secs(2 * u64::from(attempt))).await;
            }
            Err(failure) => {
                peer.fail(&format!("join:{}", failure.kind), &failure);
                return None;
            }
        }
    }
    None
}

async fn run_peer(
    peer: Arc<Peer>,
    run: Arc<Run>,
    delay: Duration,
    mut phase: watch::Receiver<Phase>,
) {
    tokio::time::sleep(delay).await;
    peer.set_state("joining");
    let Some((mut session, mut messages, mut events)) = join_with_retries(&peer, &run).await else {
        return;
    };
    let mut current = *phase.borrow();
    let mut next_edit = tokio::time::Instant::now() + session.pause();
    let mut churn = tokio::time::interval_at(
        tokio::time::Instant::now() + Duration::from_secs(1),
        Duration::from_secs(1),
    );
    let far = tokio::time::Instant::now() + Duration::from_secs(365 * 24 * 3600);
    loop {
        let typing = current == Phase::Run && session.can_type();
        let churning = current == Phase::Run
            && run.options.churn > 0.0
            && session.handle.is_some()
            && !session.ended;
        let reconnect_at = session.reconnect_at;
        tokio::select! {
            changed = phase.changed() => {
                if changed.is_err() {
                    break;
                }
                current = *phase.borrow();
                match current {
                    Phase::Run => {}
                    Phase::Settle => session.settle(),
                    Phase::Done => break,
                }
            }
            message = messages.recv() => match message {
                Some((generation, message)) => session.on_message(generation, message),
                None => break,
            },
            event = events.recv() => match event {
                Some(event) => session.on_event(event),
                None => break,
            },
            () = tokio::time::sleep_until(reconnect_at.unwrap_or(far)), if reconnect_at.is_some() => {
                session.go_live();
            }
            () = tokio::time::sleep_until(next_edit), if typing => {
                let lag = tokio::time::Instant::now().saturating_duration_since(next_edit);
                peer.stats().client_lag.push(ms(lag));
                session.edit();
                next_edit = tokio::time::Instant::now() + session.pause();
            }
            _ = churn.tick(), if churning => session.maybe_drop().await,
        }
        session.publish();
    }
    session.finish().await;
}

struct Final {
    label: String,
    content: String,
    hash: String,
}

fn current_text(peer: &Peer) -> Option<(bool, String)> {
    let held = lock(&peer.live);
    let (live, file_id) = held.as_ref()?;
    let live = lock(live);
    let content = live.doc().text(file_id).ok()?;
    Some((live.has_unsent(), content))
}

async fn settle(peers: &[Arc<Peer>], run: &Run) -> (bool, Vec<Final>) {
    let deadline = Instant::now() + run.options.settle;
    loop {
        let mut finals = Vec::new();
        let mut waiting = Vec::new();
        for peer in peers {
            if peer.failed.load(Ordering::SeqCst) {
                continue;
            }
            let Some((unsent, content)) = current_text(peer) else {
                waiting.push(peer.label.clone());
                continue;
            };
            let ended = peer.ended.load(Ordering::SeqCst);
            let ready =
                peer.online.load(Ordering::SeqCst) && peer.synced.load(Ordering::SeqCst) && !unsent;
            if !ready && !ended {
                waiting.push(peer.label.clone());
            }
            finals.push(Final {
                label: peer.label.clone(),
                hash: sha256(&content),
                content,
            });
        }
        let distinct: HashSet<&str> = finals.iter().map(|done| done.hash.as_str()).collect();
        let converged = waiting.is_empty() && distinct.len() <= 1;
        if converged || Instant::now() >= deadline {
            if !waiting.is_empty() {
                eprintln!(
                    "Still not settled after {} s: {}",
                    run.options.settle.as_secs(),
                    waiting.join(" ")
                );
            }
            for done in &finals {
                if let Some(peer) = peers.iter().find(|peer| peer.label == done.label) {
                    let count = markers(&done.content)
                        .filter(|marker| marker.epoch >= run.started_ms)
                        .count() as u64;
                    let mut stats = peer.stats();
                    stats.final_sha256 = Some(done.hash.clone());
                    stats.final_chars = Some(done.content.chars().count());
                    stats.final_bytes = Some(done.content.len());
                    stats.final_run_markers = Some(count);
                }
            }
            return (converged && !finals.is_empty(), finals);
        }
        tokio::time::sleep(SETTLE_POLL).await;
    }
}

fn groups(finals: &[Final]) -> Vec<(String, Vec<String>, usize)> {
    let mut grouped: BTreeMap<String, (Vec<String>, usize)> = BTreeMap::new();
    for done in finals {
        let entry = grouped
            .entry(done.hash.clone())
            .or_insert_with(|| (Vec::new(), done.content.chars().count()));
        entry.0.push(done.label.clone());
    }
    let mut list: Vec<(String, Vec<String>, usize)> = grouped
        .into_iter()
        .map(|(hash, (labels, chars))| (hash, labels, chars))
        .collect();
    list.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then_with(|| a.0.cmp(&b.0)));
    list
}

fn first_difference(left: &str, right: &str) -> usize {
    left.chars()
        .zip(right.chars())
        .take_while(|(a, b)| a == b)
        .count()
}

fn excerpt(content: &str, at: usize) -> String {
    content
        .chars()
        .skip(at.saturating_sub(30))
        .take(80)
        .collect::<String>()
        .replace('\n', "⏎")
}

fn status_line(started: Instant, peers: &[Arc<Peer>]) -> String {
    let elapsed = started.elapsed().as_secs();
    let mut online = 0;
    let mut sent = 0;
    let mut acked = 0;
    let mut observed = 0;
    let mut errors = 0;
    let mut latency = Vec::new();
    let mut lag = Vec::new();
    for peer in peers {
        if peer.online.load(Ordering::SeqCst) {
            online += 1;
        }
        let stats = peer.stats();
        sent += stats.sent;
        acked += stats.acked;
        observed += stats.observed;
        errors += stats.errors.values().sum::<u64>();
        latency.extend_from_slice(&stats.latency);
        lag.extend_from_slice(&stats.client_lag);
    }
    let lag = percentiles(&lag).map_or(0, |(_, _, p95, _, _)| p95);
    format!(
        "[load {:02}:{:02}] online {online}/{}, sent {sent}, acked {acked}, observed {observed}, latency {}, tool lag p95 {lag} ms, errors {errors}",
        elapsed / 60,
        elapsed % 60,
        peers.len(),
        describe(&latency)
    )
}

fn peer_report(peer: &Peer) -> Value {
    let stats = peer.stats();
    json!({
        "peer": peer.label,
        "email": peer.email,
        "device": peer.name,
        "state": stats.state,
        "signed_in": stats.signed_in,
        "sign_in_ms": stats.sign_in_ms,
        "sign_in_wait_ms": stats.sign_in_wait_ms,
        "join_ms": stats.join_ms,
        "edits_sent": stats.sent,
        "edits_acknowledged": stats.acked,
        "edits_lost": stats.lost,
        "markers_made": stats.markers_made,
        "multi_line_inserts": stats.blocks,
        "deletes": stats.deletes,
        "markers_observed": stats.observed,
        "markers_missed": stats.missed,
        "latency_ms": summary(&stats.latency),
        "delayed_latency_ms": summary(&stats.delayed),
        "ack_latency_ms": summary(&stats.ack_latency),
        "reconnects": stats.reconnects,
        "reconnect_ms": summary(&stats.reconnect_ms),
        "offline_events": stats.offline_events,
        "outage_ms": summary(&stats.outage_ms),
        "client_lag_ms": summary(&stats.client_lag),
        "errors": stats.errors,
        "error_samples": stats.error_samples,
        "final_chars": stats.final_chars,
        "final_bytes": stats.final_bytes,
        "final_sha256": stats.final_sha256,
        "final_run_markers": stats.final_run_markers,
        "editor_matches_document": stats.editor_matches,
    })
}

#[derive(Default)]
struct Totals {
    sent: u64,
    acked: u64,
    lost: u64,
    made: u64,
    observed: u64,
    missed: u64,
    reconnects: u64,
    offline_events: u64,
    latency: Vec<u64>,
    delayed: Vec<u64>,
    ack_latency: Vec<u64>,
    reconnect_ms: Vec<u64>,
    outage_ms: Vec<u64>,
    client_lag: Vec<u64>,
    sign_in_ms: Vec<u64>,
    join_ms: Vec<u64>,
    errors: BTreeMap<String, u64>,
    signed_in: BTreeMap<String, u64>,
}

fn totals(peers: &[Arc<Peer>]) -> Totals {
    let mut totals = Totals::default();
    for peer in peers {
        let stats = peer.stats();
        totals.sent += stats.sent;
        totals.acked += stats.acked;
        totals.lost += stats.lost;
        totals.made += stats.markers_made;
        totals.observed += stats.observed;
        totals.missed += stats.missed;
        totals.reconnects += stats.reconnects;
        totals.offline_events += stats.offline_events;
        totals.latency.extend_from_slice(&stats.latency);
        totals.delayed.extend_from_slice(&stats.delayed);
        totals.ack_latency.extend_from_slice(&stats.ack_latency);
        totals.reconnect_ms.extend_from_slice(&stats.reconnect_ms);
        totals.outage_ms.extend_from_slice(&stats.outage_ms);
        totals.client_lag.extend_from_slice(&stats.client_lag);
        totals.sign_in_ms.extend(stats.sign_in_ms);
        totals.join_ms.extend(stats.join_ms);
        for (kind, count) in &stats.errors {
            *totals.errors.entry(kind.clone()).or_default() += count;
        }
        *totals.signed_in.entry(stats.signed_in.clone()).or_default() += 1;
    }
    totals
}

struct Outcome {
    converged: bool,
    finals: Vec<Final>,
    settle_ms: u64,
    finished_ms: u64,
}

fn report(peers: &[Arc<Peer>], run: &Run, outcome: &Outcome) -> Value {
    let totals = totals(peers);
    let grouped = groups(&outcome.finals);
    let joined = peers
        .iter()
        .filter(|peer| peer.stats().join_ms.is_some())
        .count();
    let options = &run.options;
    json!({
        "server": run.url.as_str(),
        "project": run.project.to_string(),
        "file": options.file,
        "config": {
            "peers": options.peers,
            "email_domain": options.domain(),
            "rate_per_second": options.rate,
            "duration_s": options.duration.as_secs_f64(),
            "ramp_s": options.ramp.as_secs_f64(),
            "churn_per_second": options.churn,
            "settle_s": options.settle.as_secs_f64(),
            "seed": options.seed,
        },
        "started_at_ms": run.started_ms,
        "finished_at_ms": outcome.finished_ms,
        "overall": {
            "peers_signed_in": totals.signed_in,
            "peers_joined": joined,
            "edits_sent": totals.sent,
            "edits_acknowledged": totals.acked,
            "edits_lost": totals.lost,
            "markers_made": totals.made,
            "markers_observed": totals.observed,
            "markers_missed": totals.missed,
            "latency_ms": summary(&totals.latency),
            "delayed_latency_ms": summary(&totals.delayed),
            "ack_latency_ms": summary(&totals.ack_latency),
            "sign_in_ms": summary(&totals.sign_in_ms),
            "join_ms": summary(&totals.join_ms),
            "reconnects": totals.reconnects,
            "reconnect_ms": summary(&totals.reconnect_ms),
            "offline_events": totals.offline_events,
            "outage_ms": summary(&totals.outage_ms),
            "client_lag_ms": summary(&totals.client_lag),
            "errors": totals.errors,
            "converged": outcome.converged,
            "settle_ms": outcome.settle_ms,
            "distinct_hashes": grouped.len(),
            "documents": grouped.iter().map(|(hash, labels, chars)| json!({
                "sha256": hash,
                "chars": chars,
                "peers": labels,
            })).collect::<Vec<_>>(),
        },
        "peers": peers.iter().map(|peer| peer_report(peer)).collect::<Vec<_>>(),
    })
}

fn print_summary(peers: &[Arc<Peer>], run: &Run, outcome: &Outcome) {
    let totals = totals(peers);
    let joined = peers
        .iter()
        .filter(|peer| peer.stats().join_ms.is_some())
        .count();
    let signed: Vec<String> = totals
        .signed_in
        .iter()
        .map(|(how, count)| format!("{count} {how}"))
        .collect();
    println!();
    println!(
        "Load test on {} project {} file {}",
        run.url, run.project, run.options.file
    );
    println!(
        "Peers: {} asked, sign-in {}, {joined} joined",
        peers.len(),
        signed.join(", ")
    );
    println!("Sign-in time: {}", describe(&totals.sign_in_ms));
    println!("Join time: {}", describe(&totals.join_ms));
    println!(
        "Edits: {} sent, {} acknowledged, {} lost; {} markers made",
        totals.sent, totals.acked, totals.lost, totals.made
    );
    println!(
        "Markers seen by others: {} (missed {})",
        totals.observed, totals.missed
    );
    println!("Latency, both sides online: {}", describe(&totals.latency));
    println!(
        "Latency, delayed by a reconnect or catch-up: {}",
        describe(&totals.delayed)
    );
    println!(
        "Server acknowledgement of edits made online: {}",
        describe(&totals.ack_latency)
    );
    println!(
        "Churn: {} deliberate reconnects, each back online in {}",
        totals.reconnects,
        describe(&totals.reconnect_ms)
    );
    println!(
        "Dropped by the network or server: {} times, offline for {}",
        totals.offline_events,
        describe(&totals.outage_ms)
    );
    println!(
        "This tool's own scheduling lag: {}",
        describe(&totals.client_lag)
    );
    if percentiles(&totals.client_lag).is_some_and(|(_, _, p95, _, _)| p95 > CLIENT_LAG_WARNING) {
        println!(
            "Warning: this machine fell behind its own schedule, so the latency above includes delay on the client side. Use a --release build, fewer peers or a lower --rate."
        );
    }
    if totals.errors.is_empty() {
        println!("Errors: none");
    } else {
        let listed: Vec<String> = totals
            .errors
            .iter()
            .map(|(kind, count)| format!("{kind} {count}"))
            .collect();
        println!("Errors: {}", listed.join(", "));
    }
    let grouped = groups(&outcome.finals);
    if outcome.converged {
        if let Some((hash, labels, chars)) = grouped.first() {
            println!(
                "Converged: all {} peers hold the same text ({chars} characters, sha256 {hash}) after {:.1} s of settling",
                labels.len(),
                outcome.settle_ms as f64 / 1000.0
            );
        }
        return;
    }
    if grouped.is_empty() {
        println!("Diverged: no peer has a document to compare");
        return;
    }
    println!(
        "Diverged: {} different texts after {} s of settling",
        grouped.len(),
        run.options.settle.as_secs()
    );
    for (hash, labels, chars) in &grouped {
        println!(
            "  {} peers ({}) hold {chars} characters, sha256 {hash}",
            labels.len(),
            labels.join(" ")
        );
    }
    let Some(reference) = outcome
        .finals
        .iter()
        .find(|done| grouped.first().is_some_and(|first| first.0 == done.hash))
    else {
        return;
    };
    for (hash, labels, _) in grouped.iter().skip(1) {
        let Some(other) = outcome.finals.iter().find(|done| &done.hash == hash) else {
            continue;
        };
        let at = first_difference(&reference.content, &other.content);
        println!(
            "  {} differs from {} at character {at}:\n    {}: {}\n    {}: {}",
            labels.join(" "),
            reference.label,
            reference.label,
            excerpt(&reference.content, at),
            other.label,
            excerpt(&other.content, at)
        );
    }
}

fn write_report(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    }
    let bytes = serde_json::to_vec_pretty(value).map_err(text)?;
    std::fs::write(path, bytes)
        .map_err(|error| format!("could not write {}: {error}", path.display()))
}

fn save_texts(folder: &Path, finals: &[Final]) -> Result<(), String> {
    std::fs::create_dir_all(folder)
        .map_err(|error| format!("could not create {}: {error}", folder.display()))?;
    for (hash, labels, _) in groups(finals) {
        let Some(done) = finals.iter().find(|done| done.hash == hash) else {
            continue;
        };
        let path = folder.join(format!("{}.txt", &hash[..hash.len().min(16)]));
        std::fs::write(&path, &done.content)
            .map_err(|error| format!("could not write {}: {error}", path.display()))?;
        println!(
            "Text held by {} saved to {}",
            labels.join(" "),
            path.display()
        );
    }
    Ok(())
}

struct LocalStack {
    url: String,
    link: String,
    stop: watch::Sender<bool>,
    _data: Option<tempfile::TempDir>,
}

fn no_secret_files(path: &Path) -> std::io::Result<String> {
    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        path.display().to_string(),
    ))
}

async fn start_local_stack(smtp: &str, options: &Options) -> Result<LocalStack, String> {
    let (data, folder) = match &options.local_data {
        Some(folder) => {
            private_folder(folder)?;
            (None, folder.clone())
        }
        None => {
            let data = tempfile::tempdir().map_err(text)?;
            let folder = data.path().to_path_buf();
            (Some(data), folder)
        }
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(text)?;
    let address = listener.local_addr().map_err(text)?;
    let vars: BTreeMap<String, String> = [
        ("OLEAFLY_PUBLIC_URL", format!("http://{address}")),
        ("OLEAFLY_BIND", address.to_string()),
        ("OLEAFLY_DATA_DIR", folder.display().to_string()),
        ("OLEAFLY_SETUP_CODE", "LOAD-SETUP-CODE-0001".to_owned()),
        ("OLEAFLY_SERVER_NAME", "Load Lab".to_owned()),
        ("OLEAFLY_LOG_LEVEL", "warn".to_owned()),
        ("OLEAFLY_SMTP_URL", format!("smtp://{smtp}")),
        (
            "OLEAFLY_MAIL_FROM",
            "Load Lab <lab@load-owner.test>".to_owned(),
        ),
        (
            "OLEAFLY_MAX_MEMBERS_PER_PROJECT",
            (options.peers + 5).to_string(),
        ),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_owned(), value))
    .collect();
    let config = ServerConfig::from_vars(&vars, &no_secret_files).map_err(text)?;
    let state = AppState::new(config, Arc::new(SystemClock))
        .await
        .map_err(text)?;
    let key = DeviceKey::load_or_create(&MemorySecrets::new()).map_err(text)?;
    let owner = seed_person(
        &state,
        PersonSeed {
            name: "Load Owner".to_owned(),
            email: "owner@load-owner.test".to_owned(),
            role: ServerRole::Admin,
            device_public_key: key.public_key_b64(),
            device_name: "Load owner".to_owned(),
        },
    )
    .await
    .map_err(text)?;
    let (stop, stopped) = watch::channel(false);
    let mut signal = stopped;
    tokio::spawn(serve_until(state, listener, async move {
        let _ = signal.changed().await;
    }));
    let url = ServerUrl::parse(&format!("http://{address}")).map_err(text)?;
    let client = ServerClient::new(url.clone()).map_err(text)?;
    let access = owner.access_token.as_str();
    client
        .admin_patch_settings(
            access,
            &RuntimeSettingsPatch {
                email_link_sign_in: Some(true),
                ..RuntimeSettingsPatch::default()
            },
        )
        .await
        .map_err(text)?;
    let domain = options.domain();
    let rules = client.admin_domain_rules(access).await.map_err(text)?;
    if !rules.iter().any(|rule| rule.domain == domain) {
        client
            .admin_add_domain_rule(
                access,
                &NewDomainRule {
                    domain,
                    role: ServerRole::Member,
                },
            )
            .await
            .map_err(text)?;
    }
    let mut doc = ProjectDoc::create().map_err(text)?;
    doc.add_node(None, &options.file, NodeKind::Text, None, LOCAL_MAIN)
        .map_err(text)?;
    let project = client
        .create_project(access, "Load test")
        .await
        .map_err(text)?
        .project_id;
    client
        .put_snapshot(access, project, 0, doc.snapshot().map_err(text)?)
        .await
        .map_err(text)?;
    client.commit_project(access, project).await.map_err(text)?;
    client
        .patch_project(
            access,
            project,
            &ProjectPatch {
                link_sharing: Some(true),
                link_role: Some(ProjectRole::Editor),
                ..ProjectPatch::default()
            },
        )
        .await
        .map_err(text)?;
    let server: String = url::form_urlencoded::byte_serialize(url.as_str().as_bytes()).collect();
    Ok(LocalStack {
        url: url.as_str().to_owned(),
        link: format!("oleafly://open?server={server}&project={project}"),
        stop,
        _data: data,
    })
}

async fn run(mut options: Options) -> i32 {
    let started_ms = now_ms();
    let local = match options.local_stack.clone() {
        Some(smtp) => match start_local_stack(&smtp, &options).await {
            Ok(stack) => {
                println!(
                    "Local server on {} sends mail to {smtp}; link {}",
                    stack.url, stack.link
                );
                options.link = Some(stack.link.clone());
                options.server = Some(stack.url.clone());
                Some(stack)
            }
            Err(error) => {
                eprintln!("The local server did not start: {error}");
                return 1;
            }
        },
        None => None,
    };
    let linked = match options.link.as_deref().map(parse_link).transpose() {
        Ok(linked) => linked,
        Err(error) => {
            eprintln!("{error}");
            return 2;
        }
    };
    let Some(server) = options
        .server
        .clone()
        .or_else(|| linked.as_ref().map(|(server, _)| server.clone()))
    else {
        eprintln!("--link or --server is required");
        return 2;
    };
    let url = match ServerUrl::parse(&server) {
        Ok(url) => url,
        Err(error) => {
            eprintln!("{server} is not a usable server address: {error}");
            return 2;
        }
    };
    if let Some((link_server, _)) = &linked {
        if ServerUrl::parse(link_server).is_ok_and(|named| named.as_str() != url.as_str()) {
            eprintln!(
                "Note: the link names {link_server} but the peers use {}",
                url.as_str()
            );
        }
    }
    let client = match ServerClient::new(url.clone()) {
        Ok(client) => client,
        Err(error) => {
            eprintln!("No HTTP client: {error}");
            return 1;
        }
    };
    let manifest = match client.capabilities().await {
        Ok(manifest) => manifest,
        Err(error) => {
            eprintln!("{} did not describe itself: {error}", url.as_str());
            return 1;
        }
    };
    let provider = manifest
        .providers
        .iter()
        .find(|provider| provider.kind == ProviderKind::EmailLink)
        .map(|provider| provider.id.clone());
    println!(
        "{} at {} runs Oleafly Server {}; email sign-in is {}",
        manifest.name,
        url.as_str(),
        manifest.version,
        if provider.is_some() { "on" } else { "off" }
    );
    let mailpit = match options.mailpit.as_deref().map(Mailpit::new).transpose() {
        Ok(mailpit) => mailpit,
        Err(error) => {
            eprintln!("{error}");
            return 2;
        }
    };
    let peers = match make_peers(&options) {
        Ok(peers) => peers,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };
    let browser = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .user_agent(BROWSER_AGENT)
        .build();
    let loopback = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(10))
        .build();
    let (browser, loopback) = match (browser, loopback) {
        (Ok(browser), Ok(loopback)) => (browser, loopback),
        (Err(error), _) | (_, Err(error)) => {
            eprintln!("No HTTP client for the sign-in pages: {error}");
            return 1;
        }
    };
    let context = Arc::new(SignInContext {
        url: url.clone(),
        server_id: manifest.server_id,
        provider,
        mailpit,
        browser,
        loopback,
        sign_in_timeout: options.sign_in_timeout,
        mail_timeout: options.mail_timeout,
        platform: platform(),
        spacing: options.sign_in_spacing,
        next_start: tokio::sync::Mutex::new(tokio::time::Instant::now()),
    });
    println!(
        "Signing in {} peers as peerNN@{} ({} at a time)",
        peers.len(),
        options.domain(),
        options.sign_in_concurrency
    );
    sign_in_all(&peers, context, options.sign_in_concurrency).await;
    let ready: Vec<Arc<Peer>> = peers
        .iter()
        .filter(|peer| !peer.failed.load(Ordering::SeqCst))
        .cloned()
        .collect();
    if options.sign_in_only {
        let totals = totals(&peers);
        let signed: Vec<String> = totals
            .signed_in
            .iter()
            .map(|(how, count)| format!("{count} {how}"))
            .collect();
        println!("Sign-in only: {}", signed.join(", "));
        match &options.state_dir {
            Some(dir) => println!("Sessions are saved in {}", dir.display()),
            None => eprintln!("Without --state-dir these sessions are lost when the tool exits"),
        }
        if let Some(stack) = local {
            let _ = stack.stop.send(true);
        }
        return i32::from(ready.len() != peers.len());
    }
    let Some((_, project)) = linked else {
        eprintln!("--link is required to run the load");
        return 2;
    };
    let run = Arc::new(Run {
        options: options.clone(),
        url,
        server_id: manifest.server_id,
        project,
        started_ms,
        offline_markers: Mutex::new(HashSet::new()),
    });
    let mut outcome = Outcome {
        converged: false,
        finals: Vec::new(),
        settle_ms: 0,
        finished_ms: 0,
    };
    if ready.is_empty() {
        eprintln!("No peer could sign in, so nothing ran.");
    } else {
        outcome = drive(&ready, &run).await;
    }
    outcome.finished_ms = now_ms();
    print_summary(&peers, &run, &outcome);
    if let Some(folder) = &options.save_text {
        if let Err(error) = save_texts(folder, &outcome.finals) {
            eprintln!("{error}");
        }
    }
    if let Some(path) = &options.report {
        match write_report(path, &report(&peers, &run, &outcome)) {
            Ok(()) => println!("Report written to {}", path.display()),
            Err(error) => eprintln!("{error}"),
        }
    }
    if let Some(stack) = local {
        let _ = stack.stop.send(true);
    }
    let failed: Vec<&str> = peers
        .iter()
        .filter(|peer| peer.failed.load(Ordering::SeqCst))
        .map(|peer| peer.label.as_str())
        .collect();
    if !outcome.converged {
        1
    } else if failed.is_empty() {
        0
    } else {
        eprintln!(
            "The peers that ran agree, but these never joined: {}",
            failed.join(" ")
        );
        3
    }
}

async fn drive(ready: &[Arc<Peer>], run: &Arc<Run>) -> Outcome {
    let options = &run.options;
    if options.ramp >= options.duration && !options.ramp.is_zero() {
        eprintln!("Note: --ramp is not shorter than --duration, so the last peers join after the edits stop");
    }
    println!(
        "{} peers join over {:.0} s and type {} edits per second each for {:.0} s{}",
        ready.len(),
        options.ramp.as_secs_f64(),
        options.rate,
        options.duration.as_secs_f64(),
        if options.churn > 0.0 {
            format!(
                ", dropping their connection with probability {} per second",
                options.churn
            )
        } else {
            String::new()
        }
    );
    let (phase, phases) = watch::channel(Phase::Run);
    let started = Instant::now();
    let count = ready.len() as u32;
    let tasks: Vec<_> = ready
        .iter()
        .enumerate()
        .map(|(position, peer)| {
            let delay = options
                .ramp
                .mul_f64(position as f64 / f64::from(count.max(1)));
            tokio::spawn(run_peer(
                Arc::clone(peer),
                Arc::clone(run),
                delay,
                phases.clone(),
            ))
        })
        .collect();
    let deadline = tokio::time::Instant::now() + options.duration;
    let mut ticker =
        tokio::time::interval_at(tokio::time::Instant::now() + STATUS_EVERY, STATUS_EVERY);
    let interrupted = tokio::signal::ctrl_c();
    tokio::pin!(interrupted);
    loop {
        tokio::select! {
            () = tokio::time::sleep_until(deadline) => break,
            _ = ticker.tick() => println!("{}", status_line(started, ready)),
            _ = &mut interrupted => {
                println!("Interrupted: the peers stop typing and settle now");
                break;
            }
        }
    }
    let _ = phase.send(Phase::Settle);
    println!("{}", status_line(started, ready));
    println!(
        "Edits stopped; waiting up to {} s for every peer to hold the same text",
        options.settle.as_secs()
    );
    let settling = Instant::now();
    let (converged, finals) = settle(ready, run).await;
    let settle_ms = ms(settling.elapsed());
    let _ = phase.send(Phase::Done);
    for task in tasks {
        let _ = tokio::time::timeout(Duration::from_secs(30), task).await;
    }
    Outcome {
        converged,
        finals,
        settle_ms,
        finished_ms: 0,
    }
}

#[tokio::main]
async fn main() {
    let options = match parse_options(std::env::args().skip(1)) {
        Ok(options) => options,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };
    let code = run(options).await;
    std::process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> impl Iterator<Item = String> {
        list.iter()
            .map(|item| (*item).to_owned())
            .collect::<Vec<_>>()
            .into_iter()
    }

    #[test]
    fn markers_are_read_back_with_their_author_sequence_and_time() {
        let content = "a ⟦p03:17@1760300000123⟧ b\n⟦p12:4@1760300000999⟧\n⟦p1:x@2⟧ ⟦pbroken";
        let found: Vec<Marker> = markers(content).collect();
        assert_eq!(
            found,
            vec![
                Marker {
                    author: 3,
                    seq: 17,
                    epoch: 1_760_300_000_123
                },
                Marker {
                    author: 12,
                    seq: 4,
                    epoch: 1_760_300_000_999
                },
            ]
        );
    }

    #[test]
    fn edits_land_on_line_starts_inside_the_document_body() {
        let content =
            "\\documentclass{article}\n\\begin{document}\nfirst\nsecond é\n\\end{document}\n";
        let (start, end) = body(content);
        assert_eq!(&content[start..end], "first\nsecond é\n");
        let mut rng = Rng::new(7);
        for _ in 0..200 {
            let at = insertion_point(content, false, &mut rng);
            assert!(at >= start && at <= end, "{at}");
            assert!(at == start || content[..at].ends_with('\n'), "{at}");
        }
        assert_eq!(insertion_point(content, true, &mut rng), end);
        assert_eq!(body("plain"), (0, 5));
    }

    #[test]
    fn the_sign_in_forms_are_found_with_their_hidden_fields() {
        let html = "<div class=\"brand\"><svg><path d=\"M0\"/></svg></div><h1>Sign in to Lab</h1><p>Enter your email &amp; more.</p><form method=\"post\" action=\"/auth/email-link\"><input type=\"hidden\" name=\"pending\" value=\"a&amp;b\"><input type=\"hidden\" name=\"csrf\" value=\"c\"><label for=\"email\">Email</label><input id=\"email\" type=\"email\" name=\"email\" value=\"\" required><button type=\"submit\">Go</button></form>";
        let form = form_with(html, "email").expect("the email form");
        assert_eq!(form.action, "/auth/email-link");
        assert_eq!(
            form.fields,
            vec![
                ("pending".to_owned(), "a&b".to_owned()),
                ("csrf".to_owned(), "c".to_owned()),
                ("email".to_owned(), String::new()),
            ]
        );
        assert!(form_with(html, "token").is_none());
        assert_eq!(page_text(html), "Sign in to Lab: Enter your email & more.");
    }

    #[test]
    fn the_sign_in_link_is_taken_from_the_mail_body() {
        let body = "Sign in\n\nIf the button doesn't work, copy this address into your browser:\nhttps://oleafly.example.edu/lab/auth/email-link/verify?token=abc_DEF-123\n\nFooter";
        assert_eq!(
            sign_in_link(body).as_deref(),
            Some("https://oleafly.example.edu/lab/auth/email-link/verify?token=abc_DEF-123")
        );
        let html = "<a href=\"http://127.0.0.1:9/auth/email-link/verify?token=x1\">Sign in</a>";
        assert_eq!(
            sign_in_link(html).as_deref(),
            Some("http://127.0.0.1:9/auth/email-link/verify?token=x1")
        );
        assert_eq!(sign_in_link("no link here"), None);
    }

    #[test]
    fn only_the_loopback_callback_ends_the_browser_walk() {
        for (raw, expected) in [
            ("http://127.0.0.1:5000/callback?code=a&state=b", true),
            ("http://[::1]:5000/callback?code=a", true),
            ("http://127.0.0.1:5000/auth/email-link", false),
            ("https://oleafly.example.edu/callback", false),
        ] {
            let url = Url::parse(raw).expect("a url");
            assert_eq!(is_loopback_callback(&url), expected, "{raw}");
        }
    }

    #[test]
    fn options_need_a_link_and_a_domain_unless_the_stack_is_local() {
        let parsed = parse_options(args(&[
            "--link",
            "oleafly://open?server=https%3A%2F%2Fa.example&project=0199d2a4-7b1e-7c3a-9f00-1234567890ab",
            "--email-domain=@Load.Example",
            "--peers",
            "20",
            "--rate",
            "4",
            "--ramp",
            "0",
            "--churn",
            "0.01",
        ]))
        .expect("valid options");
        assert_eq!(parsed.peers, 20);
        assert_eq!(parsed.domain(), "load.example");
        assert!((parsed.rate - 4.0).abs() < f64::EPSILON);
        assert!(parse_options(args(&["--email-domain", "x.example"])).is_err());
        let preparing = parse_options(args(&[
            "--server",
            "https://a.example",
            "--email-domain",
            "x.example",
            "--sign-in-only",
            "--sign-in-spacing",
            "2.5",
        ]))
        .expect("a sign-in pass needs only the server");
        assert!(preparing.sign_in_only);
        assert_eq!(preparing.sign_in_spacing, Duration::from_millis(2500));
        assert!(parse_options(args(&["--local-stack", "127.0.0.1:1025"])).is_ok());
        assert!(parse_options(args(&["--local-stack", "127.0.0.1:1025", "--churn", "2"])).is_err());
        assert!(parse_options(args(&["--local-stack", "127.0.0.1:1025", "--bogus", "1"])).is_err());
    }

    #[test]
    fn links_name_the_server_and_the_project() {
        let (server, project) = parse_link(
            "oleafly://open?server=https%3A%2F%2Foleafly.example.edu%2F&project=0199d2a4-7b1e-7c3a-9f00-1234567890ab",
        )
        .expect("an app link");
        assert_eq!(server, "https://oleafly.example.edu");
        assert_eq!(project.to_string(), "0199d2a4-7b1e-7c3a-9f00-1234567890ab");
        let (server, _) =
            parse_link("https://oleafly.example.edu/p/0199d2a4-7b1e-7c3a-9f00-1234567890ab")
                .expect("a landing link");
        assert_eq!(server, "https://oleafly.example.edu");
    }

    #[test]
    fn cookies_from_the_server_are_kept_and_expired_ones_dropped() {
        let mut jar = Jar::default();
        let mut headers = HeaderMap::new();
        headers.append(
            SET_COOKIE,
            "oleafly_csrf=abc; Path=/auth; HttpOnly"
                .parse()
                .expect("header"),
        );
        jar.absorb(&headers);
        assert_eq!(jar.header().as_deref(), Some("oleafly_csrf=abc"));
        let mut expired = HeaderMap::new();
        expired.append(
            SET_COOKIE,
            "oleafly_csrf=; Max-Age=0".parse().expect("header"),
        );
        jar.absorb(&expired);
        assert_eq!(jar.header(), None);
    }

    #[test]
    fn percentiles_pick_from_the_sorted_samples() {
        let samples: Vec<u64> = (1..=100).rev().collect();
        assert_eq!(percentiles(&samples), Some((100, 51, 95, 99, 100)));
        assert_eq!(percentiles(&[]), None);
    }
}
