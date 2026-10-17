use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use oleafly_collab_protocol::frames::{ClientFrame, ServerFrame};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;

use super::LiveLink;
use crate::client::{
    connect_socket, keep_polling, post_outbox, Heard, Outbox, PollChannel, PollRequest, PollTiming,
    Polled, Socket,
};
use crate::CollabError;

const POLL_QUEUE: usize = 64;
const SOCKET_QUEUE: usize = 64;
const CLOSE_WITHIN: Duration = Duration::from_secs(2);

const MANIFEST_WITHIN: Duration = Duration::from_secs(10);

pub(super) async fn connect(link: &LiveLink) -> Result<Socket, CollabError> {
    let access = link
        .sessions
        .access_token(link.server_id, &link.client)
        .await?;
    match connect_socket(
        link.client.url(),
        link.server_id,
        &access,
        link.device_id,
        &link.signing_key(),
    )
    .await
    {
        Err(CollabError::Unauthorized) => {
            let access = renewed_after_refusal(link, &access).await?;
            connect_socket(
                link.client.url(),
                link.server_id,
                &access,
                link.device_id,
                &link.signing_key(),
            )
            .await
            .map(|connection| connection.into_socket())
        }
        other => other.map(|connection| connection.into_socket()),
    }
}

// The server's own 401 on the upgrade or on opening long-poll. A server
// reinstalled with a fresh database, or another server now at the address,
// knows nothing of this session either, and asking it to renew the session
// would throw away one that is still good. So the manifest is checked
// first, as for a refused protocol version. Without it there is no telling
// which server answered, so nothing is renewed and the session tries again
// later as after any network error. Both transports then renew once and
// try once more, and a 401 after that means the session is gone. A 401
// without the server's own answer, from a proxy, renews nothing.
async fn renewed_after_refusal(link: &LiveLink, refused: &str) -> Result<String, CollabError> {
    let Ok(Ok(manifest)) = tokio::time::timeout(MANIFEST_WITHIN, link.client.capabilities()).await
    else {
        return Err(CollabError::Network(
            "the server turned the session away and its manifest did not load, so the \
             session was kept for the next try"
                .to_owned(),
        ));
    };
    if manifest.server_id != link.server_id {
        return Err(CollabError::ServerChanged {
            expected: link.server_id,
            found: manifest.server_id,
        });
    }
    link.sessions
        .refresh_rejected(link.server_id, &link.client, refused)
        .await
}

pub(super) enum Wire {
    Socket {
        stream: SplitStream<Socket>,
        writing: mpsc::Sender<Message>,
        writer: Option<JoinHandle<()>>,
        heard: Option<Heard>,
    },
    Poll(Box<PollWire>),
}

fn connection_closed() -> CollabError {
    CollabError::Network("the server closed the connection".to_owned())
}

// Frames go out from their own task, so a long upload on a slow link never
// stops the session from reading what the server sends or from stopping.
async fn write_out(mut sink: SplitSink<Socket, Message>, mut writing: mpsc::Receiver<Message>) {
    while let Some(message) = writing.recv().await {
        let closing = matches!(message, Message::Close(_));
        if sink.send(message).await.is_err() || closing {
            return;
        }
    }
    let _ = sink.close().await;
}

impl Wire {
    pub(super) fn socket(socket: Socket) -> Wire {
        let heard = Heard::of(&socket);
        let (sink, stream) = socket.split();
        let (writing, queued) = mpsc::channel(SOCKET_QUEUE);
        Wire::Socket {
            stream,
            writing,
            writer: Some(tokio::spawn(write_out(sink, queued))),
            heard,
        }
    }

    // How long since any byte came in on the socket, even part of a frame.
    pub(super) fn silent_for(&self) -> Option<Duration> {
        match self {
            Wire::Socket {
                heard: Some(heard), ..
            } => Some(heard.silent_for()),
            _ => None,
        }
    }

    pub(super) fn poll(link: &LiveLink) -> Wire {
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

    pub(super) async fn send(&mut self, frame: &ClientFrame) -> Result<(), CollabError> {
        match self {
            Wire::Socket { writing, .. } => {
                let text = serde_json::to_string(frame)
                    .map_err(|error| CollabError::Network(error.to_string()))?;
                match writing.try_send(Message::text(text)) {
                    Ok(()) => Ok(()),
                    Err(mpsc::error::TrySendError::Full(_))
                        if matches!(
                            frame,
                            ClientFrame::Ping { .. } | ClientFrame::Presence { .. }
                        ) =>
                    {
                        Ok(())
                    }
                    Err(mpsc::error::TrySendError::Full(_)) => Err(CollabError::Network(
                        "the connection stopped taking data".to_owned(),
                    )),
                    Err(mpsc::error::TrySendError::Closed(_)) => Err(connection_closed()),
                }
            }
            Wire::Poll(poll) => poll.send(frame).await,
        }
    }

    pub(super) async fn next(&mut self) -> Result<ServerFrame, CollabError> {
        let stream = match self {
            Wire::Socket { stream, .. } => stream,
            Wire::Poll(poll) => return poll.next().await,
        };
        while let Some(message) = stream.next().await {
            match message.map_err(|error| CollabError::Network(error.to_string()))? {
                Message::Text(text) => {
                    return ServerFrame::from_json(text.as_str()).map_err(|error| {
                        CollabError::Network(format!("unreadable frame: {error}"))
                    });
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
        Err(connection_closed())
    }

    pub(super) async fn close(&mut self) {
        match self {
            Wire::Socket {
                writing, writer, ..
            } => {
                let _ = writing.try_send(Message::Close(None));
                if let Some(mut writer) = writer.take() {
                    if tokio::time::timeout(CLOSE_WITHIN, &mut writer)
                        .await
                        .is_err()
                    {
                        writer.abort();
                    }
                }
            }
            Wire::Poll(poll) => poll.close().await,
        }
    }
}

impl Drop for Wire {
    fn drop(&mut self) {
        if let Wire::Socket {
            writer: Some(writer),
            ..
        } = self
        {
            writer.abort();
        }
    }
}

pub(super) struct PollWire {
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
        let key = self.link.signing_key();
        self.link
            .client
            .open_poll(PollRequest {
                server_id: self.link.server_id,
                access_token: access,
                device_id: self.link.device_id,
                key: &key,
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
                let access = renewed_after_refusal(link, &access).await?;
                self.open_with(&access, since).await?
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

pub(super) struct Probe(pub(super) JoinHandle<()>);

impl Drop for Probe {
    fn drop(&mut self) {
        self.0.abort();
    }
}

pub(super) async fn probe_socket(link: LiveLink, every: Duration, found: mpsc::Sender<()>) {
    loop {
        tokio::time::sleep(every).await;
        if let Ok(mut socket) = connect(&link).await {
            let _ = socket.close(None).await;
            let _ = found.send(()).await;
            return;
        }
    }
}
