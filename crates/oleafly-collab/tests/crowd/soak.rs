use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::str::FromStr;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab::live::LiveProject;
use oleafly_collab::sync::{LiveEvent, LiveLink, LiveStatus};
use oleafly_collab::{DeviceKey, MemorySecrets, ServerClient, ServerUrl, SessionManager};
use oleafly_collab_protocol::auth::SessionTokens;
use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::clock::SystemClock;
use oleafly_server::state::AppState;
use oleafly_server::test_support::{test_config, BlockingProxy};
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::content;
use crate::measure::{sample, storage, LogHistogram, Percentiles, Storage};
use crate::relay::Relay;
use crate::typist::{Rng, NAMES};
use crate::{
    identity, lock, new_person, seed_from_env, settle_on, type_along, verify, Editor, Logs, Person,
    Plan,
};

const EDIT_MEMORY: Duration = Duration::from_secs(10 * 60);
const SAMPLE_EVERY: Duration = Duration::from_secs(5);
const READY_WITHIN: Duration = Duration::from_secs(30);
const WARM_UP: Duration = Duration::from_secs(120);

pub struct SoakPlan {
    pub duration: Duration,
    pub people: usize,
    pub files: usize,
    pub long_poll: usize,
    pub pause_ms: (u64, u64),
    pub report_every: Duration,
    pub cut_every: Duration,
    pub cut_for_ms: (u64, u64),
    pub figure_every: Duration,
    pub figure_kb: usize,
    pub max_chars: usize,
    pub seed: u64,
    pub data_dir: Option<PathBuf>,
    pub server_bin: PathBuf,
}

fn env_text(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn env_parse<T: FromStr>(name: &str, fallback: T) -> T {
    env_text(name)
        .and_then(|value| value.parse().ok())
        .unwrap_or(fallback)
}

fn env_pair(name: &str, fallback: (u64, u64)) -> (u64, u64) {
    env_text(name)
        .and_then(|value| {
            let (low, high) = value.split_once(',')?;
            Some((low.trim().parse().ok()?, high.trim().parse().ok()?))
        })
        .unwrap_or(fallback)
}

fn seconds(name: &str, fallback: f64) -> Duration {
    Duration::from_secs_f64(env_parse(name, fallback).max(0.0))
}

fn default_server_bin() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| Some(exe.parent()?.parent()?.join("oleafly-server")))
        .unwrap_or_else(|| PathBuf::from("oleafly-server"))
}

impl SoakPlan {
    pub fn from_env() -> SoakPlan {
        let people = env_parse("CROWD_SOAK_PEOPLE", 20usize).clamp(2, NAMES.len());
        SoakPlan {
            duration: seconds("CROWD_SOAK_MINUTES", 10.0) * 60,
            people,
            files: env_parse("CROWD_SOAK_FILES", 50usize).max(1),
            long_poll: env_parse("CROWD_SOAK_LONG_POLL", 4usize).min(people - 1),
            pause_ms: env_pair("CROWD_SOAK_PAUSE_MS", (150, 900)),
            report_every: seconds("CROWD_SOAK_REPORT_SECONDS", 60.0),
            cut_every: seconds("CROWD_SOAK_CUT_SECONDS", 120.0),
            cut_for_ms: env_pair("CROWD_SOAK_CUT_FOR_MS", (3_000, 12_000)),
            figure_every: seconds("CROWD_SOAK_FIGURE_SECONDS", 60.0),
            figure_kb: env_parse("CROWD_SOAK_FIGURE_KB", 64usize),
            max_chars: env_parse("CROWD_SOAK_MAX_CHARS", 30_000usize),
            seed: seed_from_env(0x50AC_0001),
            data_dir: env_text("CROWD_SOAK_DATA").map(PathBuf::from),
            server_bin: env_text("CROWD_SERVER_BIN")
                .map(PathBuf::from)
                .unwrap_or_else(default_server_bin),
        }
    }
}

struct ServerProcess {
    child: Child,
    addr: SocketAddr,
}

fn log_tail(data: &Path) -> String {
    let text = std::fs::read_to_string(data.join("server.log")).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(20)..].join("\n")
}

impl ServerProcess {
    async fn start(bin: &Path, data: &Path) -> Result<ServerProcess, String> {
        if !bin.is_file() {
            return Err(format!(
                "no server binary at {}. Build it with `cargo build --release -p oleafly-server` or set CROWD_SERVER_BIN",
                bin.display()
            ));
        }
        let port = std::net::TcpListener::bind(("127.0.0.1", 0))
            .and_then(|listener| listener.local_addr())
            .map_err(|error| format!("no free port: {error}"))?
            .port();
        let addr: SocketAddr = format!("127.0.0.1:{port}")
            .parse()
            .map_err(|error| format!("{error}"))?;
        let log = std::fs::File::create(data.join("server.log"))
            .map_err(|error| format!("cannot write the server log: {error}"))?;
        let mut command = Command::new(bin);
        command.env_clear();
        for kept in ["PATH", "HOME", "TMPDIR"] {
            if let Ok(value) = std::env::var(kept) {
                command.env(kept, value);
            }
        }
        let child = command
            .env("OLEAFLY_PUBLIC_URL", format!("http://{addr}"))
            .env("OLEAFLY_BIND", addr.to_string())
            .env("OLEAFLY_DATA_DIR", data)
            .env("OLEAFLY_MAX_MEMBERS_PER_PROJECT", "1000")
            .env("OLEAFLY_MAX_PROJECT_MB", "4000")
            .env("OLEAFLY_LOG_LEVEL", "warn")
            .stdout(Stdio::null())
            .stderr(log)
            .spawn()
            .map_err(|error| format!("cannot start {}: {error}", bin.display()))?;
        let mut server = ServerProcess { child, addr };
        let ready = format!("http://{addr}/readyz");
        let http = reqwest::Client::builder()
            .no_proxy()
            .build()
            .map_err(|error| error.to_string())?;
        let started = Instant::now();
        loop {
            if let Ok(Some(status)) = server.child.try_wait() {
                return Err(format!(
                    "the server stopped with {status}:\n{}",
                    log_tail(data)
                ));
            }
            if let Ok(answer) = http.get(&ready).send().await {
                if answer.status().is_success() {
                    return Ok(server);
                }
            }
            if started.elapsed() > READY_WITHIN {
                server.stop();
                return Err(format!("the server was not ready:\n{}", log_tail(data)));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    fn pid(&self) -> u32 {
        self.child.id()
    }

    fn stop(&mut self) {
        if matches!(self.child.try_wait(), Ok(Some(_))) {
            return;
        }
        let _ = Command::new("kill")
            .args(["-TERM", &self.child.id().to_string()])
            .status();
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for ServerProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Default)]
struct Totals {
    socket: LogHistogram,
    poll: LogHistogram,
    ack: LogHistogram,
    window_socket: LogHistogram,
    window_poll: LogHistogram,
    reconnects: LogHistogram,
    onlines: u64,
    cuts: u64,
    figures: u64,
    figure_failures: u64,
}

async fn observe(
    person: Arc<Person>,
    mut events: UnboundedReceiver<LiveEvent>,
    logs: Logs,
    totals: Arc<Mutex<Totals>>,
    long_poll: bool,
) {
    let mut seen_end: HashMap<usize, i32> = HashMap::new();
    let mut acked_end = i32::MIN;
    while let Some(event) = events.recv().await {
        match event {
            LiveEvent::Status(status) => {
                if status == LiveStatus::Online {
                    lock(&totals).onlines += 1;
                }
                person.on_status(status);
            }
            LiveEvent::Changed => {
                let seen = lock(&person.live).doc().version();
                let now = Instant::now();
                let away = person.expect_offline.load(Ordering::SeqCst);
                let back = *lock(&person.reconnected_at);
                let known: Vec<_> = lock(&logs).clone();
                let mut fresh = Vec::new();
                for (index, log) in known {
                    if index == person.index {
                        continue;
                    }
                    let peer = log.peer.load(Ordering::SeqCst);
                    let Some(end) = (peer != 0).then(|| seen.get(&peer).copied()).flatten() else {
                        continue;
                    };
                    let last = seen_end.entry(index).or_insert(i32::MIN);
                    if end <= *last {
                        continue;
                    }
                    let entries = lock(&log.entries);
                    let start = entries.partition_point(|edit| edit.end <= *last);
                    for edit in entries[start..].iter().take_while(|edit| edit.end <= end) {
                        let missed = away || back.is_some_and(|back| edit.at < back);
                        if !edit.offline && !missed {
                            fresh.push(micros(now.duration_since(edit.at)));
                        }
                    }
                    *last = end;
                }
                if !fresh.is_empty() {
                    let mut totals = lock(&totals);
                    for sample in fresh {
                        if long_poll {
                            totals.poll.record(sample);
                            totals.window_poll.record(sample);
                        } else {
                            totals.socket.record(sample);
                            totals.window_socket.record(sample);
                        }
                    }
                }
            }
            LiveEvent::Acknowledged => {
                let peer = person.log.peer.load(Ordering::SeqCst);
                if peer == 0 {
                    continue;
                }
                let (end, pending) = {
                    let live = lock(&person.live);
                    (
                        live.doc().version().get(&peer).copied(),
                        live.pending_changes(),
                    )
                };
                let Some(end) = end else { continue };
                let confirmed = i64::from(end) - i64::try_from(pending).unwrap_or(i64::MAX);
                let confirmed = i32::try_from(confirmed).unwrap_or(i32::MIN);
                if confirmed <= acked_end {
                    continue;
                }
                let now = Instant::now();
                let samples: Vec<u64> = {
                    let entries = lock(&person.log.entries);
                    let start = entries.partition_point(|edit| edit.end <= acked_end);
                    entries[start..]
                        .iter()
                        .take_while(|edit| edit.end <= confirmed)
                        .filter(|edit| !edit.offline)
                        .map(|edit| micros(now.duration_since(edit.at)))
                        .collect()
                };
                acked_end = confirmed;
                let mut totals = lock(&totals);
                for sample in samples {
                    totals.ack.record(sample);
                }
            }
            _ => {}
        }
    }
}

fn micros(duration: Duration) -> u64 {
    u64::try_from(duration.as_micros()).unwrap_or(u64::MAX)
}

fn forget_old_edits(logs: &Logs) {
    let cutoff = Instant::now().checked_sub(EDIT_MEMORY);
    let Some(cutoff) = cutoff else { return };
    for (_, log) in lock(logs).iter() {
        let mut entries = lock(&log.entries);
        let old = entries.partition_point(|edit| edit.at < cutoff);
        entries.drain(..old);
    }
}

fn soak_doc(files: usize, rng: &mut Rng) -> (ProjectDoc, String) {
    let mut doc = ProjectDoc::create().expect("create a project doc");
    let main = doc
        .add_node(
            None,
            "main.tex",
            NodeKind::Text,
            None,
            &content::latex_main(20_000, rng),
        )
        .expect("add main.tex");
    let sections = files.saturating_sub(1);
    let folders: Vec<String> = (0..sections.div_ceil(10))
        .map(|index| {
            doc.add_node(None, &format!("chapter-{index}"), NodeKind::Dir, None, "")
                .expect("add a folder")
        })
        .collect();
    for index in 0..sections {
        doc.add_node(
            Some(&folders[index / 10]),
            &format!("section-{index:03}.tex"),
            NodeKind::Text,
            None,
            &content::small_section(index, rng),
        )
        .expect("add a section");
    }
    (doc, main)
}

#[derive(Clone, Copy)]
struct ServerSample {
    at: Duration,
    rss_kb: u64,
    cpu_ms: u64,
}

pub struct SoakReport {
    plan_line: String,
    wall: Duration,
    edits: u64,
    head: u64,
    socket: Percentiles,
    poll: Percentiles,
    ack: Percentiles,
    reconnects: Percentiles,
    onlines: u64,
    people: usize,
    cuts: u64,
    figures: u64,
    figure_failures: u64,
    start_rss_kb: u64,
    peak_rss_kb: u64,
    end_rss_kb: u64,
    rss_slope_kb_per_hour: f64,
    cpu_ms: u64,
    storage_start: Storage,
    storage_warm: Option<(Duration, Storage)>,
    storage_end: Storage,
    storage_closed: Storage,
    snapshot_files: usize,
    convergence: Option<Duration>,
    text_bytes: usize,
    data_dir: Option<PathBuf>,
    pub problems: Vec<String>,
}

fn megabytes(bytes: u64) -> f64 {
    bytes as f64 / 1024.0 / 1024.0
}

fn growth_per_hour(start: u64, end: u64, hours: f64) -> f64 {
    (end as f64 - start as f64) / 1024.0 / 1024.0 / hours.max(1e-9)
}

impl SoakReport {
    pub fn converged(&self) -> bool {
        self.convergence.is_some()
    }

    pub fn print(&self) {
        let hours = self.wall.as_secs_f64() / 3600.0;
        println!();
        println!("{}", self.plan_line);
        println!(
            "  ran {:.1} min, {} edits, {} updates stored ({:.0}/s)",
            self.wall.as_secs_f64() / 60.0,
            self.edits,
            self.head,
            self.head as f64 / self.wall.as_secs_f64().max(0.001)
        );
        println!(
            "  edit seen by others over a socket, both online: {}",
            self.socket.line()
        );
        println!(
            "  edit seen by others over long-poll, both online: {}",
            self.poll.line()
        );
        println!("  edit acknowledged by the server: {}", self.ack.line());
        println!(
            "  reconnects: {} beyond the first connection of each person, {} network cuts, back online after a cut: {}",
            self.onlines.saturating_sub(self.people as u64),
            self.cuts,
            self.reconnects.line()
        );
        println!(
            "  server process: RSS {:.1} MB after warm-up, peak {:.1} MB, end {:.1} MB, trend {:+.2} MB/hour, CPU {:.1} s ({:.2} cores on average)",
            self.start_rss_kb as f64 / 1024.0,
            self.peak_rss_kb as f64 / 1024.0,
            self.end_rss_kb as f64 / 1024.0,
            self.rss_slope_kb_per_hour / 1024.0,
            self.cpu_ms as f64 / 1000.0,
            self.cpu_ms as f64 / 1000.0 / self.wall.as_secs_f64().max(0.001)
        );
        println!(
            "  disk: database {:.2} MB -> {:.2} MB ({:+.2} MB/hour), snapshots {:.2} MB -> {:.2} MB ({:+.2} MB/hour), files {:.2} MB -> {:.2} MB ({:+.2} MB/hour, {} figures added, {} failed)",
            megabytes(self.storage_start.database),
            megabytes(self.storage_end.database),
            growth_per_hour(self.storage_start.database, self.storage_end.database, hours),
            megabytes(self.storage_start.snapshots),
            megabytes(self.storage_end.snapshots),
            growth_per_hour(self.storage_start.snapshots, self.storage_end.snapshots, hours),
            megabytes(self.storage_start.blobs),
            megabytes(self.storage_end.blobs),
            growth_per_hour(self.storage_start.blobs, self.storage_end.blobs, hours),
            self.figures,
            self.figure_failures
        );
        if let Some((at, warm)) = self.storage_warm {
            let after = (self.wall.saturating_sub(at)).as_secs_f64() / 3600.0;
            println!(
                "  disk growth after the first {:.0} min: database {:+.2} MB/hour, snapshots {:+.2} MB/hour, files {:+.2} MB/hour",
                at.as_secs_f64() / 60.0,
                growth_per_hour(warm.database, self.storage_end.database, after),
                growth_per_hour(warm.snapshots, self.storage_end.snapshots, after),
                growth_per_hour(warm.blobs, self.storage_end.blobs, after)
            );
        }
        println!(
            "  disk after everyone closed the project: database {:.2} MB, snapshots {:.2} MB in {} files (the server keeps two per project), files {:.2} MB",
            megabytes(self.storage_closed.database),
            megabytes(self.storage_closed.snapshots),
            self.snapshot_files,
            megabytes(self.storage_closed.blobs)
        );
        match self.convergence {
            Some(time) => println!(
                "  final convergence {:.0} ms after typing stopped, {:.1} KB of text in the project",
                time.as_secs_f64() * 1000.0,
                self.text_bytes as f64 / 1024.0
            ),
            None => println!("  final convergence: never"),
        }
        if let Some(data) = &self.data_dir {
            println!("  server data and log kept in {}", data.display());
        }
        println!("  problems: {}", self.problems.len());
        for problem in self.problems.iter().take(25) {
            println!("    problem: {problem}");
        }
    }
}

async fn settled_storage(data: &Path) -> Storage {
    let give_up = Instant::now() + Duration::from_secs(15);
    let mut last = storage(data);
    loop {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let now = storage(data);
        if now == last || Instant::now() > give_up {
            return now;
        }
        last = now;
    }
}

fn files_under(path: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.metadata() {
            Ok(meta) if meta.is_dir() => files_under(&entry.path()),
            Ok(_) => 1,
            Err(_) => 0,
        })
        .sum()
}

fn slope_per_hour(samples: &[ServerSample]) -> f64 {
    let points: Vec<(f64, f64)> = samples
        .iter()
        .filter(|sample| sample.at >= WARM_UP)
        .map(|sample| (sample.at.as_secs_f64() / 3600.0, sample.rss_kb as f64))
        .collect();
    if points.len() < 2 {
        return 0.0;
    }
    let count = points.len() as f64;
    let mean_x = points.iter().map(|point| point.0).sum::<f64>() / count;
    let mean_y = points.iter().map(|point| point.1).sum::<f64>() / count;
    let spread: f64 = points.iter().map(|point| (point.0 - mean_x).powi(2)).sum();
    if spread == 0.0 {
        return 0.0;
    }
    points
        .iter()
        .map(|point| (point.0 - mean_x) * (point.1 - mean_y))
        .sum::<f64>()
        / spread
}

struct Cast {
    people: Vec<Arc<Person>>,
    events: Vec<UnboundedReceiver<LiveEvent>>,
}

#[allow(clippy::too_many_arguments)]
async fn admit(
    index: usize,
    key: Arc<DeviceKey>,
    tokens: &SessionTokens,
    upstream: SocketAddr,
    server_id: ServerId,
    project: SharedProjectId,
    owner: (&ServerClient, &str),
    logs: &Logs,
) -> Result<(Arc<Person>, UnboundedReceiver<LiveEvent>), String> {
    let relay = Relay::start(upstream).await;
    let client = Arc::new(ServerClient::new(relay.url.clone()).map_err(|error| error.to_string())?);
    let sessions = Arc::new(SessionManager::new(
        Arc::new(MemorySecrets::new()),
        Arc::clone(&key),
    ));
    sessions
        .store(server_id, tokens)
        .map_err(|error| error.to_string())?;
    if index > 0 {
        owner
            .0
            .grant_member(owner.1, project, tokens.account_id, ProjectRole::Editor)
            .await
            .map_err(|error| format!("granting {}: {error}", NAMES[index]))?;
    }
    let access = sessions
        .access_token(server_id, &client)
        .await
        .map_err(|error| error.to_string())?;
    let (seq, snapshot) = client
        .get_snapshot(&access, project)
        .await
        .map_err(|error| format!("{} cannot download the project: {error}", NAMES[index]))?;
    let role = if index == 0 {
        ProjectRole::Owner
    } else {
        ProjectRole::Editor
    };
    let live = LiveProject::new(
        ProjectDoc::load(&snapshot).map_err(|error| error.to_string())?,
        seq,
        role,
    );
    let link = LiveLink {
        client,
        server_id,
        project,
        device_id: tokens.device_id,
        key,
        sessions,
    };
    Ok(new_person(index, live, link, Some(relay), logs))
}

fn add_figure(person: &Person, number: u64, hash: &str) -> Result<(), String> {
    let mut live = lock(&person.live);
    live.doc_mut()
        .add_node(
            None,
            &format!("figure-{number:05}.png"),
            NodeKind::Blob,
            Some(hash),
            "",
        )
        .map_err(|error| error.to_string())?;
    drop(live);
    person.flush();
    Ok(())
}

async fn upload_figure(
    person: &Person,
    number: u64,
    kb: usize,
    rng: &mut Rng,
) -> Result<(), String> {
    let bytes: Vec<u8> = (0..kb * 1024).map(|_| rng.below(256) as u8).collect();
    let digest = ring::digest::digest(&ring::digest::SHA256, &bytes);
    let hash: String = digest
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let link = &person.link;
    let access = link
        .sessions
        .access_token(link.server_id, &link.client)
        .await
        .map_err(|error| error.to_string())?;
    link.client
        .put_blob(&access, link.project, &hash, bytes)
        .await
        .map_err(|error| error.to_string())?;
    add_figure(person, number, &hash)
}

async fn head_over_http(
    client: &ServerClient,
    sessions: &SessionManager,
    server_id: ServerId,
    project: SharedProjectId,
) -> u64 {
    let Ok(access) = sessions.access_token(server_id, client).await else {
        return 0;
    };
    client
        .project(&access, project)
        .await
        .map_or(0, |summary| summary.head_seq)
}

pub async fn run(plan: SoakPlan) -> SoakReport {
    let wall = Instant::now();
    let scratch = match &plan.data_dir {
        Some(_) => None,
        None => Some(tempfile::tempdir().expect("a data folder")),
    };
    let data = match (&plan.data_dir, &scratch) {
        (Some(kept), _) => kept.clone(),
        (None, Some(scratch)) => scratch.path().to_path_buf(),
        (None, None) => unreachable!(),
    };
    std::fs::create_dir_all(&data).expect("the data folder");
    let plan_line = format!(
        "crowd soak: {} people ({} on long-poll behind a proxy that blocks WebSockets) over {} files for {:.1} min, {}-{} ms between keystrokes, a network cut every {:?}, a {} KB figure every {:?}, seed {}",
        plan.people,
        plan.long_poll,
        plan.files,
        plan.duration.as_secs_f64() / 60.0,
        plan.pause_ms.0,
        plan.pause_ms.1,
        plan.cut_every,
        plan.figure_kb,
        plan.figure_every,
        plan.seed
    );
    println!("{plan_line}");
    let mut problems = Vec::new();
    let mut config = test_config();
    config.data_dir = data.clone();
    let state = AppState::new(config, Arc::new(SystemClock))
        .await
        .expect("open the server database");
    let mut identities = Vec::new();
    identities.push(identity(&state, NAMES[0], ServerRole::Admin).await);
    for name in NAMES.iter().take(plan.people).skip(1) {
        identities.push(identity(&state, name, ServerRole::Member).await);
    }
    let server_id = state.server_id;
    drop(state);
    let mut server = match ServerProcess::start(&plan.server_bin, &data).await {
        Ok(server) => server,
        Err(problem) => panic!("{problem}"),
    };
    let direct = ServerUrl::parse(&format!("http://{}", server.addr)).expect("server url");
    let owner_client = ServerClient::new(direct).expect("owner client");
    let owner_sessions =
        SessionManager::new(Arc::new(MemorySecrets::new()), Arc::clone(&identities[0].0));
    owner_sessions
        .store(server_id, &identities[0].1)
        .expect("owner session");
    let owner_access = owner_sessions
        .access_token(server_id, &owner_client)
        .await
        .expect("owner access");
    let mut rng = Rng::new(plan.seed);
    let (doc, main_file) = soak_doc(plan.files, &mut rng);
    let project = owner_client
        .create_project(&owner_access, "Soak paper")
        .await
        .expect("create the project")
        .project_id;
    owner_client
        .put_snapshot(&owner_access, project, 0, doc.snapshot().expect("snapshot"))
        .await
        .expect("upload the first snapshot");
    owner_client
        .commit_project(&owner_access, project)
        .await
        .expect("share the project");
    let proxy = BlockingProxy::start(server.addr).await;
    let logs: Logs = Arc::new(Mutex::new(Vec::new()));
    let mut cast = Cast {
        people: Vec::new(),
        events: Vec::new(),
    };
    for (index, (key, tokens)) in identities.iter().enumerate() {
        let long_poll = index >= 1 && index <= plan.long_poll;
        let upstream = if long_poll {
            proxy.address()
        } else {
            server.addr
        };
        match admit(
            index,
            Arc::clone(key),
            tokens,
            upstream,
            server_id,
            project,
            (&owner_client, &owner_access),
            &logs,
        )
        .await
        {
            Ok((person, events)) => {
                if long_poll {
                    person.expect_offline.store(true, Ordering::SeqCst);
                }
                cast.people.push(person);
                cast.events.push(events);
            }
            Err(problem) => problems.push(problem),
        }
    }
    let totals = Arc::new(Mutex::new(Totals::default()));
    let mut watchers: Vec<JoinHandle<()>> = Vec::new();
    for (person, events) in cast.people.iter().zip(cast.events.drain(..)) {
        let long_poll = person.index >= 1 && person.index <= plan.long_poll;
        watchers.push(tokio::spawn(observe(
            Arc::clone(person),
            events,
            Arc::clone(&logs),
            Arc::clone(&totals),
            long_poll,
        )));
        person.go_live();
    }
    let online_by = Instant::now() + Duration::from_secs(60);
    while cast
        .people
        .iter()
        .any(|person| !person.online.load(Ordering::SeqCst))
    {
        if Instant::now() > online_by {
            problems.push("not everyone came online within a minute".to_owned());
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let polling = proxy.refused();
    println!(
        "  everyone is online after {:.1} s, {polling} WebSocket upgrades refused by the proxy",
        wall.elapsed().as_secs_f64()
    );
    let storage_start = storage(&data);
    let (stop, _) = watch::channel(false);
    let mut typists = Vec::new();
    for person in &cast.people {
        let plan = Plan {
            operations: usize::MAX,
            pause_ms: plan.pause_ms,
            seed: plan.seed ^ (person.index as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15),
            tree_edits: true,
            switch_percent: 10,
            single_file: false,
            main_file: main_file.clone(),
            offline: None,
            max_chars: Some(plan.max_chars),
        };
        typists.push(tokio::spawn(type_along(
            Arc::clone(person),
            plan,
            stop.subscribe(),
        )));
    }
    let started = Instant::now();
    let deadline = started + plan.duration;
    let pid = server.pid();
    let mut samples: Vec<ServerSample> = Vec::new();
    let mut next_sample = started;
    let mut next_report = started + plan.report_every;
    let mut next_cut = (plan.cut_every > Duration::ZERO).then(|| started + plan.cut_every);
    let mut next_figure = (plan.figure_every > Duration::ZERO).then(|| started + plan.figure_every);
    let mut cutting: Vec<JoinHandle<()>> = Vec::new();
    let mut last_cpu = sample(pid).map_or(0, |(_, cpu)| cpu);
    let mut last_report = started;
    let mut storage_warm: Option<(Duration, Storage)> = None;
    let cpu_start = last_cpu;
    while Instant::now() < deadline {
        let now = Instant::now();
        if now >= next_sample {
            if let Some((rss_kb, cpu_ms)) = sample(pid) {
                samples.push(ServerSample {
                    at: now.duration_since(started),
                    rss_kb,
                    cpu_ms,
                });
            }
            next_sample = now + SAMPLE_EVERY;
        }
        if next_cut.is_some_and(|at| now >= at) {
            next_cut = Some(now + plan.cut_every);
            let target = Arc::clone(rng.pick(&cast.people));
            if target.online.load(Ordering::SeqCst) {
                let pause =
                    Duration::from_millis(rng.between(plan.cut_for_ms.0, plan.cut_for_ms.1));
                let totals = Arc::clone(&totals);
                lock(&totals).cuts += 1;
                cutting.push(tokio::spawn(async move {
                    let Some(relay) = target.relay.as_ref() else {
                        return;
                    };
                    target.expect_offline.store(true, Ordering::SeqCst);
                    relay.go_offline();
                    tokio::time::sleep(pause).await;
                    let back = Instant::now();
                    relay.go_online();
                    let give_up = back + Duration::from_secs(60);
                    while Instant::now() < give_up {
                        let reconnected = *lock(&target.reconnected_at);
                        if let Some(at) = reconnected.filter(|at| *at >= back) {
                            lock(&totals)
                                .reconnects
                                .record(micros(at.duration_since(back)));
                            return;
                        }
                        tokio::time::sleep(Duration::from_millis(20)).await;
                    }
                    target.problem("did not come back within a minute of a network cut".to_owned());
                }));
            }
        }
        if next_figure.is_some_and(|at| now >= at) {
            next_figure = Some(now + plan.figure_every);
            let number = {
                let totals = lock(&totals);
                totals.figures + totals.figure_failures
            };
            let author = Arc::clone(rng.pick(&cast.people));
            let uploaded = if author.online.load(Ordering::SeqCst) {
                upload_figure(&author, number, plan.figure_kb, &mut rng).await
            } else {
                Err("offline".to_owned())
            };
            let mut totals = lock(&totals);
            match uploaded {
                Ok(()) => totals.figures += 1,
                Err(_) => totals.figure_failures += 1,
            }
        }
        if now >= next_report {
            next_report = now + plan.report_every;
            forget_old_edits(&logs);
            let (rss_kb, cpu_ms) = sample(pid).unwrap_or((0, last_cpu));
            let cores = (cpu_ms.saturating_sub(last_cpu)) as f64
                / now.duration_since(last_report).as_millis().max(1) as f64;
            last_cpu = cpu_ms;
            last_report = now;
            let head = head_over_http(&owner_client, &owner_sessions, server_id, project).await;
            let disk = storage(&data);
            let ran = now.duration_since(started);
            if storage_warm.is_none() && ran >= WARM_UP {
                storage_warm = Some((ran, disk));
            }
            let (socket, poll, onlines) = {
                let mut totals = lock(&totals);
                let window = (
                    totals.window_socket.percentiles(),
                    totals.window_poll.percentiles(),
                    totals.onlines,
                );
                totals.window_socket = LogHistogram::default();
                totals.window_poll = LogHistogram::default();
                window
            };
            let edits: u64 = cast
                .people
                .iter()
                .map(|person| person.edits.load(Ordering::SeqCst))
                .sum();
            let troubled: usize = cast
                .people
                .iter()
                .map(|person| lock(&person.problems).len())
                .sum();
            println!(
                "  [{:>6.1} min] seq {head}, {edits} edits, server RSS {:.1} MB, CPU {:.2} cores, db {:.2} MB, snapshots {:.2} MB, files {:.2} MB, socket p50/p95/p99 {:.0}/{:.0}/{:.0} ms (n={}), long-poll {:.0}/{:.0}/{:.0} ms (n={}), {} reconnects, {troubled} problems",
                now.duration_since(started).as_secs_f64() / 60.0,
                rss_kb as f64 / 1024.0,
                cores,
                megabytes(disk.database),
                megabytes(disk.snapshots),
                megabytes(disk.blobs),
                socket.p50,
                socket.p95,
                socket.p99,
                socket.count,
                poll.p50,
                poll.p95,
                poll.p99,
                poll.count,
                onlines.saturating_sub(cast.people.len() as u64)
            );
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    for task in cutting.drain(..) {
        let _ = tokio::time::timeout(Duration::from_secs(90), task).await;
    }
    for person in &cast.people {
        person.halt.store(true, Ordering::SeqCst);
    }
    let typing_stopped = Instant::now();
    let done_by = Instant::now() + Duration::from_secs(60);
    while cast
        .people
        .iter()
        .any(|person| !person.done.load(Ordering::SeqCst))
    {
        if Instant::now() > done_by {
            problems.push("some typists did not stop within a minute".to_owned());
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let settled = settle_on(
        || head_over_http(&owner_client, &owner_sessions, server_id, project),
        &cast.people,
        Duration::from_secs(180),
    )
    .await;
    let _ = stop.send(true);
    let mut editors: Vec<(usize, Editor)> = Vec::new();
    for (position, typist) in typists.into_iter().enumerate() {
        match typist.await {
            Ok(editor) => editors.push((position, editor)),
            Err(error) => problems.push(format!("a typist task failed: {error}")),
        }
    }
    let convergence = match &settled {
        Ok(at) => Some(at.saturating_duration_since(typing_stopped)),
        Err(problem) => {
            problems.push(problem.clone());
            None
        }
    };
    problems.extend(verify(&cast.people, &editors));
    let text_bytes = {
        let live = lock(&cast.people[0].live);
        live.doc()
            .nodes()
            .unwrap_or_default()
            .iter()
            .filter(|node| node.kind == NodeKind::Text)
            .map(|node| live.doc().text(&node.id).map_or(0, |text| text.len()))
            .sum()
    };
    let head = head_over_http(&owner_client, &owner_sessions, server_id, project).await;
    let final_sample = sample(pid);
    let storage_end = storage(&data);
    let stopping: Vec<JoinHandle<()>> = cast
        .people
        .iter()
        .filter_map(|person| lock(&person.handle).take())
        .map(|handle| tokio::spawn(handle.stopped()))
        .collect();
    for task in stopping {
        let _ = tokio::time::timeout(Duration::from_secs(15), task).await;
    }
    let storage_closed = settled_storage(&data).await;
    let snapshot_files = files_under(&data.join("snapshots"));
    for watcher in &watchers {
        watcher.abort();
    }
    server.stop();
    let warm: Vec<&ServerSample> = samples
        .iter()
        .filter(|sample| sample.at >= WARM_UP)
        .collect();
    let start_rss_kb = warm
        .first()
        .or(samples.first().as_ref())
        .map_or(0, |sample| sample.rss_kb);
    let peak_rss_kb = samples
        .iter()
        .map(|sample| sample.rss_kb)
        .chain(final_sample.map(|(rss, _)| rss))
        .max()
        .unwrap_or(0);
    let end_rss_kb = final_sample
        .map(|(rss, _)| rss)
        .or(samples.last().map(|sample| sample.rss_kb))
        .unwrap_or(0);
    let cpu_end = final_sample
        .map(|(_, cpu)| cpu)
        .or(samples.last().map(|sample| sample.cpu_ms))
        .unwrap_or(cpu_start);
    let totals = lock(&totals);
    for person in &cast.people {
        problems.extend(lock(&person.problems).iter().cloned());
    }
    problems.sort();
    problems.dedup();
    let report = SoakReport {
        plan_line,
        wall: started.elapsed(),
        edits: cast
            .people
            .iter()
            .map(|person| person.edits.load(Ordering::SeqCst))
            .sum(),
        head,
        socket: totals.socket.percentiles(),
        poll: totals.poll.percentiles(),
        ack: totals.ack.percentiles(),
        reconnects: totals.reconnects.percentiles(),
        onlines: totals.onlines,
        people: cast.people.len(),
        cuts: totals.cuts,
        figures: totals.figures,
        figure_failures: totals.figure_failures,
        start_rss_kb,
        peak_rss_kb,
        end_rss_kb,
        rss_slope_kb_per_hour: slope_per_hour(&samples),
        cpu_ms: cpu_end.saturating_sub(cpu_start),
        storage_start,
        storage_warm,
        storage_end,
        storage_closed,
        snapshot_files,
        convergence,
        text_bytes,
        data_dir: plan.data_dir.clone(),
        problems,
    };
    drop(totals);
    drop(proxy);
    drop(scratch);
    report
}
