mod big_files;
mod catch_up;
mod comment_switches;
mod comments_off;
mod devices;
mod editing;
mod ending;
mod refusals;
mod restore;
mod transport;
mod writer_list;

use std::collections::BTreeSet;

use oleafly_collab_protocol::envelope::{Envelope, EnvelopeMode};
use oleafly_collab_protocol::frames::MemberChangeKind;
use tokio::sync::mpsc::UnboundedReceiver;

use super::online::refused_for;
use super::trust::{peer_trust, trust, Refreshed, Trust};
use super::*;
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

fn snapshot_often(pair: &Pair) {
    pair._server
        .state()
        .snapshots
        .set_policy(oleafly_server::snapshots::Policy {
            build_after: 1,
            keep_updates: 1,
        });
}

async fn stopped(side: &mut Side) {
    if let Some(handle) = side.handle.take() {
        handle.stopped().await;
    }
}

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

async fn set_project_comments(pair: &Pair, project: SharedProjectId, enabled: bool) {
    let client = ServerClient::new(pair.url.clone()).unwrap();
    client
        .patch_project(
            &pair.bob.tokens.access_token,
            project,
            &oleafly_collab_protocol::projects::ProjectPatch {
                comments_enabled: Some(enabled),
                ..Default::default()
            },
        )
        .await
        .unwrap();
}

const PROMPTLY: Duration = Duration::from_secs(2);

async fn reached(side: &mut Side, wanted: impl Fn(&LiveStatus) -> bool) -> bool {
    let mut told = false;
    tokio::time::timeout(Duration::from_secs(30), async {
        while let Some(event) = side.events.recv().await {
            match event {
                LiveEvent::CommentsNotSent(_) => told = true,
                LiveEvent::Status(status) if wanted(&status) => return,
                _ => {}
            }
        }
    })
    .await
    .expect("the connection status changed");
    told
}

async fn back_online(side: &mut Side) -> bool {
    reached(side, |status| *status == LiveStatus::Online).await
}

async fn slow_link(upstream: std::net::SocketAddr, one_way: Duration) -> std::net::SocketAddr {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    async fn pump(
        mut from: tokio::net::tcp::OwnedReadHalf,
        mut to: tokio::net::tcp::OwnedWriteHalf,
        one_way: Duration,
    ) {
        let (sender, mut receiver) = mpsc::unbounded_channel::<(tokio::time::Instant, Vec<u8>)>();
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
