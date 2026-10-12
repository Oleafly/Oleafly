use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use oleafly_collab_protocol::envelope::{Envelope, EnvelopeMode};
use oleafly_collab_protocol::frames::{ClientFrame, FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::{AccountId, DeviceId, ServerId, SharedProjectId};
use oleafly_collab_protocol::projects::{PresenceState, ProjectRole};
use serde::Serialize;
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;

use crate::client::{connect_socket, ServerClient, Socket};
use crate::live::{LiveProject, Outgoing};
use crate::{CollabError, DeviceKey, SessionManager};

const PING_EVERY: Duration = Duration::from_secs(20);
const PONG_WITHIN: Duration = Duration::from_secs(30);
const SUBSCRIBE_WITHIN: Duration = Duration::from_secs(20);
const SNAPSHOT_EVERY: u64 = 200;
const BACKOFF_MS: [u64; 6] = [500, 1_000, 2_000, 4_000, 8_000, 15_000];

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
    Merged(Vec<(String, u32)>),
    Acknowledged,
}

#[derive(Debug)]
enum LiveCommand {
    Flush,
    Presence(PresenceState),
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

pub fn spawn_live(
    link: LiveLink,
    project: SharedLive,
    events: UnboundedSender<LiveEvent>,
) -> LiveHandle {
    let (commands, receiver) = mpsc::unbounded_channel();
    let task = tokio::spawn(run(link, project, events, receiver));
    LiveHandle { commands, task }
}

enum Exit {
    End(EndReason),
    Retry { reached_online: bool },
}

async fn run(
    link: LiveLink,
    project: SharedLive,
    events: UnboundedSender<LiveEvent>,
    mut commands: UnboundedReceiver<LiveCommand>,
) {
    let mut attempt = 0usize;
    loop {
        let _ = events.send(LiveEvent::Status(LiveStatus::Connecting));
        let exit = match connect(&link).await {
            Ok(socket) => serve(&link, &project, &events, &mut commands, socket).await,
            Err(CollabError::Unauthorized) => Exit::End(EndReason::SignedOut),
            Err(_) => Exit::Retry {
                reached_online: false,
            },
        };
        lock(&project).disconnected();
        match exit {
            Exit::End(reason) => {
                let _ = events.send(LiveEvent::Status(LiveStatus::Ended { reason }));
                return;
            }
            Exit::Retry { reached_online } => {
                if reached_online {
                    attempt = 0;
                }
            }
        }
        let delay = BACKOFF_MS[attempt.min(BACKOFF_MS.len() - 1)];
        attempt += 1;
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
                    Some(LiveCommand::Flush | LiveCommand::Presence(_)) => {}
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
        }
        other => other.map(|connection| connection.into_socket()),
    }
}

struct Wire {
    sink: SplitSink<Socket, Message>,
    stream: SplitStream<Socket>,
}

impl Wire {
    async fn send(&mut self, frame: &ClientFrame) -> Result<(), CollabError> {
        let text = serde_json::to_string(frame)
            .map_err(|error| CollabError::Network(error.to_string()))?;
        self.sink
            .send(Message::text(text))
            .await
            .map_err(|error| CollabError::Network(error.to_string()))
    }

    async fn next(&mut self) -> Result<ServerFrame, CollabError> {
        while let Some(message) = self.stream.next().await {
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
        Err(CollabError::Network(
            "the server closed the connection".to_owned(),
        ))
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

async fn flush(link: &LiveLink, project: &SharedLive, wire: &mut Wire) -> Result<(), CollabError> {
    let outgoing = lock(project).next_outgoing()?;
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
    for _ in 0..3 {
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
                ServerFrame::Subscribed { role, head_seq, .. } => return Ok(Ok((role, head_seq))),
                ServerFrame::SnapshotRequired { .. } => {
                    let access = link
                        .sessions
                        .access_token(link.server_id, &link.client)
                        .await?;
                    let (seq, snapshot) = link.client.get_snapshot(&access, link.project).await?;
                    let mut live = lock(project);
                    if live.last_seq() > 0 {
                        live.begin_catch_up();
                    }
                    live.import_snapshot(seq, &snapshot)?;
                    drop(live);
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

fn upload_snapshot(link: &LiveLink, project: &SharedLive) {
    let prepared = {
        let live = lock(project);
        if !live.can_edit() {
            return;
        }
        live.doc().snapshot().map(|bytes| (live.last_seq(), bytes))
    };
    let Ok((seq, snapshot)) = prepared else {
        return;
    };
    let link = link.clone();
    tokio::spawn(async move {
        if let Ok(access) = link
            .sessions
            .access_token(link.server_id, &link.client)
            .await
        {
            let _ = link
                .client
                .put_snapshot(&access, link.project, seq, snapshot)
                .await;
        }
    });
}

async fn serve(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    commands: &mut UnboundedReceiver<LiveCommand>,
    socket: Socket,
) -> Exit {
    let (sink, stream) = socket.split();
    let mut wire = Wire { sink, stream };
    let (role, head) = match subscribe(link, project, events, &mut wire).await {
        Ok(Ok(subscribed)) => subscribed,
        Ok(Err(reason)) => return Exit::End(reason),
        Err(CollabError::Unauthorized) => return Exit::End(EndReason::SignedOut),
        Err(_) => {
            return Exit::Retry {
                reached_online: false,
            }
        }
    };
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
    let exit = online(link, project, events, commands, &mut wire, catching_up).await;
    let _ = wire.sink.close().await;
    exit
}

fn report_merged(project: &SharedLive, events: &UnboundedSender<LiveEvent>) {
    let counts = lock(project).end_catch_up();
    if !counts.is_empty() {
        let _ = events.send(LiveEvent::Merged(counts.into_iter().collect()));
    }
}

async fn online(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    commands: &mut UnboundedReceiver<LiveCommand>,
    wire: &mut Wire,
    mut catching_up: Option<u64>,
) -> Exit {
    let retry = Exit::Retry {
        reached_online: true,
    };
    if flush(link, project, wire).await.is_err() {
        return retry;
    }
    let mut ping = tokio::time::interval(PING_EVERY);
    ping.tick().await;
    let mut ping_id = 0u64;
    let mut last_heard = tokio::time::Instant::now();
    let mut since_snapshot = 0u64;
    loop {
        tokio::select! {
            frame = wire.next() => {
                let Ok(frame) = frame else { return retry };
                last_heard = tokio::time::Instant::now();
                match frame {
                    ServerFrame::Update { seq, envelope, .. } => {
                        let imported = lock(project).import_update(seq, &envelope.payload);
                        match imported {
                            Ok(true) => {
                                let _ = events.send(LiveEvent::Changed);
                                since_snapshot += 1;
                            }
                            Ok(false) => {}
                            Err(_) => return retry,
                        }
                        if catching_up.is_some_and(|head| seq >= head) {
                            catching_up = None;
                            report_merged(project, events);
                        }
                    }
                    ServerFrame::Ack { batch_id, seq, .. } => {
                        lock(project).acknowledged(batch_id, seq);
                        let _ = events.send(LiveEvent::Acknowledged);
                        since_snapshot += 1;
                        if flush(link, project, wire).await.is_err() {
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
                    ServerFrame::Error { code: FrameErrorCode::Forbidden | FrameErrorCode::TooLarge, .. } => {
                        lock(project).refused();
                    }
                    ServerFrame::Error { .. } => return retry,
                    _ => {}
                }
                if since_snapshot >= SNAPSHOT_EVERY {
                    since_snapshot = 0;
                    upload_snapshot(link, project);
                }
            }
            command = commands.recv() => match command {
                Some(LiveCommand::Flush) => {
                    if flush(link, project, wire).await.is_err() {
                        return retry;
                    }
                }
                Some(LiveCommand::Presence(state)) => {
                    let frame = ClientFrame::Presence { project_id: link.project, state };
                    if wire.send(&frame).await.is_err() {
                        return retry;
                    }
                }
                Some(LiveCommand::Stop) | None => {
                    if lock(project).can_edit() && since_snapshot > 0 {
                        upload_snapshot(link, project);
                    }
                    return Exit::End(EndReason::Stopped);
                }
            },
            _ = ping.tick() => {
                if last_heard.elapsed() > PONG_WITHIN {
                    return retry;
                }
                ping_id += 1;
                if wire.send(&ClientFrame::Ping { id: ping_id }).await.is_err() {
                    return retry;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::test_util::{two_people, Pair, Person};
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
}
