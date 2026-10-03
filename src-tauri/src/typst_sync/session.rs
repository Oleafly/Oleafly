use std::collections::BTreeMap;
use std::ffi::OsString;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use tokio::time::Instant;

use super::protocol::{self, CompileStatus, DocumentPoint, PreviewEvent, SourcePoint};
use super::ws::{self, Incoming, WsReader, WsWriter};
use crate::proc::{contain_process_tree, isolate_process_tree, NoConsole, ProcessTreeGuard};

const EVENT_CAPACITY: usize = 256;
const RETRY_PAUSE: Duration = Duration::from_millis(100);
const SEND_TIMEOUT: Duration = Duration::from_secs(10);
const START_ATTEMPTS: usize = 3;

#[derive(Clone, Copy, Debug)]
pub(super) struct Timeouts {
    pub(super) connect: Duration,
    pub(super) start: Duration,
    pub(super) compile: Duration,
    pub(super) probe: Duration,
    pub(super) forward_budget: Duration,
    pub(super) inverse_budget: Duration,
    pub(super) stop: Duration,
}

impl Default for Timeouts {
    fn default() -> Self {
        Self {
            connect: Duration::from_secs(2),
            start: Duration::from_secs(20),
            compile: Duration::from_secs(30),
            probe: Duration::from_millis(400),
            forward_budget: Duration::from_secs(4),
            inverse_budget: Duration::from_secs(3),
            stop: Duration::from_secs(2),
        }
    }
}

pub(super) type PortPicker = Arc<dyn Fn() -> std::io::Result<(u16, u16)> + Send + Sync>;

pub(super) fn reserve_ports() -> std::io::Result<(u16, u16)> {
    let data = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))?;
    let control = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))?;
    Ok((data.local_addr()?.port(), control.local_addr()?.port()))
}

fn loopback(port: u16) -> SocketAddr {
    SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Plane {
    Control,
    Data,
}

pub(super) struct Connection {
    control: Arc<tokio::sync::Mutex<WsWriter>>,
    data: Arc<tokio::sync::Mutex<WsWriter>>,
    events: broadcast::Sender<PreviewEvent>,
    alive: Arc<AtomicBool>,
    readers: Vec<JoinHandle<()>>,
}

fn spawn_reader(
    plane: Plane,
    mut reader: WsReader,
    writer: Arc<tokio::sync::Mutex<WsWriter>>,
    events: broadcast::Sender<PreviewEvent>,
    alive: Arc<AtomicBool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            match reader.next().await {
                Ok(Incoming::Message(bytes)) => {
                    let event = match plane {
                        Plane::Control => protocol::parse_control_message(&bytes),
                        Plane::Data => protocol::parse_data_message(&bytes),
                    };
                    if let Some(event) = event {
                        let _ = events.send(event);
                    }
                }
                Ok(Incoming::Ping(payload)) => {
                    if writer.lock().await.send_pong(&payload).await.is_err() {
                        break;
                    }
                }
                Ok(Incoming::Closed) | Err(_) => break,
            }
        }
        alive.store(false, Ordering::Release);
        let _ = events.send(PreviewEvent::Closed);
    })
}

impl Connection {
    pub(super) async fn open(
        control: SocketAddr,
        data: SocketAddr,
        events: broadcast::Sender<PreviewEvent>,
        timeout: Duration,
    ) -> std::io::Result<Self> {
        let alive = Arc::new(AtomicBool::new(true));
        let (control_reader, control_writer) = ws::connect(control, timeout).await?;
        let control_writer = Arc::new(tokio::sync::Mutex::new(control_writer));
        let control_task = spawn_reader(
            Plane::Control,
            control_reader,
            control_writer.clone(),
            events.clone(),
            alive.clone(),
        );
        let (data_reader, data_writer) = match ws::connect(data, timeout).await {
            Ok(pair) => pair,
            Err(error) => {
                control_task.abort();
                return Err(error);
            }
        };
        let data_writer = Arc::new(tokio::sync::Mutex::new(data_writer));
        let data_task = spawn_reader(
            Plane::Data,
            data_reader,
            data_writer.clone(),
            events.clone(),
            alive.clone(),
        );
        Ok(Self {
            control: control_writer,
            data: data_writer,
            events,
            alive,
            readers: vec![control_task, data_task],
        })
    }

    pub(super) fn subscribe(&self) -> broadcast::Receiver<PreviewEvent> {
        self.events.subscribe()
    }

    pub(super) fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Acquire)
    }

    async fn send(&self, plane: Plane, text: &str) -> Result<(), String> {
        let writer = match plane {
            Plane::Control => &self.control,
            Plane::Data => &self.data,
        };
        let sent = tokio::time::timeout(SEND_TIMEOUT, async {
            writer.lock().await.send_text(text).await
        })
        .await;
        match sent {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => {
                self.alive.store(false, Ordering::Release);
                Err(format!(
                    "the Typst preview server connection failed: {error}"
                ))
            }
            Err(_) => {
                self.alive.store(false, Ordering::Release);
                Err("the Typst preview server stopped reading".into())
            }
        }
    }

    pub(super) async fn sync_memory_files(
        &self,
        files: &BTreeMap<String, String>,
        timeout: Duration,
    ) -> Result<(), String> {
        let receiver = self.subscribe();
        self.send(Plane::Control, &protocol::sync_memory_files(files))
            .await?;
        wait_for_compile(receiver, true, timeout).await
    }

    pub(super) async fn forward(
        &self,
        filepath: &str,
        candidates: &[(usize, usize)],
        probe: Duration,
        budget: Duration,
    ) -> Result<Option<DocumentPoint>, String> {
        let deadline = Instant::now() + budget;
        for (line, character) in candidates {
            if Instant::now() >= deadline {
                break;
            }
            let receiver = self.subscribe();
            self.send(
                Plane::Control,
                &protocol::panel_scroll_to(filepath, *line, *character),
            )
            .await?;
            let wait = probe.min(deadline.saturating_duration_since(Instant::now()));
            match next_matching(receiver, wait, |event| match event {
                PreviewEvent::Jump(point) => Some(*point),
                _ => None,
            })
            .await
            {
                Wait::Found(point) => return Ok(Some(point)),
                Wait::Closed => return Err("the Typst preview server stopped".into()),
                Wait::TimedOut => {}
            }
        }
        Ok(None)
    }

    pub(super) async fn inverse(
        &self,
        probes: &[DocumentPoint],
        probe: Duration,
        budget: Duration,
    ) -> Result<Option<SourcePoint>, String> {
        let deadline = Instant::now() + budget;
        for point in probes {
            if Instant::now() >= deadline {
                break;
            }
            let receiver = self.subscribe();
            self.send(Plane::Data, &protocol::src_point(*point)).await?;
            let wait = probe.min(deadline.saturating_duration_since(Instant::now()));
            match next_matching(receiver, wait, |event| match event {
                PreviewEvent::EditorScrollTo(source) => Some(source.clone()),
                _ => None,
            })
            .await
            {
                Wait::Found(source) => return Ok(Some(source)),
                Wait::Closed => return Err("the Typst preview server stopped".into()),
                Wait::TimedOut => {}
            }
        }
        Ok(None)
    }

    pub(super) fn close(&mut self) {
        self.alive.store(false, Ordering::Release);
        for reader in self.readers.drain(..) {
            reader.abort();
        }
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.close();
    }
}

enum Wait<T> {
    Found(T),
    Closed,
    TimedOut,
}

async fn next_matching<T>(
    mut receiver: broadcast::Receiver<PreviewEvent>,
    timeout: Duration,
    mut pick: impl FnMut(&PreviewEvent) -> Option<T>,
) -> Wait<T> {
    let deadline = Instant::now() + timeout;
    loop {
        let event = match tokio::time::timeout_at(deadline, receiver.recv()).await {
            Err(_) => return Wait::TimedOut,
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(broadcast::error::RecvError::Closed)) => return Wait::Closed,
            Ok(Ok(event)) => event,
        };
        if event == PreviewEvent::Closed {
            return Wait::Closed;
        }
        if let Some(found) = pick(&event) {
            return Wait::Found(found);
        }
    }
}

pub(super) async fn wait_for_compile(
    receiver: broadcast::Receiver<PreviewEvent>,
    needs_start: bool,
    timeout: Duration,
) -> Result<(), String> {
    let mut started = !needs_start;
    match next_matching(receiver, timeout, |event| match event {
        PreviewEvent::Compile(CompileStatus::Compiling) => {
            started = true;
            None
        }
        PreviewEvent::Compile(CompileStatus::Success | CompileStatus::Error) if started => Some(()),
        _ => None,
    })
    .await
    {
        Wait::Closed => Err("the Typst preview server stopped".into()),
        Wait::Found(()) | Wait::TimedOut => Ok(()),
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ServerSpec {
    pub(super) program: PathBuf,
    pub(super) root: PathBuf,
    pub(super) main: PathBuf,
    pub(super) environment: Vec<(String, OsString)>,
}

pub(super) fn server_args(spec: &ServerSpec, data_port: u16, control_port: u16) -> Vec<OsString> {
    vec![
        "preview".into(),
        "--data-plane-host".into(),
        loopback(data_port).to_string().into(),
        "--control-plane-host".into(),
        loopback(control_port).to_string().into(),
        "--no-open".into(),
        "--root".into(),
        spec.root.clone().into_os_string(),
        spec.main.clone().into_os_string(),
    ]
}

pub(super) struct KillSwitch {
    #[cfg(test)]
    #[cfg_attr(target_os = "windows", allow(dead_code))]
    pid: u32,
    guard: Mutex<Option<ProcessTreeGuard>>,
}

impl KillSwitch {
    pub(super) fn kill_now(&self) {
        let guard = self
            .guard
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        drop(guard);
    }
}

pub(super) struct ServerProcess {
    child: tokio::process::Child,
    kill: Arc<KillSwitch>,
}

impl ServerProcess {
    pub(super) fn spawn(
        spec: &ServerSpec,
        data_port: u16,
        control_port: u16,
    ) -> Result<Self, String> {
        let mut command = tokio::process::Command::new(&spec.program);
        command
            .no_console()
            .args(server_args(spec, data_port, control_port))
            .current_dir(&spec.root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        for (name, value) in &spec.environment {
            command.env(name, value);
        }
        isolate_process_tree(&mut command);
        let mut child = command
            .spawn()
            .map_err(|error| format!("failed to start the Typst preview server: {error}"))?;
        let Some(pid) = child.id() else {
            let _ = child.start_kill();
            return Err("the Typst preview server exited at once".into());
        };
        let guard = match contain_process_tree(pid) {
            Ok(guard) => guard,
            Err(error) => {
                let _ = child.start_kill();
                return Err(format!(
                    "failed to contain the Typst preview server: {error}"
                ));
            }
        };
        Ok(Self {
            child,
            kill: Arc::new(KillSwitch {
                #[cfg(test)]
                pid,
                guard: Mutex::new(Some(guard)),
            }),
        })
    }

    pub(super) fn kill_switch(&self) -> Arc<KillSwitch> {
        self.kill.clone()
    }

    pub(super) fn running(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    pub(super) async fn stop(mut self, timeout: Duration) {
        self.kill.kill_now();
        let _ = self.child.start_kill();
        let _ = tokio::time::timeout(timeout, self.child.wait()).await;
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct SessionKey {
    pub(super) root: PathBuf,
    pub(super) main: PathBuf,
    pub(super) tinymist: String,
}

pub(super) struct Session {
    pub(super) key: SessionKey,
    pub(super) serial: u64,
    process: ServerProcess,
    connection: Connection,
    pushed: Option<u64>,
}

async fn connect_when_ready(
    process: &mut ServerProcess,
    data_port: u16,
    control_port: u16,
    events: &broadcast::Sender<PreviewEvent>,
    timeouts: &Timeouts,
) -> Result<Connection, String> {
    let deadline = Instant::now() + timeouts.start;
    loop {
        if !process.running() {
            return Err("the Typst preview server exited while starting".into());
        }
        match Connection::open(
            loopback(control_port),
            loopback(data_port),
            events.clone(),
            timeouts.connect,
        )
        .await
        {
            Ok(connection) => return Ok(connection),
            Err(error) if Instant::now() >= deadline => {
                return Err(format!(
                    "the Typst preview server did not start in time: {error}"
                ))
            }
            Err(_) => tokio::time::sleep(RETRY_PAUSE).await,
        }
    }
}

impl Session {
    pub(super) async fn start(
        spec: &ServerSpec,
        key: SessionKey,
        serial: u64,
        ports: &(dyn Fn() -> std::io::Result<(u16, u16)> + Send + Sync),
        timeouts: &Timeouts,
        on_spawn: &(dyn Fn(Arc<KillSwitch>) + Send + Sync),
    ) -> Result<Self, String> {
        let mut last_error = String::from("the Typst preview server could not start");
        for _ in 0..START_ATTEMPTS {
            let (data_port, control_port) = ports()
                .map_err(|error| format!("no free port for the Typst preview server: {error}"))?;
            let mut process = ServerProcess::spawn(spec, data_port, control_port)?;
            on_spawn(process.kill_switch());
            let events = broadcast::channel(EVENT_CAPACITY).0;
            let initial = events.subscribe();
            match connect_when_ready(&mut process, data_port, control_port, &events, timeouts).await
            {
                Ok(connection) => {
                    if let Err(error) = wait_for_compile(initial, false, timeouts.compile).await {
                        last_error = error;
                        process.stop(timeouts.stop).await;
                        continue;
                    }
                    return Ok(Self {
                        key,
                        serial,
                        process,
                        connection,
                        pushed: None,
                    });
                }
                Err(error) => {
                    last_error = error;
                    process.stop(timeouts.stop).await;
                }
            }
        }
        Err(last_error)
    }

    pub(super) fn healthy(&mut self) -> bool {
        self.connection.is_alive() && self.process.running()
    }

    #[cfg(test)]
    #[cfg_attr(target_os = "windows", allow(dead_code))]
    pub(super) fn pid(&self) -> u32 {
        self.process.kill.pid
    }

    pub(super) async fn push_sources(
        &mut self,
        files: &BTreeMap<String, String>,
        timeout: Duration,
    ) -> Result<(), String> {
        let fingerprint = protocol::sources_fingerprint(files);
        if fingerprint == self.pushed {
            return Ok(());
        }
        self.connection.sync_memory_files(files, timeout).await?;
        self.pushed = fingerprint;
        Ok(())
    }

    pub(super) async fn forward(
        &self,
        filepath: &str,
        candidates: &[(usize, usize)],
        timeouts: &Timeouts,
    ) -> Result<Option<DocumentPoint>, String> {
        self.connection
            .forward(
                filepath,
                candidates,
                timeouts.probe,
                timeouts.forward_budget,
            )
            .await
    }

    pub(super) async fn inverse(
        &self,
        probes: &[DocumentPoint],
        timeouts: &Timeouts,
    ) -> Result<Option<SourcePoint>, String> {
        self.connection
            .inverse(probes, timeouts.probe, timeouts.inverse_budget)
            .await
    }

    pub(super) async fn stop(mut self, timeout: Duration) {
        self.connection.close();
        self.process.stop(timeout).await;
    }
}
