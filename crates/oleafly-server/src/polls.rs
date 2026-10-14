use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use oleafly_collab_protocol::crypto::sha256_b64url;
use oleafly_collab_protocol::frames::{FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::{AccountId, DeviceId, SharedProjectId};
use oleafly_collab_protocol::poll::PollBatch;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio::sync::watch;
use tokio::time::Instant;

use crate::error::ServerError;
use crate::rooms::{self, Outbound, Outbox};
use crate::routes::ws::{backlog_page, leave_rooms, CursorGate, Peer, OUTBOUND_CAPACITY};
use crate::sockets::{SocketControl, SocketTicket};
use crate::state::AppState;
use crate::tokens::random_token;

pub const POLL_HOLD: Duration = Duration::from_secs(25);
pub const POLL_IDLE: Duration = Duration::from_secs(30);
pub const MAX_POLL_SESSIONS: usize = 10_000;
pub const MAX_POLL_SESSIONS_PER_ACCOUNT: usize = 64;
pub const MAX_BATCH_BYTES: usize = 4 * 1024 * 1024;

pub struct PollHub {
    sessions: Mutex<HashMap<String, Arc<PollSession>>>,
    hold_ms: AtomicU64,
    idle_ms: AtomicU64,
    stopping: AtomicBool,
    account_cap: AtomicUsize,
}

impl Default for PollHub {
    fn default() -> PollHub {
        PollHub::new()
    }
}

impl PollHub {
    pub fn new() -> PollHub {
        PollHub {
            sessions: Mutex::new(HashMap::new()),
            hold_ms: AtomicU64::new(millis(POLL_HOLD)),
            idle_ms: AtomicU64::new(millis(POLL_IDLE)),
            stopping: AtomicBool::new(false),
            account_cap: AtomicUsize::new(MAX_POLL_SESSIONS_PER_ACCOUNT),
        }
    }

    pub fn with_hold(hold: Duration) -> PollHub {
        let hub = PollHub::new();
        hub.hold_ms.store(millis(hold), Ordering::SeqCst);
        hub
    }

    pub fn set_account_cap(&self, cap: usize) {
        self.account_cap.store(cap.max(1), Ordering::SeqCst);
    }

    pub fn account_cap(&self) -> usize {
        self.account_cap.load(Ordering::SeqCst)
    }

    pub(crate) fn beyond_account_cap(&self, account: AccountId) -> Vec<Arc<PollSession>> {
        let cap = self.account_cap();
        let mut held: Vec<Arc<PollSession>> = self
            .lock()
            .values()
            .filter(|session| session.account == account && !session.is_ended())
            .cloned()
            .collect();
        if held.len() < cap {
            return Vec::new();
        }
        held.sort_by_key(|session| session.connection);
        held.truncate(held.len() + 1 - cap);
        held
    }

    pub fn stop_waiting(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        for session in self.lock().values() {
            session.wake.send_modify(|_| {});
        }
    }

    fn is_stopping(&self) -> bool {
        self.stopping.load(Ordering::SeqCst)
    }

    pub fn set_timing(&self, hold: Duration, idle: Duration) {
        self.hold_ms.store(millis(hold), Ordering::SeqCst);
        self.idle_ms.store(millis(idle), Ordering::SeqCst);
    }

    pub fn hold(&self) -> Duration {
        Duration::from_millis(self.hold_ms.load(Ordering::SeqCst))
    }

    pub fn idle(&self) -> Duration {
        Duration::from_millis(self.idle_ms.load(Ordering::SeqCst))
    }

    pub fn count(&self) -> usize {
        self.lock().len()
    }

    pub(crate) fn find(&self, key: &str) -> Option<Arc<PollSession>> {
        self.lock().get(&sha256_b64url(key.as_bytes())).cloned()
    }

    pub(crate) fn opened_by(
        &self,
        device: DeviceId,
        project: SharedProjectId,
    ) -> Vec<Arc<PollSession>> {
        self.lock()
            .values()
            .filter(|session| session.device == device && session.project == project)
            .cloned()
            .collect()
    }

    fn insert(&self, session: &Arc<PollSession>) -> bool {
        let mut sessions = self.lock();
        if sessions.len() >= MAX_POLL_SESSIONS {
            return false;
        }
        sessions.insert(session.key_hash.clone(), Arc::clone(session));
        true
    }

    fn remove(&self, session: &PollSession) {
        session.closed.store(true, Ordering::SeqCst);
        self.lock().remove(&session.key_hash);
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, Arc<PollSession>>> {
        self.sessions.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

fn millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

struct Inbox {
    outbound: Outbound,
    _open: Outbox,
    delivered: u64,
    pending: Vec<ServerFrame>,
    backlog: Option<(u64, u64)>,
}

pub struct PollSession {
    id: String,
    key_hash: String,
    pub(crate) project: SharedProjectId,
    pub(crate) device: DeviceId,
    pub(crate) account: AccountId,
    public_key: Vec<u8>,
    pub(crate) connection: u64,
    understands: Vec<FrameErrorCode>,
    inbox: tokio::sync::Mutex<Inbox>,
    wake: watch::Sender<u64>,
    last: Mutex<Option<ServerFrame>>,
    ended: AtomicBool,
    closed: AtomicBool,
    active: AtomicUsize,
    seen: Mutex<Instant>,
    cursors: CursorGate,
    _signal: UnboundedSender<SocketControl>,
}

pub(crate) struct Opening {
    pub(crate) project: SharedProjectId,
    pub(crate) device: DeviceId,
    pub(crate) account: AccountId,
    pub(crate) public_key: Vec<u8>,
    pub(crate) ticket: SocketTicket,
    pub(crate) frames: Outbox,
    pub(crate) outbound: Outbound,
    pub(crate) understands: Vec<FrameErrorCode>,
}

pub(crate) fn channel() -> (Outbox, Outbound) {
    rooms::outbox(OUTBOUND_CAPACITY)
}

pub(crate) struct Active<'a>(&'a PollSession);

impl Drop for Active<'_> {
    fn drop(&mut self) {
        self.0.touch();
        self.0.active.fetch_sub(1, Ordering::SeqCst);
    }
}

impl PollSession {
    pub(crate) fn peer<'a>(&'a self, state: &'a AppState) -> Peer<'a> {
        Peer {
            state,
            device: self.device,
            account: self.account,
            public_key: &self.public_key,
            connection: self.connection,
            understands: &self.understands,
            cursors: &self.cursors,
        }
    }

    pub(crate) fn is_ended(&self) -> bool {
        self.ended.load(Ordering::SeqCst)
    }

    pub(crate) fn enter(&self) -> Active<'_> {
        self.active.fetch_add(1, Ordering::SeqCst);
        self.touch();
        Active(self)
    }

    fn touch(&self) {
        *self.seen.lock().unwrap_or_else(PoisonError::into_inner) = Instant::now();
    }

    fn quiet_for(&self, idle: Duration) -> bool {
        self.active.load(Ordering::SeqCst) == 0
            && self
                .seen
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .elapsed()
                >= idle
    }

    fn take_turn(&self) -> (u64, watch::Receiver<u64>) {
        let mut turn = 0;
        self.wake.send_modify(|current| {
            *current += 1;
            turn = *current;
        });
        let mut receiver = self.wake.subscribe();
        receiver.borrow_and_update();
        (turn, receiver)
    }

    fn has_turn(&self, turn: u64) -> bool {
        *self.wake.borrow() == turn
    }

    fn last_frame(&self) -> Option<ServerFrame> {
        self.last
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn cursor(&self, batch: u64) -> String {
        format!("{}.{batch}", self.id)
    }

    fn batch_of(&self, cursor: &str) -> Option<u64> {
        let (id, batch) = cursor.rsplit_once('.')?;
        (id == self.id).then(|| batch.parse().ok()).flatten()
    }
}

pub(crate) fn end(state: &AppState, session: &PollSession, last: Option<ServerFrame>) {
    if session.ended.swap(true, Ordering::SeqCst) {
        return;
    }
    *session.last.lock().unwrap_or_else(PoisonError::into_inner) = last;
    leave_rooms(state, session.connection, session.device);
    state.sockets.unregister(session.device, session.connection);
    session.wake.send_modify(|_| {});
}

pub(crate) fn close(state: &AppState, session: &PollSession) {
    end(state, session, None);
    state.polls.remove(session);
}

pub(crate) async fn start(
    state: &AppState,
    opening: Opening,
    subscribed: ServerFrame,
    since: u64,
    head: u64,
) -> Result<PollBatch, ServerError> {
    let Opening {
        project,
        device,
        account,
        public_key,
        ticket,
        frames,
        outbound,
        understands,
    } = opening;
    let SocketTicket {
        id: connection,
        control,
        signal,
        ..
    } = ticket;
    let key = random_token();
    let (wake, _) = watch::channel(0u64);
    let session = Arc::new(PollSession {
        id: random_token(),
        key_hash: sha256_b64url(key.as_bytes()),
        project,
        device,
        account,
        public_key,
        connection,
        understands,
        inbox: tokio::sync::Mutex::new(Inbox {
            outbound,
            _open: frames,
            delivered: 0,
            pending: Vec::new(),
            backlog: (since < head).then_some((since, head)),
        }),
        wake,
        last: Mutex::new(None),
        ended: AtomicBool::new(false),
        closed: AtomicBool::new(false),
        active: AtomicUsize::new(0),
        seen: Mutex::new(Instant::now()),
        cursors: CursorGate::new(),
        _signal: signal,
    });
    if !state.polls.insert(&session) {
        end(state, &session, None);
        return Err(ServerError::RateLimited);
    }
    tokio::spawn(keep(state.clone(), Arc::clone(&session), control));
    let mut first = vec![subscribed];
    let read = {
        let mut inbox = session.inbox.lock().await;
        let mut budget = MAX_BATCH_BYTES;
        read_backlog(state, &session, &mut inbox, &mut first, &mut budget).await
    };
    if let Err(error) = read {
        close(state, &session);
        return Err(error);
    }
    Ok(PollBatch {
        cursor: Some(session.cursor(0)),
        key: Some(key),
        frames: first,
    })
}

async fn keep(
    state: AppState,
    session: Arc<PollSession>,
    mut control: UnboundedReceiver<SocketControl>,
) {
    loop {
        let idle = state.polls.idle();
        let check = (idle / 4).clamp(Duration::from_millis(20), Duration::from_secs(5));
        tokio::select! {
            signal = control.recv() => match signal {
                Some(SocketControl::Revoked(reason)) => end(&state, &session, Some(ServerFrame::SessionRevoked { reason })),
                Some(SocketControl::Overloaded | SocketControl::Replaced) | None => {
                    close(&state, &session);
                    return;
                }
            },
            () = tokio::time::sleep(check) => {
                if session.closed.load(Ordering::SeqCst) {
                    return;
                }
                if session.quiet_for(idle) {
                    close(&state, &session);
                    return;
                }
            }
        }
    }
}

async fn read_backlog(
    state: &AppState,
    session: &PollSession,
    inbox: &mut Inbox,
    frames: &mut Vec<ServerFrame>,
    budget: &mut usize,
) -> Result<(), ServerError> {
    while let Some((after, head)) = inbox.backlog {
        let page = backlog_page(state, session.project, after).await?;
        let mut cursor = after;
        let mut stopped = false;
        for entry in page.entries {
            if entry.size > *budget && !frames.is_empty() {
                stopped = true;
                break;
            }
            *budget = budget.saturating_sub(entry.size);
            cursor = entry.seq;
            if let Some(frame) = entry.frame {
                frames.push(frame);
            }
        }
        let done = !stopped && (!page.full || cursor >= head);
        inbox.backlog = (!done).then_some((cursor, head));
        if stopped {
            break;
        }
    }
    Ok(())
}

fn drain(inbox: &mut Inbox, frames: &mut Vec<ServerFrame>, budget: &mut usize) {
    while frames.len() < OUTBOUND_CAPACITY && *budget > 0 {
        match inbox.outbound.try_recv() {
            Ok(frame) => {
                *budget = budget.saturating_sub(frame_size(&frame));
                frames.push(frame);
            }
            Err(_) => break,
        }
    }
}

fn frame_size(frame: &ServerFrame) -> usize {
    match frame {
        ServerFrame::Update { envelope, .. } => envelope.payload.len() * 4 / 3 + 256,
        _ => 256,
    }
}

pub(crate) async fn poll(
    state: &AppState,
    session: Arc<PollSession>,
    cursor: &str,
) -> Result<PollBatch, ServerError> {
    let batch = session.batch_of(cursor).ok_or(ServerError::NotFound)?;
    let _active = session.enter();
    let (turn, mut wake) = session.take_turn();
    let mut inbox = session.inbox.lock().await;
    if !session.has_turn(turn) {
        return Ok(PollBatch {
            cursor: Some(session.cursor(inbox.delivered)),
            key: None,
            frames: Vec::new(),
        });
    }
    if batch == inbox.delivered {
        inbox.pending.clear();
    } else if batch + 1 == inbox.delivered && !inbox.pending.is_empty() {
        return Ok(PollBatch {
            cursor: Some(session.cursor(inbox.delivered)),
            key: None,
            frames: inbox.pending.clone(),
        });
    } else {
        return Err(ServerError::NotFound);
    }
    if let Some(last) = finished(state, &session)? {
        return Ok(PollBatch {
            cursor: Some(session.cursor(inbox.delivered + 1)),
            key: None,
            frames: vec![last],
        });
    }
    let mut frames = Vec::new();
    let mut budget = MAX_BATCH_BYTES;
    read_backlog(state, &session, &mut inbox, &mut frames, &mut budget).await?;
    if inbox.backlog.is_none() {
        drain(&mut inbox, &mut frames, &mut budget);
    }
    if frames.is_empty() && !state.polls.is_stopping() {
        let hold = tokio::time::sleep(state.polls.hold());
        tokio::pin!(hold);
        loop {
            tokio::select! {
                frame = inbox.outbound.recv() => {
                    if let Some(frame) = frame {
                        budget = budget.saturating_sub(frame_size(&frame));
                        frames.push(frame);
                        drain(&mut inbox, &mut frames, &mut budget);
                    }
                    break;
                }
                changed = wake.changed() => {
                    if changed.is_err()
                        || session.is_ended()
                        || !session.has_turn(turn)
                        || state.polls.is_stopping()
                    {
                        break;
                    }
                }
                () = &mut hold => break,
            }
        }
        if frames.is_empty() {
            if let Some(last) = finished(state, &session)? {
                return Ok(PollBatch {
                    cursor: Some(session.cursor(inbox.delivered + 1)),
                    key: None,
                    frames: vec![last],
                });
            }
        }
    }
    if !frames.is_empty() {
        inbox.delivered += 1;
        inbox.pending = frames.clone();
    }
    Ok(PollBatch {
        cursor: Some(session.cursor(inbox.delivered)),
        key: None,
        frames,
    })
}

fn finished(state: &AppState, session: &PollSession) -> Result<Option<ServerFrame>, ServerError> {
    if !session.is_ended() {
        return Ok(None);
    }
    let last = session.last_frame();
    state.polls.remove(session);
    last.map(Some).ok_or(ServerError::NotFound)
}
