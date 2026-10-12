use std::collections::{BTreeSet, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use oleafly_collab_protocol::crypto::verify_ed25519;
use oleafly_collab_protocol::envelope::{Envelope, EnvelopeMode};
use oleafly_collab_protocol::frames::{ClientFrame, FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::{AccountId, DeviceId, ServerId, SharedProjectId};
use oleafly_collab_protocol::projects::{PresenceState, ProjectRole};
use ring::rand::{SecureRandom, SystemRandom};
use serde::Serialize;
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;

use crate::client::{
    connect_socket, keep_polling, post_outbox, Outbox, PollChannel, PollRequest, PollTiming,
    Polled, ServerClient, Socket,
};
use crate::devices::Verdict;
use crate::live::{LiveProject, MergeReport, Outgoing, PeerCheck};
use crate::{CollabError, DeviceKey, SessionManager};

const PING_EVERY: Duration = Duration::from_secs(20);
const PONG_WITHIN: Duration = Duration::from_secs(30);
const SUBSCRIBE_WITHIN: Duration = Duration::from_secs(20);
const SNAPSHOT_EVERY: u64 = 1_000;
const BACKOFF_MS: [u64; 5] = [500, 1_000, 2_000, 3_000, 5_000];
const POLL_QUEUE: usize = 64;
const CLOSE_WITHIN: Duration = Duration::from_secs(2);
const HTTPS_CHECK_WITHIN: Duration = Duration::from_secs(10);

const JITTER_FLOOR_MS: u64 = 100;
const STEADY_AFTER: Duration = Duration::from_secs(10);
const READY_BURST: u32 = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Reached {
    Never,
    Briefly,
    Steady,
}

impl Reached {
    fn after(online: Duration) -> Reached {
        if online >= STEADY_AFTER {
            Reached::Steady
        } else {
            Reached::Briefly
        }
    }
}

fn jittered(cap: u64, random: u64) -> u64 {
    let floor = JITTER_FLOOR_MS.min(cap);
    floor + random % (cap - floor + 1)
}

fn backoff_step(attempt: usize, reached: Reached) -> usize {
    if reached == Reached::Steady {
        0
    } else {
        attempt
    }
}

fn backoff_wait(attempt: usize) -> u64 {
    let mut random = [0u8; 8];
    let _ = SystemRandom::new().fill(&mut random);
    jittered(
        BACKOFF_MS[attempt.min(BACKOFF_MS.len() - 1)],
        u64::from_le_bytes(random),
    )
}

fn should_snapshot(acknowledged: u64) -> bool {
    acknowledged > 0 && acknowledged.is_multiple_of(SNAPSHOT_EVERY)
}

fn snapshot_needed(held: Option<u64>, seq: u64) -> bool {
    held.is_none_or(|held| held < seq)
}

#[derive(Clone)]
pub struct LiveLink {
    pub client: Arc<ServerClient>,
    pub server_id: ServerId,
    pub project: SharedProjectId,
    pub device_id: DeviceId,
    pub key: Arc<DeviceKey>,
    pub sessions: Arc<SessionManager>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EndReason {
    Removed,
    Archived,
    SignedOut,
    Stopped,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum LiveStatus {
    Connecting,
    Online,
    Offline { retry_in_ms: u64 },
    Ended { reason: EndReason },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LiveEvent {
    Status(LiveStatus),
    Role(ProjectRole),
    Changed,
    Presence {
        device_id: DeviceId,
        account_id: AccountId,
        state: PresenceState,
    },
    PresenceLeft {
        device_id: DeviceId,
    },
    Merged(MergeReport),
    Acknowledged,
    NewDevice {
        account_id: AccountId,
        device_id: DeviceId,
    },
    Untrusted {
        device_id: DeviceId,
        seq: u64,
    },
    Unsendable,
}

#[derive(Debug)]
enum LiveCommand {
    Flush,
    Presence(PresenceState),
    LeavePresence,
    Stop,
}

pub struct LiveHandle {
    commands: UnboundedSender<LiveCommand>,
    task: JoinHandle<()>,
}

impl LiveHandle {
    pub fn flush(&self) {
        let _ = self.commands.send(LiveCommand::Flush);
    }

    pub fn presence(&self, state: PresenceState) {
        let _ = self.commands.send(LiveCommand::Presence(state));
    }

    pub fn leave_presence(&self) {
        let _ = self.commands.send(LiveCommand::LeavePresence);
    }

    pub fn stop(&self) {
        let _ = self.commands.send(LiveCommand::Stop);
    }

    pub fn is_finished(&self) -> bool {
        self.task.is_finished()
    }

    pub async fn stopped(self) {
        let _ = self.commands.send(LiveCommand::Stop);
        let _ = self.task.await;
    }
}

pub type SharedLive = Arc<Mutex<LiveProject>>;

fn lock(project: &SharedLive) -> MutexGuard<'_, LiveProject> {
    project.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TransportOptions {
    pub fallback_after: u32,
    pub retry_socket_every: Duration,
}

impl Default for TransportOptions {
    fn default() -> TransportOptions {
        TransportOptions {
            fallback_after: 2,
            retry_socket_every: Duration::from_secs(60),
        }
    }
}

pub fn spawn_live(
    link: LiveLink,
    project: SharedLive,
    events: UnboundedSender<LiveEvent>,
) -> LiveHandle {
    spawn_live_with(link, project, events, TransportOptions::default())
}

pub fn spawn_live_with(
    link: LiveLink,
    project: SharedLive,
    events: UnboundedSender<LiveEvent>,
    options: TransportOptions,
) -> LiveHandle {
    let (commands, receiver) = mpsc::unbounded_channel();
    let task = tokio::spawn(run(link, project, events, receiver, options));
    LiveHandle { commands, task }
}

enum Exit {
    End(EndReason),
    Retry(Reached),
    Switch,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Transport {
    Socket,
    Poll,
}

fn looks_blocked(error: &CollabError) -> bool {
    match error {
        CollabError::Network(_) => true,
        CollabError::Api { status, code, .. } => code == "websocket_refused" && *status != 429,
        _ => false,
    }
}

async fn answers_https(link: &LiveLink) -> bool {
    matches!(
        tokio::time::timeout(HTTPS_CHECK_WITHIN, link.client.capabilities()).await,
        Ok(Ok(_))
    )
}

async fn run(
    link: LiveLink,
    project: SharedLive,
    events: UnboundedSender<LiveEvent>,
    mut commands: UnboundedReceiver<LiveCommand>,
    options: TransportOptions,
) {
    lock(&project).set_device(link.device_id);
    let mut attempt = 0usize;
    let mut transport = Transport::Socket;
    let mut refused = 0u32;
    let limit = options.fallback_after.max(1);
    loop {
        let _ = events.send(LiveEvent::Status(LiveStatus::Connecting));
        let exit = match transport {
            Transport::Socket => match connect(&link).await {
                Ok(socket) => {
                    refused = 0;
                    let wire = Wire::socket(socket);
                    serve(&link, &project, &events, &mut commands, wire, None).await
                }
                Err(CollabError::Unauthorized) => Exit::End(EndReason::SignedOut),
                Err(error) => {
                    if looks_blocked(&error) && answers_https(&link).await {
                        refused += 1;
                    }
                    if refused >= limit {
                        refused = 0;
                        transport = Transport::Poll;
                        Exit::Switch
                    } else {
                        Exit::Retry(Reached::Never)
                    }
                }
            },
            Transport::Poll => {
                let wire = Wire::poll(&link);
                let probe = Some(options.retry_socket_every);
                let exit = serve(&link, &project, &events, &mut commands, wire, probe).await;
                match exit {
                    Exit::Switch => transport = Transport::Socket,
                    Exit::Retry(Reached::Never) => {
                        refused += 1;
                        if refused >= limit {
                            refused = 0;
                            transport = Transport::Socket;
                        }
                    }
                    Exit::Retry(_) => refused = 0,
                    Exit::End(_) => {}
                }
                exit
            }
        };
        lock(&project).disconnected();
        match exit {
            Exit::End(reason) => {
                let _ = events.send(LiveEvent::Status(LiveStatus::Ended { reason }));
                return;
            }
            Exit::Switch => continue,
            Exit::Retry(reached) => attempt = backoff_step(attempt, reached),
        }
        let delay = backoff_wait(attempt);
        attempt = attempt.saturating_add(1);
        let _ = events.send(LiveEvent::Status(LiveStatus::Offline {
            retry_in_ms: delay,
        }));
        let sleep = tokio::time::sleep(Duration::from_millis(delay));
        tokio::pin!(sleep);
        loop {
            tokio::select! {
                () = &mut sleep => break,
                command = commands.recv() => match command {
                    Some(LiveCommand::Stop) | None => {
                        let _ = events.send(LiveEvent::Status(LiveStatus::Ended { reason: EndReason::Stopped }));
                        return;
                    }
                    Some(LiveCommand::Flush | LiveCommand::Presence(_) | LiveCommand::LeavePresence) => {}
                },
            }
        }
    }
}

async fn connect(link: &LiveLink) -> Result<Socket, CollabError> {
    let access = link
        .sessions
        .access_token(link.server_id, &link.client)
        .await?;
    match connect_socket(
        link.client.url(),
        link.server_id,
        &access,
        link.device_id,
        &link.key,
    )
    .await
    {
        Err(CollabError::Unauthorized) => {
            let access = link
                .sessions
                .force_refresh(link.server_id, &link.client)
                .await?;
            connect_socket(
                link.client.url(),
                link.server_id,
                &access,
                link.device_id,
                &link.key,
            )
            .await
            .map(|connection| connection.into_socket())
            .map_err(refused_after_refresh)
        }
        other => other.map(|connection| connection.into_socket()),
    }
}

fn refused_after_refresh(error: CollabError) -> CollabError {
    match error {
        CollabError::Unauthorized => {
            CollabError::Network("the server turned away a session it had just renewed".to_owned())
        }
        other => other,
    }
}

enum Wire {
    Socket {
        sink: SplitSink<Socket, Message>,
        stream: SplitStream<Socket>,
    },
    Poll(Box<PollWire>),
}

fn connection_closed() -> CollabError {
    CollabError::Network("the server closed the connection".to_owned())
}

impl Wire {
    fn socket(socket: Socket) -> Wire {
        let (sink, stream) = socket.split();
        Wire::Socket { sink, stream }
    }

    fn poll(link: &LiveLink) -> Wire {
        Wire::Poll(Box::new(PollWire {
            link: link.clone(),
            channel: None,
            ready: VecDeque::new(),
            incoming: None,
            poller: None,
            outbox: None,
            sender: None,
        }))
    }

    async fn send(&mut self, frame: &ClientFrame) -> Result<(), CollabError> {
        match self {
            Wire::Socket { sink, .. } => {
                let text = serde_json::to_string(frame)
                    .map_err(|error| CollabError::Network(error.to_string()))?;
                sink.send(Message::text(text))
                    .await
                    .map_err(|error| CollabError::Network(error.to_string()))
            }
            Wire::Poll(poll) => poll.send(frame).await,
        }
    }

    async fn next(&mut self) -> Result<ServerFrame, CollabError> {
        let stream = match self {
            Wire::Socket { stream, .. } => stream,
            Wire::Poll(poll) => return poll.next().await,
        };
        while let Some(message) = stream.next().await {
            match message.map_err(|error| CollabError::Network(error.to_string()))? {
                Message::Text(text) => {
                    return serde_json::from_str(text.as_str()).map_err(|error| {
                        CollabError::Network(format!("unreadable frame: {error}"))
                    });
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
        Err(connection_closed())
    }

    async fn close(&mut self) {
        match self {
            Wire::Socket { sink, .. } => {
                let _ = sink.close().await;
            }
            Wire::Poll(poll) => poll.close().await,
        }
    }
}

struct PollWire {
    link: LiveLink,
    channel: Option<PollChannel>,
    ready: VecDeque<ServerFrame>,
    incoming: Option<mpsc::Receiver<Polled>>,
    poller: Option<JoinHandle<()>>,
    outbox: Option<Arc<Outbox>>,
    sender: Option<JoinHandle<()>>,
}

impl Drop for PollWire {
    fn drop(&mut self) {
        self.stop_polling();
    }
}

impl PollWire {
    fn stop_polling(&mut self) {
        for task in [self.poller.take(), self.sender.take()]
            .into_iter()
            .flatten()
        {
            task.abort();
        }
        self.outbox = None;
        self.incoming = None;
    }

    async fn open_with(
        &self,
        access: &str,
        since: u64,
    ) -> Result<crate::client::PollOpen, CollabError> {
        self.link
            .client
            .open_poll(PollRequest {
                server_id: self.link.server_id,
                access_token: access,
                device_id: self.link.device_id,
                key: &self.link.key,
                project: self.link.project,
                since,
            })
            .await
    }

    async fn open(&mut self, since: u64) -> Result<(), CollabError> {
        self.stop_polling();
        self.channel = None;
        let link = &self.link;
        let access = link
            .sessions
            .access_token(link.server_id, &link.client)
            .await?;
        let opened = match self.open_with(&access, since).await {
            Err(CollabError::Unauthorized) => {
                let access = link
                    .sessions
                    .force_refresh(link.server_id, &link.client)
                    .await?;
                self.open_with(&access, since)
                    .await
                    .map_err(refused_after_refresh)?
            }
            other => other?,
        };
        self.ready.extend(opened.frames);
        if let Some((channel, cursor)) = opened.channel {
            let (sender, receiver) = mpsc::channel(POLL_QUEUE);
            let outbox = Arc::new(Outbox::default());
            self.poller = Some(tokio::spawn(keep_polling(
                channel.clone(),
                cursor,
                sender.clone(),
                PollTiming::default(),
            )));
            self.sender = Some(tokio::spawn(post_outbox(
                channel.clone(),
                Arc::clone(&outbox),
                sender,
            )));
            self.outbox = Some(outbox);
            self.incoming = Some(receiver);
            self.channel = Some(channel);
        }
        Ok(())
    }

    async fn send(&mut self, frame: &ClientFrame) -> Result<(), CollabError> {
        if let ClientFrame::Subscribe { since_seq, .. } = frame {
            return self.open(*since_seq).await;
        }
        match (&self.outbox, &self.sender) {
            (Some(outbox), Some(sender)) if !sender.is_finished() => {
                outbox.push(frame.clone());
                Ok(())
            }
            _ => Err(connection_closed()),
        }
    }

    async fn next(&mut self) -> Result<ServerFrame, CollabError> {
        loop {
            if let Some(frame) = self.ready.pop_front() {
                return Ok(frame);
            }
            let incoming = self.incoming.as_mut().ok_or_else(connection_closed)?;
            let frames = incoming.recv().await.ok_or_else(connection_closed)??;
            self.ready.extend(frames);
        }
    }

    async fn close(&mut self) {
        if let Some(poller) = self.poller.take() {
            poller.abort();
        }
        self.incoming = None;
        let leave = ClientFrame::Unsubscribe {
            project_id: self.link.project,
        };
        match (self.outbox.take(), self.sender.take()) {
            (Some(outbox), Some(mut sender)) if !sender.is_finished() => {
                outbox.push(leave);
                if tokio::time::timeout(CLOSE_WITHIN, &mut sender)
                    .await
                    .is_err()
                {
                    sender.abort();
                }
            }
            _ => {
                if let Some(channel) = self.channel.as_ref() {
                    let _ = tokio::time::timeout(CLOSE_WITHIN, channel.send(vec![leave])).await;
                }
            }
        }
        self.channel = None;
    }
}

struct Probe(JoinHandle<()>);

impl Drop for Probe {
    fn drop(&mut self) {
        self.0.abort();
    }
}

async fn probe_socket(link: LiveLink, every: Duration, found: mpsc::Sender<()>) {
    loop {
        tokio::time::sleep(every).await;
        if let Ok(mut socket) = connect(&link).await {
            let _ = socket.close(None).await;
            let _ = found.send(()).await;
            return;
        }
    }
}

fn envelope(link: &LiveLink, outgoing: &Outgoing) -> Envelope {
    let mut envelope = Envelope {
        v: 1,
        project_id: link.project,
        batch_id: outgoing.batch,
        device_id: link.device_id,
        mode: EnvelopeMode::Plain,
        key_epoch: None,
        payload: outgoing.payload.clone(),
        signature: Vec::new(),
    };
    envelope.signature = link.key.sign(&envelope.signing_bytes()).to_vec();
    envelope
}

async fn flush(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    wire: &mut Wire,
) -> Result<(), CollabError> {
    let (outgoing, unsendable) = {
        let mut live = lock(project);
        let outgoing = live.next_outgoing()?;
        (outgoing, live.take_unsendable())
    };
    if unsendable {
        let _ = events.send(LiveEvent::Unsendable);
    }
    if let Some(outgoing) = outgoing {
        wire.send(&ClientFrame::Update {
            project_id: link.project,
            envelope: envelope(link, &outgoing),
        })
        .await?;
    }
    Ok(())
}

async fn subscribe(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    wire: &mut Wire,
) -> Result<Result<(ProjectRole, u64), EndReason>, CollabError> {
    let mut rebased = false;
    for _ in 0..4 {
        let since = lock(project).last_seq();
        wire.send(&ClientFrame::Subscribe {
            project_id: link.project,
            since_seq: since,
        })
        .await?;
        loop {
            let frame = tokio::time::timeout(SUBSCRIBE_WITHIN, wire.next())
                .await
                .map_err(|_| {
                    CollabError::Network("the server did not answer in time".to_owned())
                })??;
            match frame {
                ServerFrame::Subscribed {
                    role,
                    head_seq,
                    since_batch,
                    ..
                } => {
                    if !rebased && lock(project).diverged(head_seq, since_batch) {
                        rebased = true;
                        resync(link, project, events).await?;
                        break;
                    }
                    return Ok(Ok((role, head_seq)));
                }
                ServerFrame::SnapshotRequired { .. } => {
                    let access = link
                        .sessions
                        .access_token(link.server_id, &link.client)
                        .await?;
                    let pinned = lock(project).devices().clone();
                    let verified = crate::snapshots::fetch_verified(
                        &link.client,
                        &access,
                        link.project,
                        &pinned,
                    )
                    .await?;
                    {
                        let mut live = lock(project);
                        if let Some(listed) = verified.listed {
                            live.pin_devices(listed);
                        }
                        if live.last_seq() > 0 {
                            live.begin_catch_up();
                        }
                        live.import_snapshot(verified.seq, &verified.bytes)?;
                    }
                    seed_peers(link, project).await;
                    let _ = events.send(LiveEvent::Changed);
                    break;
                }
                ServerFrame::Error {
                    code: FrameErrorCode::NotFound,
                    ..
                } => return Ok(Err(EndReason::Removed)),
                ServerFrame::ProjectArchived { .. } => return Ok(Err(EndReason::Archived)),
                ServerFrame::SessionRevoked => return Ok(Err(EndReason::SignedOut)),
                ServerFrame::Error { message, .. } => return Err(CollabError::Network(message)),
                _ => {}
            }
        }
    }
    Err(CollabError::Network(
        "the server kept asking for a snapshot".to_owned(),
    ))
}

async fn resync(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
) -> Result<(), CollabError> {
    let access = link
        .sessions
        .access_token(link.server_id, &link.client)
        .await?;
    let pinned = lock(project).devices().clone();
    let verified =
        crate::snapshots::fetch_verified(&link.client, &access, link.project, &pinned).await?;
    {
        let mut live = lock(project);
        if let Some(listed) = verified.listed {
            live.pin_devices(listed);
        }
        live.rebase(verified.seq, &verified.bytes)?;
    }
    seed_peers(link, project).await;
    let _ = events.send(LiveEvent::Changed);
    Ok(())
}

fn hint_snapshot(link: &LiveLink, project: &SharedLive) {
    let seq = {
        let live = lock(project);
        if !live.can_edit() {
            return;
        }
        live.last_seq()
    };
    let link = link.clone();
    tokio::spawn(async move {
        if let Ok(access) = link
            .sessions
            .access_token(link.server_id, &link.client)
            .await
        {
            let held = link.client.snapshot_seq(&access, link.project).await;
            if held.is_ok_and(|held| !snapshot_needed(held, seq)) {
                return;
            }
            let _ = link.client.snapshot_hint(&access, link.project, seq).await;
        }
    });
}

async fn seed_peers(link: &LiveLink, project: &SharedLive) {
    let Ok(access) = link
        .sessions
        .access_token(link.server_id, &link.client)
        .await
    else {
        return;
    };
    if let Ok(listed) = link.client.project_peers(&access, link.project).await {
        lock(project).pin_peers(listed);
    }
}

async fn serve(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    commands: &mut UnboundedReceiver<LiveCommand>,
    mut wire: Wire,
    probe: Option<Duration>,
) -> Exit {
    let exit = serve_wire(link, project, events, commands, &mut wire, probe).await;
    wire.close().await;
    exit
}

async fn serve_wire(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    commands: &mut UnboundedReceiver<LiveCommand>,
    wire: &mut Wire,
    probe: Option<Duration>,
) -> Exit {
    let (role, head) = match subscribe(link, project, events, wire).await {
        Ok(Ok(subscribed)) => subscribed,
        Ok(Err(reason)) => return Exit::End(reason),
        Err(CollabError::Unauthorized) => return Exit::End(EndReason::SignedOut),
        Err(_) => return Exit::Retry(Reached::Never),
    };
    if !lock(project).peers_vouched() {
        seed_peers(link, project).await;
    }
    let catching_up = {
        let mut live = lock(project);
        live.set_role(role);
        let behind = live.last_seq() < head;
        if behind && live.last_seq() > 0 {
            live.begin_catch_up();
        }
        behind.then_some(head)
    };
    if catching_up.is_none() {
        report_merged(project, events);
    }
    let _ = events.send(LiveEvent::Role(role));
    let _ = events.send(LiveEvent::Status(LiveStatus::Online));
    let started = tokio::time::Instant::now();
    match online(link, project, events, commands, wire, catching_up, probe).await {
        Exit::Retry(_) => Exit::Retry(Reached::after(started.elapsed())),
        other => other,
    }
}

enum Trust {
    Signed(Option<AccountId>),
    Refused,
    Unreachable,
}

#[derive(Default)]
struct Refreshed {
    devices: BTreeSet<DeviceId>,
    peers: BTreeSet<u64>,
}

async fn trust(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    refreshed: &mut Refreshed,
    envelope: &Envelope,
    claimed: Option<AccountId>,
) -> Trust {
    match signature_trust(
        link,
        project,
        events,
        &mut refreshed.devices,
        envelope,
        claimed,
    )
    .await
    {
        Trust::Signed(author) => {
            match peer_trust(link, project, &mut refreshed.peers, envelope).await {
                Trust::Signed(_) => Trust::Signed(author),
                other => other,
            }
        }
        other => other,
    }
}

async fn peer_trust(
    link: &LiveLink,
    project: &SharedLive,
    refreshed: &mut BTreeSet<u64>,
    envelope: &Envelope,
) -> Trust {
    let unknown = match lock(project).check_peers(&envelope.payload, envelope.device_id) {
        PeerCheck::Fine => return Trust::Signed(None),
        PeerCheck::Refused => return Trust::Refused,
        PeerCheck::Unknown(unknown) => unknown,
    };
    if unknown.iter().all(|peer| refreshed.contains(peer)) {
        return Trust::Signed(None);
    }
    refreshed.extend(unknown);
    let listed = match link
        .sessions
        .access_token(link.server_id, &link.client)
        .await
    {
        Ok(access) => link.client.project_peers(&access, link.project).await,
        Err(error) => Err(error),
    };
    match listed {
        Ok(listed) => {
            let mut live = lock(project);
            live.pin_peers(listed);
            match live.check_peers(&envelope.payload, envelope.device_id) {
                PeerCheck::Refused => Trust::Refused,
                PeerCheck::Fine | PeerCheck::Unknown(_) => Trust::Signed(None),
            }
        }
        Err(CollabError::Api { status: 404, .. }) => Trust::Signed(None),
        Err(_) => Trust::Unreachable,
    }
}

async fn signature_trust(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    refreshed: &mut BTreeSet<DeviceId>,
    envelope: &Envelope,
    claimed: Option<AccountId>,
) -> Trust {
    if envelope.project_id != link.project {
        return Trust::Refused;
    }
    if envelope.device_id == link.device_id {
        let own = verify_ed25519(
            &link.key.public_key(),
            &envelope.signing_bytes(),
            &envelope.signature,
        );
        return if own {
            Trust::Signed(claimed)
        } else {
            Trust::Refused
        };
    }
    let verdict = lock(project).devices().verify(envelope, claimed);
    match verdict {
        Verdict::Signed(account) => return Trust::Signed(Some(account)),
        Verdict::Forged => return Trust::Refused,
        Verdict::Unknown if !refreshed.insert(envelope.device_id) => return Trust::Refused,
        Verdict::Unknown => {}
    }
    let listed = match link
        .sessions
        .access_token(link.server_id, &link.client)
        .await
    {
        Ok(access) => link.client.project_devices(&access, link.project).await,
        Err(error) => Err(error),
    };
    let Ok(listed) = listed else {
        return Trust::Unreachable;
    };
    let (announced, verdict) = {
        let mut live = lock(project);
        let announced = live.pin_devices(listed);
        (announced, live.devices().verify(envelope, claimed))
    };
    for device in announced {
        let _ = events.send(LiveEvent::NewDevice {
            account_id: device.account_id,
            device_id: device.device_id,
        });
    }
    match verdict {
        Verdict::Signed(account) => Trust::Signed(Some(account)),
        Verdict::Unknown | Verdict::Forged => Trust::Refused,
    }
}

fn report_merged(project: &SharedLive, events: &UnboundedSender<LiveEvent>) {
    if let Some(report) = lock(project).end_catch_up() {
        let _ = events.send(LiveEvent::Merged(report));
    }
}

async fn online(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    commands: &mut UnboundedReceiver<LiveCommand>,
    wire: &mut Wire,
    mut catching_up: Option<u64>,
    probe: Option<Duration>,
) -> Exit {
    let retry = Exit::Retry(Reached::Briefly);
    if flush(link, project, events, wire).await.is_err() {
        return retry;
    }
    let (found_tx, mut found) = mpsc::channel::<()>(1);
    let _probe = probe.map(|every| {
        Probe(tokio::spawn(probe_socket(
            link.clone(),
            every,
            found_tx.clone(),
        )))
    });
    let mut ping = tokio::time::interval(PING_EVERY);
    ping.tick().await;
    let mut ping_id = 0u64;
    let mut last_heard = tokio::time::Instant::now();
    let mut since_snapshot = 0u64;
    let mut refreshed = Refreshed::default();
    let mut burst = 0u32;
    loop {
        tokio::select! {
            biased;
            frame = wire.next(), if burst < READY_BURST => {
                burst += 1;
                let Ok(frame) = frame else { return retry };
                last_heard = tokio::time::Instant::now();
                match frame {
                    ServerFrame::Update { seq, account_id, envelope, .. } => {
                        lock(project).note_batch(seq, envelope.batch_id);
                        match trust(link, project, events, &mut refreshed, &envelope, account_id).await {
                            Trust::Signed(author) => {
                                let imported = lock(project).import_signed(seq, &envelope.payload, Some(envelope.device_id), author);
                                match imported {
                                    Ok(true) => {
                                        let _ = events.send(LiveEvent::Changed);
                                        since_snapshot += 1;
                                    }
                                    Ok(false) => {}
                                    Err(_) => return retry,
                                }
                            }
                            Trust::Refused => {
                                lock(project).skip_update(seq);
                                let _ = events.send(LiveEvent::Untrusted { device_id: envelope.device_id, seq });
                            }
                            Trust::Unreachable => return retry,
                        }
                        if catching_up.is_some_and(|head| seq >= head) {
                            catching_up = None;
                            report_merged(project, events);
                        }
                        let more = lock(project).sendable_now();
                        if more && flush(link, project, events, wire).await.is_err() {
                            return retry;
                        }
                    }
                    ServerFrame::Ack { batch_id, seq, .. } => {
                        {
                            let mut live = lock(project);
                            live.acknowledged(batch_id, seq);
                            live.bind_own_peer(link.device_id);
                        }
                        let _ = events.send(LiveEvent::Acknowledged);
                        since_snapshot += 1;
                        if should_snapshot(seq) {
                            since_snapshot = 0;
                            hint_snapshot(link, project);
                        }
                        if flush(link, project, events, wire).await.is_err() {
                            return retry;
                        }
                    }
                    ServerFrame::Presence { device_id, account_id, state, .. } => {
                        let _ = events.send(LiveEvent::Presence { device_id, account_id, state });
                    }
                    ServerFrame::PresenceLeft { device_id, .. } => {
                        let _ = events.send(LiveEvent::PresenceLeft { device_id });
                    }
                    ServerFrame::AccessChanged { role: Some(role), .. } => {
                        lock(project).set_role(role);
                        let _ = events.send(LiveEvent::Role(role));
                    }
                    ServerFrame::AccessChanged { role: None, .. } => return Exit::End(EndReason::Removed),
                    ServerFrame::ProjectArchived { .. } => return Exit::End(EndReason::Archived),
                    ServerFrame::SessionRevoked => return Exit::End(EndReason::SignedOut),
                    ServerFrame::Error { code: FrameErrorCode::TooLarge, .. } => {
                        lock(project).too_large();
                        if flush(link, project, events, wire).await.is_err() {
                            return retry;
                        }
                    }
                    ServerFrame::Error { code: FrameErrorCode::Forbidden, .. } => {
                        lock(project).refused();
                    }
                    ServerFrame::Error { .. } => return retry,
                    _ => {}
                }
            }
            command = commands.recv() => {
                burst = 0;
                match command {
                    Some(LiveCommand::Flush) => {
                        if flush(link, project, events, wire).await.is_err() {
                            return retry;
                        }
                    }
                    Some(LiveCommand::Presence(state)) => {
                        let frame = ClientFrame::Presence { project_id: link.project, state };
                        if wire.send(&frame).await.is_err() {
                            return retry;
                        }
                    }
                    Some(LiveCommand::LeavePresence) => {
                        let frame = ClientFrame::PresenceLeave { project_id: link.project };
                        if wire.send(&frame).await.is_err() {
                            return retry;
                        }
                    }
                    Some(LiveCommand::Stop) | None => {
                        if lock(project).can_edit() && since_snapshot > 0 {
                            hint_snapshot(link, project);
                        }
                        return Exit::End(EndReason::Stopped);
                    }
                }
            }
            Some(()) = found.recv() => return Exit::Switch,
            _ = ping.tick() => {
                burst = 0;
                if last_heard.elapsed() > PONG_WITHIN {
                    return retry;
                }
                ping_id += 1;
                if wire.send(&ClientFrame::Ping { id: ping_id }).await.is_err() {
                    return retry;
                }
            }
            () = std::future::ready(()), if burst >= READY_BURST => burst = 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_change_that_lands_on_the_interval_uploads_a_snapshot() {
        assert!(!should_snapshot(0));
        assert!(!should_snapshot(SNAPSHOT_EVERY - 1));
        assert!(should_snapshot(SNAPSHOT_EVERY));
        assert!(!should_snapshot(SNAPSHOT_EVERY + 1));
        assert!(should_snapshot(SNAPSHOT_EVERY * 3));
        assert_eq!(SNAPSHOT_EVERY, 1_000);
    }

    #[test]
    fn a_snapshot_the_server_already_holds_is_not_sent_again() {
        assert!(snapshot_needed(None, 0));
        assert!(snapshot_needed(Some(999), 1_000));
        assert!(!snapshot_needed(Some(1_000), 1_000));
        assert!(!snapshot_needed(Some(2_000), 1_000));
    }

    #[test]
    fn reconnecting_never_waits_more_than_five_seconds() {
        assert_eq!(BACKOFF_MS.iter().max(), Some(&5_000));
    }
    use crate::client::test_util::{
        another_alice_device, canned, http_response, noise, two_people, Pair, Person,
    };
    use crate::doc::{NodeKind, ProjectDoc};
    use crate::editor::DocMessage;
    use crate::live::DocSink;
    use crate::ot::TextOperation;

    const WAIT: Duration = Duration::from_secs(10);

    struct Side {
        live: SharedLive,
        events: UnboundedReceiver<LiveEvent>,
        handle: Option<LiveHandle>,
        messages: UnboundedReceiver<DocMessage>,
        events_tx: UnboundedSender<LiveEvent>,
    }

    fn link(pair: &Pair, person: &Person, project: SharedProjectId) -> LiveLink {
        LiveLink {
            client: Arc::new(ServerClient::new(pair.url.clone()).unwrap()),
            server_id: pair.server_id,
            project,
            device_id: person.tokens.device_id,
            key: Arc::clone(&person.key),
            sessions: Arc::clone(&person.sessions),
        }
    }

    fn side(live: LiveProject, main: &str) -> Side {
        let live = Arc::new(Mutex::new(live));
        let (messages_tx, messages) = mpsc::unbounded_channel();
        let sink: DocSink = Arc::new(move |message| {
            let _ = messages_tx.send(message);
        });
        lock(&live).open_file(main, sink).unwrap();
        let (events_tx, events) = mpsc::unbounded_channel();
        Side {
            live,
            events,
            handle: None,
            messages,
            events_tx,
        }
    }

    fn start(side: &mut Side, link: LiveLink) {
        side.handle = Some(spawn_live(
            link,
            Arc::clone(&side.live),
            side.events_tx.clone(),
        ));
    }

    async fn until_status(side: &mut Side, wanted: LiveStatus) {
        tokio::time::timeout(WAIT, async {
            while let Some(event) = side.events.recv().await {
                if event == LiveEvent::Status(wanted.clone()) {
                    return;
                }
            }
        })
        .await
        .expect("the status arrived");
    }

    async fn next_message(side: &mut Side) -> DocMessage {
        tokio::time::timeout(WAIT, side.messages.recv())
            .await
            .expect("a message arrived")
            .expect("the channel is open")
    }

    fn insert(position: usize, text: &str, length: usize) -> TextOperation {
        let mut operation = TextOperation::new();
        operation
            .retain(position)
            .insert(text)
            .retain(length - position);
        operation
    }

    async fn shared(pair: &Pair) -> (SharedProjectId, String, LiveProject, LiveProject) {
        let client = ServerClient::new(pair.url.clone()).unwrap();
        let bob = &pair.bob.tokens.access_token;
        let alice = &pair.alice.tokens.access_token;
        let mut doc = ProjectDoc::create().unwrap();
        let main = doc
            .add_node(None, "main.tex", NodeKind::Text, None, "abc")
            .unwrap();
        let project = client
            .create_project(bob, "Thesis")
            .await
            .unwrap()
            .project_id;
        client
            .put_snapshot(bob, project, 0, doc.snapshot().unwrap())
            .await
            .unwrap();
        client.commit_project(bob, project).await.unwrap();
        client
            .grant_member(
                bob,
                project,
                pair.alice.tokens.account_id,
                ProjectRole::Editor,
            )
            .await
            .unwrap();
        let (seq, snapshot) = client.get_snapshot(alice, project).await.unwrap();
        let joined = LiveProject::new(
            ProjectDoc::load(&snapshot).unwrap(),
            seq,
            ProjectRole::Editor,
        );
        (
            project,
            main,
            LiveProject::new(doc, 0, ProjectRole::Owner),
            joined,
        )
    }

    fn text(side: &Side, main: &str) -> String {
        lock(&side.live).doc().text(main).unwrap()
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn two_editors_see_each_others_typing_through_the_server() {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start(&mut bob, link(&pair, &pair.bob, project));
        start(&mut alice, link(&pair, &pair.alice, project));
        until_status(&mut bob, LiveStatus::Online).await;
        until_status(&mut alice, LiveStatus::Online).await;
        lock(&bob.live)
            .editor_change(&main, 0, insert(3, "d", 3))
            .unwrap();
        bob.handle.as_ref().unwrap().flush();
        assert_eq!(
            next_message(&mut bob).await,
            DocMessage::Ack { rev: 1, length: 4 }
        );
        assert_eq!(
            next_message(&mut alice).await,
            DocMessage::Remote {
                rev: 1,
                op: insert(3, "d", 3),
                length: 4
            }
        );
        lock(&alice.live)
            .editor_change(&main, 1, insert(0, "!", 4))
            .unwrap();
        alice.handle.as_ref().unwrap().flush();
        assert_eq!(
            next_message(&mut bob).await,
            DocMessage::Remote {
                rev: 2,
                op: insert(0, "!", 4),
                length: 5
            }
        );
        assert_eq!(text(&bob, &main), "!abcd");
        assert_eq!(text(&alice, &main), "!abcd");
        let here = PresenceState {
            file_id: Some(main.clone()),
            cursor: Some(2),
            anchor: None,
        };
        alice.handle.as_ref().unwrap().presence(here.clone());
        tokio::time::timeout(WAIT, async {
            while let Some(event) = bob.events.recv().await {
                if let LiveEvent::Presence { state, .. } = event {
                    assert_eq!(state, here);
                    return;
                }
            }
        })
        .await
        .expect("presence arrived");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn hiding_tells_the_others_this_device_left_after_its_last_presence() {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start(&mut bob, link(&pair, &pair.bob, project));
        start(&mut alice, link(&pair, &pair.alice, project));
        until_status(&mut bob, LiveStatus::Online).await;
        until_status(&mut alice, LiveStatus::Online).await;
        let handle = alice.handle.as_ref().unwrap();
        handle.presence(PresenceState {
            file_id: Some(main.clone()),
            cursor: Some(1),
            anchor: None,
        });
        handle.leave_presence();
        let device = pair.alice.tokens.device_id;
        tokio::time::timeout(WAIT, async {
            let mut placed = false;
            while let Some(event) = bob.events.recv().await {
                match event {
                    LiveEvent::Presence {
                        device_id, state, ..
                    } if device_id == device => {
                        placed = state.cursor == Some(1);
                    }
                    LiveEvent::PresenceLeft { device_id } if device_id == device => {
                        assert!(placed, "the leave arrived after the last presence");
                        return;
                    }
                    _ => {}
                }
            }
        })
        .await
        .expect("the leave arrived");
        assert!(!alice.handle.as_ref().unwrap().is_finished());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn an_acknowledged_change_is_reported_so_waiting_counts_can_update() {
        let pair = two_people().await;
        let (project, main, bob_live, _alice_live) = shared(&pair).await;
        let mut bob = side(bob_live, &main);
        start(&mut bob, link(&pair, &pair.bob, project));
        until_status(&mut bob, LiveStatus::Online).await;
        lock(&bob.live)
            .editor_change(&main, 0, insert(0, "x", 3))
            .unwrap();
        bob.handle.as_ref().unwrap().flush();
        tokio::time::timeout(WAIT, async {
            while let Some(event) = bob.events.recv().await {
                if event == LiveEvent::Acknowledged {
                    return;
                }
            }
        })
        .await
        .expect("the acknowledgement was reported");
        assert_eq!(lock(&bob.live).pending_changes(), 0);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn edits_made_offline_sync_after_reconnecting() {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start(&mut bob, link(&pair, &pair.bob, project));
        until_status(&mut bob, LiveStatus::Online).await;
        lock(&alice.live)
            .editor_change(&main, 0, insert(0, "offline ", 3))
            .unwrap();
        lock(&bob.live)
            .editor_change(&main, 0, insert(3, " online", 3))
            .unwrap();
        bob.handle.as_ref().unwrap().flush();
        assert!(matches!(
            next_message(&mut bob).await,
            DocMessage::Ack { .. }
        ));
        start(&mut alice, link(&pair, &pair.alice, project));
        until_status(&mut alice, LiveStatus::Online).await;
        tokio::time::timeout(WAIT, async {
            loop {
                if text(&bob, &main) == "offline abc online"
                    && text(&alice, &main) == text(&bob, &main)
                {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("both sides converged");
        assert!(!lock(&alice.live).has_unsent());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_removed_person_is_told_and_stops_syncing() {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let _bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start(&mut alice, link(&pair, &pair.alice, project));
        until_status(&mut alice, LiveStatus::Online).await;
        let client = ServerClient::new(pair.url.clone()).unwrap();
        client
            .remove_member(
                &pair.bob.tokens.access_token,
                project,
                pair.alice.tokens.account_id,
            )
            .await
            .unwrap();
        until_status(
            &mut alice,
            LiveStatus::Ended {
                reason: EndReason::Removed,
            },
        )
        .await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_person_far_behind_catches_up_from_the_snapshot() {
        let pair = two_people().await;
        snapshot_often(&pair);
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start(&mut bob, link(&pair, &pair.bob, project));
        until_status(&mut bob, LiveStatus::Online).await;
        for (rev, letter) in ["x", "y", "z"].into_iter().enumerate() {
            let length = 3 + rev;
            lock(&bob.live)
                .editor_change(&main, rev as u64, insert(length, letter, length))
                .unwrap();
            bob.handle.as_ref().unwrap().flush();
            assert!(matches!(
                next_message(&mut bob).await,
                DocMessage::Ack { .. }
            ));
            tokio::time::timeout(WAIT, async {
                while lock(&bob.live).has_unsent() {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("acknowledged");
        }
        let client = ServerClient::new(pair.url.clone()).unwrap();
        let snapshot = lock(&bob.live).doc().snapshot().unwrap();
        for seq in [2, 3] {
            client
                .put_snapshot(
                    &pair.bob.tokens.access_token,
                    project,
                    seq,
                    snapshot.clone(),
                )
                .await
                .unwrap();
        }
        start(&mut alice, link(&pair, &pair.alice, project));
        until_status(&mut alice, LiveStatus::Online).await;
        assert_eq!(text(&alice, &main), "abcxyz");
        assert_eq!(lock(&alice.live).last_seq(), 3);
    }

    async fn until_text(side: &Side, main: &str, wanted: &str) {
        tokio::time::timeout(WAIT, async {
            while text(side, main) != wanted {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap_or_else(|_| panic!("the text never became {wanted:?}"));
    }

    async fn until_event(side: &mut Side, wanted: impl Fn(&LiveEvent) -> bool) -> LiveEvent {
        tokio::time::timeout(WAIT, async {
            while let Some(event) = side.events.recv().await {
                if wanted(&event) {
                    return event;
                }
            }
            panic!("the events ended");
        })
        .await
        .expect("the event arrived")
    }

    fn signed_envelope(person: &Person, project: SharedProjectId, payload: Vec<u8>) -> Envelope {
        let mut envelope = Envelope {
            v: 1,
            project_id: project,
            batch_id: oleafly_collab_protocol::ids::BatchId::new_v7(),
            device_id: person.tokens.device_id,
            mode: EnvelopeMode::Plain,
            key_epoch: None,
            payload,
            signature: Vec::new(),
        };
        envelope.signature = person.key.sign(&envelope.signing_bytes()).to_vec();
        envelope
    }

    async fn store_on_server(pair: &Pair, person: &Person, envelope: Envelope) {
        let project = envelope.project_id;
        store_in_project(pair, person, project, envelope).await;
    }

    async fn store_in_project(
        pair: &Pair,
        person: &Person,
        project: SharedProjectId,
        envelope: Envelope,
    ) {
        let (device, account) = (person.tokens.device_id, person.tokens.account_id);
        pair._server
            .state()
            .db
            .call(move |conn| {
                let stored = serde_json::to_vec(&envelope).unwrap();
                if let Some(reach) = oleafly_server::peers::update_reach(&envelope.payload) {
                    oleafly_server::peers::bind(conn, project, device, account, &reach, 1)?;
                }
                oleafly_server::projects::append_update(
                    conn,
                    project,
                    envelope.batch_id,
                    device,
                    account,
                    &stored,
                    1,
                )
            })
            .await
            .expect("stored");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_device_seen_first_is_checked_after_one_refresh_and_a_later_one_is_announced() {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start(&mut bob, link(&pair, &pair.bob, project));
        start(&mut alice, link(&pair, &pair.alice, project));
        until_status(&mut bob, LiveStatus::Online).await;
        until_status(&mut alice, LiveStatus::Online).await;
        assert!(lock(&bob.live).devices().is_empty());
        lock(&alice.live)
            .editor_change(&main, 0, insert(0, "!", 3))
            .unwrap();
        alice.handle.as_ref().unwrap().flush();
        assert_eq!(
            next_message(&mut bob).await,
            DocMessage::Remote {
                rev: 1,
                op: insert(0, "!", 3),
                length: 4
            }
        );
        assert_eq!(
            lock(&bob.live)
                .devices()
                .account_of(pair.alice.tokens.device_id),
            Some(pair.alice.tokens.account_id)
        );
        while let Ok(event) = bob.events.try_recv() {
            assert!(!matches!(event, LiveEvent::NewDevice { .. }), "{event:?}");
        }
        let second = another_alice_device(&pair).await;
        let client = ServerClient::new(pair.url.clone()).unwrap();
        let (seq, snapshot) = client
            .get_snapshot(&second.tokens.access_token, project)
            .await
            .unwrap();
        let mut tablet = side(
            LiveProject::new(
                ProjectDoc::load(&snapshot).unwrap(),
                seq,
                ProjectRole::Editor,
            ),
            &main,
        );
        start(&mut tablet, link(&pair, &second, project));
        until_text(&tablet, &main, "!abc").await;
        assert!(matches!(
            next_message(&mut tablet).await,
            DocMessage::Remote { rev: 1, .. }
        ));
        lock(&tablet.live)
            .editor_change(&main, 1, insert(4, "?", 4))
            .unwrap();
        tablet.handle.as_ref().unwrap().flush();
        let announced = until_event(&mut bob, |event| {
            matches!(event, LiveEvent::NewDevice { .. })
        })
        .await;
        assert_eq!(
            announced,
            LiveEvent::NewDevice {
                account_id: pair.alice.tokens.account_id,
                device_id: second.tokens.device_id,
            }
        );
        until_text(&bob, &main, "!abc?").await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_badly_signed_update_is_refused_and_syncing_goes_on() {
        let pair = two_people().await;
        let (project, main, bob_live, mut alice_live) = shared(&pair).await;
        let client = ServerClient::new(pair.url.clone()).unwrap();
        let (_, snapshot) = client
            .get_snapshot(&pair.alice.tokens.access_token, project)
            .await
            .unwrap();
        let mut forger =
            LiveProject::new(ProjectDoc::load(&snapshot).unwrap(), 0, ProjectRole::Editor);
        forger.local_text(&main, "EVILabc").unwrap();
        let forged = forger.next_outgoing().unwrap().unwrap().payload;
        alice_live.local_text(&main, "abcX").unwrap();
        let honest = alice_live.next_outgoing().unwrap().unwrap().payload;
        let mut tampered = signed_envelope(&pair.alice, project, honest.clone());
        tampered.payload = forged;
        store_on_server(&pair, &pair.alice, tampered).await;
        store_on_server(
            &pair,
            &pair.alice,
            signed_envelope(&pair.alice, project, honest),
        )
        .await;
        let mut bob = side(bob_live, &main);
        start(&mut bob, link(&pair, &pair.bob, project));
        let refused = until_event(&mut bob, |event| {
            matches!(event, LiveEvent::Untrusted { .. })
        })
        .await;
        assert_eq!(
            refused,
            LiveEvent::Untrusted {
                device_id: pair.alice.tokens.device_id,
                seq: 1,
            }
        );
        until_text(&bob, &main, "abcX").await;
        assert_eq!(lock(&bob.live).last_seq(), 2);
        lock(&bob.live)
            .editor_change(&main, 1, insert(4, "!", 4))
            .unwrap();
        bob.handle.as_ref().unwrap().flush();
        until_event(&mut bob, |event| *event == LiveEvent::Acknowledged).await;
        assert_eq!(text(&bob, &main), "abcX!");
        assert!(!bob.handle.as_ref().unwrap().is_finished());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_device_list_the_server_cannot_give_never_drops_an_update() {
        let pair = two_people().await;
        let (project, main, bob_live, mut alice_live) = shared(&pair).await;
        alice_live.local_text(&main, "abcX").unwrap();
        let payload = alice_live.next_outgoing().unwrap().unwrap().payload;
        let envelope = signed_envelope(&pair.alice, project, payload);
        let bob = side(bob_live, &main);
        for status in [
            "404 Not Found",
            "403 Forbidden",
            "400 Bad Request",
            "200 OK",
        ] {
            let body = if status.starts_with("200") {
                "not json"
            } else {
                r#"{"code":"not_found","message":"Not found."}"#
            };
            let answer = canned(http_response(
                status,
                &[("content-type", "application/json")],
                body,
            ))
            .await;
            let mut older = link(&pair, &pair.bob, project);
            older.client = Arc::new(ServerClient::new(answer).unwrap());
            let verdict = trust(
                &older,
                &bob.live,
                &bob.events_tx,
                &mut Refreshed::default(),
                &envelope,
                Some(pair.alice.tokens.account_id),
            )
            .await;
            assert!(
                matches!(verdict, Trust::Unreachable),
                "{status} must retry, not refuse"
            );
        }
        assert_eq!(lock(&bob.live).last_seq(), 0);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn an_update_signed_for_another_project_is_refused() {
        let pair = two_people().await;
        let (project, main, bob_live, mut alice_live) = shared(&pair).await;
        alice_live.local_text(&main, "abcX").unwrap();
        let payload = alice_live.next_outgoing().unwrap().unwrap().payload;
        let elsewhere = signed_envelope(&pair.alice, SharedProjectId::new_v7(), payload.clone());
        store_in_project(&pair, &pair.alice, project, elsewhere).await;
        store_on_server(
            &pair,
            &pair.alice,
            signed_envelope(&pair.alice, project, payload),
        )
        .await;
        let mut bob = side(bob_live, &main);
        start(&mut bob, link(&pair, &pair.bob, project));
        let refused = until_event(&mut bob, |event| {
            matches!(event, LiveEvent::Untrusted { .. })
        })
        .await;
        assert_eq!(
            refused,
            LiveEvent::Untrusted {
                device_id: pair.alice.tokens.device_id,
                seq: 1,
            }
        );
        until_text(&bob, &main, "abcX").await;
        assert_eq!(lock(&bob.live).last_seq(), 2);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn catching_up_after_time_away_reports_who_changed_which_file_and_how() {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start(&mut bob, link(&pair, &pair.bob, project));
        start(&mut alice, link(&pair, &pair.alice, project));
        until_status(&mut alice, LiveStatus::Online).await;
        lock(&alice.live)
            .editor_change(&main, 0, insert(0, "!", 3))
            .unwrap();
        alice.handle.as_ref().unwrap().flush();
        assert!(matches!(
            next_message(&mut alice).await,
            DocMessage::Ack { .. }
        ));
        until_text(&bob, &main, "!abc").await;
        tokio::time::timeout(WAIT, async {
            while lock(&alice.live).has_unsent() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("acknowledged");
        alice.handle.take().unwrap().stopped().await;
        assert!(matches!(
            next_message(&mut bob).await,
            DocMessage::Remote { .. }
        ));
        for (rev, letter) in ["d", "e"].into_iter().enumerate() {
            let length = 4 + rev;
            lock(&bob.live)
                .editor_change(&main, 1 + rev as u64, insert(length, letter, length))
                .unwrap();
            bob.handle.as_ref().unwrap().flush();
            assert!(matches!(
                next_message(&mut bob).await,
                DocMessage::Ack { .. }
            ));
            tokio::time::timeout(WAIT, async {
                while lock(&bob.live).has_unsent() {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("acknowledged");
        }
        start(&mut alice, link(&pair, &pair.alice, project));
        let LiveEvent::Merged(report) =
            until_event(&mut alice, |event| matches!(event, LiveEvent::Merged(_))).await
        else {
            unreachable!()
        };
        assert_eq!(report.files.get(&main), Some(&2));
        assert_eq!(
            report
                .authors
                .get(&pair.bob.tokens.account_id)
                .and_then(|files| files.get(&main)),
            Some(&2)
        );
        assert_eq!(report.authors.len(), 1);
        let reviewed =
            crate::review::changed_files(lock(&alice.live).doc(), &report.before, &report.after)
                .unwrap();
        assert_eq!(
            reviewed,
            vec![crate::review::ReviewedFile {
                id: main.clone(),
                path: "main.tex".to_owned(),
                before: Some("!abc".to_owned()),
                after: Some("!abcde".to_owned()),
            }]
        );
    }

    fn quick() -> TransportOptions {
        TransportOptions {
            fallback_after: 2,
            retry_socket_every: Duration::from_secs(60),
        }
    }

    async fn proxy_for(pair: &Pair) -> oleafly_server::test_support::BlockingProxy {
        let upstream = pair
            ._server
            .url()
            .trim_start_matches("http://")
            .parse()
            .expect("server address");
        oleafly_server::test_support::BlockingProxy::start(upstream).await
    }

    fn link_via(
        pair: &Pair,
        person: &Person,
        project: SharedProjectId,
        proxy: &oleafly_server::test_support::BlockingProxy,
    ) -> LiveLink {
        let mut through = link(pair, person, project);
        let url = crate::ServerUrl::parse(&proxy.url()).expect("proxy address");
        through.client = Arc::new(ServerClient::new(url).expect("client"));
        through
    }

    fn start_with(side: &mut Side, link: LiveLink, options: TransportOptions) {
        side.handle = Some(spawn_live_with(
            link,
            Arc::clone(&side.live),
            side.events_tx.clone(),
            options,
        ));
    }

    async fn until(check: impl Fn() -> bool) {
        tokio::time::timeout(WAIT, async {
            while !check() {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("the condition came true");
    }

    async fn acknowledged(side: &Side) {
        tokio::time::timeout(WAIT, async {
            while lock(&side.live).has_unsent() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("acknowledged");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn two_editors_behind_a_proxy_that_blocks_websockets_still_converge() {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let proxy = proxy_for(&pair).await;
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start_with(
            &mut bob,
            link_via(&pair, &pair.bob, project, &proxy),
            quick(),
        );
        start_with(
            &mut alice,
            link_via(&pair, &pair.alice, project, &proxy),
            quick(),
        );
        until_status(&mut bob, LiveStatus::Online).await;
        until_status(&mut alice, LiveStatus::Online).await;
        assert!(proxy.refused() >= 4, "{} upgrades refused", proxy.refused());
        assert_eq!(pair._server.state().polls.count(), 2);
        lock(&bob.live)
            .editor_change(&main, 0, insert(3, "d", 3))
            .unwrap();
        bob.handle.as_ref().unwrap().flush();
        assert_eq!(
            next_message(&mut bob).await,
            DocMessage::Ack { rev: 1, length: 4 }
        );
        assert_eq!(
            next_message(&mut alice).await,
            DocMessage::Remote {
                rev: 1,
                op: insert(3, "d", 3),
                length: 4
            }
        );
        lock(&alice.live)
            .editor_change(&main, 1, insert(0, "!", 4))
            .unwrap();
        alice.handle.as_ref().unwrap().flush();
        assert_eq!(
            next_message(&mut bob).await,
            DocMessage::Remote {
                rev: 2,
                op: insert(0, "!", 4),
                length: 5
            }
        );
        assert_eq!(text(&bob, &main), "!abcd");
        assert_eq!(text(&alice, &main), "!abcd");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_long_poll_editor_catches_up_after_time_away_like_a_socket_one() {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let proxy = proxy_for(&pair).await;
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start_with(
            &mut bob,
            link_via(&pair, &pair.bob, project, &proxy),
            quick(),
        );
        start_with(
            &mut alice,
            link_via(&pair, &pair.alice, project, &proxy),
            quick(),
        );
        until_status(&mut alice, LiveStatus::Online).await;
        until_status(&mut bob, LiveStatus::Online).await;
        lock(&alice.live)
            .editor_change(&main, 0, insert(0, "!", 3))
            .unwrap();
        alice.handle.as_ref().unwrap().flush();
        assert!(matches!(
            next_message(&mut alice).await,
            DocMessage::Ack { .. }
        ));
        until_text(&bob, &main, "!abc").await;
        acknowledged(&alice).await;
        alice.handle.take().unwrap().stopped().await;
        assert!(matches!(
            next_message(&mut bob).await,
            DocMessage::Remote { .. }
        ));
        for (rev, letter) in ["d", "e", "f", "g"].into_iter().enumerate() {
            let length = 4 + rev;
            lock(&bob.live)
                .editor_change(&main, 1 + rev as u64, insert(length, letter, length))
                .unwrap();
            bob.handle.as_ref().unwrap().flush();
            assert!(matches!(
                next_message(&mut bob).await,
                DocMessage::Ack { .. }
            ));
            acknowledged(&bob).await;
        }
        assert_eq!(lock(&bob.live).last_seq(), 5);
        start_with(
            &mut alice,
            link_via(&pair, &pair.alice, project, &proxy),
            quick(),
        );
        let LiveEvent::Merged(report) =
            until_event(&mut alice, |event| matches!(event, LiveEvent::Merged(_))).await
        else {
            unreachable!()
        };
        assert_eq!(report.files.get(&main), Some(&4));
        until_text(&alice, &main, "!abcdefg").await;
        assert_eq!(lock(&alice.live).last_seq(), 5);
        assert_eq!(pair._server.state().polls.count(), 2);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn presence_and_leaving_cross_between_socket_and_long_poll() {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let proxy = proxy_for(&pair).await;
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start_with(&mut bob, link(&pair, &pair.bob, project), quick());
        start_with(
            &mut alice,
            link_via(&pair, &pair.alice, project, &proxy),
            quick(),
        );
        until_status(&mut bob, LiveStatus::Online).await;
        until_status(&mut alice, LiveStatus::Online).await;
        let handle = alice.handle.as_ref().unwrap();
        handle.presence(PresenceState {
            file_id: Some(main.clone()),
            cursor: Some(1),
            anchor: None,
        });
        handle.leave_presence();
        let device = pair.alice.tokens.device_id;
        tokio::time::timeout(WAIT, async {
            let mut placed = false;
            while let Some(event) = bob.events.recv().await {
                match event {
                    LiveEvent::Presence {
                        device_id, state, ..
                    } if device_id == device => {
                        placed = state.cursor == Some(1);
                    }
                    LiveEvent::PresenceLeft { device_id } if device_id == device => {
                        assert!(placed, "the leave arrived after the last presence");
                        return;
                    }
                    _ => {}
                }
            }
        })
        .await
        .expect("the leave arrived");
        let here = PresenceState {
            file_id: Some(main.clone()),
            cursor: Some(2),
            anchor: None,
        };
        bob.handle.as_ref().unwrap().presence(here.clone());
        let seen = until_event(&mut alice, |event| {
            matches!(event, LiveEvent::Presence { .. })
        })
        .await;
        assert_eq!(
            seen,
            LiveEvent::Presence {
                device_id: pair.bob.tokens.device_id,
                account_id: pair.bob.tokens.account_id,
                state: here
            }
        );
        alice.handle.take().unwrap().stopped().await;
        let gone = until_event(&mut bob, |event| {
            matches!(event, LiveEvent::PresenceLeft { .. })
        })
        .await;
        assert_eq!(gone, LiveEvent::PresenceLeft { device_id: device });
        assert_eq!(pair._server.state().polls.count(), 0);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_socket_editor_and_a_long_poll_editor_typing_together_converge() {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let proxy = proxy_for(&pair).await;
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start_with(&mut bob, link(&pair, &pair.bob, project), quick());
        start_with(
            &mut alice,
            link_via(&pair, &pair.alice, project, &proxy),
            quick(),
        );
        until_status(&mut bob, LiveStatus::Online).await;
        until_status(&mut alice, LiveStatus::Online).await;
        assert_eq!(pair._server.state().polls.count(), 1);
        for round in 0..15 {
            let at_bob = text(&bob, &main);
            lock(&bob.live)
                .local_text(&main, &format!("{at_bob}b{round}"))
                .unwrap();
            bob.handle.as_ref().unwrap().flush();
            let at_alice = text(&alice, &main);
            lock(&alice.live)
                .local_text(&main, &format!("a{round}{at_alice}"))
                .unwrap();
            alice.handle.as_ref().unwrap().flush();
            tokio::time::sleep(Duration::from_millis(15)).await;
        }
        tokio::time::timeout(WAIT, async {
            loop {
                let (left, right) = (text(&bob, &main), text(&alice, &main));
                if left == right && left.contains("b14") && left.contains("a14") {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("both sides converged");
        acknowledged(&bob).await;
        acknowledged(&alice).await;
        let merged = text(&bob, &main);
        for round in 0..15 {
            assert!(merged.contains(&format!("b{round}")), "{merged}");
            assert!(merged.contains(&format!("a{round}")), "{merged}");
        }
        assert_eq!(lock(&bob.live).last_seq(), lock(&alice.live).last_seq());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn the_fallback_moves_back_to_the_socket_once_websockets_get_through() {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let proxy = proxy_for(&pair).await;
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        let options = TransportOptions {
            fallback_after: 2,
            retry_socket_every: Duration::from_millis(300),
        };
        start_with(&mut bob, link(&pair, &pair.bob, project), quick());
        start_with(
            &mut alice,
            link_via(&pair, &pair.alice, project, &proxy),
            options,
        );
        until_status(&mut bob, LiveStatus::Online).await;
        until_status(&mut alice, LiveStatus::Online).await;
        let state = pair._server.state().clone();
        assert_eq!(state.polls.count(), 1);
        tokio::time::sleep(Duration::from_millis(700)).await;
        assert_eq!(state.polls.count(), 1);
        proxy.block_websockets(false);
        let device = pair.alice.tokens.device_id;
        until(|| state.polls.count() == 0 && state.sockets.count(device) == 1).await;
        until_status(&mut alice, LiveStatus::Online).await;
        lock(&alice.live)
            .editor_change(&main, 0, insert(0, "?", 3))
            .unwrap();
        alice.handle.as_ref().unwrap().flush();
        until_text(&bob, &main, "?abc").await;
        tokio::time::sleep(Duration::from_millis(700)).await;
        assert_eq!(state.polls.count(), 0);
        assert_eq!(state.sockets.count(device), 1);
    }

    async fn ended_after(
        blocked: bool,
        refuse: impl for<'a> Fn(&'a Pair, SharedProjectId) -> futures_util::future::BoxFuture<'a, ()>,
    ) -> LiveEvent {
        let pair = two_people().await;
        let (project, main, _bob_live, alice_live) = shared(&pair).await;
        let proxy = proxy_for(&pair).await;
        proxy.block_websockets(blocked);
        let mut alice = side(alice_live, &main);
        start_with(
            &mut alice,
            link_via(&pair, &pair.alice, project, &proxy),
            quick(),
        );
        until_status(&mut alice, LiveStatus::Online).await;
        assert_eq!(pair._server.state().polls.count(), usize::from(blocked));
        refuse(&pair, project).await;
        until_event(&mut alice, |event| {
            matches!(event, LiveEvent::Status(LiveStatus::Ended { .. }))
        })
        .await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn removal_and_sign_out_end_live_sync_the_same_way_over_both_transports() {
        for blocked in [false, true] {
            let removed = ended_after(blocked, |pair, project| {
                Box::pin(async move {
                    ServerClient::new(pair.url.clone())
                        .unwrap()
                        .remove_member(
                            &pair.bob.tokens.access_token,
                            project,
                            pair.alice.tokens.account_id,
                        )
                        .await
                        .unwrap();
                })
            })
            .await;
            assert_eq!(
                removed,
                LiveEvent::Status(LiveStatus::Ended {
                    reason: EndReason::Removed
                }),
                "blocked: {blocked}"
            );
            let signed_out = ended_after(blocked, |pair, _| {
                Box::pin(async move {
                    ServerClient::new(pair.url.clone())
                        .unwrap()
                        .sign_out_device(
                            &pair.alice.tokens.access_token,
                            pair.alice.tokens.device_id,
                        )
                        .await
                        .unwrap();
                })
            })
            .await;
            assert_eq!(
                signed_out,
                LiveEvent::Status(LiveStatus::Ended {
                    reason: EndReason::SignedOut
                }),
                "blocked: {blocked}"
            );
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_long_poll_editor_notices_a_dropped_network_and_catches_up_after() {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let proxy = proxy_for(&pair).await;
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start_with(&mut bob, link(&pair, &pair.bob, project), quick());
        start_with(
            &mut alice,
            link_via(&pair, &pair.alice, project, &proxy),
            quick(),
        );
        until_status(&mut bob, LiveStatus::Online).await;
        until_status(&mut alice, LiveStatus::Online).await;
        proxy.go_offline();
        let cut = tokio::time::Instant::now();
        until_event(&mut alice, |event| {
            matches!(event, LiveEvent::Status(LiveStatus::Offline { .. }))
        })
        .await;
        assert!(
            cut.elapsed() < Duration::from_secs(6),
            "{:?}",
            cut.elapsed()
        );
        lock(&alice.live)
            .editor_change(&main, 0, insert(0, "~", 3))
            .unwrap();
        lock(&bob.live)
            .editor_change(&main, 0, insert(3, "!", 3))
            .unwrap();
        bob.handle.as_ref().unwrap().flush();
        proxy.go_online();
        until_status(&mut alice, LiveStatus::Online).await;
        until_text(&bob, &main, "~abc!").await;
        until_text(&alice, &main, "~abc!").await;
    }

    fn snapshot_often(pair: &Pair) {
        pair._server
            .state()
            .snapshots
            .set_policy(oleafly_server::snapshots::Policy {
                build_after: 1,
                keep_updates: 1,
            });
    }

    fn forged_by(base: &ProjectDoc, peer: u64, main: &str, text: &str) -> Vec<u8> {
        let mut forger = ProjectDoc::load(&base.snapshot().unwrap()).unwrap();
        let since = forger.version();
        forger.loro().set_peer_id(peer).unwrap();
        forger.set_text(main, text).unwrap();
        forger.export_since(&since).unwrap()
    }

    async fn stopped(side: &mut Side) {
        if let Some(handle) = side.handle.take() {
            handle.stopped().await;
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_change_forged_under_another_devices_writer_id_is_refused_and_both_copies_converge() {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start(&mut bob, link(&pair, &pair.bob, project));
        start(&mut alice, link(&pair, &pair.alice, project));
        until_status(&mut bob, LiveStatus::Online).await;
        until_status(&mut alice, LiveStatus::Online).await;
        lock(&alice.live)
            .editor_change(&main, 0, insert(0, "!", 3))
            .unwrap();
        alice.handle.as_ref().unwrap().flush();
        until_text(&bob, &main, "!abc").await;
        stopped(&mut alice).await;
        stopped(&mut bob).await;
        lock(&alice.live)
            .local_text(&main, "!abc written by Alice offline")
            .unwrap();
        let alice_peer = lock(&alice.live).doc().loro().peer_id();
        let forged = forged_by(lock(&bob.live).doc(), alice_peer, &main, "!abc FORGED");
        store_on_server(
            &pair,
            &pair.bob,
            signed_envelope(&pair.bob, project, forged),
        )
        .await;
        start(&mut bob, link(&pair, &pair.bob, project));
        let refused = until_event(&mut bob, |event| {
            matches!(event, LiveEvent::Untrusted { .. })
        })
        .await;
        assert_eq!(
            refused,
            LiveEvent::Untrusted {
                device_id: pair.bob.tokens.device_id,
                seq: 2,
            }
        );
        assert_eq!(text(&bob, &main), "!abc");
        start(&mut alice, link(&pair, &pair.alice, project));
        until_text(&bob, &main, "!abc written by Alice offline").await;
        until_text(&alice, &main, "!abc written by Alice offline").await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_change_under_this_copys_own_writer_id_is_always_refused() {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let alice_peer = alice_live.doc().loro().peer_id();
        let forged = forged_by(bob_live.doc(), alice_peer, &main, "abc FORGED");
        store_on_server(
            &pair,
            &pair.bob,
            signed_envelope(&pair.bob, project, forged),
        )
        .await;
        let mut alice = side(alice_live, &main);
        start(&mut alice, link(&pair, &pair.alice, project));
        let refused = until_event(&mut alice, |event| {
            matches!(event, LiveEvent::Untrusted { .. })
        })
        .await;
        assert_eq!(
            refused,
            LiveEvent::Untrusted {
                device_id: pair.bob.tokens.device_id,
                seq: 1,
            }
        );
        assert_eq!(text(&alice, &main), "abc");
        assert_eq!(lock(&alice.live).last_seq(), 1);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_relayed_resend_from_an_honest_editor_still_converges() {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start(&mut bob, link(&pair, &pair.bob, project));
        start(&mut alice, link(&pair, &pair.alice, project));
        until_status(&mut bob, LiveStatus::Online).await;
        until_status(&mut alice, LiveStatus::Online).await;
        let start_version = lock(&bob.live).doc().version();
        lock(&alice.live)
            .editor_change(&main, 0, insert(0, "!", 3))
            .unwrap();
        alice.handle.as_ref().unwrap().flush();
        until_text(&bob, &main, "!abc").await;
        stopped(&mut bob).await;
        stopped(&mut alice).await;
        let relayed = {
            let mut live = lock(&bob.live);
            live.local_text(&main, "!abc and Bob").unwrap();
            live.doc().export_since(&start_version).unwrap()
        };
        store_on_server(
            &pair,
            &pair.bob,
            signed_envelope(&pair.bob, project, relayed),
        )
        .await;
        start(&mut alice, link(&pair, &pair.alice, project));
        until_text(&alice, &main, "!abc and Bob").await;
        start(&mut bob, link(&pair, &pair.bob, project));
        until_status(&mut bob, LiveStatus::Online).await;
        lock(&alice.live)
            .local_text(&main, "!abc and Bob!")
            .unwrap();
        alice.handle.as_ref().unwrap().flush();
        until_text(&bob, &main, "!abc and Bob!").await;
        assert_eq!(text(&alice, &main), "!abc and Bob!");
        assert!(!lock(&bob.live).has_unsent());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_snapshot_that_does_not_load_falls_back_to_the_one_before_and_the_kept_log() {
        let pair = two_people().await;
        snapshot_often(&pair);
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start(&mut bob, link(&pair, &pair.bob, project));
        until_status(&mut bob, LiveStatus::Online).await;
        for (rev, letter) in ["x", "y", "z"].into_iter().enumerate() {
            let length = 3 + rev;
            lock(&bob.live)
                .editor_change(&main, rev as u64, insert(length, letter, length))
                .unwrap();
            bob.handle.as_ref().unwrap().flush();
            until_event(&mut bob, |event| *event == LiveEvent::Acknowledged).await;
        }
        let client = ServerClient::new(pair.url.clone()).unwrap();
        client
            .put_snapshot(&pair.bob.tokens.access_token, project, 2, Vec::new())
            .await
            .unwrap();
        let state = pair._server.state().clone();
        state
            .snapshots
            .upload(
                &state.db,
                project,
                3,
                b"left by an older editor".to_vec().into(),
                pair.bob.tokens.account_id,
                1,
            )
            .await
            .unwrap();
        start(&mut alice, link(&pair, &pair.alice, project));
        until_text(&alice, &main, "abcxyz").await;
        assert_eq!(lock(&alice.live).last_seq(), 3);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_late_joiner_sees_comment_authors_as_verified_only_when_the_server_vouches() {
        let pair = two_people().await;
        snapshot_often(&pair);
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let initial = bob_live.doc().snapshot().unwrap();
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start(&mut bob, link(&pair, &pair.bob, project));
        start(&mut alice, link(&pair, &pair.alice, project));
        until_status(&mut bob, LiveStatus::Online).await;
        until_status(&mut alice, LiveStatus::Online).await;
        let (alice_account, bob_account) =
            (pair.alice.tokens.account_id, pair.bob.tokens.account_id);
        let (honest, forged) = {
            let mut live = lock(&alice.live);
            let doc = live.comment_doc();
            let honest = doc
                .create_comment_thread(&main, 0, 1, alice_account, 1, "Mine", &[])
                .unwrap();
            let forged = doc
                .create_comment_thread(&main, 1, 2, bob_account, 2, "Pretending to be Bob", &[])
                .unwrap();
            (honest.id, forged.id)
        };
        alice.handle.as_ref().unwrap().flush();
        until_event(&mut alice, |event| *event == LiveEvent::Acknowledged).await;
        for letter in ["x", "y"] {
            let typed = format!("{}{letter}", text(&bob, &main));
            lock(&bob.live).local_text(&main, &typed).unwrap();
            bob.handle.as_ref().unwrap().flush();
            until_event(&mut bob, |event| *event == LiveEvent::Acknowledged).await;
        }
        let client = ServerClient::new(pair.url.clone()).unwrap();
        let head = lock(&bob.live).last_seq();
        client
            .snapshot_hint(&pair.bob.tokens.access_token, project, head - 1)
            .await
            .unwrap();
        client
            .snapshot_hint(&pair.bob.tokens.access_token, project, head)
            .await
            .unwrap();
        let tablet = another_alice_device(&pair).await;
        let (seq, _) = client
            .get_snapshot(&tablet.tokens.access_token, project)
            .await
            .unwrap();
        assert_eq!(seq, head);
        let mut late = side(
            LiveProject::new(ProjectDoc::load(&initial).unwrap(), 0, ProjectRole::Editor),
            &main,
        );
        start(&mut late, link(&pair, &tablet, project));
        until_text(&late, &main, &text(&bob, &main)).await;
        tokio::time::timeout(WAIT, async {
            while lock(&late.live)
                .doc()
                .comment_thread(&main, honest)
                .ok()
                .flatten()
                .is_none()
            {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("the comments arrived");
        let seen_honest = lock(&late.live)
            .doc()
            .comment_thread(&main, honest)
            .unwrap()
            .unwrap();
        let seen_forged = lock(&late.live)
            .doc()
            .comment_thread(&main, forged)
            .unwrap()
            .unwrap();
        assert!(seen_honest.verified);
        assert!(seen_honest.messages[0].verified);
        assert!(!seen_forged.verified);
        assert!(!seen_forged.messages[0].verified);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn an_older_server_without_the_writer_list_still_lets_changes_through() {
        let pair = two_people().await;
        let (project, main, bob_live, mut alice_live) = shared(&pair).await;
        alice_live.local_text(&main, "abcX").unwrap();
        let payload = alice_live.next_outgoing().unwrap().unwrap().payload;
        let envelope = signed_envelope(&pair.alice, project, payload);
        let bob = side(bob_live, &main);
        for (status, accepted) in [
            ("404 Not Found", true),
            ("500 Internal Server Error", false),
        ] {
            let answer = canned(http_response(
                status,
                &[("content-type", "application/json")],
                r#"{"code":"not_found","message":"Not found."}"#,
            ))
            .await;
            let mut older = link(&pair, &pair.bob, project);
            older.client = Arc::new(ServerClient::new(answer).unwrap());
            let verdict = peer_trust(&older, &bob.live, &mut BTreeSet::new(), &envelope).await;
            assert_eq!(
                matches!(verdict, Trust::Signed(_)),
                accepted,
                "{status} answered the wrong way"
            );
            assert_eq!(
                matches!(verdict, Trust::Unreachable),
                !accepted,
                "{status} answered the wrong way"
            );
        }
    }

    const BIG_WAIT: Duration = Duration::from_secs(300);

    fn append(side: &Side, main: &str, word: &str) {
        let mut live = lock(&side.live);
        let typed = format!("{}{word}", live.doc().text(main).unwrap());
        live.local_text(main, &typed).unwrap();
    }

    fn flushed(side: &Side) {
        side.handle.as_ref().unwrap().flush();
    }

    fn dropped(side: &mut Side) -> usize {
        let mut count = 0;
        while let Ok(event) = side.events.try_recv() {
            if matches!(
                event,
                LiveEvent::Status(LiveStatus::Offline { .. } | LiveStatus::Ended { .. })
            ) {
                count += 1;
            }
        }
        count
    }

    async fn four_big_files_reach_the_other_editor(blocked: bool) {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let proxy = proxy_for(&pair).await;
        proxy.block_websockets(blocked);
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start_with(
            &mut bob,
            link_via(&pair, &pair.bob, project, &proxy),
            quick(),
        );
        start_with(
            &mut alice,
            link_via(&pair, &pair.alice, project, &proxy),
            quick(),
        );
        until_status(&mut bob, LiveStatus::Online).await;
        until_status(&mut alice, LiveStatus::Online).await;
        let files: Vec<(String, String)> = {
            let mut live = lock(&bob.live);
            (0..4u64)
                .map(|index| {
                    let body = noise(3 * 1024 * 1024, index + 1);
                    let id = live
                        .doc_mut()
                        .add_node(
                            None,
                            &format!("part{index}.tex"),
                            NodeKind::Text,
                            None,
                            &body,
                        )
                        .unwrap();
                    (id, body)
                })
                .collect()
        };
        flushed(&bob);
        tokio::time::timeout(BIG_WAIT, async {
            loop {
                let arrived = {
                    let live = lock(&alice.live);
                    files.iter().all(|(id, body)| {
                        live.doc().contains(id)
                            && live
                                .doc()
                                .text_of(id)
                                .is_ok_and(|text| text.len_unicode() == body.len())
                    })
                };
                if arrived {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        })
        .await
        .expect("all four files reached Alice");
        for (id, body) in &files {
            assert_eq!(&lock(&alice.live).doc().text(id).unwrap(), body);
        }
        acknowledged(&bob).await;
        append(&bob, &main, "!");
        flushed(&bob);
        until_text(&alice, &main, "abc!").await;
        assert_eq!(dropped(&mut bob), 0, "Bob's connection dropped");
        assert_eq!(dropped(&mut alice), 0, "Alice's connection dropped");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn four_three_megabyte_files_added_at_once_reach_the_other_editor_over_a_socket() {
        four_big_files_reach_the_other_editor(false).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn four_three_megabyte_files_added_at_once_reach_the_other_editor_over_long_poll() {
        four_big_files_reach_the_other_editor(true).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn an_edit_too_large_for_any_batch_is_reported_once_and_the_connection_stays_up() {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        lock(&bob.live).set_batch_limit(16 * 1024);
        start(&mut bob, link(&pair, &pair.bob, project));
        start(&mut alice, link(&pair, &pair.alice, project));
        until_status(&mut bob, LiveStatus::Online).await;
        until_status(&mut alice, LiveStatus::Online).await;
        append(&bob, &main, "d");
        {
            let mut live = lock(&bob.live);
            let huge = noise(64 * 1024, 5);
            let doc = live.comment_doc().loro();
            doc.get_map("oversized")
                .insert("value", huge.as_str())
                .unwrap();
            doc.commit();
        }
        flushed(&bob);
        until_text(&alice, &main, "abcd").await;
        until_event(&mut bob, |event| *event == LiveEvent::Unsendable).await;
        flushed(&bob);
        tokio::time::sleep(Duration::from_millis(300)).await;
        let mut again = 0;
        while let Ok(event) = bob.events.try_recv() {
            assert!(
                !matches!(event, LiveEvent::Status(LiveStatus::Offline { .. })),
                "{event:?}"
            );
            again += usize::from(event == LiveEvent::Unsendable);
        }
        assert_eq!(again, 0, "the refusal was reported again");
        assert!(!bob.handle.as_ref().unwrap().is_finished());
    }

    async fn backup(pair: &Pair) -> (tempfile::TempDir, std::path::PathBuf) {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("backup.sqlite3");
        let target = path.to_string_lossy().into_owned();
        pair._server
            .state()
            .db
            .call(move |conn| {
                conn.execute("VACUUM INTO ?1", [target])?;
                Ok(())
            })
            .await
            .expect("backed up");
        (folder, path)
    }

    async fn restore(pair: &Pair, saved: &std::path::Path) {
        let source = saved.to_string_lossy().into_owned();
        pair._server
            .state()
            .db
            .call(move |conn| {
                conn.execute("ATTACH DATABASE ?1 AS saved", [source])?;
                let tables: Vec<String> = {
                    let mut listed = conn.prepare(
                        "SELECT name FROM saved.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
                    )?;
                    let names = listed.query_map([], |row| row.get(0))?;
                    names.collect::<Result<_, _>>()?
                };
                conn.execute_batch("PRAGMA foreign_keys = OFF; BEGIN;")?;
                for table in &tables {
                    conn.execute_batch(&format!(
                        "DELETE FROM main.\"{table}\"; INSERT INTO main.\"{table}\" SELECT * FROM saved.\"{table}\";"
                    ))?;
                }
                conn.execute_batch("COMMIT; PRAGMA foreign_keys = ON; DETACH DATABASE saved;")?;
                Ok(())
            })
            .await
            .expect("restored");
    }

    async fn type_rounds(bob: &Side, alice: &Side, main: &str, rounds: std::ops::Range<u32>) {
        for round in rounds {
            append(bob, main, &format!(" b{round}"));
            flushed(bob);
            append(alice, main, &format!(" a{round}"));
            flushed(alice);
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
    }

    async fn settled(sides: &[&Side], main: &str) {
        tokio::time::timeout(WAIT * 3, async {
            loop {
                let first = text(sides[0], main);
                let same = sides.iter().all(|side| text(side, main) == first);
                let sent = sides.iter().all(|side| !lock(&side.live).has_unsent());
                if same && sent {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .unwrap_or_else(|_| {
            let texts: Vec<String> = sides.iter().map(|side| text(side, main)).collect();
            panic!("the copies never settled: {texts:#?}")
        });
    }

    fn holds_every_word(merged: &str, rounds: std::ops::Range<u32>, people: &[char]) {
        for round in rounds {
            for person in people {
                let word = format!(" {person}{round}");
                assert!(
                    merged.contains(&word),
                    "{word:?} is missing from {merged:?}"
                );
            }
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_database_restored_from_an_older_backup_leaves_every_copy_identical_and_loses_no_acknowledged_edit(
    ) {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let proxy = proxy_for(&pair).await;
        proxy.block_websockets(false);
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start_with(
            &mut bob,
            link_via(&pair, &pair.bob, project, &proxy),
            quick(),
        );
        start_with(
            &mut alice,
            link_via(&pair, &pair.alice, project, &proxy),
            quick(),
        );
        until_status(&mut bob, LiveStatus::Online).await;
        until_status(&mut alice, LiveStatus::Online).await;
        type_rounds(&bob, &alice, &main, 0..6).await;
        settled(&[&bob, &alice], &main).await;
        let (_kept, saved) = backup(&pair).await;
        let at_backup = lock(&bob.live).last_seq();
        type_rounds(&bob, &alice, &main, 6..12).await;
        settled(&[&bob, &alice], &main).await;
        assert!(lock(&bob.live).last_seq() > at_backup);
        restore(&pair, &saved).await;
        proxy.go_offline();
        proxy.go_online();
        for round in 12..15 {
            append(&alice, &main, &format!(" a{round}"));
            flushed(&alice);
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let tablet = another_alice_device(&pair).await;
        let client = ServerClient::new(pair.url.clone()).unwrap();
        let (seq, snapshot) = client
            .get_snapshot(&tablet.tokens.access_token, project)
            .await
            .unwrap();
        let mut late = side(
            LiveProject::new(
                ProjectDoc::load(&snapshot).unwrap(),
                seq,
                ProjectRole::Editor,
            ),
            &main,
        );
        start(&mut late, link(&pair, &tablet, project));
        settled(&[&bob, &alice, &late], &main).await;
        let merged = text(&bob, &main);
        holds_every_word(&merged, 0..12, &['a', 'b']);
        holds_every_word(&merged, 12..15, &['a']);
    }

    async fn restored_pair() -> (
        Pair,
        SharedProjectId,
        String,
        Side,
        Side,
        oleafly_server::test_support::BlockingProxy,
    ) {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let proxy = proxy_for(&pair).await;
        proxy.block_websockets(false);
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start_with(
            &mut bob,
            link_via(&pair, &pair.bob, project, &proxy),
            quick(),
        );
        start_with(
            &mut alice,
            link_via(&pair, &pair.alice, project, &proxy),
            quick(),
        );
        until_status(&mut bob, LiveStatus::Online).await;
        until_status(&mut alice, LiveStatus::Online).await;
        type_rounds(&bob, &alice, &main, 0..4).await;
        settled(&[&bob, &alice], &main).await;
        (pair, project, main, bob, alice, proxy)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_restore_is_noticed_even_after_the_others_pushed_the_head_past_this_copys_last_change(
    ) {
        let (pair, project, main, bob, mut alice, proxy) = restored_pair().await;
        let (_kept, saved) = backup(&pair).await;
        for round in 4..8 {
            append(&bob, &main, &format!(" b{round}"));
            flushed(&bob);
            acknowledged(&bob).await;
        }
        settled(&[&bob, &alice], &main).await;
        let alice_last = lock(&alice.live).last_seq();
        stopped(&mut alice).await;
        restore(&pair, &saved).await;
        proxy.go_offline();
        proxy.go_online();
        let mut round = 8;
        tokio::time::timeout(WAIT * 3, async {
            while lock(&bob.live).last_seq() <= alice_last {
                append(&bob, &main, &format!(" b{round}"));
                flushed(&bob);
                round += 1;
                tokio::time::sleep(Duration::from_millis(40)).await;
            }
        })
        .await
        .expect("the server's head moved past Alice's last change");
        settled(&[&bob], &main).await;
        start_with(
            &mut alice,
            link_via(&pair, &pair.alice, project, &proxy),
            quick(),
        );
        settled(&[&bob, &alice], &main).await;
        let merged = text(&bob, &main);
        holds_every_word(&merged, 0..4, &['a', 'b']);
        holds_every_word(&merged, 4..round, &['b']);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn after_a_restore_changes_built_on_a_lost_change_wait_for_its_author_and_nothing_is_lost(
    ) {
        let (pair, project, main, bob, mut alice, proxy) = restored_pair().await;
        let (_kept, saved) = backup(&pair).await;
        type_rounds(&bob, &alice, &main, 4..8).await;
        settled(&[&bob, &alice], &main).await;
        stopped(&mut alice).await;
        restore(&pair, &saved).await;
        proxy.go_offline();
        proxy.go_online();
        for round in 8..11 {
            append(&bob, &main, &format!(" b{round}"));
            flushed(&bob);
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert!(
            lock(&bob.live).pending_changes() > 0,
            "Bob's new words build on Alice's lost ones and must wait for her"
        );
        start_with(
            &mut alice,
            link_via(&pair, &pair.alice, project, &proxy),
            quick(),
        );
        settled(&[&bob, &alice], &main).await;
        let merged = text(&bob, &main);
        holds_every_word(&merged, 0..8, &['a', 'b']);
        holds_every_word(&merged, 8..11, &['b']);
        let tablet = another_alice_device(&pair).await;
        let client = ServerClient::new(pair.url.clone()).unwrap();
        let (seq, snapshot) = client
            .get_snapshot(&tablet.tokens.access_token, project)
            .await
            .unwrap();
        let mut late = side(
            LiveProject::new(
                ProjectDoc::load(&snapshot).unwrap(),
                seq,
                ProjectRole::Editor,
            ),
            &main,
        );
        start(&mut late, link(&pair, &tablet, project));
        settled(&[&bob, &alice, &late], &main).await;
    }

    async fn turning_away_upgrades(upstream: std::net::SocketAddr, refusals: usize) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let left = Arc::new(std::sync::atomic::AtomicUsize::new(refusals));
        tokio::spawn(async move {
            while let Ok((mut client, _)) = listener.accept().await {
                let left = Arc::clone(&left);
                tokio::spawn(async move {
                    let mut head = Vec::new();
                    let mut buffer = [0u8; 4096];
                    while !head.windows(4).any(|window| window == b"\r\n\r\n") {
                        match client.read(&mut buffer).await {
                            Ok(0) | Err(_) => return,
                            Ok(read) => head.extend_from_slice(&buffer[..read]),
                        }
                    }
                    let upgrade = String::from_utf8_lossy(&head)
                        .to_ascii_lowercase()
                        .contains("upgrade: websocket");
                    let refuse = upgrade
                        && left
                            .fetch_update(
                                std::sync::atomic::Ordering::SeqCst,
                                std::sync::atomic::Ordering::SeqCst,
                                |count| count.checked_sub(1),
                            )
                            .is_ok();
                    if refuse {
                        let _ = client
                            .write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                            .await;
                        return;
                    }
                    let Ok(mut server) = tokio::net::TcpStream::connect(upstream).await else {
                        return;
                    };
                    if server.write_all(&head).await.is_ok() {
                        let _ = tokio::io::copy_bidirectional(&mut client, &mut server).await;
                    }
                });
            }
        });
        format!("http://{address}")
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_socket_turned_away_right_after_a_fresh_token_is_tried_again_instead_of_signing_out()
    {
        let pair = two_people().await;
        let (project, main, _bob_live, alice_live) = shared(&pair).await;
        let upstream = pair
            ._server
            .url()
            .trim_start_matches("http://")
            .parse()
            .unwrap();
        let front = turning_away_upgrades(upstream, 3).await;
        let mut alice = side(alice_live, &main);
        let mut through = link(&pair, &pair.alice, project);
        through.client =
            Arc::new(ServerClient::new(crate::ServerUrl::parse(&front).unwrap()).unwrap());
        start_with(&mut alice, through, quick());
        let reached = until_event(&mut alice, |event| {
            matches!(
                event,
                LiveEvent::Status(LiveStatus::Online | LiveStatus::Ended { .. })
            )
        })
        .await;
        assert_eq!(reached, LiveEvent::Status(LiveStatus::Online));
    }

    async fn slow_link(upstream: std::net::SocketAddr, one_way: Duration) -> std::net::SocketAddr {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        async fn pump(
            mut from: tokio::net::tcp::OwnedReadHalf,
            mut to: tokio::net::tcp::OwnedWriteHalf,
            one_way: Duration,
        ) {
            let (sender, mut receiver) =
                mpsc::unbounded_channel::<(tokio::time::Instant, Vec<u8>)>();
            let writer = tokio::spawn(async move {
                while let Some((at, bytes)) = receiver.recv().await {
                    tokio::time::sleep_until(at + one_way).await;
                    if to.write_all(&bytes).await.is_err() {
                        return;
                    }
                }
                let _ = to.shutdown().await;
            });
            let mut buffer = vec![0u8; 64 * 1024];
            loop {
                match from.read(&mut buffer).await {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        if sender
                            .send((tokio::time::Instant::now(), buffer[..read].to_vec()))
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
            drop(sender);
            let _ = writer.await;
        }
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((client, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let Ok(server) = tokio::net::TcpStream::connect(upstream).await else {
                        return;
                    };
                    let _ = client.set_nodelay(true);
                    let _ = server.set_nodelay(true);
                    let (client_read, client_write) = client.into_split();
                    let (server_read, server_write) = server.into_split();
                    let up = tokio::spawn(pump(client_read, server_write, one_way));
                    let down = tokio::spawn(pump(server_read, client_write, one_way));
                    let _ = tokio::join!(up, down);
                });
            }
        });
        address
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_long_poll_editor_keeps_reading_while_its_own_posts_cross_a_slow_link() {
        let pair = two_people().await;
        let (project, main, bob_live, alice_live) = shared(&pair).await;
        let upstream = pair
            ._server
            .url()
            .trim_start_matches("http://")
            .parse()
            .unwrap();
        let slow = slow_link(upstream, Duration::from_millis(100)).await;
        let blocking = oleafly_server::test_support::BlockingProxy::start(slow).await;
        let mut bob = side(bob_live, &main);
        let mut alice = side(alice_live, &main);
        start(&mut bob, link(&pair, &pair.bob, project));
        start_with(
            &mut alice,
            link_via(&pair, &pair.alice, project, &blocking),
            quick(),
        );
        until_status(&mut bob, LiveStatus::Online).await;
        tokio::time::timeout(Duration::from_secs(30), async {
            while let Some(event) = alice.events.recv().await {
                if event == LiveEvent::Status(LiveStatus::Online) {
                    return;
                }
            }
        })
        .await
        .expect("Alice came online over long-poll");
        assert_eq!(pair._server.state().polls.count(), 1);
        let handle = alice.handle.as_ref().unwrap();
        for cursor in 0..60u32 {
            handle.presence(PresenceState {
                file_id: Some(main.clone()),
                cursor: Some(cursor),
                anchor: None,
            });
        }
        for round in 0..40 {
            append(&bob, &main, &format!(" {round}"));
            flushed(&bob);
            acknowledged(&bob).await;
        }
        let typed = tokio::time::Instant::now();
        let wanted = text(&bob, &main);
        tokio::time::timeout(Duration::from_secs(30), async {
            while text(&alice, &main) != wanted {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("Alice caught up");
        let behind = typed.elapsed();
        assert!(
            behind < Duration::from_secs(3),
            "Alice saw Bob's last change {behind:?} after he typed it"
        );
    }

    #[test]
    fn reconnect_waits_spread_over_the_whole_window() {
        for cap in BACKOFF_MS {
            for random in [0, 1, 99, 4_999, u64::MAX] {
                let wait = jittered(cap, random);
                assert!(
                    (JITTER_FLOOR_MS..=cap).contains(&wait),
                    "{wait} ms for a {cap} ms window"
                );
            }
        }
        let spread: BTreeSet<u64> = (0..200u64)
            .map(|n| jittered(5_000, n.wrapping_mul(0x9E37_79B9_7F4A_7C15)))
            .collect();
        assert!(spread.len() > 150, "{} distinct waits", spread.len());
    }

    #[test]
    fn only_a_connection_that_stayed_up_starts_the_waits_over() {
        assert_eq!(Reached::after(Duration::from_millis(300)), Reached::Briefly);
        assert_eq!(Reached::after(STEADY_AFTER), Reached::Steady);
        assert_eq!(backoff_step(3, Reached::Never), 3);
        assert_eq!(backoff_step(3, Reached::Briefly), 3);
        assert_eq!(backoff_step(3, Reached::Steady), 0);
    }
}
